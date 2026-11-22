// デッキ・コレクションの書き出し（.apkg・.colpkg）と、.apkg・.colpkg の読み込み（AnkiMobile 25.09 の「エクスポート」「iTunesからインポート」・ファイルを開く）。
// 書き出す中身の選び方は rslib 25.09.4 import_export/gather.rs（ExchangeData::gather_data）を、読み込みの決まりは apkg/import（notes.rs・decks.rs・cards.rs・media.rs）をなぞる。
// 端末の中の姿（束＋端末での変更）から、Anki の schema 11 の形を組み直して書く。パッケージの読み書きは app/pkg.mjs
import * as pkg from './pkg.mjs';
import { planAdd, normalizeName } from './decks.mjs';
import { timingToday } from '../fsrs/sched.mjs';

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


  // ---------- 読み込み（rslib apkg/import をなぞる。merge_notetypes＝しない・ノートとノートタイプの更新＝新しければ） ----------
  // パッケージ側の gather_data（コレクション全部）。opts: { sched, configs }
  function gatherPackage(col, sched, configs) {
    const decksById = new Map(col.decks.map(d => [d.id, d])), byName = new Map(col.decks.map(d => [fold(d.name), d]));
    const notes = col.notes.map(n => ({ ...n })), cards = col.cards.map(c => ({ ...c }));
    const want = new Set(); for (const c of cards) { want.add(c.did); if (sched && c.odid) want.add(c.odid); }
    const names = new Set([...want].map(id => decksById.get(id)?.name).filter(Boolean).map(fold));
    for (const id of [...want]) { const d = decksById.get(id); if (!d) continue; for (const p of parentNames(d.name)) { if (names.has(fold(p))) continue; names.add(fold(p)); const pd = byName.get(fold(p)); if (pd) want.add(pd.id); } }
    const decks = [...want].map(id => decksById.get(id)).filter(Boolean).filter(d => !(!sched && d.id === 1)).map(d => structuredClone(d));
    const mids = new Set(notes.map(n => n.mid)), notetypes = col.notetypes.filter(m => mids.has(m.id)).map(m => structuredClone(m));
    const deckIds = new Set(decks.map(d => d.id)), dyn = new Set(decks.filter(d => d.dyn).map(d => d.id));
    const allowFiltered = cards.every(c => (!c.odid && deckIds.has(c.did) && !dyn.has(c.did)) || c.odid === 1 || deckIds.has(c.odid));
    let revlog = [];
    if (sched) {
      const ids = new Set(cards.map(c => c.id)); revlog = col.revlog.filter(r => ids.has(r.cid)).map(r => ({ ...r }));
      if (!allowFiltered) for (const c of cards) if (c.odid) { c.odid = c.did; restoreFromFiltered(c); }
    } else {
      for (const n of notes) { const t = String(n.tags).trim().split(/\s+/).filter(x => x && !['marked', 'leech'].includes(fold(x))); n.tags = t.length ? ` ${t.join(' ')} ` : ''; }
      let pos = Number(col.conf?.nextPos) || 0;
      for (const c of cards) { const did = c.did; if (scheduleAsNew(c, pos)) pos++; c.flags = 0; c.did = did; }
    }
    let dconf = [];
    if (configs) { const used = new Set(decks.filter(d => !d.dyn).map(d => +d.conf)); dconf = col.dconf.filter(c => used.has(+c.id)).map(c => structuredClone(c)); }
    for (const d of decks) {
      if (!sched) { d.lrnToday = [0, 0]; d.revToday = [0, 0]; d.newToday = [0, 0]; d.timeToday = [0, 0]; d.collapsed = false; d.browserCollapsed = false; }
      if (!d.dyn) {
        if (!configs) d.conf = 1;
        if (!sched) Object.assign(d, { extendNew: 0, extendRev: 0, reviewLimit: null, reviewLimitToday: null, newLimit: null, newLimitToday: null });
      } else if (!sched || !allowFiltered) {
        for (const k of ['resched', 'terms', 'separate', 'delays', 'previewDelay', 'previewAgainSecs', 'previewHardSecs', 'previewGoodSecs']) delete d[k];
        Object.assign(d, { dyn: 0, conf: 1, desc: '', extendNew: 0, extendRev: 0, reviewLimit: null, newLimit: null, reviewLimitToday: null, newLimitToday: null, desiredRetention: null });
      }
    }
    const daysElapsed = timingToday(Math.floor(Date.now() / 1000), { crt: col.crt, config: col.conf || {} }).daysElapsed;
    return { notes, cards, decks, notetypes, revlog, dconf, daysElapsed };
  }
  // 端末の中のノートタイプを schema 11 で
  const target11 = () => Object.entries(S.meta.notetypes || {}).map(([id, n]) => ntTo11(id, n));
  const fieldMatch = (a, b) => (a.id != null && b.id != null ? String(a.id) === String(b.id) : a.name === b.name);
  const equalSchema = (a, b) => a.flds.length === b.flds.length && a.tmpls.length === b.tmpls.length && a.flds.every((f, i) => fieldMatch(f, b.flds[i])) && a.tmpls.every((t, i) => fieldMatch(t, b.tmpls[i]));
  const shouldUpdate = (cond, existing, incoming) => (cond === 'always' ? existing !== incoming : cond === 'never' ? false : existing < incoming);
  // 端末の id と重ならない id（Anki のように時刻から。足すたびに 1 ずつ）
  function idMaker(used) { let t = Date.now(); return () => { while (used.has(t)) t++; used.add(t); return t++; }; }
  // 画像・音声の名前の付け替え（rslib replace_media_refs）
  function replaceMediaRefs(field, fn) {
    let changed = false;
    const out = field.replace(MEDIA_TAG, (m, a, b, c) => { const f = a ?? b ?? c; const r = fn(pkg.decodeEntities(f)); if (r == null) return m; changed = true; return m.replace(f, a != null || b != null ? r.replace(/"/g, '&quot;') : r); })
      .replace(/\[sound:(.+?)\]/gs, (m, f) => { const r = fn(pkg.decodeEntities(f)); if (r == null) return m; changed = true; return `[sound:${r}]`; });
    return changed ? out : null;
  }
  // 読み込みの計画を立てる（端末にはまだ何も書かない）。p＝pkg.readPackage の戻り値。opts: { sched, configs, updateNotes, updateNotetypes }
  async function planImport(p, opts = {}) {
    const o = { sched: true, configs: false, updateNotes: 'ifNewer', updateNotetypes: 'ifNewer', ...opts };
    const g = gatherPackage(p.col, o.sched, o.configs);
    const notesNow = await env.loadNotes();
    const plan = { notetypesAdd: [], notetypesUpdate: [], decksAdd: [], decksUpdate: [], dconfAdd: [], notesAdd: [], notesUpdate: [], cardsAdd: [], revlogAdd: [], media: [],
      log: { found: g.notes.length, new: 0, updated: 0, duplicate: 0, conflicting: 0, media: 0 }, daysElapsed: g.daysElapsed };
    // --- 画像・音声（prepare_media） ---
    const have = await env.mediaIndex();   // 名前 → sha1（16 進。束のものは先頭 10 桁）
    const checked = new Map(), unchecked = [];
    for (const e of p.media) {
      if (!pkg.filenameIsSafe(e.name)) throw new pkg.PackageError('指定したファイルは正当な .apkg ファイルではありません。');
      const name = pkg.normalizeFilename(e.name), ent = { ...e, name, used: false };
      const ex = have.get(name);
      if (name.startsWith('_') || name.startsWith('latex-')) { if (ex == null) unchecked.push(ent); continue; }
      if (ex != null) {
        if (!ent.sha1) ent.sha1 = await pkg.sha1hex(await e.bytes());
        if (!ent.sha1.startsWith(ex) && !ex.startsWith(ent.sha1)) { const orig = ent.name; ent.name = pkg.addHashSuffix(ent.name, ent.sha1); checked.set(orig, ent); }
      } else checked.set(name, ent);
    }
    const useMedia = name => { let n; try { if (!pkg.filenameIsSafe(name)) return null; n = pkg.normalizeFilename(name); } catch { return null; } const ent = checked.get(n); if (ent) { ent.used = true; return ent.name !== name ? ent.name : null; } return n !== name ? n : null; };
    // --- ノートタイプ（import_notetypes） ---
    const targets = target11(), remapNt = new Map(), usedNtIds = new Set(targets.map(m => +m.id));
    const ntName = new Set(targets.map(m => fold(m.name)));
    const newNtId = idMaker(usedNtIds);
    for (const inc of g.notetypes) {
      inc.originalId = String(inc.id);
      const ex = targets.find(m => +m.id === +inc.id);
      if (ex) {
        let existing = ex;
        if (!equalSchema(existing, inc)) {
          const dup = targets.find(m => +m.id !== +inc.id && String(m.originalId ?? '') === String(inc.id) && equalSchema(m, inc));
          if (dup) { remapNt.set(+inc.id, +dup.id); existing = dup; inc.id = +dup.id; }
          else { const old = +inc.id; inc.id = newNtId(); remapNt.set(old, inc.id); while (ntName.has(fold(inc.name))) { inc.name += '+'; inc.mod = Math.floor(Date.now() / 1000); } ntName.add(fold(inc.name)); plan.notetypesAdd.push(inc); targets.push(inc); continue; }
        }
        if (shouldUpdate(o.updateNotetypes, existing.mod || 0, inc.mod || 0)) { inc.id = +existing.id; plan.notetypesUpdate.push(inc); const i = targets.indexOf(existing); targets[i] = inc; }
      } else {
        while (ntName.has(fold(inc.name))) { inc.name += '+'; inc.mod = Math.floor(Date.now() / 1000); }
        ntName.add(fold(inc.name)); usedNtIds.add(+inc.id); plan.notetypesAdd.push(inc); targets.push(inc);
      }
    }
    const ntById = id => targets.find(m => +m.id === +id);
    // --- ノート（import_notes） ---
    const guids = new Map(); for (const [id, n] of notesNow) if (n.guid) guids.set(n.guid, { id, mod: n.mod || 0, mid: n.mid });
    const noteIds = new Set([...notesNow.keys(), ...(S.noteRecs ? S.noteRecs.keys() : [])]);
    const idMap = new Map(), tagCase = new Map(); for (const n of notesNow.values()) for (const t of String(n.tags).split(/\s+/)) if (t && !tagCase.has(fold(t))) tagCase.set(fold(t), t);
    const canonTags = tags => { const seen = new Map(); for (const t of String(tags).split(/[\s　]+/)) { if (!t) continue; const k = fold(t); if (seen.has(k)) continue; seen.set(k, tagCase.get(k) ?? t); if (!tagCase.has(k)) tagCase.set(k, t); } return [...seen.values()].sort((a, b) => (fold(a) < fold(b) ? -1 : fold(a) > fold(b) ? 1 : 0)); };
    const normalize = S.meta.config?.normalize_note_text !== false;
    for (const n0 of g.notes) {
      const n = { ...n0 }; if (remapNt.has(+n.mid)) n.mid = remapNt.get(+n.mid);
      const ex = guids.get(n.guid);
      const munge = () => { const f = String(n.flds).split('\x1f').map(x => replaceMediaRefs(x, useMedia) ?? x); n.flds = f.join('\x1f'); };
      if (ex) {
        if (+ex.mid !== +n.mid) { plan.log.conflicting++; continue; }
        if (shouldUpdate(o.updateNotes, ex.mod, n.mod)) {
          munge(); const t = ntById(n.mid); const flds = fixFields(n.flds, t, normalize);
          plan.notesUpdate.push({ id: ex.id, mid: +n.mid, flds, tags: canonTags(n.tags), mod: n.mod, guid: n.guid }); idMap.set(n0.id, ex.id); plan.log.updated++;
        } else { idMap.set(n0.id, ex.id); plan.log.duplicate++; }
        continue;
      }
      munge();
      const t = ntById(n.mid); if (!t) continue;
      const flds = fixFields(n.flds, t, normalize);
      let id = n.id; while (noteIds.has(id)) id += 999; noteIds.add(id);
      plan.notesAdd.push({ id, guid: n.guid, mid: +n.mid, mod: n.mod, flds, tags: canonTags(n.tags) }); idMap.set(n0.id, id); guids.set(n.guid, { id, mod: n.mod, mid: n.mid }); plan.log.new++;
    }
    // --- デッキとプリセット（import_decks_and_configs） ---
    const presetIds = new Set(Object.keys(S.meta.presets || {}).map(Number));
    for (const c of g.dconf) if (!presetIds.has(+c.id)) { plan.dconfAdd.push(c); presetIds.add(+c.id); }
    const W = deckList().map(d => ({ id: d.id, name: d.name, dyn: d.dyn })), deckMap = new Map(), renamedParents = [];
    const suffix = String(Math.floor(Date.now() / 1000));
    const level = d => d.name.split('::').length;
    for (const d of g.decks.slice().sort((a, b) => level(a) - level(b))) {
      for (const [from, to] of renamedParents) if (d.name.startsWith(from)) { d.name = to + d.name.slice(from.length); break; }
      if (!d.dyn) for (const k of ['newLimitToday', 'reviewLimitToday']) {
        const lim = d[k]; if (!lim) continue; const today = timingToday(Math.floor(Date.now() / 1000), S.meta).daysElapsed;
        if (lim.today === g.daysElapsed) lim.today = today; else if (today > 0) lim.today = Math.min(lim.today, today - 1); else d[k] = null;
      }
      const ex = W.find(x => fold(x.name) === fold(normalizeName(d.name)));
      if (ex && !!ex.dyn === !!d.dyn) {
        deckMap.set(d.id, ex.id);
        if (!d.dyn) plan.decksUpdate.push({ id: ex.id, desc: d.desc || '', md: !!d.md, conf: +d.conf, reviewLimit: d.reviewLimit ?? null, newLimit: d.newLimit ?? null, reviewLimitToday: d.reviewLimitToday ?? null, newLimitToday: d.newLimitToday ?? null });
        else plan.decksUpdate.push({ id: ex.id, filtered: d });
        continue;
      }
      if (ex) { const old = d.name + '::'; d.name = `${d.name} ${suffix}`; renamedParents.push([old, d.name + '::']); }
      // 親がフィルターデッキなら、その名前のふつうのデッキを作って付け替える（ensure_valid_first_existing_parent）
      const parts = normalizeName(d.name).split('::');
      for (let i = parts.length - 1; i >= 1; i--) {
        const pn = parts.slice(0, i).join('::'), pd = W.find(x => fold(x.name) === fold(pn)); if (!pd) continue;
        if (pd.dyn) { const nn = `${pd.name} ${suffix}`; const r = planAdd(W, nn); for (const c of r.created) { W.push({ id: c.id, name: c.name, dyn: 0 }); plan.decksAdd.push({ id: c.id, name: c.name, dyn: 0, d11: null }); } renamedParents.push([pd.name + '::', nn + '::']); d.name = nn + d.name.slice(pd.name.length); }
        break;
      }
      const r = planAdd(W, d.name);
      for (const c of r.created) { W.push({ id: c.id, name: c.name, dyn: c.id === r.id ? (d.dyn ? 1 : 0) : 0 }); plan.decksAdd.push({ id: c.id, name: c.name, dyn: c.id === r.id ? (d.dyn ? 1 : 0) : 0, d11: c.id === r.id ? { ...d, id: c.id, name: c.name } : null }); }
      deckMap.set(d.id, r.id);
    }
    // --- カードと記録（import_cards_and_revlog） ---
    const today = timingToday(Math.floor(Date.now() / 1000), S.meta).daysElapsed, delta = g.daysElapsed - today;
    const existingCards = new Set(S.all.filter(c => !c.gone).map(c => `${c.nid}:${c.ord}`)), cardIds = new Set(S.byId.keys()), cardMap = new Map();
    for (const c0 of g.cards) {
      const nid = idMap.get(c0.nid); if (nid == null) continue;
      if (existingCards.has(`${nid}:${c0.ord}`)) continue;
      const c = { ...c0, nid };
      if (deckMap.has(c.did)) c.did = deckMap.get(c.did);
      if (c.odid && deckMap.has(c.odid)) c.odid = deckMap.get(c.odid);
      if (c.queue === 2 || c.queue === 3 || c.type === 2) c.due -= delta;
      if (c.type === 2 && c.odue) c.odue -= delta;
      let id = c.id; while (cardIds.has(id)) id += 999; cardIds.add(id); cardMap.set(c0.id, id); c.id = id;
      existingCards.add(`${nid}:${c.ord}`);
      plan.cardsAdd.push(c);
    }
    const revIds = new Set(S.revIds || []);
    for (const r of g.revlog) { const cid = cardMap.get(r.cid); if (cid == null || revIds.has(r.id)) continue; revIds.add(r.id); plan.revlogAdd.push({ ...r, cid }); }
    // --- 使う画像・音声 ---
    plan.media = [...[...checked.values()].filter(e => e.used), ...unchecked];
    plan.log.media = plan.media.length;
    return plan;
  }
  // フィールドの数をノートタイプに合わせ（足りなければ空、多ければ捨てる）、NFC にする
  function fixFields(flds, t, normalize) {
    const n = Math.max(1, (t?.flds || []).length), a = String(flds).split('\x1f');
    while (a.length < n) a.push(''); a.length = n;
    return normalize ? a.map(x => x.normalize('NFC')) : a;
  }


  // パッケージのカード（schema 11 の行）→ アプリの状態（フィルターデッキに入っていれば、元のデッキでの状態＋data.flt。tools/export_anki.py の home_state と同じ）
  function stateOf(c) {
    const data = c.data ? JSON.parse(c.data) : {};
    const st = { type: c.type, queue: c.queue, due: c.due, ivl: c.ivl, factor: c.factor, reps: c.reps, lapses: c.lapses, left: c.left, data, flags: c.flags || 0 };
    if (c.odid) {
      const hdue = c.odue !== 0 ? c.odue : c.due;
      st.queue = c.queue >= 0 ? (c.type === 0 ? 0 : c.type === 2 ? 2 : hdue > 1_000_000_000 ? 1 : 3) : c.queue; st.due = hdue;
      data.flt = { d: c.did, due: c.due, q: c.queue };
    }
    return st;
  }
  const homeDeck = c => (c.odid ? c.odid : c.did);
  // フィルターデッキ（schema 11）→ アプリの形（tools/export_anki.py の fdeck_def と同じ）
  function fdeckFrom11(d, name) {
    const terms = (d.terms || []).slice(0, 2).map(t => ({ search: t[0], limit: +t[1], order: +t[2] }));
    return { id: d.id, name: name ?? d.name, terms: terms.length ? terms : [{ search: '', limit: 100, order: 1 }], second: terms.length > 1, resched: d.resched !== false,
      previewAgain: d.previewAgainSecs ?? 60, previewHard: d.previewHardSecs ?? 600, previewGood: d.previewGoodSecs ?? 0, mod: Math.floor(Date.now() / 1000) };
  }
  // 計画を端末の記録にして、同期で Anki とほかの端末に届ける。
  // hooks: { commitConf(rows), commitImported({ adds, updates, extraCards, rev }), addOps(ops), saveMedia(name, Uint8Array), done() }
  async function applyImport(plan, hooks) {
    const rev = Date.now(), rows = [], decksNow = new Set(deckList().map(d => d.id));
    // 1. ノートタイプ（nt:<id> に schema 11 のまま。アプリはここから描き、アドオンは同じ id で Anki に作る）
    for (const m of [...plan.notetypesAdd, ...plan.notetypesUpdate]) rows.push({ k: 'nt:' + m.id, v: m, rev });
    // 2. デッキ（ふつうのデッキは dname:<id>＝app/decks.mjs の記録。フィルターデッキは fdeck:<id>＝端末だけ）とプリセット・デッキの設定
    for (const a of plan.decksAdd) { decksNow.add(a.id); rows.push(a.dyn ? { k: 'fdeck:' + a.id, v: fdeckFrom11({ ...a.d11, id: a.id }, a.name), rev } : { k: 'dname:' + a.id, v: { name: a.name, created: 1 }, rev }); }
    for (const c of plan.dconfAdd) rows.push({ k: 'preset:' + c.id, v: { ...c, id: +c.id }, rev });
    const lim = d => { const v = {}; for (const k of ['reviewLimit', 'newLimit', 'reviewLimitToday', 'newLimitToday']) if (d[k] != null) v[k] = d[k]; return v; };
    for (const a of plan.decksAdd) if (!a.dyn && a.d11) rows.push({ k: 'deck:' + a.id, v: { conf: +a.d11.conf || 1, ...lim(a.d11), ...(a.d11.desc ? { desc: a.d11.desc } : {}), ...(a.d11.desiredRetention != null ? { desiredRetention: a.d11.desiredRetention } : {}) }, rev: rev + 1 });
    for (const u of plan.decksUpdate) {
      if (u.filtered) { const f = S.fdecks.get(u.id); rows.push({ k: 'fdeck:' + u.id, v: fdeckFrom11({ ...u.filtered, id: u.id }, f?.name), rev: Math.max(rev, (f?.rev || 0) + 1) }); continue; }
      const v = lim(u); if (u.desc) { v.desc = u.desc; if (u.md) v.md = true; } if (u.conf !== 1) v.conf = u.conf;
      if (Object.keys(v).length) rows.push({ k: 'deck:' + u.id, v, rev: Math.max(rev + 1, ((S.decksById.get(u.id)?.mod || 0) + 1) * 1000) });
    }
    if (rows.length) await hooks.commitConf(rows);
    // 3. ノート（足したノートは added=1・imp=1＝Anki でもこのカードだけを作る。既にあるノートの更新と、既にあるノートに増えるカード）
    const fixDeck = did => (decksNow.has(did) ? did : 1);
    const byNote = new Map(); for (const c of plan.cardsAdd) { if (!byNote.has(c.nid)) byNote.set(c.nid, []); byNote.get(c.nid).push(c); }
    const row = c => [c.id, c.ord, fixDeck(homeDeck(c)), c.odid ? (c.odue !== 0 ? c.odue : c.due) : c.due];
    const adds = plan.notesAdd.map(n => { const cs = byNote.get(n.id) || []; byNote.delete(n.id);
      return { id: n.id, guid: n.guid, mid: n.mid, flds: n.flds, tags: n.tags.join(' '), did: cs.length ? fixDeck(homeDeck(cs[0])) : 1, cards: cs.map(row), rev, del: 0, added: 1, imp: 1 }; });
    const updates = plan.notesUpdate.map(n => { const cs = byNote.get(n.id) || []; byNote.delete(n.id); return { id: n.id, mid: n.mid, flds: n.flds, tags: n.tags.join(' '), cards: cs.map(row) }; });
    const extraCards = [...byNote].map(([nid, cs]) => ({ id: nid, cards: cs.map(row) }));
    await hooks.commitImported({ adds, updates, extraCards, rev });
    // 4. カードの状態（学習の記録を含めたとき・新規のままでないカード）と、記録
    const ops = [];
    for (const c of plan.cardsAdd) {
      const st = stateOf(c); st.data = st.data || {};
      if (st.type === 0 && st.queue === 0 && !st.flags && !Object.keys(st.data).length) continue;   // 新規のまま（ノートの記録の位置で足りる）
      ops.push({ t: 'set', c: { id: c.id, st, rev } });
    }
    for (const r of plan.revlogAdd) ops.push({ t: 'rev', r: { id: r.id, cid: r.cid, ease: r.ease, ivl: r.ivl, lastIvl: r.lastIvl, factor: r.factor, time: r.time, type: r.type } });
    if (ops.length) await hooks.addOps(ops);
    // 5. 画像・音声（端末に置き、同期でサーバーへ送る）
    let i = 0;
    for (const m of plan.media) { if (++i % 10 === 0) env.progress?.(`メディアを読み込んでいます… ${i}/${plan.media.length}`); await hooks.saveMedia(m.name, await m.bytes()); }
    await hooks.done?.();
    return plan.log;
  }
  // ファイルを読み込む（.apkg・.colpkg）。opts: { sched, configs }。返すのは log
  async function importPackage(file, opts, hooks) {
    env.progress?.('ファイルをインポート中...');
    try {
      const SQL = await env.sql(), zstd = await env.zstd();
      const p = await pkg.readPackage(file, { SQL, zstd });
      const plan = await planImport(p, opts);
      return await applyImport(plan, hooks);
    } finally { env.progress?.(null); }
  }

  return { exportDeck, exportCollection, gather, planImport, gatherPackage, applyImport, importPackage, stateOf };
}
