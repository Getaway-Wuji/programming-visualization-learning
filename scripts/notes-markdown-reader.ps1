param([Parameter(Mandatory = $true)][string]$Folder)
$ErrorActionPreference = 'Stop'
$noteFolder = (Resolve-Path -LiteralPath $Folder).Path
$noteFile = Join-Path $noteFolder '笔记.md'
$noteHtml = ConvertFrom-Markdown -LiteralPath $noteFile
$notePage = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>笔记阅读检查</title><body>' + $noteHtml.Html + '</body></html>'
[System.IO.File]::WriteAllText((Join-Path $noteFolder 'reader.html'), $notePage, [System.Text.UTF8Encoding]::new($false))
