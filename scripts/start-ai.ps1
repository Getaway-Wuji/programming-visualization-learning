[CmdletBinding()]
param(
    [ValidateRange(1, 65535)][int]$Port = 4173,
    [string]$Origin = '',
    [string]$BasePath = '/'
)
$ErrorActionPreference = 'Stop'
$workspaceDir = Split-Path -Parent $PSScriptRoot
$gatewayPath = Join-Path $workspaceDir 'server/ai-proxy/target/release/c-viz-ai-proxy.exe'
$staticPath = Join-Path $workspaceDir 'web/dist'
if (-not (Test-Path -LiteralPath $gatewayPath) -or -not (Test-Path -LiteralPath (Join-Path $staticPath 'ai-gateway-policy.json'))) {
    throw 'Build the product and AI gateway first. This launcher does not download a model or request a Key.'
}
if ($Origin -eq '') { $Origin = "http://127.0.0.1:$Port" }
& $gatewayPath --port $Port --origin $Origin --base $BasePath --static $staticPath
exit $LASTEXITCODE
