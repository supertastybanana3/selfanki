# AI エージェントへ

このリポジトリで作業する前に `README.md` を最初から最後まで読むこと。特に「AI で作業するときの決まり」の節は必ず守る。

- 手順は README の番号順に進め、各手順の「確認」を実行してから次へ進む
- 合言葉のファイル（`config.json` の `token_file`）は読み取りもしない。中身を表示・出力・コミットしない
- `python` は手順 1 で作った仮想環境の python（Windows は `.venv\Scripts\python`、Mac・Linux は `.venv/bin/python`）で動かす。システムの Python に `pip install` しない
- `config.json`・`cloud/state/`・`cloud/site/`・`cloud/media/`・`*.anki2` をコミットしない
- 人間が決めること（プロジェクト名・移さないデッキ・本家に無い機能を入れるか・Apple ID・ログイン）は、自分で決めずに聞く
- 迷ったら `python tools/doctor.py` を動かし、`[NG]` の行の指示に従う
