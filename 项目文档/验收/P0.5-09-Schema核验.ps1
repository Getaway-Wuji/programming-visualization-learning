param()
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$folder = Join-Path $workspace '.artifacts/P0.5-09'
$contentSchema = Join-Path $workspace '项目文档/契约/P0.5-09-内容结构-1.1.0.schema.json'
$executionSchema = Join-Path $workspace '项目文档/契约/P0.5-09-执行与判题-1.1.0.schema.json'
$content = [IO.File]::ReadAllText((Join-Path $workspace 'content/c/p05/course-1.0.0.json'))
if (-not (Test-Json -Json $content -SchemaFile $contentSchema)) { throw 'New content schema rejected the reviewed draft.' }
$fixture = Get-Content (Join-Path $workspace '项目文档/契约/02.2-正常轨迹样例.json') -Raw | ConvertFrom-Json -DateKind String
$request = $fixture.fixtures[0].request
$request.protocolVersion = '1.1.0'; $request.judgeVersion = '1.1.0'
$request.mode = 'exercise-test'; $request.identity.testCaseKey = 'only'
$request.packageRef = @{ id='content.c.p05'; version='1.0.0' }
$request.programRef = @{ id='program.c.practice-first-output'; version='1.0.0' }
$request.subjectRef = @{ id='exercise.c.first-output'; version='1.0.0' }
$request.learningRevision = 1
$request.source = @{ text="#include <stdio.h>`nint main(void) { printf(`"Hello, C!\n`"); return 0; }`n"; blockMap=@(); bindingMap=@() }
$request.input = @{ specRef=@{id='input.c.first-output';version='1.0.0'}; values=@{}; random=$null }
$request.judge = @{ profileRef=@{id='judge.c.first-output';version='1.0.0'};rule='entry-output';expectedStdout="Hello, C!`n";expectedExitCode=0 }
$cases = @()
foreach ($name in @('valid','mixed-vector','profile-version','extra-input','input-ref','legacy')) {
    $body = ($request | ConvertTo-Json -Depth 100 -Compress) | ConvertFrom-Json -DateKind String
    if ($name -eq 'mixed-vector') { $body.judgeVersion='1.0.0' }
    if ($name -eq 'profile-version') { $body.judge.profileRef.version='9.0.0' }
    if ($name -eq 'extra-input') { $body.input.values=@{x=7} }
    if ($name -eq 'input-ref') { $body.input.specRef.id='input.c.other' }
    if ($name -eq 'legacy') { $body=$fixture.fixtures[1].request }
    $accepted = Test-Json -Json ($body | ConvertTo-Json -Depth 100 -Compress) -SchemaFile $executionSchema -ErrorAction SilentlyContinue
    if ($accepted -ne ($name -eq 'valid')) { throw "Unexpected structural result: $name" }
    $cases += @{ name=$name; accepted=[bool]$accepted }
}
@{ task='P0.5-09'; evidenceLevel='independent-json-schema-structure'; runtimeValidated=$false; contentAccepted=$true; cases=$cases } | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 (Join-Path $folder 'schema-structure-standard.json')
Write-Output 'CONTENT1.1 and six EXEC1.1 structural acceptance/rejection cases passed; this is not execution evidence.'
