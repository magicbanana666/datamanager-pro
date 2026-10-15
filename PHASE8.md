# Phase 8 — Network Share Support

Network Analysis now works on real SMB shares, read-only. The IP / Port
Scanner tool is **not** part of this phase and stays the Phase 1 demo
(see [Not built](#not-built)).

## Implemented Features

- **Scanning a share** uses the regular scan engine (UNC paths always
  take the walk engine), through its own scan store
  (`useNetworkScanStore`), so a network scan doesn't replace the Disk/
  Folder Analysis scan. Treemap, chart, top folders/files, file types
  and the folder table all show the real result, with lazy drill-down
  like the analysis pages. Before a scan the page shows empty states
  instead of sample data.
- **Connection status** for a `\\server\share` path: reachability, TCP
  connect time to port 445, the SMB dialect (via `Get-SmbConnection`,
  when Windows reports one), and the account the app runs as.
- **Shares** of a server (`NetShareEnum`): name, type, admin/hidden
  flag, remark, total and free space and file system for disk shares
  (`GetDiskFreeSpaceExW`/`GetVolumeInformationW` on the share root),
  and whether it's readable. "Use" puts a share in the location field.
- **Access rights** of the scanned location or the selected folder:
  its DACL with account names resolved (`LookupAccountSidW`),
  allow/deny, inherited or explicit, and the mask named the way
  Explorer's Security tab does (Full Control, Modify, Read & Execute,
  Read, Write, or Special). Works for local paths too.
- **Sessions** on the server (`NetSessionEnum`): user, client, connected
  and idle time. Windows only allows this for administrators of that
  server; otherwise the page says so.
- **Read speed**: reads the scanned share's largest file (up to 512 MB
  or 8 s) unbuffered (`FILE_FLAG_NO_BUFFERING`, so the Windows cache
  doesn't inflate the number) and charts Mbit/s every 250 ms.

## Tauri Commands

| Command | Purpose |
|---|---|
| `get_share_connection(path)` | Server, share, user, reachability, latency, SMB dialect |
| `list_server_shares(server)` | A server's shares with space and file system |
| `list_server_sessions(server)` | Who is connected (needs admin on the server) |
| `get_access_rights(path)` | DACL entries with names |
| `measure_read_speed(path)` | Unbuffered read throughput |

## Tests

UNC/server-name parsing, access-mask naming, reading the DACL of a
temp folder, and the read-speed measurement on a local file.

## Not built

The roadmap's IP / port scanner was dropped from this phase: the IP /
Port Scanner page under Tools stays the Phase 1 simulation (no network
traffic). LAN host discovery is therefore not part of the app either.
