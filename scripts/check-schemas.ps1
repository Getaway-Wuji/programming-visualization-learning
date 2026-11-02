param()
$ErrorActionPreference = 'Stop'
$contracts = Join-Path (Split-Path -Parent $PSScriptRoot) 'shared/contracts'
$contentSchema = Join-Path $contracts '02.1-内容结构.schema.json'
$executionSchema = Join-Path $contracts '02.2-执行与轨迹.schema.json'
$saveSchema = Join-Path $contracts '02.3-存档结构.schema.json'
$count = 0
function Assert-Structure($body, $schema, $label) {
    $json = $body | ConvertTo-Json -Depth 100 -Compress
    if (-not (Test-Json -Json $json -SchemaFile $schema -ErrorAction Stop)) { throw "Schema failed: $label" }
}
# Keep ISO timestamps as strings; this is document QA, not a storage adapter.
$content = Get-Content -LiteralPath (Join-Path $contracts '02.1-内容样例.json') -Raw | ConvertFrom-Json -DateKind String
Assert-Structure $content $contentSchema 'content'
$count++
foreach ($name in @('02.2-正常轨迹样例.json', '02.2-失败与超限轨迹样例.json')) {
    $data = Get-Content -LiteralPath (Join-Path $contracts $name) -Raw | ConvertFrom-Json -DateKind String
    foreach ($fixture in $data.fixtures) {
        Assert-Structure $fixture.request $executionSchema "$($fixture.id):request"
        Assert-Structure $fixture.result $executionSchema "$($fixture.id):result"
        $count += 2
    }
}
$saves = Get-Content -LiteralPath (Join-Path $contracts '02.3-存档样例.json') -Raw | ConvertFrom-Json -DateKind String
foreach ($sample in $saves.snapshots) {
    Assert-Structure $sample.snapshot $saveSchema $sample.id
    $count++
}
if ($count -ne 27) { throw "Unexpected body count: $count" }
[ordered]@{ SchemaBodiesPassed = $count; EvidenceLevel = 'document-model'; Limitation = 'JSON structure only; no Rust, browser or persistence verification.' } | ConvertTo-Json
