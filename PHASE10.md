# Phase 10 — Installer, Portable Build, Updates & Hardening

## Installer

`npm run build:installer` (`tauri build`) produces both:

- **NSIS** `.exe` setup (per-machine install - the app requires
  administrator rights anyway) in `src-tauri\target\release\bundle\nsis\`.
- **MSI** in `src-tauri\target\release\bundle\msi\`.

Both install the WebView2 runtime if it's missing (download
bootstrapper). Publisher, copyright and descriptions are set in
`tauri.conf.json`.

## Portable build

`npm run build:portable` writes `builds\DataManagerPro-<version>-portable.zip`:
the exe, a `DataManagerPro.portable` marker and a README. With the
marker next to the exe, the app keeps everything there
(`src-tauri/src/app_paths.rs`): `Data\` (journals, sync state,
scheduler, report index, logs, crash reports) and `Reports\`. Delete
the marker to use `%APPDATA%` / Documents instead. WebView2's own cache
(local storage: settings and saved searches) still lives in
`%LOCALAPPDATA%`.

## Auto-update

`tauri-plugin-updater` checks
`https://github.com/magicbanana666/datamanager-pro/releases/latest/download/latest.json`
at launch (setting "Check for updates on launch"; release builds only)
and on demand (Settings → General → "Check for updates now"). An
available update shows its version and notes; "Install and restart"
downloads, verifies its minisign signature, installs (NSIS, passive)
and relaunches.

- The **public key** is in `tauri.conf.json`. The **private key** was
  generated on the developer machine at `~/.tauri/datamanager-pro.key`
  (no password) and is not in the repository. Keep a backup: without
  it, installed copies can't be updated any more.
- `.github/workflows/release.yml` builds and publishes a release when a
  `v*` tag is pushed: installers, signed updater artifacts,
  `latest.json` (via `tauri.release.conf.json`, which turns on
  `createUpdaterArtifacts` only for releases) and the portable zip. It
  needs the repository secret `TAURI_SIGNING_PRIVATE_KEY` = the contents
  of the private key file.
- To release: bump `version` in `tauri.conf.json` (and `Cargo.toml`,
  `package.json`), commit, `git tag v0.2.0`, `git push origin v0.2.0`.

## Code signing

Not configured - it needs an Authenticode certificate (OV/EV, or Azure
Trusted Signing). Until then Windows SmartScreen warns about the
installer ("unknown publisher"). With a certificate, set
`bundle.windows.certificateThumbprint` (or a `signCommand`) in
`tauri.conf.json` and add the certificate to the release workflow.

## Crash reporting & logs

`src-tauri/src/diagnostics.rs`:

- Every run logs to `logs\datamanager-<time>.log` (the 10 newest are
  kept), besides the console.
- A panic writes `crashes\crash-<time>.txt` (message, location,
  backtrace, version) before the process aborts. The next start shows
  "DataManager Pro closed unexpectedly" with the report and the logs
  folder; each report is offered once.
- Uncaught frontend errors and unhandled promise rejections go to the
  same log, and a page that throws while rendering shows "This page ran
  into a problem" (an error boundary) instead of blanking the window.
- Help → "Open logs folder".

Nothing is sent anywhere - crash reports stay on the machine.

## Hardening

- **Single instance** (`tauri-plugin-single-instance`): a second launch
  focuses the running window. Two instances would run every scheduled
  task twice and share transfer journals.
- **Scan cache capped** at the 4 newest trees - each whole-drive tree is
  hundreds of MB and was kept for the whole session before.
- **Settings persist** across restarts (they were reset on every launch),
  merged over the defaults so new settings get their default.
- **CI** (`.github/workflows/ci.yml`): typecheck, lint, clippy with
  warnings as errors, and `cargo test` on every pull request.

## Tests

Log pruning; the full suite (`cargo test`) and the frontend checks pass.
The installer and portable builds were produced locally.

## No more sample data

Everything that still showed Phase 1 sample data or did nothing is now
real, or removed:

- **Overview**: real drives (used/free), the last scan, duplicates,
  transfers, scheduled tasks; recent scans and transfers from a small
  persisted activity log; the real recent reports.
- **Disk / Folder Analysis, Compare Locations, Duplicate Finder, File
  Search**: start empty (with a hint) instead of sample results and
  fake default paths. The **Users/Owners** tab totals size per NTFS
  owner of the folder in view (`analyze_owners`), on request.
- **Tools**: all 30 tools work except the IP / Port Scanner - Windows'
  own tools, links to the app's pages, or built-in dialogs (properties,
  hashes/checksum verification, split/join, ZIP create/extract,
  shredder, ping, DNS lookup, Wake-on-LAN, disk health, system info,
  script runner, log viewer).
- **Toolbar**: New Scan starts a drive/folder/share scan; Open/Save
  Project read and write a `.dmproj` with every page's locations and
  options.
- **Settings**: every setting applies (scan threads and hidden files,
  file-operation and report defaults, accent colour, log level, launch
  behaviour and remembered locations); settings no engine uses were
  removed.
- **Status bar**: the process's real memory use and the real version.

The IP / Port Scanner page is the only demo left and says so at the top.
