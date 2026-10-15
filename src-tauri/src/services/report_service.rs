//! Phase 9 report rendering: a [`ReportDocument`] to self-contained
//! HTML (charts as CSS bars, so they print), PDF (that HTML printed by
//! Microsoft Edge in headless mode - present on every Windows 10/11
//! machine), XLSX (one sheet per table) or CSV.

use crate::models::reports::{ReportDocument, ReportFormat, ReportRequest, ReportSection, ReportTemplate};
use rust_xlsxwriter::{Format, Workbook};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

fn cell_text(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        serde_json::Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

/// Rows shown per table in HTML/PDF - every row goes to XLSX/CSV.
fn html_row_limit(template: ReportTemplate) -> usize {
    match template {
        ReportTemplate::Compact => 25,
        ReportTemplate::Professional => 100,
        ReportTemplate::Detailed => 1_000,
    }
}

pub fn render_html(request: &ReportRequest, generated_at: &str) -> String {
    let doc = &request.document;
    let (base, pad) = match request.template {
        ReportTemplate::Compact => (11.5, 6),
        ReportTemplate::Professional => (13.0, 10),
        ReportTemplate::Detailed => (12.0, 8),
    };
    let mut h = String::new();
    let _ = write!(
        h,
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title><style>
:root {{ --fg:#1b2430; --muted:#5d6b7c; --line:#d9e0e8; --accent:#2f6fde; --band:#f4f7fa; }}
* {{ box-sizing:border-box; }}
body {{ font-family:"Segoe UI",Arial,sans-serif; font-size:{base}px; color:var(--fg); margin:28px; }}
header {{ border-bottom:3px solid var(--accent); padding-bottom:10px; margin-bottom:18px; }}
h1 {{ font-size:1.7em; margin:0 0 4px; }}
.meta {{ color:var(--muted); }}
h2 {{ font-size:1.2em; margin:22px 0 8px; color:var(--accent); break-after:avoid; }}
table {{ border-collapse:collapse; width:100%; }}
th, td {{ text-align:left; padding:{pad}px {pad2}px; border-bottom:1px solid var(--line); vertical-align:top; }}
th {{ background:var(--band); font-weight:600; }}
td.num {{ text-align:right; white-space:nowrap; }}
dl {{ display:grid; grid-template-columns:max-content 1fr; gap:4px 18px; margin:0; }}
dt {{ color:var(--muted); }} dd {{ margin:0; }}
.bar {{ display:grid; grid-template-columns:minmax(120px,30%) 1fr max-content; gap:10px; align-items:center; margin:3px 0; }}
.track {{ background:var(--band); height:12px; border-radius:3px; overflow:hidden; }}
.fill {{ background:var(--accent); height:100%; }}
.notes {{ background:var(--band); padding:10px 12px; border-left:3px solid var(--accent); white-space:pre-wrap; }}
.more {{ color:var(--muted); margin-top:4px; }}
footer {{ margin-top:28px; color:var(--muted); font-size:.85em; border-top:1px solid var(--line); padding-top:8px; }}
tr {{ break-inside:avoid; }}
</style></head><body>
<header><h1>{title}</h1><div class="meta">{category} · {source} · generated {generated}</div></header>
"#,
        title = esc(&doc.title),
        category = esc(&doc.category),
        source = esc(&doc.source),
        generated = esc(generated_at),
        base = base,
        pad = pad / 2,
        pad2 = pad,
    );
    if let Some(notes) = doc.notes.as_deref().filter(|n| !n.trim().is_empty()) {
        let _ = write!(h, "<h2>Notes</h2><div class=\"notes\">{}</div>", esc(notes));
    }
    let limit = html_row_limit(request.template);
    for section in &doc.sections {
        match section {
            ReportSection::KeyValues { title, items } => {
                let _ = write!(h, "<h2>{}</h2><dl>", esc(title));
                for kv in items {
                    let _ = write!(h, "<dt>{}</dt><dd>{}</dd>", esc(&kv.label), esc(&kv.value));
                }
                h.push_str("</dl>");
            }
            ReportSection::Table { title, columns, rows } => {
                let _ = write!(h, "<h2>{}</h2><table><thead><tr>", esc(title));
                for c in columns {
                    let _ = write!(h, "<th>{}</th>", esc(c));
                }
                h.push_str("</tr></thead><tbody>");
                for row in rows.iter().take(limit) {
                    h.push_str("<tr>");
                    for cell in row {
                        let class = if cell.is_number() { " class=\"num\"" } else { "" };
                        let _ = write!(h, "<td{class}>{}</td>", esc(&cell_text(cell)));
                    }
                    h.push_str("</tr>");
                }
                h.push_str("</tbody></table>");
                if rows.len() > limit {
                    let _ = write!(
                        h,
                        "<div class=\"more\">{} more rows - choose the Detailed template, XLSX or CSV for all of them.</div>",
                        rows.len() - limit
                    );
                }
            }
            ReportSection::Bars { title, items } => {
                if !request.include_charts {
                    continue;
                }
                let max = items.iter().map(|i| i.value).fold(0.0_f64, f64::max);
                let _ = write!(h, "<h2>{}</h2>", esc(title));
                for item in items {
                    let pct = if max > 0.0 { item.value / max * 100.0 } else { 0.0 };
                    let _ = write!(
                        h,
                        "<div class=\"bar\"><span>{}</span><div class=\"track\"><div class=\"fill\" style=\"width:{pct:.1}%\"></div></div><span>{}</span></div>",
                        esc(&item.label),
                        esc(&item.display)
                    );
                }
            }
        }
    }
    let _ = write!(h, "<footer>DataManager Pro {} report</footer></body></html>", env!("CARGO_PKG_VERSION"));
    h
}

fn csv_cell(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

pub fn render_csv(doc: &ReportDocument) -> String {
    let mut out = String::new();
    let line = |out: &mut String, cells: &[String]| {
        out.push_str(&cells.iter().map(|c| csv_cell(c)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    };
    line(&mut out, std::slice::from_ref(&doc.title));
    line(&mut out, &["Source".into(), doc.source.clone()]);
    for section in &doc.sections {
        out.push_str("\r\n");
        match section {
            ReportSection::KeyValues { title, items } => {
                line(&mut out, std::slice::from_ref(title));
                for kv in items {
                    line(&mut out, &[kv.label.clone(), kv.value.clone()]);
                }
            }
            ReportSection::Table { title, columns, rows } => {
                line(&mut out, std::slice::from_ref(title));
                line(&mut out, columns);
                for row in rows {
                    line(&mut out, &row.iter().map(cell_text).collect::<Vec<_>>());
                }
            }
            ReportSection::Bars { title, items } => {
                line(&mut out, std::slice::from_ref(title));
                for item in items {
                    line(&mut out, &[item.label.clone(), item.value.to_string(), item.display.clone()]);
                }
            }
        }
    }
    out
}

/// A valid, unique Excel sheet name (31 chars, none of `[]:*?/\`).
fn sheet_name(title: &str, used: &mut Vec<String>) -> String {
    let clean: String = title.chars().filter(|c| !"[]:*?/\\".contains(*c)).take(28).collect();
    let base = if clean.trim().is_empty() { "Sheet".to_string() } else { clean.trim().to_string() };
    let mut name = base.clone();
    let mut n = 2;
    while used.iter().any(|u| u.eq_ignore_ascii_case(&name)) {
        name = format!("{base} {n}");
        n += 1;
    }
    used.push(name.clone());
    name
}

pub fn write_xlsx(doc: &ReportDocument, path: &Path) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let bold = Format::new().set_bold();
    let title_format = Format::new().set_bold().set_font_size(14);
    let mut used = Vec::new();
    let err = |e: rust_xlsxwriter::XlsxError| e.to_string();

    // Summary sheet: title, source, notes and every key/value section.
    let summary = workbook.add_worksheet();
    summary.set_name(sheet_name("Summary", &mut used)).map_err(err)?;
    summary.write_with_format(0, 0, doc.title.as_str(), &title_format).map_err(err)?;
    summary.write(1, 0, "Source").map_err(err)?;
    summary.write(1, 1, doc.source.as_str()).map_err(err)?;
    let mut row = 3u32;
    if let Some(notes) = doc.notes.as_deref().filter(|n| !n.trim().is_empty()) {
        summary.write_with_format(row, 0, "Notes", &bold).map_err(err)?;
        summary.write(row, 1, notes).map_err(err)?;
        row += 2;
    }
    for section in &doc.sections {
        if let ReportSection::KeyValues { title, items } = section {
            summary.write_with_format(row, 0, title.as_str(), &bold).map_err(err)?;
            row += 1;
            for kv in items {
                summary.write(row, 0, kv.label.as_str()).map_err(err)?;
                summary.write(row, 1, kv.value.as_str()).map_err(err)?;
                row += 1;
            }
            row += 1;
        }
    }
    summary.autofit();

    for section in &doc.sections {
        match section {
            ReportSection::Table { title, columns, rows } => {
                let sheet = workbook.add_worksheet();
                sheet.set_name(sheet_name(title, &mut used)).map_err(err)?;
                for (c, col) in columns.iter().enumerate() {
                    sheet.write_with_format(0, c as u16, col.as_str(), &bold).map_err(err)?;
                }
                for (r, cells) in rows.iter().enumerate() {
                    for (c, cell) in cells.iter().enumerate() {
                        let (r, c) = (r as u32 + 1, c as u16);
                        match cell.as_f64() {
                            Some(n) => sheet.write(r, c, n).map_err(err)?,
                            None => sheet.write(r, c, cell_text(cell).as_str()).map_err(err)?,
                        };
                    }
                }
                sheet.set_freeze_panes(1, 0).map_err(err)?;
                sheet.autofit();
            }
            ReportSection::Bars { title, items } => {
                let sheet = workbook.add_worksheet();
                sheet.set_name(sheet_name(title, &mut used)).map_err(err)?;
                for (c, h) in ["Item", "Value", "Shown as"].iter().enumerate() {
                    sheet.write_with_format(0, c as u16, *h, &bold).map_err(err)?;
                }
                for (r, item) in items.iter().enumerate() {
                    let r = r as u32 + 1;
                    sheet.write(r, 0, item.label.as_str()).map_err(err)?;
                    sheet.write(r, 1, item.value).map_err(err)?;
                    sheet.write(r, 2, item.display.as_str()).map_err(err)?;
                }
                sheet.autofit();
            }
            ReportSection::KeyValues { .. } => {}
        }
    }
    workbook.save(path).map_err(err)
}

fn find_edge() -> Option<PathBuf> {
    let candidates = [
        std::env::var("ProgramFiles(x86)").ok(),
        std::env::var("ProgramFiles").ok(),
        std::env::var("LOCALAPPDATA").ok(),
    ];
    candidates
        .into_iter()
        .flatten()
        .map(|base| PathBuf::from(base).join("Microsoft\\Edge\\Application\\msedge.exe"))
        .find(|p| p.is_file())
}

/// Prints `html` to `pdf_path` with headless Edge (its own throwaway
/// profile, so it never touches a running Edge).
pub fn write_pdf(html: &str, pdf_path: &Path) -> Result<(), String> {
    let edge = find_edge().ok_or("Microsoft Edge was not found - choose HTML instead and print it to PDF.")?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let work = std::env::temp_dir().join(format!("dmp-report-{nanos}"));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = print_with_edge(&edge, &work, html, pdf_path);
    // Best effort: Edge can hold its profile files for a moment.
    let _ = std::fs::remove_dir_all(&work);
    result
}

fn print_with_edge(edge: &Path, work: &Path, html: &str, pdf_path: &Path) -> Result<(), String> {
    let html_path = work.join("report.html");
    std::fs::write(&html_path, html).map_err(|e| e.to_string())?;
    let url = format!("file:///{}", html_path.to_string_lossy().replace('\\', "/"));
    let mut command = std::process::Command::new(edge);
    command.args([
        "--headless=new".to_string(),
        "--disable-gpu".into(),
        "--no-first-run".into(),
        "--no-pdf-header-footer".into(),
        format!("--user-data-dir={}", work.join("profile").display()),
        format!("--print-to-pdf={}", pdf_path.display()),
        url,
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|e| format!("Starting Edge failed: {e}"))?;
    let started = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if !status.success() && !pdf_path.is_file() {
                return Err(format!("Edge could not print the report ({status})."));
            }
            break;
        }
        if started.elapsed() > Duration::from_secs(90) {
            let _ = child.kill();
            return Err("Printing the PDF timed out.".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if pdf_path.metadata().map_or(true, |m| m.len() == 0) {
        return Err("Edge didn't produce a PDF.".into());
    }
    Ok(())
}

/// Writes the report in the requested format to `path`.
pub fn write(request: &ReportRequest, path: &Path, generated_at: &str) -> Result<(), String> {
    match request.format {
        ReportFormat::Html => std::fs::write(path, render_html(request, generated_at)).map_err(|e| e.to_string()),
        ReportFormat::Pdf => write_pdf(&render_html(request, generated_at), path),
        ReportFormat::Csv => std::fs::write(path, render_csv(&request.document)).map_err(|e| e.to_string()),
        ReportFormat::Xlsx => write_xlsx(&request.document, path),
    }
}

/// `Disk Analysis Report` → `Disk_Analysis_Report`.
pub fn file_stem(title: &str) -> String {
    let stem: String = title
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    let stem = stem.split('_').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("_");
    if stem.is_empty() { "Report".into() } else { stem }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::reports::{BarItem, KeyValue};

    fn request(format: ReportFormat) -> ReportRequest {
        ReportRequest {
            document: ReportDocument {
                title: "Disk <Analysis> Report".into(),
                category: "Disk Analysis".into(),
                source: "C:\\Data".into(),
                notes: Some("Monthly".into()),
                sections: vec![
                    ReportSection::KeyValues {
                        title: "Summary".into(),
                        items: vec![KeyValue { label: "Files".into(), value: "12".into() }],
                    },
                    ReportSection::Table {
                        title: "Largest files".into(),
                        columns: vec!["Name".into(), "Size".into()],
                        rows: vec![vec!["a,b.txt".into(), 1024.into()], vec!["c.txt".into(), 10.into()]],
                    },
                    ReportSection::Bars {
                        title: "File types".into(),
                        items: vec![BarItem { label: "Documents".into(), value: 5.0, display: "5 B".into() }],
                    },
                ],
            },
            format,
            template: ReportTemplate::Professional,
            include_charts: true,
            description: String::new(),
        }
    }

    #[test]
    fn html_is_escaped_and_has_every_section() {
        let html = render_html(&request(ReportFormat::Html), "now");
        assert!(html.contains("Disk &lt;Analysis&gt; Report"));
        assert!(html.contains("Largest files") && html.contains("class=\"fill\""));
        assert!(html.contains("<td class=\"num\">1024</td>"));
    }

    #[test]
    fn csv_quotes_cells() {
        let csv = render_csv(&request(ReportFormat::Csv).document);
        assert!(csv.contains("\"a,b.txt\",1024\r\n"));
    }

    #[test]
    fn writes_an_xlsx_workbook() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("r.xlsx");
        write_xlsx(&request(ReportFormat::Xlsx).document, &path).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..2], b"PK");
    }

    #[test]
    fn sheet_names_are_valid_and_unique() {
        let mut used = Vec::new();
        assert_eq!(sheet_name("Top: files/folders", &mut used), "Top filesfolders");
        assert_eq!(sheet_name("Top: files/folders", &mut used), "Top filesfolders 2");
        assert_eq!(file_stem("Disk Analysis Report"), "Disk_Analysis_Report");
    }

    /// Needs Microsoft Edge; skipped where it isn't installed.
    #[test]
    fn prints_a_pdf_with_edge() {
        if find_edge().is_none() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("r.pdf");
        write(&request(ReportFormat::Pdf), &path, "now").unwrap();
        assert_eq!(&std::fs::read(&path).unwrap()[..4], b"%PDF");
    }
}
