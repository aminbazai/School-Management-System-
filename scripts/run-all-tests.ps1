$ErrorActionPreference = 'Continue'

# `npm` on Windows is a .ps1 shim, which the default execution policy blocks.
# npm.cmd is the same launcher without that restriction.
$npm = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'npm.cmd' } else { 'npm' }

$tests = @('smoke','test:security','test:phase2','test:phase3','test:phase4','test:phase5','test:phase6','test:phase7','test:phase8','test:phase9','test:classes','test:ui','check:routes','check:i18n')
$failed = @()
foreach ($t in $tests) {
  Write-Output ('===== ' + $t + ' =====')
  $out = & $npm run $t 2>&1 | Out-String
  $lines = $out -split "`r?`n" | Where-Object { $_ -match 'PASSED|FAILURES|FAIL  |Error:|exited with' }
  $lines | ForEach-Object { Write-Output $_ }
  if ($out -match 'FAILURES') { $failed += $t }
}
Write-Output ''
if ($failed.Count -gt 0) {
  Write-Output ('SUITES WITH FAILURES: ' + ($failed -join ', '))
  exit 1
}
Write-Output 'ALL SUITES PASSED'
