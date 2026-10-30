param([string]$Label='14-4-candidate-final',[string]$Evidence='schema-final')
$ErrorActionPreference='Stop'
$workspaceDir=Split-Path -Parent $PSScriptRoot
$schema=Join-Path $workspaceDir '项目文档/契约/14.4-内存关卡.schema.json'
$oldSchema=Join-Path $workspaceDir '项目文档/契约/12.2-内存执行.schema.json'
$folder=Join-Path $workspaceDir ".artifacts/14.4/browser/$Label"
$outputPath=Join-Path $workspaceDir ".artifacts/14.4/$Evidence.json"
if(Test-Path -LiteralPath $outputPath){throw 'Use a fresh evidence label.'}
$registry=Get-Content -LiteralPath (Join-Path $workspaceDir 'content/cpp/bugs/questions-1.0.0.json') -Raw | ConvertFrom-Json -DateKind String
$positive=0;$negative=0;$firstRequest=$null;$firstResult=$null
foreach($q in $registry.questions){
 $path=Join-Path $folder "$($q.exerciseRef.id).json"
 $proof=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -DateKind String
 foreach($capture in $proof.captures){
  $compressed=[IO.MemoryStream]::new([IO.File]::ReadAllBytes((Join-Path $folder $capture.raw.file)))
  $decoded=[IO.MemoryStream]::new()
  $gzip=[IO.Compression.GZipStream]::new($compressed,[IO.Compression.CompressionMode]::Decompress)
  try{$gzip.CopyTo($decoded);$raw=$decoded.ToArray()}finally{$gzip.Dispose();$decoded.Dispose();$compressed.Dispose()}
  $sha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($raw)).ToLowerInvariant()
  if($sha -ne $capture.raw.sha256 -or $raw.Length -ne $capture.raw.bytes){throw 'Raw native result changed.'}
  $body=[Text.UTF8Encoding]::new($false,$true).GetString($raw)
  $request=$capture.request | ConvertTo-Json -Depth 100 -Compress
  if(-not(Test-Json -Json $body -SchemaFile $schema -ErrorAction Stop)){throw 'Actual result failed schema.'}
  if(-not(Test-Json -Json $request -SchemaFile $schema -ErrorAction Stop)){throw 'Actual request failed schema.'}
  $positive+=2
  if($null -eq $firstResult){$firstResult=$body;$firstRequest=$request}
 }
}
function Reject($body,$schemaFile){if(Test-Json -Json $body -SchemaFile $schemaFile -ErrorAction SilentlyContinue){throw 'Invalid or incompatible body was accepted.'};$script:negative++}
Reject $firstRequest $oldSchema
Reject $firstResult $oldSchema
$request=$firstRequest | ConvertFrom-Json -DateKind String
$request.PSObject.Properties.Remove('bug')
if(-not(Test-Json -Json ($request|ConvertTo-Json -Depth 100 -Compress) -SchemaFile $oldSchema)){throw 'Old request shape no longer works.'};$positive++
$result=$firstResult | ConvertFrom-Json -DateKind String
$result.PSObject.Properties.Remove('bugJudgement')
if(-not(Test-Json -Json ($result|ConvertTo-Json -Depth 100 -Compress) -SchemaFile $oldSchema)){throw 'Old result shape no longer works.'};$positive++
$request=$firstRequest | ConvertFrom-Json -DateKind String
$request.bug.exerciseId='exercise.cpp.foreign'
Reject ($request|ConvertTo-Json -Depth 100 -Compress) $schema
$request=$firstRequest | ConvertFrom-Json -DateKind String
$request.bug | Add-Member -NotePropertyName extra -NotePropertyValue $true
Reject ($request|ConvertTo-Json -Depth 100 -Compress) $schema
$result=$firstResult | ConvertFrom-Json -DateKind String
$result.bugJudgement.status='met'
Reject ($result|ConvertTo-Json -Depth 100 -Compress) $schema
$result=$firstResult | ConvertFrom-Json -DateKind String
$result.bugJudgement.status='met';foreach($check in $result.bugJudgement.checks){$check.met=$true}
Reject ($result|ConvertTo-Json -Depth 100 -Compress) $schema
if($positive -ne 74 -or $negative -ne 6){throw "Unexpected coverage: $positive/$negative"}
$schemaSha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($schema))).ToLowerInvariant()
$proof=[ordered]@{level='Actual native Rust packets; shape and incompatibility only. Browser full consumer verifies semantics.';label=$Label;schemaSha256=$schemaSha;positive=$positive;negative=$negative;passed=$true}
[IO.File]::WriteAllText($outputPath,($proof|ConvertTo-Json -Depth 20)+"`n")
$proof|ConvertTo-Json
