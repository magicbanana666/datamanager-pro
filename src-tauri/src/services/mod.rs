//! Business-logic layer between Tauri commands and the
//! filesystem/platform APIs. Commands stay thin (argument
//! marshalling + `spawn_blocking`); the actual read-only I/O logic
//! lives here so it stays independently testable.

pub mod comparison_service;
pub mod duplicate_service;
pub mod filesystem_service;
pub mod hashing;
pub mod path_service;
pub mod scan_analysis_service;
pub mod scan_service;
pub mod search_service;
pub mod storage_service;
pub mod sync_state;
pub mod transfer_journal;
pub mod transfer_service;
