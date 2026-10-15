# Phase 5 — Search, Comparison & Duplicate Engine

Phase 5 replaces the mock data behind Duplicate Finder, Compare
Locations and File Search with three real, **read-only** engines, plus
the Duplicates tab on Folder Analysis. All three list files with the
Phase 3 scan engines (MFT when elevated, otherwise the parallel walk),
so collecting candidates is as fast as a disk scan, and all three share
one job/progress/cancel pipeline.

## Implemented Features

### Duplicate Finder
- Criteria: **exact content**, **same name** (optionally
  case-insensitive) or **same size**, with min/max size limits and
  hidden/system filters. Overlapping locations never self-match.
- Exact content groups by size first, hashes the first 64 KiB of every
  same-size candidate, and only reads whole files that still match
  (xxh3-128, in parallel).
- **Hard links are collapsed** by volume serial + file index - two
  paths to one physical file aren't duplicates. Without this,
  `C:\Windows` reported ~7.7 GB of "duplicates" that were almost all
  WinSxS links; now 1.4 GB of real ones in 3.8 s (walk engine, release).
- Results: top 5,000 groups by recoverable space (totals cover every
  group), File Types and Folders breakdowns, working keep rules
  (newest/oldest/shortest path/largest).

### Compare Locations
- Files are paired by path relative to each location,
  case-insensitively.
- Modes: **content** (hashes only same-size pairs - a size difference
  settles "different" without opening either file), **size + modified
  time** (2 s tolerance for FAT/exFAT) or **name only**.
  Include-subfolders and ignore-small-files (< 4 KB) are real.
- Per-side summaries, extension totals, per-status tabs, file-type
  donuts and per-category bar charts. `System32` vs `SysWOW64` by
  content: 11 s (walk engine, release).

### File Search
- Queries: plain text, wildcard patterns (`*.pdf`, whole-name match) or
  regex, with case-sensitive and whole-word options. An invalid regex
  or empty query is rejected up front (`InvalidInput`) instead of
  showing "no results".
- Optional **in-archive** search: entry names inside `.zip` files, read
  from the central directory only - nothing is decompressed.
- Optional **content** search over raw bytes, so any ASCII/UTF-8 text
  format matches (source, logs, CSV, HTML...). Binaries are skipped by
  a NUL sniff; formats that store text compressed or as UTF-16
  (`.docx`, `.pdf`, Notepad "Unicode" `.txt`) are not decoded. Content
  hits carry snippets; `get_text_preview` serves the preview pane and
  `open_path` opens a hit with its default app.
- Type/size/date filters are applied before matching; matching runs in
  parallel.

### Folder Analysis → Duplicates tab
After a real folder scan, the tab runs the real duplicate finder
(exact content) on the folder currently in view and lists the largest
groups. It uses the Duplicate Finder's global run, so "Open in
Duplicate Finder" shows the same result with the folder prefilled.

### Still demo
Deleting/moving duplicates and comparison file actions stay demo
until the Phase 6 file-operations engine. Before a first run, each
page still shows its Phase 1 sample data with a `DemoBadge`, the same
pattern Phase 4 used.

## Shared Job Plumbing

```
src-tauri/src/models/hash_job.rs     HashJobState / HashJobProgress / HashJobPhase
src-tauri/src/services/hashing.rs    hash_file (xxh3-128, optional prefix)
src-tauri/src/commands/mod.rs        JobRegistry + run_hash_job (150 ms progress ticker)
src/api/jobs.ts                      subscribeJobEvents(prefix, id, handlers)
src/state/createJobStore.ts          one global zustand store per feature
```

Each feature emits `<prefix>-progress`, `-complete`, `-cancelled` and
`-error` (prefix `duplicate`, `comparison`, `search`), filtered to one
frontend-generated job id. The stores are global, so a running job -
and its result - survive navigating away, and terminal states are
toasted from the store rather than a page.

## Tauri Commands

| Command | Purpose |
|---|---|
| `start_duplicate_scan` / `cancel_duplicate_scan` | Duplicate finder |
| `start_comparison` / `cancel_comparison` | Folder comparison |
| `start_file_search` / `cancel_file_search` | File search |
| `get_text_preview` | First KBs of a text file for the preview pane |
| `open_path` | Open a search hit with its default app |

## Safety Guarantee

Every Phase 5 engine is read-only: nothing creates, modifies, moves or
deletes a file. File actions offered by the result tables stay demo
until Phase 6.
