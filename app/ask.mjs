// カードから AI に質問する「？」（中継サーバーを別に用意したときだけ出る）。
// 中継はサーバーの環境変数 ASK_URL（このリポジトリには入っていない）。中継の合言葉はアプリに持たせず、サーバー（/api/ask）が付けて取り次ぐ。
// カードの中身（デッキ名・タグ・表・裏・カード番号）を自動で添え、答えは少しずつ出す。
// 会話はカードごとにこの端末に覚える（新しいほうから400枚）。前の会話があるカードは「？」を反転して知らせ、自分では開かない（答えが見えるため）
const API = new URL('../api/ask', location.href).href;
const MATHJAX_URL = new URL('../vendor/mathjax/tex-chtml.js', location.href).href;
const ERR = { no_api_key: '（AI の API キーがまだ設定されていません）', bad_token: '（中継の合言葉が違います）', no_ask_token: '（中継の合言葉がサーバーに入っていません）', daily_limit: '（今日の上限回数に達しました）', empty: '（質問が空です）' };
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

export function createAsk({ getCard, getSide, deckName, penImage, hasStrokes, cardById }) {
  const st = { open: false, busy: false, cid: null, hist: [], raf: 0, drag: null };
  const btn = $('#ask'), panel = $('#askPanel'), log = $('#ask-log'), q = $('#ask-q'), send = $('#ask-send'), imgRow = $('#ask-imgl'), img = $('#ask-img');

  // ---- カードの中身を文字にする（式は TeX のまま。カードの HTML には組む前の \( \) が入っている） ----
  function h2t(h) {
    h = h.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|tr|h\d|blockquote)>/gi, '\n').replace(/<hr[^>]*>/gi, '\n---\n')
      .replace(/<img[^>]*?src=["']?([^"' >]+)[^>]*>/gi, '[画像 $1]').replace(/\[anki:play:[qa]:\d+\]/g, '');
    const d = new DOMParser().parseFromString(`<body>${h}</body>`, 'text/html');
    return (d.body.textContent || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function cardInfo() {
    const c = getCard(), side = getSide();
    const r = { deck: deckName(c.did), tags: (c.tags || []).join(' '), cid: String(c.id), side: side === 'a' ? 'back' : 'front', front: '', back: '' };
    if (side !== 'a') { r.front = h2t(c.q); return r; }
    const m = c.a.match(/<hr[^>]*id=["']?answer["']?[^>]*>/i);
    if (m) { r.front = h2t(c.a.slice(0, m.index)); r.back = h2t(c.a.slice(m.index + m[0].length)); if (!r.back) { r.back = r.front; r.front = ''; } }
    else { r.front = h2t(c.q); r.back = h2t(c.a); }
    return r;
  }

  // ---- 同じ単語の別のカードで前にした質問と答え（中継がプロンプトの <related> に入れる） ----
  // 単語の見分け: 裏に見出し語（span.hw）がある型はそれ、ほかは表が英単語・熟語だけ（3語まで）のときその語。大文字小文字は区別しない
  const words = new Map();
  function wordOf(c) {
    if (!c) return null;
    if (words.has(c.id)) return words.get(c.id);
    let w = null; const m = c.a.match(/<span class="hw">([^<]+)<\/span>/);
    if (m) w = m[1].trim().toLowerCase();
    else { const f = h2t(c.q).trim(); if (/^[A-Za-z][A-Za-z' -]{0,40}$/.test(f) && f.split(/\s+/).length <= 3) w = f.toLowerCase(); }
    words.set(c.id, w); return w;
  }
  function relatedFor(c) {
    const w = wordOf(c); if (!w) return null;
    const items = [];
    for (const id of ls.get('askHistIdx', [])) {
      if (String(id) === String(c.id)) continue;
      const oc = cardById(+id); if (wordOf(oc) !== w) continue;
      const h = ls.get(key(id), null); if (!h) continue;
      for (const e of h.hist) items.push({ deck: deckName(oc.did), front: h2t(oc.q).slice(0, 200), q: e.q, a: e.a });
    }
    return items.length ? { word: w, items: items.slice(-8) } : null;
  }

  // ---- カードごとの会話 ----
  const key = cid => `askHist:${cid}`;
  function save(cid, arr) {
    // 答えを作っている途中の質問も番号（rid）ごと残す（アプリが裏に回ったり落ちたりしても、あとで答えを取りに行けるように）
    const h = arr.filter(e => !e.failed && (e.a || (e.pending && e.rid))).map(e => (e.pending && e.rid ? { q: e.q, a: e.a, rid: e.rid, pending: true } : { q: e.q, a: e.a }));
    const idx = ls.get('askHistIdx', []).filter(x => x !== cid);
    if (h.length) { ls.set(key(cid), { t: Date.now(), hist: h }); idx.push(cid); } else ls.set(key(cid), null);
    while (idx.length > 400) ls.set(key(idx.shift()), null);
    ls.set('askHistIdx', idx);
  }
  const paintBtn = () => btn.classList.toggle('has', st.hist.some(e => !e.pending && !e.failed && e.a));

  // ---- 答えの表示（**太字**・箇条書き・見出し・改行。式は崩さず MathJax で組む） ----
  function fmtText(t) {
    let h = esc(t);
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/^[ \t]*[-*][ \t]+/gm, '・').replace(/^#{1,6}[ \t]*(.+)$/gm, '<b>$1</b>');
    return h.replace(/\n/g, '<br>');
  }
  function fmtAll(t) {
    const math = [];
    t = String(t).replace(/\n+(\\\[)/g, '$1').replace(/(\\\])\n+/g, '$1');
    t = t.replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, m => { math.push(m); return '\u0000' + (math.length - 1) + '\u0000'; });
    return fmtText(t).replace(/\u0000(\d+)\u0000/g, (_, i) => esc(math[+i]).replace(/\n/g, ' '));
  }
  let mj = null;
  function typeset(node) {
    if (!/\\\(|\\\[/.test(node.textContent)) return;
    if (!mj) mj = new Promise(res => {
      window.MathJax = { tex: { inlineMath: [['\\(', '\\)']], displayMath: [['\\[', '\\]']], packages: { '[+]': ['mhchem'] } }, loader: { load: ['[tex]/mhchem'] }, startup: { typeset: false, ready() { MathJax.startup.defaultReady(); res(); } }, chtml: { displayAlign: 'left' } };
      const s = document.createElement('script'); s.src = MATHJAX_URL; s.async = true; document.head.appendChild(s);
    });
    mj.then(() => window.MathJax.typesetPromise([node])).catch(() => {});
  }
  function render() {
    cancelAnimationFrame(st.raf); st.raf = 0;
    if (!st.hist.length) { log.innerHTML = '<div class="ask-sub">このカードについて質問できます。カードの中身（表・裏・デッキ名）は自動で添えます。</div>'; return; }
    log.innerHTML = st.hist.map((e, i) => `<div class="ask-qb">${esc(e.q)}</div><div class="ask-ab" data-ans="${i}">${e.a ? fmtAll(e.a) : (e.pending ? '<span class="ask-sub">考え中…</span>' : '')}</div>`).join('');
    if (!st.busy) typeset(log);
    log.scrollTop = log.scrollHeight;
  }
  function updateLast(entry) {
    if (st.raf) return;
    st.raf = requestAnimationFrame(() => {
      st.raf = 0; const i = st.hist.indexOf(entry); const n = log.querySelector(`[data-ans="${i}"]`);
      if (n) { n.innerHTML = fmtAll(entry.a); log.scrollTop = log.scrollHeight; }
    });
  }

  // ---- 送る ----
  async function doSend() {
    if (st.busy) return;
    const text = q.value.trim(); if (!text) return;
    const rid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
    const entry = { q: text, a: '', pending: true, rid };
    const prior = st.hist.filter(h => !h.failed).map(h => ({ q: h.q, a: h.a }));
    st.hist.push(entry); q.value = '';
    const body = { q: text, rid, card: cardInfo(), history: prior, image: img.checked && hasStrokes() ? penImage() : null, related: relatedFor(getCard()) };
    st.busy = true; send.classList.add('busy'); send.textContent = '…'; render();
    const cid = st.cid, thread = st.hist; // 答えの途中で次のカードへ進んでも、質問したカードの会話として残す
    save(cid, thread);
    let cut = false;
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); entry.a = ERR[j.error] || `（エラー ${res.status}）`; entry.failed = true; }
      else if (res.body && res.body.getReader) {
        const rd = res.body.getReader(), dec = new TextDecoder();
        for (;;) { const x = await rd.read(); if (x.done) { entry.a += dec.decode(); break; } entry.a += dec.decode(x.value, { stream: true }); if (thread === st.hist) updateLast(entry); }
      } else entry.a = await res.text();
    } catch (e) { cut = true; }
    st.busy = false; send.classList.remove('busy'); send.textContent = '送る';
    // 途中で受け取りが切れた（アプリが裏に回った・電波が切れた）ときは、作り終わった答えを番号で取りに行く
    if (cut) { recover(entry, cid, thread); return; }
    entry.pending = false; delete entry.rid;
    save(cid, thread);
    if (thread === st.hist) { render(); paintBtn(); }
  }
  // 裏に回っていた間の答えを取りに行く（中継が最後まで作って保存している）。3分たっても終わらなければあきらめる
  const recovering = new Set();
  async function recover(entry, cid, thread) {
    const rid = entry.rid;
    if (!rid || recovering.has(rid)) return;
    recovering.add(rid);
    const t0 = Date.now(); let missing = 0;
    while (Date.now() - t0 < 180000) {
      try {
        const r = await fetch(API + '?rid=' + encodeURIComponent(rid), { cache: 'no-store', credentials: 'same-origin' });
        const j = r.ok ? await r.json() : null;
        if (j && j.missing) { if (++missing > 20) break; }
        else if (j && typeof j.a === 'string') {
          if (j.a.length >= entry.a.length) { entry.a = j.a; if (thread === st.hist) updateLast(entry); }
          if (j.done) { entry.pending = false; delete entry.rid; break; }
        }
      } catch (e) { /* つながらないあいだは待つ */ }
      if (document.hidden) { recovering.delete(rid); return; } // また裏に回ったら、前に戻ったときにやり直す
      await new Promise(res => setTimeout(res, 1500));
    }
    if (entry.pending) { entry.pending = false; delete entry.rid; entry.a += (entry.a ? '\n\n' : '') + '（答えを最後まで受け取れませんでした。もう一度聞いてください）'; }
    recovering.delete(rid);
    save(cid, thread);
    if (thread === st.hist) { render(); paintBtn(); }
  }
  // 前に戻ったとき・カードを開いたときに、途中の答えがあれば取りに行く
  const resumePending = () => { if (document.hidden || st.busy) return; for (const e of st.hist) if (e.pending && e.rid) recover(e, st.cid, st.hist); };
  document.addEventListener('visibilitychange', resumePending);
  window.addEventListener('focus', resumePending); window.addEventListener('online', resumePending); window.addEventListener('pageshow', resumePending);

  // ---- パネルの位置（見出しをつかんで動かす。置いた場所は覚える） ----
  // 置いた高さに合わせてパネルの高さを縮める（下へ動かすほど低く、上へ戻すと伸びる。Anki 版と同じ）
  function place(pos) {
    const host = $('#cardhost').getBoundingClientRect();
    if (!pos) { panel.style.left = ''; panel.style.top = ''; panel.style.right = '10px'; panel.style.maxHeight = ''; return; }
    const w = panel.offsetWidth, l = Math.max(0, Math.min(pos.l, host.width - w)), t = Math.max(0, Math.min(pos.t, host.height - 240)); // いちばん低くしても（220px）送るが画面に残る所で止める
    panel.style.right = 'auto'; panel.style.left = l + 'px'; panel.style.top = t + 'px';
    panel.style.maxHeight = Math.max(220, host.height - t - 20) + 'px';
    return { l, t };
  }
  window.addEventListener('resize', () => { if (st.open) place(ls.get('askPanelPos', null)); });
  const bar = panel.querySelector('.ask-bar');
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect(), host = $('#cardhost').getBoundingClientRect();
    st.drag = { id: e.pointerId, dx: e.clientX - r.left + host.left, dy: e.clientY - r.top + host.top, pos: null };
    bar.setPointerCapture(e.pointerId); e.preventDefault();
  });
  bar.addEventListener('pointermove', e => { if (st.drag && e.pointerId === st.drag.id) st.drag.pos = place({ l: e.clientX - st.drag.dx, t: e.clientY - st.drag.dy }); });
  const endDrag = e => { if (!st.drag || e.pointerId !== st.drag.id) return; if (st.drag.pos) ls.set('askPanelPos', st.drag.pos); st.drag = null; };
  bar.addEventListener('pointerup', endDrag); bar.addEventListener('pointercancel', endDrag);

  function setOpen(o) {
    st.open = o; panel.hidden = !o;
    if (o) { place(ls.get('askPanelPos', null)); imgRow.hidden = !hasStrokes(); render(); try { q.focus(); } catch {} }
    else { try { q.blur(); } catch {} }
  }
  btn.onclick = () => setOpen(!st.open);
  $('#ask-close').onclick = () => setOpen(false);
  $('#ask-new').onclick = () => { if (st.busy) return; st.hist = []; save(st.cid, []); render(); paintBtn(); };
  send.onclick = doSend;
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doSend(); } });
  // パネルの中のキー入力は、カードめくり・評価（スペース・1〜4）に渡さない
  for (const t of ['keydown', 'keyup', 'keypress']) panel.addEventListener(t, e => e.stopPropagation());

  // AnkiMobile の「？」でした会話（配ったファイル）を端末の記録に足す。同じ質問は入れない。一度入れたもの（cid と最後の時刻）は覚えて、
  // 「新しく」で消したあとに戻ってこないようにする
  function importHistory(list) {
    const done = new Set(ls.get('askImported', [])); let n = 0;
    for (const x of list || []) {
      const mark = `${x.cid}:${x.last}`; if (done.has(mark)) continue;
      const cid = String(x.cid), local = ls.get(key(cid), null)?.hist || [];
      const seen = new Set(local.map(e => e.q + '\u0000' + e.a));
      const add = x.hist.filter(e => !seen.has(e.q + '\u0000' + e.a));
      if (add.length) { save(cid, [...add, ...local]); n += add.length; }
      done.add(mark);
      if (st.cid === cid && !st.busy) { st.hist = ls.get(key(cid), null)?.hist || []; paintBtn(); }
    }
    ls.set('askImported', [...done].slice(-2000));
    return n;
  }
  return {
    importHistory, relatedFor,
    // カードが変わったら（表→裏は同じカード）、そのカードの前の会話を読み、パネルは閉じる
    onCard(card) {
      if (!card) { setOpen(false); st.cid = null; st.hist = []; paintBtn(); return; }
      const cid = String(card.id);
      if (st.cid !== cid) { st.cid = cid; st.hist = ls.get(key(cid), null)?.hist || []; setOpen(false); }
      paintBtn(); resumePending();
    },
    isOpen: () => st.open,
  };
}
