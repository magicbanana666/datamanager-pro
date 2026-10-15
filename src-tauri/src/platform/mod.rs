//! OS-specific code behind one interface (`current::*`), so `services`
//! needs no `#[cfg]` blocks. Only Windows is implemented.

#[cfg(windows)]
pub mod windows;
#[cfg(windows)]
pub use windows as current;

#[cfg(not(windows))]
mod fallback;
#[cfg(not(windows))]
pub use fallback as current;
