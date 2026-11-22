// デッキ・コレクションの書き出し（.apkg・.colpkg）と、.apkg・.colpkg の読み込み（AnkiMobile 25.09 の「エクスポート」「iTunesからインポート」・ファイルを開く）。
// 書き出す中身の選び方は rslib 25.09.4 import_export/gather.rs（ExchangeData::gather_data）を、読み込みの決まりは apkg/import（notes.rs・decks.rs・cards.rs・media.rs）をなぞる。
// 端末の中の姿（束＋端末での変更）から、Anki の schema 11 の形を組み直して書く。パッケージの読み書きは app/pkg.mjs
import * as pkg from './pkg.mjs';

// ---------- 小物 ----------
const BASE91 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
// ノートの guid（rslib anki_base91(乱数 u64)）
export function guid64() {
  const b = crypto.getRandomValues(new Uint32Array(2)); let n = (BigInt(b[0]) << 32n) | BigInt(b[1]), s = '';
  while (n > 0n) { s = BASE91[Number(n % 91n)] + s; n /= 91n; }
  return s || 'a';
}
// HTML を取り、画像・音声のファイル名は残す（rslib strip_html_preserving_media_filenames）
const MEDIA_TAG = /<\b(?:img|audio|video|object|source)\b(?:[^>]|"[^"]+?"|'[^']+?')+?\b(?:src|data)\b=(?:"([^"]+?)"[^>]*>|'([^']+?)'[^>]*>|([^ >]+?)(?: [^>]*>|>))/gis;
export function stripHtmlMedia(h) {
  return pkg.decodeEntities(String(h).replace(MEDIA_TAG, (m, a, b, c) => ` ${a ?? b ?? c ?? ''} `)
    .replace(/<!--.*?-->/gs, '').replace(/<(?:style|script)[^>]*>.*?<\/(?:style|script)>/gis, '').replace(/<.*?>/gs, ''));
}
// 最初のフィールドの指紋（rslib field_checksum: sha1 の先頭 4 バイト）
export async function fieldChecksum(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(stripHtmlMedia(text))));
  return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
}
const DEFAULT_LATEX_PRE = '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';
const DEFAULT_LATEX_POST = '\\end{document}';
// アプリのノートタイプ（tools/export_anki.py の形。x にアプリで使わない値）→ schema 11
export function ntTo11(id, n) {
  const x = { ...(n.x || {}) };
  return {
    id: +id, name: n.name, type: n.type || 0, mod: 0, usn: -1, sortf: n.sortf || 0, did: null,
    tmpls: (n.templates || []).map(t => ({ name: t.name, ord: t.ord, qfmt: t.qfmt, afmt: t.afmt, bqfmt: '', bafmt: '', did: t.did ?? null, bfont: '', bsize: 0, id: null, ...(t.x || {}) })),
    flds: (n.fields || []).map(f => ({ name: f.name, ord: f.ord, sticky: !!f.sticky, rtl: !!f.rtl, font: f.font || 'Arial', size: f.size || 20, description: f.description || '', plainText: !!f.plainText,
      collapsed: false, excludeFromSearch: !!f.excludeFromSearch, id: null, tag: null, preventDeletion: false, ...(f.x || {}) })),
    css: n.css || '', latexPre: DEFAULT_LATEX_PRE, latexPost: DEFAULT_LATEX_POST, latexsvg: false, req: [], originalStockKind: 0,
    ...x,
  };
}
// schema 11 → アプリのノートタイプ（tools/export_anki.py と同じ形）
const NT_KNOWN = new Set(['id', 'name', 'css', 'type', 'sortf', 'flds', 'tmpls']);
const FLD_KNOWN = new Set(['name', 'ord', 'excludeFromSearch', 'font', 'size', 'sticky', 'rtl', 'plainText', 'description']);
const TMPL_KNOWN = new Set(['name', 'ord', 'qfmt', 'afmt', 'did']);
const extras = (o, known) => { const x = {}; for (const [k, v] of Object.entries(o)) if (!known.has(k)) x[k] = (k === 'id' || k === 'originalId') && v != null ? String(v) : v; return x; };
export function ntFrom11(m) {
  return { name: m.name, css: m.css || '', type: m.type || 0, sortf: m.sortf || 0,
    fields: (m.flds || []).map(f => ({ name: f.name, ord: f.ord, excludeFromSearch: !!f.excludeFromSearch, font: f.font || 'Arial', size: f.size || 20, sticky: !!f.sticky, rtl: !!f.rtl, plainText: !!f.plainText, description: f.description || '', x: extras(f, FLD_KNOWN) })),
    templates: (m.tmpls || []).map(t => ({ name: t.name, ord: t.ord, qfmt: t.qfmt || '', afmt: t.afmt || '', did: t.did ?? null, x: extras(t, TMPL_KNOWN) })),
    used: true, x: extras(m, NT_KNOWN) };
}
// デッキ（S.meta.decks の Anki の形。アプリが足した印を除く）→ schema 11
const APP_DECK_KEYS = new Set(['gone', 'cleared', 'local']);
function deckTo11(d) {
  const o = {}; for (const [k, v] of Object.entries(d)) if (!APP_DECK_KEYS.has(k)) o[k] = v;
  const z = [0, 0];
  for (const k of ['lrnToday', 'revToday', 'newToday', 'timeToday']) if (!Array.isArray(o[k])) o[k] = z.slice();
  if (o.desiredRetention != null && o.desiredRetention <= 1) o.desiredRetention = Math.trunc(o.desiredRetention * 100);   // 端末のオプション画面は 0.9 の形で持つ
  return { usn: -1, collapsed: false, browserCollapsed: false, desc: '', dyn: 0, conf: 1, extendNew: 0, extendRev: 0, reviewLimit: null, newLimit: null, reviewLimitToday: null, newLimitToday: null, desiredRetention: null, mod: 0, ...o };
}
// フィルターデッキ（S.fdecks・app の形）→ schema 11
function fdeckTo11(f) {
  return { id: f.id, mod: Math.floor((f.rev || 0) / 1000), name: f.name, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: '', dyn: 1,
    resched: !!f.resched, terms: (f.terms || []).slice(0, f.second === false ? 1 : 2).map(t => [t.search || '', t.limit ?? 100, t.order ?? 0]), separate: true, delays: null, previewDelay: 0,
    previewAgainSecs: f.previewAgain ?? 60, previewHardSecs: f.previewHard ?? 600, previewGoodSecs: f.previewGood ?? 0 };
}
const fold = s => String(s).toUpperCase().toLowerCase();
// カードの data（Anki の CardData）。記憶の値などの実数は、整数でも Anki と同じく「1.0」の形で書く
const cardData = d => Object.keys(d).length ? JSON.stringify(d).replace(/"(s|d|dr|decay)":(-?\d+)(?=[,}])/g, '"$1":$2.0') : '{}';
const parentNames = name => { const out = []; const p = name.split('::'); for (let i = 1; i < p.length; i++) out.push(p.slice(0, i).join('::')); return out; };

// env: { S, alive(c), loadNotes(), mediaNames(): Promise<string[]>, fetchMedia(name): Promise<Blob|null>, nextNewPos(), sql(): Promise<SQL>, zstd(): Promise<fn>, progress(text|null) }
export function createExchange(env) {
  const { S } = env;
  const deckList = () => [...S.meta.decks.filter(d => !d.gone).map(d => ({ id: d.id, name: d.name, dyn: 0, d })), ...[...S.fdecks.values()].filter(f => !f.removed).map(f => ({ id: f.id, name: f.name, dyn: 1, f }))];
  // アプリのカード → Anki の cards の行（フィルターデッキに入っているカードは did＝フィルターデッキ・odid＝元のデッキ）
  function cardRow(c) {
    const data = { ...(c.data || {}) }, flt = data.flt; delete data.flt;
    const base = { id: c.id, nid: c.nid, did: c.did, ord: c.ord, mod: Math.max(c.mod || 0, Math.floor((c.rev || 0) / 1000)), usn: -1, type: c.type, queue: c.queue, due: c.due, ivl: c.ivl || 0, factor: c.factor || 0,
      reps: c.reps || 0, lapses: c.lapses || 0, left: c.left || 0, odue: 0, odid: 0, flags: c.flags || 0, data: cardData(data) };
    if (flt && S.fdecks.get(flt.d) && !S.fdecks.get(flt.d).removed) Object.assign(base, { did: flt.d, odid: c.did, due: flt.due, odue: c.due, queue: flt.q });
    return base;
  }
  // ノートの行（束の生の中身＋端末の変更。マーク・リーチは端末で付け外ししたものを反映）
  async function noteRows(nids, cardsByNote) {
    const notes = await env.loadNotes(), out = [];
    for (const nid of nids) {
      const n = notes.get(nid); if (!n) continue;
      let tags = String(n.tags || '').trim().split(/\s+/).filter(Boolean);
      const cs = cardsByNote.get(nid) || [];
      const mk = cs.find(c => c.mark !== undefined);
      if (mk) { tags = tags.filter(t => fold(t) !== 'marked'); if (mk.mark) tags.push('marked'); }
      if (cs.some(c => c.leeched) && !tags.some(t => fold(t) === 'leech')) tags.push('leech');
      const rec = S.noteRecs?.get(nid), edited = rec && rec.eff === 'note';
      const flds = n.flds, first = String(flds).split('\x1f')[0];
      out.push({ id: nid, guid: n.guid || rec?.guid || guidFor(nid), mid: n.mid, mod: n.mod || Math.floor(Date.now() / 1000), usn: -1, tags: tags.length ? ` ${tags.join(' ')} ` : '',
        flds, sfld: n.sfld ?? '', csum: edited || !n.csum ? await fieldChecksum(first) : n.csum, flags: 0, data: '' });
    }
    return out;
  }
  // guid が分からないノート（古い束）には、ノートの id から決まる guid を付ける（同じ端末で何度書き出しても同じになるように）
  const guidFor = nid => { let n = BigInt(nid) * 0x9E3779B97F4A7C15n & 0xFFFFFFFFFFFFFFFFn, s = ''; while (n > 0n) { s = BASE91[Number(n % 91n)] + s; n /= 91n; } return s; };
  const ntOf = mid => S.meta.notetypes?.[mid];
  // ---------- 書き出す中身を集める（gather_data） ----------
  // search: { deck: did } か { all: true }。opts: { sched, configs }
  async function gather(search, { sched = true, configs = true } = {}) {
    const all = S.all.filter(c => env.alive(c) && c.type != null);
    const decks = deckList(), byId = new Map(decks.map(d => [d.id, d]));
    let picked;
    if (search.all) picked = all;
    else {
      const top = byId.get(search.deck); if (!top) throw new Error('デッキがありません。');
      const pre = fold(top.name + '::'), tree = new Set(decks.filter(d => d.id === top.id || fold(d.name).startsWith(pre)).map(d => d.id));
      // rslib の DeckIdWithChildren（c.did in …）: 今いるデッキで選ぶ（フィルターデッキに入っているカードは、元のデッキを書き出しても入らない）
      const cur = c => (c.data?.flt && S.fdecks.get(c.data.flt.d) && !S.fdecks.get(c.data.flt.d).removed ? c.data.flt.d : c.did);
      picked = all.filter(c => tree.has(cur(c)));
    }
    const nids = [...new Set(picked.map(c => c.nid))].sort((a, b) => a - b);
    const nidSet = new Set(nids);
    const cardsAll = search.all ? all : all.filter(c => nidSet.has(c.nid));   // そのノートのカードは全部（別のデッキにあっても）
    const byNote = new Map(); for (const c of cardsAll) { if (!byNote.has(c.nid)) byNote.set(c.nid, []); byNote.get(c.nid).push(c); }
    let cards = cardsAll.map(cardRow).sort((a, b) => a.id - b.id);
    let notes = await noteRows(nids, byNote);
    // デッキ: カードのデッキ（スケジュールを含めるなら元のデッキも）と、その親。スケジュールを含めないなら既定のデッキは除く
    const want = new Set(); for (const c of cards) { want.add(c.did); if (sched && c.odid) want.add(c.odid); }
    if (search.all) for (const d of decks) want.add(d.id);
    const names = new Set([...want].map(id => byId.get(id)?.name).filter(Boolean).map(fold));
    for (const id of [...want]) { const d = byId.get(id); if (!d) continue; for (const p of parentNames(d.name)) { if (names.has(fold(p))) continue; names.add(fold(p)); const pd = decks.find(x => fold(x.name) === fold(p)); if (pd) want.add(pd.id); } }
    let deckObjs = [...want].map(id => byId.get(id)).filter(Boolean).filter(d => !(!sched && d.id === 1 && !search.all)).map(d => d.dyn ? fdeckTo11(d.f) : deckTo11(d.d));
    const notetypes = [...new Set(notes.map(n => n.mid).concat(search.all ? Object.keys(S.meta.notetypes || {}).map(Number) : []))].filter(mid => ntOf(mid)).map(mid => ntTo11(mid, ntOf(mid)));
    // フィルターデッキを書けるか（全部のカードが、ふつうのデッキにあるか、元のデッキも書き出すか）
    const deckIds = new Set(deckObjs.map(d => d.id)), dynIds = new Set(deckObjs.filter(d => d.dyn).map(d => d.id));
    const allowFiltered = cards.every(c => (c.odid === 0 && deckIds.has(c.did) && !dynIds.has(c.did)) || c.odid === 1 || deckIds.has(c.odid));
    let revlog = [];
    if (sched) {
      const ids = new Set(cards.map(c => c.id));
      revlog = S.revlog.filter(r => ids.has(r.cid)).map(r => ({ ...r, usn: -1 })).sort((a, b) => a.id - b.id);
      if (!allowFiltered) for (const c of cards) if (c.odid) { c.odid = c.did; restoreFromFiltered(c); }
    } else {
      // スケジュールを含めない: マーク・リーチのタグを外し、カードを新規に戻す（位置は Anki の次の位置から）
      for (const n of notes) { const t = n.tags.trim().split(/\s+/).filter(x => x && !['marked', 'leech'].includes(fold(x))); n.tags = t.length ? ` ${t.join(' ')} ` : ''; }
      let pos = env.nextNewPos();
      for (const c of cards) { const did = c.did; if (scheduleAsNew(c, pos)) pos++; c.flags = 0; c.did = did; }
    }
    let dconf = [];
    if (configs) { const used = new Set(deckObjs.filter(d => !d.dyn).map(d => d.conf)); dconf = Object.values(S.meta.presets || {}).filter(p => used.has(p.id) || search.all).map(p => ({ ...p })); }
    // デッキを整える（reset_decks）
    for (const d of deckObjs) {
      if (!sched) { d.lrnToday = [0, 0]; d.revToday = [0, 0]; d.newToday = [0, 0]; d.timeToday = [0, 0]; d.collapsed = false; d.browserCollapsed = false; }
      if (!d.dyn) {
        if (!configs) d.conf = 1;
        if (!sched) Object.assign(d, { extendNew: 0, extendRev: 0, reviewLimit: null, reviewLimitToday: null, newLimit: null, newLimitToday: null });
      } else if (!sched || !allowFiltered) {
        const { resched, terms, separate, delays, previewDelay, previewAgainSecs, previewHardSecs, previewGoodSecs, ...rest } = d;
        Object.keys(d).forEach(k => delete d[k]); Object.assign(d, { ...rest, dyn: 0, conf: 1, desc: '', extendNew: 0, extendRev: 0, reviewLimit: null, newLimit: null, reviewLimitToday: null, newLimitToday: null, desiredRetention: null });
      }
    }
    return { cards, notes, decks: deckObjs, notetypes, revlog, dconf };
  }
  // rslib Card::remove_from_filtered_deck_restoring_queue（odid を立てたあとで呼ぶ）
  function restoreFromFiltered(c) {
    if (!c.odid) return;
    c.did = c.odid; c.odid = 0;
    if (c.odue) c.due = c.odue;
    if (c.queue >= 0) c.queue = c.type === 1 || c.type === 3 ? (c.due > 1_000_000_000 ? 1 : 3) : c.type === 0 ? 0 : 2;
    c.odue = 0;
  }
  // rslib Card::schedule_as_new(position, reset_counts=true, restore_position=true)。位置を使ったら true
  function scheduleAsNew(c, position) {
    const data = c.data ? JSON.parse(c.data) : {};
    const last = c.type === 0 ? (c.odid ? c.odue : c.due) : data.pos ?? null;
    if (c.odid) { c.did = c.odid; c.odid = 0; c.odue = 0; }
    c.due = last ?? position; c.type = 0; c.queue = 0; c.ivl = 0; c.factor = 0; delete data.pos; c.reps = 0; c.lapses = 0; delete data.s; delete data.d;
    c.data = cardData(data);
    return last == null;
  }
  // 画像・音声の名前（ノートのフィールドと、ノートタイプの「_」で始まるファイル）
  function mediaOf(notes, notetypes) {
    const s = new Set();
    for (const n of notes) for (const f of String(n.flds).split('\x1f')) for (const r of pkg.extractMediaRefs(f)) if (pkg.filenameIsSafe(r.decoded)) s.add(r.decoded);
    for (const m of notetypes) for (const x of pkg.notetypeMediaNames(m)) if (pkg.filenameIsSafe(x)) s.add(x);
    return [...s].sort();
  }
  async function mediaBlobs(names) {
    const out = []; let i = 0;
    for (const name of names) {
      if (++i % 20 === 0) env.progress?.(`メディアを集めています… ${i}/${names.length}`);
      const b = await env.fetchMedia(name).catch(() => null);
      if (b) out.push({ name, blob: b });
    }
    return out;
  }
  // ---------- 書き出す ----------
  // デッキを .apkg に（opts: { sched, configs, media }）。返す: { blob, name, notes, cards }
  async function exportDeck(did, opts = {}) {
    const o = { sched: true, configs: true, media: true, ...opts };
    env.progress?.('ファイルをエクスポート中...');
    const SQL = await env.sql();
    const g = await gather({ deck: did }, o);
    const media = o.media ? await mediaBlobs(mediaOf(g.notes, g.notetypes)) : [];
    const data = { crt: S.meta.crt, conf: colConf(false), notetypes: g.notetypes, decks: g.decks, dconf: g.dconf, tags: tagList(g.notes), notes: g.notes, cards: g.cards, revlog: g.revlog };
    const blob = await pkg.writePackage(SQL, data, media);
    env.progress?.(null);
    const d = deckList().find(x => x.id === did);
    return { blob, name: fileName(d?.name || 'deck') + '.apkg', notes: g.notes.length, cards: g.cards.length };
  }
  // コレクション全部を .colpkg に（画像・音声は opts.media が false でなければ全部）
  async function exportCollection(opts = {}) {
    const o = { media: true, ...opts };
    env.progress?.('ファイルをエクスポート中...');
    const SQL = await env.sql();
    const g = await gather({ all: true }, { sched: true, configs: true });
    const names = o.media ? [...new Set([...(await env.mediaNames()), ...mediaOf(g.notes, g.notetypes)])].sort() : [];
    const media = await mediaBlobs(names);
    const data = { crt: S.meta.crt, conf: colConf(true), notetypes: g.notetypes, decks: g.decks, dconf: g.dconf, tags: tagList(g.notes), notes: g.notes, cards: g.cards, revlog: g.revlog };
    const blob = await pkg.writePackage(SQL, data, media);
    env.progress?.(null);
    return { blob, name: 'collection.colpkg', notes: g.notes.length, cards: g.cards.length };
  }
  // コレクションの設定（colpkg は端末の設定を、apkg は Anki が新しいコレクションに書くものと同じ程度に）
  function colConf(full) {
    const c = S.meta.config || {}, out = {};
    if (full) for (const [k, v] of Object.entries(c)) if (v != null) out[k] = v;
    out.nextPos = env.nextNewPos();
    for (const k of ['creationOffset', 'localOffset', 'rollover', 'sched2021']) if (c[k] != null) out[k] = c[k];
    out.schedVer = 2;
    if (out.curDeck == null) out.curDeck = 1;
    return out;
  }
  const tagList = notes => { const m = new Map(); for (const n of notes) for (const t of n.tags.trim().split(/\s+/)) if (t && !m.has(fold(t))) m.set(fold(t), t); return [...m.values()]; };
  const fileName = s => String(s).replace(/::/g, '__').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'deck';

  return { exportDeck, exportCollection, gather };
}
