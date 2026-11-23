// 「カードテンプレート」（学習画面のアクション）と、ブラウザの「ノートタイプを変更」の画面。
// カードテンプレートは AnkiMobile 25.09 の実機（11/23）のとおり: 上に 戻る・「カードテンプレート」・元に戻す（変えるまで薄い）、その下に「表面｜裏面｜スタイル｜プレビュー」、
// 中は今のカードのカードタイプのテンプレートをそのまま直す欄。プレビューでは右上が「反転」（表と裏）。戻ると保存する。
// 実機に無い「オプション」（カードタイプの追加・削除・名前変更・順序）と「フィールド...」は、?debug のときだけ出す（同期の仕組みの試験のため。関数と同期は残す）。
// 決まりは app/ntedit.mjs（rslib の写し）、ノートとカードの書き換えは app/notes.mjs、保存は conf の nt:<id>（アドオンが Anki に書く）
import { prepareNotetype, finalizeOrds, randomId, NtError, defaultFieldMap, defaultTemplateMap, templateMap, singleNotetype, fixFieldName } from './ntedit.mjs';
import { renderCard } from './template.mjs';
import { ntTo11 } from './exchange.mjs';

const DEV = (() => { try { return new URLSearchParams(location.search).has('debug'); } catch { return false; } })();
const BACK_SVG = '<svg viewBox="0 0 12 20" width="12" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>';
const SEGS = [['q', '表面'], ['a', '裏面'], ['css', 'スタイル'], ['pv', 'プレビュー']];
const CSS = `#ntpage{position:fixed;inset:0;z-index:29;background:var(--am-bg);color:var(--am-text);display:flex;flex-direction:column}
#ntpage[hidden],#ntpage [hidden]{display:none !important}
#ntpage .pnav{flex:none;height:calc(50.5px + env(safe-area-inset-top));padding-top:env(safe-area-inset-top);display:grid;grid-template-columns:1fr auto 1fr;align-items:center;background:var(--am-bar);border-bottom:.5px solid var(--am-barline)}
#ntpage .pnav button{height:44px;padding:0 14px;color:var(--am-bartext);font-size:17px} #ntpage .pnav .l{justify-self:start} #ntpage .pnav .r{justify-self:end;font-weight:600}
#ntpage .pnav .t{font-size:17px;font-weight:600;color:var(--am-bartitle,var(--am-text));max-width:52vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ntpage .bar{flex:none;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;border-bottom:.5px solid var(--am-sep)}
#ntpage select{font-size:15px;padding:4px 6px;border-radius:7px;border:.5px solid var(--am-sep);background:var(--am-bg);color:var(--am-text);max-width:60vw}
#ntpage .btn{font-size:15px;color:var(--am-blue);padding:5px 8px;border-radius:7px}
#ntpage .seg{display:flex;border:1px solid var(--am-blue);border-radius:8px;overflow:hidden} #ntpage .seg button{font-size:14px;padding:5px 10px;color:var(--am-blue)} #ntpage .seg button.on{background:var(--am-blue);color:#fff}
#ntpage textarea{flex:1;margin:0;border:0;padding:10px 12px;font:14px/1.45 ui-monospace,Menlo,monospace;background:var(--am-bg);color:var(--am-text);resize:none;outline:none}
#ntpage .list{flex:1;overflow:auto} #ntpage .row{display:flex;align-items:center;gap:10px;min-height:46px;padding:0 14px;border-bottom:.5px solid var(--am-sep);font-size:16px}
#ntpage .row .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} #ntpage .row .s{font-size:13px;color:var(--am-zero)}
#ntpage .sec{font-size:13px;color:var(--am-zero);padding:14px 14px 6px} #ntpage .note{font-size:13px;line-height:1.5;padding:6px 14px;white-space:pre-wrap}
#ntpage iframe{flex:1;border:0;background:#fff}
#ntpage .pnav .l{display:flex;align-items:center;gap:6px} #ntpage .pnav .r:disabled{color:var(--am-zero);opacity:.6} #ntpage .pnav .r.tm{font-weight:400}
#ntpage .segw{flex:none;display:flex;justify-content:center;padding:8px 12px 6px}
#ntpage .seg2{display:flex;padding:2px;border-radius:9px;background:var(--nt-seg,#232325)} #ntpage .seg2 button{min-width:80px;height:30px;padding:0 12px;border-radius:7px;font-size:15px;color:var(--am-text);opacity:.65}
#ntpage .pnav .t{color:var(--am-text)}   /* 実機は白（デッキの一覧の題のような青ではない） */
#ntpage .seg2 button.on{background:var(--nt-segon,#444449);opacity:1;font-weight:600}
#ntpage textarea.code{font:12px/1.5 ui-monospace,Menlo,monospace;padding:12px 8px}
@media (prefers-color-scheme:light){:root:not([data-theme=dark]) #ntpage{--nt-seg:#e3e3e8;--nt-segon:#fff}} :root[data-theme=light] #ntpage{--nt-seg:#e3e3e8;--nt-segon:#fff}
#ntsheet{position:fixed;inset:0;z-index:82;background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center}
#ntsheet .box{width:min(420px,100%);margin:0 8px calc(8px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px}
#ntsheet .g{border-radius:13px;overflow:hidden;background:var(--al-bg,#fff)} #ntsheet button{display:block;width:100%;height:56px;font-size:19px;color:var(--am-blue);border-top:.5px solid var(--am-sep)}
#ntsheet .g button:first-child{border-top:0} #ntsheet button.red{color:#ff3b30} #ntsheet .c{font-weight:600}`;

export function createNtScreen(env) {
  const { S, notes } = env;
  let el = null, st = null;   // st: { mode, mid, work, prevNt, ti, side, card, page }
  const tr = {
    saved: '変更を保存しました。', discard: '変更を破棄しますか？', atLeastOneCard: '最低一つのカードタイプが必要です。', atLeastOneField: 'ノートには最低一つのフィールドが必要です。',
    fieldUsed: 'そのフィールド名は既に使用しています。', delField: n => `${n} からこのフィールドを削除しますか？`,
    delCard: (t, n) => `カードタイプ「${t}」とそれを使用している${n}枚のカードを削除しますか？`, createCards: n => `${n}枚のカードが作成されます。続行しますか？`,
    newPos: n => `カードの新しい位置を入力してください (1...${n}):`, newFieldPos: n => `新しい位置 (1...${n}):`, cardN: n => `カード ${n}`,
  };
  const ask = (title, message, o = {}) => env.prompt({ title, message, ...o });
  const sheet = items => new Promise(res => {
    const d = document.createElement('div'); d.id = 'ntsheet';
    const box = document.createElement('div'); box.className = 'box'; const g = document.createElement('div'); g.className = 'g';
    for (const [t, v, cls] of items) { const b = document.createElement('button'); b.textContent = t; if (cls) b.className = cls; b.onclick = () => { d.remove(); res(v); }; g.append(b); }
    const g2 = document.createElement('div'); g2.className = 'g'; const c = document.createElement('button'); c.className = 'c'; c.textContent = 'キャンセル'; c.onclick = () => { d.remove(); res(null); }; g2.append(c);
    box.append(g, g2); d.append(box); d.onclick = e => { if (e.target === d) { d.remove(); res(null); } }; document.body.append(d);
  });
  function build() {
    if (el) return el;
    const s = document.createElement('style'); s.textContent = CSS; document.head.append(s);
    el = document.createElement('div'); el.id = 'ntpage'; el.hidden = true; document.body.append(el);
    return el;
  }
  const clone = x => structuredClone(x);
  const working = n => { const w = clone(n); w.fields.forEach((f, i) => { f.ord = i; }); w.templates.forEach((t, i) => { t.ord = i; }); return w; };
  const dirty = () => JSON.stringify(st.work) !== st.orig;
  // そのノートタイプのカードの数（テンプレートごと）
  const cardsOf = (mid, ord) => S.all.filter(c => !c.gone && +c.mid === +mid && (ord == null || c.ord === ord)).length;
  const notesCount = mid => notes.notesOfType(mid).length;

  // ---------- カードテンプレート ----------
  async function openTemplates(card) {
    if (!card || !S.meta.notetypes?.[card.mid]) return;
    const nt0 = S.meta.notetypes[card.mid];
    st = { mode: 'tmpl', mid: +card.mid, work: working(nt0), ti: nt0.type === 1 ? 0 : Math.min(card.ord, nt0.templates.length - 1), side: 'q', pvSide: 'q', card, page: 'edit' };
    st.orig = JSON.stringify(st.work);
    build(); el.hidden = false; paint();
  }
  function paint() {
    const w = st.work, t = w.templates[st.ti];
    if (st.page === 'fields') return paintFields();
    const pv = st.side === 'pv';
    el.innerHTML = `<nav class="pnav"><button class="l">${BACK_SVG}<span>戻る</span></button><span class="t">カードテンプレート</span><button class="r${pv ? '' : ' tm'}"></button></nav>
<div class="segw"><div class="seg2">${SEGS.map(([k, l]) => `<button data-s="${k}">${l}</button>`).join('')}</div></div>
${DEV ? '<div class="bar dev"><select class="tsel"></select><button class="btn opt">オプション</button><button class="btn flds">フィールド...</button></div>' : ''}
${pv ? '<iframe title="プレビュー"></iframe>' : '<textarea class="code" spellcheck="false" autocapitalize="off" autocorrect="off"></textarea>'}`;
    for (const b of el.querySelectorAll('.seg2 button')) { b.classList.toggle('on', b.dataset.s === st.side); b.onclick = () => { keep(); st.side = b.dataset.s; paint(); }; }
    const r = el.querySelector('.r');
    if (pv) { r.textContent = '反転'; r.onclick = () => { st.pvSide = st.pvSide === 'q' ? 'a' : 'q'; showPreview(); }; showPreview(); }
    else {
      const ta = el.querySelector('textarea'); ta.value = st.side === 'css' ? w.css : st.side === 'q' ? t.qfmt : t.afmt;
      r.textContent = '元に戻す'; r.disabled = !dirty();
      ta.addEventListener('input', () => { keep(); r.disabled = !dirty(); });
      r.onclick = () => { st.work = JSON.parse(st.orig); paint(); };   // 開いたときの中身に戻す
    }
    el.querySelector('.l').onclick = () => back();
    if (DEV) {
      const sel = el.querySelector('.tsel');
      w.templates.forEach((x, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${i + 1}: ${x.name}`; sel.append(o); });
      sel.value = st.ti; sel.onchange = () => { keep(); st.ti = +sel.value; paint(); };
      el.querySelector('.opt').onclick = () => options();
      el.querySelector('.flds').onclick = () => { keep(); st.page = 'fields'; paint(); };
    }
  }
  // 戻る: 変えていれば保存してから閉じる（実機には保存のボタンが無い）
  async function back() { keep(); if (dirty()) await save(); else hide(); }
  function keep() {
    if (st.page !== 'edit' || st.side === 'pv') return;
    const ta = el.querySelector('textarea.code'); if (!ta) return;
    const t = st.work.templates[st.ti];
    if (st.side === 'css') st.work.css = ta.value; else if (st.side === 'q') t.qfmt = ta.value; else t.afmt = ta.value;
  }
  async function options() {
    keep();
    const w = st.work, cloze = w.type === 1;
    const items = [];
    if (!cloze) items.push(['カードタイプを追加...', 'add'], ['このカードタイプを削除', 'del', 'red']);
    items.push(['このカードタイプ名を変更...', 'ren']);
    if (!cloze) items.push(['このカードタイプの順序を変更...', 'pos']);
    const k = await sheet(items); if (!k) return;
    const t = w.templates[st.ti];
    if (k === 'add') {
      const n = notesCount(st.mid);
      if (n && !(await env.confirm('', tr.createCards(n), { ok: 'はい', cancel: 'いいえ' }))) return;
      let i = w.templates.length + 1; const names = new Set(w.templates.map(x => x.name)); while (names.has(tr.cardN(i))) i++;
      w.templates.push({ name: tr.cardN(i), ord: null, qfmt: t.qfmt, afmt: t.afmt, did: null, x: { id: randomId() } });
      st.ti = w.templates.length - 1;
    } else if (k === 'del') {
      if (w.templates.length < 2) { env.alert('', tr.atLeastOneCard); return; }
      const n = t.ord == null ? 0 : cardsOf(st.mid, t.ord);
      if (!(await env.confirm('', tr.delCard(t.name, n), { ok: 'はい', cancel: 'いいえ' }))) return;
      w.templates.splice(st.ti, 1); st.ti = Math.max(0, st.ti - 1);
    } else if (k === 'ren') {
      const r = await ask('名前を変更', '新しい名前:', { input: t.name }); if (!r || !r.value.trim()) return;
      t.name = r.value.trim();
    } else if (k === 'pos') {
      const r = await ask('並び替える', tr.newPos(w.templates.length), { input: String(st.ti + 1) }); if (!r) return;
      const p = Math.trunc(Number(r.value)); if (!(p >= 1 && p <= w.templates.length)) return;
      const [x] = w.templates.splice(st.ti, 1); w.templates.splice(p - 1, 0, x); st.ti = p - 1;
    }
    paint();
  }
  // ---------- フィールド ----------
  function paintFields() {
    const w = st.work;
    el.innerHTML = `<nav class="pnav"><button class="l">‹ 戻る</button><span class="t"></span><span></span></nav><div class="list"></div><div class="bar"><button class="btn add">フィールドを追加</button></div>`;
    el.querySelector('.t').textContent = `${w.name} のフィールド`;
    const list = el.querySelector('.list');
    w.fields.forEach((f, i) => {
      const r = document.createElement('button'); r.className = 'row'; r.style.width = '100%';
      r.innerHTML = '<span class="n"></span><span class="s"></span>'; r.querySelector('.n').textContent = `${i + 1}: ${f.name}`;
      if (sortIdx() === i) r.querySelector('.s').textContent = 'ソート';
      r.onclick = () => fieldMenu(i); list.append(r);
    });
    el.querySelector('.l').onclick = () => { st.page = 'edit'; paint(); };
    el.querySelector('.add').onclick = () => addField();
  }
  // ソートフィールドは、直す前の位置（ord）で持つ（rslib と同じ）。画面では今の並びの何番目かを出す
  const sortIdx = () => { const w = st.work, i = w.fields.findIndex(f => f.ord === (w.sortf || 0)); return i >= 0 ? i : Math.min(w.sortf || 0, w.fields.length - 1); };
  function checkName(name, except) {
    let n; try { n = fixFieldName(name); } catch { return null; }
    if (st.work.fields.some((f, i) => i !== except && f.name.toLowerCase() === n.toLowerCase())) { env.alert('', tr.fieldUsed); return null; }
    return n;
  }
  async function addField() {
    const r = await ask('フィールドを追加', 'フィールド名:', { input: '' }); if (!r || !r.value.trim()) return;
    const n = checkName(r.value.trim(), -1); if (!n) return;
    st.work.fields.push({ name: n, ord: null, sticky: false, rtl: false, font: 'Arial', size: 20, description: '', plainText: false, excludeFromSearch: false, x: { id: randomId() } });
    paint();
  }
  async function fieldMenu(i) {
    const w = st.work, f = w.fields[i];
    const k = await sheet([['名前を変更', 'ren'], ['並び替える', 'pos'], ['このフィールドをブラウザでのソート（並び替え用）フィールドにする', 'sort'], ['削除', 'del', 'red']]); if (!k) return;
    if (k === 'ren') {
      const r = await ask('名前を変更', 'フィールド名:', { input: f.name }); if (!r || !r.value.trim()) return;
      const n = checkName(r.value.trim(), i); if (!n) return; f.name = n;
    } else if (k === 'pos') {
      const r = await ask('並び替える', tr.newFieldPos(w.fields.length), { input: String(i + 1) }); if (!r) return;
      const p = Math.trunc(Number(r.value)); if (!(p >= 1 && p <= w.fields.length)) return;
      const [x] = w.fields.splice(i, 1); w.fields.splice(p - 1, 0, x);
    } else if (k === 'sort') {
      if (f.ord == null) { env.alert('', '保存してから選んでください。'); return; }
      w.sortf = f.ord;
    } else if (k === 'del') {
      if (w.fields.length < 2) { env.alert('', tr.atLeastOneField); return; }
      if (!(await env.confirm('', tr.delField(w.name), { ok: 'はい', cancel: 'いいえ' }))) return;
      w.fields.splice(i, 1);
    }
    paint();
  }
  // ---------- プレビュー（今のカードのノートを、直している途中のテンプレートとスタイルで描く。「反転」で表と裏） ----------
  async function showPreview() {
    const f = el.querySelector('iframe'); if (!f) return;
    const w = clone(st.work), notesMap = await env.loadNotes(), n = notesMap.get(st.card.nid);
    const prev = S.meta.notetypes[st.mid];
    let html;
    try {
      prepareNotetype(w, prev, { skipChecks: true });
      // 直す前のフィールドの並びのノートを、今の並びに直して描く
      const flds0 = n ? n.flds.split('\x1f') : [];
      const flds = w.fields.map(f => (f.ord == null ? '' : flds0[f.ord] ?? ''));
      finalizeOrds(w);
      const t = { name: w.name, type: w.type, sortf: w.sortf, flds: w.fields, tmpls: w.templates };
      const ord = w.type === 1 ? st.card.ord : st.ti;
      const r = renderCard(t, { fields: flds, tags: (n?.tags || '').trim().split(/\s+/).filter(Boolean) }, { ord, flags: st.card.flags || 0, id: st.card.id, deckName: env.deckName(st.card.did) });
      html = st.pvSide === 'q' ? r.q : r.a;
    } catch (e) { html = `<p>${String(e.message || e).replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))}</p>`; }
    if (!el.contains(f)) return;
    if (env.showPreview) await env.showPreview(f, { a: html, mid: st.mid, css: w.css });
    else f.srcdoc = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${w.css}</style><body class="card">${html}</body>`;
  }
  // ---------- 保存 ----------
  async function save() {
    keep();
    if (!dirty()) { hide(); return; }   // 何も変えていなければ、何も送らない
    const mid = st.mid, prevNt = S.meta.notetypes[mid], w = clone(st.work);
    let plan;
    try { plan = prepareNotetype(w, prevNt); } catch (e) { env.alert('', e instanceof NtError ? e.message : String(e?.message || e)); return; }
    finalizeOrds(w);
    for (const x of [...w.fields, ...w.templates]) { x.x = x.x || {}; if (!x.x.id) x.x.id = randomId(); }
    await commitNt(mid, w, plan, prevNt, 'カードテンプレート');
    st.orig = JSON.stringify(st.work);
    env.toast(tr.saved); hide();
  }
  // 前の形にあって新しい形に無いフィールド・カードの種類（＝端末で消したもの）。アドオンはこれだけを Anki から消す（端末が知らなかったものは残す）
  const removedOf = (prev, next) => {
    const gone = (a, b) => { const ids = new Set(b.map(x => x.x?.id).filter(Boolean)), names = new Set(b.map(x => x.name)); return a.filter(x => (x.x?.id ? !ids.has(x.x.id) : !names.has(x.name))).map(x => ({ id: x.x?.id ? String(x.x.id) : null, name: x.name })); };
    return { fields: gone(prev.fields || [], next.fields || []), templates: gone(prev.templates || [], next.templates || []) };
  };
  async function commitNt(mid, w, plan, prevNt, label) {
    const prevCopy = clone(prevNt);
    const { rev: _r, ...body } = w;
    const v = ntTo11(mid, body); v.saRemoved = removedOf(prevNt, w);
    await env.commitConf([{ k: 'nt:' + mid, v, rev: Math.max(Date.now(), (prevNt.rev || 0) + 1) }]);
    const items = await notes.notetypeEdited(mid, plan);
    await notes.rerender([mid]);
    env.pushUndo({ kind: 'nt', label, mid, prevNt: prevCopy, items });
    env.changed();
  }
  // 元に戻す／やり直す（app.mjs の revertEntry から）: ノートタイプを前のものに戻し、書き換えたノートを前の中身とカードに戻す
  async function revert(e) {
    const cur = S.meta.notetypes[e.mid], { rev: _r, ...body } = e.prevNt;
    const v = ntTo11(e.mid, body); v.saRemoved = removedOf(cur || {}, e.prevNt);   // 元に戻す: 戻したときに無くなるもの（端末で足したもの）だけを消す
    await env.commitConf([{ k: 'nt:' + e.mid, v, rev: Math.max(Date.now(), (cur?.rev || 0) + 1) }]);
    if (e.items.length) await notes.undo({ items: e.items });
    await notes.rerender([e.mid]);
    env.changed();
  }
  async function inverse(e) { return { ...e, prevNt: clone(S.meta.notetypes[e.mid]), items: (await notes.inverse({ items: e.items })).items }; }
  async function close() { if (st && st.mode === 'tmpl') return back(); hide(); }
  function hide() { if (el) { el.hidden = true; el.innerHTML = ''; } st = null; }

  // ---------- ブラウザの「ノートタイプを変更」 ----------
  async function openChange(cards) {
    const nids = [...new Set(cards.map(c => c.nid))];
    let oldMid; try { oldMid = singleNotetype(cards.map(c => +c.mid)); } catch (e) { env.alert('', e.message); return; }
    const list = Object.entries(S.meta.notetypes).filter(([, n]) => Array.isArray(n.templates) && n.templates.length && n.templates.every(t => typeof t.qfmt === 'string')).sort((a, b) => a[1].name.localeCompare(b[1].name));
    st = { mode: 'chg', nids, oldMid, newMid: oldMid, fmap: null, tmap: null };
    build(); el.hidden = false;
    const reset = () => { const o = S.meta.notetypes[st.oldMid], n = S.meta.notetypes[st.newMid]; st.fmap = defaultFieldMap(o, n); st.tmap = defaultTemplateMap(o, n); };
    reset();
    const draw = () => {
      const o = S.meta.notetypes[st.oldMid], n = S.meta.notetypes[st.newMid];
      el.innerHTML = `<nav class="pnav"><button class="l">キャンセル</button><span class="t">ノートタイプを変更</span><button class="r">保存</button></nav>
<div class="list"><div class="sec">現在のノートタイプ: <b class="on"></b></div><div class="bar">変更後のノートタイプ: <select class="nsel"></select></div>
<div class="sec">フィールド</div><div class="fl"></div><div class="tsec"><div class="sec">テンプレート</div><div class="tl"></div></div><div class="note warn"></div></div>`;
      el.querySelector('.on').textContent = o.name;
      const nsel = el.querySelector('.nsel');
      for (const [id, x] of list) { const op = document.createElement('option'); op.value = id; op.textContent = x.name; nsel.append(op); }
      nsel.value = st.newMid; nsel.onchange = () => { st.newMid = +nsel.value; reset(); draw(); };
      const rowSel = (label, opts, val, on) => {
        const r = document.createElement('div'); r.className = 'row'; const s = document.createElement('span'); s.className = 'n'; s.textContent = label;
        const sel = document.createElement('select'); opts.forEach((t, i) => { const op = document.createElement('option'); op.value = i; op.textContent = t; sel.append(op); });
        const none = document.createElement('option'); none.value = ''; none.textContent = '(なし)'; sel.append(none);
        sel.value = val == null ? '' : String(val); sel.onchange = () => { on(sel.value === '' ? null : +sel.value); draw(); };
        r.append(s, sel); return r;
      };
      const fl = el.querySelector('.fl');
      n.fields.forEach((f, i) => fl.append(rowSel(f.name, o.fields.map(x => x.name), st.fmap[i], v => { st.fmap[i] = v; })));
      const tl = el.querySelector('.tl'), warn = [];
      if (st.tmap) n.templates.forEach((t, i) => tl.append(rowSel(t.name, o.templates.map(x => x.name), st.tmap[i], v => { st.tmap[i] = v; })));
      else { el.querySelector('.tsec').hidden = true; warn.push('穴埋め問題ノートタイプへ変更、あるいは穴埋め問題から別のノートタイプへ変更する場合、カード番号はそのまま変わりません。\n\n穴埋め問題ノートタイプから通常のノートタイプへ変更する際、カードテンプレートよりも多くの穴埋め問題がある場合は、超過分のカードは削除されます。'); }
      const lostF = o.fields.filter((_, i) => !st.fmap.includes(i)).map(f => f.name);
      if (lostF.length) warn.push('これらのフィールドの内容が破棄されます: ' + lostF.join(', '));
      if (st.tmap) { const lostT = templateMap(st.tmap, o.templates.length).removed.map(i => o.templates[i].name); if (lostT.length) warn.push('これらのカードが削除されます: ' + lostT.join(', ')); }
      el.querySelector('.warn').textContent = warn.join('\n\n');
      el.querySelector('.l').onclick = () => hide();
      el.querySelector('.r').onclick = async () => {
        const same = st.newMid === st.oldMid && st.fmap.every((v, i) => v === i) && (!st.tmap || st.tmap.every((v, i) => v === i));
        const { nids: ids, newMid, fmap, tmap } = st; hide();
        if (same) return;
        const k = await notes.changeNotetypeOf(ids, newMid, fmap, tmap);
        if (k) { env.changed(); env.toast(`${k}件のノートのノートタイプを変更しました`); }
      };
    };
    draw();
  }
  return { openTemplates, openChange, revert, inverse, isOpen: () => !!st, close: hide };
}
