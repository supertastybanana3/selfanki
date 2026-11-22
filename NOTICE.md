# 由来とライセンス

このリポジトリ全体は GNU Affero General Public License v3.0 以降（AGPL-3.0-or-later）で配る（`LICENSE`）。Anki のソースを JavaScript に書き写した部分と、Anki の画面の組み上がりを含むため、Anki と同じライセンスにしている。

このアプリは Ankitects Pty Ltd（Anki・AnkiMobile の作者）とは関係ない。「Anki」「AnkiMobile」の名前は、挙動の出どころを説明するためだけに使っている。

## 含んでいるもの・書き写したもの

| 場所 | 出どころ | 著作権・ライセンス |
|---|---|---|
| `fsrs/queue.mjs`・`fsrs/sched.mjs`・`fsrs/schedule.mjs`・`app/search.mjs`・`app/ankiweb.mjs` の計算部分 | Anki 25.09.4 の rslib（scheduler・search・stats）を、このリポジトリの作者が 2026 年に JavaScript へ書き写し、手を加えたもの。元のソースは <https://github.com/ankitects/anki>（タグ `25.09.4`） | Copyright Ankitects Pty Ltd and contributors。AGPL-3.0-or-later（`LICENSES/anki-LICENSE.txt`） |
| `ankiweb/_app/` | Anki 25.9.4 の Python パッケージ `aqt` に入っている SvelteKit の組み上がり（`_aqt/data/web/sveltekit/_app`）そのもの。対応するソースは同じリポジトリのタグ `25.09.4` の `ts/` | Copyright Ankitects Pty Ltd and contributors。AGPL-3.0-or-later。組み上がりに含まれるライブラリのライセンスは Anki のリポジトリに従う |
| `ankiweb/js/reviewer.js` | Anki 25.9.4 の Python パッケージ `aqt` に入っている学習画面のスクリプト（`_aqt/data/web/js/reviewer.js`）そのもの。画像穴埋めの表示（`anki.imageOcclusion.setup()`）に使う。対応するソースは同じリポジトリのタグ `25.09.4` の `ts/` | Copyright Ankitects Pty Ltd and contributors。AGPL-3.0-or-later |
| `ankiweb/*/index.html` | 同じく `aqt` の `index.html` に、問い合わせをアプリに回す起動文を足したもの（2026 年） | 同上 |
| `ankiweb/i18n_ja.json`、組み立てのときに作る `i18n_anki.json` | Anki 25.9.4 の翻訳（Python の anki パッケージで書き出したもの） | Anki のライセンスの説明では、翻訳は BSD とパブリックドメインの混在（`LICENSES/anki-LICENSE.txt`） |
| `fsrs/fsrs6.mjs` | Anki が使う FSRS-6 の式（fsrs-rs）を 2026 年に JavaScript へ書き写したもの。<https://github.com/open-spaced-repetition/fsrs-rs> | Copyright (c) 2023, Open Spaced Repetition。BSD-3-Clause（`LICENSES/fsrs-rs-BSD-3-Clause.txt`） |
| `fsrs/rng.mjs` | Rust の `rand` 0.9・`rand_chacha` 0.9・`rand_core` 0.9 の乱数の作り方（ChaCha12、PCG32 による種の広げ方、範囲の取り方）を 2026 年に JavaScript へ書き写したもの。<https://github.com/rust-random/rand> | Copyright Developers of the Rand project / The Rust Project Developers。MIT（`LICENSES/rand-MIT.txt`。元は MIT か Apache-2.0 の選択） |
| `fsrs/optimize.mjs`・`fsrs/simulate.mjs`・`fsrs/memory.mjs`・`app/fsrsjobs.mjs` | fsrs-rs 5.1.0 のパラメータの最適化（dataset・parameter_initialization・training・batch_shuffle・cosine_annealing・parameter_clipper）・評価（inference）・シミュレーター（simulation）と、Anki 25.09.4 の rslib（scheduler/fsrs の params・memory_state・rescheduler・simulator・retention、deckconfig）を、このリポジトリの作者が 2026 年に JavaScript へ書き写し、手を加えたもの | fsrs-rs の部分は Copyright (c) 2023, Open Spaced Repetition。BSD-3-Clause（`LICENSES/fsrs-rs-BSD-3-Clause.txt`）。rslib の部分は Copyright Ankitects Pty Ltd and contributors。AGPL-3.0-or-later |
| `fsrs/optimize.mjs` の Adam（学習の1歩の進め方） | burn 0.17.1（burn-core の optim/adam）の計算の順を写したもの。<https://github.com/tracel-ai/burn> | Copyright (c) 2022 Nathaniel Simard & Burn Framework Contributors。MIT（`LICENSES/burn-MIT.txt`。元は MIT か Apache-2.0 の選択） |
| `fsrs/simulate.mjs` の `PQ`（優先度つきの並び） | priority-queue 2.5.0（<https://github.com/garro95/priority-queue>）のヒープの動き（同じ優先度の並びまで fsrs-rs のシミュレーターと同じにするため） | Copyright Gianmarco Garrisi。MPL-2.0（`LICENSES/priority-queue-MPL-2.0.txt`。元は LGPL-3.0-or-later か MPL-2.0 の選択） |
| `resign/`（自動で入れ直すプログラム） | このリポジトリの作者が作った。部品として isideload 0.5.2（<https://github.com/nab138/isideload>、MIT）・idevice（MIT）・keyring（MIT か Apache-2.0）ほかを使う（`resign/Cargo.lock`）。iloader（<https://github.com/nab138/iloader>、MIT）と同じ部品・同じ設定にしている | 部品はそれぞれのライセンス |
| MathJax 3.2.2 | リポジトリには入れず、`tools/fetch_vendor.py` が npm の公式の置き場から取ってくる | Apache-2.0 |
| `app/pkg.mjs`・`app/exchange.mjs`（.apkg・.colpkg の読み書きと、読み込み・書き出しの決まり） | Anki 25.09.4 の rslib（import_export の gather・package・apkg/import の notes・decks・cards・media、notetype・decks・deckconfig の schema11、media/files のファイル名の直し方）を、このリポジトリの作者が 2026 年に JavaScript へ書き写し、手を加えたもの。protobuf の形は Python の anki 25.9.4 の記述子から取った | Copyright Ankitects Pty Ltd and contributors。AGPL-3.0-or-later（`LICENSES/anki-LICENSE.txt`） |
| sql.js 1.14.2（.apkg・.colpkg の中の SQLite） | リポジトリには入れず、`tools/fetch_vendor.py` が npm の公式の置き場から取ってくる（`sql-wasm-browser.js`・`.wasm`。SQLite はパブリックドメイン） | Copyright (c) 2017 sql.js authors。MIT（取ってきた `cloud/vendor/sqljs/LICENSE`） |
| fzstd 0.1.1（新しい形の .apkg・.colpkg の zstd を開く） | 同上（`esm/index.mjs`） | Copyright (c) 2020 Arjun Barrett。MIT（取ってきた `cloud/vendor/fzstd/LICENSE`） |

## AnkiMobile について

AnkiMobile のプログラム・画像・スクリーンショットは含んでいない。画面の寸法や色は、AnkiMobile 25.09 の画面を実機で測った値を CSS に書いたもの。画面の項目名などの文言は、AnkiMobile 25.09 の日本語の表示に合わせている。
