// 画面の文言を、組み立てのときに選んだ言語に置き換える（日本語のときは何もしない）。
// 置き換え表 app/i18n/ui.json は tools/build_site.py が作る（Anki の翻訳にある文言はその訳、無いものは英語）。
// 画面に出た文字（テキスト・title・placeholder・aria-label）を、次の順に置き換える
//   1. __ctx: その要素が CSS セレクタの中にあるときだけ使う訳（同じ日本語で場所により訳が違うもの）
//   2. 表の日本語とぴったり同じ
//   3. __pat: 「{0}件のノートを更新しました。」のような、数や名前が入る文言（{0} の所は何でもよい。{0:n} は数だけ）
//      訳の中の {0} はそのまま、{~0} はその部分も訳す、{0|note|notes} は {0} が 1 なら note・ほかは notes
//   4. 何行かあるものは、全体で合わなければ1行ずつ
// translate="no" の要素（デッキ名などの利用者のデータ）の中は触らない
let MAP = null, PATS = [], CTX = new Map();
const ATTRS = ['title', 'placeholder', 'aria-label'];
const JA = /[぀-ヿ㐀-鿿！-～]/;   // かな・漢字・全角の記号（これを含む文字だけ表を引く）
const memo = new Map();

function fill(out, m) {
  return out.replace(/\{(~?)(\d+)(?:\|([^|}]*)\|([^}]*))?\}/g, (_, tl, i, one, many) => {
    const g = m[+i + 1] ?? '';
    if (one != null) return g.trim() === '1' ? one : many;
    if (!tl) return g;
    const k = g.trim(); const v = k ? lookup(k) : null;
    return v == null ? g : g.replace(k, v);
  });
}
function lookup(k, el) {
  if (el && CTX.has(k)) for (const [sel, v] of CTX.get(k)) if (el.closest(sel)) return v;
  const v = MAP.get(k); if (v != null) return v;
  if (!PATS.length || !JA.test(k)) return null;
  if (memo.has(k)) return memo.get(k);
  let r = null;
  for (const p of PATS) { if (p.lit && !k.includes(p.lit)) continue; const m = p.re.exec(k); if (m) { r = fill(p.out, m); break; } }
  // 何行かをまとめた知らせ（読み込みの結果など）は、全体で合わなければ1行ずつ訳す
  if (r == null && k.includes('\n')) {
    let hit = false;
    const out = k.split('\n').map(l => { const x = l.trim(), v = x ? lookup(x) : null; if (v == null) return l; hit = true; return l.replace(x, v); });
    if (hit) r = out.join('\n');
  }
  if (memo.size > 3000) memo.clear();
  memo.set(k, r); return r;
}
// 画面の外に出す文字（ファイル名など）を訳す。表に無ければそのまま
export function t(s) { if (!MAP || s == null) return s; const k = String(s).trim(); const v = k ? lookup(k) : null; return v == null ? s : String(s).replace(k, v); }

function tr(node) {
  if (node.nodeType === 3) {
    const t = node.nodeValue, k = t.trim();
    if (!k || !JA.test(k) && !MAP.has(k)) return;
    const p = node.parentElement; if (p?.closest('[translate="no"]')) return;
    const v = lookup(k, p); if (v != null && v !== k) node.nodeValue = t.replace(k, v);
    return;
  }
  if (node.nodeType !== 1 || node.tagName === 'IFRAME' || node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'TEXTAREA') return;
  if (node.getAttribute('translate') === 'no') return;
  for (const a of ATTRS) { const v = node.getAttribute(a); if (v) { const k = v.trim(), w = k && lookup(k, node); if (w != null && w !== k) node.setAttribute(a, v.replace(k, w)); } }
  for (const c of node.childNodes) tr(c);
}
function compile(ja) {
  // 「{0}」の所を何でも合う部分（改行は含まない）にした、全体に合う正規表現。いちばん長い決まった部分は、先に includes で絞るのに使う
  // {0:n} は数だけに合う（「{0:n}日」が「毎日」に合わないように）
  const parts = ja.split(/\{\d+(?::n)?\}/); const lit = parts.reduce((a, b) => (b.length > a.length ? b : a), '');
  const src = ja.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\d+)(:n)?\\\}/g, (_, i, n) => (n ? '(-?[\\d.,]+)' : '([^\\n]+?)'));
  return { re: new RegExp('^' + src + '$'), lit };
}
export async function start(lang) {
  let table;
  try { table = await (await fetch(new URL('./i18n/ui.json', import.meta.url), { cache: 'no-cache' })).json(); }
  catch { return; }
  if (table.__ivl) { window.SA_IVL = table.__ivl; delete table.__ivl; }   // 答えのボタンの間隔の単位（app.mjs の fmtIvl が使う）
  for (const [ja, out] of table.__pat || []) PATS.push({ ...compile(ja), out });
  for (const [sel, ja, out] of table.__ctx || []) { if (!CTX.has(ja)) CTX.set(ja, []); CTX.get(ja).push([sel, out]); }
  delete table.__pat; delete table.__ctx;
  MAP = new Map(Object.entries(table));
  window.SA_T = t;
  document.documentElement.lang = lang.split(/[-_]/)[0];
  tr(document.body); document.title = t(document.title);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') tr(m.target);
      else if (m.type === 'attributes') tr(m.target);
      else for (const n of m.addedNodes) tr(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
