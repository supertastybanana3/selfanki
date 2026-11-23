// ノートの追加・編集・削除（AnkiMobile 25.09 の「追加」「編集」「ノートを削除」と、ブラウザの「ノートを削除する」）。
// 端末で変えたノートは D1 の notes 表に積み、配った束（Anki が描いたカード）の上に重ねる。カードの表・裏は template.mjs が Anki と同じに描く。
// 決まり: 束のノート（Anki で最後に変えた時刻 nmod）と端末の記録（rev）の新しいほうを使う。消したノートのカードは隠す（c.gone）。
// 端末で作ったカードには c.local を付ける（束のカードと分けるため）
import { renderCard, cardsRequired, sortText, stripHtml, clozeNumbers } from './template.mjs';
import { reorderFields, remapFields, remapCardOrds } from './ntedit.mjs';

const tagsArr = s => String(s || '').split(/\s+/).filter(Boolean);
// ノートの guid（Anki と同じく、64 ビットの乱数を 91 文字で。rslib anki_base91）。.apkg に書き出したとき、Anki が同じノートだと分かる印
const B91 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
function guid64() { const b = crypto.getRandomValues(new Uint32Array(2)); let n = (BigInt(b[0]) << 32n) | BigInt(b[1]), s = ''; while (n > 0n) { s = B91[Number(n % 91n)] + s; n /= 91n; } return s || 'a'; }
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
// 道具の帯（AnkiMobile 25.09 の実機 11/23: B・I・U・Fx・目・絵筆・マイク・クリップ・ペン・√・</>）。フィールドを選んでいないときは、目と </> のほかは押せない（実機）
const TOOLS = [
  ['bold', '<b>B</b>', '太字'],
  ['italic', '<i style="font-family:Georgia,serif">I</i>', 'イタリック'],
  ['underline', '<u>U</u>', '下線を追加'],
  ['removeFormat', '<span style="font-style:italic;font-family:Georgia,serif">F<small>x</small></span>', '書式を取り除く'],
  ['preview', '<svg viewBox="0 0 28 20" width="25" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1.5 10S6 2 14 2s12.5 8 12.5 8S22 18 14 18 1.5 10 1.5 10z"/><circle cx="14" cy="10" r="4"/></svg>', 'プレビュー'],
  ['color', '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5l5 5-8 8-5-5z"/><path d="M6.5 12.5 3 21l8.5-3.5"/></svg>', '文字色'],
  ['mic', '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>', '音声を録音'],
  ['attach', '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/></svg>', 'メディアを追加'],
  ['draw', '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/></svg>', '手書き'],
  ['math', '<span style="font-family:Georgia,serif">√<i style="font-size:13px">x</i></span>', '数式'],
  ['html', '<span style="font:600 15px ui-monospace,Menlo,monospace">&lt;/&gt;</span>', 'HTMLエディタ'],
];
const ALWAYS = new Set(['preview', 'html']);
// 絵筆の8色。ダークは実機（11/23）で測った色（iOS の dark の system 色）。ライトは iOS の light の system 色と推測（実機では見ていない）
const PAL_DARK = ['#ffffff', '#0091ff', '#31d158', '#ff9230', '#ff4246', '#db33f2', '#ffd702', '#8e8e93'];
const PAL_LIGHT = ['#000000', '#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#ffcc00', '#8e8e93'];
const MIC_DENIED = 'お使いのデバイスの「設定」→「プライバシー」→「マイク」からAnkiがマイクを使用できるように設定してください。';
// 手書き（ペン）の色（実機の iOS の手書きの道具で測った色）
const PEN_COLORS = ['#000000', '#167efb', '#53d769', '#fed02f', '#fc3042'];   // フィールドを選んでいなくても押せる
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
#erec{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center}
#erec .box{width:270px;border-radius:14px;background:var(--br-pop,#2c2c2e);color:#fff;text-align:center;overflow:hidden}
#erec .t{font-size:17px;font-weight:600;padding:19px 16px 4px} #erec .tm{font:300 34px -apple-system,system-ui,sans-serif;font-variant-numeric:tabular-nums;padding:4px 0 16px;color:#ff453a}
#erec .bt{display:flex;border-top:.5px solid rgba(255,255,255,.15)} #erec .bt button{flex:1;height:44px;font-size:17px;color:#4ea2ff;background:none;border:0} #erec .bt button+button{border-left:.5px solid rgba(255,255,255,.15);font-weight:600}
#edraw{position:fixed;inset:0;z-index:40;background:#fff;display:flex;flex-direction:column}
#edraw nav{flex:none;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;height:calc(50.5px + env(safe-area-inset-top));padding:env(safe-area-inset-top) 14px 0;background:var(--am-bar);border-bottom:.5px solid var(--am-barline)}
#edraw nav b{font-size:17px;font-weight:600;color:var(--am-text)} #edraw nav button{font-size:17px;color:var(--am-bartext);background:none;border:0;justify-self:start} #edraw nav .yes{justify-self:end}
#edraw canvas{flex:1;width:100%;touch-action:none;background:#fff}
#edraw .pk{position:absolute;left:50%;bottom:calc(12px + env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:10px 18px;border-radius:30px;background:#343434;box-shadow:0 4px 24px rgba(0,0,0,.28)}
#edraw .pk .undo,#edraw .pk .redo{width:36px;height:36px;border-radius:50%;background:#4a4a4c;color:#fff;display:flex;align-items:center;justify-content:center;border:0} #edraw .pk button:disabled{opacity:.35}
#edraw .pk .sep{width:1px;height:40px;background:#555}
#edraw .pk .cols{display:grid;grid-template-columns:repeat(3,30px);gap:8px}
#edraw .pk .col{width:30px;height:30px;border-radius:50%;background:var(--c);border:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)} #edraw .pk .col.on{box-shadow:0 0 0 2px #343434,0 0 0 4px #fff}
#epop{position:fixed;z-index:31;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:13px;background:var(--br-pop,#2c2c2e);box-shadow:0 8px 30px rgba(0,0,0,.4)}
#epop::after{content:"";position:absolute;left:calc(var(--ax) - 9px);border:9px solid transparent}
#epop.below::after{top:-17px;border-bottom-color:var(--br-pop,#2c2c2e)} #epop.above::after{bottom:-17px;border-top-color:var(--br-pop,#2c2c2e)}
#epop button{min-width:44px;height:40px;padding:0 8px;border:0;background:none;color:#4ea2ff;font:400 19px -apple-system,system-ui,sans-serif}
#epop.above{gap:0;padding:10px 6px} #epop.above button{min-width:min(80px,calc((100vw - 40px) / 8));height:30px;display:flex;align-items:center;justify-content:center}
#epop .dot{display:block;width:14px;height:14px;border-radius:50%;box-shadow:0 0 0 .5px rgba(128,128,128,.5)}
#editor .pnav .mid{display:flex;align-items:center;justify-content:center} #editor .pnav .mid .tools{height:44px;color:var(--am-bartext);font-size:17px}
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
  const noteRow = (rec, t, guid) => ({ mid: rec.mid, flds: rec.flds.join('\x1f'), sfld: plain(rec.flds[t.sortf] ?? ''), csum: 0, tags: tagsArr(rec.tags).length ? ' ' + tagsArr(rec.tags).join(' ') + ' ' : '', mod: Math.floor(rec.rev / 1000), guid: rec.guid ?? guid });
  const cardRow = c => [c.id, c.ord, c.did, c.type === 0 ? c.due : 0];
  // guid＝端末で作ったノートの guid（Anki に足すときに使う）、imp＝パッケージから読み込んだノート（Anki でもこのカードだけを作る）
  const fieldNames = mid => nt(mid)?.flds?.map(f => f.name);
  const wire = r => ({ id: r.id, mid: r.mid, flds: r.flds, ...(fieldNames(r.mid)?.length === r.flds.length ? { fn: fieldNames(r.mid) } : {}), tags: r.tags, did: r.did, cards: r.cards, rev: r.rev, del: r.del ? 1 : 0, added: r.added ? 1 : 0, ...(r.guid ? { guid: r.guid } : {}), ...(r.imp ? { imp: 1 } : {}) });

  // ---------- 記録を重ねる ----------
  const sameContent = (a, b) => a.mid === b.mid && !!a.del === !!b.del && a.tags === b.tags && JSON.stringify(a.flds) === JSON.stringify(b.flds) && JSON.stringify(a.cards) === JSON.stringify(b.cards);
  // 記録を1つ重ねる。見えるものが変わったら true
  function apply(rec0) {
    // 届いた記録のフィールドを、この端末のノートタイプの並びへ名前で合わせる（fn＝記録の並びのフィールド名。Anki でフィールドを足した・並べ替えたとき）
    const names = fieldNames(rec0.mid);
    if (names && Array.isArray(rec0.fn) && rec0.fn.length === rec0.flds.length && JSON.stringify(rec0.fn) !== JSON.stringify(names)) {
      const m = new Map(rec0.fn.map((k, i) => [k, rec0.flds[i]])); rec0 = { ...rec0, flds: names.map(nm => m.get(nm) ?? ''), fn: names };
    }
    const cur = S.noteRecs.get(rec0.id);
    if (cur && cur.rev > rec0.rev) return false;
    const rec = { ...rec0, src: rec0.src || 'app' };
    if (rec.guid == null && cur?.guid) rec.guid = cur.guid;   // 編集の記録には guid が無い（足したときの guid を引き継ぐ）
    if (!rec.imp && cur?.imp) rec.imp = 1;
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
    // 記録のカードの一覧が、そのノートの生きているカードのすべて（ord もこの一覧のとおり。ノートタイプの変更でテンプレートを消した・並べ替えたとき）
    const want = new Map(rec.cards.map(([cid, ord]) => [cid, ord]));
    for (const c of index().get(rec.id) || []) {
      if (c.nid !== rec.id) continue;
      if (!want.has(c.id)) { c.gone = true; continue; }
      c.gone = false; c.ord = want.get(c.id);
      const r = renderCard(t, { fields: rec.flds, tags }, { ord: c.ord, flags: c.flags || 0, id: c.id, deckName: deckName(c.did) });
      Object.assign(c, { q: r.q, a: r.a, qav: r.qav, aav: r.aav, tname: r.tname, sfld: sortText(rec.flds[t.sortf] ?? ''), tags, mid: rec.mid });
      if (r.typ) c.typ = r.typ; else delete c.typ;
    }
    S.notes?.set(rec.id, noteRow(rec, t, S.notes.get(rec.id)?.guid));
    return true;
  }
  // 検索用のノートの中身（束の notes）を読んだときに、記録を重ねる（search.mjs の loadNotes から呼ばれる）
  S.onNotesLoaded = m => { for (const rec of S.noteRecs.values()) { if (rec.eff === 'del') m.delete(rec.id); else if (rec.eff === 'note') m.set(rec.id, noteRow(rec, nt(rec.mid), m.get(rec.id)?.guid)); } };
  function reset() { idx = null; S.noteRecs.clear(); }

  // ---------- 変える ----------
  const freshNoteId = () => { let id = Date.now(); while (index().has(id) || S.noteRecs.has(id) || S.notes?.has(id)) id++; return id; };
  // 新しいカードの id（ミリ秒）。まだ積んでいない分（まとめて書くときの前のノートのカード）とも重ならないように、前に出した id より大きくする
  let lastFresh = 0;
  function freshCardIds(n) { const out = []; let id = Math.max(Date.now(), lastFresh + 1); while (out.length < n) { if (!S.byId.has(id)) out.push(id); id++; } lastFresh = id - 1; return out; }
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
    const rec = { id: freshNoteId(), mid, flds, tags, did, cards, rev: Date.now(), del: 0, added: 1, guid: guid64() };
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
    for (const rec of recs) { const marked = tagsArr(rec.tags).some(x => x.toLowerCase() === 'marked'); for (const c of cardsOf(rec.id)) if (c.mark !== undefined) c.mark = marked; }   // editNote と同じく、マークを書いたタグに合わせる
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
      const c0 = await content(nid); items.push({ nid, prev: c0 ? { ...c0, did: rec?.did ?? liveCards(nid)[0]?.did ?? 1, cards: liveCards(nid).map(cardRow) } : null });
    }
    return { ...entry, items };
  }
  // 元に戻す: 追加は消す、編集は前の中身に、削除は消す前の中身に戻す（どれも新しい rev で送る）。編集で増えたカードは残る（Anki と違う）
  async function undo(entry) {
    const recs = [];
    for (const { nid, prev } of entry.items) {
      const cur = S.noteRecs.get(nid);
      if (!prev) { if (cur) recs.push({ ...wire(cur), rev: newRev(nid), del: 1 }); continue; }
      recs.push({ id: nid, mid: prev.mid, flds: prev.flds, tags: prev.tags, did: prev.did ?? cur?.did ?? 1, cards: prev.cards ?? cur?.cards ?? liveCards(nid).map(cardRow), rev: newRev(nid), del: 0, added: prev.added ? 1 : 0 });
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
    // color-scheme を親と合わせる（違うと Chromium は枠を不透明な白で描き、ダークで薄い字が読めなくなる）
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${dark ? 'dark' : 'light'}"><base href="${env.MEDIA}"><style>html{color-scheme:${dark ? 'dark' : 'light'};color:${dark ? '#f2f2f2' : '#000'};background:transparent}
body{margin:0;padding:10px 12px;min-height:22px;font-family:"${font}",-apple-system,"Hiragino Sans",sans-serif;font-size:17px;line-height:1.35;overflow-wrap:anywhere;outline:none;-webkit-text-size-adjust:100%}
img{max-width:100%;height:auto}</style></head><body contenteditable="true" spellcheck="false" autocapitalize="${env.pref?.('autoCap') === false ? 'none' : 'sentences'}" autocorrect="${env.pref?.('autoCorrect') === false ? 'off' : 'on'}"${f.rtl ? ' dir="rtl"' : ''}>${html}</body></html>`;   // 設定＞編集の「文頭を大文字」「オートコレクト」
  }
  const fit = f => { try { const b = f.contentDocument.body; f.style.height = Math.max(44, Math.ceil(b.getBoundingClientRect().height)) + 'px'; } catch {} };
  function build() {
    if (el) return el;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    el = document.createElement('div'); el.id = 'editor'; el.hidden = true;
    el.innerHTML = `<nav class="pnav"><button class="back">閉じる</button><span class="mid"><span class="ptitle"></span><button class="tools">ツール</button></span><div class="nr"><button class="go"></button></div></nav>
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
    // 実機（11/23）の編集の画面: 左「戻る」、真ん中「ツール」（題は無い）、右「保存」は中身を変えたときだけ。追加の画面は今のまま（実機は見比べていない）
    const edit = ed.mode === 'edit';
    el.querySelector(':scope > .pnav > .back').textContent = edit ? '戻る' : '閉じる';
    el.querySelector(':scope > .pnav .ptitle').textContent = edit ? '' : '追加';
    el.querySelector(':scope > .pnav .ptitle').hidden = edit;
    el.querySelector('.go').textContent = edit ? '保存' : '追加';
    el.querySelector('.go').hidden = edit;   // 変えたら watch() が出す
    el.querySelector('.tools').hidden = !edit;
    const row = (lab, val, fn) => { const b = document.createElement('button'); b.className = 'it'; b.innerHTML = `<span class="lab"></span><span class="val" translate="no"></span><span class="chev">${CHEV}</span>`; b.children[0].textContent = lab; b.children[1].textContent = val; b.onclick = fn; return b; };
    if (ed.mode === 'add') {   // ノートタイプとデッキは追加のときだけ（マニュアルのとおり、編集には無い）
      const g = document.createElement('div'); g.className = 'grp';
      g.append(row('ノートタイプ', S.meta.notetypes[ed.mid].name, pickType), row('デッキ', deckName(ed.did), pickDeck));
      body.append(g);
    }
    ed.html = new Set();
    // フィールドは枠（sandbox）に HTML をそのまま入れる。中身のスクリプト・onerror などは、ページの決まり（CSP の script-src 'self'。srcdoc の枠も受け継ぐ）で動かない。
    // allow-scripts は、WebKit が枠の中の出来事（貼り付けなど）を親の受け口に渡すために要る（無いと WebKit は受け口を動かさない）。
    // 変えたかどうかは読み込んだときの HTML と比べ、高さと選んでいるフィールドは watch() で見る
    t.flds.forEach((f, i) => {
      const sec = document.createElement('div'); sec.className = 'sec'; sec.textContent = f.name; sec.setAttribute('translate', 'no');   // フィールド名は訳さない
      const box = document.createElement('div'); box.className = 'fbox';
      const fr = document.createElement('iframe'); fr.setAttribute('sandbox', 'allow-same-origin allow-scripts'); fr.title = f.name;
      const ta = document.createElement('textarea'); ta.hidden = true; ta.spellcheck = false; ta.setAttribute('autocapitalize', 'off'); ta.setAttribute('autocorrect', 'off');
      fr.onload = () => {
        const d = fr.contentDocument; if (!d || !d.body) return;
        fr._init = d.body.innerHTML; fit(fr);
        d.addEventListener('paste', e => pasteImages(e, fr, ta, i));
        d.addEventListener('focusin', () => watch()); d.addEventListener('focusout', () => setTimeout(watch, 0));
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
    let focused = -1;
    boxes.forEach((box, i) => { const fr = box.querySelector('iframe'); if (!fr.hidden) fit(fr); if (a === fr || a === box.querySelector('textarea')) { ed.cur = i; focused = i; } });
    // 実機: フィールドを選んでいない（入力の場所が無い）ときは、目と </> のほかは押せない。メニューを開いているあいだは、開いたときのまま
    if (!document.getElementById('etools') && !document.getElementById('epop')) for (const b of el.querySelectorAll('.etb button')) if (!ALWAYS.has(b.dataset.k)) b.disabled = focused < 0;
    if (ed.mode === 'edit') { const go = el.querySelector('.go'), ch = hasChanges(); if (go.hidden === ch) go.hidden = !ch; }   // 保存は変えたときだけ
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
    const run = (cmd, val = null) => { try { fr.contentWindow.focus(); fr.contentDocument.execCommand(cmd, false, val); fit(fr); } catch {} };
    if (k === 'color') {   // 絵筆（実機 11/23）: 8色の丸が横に並ぶ吹き出し。押した色を、選んでいる文字に付ける
      const pal = env.isDark() ? PAL_DARK : PAL_LIGHT;
      hpop(el.querySelector('.etb [data-k="color"]'), pal.map(c => [`<span class="dot" style="background:${c}"></span>`, c, () => { try { fr.contentDocument.execCommand('styleWithCSS', false, true); } catch {} run('foreColor', c); }]), 'above');
      return;
    }
    if (k === 'attach') {   // クリップ: カメラ・写真ライブラリ・ファイルから（画像は Anki の貼り付けと同じく paste-<sha1>、ファイルは元の名前）
      menu('メディアを追加', [['カメラから', () => pickMedia(fr, ta, i, 'image/*,video/*', 'environment')], ['写真から', () => pickMedia(fr, ta, i, 'image/*,video/*')], ['ファイルから', () => pickMedia(fr, ta, i, '', null, true)]],
        el.querySelector('.etb [data-k="attach"]'));
      return;
    }
    if (k === 'mic') { recordInto(fr, ta, i); return; }
    if (k === 'draw') { drawInto(fr, ta, i); return; }
    if (k === 'math') {   // √（実機 11/23）: ボタンの下の小さな横並びの吹き出しに、上付き・下付き・MathJax インライン・MathJax ブロック。選んでいた文字を囲む
      const wrap = (a, b) => () => { const sel = fr.contentDocument.getSelection()?.toString() ?? ''; run('insertText', a + sel + b); };
      hpop(el.querySelector('.etb [data-k="math"]'), [['x<sup>2</sup>', '上付き文字', () => run('superscript')], ['x<sub>2</sub>', '下付き文字', () => run('subscript')],
        ['\\(', 'MathJax インライン数式', wrap('\\(', '\\)')], ['\\[', 'MathJax ブロック数式', wrap('\\[', '\\]')]], 'below');
      return;
    }
    run(k);
  }
  // 画像・音声をフィールドに入れる（画像は <img src>、音声・動画は [sound:]。Anki の editor と同じ）。HTML を出している欄なら文字として足す
  const isImage = n => /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif|ico)$/i.test(n);
  function insertMedia(fr, ta, i, name) {
    const html = isImage(name) ? `<img src="${name.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` : `[sound:${name}]`;
    if (ed?.html.has(i)) { const p = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, p) + html + ta.value.slice(ta.selectionEnd ?? p); return; }
    try { fr.contentWindow.focus(); fr.contentDocument.execCommand('insertHTML', false, html); fit(fr); } catch {}
  }
  async function addBytes(fr, ta, i, name, bytes) {
    try { const got = await env.addMedia(name, bytes); insertMedia(fr, ta, i, got); }
    catch (e) { env.iosAlert('Error', String(e?.message || e)); }
  }
  function pickMedia(fr, ta, i, accept, capture = null, keepName = false) {
    const inp = document.createElement('input'); inp.type = 'file'; if (accept) inp.accept = accept; if (capture) inp.setAttribute('capture', capture); inp.multiple = !capture;
    inp.style.cssText = 'position:fixed;left:-100px;top:0;opacity:0'; document.body.append(inp);
    inp.addEventListener('change', async () => {
      for (const f of inp.files) {
        let bytes = new Uint8Array(await f.arrayBuffer());
        let ext = (f.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || (f.type.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('quicktime', 'mov');
        if (!keepName && /^image\/(jpeg|png|heic|heif|webp)$/.test(f.type)) {   // カメラ・写真ライブラリの写真は、長辺を設定＞編集の「最大画像サイズ」まで
          const r = await resizeImage(bytes, f.type, env.maxImg()); if (r) { bytes = r.bytes; ext = r.type === 'image/png' ? 'png' : 'jpg'; }
        }
        const name = keepName || !/^(image|video)\//.test(f.type) ? f.name : `paste-${await env.sha1Of(bytes)}.${ext}`;
        await addBytes(fr, ta, i, name, bytes);
      }
      inp.remove();
    });
    inp.click();
  }
  // 画像を小さくする（長辺を maxSide まで。0 なら大きさはそのまま）。outType を付けるとその形式に書き直す。変えることが無ければ null
  async function resizeImage(bytes, type, maxSide, outType = null) {
    let bmp; try { bmp = await createImageBitmap(new Blob([bytes], { type })); } catch { return null; }
    const s = maxSide > 0 ? Math.min(1, maxSide / Math.max(bmp.width, bmp.height)) : 1;
    if (s === 1 && (!outType || outType === type)) return null;
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
    const out = outType || (type === 'image/png' ? 'image/png' : 'image/jpeg');
    if (out === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
    g.drawImage(bmp, 0, 0, w, h);
    const b = await new Promise(r => cv.toBlob(r, out, 0.9)); return b ? { bytes: new Uint8Array(await b.arrayBuffer()), type: out } : null;
  }
  // 貼り付けた画像は、ファイルにして入れる（Anki と同じ paste-<sha1>。設定＞編集の「PNG 形式で貼り付ける」がオフなら JPEG、「貼り付けの際にリサイズ」で長辺を最大画像サイズまで）
  async function pasteImages(e, fr, ta, i) {
    const types = [...(e.clipboardData?.types || [])];
    if (types.includes('text/html') || types.includes('text/plain')) return;   // 文字と一緒の貼り付け（ウェブのページから写したなど）はふつうに貼る（横取りすると文字が消える）
    const files = [...(e.clipboardData?.items || [])].filter(it => it.kind === 'file' && /^image\//.test(it.type)).map(it => it.getAsFile()).filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      let bytes = new Uint8Array(await f.arrayBuffer()), type = f.type;
      const png = !!env.pref?.('pastePng'), r = await resizeImage(bytes, type, env.pref?.('pasteResize') ? env.maxImg() : 0, png ? 'image/png' : 'image/jpeg');
      if (r) { bytes = r.bytes; type = r.type; }
      await addBytes(fr, ta, i, `paste-${await env.sha1Of(bytes)}.${type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : (type.split('/')[1] || 'png')}`, bytes);
    }
  }
  // マイク: 録って、保存で入れる（Anki の「音声を録音」と同じく録り終えてから入れる）
  async function recordInto(fr, ta, i) {
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { env.iosAlert('', MIC_DENIED); return; }   // 文言は実機（11/23）
    const mr = new MediaRecorder(stream), chunks = []; mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const d = document.createElement('div'); d.id = 'erec';
    d.innerHTML = '<div class="box"><div class="t">録音中</div><div class="tm">0:00</div><div class="bt"><button class="no">キャンセル</button><button class="yes">保存</button></div></div>';
    document.body.append(d);
    const t0 = Date.now(), tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); d.querySelector('.tm').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
    const finish = keep => new Promise(res => { mr.onstop = res; mr.stop(); }).then(async () => {
      clearInterval(tick); stream.getTracks().forEach(t => t.stop()); d.remove();
      if (!keep || !chunks.length) return;
      const type = mr.mimeType || 'audio/mp4', ext = /webm/.test(type) ? 'webm' : /ogg/.test(type) ? 'ogg' : 'm4a';
      const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
      await addBytes(fr, ta, i, `rec-${(await env.sha1Of(bytes)).slice(0, 16)}.${ext}`, bytes);
    });
    d.querySelector('.no').onclick = () => finish(false); d.querySelector('.yes').onclick = () => finish(true);
    mr.start();
  }
  // ペン（実機 11/23）: 全画面の「手書き」。左上キャンセル・右上保存・白い紙。下に iOS の手書きの道具に似せた帯（元に戻す・やり直す・5色。ペンの種類・定規は無い）。
  // 保存で、描いた所を切り出して PNG で入れる（あとで描き直す機能は無い）
  function drawInto(fr, ta, i) {
    const d = document.createElement('div'); d.id = 'edraw';
    d.innerHTML = `<nav><button class="no">キャンセル</button><b>手書き</b><button class="yes">保存</button></nav><canvas></canvas>
<div class="pk"><button class="undo" title="元に戻す"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button><button class="redo" title="やり直す"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg></button><span class="sep"></span><span class="cols">${PEN_COLORS.map((c, k) => `<button class="col${k ? '' : ' on'}" data-c="${c}" style="--c:${c}"></button>`).join('')}</span></div>`;
    document.body.append(d);
    const cv = d.querySelector('canvas'), ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
    let strokes = [], redo = [], cur = null, color = PEN_COLORS[0];
    const tools = () => { d.querySelector('.undo').disabled = !strokes.length; d.querySelector('.redo').disabled = !redo.length; };
    const paint = () => { ctx.clearRect(0, 0, W, H); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of cur ? [...strokes, cur] : strokes) { ctx.strokeStyle = s.c; ctx.beginPath(); s.p.forEach((p, k) => { ctx.lineWidth = p.w; k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); if (s.p.length === 1) ctx.lineTo(s.p[0].x + .01, s.p[0].y); ctx.stroke(); }
      tools(); };
    const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: e.pointerType === 'pen' && e.pressure > 0 ? 1 + 4 * e.pressure : 3 }; };
    cv.addEventListener('pointerdown', e => { e.preventDefault(); if (env.pref?.('drawNoFinger') && e.pointerType === 'touch') return; try { cv.setPointerCapture(e.pointerId); } catch {} cur = { c: color, p: [pt(e)] }; paint(); });   // 「手書きスクリーンで指での入力を無視」
    cv.addEventListener('pointermove', e => { if (!cur) return; for (const x of (e.getCoalescedEvents?.() || [e])) cur.p.push(pt(x)); paint(); });
    const end = () => { if (cur) { strokes.push(cur); redo = []; cur = null; paint(); } }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    d.querySelector('.undo').onclick = () => { if (strokes.length) redo.push(strokes.pop()); paint(); };
    d.querySelector('.redo').onclick = () => { if (redo.length) strokes.push(redo.pop()); paint(); };
    for (const b of d.querySelectorAll('.col')) b.onclick = () => { color = b.dataset.c; for (const x of d.querySelectorAll('.col')) x.classList.toggle('on', x === b); };
    d.querySelector('.no').onclick = () => d.remove();
    d.querySelector('.yes').onclick = async () => {
      if (!strokes.length) { d.remove(); return; }
      // 描いた所だけを切り出す（周りに 10pt の余白）
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of strokes) for (const p of s.p) { x0 = Math.min(x0, p.x - p.w); y0 = Math.min(y0, p.y - p.w); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.w); }
      x0 = Math.max(0, x0 - 10); y0 = Math.max(0, y0 - 10); x1 = Math.min(W, x1 + 10); y1 = Math.min(H, y1 + 10);
      const out = document.createElement('canvas'); out.width = Math.round((x1 - x0) * dpr); out.height = Math.round((y1 - y0) * dpr);
      const o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height); o.drawImage(cv, x0 * dpr, y0 * dpr, out.width, out.height, 0, 0, out.width, out.height);
      const bytes = new Uint8Array(await (await new Promise(r => out.toBlob(r, 'image/png'))).arrayBuffer());
      d.remove(); await addBytes(fr, ta, i, `paste-${await env.sha1Of(bytes)}.png`, bytes);
    };
    tools();
  }
  // 道具の帯から出す、横並びの小さな吹き出し（√ はボタンの下、絵筆は帯の上。実機 11/23）。items: [中身の HTML, 名前, 押したとき]
  function hpop(anchor, items, where) {
    document.getElementById('epop')?.remove(); document.getElementById('etools')?.remove();
    const pop = document.createElement('div'); pop.id = 'epop'; pop.className = where;
    for (const [html, title, fn] of items) {
      const b = document.createElement('button'); b.innerHTML = html; b.title = title;
      b.addEventListener('pointerdown', e => e.preventDefault());   // フィールドから入力の場所を外さない
      b.onclick = () => { close(); fn(); }; pop.append(b);
    }
    document.body.append(pop);
    const r = anchor.getBoundingClientRect(), bar = anchor.parentElement.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    pop.style.left = left + 'px'; pop.style.top = (where === 'above' ? Math.max(4, bar.top - h - 6) : r.bottom + 10) + 'px';
    pop.style.setProperty('--ax', (r.left + r.width / 2 - left) + 'px');   // 矢印の位置（ボタンの真ん中）
    const off = e => { if (!pop.contains(e.target)) close(); };
    function close() { pop.remove(); document.removeEventListener('pointerdown', off, true); }
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }
  // 道具の帯から出す小さなメニュー（ツールの吹き出しと同じ見た目で、押したボタンの下に出す）
  function menu(title, items, anchor) {
    document.getElementById('etools')?.remove();
    const pop = document.createElement('div'); pop.id = 'etools'; pop.innerHTML = '<div class="h"></div>'; pop.firstChild.textContent = title;
    for (const [t, fn] of items) { const b = document.createElement('button'); b.textContent = t; b.addEventListener('pointerdown', e => e.preventDefault()); b.onclick = () => { close(); fn(); }; pop.append(b); }
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + 6) + 'px'; pop.style.right = 'auto'; pop.style.left = Math.max(8, Math.min(window.innerWidth - 268, r.left + r.width / 2 - 130)) + 'px';
    const off = e => { if (!pop.contains(e.target)) close(); };
    function close() { pop.remove(); document.removeEventListener('pointerdown', off, true); }
    document.addEventListener('pointerdown', off, true);
    document.body.append(pop);
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
    if (!force && hasChanges() && !(await env.confirm('変更を破棄しますか？', '', { ok: '破棄', cancel: '編集を続ける' }))) return;
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
  // パッケージの読み込み（app/exchange.mjs の applyImport から）。adds＝足すノートの記録そのもの、updates＝既にあるノートの中身の更新（＋増えるカード）、
  // extraCards＝既にあるノート（中身はそのまま）に増えるカード。元に戻すは作らない
  async function importRecords({ adds = [], updates = [], extraCards = [] }) {
    const recs = [...adds];
    for (const u of [...updates, ...extraCards]) {
      const c0 = await content(u.id); if (!c0) continue;
      const live = liveCards(u.id), decks = new Set(live.map(c => c.did)), exDeck = decks.size === 1 ? [...decks][0] : null;
      recs.push({ id: u.id, mid: c0.mid, flds: u.flds ?? c0.flds, tags: u.tags ?? c0.tags, did: exDeck ?? live[0]?.did ?? 1, cards: [...live.map(cardRow), ...u.cards], rev: newRev(u.id), del: 0, added: c0.added });
    }
    if (!recs.length) return 0;
    for (const rec of recs) apply(rec);
    await env.store.addOps(recs.map(r => ({ t: 'note', n: wire(r) })));   // 何千件でも1回で積む
    env.changed(new Set(recs.map(r => r.id)));
    env.scheduleSync();
    return recs.length;
  }
  // ノートタイプが届いた・変わったとき（同期の nt:<id>・読み込み）: そのノートタイプのノートを描き直す。束のカードも、ノートの中身から描き直す
  async function rerender(mids) {
    const want = new Set([...mids].map(Number)); if (!want.size) return 0;
    for (const rec of [...S.noteRecs.values()]) if (want.has(+rec.mid)) { S.noteRecs.delete(rec.id); apply(rec); }   // 写しで回す（消して足し直すと、Map の終わりに付いてもう一度回ってしまう）
    const t0 = [...want].map(m => [m, nt(m)]).filter(([, t]) => t); if (!t0.length) return 0;
    const notesMap = await env.loadNotes(); let n = 0;
    for (const c of S.all) {
      if (!want.has(+c.mid) || c.gone || c.local) continue;
      const rec = S.noteRecs.get(c.nid); if (rec && rec.eff === 'note') continue;   // 端末の記録で描いたもの（上で描き直した）
      const note = notesMap.get(c.nid), t = nt(c.mid); if (!note || !t) continue;
      const r = renderCard(t, { fields: note.flds.split('\x1f'), tags: tagsArr(note.tags) }, { ord: c.ord, flags: c.flags || 0, id: c.id, deckName: deckName(c.did) });
      Object.assign(c, { q: r.q, a: r.a, qav: r.qav, aav: r.aav, tname: r.tname }); if (r.typ) c.typ = r.typ; else delete c.typ; n++;
    }
    return n;
  }
  // ---------- ノートタイプの変更（app/ntedit.mjs の決まりで、ノートとカードを書き換える） ----------
  // そのノートタイプの、生きているノート（カードの mid は記録で書き換わる）。id の順（rslib は nid の順に作る）
  const notesOfType = mid => [...new Set(S.all.filter(c => !c.gone && +c.mid === +mid).map(c => c.nid))].filter(nid => S.noteRecs.get(nid)?.eff !== 'del').sort((a, b) => a - b);
  const lastDeckOf = mid => { const d = +S.meta.config?.['_nt_' + mid + '_lastDeck']; return S.decksById.has(d) ? d : null; };
  // カードを作る（rslib cardgen.rs）。exist＝残るカード [{ id, ord, did, type, due }]、target＝どのデッキにも決まらないときのデッキ
  function genCards(t, flds, exist, target, skipFull) {
    if (skipFull && t.type !== 1 && exist.length === t.tmpls.length) return [];
    const decks = new Set(exist.map(c => c.did)), exDeck = decks.size === 1 ? [...decks][0] : null, exNew = exist.find(c => c.type === 0);
    const req = cardsRequired(t, flds, new Set(exist.map(c => c.ord)), true);
    const ids = freshCardIds(req.length); let pos = null;
    return req.map((r, i) => { const d = deckForAdding(r.did ?? exDeck ?? target); if (exNew) return [ids[i], r.ord, d, exNew.due]; pos = pos || takePosition(); return [ids[i], r.ord, d, isRandom(d) ? pos.r : pos.p]; });
  }
  // ノートタイプを直した（plan＝ntedit.mjs prepareNotetype の返り値。S.meta.notetypes[mid] はもう新しいもの）。書き換えたノートの、元に戻す用の items を返す
  async function notetypeEdited(mid, plan) {
    const t = nt(mid); if (!t) return [];
    const recs = [], items = [];
    for (const nid of notesOfType(mid)) {
      const c0 = await content(nid); if (!c0) continue;
      const live = liveCards(nid);
      const flds = plan.fieldsChanged ? reorderFields(c0.flds, plan.fieldOrds) : c0.flds;
      let changed = plan.fieldsChanged;
      const gone = new Set(plan.tmpl.removed), exist = [];
      for (const c of live) {
        if (t.type !== 1 && gone.has(c.ord)) { changed = true; continue; }
        const ord = t.type !== 1 && plan.tmpl.moved.has(c.ord) ? plan.tmpl.moved.get(c.ord) : c.ord;
        if (ord !== c.ord) changed = true;
        exist.push({ id: c.id, ord, did: c.did, type: c.type, due: c.due });
      }
      const add = plan.generate && exist.length ? genCards(t, flds, exist, null, true) : [];   // rslib はカードの残っているノートだけから作る（全部消えたノートには作らない）
      if (add.length) changed = true;
      if (!changed) continue;
      const decks = new Set(exist.map(c => c.did)), did = decks.size === 1 ? [...decks][0] : (live[0]?.did ?? 1);
      recs.push({ id: nid, mid: +mid, flds, tags: c0.tags, did, cards: [...exist.map(c => [c.id, c.ord, c.did, c.type === 0 ? c.due : 0]), ...add], rev: newRev(nid), del: 0, added: c0.added });
      items.push({ nid, prev: { ...c0, did: live[0]?.did ?? 1, cards: live.map(cardRow) } });
    }
    if (recs.length) { for (const rec of recs) apply(rec); await env.store.addOps(recs.map(r => ({ t: 'note', n: wire(r) }))); env.changed(new Set(recs.map(r => r.id))); env.scheduleSync(); }
    return items;
  }
  // ブラウザの「ノートタイプを変更」。fmap[i]＝新しい i 番目のフィールドに入れる前のフィールドの位置（null＝空）、tmap[i]＝新しい i 番目のテンプレートに移す前のカードの ord（穴埋めがからむときは null）
  async function changeNotetypeOf(nids, newMid, fmap, tmap) {
    const t = nt(newMid); if (!t) return 0;
    const newNt = S.meta.notetypes[newMid], recs = [], items = [];
    for (const nid of nids) {   // 渡された順（rslib も note_ids の順に位置を割り当てる）
      const c0 = await content(nid); if (!c0) continue;
      const oldNt = S.meta.notetypes[c0.mid], live = liveCards(nid); if (!oldNt || !live.length) continue;
      const flds = remapFields(c0.flds, fmap), ords = remapCardOrds(live, oldNt, newNt, tmap), exist = [];
      live.forEach((c, i) => { if (ords[i] != null) exist.push({ id: c.id, ord: ords[i], did: c.did, type: c.type, due: c.due }); });
      const add = genCards(t, flds, exist, lastDeckOf(newMid), false);
      const decks = new Set(exist.map(c => c.did)), did = decks.size === 1 ? [...decks][0] : (live[0]?.did ?? 1);
      recs.push({ id: nid, mid: +newMid, flds, tags: c0.tags, did, cards: [...exist.map(c => [c.id, c.ord, c.did, c.type === 0 ? c.due : 0]), ...add], rev: newRev(nid), del: 0, added: c0.added });
      items.push({ nid, prev: { ...c0, did: live[0]?.did ?? 1, cards: live.map(cardRow) } });
    }
    if (!recs.length) return 0;
    await commit(recs, { kind: 'note', label: 'ノートタイプを変更', items });
    return recs.length;
  }
  // コレクションの置き換え（.colpkg）で消すノート。元に戻すは作らず、1回で積む
  async function removeNotes(nids) {
    const recs = [];
    for (const nid of nids) {
      const c0 = await content(nid); if (!c0) continue;
      const live = liveCards(nid); if (!live.length) continue;
      recs.push({ id: nid, mid: c0.mid, flds: c0.flds, tags: c0.tags, did: live[0].did, cards: live.map(cardRow), rev: newRev(nid), del: 1, added: c0.added });
    }
    if (!recs.length) return 0;
    for (const rec of recs) apply(rec);
    await env.store.addOps(recs.map(r => ({ t: 'note', n: wire(r) })));
    env.changed(new Set(recs.map(r => r.id))); env.scheduleSync();
    return recs.length;
  }
  return { ready, apply, reset, openAdd, openEdit, deleteFrom, deleteBrowse, undo, inverse, bulkEdit, addNote, notetype: nt, importRecords, removeNotes, rerender, notesOfType, notetypeEdited, changeNotetypeOf, isOpen: () => !!ed, close, element: build };
}
