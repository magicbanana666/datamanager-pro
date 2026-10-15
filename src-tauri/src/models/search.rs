//! File search types. Mirrors `src/models/search.ts`.

use crate::models::scan::ScanSkip;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub query: String,
    pub match_name: bool,
    pub match_content: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    /// The query is a regular expression. Otherwise it's plain text, or
    /// a wildcard pattern (`*`, `?`) when it contains either.
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub whole_words: bool,
    #[serde(default = "default_true")]
    pub include_subfolders: bool,
    /// Also match the names of entries inside `.zip` archives.
    #[serde(default)]
    pub search_archives: bool,
    /// Search the content of files that look binary (a NUL byte in
    /// their first 8 KiB) too.
    #[serde(default)]
    pub include_binary: bool,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub include_system: bool,
    /// Lowercase extensions with their dot (`.pdf`); empty = any type.
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub min_size: Option<u64>,
    #[serde(default)]
    pub max_size: Option<u64>,
    /// RFC 3339; only files modified at or after this.
    #[serde(default)]
    pub modified_after: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchedIn {
    Name,
    Content,
    Archive,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSnippet {
    /// 1-based.
    pub line: u64,
    /// The matching line, trimmed to a readable length around the match.
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub last_modified: Option<String>,
    pub matched_in: MatchedIn,
    /// Content matches in the file (0 for a name-only match).
    pub occurrences: u64,
    /// The first few content matches, for the Occurrences panel.
    pub snippets: Vec<ContentSnippet>,
    /// For an archive match: the matching entries inside it.
    pub archive_entries: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub scan_id: String,
    /// Capped at [`MAX_HITS`]; `total_hits` counts every match.
    pub hits: Vec<SearchHit>,
    pub total_hits: u64,
    pub files_searched: u64,
    pub elapsed_ms: u64,
    pub skipped: Vec<ScanSkip>,
}

/// Hit cap per result; a broad query over a drive can match far more.
pub const MAX_HITS: usize = 10_000;
/// Content matches kept per file for the Occurrences panel.
pub const MAX_SNIPPETS: usize = 20;
/// Archive entries kept per archive hit.
pub const MAX_ARCHIVE_ENTRIES: usize = 50;
/// Larger files are only matched by name (content search reads the
/// whole file into memory).
pub const MAX_CONTENT_BYTES: u64 = 64 * 1024 * 1024;
