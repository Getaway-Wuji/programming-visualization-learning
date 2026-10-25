[CmdletBinding()]
param([switch]$SkipBindgen)
$ErrorActionPreference = 'Stop'
$workspaceDir = Split-Path -Parent $PSScriptRoot
$taskToolsDir = Join-Path $workspaceDir '.tools'
New-Item -ItemType Directory -Path $taskToolsDir -Force | Out-Null
$nodeDir = Join-Path $taskToolsDir 'node-v24.21.0-win-x64'
if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) {
    $archivePath = Join-Path $taskToolsDir 'node-v24.21.0-win-x64.zip'
    Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip' -OutFile $archivePath
    $expectedHash = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant() -ne $expectedHash) {
        throw 'Node archive checksum mismatch.'
    }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $taskToolsDir -Force
}
$env:PATH = "$nodeDir;$env:PATH"
& node --version
& npm.cmd --version
if ((& node --version) -ne 'v24.21.0' -or (& npm.cmd --version) -ne '11.19.0') {
    throw 'Node/npm version mismatch.'
}
Push-Location $workspaceDir
try {
    & rustup toolchain install 1.99.0 --profile minimal --component rustfmt --component clippy --target wasm32-unknown-unknown
    if ($LASTEXITCODE -ne 0) { throw 'Rust toolchain setup failed.' }
    if (-not $SkipBindgen) {
        $bindgenRoot = Join-Path $taskToolsDir 'wasm-bindgen'
        $bindgenExe = Join-Path $bindgenRoot 'bin/wasm-bindgen.exe'
        if (-not (Test-Path -LiteralPath $bindgenExe)) {
            $env:CARGO_HTTP_MULTIPLEXING = 'false'
            & cargo +1.99.0 install wasm-bindgen-cli --version 0.2.129 --locked --root $bindgenRoot
            if ($LASTEXITCODE -ne 0) { throw 'wasm-bindgen CLI setup failed.' }
        }
        if ((& $bindgenExe --version) -ne 'wasm-bindgen 0.2.129') { throw 'wasm-bindgen CLI version mismatch.' }
    }
} finally { Pop-Location }
Write-Output 'Tool setup complete. Use scripts/task.ps1 for the fixed Node environment.'
