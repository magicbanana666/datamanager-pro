# Roadmap

**Phase 1 — Complete** (UI-only, see [PHASE1.md](./PHASE1.md)).
**Phase 2 — Complete** (real, read-only filesystem layer, see
[PHASE2.md](./PHASE2.md)).
**Phase 3 — Complete** (real recursive scanner, see
[PHASE3.md](./PHASE3.md)).
**Phase 4 — Complete** (real Treemap/charts/tables, see
[PHASE4.md](./PHASE4.md)).
**Phase 5 — Complete** (real search/comparison/duplicates, see
[PHASE5.md](./PHASE5.md)).
**Phases 6 & 7 — Complete** (copy/move/sync engine with journal and
resume, see [PHASE6.md](./PHASE6.md)).
**Phase 8 — Complete** (network shares, see [PHASE8.md](./PHASE8.md)).
**Phase 9 — Complete** (scheduler and reports, see [PHASE9.md](./PHASE9.md)).
**Phase 10 — Complete** (installer, portable, updates, hardening, see
[PHASE10.md](./PHASE10.md)).
 The phases below are suggested milestones
for turning the rest of the UI into a fully functional application.
Each phase should keep the existing page/component structure intact
and simply swap mock data sources for real ones behind the same
interfaces (`src/models/*.ts` on the frontend, `src-tauri/src/models/*.rs`
on the backend).

### ~~Phase 2 — Real filesystem abstraction & drive enumeration~~ ✅ Complete
Rust commands enumerate real drives/volumes (letter, label, total/
used/free bytes, file system) and browse folders read-only, replacing
`src/mock/drives.ts` for that purpose. A real native folder-picker
dialog (`@tauri-apps/plugin-dialog`) is wired behind every "Browse..."
button. Path validation, non-recursive directory listing, and
shallow folder/file metadata are also real. See
[PHASE2.md](./PHASE2.md) for the full detail; the analytical layers
(treemaps, charts, duplicates, etc.) remain mock data going into
Phase 3.

### ~~Phase 3 — High-speed folder/disk scanner~~ ✅ Complete
A multithreaded Rust scanning engine (MFT-based on NTFS where
possible via the `ntfs` crate, automatically falling back to a
`rayon`-parallel directory walk) walks a location and produces the
real `FsNode` tree shape the frontend already expects, streamed to the
UI via Tauri events (`scan-progress`/`scan-complete`/`scan-cancelled`/
`scan-error`) so the existing progress-bar patterns keep working. See
[PHASE3.md](./PHASE3.md) for the full detail; the Treemap/charts/
duplicate-finder layers still render Phase 1 mock data going into
Phase 4 - Phase 3 only proves the engine end-to-end via a real
Scan/Cancel/live-summary slice on Disk Analysis and Folder Analysis.

### ~~Phase 4 — Treemap & analysis engine using real data~~ ✅ Complete
Disk Analysis and Folder Analysis's Treemap, "Files & Folders" table,
and every derivable analytical tab (Chart, File Types, Top Files, Top
Folders, Timeline, Extensions) now render a real completed scan,
re-scoping to whatever subfolder is drilled into. See
[PHASE4.md](./PHASE4.md) for the full detail, including a genuine
layout bug (a `Card` body's default flex sizing silently beating an
explicit fixed height) this phase found and fixed across the whole
app. Network Analysis stays mock (no real backend until Phase 8), as
do Users/Owners (Disk Analysis) and Duplicates (Folder Analysis) -
neither has real data to show yet. Persistence (reopening a completed
scan without rescanning) was explicitly deferred as a fast-follow, not
built this pass.

### ~~Phase 5 — Search, comparison & duplicate engine~~ ✅ Complete
Real file-name/content search (with regex, in-archive search),
real folder comparison (size/timestamp, content hash, name-only), and
a real duplicate-detection engine (hash-based grouping, hard-link
aware), plus the Folder Analysis Duplicates tab. All read-only. See
[PHASE5.md](./PHASE5.md).

### ~~Phase 6 — Copy/move engine with journaling & resume~~ ✅ Complete
A real, cancellable/resumable copy/move engine with a transaction
journal so interrupted transfers can resume, with real collision
policies, verification and permission preservation, plus the file
actions on Duplicate Finder and Compare Locations. See
[PHASE6.md](./PHASE6.md).

### ~~Phase 7 — Incremental sync & mirror engine~~ ✅ Complete
Mirror, incremental, update-newer and two-way sync on the same engine,
with a two-way change tracker and conflict resolution. See
[PHASE6.md](./PHASE6.md).

### ~~Phase 8 — Network share support~~ ✅ Complete
Real SMB share scanning, server shares, access rights, sessions,
connection status and read-speed measurement on Network Analysis. The
IP/port scanner part was not built; that page stays a demo. See
[PHASE8.md](./PHASE8.md).

### ~~Phase 9 — Scheduler & reporting~~ ✅ Complete
An in-app scheduler (runs while the app is open, clearly disclosed)
that runs transfer and scan tasks, and real HTML/PDF/XLSX/CSV reports
from the app's live results. See [PHASE9.md](./PHASE9.md).

### ~~Phase 10 — Installer, portable build, update system & production hardening~~ ✅ Complete
NSIS and MSI installers, a portable edition (data next to the exe), an
auto-update channel via GitHub Releases with signed updates and a release
workflow, crash reports and log files, single-instance, a capped scan
cache, persistent settings and CI. Code signing needs a certificate and
is documented, not configured. See [PHASE10.md](./PHASE10.md).
