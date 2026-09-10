# Phase 2 — Read-Only Filesystem Foundation

Phase 2 replaces the Rust side's diagnostic-only backend with a real,
read-only filesystem and storage abstraction, and wires it into the
Phase 1 UI wherever the brief calls for real data. **Everything in this
phase is read-only** - see [Safety Guarantee](#safety-guarantee).

## Implemented Features

- **Storage volume enumeration** - real drive letters, capacity,
  free/available/used bytes, filesystem, volume label/serial, and a
  typed `VolumeType` (Fixed/Removable/Network/Optical/RamDisk/Unknown),
  read via native Win32 APIs (`GetLogicalDrives`, `GetDriveTypeW`,
  `GetVolumeInformationW`, `GetDiskFreeSpaceExW`).
- **Non-recursive directory browsing** - `list_directory` returns only
  a folder's *immediate* children, typed as file/directory/symlink/
  other, with size, allocated size, timestamps, and decoded Windows
  file attributes (ReadOnly/Hidden/System/Archive/Compressed/Encrypted/
  Offline/Temporary/Sparse/ReparsePoint).
- **Shallow directory summaries** (`get_directory_summary`) - direct
  file/folder counts and direct file bytes only; explicitly not a
  recursive disk-usage scan.
- **File and folder metadata** (`get_file_metadata`,
  `get_folder_metadata`) - full metadata for a single item, including a
  best-effort on-disk allocation size (true compressed/sparse size via
  `GetCompressedFileSizeW`, or the logical size rounded up to the
  volume's cluster size otherwise).
- **Path validation and normalization** (`validate_path`) - never
  panics or throws on a missing/inaccessible/malformed path; classifies
  UNC vs. drive-rooted paths, resolves `C:` to `C:\`, and reports
  existence/type/accessibility as structured data.
- **UNC / network path support** - the same commands above work
  unmodified against `\\server\share` paths; an unreachable share
  reports a structured `networkUnavailable` error rather than a raw
  I/O error or a hang. No SMB discovery or LAN enumeration is
  implemented (out of scope for Phase 2).
- **Real system info** (`get_system_info`) - OS, OS version, hostname,
  architecture, logical CPU count, total/available RAM via `sysinfo`,
  kept deliberately separate from the filesystem/storage commands.
- **Native folder/file picker** - every "Browse..." button
  (`LocationPicker`, used by Disk Analysis, Folder Analysis, File
  Search, Comparison A/B, Data Transfer source/destination, Sync
  source/destination) now opens a real OS picker via
  `@tauri-apps/plugin-dialog`. Selecting a folder only ever updates
  frontend state.
- **Live path validation indicator** - `LocationPicker` debounces a
  call to `validate_path` as the user types or after a pick, showing a
  checkmark/warning icon with the real error message on hover.
- **Reusable filesystem UI components**:
  - `PathBreadcrumb` - splits a real path (drive-rooted or UNC) into
    clickable segments, e.g. `D: > Data > Projects` or
    `NAS > CompanyData > Projects`.
  - `DirectoryTree` - a lazily-expanding folder tree; expanding a node
    fetches only *that* node's direct children, never the whole tree.
  - `VolumeSelector` - real volume chips with a capacity bar, used by
    Disk Analysis.
  - `DemoBadge` - a small "Demo Visualization" marker used on every
    analytical widget (treemaps, charts, the mock breakdown tables)
    that still runs on Phase 1 mock data, so real and mock numbers are
    never presented as if they were the same thing.
- **Structured logging** via `tracing`/`tracing-subscriber` - app
  startup and every command call are logged at `info`, with `warn` for
  recoverable per-entry read failures and `debug` for verbose detail
  (e.g. human-readable directory summary sizes). Controlled by the
  `RUST_LOG` env var (defaults to `info`).
- **A tiny read-through cache** for volume enumeration (10s TTL, one
  static slot) - `force_refresh` bypasses it. Directory browsing is
  never cached, since it's meant to reflect the live filesystem.

## Rust Modules Added

```
src-tauri/src/
  models/
    errors.rs        AppError / AppErrorCode - the one error shape every
                      command returns on failure
    storage.rs        StorageVolume, VolumeType
    filesystem.rs      FileSystemEntry, EntryType, FileAttribute,
                      ListDirectoryOptions, DirectoryListing,
                      DirectorySummary, FileMetadata, FolderMetadata,
                      PathValidation
  services/
    path_service.rs         normalize/validate a path - no filesystem
                            mutation, ever
    filesystem_service.rs    list_directory, get_directory_summary,
                            get_file_metadata, get_folder_metadata
    storage_service.rs      list_volumes + the small TTL cache
  platform/
    mod.rs           picks `windows` or `fallback` behind one identical
                     `current::*` surface
    windows.rs       every real Win32 call (volume enumeration, free
                     space, allocation size, attribute decoding) -
                     isolated here per the brief
    fallback.rs      honest `Unsupported`/`None` on non-Windows targets,
                     so the crate still builds elsewhere for dev/CI
  utils/
    path.rs          normalize_path, is_unc, is_absolute (pure,
                     unit-tested)
    size.rs          format_bytes, usage_percent (pure, unit-tested)
    time.rs          SystemTime -> UTC ISO 8601 (pure, unit-tested)
  commands/
    filesystem.rs    validate_path, list_directory,
                     get_directory_summary, get_file_metadata,
                     get_folder_metadata (all async, spawn_blocking)
    storage.rs       list_storage_volumes (async, spawn_blocking)
    system.rs        get_app_version, get_system_info (async), ping_backend
```

`commands::network`, `commands::scheduler`, `commands::transfer` and
their matching `models::` files remain the documented, empty
placeholders from Phase 1 - untouched, since network share scanning,
scheduler execution and the transfer engine are later phases.

## Tauri Commands

| Command | Async | Notes |
|---|---|---|
| `ping_backend` | no | Phase 1, unchanged |
| `get_app_version` | no | Phase 1, unchanged |
| `get_system_info` | yes | **new** - replaces the Phase 1 `get_system_info_mock` |
| `list_storage_volumes(forceRefresh?)` | yes | **new** |
| `validate_path(path)` | yes | **new** |
| `list_directory(path, options?)` | yes | **new** - `ListDirectoryOptions { showHidden, showSystem }`, both default `false` |
| `get_directory_summary(path)` | yes | **new** - shallow, non-recursive |
| `get_file_metadata(path)` | yes | **new** |
| `get_folder_metadata(path)` | yes | **new** |

Every fallible command returns `Result<T, AppError>`; Tauri serializes
that directly, so a JS `catch` receives the real `{ code, message,
path, details }` shape rather than a stringified Rust panic.

## Frontend Changes

- `src/models/backend.ts` - hand-kept TypeScript mirrors of every Rust
  model above (camelCase on both sides; see [Type Sharing](#type-sharing-decision)).
- `src/api/backend.ts` - typed `invoke()` wrappers plus `toAppError()`,
  which normalizes anything a command promise can reject with into the
  one `AppError` shape.
- `src/api/dialog.ts` - `pickFolder`/`pickFile` wrapping
  `@tauri-apps/plugin-dialog`.
- `src/state/filesystemStore.ts` - `useFilesystemStore`: the single
  active browse session (`volumes`, `currentPath`, `entries`,
  `directorySummary`, `selectedEntry`, `loading`, `error`,
  `showHidden`/`showSystem`) plus `loadVolumes`, `browse`,
  `selectEntry`, `refresh`, `validatePath`. Disk Analysis and Folder
  Analysis - the two "one location at a time" pages - use it directly.
  Pages needing *two* independent locations at once (Comparison,
  Data Transfer, Sync) call `api/backend.ts` directly with their own
  local path state instead; see the doc comment at the top of that
  file for why a single global `currentPath` can't represent two
  locations simultaneously.
- `src/components/filesystem/` - `PathBreadcrumb`, `DirectoryTree`,
  `VolumeSelector` (see above).
- `src/components/controls/DemoBadge.tsx` and the upgraded
  `LocationPicker.tsx` (real picker + live validation, described above).

## Which UI Pages Now Use Real Data

| Page | Real | Still mock |
|---|---|---|
| **Disk Analysis** | Volume selector, drive capacity/free/used/filesystem, Browse picker, path validation | Treemap, Drive Usage donut, Top File Types, Files & Folders table, Chart/Top Files/Top Folders/Timeline/Extensions/Users tabs (all badged "Demo Visualization") |
| **Folder Analysis** | "Folder Info (Real)" card (direct file/folder counts, direct size, last modified via `get_directory_summary`), real path breadcrumb, a lazy `DirectoryTree` browser, Browse picker, path validation | Treemap, Size Distribution, File Types, Top 10 Largest Files, Files & Folders table, Duplicates tab (all badged) |
| **File Search** | Location Browse picker + path validation | All search results (badged "Demo Results") - search itself is not implemented yet |
| **Comparison** | Location A/B Browse picker + path validation | All comparison results (badged "Demo Comparison") - content/hash comparison is not implemented yet |
| **Data Transfer** | Source/destination Browse picker + path validation | The transfer itself - clicking Start Transfer shows a "Phase 2 Read-Only Mode" toast and only ever runs the Phase 1 frontend-timer simulation |
| **Sync / Incremental** | Source/destination Browse picker + path validation | Same as Data Transfer - "Phase 2 Read-Only Mode" toast, simulated progress only |
| **Help dialog** | `get_system_info` now returns real OS/CPU/RAM instead of a mock payload | - |
| Network Analysis, Duplicate Finder, Scheduler, Reports, Tools, IP/Port Scanner | unchanged | fully mock (their real backends are Phase 8/6-7/9/9/-/8 respectively) |

## Type Sharing Decision

The brief allows either a codegen tool (e.g. `specta`) or centralized
hand-kept types. Phase 2's backend surface is 8 commands and ~10
small, stable model types - small enough that hand-kept types in one
file (`src/models/backend.ts`) are simpler than adding a build-time
codegen dependency and its own maintenance surface. All Rust models use
`#[serde(rename_all = "camelCase")]` specifically so the TypeScript
side needs no field-name mapping. Revisit this decision if the backend
surface grows substantially (Phase 3's scanner is a reasonable trigger
point).

## Display & Timestamp Conventions

- **Sizes**: computed in binary (1024-based) arithmetic, labeled with
  the common unit names (KB/MB/GB/TB/PB) rather than KiB/MiB - e.g.
  `1.24 TB`. Implemented once in `utils::size::format_bytes` (Rust,
  unit-tested) and mirrored by the pre-existing `src/utils/format.ts`
  (frontend) - the backend sends raw byte counts as numbers; formatting
  is a frontend concern.
- **Timestamps**: the backend always returns UTC ISO 8601
  (`2026-09-09T14:22:00Z`); the frontend's existing `formatDate`
  helpers convert to the user's local timezone for display, per the
  brief.

## Tests Added

**Rust** (`cargo test`, 40 tests, all passing):
- `utils::path` - forward/backslash normalization, UNC prefix
  preservation, bare-drive-to-root resolution, trailing-slash handling,
  duplicate-separator collapsing, `is_unc`/`is_absolute`, and a
  300+-character long-path case (no truncation).
- `utils::size` - byte formatting across all unit boundaries
  (0 B up to petabytes, including the exact `1.24 TB` example from the
  brief) and `usage_percent` (normal case, zero-total, over-100 clamp).
- `utils::time` - epoch and an arbitrary UTC instant round-trip to the
  expected ISO 8601 string.
- `services::path_service::validate` - missing path, empty input,
  a real tempdir (file and directory), UNC classification, and
  forward-slash normalization - all via `tempfile`, so nothing depends
  on a specific drive letter.
- `services::filesystem_service` - `list_directory` correctly types
  files vs. folders and never reports a folder's size; missing paths
  return a structured error instead of panicking;
  `get_directory_summary` counts only *direct* children (a file nested
  inside a subfolder is confirmed *not* counted); `get_file_metadata`/
  `get_folder_metadata` reject the wrong entry type and read real
  tempfile-backed data correctly.

**Frontend**: no automated test runner exists in this project (Phase 1
didn't add one either); verified manually per [UI States](#ui-states-verified-manually)
below, plus the full `tsc`/`eslint`/`vite build` gate.

## UI States Verified Manually

Loading (volume enumeration / folder browse spinners), success (real
volumes and folder listings rendering), empty directory, access denied,
path not found, and unexpected-backend-error all render through the
same `AppError`-driven paths in `VolumeSelector`, the real-data section
of Folder Analysis's "Select Folder" card, `LocationPicker`'s
validation icon, and `DirectoryTree`'s per-node error line - there's no
separate "happy path only" code path anywhere in this phase.

**Layout fix found during manual verification:** the real folder
info (breadcrumb + direct file/folder counts) was originally its own
standalone Card between "Select Folder"/"Scan Options" and the tabs.
On the app's fixed, no-page-scroll 1536×1024 layout, that extra ~100px
of fixed-height content squeezed the flexible Treemap/`DirectoryTree`
row down to only a few pixels tall - visible live as the "Browse
(Real)" tree's root row rendering as a bare highlighted sliver with no
readable label. Fixed by folding the breadcrumb/summary into the
existing "Select Folder" card, which already had unused vertical space
(it's height-stretched to match the taller "Scan Options" card), so no
new fixed height was added to the page at all. Verified live: the
`DirectoryTree` now renders and expands normally (confirmed against
`C:\Windows`'s real subfolders).

## Build Verification

Run from `src-tauri/`:

```
cargo fmt --check    ✅ no diff
cargo clippy --all-targets   ✅ zero warnings
cargo test            ✅ 40 passed, 0 failed
cargo check           ✅ zero warnings
```

Run from the repo root:

```
npm run typecheck     ✅ zero errors
npm run lint           ✅ zero errors
npm run build          ✅ production build succeeds
```

`npm run tauri dev` was launched and the real volume list, folder
browsing, native folder picker, and path validation indicator were all
verified against the actual local filesystem (not just compiled) - see
the session's screenshots.

## Known Limitations

- **Owner lookup** is not implemented (`FileMetadata.owner` is always
  `null`) - the brief explicitly allows deferring this.
- **Allocated size** is best-effort: exact for compressed/sparse files
  (via `GetCompressedFileSizeW`), cluster-rounded for everything else.
  It is `None` if both underlying Win32 calls fail.
- **UNC/network browsing** works through the same generic path APIs
  but Phase 2 does no SMB-specific handling (share enumeration, credential
  prompts, retry/backoff) - an unreachable share simply reports
  `networkUnavailable`.
- **No automated frontend test runner** exists yet in this project; all
  UI-state coverage for this phase was manual (see above).
- **The volume cache** is a single 10-second-TTL slot, not
  invalidated on external volume changes (e.g. plugging in a USB drive
  won't appear until the cache expires or Refresh is clicked).
- Directory listings are not paginated - a very large directory (tens
  of thousands of entries) is still read in one call. Acceptable for
  Phase 2's "browse, don't scan" scope; revisit if it proves slow in
  practice.

## Safety Guarantee

Every function added in this phase is read-only. Verified by grepping
the entire crate for the destructive standard-library APIs a
filesystem feature could plausibly use:

```
grep -rn "remove_file\|remove_dir\|rename\|::copy\|OpenOptions.*write\|set_permissions\|fs::write\|create_dir" src-tauri/src
```

The only matches are `std::fs::write` calls inside `#[cfg(test)]` test
modules, which write to a `tempfile` temp directory purely to set up
test fixtures (and are cleaned up automatically when the tempdir
drops) - never in `commands/`, `services/`, or `platform/`. No
`remove_*`, `rename`, `copy`, `set_permissions`, or non-test `create_dir`
call exists anywhere in this crate.
