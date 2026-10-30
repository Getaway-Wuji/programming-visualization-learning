param([string]$Evidence = '.artifacts/13.4/history-guard-final.json')
$ErrorActionPreference = 'Stop'
$schema = Join-Path (Split-Path -Parent $PSScriptRoot) '契约/13.4-存档结构3.0.0.schema.json'
$report = Get-Content -LiteralPath $Evidence -Raw | ConvertFrom-Json -DateKind String
function Get-Attachments($suites) {
    foreach ($suite in $suites) {
        foreach ($spec in $suite.specs) {
            foreach ($test in $spec.tests) {
                foreach ($result in $test.results) { $result.attachments }
            }
        }
        Get-Attachments $suite.suites
    }
}
$attachment = @(Get-Attachments $report.suites | Where-Object name -eq 'native-count-bytes-isolation')
if ($attachment.Count -ne 1) { throw 'Expected one actual native IndexedDB attachment.' }
$native = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($attachment[0].body)) | ConvertFrom-Json -DateKind String
foreach ($snapshot in @($native.initial, $native.cleared)) {
    if (-not (Test-Json -Json ($snapshot | ConvertTo-Json -Depth 100) -SchemaFile $schema)) { throw 'Actual SAVE3 projection rejected.' }
}
$old = $native.initial | ConvertTo-Json -Depth 100 | ConvertFrom-Json -DateKind String
$old.meta.schemaVersion = '2.0.0'
$old.meta.dbVersion = 2
if (Test-Json -Json ($old | ConvertTo-Json -Depth 100) -SchemaFile $schema -ErrorAction SilentlyContinue) { throw 'SAVE3 accepted old meta.' }
$extra = $native.initial | ConvertTo-Json -Depth 100 | ConvertFrom-Json -DateKind String
$extra | Add-Member -NotePropertyName editHistory -NotePropertyValue @()
if (Test-Json -Json ($extra | ConvertTo-Json -Depth 100) -SchemaFile $schema -ErrorAction SilentlyContinue) { throw 'Projection accepted an undeclared history field.' }
[ordered]@{
    passed = 4
    source = $Evidence
    sourceSha256 = (Get-FileHash -LiteralPath $Evidence -Algorithm SHA256).Hash.ToLowerInvariant()
    schemaSha256 = (Get-FileHash -LiteralPath $schema -Algorithm SHA256).Hash.ToLowerInvariant()
    limitation = 'JSON structure only; native transaction and execution evidence is separate.'
} | ConvertTo-Json
