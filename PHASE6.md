# Phase 6 & 7 — Copy/Move Engine, Journaling & Resume, Sync

Phases 6 and 7 add the app's first engine that **writes**: one Rust
transfer engine behind Data Transfer (copy, move, sync, mirror), Sync /
Incremental (mirror, incremental, update-newer, two-way) and the file
actions on Duplicate Finder and Compare Locations. They're one engine
because every sync mode is "plan which files need what, then copy and
delete", the same machinery copy/move need.

## How a transfer runs

1. **Analyze** (read-only) - both sides are listed (junctions and
   symbolic links are never followed) and every file gets a
   `PlanAction`: copy-new, update, rename-copy, copy-back, update-back,
   delete-dest, delete-source, create-folder, skip-same, skip-older,
   excluded or conflict. The plan's summary carries the totals and the
   destination's free space.
2. **Execute** - Data Transfer does this straight away; Sync shows the
   plan first, so rows can be unticked and conflicts resolved.
   - A pre-flight check refuses to start when the destination lacks
     the space the plan needs (copies minus the files they replace).
   - Missing empty folders are created first.
   - Files are copied in parallel (small files 8 at a time, large
     ones depending on the storage - see *Copy engine performance*);
     large files and replacements go through `<name>.dmp-part`,
     renamed into place only once complete (and verified, if asked) -
     an existing destination file is never left half-written.
   - Deletions run **last** (Recycle Bin by default), so a failed copy
     never costs the only other copy of a file.
   - A move within one volume is a rename; otherwise copy, verify,
     then delete the source. Emptied source folders are removed.

### Options, all real
- **Collision policies** (Copy/Move): skip if same size/date (2 s
  tolerance for FAT/exFAT), compare hash, rename new file (`name (1).ext`),
  overwrite older.
- **Verify after transfer**: the source is hashed (xxh3-128) while
  copying, the copy re-read before it's renamed into place.
- **Preserve NTFS permissions**: the DACL is copied
  (`GetNamedSecurityInfoW`/`SetNamedSecurityInfoW`); a protected DACL
  stays protected, otherwise the copy inherits from its new parent like
  robocopy `/SEC`. Owner/SACL are left alone (they need
  SeRestore/SeSecurity privilege).
- **Timestamps** (modified, accessed, created) and attributes
  (read-only, hidden, system, archive, not-indexed) are carried over.
- **Filters**: `;`-separated wildcards on names, or on relative paths
  when a pattern contains `\`; excludes also match folder names
  (`node_modules` skips the subtree).
- **Pause / Resume / Stop**, live speed (over the last 2 s), per-file
  progress for files of 4 MB and up, a log, and a completion report.
- **After completion**: show report, open destination folder, shut
  down (60 s delay, cancellable).

## Journaling & resume

`services::transfer_journal`, per job in `%APPDATA%\xyz.vanhulle.datamanagerpro\journals\`:

- `<job>.json` - the request and every item that does work, written
  once when execution starts.
- `<job>.log` - append-only, flushed per line: `D <id>` when an item is
  done, `P <id> <bytes>` when a large copy checkpoints (every 64 MB the
  `.dmp-part` file is synced to disk and the offset journaled).

A stopped job, or one interrupted by closing or crashing the app,
shows up under **Interrupted Transfers** on Data Transfer and Sync.
**Resume** skips everything marked done and continues a large file
from its last checkpoint (if the source's size is unchanged).
**Discard** removes the journal and the partial files. A done line lost
to a crash only means that item is redone; a move whose source is
gone but whose destination exists counts as done.

## Sync modes (Phase 7)

| Mode | New at source | Changed | Only at destination |
|---|---|---|---|
| Mirror | copy | update | delete |
| Incremental | copy | update | delete only with "Delete files at destination" |
| Update newer only | copy | update if the source is newer, else skip (older) | as incremental |
| Two-way | copy either way | carried to the other side | see below |

"Changed" means size or modified time differ ("Skip same size and
date"), or the contents do ("Compare file content (hash)").

**Two-way** keeps a change tracker (`services::sync_state`,
`sync-state\<hash>.json` per source/destination pair): after every run,
each file's size and modified time on both sides. The next run
compares each side against it: edited on one side → copied over;
edited on both → **conflict**; missing on one side but unchanged on
the other → deleted there too; deleted on one side but edited on the
other → the edit wins. The first run has no history, so it only
copies (newer wins when both exist). Conflicts are skipped unless
resolved on the Conflicts tab (keep source / keep destination).
Folders deleted on one side are not removed on the other (their files
are).

## File actions on other pages

- **Duplicate Finder**: Delete Selected Files (Recycle Bin, never every
  copy of a group), Move to Folder (transfer engine, verified,
  rename-on-collision), CSV export, text preview.
- **Compare Locations**: Open, Open Location, Copy To, Move To, Delete
  (Recycle Bin), Exclude, Properties, Export Report (CSV) and Save
  Comparison (JSON) on the selected row's A or B copy.
- **File Search**: saved searches (persisted in the webview's local
  storage).

## Tauri commands

| Command | Purpose |
|---|---|
| `start_transfer(jobId, request, execute)` | Analyze, and optionally execute |
| `execute_transfer(jobId, overrides)` | Execute a planned job with per-item decisions |
| `set_transfer_paused` / `cancel_transfer` | Pause/resume, stop (keeps the journal) |
| `list_interrupted_transfers` / `resume_interrupted_transfer` / `discard_interrupted_transfer` | Journal |
| `schedule_shutdown` / `cancel_shutdown` / `open_folder` | After-completion actions |
| `delete_files(paths, useRecycleBin)` | Files only, never folders |
| `save_text_file(path, contents)` | Exports, to a path from the native save dialog |

Events: `transfer-progress` (150 ms), `transfer-planned`,
`transfer-complete`, `transfer-cancelled` (`resumable`),
`transfer-error`.

## Tests

`cargo test`: glob/filter matching; copy creating the tree and
skipping unchanged files on the second run; every collision policy;
move removing sources and emptied folders; mirror deleting extras
(a missing folder as one item); incremental keeping extras and
honouring excludes; two-way propagating edits and deletions and
detecting a conflict from saved state; verification and resuming a
3 MB copy from a 1 MB checkpoint; explicit file lists; journal
recording, torn-line recovery and cleanup; deleting files but never
folders.

## Known limitations

- Large files are copied with the app's own direct I/O, which copies
  the main data stream only: alternate data streams and EFS encryption
  aren't carried over for them (small files use `CopyFileExW`, which
  does carry streams).
- Long paths rely on Rust's automatic `\\?\` handling.
- The Recycle Bin isn't available on network shares; deletions there
  fall back to permanent deletion for sync, and are refused for
  Duplicate Finder/Compare Locations' Delete.

## Copy engine performance

Files are copied by size:

| Size | How | Safety |
|---|---|---|
| 16 MB and up | Native **direct I/O** (`platform/windows/directio.rs`): unbuffered (`FILE_FLAG_NO_BUFFERING`, bypassing the Windows cache), asynchronous with several sector-aligned requests in flight (`FILE_FLAG_OVERLAPPED`), destination **pre-allocated** to its full size | `.dmp-part`, renamed into place when complete; journal checkpoint every 64 MB, resumes mid-file; hashed on the same buffers for verification |
| Smaller, new | The kernel's copy (`CopyFileExW`) straight to the final name | Removed on error or stop; after a crash the journal copies it again (or Discard removes it) |
| Smaller, replacing a file | `CopyFileExW` to `.dmp-part`, then renamed | The existing file is never half-overwritten |

Scheduling adapts to the storage on both sides (seek-penalty query):
large files 2 at a time between SSDs, 1 at a time when a hard disk is
involved (16 MB x 2 requests), network 4 MB x 8 requests; small files 8
at a time. If a volume refuses unbuffered I/O, that file falls back to
a buffered copy. The transfer log says which tuning was chosen.

Benchmark (`npm run bench:copy`, `services/copy_bench.rs`): 4 x 1 GB +
2000 files of 16-512 KB on one NVMe SSD (C: to C:), the source rewritten
uncached before every run so no tool reads from RAM; "on disk" includes
flushing everything the tool left in the cache.

| Tool | Returned (s) | On disk (s) |
|---|---|---|
| DataManager Pro (new) | 4.8 | **7.0-7.1** |
| robocopy /MT:8 | 3.4-3.5 | 7.3-14.0 |
| robocopy /J /MT:8 | 2.8 | 12.1-12.2 |
| DataManager Pro (old, buffered) | 8.6-8.7 | 11.2-11.3 |
| Explorer (shell copy engine) | 26.4-26.8 | 28.5-29.2 |

Large files alone: 2.0 s for 4 GB (~2 GB/s) against robocopy's 2.5 s
and Explorer's 5.0 s. robocopy "returns" sooner because it leaves data
in the cache to be written later; measured until the data is on disk,
the new engine is the fastest and the most consistent. Small files are
bound by the file system and Defender's scan of each new file - the
.dmp-part rename was dropped for new small files because it made
Defender scan every file twice.
