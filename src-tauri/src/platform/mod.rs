//! Platform-specific filesystem/storage APIs, isolated behind a small,
//! identical surface (`current::*`) on every target so `services` never
//! needs its own `#[cfg(windows)]` blocks. Windows 10/11 is the primary,
//! fully-implemented target; other platforms get an honest
//! `Unsupported`/`None` fallback rather than guessed values.

#[cfg(windows)]
pub mod windows;
#[cfg(windows)]
pub use windows as current;

#[cfg(not(windows))]
mod fallback;
#[cfg(not(windows))]
pub use fallback as current;
