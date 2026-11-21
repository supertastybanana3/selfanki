# 暗記（selfanki）

AnkiMobile 25.09 の見た目と動きを写した Web アプリ。カードはパソコンの Anki から移し、自分の Cloudflare（無料枠）に置いて、iPad・iPhone・Android・パソコンのブラウザで使う。パソコンの Anki とは、Anki のアドオン（同梱）で同期できる。

- 既定では AnkiMobile 25.09 と同じ動きを目指している。間隔の計算（FSRS をオンにしたときも、オフにしたとき＝SM-2 も。学習ステップ・揺らぎ・負荷分散を含む）、出題の並び（並び順のオプション・兄弟の埋め・上限を含む）、日付の区切り（次の日の開始時刻・タイムゾーン）は Anki 25.09.4 と突き合わせて一致を確認した。同期も本家と同じく「同期」を押したときだけ。統計・デッキのオプション・課題を終えた画面は Anki 本体の画面をそのまま使っている
- まだ写せていない機能は、薄く表示して押せないようにしてある（カードの追加・編集、フィルターデッキなど）
- 本家に無い機能もオプションで入っている。入れるかはインストールのときに選ぶ。選ばなければアプリにも出てこない
  - 書き込み: Apple Pencil でカードの上に直接書く（縦書きのカードにも書ける）。本家の「手書きパッド」とは別のもの。道具の帯などのデザインは各自で作る前提で、作者のデザインは見本として `app/designs/sample/` に置いてある。見本をそのまま使ってもよい（[デザインの作り方](app/designs/README.md)）
  - スクイーズ・ダブルタップ: 書き込みを入れて iPad・iPhone 用の殻（[手順 7](#手順-7-ipadiphone-の殻任意)）も入れると、Apple Pencil Pro のスクイーズとダブルタップが使える（見本では消しゴムと一画戻す）。殻では日本語入力のままでもキーボードのショートカットが効く
  - 自動同期: 答えるたびに数秒後に送り、開いたとき・戻ったときにも同期する
- 画面の言語は Anki にある言語から選べる。Anki 本体の画面は Anki の訳、アプリの文言は Anki の訳があるものはその訳で、無いものは英語になる
- Ankitects（Anki・AnkiMobile の作者）とは関係ない
- 無保証。使ったことでデータが壊れたり消えたり、学習の記録がずれたりしても、作者は責任を負わない。使い始める前と、書き戻し（手順 8）の前には、Anki のバックアップを取っておくこと

| したいこと | 見るところ | このリポジトリ | サイドロード |
|---|---|---|---|
| AnkiMobile を 26.10 より前の見た目に戻したいだけ | [A](#a-ankimobile-を古い版に戻す) | 要らない | 要らない |
| Anki（パソコン版）を古い版に戻したい | [B](#b-anki-パソコン版を古い版に戻す) | 要らない | 要らない |
| AnkiDroid を古い版に戻したい | [C](#c-ankidroid-を古い版に戻す) | 要らない | 要らない |
| このアプリを使いたい | [このアプリを使う](#このアプリを使う) | 要る | 要らない（ブラウザで使える） |
| さらに iPad・iPhone でスクイーズやキーボードのショートカットを使いたい | [手順 7](#手順-7-ipadiphone-の殻任意) | 要る | 要る |

旧 UI に戻したいだけなら、このアプリもサイドロードも要らない。A のとおり AnkiMobile 自体を戻せばよい（A〜C はこの README の最後）。

---

## このアプリを使う

### 仕組み

```
 パソコン（Anki と、このリポジトリの道具）
   │ 1. Anki のコレクションの写しから、カードの表・裏（Anki が描いたもの）・デッキ・設定・記録を書き出す
   │ 2. Cloudflare に上げる（合言葉を持つ端末だけが見られる）
   ▼
 Cloudflare（自分のアカウント・無料枠）
   Pages … アプリとカードの中身
   D1    … 答えの記録
   ▲                                     │
   │ 答える（オフラインでも。「同期」で送る）  │ 3. Anki との同期（任意。アドオン）: 答えを Anki に書き、
   │                                     │    Anki（AnkiMobile など）で解いた分をこちらへ送る
 端末（iPad・iPhone・Android・パソコンのブラウザ、または iOS の殻）
```

Cloudflare に置かれるもの: カードの表・裏、ノートのすべてのフィールド（検索のため）、タグ、デッキ名、ノートタイプの CSS、画像・音声、学習記録。どれも合言葉がないと見られない。端末にも同じものが残る。端末から消すには、そのブラウザでサイトのデータを消す（殻なら殻を消す）。

カードの HTML は、`<script>` と `onerror=` などの属性・`javascript:` の URL を除いて表示する。

できないこと:
- カードの追加・編集・削除。Anki でやってから、もう一度上げる（手順 9）
- テンプレートの JavaScript に頼るカードは動かない（スクリプトは除くため）。ただし、入力して答えるカード（`{{type:…}}`）と画像穴埋めは、Anki と同じに動くようにしてある
- フィルターデッキ（カスタム学習セッションなど）は移さない。中のカードは元のデッキに出る
- AnkiWeb とは直接同期しない。Anki との行き来はパソコンの Anki を通す（手順 8。Anki のアドオンで同期する）
- 「？」ボタン（AI に質問）は別の中継サーバーが要る。このリポジトリには入っていないので、設定しなければボタンは出ない
- 同期していない答えはサーバーにもパソコンの Anki にも届かない。既定では、答えたあとに下の「同期」を押す

### 同期の注意

- 同じカードを、同期しないまま2か所（このアプリの別の端末、Anki、AnkiMobile など）で答えると、カードごとに新しい答えのほうが残り、もう片方の答えの結果は消える（記録の行は両方残る）。新しさは各端末の時計で決まるので、時計がずれていると古いほうが残ることがある
- 答えではない変更（非表示・休止・フラグ、Anki でオプションを変えて計算し直したこと）は、相手の知らない新しい答えを上書きしない。たとえば Anki で答えたカードを、まだ同期していない端末が兄弟として非表示にしても、Anki で答えた期日が残る（その非表示は消える）
- 同期していない答えは、その端末の中にしかない。端末を替える前、ブラウザのデータを消す前には同期する。iPhone・iPad の Safari は、7日ほど使っていないサイトの保存データを消すことがある（ホーム画面に追加したものは対象外）。ホーム画面に追加して使い、こまめに同期する
- ほかの端末で答えた分は、その端末で同期したあと、こちらでも同期すると出てくる
- パソコンの Anki に届くのは、手順 8（Anki との同期）をしたとき。AnkiMobile・AnkiWeb とは、パソコンの Anki を通して行き来する
- 書き戻しのあと、Anki が AnkiWeb との「一方向の同期」（アップロードかダウンロードか）を聞いてきたら、どちらを残すかよく確かめてから選ぶ。まちがえると、書き戻した分か AnkiWeb 側の分が消える
- このアプリで「元に戻す」をした答えのうち、すでに Anki に書き戻した分は Anki からは消えない。デッキごとの上限と全体の設定は Anki に書き戻さない

- 日付の変わり目は、Anki と同じく、コレクションの「次の日の開始時刻」と、いま使っている端末のタイムゾーンで決まる。端末ごとにタイムゾーンが違うと、端末ごとに「今日」の区切りも違う（本家も同じ）

### 要るもの

| もの | 条件 | 確認した組み合わせ |
|---|---|---|
| パソコン | Windows 10/11・Mac・Linux。コマンドを打つ画面（ターミナル）を使う | Windows 11（WSL の Ubuntu と、Windows の Python） |
| Anki（パソコン版） | 移したいカードが入っていること | 25.09.4 の形式のコレクション |
| Python | 3.9 以上。3.12 か 3.14 を勧める | 3.12・3.14 |
| Node.js | 20 以上（LTS） | 22・24 |
| Cloudflare のアカウント | 無料。<https://dash.cloudflare.com/sign-up> | — |
| 手順 7 をするなら | GitHub アカウント、Apple ID、iOS・iPadOS 17.5 以上 | iPadOS 27 |
| 手順 8 をするなら | Anki 25.09 以降（8-A のアドオン）か、AnkiConnect（8-B） | Anki 25.9.4 |

Cloudflare の無料枠（[Pages](https://developers.cloudflare.com/pages/platform/limits/)・[D1](https://developers.cloudflare.com/d1/platform/pricing/)）: 1つのサイトに置けるファイルは 20,000 個まで、1ファイル 25 MiB まで。D1 は1つ 500 MB まで、書き込みは1日 10 万行まで。画像・音声は1つが1ファイルになる。アプリ本体などで数百ファイルを使うので、画像・音声が 19,000 個を超えるなら、使わないデッキを移さないようにする（手順 2 の `exclude_top_decks`）。

### いちばん短い手順

1. 先に Cloudflare の無料アカウントを作り、メールの確認まで済ませておく（<https://dash.cloudflare.com/sign-up>）。Anki は閉じておく
2. [手順 1](#手順-1-python-と-nodejs) のとおり Python と Node.js を入れる
3. このリポジトリを落とす（GitHub の「Code」→「Download ZIP」→ 展開。`C:\selfanki` のように日本語を含まない場所に置くと無難）
4. Windows は `setup_windows.bat` をダブルクリック（「Windows によって PC が保護されました」と出たら「詳細情報」→「実行」）。Mac・Linux はターミナルで展開したフォルダに移り、`bash setup.sh`
5. 聞かれたことに答える
   - Anki のプロファイル（1つなら自動）
   - 置き場の名前（Enter でおまかせ）
   - 移さないデッキ（番号で選ぶ。全部移すなら Enter）
   - 画面の言語
   - 本家に無い機能を入れるか（書き込み: 使わない／見本のデザイン／自分のデザイン、同期: 本家どおり／自動）。迷ったら Enter（本家どおり）
   - Cloudflare へのログイン（ブラウザが開くので、ログインして「Allow」）
6. 最後に表示される URL と6桁の番号を、使いたい端末で入れる（[手順 6](#手順-6-端末をつなぐ)）。作ってすぐは、つながるまで数分かかることがある

途中で止まったら `[止まりました]` の説明のとおりに直して、同じものをもう一度動かす。済んだところは飛ばして続きから進む。ブラウザで使うだけなら、ここで終わり。手順 7〜9 は必要な人だけ。

2回目からは、同じもの（`setup_windows.bat` か `bash setup.sh`）を動かすと、することを選べる: 端末を足す（番号を出す）／Anki で足したり直したりしたカードを上げる／Anki に書き戻す（試し・本番）／点検／Anki のアドオンを作る。

以下は同じことを1つずつ手でやる方法。

### AI で作業するときの決まり

この README を読んで作業する AI は、次を守る。

1. 手順は番号順に進める。各手順の「確認」を実行し、書いてある結果と違えば先へ進まず、[困ったとき](#困ったとき)を見る。そこに無ければ人間に相談する。そのとき出力に含まれる6桁の番号・URL・パスは伏せる
2. 合言葉（`config.json` の `token_file` のファイル）は、読み取りもしない。中身を画面・チャット・ログ・コミット・URL に出さない。端末をつなぐときは `tools/pair_code.py` の番号を使う
3. `python` と書いてあるところは、手順 1 で作った仮想環境の python で動かす（Windows は `.venv\Scripts\python`、Mac・Linux は `.venv/bin/python`）。システムの Python に `pip install` しない
4. `config.json`・`cloud/state/`・`cloud/site/`・`cloud/media/`・`*.anki2` をコミットしない。`git add` の前に `git status` で確かめる
5. 本物の `collection.anki2` を開いたり書き換えたりしない（道具は写しだけを開く）。Anki のデータを消す操作、「Downgrade & Quit」、AnkiWeb との同期は、人間に頼まれたときだけ
6. 人間が決めること: `project_name`、移さないデッキ（`exclude_top_decks`）、言語（`language`）、本家に無い機能を入れるか（`extras`。聞かずに入れない）、Cloudflare・GitHub・Apple ID へのログイン（ブラウザやパスワードの入力は人間）、iPhone・iPad の画面の操作
7. `tools/build_site.py` に `--rebase` を付けない
8. Cloudflare のプロジェクトやデータベースを消さない
9. 手順 8（Anki との同期）は人間が望んだときだけ。先に Anki のバックアップを取り、試し（アドオンの「試す」か `--dry`）の結果を人間に見せてから本番をする
10. 対話の質問に答えられないときは、手順 2 のとおり `config.json` を書いてから各道具を動かす（埋まっていれば `tools/setup.py` は何も聞かない）
11. 迷ったら `python tools/doctor.py` を動かし、`[NG]` の行の `→` に従う

---

### 手順 1: Python と Node.js

- Python: <https://www.python.org/downloads/>。Windows ではインストールの最初の画面で「Add python.exe to PATH」にチェックを入れる
- Node.js: <https://nodejs.org/> の LTS

確認（新しく開いたターミナルで）: `python --version`（Windows は `py --version`）が 3.9 以上、`node --version` が v20 以上。

仮想環境を作って anki を入れる（リポジトリのフォルダで。`setup_windows.bat`・`setup.sh` を使うなら自動でされる）:

| | Windows | Mac・Linux |
|---|---|---|
| 作る | `py -3 -m venv .venv` | `python3 -m venv .venv` |
| anki を入れる | `.venv\Scripts\python -m pip install anki==25.9.4` | `.venv/bin/python -m pip install anki==25.9.4` |

この README の `python` は、この仮想環境の python のこと。Windows は `.venv\Scripts\python`、Mac・Linux は `.venv/bin/python` と読み替える。

確認: `python -c "from anki.buildinfo import version; print(version)"` が `25.09.4` を出す。

### 手順 2: 設定ファイル

`config.example.json` を `config.json` という名前で写して埋める。`python tools/setup.py --config-only` で、質問に答えて作ってもよい。

```json
{
  "project_name": "myanki-7f3a",
  "site_url": "",
  "anki_collection": "C:/Users/名前/AppData/Roaming/Anki2/ユーザー 1/collection.anki2",
  "anki_media_dir": "C:/Users/名前/AppData/Roaming/Anki2/ユーザー 1/collection.media",
  "language": "ja_JP",
  "ankiconnect_url": "http://127.0.0.1:8765",
  "ankiweb_sync": false,
  "exclude_top_decks": [],
  "exclude_underscore_decks": false,
  "token_file": "~/.config/selfanki/token",
  "extras": {
    "pen_design": "",
    "auto_sync": false
  }
}
```

| 項目 | 意味 |
|---|---|
| `project_name` | Cloudflare に作る置き場の名前。英小文字・数字・ハイフンだけで、2〜58文字。両端は英小文字か数字。アプリの住所はふつう `https://<この名前>.pages.dev` になる（同じ名前が使われていると後ろに文字が足される。実際の住所は手順 4 で表示される）。推測されにくい名前にする。例の `myanki-7f3a` はそのまま使わない |
| `site_url` | 空のまま（手順 4 で入る） |
| `anki_collection` | Anki のコレクション。Windows はエクスプローラーのアドレス欄に `%APPDATA%\Anki2` と打って開くフォルダの中、プロファイル名（`ユーザー 1`、`User 1` など）のフォルダにある `collection.anki2`。Mac は `~/Library/Application Support/Anki2/プロファイル名/collection.anki2`、Linux は `~/.local/share/Anki2/プロファイル名/collection.anki2`（[公式の説明](https://docs.ankiweb.net/manual/files)）。WSL から使うときは Windows 側の場所を `/mnt/c/Users/…` で書く。パスの区切りは `/`（`\` なら `\\`） |
| `anki_media_dir` | 同じフォルダの `collection.media`。空にすると、上げるときに Anki を起動して AnkiConnect から取ってくる |
| `language` | 画面の言語。Anki の言語の番号（`ja_JP`・`en_US`・`de_DE`・`zh_CN` など。`tools/setup.py` で一覧から選べる） |
| `ankiconnect_url` | 手順 8 で使う。ふつうはこのまま |
| `ankiweb_sync` | 手順 8 で、書き戻しの前後に Anki を AnkiWeb と同期するか。`true` か `false`（`"false"` と引用符で囲まない） |
| `exclude_top_decks` | 移さない最上位のデッキの名前（`::` の左端）。全部移すなら `[]` |
| `exclude_underscore_decks` | `true` にすると、名前が `_` で始まるデッキを移さない |
| `token_file` | 合言葉を置くファイル。リポジトリの外に置く（既定のままでよい） |
| `extras.pen_design` | 書き込み（本家に無い機能）のデザイン。`""`＝使わない（既定）、`"sample"`＝作者のデザインの見本、自分で作ったものは `app/designs/` の中のフォルダ名（[作り方](app/designs/README.md)） |
| `extras.auto_sync` | `false`＝「同期」を押したときだけ（既定・本家どおり）、`true`＝答えるたびに自動で同期 |
| `cloudflare_account_id` | 書かなくてよい。Cloudflare のアカウントが複数あって選べと言われたときだけ書く |
| `d1_location` | 書かなくてよい。D1 を置く地域の希望（`apac`・`wnam` など）。最初の手順 4 のときだけ効く |
| `lock_command` | 書かなくてよい。書き戻しの前後に `on`・`off` を付けて呼ぶコマンド（配列）。同じ時刻にほかの道具が Anki を触らないようにしたいときに使う |

確認: `python tools/doctor.py` で `config.json`・`Anki のコレクション`・`画像・音声のフォルダ` が `[OK]`。

### 手順 3: MathJax

```
python tools/fetch_vendor.py
```

確認: `入れた: …mathjax 106 ファイル`（2回目からは `もう入っている`）。

### 手順 4: Cloudflare の準備（最初の1回だけ）

1. ログインする。ブラウザが開くので人間がログインして「Allow」を押す
   ```
   npx --yes wrangler@4.165.0 login
   ```
2. 置き場を作る
   ```
   python tools/setup_cloud.py
   ```
   合言葉を作って `token_file` に保存し（表示はしない）、D1 のデータベース・`cloud/wrangler.toml`・表・Pages のプロジェクトを作り、合言葉を Pages の secret `SA_TOKEN` に入れ、`config.json` の `site_url` を埋める

確認: `[1/6]`〜`[6/6]` が出て、最後に `あなたのサイトは https://….pages.dev です`。

同じ名前のデータベースやプロジェクトがすでにあれば、それを使う。別のコレクション用に作ったものと同じ名前にしないこと。

### 手順 5: Anki から移して上げる

1. AnkiWeb を使っているなら先に同期しておく。移しているあいだは Anki で勉強・編集しない（できれば閉じる）
2. 書き出す。本物のコレクションには触らず、`cloud/state/snap/` に写しを取ってから読む
   ```
   python tools/export_anki.py
   ```
   確認: `cards 枚数` と `最上位デッキごと [...]` が出て、`missing(コピーに無い) 0`。0 でなければ、その数の画像・音声が Anki のフォルダに無い（Anki の「ツール」→「メディアをチェック」）
3. 組み立てて上げる（はじめては数分かかる）
   ```
   python tools/build_site.py --deploy
   ```
   確認: `site を組んだ: …`、`Pages に上げた … Deployment complete!`。続けて `python tools/doctor.py` で `合言葉なしでは中身が見えない（401）` と `合言葉ありで manifest が読める（200）` が `[OK]`

作ってから数分は、サイトにつながらないことがある。

### 手順 6: 端末をつなぐ

1. パソコンで番号を出す（15分・1回きり）
   ```
   python tools/pair_code.py
   ```
2. 表示された URL（`…/pair`）を使いたい端末で開いて、6桁の番号を入れる（先頭の 0 も入れる）
   - iPhone・iPad（Safari）: 番号を入れる前に、共有ボタン →「ホーム画面に追加」をして、ホーム画面のアイコンから開いて番号を入れる（ホーム画面のアプリと Safari では保存場所が別になるため）
   - Android（Chrome）: 番号を入れてから、︙ →「ホーム画面に追加」
   - パソコン: そのままブラウザで使える
3. 端末ごとに番号を出し直す。番号を5回まちがえると、出してある番号は全部消える

確認: デッキの一覧が出て、カードに答えられる。答えたあと下の「同期」を押すと、記録がサーバーに届く（その端末で最初に開いたときだけは自動で同期する）。

一度開けば、そのあとはオフラインでも開ける。ただし画像・音声を全部取り終えるまでは、オフラインで出ないものがある。

書き込みや自動同期は、インストールのときに入れたものだけが出る（`config.json` の `extras`）。あとから入れるなら `extras` を直して `python tools/build_site.py --deploy`。入れたものを端末ごとに切るのは「設定」→「このアプリ独自の機能」。

### 手順 7: iPad・iPhone の殻（任意）

ブラウザでも使えるが、iOS では Web ページから次のことができない。これらが要るときだけ、薄いネイティブの殻（Swift。中身は同じ Web アプリ）を入れる。どれも本家に無い機能。

- Apple Pencil Pro のスクイーズ・ダブルタップ（インストールのときに書き込みのデザインを入れたときだけ働く）
- 日本語入力のままでのキーボードのショートカット
- 消音モードのときもカードの音声を鳴らし、ほかのアプリの音楽を止めないこと（ブラウザでも重ねて鳴るようにしてあるが、iOS の Safari では確認していない）

前提: iOS・iPadOS 17.5 以上。自分の Apple ID で署名して入れるので、7日ごとに入れ直す（無料の Apple ID の決まり。同時に入れられるのは3つ、登録できる App ID は7日で10個まで。[Apple の説明](https://developer.apple.com/support/compare-memberships/)）。iOS 16 以降は端末のデベロッパモードをオンにする必要がある。

#### 7-1. IPA を組む（GitHub Actions）

1. GitHub に非公開（Private）のリポジトリを作り、このリポジトリの中身を入れる。フォークすると公開になるので、新しく作る。GitHub CLI（`gh`。<https://cli.github.com/>）なら、リポジトリのフォルダで:
   ```
   git init
   git add .
   git status
   git commit -m "first"
   gh repo create 好きな名前 --private --source=. --push
   ```
   commit の前に、`git status` に `config.json`・`cloud/state` などが入っていないことを確かめる。GitHub の画面にフォルダをドラッグして上げるときは `.gitignore` が効かないので、手元のフォルダではなく、新しく落として展開しただけの ZIP の中身を上げる（`config.json`・`cloud/state`・`cloud/site`・`cloud/media` には自分のカードや設定が入っている）
2. リポジトリの「Settings」→「Secrets and variables」→「Actions」→「Variables」に `APP_HOST` を作る。値は `site_url` から `https://` を除いたもの
   ```
   gh variable set APP_HOST --body "自分のサイトのホスト名"
   ```
   任意で `APP_NAME`（ホーム画面の名前。既定は「暗記」）、`BUNDLE_ID`（既定は `local.selfanki.app`）
3. 「Actions」→「build-ipa」→「Run workflow」で組む（2〜5分）。終わったら、その実行の画面の下にある「SelfAnki-ipa」を落として展開すると `SelfAnki.ipa` が出てくる。`gh` なら:
   ```
   gh workflow run build-ipa.yml
   gh run watch
   gh run download -n SelfAnki-ipa
   ```

合言葉は IPA に入れない。殻を初めて開くと番号の入力画面が出る。

#### 7-2. iloader で入れる

1. [iloader](https://github.com/nab138/iloader/releases)（2.4.2 以上）を入れる。Windows は iTunes（Microsoft Store 版でよい）も入れて、一度起動して使用許諾に同意しておく。Linux は usbmuxd が要る
2. iPhone・iPad を USB でつなぎ、「このコンピュータを信頼」を押す
3. iloader で Apple ID にサインインし、「Import IPA」で `SelfAnki.ipa` を選ぶ
4. iPhone・iPad で:
   - 「設定」→「プライバシーとセキュリティ」→「デベロッパモード」をオン → 再起動 →「オンにする」とパスコード（[Apple の説明](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)）
   - 「設定」→「一般」→「VPN とデバイス管理」→ 自分の Apple ID →「信頼」
5. ホーム画面の「暗記」を開き、手順 6 で出した番号を入れる

7日たって「使用できません」と出たら、iloader で同じ IPA を入れ直して、もう一度「信頼」を押す。これを自動にするのが 7-3。

番号の入力画面は、殻ではまだ試していない（合言葉を組み込んだ版でしか確認していない）。外付けキーボードの数字が入らないときは、画面のキーボードで入れる。

#### 7-3. 7日ごとの入れ直しを自動にする（Windows・任意）

無料の Apple ID の署名は7日で切れる。`resign/` のプログラム（selfanki_resign.exe）を2時間おきに動かしておくと、前に入れ直してから5日たった後の最初の回に、パソコンから iPad・iPhone へ入れ直す。iloader と同じ部品・同じ保存先（同じ署名の鍵）を使う。作者の環境では、同じ Apple ID・同じ端末・同じ IPA で入れ直したとき、「信頼」のやり直しは要らず、端末のデータも残った。

入れ直す端末は、`config.json` の `udid` に書いたもの。書いていなければ、最初に入れ直せた端末を `state.json` に覚えて、以後はその端末だけを入れ直す（別の端末に入れてしまわないように）。端末を替えるときは、`state.json` の `udid` を消すか、`config.json` に書く。

前提:
- 7-2 を iloader で済ませてあり、iloader で Apple ID にログインするとき「Save Credentials」にチェックを入れてある。このプログラムは、iloader が Windows の資格情報マネージャーに保存したパスワード・署名の鍵・「この PC」の登録をそのまま使う。iloader 以外（Sideloadly・AltStore など）で入れた場合は使えない（試していないが、確認コードを求められて止まるか、新しい証明書を作ろうとして無料の Apple ID の上限で止まるはず）
- iPad・iPhone が USB でつながっているか、パソコンと同じ Wi-Fi にいる。Wi-Fi で見えるかどうかは、iTunes（Apple Mobile Device）がその端末を Wi-Fi 越しに見つけるかで決まる。USB を外して下の 3 を動かし（つないだままなら `--check --wifi`）、「Wi-Fi で見えている」と出なければ、USB でつないで iTunes を開き、その端末の「Wi-Fi 経由でこの iPad と同期」をオンにしてから試し直す
- 入れ直しの時刻にパソコンが起きていること（スリープ中は動かない。動けなかった分は次に起きたときに動く）
- Windows 11（作者が確かめたのは Windows 11。タスクは `conhost.exe --headless` で窓を出さずに動かすので、古い Windows 10 では動かないかもしれない）

手順:
1. GitHub の「Actions」→「build-resign」→「Run workflow」で組み、成果物「selfanki_resign-windows」を落として展開する（`selfanki_resign.exe` と `register_task.ps1` が出てくる）。Rust があれば `resign/` で `cargo build --release --locked` でもよい（exe は `resign/target/release/` にできる）
2. 自分が書き込めるフォルダ（たとえば `C:\selfanki_resign`）に、その2つと、7-1 で作った `SelfAnki.ipa` を置く。以下のコマンドはそのフォルダで打つ（PowerShell なら頭に `.\` を付けて `.\selfanki_resign.exe …`）
3. 確かめる（Apple にはつながず、入れ直しもせず、`state.json` も書かない）
   ```
   selfanki_resign.exe --check
   ```
   確認: `確認: 端末は USB（か Wi-Fi）で見えている・パスワードと IPA はある` と出る。端末が2台以上見えていると止まるので、そのとき出る番号から選んで、同じフォルダの `config.json`（最初の1回で作られる）の `udid` に書く
4. 一度だけ今すぐ入れ直して、通ることを確かめる
   ```
   selfanki_resign.exe --force
   ```
   確認: `成功: 入れ直した（USB か Wi-Fi）。次の期限 …`。端末で「暗記」が「信頼」なしで開く。確認コード（2段階認証）を求められて止まったら、`selfanki_resign.exe --force --interactive` で、窓にコードを打つ。入れ直す前に、まだ同期していない答えがあれば同期しておく
5. 2時間おきに動かすタスクを登録する（PowerShell で）
   ```
   powershell -ExecutionPolicy Bypass -File register_task.ps1
   ```
   消すときは `Unregister-ScheduledTask -TaskName SelfAnkiResign`。4 を飛ばして登録すると（`state.json` が無いので）、最初に動いたときにすぐ1回入れ直す。害はない

- 記録は同じフォルダの `resign.log`、状態は `state.json`。止まると Windows の通知で知らせる（端末が見えない・パスワードや IPA が無い・ログインや入れ直しの失敗・`config.json` の書き間違い。同じ種類の知らせは12時間に1回まで。端末が見えない知らせは、期限の30時間前から）
- Apple へのログインや入れ直しで失敗したあとは、3・6・12・24時間とあけて試し直す（ログインを繰り返さないように）。端末が見えない・パスワードが無いときは、Apple にはつながないので、タスクのたび（2時間おき）に見直す
- 確認コードを求められて止まったときは、通知のとおり `selfanki_resign.exe --force --interactive` で入れ直す
- `resign.log` には、Apple ID の一部（`a***@…` のように伏せたもの）、端末が2台以上見えたときの端末の番号（UDID）、ファイルの場所が出る。人に見せるときは、そのまま貼らずに消してから
- Apple がログインのやり方を変えると、ログインで止まる（503 など）。そのときは、iloader の新しい版が Apple に名乗る値に、`config.json` の `anisette_client_info`・`anisette_user_agent` を合わせる（既定は iloader 2.4.2 の値）
- Apple へのログインは iloader・SideStore と同じく非公式なやり方。作者の環境（Windows 11・iPad）で、Wi-Fi だけで入れ直せることは確かめた（このリポジトリに入れる前の版で）。期限の前に自動で入れ直されることと、通知が画面に出ることは、まだ確かめていない
- Mac・Linux 用は無い

#### Mac なら

GitHub Actions も iloader も使わず、Xcode（無料）で直接入れられると思うが、試していない。無料の Apple ID は Personal Team として使える（[Apple の説明](https://developer.apple.com/support/compare-memberships/)）。

1. `ios/SelfAnki.swiftpm/Config.swift` の `example.pages.dev` を、自分のサイトのホスト名にする
2. Xcode で `ios/SelfAnki.swiftpm` を開く
3. 署名で自分の Apple ID（Personal Team）を選ぶ。bundle ID が他人と重なるとエラーになるので、`Package.swift` の `bundleIdentifier` を自分だけの名前に変える
4. Info.plist に `WKAppBoundDomains`（配列）を足して、自分のサイトのホスト名を入れる（GitHub Actions ではここを自動でしている。無いとオフラインで開けない）
5. iPhone・iPad をつないで実行する

この Mac の手順は試していない。Swift Playgrounds のアプリは Xcode で開ける、と Apple は書いている（[説明](https://support.apple.com/guide/playgrounds-ipad/itcdd1ad55f1/ipados)）が、このパッケージを Xcode から実機で動かせるかは確認していない。

### 手順 8: Anki との同期（任意）

このアプリで答えた分をパソコンの Anki に書き、Anki（AnkiMobile・AnkiDroid で解いて同期した分を含む）で解いた分をこちらへ送る。カードごとに新しいほうを正にする。やり方は2つあり、ふつうは 8-A のアドオンを使う。

どちらでも、始める前に Anki のバックアップを取る（Anki の「ファイル」→「バックアップを作成」）。

#### 8-A. Anki のアドオン「暗記と同期」（勧める）

Anki の中で動くので、AnkiConnect も、Anki が起動しているかの心配も要らない。同期するたびに、書く前に Anki のバックアップを作る（「ファイル」→「バックアップから復元」で戻せる。戻るのは Anki の側だけで、暗記へ送った分は戻らない）。

1. アドオンのファイルを作る
   ```
   python tools/build_addon.py
   ```
   `dist/selfanki_sync.ankiaddon` ができる（`setup_windows.bat`・`setup.sh` の2回目からのメニューでも作れる）
2. Anki の「ツール」→「アドオン」→「ファイルからインストール」で `selfanki_sync.ankiaddon` を選び、Anki を再起動する
3. パソコンで番号を出す（`python tools/pair_code.py`）。Anki の「ツール」→「暗記」→「つなぐ」で、サイトの住所（`site_url`。`pair_code.py` が出す `…/pair` のままでもよい）とその番号を入れる。つなぐ先はプロファイルごとに覚える
4. 「ツール」→「暗記」→「試す（数えるだけ・何も書かない）」で数を見る（カード・記録・マーク・デッキのオプション）。思っていたより多ければ止めて調べる
5. 「ツール」→「暗記」→「同期する」

- 既定では、「同期する」を押したときだけ動く。アドオンの設定（「ツール」→「アドオン」→「暗記と同期」→「設定」）で `after_anki_sync` を `true` にすると、Anki の「同期」（AnkiWeb）が終わったあとに続けて動く。順番は AnkiWeb が先なので、暗記で答えた分が AnkiWeb（AnkiMobile・AnkiDroid）に届くのは、次に Anki で同期したとき。Anki を閉じるときの自動同期のあとには動かない（閉じる途中で止まらないように）
- つないだプロファイルのカードが、暗記のカードの半分より少なければ止まる（別のプロファイルにつないだときの用心）
- どちらを残すかは「同期の注意」のとおり（相手の知らない新しい答えがある側。答えが同じなら新しく変えたほう）。8-B も同じ決まりを使う
- このアプリで「元に戻す」をした答えのうち、すでに Anki に書いた分は、記録の行が Anki に残る（カードの期日は戻した状態になる）。デッキごとの上限と全体の設定は Anki に書かない。このアプリで消したプリセットは、Anki では消さない
- カードの中身は送らない。Anki でカードを足したり直したりしたら手順 9

#### 8-B. tools/mirror.py（AnkiConnect を使う）

アドオンを入れたくないとき、決まった時刻に自動で動かしたいときの方法。

1. Anki にアドオン AnkiConnect を入れる。「ツール」→「アドオン」→「アドオンを取得」→ コード `2055492159` → Anki を再起動
2. Anki を起動したまま、試しに数える（Anki にもサーバーにも書かず、同期もしない）
   ```
   python tools/mirror.py --dry
   ```
   確認: `比べた: Anki へ カード N 記録 N ／サーバーへ …`
3. 本番
   ```
   python tools/mirror.py
   ```
   確認: 最後の行に `"ok": true`。失敗すると終了コードが 1 になる。記録は `cloud/state/mirror.log`

- 動いているあいだは Anki で勉強・編集しない
- Anki で開いているプロファイルが `anki_collection` のプロファイルと違えば止まる
- `ankiweb_sync` が `true` なら、書く前後に AnkiWeb と同期し、同期の前にも写しを取る（`cloud/state/snap/` に 20 個まで）
- カードの中身やデッキが変わっていれば、サイトを組み直して上げ直す（手順 9 も一緒にされる）
- 決まった時刻に動かすなら（その時刻に Anki が起動していて、パソコンがスリープしていないこと）:
  - Windows: コマンド プロンプトで（パスは自分のものに）
    ```
    schtasks /Create /SC DAILY /ST 03:30 /TN SelfAnkiMirror /TR "\"C:\selfanki\.venv\Scripts\python.exe\" \"C:\selfanki\tools\mirror.py\""
    ```
  - Mac・Linux: `crontab -e` に1行足す
    ```
    30 3 * * * cd /path/to/selfanki && .venv/bin/python tools/mirror.py >> cloud/state/mirror_run.log 2>&1
    ```

### 手順 9: Anki でカードを足したり直したりしたら

```
python tools/export_anki.py
python tools/build_site.py --deploy
```

手順 5 と同じく、書き出しているあいだは Anki で勉強・編集しない（できれば閉じる）。端末は次に開いたときに新しい中身を取ってくる。新しく足したカードは、Anki での学習の状態と記録のまま出る。

すでに移したカードを Anki・AnkiMobile で進めた分は、これでは入らない。入れるには手順 8（同期）をする。

`exclude_top_decks` に足しても、すでに配ったカードの記録や端末の控えは消えない（今後出さなくなるだけ）。

---

### 合言葉を変える・最初からやり直す

合言葉が漏れたかもしれないとき:
1. `token_file` のファイルを消す
2. `python tools/setup_cloud.py`（新しい合言葉を作って入れ直す）
3. `python tools/build_site.py --deploy`
4. すべての端末で、手順 6 の番号を入れ直す（Anki のアドオンも「ツール」→「暗記」→「つなぐ」で入れ直す）
5. Cloudflare の画面で、そのプロジェクトの古い配信（Deployments）を消す

別の置き場やコレクションで最初からやり直すときは、`cloud/state` を別の名前に変えてから手順 4 に戻る。`cloud/state/base.json` は最初に移した時点の状態で、置き場ごとに1つ。

### 困ったとき

| 出たもの | 原因と直し方 |
|---|---|
| `npx が見つかりません` | Node.js が入っていない。手順 1。入れたらターミナルを開き直す |
| `Python の anki パッケージがありません` | 仮想環境の python で動かしていない。手順 1 の表 |
| `config.json の文字コードが UTF-8 ではありません` | メモ帳などで「UTF-8」を選んで保存し直す |
| `仮想環境を作れませんでした`（Ubuntu・Debian） | `sudo apt install python3-venv` |
| `AnkiConnect が古く…` | Anki の「ツール」→「アドオン」で AnkiConnect を新しくする |
| `base.json は置き場「…」用です` | 別の置き場の作業フォルダを使っている。上の「最初からやり直す」 |
| `Cloudflare にログインしていません` / `not authenticated` | `npx --yes wrangler@4.165.0 login` |
| `More than one account available` | Cloudflare のアカウントが複数ある。`config.json` に `"cloudflare_account_id": "…"` を足す（ID は Cloudflare の画面の URL にある32文字） |
| `コレクションの写しが3回とも壊れていました` | Anki で勉強・編集中に写しを取った。Anki を閉じてもう一度 |
| `config.json の書き方がまちがっています` | 多くは Windows のパスの `\`。`/` に直す |
| `書き出すカードが0枚でした` | `exclude_top_decks` で全部を除いている |
| 書き出しの `missing(コピーに無い)` が 0 でない | その画像・音声が Anki のフォルダに無い。Anki の「ツール」→「メディアをチェック」 |
| 上げるときに 20,000 ファイルを超えたというエラー | 画像・音声が多すぎる。使わないデッキを `exclude_top_decks` に入れて手順 5 をやり直す |
| 書き出しでコレクションが新しすぎて開けないというエラー | 先にバックアップを取り、パソコンの Anki で「ファイル」→「プロファイルを切り替え」→「Downgrade & Quit」をしてから書き出す |
| 端末に `Unauthorized` と出る / 番号の画面が出る | その端末はまだつないでいない。手順 6 |
| `番号が違うか、期限が切れています` | 番号は15分・1回きり。`python tools/pair_code.py` で出し直す |
| サイトにつながらない | 作ってすぐなら数分待つ。`python tools/doctor.py` |
| iOS の殻が「使用できません」 | 無料署名の7日が切れた。手順 7-2 で入れ直して「信頼」。次からは 7-3 で自動にできる |
| iloader で `Failed to connect to usbmuxd` | Windows で iTunes を起動して使用許諾に同意していない |
| ipatool で `keyring` のエラー（Windows） | A の手順 4。`--keychain-passphrase` を全部のコマンドに付ける |
| 書き戻しで `AnkiConnect … につながりません` | Anki が起動していないか、AnkiConnect が入っていない |
| 書き戻しで「プロファイルが違います」 | Anki で `anki_collection` のプロファイルに切り替える |
| アドオンで「このプロファイルには、暗記のカード … しかありません」 | 別のプロファイルにつないでいる。Anki でプロファイルを切り替えるか、「ツール」→「暗記」→「つなぎを外す」 |
| アドオンで「合言葉が違う」 | 合言葉を変えた。「ツール」→「暗記」→「つなぐ」で番号を入れ直す |

---

### 確認したこと

| 何を | どこで | 結果 |
|---|---|---|
| 間隔の計算（揺らぎの乱数・負荷分散を含む） | Python の Anki 25.09.4 と突き合わせ | 13,200 通りすべて一致 |
| FSRS をオフにしたとき（SM-2）の間隔の計算（プリセット4通り×カードの状態7通り、負荷分散あり・なし、カスタム学習での期日前の復習）と、答えたあとのカード・記録 | Python の Anki 25.09.4 と突き合わせ | 次の状態 2,240 通り・期日前 240 通り・答えたあと 376 回すべて一致 |
| 日付の区切り（次の日の開始時刻5通り×作ったときの時差5通り×作った日時32通り、タイムゾーン5つ） | Python の Anki 25.09.4 と突き合わせ | 4,000 通りすべて一致 |
| 並び順のオプション（新規の集め方6・並べ方5・復習の並べ方12・混ぜ方3×3、FSRS あり・なし、親の上限を効かせる設定、新規は復習の上限を無視） | Python の Anki 25.09.4 と突き合わせ | 集めるカードと並びが 124 通りすべて一致 |
| 出題の並び（兄弟の埋めの8通りの組み合わせ・答えたあとの埋め） | Python の Anki 25.09.4 と突き合わせ | 集めるカードと並びが8通りとも一致、答えたあとの埋めは 96 回すべて一致 |
| 答えていく順（復習・新規の混ぜ方と上限。1枚答えるたびに組み直さず、集めた並びから取る） | Python の Anki 25.09.4 で最後まで答えた順と突き合わせ | 5通りとも一致 |
| 歯車メニューの「手書きパッド」（出す・消すをノートタイプごとに覚える、次のカードで消える、元に戻すの短押し・長押し、大きさ・透明度・太さ・帯の下に置く） | AnkiMobile 25.09 の実機（iPad）で測った値で作り、Chromium で確かめた | 通った。iPad の実機で暗記の手書きパッドを見比べるのはまだ |
| タップ（9区画×表裏）・スワイプ（4方向、縦は左右の端から）・トップバー（ボタン9個）の割り当て、歯車メニューの「すべてのアクション」、Aa（文字の大きさ。0.1〜10.0倍）、カードの自動送り（デッキのオプションの秒数・動き） | 名前・並び・既定・刻みは AnkiMobile 25.09 の実機とマニュアルのとおり、自動送りは Anki 25.09.4 の reviewer.py のとおりに作り、Chromium で確かめた | 通った。iPad の実機で暗記の側を見比べるのはまだ |
| 入力して答える（{{type:…}}・{{type:cloze:…}}・{{type:nc:…}}。入力欄・Enter で答えを出す・比べた結果・設定の「文字入力で解答しない」） | Python の Anki 25.9.4 の compare_answer と、aqt の reviewer.py の typeAnsFilter そのものと突き合わせ、Chromium で流れを確かめた | 比べた結果 3,918 通り、表と裏への差し込み 72 通りとも一致 |
| 新規カードにリセット・期日を指定（すべてのアクション・タップなどから。記録は種類 4「手動」、元に戻すで戻せる） | Python の Anki 25.9.4 と突き合わせ（FSRS オン・オフ、新規・学習中・復習・再学習、元の位置・回数のリセット、"0"・"5"・"3!"・"12!" など） | 状態・記録とも 480 通り一致。"3-7" のような幅は Anki と同じく一様に選ぶ（乱数の並びまでは合わせていない）。小窓の見た目は AnkiMobile の実機とは見比べていない |
| 回答確認用のマーク（✓・×の形・位置・消え方）、一覧の「？」（マニュアルを開く）、同期ボタンの色（送っていない分があると橙）、ツールアイコンの表示・左右、ダブルタップ防止の3段階、シェイクアクション、カードのリンクを外で開く、手書きパッドを表示しない | AnkiMobile 25.09 の実機で測った（マークは押した直後を 0.1 秒おきに撮って）。ダブルタップ防止の「短い」「長い」とシェイクの強さは測っていない目安。Chromium で確かめた | 通った |
| 回答確認用マークの「種類別」（ボタンの真上に、ボタンと同じ色）、ブラウザの「選択」と「アクション」（フラグを変更・休止 / 休止解除・期日を指定・カードをリセット。ほかは薄く） | AnkiMobile 25.09 の実機で測った。Chromium で確かめた | 通った |
| 画像穴埋め（Image Occlusion）のカード（問題で覆い、答えで外す、Toggle Masks） | Anki 25.9.4 で作った画像穴埋めのノート・Chromium（Anki の reviewer.js をそのまま使う） | 通った |
| 検索 | Anki 25.09.4 と突き合わせ | 740 通り中 739 一致（`-and` のときのエラーの文面だけ違う） |
| 手順 8-A（アドオン）: つなぐ・試す・同期する（バックアップを作り、端末で答えた分が記憶の値まで一致して Anki に入る、Anki で答えた分が届く、2回目は何もしない） | Anki 25.9.4（WSL・画面なし）・手元の Cloudflare | 通った |
| 手順 8-A の `after_anki_sync`（Anki の同期が終わった合図で続けて同期する・オフなら動かない・閉じる途中は動かない・二重に動かない） | 同上。AnkiWeb とは同期せず、終わった合図だけを出して試した | 通った |
| 同期でどちらを残すか（答えた・Anki で答えた・計算し直しただけ・記録だけ入って止まった・元に戻した・マークなど9場面）、古い答えしか知らない変更をサーバーが捨てること | アドオンの決まりを直接・手元の Cloudflare | 通った |
| 手順 2〜6 と 8-B（書き戻しは試し実行と、AnkiConnect の代わりを使った書き込み） | WSL の Ubuntu・Python 3.12・Cloudflare（試験用に作って消した）・見本のコレクション | 通った |
| 手順 1〜3・5 の書き出しと組み立て、`setup_windows.bat` | Windows 11・Python 3.14 | 通った |
| 手順 9（Anki で中身を書き換え・カードを追加・デッキを移動・ノートを削除してから組み直す） | WSL・手元の Cloudflare・Chromium（前の中身を持っている端末で開き直す） | 通った（4つとも反映。端末で答えた分の状態も残った） |
| 本家に無い機能の入れ方（入れない／見本のデザイン／見本＋自動同期）、同期は押したときだけ | 手元の Cloudflare（wrangler pages dev）・Chromium | 通った |
| 画面の言語（英語・ドイツ語・中国語） | 同上 | 通った（アプリの文言のうち Anki に訳が無いものは英語） |
| 手順 7（殻）の組み立てと iloader での入れ方 | iPad | 通った（ただし番号を入れる版は未確認） |
| 手順 7-3（自動の入れ直し）の `--check`・`--force` | Windows 11・iPad（Wi-Fi だけで） | 通った（「信頼」なしで開き、データも残った）。`--force` とタスクの登録はこのリポジトリに入れる前の版で、入れたあとの版は `--check`（IPA が無い・設定の書き間違い・重ねて動かした・覚えた端末が見えない）だけ。期限前の自動の入れ直しと、通知が画面に出ることは未確認 |
| iPhone・Mac・Linux のデスクトップ | — | 未確認。Android の Chrome では使えた |

## A. AnkiMobile を古い版に戻す

AnkiMobile は 26.10 でブラウザやデッキ一覧の見た目が大きく変わった（[告知](https://forums.ankiweb.net/t/ankimobile-26-10-is-out/74202)）。Anki チームは元に戻すのは現実的でないとしている（[返答](https://forums.ankiweb.net/t/anki-team-response-to-feedback-about-ankimobile-26-10/74500)）。App Store にも古い版を選んで入れる画面はない（[フォーラムの回答](https://forums.ankiweb.net/t/undo-26-10-update/74279)）。

利用者のあいだでは ipatool（自分の Apple ID で買ったアプリの過去の版を App Store から落とす道具）で戻す方法が使われている。この方法で Windows から 26.10 を 25.09 に上書きできることは確認した。Apple も Anki も保証していない非公式な方法なので、自己責任で。

要るもの:
- AnkiMobile をその Apple ID で購入済みであること。落とした IPA はその Apple ID 用なので、人には配らない
- パソコン（Windows・Mac・Linux）と USB ケーブル。iPhone・iPad をつないで「このコンピュータを信頼」を押しておく
- Windows は iTunes（Microsoft Store 版でよい）。一度起動して使用許諾に同意しておく。同意するまで、iPhone・iPad と通信する部品が動かないことがある
- Python 3（pymobiledevice3 に使う）

手順:
1. 先にバックアップを取る。AnkiWeb と同期しておくか、AnkiMobile の機能でバックアップを書き出す
2. 自動アップデートを切る。「設定」→「App Store」→「App のアップデート」をオフ。切り忘れると夜のうちに新しい版に戻る
3. ipatool を入れる。<https://github.com/majd/ipatool/releases> から OS に合うものを落として展開する。2.8.0 以上を使う（2.7.0 ではサインインできないことがあった）
4. サインインする。パスワードと2ファクタ認証のコードは自分で入れる
   ```
   ipatool auth login -e AppleIDのメールアドレス
   ```
   Windows で `The specified item could not be found in the keyring` と出たら、`--keychain-passphrase 好きな文字列` を以後のすべての ipatool コマンドに付ける。この文字列はコマンドの履歴に残るので、ほかで使っているパスワードにはしない
5. 版の番号を調べる
   ```
   ipatool list-versions -b net.ichi2.anki
   ipatool get-version-metadata -b net.ichi2.anki --external-version-id 番号
   ```
   確認した番号（App Store の版の情報）:

   | 版 | 番号 | 版の情報の日付 |
   |---|---|---|
   | 26.10 | 894175942 | 2026-10-21 |
   | 25.09 | 877897364 | 2025-09-06 |
   | 25.07.1 | 876758655 | 2025-07-28 |
   | 25.07 | 876569007 | 2025-07-21 |
   | 25.02.2 | 872747305 | 2025-02-24 |
6. 落とす
   ```
   ipatool download -b net.ichi2.anki --external-version-id 877897364 -o AnkiMobile_25.09.ipa
   ```
   `"success":true` と出れば成功。購入済みなら `"purchased":false`（新しい購入はなし）と出る
7. USB で上書きする
   ```
   python -m pip install pymobiledevice3
   python -m pymobiledevice3 apps install AnkiMobile_25.09.ipa
   ```
   `Installation succeed.` と出れば完了。上書きしてもデッキと記録が残ることは確認したが、手順 1 のバックアップは取っておく
8. 「設定」→「一般」→「iPhone（iPad）ストレージ」→「AnkiMobile」で版が 25.09 になっていることを見る

- App Store が署名した IPA なので、デベロッパモードは要らないと思うが、オフの端末では試していない
- 新しい版が同期の仕組みの変更に頼ることがあると公式は書いている（[同期サーバーの説明](https://docs.ankiweb.net/manual/sync-server.md)）。古い版でいつまで AnkiWeb と同期できるかは分からない

## B. Anki パソコン版を古い版に戻す

公式マニュアル（[インストール](https://docs.ankiweb.net/manual/platform/windows/installing.md)・[プロファイル](https://docs.ankiweb.net/manual/profiles.md)）より。

1. 先にバックアップを取り、今の版で「ファイル」→「プロファイルを切り替え」→「Downgrade & Quit」をする。しないと古い版で開いたときにエラーになることがある
2. 古い版は <https://github.com/ankitects/anki/releases> から入れる
   - 25.07 以降は Anki の「ツール」→「Upgrade/Downgrade」で版を選べる（[25.07 のリリースノート](https://github.com/ankitects/anki/releases/tag/25.07)）
   - 25.09.x は [25.09 のリリース](https://github.com/ankitects/anki/releases/tag/25.09)の `anki-launcher-25.09-…`（Windows は .exe、Mac は .dmg）を入れてから、「Upgrade/Downgrade」で選ぶ（25.09.4 のリリースにはファイルが付いていない）
   - 26.x から 25.09.x へこの方法で戻れるかは確認していない

このアプリを使うだけなら、パソコンの Anki を戻す必要はない。道具は Python の anki 25.9.4 を別に使う（Anki 26.09.4 で作った試験用のコレクションを 25.9.4 で開けることは確認した。確認したのはその1件だけ）。

## C. AnkiDroid を古い版に戻す

AnkiDroid は過去の版をすべて APK で配っている（[releases](https://github.com/ankidroid/Anki-Android/releases)・[wiki の FAQ](https://github.com/ankidroid/Anki-Android/wiki/FAQ)）。Android は入っているものより古い版を上書きできない（[Android の説明](https://developer.android.com/studio/publish/versioning)）ので、どちらかにする。

- wiki が勧める Parallel 版（A などの印が付いた APK）を入れて、今の版と並べて使う
- 先に AnkiWeb と同期するかバックアップを取ってから今の版をアンインストールし、古い版を入れる。アンインストールで「データを消す」を選ぶとデータが消える

---

## ライセンス

AGPL-3.0-or-later（`LICENSE`）。由来は `NOTICE.md`。
