# Copy benchmark: DataManager Pro's engine (buffered and direct I/O)
# against Explorer's copy engine and robocopy, on cold (uncached) data -
# see src-tauri/src/services/copy_bench.rs. Writes about 45 GB in total
# to the chosen folder's disk (4 x 1 GB + 2000 small files, five times).
#
# Usage: npm run bench:copy                  (uses %TEMP%\dmp-bench)
#        npm run bench:copy -- -Dir D:\bench  (another disk)
param([string]$Dir)
$project = Split-Path -Parent $PSScriptRoot
if ($Dir) { $env:DMP_BENCH_DIR = $Dir }
Set-Location -LiteralPath (Join-Path $project 'src-tauri')
cargo test --profile quick --lib -- --ignored copy_bench --nocapture
