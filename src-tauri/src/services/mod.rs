//! Business-logic layer that will sit between Tauri commands and the
//! filesystem/network/scheduler engines in later phases (e.g. a
//! `scanner` service used by both `commands::disk` and
//! `commands::network`, or a `journal` service backing resumable
//! transfers). Deliberately empty in Phase 1: no service needs to exist
//! yet because no command performs real work, but the module is kept so
//! `commands::*` has an obvious place to delegate to once it does.
