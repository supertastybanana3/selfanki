// ノートタイプの変更の決まり（Anki 25.09.4 の rslib notetype/mod.rs prepare_for_update・schemachange.rs・notetypechange.rs を写したもの）。
// 画面にも同期にも触らない（app/ntscreen.mjs と app/notes.mjs が使う）。ノートタイプはアプリの形（tools/export_anki.py と同じ）:
//   { name, type(0=通常 1=穴埋め), sortf, css, fields: [{ name, ord, …, x: { id, … } }], templates: [{ name, ord, qfmt, afmt, did, x: { id, bqfmt, bafmt, … } }] }
// 直している途中の写しでは、fields・templates の ord は「直す前の位置」（新しく足したものは null）。rslib と同じ持ち方
import { parseTemplate, templateToString, renameAndRemoveFields, referencedFields, containsClozeReplacement, containsFieldReplacement } from './template.mjs';

// 文言は Anki 25.9.4 の日本語訳（card_templates_* ほか）
export const NT_TEXT = {
  invalidTemplate: n => `カードタイプ${n}のテンプレートに不備があります。`,
  seePreview: '詳細はプレビューをご覧ください。',
  fieldNotFound: f => `「${f}」というフィールドが見つかりません。`,
  noFrontField: '表面のカードテンプレートには「{{表面}}」といったフィールドを指定する置換え文字列が必要です。',
  identicalFront: n => `表面側がカードタイプ${n}のテンプレートと同一です。`,
  missingCloze: '表面と裏面のカードテンプレートには 「{{cloze:テキスト}}」といった置換え文字列が必要です。',
  multipleNotetypes: '同じノートタイプのノートを選択してください。',
  schema: 'この変更を他のデバイスと同期するには、次回の同期の際にデータベースの完全なアップロードが必要となります。他のデバイスでカード学習やその他の変更を行って、まだこのデバイスとの同期が済んでいない場合、それらの変更は失われます。処理を続行しますか？',
};
export class NtError extends Error { constructor(msg, info = {}) { super(msg); this.info = info; } }

const SPECIAL = new Set(['FrontSide', 'Card', 'CardFlag', 'Deck', 'Subdeck', 'Tags', 'Type', 'CardID']);
const fold = s => String(s).toUpperCase().toLowerCase();   // UniCase の代わり（大文字小文字を区別しない）
export const randomId = () => String(Math.floor(Math.random() * 2 ** 31) * 2 ** 21 + Math.floor(Math.random() * 2 ** 21));   // rslib は rand::random::<i64>()。JSON で安全な範囲の正の数にする

// ---------- 名前の直し（fields.rs・templates.rs の fix_name、mod.rs の ensure_names_unique） ----------
export function fixFieldName(name) {
  if (!name) throw new NtError('Empty field name', { kind: 'emptyField' });
  let n = name.replace(/[:{}"]/g, '');
  n = n.trim().replace(/^[#/^\s]+/u, '');
  if (!n) throw new NtError('Field name: ' + name, { kind: 'badField' });
  return n;
}
export function fixTemplateName(name) {
  if (!name) throw new NtError('Empty template name', { kind: 'emptyTemplate' });
  const n = name.replace(/"/g, ''); if (!n) throw new NtError('Template name contains only quotes', { kind: 'badTemplate' });
  return n;
}
function uniqueNames(list) {
  const seen = new Set();
  for (const x of list) { while (seen.has(fold(x.name))) x.name += '+'; seen.add(fold(x.name)); }
}

// ---------- 直したノートタイプを確かめて整える（prepare_for_update） ----------
// nt は直している途中の写し（書き換える）。prev は直す前（アプリの形・ord＝位置）。返り値は、ノートとカードに要る変更
export function prepareNotetype(nt, prev, { skipChecks = false } = {}) {
  if (!nt.fields.length) throw new NtError('1 field required', { kind: 'noFields' });
  if (!nt.templates.length) throw new NtError('1 template required', { kind: 'noTemplates' });
  nt.name = String(nt.name ?? '').replace(/"/g, '');
  if (!nt.name) throw new NtError('Empty notetype name', { kind: 'emptyName' });
  nt.name = nt.name.normalize('NFC');
  for (const f of nt.fields) f.name = fixFieldName(String(f.name ?? '').normalize('NFC'));
  for (const t of nt.templates) t.name = fixTemplateName(String(t.name ?? '').normalize('NFC'));
  uniqueNames(nt.templates); uniqueNames(nt.fields);
  // 並べ替えた位置に、ソートフィールドを合わせる（reposition_sort_idx）
  const prevSort = nt.sortf || 0;
  const si = nt.fields.findIndex(f => f.ord === prevSort);
  nt.sortf = si >= 0 ? si : Math.min(Math.max(prevSort, 0), nt.fields.length - 1);
  const x = t => t.x || (t.x = {});
  const parsed = nt.templates.map(t => [parseTemplate(t.qfmt), parseTemplate(t.afmt)]);
  const parsedB = nt.templates.map(t => [parseTemplate(x(t).bqfmt ?? ''), parseTemplate(x(t).bafmt ?? '')]);
  // 名前を変えた・消したフィールドを、テンプレートの中でも直す
  if (prev) {
    const map = new Map(), kept = new Set();
    for (const f of nt.fields) {
      if (f.ord == null) continue;
      kept.add(f.ord); const old = prev.fields[f.ord];
      if (old && old.name !== f.name) map.set(old.name, f.name);
    }
    prev.fields.forEach((f, i) => { if (!kept.has(i)) map.set(f.name, null); });
    if (map.size) {
      const first = nt.fields[0].name, cloze = nt.type === 1;
      const fixQ = q => { q = renameAndRemoveFields(q, map); if (!containsFieldReplacement(q) || (cloze && !containsClozeReplacement(q))) q.push({ t: 'rep', key: first, filters: cloze ? ['cloze'] : [] }); return q; };
      const fixA = a => { a = renameAndRemoveFields(a, map); if (cloze && !containsClozeReplacement(a)) a.push({ t: 'rep', key: first, filters: cloze ? ['cloze'] : [] }); return a; };
      nt.templates.forEach((t, i) => {
        const [q, a] = parsed[i];
        if (q) { parsed[i][0] = fixQ(q); t.qfmt = templateToString(parsed[i][0]); }
        if (a) { parsed[i][1] = fixA(a); t.afmt = templateToString(parsed[i][1]); }
        const [bq, ba] = parsedB[i];
        if (bq) x(t).bqfmt = templateToString(fixQ(bq));
        if (ba) x(t).bafmt = templateToString(fixA(ba));
      });
    }
  }
  if (!skipChecks) checkTemplates(nt, parsed);
  return planOf(nt, prev, prevSort);
}

function checkTemplates(nt, parsed) {
  const fail = (ordinal, detail, kind) => { throw new NtError(NT_TEXT.invalidTemplate(ordinal + 1) + '\n' + detail, { kind, ordinal }); };
  const seen = new Map();
  nt.templates.forEach((t, i) => {
    if (seen.has(t.qfmt) && !/\{\{\s*Card\s*\}\}/.test(t.qfmt)) fail(i, NT_TEXT.identicalFront(seen.get(t.qfmt) + 1), 'duplicate');
    if (!seen.has(t.qfmt)) seen.set(t.qfmt, i);
  });
  const names = new Set(nt.fields.map(f => f.name));
  parsed.forEach(([q, a], i) => {
    if (!q || !a) fail(i, NT_TEXT.seePreview, 'parse');
    const qf = referencedFields(q);
    if (!qf.size) fail(i, NT_TEXT.noFrontField, 'noFrontField');
    for (const n of new Set([...qf, ...referencedFields(a)])) if (n !== '' && !SPECIAL.has(n) && !names.has(n)) fail(i, NT_TEXT.fieldNotFound(n), 'noSuchField');
  });
  if (nt.type === 1) {
    const has = p => !!p && referencedFields(p, true, false).size > 0;
    if (!parsed.length || !has(parsed[0][0]) || !has(parsed[0][1])) fail(0, NT_TEXT.missingCloze, 'missingCloze');
  }
}

// ---------- フィールド・テンプレートの位置の変化（schemachange.rs） ----------
export const ordsChanged = (ords, prevLen) => ords.length !== prevLen || ords.some((o, i) => o !== i);
export function templateOrdChanges(ords, prevLen) {
  const added = [], moved = new Map(), keep = new Set();
  ords.forEach((o, i) => { if (o == null) added.push(i); else { keep.add(o); if (o !== i) moved.set(o, i); } });
  const removed = []; for (let i = 0; i < prevLen; i++) if (!keep.has(i)) removed.push(i);
  return { added, removed, moved };
}
function planOf(nt, prev, prevSort) {
  const fords = nt.fields.map(f => f.ord), tords = nt.templates.map(t => t.ord);
  const prevF = prev ? prev.fields.length : nt.fields.length, prevT = prev ? prev.templates.length : nt.templates.length;
  const fieldsChanged = ordsChanged(fords, prevF);
  const sortChanged = !fieldsChanged && nt.sortf !== prevSort;
  const tmpl = templateOrdChanges(tords, prevT);
  const tmplChanged = tmpl.added.length > 0 || tmpl.removed.length > 0 || tmpl.moved.size > 0;
  // テンプレートの表が変わった（並びの比べ方は rslib と同じく、新しい並びと前の並びをそのまま比べる）か、足したテンプレートがあれば、カードを作り直す
  const frontsSame = !!prev && nt.templates.length === prev.templates.length && nt.templates.every((t, i) => t.qfmt === prev.templates[i].qfmt);
  const generate = !(tmpl.added.length === 0 && frontsSame);
  return { fieldOrds: fords, fieldsChanged, sortChanged, tmpl, tmplChanged, generate, schema: fieldsChanged || sortChanged || tmplChanged };
}
// 直し終えた写しの ord を、新しい位置にする（保存の形）
export function finalizeOrds(nt) { nt.fields.forEach((f, i) => { f.ord = i; }); nt.templates.forEach((t, i) => { t.ord = i; }); return nt; }
// フィールドの並べ替え（Note::reorder_fields）。ords[i]＝新しい i 番目に来る前の位置（null＝空）
export const reorderFields = (flds, ords) => ords.map(o => (o == null ? '' : flds[o] ?? ''));

// ---------- ノートタイプの変更（notetypechange.rs） ----------
const isCloze = n => (n.type || 0) === 1;
function defaultMap(oldList, newList) {
  const byName = new Map(oldList.map((x, i) => [x.name, i])), used = new Set();
  const out = newList.map(x => { const i = byName.get(x.name); if (i == null) return null; used.add(i); return i; });
  const rest = oldList.map((_, i) => i).filter(i => !used.has(i));
  for (let i = 0; i < out.length && rest.length; i++) if (out[i] == null) out[i] = rest.shift();
  return out;
}
export const defaultFieldMap = (oldNt, newNt) => defaultMap(oldNt.fields, newNt.fields);
export const defaultTemplateMap = (oldNt, newNt) => (isCloze(oldNt) || isCloze(newNt) ? null : defaultMap(oldNt.templates, newNt.templates));
// TemplateMap::new。removed＝消すカードの ord、remapped＝前の ord → 新しい ord
export function templateMap(newTemplates, oldCount) {
  const seen = new Set(), remapped = new Map();
  newTemplates.forEach((o, i) => { if (o != null) { seen.add(o); if (o !== i) remapped.set(o, i); } });
  const removed = []; for (let i = 0; i < oldCount; i++) if (!seen.has(i)) removed.push(i);
  return { removed, remapped };
}
// remap_fields（同じフィールドを2か所に写してよい）
export const remapFields = (flds, map) => map.map(o => (o == null ? '' : flds[o] ?? ''));
// 1つのノートのカード（[{ id, ord }]）を、新しいノートタイプへ移したあとの ord にする。null＝消える
export function remapCardOrds(cards, oldNt, newNt, tmap) {
  if (tmap) { const m = templateMap(tmap, oldNt.templates.length), gone = new Set(m.removed); return cards.map(c => (gone.has(c.ord) ? null : (m.remapped.has(c.ord) ? m.remapped.get(c.ord) : c.ord))); }
  if (!isCloze(newNt)) return cards.map(c => (c.ord > newNt.templates.length - 1 ? null : c.ord));   // 穴埋め → 通常: テンプレートの数を超えるカードは消える
  return cards.map(c => c.ord);   // 通常 → 穴埋め・穴埋め → 穴埋め: 番号はそのまま
}
// 選んだノートに入れられるか（すべて同じノートタイプでないと Anki はできない）
export function singleNotetype(mids) { const s = new Set(mids); if (s.size !== 1) throw new NtError(NT_TEXT.multipleNotetypes, { kind: 'multiple' }); return [...s][0]; }
