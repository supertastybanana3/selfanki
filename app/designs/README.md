# 書き込みのデザイン

「書き込み」（Apple Pencil でカードの上に直接書く。本家に無い、このアプリ独自の機能）は、**書く仕組み**（`app/pen.mjs`。どのデザインでも同じ）と、**デザイン**（道具の帯・墨の色・スクイーズで何をするか）に分かれています。

- デザインを何も入れなければ、書き込みは出ません（道具も出ず、Pencil でも書けない）。これが既定です
- `sample/` は作者が使っているデザインの**見本**です。そのまま使ってもよいし、写して自分のものを作ってもかまいません
- どのデザインを使うかは `config.json` の `extras.pen_design` にフォルダの名前を書き（`tools/setup.py` の質問でも選べる）、`python tools/build_site.py --deploy` で組み直すと決まります

## 自分のデザインを作る

1. `app/designs/sample` を写して、`app/designs/<名前>`（英数字・`-`・`_`）を作る
2. `design.mjs` を書き換える
3. `config.json` の `"extras": {"pen_design": "<名前>"}` にして、組み直す

`design.mjs` は `mount(api)` を1つ書き出します。アプリは起動したときに一度だけこれを呼びます。

```js
export function mount(api) {
  // api.pen          書く仕組み。undo() 一画戻す / clear() 全部消す / toggleEraser() 消しゴムの切り替え /
  //                  setColor(色 or null) 墨の色（null は表・裏の既定の色）/ setSideColor(色) 表・裏の既定の色 /
  //                  state（tool: 'pen'|'eraser'、color、strokes）/ state.onChange（書いた・消したときに呼ばれる）
  // api.host         道具を置く場所（出題の画面。position:absolute で置ける）
  // api.isDark()     暗いテーマか
  // api.isShell      iOS の殻の中か（スクイーズ・ダブルタップが届くか）
  // api.keyboardMode { active(), toggle() }  キーボードモード（指で触れてもめくらない）。使うなら返り値に keyboardMode: true
  return {
    onSide(side, dark) {},     // 表（'q'）と裏（'a'）が切り替わったとき・テーマが変わったとき
    onSqueeze() {},            // Apple Pencil Pro のスクイーズ（殻のときだけ）
    onTap() {},                // Apple Pencil のダブルタップ（殻のときだけ）
    onKeyboardMode(on) {},     // キーボードモードが変わったとき
    keyboardMode: false,       // true にするとキーボードモードを使う
  };
}
```

道具の要素には `#pentools` のような ID を付けてかまいません。アプリは、書き込みを切ったときに `body` へ `nopen` を付けるので、`body.nopen #自分の道具{display:none}` で隠してください。
