// Anki のパッケージ（.apkg・.colpkg）を読み書きする。画面には触らない（app/exchange.mjs から使う）。
// 書く: 古い形（meta＝VERSION_LEGACY_2・collection.anki21＝schema 11 の SQLite・media＝JSON の対応表）。Anki 2.1.50 以降・AnkiDroid・AnkiMobile が読める
// 読む: いちばん古い形（collection.anki2）・古い形（collection.anki21）・新しい形（collection.anki21b＝zstd で縮めた schema 18。設定は protobuf）
// 中身は rslib 25.09.4 の import_export/package（meta.rs・media.rs・colpkg/export.rs）と、schema11.rs（notetype・decks・deckconfig）の変換をなぞる。
// SQLite は sql.js（opts.SQL）、zstd は fzstd（opts.zstd）を外から渡す。

// ---------- ZIP ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8, crc = 0) { crc = ~crc >>> 0; for (let i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8); return ~crc >>> 0; }
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;
const utf8 = new TextDecoder(), enc = new TextEncoder();
async function blobBytes(blob, a, b) { return new Uint8Array(await blob.slice(a, b).arrayBuffer()); }
async function inflateRaw(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
async function deflateRaw(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); }
export class PackageError extends Error {}

// 中の一覧を読む（中身は要るときに取る）。ZIP64 にも対応
export async function zipOpen(blob) {
  const size = blob.size, tailLen = Math.min(size, 65557 + 20);
  const tail = await blobBytes(blob, size - tailLen, size);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { at = i; break; }
  if (at < 0) throw new PackageError('ZIP の形になっていません（.apkg・.colpkg ではないか、途中で切れています）。');
  let count = u16(tail, at + 10), cdSize = u32(tail, at + 12), cdOff = u32(tail, at + 16);
  if ((count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) && at >= 20 && u32(tail, at - 20) === 0x07064b50) {
    const e64 = await blobBytes(blob, u64(tail, at - 12), u64(tail, at - 12) + 56);
    if (u32(e64, 0) !== 0x06064b50) throw new PackageError('ZIP64 の目次が壊れています。');
    count = u64(e64, 32); cdSize = u64(e64, 40); cdOff = u64(e64, 48);
  }
  const cd = await blobBytes(blob, cdOff, cdOff + cdSize);
  const entries = new Map();
  for (let p = 0, n = 0; n < count; n++) {
    if (u32(cd, p) !== 0x02014b50) throw new PackageError('ZIP の目次が壊れています。');
    const method = u16(cd, p + 10), crc = u32(cd, p + 16), nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32);
    let csize = u32(cd, p + 20), usize = u32(cd, p + 24), lho = u32(cd, p + 42);
    const name = utf8.decode(cd.subarray(p + 46, p + 46 + nl));
    for (let x = p + 46 + nl, end = x + xl; x + 4 <= end;) {
      const id = u16(cd, x), len = u16(cd, x + 2);
      if (id === 1) { let q = x + 4; if (usize === 0xffffffff) { usize = u64(cd, q); q += 8; } if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; } if (lho === 0xffffffff) lho = u64(cd, q); }
      x += 4 + len;
    }
    entries.set(name, { name, method, crc, csize, usize, lho });
    p += 46 + nl + xl + cl;
  }
  async function raw(e) {
    const h = await blobBytes(blob, e.lho, e.lho + 30);
    if (u32(h, 0) !== 0x04034b50) throw new PackageError('ZIP の中のファイルが壊れています: ' + e.name);
    const start = e.lho + 30 + u16(h, 26) + u16(h, 28);
    return blob.slice(start, start + e.csize);
  }
  return {
    names: [...entries.keys()], has: n => entries.has(n), entry: n => entries.get(n),
    // 中身（縮めてあれば戻す）
    async bytes(n) {
      const e = entries.get(n); if (!e) throw new PackageError('パッケージの中に ' + n + ' がありません。');
      const r = new Uint8Array(await (await raw(e)).arrayBuffer());
      if (e.method === 0) return r;
      if (e.method === 8) return inflateRaw(r);
      throw new PackageError(`対応していない縮め方です（${e.method}）: ${n}`);
    },
  };
}

// ZIP を作る。files: [{ name, data: Uint8Array | Blob, deflate }]。Blob はそのまま（縮めずに）つなぐので、大きな画像・音声も一度に持たない
export async function zipBuild(files) {
  const parts = [], cds = []; let off = 0;
  const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    let data = f.data, usize, csize, crc, method = 0;
    if (data instanceof Blob) { const u = new Uint8Array(await data.arrayBuffer()); crc = crc32(u); usize = csize = u.length; }
    else { crc = crc32(data); usize = data.length; if (f.deflate) { data = await deflateRaw(data); method = 8; } csize = data.length; }
    const big = usize >= 0xffffffff || csize >= 0xffffffff, bigOff = off >= 0xffffffff;
    const lh = new DataView(new ArrayBuffer(30 + name.length + (big ? 20 : 0)));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, big ? 45 : 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, big ? 0xffffffff : csize, true); lh.setUint32(22, big ? 0xffffffff : usize, true); lh.setUint16(26, name.length, true); lh.setUint16(28, big ? 20 : 0, true);
    new Uint8Array(lh.buffer).set(name, 30);
    if (big) { lh.setUint16(30 + name.length, 1, true); lh.setUint16(32 + name.length, 16, true); lh.setBigUint64(34 + name.length, BigInt(usize), true); lh.setBigUint64(42 + name.length, BigInt(csize), true); }
    parts.push(lh.buffer, data);
    cds.push({ name, method, crc, usize, csize, off, big, bigOff, dosTime, dosDate });
    off += lh.byteLength + csize;
  }
  const cdStart = off; let cdLen = 0;
  for (const c of cds) {
    const xl = (c.big ? 16 : 0) + (c.bigOff ? 8 : 0), x64 = xl ? 4 + xl : 0;
    const h = new DataView(new ArrayBuffer(46 + c.name.length + x64));
    h.setUint32(0, 0x02014b50, true); h.setUint16(4, 0x0314, true); h.setUint16(6, x64 ? 45 : 20, true); h.setUint16(8, 0x0800, true); h.setUint16(10, c.method, true);
    h.setUint16(12, c.dosTime, true); h.setUint16(14, c.dosDate, true); h.setUint32(16, c.crc, true);
    h.setUint32(20, c.big ? 0xffffffff : c.csize, true); h.setUint32(24, c.big ? 0xffffffff : c.usize, true); h.setUint16(28, c.name.length, true); h.setUint16(30, x64, true);
    h.setUint32(38, 0o100644 << 16, true); h.setUint32(42, c.bigOff ? 0xffffffff : c.off, true);
    new Uint8Array(h.buffer).set(c.name, 46);
    if (x64) { let q = 46 + c.name.length; h.setUint16(q, 1, true); h.setUint16(q + 2, xl, true); q += 4; if (c.big) { h.setBigUint64(q, BigInt(c.usize), true); h.setBigUint64(q + 8, BigInt(c.csize), true); q += 16; } if (c.bigOff) h.setBigUint64(q, BigInt(c.off), true); }
    parts.push(h.buffer); cdLen += h.byteLength;
  }
  const need64 = cds.length >= 0xffff || cdStart >= 0xffffffff || cdLen >= 0xffffffff;
  if (need64) {
    const e = new DataView(new ArrayBuffer(56 + 20)), at = cdStart + cdLen;
    e.setUint32(0, 0x06064b50, true); e.setBigUint64(4, 44n, true); e.setUint16(12, 45, true); e.setUint16(14, 45, true);
    e.setBigUint64(24, BigInt(cds.length), true); e.setBigUint64(32, BigInt(cds.length), true); e.setBigUint64(40, BigInt(cdLen), true); e.setBigUint64(48, BigInt(cdStart), true);
    e.setUint32(56, 0x07064b50, true); e.setBigUint64(64, BigInt(at), true); e.setUint32(72, 1, true);
    parts.push(e.buffer);
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, need64 ? 0xffff : cds.length, true); eocd.setUint16(10, need64 ? 0xffff : cds.length, true);
  eocd.setUint32(12, need64 ? 0xffffffff : cdLen, true); eocd.setUint32(16, need64 ? 0xffffffff : cdStart, true);
  parts.push(eocd.buffer);
  return new Blob(parts, { type: 'application/octet-stream' });
}

// ---------- protobuf（読むだけ。形は pip の anki 25.9.4 の記述子から取ったもの） ----------
const PB = {"Meta":{"1":["version","enum",0]},"Media":{"1":["entries","msg",1,"MediaEntry"]},"MediaEntry":{"1":["name","string",0],"2":["size","uint32",0],"3":["sha1","bytes",0],"255":["legacy_zip_filename","uint32",0]},"NtConfig":{"1":["kind","enum",0],"2":["sort_field_idx","uint32",0],"3":["css","string",0],"4":["target_deck_id_unused","int64",0],"5":["latex_pre","string",0],"6":["latex_post","string",0],"7":["latex_svg","bool",0],"8":["reqs","msg",1,"NtReq"],"9":["original_stock_kind","enum",0],"10":["original_id","int64",0],"255":["other","bytes",0]},"NtReq":{"1":["card_ord","uint32",0],"2":["kind","enum",0],"3":["field_ords","uint32",1]},"FieldConfig":{"1":["sticky","bool",0],"2":["rtl","bool",0],"3":["font_name","string",0],"4":["font_size","uint32",0],"5":["description","string",0],"6":["plain_text","bool",0],"7":["collapsed","bool",0],"8":["exclude_from_search","bool",0],"9":["id","int64",0],"10":["tag","uint32",0],"11":["prevent_deletion","bool",0],"255":["other","bytes",0]},"TmplConfig":{"1":["q_format","string",0],"2":["a_format","string",0],"3":["q_format_browser","string",0],"4":["a_format_browser","string",0],"5":["target_deck_id","int64",0],"6":["browser_font_name","string",0],"7":["browser_font_size","uint32",0],"8":["id","int64",0],"255":["other","bytes",0]},"DeckCommon":{"1":["study_collapsed","bool",0],"2":["browser_collapsed","bool",0],"3":["last_day_studied","uint32",0],"4":["new_studied","int32",0],"5":["review_studied","int32",0],"7":["milliseconds_studied","int32",0],"6":["learning_studied","int32",0],"255":["other","bytes",0]},"DeckKind":{"1":["normal","msg",0,"DeckNormal"],"2":["filtered","msg",0,"DeckFiltered"]},"DeckNormal":{"1":["config_id","int64",0],"2":["extend_new","uint32",0],"3":["extend_review","uint32",0],"4":["description","string",0],"5":["markdown_description","bool",0],"6":["review_limit","uint32",0],"7":["new_limit","uint32",0],"8":["review_limit_today","msg",0,"DayLimit"],"9":["new_limit_today","msg",0,"DayLimit"],"10":["desired_retention","float",0]},"DayLimit":{"1":["limit","uint32",0],"2":["today","uint32",0]},"DeckFiltered":{"1":["reschedule","bool",0],"2":["search_terms","msg",1,"SearchTerm"],"3":["delays","float",1],"4":["preview_delay","uint32",0],"7":["preview_again_secs","uint32",0],"5":["preview_hard_secs","uint32",0],"6":["preview_good_secs","uint32",0]},"SearchTerm":{"1":["search","string",0],"2":["limit","uint32",0],"3":["order","enum",0]},"DeckConfig":{"1":["learn_steps","float",1],"2":["relearn_steps","float",1],"3":["fsrs_params_4","float",1],"5":["fsrs_params_5","float",1],"6":["fsrs_params_6","float",1],"9":["new_per_day","uint32",0],"10":["reviews_per_day","uint32",0],"35":["new_per_day_minimum","uint32",0],"11":["initial_ease","float",0],"12":["easy_multiplier","float",0],"13":["hard_multiplier","float",0],"14":["lapse_multiplier","float",0],"15":["interval_multiplier","float",0],"16":["maximum_review_interval","uint32",0],"17":["minimum_lapse_interval","uint32",0],"18":["graduating_interval_good","uint32",0],"19":["graduating_interval_easy","uint32",0],"20":["new_card_insert_order","enum",0],"34":["new_card_gather_priority","enum",0],"32":["new_card_sort_order","enum",0],"30":["new_mix","enum",0],"33":["review_order","enum",0],"31":["interday_learning_mix","enum",0],"21":["leech_action","enum",0],"22":["leech_threshold","uint32",0],"23":["disable_autoplay","bool",0],"24":["cap_answer_time_to_secs","uint32",0],"25":["show_timer","bool",0],"38":["stop_timer_on_answer","bool",0],"41":["seconds_to_show_question","float",0],"42":["seconds_to_show_answer","float",0],"36":["question_action","enum",0],"43":["answer_action","enum",0],"44":["wait_for_audio","bool",0],"26":["skip_question_when_replaying_answer","bool",0],"27":["bury_new","bool",0],"28":["bury_reviews","bool",0],"29":["bury_interday_learning","bool",0],"37":["desired_retention","float",0],"46":["ignore_revlogs_before_date","string",0],"4":["easy_days_percentages","float",1],"40":["historical_retention","float",0],"45":["param_search","string",0],"255":["other","bytes",0]}};
// 64 ビットの整数は、安全に数として持てるなら数、持てなければ 10 進の文字列（フィールド・テンプレートの id は 64 ビットの乱数）
function varint(b, p) {
  let lo = 0, hi = 0, shift = 0, x;
  do { x = b[p.i++]; if (shift < 28) lo |= (x & 0x7f) << shift; else if (shift === 28) { lo |= (x & 0x0f) << 28; hi |= (x & 0x7f) >> 4; } else hi |= (x & 0x7f) << (shift - 32); shift += 7; } while (x & 0x80);
  return [lo >>> 0, hi >>> 0];
}
function toInt64([lo, hi], signed) {
  const big = (BigInt(hi) << 32n) | BigInt(lo), v = signed ? BigInt.asIntN(64, big) : big;
  return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
}
export function pbDecode(type, u8) {
  const T = PB[type], out = {}, p = { i: 0 }, dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  while (p.i < u8.length) {
    const [tag] = varint(u8, p), no = tag >>> 3, wt = tag & 7, f = T[no];
    let val, len;
    if (wt === 0) val = varint(u8, p);
    else if (wt === 1) { val = p.i; p.i += 8; }
    else if (wt === 5) { val = p.i; p.i += 4; }
    else if (wt === 2) { len = varint(u8, p)[0]; val = u8.subarray(p.i, p.i + len); p.i += len; }
    else throw new PackageError('protobuf が読めません');
    if (!f) continue;
    const [name, ty, rep, sub] = f;
    const one = v => {
      switch (ty) {
        case 'bool': return v[0] !== 0 || v[1] !== 0;
        case 'enum': case 'int32': return v[0] | 0;
        case 'uint32': return v[0];
        case 'int64': return toInt64(v, true);
        case 'uint64': return toInt64(v, false);
        case 'float': return dv.getFloat32(v, true);
        case 'double': return dv.getFloat64(v, true);
        case 'string': return utf8.decode(v);
        case 'bytes': return v.slice();
        case 'msg': return pbDecode(sub, v);
      }
    };
    if (rep && wt === 2 && ty !== 'string' && ty !== 'bytes' && ty !== 'msg') {   // 詰めて並べた数（packed）
      const arr = out[name] || (out[name] = []), q = { i: 0 }, sv = new DataView(val.buffer, val.byteOffset, val.byteLength);
      while (q.i < val.length) {
        if (ty === 'float') { arr.push(sv.getFloat32(q.i, true)); q.i += 4; }
        else if (ty === 'double') { arr.push(sv.getFloat64(q.i, true)); q.i += 8; }
        else { const v = varint(val, q); arr.push(ty === 'int64' ? toInt64(v, true) : ty === 'uint64' ? toInt64(v, false) : ty === 'int32' || ty === 'enum' ? v[0] | 0 : ty === 'bool' ? v[0] !== 0 : v[0]); }
      }
      continue;
    }
    const v = wt === 1 && (ty === 'double') ? one(val) : wt === 5 && ty === 'float' ? one(val) : one(val);
    if (rep) (out[name] || (out[name] = [])).push(v); else out[name] = v;
  }
  return out;
}

// ---------- JSON（64 ビットの id を壊さずに） ----------
// 文字列の外にある 16 桁以上の整数を文字列にしてから読む（JavaScript の数は 2^53 を超えると丸まる）
export function parseJSONBig(text) {
  if (typeof text !== 'string') text = utf8.decode(text);
  let out = '', i = 0, inStr = false, last = 0;
  for (; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (inStr) { if (ch === 92) i++; else if (ch === 34) inStr = false; continue; }
    if (ch === 34) { inStr = true; continue; }
    if ((ch >= 48 && ch <= 57) || ch === 45) {
      let j = i + 1; while (j < text.length && /[0-9.eE+-]/.test(text[j])) j++;
      const num = text.slice(i, j);
      if (/^-?\d{16,}$/.test(num) && !Number.isSafeInteger(Number(num))) { out += text.slice(last, i) + '"' + num + '"'; last = j; }
      i = j - 1;
    }
  }
  return JSON.parse(out + text.slice(last));
}
// 書くときは、フィールド・テンプレートの id（文字列にしたもの）を数に戻す
export const stringify11 = o => JSON.stringify(o).replace(/"(id|originalId)":"(-?\d+)"/g, '"$1":$2');
// f32 を、Anki（serde_json）が書くのと同じいちばん短い 10 進に
export function f32(x) {
  if (x == null || !Number.isFinite(x)) return x;
  for (let p = 1; p <= 9; p++) { const s = +x.toPrecision(p); if (Math.fround(s) === Math.fround(x)) return s; }
  return x;
}
const f32s = a => (a || []).map(f32);
const otherJSON = (u8, reserved) => { if (!u8 || !u8.length) return {}; let o; try { o = parseJSONBig(u8); } catch { return {}; } if (!o || typeof o !== 'object' || Array.isArray(o)) return {}; for (const k of reserved) delete o[k]; return o; };

// ---------- schema 18 → schema 11（rslib の notetype/decks/deckconfig の schema11.rs をなぞる） ----------
const RES_NT = ['latexPost', 'flds', 'css', 'originalStockKind', 'originalId', 'id', 'usn', 'mod', 'req', 'latexPre', 'name', 'did', 'tmpls', 'type', 'sortf', 'latexsvg'];
const RES_FLD = ['name', 'ord', 'sticky', 'rtl', 'plainText', 'font', 'size', 'collapsed', 'description', 'excludeFromSearch', 'id', 'tag', 'preventDeletion'];
const RES_TMPL = ['name', 'ord', 'did', 'afmt', 'bafmt', 'qfmt', 'bqfmt', 'bfont', 'bsize', 'id'];
const REQ_KIND = ['none', 'any', 'all'];
function nt18to11(row, flds, tmpls) {
  const c = pbDecode('NtConfig', row.config);
  return {
    id: row.id, name: row.name, type: c.kind === 1 ? 1 : 0, mod: row.mtime_secs, usn: row.usn, sortf: c.sort_field_idx || 0,
    did: c.target_deck_id_unused ? c.target_deck_id_unused : null,
    tmpls: tmpls.map(t => { const tc = pbDecode('TmplConfig', t.config); return { name: t.name, ord: t.ord, qfmt: tc.q_format || '', afmt: tc.a_format || '', bqfmt: tc.q_format_browser || '', bafmt: tc.a_format_browser || '',
      did: tc.target_deck_id > 0 ? tc.target_deck_id : null, bfont: tc.browser_font_name || '', bsize: tc.browser_font_size || 0, id: tc.id ?? null, ...otherJSON(tc.other, RES_TMPL) }; }),
    flds: flds.map(f => { const fc = pbDecode('FieldConfig', f.config); return { name: f.name, ord: f.ord, sticky: !!fc.sticky, rtl: !!fc.rtl, font: fc.font_name || '', size: fc.font_size || 0, description: fc.description || '',
      plainText: !!fc.plain_text, collapsed: !!fc.collapsed, excludeFromSearch: !!fc.exclude_from_search, id: fc.id ?? null, tag: fc.tag ?? null, preventDeletion: !!fc.prevent_deletion, ...otherJSON(fc.other, RES_FLD) }; }),
    css: c.css || '', latexPre: c.latex_pre || '', latexPost: c.latex_post || '', latexsvg: !!c.latex_svg,
    req: (c.reqs || []).map(r => [r.card_ord || 0, REQ_KIND[r.kind || 0], r.field_ords || []]),
    originalStockKind: c.original_stock_kind || 0, ...(c.original_id != null ? { originalId: c.original_id } : {}),
    ...otherJSON(c.other, RES_NT),
  };
}
const RES_DECK = ['usn', 'revToday', 'newLimit', 'dyn', 'reviewLimit', 'newToday', 'timeToday', 'reviewLimitToday', 'extendNew', 'mod', 'newLimitToday', 'desc', 'name', 'lrnToday', 'conf', 'browserCollapsed', 'extendRev', 'id', 'collapsed', 'desiredRetention'];
const dayLimit = d => d ? { limit: d.limit || 0, today: d.today || 0 } : null;
function deck18to11(row) {
  const cm = pbDecode('DeckCommon', row.common), k = pbDecode('DeckKind', row.kind), day = cm.last_day_studied || 0;
  const common = { id: row.id, mod: row.mtime_secs, name: String(row.name).split('\x1f').join('::'), usn: row.usn,
    lrnToday: [day, cm.learning_studied || 0], revToday: [day, cm.review_studied || 0], newToday: [day, cm.new_studied || 0], timeToday: [day, cm.milliseconds_studied || 0],
    collapsed: !!cm.study_collapsed, browserCollapsed: !!cm.browser_collapsed };
  if (k.filtered) {
    const f = k.filtered;
    return { ...common, desc: '', dyn: 1, ...otherJSON(cm.other, RES_DECK), resched: !!f.reschedule, terms: (f.search_terms || []).map(t => [t.search || '', t.limit || 0, t.order || 0]), separate: true,
      delays: (f.delays || []).length ? f.delays.map(f32) : null, previewDelay: f.preview_delay || 0, previewAgainSecs: f.preview_again_secs || 0, previewHardSecs: f.preview_hard_secs || 0, previewGoodSecs: f.preview_good_secs || 0 };
  }
  const n = k.normal || {};
  return { ...common, desc: n.description || '', ...(n.markdown_description ? { md: true } : {}), dyn: 0, ...otherJSON(cm.other, RES_DECK),
    conf: n.config_id ?? 1, extendNew: n.extend_new || 0, extendRev: n.extend_review || 0, reviewLimit: n.review_limit ?? null, newLimit: n.new_limit ?? null,
    reviewLimitToday: dayLimit(n.review_limit_today), newLimitToday: dayLimit(n.new_limit_today),
    desiredRetention: n.desired_retention != null ? Math.trunc(Math.fround(n.desired_retention) * 100) : null };
}
const RES_DC = ['id', 'mod', 'name', 'usn', 'maxTaken', 'autoplay', 'timer', 'replayq', 'new', 'rev', 'lapse', 'dyn', 'newMix', 'newPerDayMinimum', 'interdayLearningMix', 'reviewOrder', 'newSortOrder', 'newGatherPriority',
  'buryInterdayLearning', 'fsrsWeights', 'fsrsParams5', 'fsrsParams6', 'desiredRetention', 'ignoreRevlogsBeforeDate', 'easyDaysPercentages', 'stopTimerOnAnswer', 'secondsToShowQuestion', 'secondsToShowAnswer',
  'questionAction', 'answerAction', 'waitForAudio', 'sm2Retention', 'weightSearch'];
const RES_DC_NEW = ['bury', 'delays', 'initialFactor', 'ints', 'order', 'perDay'], RES_DC_REV = ['bury', 'ease4', 'ivlFct', 'maxIvl', 'perDay', 'hardFactor'], RES_DC_LAPSE = ['delays', 'leechAction', 'leechFails', 'minInt', 'mult'];
function dconf18to11(row) {
  const i = pbDecode('DeckConfig', row.config);
  let top = {}, nw = {}, rv = {}, lp = {};
  if (i.other && i.other.length) {
    try { top = parseJSONBig(i.other) || {}; } catch { top = {}; }
    const take = (k, res) => { const v = top[k]; delete top[k]; if (!v || typeof v !== 'object') return {}; for (const r of res) delete v[r]; return v; };
    nw = take('new', RES_DC_NEW); rv = take('rev', RES_DC_REV); lp = take('lapse', RES_DC_LAPSE);
    for (const r of RES_DC) delete top[r];
  }
  const ans = { 1: 1, 2: 2, 3: 3, 4: 4 }[i.answer_action] ?? 0;
  return {
    id: row.id, mod: row.mtime_secs, name: row.name, usn: row.usn, maxTaken: i.cap_answer_time_to_secs || 0, autoplay: !i.disable_autoplay, timer: i.show_timer ? 1 : 0, replayq: !i.skip_question_when_replaying_answer,
    new: { bury: !!i.bury_new, delays: f32s(i.learn_steps), initialFactor: Math.trunc(Math.fround(i.initial_ease || 0) * 1000) & 0xffff, ints: [i.graduating_interval_good || 0, i.graduating_interval_easy || 0, 0],
      order: i.new_card_insert_order === 1 ? 0 : 1, perDay: i.new_per_day || 0, ...nw },
    rev: { bury: !!i.bury_reviews, ease4: f32(i.easy_multiplier || 0), ivlFct: f32(i.interval_multiplier || 0), maxIvl: i.maximum_review_interval || 0, perDay: i.reviews_per_day || 0, hardFactor: f32(i.hard_multiplier || 0), ...rv },
    lapse: { delays: f32s(i.relearn_steps), leechAction: i.leech_action === 1 ? 1 : 0, leechFails: i.leech_threshold || 0, minInt: i.minimum_lapse_interval || 0, mult: f32(i.lapse_multiplier || 0), ...lp },
    dyn: false, newMix: i.new_mix || 0, newPerDayMinimum: i.new_per_day_minimum || 0, interdayLearningMix: i.interday_learning_mix || 0, reviewOrder: i.review_order || 0, newSortOrder: i.new_card_sort_order || 0,
    newGatherPriority: i.new_card_gather_priority || 0, buryInterdayLearning: !!i.bury_interday_learning, fsrsWeights: f32s(i.fsrs_params_4), fsrsParams5: f32s(i.fsrs_params_5), fsrsParams6: f32s(i.fsrs_params_6),
    desiredRetention: f32(i.desired_retention || 0), ignoreRevlogsBeforeDate: i.ignore_revlogs_before_date || '', easyDaysPercentages: f32s(i.easy_days_percentages),
    stopTimerOnAnswer: !!i.stop_timer_on_answer, secondsToShowQuestion: f32(i.seconds_to_show_question || 0), secondsToShowAnswer: f32(i.seconds_to_show_answer || 0),
    questionAction: i.question_action === 1 ? 1 : 0, answerAction: ans, waitForAudio: !!i.wait_for_audio, sm2Retention: f32(i.historical_retention || 0), weightSearch: i.param_search || '',
    ...top,
  };
}

// ---------- コレクション（SQLite）を読む ----------
function rows(db, sql, params) {
  const st = db.prepare(sql); const out = [];
  try { if (params) st.bind(params); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
  return out;
}
// 戻り値（どちらの形でも schema 11 の JSON の形にそろえる）:
//   { ver, crt, conf, notetypes: [..], decks: [..], dconf: [..], notes: [{id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data}], cards: [..全部の列], revlog: [..], tags: [..] }
export function readCollection(SQL, bytes) {
  const db = new SQL.Database(bytes);
  try {
    const col = rows(db, 'select crt, mod, scm, ver, conf, models, decks, dconf, tags from col')[0];
    if (!col) throw new PackageError('コレクションの中身がありません。');
    const out = { ver: col.ver, crt: col.crt, mod: col.mod };
    if (col.ver >= 15) {
      out.conf = {}; for (const r of rows(db, 'select KEY as k, val from config')) { try { out.conf[r.k] = parseJSONBig(r.val); } catch {} }
      const flds = new Map(), tmpls = new Map();
      for (const f of rows(db, 'select ntid, ord, name, config from fields order by ntid, ord')) { if (!flds.has(f.ntid)) flds.set(f.ntid, []); flds.get(f.ntid).push(f); }
      for (const t of rows(db, 'select ntid, ord, name, mtime_secs, usn, config from templates order by ntid, ord')) { if (!tmpls.has(t.ntid)) tmpls.set(t.ntid, []); tmpls.get(t.ntid).push(t); }
      out.notetypes = rows(db, 'select id, name, mtime_secs, usn, config from notetypes').map(r => nt18to11(r, flds.get(r.id) || [], tmpls.get(r.id) || []));
      out.decks = rows(db, 'select id, name, mtime_secs, usn, common, kind from decks').map(deck18to11);
      out.dconf = rows(db, 'select id, name, mtime_secs, usn, config from deck_config').map(dconf18to11);
      // tags 表は主キーが Anki の照合（unicase）で、sql.js では読めない。タグはノートから集める（下）
    } else {
      out.conf = col.conf ? parseJSONBig(col.conf) : {};
      out.notetypes = Object.values(col.models ? parseJSONBig(col.models) : {});
      out.decks = Object.values(col.decks ? parseJSONBig(col.decks) : {});
      out.dconf = Object.values(col.dconf ? parseJSONBig(col.dconf) : {});
    }
    for (const n of out.notetypes) { n.id = +n.id; }
    for (const d of out.decks) { d.id = +d.id; if (d.conf != null) d.conf = +d.conf; }
    for (const c of out.dconf) c.id = +c.id;
    out.notes = rows(db, 'select id, guid, mid, mod, usn, tags, flds, cast(sfld as text) as sfld, csum, flags, data from notes order by id');
    out.cards = rows(db, 'select id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data from cards order by id');
    out.revlog = rows(db, 'select id, cid, usn, ease, ivl, lastIvl, factor, time, type from revlog order by id');
    const tags = new Map(); for (const n of out.notes) for (const t of String(n.tags).split(/[ \u3000]+/)) if (t && !tags.has(t.toLowerCase())) tags.set(t.toLowerCase(), t);
    out.tags = [...tags.values()];
    return out;
  } finally { db.close(); }
}

// ---------- パッケージを読む ----------
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
// 返す: { version（1/2/3）, col（readCollection の形）, media: [{ name, size, sha1（16 進・分からなければ null）, bytes() }] }
export async function readPackage(blob, { SQL, zstd }) {
  const z = await zipOpen(blob);
  const version = z.has('meta') ? (pbDecode('Meta', await z.bytes('meta')).version || 0) : 1;
  if (version > 3 || version < 1) throw new PackageError('このパッケージは新しすぎる形で、読めません（Anki を新しくしてから書き出し直してください）。');
  const zs = version >= 3;
  const unz = u8 => { if (!zs) return u8; if (!zstd) throw new PackageError('zstd を開く部品がありません。'); return zstd(u8); };
  const colName = version === 1 ? 'collection.anki2' : version === 2 ? 'collection.anki21' : 'collection.anki21b';
  if (!z.has(colName)) throw new PackageError('パッケージの中にコレクションがありません。');
  const col = readCollection(SQL, unz(await z.bytes(colName)));
  // 画像・音声の一覧（古い形＝{"0": 名前}・新しい形＝protobuf の MediaEntries。名前の順に 0,1,2… が中のファイル名）
  let media = [];
  if (z.has('media')) {
    const raw = await z.bytes('media');
    if (zs) {
      const m = pbDecode('Media', unz(raw));
      media = (m.entries || []).map((e, i) => ({ name: e.name, zipName: String(e.legacy_zip_filename ?? i), size: e.size ?? null, sha1: e.sha1 && e.sha1.length ? hex(e.sha1) : null }));
    } else {
      let map = {}; try { map = JSON.parse(utf8.decode(raw) || '{}'); } catch { throw new PackageError('画像・音声の一覧が壊れています。'); }
      media = Object.entries(map).map(([zipName, name]) => ({ name, zipName, size: null, sha1: null }));
    }
  }
  for (const m of media) {
    const e = z.entry(m.zipName);
    if (e && m.size == null && !zs) m.size = e.usize;
    m.bytes = async () => unz(await z.bytes(m.zipName));
    m.present = !!e;
  }
  return { version, col, media: media.filter(m => m.present) };
}

// ---------- パッケージを書く（古い形） ----------
const DDL11 = `CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL);
CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL);
CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_notes_csum ON notes (csum);`;
// 数を SQLite の整数として入れる（sql.js は 2^31 を超える数を実数で渡すので BigInt にする）
const I = v => (typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : v);
// data: { crt, mod, conf, notetypes, decks, dconf, tags, notes, cards, revlog }（readCollection と同じ形）。schema 11 の SQLite を返す
export function writeCollection(SQL, data) {
  const db = new SQL.Database();
  try {
    db.exec('PRAGMA page_size = 4096; PRAGMA legacy_file_format = 0;');
    db.exec(DDL11);
    const obj = (list) => { const o = {}; for (const x of list) o[x.id] = x; return o; };
    const tags = {}; for (const t of data.tags || []) tags[t] = 0;
    const now = Date.now();
    db.run('insert into col values (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)', [I(data.crt), I(data.mod ?? now), I(data.scm ?? now), JSON.stringify(data.conf || {}),
      stringify11(obj(data.notetypes)), stringify11(obj(data.decks)), stringify11(obj(data.dconf)), JSON.stringify(tags)]);
    db.exec('BEGIN');
    let st = db.prepare('insert into notes values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const n of data.notes) st.run([I(n.id), n.guid, I(n.mid), I(n.mod), I(n.usn ?? -1), n.tags, n.flds, typeof n.sfld === 'number' ? I(n.sfld) : n.sfld, I(n.csum), I(n.flags || 0), n.data || '']);
    st.free();
    st = db.prepare('insert into cards values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const c of data.cards) st.run([c.id, c.nid, c.did, c.ord, c.mod, c.usn ?? -1, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.left, c.odue || 0, c.odid || 0, c.flags || 0, c.data || '{}'].map(I));
    st.free();
    st = db.prepare('insert into revlog values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of data.revlog) st.run([r.id, r.cid, r.usn ?? -1, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type].map(I));
    st.free();
    db.exec('COMMIT');
    return db.export();
  } finally { db.close(); }
}
// media: [{ name, blob }]（Blob のまま。名前の順に 0,1,2… を中のファイル名にする）
export async function writePackage(SQL, data, media = []) {
  const files = [{ name: 'meta', data: new Uint8Array([0x08, 0x02]) }, { name: 'collection.anki21', data: writeCollection(SQL, data), deflate: true }];
  const map = {};
  media.forEach((m, i) => { map[i] = m.name; files.push({ name: String(i), data: m.blob }); });
  files.push({ name: 'media', data: enc.encode(JSON.stringify(map)) });
  return zipBuild(files);
}

// ---------- 画像・音声の名前（rslib text.rs・media/files.rs） ----------
const HTML_MEDIA_TAGS = /<\b(?:img|audio|video|object|source)\b(?:[^>]|"[^"]+?"|'[^']+?')+?\b(?:src|data)\b=(?:"([^"]+?)"[^>]*>|'([^']+?)'[^>]*>|([^ >]+?)(?: [^>]*>|>))/gis;
const AV_TAGS = /\[sound:(.+?)\]|\[anki:tts\]\[(.*?)\](.*?)\[\/anki:tts\]/gs;
const UNDERSCORED_CSS = /(?:@import\s+"(_[^"]*.css)"|'(_[^']*.css)')|(?:url\(\s*"(_[^"]+)"|'(_[^']+)'|(_.+?)\s*\))/gi;
const UNDERSCORED_REFS = /\[sound:(_[^\]]+)\]|"(_[^"]+)"|'(_[^']+)'|\b(?:src|data)=(_[^ >]+)/g;
export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  const t = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };   // htmlescape の decode_html のあと、nbsp（U+00A0）は空白に（rslib decode_entities）
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => { if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n <= 0x10ffff ? (n === 0xa0 ? ' ' : String.fromCodePoint(n)) : m; } return t[e.toLowerCase()] ?? m; });
}
// フィールドの中で使っている画像・音声（[{ full, fname, decoded }]）
export function extractMediaRefs(text) {
  const out = [];
  for (const m of text.matchAll(HTML_MEDIA_TAGS)) { const f = m[1] ?? m[2] ?? m[3]; out.push({ full: m[0], fname: f, decoded: decodeEntities(f) }); }
  for (const m of text.matchAll(AV_TAGS)) if (m[1] != null) out.push({ full: m[0], fname: m[1], decoded: decodeEntities(m[1]) });
  return out;
}
// ノートタイプの CSS・テンプレートが使う「_」で始まるファイル
export function notetypeMediaNames(nt) {
  const out = [];
  for (const m of String(nt.css || '').matchAll(UNDERSCORED_CSS)) out.push(m.slice(1).find(x => x != null));
  for (const t of nt.tmpls || nt.templates || []) for (const side of [t.qfmt, t.afmt]) for (const m of String(side || '').matchAll(UNDERSCORED_REFS)) out.push(m.slice(1).find(x => x != null));
  return out.filter(Boolean);
}
// ファイル名を Anki と同じく直す（normalize_filename）。不可能な字を消し、Windows で使えない名前を避け、120 バイトに切る
const MAX_NAME = 120;
const truncBytes = (s, max) => { const b = enc.encode(s); if (b.length <= max) return s; let n = max; while (n > 0 && (b[n] & 0xc0) === 0x80) n--; return utf8.decode(b.subarray(0, n)); };
function splitTrunc(fname, maxBytes) {
  const i = fname.lastIndexOf('.');
  let stem = i < 0 ? fname : fname.slice(0, i), ext = i < 0 ? '' : fname.slice(i + 1);
  ext = truncBytes(ext, 10);
  stem = truncBytes(stem, maxBytes - enc.encode(ext).length - 2);
  return [stem, ext];
}
export function normalizeFilename(name) {
  let f = String(name).normalize('NFC');
  f = f.replace(/[[\]<>:"/?*^\\|\x00-\x1f\x7f]/g, '').replace(/\p{Cn}/gu, '');
  f = f.replace(/ /g, ' ');
  f = f.replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, '$1_$2');
  if (/[ .]$/.test(f)) f += '_';
  if (enc.encode(f).length > MAX_NAME) { const [s, e] = splitTrunc(f, MAX_NAME); f = e ? `${s}.${e}` : s; if (/[ .]$/.test(f)) f += '_'; }
  return f;
}
// 同じ名前で中身が違うとき（rslib add_hash_suffix_to_file_stem）: 「名前-<sha1>.拡張子」
export function addHashSuffix(name, sha1hex) { const [s, e] = splitTrunc(name, MAX_NAME - 41); return `${s}-${sha1hex}.${e}`; }
export const filenameIsSafe = n => !!n && !/[/\\]/.test(n) && n !== '.' && n !== '..' && !n.includes('\0');
export async function sha1hex(u8) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-1', u8))); }
