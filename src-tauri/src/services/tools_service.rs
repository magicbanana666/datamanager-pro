//! The small utilities behind the Tools page: file digests, splitting
//! and joining files, zip/unzip, shredding, and a Wake-on-LAN packet.
//! Each one only touches the paths the user picked.

use md5::Md5;
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const BUFFER: usize = 1024 * 1024;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Digests {
    pub size: u64,
    pub md5: String,
    pub sha1: String,
    pub sha256: String,
}

/// MD5, SHA-1 and SHA-256 of a file, in one read.
pub fn digests(path: &Path) -> std::io::Result<Digests> {
    let mut file = File::open(path)?;
    let (mut md5, mut sha1, mut sha256) = (Md5::new(), Sha1::new(), Sha256::new());
    let mut buf = vec![0u8; BUFFER];
    let mut size = 0u64;
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        size += n as u64;
        md5.update(&buf[..n]);
        sha1.update(&buf[..n]);
        sha256.update(&buf[..n]);
    }
    Ok(Digests {
        size,
        md5: hex(&md5.finalize()),
        sha1: hex(&sha1.finalize()),
        sha256: hex(&sha256.finalize()),
    })
}

/// Splits `path` into `<name>.001`, `.002`, ... of `part_size` bytes in
/// `dest_dir`. Returns the parts.
pub fn split(path: &Path, part_size: u64, dest_dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    if part_size == 0 {
        return Err(std::io::Error::other("the part size must be more than 0"));
    }
    let name = path.file_name().ok_or_else(|| std::io::Error::other("not a file"))?.to_string_lossy().into_owned();
    let total = fs::metadata(path)?.len();
    let count = total.div_ceil(part_size).max(1);
    if count > 999 {
        return Err(std::io::Error::other("that would make more than 999 parts - choose a larger part size"));
    }
    let mut input = BufReader::with_capacity(BUFFER, File::open(path)?);
    let mut parts = Vec::new();
    for i in 1..=count {
        let part = dest_dir.join(format!("{name}.{i:03}"));
        let mut out = BufWriter::with_capacity(BUFFER, File::create(&part)?);
        std::io::copy(&mut (&mut input).take(part_size), &mut out)?;
        out.flush()?;
        parts.push(part);
    }
    Ok(parts)
}

/// Joins `<name>.001`, `.002`, ... (pass the first) into `<name>` in
/// `dest_dir`. Returns the joined file.
pub fn merge(first_part: &Path, dest_dir: &Path) -> std::io::Result<PathBuf> {
    let file_name = first_part.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let base = file_name
        .strip_suffix(".001")
        .ok_or_else(|| std::io::Error::other("choose the first part (a file ending in .001)"))?;
    let dir = first_part.parent().unwrap_or(Path::new("."));
    let target = dest_dir.join(base);
    if target.exists() {
        return Err(std::io::Error::other(format!("{} already exists", target.display())));
    }
    let mut out = BufWriter::with_capacity(BUFFER, File::create(&target)?);
    let mut i = 1;
    loop {
        let part = dir.join(format!("{base}.{i:03}"));
        if !part.is_file() {
            break;
        }
        std::io::copy(&mut BufReader::with_capacity(BUFFER, File::open(&part)?), &mut out)?;
        i += 1;
    }
    out.flush()?;
    Ok(target)
}

/// Zips a file or a folder (recursively, deflate) into `dest`.
/// Returns the number of files added.
pub fn zip_path(source: &Path, dest: &Path) -> Result<u64, String> {
    use zip::write::SimpleFileOptions;
    let file = File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(BufWriter::new(file));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut added = 0u64;
    // Entries keep the picked item's own name (`docs/a.txt`), as Windows'
    // "Send to > Compressed folder" does.
    let base = source.parent().unwrap_or(Path::new("")).to_path_buf();
    let mut stack = vec![source.to_path_buf()];
    while let Some(path) = stack.pop() {
        if path == dest {
            continue;
        }
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            continue;
        }
        let name = path.strip_prefix(&base).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        if meta.is_dir() {
            if !name.is_empty() {
                zip.add_directory(format!("{name}/"), options).map_err(|e| e.to_string())?;
            }
            for entry in fs::read_dir(&path).map_err(|e| e.to_string())?.filter_map(Result::ok) {
                stack.push(entry.path());
            }
        } else {
            zip.start_file(name, options).map_err(|e| e.to_string())?;
            std::io::copy(&mut File::open(&path).map_err(|e| e.to_string())?, &mut zip).map_err(|e| e.to_string())?;
            added += 1;
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(added)
}

/// Extracts `archive` into `dest_dir`. Entries that would land outside
/// it (`..\` tricks) are skipped. Returns the number of files written.
pub fn unzip(archive: &Path, dest_dir: &Path) -> Result<u64, String> {
    let file = File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| e.to_string())?;
    let mut written = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(relative) = entry.enclosed_name() else { continue };
        let target = dest_dir.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        written += 1;
    }
    Ok(written)
}

/// Overwrites a file with pseudo-random bytes, renames it to a
/// meaningless name and deletes it. On SSDs and copy-on-write storage the
/// old blocks can survive (wear levelling) - the UI says so.
pub fn shred(path: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.is_file() {
        return Err(std::io::Error::other("not a file"));
    }
    crate::platform::current::clear_readonly(path);
    let len = meta.len();
    let mut file = fs::OpenOptions::new().write(true).open(path)?;
    file.seek(SeekFrom::Start(0))?;
    let mut state = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0x9E37_79B9_7F4A_7C15, |d| d.as_nanos() as u64)
        | 1;
    let mut buf = vec![0u8; BUFFER];
    let mut left = len;
    while left > 0 {
        for chunk in buf.chunks_mut(8) {
            // xorshift64
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            chunk.copy_from_slice(&state.to_le_bytes()[..chunk.len()]);
        }
        let n = left.min(BUFFER as u64) as usize;
        file.write_all(&buf[..n])?;
        left -= n as u64;
    }
    file.sync_all()?;
    drop(file);
    let renamed = path.with_file_name(format!("{:016x}.tmp", state));
    fs::rename(path, &renamed)?;
    fs::remove_file(renamed)
}

/// `aa:bb:cc:dd:ee:ff` / `aa-bb-...` / `aabbccddeeff` → bytes.
pub fn parse_mac(mac: &str) -> Option<[u8; 6]> {
    let hex: String = mac.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 12 || mac.chars().any(|c| !(c.is_ascii_hexdigit() || ":-. ".contains(c))) {
        return None;
    }
    let mut out = [0u8; 6];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

/// The Wake-on-LAN magic packet: 6 x 0xFF, then the MAC 16 times.
pub fn magic_packet(mac: [u8; 6]) -> Vec<u8> {
    let mut packet = vec![0xFF; 6];
    for _ in 0..16 {
        packet.extend_from_slice(&mac);
    }
    packet
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digests_match_known_values() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("abc.txt");
        fs::write(&path, "abc").unwrap();
        let d = digests(&path).unwrap();
        assert_eq!(d.md5, "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(d.sha1, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(d.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn split_then_merge_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let data: Vec<u8> = (0..2_500_000u32).map(|i| (i % 253) as u8).collect();
        let path = dir.path().join("big.bin");
        fs::write(&path, &data).unwrap();
        let parts = split(&path, 1_000_000, dir.path()).unwrap();
        assert_eq!(parts.len(), 3);
        let out = tempfile::tempdir().unwrap();
        let merged = merge(&parts[0], out.path()).unwrap();
        assert_eq!(fs::read(merged).unwrap(), data);
    }

    #[test]
    fn zip_and_unzip_a_folder() {
        let src = tempfile::tempdir().unwrap();
        fs::create_dir_all(src.path().join("docs/sub")).unwrap();
        fs::write(src.path().join("docs/a.txt"), "aaaa").unwrap();
        fs::write(src.path().join("docs/sub/b.txt"), "bb").unwrap();
        let work = tempfile::tempdir().unwrap();
        let archive = work.path().join("docs.zip");
        assert_eq!(zip_path(&src.path().join("docs"), &archive).unwrap(), 2);
        let out = work.path().join("out");
        assert_eq!(unzip(&archive, &out).unwrap(), 2);
        assert_eq!(fs::read_to_string(out.join("docs/sub/b.txt")).unwrap(), "bb");
    }

    #[test]
    fn shred_removes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret.txt");
        fs::write(&path, "top secret").unwrap();
        shred(&path).unwrap();
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn wake_on_lan_packet() {
        let mac = parse_mac("AA:bb-CC:dd:EE:ff").unwrap();
        assert_eq!(mac, [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
        let p = magic_packet(mac);
        assert_eq!(p.len(), 102);
        assert_eq!(&p[6..12], &mac);
        assert!(parse_mac("zz:11:22:33:44:55").is_none());
    }
}
