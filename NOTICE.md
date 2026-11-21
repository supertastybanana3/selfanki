# 由来とライセンス

このリポジトリ全体は GNU Affero General Public License v3.0 以降（AGPL-3.0-or-later）で配る（`LICENSE`）。Anki のソースを JavaScript に書き写した部分と、Anki の画面の組み上がりを含むため、Anki と同じライセンスにしている。

このアプリは Ankitects Pty Ltd（Anki・AnkiMobile の作者）とは関係ない。「Anki」「AnkiMobile」の名前は、挙動の出どころを説明するためだけに使っている。

## 含んでいるもの・書き写したもの

| 場所 | 出どころ | 著作権・ライセンス |
|---|---|---|
| `fsrs/queue.mjs`・`fsrs/sched.mjs`・`fsrs/schedule.mjs`・`app/search.mjs`・`app/ankiweb.mjs` の計算部分 | Anki 25.09.4 の rslib（scheduler・search・stats）を、このリポジトリの作者が 2026 年に JavaScript へ書き写し、手を加えたもの。元のソースは <https://github.com/ankitects/anki>（タグ `25.09.4`） | Copyright Ankitects Pty Ltd and contributors。AGPL-3.0-or-later（`LICENSES/anki-LICENSE.txt`） |
| `ankiweb/_app/` | Anki 25.9.4 の Python パッケージ `aqt` に入っている SvelteKit の組み上がり（`_aqt/data/web/sveltekit/_app`）そのもの。対応するソースは同じリポジトリのタグ `25.09.4` の `ts/` | Copyright Ankitects Pty Ltd and contributors。AGPL-3.0-or-later。組み上がりに含まれるライブラリのライセンスは Anki のリポジトリに従う |
| `ankiweb/*/index.html` | 同じく `aqt` の `index.html` に、問い合わせをアプリに回す起動文を足したもの（2026 年） | 同上 |
| `ankiweb/i18n_ja.json`、組み立てのときに作る `i18n_anki.json` | Anki 25.9.4 の翻訳（Python の anki パッケージで書き出したもの） | Anki のライセンスの説明では、翻訳は BSD とパブリックドメインの混在（`LICENSES/anki-LICENSE.txt`） |
| `fsrs/fsrs6.mjs` | Anki が使う FSRS-6 の式（fsrs-rs）を 2026 年に JavaScript へ書き写したもの。<https://github.com/open-spaced-repetition/fsrs-rs> | Copyright (c) 2023, Open Spaced Repetition。BSD-3-Clause（`LICENSES/fsrs-rs-BSD-3-Clause.txt`） |
| `fsrs/rng.mjs` | Rust の `rand` 0.9・`rand_chacha` 0.9・`rand_core` 0.9 の乱数の作り方（ChaCha12、PCG32 による種の広げ方、範囲の取り方）を 2026 年に JavaScript へ書き写したもの。<https://github.com/rust-random/rand> | Copyright Developers of the Rand project / The Rust Project Developers。MIT（`LICENSES/rand-MIT.txt`。元は MIT か Apache-2.0 の選択） |
| `resign/`（自動で入れ直すプログラム） | このリポジトリの作者が作った。部品として isideload 0.5.2（<https://github.com/nab138/isideload>、MIT）・idevice（MIT）・keyring（MIT か Apache-2.0）ほかを使う（`resign/Cargo.lock`）。iloader（<https://github.com/nab138/iloader>、MIT）と同じ部品・同じ設定にしている | 部品はそれぞれのライセンス |
| MathJax 3.2.2 | リポジトリには入れず、`tools/fetch_vendor.py` が npm の公式の置き場から取ってくる | Apache-2.0 |

## AnkiMobile について

AnkiMobile のプログラム・画像・スクリーンショットは含んでいない。画面の寸法や色は、AnkiMobile 25.09 の画面を実機で測った値を CSS に書いたもの。画面の項目名などの文言は、AnkiMobile 25.09 の日本語の表示に合わせている。
