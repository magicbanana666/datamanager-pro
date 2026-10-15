# Phase 9 — Scheduler & Reporting

## Scheduler

An **in-app runner** (`commands::scheduler`), not Windows Task
Scheduler - tasks run **only while DataManager Pro is open**, which the
Scheduler page states up front.

- Tasks, settings and run history persist in
  `%APPDATA%\xyz.vanhulle.datamanagerpro\scheduler\tasks.json`.
- Schedules: daily, weekly (a weekday), monthly (a day, clamped to the
  month's last day) or once (a date), at a local time. A time skipped
  by a DST change runs an hour later.
- Every 20 s the runner starts enabled tasks whose next run has come.
  **Sync / Copy / Move / Mirror** go through the Phase 6/7 transfer
  engine headless (`transfer::run_headless`): journaled, resumable from
  Data Transfer if stopped, stoppable from the task's details;
  **Analyze** runs the scan engine and records size, files and folders.
- Runs missed while the app was closed either run once at startup or
  are recorded as missed (setting).
- Options: include subfolders, skip unchanged files (Copy/Move),
  delete at destination (Sync, to the Recycle Bin), verify, "files in
  use don't fail the run" (sharing/lock violations only), keep the full
  log (`logs\<run>.log`, opened from the history).
- History: date, status (success, failed, cancelled, missed), details,
  files, size, duration; the limit is a setting. A finished run toasts
  on whichever page is open.

Commands: `get_scheduler`, `save_scheduled_task`, `delete_scheduled_task`,
`set_task_enabled`, `update_scheduler_settings`, `clear_task_history`,
`run_task_now`. Events: `scheduler-changed`, `scheduler-run-finished`.

## Reports

The frontend builds a report from the **real** results the app holds
(`src/utils/reportBuilder.ts`); the backend renders it
(`services::report_service`):

| Report | Built from |
|---|---|
| Disk / Folder Analysis | The last Disk/Folder Analysis scan, analyzed in full (`analyze_subtree`) |
| Network Analysis | The last Network Analysis scan |
| Duplicate Finder | The last duplicate scan, every duplicate file |
| Folder Comparison | The last comparison's totals and rows |
| File Search | The last search's results |
| Transfer / Sync | The last transfer and sync reports, plus scheduled runs |
| Scheduled Tasks | Every task and the run history |

Formats:
- **HTML** - one self-contained file; charts are CSS bars, so they
  print.
- **PDF** - that HTML printed by Microsoft Edge in headless mode (on
  every Windows 10/11 machine), with a throwaway profile so a running
  Edge is never touched.
- **XLSX** (`rust_xlsxwriter`) - a Summary sheet plus one sheet per
  table/chart, numbers as numbers, header row frozen.
- **CSV** - every section in one file.

Templates set density and how many rows per table HTML/PDF show
(compact 25, professional 100, detailed 1,000); XLSX and CSV always
hold every row. Reports go to `Documents\DataManager Pro Reports`; an
index backs **Recent Reports** (open, save a copy, show folder, delete
to the Recycle Bin). **Preview** renders the HTML in the app.

The Overview tab shows the same live data: the last scan's size, files,
folders, top folders and file types, the duplicate result, files
transferred, scheduled tasks, and data copied by scheduled runs per day.

Commands: `generate_report`, `preview_report`, `list_reports`,
`delete_report`, `export_report`, `reports_folder`.

## Tests

Next-run calculation (daily, weekly, monthly clamping, once, invalid
times), scheduler persistence, in-use error detection, HTML escaping and
sections, CSV quoting, XLSX output, sheet names, and a real PDF printed
by Edge (skipped where Edge isn't installed).
