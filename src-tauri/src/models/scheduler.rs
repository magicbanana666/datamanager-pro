//! Scheduler types. Mirrors `src/models/scheduler.ts`. Stored as JSON
//! under `scheduler\` in the data folder.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScheduledTaskType {
    Sync,
    Copy,
    Move,
    Mirror,
    Analyze,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScheduleFrequency {
    Daily,
    Weekly,
    Monthly,
    Once,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub frequency: ScheduleFrequency,
    /// Local time, `HH:MM`.
    pub time: String,
    /// Weekly: 0 = Monday ... 6 = Sunday.
    #[serde(default)]
    pub weekday: u32,
    /// Monthly: 1-31 (clamped to the month's last day).
    #[serde(default = "first")]
    pub day_of_month: u32,
    /// Once: `YYYY-MM-DD`.
    #[serde(default)]
    pub date: String,
}

fn first() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskOptions {
    pub include_subfolders: bool,
    /// Copy/Move: skip files whose size and date already match (otherwise
    /// every file is overwritten).
    pub incremental_only: bool,
    /// Sync: delete destination files no longer at the source.
    pub delete_at_destination: bool,
    /// Files locked by another program don't fail the run.
    pub skip_files_in_use: bool,
    /// Keep the run's full log in the app data folder.
    pub log_all_operations: bool,
    pub verify_after_transfer: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskRunStatus {
    Success,
    Failed,
    Cancelled,
    Missed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: ScheduledTaskType,
    pub source: String,
    #[serde(default)]
    pub destination: String,
    pub schedule: Schedule,
    pub enabled: bool,
    pub options: TaskOptions,
    /// ISO 8601, computed by the backend.
    #[serde(default)]
    pub next_run: Option<String>,
    #[serde(default)]
    pub last_run: Option<String>,
    #[serde(default)]
    pub last_run_status: Option<TaskRunStatus>,
    /// The job id of the run in progress (transfer events use it).
    #[serde(default)]
    pub running_job: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunHistoryEntry {
    pub id: String,
    pub task_id: String,
    pub task_name: String,
    pub date_time: String,
    pub status: TaskRunStatus,
    pub details: String,
    pub files: Option<u64>,
    pub size: Option<u64>,
    pub duration_seconds: f64,
    /// Full log, when "Log all operations" is on.
    #[serde(default)]
    pub log_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerSettings {
    /// Run tasks whose time passed while the app was closed, once, at
    /// startup. Otherwise they're recorded as missed.
    pub run_missed_on_startup: bool,
    /// History entries kept.
    pub history_limit: u32,
}

impl Default for SchedulerSettings {
    fn default() -> Self {
        Self { run_missed_on_startup: true, history_limit: 500 }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerData {
    pub tasks: Vec<ScheduledTask>,
    pub history: Vec<TaskRunHistoryEntry>,
    #[serde(default)]
    pub settings: SchedulerSettings,
}
