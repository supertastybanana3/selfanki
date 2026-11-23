# AI エージェントへ

このリポジトリで作業する前に `README.md` を最初から最後まで読むこと。特に「AI で作業するときの決まり」の節は必ず守る。

- 手順は README の番号順に進め、各手順の「確認」を実行してから次へ進む
- 合言葉のファイル（`config.json` の `token_file`）は読み取りもしない。中身を表示・出力・コミットしない
- `python` は手順 1 で作った仮想環境の python（Windows は `.venv\Scripts\python`、Mac・Linux は `.venv/bin/python`）で動かす。システムの Python に `pip install` しない
- `config.json`・`cloud/state/`・`cloud/site/`・`cloud/media/`・`*.anki2` をコミットしない
- 人間が決めること（プロジェクト名・移さないデッキ・本家に無い機能を入れるか・Apple ID・ログイン）は、自分で決めずに聞く
- 迷ったら `python tools/doctor.py` を動かし、`[NG]` の行の指示に従う

# To AI agents

Before working in this repository, read `README.md` (Japanese) or `README.en.md` (English) from start to finish. Always follow the section "Rules for AI agents".

- Follow the README's steps in order, and run each step's "Check" before moving on
- Never read the passphrase file (`token_file` in `config.json`). Never print, output or commit its contents
- Run `python` as the virtual environment's python from Step 1 (Windows `.venv\Scripts\python`, Mac/Linux `.venv/bin/python`). Don't `pip install` into the system Python
- Don't commit `config.json`, `cloud/state/`, `cloud/site/`, `cloud/media/` or `*.anki2`
- Ask the human about things the human decides (project name, decks to exclude, whether to include features the official app doesn't have, Apple ID, logins). Don't decide them yourself
- When unsure, run `python tools/doctor.py` and follow the instruction on each `[NG]` line
