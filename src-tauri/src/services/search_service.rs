//! The Phase 5 file-search engine.
//!
//! Lists the location with the regular scan engines (so a name search
//! over a whole drive is as fast as a scan), applies the type/size/date
//! filters, then matches each remaining file in parallel:
//!
//! - **name**: plain text, a wildcard pattern (`*.pdf`), or a regex;
//! - **archive**: the names of entries inside `.zip` files - read from
//!   the archive's central directory only, nothing is decompressed;
//! - **content**: the file's raw bytes, so any ASCII/UTF-8 text format
//!   matches (source, logs, CSV, HTML, ...). Formats that store text
//!   compressed or as UTF-16 (`.docx`, `.pdf`, many `.txt` files saved
//!   by Notepad as "Unicode") are not decoded and won't match by content.
//!
//! Read-only throughout.

use crate::models::hash_job::{HashJobPhase, HashJobState};
use crate::models::scan::{FsNode, NodeKind, ScanOptions};
use crate::models::search::{
    ContentSnippet, MatchedIn, SearchHit, SearchOptions, MAX_ARCHIVE_ENTRIES, MAX_CONTENT_BYTES,
    MAX_HITS, MAX_SNIPPETS,
};
use crate::services::scan_service;
use chrono::DateTime;
use rayon::prelude::*;
use regex::{bytes, Regex, RegexBuilder};
use std::fs::{self, File};
use std::sync::atomic::Ordering;

/// How much of a file is checked for a NUL byte to call it binary.
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
/// Longest snippet text shown per content match.
const SNIPPET_CHARS: usize = 160;

/// The compiled query: one regex for names (a wildcard pattern must
/// match the *whole* name) and one for content (matches anywhere).
pub struct Matcher {
    name: Regex,
    content: bytes::Regex,
}

/// Builds the matcher, or a readable message for an invalid pattern -
/// called up front by the command so a typo'd regex is reported
/// immediately instead of as "no results".
pub fn build_matcher(options: &SearchOptions) -> Result<Matcher, String> {
    let query = options.query.trim();
    if query.is_empty() {
        return Err("Enter something to search for.".to_string());
    }
    let is_glob = !options.regex && (query.contains('*') || query.contains('?'));
    let core = if options.regex {
        query.to_string()
    } else if is_glob {
        glob_to_regex(query)
    } else {
        regex::escape(query)
    };
    let core = if options.whole_words {
        format!(r"\b(?:{core})\b")
    } else {
        core
    };
    let name_pattern = if is_glob {
        format!("^(?:{core})$")
    } else {
        core.clone()
    };

    let invalid = |e: regex::Error| format!("Invalid search pattern: {e}");
    Ok(Matcher {
        name: RegexBuilder::new(&name_pattern)
            .case_insensitive(!options.case_sensitive)
            .build()
            .map_err(invalid)?,
        content: bytes::RegexBuilder::new(&core)
            .case_insensitive(!options.case_sensitive)
            .build()
            .map_err(invalid)?,
    })
}

fn glob_to_regex(glob: &str) -> String {
    let mut out = String::new();
    for c in glob.chars() {
        match c {
            '*' => out.push_str(".*"),
            '?' => out.push('.'),
            c => out.push_str(&regex::escape(&c.to_string())),
        }
    }
    out
}

pub struct SearchOutcome {
    /// Sorted by path, capped at `MAX_HITS`.
    pub hits: Vec<SearchHit>,
    pub total_hits: u64,
    pub files_searched: u64,
}

pub fn search(
    location: &str,
    options: &SearchOptions,
    matcher: &Matcher,
    state: &HashJobState,
) -> SearchOutcome {
    let candidates = collect_candidates(location, options, state);
    let files_searched = candidates.len() as u64;

    if options.match_content {
        let to_read = candidates
            .iter()
            .filter(|f| f.size <= MAX_CONTENT_BYTES)
            .map(|f| f.size)
            .sum();
        state.begin_phase(HashJobPhase::Hashing, to_read);
    }

    let mut hits: Vec<SearchHit> = candidates
        .into_par_iter()
        .filter_map(|f| {
            if state.is_cancelled() {
                return None;
            }
            match_file(f, options, matcher, state)
        })
        .collect();

    let total_hits = hits.len() as u64;
    hits.sort_unstable_by(|a, b| a.path.cmp(&b.path));
    hits.truncate(MAX_HITS);
    SearchOutcome {
        hits,
        total_hits,
        files_searched,
    }
}

struct Candidate {
    path: String,
    name: String,
    size: u64,
    last_modified: Option<String>,
}

fn collect_candidates(
    location: &str,
    options: &SearchOptions,
    state: &HashJobState,
) -> Vec<Candidate> {
    let scan_options = ScanOptions {
        show_hidden: options.include_hidden,
        show_system: options.include_system,
        threads: None,
    };
    let (tree, _engine) = scan_service::run_scan(location, scan_options, &state.scan);
    let modified_after = options
        .modified_after
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok());

    let keep = |n: &FsNode| {
        if options.min_size.is_some_and(|min| n.size < min)
            || options.max_size.is_some_and(|max| n.size > max)
        {
            return false;
        }
        if !options.extensions.is_empty() {
            let ext = extension_of(&n.name);
            if !options.extensions.contains(&ext) {
                return false;
            }
        }
        match modified_after {
            Some(after) => n
                .last_modified
                .as_deref()
                .and_then(|m| DateTime::parse_from_rfc3339(m).ok())
                .is_some_and(|m| m >= after),
            None => true,
        }
    };

    let mut out = Vec::new();
    let mut stack: Vec<&FsNode> = tree.children.as_deref().unwrap_or(&[]).iter().collect();
    while let Some(n) = stack.pop() {
        match n.kind {
            NodeKind::File => {
                if keep(n) {
                    out.push(Candidate {
                        path: n.path.clone(),
                        name: n.name.clone(),
                        size: n.size,
                        last_modified: n.last_modified.clone(),
                    });
                }
            }
            NodeKind::Folder if options.include_subfolders => {
                stack.extend(n.children.as_deref().unwrap_or(&[]))
            }
            NodeKind::Folder => {}
        }
    }
    out
}

/// Same rule as `scan_analysis_service`: a leading dot alone means no
/// extension.
fn extension_of(name: &str) -> String {
    match name.rfind('.') {
        Some(idx) if idx > 0 => name[idx..].to_lowercase(),
        _ => String::new(),
    }
}

fn match_file(
    f: Candidate,
    options: &SearchOptions,
    matcher: &Matcher,
    state: &HashJobState,
) -> Option<SearchHit> {
    let hit = |matched_in, occurrences, snippets, archive_entries| SearchHit {
        path: f.path.clone(),
        name: f.name.clone(),
        size: f.size,
        last_modified: f.last_modified.clone(),
        matched_in,
        occurrences,
        snippets,
        archive_entries,
    };

    // A name match settles it without reading the file - content
    // occurrences are only gathered for files found *by* content.
    if options.match_name && matcher.name.is_match(&f.name) {
        if options.match_content && f.size <= MAX_CONTENT_BYTES {
            state.bytes_hashed.fetch_add(f.size, Ordering::Relaxed);
        }
        return Some(hit(MatchedIn::Name, 0, Vec::new(), Vec::new()));
    }

    if options.search_archives && extension_of(&f.name) == ".zip" {
        let entries = matching_zip_entries(&f.path, matcher, state);
        if !entries.is_empty() {
            return Some(hit(MatchedIn::Archive, 0, Vec::new(), entries));
        }
    }

    if options.match_content && f.size <= MAX_CONTENT_BYTES {
        state.scan.set_current_path(&f.path);
        let found = search_content(&f.path, options, matcher, state);
        state.bytes_hashed.fetch_add(f.size, Ordering::Relaxed);
        if let Some((occurrences, snippets)) = found {
            return Some(hit(MatchedIn::Content, occurrences, snippets, Vec::new()));
        }
    }
    None
}

/// Entry names inside a `.zip` matching the query (by their file name,
/// like a regular name search). Unreadable/corrupt archives are skipped.
fn matching_zip_entries(path: &str, matcher: &Matcher, state: &HashJobState) -> Vec<String> {
    let archive = File::open(path)
        .map_err(|e| e.to_string())
        .and_then(|file| zip::ZipArchive::new(file).map_err(|e| e.to_string()));
    match archive {
        Ok(archive) => archive
            .file_names()
            // An entry name that isn't valid text can't match a text query.
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or(entry);
                matcher.name.is_match(name)
            })
            .take(MAX_ARCHIVE_ENTRIES)
            .map(|entry| entry.into_owned())
            .collect(),
        Err(err) => {
            state
                .scan
                .record_skip(path, format!("Couldn't read archive: {err}"));
            Vec::new()
        }
    }
}

/// `None` when the file has no match (or can't be read, or is binary
/// and binary files are excluded).
fn search_content(
    path: &str,
    options: &SearchOptions,
    matcher: &Matcher,
    state: &HashJobState,
) -> Option<(u64, Vec<ContentSnippet>)> {
    let data = match fs::read(path) {
        Ok(d) => d,
        Err(err) => {
            if !state.is_cancelled() {
                state.scan.record_skip(path, err.to_string());
            }
            return None;
        }
    };
    if !options.include_binary && data[..data.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
        return None;
    }

    let mut occurrences = 0u64;
    let mut snippets = Vec::new();
    // Line numbers are counted incrementally from the previous match, so
    // a file with many matches isn't rescanned from the start each time.
    let (mut line, mut counted_to) = (1u64, 0usize);
    for m in matcher.content.find_iter(&data) {
        occurrences += 1;
        if snippets.len() < MAX_SNIPPETS {
            line += data[counted_to..m.start()]
                .iter()
                .filter(|&&b| b == b'\n')
                .count() as u64;
            counted_to = m.start();
            snippets.push(ContentSnippet {
                line,
                text: snippet(&data, m.start(), m.end()),
            });
        }
    }
    (occurrences > 0).then_some((occurrences, snippets))
}

/// The line containing a match, trimmed to [`SNIPPET_CHARS`] around it.
fn snippet(data: &[u8], start: usize, end: usize) -> String {
    let line_start = data[..start]
        .iter()
        .rposition(|&b| b == b'\n')
        .map_or(0, |i| i + 1);
    let line_end = data[end..]
        .iter()
        .position(|&b| b == b'\n')
        .map_or(data.len(), |i| end + i);
    let from = start.saturating_sub(SNIPPET_CHARS / 2).max(line_start);
    let to = (end + SNIPPET_CHARS / 2).min(line_end);
    let text = String::from_utf8_lossy(&data[from..to]);
    let mut text = text.trim().to_string();
    if from > line_start {
        text.insert(0, '…');
    }
    if to < line_end {
        text.push('…');
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(query: &str) -> SearchOptions {
        SearchOptions {
            query: query.to_string(),
            match_name: true,
            match_content: true,
            case_sensitive: false,
            regex: false,
            whole_words: false,
            include_subfolders: true,
            search_archives: false,
            include_binary: false,
            include_hidden: false,
            include_system: false,
            extensions: Vec::new(),
            min_size: None,
            max_size: None,
            modified_after: None,
        }
    }

    fn run(dir: &std::path::Path, opts: &SearchOptions) -> Vec<SearchHit> {
        let matcher = build_matcher(opts).unwrap();
        let state = HashJobState::new();
        search(&dir.to_string_lossy(), opts, &matcher, &state).hits
    }

    fn names(hits: &[SearchHit]) -> Vec<(&str, MatchedIn)> {
        hits.iter()
            .map(|h| (h.name.as_str(), h.matched_in))
            .collect()
    }

    #[test]
    fn finds_by_name_and_content_with_line_numbers() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("Report_2026.txt"), b"nothing here").unwrap();
        fs::write(
            dir.path().join("sub").join("notes.txt"),
            b"line one\nthe REPORT is due\nreport again",
        )
        .unwrap();
        fs::write(dir.path().join("binary.dat"), b"report\0\0\0").unwrap();
        fs::write(dir.path().join("other.txt"), b"unrelated").unwrap();

        let hits = run(dir.path(), &options("report"));
        assert_eq!(
            names(&hits),
            vec![
                ("Report_2026.txt", MatchedIn::Name),
                ("notes.txt", MatchedIn::Content)
            ]
        );
        let notes = &hits[1];
        assert_eq!(notes.occurrences, 2);
        assert_eq!(notes.snippets[0].line, 2);
        assert_eq!(notes.snippets[0].text, "the REPORT is due");
        assert_eq!(notes.snippets[1].line, 3);

        let mut with_binary = options("report");
        with_binary.include_binary = true;
        assert_eq!(run(dir.path(), &with_binary).len(), 3);
    }

    #[test]
    fn wildcards_match_whole_names_and_filters_apply() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.pdf"), b"x").unwrap();
        fs::write(dir.path().join("a.pdf.bak"), b"x").unwrap();
        fs::write(dir.path().join("big.pdf"), vec![1u8; 5000]).unwrap();

        let mut opts = options("*.pdf");
        opts.match_content = false;
        assert_eq!(names(&run(dir.path(), &opts)).len(), 2);

        opts.max_size = Some(100);
        assert_eq!(
            names(&run(dir.path(), &opts)),
            vec![("a.pdf", MatchedIn::Name)]
        );
    }

    #[test]
    fn regex_case_and_whole_words() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("x.txt"),
            b"Invoice INV-2026-004 and reinvoiced",
        )
        .unwrap();

        let mut opts = options(r"INV-\d{4}");
        opts.regex = true;
        opts.case_sensitive = true;
        assert_eq!(run(dir.path(), &opts)[0].occurrences, 1);

        let mut words = options("invoice");
        words.whole_words = true;
        assert_eq!(run(dir.path(), &words)[0].occurrences, 1); // not "reinvoiced"

        let mut bad = options("(unclosed");
        bad.regex = true;
        assert!(build_matcher(&bad).is_err());
    }

    #[test]
    fn finds_entries_inside_zip_archives() {
        let dir = tempfile::tempdir().unwrap();
        let file = File::create(dir.path().join("backup.zip")).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("docs/Report.txt", stored).unwrap();
        std::io::Write::write_all(&mut zip, b"x").unwrap();
        zip.finish().unwrap();

        let mut opts = options("report");
        opts.match_content = false;
        assert!(run(dir.path(), &opts).is_empty());
        opts.search_archives = true;
        let hits = run(dir.path(), &opts);
        assert_eq!(names(&hits), vec![("backup.zip", MatchedIn::Archive)]);
        assert_eq!(hits[0].archive_entries, vec!["docs/Report.txt"]);
    }

    /// Live timing: a wildcard name search over `C:\Windows`, then a
    /// content search over `C:\Windows\Logs`.
    #[test]
    #[ignore]
    fn search_bench() {
        let time = |location: &str, opts: &SearchOptions| {
            let matcher = build_matcher(opts).unwrap();
            let state = HashJobState::new();
            let started = std::time::Instant::now();
            let outcome = search(location, opts, &matcher, &state);
            println!(
                "search {location} {:?}: {:.1}s searched={} hits={}",
                opts.query,
                started.elapsed().as_secs_f64(),
                outcome.files_searched,
                outcome.total_hits
            );
        };
        let mut names = options("*.dll");
        names.match_content = false;
        time(r"C:\Windows", &names);
        let mut content = options("error");
        content.match_name = false;
        time(r"C:\Windows\Logs", &content);
    }
}
