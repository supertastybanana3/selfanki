// ノートの追加・編集・削除（AnkiMobile 25.09 の「追加」「編集」「ノートを削除」と、ブラウザの「ノートを削除する」）。
// 端末で変えたノートは D1 の notes 表に積み、配った束（Anki が描いたカード）の上に重ねる。カードの表・裏は template.mjs が Anki と同じに描く。
// 決まり: 束のノート（Anki で最後に変えた時刻 nmod）と端末の記録（rev）の新しいほうを使う。消したノートのカードは隠す（c.gone）。
// 端末で作ったカードには c.local を付ける（束のカードと分けるため）
import { renderCard, cardsRequired, sortText, stripHtml, clozeNumbers } from './template.mjs';

const tagsArr = s => String(s || '').split(/\s+/).filter(Boolean);
// タグを Anki と同じく空白で区切り、大文字小文字だけ違う重なりを除く（初めのものを残す）
function normTags(s) { const seen = new Set(), out = []; for (const t of tagsArr(s)) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } } return out.join(' '); }
// 中身が空か（画像・音声だけのフィールドは空ではない）。空のフィールドに残る <br> などは '' にする
const htmlIsEmpty = h => !/<(?:img|audio|video|object|source)\b|\[sound:/i.test(h) && stripHtml(h).trim() === '';
const ls = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
// 検索で使うノートの欄（S.notes の sfld）は、Anki の DB と同じく画像・音声のファイル名を残して HTML を除いたもの
const plain = h => stripHtml(String(h).replace(/<(?:img|audio|video|source)\b[^>]*?\bsrc\s*=\s*["']?([^"'>\s]+)[^>]*>/gi, ' $1 '));
const BACK_SVG = '<svg viewBox="0 0 12 20" width="12" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>';
const CHEV = '<svg width="7.7" height="12.8" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5 7.5 7.5 1.5 13.5"/></svg>';
// 道具の帯（AnkiMobile のマニュアル editing.md の並び: B I U・Fx・絵筆・クリップ・√・目・</>）。絵筆・クリップ・√ はまだ写していない
const TOOLS = [
  ['bold', '<b>B</b>', '太字'], ['italic', '<i style="font-family:Georgia,serif">I</i>', 'イタリック'], ['underline', '<u>U</u>', '下線を追加'],
  ['removeFormat', '<span style="font-style:italic;font-family:Georgia,serif">F<small>x</small></span>', '書式を取り除く'],
  ['color', '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5l5 5-8 8-5-5z"/><path d="M6.5 12.5 3 21l8.5-3.5"/></svg>', '文字色', 1],
  ['attach', '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/></svg>', 'メディアを追加', 1],
  ['math', '<span style="font-family:Georgia,serif">√</span>', '数式', 1],
  ['preview', '<svg viewBox="0 0 28 20" width="25" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1.5 10S6 2 14 2s12.5 8 12.5 8S22 18 14 18 1.5 10 1.5 10z"/><circle cx="14" cy="10" r="4"/></svg>', 'プレビュー'],
  ['html', '<span style="font:600 15px ui-monospace,Menlo,monospace">&lt;/&gt;</span>', 'HTMLエディタ'],
];
const CSS = `#editor{position:fixed;inset:0;z-index:28;background:var(--am-bg);display:flex;flex-direction:column}
#editor[hidden],#editor [hidden]{display:none !important}
#editor .pnav{flex:none;height:calc(50.5px + env(safe-area-inset-top));padding-top:env(safe-area-inset-top);display:grid;grid-template-columns:1fr auto 1fr;align-items:center;background:var(--am-bar);border-bottom:.5px solid var(--am-barline)}
#editor .pnav > .back{justify-self:start;display:flex;align-items:center;gap:6px;padding:0 0 0 14px;height:44px;color:var(--am-bartext);font-size:17px}
#editor .ptitle{color:var(--am-text);font-size:17px;font-weight:600}
#editor .nr{justify-self:end;display:flex;gap:20px;padding-right:16px}
#editor .nr button{height:44px;color:var(--am-bartext);font-size:17px} #editor .nr .go{font-weight:600}
#editor .etb{flex:none;display:flex;gap:2px;padding:3px 8px;background:var(--am-bar);border-bottom:.5px solid var(--am-barline);overflow-x:auto}
#editor .etb button{min-width:42px;height:36px;color:var(--am-bartext);font-size:18px;display:flex;align-items:center;justify-content:center;border-radius:7px}
#editor .etb button:disabled{opacity:.35} #editor .etb button.on{background:var(--am-sep)}
#editor .pbody{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:26px 0 120px}
#editor .grp{background:var(--am-group);border-radius:12px;margin:0 16px 26px;overflow:hidden}
#editor .it{display:flex;align-items:center;gap:8px;width:100%;min-height:45px;padding:0 16px;position:relative;font-size:16px;color:var(--am-text);text-align:left}
#editor .it + .it::before{content:"";position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--am-sep)}
#editor .it .lab{flex:1} #editor .it .val{color:var(--am-zero);max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#editor .it .chev{color:var(--am-chev);display:flex} #editor .it .ck{color:var(--am-blue);font-size:19px}
#editor .sec{font-size:13px;color:var(--am-zero);padding:0 32px 6px}
#editor .fbox{background:var(--am-group);border-radius:10px;margin:0 16px 20px;overflow:hidden}
#editor .fbox iframe{display:block;width:100%;height:44px;border:0;background:transparent}
#editor .fbox textarea{display:block;width:100%;min-height:96px;border:0;padding:10px 12px;font:14px/1.45 ui-monospace,Menlo,monospace;background:transparent;color:var(--am-text);resize:vertical;outline:none}
#editor input.tags{display:block;width:100%;height:44px;border:0;padding:0 12px;font-size:17px;background:transparent;color:var(--am-text);outline:none}
#editor .esub,#editor .eprev{position:absolute;inset:0;z-index:2;background:var(--am-bg);display:flex;flex-direction:column}
#editor .eprev iframe{flex:1;width:100%;border:0;background:var(--st-card,#fff)}
#editor .etoast{position:absolute;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:3;padding:8px 14px;border-radius:10px;background:rgba(40,40,42,.92);color:#fff;font-size:15px;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap}
#editor .etoast.show{opacity:1}
#etools{position:fixed;z-index:31;top:calc(46px + env(safe-area-inset-top));right:10px;width:260px;border-radius:13px;background:var(--br-pop,#2c2c2e);box-shadow:0 8px 30px rgba(0,0,0,.45);overflow:hidden;display:flex;flex-direction:column}
#etools .h{font-size:13px;color:#8e8e93;text-align:center;padding:12px 0 11px}
#etools button{height:54px;border:0;border-top:.5px solid rgba(255,255,255,.12);background:none;color:#4ea2ff;font-size:18px} #etools button.red{color:#ff4c44}`;

// env: { S, store, MEDIA, loadNotes, toast, iosAlert, confirm(title, msg, {ok, cancel}), pushUndo(entry), changed(nids), scheduleSync,
//        nextNewPos, bumpNewPos, isDark, isMarked(card), showPreview(iframe, {a, mid}) }
export function createNotes(env) {
  const { S } = env;
  S.noteRecs = new Map();   // ノートの id → いちばん新しい記録（eff: 'note'＝中身をこれにした・'del'＝消した・'anki'＝束のほうが新しいので使わない）
  let idx = null;           // ノートの id → カード（S.all）
  const index = () => {
    if (!idx) { idx = new Map(); for (const c of S.all) { const a = idx.get(c.nid); if (a) a.push(c); else idx.set(c.nid, [c]); } }
    return idx;
  };
  const cardsOf = nid => (index().get(nid) || []).slice().sort((a, b) => a.ord - b.ord || a.id - b.id);
  const liveCards = nid => cardsOf(nid).filter(c => !c.gone);
  const addCard = c => { S.all.push(c); S.byId.set(c.id, c); const a = index().get(c.nid); if (a) a.push(c); else index().set(c.nid, [c]); };
  // 束にあるノートの、Anki で最後に変えた時刻（秒）。束に無ければ null
  const bundleMod = nid => { let m = null; for (const c of index().get(nid) || []) if (!c.local) m = Math.max(m ?? 0, c.nmod || 0); return m; };
  // ノートタイプ（テンプレートの中身まで配ってある束でだけ描ける）
  function nt(mid) {
    const n = S.meta.notetypes?.[mid];
    if (!n || !Array.isArray(n.templates) || !n.templates.length || n.templates.some(t => typeof t.qfmt !== 'string')) return null;
    return { name: n.name, type: n.type, sortf: n.sortf || 0, flds: n.fields, tmpls: n.templates };
  }
  const ready = () => Object.keys(S.meta.notetypes || {}).some(m => nt(m));
  const deckName = did => S.decksById.get(did)?.name ?? '(Deck)';   // rslib と同じく、無いデッキは (Deck)
  const noteRow = (rec, t) => ({ mid: rec.mid, flds: rec.flds.join('\x1f'), sfld: plain(rec.flds[t.sortf] ?? ''), csum: 0, tags: tagsArr(rec.tags).length ? ' ' + tagsArr(rec.tags).join(' ') + ' ' : '', mod: Math.floor(rec.rev / 1000) });
  const cardRow = c => [c.id, c.ord, c.did, c.type === 0 ? c.due : 0];
  const wire = r => ({ id: r.id, mid: r.mid, flds: r.flds, tags: r.tags, did: r.did, cards: r.cards, rev: r.rev, del: r.del ? 1 : 0, added: r.added ? 1 : 0 });

  // ---------- 記録を重ねる ----------
  const sameContent = (a, b) => a.mid === b.mid && !!a.del === !!b.del && a.tags === b.tags && JSON.stringify(a.flds) === JSON.stringify(b.flds) && JSON.stringify(a.cards) === JSON.stringify(b.cards);
  // 記録を1つ重ねる。見えるものが変わったら true
  function apply(rec0) {
    const cur = S.noteRecs.get(rec0.id);
    if (cur && cur.rev > rec0.rev) return false;
    const rec = { ...rec0, src: rec0.src || 'app' };
    const bm = bundleMod(rec.id);
    rec.eff = bm != null && rec.rev <= bm * 1000 ? 'anki' : rec.del ? 'del' : nt(rec.mid) ? 'note' : 'anki';
    S.noteRecs.set(rec.id, rec);
    if (cur && cur.eff === rec.eff && sameContent(cur, rec)) return false;   // 同期で自分の送ったものが戻ってきた・アドオンが書いた印だけが変わった
    if (rec.eff === 'anki') return true;
    if (rec.eff === 'del') { for (const c of index().get(rec.id) || []) c.gone = true; S.notes?.delete(rec.id); return true; }
    const t = nt(rec.mid), tags = tagsArr(rec.tags);
    for (const [cid, ord, did, due] of rec.cards) {
      if (S.byId.has(cid)) continue;
      addCard({ id: cid, nid: rec.id, did, mid: rec.mid, ord, flags: 0, tags: [], type: 0, queue: 0, due, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, data: {},
        mod: Math.floor(rec.rev / 1000), nmod: 0, rev: 0, local: true });
    }
    for (const c of index().get(rec.id) || []) {
      if (c.nid !== rec.id) continue;
      c.gone = false;
      const r = renderCard(t, { fields: rec.flds, tags }, { ord: c.ord, flags: c.flags || 0, id: c.id, deckName: deckName(c.did) });
      Object.assign(c, { q: r.q, a: r.a, qav: r.qav, aav: r.aav, tname: r.tname, sfld: sortText(rec.flds[t.sortf] ?? ''), tags, mid: rec.mid });
      if (r.typ) c.typ = r.typ; else delete c.typ;
    }
    S.notes?.set(rec.id, noteRow(rec, t));
    return true;
  }
  // 検索用のノートの中身（束の notes）を読んだときに、記録を重ねる（search.mjs の loadNotes から呼ばれる）
  S.onNotesLoaded = m => { for (const rec of S.noteRecs.values()) { if (rec.eff === 'del') m.delete(rec.id); else if (rec.eff === 'note') m.set(rec.id, noteRow(rec, nt(rec.mid))); } };
  function reset() { idx = null; S.noteRecs.clear(); }

  // ---------- 変える ----------
  const freshNoteId = () => { let id = Date.now(); while (index().has(id) || S.noteRecs.has(id) || S.notes?.has(id)) id++; return id; };
  function freshCardIds(n) { const out = []; let id = Date.now(); while (out.length < n) { if (!S.byId.has(id)) out.push(id); id++; } return out; }
  const newRev = nid => Math.max(Date.now(), (S.noteRecs.get(nid)?.rev || 0) + 1, (bundleMod(nid) ?? 0) * 1000 + 1);
  // 新規の位置（rslib cardgen: ノートごとに1つ。並び順が「ランダム」のプリセットのデッキでは、1〜max(位置, 1000) の乱数。Anki と同じ乱数ではない）
  const isRandom = did => S.meta.presets?.[S.decksById.get(did)?.conf]?.new?.order === 0;
  function takePosition() { const p = env.nextNewPos(); env.bumpNewPos(p + 1); return { p, r: 1 + Math.floor(Math.random() * (Math.max(p, 1000) - 1)) }; }
  // カードを入れるデッキ（rslib deck_for_adding: 指定が無いかフィルターデッキなら、既定のデッキ 1）
  const deckForAdding = did => { if (did) { const d = S.decksById.get(did); if (!d || !d.dyn) return did; } return 1; };
  // 今のノートの中身（記録があれば記録、無ければ束）
  async function content(nid) {
    const rec = S.noteRecs.get(nid);
    if (rec && rec.eff === 'note') return { mid: rec.mid, flds: rec.flds.slice(), tags: rec.tags, added: rec.added ? 1 : 0 };
    await env.loadNotes();
    const n = S.notes.get(nid); if (!n) return null;
    return { mid: n.mid, flds: n.flds.split('\x1f'), tags: tagsArr(n.tags).join(' '), added: rec?.added ? 1 : 0 };
  }
  async function commit(recs, undo) {
    for (const rec of recs) { apply(rec); await env.store.addOp({ t: 'note', n: wire(rec) }); }
    if (undo) env.pushUndo(undo);
    env.changed(new Set(recs.map(r => r.id)));
    env.scheduleSync();
  }
  async function addNote(mid, did, flds, tags) {
    const t = nt(mid), req = cardsRequired(t, flds), ids = freshCardIds(req.length);
    let pos = null;
    const cards = req.map((r, i) => { const d = deckForAdding(r.did ?? did); pos = pos || takePosition(); return [ids[i], r.ord, d, isRandom(d) ? pos.r : pos.p]; });
    const rec = { id: freshNoteId(), mid, flds, tags, did, cards, rev: Date.now(), del: 0, added: 1 };
    await commit([rec], { kind: 'note', label: 'ノートの追加', items: [{ nid: rec.id, prev: null }] });
    return rec;
  }
  async function editNote(nid, flds, tags) {
    const c0 = await content(nid), t = nt(c0.mid), live = liveCards(nid);
    // 増えるカード（rslib: 今のカードが1つのデッキにまとまっていればそのデッキ、新規のカードがあればその位置）
    const req = cardsRequired(t, flds, new Set(live.map(c => c.ord)), true);
    const decks = new Set(live.map(c => c.did)), exDeck = decks.size === 1 ? [...decks][0] : null, exNew = live.find(c => c.type === 0);
    const ids = freshCardIds(req.length); let pos = null;
    const add = req.map((r, i) => { const d = deckForAdding(r.did ?? exDeck); if (exNew) return [ids[i], r.ord, d, exNew.due]; pos = pos || takePosition(); return [ids[i], r.ord, d, isRandom(d) ? pos.r : pos.p]; });
    const rec = { id: nid, mid: c0.mid, flds, tags, did: exDeck ?? live[0]?.did ?? 1, cards: [...live.map(cardRow), ...add], rev: newRev(nid), del: 0, added: c0.added };
    const prev = { ...c0, did: rec.did };
    await commit([rec], { kind: 'note', label: 'ノートの編集', items: [{ nid, prev }] });
    // マーク（タグ marked）を端末で付け外ししていたカードは、書いたタグに合わせる
    const marked = tagsArr(tags).some(x => x.toLowerCase() === 'marked');
    for (const c of cardsOf(nid)) if (c.mark !== undefined) c.mark = marked;
  }
  // まとめて直す（ブラウザの「タグを追加」「タグを解除」「検索して置換」）。fn(今の中身, ノートタイプ) が { flds, tags } を返す。中身が変わったノートだけ送り、元に戻すは1回で全部
  async function bulkEdit(nids, fn, label) {
    if (!ready()) { say('この束にはテンプレートが入っていません。手順 9 で書き出し直してください。'); return 0; }
    const recs = [], items = [];
    for (const nid of nids) {
      const c0 = await content(nid); if (!c0) continue; const t = nt(c0.mid); if (!t) continue;
      const live = liveCards(nid); if (!live.length) continue;
      const out = fn({ flds: c0.flds.slice(), tags: c0.tags }, t);
      if (JSON.stringify(out.flds) === JSON.stringify(c0.flds) && out.tags === c0.tags) continue;
      const req = cardsRequired(t, out.flds, new Set(live.map(c => c.ord)), true);
      const decks = new Set(live.map(c => c.did)), exDeck = decks.size === 1 ? [...decks][0] : null, exNew = live.find(c => c.type === 0);
      const ids = freshCardIds(req.length); let pos = null;
      const add = req.map((r, i) => { const d = deckForAdding(r.did ?? exDeck); if (exNew) return [ids[i], r.ord, d, exNew.due]; pos = pos || takePosition(); return [ids[i], r.ord, d, isRandom(d) ? pos.r : pos.p]; });
      recs.push({ id: nid, mid: c0.mid, flds: out.flds, tags: out.tags, did: exDeck ?? live[0]?.did ?? 1, cards: [...live.map(cardRow), ...add], rev: newRev(nid), del: 0, added: c0.added });
      items.push({ nid, prev: { ...c0, did: exDeck ?? live[0]?.did ?? 1 } });
    }
    if (recs.length) await commit(recs, { kind: 'note', label, items });
    return recs.length;
  }
  async function deleteNotes(nids, label = 'ノートを削除') {
    const recs = [], items = [];
    for (const nid of nids) {
      const c0 = await content(nid); if (!c0) continue;
      const live = liveCards(nid); if (!live.length) continue;
      recs.push({ id: nid, mid: c0.mid, flds: c0.flds, tags: c0.tags, did: live[0].did, cards: live.map(cardRow), rev: newRev(nid), del: 1, added: c0.added });
      items.push({ nid, prev: { ...c0, did: live[0].did } });
    }
    if (recs.length) await commit(recs, { kind: 'note', label, items });
    return recs.reduce((n, r) => n + r.cards.length, 0);
  }
  // やり直す用: 戻す前の中身を控えた、逆向きの記録（消してあるノートは null＝やり直すと消す）
  async function inverse(entry) {
    const items = [];
    for (const { nid } of entry.items) {
      const rec = S.noteRecs.get(nid);
      if (rec?.eff === 'del' || !liveCards(nid).length) { items.push({ nid, prev: null }); continue; }
      const c0 = await content(nid); items.push({ nid, prev: c0 ? { ...c0, did: rec?.did ?? liveCards(nid)[0]?.did ?? 1 } : null });
    }
    return { ...entry, items };
  }
  // 元に戻す: 追加は消す、編集は前の中身に、削除は消す前の中身に戻す（どれも新しい rev で送る）。編集で増えたカードは残る（Anki と違う）
  async function undo(entry) {
    const recs = [];
    for (const { nid, prev } of entry.items) {
      const cur = S.noteRecs.get(nid);
      if (!prev) { if (cur) recs.push({ ...wire(cur), rev: newRev(nid), del: 1 }); continue; }
      recs.push({ id: nid, mid: prev.mid, flds: prev.flds, tags: prev.tags, did: prev.did ?? cur?.did ?? 1, cards: cur?.cards || liveCards(nid).map(cardRow), rev: newRev(nid), del: 0, added: prev.added ? 1 : 0 });
    }
    for (const rec of recs) { apply(rec); await env.store.addOp({ t: 'note', n: wire(rec) }); }
    env.changed(new Set(recs.map(r => r.id)));
    env.scheduleSync();
  }

  // ---------- 画面（追加・編集） ----------
  let el = null, ed = null, toastT = null, tick = null;
  // 知らせ（編集の画面を開いているときは、その上に出す）
  function say(msg) {
    if (!el || el.hidden) { env.toast(msg); return; }
    const t = el.querySelector('.etoast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800);
  }
  const frames = () => [...el.querySelectorAll(':scope > .pbody .fbox')];
  function fieldDoc(html, f) {
    const dark = env.isDark(), font = String(f.font || 'Arial').replace(/["<>]/g, '');
    return `<!doctype html><html><head><meta charset="utf-8"><base href="${env.MEDIA}"><style>html{color:${dark ? '#f2f2f2' : '#000'};background:transparent}
body{margin:0;padding:10px 12px;min-height:22px;font-family:"${font}",-apple-system,"Hiragino Sans",sans-serif;font-size:17px;line-height:1.35;overflow-wrap:anywhere;outline:none;-webkit-text-size-adjust:100%}
img{max-width:100%;height:auto}</style></head><body contenteditable="true" spellcheck="false"${f.rtl ? ' dir="rtl"' : ''}>${html}</body></html>`;
  }
  const fit = f => { try { const b = f.contentDocument.body; f.style.height = Math.max(44, Math.ceil(b.getBoundingClientRect().height)) + 'px'; } catch {} };
  function build() {
    if (el) return el;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    el = document.createElement('div'); el.id = 'editor'; el.hidden = true;
    el.innerHTML = `<nav class="pnav"><button class="back">閉じる</button><span class="ptitle"></span><div class="nr"><button class="tools">ツール</button><button class="go"></button></div></nav>
<div class="etb">${TOOLS.map(([k, h, t, off]) => `<button data-k="${k}" title="${t}"${off ? ' disabled' : ''}>${h}</button>`).join('')}</div><div class="pbody"></div>
<div class="esub" hidden><nav class="pnav"><button class="back">${BACK_SVG}<span class="bl"></span></button><span class="ptitle"></span><span></span></nav><div class="pbody"></div></div>
<div class="etoast"></div><div class="eprev" hidden><nav class="pnav"><button class="back">${BACK_SVG}<span class="bl">戻る</span></button><span class="ptitle">プレビュー</span><span></span></nav><iframe title="プレビュー"></iframe></div>`;
    document.body.append(el);
    el.querySelector(':scope > .pnav .back').onclick = () => close();
    el.querySelector('.go').onclick = () => go();
    el.querySelector('.tools').onclick = () => tools();
    el.querySelector('.esub .back').onclick = () => { el.querySelector('.esub').hidden = true; };
    el.querySelector('.eprev .back').onclick = () => { el.querySelector('.eprev').hidden = true; el.querySelector('.eprev iframe').srcdoc = ''; };
    for (const b of el.querySelectorAll('.etb button')) {
      b.addEventListener('pointerdown', e => { e.preventDefault(); watch(); });   // 押してもフィールドから文字の入力の場所が外れないように
      b.onclick = () => tool(b.dataset.k);
    }
    return el;
  }
  function paint() {
    const body = el.querySelector(':scope > .pbody'); body.innerHTML = '';
    const t = nt(ed.mid);
    el.querySelector(':scope > .pnav .ptitle').textContent = ed.mode === 'add' ? '追加' : '編集';
    el.querySelector('.go').textContent = ed.mode === 'add' ? '追加' : '保存';
    el.querySelector('.tools').hidden = ed.mode === 'add';
    const row = (lab, val, fn) => { const b = document.createElement('button'); b.className = 'it'; b.innerHTML = `<span class="lab"></span><span class="val"></span><span class="chev">${CHEV}</span>`; b.children[0].textContent = lab; b.children[1].textContent = val; b.onclick = fn; return b; };
    if (ed.mode === 'add') {   // ノートタイプとデッキは追加のときだけ（マニュアルのとおり、編集には無い）
      const g = document.createElement('div'); g.className = 'grp';
      g.append(row('ノートタイプ', S.meta.notetypes[ed.mid].name, pickType), row('デッキ', deckName(ed.did), pickDeck));
      body.append(g);
    }
    ed.html = new Set();
    // フィールドは、スクリプトを動かさない枠（sandbox）に HTML をそのまま入れる。WebKit はこの枠の中の出来事を親に知らせないので、
    // 変えたかどうかは読み込んだときの HTML と比べ、高さと選んでいるフィールドは watch() で見る
    t.flds.forEach((f, i) => {
      const sec = document.createElement('div'); sec.className = 'sec'; sec.textContent = f.name;
      const box = document.createElement('div'); box.className = 'fbox';
      const fr = document.createElement('iframe'); fr.setAttribute('sandbox', 'allow-same-origin'); fr.title = f.name;
      const ta = document.createElement('textarea'); ta.hidden = true; ta.spellcheck = false; ta.setAttribute('autocapitalize', 'off'); ta.setAttribute('autocorrect', 'off');
      fr.onload = () => {
        const d = fr.contentDocument; if (!d || !d.body) return;
        fr._init = d.body.innerHTML; fit(fr);
        if (i === 0 && ed && ed.focusFirst) { ed.focusFirst = false; try { fr.contentWindow.focus(); d.body.focus(); } catch {} }
      };
      fr.srcdoc = fieldDoc(ed.vals[i] ?? '', f);
      box.append(fr, ta); body.append(sec, box);
    });
    const sec = document.createElement('div'); sec.className = 'sec'; sec.textContent = 'タグ';
    const g = document.createElement('div'); g.className = 'grp';
    const inp = document.createElement('input'); inp.className = 'tags'; inp.value = ed.tags; inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('autocorrect', 'off'); inp.spellcheck = false;
    g.append(inp); body.append(sec, g);
  }
  // フィールドの今の中身（変えていないフィールドは元の文字列のまま。ブラウザが HTML を書き換えるのを避ける）
  function readVals() {
    const boxes = frames();
    return ed.vals.map((v, i) => {
      const box = boxes[i]; if (!box) return v;
      let h;
      if (ed.html.has(i)) { const ta = box.querySelector('textarea'); if (ta.value === ta._init) return v; h = ta.value; }
      else { const fr = box.querySelector('iframe'), b = fr.contentDocument?.body; if (!b || fr._init == null || b.innerHTML === fr._init) return v; h = b.innerHTML; }
      return htmlIsEmpty(h) ? '' : h;
    });
  }
  // 高さを中身に合わせ、文字を打っているフィールドを覚える（開いているあいだ 0.25 秒おき）
  let typing = false;
  function watch() {
    if (!ed || !el) return;
    const boxes = frames(), a = document.activeElement;
    boxes.forEach((box, i) => { const fr = box.querySelector('iframe'); if (!fr.hidden) fit(fr); if (a === fr || a === box.querySelector('textarea')) ed.cur = i; });
    // iOS の殻に、文字を打っているかを知らせる（フィールドの枠の中に入ったことは、親の focusin では分からないため）
    const t = !!a && el.contains(a) && a.matches('iframe,textarea,input');
    if (t !== typing) { typing = t; env.typing?.(t); }
  }
  const readTags = () => normTags(el.querySelector('input.tags')?.value ?? ed.tags);
  const hasChanges = () => { if (!ed) return false; const v = readVals(); return v.some((x, i) => x !== ed.orig[i]) || readTags() !== normTags(ed.origTags); };
  function tool(k) {
    if (!ed) return;
    if (k === 'preview') return preview();
    const i = ed.cur ?? 0, box = frames()[i]; if (!box) return;
    const fr = box.querySelector('iframe'), ta = box.querySelector('textarea');
    if (k === 'html') {   // HTML を見る・直す（選んでいるフィールドだけ。もう一度押すと戻る）
      const v = ed.vals[i] ?? '';
      if (!ed.html.has(i)) { ta.value = readVals()[i]; ta._init = v; ed.html.add(i); fr.hidden = true; ta.hidden = false; ta.focus(); }
      else {
        const b = fr.contentDocument.body; ed.html.delete(i); b.innerHTML = ta.value;
        if (ta.value === v) fr._init = b.innerHTML;   // 変えていなければ、元のままとみなす
        ta.hidden = true; fr.hidden = false; fit(fr);
      }
      el.querySelector('.etb [data-k="html"]').classList.toggle('on', ed.html.has(i));
      return;
    }
    if (ed.html.has(i)) return;
    try { fr.contentDocument.execCommand(k, false, null); fit(fr); } catch {}
  }
  function preview() {
    const vals = readVals(), t = nt(ed.mid), tags = tagsArr(readTags());
    let card;
    if (ed.mode === 'edit') { const c = ed.card; card = { ord: c.ord, flags: c.flags || 0, id: c.id, deckName: deckName(c.did) }; }
    else { const r = cardsRequired(t, vals)[0]; card = { ord: r.ord, flags: 0, id: 0, deckName: deckName(deckForAdding(r.did ?? ed.did)) }; }
    const r = renderCard(t, { fields: vals, tags }, card);
    const p = el.querySelector('.eprev'); p.hidden = false;
    env.showPreview(p.querySelector('iframe'), { a: r.a, mid: ed.mid });
  }
  function sub(title, items) {
    const s = el.querySelector('.esub'); s.querySelector('.ptitle').textContent = title; s.querySelector('.bl').textContent = '追加';
    const body = s.querySelector('.pbody'); body.innerHTML = '';
    const g = document.createElement('div'); g.className = 'grp'; body.append(g);
    for (const it of items) {
      const b = document.createElement('button'); b.className = 'it'; b.innerHTML = '<span class="lab"></span>' + (it.ck ? '<span class="ck">✓</span>' : '');
      b.querySelector('.lab').textContent = it.t; b.onclick = () => { s.hidden = true; it.run(); }; g.append(b);
    }
    s.hidden = false;
  }
  function pickType() {
    const list = Object.entries(S.meta.notetypes).filter(([id]) => nt(id)).sort((a, b) => a[1].name.localeCompare(b[1].name));
    sub('ノートタイプ', list.map(([id, n]) => ({ t: n.name, ck: +id === ed.mid, run: () => {
      if (+id === ed.mid) return;
      const vals = readVals(), cnt = nt(id).flds.length;   // 中身はフィールドの順に引き継ぐ
      ed.tags = readTags(); ed.mid = +id; ed.vals = Array.from({ length: cnt }, (_, i) => vals[i] ?? ''); ed.orig = ed.vals.map(() => ''); paint();
    } })));
  }
  function pickDeck() {
    const list = S.meta.decks.filter(d => !d.dyn).sort((a, b) => a.name.localeCompare(b.name));
    sub('デッキ', list.map(d => ({ t: d.name, ck: d.id === ed.did, run: () => { ed.did = d.id; ed.vals = readVals(); ed.tags = readTags(); paint(); } })));
  }
  function tools() {
    let pop = document.getElementById('etools'); if (pop) { pop.remove(); return; }
    pop = document.createElement('div'); pop.id = 'etools'; pop.innerHTML = '<div class="h">ツール</div>';
    const b = document.createElement('button'); b.className = 'red'; b.textContent = 'ノートを削除';
    b.onclick = async () => { pop.remove(); const card = ed.card; await close(true); await deleteFrom(card); };
    pop.append(b);
    const off = e => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
    document.body.append(pop);
  }
  async function go() {
    if (!ed || ed.saving) return;
    const vals = readVals(), tags = readTags(), t = nt(ed.mid);
    if (ed.mode === 'add') {
      if (htmlIsEmpty(vals[0] ?? '')) { env.iosAlert('', '最初のフィールドが空欄です。'); return; }
      if (t.type === 1 && !clozeNumbers(vals).size && !(await env.confirm('', '穴埋め問題用のノートタイプを使用していますが、穴埋め問題用の範囲がまだ指定されていません。このままの状態でカードを追加してもよろしいですか？'))) return;
      ed.saving = true;
      try { await addNote(ed.mid, ed.did, vals, tags); } finally { ed.saving = false; }
      lsSet('addMid', String(ed.mid)); lsSet('addDid', String(ed.did)); lsSet('addTags', tags);
      say('追加しました');
      // 続けて足せるように、固定（sticky）のフィールドとタグだけ残す（Anki と同じ）
      ed.vals = vals.map((v, i) => (t.flds[i]?.sticky ? v : '')); ed.orig = ed.vals.slice(); ed.tags = tags; ed.origTags = tags; ed.focusFirst = true; paint();
      return;
    }
    if (vals.some((v, i) => v !== ed.orig[i]) || tags !== normTags(ed.origTags)) {
      ed.saving = true;
      try { await editNote(ed.nid, vals, tags); } finally { if (ed) ed.saving = false; }
    }
    await close(true);
  }
  async function close(force = false) {
    if (!ed) return;
    if (!force && hasChanges() && !(await env.confirm('', '現在の編集を破棄しますか？', { ok: '破棄', cancel: '編集を続ける' }))) return;
    document.getElementById('etools')?.remove();
    clearInterval(tick); tick = null; if (typing) { typing = false; env.typing?.(false); }
    el.hidden = true; el.querySelector(':scope > .pbody').innerHTML = ''; el.querySelector('.esub').hidden = true; el.querySelector('.eprev').hidden = true;
    ed = null;
  }
  function open(state) { build(); ed = { cur: 0, focusFirst: true, ...state }; paint(); el.hidden = false; clearInterval(tick); tick = setInterval(watch, 250); }
  async function openAdd({ did } = {}) {
    if (!ready()) { env.iosAlert('', 'この束にはノートタイプのテンプレートが入っていません。パソコンで書き出して上げ直してください（README の手順 9）。'); return; }
    const mid = [+ls('addMid'), +S.meta.config.curModel].find(m => nt(m)) ?? +Object.keys(S.meta.notetypes).find(m => nt(m));
    const decks = S.meta.decks.filter(d => !d.dyn), okDeck = x => decks.some(d => d.id === x);
    const d = [did, +ls('addDid'), S.lastDeck, +S.meta.config.curDeck].find(okDeck) ?? decks[0]?.id ?? 1;
    const vals = nt(mid).flds.map(() => ''), tags = ls('addTags') || '';
    open({ mode: 'add', mid, did: d, vals, orig: vals.slice(), tags, origTags: tags });
  }
  async function openEdit(card) {
    if (!card) return;
    if (!ready()) { env.iosAlert('', 'この束にはノートタイプのテンプレートが入っていません。パソコンで書き出して上げ直してください（README の手順 9）。'); return; }
    const c0 = await content(card.nid), t = c0 && nt(c0.mid);
    if (!t) { env.iosAlert('', 'このノートは編集できません（ノートタイプのテンプレートがありません）。'); return; }
    const flds = t.flds.map((_, i) => c0.flds[i] ?? '');
    // マークを端末で付け外ししていれば、タグに映して見せる
    let tags = tagsArr(c0.tags);
    if (card.mark !== undefined) { const has = tags.some(x => x.toLowerCase() === 'marked'); if (card.mark && !has) tags.push('marked'); if (!card.mark && has) tags = tags.filter(x => x.toLowerCase() !== 'marked'); }
    tags = tags.join(' ');
    open({ mode: 'edit', nid: card.nid, mid: c0.mid, card, vals: flds, orig: flds.slice(), tags, origTags: tags, focusFirst: false });
  }
  // 学習の画面のアクション「ノートを削除」・編集の「ツール」→「ノートを削除」
  async function deleteFrom(card) {
    if (!card) return;
    const n = await deleteNotes([card.nid]);
    if (n) env.toast(`ノートを削除しました（カード${n}枚）`);
  }
  // ブラウザの「ノートを削除する」（選んだカードのノートを全部）
  async function deleteBrowse(cards) {
    const nids = [...new Set(cards.map(c => c.nid))];
    const n = await deleteNotes(nids, 'ノートを削除する');
    if (n) env.toast(`${nids.length}件のノートを削除しました（カード${n}枚）`);
  }
  return { ready, apply, reset, openAdd, openEdit, deleteFrom, deleteBrowse, undo, inverse, bulkEdit, isOpen: () => !!ed, close, element: build };
}
