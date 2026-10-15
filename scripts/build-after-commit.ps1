# Optimized build (no installer) after every commit, started by the git
# post-commit hook (scripts/git-hooks/post-commit). The exe goes to
# builds\DataManager Pro.exe - with a desktop shortcut "DataManager Pro
# (latest build)" - so the newest version starts instantly, with no
# compiling. Log: builds\build.log.
#
# - Uses the incremental [profile.quick] (src-tauri/Cargo.toml): only
#   what changed is rebuilt, minutes instead of a full LTO build.
# - If the app is open, the exe can't be replaced: the new one waits in
#   src-tauri\target\quick and is copied as soon as the app is closed.
# - Commits made during a build queue one follow-up build (skipped if
#   HEAD didn't move).
$project = Split-Path -Parent $PSScriptRoot
$builds = Join-Path $project 'builds'
New-Item -ItemType Directory -Force $builds | Out-Null
$lock = Join-Path $builds 'build.lock'
$pending = Join-Path $builds 'build.pending'
$log = Join-Path $builds 'build.log'
$target = Join-Path $builds 'DataManager Pro.exe'

function Write-Log($text) { $text | Out-File $log -Append -Encoding utf8 }

function Ensure-Shortcut {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $link = Join-Path $desktop 'DataManager Pro (latest build).lnk'
    if (Test-Path $link) { return }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $builds
    $shortcut.Description = 'The newest DataManager Pro build (rebuilt after every commit)'
    $shortcut.Save()
}

if (Test-Path $lock) {
    $owner = Get-Process -Id (Get-Content $lock) -ErrorAction SilentlyContinue
    if ($owner) { New-Item -ItemType File -Force $pending | Out-Null; exit }
}
Set-Content $lock $PID
Set-Location -LiteralPath $project
try {
    do {
        Remove-Item $pending -ErrorAction SilentlyContinue
        $built = git rev-parse HEAD
        $commit = git log -1 --format='%h %s'
        "=== $(Get-Date -Format s) building $commit" | Out-File $log -Encoding utf8
        npm run tauri build -- --no-bundle -- --profile quick *>> $log
        if ($LASTEXITCODE -ne 0) {
            Write-Log "=== FAILED $(Get-Date -Format s) (exit $LASTEXITCODE)"
            continue
        }
        $exe = Join-Path $project 'src-tauri\target\quick\datamanager-pro.exe'
        # The running app locks its exe: wait for it to close (a newer
        # commit's build takes over instead).
        $waiting = $false
        while ($true) {
            try {
                Copy-Item $exe $target -Force -ErrorAction Stop
                Set-Content (Join-Path $builds 'BUILD.txt') "$commit`r`nBuilt $(Get-Date -Format s)"
                Write-Log "=== OK $(Get-Date -Format s): builds\DataManager Pro.exe ($commit)"
                Ensure-Shortcut
                break
            } catch {
                if (-not $waiting) {
                    Write-Log "=== Built; waiting for DataManager Pro to close to replace the exe..."
                    $waiting = $true
                }
                if (Test-Path $pending) { break }
                Start-Sleep -Seconds 15
            }
        }
    } while ((Test-Path $pending) -and ((git rev-parse HEAD) -ne $built))
} finally {
    Remove-Item $lock -ErrorAction SilentlyContinue
}
