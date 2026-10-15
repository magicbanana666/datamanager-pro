# DataManager Pro

**Analyze. Migrate. Manage. Your Data.**

DataManager Pro is a Windows desktop tool for system administrators. It
combines disk usage analysis, file search, folder comparison, duplicate
detection, copy/move/sync, network share analysis, scheduling and
reporting in one app.

Built with Tauri 2 (Rust) and React + TypeScript.

## Features

| Area | What it does |
|---|---|
| **Disk / Folder Analysis** | Scans a drive or folder and shows a treemap, file types, top files and folders, extensions, a modified-date timeline and owners. Whole drives are read straight from the NTFS MFT when running as administrator (a full C:\ with ~1M files takes a few seconds). |
| **File Search** | Name (text, wildcard or regex), content and `.zip` entry search with type, size and date filters. |
| **Compare Locations** | Compares two folders by size and date, or by content hash, and acts on the differences. |
| **Duplicate Finder** | Exact content, same name or same size. Hard links are recognized and not reported as duplicates. |
| **Data Transfer** | Copy and move with collision policies, verification (xxh3), timestamps, attributes and NTFS permissions. Large files use unbuffered, asynchronous direct I/O. |
| **Sync / Incremental** | Mirror, incremental, update-newer and two-way sync, with a preview of the plan and conflict resolution. |
| **Resume** | Every transfer is journaled. A stopped or crashed job resumes where it left off, including halfway through a large file. |
| **Network Analysis** | SMB connection details, shares, sessions, permissions and read speed of UNC paths. |
| **Scheduler** | Runs sync, copy, move and analysis tasks on a schedule while the app is open. |
| **Reports** | HTML, PDF, XLSX and CSV reports from any result. |
| **Tools** | Hashes, file split/merge, zip/unzip, secure delete, ping, DNS lookup, Wake-on-LAN, disk health, log viewer and shortcuts to Windows tools. |

The IP / Port Scanner page is a non-functional demo and is labelled as such.

## Copy performance

Measured with `npm run bench:copy`: 4 × 1 GB plus 2,000 files of
16–512 KB, NVMe SSD, C: to C:. The source is uncached and the time is
measured until the data is on disk.

| Tool | Time |
|---|---|
| DataManager Pro | **7.0 s** |
| robocopy /MT:8 | 7.3 – 14.0 s |
| robocopy /J /MT:8 | 12.1 s |
| Windows Explorer | 28.5 – 29.2 s |

Large files alone copy at about 2 GB/s.

## Requirements

- Windows 10 or 11
- Node.js 20+
- Rust (stable, via [rustup](https://rustup.rs))
- Microsoft C++ Build Tools ("Desktop development with C++")
- WebView2 runtime (included with Windows 11)

## Getting started

```bash
npm install
npm run tauri dev
```

The MFT scanner needs administrator rights. From an elevated terminal:

```bash
npm run dev:admin
```

`npm run dev:noadmin` runs without elevation; scans then use the
directory walk.

## Scripts

| Command | |
|---|---|
| `npm run tauri dev` | Run the app in development mode |
| `npm run typecheck` / `npm run lint` | Frontend checks |
| `cargo test` (in `src-tauri`) | Backend tests |
| `npm run build:installer` | NSIS and MSI installers in `src-tauri/target/release/bundle/` |
| `npm run build:portable` | Portable build (zip) |
| `npm run bench:copy` | Copy benchmark against Explorer and robocopy (writes ~45 GB) |

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds
the installers and the portable zip and publishes a GitHub release
with the signed update manifest used by the in-app updater. The
updater signing key is stored in the `TAURI_SIGNING_PRIVATE_KEY`
repository secret.

## Project layout

```
src/                    React frontend
  pages/                One folder per page
  components/           Shared UI (tables, treemap, charts, dialogs, ...)
  state/                Zustand stores
  api/                  Typed wrappers around the Tauri commands
  models/               TypeScript types, mirroring the Rust models
src-tauri/src/          Rust backend
  commands/             Tauri commands per feature
  services/             Scan, search, comparison, duplicates, transfer,
                        journal, sync state, reports, scheduler
  platform/windows/     Win32: MFT reader, direct I/O, file ops, network
  models/               Types shared with the frontend
```

## Data and safety

- Analysis is read-only. Files are only changed by an explicit action:
  a transfer, sync, delete or tool.
- Deletes go to the Recycle Bin by default. Sync deletions run after
  all copies have succeeded.
- Large files and replacements are written to `<name>.dmp-part` and
  renamed when complete, so an existing file is never left
  half-overwritten.
- App data (journals, scheduler, logs, crash reports) is stored in
  `%APPDATA%\xyz.vanhulle.datamanagerpro`. In portable mode it is
  stored next to the executable.
