// ブラウザの列と並べ替え（AnkiMobile 25.09 のブラウザの「オプション」＝Anki の browser_table の列。AnkiMobile に無い 位置・安定度・正答可能性・難度 は除く）。
// 列の文字と並びは rslib 25.09.4 の browser_table.rs（get_cell_text・get_row_color）と search/mod.rs（card_order_from_sort_column・
// note_order_from_sort_column・prepare_sort と *_order.sql）のとおり。並びの同点は Anki（SQLite）でも決まらないので、id の小さい順にする
import { stripHtmlMedia } from './exchange.mjs';

// [キー（Anki の列のキー）, AnkiMobile の名前]。並べ替えの一覧はこの13、列の一覧は＋解答・質問・オフ
export const SORTS = [['template', 'カードタイプ'], ['cardMod', 'カード更新日時'], ['noteFld', 'ソートフィールド'], ['noteTags', 'タグ'], ['deck', 'デッキ'],
  ['note', 'ノートタイプ'], ['noteCrt', 'ノート作成日時'], ['noteMod', 'ノート更新日時'], ['cardReps', '学習回数'], ['cardLapses', '復習での忘却'],
  ['cardIvl', '復習間隔'], ['cardEase', '易しさ'], ['cardDue', '期日']];
export const COLUMNS = [...SORTS, ['answer', '解答'], ['question', '質問'], ['off', 'オフ']];
export const DEF_COLS = ['noteFld', 'template', 'cardDue', 'off', 'off', 'off'];
export const DEF_SORT = 'noteFld';
// 文字を真ん中にそろえる列（日時と数）。文字の列は左から（AnkiMobile の既定の3列は 左・左・真ん中）
export const CENTER = new Set(['cardMod', 'noteCrt', 'noteMod', 'cardReps', 'cardLapses', 'cardIvl', 'cardEase', 'cardDue']);

// ---------- 比べ方 ----------
// SQLite の NOCASE（ASCII の A〜Z だけを小文字に）と、文字のコードポイント順（UTF-8 のバイト順と同じ）
// UTF-16 の単位で比べ、違った所がサロゲート（U+D800〜DFFF）と U+E000〜FFFF なら入れ替える（＝コードポイントの順）
function cpCmp(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i), y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 0xD800 && y >= 0xD800) { x = x >= 0xE000 ? x - 0x800 : x + 0x2000; y = y >= 0xE000 ? y - 0x800 : y + 0x2000; }
    return x - y;
  }
  return a.length - b.length;
}
const nocase = s => s.replace(/[A-Z]/g, ch => ch.toLowerCase());
// Anki の unicase（大文字小文字を区別しない）
const unicase = (a, b) => cpCmp(a.toLowerCase(), b.toLowerCase());
// notes.sfld は数の形なら数として入る（SQLite の型の順: NULL < 数 < 文字）
const NUM = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const sfldKey = v => { const t = String(v); return NUM.test(t) && Number.isFinite(+t) ? { n: +t } : { s: nocase(t) }; };
function sfldCmp(a, b) {   // a・b は sfldKey
  if (a.n != null && b.n != null) return a.n - b.n;
  if ((a.n != null) !== (b.n != null)) return a.n != null ? -1 : 1;
  return cpCmp(a.s, b.s);
}
const numCmp = (a, b) => (a == null ? (b == null ? 0 : -1) : b == null ? 1 : a - b);   // NULL が先

// ---------- 文字 ----------
const p2 = n => String(n).padStart(2, '0');
export const dateStr = secs => { const d = new Date(secs * 1000); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const dateTimeStr = secs => { const d = new Date(secs * 1000); return `${dateStr(secs)} @ ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
// rslib time_span（precise=false）
const MIN = 60, HOUR = 3600, DAY = 86400, YEAR = 365 * DAY, MONTH = YEAR / 12;
export function timeSpan(secs) {
  const a = Math.abs(secs);
  const [div, txt, whole] = a < MIN ? [1, '秒', true] : a < HOUR ? [MIN, '分', false] : a < DAY ? [HOUR, '時間', false] : a < MONTH ? [DAY, '日', true] : a < YEAR ? [MONTH, 'か月', false] : [YEAR, '年', false];
  const v = Math.fround(secs / div), amount = whole ? Math.round(v) : Math.round(v * 10) / 10;
  return `${amount}${txt}`;
}
// rslib html_to_text_line（preserve_media_filenames）
export function textLine(html) {
  return stripHtmlMedia(String(html || '').replace(/<br\s*\/?>|<div>|\n/gi, ' ').replace(/\[\[type:[^\]]+\]\]/g, '').replace(/\[sound:([^\]]+)\]/g, '$1')).trim();
}

// カードの表・裏の HTML の音声の印 [anki:play:q:0] を、Anki のブラウザと同じく 🔉名前🔉（読み上げは 💬文💬）にする（rslib prettify_av_tags）
export function avLine(c, side) {
  return String((side === 'q' ? c.q : c.a) || '').replace(/\[anki:play:(q|a):(\d+)\]/g, (m, s, i) => {
    const it = (s === 'q' ? c.qav : c.aav)?.[+i];
    return it?.sound != null ? `🔉${it.sound}🔉` : it?.tts != null ? `💬${it.tts}💬` : '';
  });
}
// ctx: { ntOf(mid) → {name, type, templates:[{name}], sortf}, deckName(did), homeOf(card) → 元のデッキの id（フィルターデッキの中なら）, inFiltered(card),
//        days（今日が何日目）, now（秒）, noteMod(card), tagsOf(card) → 配列, avText(card, side) → [anki:play] を 🔉名前🔉 にした HTML }
// ctx.eff(c)＝表と並べ替えに使う did・due・queue（Anki のフィルターデッキの中のカードは中での値。束では data.flt に入っている）
const E = (c, ctx) => (ctx.eff ? ctx.eff(c) : c);
// カードの更新日時（秒）。ctx.cardMod があればそれ（端末では状態の rev から）
const cmod = (c, ctx) => (ctx.cardMod ? ctx.cardMod(c) : c.mod || 0);
const isNewish = (c, ctx) => c.type === 0 || E(c, ctx).queue === 0;
const undue = (c, ctx) => E(c, ctx).queue < 0;   // 休止・今日は非表示
// rslib Card::due_time
function dueTime(c, ctx) {
  const { queue, due } = E(c, ctx);
  if (queue === 1) return due;
  const inDays = queue === 2 || queue === 3 || ((c.type === 2 || c.type === 3) && queue < 0);
  return inDays ? ctx.now + (due - ctx.days) * 86400 : null;
}
function cardDueStr(c, ctx) {
  let due;
  if (ctx.inFiltered(c)) due = '(フィルター)';
  else if (isNewish(c, ctx)) due = `新規#${E(c, ctx).due}`;
  else { const t = dueTime(c, ctx); if (t == null) return ''; due = dateStr(t); }
  return undue(c, ctx) ? `(${due})` : due;
}
function sideStr(c, ctx, answer) {
  const av = ctx.avText || avLine, q = av(c, 'q');
  if (!answer) return textLine(q);
  const a = av(c, 'a');
  return textLine(a.startsWith(q) ? a.slice(q.length) : a);
}
function templateName(c, ctx) {
  const nt = ctx.ntOf(c.mid); if (!nt) return c.tname || '';
  if (nt.type === 1) return `${nt.templates?.[0]?.name ?? ''} ${c.ord + 1}`;
  return nt.templates?.[c.ord]?.name ?? c.tname ?? '';
}
function deckStr(c, ctx) {
  const name = ctx.deckName(E(c, ctx).did);
  return ctx.inFiltered(c) ? `${name} (${ctx.deckName(c.did)})` : name;
}
// 1枚のカードの行の文字（カードモード）
export function cardCell(key, c, ctx) {
  switch (key) {
    case 'template': return templateName(c, ctx);
    case 'cardMod': return dateTimeStr(cmod(c, ctx));
    case 'noteFld': return c.sfld ?? '';
    case 'noteTags': return ctx.tagsOf(c).join(' ');
    case 'deck': return deckStr(c, ctx);
    case 'note': return ctx.ntOf(c.mid)?.name ?? '';
    case 'noteCrt': return dateTimeStr(Math.floor(c.nid / 1000));
    case 'noteMod': return dateTimeStr(ctx.noteMod(c));
    case 'cardReps': return String(c.reps || 0);
    case 'cardLapses': return String(c.lapses || 0);
    case 'cardIvl': return c.type === 0 ? '(新規)' : c.type === 1 ? '(習得中)' : timeSpan((c.ivl || 0) * 86400);
    case 'cardEase': return c.type === 0 ? '(新規)' : `${Math.floor((c.factor || 0) / 10)}%`;
    case 'cardDue': return cardDueStr(c, ctx);
    case 'question': return sideStr(c, ctx, false);
    case 'answer': return sideStr(c, ctx, true);
    default: return '';
  }
}
// 1つのノートの行の文字（ノートモード。cs＝そのノートのカード、並びは id 順＝Anki がノートのカードを読む順）
export function noteCell(key, cs, ctx) {
  const c = cs[0];
  switch (key) {
    case 'template': return String(cs.length);
    case 'cardMod': return dateTimeStr(Math.max(...cs.map(x => cmod(x, ctx))));
    case 'deck': { const ds = new Set(cs.map(x => E(x, ctx).did)); return ds.size > 1 ? `(${ds.size})` : deckStr(c, ctx); }
    case 'cardReps': return String(cs.reduce((s, x) => s + (x.reps || 0), 0));
    case 'cardLapses': return String(cs.reduce((s, x) => s + (x.lapses || 0), 0));
    case 'cardIvl': { const iv = cs.filter(x => x.type === 2 || x.type === 3).map(x => x.ivl || 0); return iv.length ? timeSpan(Math.floor(iv.reduce((a, b) => a + b, 0) * 86400 / iv.length)) : ''; }
    case 'cardEase': { const e = cs.filter(x => x.type !== 0).map(x => x.factor || 0); return e.length ? `${Math.floor(Math.floor(e.reduce((a, b) => a + b, 0) / e.length) / 10)}%` : '(新規)'; }
    case 'cardDue': { const ts = cs.filter(x => !(ctx.inFiltered(x) || isNewish(x, ctx) || undue(x, ctx))).map(x => dueTime(x, ctx)).filter(t => t != null); return ts.length ? dateStr(Math.min(...ts)) : ''; }
    default: return cardCell(key, c, ctx);
  }
}

// ---------- 並べ替え ----------
// 名前の並び（Anki の sort_order: 名前の順に番号を振る。デッキはフィルターデッキも含む全部）
function posMap(items, nameOf) { const m = new Map(); [...items].sort((a, b) => unicase(nameOf(a), nameOf(b)) || (a.id - b.id)).forEach((x, i) => m.set(x.id, i)); return m; }
// ctx.decks（{id, name} の全部）・ctx.notetypes（[id, nt] の全部）を使う
export function makeOrder(ctx) {
  const deckPos = posMap(ctx.decks, d => d.name.replaceAll('::', '\x1f'));   // Anki の decks.name は「::」の代わりに \x1f で持つ
  const ntPos = posMap(ctx.notetypes.map(([id, nt]) => ({ id: +id, name: nt.name })), x => x.name);
  const tmplPos = new Map(); {
    const all = []; for (const [id, nt] of ctx.notetypes) (nt.templates || []).forEach((t, ord) => all.push({ k: `${id}:${ord}`, name: t.name, id: +id, ord }));
    all.sort((a, b) => unicase(a.name, b.name) || a.id - b.id || a.ord - b.ord).forEach((x, i) => tmplPos.set(x.k, i));
  }
  // 並べ替えのあいだに何度も引くキーは、カードごとに1回だけ作る（5万枚でも重くならないように）
  const memo = fn => { const m = new Map(); return c => { let v = m.get(c.id); if (v === undefined) { v = fn(c); m.set(c.id, v); } return v; }; };
  const tagsRaw = c => ` ${ctx.tagsOf(c).join(' ')} `, sortRaw = c => sfldKey(ctx.sortFld ? ctx.sortFld(c) : (c.sfld ?? ''));   // notes.sfld（HTML を除いただけ。前後の空白も残る）
  const tagsKey = memo(tagsRaw), sortFld = memo(sortRaw);
  const dueKey = memo(c => { const d = E(c, ctx).due; return d > 1e9 || c.type === 0 ? d : (d - ctx.days) * 86400 + ctx.now; });
  // カードモードの比べ方（並べ替えのキー → (a, b) => 数）
  const card = {
    cardMod: (a, b) => cmod(a, ctx) - cmod(b, ctx),
    template: (a, b) => numCmp(tmplPos.get(`${a.mid}:${a.ord}`) ?? tmplPos.get(`${a.mid}:0`), tmplPos.get(`${b.mid}:${b.ord}`) ?? tmplPos.get(`${b.mid}:0`)) || a.ord - b.ord,
    deck: (a, b) => numCmp(deckPos.get(E(a, ctx).did), deckPos.get(E(b, ctx).did)),
    cardDue: (a, b) => dueKey(a) - dueKey(b),
    cardEase: (a, b) => ((a.type === 0) - (b.type === 0)) || (a.factor || 0) - (b.factor || 0),
    cardIvl: (a, b) => (a.ivl || 0) - (b.ivl || 0),
    cardLapses: (a, b) => (a.lapses || 0) - (b.lapses || 0),
    noteCrt: (a, b) => a.nid - b.nid || a.ord - b.ord,
    noteMod: (a, b) => ctx.noteMod(a) - ctx.noteMod(b) || a.ord - b.ord,
    note: (a, b) => numCmp(ntPos.get(+a.mid), ntPos.get(+b.mid)),
    cardReps: (a, b) => (a.reps || 0) - (b.reps || 0),
    noteFld: (a, b) => sfldCmp(sortFld(a), sortFld(b)) || a.ord - b.ord,
    noteTags: (a, b) => cpCmp(tagsKey(a), tagsKey(b)),
  };
  // 並べ替える（rev＝後ろからソート。Anki は SQL の asc を全部 desc にするので、2つ目のキーも逆になる。同点は id の小さい順）
  // 読む順（同点のとき。逆順でも逆にならない）: デッキで並べるときはカードの索引 (did, queue, due) の順、ほかは id の順
  const scan = { deck: (a, b) => E(a, ctx).queue - E(b, ctx).queue || E(a, ctx).due - E(b, ctx).due };
  // ソートフィールドとタグ（文字で比べるもの）は、先にキーを作ってから並べる（5万枚で速くするため）
  const keyed = { noteFld: [sortRaw, (x, y) => sfldCmp(x[0], y[0]) || x[1].ord - y[1].ord], noteTags: [tagsRaw, (x, y) => cpCmp(x[0], y[0])] };
  function sortCards(cards, key, rev) {
    const s = rev ? -1 : 1, t = scan[key];
    if (!card[key]) key = 'noteFld';
    if (keyed[key]) { const [kf, kc] = keyed[key]; return cards.map(c => [kf(c), c]).sort((x, y) => s * kc(x, y) || x[1].id - y[1].id).map(x => x[1]); }
    const f = card[key];
    return cards.slice().sort((a, b) => s * f(a, b) || (t ? t(a, b) : 0) || a.id - b.id);
  }
  // ノートモード: groups＝[[ノートのカード…]…]（どのノートも ord 順）。allByNote＝コレクション全部のカード（並びの下ごしらえは全部のカードから）
  function sortNotes(groups, key, rev, allByNote) {
    const s = rev ? -1 : 1, nid = g => g[0].nid, first = g => g[0];
    const agg = (fn) => { const m = new Map(); for (const [n, cs] of allByNote) { const v = fn(cs); if (v != null) m.set(n, v); } return m; };
    let pos = null;   // ノートの順位（sort_order。無いノートは NULL＝先）
    const rank = vals => { const arr = [...vals].sort((a, b) => cmpVal(a[1], b[1]) || a[0] - b[0]); const m = new Map(); arr.forEach(([n], i) => m.set(n, i)); return m; };
    const cmpVal = (x, y) => (Array.isArray(x) ? (x[0] - y[0]) || (x[1] - y[1]) : x - y);
    switch (key) {
      case 'template': pos = rank(agg(cs => cs.length)); break;
      case 'cardMod': pos = rank(agg(cs => Math.max(...cs.map(c => cmod(c, ctx))))); break;
      // 2つ目のキー decks.pos は集計していない列なので、SQLite ではそのノートの最初に読んだカード（id のいちばん小さいカード）の値になる
      case 'deck': pos = rank(agg(cs => { const first = cs.reduce((m, c) => (c.id < m.id ? c : m)); return [new Set(cs.map(c => E(c, ctx).did)).size, deckPos.get(E(first, ctx).did) ?? 0]; })); break;
      case 'cardDue': pos = rank(agg(cs => { const ok = cs.filter(c => !ctx.inFiltered(c) && c.type !== 0 && E(c, ctx).queue > 0); return ok.length ? Math.min(...ok.map(dueKey)) : null; })); break;
      case 'cardEase': pos = rank(agg(cs => { const ok = cs.filter(c => c.type !== 0); return ok.length ? ok.reduce((t, c) => t + (c.factor || 0), 0) / ok.length : null; })); break;
      case 'cardIvl': pos = rank(agg(cs => { const ok = cs.filter(c => c.type === 2 || c.type === 3); return ok.length ? ok.reduce((t, c) => t + (c.ivl || 0), 0) / ok.length : null; })); break;
      case 'cardLapses': pos = rank(agg(cs => cs.reduce((t, c) => t + (c.lapses || 0), 0))); break;
      case 'cardReps': pos = rank(agg(cs => cs.reduce((t, c) => t + (c.reps || 0), 0))); break;
    }
    const f = pos ? (a, b) => numCmp(pos.get(nid(a)), pos.get(nid(b)))
      : key === 'noteCrt' ? (a, b) => nid(a) - nid(b)
      : key === 'noteMod' ? (a, b) => ctx.noteMod(first(a)) - ctx.noteMod(first(b))
      : key === 'note' ? (a, b) => numCmp(ntPos.get(+first(a).mid), ntPos.get(+first(b).mid))
      : key === 'noteTags' ? (a, b) => cpCmp(tagsKey(first(a)), tagsKey(first(b)))
      : (a, b) => sfldCmp(sortFld(first(a)), sortFld(first(b)));
    return groups.slice().sort((a, b) => s * f(a, b) || nid(a) - nid(b));
  }
  return { sortCards, sortNotes };
}

// 一覧の中で光らせる語（検索のうち、key:値 でない ふつうの語。OR・AND・- 付き・括弧は除く。* と _ は外す）
export function highlightTerms(q) {
  const out = []; const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g; let m;
  while ((m = re.exec(String(q || '')))) {
    let t = m[1] != null ? m[1] : m[2];
    if (m[1] == null) { t = t.replace(/^\(+|\)+$/g, ''); if (!t || /^(or|and)$/i.test(t) || t.startsWith('-')) continue; }
    if (/^[^\\]*:/.test(t)) continue;   // key:値
    t = t.replace(/\\(.)/g, '$1').replace(/[*_]/g, '');
    if (t) out.push(t);
  }
  return out;
}
