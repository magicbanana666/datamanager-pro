# Roadmap

Phase 1 is UI-only (see [PHASE1.md](./PHASE1.md)). The phases below are
suggested milestones for turning that UI into a fully functional
application. Each phase should keep the existing page/component
structure intact and simply swap mock data sources for real ones behind
the same interfaces (`src/models/*.ts` on the frontend,
`src-tauri/src/models/*.rs` on the backend).

### Phase 2 — Real filesystem abstraction & drive enumeration
Rust commands to enumerate real drives/volumes (letter, label, total/
used/free bytes, file system) and browse folders, replacing
`src/mock/drives.ts`. Introduce a real native folder-picker dialog
(`@tauri-apps/plugin-dialog`) behind every "Browse..." button.

### Phase 3 — High-speed folder/disk scanner
A multithreaded Rust scanning engine (MFT-based on NTFS where possible,
falling back to `walkdir`) that walks a location and produces the
`FsNode` tree shape the frontend already expects, streamed to the UI
via Tauri events so the existing progress-bar patterns keep working.

### Phase 4 — Treemap & analysis engine using real data
Wire Disk Analysis, Folder Analysis and Network Analysis's Treemap,
charts, and tables to real scan results from Phase 3. Add persistence
so a completed scan can be reopened without rescanning.

### Phase 5 — Search, comparison & duplicate engine
Real file-name/content search (with regex, in-archive search),
real folder comparison (size/timestamp, content hash, name-only), and
a real duplicate-detection engine (hash-based grouping). Replace
`src/mock/search.ts`, `src/mock/comparison.ts`, `src/mock/duplicates.ts`.

### Phase 6 — Copy/move engine with journaling & resume
A real, cancellable/resumable copy/move engine with a transaction
journal so interrupted transfers can resume. Wire up Data Transfer's
collision policies, verification, and permission preservation for real.

### Phase 7 — Incremental sync & mirror engine
Build the real Sync / Incremental engine (mirror, incremental, update-
newer, two-way) on top of the Phase 6 journal, including real conflict
detection or the two-way sync change tracker.

### Phase 8 — Network share support & IP/port scanning
Real SMB share browsing/scanning (replacing `src/mock/network.ts`) and
a real, consent-gated IP/port scanner (replacing `src/mock/portscan.ts`)
using async TCP connect scans - always behind explicit user action and
scoped to networks the user has permission to scan.

### Phase 9 — Scheduler & reporting
A real scheduler (either an internal cron-like runner or genuine
Windows Task Scheduler integration, clearly disclosed to the user) and
real report generation (PDF/HTML/XLSX/CSV) replacing the "Generate
Report" no-op in `src/pages/reports`.

### Phase 10 — Installer, portable build, update system & production hardening
MSI/NSIS installer via `tauri-bundler`, a portable single-exe build,
an auto-update channel, code signing, crash reporting, and a pass over
error handling/edge cases across every engine added in Phases 2-9.
