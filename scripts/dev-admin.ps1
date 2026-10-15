# Starts `npm run tauri dev` in a new, elevated PowerShell window (UAC
# prompt). The app embeds a requireAdministrator manifest (see
# src-tauri/windows-app-manifest.xml), so a dev run from a normal
# terminal builds fine but then fails to launch with "os error 740".
# --no-watch: the project lives in OneDrive, whose syncing touches files
# and made the watcher restart the app mid-scan.
# Usage, from any terminal: npm run dev:admin
$project = Split-Path -Parent $PSScriptRoot
$command = "Set-Location -LiteralPath '$project'; npm run tauri dev -- --no-watch"
Start-Process pwsh -Verb RunAs -ArgumentList '-NoExit', '-Command', $command
