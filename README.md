# DataManager Pro

**Analyze. Migrate. Manage. Your Data.**

A Windows desktop application combining disk/folder/network analysis
(WizTree/TreeSize-style), file comparison, duplicate finding,
SyncBack-style copy/move/sync, network & port scanning, scheduling,
reporting and administration utilities into a single professional,
dark-mode admin tool.

> **Current Phase: Phase 2 — Real, Read-Only Filesystem Layer.** Volume
> enumeration, folder/file browsing, path validation and non-recursive
> folder/file metadata are now backed by real Rust/Win32 code — no mock
> data for those. Everything else (the high-speed recursive scanner,
> file copy/move/sync/delete, duplicate detection, network share
> discovery, port scanning, scheduler execution) is still mock/simulated.
> See [PHASE1.md](./PHASE1.md) and [PHASE2.md](./PHASE2.md) for exactly
> what's built and [ROADMAP.md](./ROADMAP.md) for what comes next.

## Requirements

- **Windows 10 or 11** (the target platform; the app also builds fine on
  other desktop OSes since Tauri is cross-platform, but Phase 1's design
  assumes Windows conventions)
- **Node.js** 20+ and npm
- **Rust** (stable toolchain, via [rustup](https://rustup.rs))
- **Microsoft C++ Build Tools** (the MSVC linker Rust needs on Windows) —
  install via `winget install Microsoft.VisualStudio.2022.BuildTools`
  with the "Desktop development with C++" workload, or Visual Studio
  with the same workload
- **WebView2 runtime** — preinstalled on Windows 11 and modern Windows 10;
  Tauri will prompt to install it otherwise

## Tech Stack

- **Rust** backend via **Tauri 2**
- **React 19 + TypeScript** frontend, bundled with **Vite**
- **Tailwind CSS v4** (CSS-first theming, see `src/styles/index.css`)
- **Recharts** for donut/bar/line charts
- **Lucide** icons
- **Zustand** for global UI/settings/scheduler state
- **React Router** (`HashRouter`) for in-app page navigation

See [Design Decisions](#design-decisions) below for why this stack was
chosen over egui/Slint/Dioxus/Iced.

## Development Setup

```bash
# 1. Install frontend dependencies
npm install

# 2. Make sure the Rust toolchain + MSVC Build Tools are installed
rustc --version
cargo --version
```

## How to Run

```bash
# Runs the Vite dev server + launches the Tauri window with hot reload
npm run tauri dev
```

Frontend-only checks, if you want to iterate on the UI in a browser tab
without the Tauri window (some Tauri-only bits like the backend ping in
Help will show "Unavailable"):

```bash
npm run dev
```

## How to Build

```bash
# Type-check, lint, and build a production Tauri installer/binary
npm run typecheck
npm run lint
npm run tauri build
```

`npm run tauri build` produces a Windows installer (`.msi`/`.exe`) under
`src-tauri/target/release/bundle/`.

## Current Phase

**Phase 1 — Complete** (UI only, see [PHASE1.md](./PHASE1.md)).
**Phase 2 — Complete** (real, read-only filesystem layer, see
[PHASE2.md](./PHASE2.md)): real volume enumeration, real folder/file
browsing and metadata, real path validation, and a native folder-picker
dialog wired into every "Browse..." button, with a hard guarantee that
nothing in the Rust crate can delete, move, copy, rename, or otherwise
write to the filesystem.

## Architecture Overview

```
src/
  components/       Reusable UI building blocks (see below)
  pages/            One folder per sidebar page, each a self-contained
                     page component composed from src/components
  mock/             Typed mock-data modules (one per feature area)
  models/           Shared TypeScript types/interfaces for that data,
                     including `backend.ts` (mirrors the Rust models)
  api/              Typed `invoke()` wrappers: `backend.ts` (filesystem/
                     storage/system commands) and `dialog.ts` (native
                     folder/file picker)
  state/            Zustand stores (settings, toasts/dialogs, scheduler,
                     and `filesystemStore` for the real backend)
  hooks/             Reusable hooks (fake progress simulator, element size,
                     backend status)
  utils/            Formatting, color palette, filesystem-tree helpers
  styles/           Tailwind v4 theme tokens (index.css)

src-tauri/
  src/
    main.rs         Entry point
    lib.rs          Registers all Tauri commands, the dialog plugin,
                     and `tracing` logging
    commands/       Tauri commands, grouped by feature area: `system`
                     (real), `filesystem` and `storage` (real, Phase 2),
                     `network`/`transfer`/`scheduler` (still documented,
                     empty placeholders reserved for later phases)
    models/         Rust-side data shapes (mirrors `src/models`),
                     including `errors.rs` (`AppError`), `storage.rs`
                     and `filesystem.rs`
    services/       Business logic behind the commands: `path_service`,
                     `filesystem_service`, `storage_service` (all
                     read-only, non-recursive)
    platform/       Windows-specific Win32 FFI (`windows.rs`) behind a
                     `platform::current` abstraction, with a
                     non-Windows `fallback.rs`
    utils/          Path normalization, byte-size formatting, and
                     UTC-ISO8601 timestamp helpers shared by services
```

### Component layers (`src/components/`)

- `app-shell/` — the persistent shell (`AppShell`) and the sidebar nav
  config shared by the sidebar and toolbar
- `sidebar/`, `toolbar/`, `status-bar/` — the three chrome regions
- `cards/` — `Card`, `StatCard`, `ToolCard`, `FolderDetailsCard`
- `tables/` — `DataTable` (generic, sortable, resizable-column,
  selectable rows) and `Pagination`
- `treemap/` — a from-scratch squarified treemap layout algorithm
  (`treemapLayout.ts`) plus the `Treemap` and `Breadcrumb` components,
  used by Disk Analysis, Folder Analysis and Network Analysis
- `charts/` — `DonutChart`, `BarChartPanel`, `LineChartPanel`,
  `ProgressBar` (thin Recharts wrappers themed to match the app)
- `dialogs/` — the generic `Dialog` primitive plus `SettingsDialog`,
  `HelpDialog`, `PlaceholderDialog`
- `controls/` — `Button`, `Checkbox`, `RadioGroup`, `Select`, `TextInput`,
  `Toggle`, `Tabs`, `Badge`, `LocationPicker`, `HighlightText`
- `toast/` — `ToastHost`, driven by `state/toastStore.ts`
- `layout/` — `PageHeader`
- `filesystem/` — real-backend UI pieces added in Phase 2:
  `PathBreadcrumb` (clickable path segments), `VolumeSelector` (real
  drive chips with live capacity), `DirectoryTree` (lazy-loading real
  folder tree, fetches one level at a time)

### State management (`src/state/`)

Kept deliberately simple (per the Phase 1 brief, no Redux):

- `filesystemStore` — real backend state for the single-location pages
  (Disk Analysis, Folder Analysis): volumes, current path, directory
  listing/summary, loading/error state. Pages needing two simultaneous
  locations (Comparison, Data Transfer, Sync) call `api/backend.ts`
  directly instead
- `settingsStore` — the Settings dialog's `AppSettings`
- `uiStore` — toolbar dialog open/close flags, status bar text/memory,
  and the generic placeholder-dialog content
- `toastStore` — the toast queue, plus fire-and-forget helpers
  (`toast.success(...)`, `toast.demo()`, `toast.demoNoFilesModified()`)
  usable from anywhere, including outside React components
- `schedulerStore` — the mock scheduled-task list, shared between the
  Scheduler page and (eventually) the Overview dashboard

Everything else - selected treemap node, active tab, in-progress fake
scan/transfer state - is local `useState` inside the page that owns it,
since it doesn't need to be shared across pages.

### Fake scans & transfers

`src/hooks/useSimulatedProgress.ts` is a single reusable hook that ticks
a 0→100 progress value over a configurable duration using
`setInterval`, with pause/resume/stop support. Every "Start Scan" /
"Start Transfer" / "Start Sync" button in the app uses this same hook;
none of it touches the filesystem, network, or OS.

## Planned Future Backend Integration

Phase 2 delivered real, read-only volume enumeration and folder/file
browsing. What's still ahead, without restructuring the existing
module layout (`commands/`, `models/`, `services/`, `platform/`,
`utils/`): a fast recursive scanning engine (Phase 3), a real
analysis/treemap engine (Phase 4), search/comparison/duplicate engines
(Phase 5), a journaled copy/move engine (Phase 6), an incremental sync
engine (Phase 7), network share + port scanning (Phase 8), a real
scheduler + reporting (Phase 9), and installer/production hardening
(Phase 10). See [ROADMAP.md](./ROADMAP.md) for details.

## Design Decisions

- **Tauri 2 + React/TypeScript**, not egui/Slint/Dioxus/Iced: this app's
  UI is dominated by dense data tables, multiple simultaneous charts, a
  custom treemap, many tabs/dialogs and forms across 13 pages. That's
  squarely a DOM/CSS strength (flex/grid layout, text truncation,
  scroll containers, hover states) that Rust-native immediate-mode or
  retained-mode UI frameworks make significantly more code to achieve.
  Tauri keeps the backend in real Rust (important for the fast
  scanning/copy engines in later phases) while giving the UI layer
  access to the mature web ecosystem (Recharts, Tailwind, React Router).
- **Tailwind v4 CSS-first theming** instead of a JS config file — all
  design tokens live as CSS custom properties in `src/styles/index.css`,
  making the whole palette a one-file edit.
- **`HashRouter`** instead of `BrowserRouter` — Tauri serves the built
  app from a single `index.html`; hash-based routes avoid any deep-link
  path resolution issues in the production webview.
- **A hand-rolled squarified treemap** rather than a chart library's
  treemap, so drill-down, breadcrumbs and selection state integrate
  cleanly with the rest of the app's state model.
- **No Redux** — Zustand covers the handful of things that need to be
  global (settings, toasts, scheduler tasks); everything else is local
  component state, per the brief's "don't over-engineer" guidance.

## Known Limitations (Phase 2)

- Volume enumeration, folder/file browsing, path validation and
  non-recursive folder/file metadata are real. Everything analytical
  layered on top of a selected path (treemaps, charts, top-files/types,
  duplicates, timelines) is still mock data, clearly marked with a
  "Demo Visualization" badge.
- No recursive scanning: `get_directory_summary` and `DirectoryTree`
  only ever look at one directory level at a time; there is no
  aggregate real size for a folder tree yet (that's Phase 3).
- Data Transfer and Sync accept real source/destination paths and
  validate them for real, but clicking "Start" only ever runs the
  existing simulated progress animation — a "Phase 2 Read-Only Mode"
  toast says so explicitly, and nothing is copied, moved, or written.
- Network Analysis's UNC path field is validated with the same
  real, read-only `validate_path` command, but there is no SMB share
  discovery or LAN enumeration — the mock share/host data is unchanged.
- The bottom status bar's "Memory" value is a cosmetically animated
  number, not real process telemetry.
- No data persists between app restarts (Settings, Scheduler edits,
  toggled duplicate selections, etc. all reset on relaunch).

See [PHASE2.md](./PHASE2.md) for the full breakdown of what's real vs.
mock, page by page, plus the Rust test suite and the destructive-API
safety audit.
