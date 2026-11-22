// ブラウザの「絞り込み」（AnkiMobile のマニュアル editing.md: パソコン版のサイドバーのような一覧。押すと検索を置き換え、スワイプで今の検索に足す）。
// 項目・並び・文言・検索の書き方は Anki 25.9.4 の aqt/browser/sidebar/tree.py と rslib の build_search_string のとおり:
//   保存した検索条件 → 今日 → フラグ → カードの状態 → デッキ → ノートタイプ（カードの種類・フィールド）→ タグ。
//   名前の中の \ " * _ の前に \ を付け、空白か括弧があれば "key:値" 全体をくくる。足すとき（AND）は、今の検索が2語以上なら ( ) でくくる（rslib join_search_nodes）
// 画面の見た目は AnkiMobile の実機と見比べていない
const esc = v => String(v).replace(/[\\"*_]/g, m => '\\' + m);
const quote = t => (/[\s()]/.test(t) ? `"${t}"` : t);
export const term = (key, v) => quote(`${key}:${esc(v)}`);
// 今の検索のいちばん外側の語の数（引用符・括弧の中は数えない。OR・AND も1語に数える）
export function topTerms(s) {
  let n = 0, depth = 0, inq = false, cur = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inq) { if (ch === '\\') i++; else if (ch === '"') inq = false; cur = true; continue; }
    if (ch === '"') { inq = true; cur = true; continue; }
    if (ch === '(') { depth++; cur = true; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); cur = true; continue; }
    if (/\s/.test(ch) && depth === 0) { if (cur) n++; cur = false; continue; }
    if (ch === '\\') i++;
    cur = true;
  }
  return n + (cur ? 1 : 0);
}
export function joinAnd(existing, add) {
  const ex = String(existing || '').trim(); if (!ex) return add;
  return topTerms(ex) > 1 ? `(${ex}) ${add}` : `${ex} ${add}`;
}
const FLAG_NAMES = ['レッド', 'オレンジ', 'グリーン', 'ブルー', 'ピンク', 'ターコイズ', 'パープル'];
const FLAG_COLORS = ['#ff3b30', '#ff9500', '#34c759', '#007aff', '#ff2d92', '#30c8d6', '#af52de'];

// env: { S, loadNotes(): Promise<Map>, current(): string, apply(query): void }
export function createFilter(env) {
  const { S } = env;
  let el = null; const open = new Set();   // 開いている枝（'deck:<名前>'・'tag:<名前>'・'nt:<id>'）
  function sections(notes) {
    const out = [];
    const saved = S.meta.config?.savedFilters || {};
    const sv = Object.keys(saved).sort().map(n => ({ t: n, q: saved[n] }));
    if (sv.length) out.push({ h: '保存した検索条件', rows: sv });
    out.push({ h: '今日', rows: [
      { t: '今日が期日', q: 'prop:due=0' }, { t: '今日追加した', q: 'added:1' }, { t: '今日編集した', q: 'edited:1' }, { t: '今日学習した', q: 'rated:1' },
      { t: '今日学習を開始した', q: 'introduced:1' }, { t: '今日スケジュールを変更した', q: 'resched:1' }, { t: '今日間違えた（「もう一度」と回答した）', q: 'rated:1:1' },
      { t: '今日延滞中（期日が昨日以前）', q: 'is:due -prop:due=0' }] });
    const labels = S.meta.config?.flagLabels || {};
    out.push({ h: 'フラグ', rows: [{ t: 'フラグなし', q: 'flag:0' }, ...FLAG_NAMES.map((n, i) => ({ t: labels[String(i + 1)] || n, q: `flag:${i + 1}`, dot: FLAG_COLORS[i] }))] });
    out.push({ h: 'カードの状態', rows: [{ t: '新規', q: 'is:new' }, { t: '習得中または再習得中', q: 'is:learn' }, { t: '復習', q: 'is:review' }, { t: '休止中', q: 'is:suspended' }, { t: '今日は非表示', q: 'is:buried' }] });
    // デッキ（ふつうのデッキとフィルターデッキの名前の木）
    const dnames = [...new Set([...(S.meta.decks || []).map(d => d.name), ...[...(S.fdecks?.values() || [])].filter(f => !f.removed).map(f => f.name)])];
    out.push({ h: 'デッキ', rows: [{ t: '現在のデッキ', q: 'deck:current' }, ...tree(dnames, 'deck')] });
    // ノートタイプ（名前の小文字順。子はカードの種類 card:N とフィールド フィールド名:_*）
    const nts = Object.entries(S.meta.notetypes || {}).sort((a, b) => a[1].name.toLowerCase().localeCompare(b[1].name.toLowerCase()));
    const ntRows = [];
    for (const [id, nt] of nts) {
      const key = 'nt:' + id, kids = [...(nt.templates || []).map((t, i) => ({ t: t.name, q: `${term('note', nt.name)} card:${i + 1}`, depth: 1 })), ...(nt.fields || []).map(f => ({ t: f.name, q: `${term('note', nt.name)} ${quote(esc(f.name) + ':_*')}`, depth: 1, fld: true }))];
      ntRows.push({ t: nt.name, q: term('note', nt.name), key, kids: kids.length > 0 });
      if (open.has(key)) ntRows.push(...kids);
    }
    if (ntRows.length) out.push({ h: 'ノートタイプ', rows: ntRows });
    // タグ（ノートのタグの木）
    const tags = new Set(); for (const n of notes.values()) for (const t of String(n.tags || '').split(/\s+/)) if (t) tags.add(t);
    out.push({ h: 'タグ', rows: [{ t: 'タグなし', q: '-tag:_*' }, ...tree([...tags], 'tag')] });
    return out;
  }
  // 名前（親::子）の木。大文字小文字を区別しない並び。子のある枝は開け閉めできる
  function tree(names, key) {
    const node = new Map();
    for (const full of names) { const parts = full.split('::'); for (let i = 1; i <= parts.length; i++) { const p = parts.slice(0, i).join('::'); if (!node.has(p.toLowerCase())) node.set(p.toLowerCase(), p); } }
    const all = [...node.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const hasKids = p => all.some(x => x.toLowerCase().startsWith(p.toLowerCase() + '::'));
    const rows = [];
    for (const p of all) {
      const parts = p.split('::'), depth = parts.length - 1;
      if (depth && !parts.slice(0, -1).every((_, i) => open.has(key + ':' + parts.slice(0, i + 1).join('::').toLowerCase()))) continue;   // 親が閉じている
      rows.push({ t: parts.at(-1), q: term(key, p), depth, key: key + ':' + p.toLowerCase(), kids: hasKids(p) });
    }
    return rows;
  }
  function build() {
    if (el) return el;
    el = document.createElement('div'); el.id = 'bfilter'; el.hidden = true;
    el.innerHTML = '<nav class="pnav"><button class="back">‹ ブラウザ</button><b class="ptitle">絞り込み</b><span></span></nav><div class="pbody"></div>';
    const st = document.createElement('style');
    st.textContent = `#bfilter{position:fixed;inset:0;z-index:32;background:var(--am-bg,#000);color:var(--am-text,#fff);display:flex;flex-direction:column}
#bfilter[hidden]{display:none}
#bfilter .pnav{flex:none;height:calc(50px + env(safe-area-inset-top));padding-top:env(safe-area-inset-top);display:grid;grid-template-columns:1fr auto 1fr;align-items:center;border-bottom:.5px solid var(--am-barline,#333)}
#bfilter .pnav .back{justify-self:start;padding:0 12px;font-size:17px;color:var(--am-blue,#0a84ff);background:none;border:0}
#bfilter .pnav .ptitle{font-size:17px}
#bfilter .pbody{flex:1;overflow:auto;padding-bottom:30px}
#bfilter .h{font-size:13px;color:#8e8e93;padding:22px 16px 6px}
#bfilter .row{display:flex;align-items:center;min-height:44px;border-bottom:.5px solid var(--am-sep,#333);background:var(--am-cell,#1c1c1e);touch-action:pan-y;transition:background .15s}
#bfilter .row.add{background:#2d6a35}
#bfilter .row .tw{width:28px;flex:none;text-align:center;color:#8e8e93;font-size:13px}
#bfilter .row .t{flex:1;font-size:16px;padding:10px 12px 10px 0;overflow-wrap:anywhere}
#bfilter .row .dot{width:10px;height:10px;border-radius:50%;margin-right:8px;flex:none}
#bfilter .row.fld .t{color:#aeaeb2}`;
    el.append(st);
    el.querySelector('.back').onclick = () => close();
    document.body.append(el);
    return el;
  }
  async function paint() {
    const body = el.querySelector('.pbody'), y = body.scrollTop; body.innerHTML = '';
    let notes = new Map(); try { notes = await env.loadNotes(); } catch {}
    for (const sec of sections(notes)) {
      const h = document.createElement('div'); h.className = 'h'; h.textContent = sec.h; body.append(h);
      for (const r of sec.rows) {
        const row = document.createElement('div'); row.className = 'row' + (r.fld ? ' fld' : ''); row.style.paddingLeft = (r.depth || 0) * 18 + 'px';
        const tw = document.createElement('span'); tw.className = 'tw'; tw.textContent = r.kids ? (open.has(r.key) ? '▾' : '▸') : '';
        if (r.kids) tw.onclick = e => { e.stopPropagation(); if (open.has(r.key)) open.delete(r.key); else open.add(r.key); paint(); };
        row.append(tw);
        if (r.dot) { const d = document.createElement('span'); d.className = 'dot'; d.style.background = r.dot; row.append(d); }
        const t = document.createElement('span'); t.className = 't'; t.textContent = r.t; row.append(t);
        // 押す＝置き換え、横にスワイプ＝今の検索に足す（AND）
        let x0 = null, y0 = 0, swiped = false;
        row.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; swiped = false; });
        row.addEventListener('pointermove', e => { if (x0 == null) return; if (Math.abs(e.clientX - x0) > 40 && Math.abs(e.clientX - x0) > 2 * Math.abs(e.clientY - y0)) { swiped = true; row.classList.add('add'); } });
        row.addEventListener('pointerup', () => { if (x0 == null) return; x0 = null; if (swiped) { close(); env.apply(joinAnd(env.current(), r.q)); } });
        row.addEventListener('pointercancel', () => { x0 = null; row.classList.remove('add'); });
        row.addEventListener('click', () => { if (swiped) return; close(); env.apply(r.q); });
        body.append(row);
      }
    }
    body.scrollTop = y;
  }
  function close() { if (el) el.hidden = true; }
  return { open: () => { build().hidden = false; paint(); }, close, isOpen: () => !!el && !el.hidden };
}
