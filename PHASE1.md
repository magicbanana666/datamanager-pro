# Phase 1 — Implementation Record

This document lists exactly what Phase 1 of DataManager Pro delivers, so
later phases (and reviewers) know precisely what's real UI vs. what's
still mock. Nothing described here performs a real disk, network, or
filesystem operation — see [Safety Guarantee](#safety-guarantee) at the
bottom.

## Application Shell

- Persistent left **sidebar** (12 entries, blue highlight on the active
  page, tagline at the bottom: "Analyze. Migrate. Manage. Your Data.")
- Persistent top **toolbar**: New Scan, Open Project, Save Project,
  Compare, Scheduler, Reports, Settings, Help — the last two open real
  dialogs; Compare/Scheduler/Reports navigate and highlight like the
  sidebar; the first three show a "Phase 1 Demo Mode" dialog
- Persistent bottom **status bar**: `Ready | Memory: NNN MB | v0.1.0`,
  all three values driven by app state (`state/uiStore.ts`), not
  hardcoded JSX
- **Settings dialog** with all 7 required sections (General, Appearance,
  Scanning, File Operations, Network, Reports, Advanced), backed by
  `state/settingsStore.ts`. Appearance → Density actually applies
  (toggles `data-density` on `<html>`, which the table row height reacts
  to)
- **Help dialog** that calls the real Rust backend (`ping_backend`,
  `get_app_version`, `get_system_info_mock`) and shows the live result —
  the one place Phase 1 proves the frontend/backend bridge end-to-end
- Toast notifications (`state/toastStore.ts`) for every demo/no-op
  action, including the two exact messages required by the brief:
  *"Phase 1 Demo Mode — this action is not connected to the backend
  yet."* and *"Demo mode - no files were modified."*

## Pages (13)

1. **Overview** — 6 stat cards, storage usage line chart, recent scans
   table, quick actions, recent transfers, recent reports.
2. **Disk Analysis** — location bar, scan options, quick filters (All /
   Large Files / Old Files / Temporary Files / System Files, which
   really filter the treemap+table), 8 tabs (Treemap / Chart / File
   Types / Top Files / Top Folders / Timeline / Extensions / Users),
   drill-down treemap with breadcrumb, drive usage donut, drive info,
   top file types, largest files, and an expandable/sortable folder
   table with a live "Folder Details" panel.
3. **Folder Analysis** — same pattern scoped to `D:\Data\Projects`, with
   a Duplicates tab linking into Duplicate Finder, plus Size
   Distribution / File Types / Top 10 Largest Files panels.
4. **Network Analysis** — connection status, scan summary, 9 tabs
   (Overview / Shares / Treemap / Chart / Top Folders / Top Files / File
   Types / Access Rights / Sessions), network throughput line chart,
   network shares table, access rights table.
5. **Comparison** — two location pickers with swap, 3 comparison modes,
   3 options, 9 tabs that both switch the summary dashboard and filter
   the detailed table, and all 8 bottom action buttons.
6. **File Search** — location + criteria + saved searches, a left
   filter panel, a results table with **actual text highlighting** of
   the matched term, and a right preview/details/occurrences panel.
7. **Duplicate Finder** — multi-location checklist, 4 match criteria, 5
   ignore options, 8 tabs, expandable/collapsible groups with
   checkboxes, live summary stats (recomputed from selection state),
   and a right panel with Preview / File Details / Group Selection /
   Keep Rules. Delete/Move buttons always show the demo-mode toast and
   never touch a file.
8. **Data Transfer** — source/destination, 4 transfer modes, 4 collision
   policies, options, simulated progress (0→100% over a real timer)
   that drives per-file status/progress/speed/ETA, a transfer log tab,
   and a live speed chart.
9. **Sync / Incremental** — source/destination, 4 sync modes, include/
   exclude filters, a status-coded change table (Copy New / Update
   Newer / Skip Same / Skip Older / Exclude Filter), live sync summary
   counts, and simulated progress with a realtime speed chart.
10. **Scheduler** — task table bound to a Zustand store (toggle enabled,
    edit, delete, "run now" all mutate real app state), summary cards
    computed from that state, task details panel, and a run history
    table. Never touches the real Windows Task Scheduler.
11. **Reports** — 6 tabs, 5 summary cards, 3 charts (top folders, file
    type distribution, data growth), a filterable recent-reports table,
    and a full "Generate New Report" form.
12. **Tools** — a searchable grid of 30 tool cards across 5 categories;
    every card either navigates to a real Phase 1 page (only IP/Port
    Scanner does) or shows the demo-mode toast.
13. **Tools → IP / Port Scanner** — 4 target modes, 3 port-setting
    modes, 4 scan options, a simulated scan that progressively "reveals"
    8 realistic LAN hosts with a live progress panel (hosts scanned,
    open ports found, hosts/sec, ETA), a results table, host details
    panel with quick actions (including a working "favorite" toggle),
    Export and Favorites tabs.

## Reusable Components That Power All of the Above

- **`Treemap`** — a hand-written squarified-treemap layout algorithm
  (`components/treemap/treemapLayout.ts`) rendered as absolutely
  positioned tiles, with click-to-select and double-click-to-drill-down,
  paired with a `Breadcrumb` component. Used by Disk Analysis, Folder
  Analysis, and Network Analysis.
- **`DataTable`** — generic table with column sorting (click header),
  **resizable columns** (drag the header edge), row selection, and a
  scroll container; every page's tables are built on it.
- **`DonutChart` / `BarChartPanel` / `LineChartPanel` / `ProgressBar`** —
  themed Recharts wrappers reused across every chart in the app.
- **`useSimulatedProgress`** — the single hook behind every fake
  scan/transfer/sync's Start/Pause/Stop/Resume behavior.

## Mock Data

Centralized under `src/mock/*.ts`, typed against `src/models/*.ts` —
never hardcoded inline in a component. Uses the exact sample data named
in the brief: drives `C:`, `D:\Data`, `E:\Archive`; network locations
`\\NAS\CompanyData`, `\\NAS\Backups`, `\\NAS\Projects`; customers
AMGroup, Cobofisk, Desmet; folder names Clients/Projects/Backups/ISO/
Media/Documents/Tools/Temp/Archive; and the exact IP/Port Scanner device
list from the brief (router, pc-jonas, fileserver, printer,
nas-synology, camera-01, unknown, webserver).

## Rust Backend

Three real Tauri commands (`src-tauri/src/commands/system.rs`):
`get_app_version`, `get_system_info_mock`, `ping_backend` — all return
hand-authored mock values, proving the invoke round-trip works (see the
Help dialog). `commands/disk.rs`, `commands/network.rs`,
`commands/transfer.rs`, `commands/scheduler.rs` and the matching
`models/*.rs` files exist as documented, empty placeholders so later
phases can add real commands without restructuring the crate.

## Safety Guarantee

Phase 1 contains **no** real: delete, move, copy, rename, overwrite,
sync, port scan, raw socket, filesystem modification, scheduled task
creation, shutdown command, PowerShell execution, or Command Prompt
execution. Every button that would normally trigger one of those shows
a toast or dialog instead. This was verified by grepping the Rust crate
for filesystem/process/network APIs (`std::fs`, `std::process`,
`std::net`, `TcpStream`, etc.) - none are used anywhere in
`src-tauri/src`.
