// ブラウザの「オプション」（歯車）・「表示」（目）・「デッキを選択」（アクション＞デッキの変更）。AnkiMobile 25.09 の実機で見た並び・文言
// どれもブラウザ（#browse）の中に重ねる全画面のページ。上の帯は #browse の .pnav の見た目をそのまま使う
import { SORTS, COLUMNS } from './bcols.mjs';

const BACK = '<svg viewBox="0 0 12 20" width="12" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>';
const CHEV = '<svg width="7.7" height="12.8" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5 7.5 7.5 1.5 13.5"/></svg>';
const CSS = `#browse .bpage{position:absolute;inset:0;z-index:3;background:var(--am-bg);display:flex;flex-direction:column}
#browse .bpage[hidden]{display:none}
#browse .bpage .pnav{flex:none}
#browse .bpage .nr{justify-content:flex-end;padding-right:16px}
#browse .bpage .tx{color:var(--am-bartext);font-size:17px;background:none;border:0;padding:0 4px;height:44px}
#browse .bpage .pbody{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:34.5px 0 60px}
#browse .bpage .grp{background:var(--am-group);border-radius:12px;margin:0 1px 35px;overflow:hidden}
#browse .bpage .it{display:flex;align-items:center;gap:8px;width:100%;min-height:45px;padding:0 22px 0 21px;position:relative;font-size:16px;color:var(--am-text);text-align:left;background:none;border:0}
#browse .bpage .it + .it::before{content:"";position:absolute;top:0;left:21px;right:0;height:.5px;background:var(--am-sep)}
#browse .bpage .it .lab{flex:1;padding:12px 0;overflow-wrap:anywhere} #browse .bpage .it .val{color:var(--am-blue)} #browse .bpage .it .chev{color:var(--am-chev);display:flex}
#browse .bpage .it.act .lab{color:var(--am-blue)} #browse .bpage .it:disabled > *{opacity:.4} #browse .bpage .it.tgr{min-height:53px} #browse .bpage .it .ck{color:var(--am-blue);font-size:19px}
#browse .bpage .tg{width:51px;height:31px;border-radius:16px;background:#39393d;position:relative;flex:none} #browse .bpage .tg.on{background:var(--am-blue)}
#browse .bpage .tg::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;transition:left .2s} #browse .bpage .tg.on::after{left:22px}
#bprev .nr{justify-content:flex-end;padding-right:22px} #bprev .both{color:var(--am-bartext);height:44px;width:40px;display:flex;align-items:center;justify-content:center;background:none;border:0}
#bprev .pbar{flex:none;height:calc(50px + env(safe-area-inset-bottom));padding:0 20px env(safe-area-inset-bottom);display:flex;align-items:center;justify-content:space-between;background:var(--bp-bar,#121212);border-top:.5px solid var(--bp-line,#262626)}
#bprev .pbar button{width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--am-bartext);background:none;border:0;padding:0}
:root{--bp-bar:#f9f9f9;--bp-line:#c6c6c8}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bp-bar:#121212;--bp-line:#262626}}
:root[data-theme=dark]{--bp-bar:#121212;--bp-line:#262626}`;
let cssDone = false;
const addCss = () => { if (cssDone) return; cssDone = true; const st = document.createElement('style'); st.textContent = CSS; document.head.append(st); };

// 項目の一覧を描く（設定の画面と同じ形: {t, v, go, ck, tg, act, off, run}）
function renderGroups(body, groups, onGo) {
  body.innerHTML = '';
  for (const g of groups) {
    const box = document.createElement('div'); box.className = 'grp'; body.append(box);
    for (const it of g) {
      const b = document.createElement('button'); b.className = 'it' + (it.act ? ' act' : '') + (it.tg != null ? ' tgr' : ''); if (it.off) b.disabled = true;
      b.innerHTML = '<span class="lab"></span>' + (it.v != null ? '<span class="val"></span>' : '') + (it.go ? `<span class="chev">${CHEV}</span>` : '') + (it.ck ? '<span class="ck">✓</span>' : '') + (it.tg != null ? `<span class="tg${it.tg ? ' on' : ''}"></span>` : '');
      b.querySelector('.lab').textContent = it.t; if (it.v != null) b.querySelector('.val').textContent = it.v;
      if (it.key) b.dataset.k = it.key;
      if (!it.off) b.onclick = () => (it.go ? onGo(it.go) : it.run?.());
      box.append(b);
    }
  }
}
function makePage(id, host) {
  addCss();
  let el = document.getElementById(id); if (el) return el;
  el = document.createElement('div'); el.id = id; el.className = 'bpage'; el.hidden = true;
  el.innerHTML = `<nav class="pnav"><div class="nl"><button class="back">${BACK}<span class="bl"></span></button></div><span class="ptitle"></span><div class="nr"></div></nav><div class="pbody"></div>`;
  host.append(el); return el;
}
const nameOf = (list, k) => list.find(x => x[0] === k)?.[1] ?? '';

// 「オプション」: 元に戻す／ノートモード／ソート順・後ろからソート／列1〜列6／使用されていないタグを削除
// env: { host(), get() → {sort, rev, notes, cols}, set(patch), undoLabel() → 文字 or null, undo(): Promise }
export function createOptions(env) {
  let el = null, stack = [];
  const pages = {
    root: () => {
      const o = env.get(), u = env.undoLabel();
      return { title: 'オプション', groups: [
        [{ t: u ? `${u} を元に戻す` : '元に戻す', act: 1, off: !u, key: 'undo', run: async () => { await env.undo(); paint(); } }],
        [{ t: 'ノートモード', tg: o.notes, key: 'notes', run: () => { env.set({ notes: !env.get().notes }); paint(); } }],
        [{ t: 'ソート順', v: nameOf(SORTS, o.sort), go: 'sort', key: 'sort' }, { t: '後ろからソート', tg: o.rev, key: 'rev', run: () => { env.set({ rev: !env.get().rev }); paint(); } }],
        o.cols.map((k, i) => ({ t: `列${i + 1}`, v: nameOf(COLUMNS, k), go: 'col' + i, key: 'col' + i })),
        [{ t: '使用されていないタグを削除', act: 1, off: 1, key: 'cleartags' }],   // タグはノートから数えるので、使われていないタグは無い
      ] };
    },
    sort: () => ({ title: 'ソート順', groups: [SORTS.map(([k, t]) => ({ t, ck: env.get().sort === k, key: k, run: () => { env.set({ sort: k }); paint(); } }))] }),
  };
  for (let i = 0; i < 6; i++) pages['col' + i] = () => ({ title: `列${i + 1}`, groups: [COLUMNS.map(([k, t]) => ({ t, ck: env.get().cols[i] === k, key: k, run: () => { const cols = env.get().cols.slice(); cols[i] = k; env.set({ cols }); paint(); } }))] });
  function paint() {
    const pg = pages[stack.at(-1)]();
    el.querySelector('.ptitle').textContent = pg.title;
    el.querySelector('.bl').textContent = stack.length > 1 ? pages[stack.at(-2)]().title : 'ブラウザ';
    renderGroups(el.querySelector('.pbody'), pg.groups, go => { stack.push(go); paint(); el.querySelector('.pbody').scrollTop = 0; });
  }
  function open() {
    el = makePage('bopts', env.host());
    el.querySelector('.back').onclick = () => { stack.pop(); if (stack.length) paint(); else close(); };
    stack = ['root']; paint(); el.hidden = false;
  }
  function close() { if (el) el.hidden = true; stack = []; }
  return { open, close, isOpen: () => !!el && !el.hidden };
}

// 「デッキを選択」（デッキの変更）: 左上「N/M 件選択」・右上「新規追加」。デッキは名前全体（::）、選んだカードがみな同じデッキならそこに ✓
// env: { host(), backLabel(), decks() → [{id, name}]（並べたもの）, current() → id or null, pick(did): Promise, create(): Promise<id or null> }
export function createDeckPicker(env) {
  let el = null;
  function paint() {
    const cur = env.current();
    renderGroups(el.querySelector('.pbody'), [env.decks().map(d => ({ t: d.name, ck: d.id === cur, key: String(d.id), run: () => choose(d.id) }))], () => {});
  }
  async function choose(did) { close(); await env.pick(did); }
  function open() {
    el = makePage('bdeck', env.host());
    el.querySelector('.ptitle').textContent = 'デッキを選択'; el.querySelector('.bl').textContent = env.backLabel();
    const nr = el.querySelector('.nr'); nr.innerHTML = '<button class="tx add">新規追加</button>';
    nr.querySelector('.add').onclick = async () => { const id = await env.create(); if (id != null) await choose(id); };
    el.querySelector('.back').onclick = () => close();
    paint(); el.hidden = false; el.querySelector('.pbody').scrollTop = 0;
  }
  function close() { if (el) el.hidden = true; }
  return { open, close, isOpen: () => !!el && !el.hidden };
}

// 「表示」（目）: 一覧のカードを1枚ずつ。上「i/N」、右上の四角＝問題だけ ⇔ 問題と解答、下 ◀（前）⏮（最初）⏭（最後）▶（次）
// env: { el: #bprev, list() → カード, render(iframe, card, both): Promise }
const SQ = '<svg viewBox="0 0 22 22" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2" width="18" height="18" rx="3.5"/></svg>';
const SQ2 = '<svg viewBox="0 0 22 22" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2" width="18" height="18" rx="3.5"/><path d="M2 11h18"/></svg>';
const ICONS = {
  prev: '<svg viewBox="0 0 20 22" width="17" height="19" fill="currentColor"><path d="M2 11 18 1.5v19z"/></svg>',
  first: '<svg viewBox="0 0 24 22" width="21" height="19" fill="currentColor"><rect x="1.5" y="2" width="3" height="18" rx="1"/><path d="M5 11 14 4v14zM13 11l9-7v14z"/></svg>',
  last: '<svg viewBox="0 0 24 22" width="21" height="19" fill="currentColor"><rect x="19.5" y="2" width="3" height="18" rx="1"/><path d="M19 11 10 4v14zM11 11 2 4v14z"/></svg>',
  next: '<svg viewBox="0 0 20 22" width="17" height="19" fill="currentColor"><path d="M18 11 2 1.5v19z"/></svg>',
};
export function createPreview(env) {
  addCss();
  const el = env.el; let i = 0, both = false, built = false, list = [];
  function build() {
    if (built) return; built = true;
    const nav = el.querySelector('.pnav'), spare = nav.lastElementChild;
    const nr = document.createElement('div'); nr.className = 'nr'; nr.innerHTML = '<button class="both" title="問題と解答"></button>'; spare.replaceWith(nr);
    const bar = document.createElement('div'); bar.className = 'pbar';
    bar.innerHTML = ['prev', 'first', 'last', 'next'].map(k => `<button data-go="${k}" title="${{ prev: '前', first: '最初', last: '最後', next: '次' }[k]}">${ICONS[k]}</button>`).join('');
    el.append(bar);
    bar.onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.go); };
    nr.querySelector('.both').onclick = () => { both = !both; show(); };
    document.addEventListener('keydown', e => {
      if (el.hidden || e.target?.closest?.('input,textarea')) return;
      const k = { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'first', End: 'last' }[e.key];
      if (k) { e.preventDefault(); e.stopPropagation(); go(k); }
    }, true);
  }
  function go(k) {
    const n = list.length; if (!n) return;
    const j = k === 'prev' ? i - 1 : k === 'next' ? i + 1 : k === 'first' ? 0 : n - 1;
    if (j < 0 || j >= n || j === i) return;
    i = j; show();
  }
  async function show() {
    el.querySelector('.ptitle').textContent = list.length ? `${i + 1}/${list.length}` : '0/0';
    el.querySelector('.both').innerHTML = both ? SQ2 : SQ;
    if (list[i]) await env.render(el.querySelector('iframe'), list[i], both);
  }
  function open(start = 0) { build(); list = env.list(); i = Math.max(0, Math.min(start, list.length - 1)); el.hidden = false; return show(); }
  return { open, isOpen: () => !el.hidden };
}
