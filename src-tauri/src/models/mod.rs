//! Data shapes shared by Tauri commands. Only `system` has real fields in
//! Phase 1; the rest are documented placeholders reserved for later phases
//! so the module layout doesn't need to change when real scanning,
//! transfer, network and scheduler engines are added.

pub mod system;

pub mod disk;
pub mod network;
pub mod scheduler;
pub mod transfer;
