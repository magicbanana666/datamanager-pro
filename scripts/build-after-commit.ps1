# Release build (no installer) after every commit, started by the git
# post-commit hook (scripts/git-hooks/post-commit). The optimized exe is
# copied to builds\DataManager Pro.exe so it starts instantly, without the
# dev compile/vite wait. Log: builds\build.log. Commits made during a
# running build queue one follow-up build (skipped if HEAD didn't move).
$project = Split-Path -Parent $PSScriptRoot
$builds = Join-Path $project 'builds'
New-Item -ItemType Directory -Force $builds | Out-Null
$lock = Join-Path $builds 'build.lock'
$pending = Join-Path $builds 'build.pending'
$log = Join-Path $builds 'build.log'

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
        npm run tauri build -- --no-bundle *>> $log
        if ($LASTEXITCODE -eq 0) {
            $exe = Join-Path $project 'src-tauri\target\release\datamanager-pro.exe'
            try {
                Copy-Item $exe (Join-Path $builds 'DataManager Pro.exe') -Force -ErrorAction Stop
                "=== OK $(Get-Date -Format s): builds\DataManager Pro.exe ($commit)" | Out-File $log -Append -Encoding utf8
            } catch {
                "=== Built, but copy failed (app still open?): $_" | Out-File $log -Append -Encoding utf8
            }
        } else {
            "=== FAILED $(Get-Date -Format s) (exit $LASTEXITCODE)" | Out-File $log -Append -Encoding utf8
        }
    } while ((Test-Path $pending) -and ((git rev-parse HEAD) -ne $built))
} finally {
    Remove-Item $lock -ErrorAction SilentlyContinue
}
