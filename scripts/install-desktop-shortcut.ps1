# Creates (or refreshes) a "Document Graph Explorer" shortcut on the Windows
# desktop that launches the app via run.cmd - the Node-based local server.
# No binary is installed: the shortcut just points back at this repo, so it
# stays valid as the repo updates and never trips SmartScreen/EDR the way an
# unsigned self-built .exe would.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-desktop-shortcut.ps1
#   ...add -Airgap to launch the sealed air-gapped build instead.
#
# Build the app first (npm run build, or npm run build:airgap for -Airgap).
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 as the
# system ANSI codepage, so non-ASCII (em dashes, curly quotes) corrupts it.
param([switch]$Airgap)
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot -Parent
$runCmd = Join-Path $repoRoot 'run.cmd'
if (-not (Test-Path $runCmd)) { throw "run.cmd not found at $runCmd" }

$icon = Join-Path $repoRoot 'packaging\document-graph-explorer.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$name = if ($Airgap) { 'Document Graph Explorer (Air-Gapped)' } else { 'Document Graph Explorer' }
$linkPath = Join-Path $desktop "$name.lnk"

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($linkPath)
$sc.TargetPath = $runCmd
if ($Airgap) { $sc.Arguments = '--airgap' }
$sc.WorkingDirectory = $repoRoot
$sc.Description = 'Document Graph Explorer - local document graph (localhost only)'
if (Test-Path $icon) { $sc.IconLocation = "$icon,0" }
$sc.Save()

$distDir = if ($Airgap) { 'dist-airgap' } else { 'dist' }
$buildCmd = if ($Airgap) { 'npm run build:airgap' } else { 'npm run build' }
$argSuffix = if ($Airgap) { ' --airgap' } else { '' }

Write-Host "Desktop shortcut created:"
Write-Host "  $linkPath"
Write-Host "  -> $runCmd$argSuffix"
if (-not (Test-Path (Join-Path $repoRoot $distDir))) {
  Write-Host ""
  Write-Host "NOTE: the $distDir build folder is not there yet - run '$buildCmd' once before launching."
}
