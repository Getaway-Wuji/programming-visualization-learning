[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)] [string[]]$ViteArgs
)
$ErrorActionPreference = 'Stop'
$workspaceDir = Split-Path -Parent $PSScriptRoot
$nodeDir = Join-Path $workspaceDir '.tools/node-v24.21.0-win-x64'
$nodePath = Join-Path $nodeDir 'node.exe'
$vitePath = Join-Path $workspaceDir 'node_modules/vite/bin/vite.js'
if (-not (Test-Path -LiteralPath $nodePath)) {
    throw 'Missing project Node 24.21.0. Follow the first-time setup steps in README.md.'
}
if (-not (Test-Path -LiteralPath $vitePath)) {
    throw 'Missing Vite dependencies. Follow the ci installation step in README.md.'
}
$env:PATH = "$nodeDir;$env:PATH"
Push-Location $workspaceDir
try {
    & $nodePath $vitePath --config (Join-Path $workspaceDir 'vite.config.ts') --host 127.0.0.1 @ViteArgs
    $devExitCode = $LASTEXITCODE
} finally { Pop-Location }
exit $devExitCode
