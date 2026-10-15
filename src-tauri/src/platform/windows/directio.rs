//! Fast copying of large files with native Win32 I/O:
//!
//! - **Unbuffered** (`FILE_FLAG_NO_BUFFERING`): data goes straight between
//!   the disks and our buffers, bypassing the Windows file cache - a big
//!   copy neither evicts everything else from RAM nor slows the PC down.
//! - **Asynchronous with several requests in flight**
//!   (`FILE_FLAG_OVERLAPPED`): a ring of sector-aligned buffers keeps the
//!   source reading ahead while earlier chunks are being written, so
//!   neither disk waits for the other.
//! - **Pre-allocated**: the destination's full size is set before the
//!   first write - less fragmentation, and a full disk fails at once
//!   instead of halfway.
//!
//! Chunks are handed to a [`CopySink`] in order (for hashing/progress)
//! and completed writes are reported in order (for resume checkpoints).

use super::to_wide;
use std::alloc::{alloc_zeroed, dealloc, Layout};
use std::io;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, ERROR_HANDLE_EOF, ERROR_IO_PENDING, GENERIC_READ, GENERIC_WRITE, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, GetDiskFreeSpaceW, ReadFile, SetFileInformationByHandle, WriteFile, FileEndOfFileInfo,
    CREATE_ALWAYS, FILE_END_OF_FILE_INFO, FILE_FLAGS_AND_ATTRIBUTES, FILE_FLAG_NO_BUFFERING,
    FILE_FLAG_OVERLAPPED, FILE_FLAG_SEQUENTIAL_SCAN, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING,
};
use windows::Win32::System::IO::{CancelIoEx, DeviceIoControl, GetOverlappedResult, OVERLAPPED};
use windows::Win32::System::Ioctl::{
    PropertyStandardQuery, StorageDeviceSeekPenaltyProperty, DEVICE_SEEK_PENALTY_DESCRIPTOR,
    IOCTL_STORAGE_QUERY_PROPERTY, STORAGE_PROPERTY_QUERY,
};
use windows::Win32::System::Threading::CreateEventW;

/// What kind of storage a path is on - decides how much to parallelize.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Medium {
    /// No seek penalty: SSD / NVMe.
    Solid,
    /// Seek penalty: a spinning disk.
    Rotational,
    /// A UNC path or mapped network drive.
    Network,
    Unknown,
}

/// The medium behind `path`, via `IOCTL_STORAGE_QUERY_PROPERTY`'s seek
/// penalty (works without administrator rights).
pub fn medium_of(path: &Path) -> Medium {
    let s = path.to_string_lossy();
    if crate::utils::path::is_unc(&s) {
        return Medium::Network;
    }
    let Some(letter) = s.chars().next().filter(|c| c.is_ascii_alphabetic() && s[1..].starts_with(':')) else {
        return Medium::Unknown;
    };
    let root = to_wide(&format!("{letter}:\\"));
    if unsafe { windows::Win32::Storage::FileSystem::GetDriveTypeW(PCWSTR(root.as_ptr())) } == 4 {
        return Medium::Network; // DRIVE_REMOTE
    }
    let device = to_wide(&format!("\\\\.\\{letter}:"));
    let Ok(handle) = (unsafe {
        CreateFileW(
            PCWSTR(device.as_ptr()),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
    }) else {
        return Medium::Unknown;
    };
    let query = STORAGE_PROPERTY_QUERY {
        PropertyId: StorageDeviceSeekPenaltyProperty,
        QueryType: PropertyStandardQuery,
        ..Default::default()
    };
    let mut out = DEVICE_SEEK_PENALTY_DESCRIPTOR::default();
    let mut returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_STORAGE_QUERY_PROPERTY,
            Some(&query as *const _ as *const _),
            std::mem::size_of::<STORAGE_PROPERTY_QUERY>() as u32,
            Some(&mut out as *mut _ as *mut _),
            std::mem::size_of::<DEVICE_SEEK_PENALTY_DESCRIPTOR>() as u32,
            Some(&mut returned),
            None,
        )
    }
    .is_ok();
    unsafe {
        let _ = CloseHandle(handle);
    }
    match (ok, out.IncursSeekPenalty) {
        (true, true) => Medium::Rotational,
        (true, false) => Medium::Solid,
        _ => Medium::Unknown,
    }
}

/// Receives a copy's data and progress, in file order.
pub trait CopySink {
    /// A chunk was read (exactly the file's bytes). `false` stops the
    /// copy (cancelled) - what's written so far is kept for a resume.
    fn data(&mut self, chunk: &[u8]) -> bool;
    /// Everything up to `total` bytes is on disk.
    fn written(&mut self, total: u64);
}

pub struct DirectCopy<'a> {
    pub from: &'a Path,
    /// The destination (a `.dmp-part` file).
    pub to: &'a Path,
    pub size: u64,
    /// Resume from here (the existing destination already holds the bytes
    /// before it); rounded down to the sector alignment.
    pub resume_at: u64,
    /// Bytes per request.
    pub chunk: usize,
    /// Requests in flight.
    pub depth: usize,
}

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

struct AlignedBuf {
    ptr: *mut u8,
    layout: Layout,
}
impl AlignedBuf {
    fn new(len: usize, align: usize) -> io::Result<Self> {
        let layout = Layout::from_size_align(len, align).map_err(io::Error::other)?;
        let ptr = unsafe { alloc_zeroed(layout) };
        if ptr.is_null() {
            return Err(io::Error::other("out of memory"));
        }
        Ok(Self { ptr, layout })
    }
    fn slice(&mut self) -> &mut [u8] {
        unsafe { std::slice::from_raw_parts_mut(self.ptr, self.layout.size()) }
    }
}
impl Drop for AlignedBuf {
    fn drop(&mut self) {
        unsafe { dealloc(self.ptr, self.layout) }
    }
}

fn sector_size(path: &Path) -> u32 {
    let s = path.to_string_lossy();
    let root = match s.char_indices().nth(2) {
        Some(_) if s.as_bytes().get(1) == Some(&b':') => format!("{}\\", &s[..2]),
        _ => return 4096,
    };
    let wide = to_wide(&root);
    let mut bytes = 0u32;
    if unsafe { GetDiskFreeSpaceW(PCWSTR(wide.as_ptr()), None, Some(&mut bytes), None, None) }.is_ok() && bytes > 0 {
        bytes
    } else {
        4096
    }
}

fn open(path: &Path, write: bool, create: bool) -> io::Result<Handle> {
    let wide = to_wide(&path.to_string_lossy());
    let flags = FILE_FLAG_NO_BUFFERING | FILE_FLAG_OVERLAPPED | if write { FILE_FLAGS_AND_ATTRIBUTES(0) } else { FILE_FLAG_SEQUENTIAL_SCAN };
    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            if write { GENERIC_WRITE.0 } else { GENERIC_READ.0 },
            if write { FILE_SHARE_READ } else { FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE },
            None,
            if create { CREATE_ALWAYS } else { OPEN_EXISTING },
            flags,
            None,
        )
    }
    .map_err(io::Error::from)?;
    Ok(Handle(handle))
}

fn set_end_of_file(file: &Handle, len: u64) -> io::Result<()> {
    let info = FILE_END_OF_FILE_INFO { EndOfFile: len as i64 };
    unsafe {
        SetFileInformationByHandle(
            file.0,
            FileEndOfFileInfo,
            &info as *const _ as *const _,
            std::mem::size_of::<FILE_END_OF_FILE_INFO>() as u32,
        )
    }
    .map_err(io::Error::from)
}

fn overlapped_at(offset: u64, event: HANDLE) -> OVERLAPPED {
    let mut ov = OVERLAPPED { hEvent: event, ..Default::default() };
    ov.Anonymous.Anonymous.Offset = offset as u32;
    ov.Anonymous.Anonymous.OffsetHigh = (offset >> 32) as u32;
    ov
}

/// Starts an overlapped read/write; `Ok(())` when it's under way or done.
fn started(result: windows::core::Result<()>) -> io::Result<()> {
    match result {
        Ok(()) => Ok(()),
        Err(e) if e.code() == ERROR_IO_PENDING.to_hresult() => Ok(()),
        Err(e) => Err(io::Error::from(e)),
    }
}

/// Waits for an overlapped request; the bytes transferred (0 at EOF).
fn finish(file: &Handle, ov: &OVERLAPPED) -> io::Result<u32> {
    let mut n = 0u32;
    match unsafe { GetOverlappedResult(file.0, ov, &mut n, true) } {
        Ok(()) => Ok(n),
        Err(e) if e.code() == ERROR_HANDLE_EOF.to_hresult() => Ok(0),
        Err(e) => Err(io::Error::from(e)),
    }
}

struct Slot {
    buf: AlignedBuf,
    read_ev: Handle,
    write_ev: Handle,
    read_ov: OVERLAPPED,
    write_ov: OVERLAPPED,
    offset: u64,
    reading: bool,
    writing: bool,
    /// Bytes of file data in the buffer once read.
    len: usize,
}

/// Copies `job.from` to `job.to` with unbuffered, overlapped I/O.
/// Returns the bytes written. A stop requested by the sink returns
/// `ErrorKind::Interrupted`; the destination keeps what was written.
pub fn copy_direct(job: &DirectCopy, sink: &mut dyn CopySink) -> io::Result<u64> {
    let align = sector_size(job.from).max(sector_size(job.to)).max(4096) as u64;
    let chunk = (job.chunk as u64).max(align) / align * align;
    let depth = job.depth.clamp(2, 16);
    let start = job.resume_at / align * align;
    let aligned_total = job.size.div_ceil(align) * align;

    let src = open(job.from, false, false)?;
    let dst = open(job.to, true, start == 0)?;
    // Pre-allocate: the whole (sector-rounded) size up front.
    set_end_of_file(&dst, aligned_total.max(start))?;

    let mut slots = Vec::with_capacity(depth);
    for _ in 0..depth {
        let event = || unsafe { CreateEventW(None, true, false, PCWSTR::null()) }.map(Handle).map_err(io::Error::from);
        slots.push(Slot {
            buf: AlignedBuf::new(chunk as usize, align as usize)?,
            read_ev: event()?,
            write_ev: event()?,
            read_ov: OVERLAPPED::default(),
            write_ov: OVERLAPPED::default(),
            offset: 0,
            reading: false,
            writing: false,
            len: 0,
        });
    }

    let mut next_read = start;
    let mut written = start;
    let issue_read = |slot: &mut Slot, next_read: &mut u64| -> io::Result<()> {
        slot.offset = *next_read;
        slot.read_ov = overlapped_at(slot.offset, slot.read_ev.0);
        let len = chunk.min(aligned_total - slot.offset) as usize;
        started(unsafe { ReadFile(src.0, Some(&mut slot.buf.slice()[..len]), None, Some(&mut slot.read_ov)) })?;
        slot.reading = true;
        *next_read += len as u64;
        Ok(())
    };

    let result: io::Result<()> = (|| {
        for slot in slots.iter_mut() {
            if next_read >= job.size {
                break;
            }
            issue_read(slot, &mut next_read)?;
        }
        let mut index = 0usize;
        loop {
            let s = index % depth;
            if !slots[s].reading {
                break; // nothing more was read: done
            }
            let n = finish(&src, &slots[s].read_ov)? as usize;
            slots[s].reading = false;
            let remaining = job.size - slots[s].offset;
            let len = (n as u64).min(remaining) as usize;
            if len == 0 {
                break;
            }
            slots[s].len = len;
            if !sink.data(&slots[s].buf.slice()[..len]) {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
            }
            // Writes must be whole sectors; the padding past the end is
            // cut off by the final end-of-file.
            let write_len = (len as u64).div_ceil(align) * align;
            {
                let slot = &mut slots[s];
                slot.write_ov = overlapped_at(slot.offset, slot.write_ev.0);
                started(unsafe { WriteFile(dst.0, Some(&slot.buf.slice()[..write_len as usize]), None, Some(&mut slot.write_ov)) })?;
                slot.writing = true;
            }
            // The previous slot's write has had a whole read's time to
            // finish: reap it in order and refill that buffer.
            let p = (index + depth - 1) % depth;
            if index > 0 && slots[p].writing {
                finish(&dst, &slots[p].write_ov)?;
                slots[p].writing = false;
                written += slots[p].len as u64;
                sink.written(written);
                if next_read < job.size {
                    issue_read(&mut slots[p], &mut next_read)?;
                }
            }
            index += 1;
        }
        // The last outstanding writes, oldest first.
        for k in 0..depth {
            let s = (index + k) % depth;
            if slots[s].writing {
                finish(&dst, &slots[s].write_ov)?;
                slots[s].writing = false;
                written += slots[s].len as u64;
                sink.written(written);
            }
        }
        Ok(())
    })();

    if result.is_err() {
        // Nothing may still write into the buffers once they're freed.
        unsafe {
            let _ = CancelIoEx(src.0, None);
            let _ = CancelIoEx(dst.0, None);
        }
        for slot in &slots {
            if slot.reading {
                let _ = finish(&src, &slot.read_ov);
            }
            if slot.writing {
                let _ = finish(&dst, &slot.write_ov);
            }
        }
        // A cancelled copy keeps exactly what's complete on disk.
        let _ = set_end_of_file(&dst, written.min(job.size));
        return result.map(|_| written);
    }
    set_end_of_file(&dst, job.size)?;
    Ok(written.min(job.size))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Collect {
        data: Vec<u8>,
        written: Vec<u64>,
        stop_after: Option<usize>,
    }
    impl CopySink for Collect {
        fn data(&mut self, chunk: &[u8]) -> bool {
            self.data.extend_from_slice(chunk);
            self.stop_after.is_none_or(|limit| self.data.len() < limit)
        }
        fn written(&mut self, total: u64) {
            self.written.push(total);
        }
    }

    fn sample(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 7 % 251) as u8).collect()
    }

    #[test]
    fn copies_an_unaligned_file_exactly() {
        let dir = tempfile::tempdir().unwrap();
        let data = sample(3 * 1024 * 1024 + 12_345);
        let from = dir.path().join("src.bin");
        let to = dir.path().join("dst.bin.dmp-part");
        std::fs::write(&from, &data).unwrap();
        let mut sink = Collect { data: Vec::new(), written: Vec::new(), stop_after: None };
        let job = DirectCopy { from: &from, to: &to, size: data.len() as u64, resume_at: 0, chunk: 1024 * 1024, depth: 3 };
        let n = copy_direct(&job, &mut sink).unwrap();
        assert_eq!(n, data.len() as u64);
        assert_eq!(std::fs::read(&to).unwrap(), data);
        assert_eq!(sink.data, data, "chunks arrive in file order");
        assert!(sink.written.windows(2).all(|w| w[0] < w[1]));
        assert_eq!(*sink.written.last().unwrap(), data.len() as u64);
    }

    #[test]
    fn stops_and_resumes() {
        let dir = tempfile::tempdir().unwrap();
        let data = sample(5 * 1024 * 1024 + 777);
        let from = dir.path().join("src.bin");
        let to = dir.path().join("dst.bin.dmp-part");
        std::fs::write(&from, &data).unwrap();
        let mut first = Collect { data: Vec::new(), written: Vec::new(), stop_after: Some(2 * 1024 * 1024) };
        let job = DirectCopy { from: &from, to: &to, size: data.len() as u64, resume_at: 0, chunk: 1024 * 1024, depth: 2 };
        let err = copy_direct(&job, &mut first).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::Interrupted);
        let kept = std::fs::metadata(&to).unwrap().len();
        assert_eq!(std::fs::read(&to).unwrap(), data[..kept as usize]);

        let mut second = Collect { data: Vec::new(), written: Vec::new(), stop_after: None };
        let job = DirectCopy { resume_at: kept, ..job };
        copy_direct(&job, &mut second).unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), data);
    }

    #[test]
    fn empty_and_tiny_files() {
        let dir = tempfile::tempdir().unwrap();
        for len in [0usize, 1, 4095, 4096, 4097] {
            let data = sample(len);
            let from = dir.path().join(format!("s{len}"));
            let to = dir.path().join(format!("d{len}"));
            std::fs::write(&from, &data).unwrap();
            let mut sink = Collect { data: Vec::new(), written: Vec::new(), stop_after: None };
            let job = DirectCopy { from: &from, to: &to, size: len as u64, resume_at: 0, chunk: 64 * 1024, depth: 4 };
            copy_direct(&job, &mut sink).unwrap();
            assert_eq!(std::fs::read(&to).unwrap(), data, "len {len}");
        }
    }

    #[test]
    fn knows_the_system_drive() {
        let medium = medium_of(Path::new("C:\\Windows"));
        assert!(matches!(medium, Medium::Solid | Medium::Rotational | Medium::Unknown));
        assert_eq!(medium_of(Path::new("\\\\server\\share")), Medium::Network);
    }
}
