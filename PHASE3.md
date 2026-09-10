# Phase 3 — High-Speed Folder/Disk Scanner

Phase 3 adds a real, recursive, cancellable scanner on top of Phase 2's
read-only filesystem layer, and streams its progress to the UI via
Tauri events instead of blocking a single request/response. Wiring the
resulting real `FsNode` tree into the Treemap/charts/tables themselves
is Phase 4's job, not this one - see [Which Pages Use Real
Data](#which-pages-use-real-data) below for exactly what changed.
**Everything in this phase is still read-only** - see [Safety
Guarantee](#safety-guarantee).

## Implemented Features

- **Two scan engines, chosen automatically per scan**:
  - **Walk engine** (`services::scan_service`) - a multithreaded,
    cancellable recursive directory walk built on `rayon`. Reuses
    Phase 2's `platform::current::{decode_attributes,
    allocated_size_bytes}` helpers per file, the same way
    `filesystem_service::list_directory` does. Works identically
    against local drives and UNC network shares. This is the primary,
    fully-verified engine - every scan falls back to it.
  - **MFT engine** (`platform::current::try_mft_scan`, Windows-only) -
    a best-effort fast path using the
    [`ntfs`](https://github.com/ColinFinck/ntfs) crate (a real,
    maintained, read-only NTFS parser) to read directory index records
    directly instead of `stat`-ing every file. NTFS caches each file's
    size/allocated-size/timestamps/attributes right in its parent
    directory's index specifically so directory listings are fast -
    that cache is the entire source of this engine's speed. It's
    inherently single-reader (one raw volume handle), so unlike the
    walk engine it does not parallelize - "multithreaded" (per the
    brief) is satisfied by the walk engine.
  - **The choice is automatic and silent per scan**: MFT is attempted
    first only for local, drive-rooted paths; opening the raw volume
    (`\\.\C:`) requires admin/backup privilege, so without it (or for
    a UNC path, a non-NTFS volume, or any parse error partway through)
    the scan transparently retries with the walk engine - no error is
    ever surfaced to the user for this. The frontend is told which
    engine actually ran, once the scan completes.
- **Real recursive aggregation** - unlike Phase 2's deliberately
  shallow `get_directory_summary`, a scan's root/every folder node
  reports true recursive `size`/`allocated`/`fileCount`/`folderCount`
  totals across its entire subtree.
- **Live progress via events, not polling** - `scan-progress` is
  emitted roughly every 150ms with live scanned-files/folders/bytes
  counts and the current path, `scan-complete` once with the full
  result tree, `scan-cancelled` or `scan-error` instead if applicable.
- **Real cancellation** - `cancel_scan` flips a cooperative flag the
  running scan checks regularly; already-visited work is kept, nothing
  is torn down mid-write (there's nothing to tear down - the whole
  phase is read-only).
- **Errors don't abort a scan** - an access-denied or otherwise
  unreadable subtree is recorded (path + reason, capped at 200
  entries) and the walk continues past it, the same "skip and warn"
  philosophy as Phase 2's `list_directory`.
- **Symlinks/junctions are not traversed** - reported as a zero-size,
  non-recursed leaf to avoid cycles and double-counting. See [Known
  Limitations](#known-limitations).
- **Real UI slice, not a full Treemap rewire** (per the Phase 3/4
  split) - Disk Analysis and Folder Analysis's "Scan" button now runs
  a real scan against the picked location: a live "Scanning... N
  files" label, an indeterminate progress bar (a real item count isn't
  knowable ahead of time - see [Progress Bar](#progress-bar-decision)
  below), a Cancel button, and on completion a real one-line summary
  (size/file/folder counts) plus a toast naming which engine ran. The
  Treemap/tabs/tables below remain on Phase 1 mock data with their
  existing `DemoBadge` - that's Phase 4's job.

## Rust Modules Added

```
src-tauri/src/
  models/
    scan.rs              ScanOptions, ScanEngine, ScanProgress,
                          ScanSkip, ScanResult, FsNode (mirrors
                          src/models/common.ts's FsNode exactly),
                          ScanProgressState (shared runtime counters/
                          cancel flag/skip list - deliberately in
                          `models` so neither `services` nor
                          `platform` has to depend on the other)
  services/
    scan_service.rs       the walk engine (`scan_dir`) plus
                          `run_scan`, which tries the MFT engine first
                          and falls back automatically
  platform/
    windows/mft.rs         the MFT engine: a sector-aligned raw-volume
                          reader, path resolution via the NTFS
                          directory index, and the FsNode-building
                          walk over cached $FILE_NAME records
    fallback.rs            (extended) `try_mft_scan` unconditionally
                          unavailable on non-Windows, so the crate
                          still builds elsewhere for dev/CI
  commands/
    scan.rs                start_scan, cancel_scan - thin Tauri glue:
                          validates the path, registers/deregisters
                          the scan, runs it on a background task with
                          a concurrent progress ticker, emits exactly
                          one of scan-complete/scan-cancelled/
                          scan-error
```

New dependencies: `rayon` (fork-join parallelism for the walk engine)
and `ntfs` (the MFT engine's NTFS parser). No `walkdir` - a hand-rolled
walker gives direct control over per-directory cancellation checks and
rayon fork points that an external iterator wouldn't.

## Tauri Commands

| Command | Async | Notes |
|---|---|---|
| `start_scan(scanId, path, options?)` | yes | **new** - `scanId` is generated by the *frontend*, not the backend (see [Scan ID Ownership](#scan-id-ownership-decision)). Returns once the scan is registered and running, not once it's done. |
| `cancel_scan(scanId)` | no | **new** - no-op (not an error) if the id is already finished |

## Events

| Event | Payload | When |
|---|---|---|
| `scan-progress` | `ScanProgress` | ~every 150ms while a scan runs |
| `scan-complete` | `ScanResult` | once, on success |
| `scan-cancelled` | `{ scanId }` | once, instead of `scan-complete`, if cancelled before finishing |
| `scan-error` | `{ scanId, error }` | only if the scan task itself panics - a bug, not a normal outcome; every *expected* failure (an unreadable subfolder) is recorded in `ScanResult.skipped` instead |

## Frontend Changes

- `src/models/backend.ts` - `ScanOptions`, `ScanEngine`, `ScanProgress`,
  `ScanSkip`, `ScanResult` (its `root` field is typed as the
  **existing** `FsNode` from `src/models/common.ts`, not a new
  duplicate type).
- `src/api/scan.ts` - `generateScanId`, `startScan`, `cancelScan`, and
  `subscribeScanEvents` (wraps `@tauri-apps/api/event`'s `listen()`
  for all four events, filtered to one scan id).
- `src/state/scanStore.ts` - `useScanStore`: the single active scan
  session (status/progress/result/error), same self-contained-async
  style as `filesystemStore`. Disk Analysis and Folder Analysis share
  it directly, matching how they already share `filesystemStore`.
- `src/hooks/useScanNotifications.ts` - fires the completion/
  cancellation/error toast exactly once per scan; shared by both pages
  since the scan store is global (a scan started on one page can
  finish while the user is on the other).
- `src/components/charts/ProgressBar.tsx` - new optional
  `indeterminate` prop (existing callers untouched).
- `DiskAnalysisPage.tsx` / `FolderAnalysisPage.tsx` - "Scan" now runs
  `useScanStore.start(...)` against the picked real location instead
  of `useSimulatedProgress`'s frontend-only timer; a Cancel button
  appears mid-scan; a one-line real summary appears on completion.

## Which Pages Use Real Data

| Page | Real (new in Phase 3) | Still mock |
|---|---|---|
| **Disk Analysis** | Real recursive scan (Scan/Cancel buttons, live progress, one-line real size/file/folder summary, real-engine-named toast) | Treemap, Drive Usage donut, Top File Types, Files & Folders table, other tabs (all still `DemoBadge`-marked, per Phase 2) |
| **Folder Analysis** | Same real recursive scan slice, alongside Phase 2's existing shallow "Direct files/folders/size" card | Treemap, Size Distribution, File Types, Top 10 Largest Files, Files & Folders table, Duplicates tab |
| Every other page | unchanged | fully mock (their real backends are later phases) |

## Progress Bar Decision

A scan's total item count isn't known until it finishes - there's no
cheap way to pre-count a folder tree without doing most of the walk
twice. Rather than fake a percentage, `ProgressBar` gained an
`indeterminate` mode (a full-width, pulsing bar) for this case; the
live "Scanning... N files" label on the button itself carries the real
signal instead.

## Scan ID Ownership Decision

`start_scan` takes `scanId` as a parameter generated by the
**frontend** (`crypto.randomUUID()`-based), rather than generating one
server-side and returning it. Generating it server-side would leave a
real race: a scan of a tiny folder can finish (and emit
`scan-complete`) before the frontend's `await startScan(...)` call
even resolves, let alone before it gets to call `listen()` on an id it
didn't have yet. With the id generated up front, `useScanStore.start`
calls `subscribeScanEvents` (awaiting all four `listen()` calls) and
only *then* calls `startScan` - closing the race entirely.

## Tests Added

**Rust** (`cargo test`, 45 tests total, all passing) - 5 new in
`services::scan_service`:
- Recursive size/file/folder aggregation across a nested tree (not the
  shallow direct-children-only counts Phase 2's summary reports).
- `percentOfParent` is relative to the immediate parent, and the root
  is exactly 100.
- An unreadable subtree (a missing path mid-scan) is recorded as a
  skip and returns an empty stub, without affecting a real scan of the
  real tree around it.
- A pre-cancelled scan visits nothing and returns immediately.
- A directory symlink/junction is reported as a zero-size, non-
  recursed leaf rather than being traversed (skipped gracefully via
  `return` if the platform/privilege can't create one, rather than
  failing the suite over an environment gap unrelated to the
  scanner).

The MFT engine's raw NTFS parsing isn't practically unit-testable in
CI (it needs a real formatted NTFS volume and, in most environments,
elevation) - see [Known Limitations](#known-limitations) for how it
was verified instead.

**Frontend**: still no automated test runner (unchanged from Phase 1/
2); verified via the full `tsc`/`eslint`/`vite build` gate plus a live
`npm run tauri dev` run.

## Build Verification

Run from `src-tauri/`:

```
cargo fmt --check    ✅ no diff
cargo clippy --all-targets   ✅ zero warnings
cargo test            ✅ 45 passed, 0 failed
cargo check           ✅ zero warnings
```

Run from the repo root:

```
npm run typecheck     ✅ zero errors
npm run lint           ✅ zero errors
npm run build          ✅ production build succeeds
```

`npm run tauri dev` was launched and driven end-to-end against the
real build (Win32 `PrintWindow` capture + a focus-and-click driver,
since `tauri-driver`/CDP weren't set up in this session):

- Scanned the real `C:\` (this dev session happens to be elevated,
  ~580 GB / ~750K files / ~133K folders) via the **MFT engine** -
  `engine=Mft elapsed_ms=88741 files=750064 folders=133177`. Re-ran
  the same `C:\` scan ~13 minutes later via the **walk engine**
  (`engine=Walk elapsed_ms=115226 files=750590 folders=132632`) - the
  two independent engines agreed to within ~500 files/folders and
  ~200 KB out of 580 GB, exactly the amount of drift you'd expect from
  normal filesystem churn (temp files, logs) in 13 real minutes. Real,
  live, independent cross-validation that both engines compute
  matching results on the same real volume - not just that each one
  runs.
- Clicked **Scan** on `C:\` a third time, then clicked **Cancel**
  ~28 seconds in; the backend logged the cancellation request and
  `scan cancelled` 53ms later, and the UI reverted to the idle "Scan"
  button with no stale result shown (correctly distinct from the
  "completed" summary line, which only renders for a real
  `scan-complete`).
- Also scanned a real folder (`...\OneDrive - IT PARTNER BV\Bureaublad`)
  in 435ms via MFT.
- No panics, no permission errors, no stray console errors observed
  throughout.

## Performance: Bulk $MFT Read

The directory-index MFT engine described above (one `directory_index()`
B+tree lookup per folder) is already far faster than the walk engine,
but a live side-by-side against WizTree on this machine's real `C:\`
(~1M files) showed a real gap worth closing: **90-133s here vs.
WizTree's ~3.67s**. Two rounds of investigation followed, both
validated directly via `cargo test -- --ignored --nocapture` against
real local folders/drives rather than the slow UI-click verification
loop used elsewhere in this doc - see `src-tauri/src/platform/windows/mft.rs`'s
`bulk_mft_tests` module for the tests themselves (all `#[ignore]`-gated
since they need an elevated/backup-privileged shell and touch a real
volume).

**Attempt 1 (reverted): sequential per-record `Ntfs::file()` calls.**
The theory was that reading the ~750K-900K File Records in raw
record-number order would be faster than following live directory
structure. It was dramatically *slower* instead (8+ minutes, didn't
finish) - `Ntfs::file()` re-derives the `$MFT`'s own `$DATA` run list
on *every call* (see its doc comment in the `ntfs` crate source), and
calling it once per *record* rather than once per *folder* multiplied
that redundant work by roughly the file-to-folder ratio. Reverted live
back to the directory-index engine; see `mft.rs`'s top doc comment for
the full postmortem, preserved there since it explains why the
*next* attempt had to avoid `Ntfs::file()` entirely.

**Attempt 2 (shipped): one bulk read of the whole `$MFT`, parsed by
hand from an in-memory buffer.** `bulk_scan_via_mft` (same file) reads
the entire `$MFT` data stream in a single `NtfsReadSeek::read_exact`
call - the *only* per-scan use of `Ntfs::file()` this path makes - then
hand-parses every fixed-size File Record directly out of that buffer:
the Update Sequence Array fixup, the attribute list, `$FILE_NAME`, and
(new territory beyond what the directory-index engine needs) the
record header's `base_file_record` field and `$ATTRIBUTE_LIST`
entries. No further disk I/O after the one bulk read - this is the
same overall approach WizTree itself is understood to use.

Three real correctness bugs turned up building this, each confirmed via
a live scan before being fixed - noted here since the fixes are exactly
what makes hand-parsing raw MFT bytes trustworthy instead of merely
fast:

1. **Extension-record identity.** When a heavily hard-linked
   file/folder's attributes don't fit one File Record (WinSxS and the
   Driver Store are full of this), NTFS moves some into a separate
   *extension* record referenced via `$ATTRIBUTE_LIST`. An extension
   record has its own record number but no identity as a *parent* -
   every child's parent reference always names the *base* record. Using
   the extension record's own number as "this folder's identity" made
   every one of its real children invisible (found live: several
   WinSxS driver-package folders showing 0 children when a live listing
   showed 3). Fixed by reading `base_file_record` from every record's
   header and keying by that instead when it's non-zero.
2. **Stale `$FILE_NAME`-cached size.** `$FILE_NAME`'s cached
   `data_size`/`allocated_size` fields are only guaranteed in sync
   "when the file name changes" (per the `ntfs` crate's own doc
   comments) - confirmed live that a meaningful number of real system
   files (`msedge.dll` at 263 MB, among others) have this cached value
   genuinely zeroed in their own record, even though the *parent
   directory's index* copy of the same structure (what the
   directory-index engine reads instead) is correct. Fixed by reading
   the authoritative size from the record's own `$DATA` attribute
   instead (resident value length, or the non-resident header's
   `data_size`/`allocated_size` fields - present directly in the
   record, no data-run resolution needed).
3. **`$DATA` itself can be relocated too.** For a large enough/heavily
   fragmented file (confirmed live: an actively-growing registry hive,
   `C:\Windows\System32\config\SOFTWARE`), even `$DATA` doesn't fit in
   the base record and gets moved to extension record(s) via
   `$ATTRIBUTE_LIST`. Fixed with a second pass: any record whose
   `$DATA` wasn't found directly is resolved by jumping straight to the
   extension record(s) named in its (resident) `$ATTRIBUTE_LIST` -
   every record is already fixed-up in memory by then, so this second
   pass is pure in-memory lookups, no extra I/O.
4. **Reconciling the two legitimate sizes.** Bug 2's fix (always
   trusting `$DATA`) turned out to have its own failure mode: OneDrive
   "Files On-Demand" cloud placeholders (multi-GB files not yet
   materialized locally) have a correct, full-size `$FILE_NAME` cache
   but a `$DATA` attribute reporting ~0 (nothing local yet) - the exact
   opposite staleness direction. Final fix takes `max()` of the two
   values per file: understating a real file as 0 bytes is a far worse
   failure mode for a disk-usage tool than occasionally overstating a
   since-shrunk file with a stale-but-larger cached value.

**Validated live**, each cross-checked against the existing
directory-index engine on the same target:

| Target | Files/Folders | Bulk (debug) | Directory-index | Speedup |
|---|---|---|---|---|
| `C:\Windows\WinSxS` | ~121K / ~66K | ~13-17s | ~78-88s | ~5-7x |
| `C:\Windows` | ~178K / ~77K | ~13-17s | ~78-97s | ~5-9x |
| `C:\` (whole drive) | ~1.04M / ~170K | ~19s | ~174s | ~9x |

File/folder counts and total bytes matched the directory-index engine
within live-filesystem noise on every target (confirmed via two
back-to-back bulk-only runs of the same target too,
`bulk_mft_self_consistency`: **0** file/folder count difference and a
sub-0.0001% byte difference, proving the bulk parser itself is
deterministic - the count differences seen against the *much slower*
comparison scans, especially on `C:\` where the directory-index run
alone takes ~174s, are genuine churn on an actively-synced machine, not
a parsing bug).

**The table above was measured with `cargo test` (debug, unoptimized) -
misleadingly pessimistic**, since that's not what actually ships (Tauri
always builds the real app in release mode). Re-measured with
`cargo test --release`, `C:\`'s per-run breakdown dropped from ~19s to
**~4.5-6.5s** (varies with OS filesystem cache state for the ~1.2 GB
`$MFT` read) - within **~1.2-1.8x of WizTree's ~3.67s**, not ~5x.
Two further changes closed most of that remaining gap once the debug/
release mismatch itself was found and this session kept pushing (both
confirmed live, correctness re-checked after each: WinSxS's bulk-vs-
directory-index counts/bytes still matched within the same noise
margin as before):

- **Parallelized `bulk_parse_mft`'s pass 1** (rayon, already a
  dependency for the walk engine) - each record's fixup+parse is fully
  independent of every other, so this maps every record in parallel
  into small owned results, merged into the shared maps in one cheap
  sequential pass afterwards. This was the single biggest CPU-bound
  cost in the whole bulk path (measured in isolation: ~15-16s of the
  ~19s *debug* total was this one step).
- **Parallelized `build_node_from_map`'s recursion** - a directory's
  children are independent of its siblings once the in-memory
  parent-child map exists, so building them (including recursing into
  subdirectories) runs via rayon's `par_iter` instead of a sequential
  loop. Measured on its own: ~2.1-2.7s down to **~0.4-0.7s**.
- A larger (4 MiB, vs. `BufReader`'s 8 KiB default) read buffer
  specifically for the bulk path's one long sequential `$MFT` read -
  a smaller, secondary win alongside the two above.

12 logical cores were available on the machine this was measured on;
the speedup from parallelizing will scale with core count, same as the
walk engine's own rayon-based parallelism already does.

**Bulk read has a mostly-fixed cost, unlike the directory-index
engine.** It reads the *entire* `$MFT` regardless of how small the
target folder is (confirmed live: a ~560-file `C:\Windows\Fonts`
subfolder took the same ~16s the whole-drive read costs, against the
directory-index engine's ~0.17s there) - because scanning it means
parsing one record at a time out of a buffer that's already fully in
memory, whereas the directory-index engine's cost scales with how many
folders are actually in the target. So `try_mft_scan` **dispatches**:
a bare drive root (`C:\`) goes to `bulk_scan_via_mft`; anything
narrower (the common Folder Analysis case) keeps using the
directory-index engine, where it's the clear winner instead.

**Known remaining gap**: a *non-resident* `$ATTRIBUTE_LIST` (only when
even the attribute list itself doesn't fit resident - confirmed live
on exactly one file across a full `C:\` scan, `MRT.exe`) isn't
followed; such a record falls back to whatever `$FILE_NAME` has
cached, which can still be 0 in the rare case both are stale for the
same record. Resolving this would need volume data-run resolution for
the attribute list's own value, reintroducing per-record I/O for a
narrow enough case that it wasn't judged worth trading the bulk read's
"one I/O for the whole scan" property for.

## Known Limitations

- **MFT engine needs admin/backup privilege** to open a raw volume
  handle - without it (the common case for a normal, non-elevated
  run), every scan silently and correctly falls back to the walk
  engine. This session happened to be elevated, so the MFT path was
  live-verified directly (see Build Verification above); on a typical
  non-elevated run, only the walk engine will ever be exercised.
- **Symlinks and junctions are not traversed** - reported as a
  zero-size leaf. A real symlink target's contents are simply not
  counted, whichever engine ran.
- **No pagination/streaming of the result tree itself** - the full
  `FsNode` tree for the scanned location is built in memory and sent
  in one `scan-complete` event. Fine for Phase 3's scope; a
  pathologically large tree (many hundreds of thousands of files)
  would produce a correspondingly large single IPC payload. Revisit if
  it proves slow in practice - Phase 4, which actually renders this
  data into a Treemap, is a more natural point to add windowing if
  needed.
- **The MFT engine's allocated size** comes straight from NTFS's
  cached `$FILE_NAME.allocated_size` (exact, no approximation needed -
  better than Phase 2's own cluster-rounding fallback for the walk
  engine's per-file case, which still applies there).
- **No progress engine name.** A `scan-progress` tick doesn't say which
  engine is running (only `scan-complete` does) - the MFT/walk decision
  happens as part of the scan itself, so it isn't known yet mid-flight.
- **One active scan in the frontend UI** - `useScanStore` models a
  single active session (matching `filesystemStore`'s "one browse
  session" convention); the backend itself can track multiple
  concurrent scans by id if a later phase needs that.
- **A non-resident `$ATTRIBUTE_LIST`** on the bulk-read engine isn't
  followed (see "Performance: Bulk $MFT Read" above) - narrow (one file
  in a full live `C:\` scan) but real; such a file can show a stale
  cached size instead of its true one.

## Safety Guarantee

Every function added in this phase is read-only, including the raw
NTFS volume access - opening `\\.\C:` uses default (shared) access and
never calls anything but read/seek on it. Verified with the same
grep Phase 2 used, extended to the new modules:

```
grep -rn "remove_file\|remove_dir\|rename\|::copy\|OpenOptions.*write\|set_permissions\|fs::write\|create_dir" src-tauri/src
```

The only matches remain the pre-existing `#[cfg(test)]` tempfile
fixture writes from Phase 2 (plus this phase's own new tempfile-based
tests, same pattern) - never in `commands/`, `services/`, or
`platform/`.
