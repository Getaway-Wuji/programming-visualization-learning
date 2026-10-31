param([string]$Label,[string]$Script,[Parameter(ValueFromRemainingArguments=$true)][string[]]$TaskArguments)
$ErrorActionPreference='Stop'
$taskNode=(Resolve-Path '.tools/node-v24.21.0-win-x64/node.exe').Path
$env:PATH="$(Split-Path $taskNode);$env:PATH"
$env:PLAYWRIGHT_BROWSERS_PATH=(Resolve-Path '.tools/playwright').Path
$env:TASK_EVIDENCE_TASK='16.6'
$target=".artifacts/16.6/$Label"
if(Test-Path "$target.log"){throw 'Use a fresh evidence label'}
& $taskNode $Script @TaskArguments *> "$target.log"
$taskCode=$LASTEXITCODE
$taskCode | Set-Content "$target.exit"
Get-Content "$target.log" -Tail 22
exit $taskCode
