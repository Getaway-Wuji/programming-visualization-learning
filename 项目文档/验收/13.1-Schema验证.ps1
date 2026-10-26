param()
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskSchema = Get-Content -LiteralPath (Join-Path $taskRoot '项目文档/契约/13.1-双向编辑.schema.json') -Raw | ConvertFrom-Json -Depth 100 -DateKind String
$taskPriorSchema = Get-Content -LiteralPath (Join-Path $taskRoot '项目文档/契约/02.2-执行与轨迹.schema.json') -Raw
$taskRequests = [Console]::In.ReadToEnd() | ConvertFrom-Json -Depth 100 -DateKind String
$taskResults = @()
foreach ($taskRequest in $taskRequests) {
    if ($taskRequest.target -eq 'oldExecution') {
        $taskActiveSchema = $taskPriorSchema
    } else {
        $taskWrapper = [ordered]@{
            '$schema' = $taskSchema.'$schema'
            '$id' = $taskSchema.'$id'
            '$defs' = $taskSchema.'$defs'
            '$ref' = '#/$defs/' + $taskRequest.target
        }
        $taskActiveSchema = $taskWrapper | ConvertTo-Json -Depth 100 -Compress
    }
    $taskBody = $taskRequest.body | ConvertTo-Json -Depth 100 -Compress
    $taskValid = Test-Json -Json $taskBody -Schema $taskActiveSchema -ErrorAction SilentlyContinue
    $taskResults += [ordered]@{ key = $taskRequest.key; valid = [bool]$taskValid }
}
ConvertTo-Json -InputObject @($taskResults) -Depth 5 -Compress
