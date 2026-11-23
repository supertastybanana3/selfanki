@echo off
rem Read the Windows UI language before switching the console to UTF-8 (PowerShell falls back to en-US under code page 65001)
set SA_OSLANG=
if not defined SELFANKI_LANG for /f "usebackq delims=" %%L in (`powershell -NoProfile -NonInteractive -Command "[Globalization.CultureInfo]::CurrentUICulture.Name" 2^>nul`) do set SA_OSLANG=%%L
chcp 65001 >nul
set PYTHONUTF8=1
rem Windows: はじめての設定と、そのあとの操作（このファイルをダブルクリック）
cd /d "%~dp0"
rem 文言の言語: 環境変数 SELFANKI_LANG → config.json の language → Windows の表示言語（tools/common.py と同じ順）
set JA=
set UILANG=%SELFANKI_LANG%
if not defined UILANG if exist config.json (
  findstr /r /c:"language. *: *.[A-Za-z]" config.json >nul 2>nul && set UILANG=other
  findstr /r /c:"language. *: *.ja" config.json >nul 2>nul && set UILANG=ja
)
if not defined UILANG set UILANG=%SA_OSLANG%
if not defined UILANG set UILANG=en
if /i "%UILANG:~0,2%"=="ja" set JA=1
set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY where python >nul 2>nul && set PY=python
if not defined PY (
  if defined JA (echo Python が見つかりません。README の「手順 1」で Python を入れてから、もう一度ダブルクリックしてください。) else (echo Python was not found. Install Python as in README "Step 1", then double-click this file again.)
  pause
  exit /b 1
)
where npx >nul 2>nul
if errorlevel 1 (
  if defined JA (echo Node.js が見つかりません。README の「手順 1」で Node.js LTS を入れてから、もう一度ダブルクリックしてください。) else (echo Node.js was not found. Install Node.js LTS as in README "Step 1", then double-click this file again.)
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  if defined JA (echo 仮想環境を作っています...) else (echo Creating the virtual environment...)
  %PY% -m venv .venv
  if errorlevel 1 (
    if defined JA (echo 仮想環境を作れませんでした。上のエラーを読んでください。) else (echo Could not create the virtual environment. Read the error above.)
    pause
    exit /b 1
  )
)
".venv\Scripts\python.exe" -c "from anki.buildinfo import version" >nul 2>nul
if errorlevel 1 (
  if defined JA (echo anki を入れています。数分かかります...) else (echo Installing anki. This takes a few minutes...)
  ".venv\Scripts\python.exe" -m pip install anki==25.9.4
  if errorlevel 1 (
    if defined JA (echo anki を入れられませんでした。上のエラーを読んでください。) else (echo Could not install anki. Read the error above.)
    pause
    exit /b 1
  )
)
".venv\Scripts\python.exe" tools\setup.py %*
pause
