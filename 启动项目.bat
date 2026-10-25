@echo off
setlocal
chcp 65001 >nul
title 编程可视化教学平台
cd /d "%~dp0"
if errorlevel 1 goto directory_error

if not exist ".tools\node-v24.21.0-win-x64\node.exe" goto environment_error
if not exist "node_modules\vite\bin\vite.js" goto dependencies_error
if not exist "web\src\generated\engine-build.ts" goto build_error
if not exist "web\src\generated\c_viz_wasm.js" goto build_error
if not exist "web\src\generated\c_viz_wasm_bg.wasm" goto build_error
if not exist "web\public\content\sample\" goto build_error

echo 正在检查项目是否已经启动……
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "try { $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; $html = [Text.Encoding]::UTF8.GetString($page.RawContentStream.ToArray()); $title = [regex]::Match([IO.File]::ReadAllText((Join-Path (Get-Location) 'web/index.html'), [Text.Encoding]::UTF8), '<title>.*?</title>').Value; if ($title -and $html.Contains($title) -and $html.Contains('/@vite/client')) { exit 0 } } catch {}; exit 1" >nul 2>&1
if errorlevel 1 goto start_server

echo 项目已在运行，正在打开浏览器。
start "" "http://127.0.0.1:5173/"
exit /b 0

:start_server
echo 正在启动项目，准备好后会自动打开浏览器。
echo 使用期间请保持此窗口打开；关闭窗口或按 Ctrl+C 可停止项目。
echo.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "scripts\task.ps1" dev --open
if errorlevel 1 goto startup_error
exit /b 0

:directory_error
echo 无法进入项目目录，请将本文件保留在项目根目录。
goto failed

:environment_error
echo 缺少项目固定的Node环境，请先按README.md完成首次环境准备。
goto failed

:dependencies_error
echo 缺少项目依赖，请先按README.md执行ci安装步骤。
goto failed

:build_error
echo 缺少Rust或课程生成资源，请先按README.md执行build构建步骤。
goto failed

:startup_error
echo.
echo 启动失败，请查看上方提示。若5173端口被其他程序占用，请先处理占用。

:failed
echo.
pause
exit /b 1
