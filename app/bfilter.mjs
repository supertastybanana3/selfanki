// ブラウザの「絞り込み」（AnkiMobile 25.09 の実機で見たとおり）: 絞り込みのボタンの左下に出る吹き出し。上に検索欄「フィルター」（打った文字の所を青で）、下は平らな一覧
//   決まった項目 → フラグ → 「デッキ： 名前」（フィルターデッキも。名前は全部）→「タグ： 名前」→「ノート： 名前」。名前の並びは大文字小文字を区別しない
//   押す＝検索を置き換える、横にスワイプ＝今の検索の後ろに空白でつなぐだけ（2語でも OR があっても括弧でくくらない。実機で確かめた）。どちらも吹き出しを閉じる
// 検索の書き方は rslib の build_search_string（名前の中の \ " * _ の前に \ を付け、空白か括弧があれば "key:値" 全体をくくる）。実機の例: "deck:古文cloze (test)"・tag:古文cloze・"note:古文cloze \_drawtest"
const esc = v => String(v).replace(/[\\"*_]/g, m => '\\' + m);
const quote = t => (/[\s()]/.test(t) ? `"${t}"` : t);
export const term = (key, v) => quote(`${key}:${esc(v)}`);
export const joinAnd = (existing, add) => { const ex = String(existing || '').trim(); return ex ? `${ex} ${add}` : add; };
const FLAG_NAMES = ['レッド', 'オレンジ', 'グリーン', 'ブルー', 'ピンク', 'ターコイズ', 'パープル'];
export const FIXED = [['コレクション全体', ''], ['現在のデッキ', 'deck:current'], ['今日追加した', 'added:1'], ['今日学習した', 'rated:1'], ['今日間違えた（「もう一度」と回答した）', 'rated:1:1'],
  ['新規カード', 'is:new'], ['習得中', 'is:learn'], ['学習回数', 'is:review'], ['課題 (期日・予定時刻が到来済み)', 'is:due'], ['休止中', 'is:suspended'],
  ...FLAG_NAMES.map((n, i) => [`フラグ${i + 1} (${n})`, `flag:${i + 1}`]), ['フラグなし', 'flag:0'], ['フラグあり', '-flag:0']];
const byName = (a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };

// 一覧の項目 [表示, 検索]。decks＝デッキの名前（フィルターデッキも）、tags＝タグ（親も）、notetypes＝ノートタイプの名前
export function filterItems({ decks = [], tags = [], notetypes = [] }) {
  const uniq = arr => { const m = new Map(); for (const x of arr) if (x && !m.has(x)) m.set(x, x); return [...m.values()].sort(byName); };
  const tagAll = []; for (const t of tags) { const p = t.split('::'); for (let i = 1; i <= p.length; i++) tagAll.push(p.slice(0, i).join('::')); }
  const tagMap = new Map(); for (const t of tagAll) if (!tagMap.has(t.toLowerCase())) tagMap.set(t.toLowerCase(), t);   // タグは大文字小文字を区別しない（最初に見た書き方）
  return [...FIXED,
    ...uniq(decks).map(n => [`デッキ： ${n}`, term('deck', n)]),
    ...[...tagMap.values()].sort(byName).map(n => [`タグ： ${n}`, term('tag', n)]),
    ...uniq(notetypes).map(n => [`ノート： ${n}`, term('note', n)])];
}

// env: { names(): Promise<{decks, tags, notetypes}>, current(): string, apply(query): void, anchor(): 絞り込みのボタン, host(): 吹き出しを入れる要素 }
export function createFilter(env) {
  let el = null, items = [];
  function build() {
    if (el) return el;
    el = document.createElement('div'); el.id = 'bfilter'; el.hidden = true;
    el.innerHTML = '<div class="pop"><div class="hd"><label class="sf"><svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8.5" cy="8.5" r="6"/><path d="m13 13 5 5" stroke-linecap="round"/></svg><input type="search" placeholder="フィルター" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"><button class="clr" type="button" title="消す">×</button></label></div><div class="lst"></div></div><i class="arrow"></i><button class="back" hidden></button>';
    const st = document.createElement('style');
    st.textContent = `#bfilter{position:fixed;inset:0;z-index:31}
#bfilter[hidden]{display:none}
#bfilter .pop{position:absolute;display:flex;flex-direction:column;border-radius:13px;overflow:hidden;background:var(--br-row);box-shadow:0 10px 40px rgba(0,0,0,.35)}
#bfilter .arrow{position:absolute;width:0;height:0;border-top:11px solid transparent;border-bottom:11px solid transparent;border-left:12px solid var(--br-sbar)}
#bfilter .hd{flex:none;height:55px;padding:10px 8px;background:var(--br-sbar)}
#bfilter .sf{display:flex;align-items:center;gap:6px;height:35px;border-radius:10px;background:var(--br-field);padding:0 8px 0 10px;color:var(--am-zero)}
#bfilter .sf input{flex:1;min-width:0;height:100%;border:0;background:transparent;color:var(--am-text);font-size:17px;outline:none;-webkit-appearance:none;appearance:none}
#bfilter .sf input::-webkit-search-cancel-button{display:none} #bfilter .sf input::placeholder{color:var(--am-zero)}
#bfilter .sf .clr{width:20px;height:20px;border-radius:50%;background:var(--am-zero);color:var(--br-field);font-size:15px;line-height:20px;display:flex;align-items:center;justify-content:center;border:0;padding:0}
#bfilter .sf .clr[hidden]{display:none}
#bfilter .lst{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
#bfilter .row{position:relative;min-height:45px;padding:11px 20px;box-sizing:border-box;font-size:17px;line-height:23px;color:var(--am-text);overflow-wrap:anywhere;touch-action:pan-y;transition:background .15s;-webkit-user-select:none;user-select:none}
#bfilter .row + .row::before{content:"";position:absolute;top:0;left:20px;right:0;height:.5px;background:var(--br-line)}
#bfilter .row:active,#bfilter .row.add{background:var(--br-field)}
#bfilter .hl{color:#77ccff}
#browse.bfopen > .pnav .ic{color:var(--am-zero)}`;
    el.append(st);
    const inp = el.querySelector('input'), clr = el.querySelector('.clr');
    inp.addEventListener('input', () => { clr.hidden = !inp.value; paint(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } });
    clr.onclick = e => { e.preventDefault(); inp.value = ''; clr.hidden = true; paint(); inp.focus(); };
    el.addEventListener('pointerdown', e => { if (!e.target.closest('.pop')) { e.preventDefault(); close(); } });
    el.querySelector('.back').onclick = () => close();   // Esc・Android の戻る
    (env.host?.() || document.body).append(el);
    return el;
  }
  // 吹き出しの置き場所（834pt 幅の実機: 左 119・右 719・上 62、右の辺の三角の先が (731, 82)。ボタンの真ん中は (744, 57)）
  function place() {
    const pop = el.querySelector('.pop'), ar = el.querySelector('.arrow');
    const b = env.anchor?.()?.getBoundingClientRect(); const cx = b ? b.left + b.width / 2 : innerWidth - 90, cy = b ? b.top + b.height / 2 : 57;
    const right = Math.min(innerWidth - 16, cx - 25), w = Math.min(600, right - 16), top = cy + 5;
    const vh = window.visualViewport ? visualViewport.height + visualViewport.offsetTop : innerHeight;
    Object.assign(pop.style, { left: right - w + 'px', width: w + 'px', top: top + 'px', maxHeight: Math.max(120, vh - top - 20) + 'px' });
    Object.assign(ar.style, { left: right - 0.5 + 'px', top: cy + 25 - 11 + 'px' });
  }
  function paint() {
    const lst = el.querySelector('.lst'); lst.innerHTML = '';
    const q = el.querySelector('input').value.trim().toLowerCase();
    for (const [label, query] of items) {
      const lo = label.toLowerCase(); if (q && !lo.includes(q)) continue;
      const row = document.createElement('div'); row.className = 'row';
      if (q) { let i = 0, j; while ((j = lo.indexOf(q, i)) >= 0) { row.append(label.slice(i, j)); const s = document.createElement('span'); s.className = 'hl'; s.textContent = label.slice(j, j + q.length); row.append(s); i = j + q.length; } row.append(label.slice(i)); }
      else row.textContent = label;
      // 押す＝置き換え、横にスワイプ＝今の検索の後ろにつなぐ
      let x0 = null, y0 = 0, swiped = false;
      row.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; swiped = false; });
      row.addEventListener('pointermove', e => { if (x0 == null) return; const dx = Math.abs(e.clientX - x0); if (dx > 40 && dx > 2 * Math.abs(e.clientY - y0)) { swiped = true; row.classList.add('add'); } });
      row.addEventListener('pointerup', () => { if (x0 == null) return; x0 = null; if (swiped) { close(); env.apply(joinAnd(env.current(), query)); } });
      row.addEventListener('pointercancel', () => { x0 = null; row.classList.remove('add'); });
      row.addEventListener('click', () => { if (swiped) return; close(); env.apply(query); });
      lst.append(row);
    }
  }
  const onResize = () => { if (el && !el.hidden) place(); };
  async function open() {
    build(); el.querySelector('input').value = ''; el.querySelector('.clr').hidden = true;
    let names = {}; try { names = await env.names(); } catch {}
    items = filterItems(names);
    el.hidden = false; env.host?.()?.classList.add('bfopen'); place(); paint(); el.querySelector('.lst').scrollTop = 0;
    window.visualViewport?.addEventListener('resize', onResize); window.addEventListener('resize', onResize);
    el.querySelector('input').focus({ preventScroll: true });
  }
  function close() {
    if (!el || el.hidden) return;
    el.hidden = true; env.host?.()?.classList.remove('bfopen'); el.querySelector('input').blur();
    window.visualViewport?.removeEventListener('resize', onResize); window.removeEventListener('resize', onResize);
  }
  return { open, close, isOpen: () => !!el && !el.hidden };
}
