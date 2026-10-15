//! Win32 calls the Phase 6/7 transfer engine needs beyond `std::fs`:
//! copying a file's DACL (NTFS permissions) and attributes, deleting to
//! the Recycle Bin, and free space for the pre-flight check.
//!
//! Unlike the rest of `platform::windows`, these *do* modify the
//! filesystem - they're only ever called by `services::transfer_service`
//! on paths the user explicitly chose as a transfer's source/destination.

use super::to_wide;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{LocalFree, ERROR_SUCCESS, HLOCAL};
use windows::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SetNamedSecurityInfoW, SE_FILE_OBJECT,
};
use windows::Win32::Security::{
    GetSecurityDescriptorControl, ACL, DACL_SECURITY_INFORMATION,
    PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED,
    UNPROTECTED_DACL_SECURITY_INFORMATION,
};
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetFileAttributesW, SetFileAttributesW, FILE_FLAGS_AND_ATTRIBUTES,
    INVALID_FILE_ATTRIBUTES,
};
use windows::Win32::UI::Shell::{
    SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE,
    SHFILEOPSTRUCTW,
};

/// Attributes worth carrying over to a copy. Compressed/encrypted/
/// sparse are properties of how the destination stores the data, not
/// something `SetFileAttributesW` can set.
const COPYABLE_ATTRIBUTES: u32 = 0x0001 // READONLY
    | 0x0002 // HIDDEN
    | 0x0004 // SYSTEM
    | 0x0020 // ARCHIVE
    | 0x2000; // NOT_CONTENT_INDEXED

const FILE_ATTRIBUTE_READONLY: u32 = 0x0001;
const FILE_ATTRIBUTE_NORMAL: u32 = 0x0080;

fn path_wide(path: &Path) -> Vec<u16> {
    to_wide(&path.to_string_lossy())
}

/// Copies `source`'s DACL onto `dest`. A protected DACL (inheritance
/// disabled) stays protected; otherwise only the explicit entries are
/// copied and `dest` inherits from its new parent, as Explorer and
/// robocopy `/SEC` do. Owner/SACL are left alone - setting those needs
/// SeRestorePrivilege / SeSecurityPrivilege.
pub fn copy_dacl(source: &Path, dest: &Path) -> Result<(), String> {
    let src = path_wide(source);
    let dst = path_wide(dest);
    let mut dacl: *mut ACL = std::ptr::null_mut();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    let status = unsafe {
        GetNamedSecurityInfoW(
            PCWSTR(src.as_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(&mut dacl),
            None,
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(format!("reading permissions failed (Win32 error {})", status.0));
    }

    let mut control = 0u16;
    let mut revision = 0u32;
    let protected = unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) }
        .is_ok()
        && control & SE_DACL_PROTECTED.0 != 0;
    let info = DACL_SECURITY_INFORMATION
        | if protected {
            PROTECTED_DACL_SECURITY_INFORMATION
        } else {
            UNPROTECTED_DACL_SECURITY_INFORMATION
        };
    let status = unsafe {
        SetNamedSecurityInfoW(
            PCWSTR(dst.as_ptr()),
            SE_FILE_OBJECT,
            info,
            None,
            None,
            Some(dacl as *const ACL),
            None,
        )
    };
    unsafe { LocalFree(Some(HLOCAL(descriptor.0))) };
    if status != ERROR_SUCCESS {
        return Err(format!("writing permissions failed (Win32 error {})", status.0));
    }
    Ok(())
}

fn file_attributes(path: &Path) -> Option<u32> {
    let wide = path_wide(path);
    let attrs = unsafe { GetFileAttributesW(PCWSTR(wide.as_ptr())) };
    (attrs != INVALID_FILE_ATTRIBUTES).then_some(attrs)
}

fn set_attributes(path: &Path, attrs: u32) -> Result<(), String> {
    let wide = path_wide(path);
    let attrs = if attrs == 0 { FILE_ATTRIBUTE_NORMAL } else { attrs };
    unsafe { SetFileAttributesW(PCWSTR(wide.as_ptr()), FILE_FLAGS_AND_ATTRIBUTES(attrs)) }
        .map_err(|e| format!("setting attributes failed: {e}"))
}

/// Copies read-only/hidden/system/archive/not-indexed from `source`.
pub fn copy_attributes(source: &Path, dest: &Path) -> Result<(), String> {
    let attrs = file_attributes(source).ok_or("reading attributes failed")?;
    set_attributes(dest, attrs & COPYABLE_ATTRIBUTES)
}

/// Clears read-only so the file can be replaced or deleted - Windows
/// refuses both on a read-only file.
pub fn clear_readonly(path: &Path) {
    if let Some(attrs) = file_attributes(path) {
        if attrs & FILE_ATTRIBUTE_READONLY != 0 {
            let _ = set_attributes(path, attrs & !FILE_ATTRIBUTE_READONLY);
        }
    }
}

/// Moves a file or folder (with its contents) to the Recycle Bin.
/// Paths without a Recycle Bin (network shares, some removable drives)
/// are refused rather than silently deleted for good - the caller
/// decides whether to delete permanently instead.
pub fn recycle(path: &Path) -> Result<(), String> {
    if crate::utils::path::is_unc(&path.to_string_lossy()) {
        return Err("network locations have no Recycle Bin".into());
    }
    // pFrom is a list of paths, each null-terminated, ending with an
    // extra null.
    let mut from = path_wide(path);
    from.push(0);
    let mut op = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT).0 as u16,
        ..Default::default()
    };
    let code = unsafe { SHFileOperationW(&mut op) };
    if code != 0 {
        return Err(format!("moving to the Recycle Bin failed (code {code:#x})"));
    }
    if op.fAnyOperationsAborted.as_bool() {
        return Err("moving to the Recycle Bin was aborted".into());
    }
    Ok(())
}

/// Bytes available to the current user on the volume holding `path`
/// (which must exist - pass the nearest existing ancestor).
pub fn free_space_bytes(path: &Path) -> Option<u64> {
    let wide = path_wide(path);
    let mut available = 0u64;
    unsafe { GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut available), None, None) }
        .ok()?;
    Some(available)
}
