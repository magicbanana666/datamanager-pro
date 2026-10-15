# Builds the portable edition: the release exe plus the
# DataManagerPro.portable marker (which makes the app keep its data in
# Data\ and Reports\ next to the exe - see src-tauri/src/app_paths.rs),
# zipped as builds\DataManagerPro-<version>-portable.zip.
# Usage: npm run build:portable   (-SkipBuild reuses target\release)
param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $project

if (-not $SkipBuild) {
    npm run tauri build -- --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed ($LASTEXITCODE)" }
}

$version = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
$name = "DataManagerPro-$version-portable"
$stage = Join-Path $project "builds\$name"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

Copy-Item src-tauri\target\release\datamanager-pro.exe (Join-Path $stage 'DataManager Pro.exe')
Set-Content (Join-Path $stage 'DataManagerPro.portable') 'This file makes DataManager Pro portable: its data is kept in the Data and Reports folders next to the exe. Delete it to use %APPDATA% instead.'
Set-Content (Join-Path $stage 'README.txt') @"
DataManager Pro $version - portable edition

Run "DataManager Pro.exe" (it asks for administrator rights, needed for
the fast MFT disk scan). Settings, journals, scheduler and logs are kept
in .\Data, reports in .\Reports. Requires the Microsoft Edge WebView2
runtime, which Windows 10/11 include.
"@

$zip = Join-Path $project "builds\$name.zip"
Remove-Item -Force $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Write-Host "Portable build: $zip"
