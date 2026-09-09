# DataManager Pro

**Analyze. Migrate. Manage. Your Data.**

A Windows desktop application combining disk/folder/network analysis
(WizTree/TreeSize-style), file comparison, duplicate finding,
SyncBack-style copy/move/sync, network & port scanning, scheduling,
reporting and administration utilities into a single professional,
dark-mode admin tool.

> **Current Phase: Phase 1 — UI Only.** Every screen in this build is fully
> interactive but runs entirely on realistic mock/demo data. No disk
> scanning, network scanning, file copying, synchronization, deletion,
> scheduling, filesystem modification, or port scanning is implemented yet.
> See [PHASE1.md](./PHASE1.md) for exactly what's built and
> [ROADMAP.md](./ROADMAP.md) for what comes next.

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

**Phase 1 — UI Only.** See [PHASE1.md](./PHASE1.md) for the full list of
implemented pages/components and the explicit "no real backend
operations" guarantee.

## Architecture Overview

```
src/
  components/       Reusable UI building blocks (see below)
  pages/            One folder per sidebar page, each a self-contained
                     page component composed from src/components
  mock/             Typed mock-data modules (one per feature area)
  models/           Shared TypeScript types/interfaces for that data
  state/            Zustand stores (settings, toasts/dialogs, scheduler)
  hooks/             Reusable hooks (fake progress simulator, element size,
                     backend status)
  utils/            Formatting, color palette, filesystem-tree helpers
  styles/           Tailwind v4 theme tokens (index.css)

src-tauri/
  src/
    main.rs         Entry point
    lib.rs          Registers the Phase 1 diagnostic commands
    commands/       Tauri commands, grouped by feature area (only
                     `system` has real commands in Phase 1; disk/
                     network/transfer/scheduler are documented, empty
                     placeholders reserved for later phases)
    models/         Rust-side data shapes (mirrors `src/models`)
    services/       Business-logic layer placeholder for later phases
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

### State management (`src/state/`)

Kept deliberately simple (per the Phase 1 brief, no Redux):

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

Phase 1's Rust crate already has the module layout (`commands/`,
`models/`, `services/`, split by feature area) that later phases will
fill in without restructuring: real drive/folder enumeration (Phase 2),
a fast scanning engine (Phase 3), a real analysis/treemap engine (Phase
4), search/comparison/duplicate engines (Phase 5), a journaled copy/move
engine (Phase 6), an incremental sync engine (Phase 7), network share +
port scanning (Phase 8), a real scheduler + reporting (Phase 9), and
installer/production hardening (Phase 10). See
[ROADMAP.md](./ROADMAP.md) for details.

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

## Known Limitations (Phase 1)

- All data is mock data; nothing here reflects real drives, files, or
  network hosts.
- "Browse..." buttons, most toolbar actions, and most secondary buttons
  intentionally just show a "Phase 1 Demo Mode" toast/dialog instead of
  opening a real file/folder picker.
- The bottom status bar's "Memory" value is a cosmetically animated
  number, not real process telemetry.
- No data persists between app restarts (Settings, Scheduler edits,
  toggled duplicate selections, etc. all reset on relaunch).
