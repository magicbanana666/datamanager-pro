//! Storage volume types.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VolumeType {
    Fixed,
    Removable,
    Network,
    Optical,
    RamDisk,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageVolume {
    /// The mount point, e.g. `"C:\\"`.
    pub id: String,
    pub name: String,
    pub mount_point: String,
    pub drive_letter: Option<String>,
    pub file_system: Option<String>,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f64,
    pub is_removable: bool,
    pub is_read_only: bool,
    pub volume_label: Option<String>,
    pub volume_serial: Option<String>,
    pub volume_type: VolumeType,
}
