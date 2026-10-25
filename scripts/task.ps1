[CmdletBinding()]
param(
    [Parameter(Position = 0)] [string]$Task = 'check',
    [Parameter(ValueFromRemainingArguments = $true)] [string[]]$TaskArgs
)
$ErrorActionPreference = 'Stop'
$workspaceDir = Split-Path -Parent $PSScriptRoot
$nodeDir = Join-Path $workspaceDir '.tools/node-v24.21.0-win-x64'
if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) {
    throw 'Run pwsh -File scripts/setup.ps1 first.'
}
$env:PATH = "$nodeDir;$(Join-Path $workspaceDir '.tools/wasm-bindgen/bin');$env:PATH"
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $workspaceDir '.tools/playwright'
Push-Location $workspaceDir
try {
    if ($Task -eq 'ci') { & npm.cmd ci @TaskArgs }
    else { & npm.cmd run $Task -- @TaskArgs }
    $taskExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $taskExitCode
