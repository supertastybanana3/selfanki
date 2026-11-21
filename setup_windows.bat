@echo off
chcp 65001 >nul
set PYTHONUTF8=1
rem Windows: はじめての設定と、そのあとの操作（このファイルをダブルクリック）
cd /d "%~dp0"
set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY where python >nul 2>nul && set PY=python
if not defined PY (
  echo Python が見つかりません。README の「手順 1」で Python を入れてから、もう一度ダブルクリックしてください。
  pause
  exit /b 1
)
where npx >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。README の「手順 1」で Node.js LTS を入れてから、もう一度ダブルクリックしてください。
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo 仮想環境を作っています...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo 仮想環境を作れませんでした。上のエラーを読んでください。
    pause
    exit /b 1
  )
)
".venv\Scripts\python.exe" -c "from anki.buildinfo import version" >nul 2>nul
if errorlevel 1 (
  echo anki を入れています。数分かかります...
  ".venv\Scripts\python.exe" -m pip install anki==25.9.4
  if errorlevel 1 (
    echo anki を入れられませんでした。上のエラーを読んでください。
    pause
    exit /b 1
  )
)
".venv\Scripts\python.exe" tools\setup.py %*
pause
