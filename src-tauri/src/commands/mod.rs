//! Tauri command handlers, grouped by feature area. Only `system` exposes
//! any commands in Phase 1; the rest are documented, empty placeholders
//! so later phases can add real commands without restructuring the
//! project.

pub mod system;

pub mod disk;
pub mod network;
pub mod scheduler;
pub mod transfer;
