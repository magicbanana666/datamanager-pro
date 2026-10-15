//! Data model for Phase 9 reports, mirroring `src/models/reports.ts`.
//! The frontend assembles a [`ReportDocument`] from the real results it
//! holds (scan, duplicates, comparison, search, transfers, scheduler);
//! the backend renders it to HTML, PDF, XLSX or CSV.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarItem {
    pub label: String,
    pub value: f64,
    /// The value as shown (e.g. "12.4 GB").
    pub display: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReportSection {
    #[serde(rename_all = "camelCase")]
    KeyValues { title: String, items: Vec<KeyValue> },
    /// Cells are strings or numbers (numbers stay numbers in XLSX/CSV).
    #[serde(rename_all = "camelCase")]
    Table { title: String, columns: Vec<String>, rows: Vec<Vec<serde_json::Value>> },
    #[serde(rename_all = "camelCase")]
    Bars { title: String, items: Vec<BarItem> },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDocument {
    pub title: String,
    /// The Recent Reports category ("Disk Analysis", ...).
    pub category: String,
    pub source: String,
    pub notes: Option<String>,
    pub sections: Vec<ReportSection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ReportFormat {
    Pdf,
    Html,
    Xlsx,
    Csv,
}

impl ReportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            ReportFormat::Pdf => "pdf",
            ReportFormat::Html => "html",
            ReportFormat::Xlsx => "xlsx",
            ReportFormat::Csv => "csv",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReportTemplate {
    Professional,
    Compact,
    Detailed,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRequest {
    pub document: ReportDocument,
    pub format: ReportFormat,
    pub template: ReportTemplate,
    pub include_charts: bool,
    pub description: String,
    /// Settings > Reports > Default output folder; empty uses the standard
    /// reports folder.
    #[serde(default)]
    pub output_dir: Option<String>,
}

/// One generated report, as listed under Recent Reports.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRecord {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub category: String,
    pub date_created: String,
    pub size: u64,
    pub description: String,
    pub path: String,
    pub format: ReportFormat,
}
