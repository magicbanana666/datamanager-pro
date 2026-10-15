//! Data shapes shared by Tauri commands.
//!
//! `errors`, `filesystem` and `storage` back the Phase 2 read-only
//! filesystem API. `scan` backs the Phase 3 recursive scanner. `system`
//! holds both the Phase 1 diagnostic types and the real `SystemInfo`
//! added in Phase 2. `network`, `scheduler` and `transfer` remain
//! documented, empty placeholders reserved for later phases so the
//! module layout doesn't need to change when real network scanning,
//! scheduling and transfer engines are added.

pub mod comparison;
pub mod duplicates;
pub mod errors;
pub mod filesystem;
pub mod hash_job;
pub mod scan;
pub mod search;
pub mod storage;
pub mod system;

pub mod network;
pub mod scheduler;
pub mod transfer;
