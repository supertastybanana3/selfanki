#!/bin/bash
# Mac・Linux: はじめての設定と、そのあとの操作（ターミナルで  bash setup.sh  と打つ）
set -e
cd "$(dirname "$0")"
PY=$(command -v python3.12 || command -v python3 || true)
[ -n "$PY" ] || { echo "Python 3 が見つかりません。README の「手順 1」で入れてください。"; exit 1; }
command -v npx >/dev/null || { echo "Node.js（npx）が見つかりません。README の「手順 1」で入れてください。"; exit 1; }
[ -x .venv/bin/python ] || "$PY" -m venv .venv || { echo "仮想環境を作れませんでした。Ubuntu・Debian なら  sudo apt install python3-venv  をしてから、もう一度動かしてください。"; exit 1; }
.venv/bin/python -c "from anki.buildinfo import version" 2>/dev/null || { echo "anki を入れています。数分かかります..."; .venv/bin/python -m pip install anki==25.9.4; }
exec .venv/bin/python tools/setup.py "$@"
