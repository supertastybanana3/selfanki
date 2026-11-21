// 画面の文言を、組み立てのときに選んだ言語に置き換える（日本語のときは何もしない）。
// 置き換え表 app/i18n/ui.json は tools/build_site.py が作る（Anki の翻訳にある文言はその訳、無いものは英語）。
// 画面に出た文字（テキスト・title・placeholder）が表の日本語とぴったり同じときだけ置き換える
let MAP = null;
const ATTRS = ['title', 'placeholder', 'aria-label'];
function tr(node) {
  if (node.nodeType === 3) {
    const t = node.nodeValue, k = t.trim();
    if (k && MAP.has(k)) node.nodeValue = t.replace(k, MAP.get(k));
    return;
  }
  if (node.nodeType !== 1 || node.tagName === 'IFRAME' || node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'TEXTAREA') return;
  for (const a of ATTRS) { const v = node.getAttribute?.(a); if (v && MAP.has(v.trim())) node.setAttribute(a, MAP.get(v.trim())); }
  for (const c of node.childNodes) tr(c);
}
export async function start(lang) {
  let table;
  try { table = await (await fetch(new URL('./i18n/ui.json', import.meta.url), { cache: 'no-cache' })).json(); }
  catch { return; }
  if (table.__ivl) { window.SA_IVL = table.__ivl; delete table.__ivl; }   // 答えのボタンの間隔の単位（app.mjs の fmtIvl が使う）
  MAP = new Map(Object.entries(table));
  document.documentElement.lang = lang.split(/[-_]/)[0];
  tr(document.body); if (MAP.has(document.title)) document.title = MAP.get(document.title);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') tr(m.target);
      else if (m.type === 'attributes') tr(m.target);
      else for (const n of m.addedNodes) tr(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
