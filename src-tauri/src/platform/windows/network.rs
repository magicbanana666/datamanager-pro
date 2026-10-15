//! Win32 networking queries for Phase 8: SMB shares and sessions of a
//! server (`NetShareEnum`/`NetSessionEnum`), a path's NTFS access rights
//! (its DACL, with account names resolved). All read-only.

use super::{to_wide, wide_to_string};
use std::path::Path;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{LocalFree, ERROR_SUCCESS, HLOCAL};
use windows::Win32::NetworkManagement::NetManagement::NetApiBufferFree;
use windows::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
use windows::Win32::Security::{
    GetAce, LookupAccountSidW, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, DACL_SECURITY_INFORMATION,
    PSECURITY_DESCRIPTOR, PSID, SID_NAME_USE,
};
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetVolumeInformationW, NetSessionEnum, NetShareEnum, SESSION_INFO_10,
    SHARE_INFO_1,
};

const MAX_PREFERRED_LENGTH: u32 = u32::MAX;
const ERROR_MORE_DATA: u32 = 234;
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
const INHERITED_ACE: u8 = 0x10;

fn pwstr_to_string(p: PWSTR) -> String {
    if p.is_null() {
        String::new()
    } else {
        unsafe { p.to_string() }.unwrap_or_default()
    }
}

pub struct RawShare {
    pub name: String,
    /// `STYPE_*`: 0 disk, 1 printer, 2 device, 3 IPC; bit 31 = special/admin.
    pub kind: u32,
    pub remark: String,
}

/// The shares `server` (a name or IP, no backslashes) offers. `Err` is
/// the Win32/NET API error code.
pub fn list_shares(server: &str) -> Result<Vec<RawShare>, u32> {
    let wide = to_wide(&format!("\\\\{server}"));
    let mut shares = Vec::new();
    let mut resume = 0u32;
    loop {
        let mut buf: *mut u8 = std::ptr::null_mut();
        let (mut read, mut total) = (0u32, 0u32);
        let status = unsafe {
            NetShareEnum(
                PCWSTR(wide.as_ptr()),
                1,
                &mut buf,
                MAX_PREFERRED_LENGTH,
                &mut read,
                &mut total,
                Some(&mut resume),
            )
        };
        if status != 0 && status != ERROR_MORE_DATA {
            return Err(status);
        }
        if !buf.is_null() {
            let items = unsafe { std::slice::from_raw_parts(buf as *const SHARE_INFO_1, read as usize) };
            shares.extend(items.iter().map(|s| RawShare {
                name: pwstr_to_string(s.shi1_netname),
                kind: s.shi1_type.0,
                remark: pwstr_to_string(s.shi1_remark),
            }));
            unsafe { NetApiBufferFree(Some(buf as *const _)) };
        }
        if status != ERROR_MORE_DATA {
            return Ok(shares);
        }
    }
}

pub struct RawSession {
    pub client: String,
    pub user: String,
    pub connected_secs: u32,
    pub idle_secs: u32,
}

/// Who is connected to `server` - needs administrator rights there.
pub fn list_sessions(server: &str) -> Result<Vec<RawSession>, u32> {
    let wide = to_wide(&format!("\\\\{server}"));
    let mut buf: *mut u8 = std::ptr::null_mut();
    let (mut read, mut total) = (0u32, 0u32);
    let status = unsafe {
        NetSessionEnum(
            PCWSTR(wide.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            10,
            &mut buf,
            MAX_PREFERRED_LENGTH,
            &mut read,
            &mut total,
            None,
        )
    };
    if status != 0 && status != ERROR_MORE_DATA {
        return Err(status);
    }
    let mut sessions = Vec::new();
    if !buf.is_null() {
        let items = unsafe { std::slice::from_raw_parts(buf as *const SESSION_INFO_10, read as usize) };
        sessions.extend(items.iter().map(|s| RawSession {
            client: pwstr_to_string(s.sesi10_cname).trim_start_matches('\\').to_string(),
            user: pwstr_to_string(s.sesi10_username),
            connected_secs: s.sesi10_time,
            idle_secs: s.sesi10_idle_time,
        }));
        unsafe { NetApiBufferFree(Some(buf as *const _)) };
    }
    Ok(sessions)
}

/// File system, total and free bytes of the volume behind `root` (a
/// drive root or `\\server\share\`).
pub fn volume_info(root: &str) -> Option<(Option<String>, u64, u64)> {
    let wide = to_wide(root);
    let (mut available, mut total, mut free) = (0u64, 0u64, 0u64);
    unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR(wide.as_ptr()),
            Some(&mut available),
            Some(&mut total),
            Some(&mut free),
        )
    }
    .ok()?;
    let mut fs_name = [0u16; 64];
    let fs = unsafe {
        GetVolumeInformationW(PCWSTR(wide.as_ptr()), None, None, None, None, Some(&mut fs_name))
    }
    .ok()
    .and_then(|_| wide_to_string(&fs_name));
    Some((fs, total, available))
}

pub struct RawAce {
    pub account: String,
    /// `SID_NAME_USE`: 1 user, 2 group, 5 well-known group, 4 alias...
    pub account_kind: i32,
    pub allow: bool,
    pub mask: u32,
    pub inherited: bool,
}

fn account_name(sid: PSID) -> (String, i32) {
    let mut name = [0u16; 256];
    let mut domain = [0u16; 256];
    let (mut name_len, mut domain_len) = (name.len() as u32, domain.len() as u32);
    let mut kind = SID_NAME_USE(0);
    let ok = unsafe {
        LookupAccountSidW(
            PCWSTR::null(),
            sid,
            Some(PWSTR(name.as_mut_ptr())),
            &mut name_len,
            Some(PWSTR(domain.as_mut_ptr())),
            &mut domain_len,
            &mut kind,
        )
    }
    .is_ok();
    if !ok {
        return (sid_string(sid), 0);
    }
    let name = String::from_utf16_lossy(&name[..name_len as usize]);
    let domain = String::from_utf16_lossy(&domain[..domain_len as usize]);
    (if domain.is_empty() { name } else { format!("{domain}\\{name}") }, kind.0)
}

fn sid_string(sid: PSID) -> String {
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    let mut out = PWSTR::null();
    if unsafe { ConvertSidToStringSidW(sid, &mut out) }.is_err() {
        return "(unknown account)".into();
    }
    let s = pwstr_to_string(out);
    unsafe { LocalFree(Some(HLOCAL(out.0 as *mut _))) };
    s
}

/// The DACL of `path`, one entry per allow/deny ACE.
pub fn read_dacl(path: &Path) -> Result<Vec<RawAce>, String> {
    let wide = to_wide(&path.to_string_lossy());
    let mut dacl: *mut ACL = std::ptr::null_mut();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    let status = unsafe {
        GetNamedSecurityInfoW(
            PCWSTR(wide.as_ptr()),
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
    let mut entries = Vec::new();
    if !dacl.is_null() {
        let count = unsafe { (*dacl).AceCount };
        for i in 0..count as u32 {
            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
            if unsafe { GetAce(dacl, i, &mut ace) }.is_err() {
                continue;
            }
            let header = unsafe { &*(ace as *const ACE_HEADER) };
            if header.AceType != ACCESS_ALLOWED_ACE_TYPE && header.AceType != ACCESS_DENIED_ACE_TYPE {
                continue; // object/callback ACEs - not used on files
            }
            // Allowed and denied ACEs share this layout.
            let allowed = unsafe { &*(ace as *const ACCESS_ALLOWED_ACE) };
            let sid = PSID(&allowed.SidStart as *const u32 as *mut _);
            let (account, account_kind) = account_name(sid);
            entries.push(RawAce {
                account,
                account_kind,
                allow: header.AceType == ACCESS_ALLOWED_ACE_TYPE,
                mask: allowed.Mask,
                inherited: header.AceFlags & INHERITED_ACE != 0,
            });
        }
    }
    unsafe { LocalFree(Some(HLOCAL(descriptor.0))) };
    Ok(entries)
}


/// The owner SID of `path`, as raw bytes (comparable, hashable).
pub fn owner_sid(path: &Path) -> Option<Vec<u8>> {
    use windows::Win32::Security::{GetLengthSid, OWNER_SECURITY_INFORMATION};
    let wide = to_wide(&path.to_string_lossy());
    let mut owner = PSID::default();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    let status = unsafe {
        GetNamedSecurityInfoW(
            PCWSTR(wide.as_ptr()),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            Some(&mut owner),
            None,
            None,
            None,
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let sid = (!owner.is_invalid()).then(|| {
        let len = unsafe { GetLengthSid(owner) } as usize;
        unsafe { std::slice::from_raw_parts(owner.0 as *const u8, len) }.to_vec()
    });
    unsafe { LocalFree(Some(HLOCAL(descriptor.0))) };
    sid
}

/// `DOMAIN\name` for a SID from [`owner_sid`].
pub fn sid_account_name(sid: &[u8]) -> String {
    account_name(PSID(sid.as_ptr() as *mut _)).0
}
