#!/bin/bash
# Mac・Linux: はじめての設定と、そのあとの操作（ターミナルで  bash setup.sh  と打つ）
set -e
cd "$(dirname "$0")"
# 文言の言語: 環境変数 SELFANKI_LANG → config.json の language → LC_ALL・LC_MESSAGES・LANG（Mac は AppleLocale も）（tools/common.py と同じ順）
lang="${SELFANKI_LANG:-}"
[ -n "$lang" ] || lang=$(sed -n 's/.*"language"[[:space:]]*:[[:space:]]*"\([^"<]*\)".*/\1/p' config.json 2>/dev/null | head -n 1)
[ -n "$lang" ] || lang="${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}"
[ -n "$lang" ] || [ "$(uname)" != Darwin ] || lang=$(defaults read -g AppleLocale 2>/dev/null || true)
case "$lang" in ja*|JA*) JA=1 ;; *) JA= ;; esac
msg() { if [ -n "$JA" ]; then echo "$1"; else echo "$2"; fi; }
PY=$(command -v python3.12 || command -v python3 || true)
[ -n "$PY" ] || { msg "Python 3 が見つかりません。README の「手順 1」で入れてください。" "Python 3 was not found. Install it as in README \"Step 1\"."; exit 1; }
command -v npx >/dev/null || { msg "Node.js（npx）が見つかりません。README の「手順 1」で入れてください。" "Node.js (npx) was not found. Install it as in README \"Step 1\"."; exit 1; }
[ -x .venv/bin/python ] || "$PY" -m venv .venv || { msg "仮想環境を作れませんでした。Ubuntu・Debian なら  sudo apt install python3-venv  をしてから、もう一度動かしてください。" "Could not create the virtual environment. On Ubuntu/Debian, run  sudo apt install python3-venv  and try again."; exit 1; }
.venv/bin/python -c "from anki.buildinfo import version" 2>/dev/null || { msg "anki を入れています。数分かかります..." "Installing anki. This takes a few minutes..."; .venv/bin/python -m pip install anki==25.9.4; }
exec .venv/bin/python tools/setup.py "$@"
