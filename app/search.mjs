// Anki 25.09.4 の検索を写したもの。
//   解析: rslib/src/search/parser.rs（nom で書かれた解析を、同じ順番・同じ失敗の仕方で手で写した）
//   絞り込み: rslib/src/search/sqlwriter.rs（SQL の条件を、カードとノートに対する判定に写した。SQL の NULL の扱いも同じ）
//   書き間違いは SearchError（文面は Anki の日本語訳そのまま。Fluent と同じく差し込む値を U+2068…U+2069 で囲む）
// ノートの欄（n.flds・n.sfld・n.tags）は S.notes（nid → {mid, flds, sfld, csum, tags, mod}）を使う。先に loadNotes で読んでおくこと
import { timingToday } from '../fsrs/sched.mjs';

// ---------- 文面（aqt 25.9.4 の日本語訳。ankiweb/i18n_ja.json から写した） ----------
const JA = {
  'search-invalid-search': '無効な検索:{ $reason }',
  'search-misplaced-and': '検索で`and`が使用されていますが、２つの検索条件を接続していません。その文字列自体を検索したい場合は、二重引用符で囲んでください：`"and"`',
  'search-misplaced-or': '検索で`or`が使用されていますが、２つの検索用語を接続していません。その文字列自体を検索したい場合は、二重引用符で囲んでください：`"or"`',
  'search-empty-group': '検索で`(...)`が使用されていますが、カッコ内に検索するものがありません。カッコ自体を検索したい場合は、二重引用符で囲んでください：`"( )"`',
  'search-unopened-group': '検索で`)`が使用されていますが、それに先立つ`(`がみつかりません。`)`の記号自体を検索したい場合は、二重引用符で囲むか手前にバックスラッシュをつけてください：`")"` または `\\)`',
  'search-unclosed-group': '検索で`(`が使用されていますが、それに続く`)`がみつかりません。`(`の記号自体を検索したい場合は、二重引用符で囲むか手前にバックスラッシュをつけてください：`"("` または `\\(`',
  'search-empty-quote': '検索で二重引用符`""`が使用されていますが、引用符内に検索するものがありません。二重引用符の記号自体を検索したい場合は、手前にバックスラッシュをつけてください：`\\"\\"`',
  'search-unclosed-quote': String.fromCharCode(0x3000) + '検索で二重引用符`"`が使用されていますが、それを閉じるもう片方がみつかりません。`"`の記号自体を検索したい場合は、手前にバックスラッシュをつけてください：`\\"`',
  'search-missing-key': '検索でコロン`:`が使用されていますが、その手前にキーワードがありません。`:`の記号自体を検索したい場合は、手前にバックスラッシュをつけてください：`\\:`',
  'search-unknown-escape': 'エスケープシーケンス`{ $val }`は定義されていません。バックスラッシュ`\\`自体を検索したい場合は、前にもう一つ付け加えてください：`\\\\`',
  'search-invalid-argument': '`{ $term }` に無効な引数 \'`{ $argument }`\'が使用されています。',
  'search-invalid-flag-2': '`flag:`に続けて有効なフラグ番号を入力してください：`1` (赤) `2` (橙) `3` (緑) `4` (青) `5` (ピンク), `6` (ターコイズ), `7` (紫)  `0` (フラグなし)',
  'search-invalid-prop-operator': '`prop:{ $val }`の後には、以下の比較演算子のうちのいずれかが続く必要があります：`=`, `!=`, `<`, `>`, `<=` , `>=`',
  'search-invalid-other': '入力ミスがないか確認してください。',
  'search-invalid-number': '"`{ $context }`"の数字であるべき箇所に "`{ $provided }`"が入力されています。',
  'search-invalid-whole-number': '"`{ $context }`"の整数であるべき箇所に"`{ $provided }`"が入力されています。',
  'search-invalid-positive-whole-number': '"`{ $context }`"の正の整数であるべき箇所に "`{ $provided }`"が入力されています。',
  'search-invalid-negative-whole-number': '"`{ $context }`"の0かそれ未満の整数であるべき箇所に"`{ $provided }`"が入力されています。',
  'search-invalid-answer-button': '"`{ $context }`"の回答ボタン1-4の間であるべき箇所に"`{ $provided }`"が入力されています。',
};
const tr = (key, args = {}) => JA[key].replace(/\{\s*\$(\w+)\s*\}/g, (_, k) => '⁨' + args[k] + '⁩');

// 書き間違い（rslib error/search.rs SearchErrorKind）
export class SearchError extends Error {
  constructor(kind, a = {}) {
    const q = s => String(s).replace(/`/g, "'");
    const reason = {
      MisplacedAnd: () => tr('search-misplaced-and'), MisplacedOr: () => tr('search-misplaced-or'),
      EmptyGroup: () => tr('search-empty-group'), UnopenedGroup: () => tr('search-unopened-group'), UnclosedGroup: () => tr('search-unclosed-group'),
      EmptyQuote: () => tr('search-empty-quote'), UnclosedQuote: () => tr('search-unclosed-quote'), MissingKey: () => tr('search-missing-key'),
      UnknownEscape: () => tr('search-unknown-escape', { val: q(a.provided) }),
      InvalidState: () => tr('search-invalid-argument', { term: 'is:', argument: q(a.provided) }),
      InvalidFlag: () => tr('search-invalid-flag-2'),
      InvalidPropProperty: () => tr('search-invalid-argument', { term: 'prop:', argument: q(a.provided) }),
      InvalidPropOperator: () => tr('search-invalid-prop-operator', { val: a.provided }),
      Other: () => (a.info != null ? a.info : tr('search-invalid-other')),
      InvalidNumber: () => tr('search-invalid-number', { context: q(a.context), provided: q(a.provided) }),
      InvalidWholeNumber: () => tr('search-invalid-whole-number', { context: q(a.context), provided: q(a.provided) }),
      InvalidPositiveWholeNumber: () => tr('search-invalid-positive-whole-number', { context: q(a.context), provided: q(a.provided) }),
      InvalidNegativeWholeNumber: () => tr('search-invalid-negative-whole-number', { context: q(a.context), provided: q(a.provided) }),
      InvalidAnswerButton: () => tr('search-invalid-answer-button', { context: q(a.context), provided: q(a.provided) }),
    }[kind]();
    super(tr('search-invalid-search', { reason }));
    this.kind = kind; this.name = 'SearchError';
  }
}
// AnkiMobile は文面のバッククォートを取り除いて出す
export const displayText = msg => msg.replace(/`/g, '');

// ---------- 解析（parser.rs） ----------
// nom の「やり直しのきく失敗（Error）」は null を返し、「やり直さない失敗（Failure）」は SearchError を投げる
const fail = (kind, a) => { throw new SearchError(kind, a); };
const WS = ' 　';
const cpAt = (s, i) => String.fromCodePoint(s.codePointAt(i));
// Rust の str::trim（White_Space の文字。U+FEFF は含まない）
const RUST_WS = new RegExp('^[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+|[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+$', 'g');
// nom の escaped(is_not(止める文字), '\\', 続けてよい文字)。返り値 {rest, m} か {err: 'Escaped'|'NoneOf', at}
function escaped(s, stop, okAfter) {
  let i = 0;
  while (i < s.length) {
    const c = cpAt(s, i);
    if (c !== '\\' && !stop.includes(c)) { i += c.length; continue; } // is_not で進む
    if (c === '\\') {
      if (i + 1 >= s.length) return { err: 'Escaped', at: s };
      const n = cpAt(s, i + 1);
      if (!okAfter(n)) return { err: 'NoneOf', at: s.slice(i + 1) };
      i += 1 + n.length; continue;
    }
    if (i === 0) return { err: 'Escaped', at: s };
    return { rest: s.slice(i), m: s.slice(0, i) };
  }
  return { rest: '', m: s };
}
const anyChar = () => true, notWs = c => !WS.includes(c);
const ws0 = s => { let i = 0; while (i < s.length && WS.includes(s[i])) i++; return s.slice(i); };

export function parse(input) {
  input = input.replace(RUST_WS, '');
  if (!input) return [{ t: 'WholeCollection' }];
  const [rest, nodes] = groupInner(input);
  if (rest !== '') fail('UnopenedGroup');
  return nodes;
}
function groupInner(input) {
  let rem = input; const nodes = [];
  for (;;) {
    const r = node(rem); if (!r) break;
    rem = r[0]; const nd = r[1];
    if (nodes.length % 2 === 0) { if (nd === 'And') fail('MisplacedAnd'); if (nd === 'Or') fail('MisplacedOr'); }
    else if (nd !== 'And' && nd !== 'Or') nodes.push('And');
    nodes.push(nd);
  }
  const last = nodes[nodes.length - 1];
  if (last === 'And') fail('MisplacedAnd'); if (last === 'Or') fail('MisplacedOr');
  return [ws0(rem), nodes];
}
function node(s) { s = ws0(s); return negatedNode(s) || group(s) || text(s); }
function negatedNode(s) {
  if (s[0] !== '-') return null;
  const r = group(s.slice(1)) || text(s.slice(1)); if (!r) return null;
  return [r[0], { not: r[1] }];
}
function group(s) {
  if (s[0] !== '(') return null;
  const [tail, inner] = groupInner(s.slice(1));
  if (tail[0] === ')') { if (!inner.length) fail('EmptyGroup'); return [tail.slice(1), { group: inner }]; }
  fail('UnclosedGroup');
}
function text(s) { return quotedTerm(s) || partiallyQuotedTerm(s) || unquotedTerm(s); }
function quotedTerm(s) { const r = quotedTermStr(s); if (!r) return null; return [r[0], searchNodeForText(r[1])]; }
function partiallyQuotedTerm(s) {
  const k = escaped(s, '"(): 　\\', notWs); if (k.err) return null;
  if (k.rest[0] !== ':') return null;
  const r = quotedTermStr(k.rest.slice(1)); if (!r) return null;
  return [r[0], searchNodeForTextWithArgument(k.m, r[1])];
}
function unquotedTerm(s) {
  const r = escaped(s, '"() 　\\', notWs);
  if (!r.err) {
    if (r.m === '') return null;
    if (r.m.toLowerCase() === 'and' && /^[a-z]+$/i.test(r.m)) return [r.rest, 'And'];
    if (r.m.toLowerCase() === 'or' && /^[a-z]+$/i.test(r.m)) return [r.rest, 'Or'];
    return [r.rest, searchNodeForText(r.m)];
  }
  if (r.err === 'NoneOf') fail('UnknownEscape', { provided: '\\' + r.at });
  if ('"() 　'.includes(cpAt(s, 0))) return null;
  fail('UnknownEscape', { provided: '\\' }); // 末尾が奇数個の \
}
function quotedTermStr(s) {
  if (s[0] !== '"') return null;
  const opened = s.slice(1);
  const r = escaped(opened, '"\\', anyChar);
  if (!r.err) { if (r.rest[0] === '"') return [r.rest.slice(1), r.m]; fail('UnclosedQuote'); }
  fail(opened[0] === '"' ? 'EmptyQuote' : 'UnclosedQuote');
}
function searchNodeForText(s) {
  const r = escaped(s, ':\\', anyChar);
  if (r.err || r.m === '') fail('MissingKey');
  if (r.rest === '') return { t: 'UnqualifiedText', text: unescape(r.m) };
  return searchNodeForTextWithArgument(r.m, r.rest.slice(1));
}
const asciiLower = s => s.replace(/[A-Z]/g, c => c.toLowerCase());
function searchNodeForTextWithArgument(key, val) {
  switch (asciiLower(key)) {
    case 'deck': return { t: 'Deck', deck: unescape(val) };
    case 'note': return { t: 'Notetype', name: unescape(val) };
    case 'tag': return val.startsWith('re:') ? { t: 'Tag', tag: unescapeQuotes(val.slice(3)), regex: true } : { t: 'Tag', tag: unescape(val), regex: false };
    case 'card': { const n = parseUint(val, 65535); return n != null ? { t: 'Template', ord: Math.max(n, 1) - 1 } : { t: 'Template', name: unescape(val) }; }
    case 'flag': { const n = parseUint(val, 255); if (n == null || n > 7) fail('InvalidFlag'); return { t: 'Flag', flag: n }; }
    case 'resched': return { t: 'Rated', days: u32(val, 'resched:'), ease: 'manual' };
    case 'prop': return parseProp(val);
    case 'added': return { t: 'Added', days: Math.max(u32(val, 'added:'), 1) };
    case 'edited': return { t: 'Edited', days: Math.max(u32(val, 'edited:'), 1) };
    case 'introduced': return { t: 'Introduced', days: Math.max(u32(val, 'introduced:'), 1) };
    case 'rated': { const i = val.indexOf(':'); const a = i < 0 ? val : val.slice(0, i), b = i < 0 ? null : val.slice(i + 1); return { t: 'Rated', days: Math.max(u32(a, 'rated:'), 1), ease: answerButton(b, val) }; }
    case 'is': {
      const st = { new: 'New', review: 'Review', learn: 'Learning', due: 'Due', buried: 'Buried', 'buried-manually': 'UserBuried', 'buried-sibling': 'SchedBuried', suspended: 'Suspended' }[val];
      if (!st || !Object.prototype.hasOwnProperty.call({ new: 1, review: 1, learn: 1, due: 1, buried: 1, 'buried-manually': 1, 'buried-sibling': 1, suspended: 1 }, val)) fail('InvalidState', { provided: val });
      return { t: 'State', state: st };
    }
    case 'did': return { t: 'DeckIds', ids: idList(val, key) };
    case 'mid': return { t: 'NotetypeId', id: i64(val, 'mid:') };
    case 'nid': return { t: 'NoteIds', ids: idList(val, key) };
    case 'cid': return { t: 'CardIds', ids: idList(val, key) };
    case 're': return { t: 'Regex', re: unescapeQuotes(val) };
    case 'nc': return { t: 'NoCombining', text: unescape(val) };
    case 'sc': return { t: 'StripClozes', text: unescape(val) };
    case 'w': return { t: 'WordBoundary', text: unescape(val) };
    case 'dupe': {
      const i = val.indexOf(','); const ntid = i64(i < 0 ? val : val.slice(0, i), val);
      if (i < 0) fail('Other', { info: "invalid 'dupe:' search" });
      return { t: 'Dupe', ntid, text: unescapeQuotesAndBackslashes(val.slice(i + 1)) };
    }
    case 'has-cd': return { t: 'CustomData', key: unescape(val) };
    case 'preset': return { t: 'Preset', name: val };
    default:
      if (val.startsWith('re:')) return { t: 'Field', field: unescape(key), text: unescapeQuotes(val.slice(3)), mode: 'regex' };
      if (val.startsWith('nc:')) return { t: 'Field', field: unescape(key), text: unescapeQuotes(val.slice(3)), mode: 'nc' };
      return { t: 'Field', field: unescape(key), text: unescape(val), mode: 'normal' };
  }
}
const PROPS = ['ivl', 'due', 'reps', 'lapses', 'ease', 'pos', 'rated', 'resched', 's', 'd', 'r'];
function parseProp(clause) {
  let prop = PROPS.find(p => clause.startsWith(p));
  if (!prop) { const m = clause.match(/^cd[ns]:[A-Za-z0-9]+/); if (m) prop = m[0]; }
  if (!prop) fail('InvalidPropProperty', { provided: clause });
  const tail = clause.slice(prop.length);
  const op = ['<=', '>=', '!=', '=', '<', '>'].find(o => tail.startsWith(o));
  if (!op) fail('InvalidPropOperator', { provided: prop });
  const num = tail.slice(op.length);
  let kind;
  if (prop === 'ease') kind = { k: 'ease', v: f32(num, clause) };
  else if (prop === 'due') kind = { k: 'due', v: i32(num, clause) };
  else if (prop === 'rated') { const i = num.indexOf(':'); kind = { k: 'rated', days: negI32(i < 0 ? num : num.slice(0, i), clause), ease: answerButton(i < 0 ? null : num.slice(i + 1), clause) }; }
  else if (prop === 'resched') kind = { k: 'rated', days: negI32(num, clause), ease: 'manual' };
  else if (['ivl', 'reps', 'lapses', 'pos'].includes(prop)) kind = { k: prop, v: u32(num, clause) };
  else if (prop === 's' || prop === 'd' || prop === 'r') kind = { k: prop, v: f32(num, clause) };
  else if (prop.startsWith('cdn:')) kind = { k: 'cdn', key: prop.slice(4), v: f32(num, clause) };
  else kind = { k: 'cds', key: prop.slice(4), v: num };
  return { t: 'Prop', op, kind };
}
// Rust の数の読み方（u32・i32・i64 は + を許す。f32 は inf・nan・1e3・.5・5. を許す）
const DIGITS = /^\+?\d+$/;
function parseUint(s, max) { if (!DIGITS.test(s)) return null; const n = Number(s.replace(/^\+/, '')); return n <= max ? n : null; }
function u32(num, context) { const n = parseUint(num, 4294967295); if (n == null) fail('InvalidPositiveWholeNumber', { context, provided: num }); return n; }
function i32(num, context) { if (!/^[+-]?\d+$/.test(num)) fail('InvalidWholeNumber', { context, provided: num }); const n = Number(num); if (n < -2147483648 || n > 2147483647) fail('InvalidWholeNumber', { context, provided: num }); return n; }
function negI32(num, context) { let n = null; if (/^[+-]?\d+$/.test(num)) { n = Number(num); if (n < -2147483648 || n > 2147483647) n = null; } if (n == null || n > 0) fail('InvalidNegativeWholeNumber', { context, provided: num }); return n; }
function i64(num, context) { if (!/^[+-]?\d+$/.test(num)) fail('InvalidWholeNumber', { context, provided: num }); const b = BigInt(num); if (b < -(2n ** 63n) || b >= 2n ** 63n) fail('InvalidWholeNumber', { context, provided: num }); return Number(b); }
function f32(num, context) {
  if (!/^[+-]?(?:inf|infinity|nan|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/i.test(num)) fail('InvalidNumber', { context, provided: num });
  const v = /nan/i.test(num) ? NaN : /inf/i.test(num) ? (num[0] === '-' ? -Infinity : Infinity) : Number(num);
  return Math.fround(v);
}
function answerButton(num, context) {
  if (num == null) return 'any';
  const n = parseUint(num, 255); if (n == null || n < 1 || n > 4) fail('InvalidAnswerButton', { context, provided: num });
  return n;
}
function idList(s, context) { if (!/^(\d+,)*\d+$/.test(s)) fail('Other', { info: `expected only digits and commas in ${context}:` }); return s.split(',').map(Number); }
const unescapeQuotes = s => (s.includes('"') ? s.replace(/\\"/g, '"') : s);
const unescapeQuotesAndBackslashes = s => (s.includes('"') || s.includes('\\') ? s.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : s);
function unescape(txt) {
  const m = txt.match(/(?:^|[^\\])(?:\\\\)*(\\(?:[^\\":*_()-]|$))/u);
  if (m) fail('UnknownEscape', { provided: m[1] });
  if (/(?:^|[^\\])(?:\\\\)*\\[":()-]/u.test(txt)) return txt.replace(/\\[\\":()-]/g, x => (x === '\\\\' ? '\\\\' : x[1]));
  return txt;
}

// ---------- 文字の変換（rslib text.rs） ----------
// regex::escape（Rust は # & - ~ も逃がすが、JS の u モードではそれらを逃がすと誤りになるので、JS で意味のある記号だけ逃がす。結果は同じ）
const reEscape = s => s.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&');
function toCustomRe(txt, wildcard) {
  return txt.replace(/\\?[\s\S]/gu, s => {
    if (s === '\\\\' || s === '\\*') return s;
    if (s === '\\_') return '_';
    if (s === '*') return wildcard + '*';
    if (s === '_') return wildcard;
    return reEscape(s);
  });
}
const toRe = txt => toCustomRe(txt, '.');
const toSql = txt => txt.replace(/\\[\\*]|[*%]/g, s => ({ '\\\\': '\\\\', '\\*': '*', '*': '%', '%': '\\%' })[s]);
const toText = txt => txt.replace(/\\([\s\S])/gu, '$1');
const isGlob = txt => /(?:^|[^\\])(?:\\\\)*[*_]/.test(txt);
const nfc = s => s.normalize('NFC');
const EXTRA = { '€': 'E', 'Æ': 'AE', 'Ð': 'D', 'Ø': 'O', 'Þ': 'TH', 'ß': 's', 'æ': 'ae', 'ð': 'd', 'ø': 'o', 'þ': 'th', 'Đ': 'D', 'đ': 'd', 'Ħ': 'H', 'ħ': 'h', 'ı': 'i', 'ĸ': 'k', 'Ł': 'L', 'ł': 'l', 'Ŋ': 'N', 'ŋ': 'n', 'Œ': 'OE', 'œ': 'oe', 'Ŧ': 'T', 'ŧ': 't', 'Ə': 'E', 'ǝ': 'e', 'ɑ': 'a' };
const withoutCombining = s => [...s.normalize('NFKD').replace(/\p{M}/gu, '')].map(c => EXTRA[c] ?? c).join('');
const stripClozes = s => s.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1');
// Rust の regex の \b \w \d は Unicode の意味（日本語の文字も単語の文字）。JS では英数字だけなので置き換える
const B_ = String.fromCharCode(92), WCLS = ['Alphabetic', 'M', 'Nd', 'Pc', 'Join_Control'].map(p => B_ + 'p{' + p + '}').join('');
function rustToJs(src) {
  let out = '', inCls = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === B_ && i + 1 < src.length) {
      const n = src[++i];
      if (n === 'd') out += B_ + 'p{Nd}'; else if (n === 'D') out += B_ + 'P{Nd}';
      else if (n === 'w') out += inCls ? WCLS : `[${WCLS}]`;
      else if (n === 'W' && !inCls) out += `[^${WCLS}]`;
      else if (n === 'b' && !inCls) out += `(?:(?<=[${WCLS}])(?![${WCLS}])|(?<![${WCLS}])(?=[${WCLS}]))`;
      else if (n === 'B' && !inCls) out += `(?:(?<=[${WCLS}])(?=[${WCLS}])|(?<![${WCLS}])(?![${WCLS}]))`;
      else if (n === 'A') out += '^'; else if (n === 'z') out += '$';
      else if (/[A-Za-z0-9]/.test(n) || '^$.*+?()[]{}|/'.includes(n) || n === B_ || (inCls && n === '-')) out += B_ + n;
      else out += n; // Rust では記号はどれでも逃がせるが、JS の u モードでは誤りになるので、そのまま書く
      continue;
    }
    if (c === '[' && !inCls) inCls = true; else if (c === ']' && inCls) inCls = false;
    out += c;
  }
  return out;
}
// Rust の regex を JS で（(?i)(?s) などの先頭の旗も移す）。作れなければ null
function rustRe(src) {
  // 先頭の旗のかたまり（(?i)・(?-i)・(?is-m)・(?x) など）を順に読む。Anki は検索の頭に (?i) を付けるので、後の (?-i) で区別するようになる
  const on = new Set(); let m;
  while ((m = src.match(/^\(\?([a-zA-Z]*)(?:-([a-zA-Z]*))?\)/)) && (m[1] || m[2])) {
    for (const f of m[1]) on.add(f); for (const f of (m[2] || '')) on.delete(f); src = src.slice(m[0].length);
  }
  if (on.has('x')) src = stripVerbose(src);   // (?x): 空白と # から行末までを無視（文字クラスの中と \ の後は除く）
  const flags = 'u' + (on.has('i') ? 'i' : '') + (on.has('s') ? 's' : '') + (on.has('m') ? 'm' : '');
  try { return new RegExp(rustToJs(src), flags); } catch { try { return new RegExp(src, flags.replace('u', '')); } catch { return null; } }
}
function stripVerbose(src) {
  let out = '', cls = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { out += ch + (src[i + 1] ?? ''); i++; continue; }
    if (cls) { if (ch === ']') cls = false; out += ch; continue; }
    if (ch === '[') { cls = true; out += ch; continue; }
    if (/\s/.test(ch)) continue;
    if (ch === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    out += ch;
  }
  return out;
}
// SQLite の LIKE（ESCAPE '\'。大文字小文字は英字だけ区別しない。_ は1文字・% は何文字でも）
const likeCache = new Map();
function likeRe(pat) {
  let re = likeCache.get(pat); if (re) return re;
  let out = '^';
  for (let i = 0; i < pat.length;) {
    let c = cpAt(pat, i); i += c.length;
    if (c === '\\' && i < pat.length) { c = cpAt(pat, i); i += c.length; out += lit(c); continue; }
    out += c === '%' ? '.*' : c === '_' ? '.' : lit(c);
  }
  re = new RegExp(out + '$', 'su'); likeCache.set(pat, re); return re;
}
const lit = c => (/[a-z]/i.test(c) && c.length === 1 ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'));
const like = (s, pat) => likeRe(pat).test(String(s));
// f32 の値を Rust が SQL に書くときの10進（いちばん短い表し方）に直してから比べる
function f32ToSql(x) { if (!Number.isFinite(x)) return x; for (let p = 1; p <= 9; p++) { const v = Number(x.toPrecision(p)); if (Math.fround(v) === x) return v; } return x; }

// ---------- 絞り込み（sqlwriter.rs） ----------
// 判定は true・false・null（SQL の NULL）の3つ
const AND = (a, b) => (a === false || b === false ? false : a === null || b === null ? null : true);
const OR = (a, b) => (a === true || b === true ? true : a === null || b === null ? null : false);
const NOT = a => (a === null ? null : !a);
const CMP = { '=': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b };
const cmpNull = (a, op, b) => (a == null || b == null || Number.isNaN(a) || Number.isNaN(b) ? null : CMP[op](a, b));

export function compileSearch(S, query, currentDid) {
  const nodes = parse(query || '');
  const now = Math.floor(Date.now() / 1000), t = timingToday(now, S.meta), cfg = S.meta.config || {};
  const ignoreAccents = cfg.ignoreAccentsInSearch === true, normNote = cfg.normalize_note_text === false ? s => s : nfc;
  const learnAhead = cfg.collapseTime ?? 1200;
  const notes = S.notes || new Map();
  const note = c => notes.get(c.nid) || { mid: c.mid, flds: '', sfld: '', tags: ' ' + (c.tags || []).join(' ') + ' ', mod: 0, csum: 0 };
  const nts = Object.entries(S.meta.notetypes || {}).map(([id, n]) => ({ id: +id, ...n })).sort((a, b) => a.id - b.id);
  const decks = S.meta.decks.map(d => ({ id: d.id, native: d.name.split('::').join('\x1f'), conf: d.conf, dyn: d.dyn }));
  // フィルターデッキ（カードは動かさず data.flt で中にいることを表す）も、名前で探せるように
  for (const [id, f] of S.fdecks || []) if (!f.removed) decks.push({ id, native: f.name.split('::').join('\x1f'), dyn: true });
  const fltD = c => { const f = c.data?.flt; if (!f) return null; const d = S.fdecks?.get(f.d); return d && !d.removed ? f.d : null; };   // 今いるフィルターデッキ
  let revByCard = null;
  const revs = cid => { if (!revByCard) { revByCard = new Map(); for (const r of S.revlog) { const a = revByCard.get(r.cid); a ? a.push(r) : revByCard.set(r.cid, [r]); } } return revByCard.get(cid) || []; };
  const due0 = c => c.due; // 書き出しでは odue を due に入れてある（case when c.odue != 0 then c.odue else c.due end）
  const collectRanges = (ords, join) => { const out = []; for (const o of ords) { const last = out[out.length - 1]; if (join && last && last[1] === o) last[1]++; else out.push([o, o + 1]); } return out; };
  const fieldPattern = (total, range, arg) => { const parts = []; for (let i = 0; i < total; i++) { if (i === range[0]) parts.push(arg); else if (i > range[0] && i < range[1]) continue; else parts.push('%'); } return parts.join('\x1f'); };
  const globMatcher = name => { if (isGlob(name)) { const re = rustRe('(?i)^' + toRe(name) + '$'); return s => !!re && re.test(s); } const tx = toText(name).toLowerCase(); return s => s.toLowerCase() === tx; };

  const unqualified = (text, noComb, stripCl) => {
    let pat = toSql(text); if (noComb) pat = withoutCombining(pat); pat = `%${pat}%`;
    const proc = s => { s = String(s); if (stripCl) s = stripClozes(s); if (noComb) s = withoutCombining(s); return s; };
    const clozeMids = stripCl ? new Set(nts.filter(n => n.type === 1).map(n => n.id)) : null;
    const anyExcluded = nts.some(n => (n.fields || []).some(f => f.excludeFromSearch));
    const ctx = anyExcluded ? new Map(nts.map(n => { const fs = n.fields || []; const inc = fs.filter(f => !f.excludeFromSearch).map(f => f.ord); return [n.id, { total: fs.length, ranges: collectRanges(inc, true), sortfExcluded: fs.some(f => f.excludeFromSearch && f.ord === (n.sortf || 0)) }]; })) : null;
    return c => {
      const n = note(c);
      if (clozeMids && !clozeMids.has(n.mid)) return false;
      const flds = proc(n.flds), sfld = proc(n.sfld);
      if (!ctx) return like(sfld, pat) || like(flds, pat);
      const x = ctx.get(n.mid); if (!x || !x.ranges.length) return false;
      return x.ranges.some(r => like(flds, fieldPattern(x.total, r, pat))) || (!x.sortfExcluded && like(sfld, pat));
    };
  };
  const regexAll = (word, noComb) => {
    if (noComb) word = withoutCombining(word);
    const re = rustRe('(?i)' + word); if (!re) throw new SearchError('Other', { info: `<pre>${word}</pre>` });
    const anyExcluded = nts.some(n => (n.fields || []).some(f => f.excludeFromSearch));
    const inc = anyExcluded ? new Map(nts.map(n => [n.id, (n.fields || []).filter(f => !f.excludeFromSearch).map(f => f.ord)])) : null;
    return c => {
      const n = note(c); const flds = noComb ? withoutCombining(n.flds) : n.flds;
      if (!inc) return re.test(flds);
      const ords = inc.get(n.mid); if (!ords) return false;
      const fs = flds.split('\x1f'); if (ords.length === fs.length) return re.test(flds);
      return fs.some((f, i) => ords.includes(i) && re.test(f));
    };
  };
  const field = (fname, val, mode) => {
    if (['*', '_*', '*_'].includes(fname)) {
      const re = mode === 'regex' ? rustRe('(?i)' + val) : rustRe('(?is)^' + toRe(val) + '$');
      if (!re) throw new SearchError('Other', { info: `<pre>${val}</pre>` });
      return c => note(c).flds.split('\x1f').some(f => re.test(f));
    }
    const m = globMatcher(fname);
    if (mode === 'regex') {
      const map = new Map(nts.map(n => [n.id, (n.fields || []).filter(f => m(f.name)).map(f => f.ord)]).filter(([, o]) => o.length));
      if (!map.size) return () => false;
      const re = rustRe('(?i)' + val); if (!re) throw new SearchError('Other', { info: `<pre>${val}</pre>` });
      return c => { const n = note(c); const ords = map.get(n.mid); return !!ords && n.flds.split('\x1f').some((f, i) => ords.includes(i) && re.test(f)); };
    }
    const nonEmpty = ['*', '_*', '*_'].includes(val);
    const map = new Map(nts.map(n => { const fs = n.fields || []; return [n.id, { total: fs.length, ranges: collectRanges(fs.filter(f => m(f.name)).map(f => f.ord), !nonEmpty) }]; }).filter(([, x]) => x.ranges.length));
    if (!map.size) return () => false;
    let pat = toSql(val); if (mode === 'nc') pat = withoutCombining(pat);
    return c => { const n = note(c); const x = map.get(n.mid); if (!x) return false; const flds = mode === 'nc' ? withoutCombining(n.flds) : n.flds; return x.ranges.some(r => like(flds, fieldPattern(x.total, r, pat))); };
  };
  const deckMatch = deck => {
    if (deck === '*') return () => true;
    if (deck === 'filtered') return c => fltD(c) != null;
    let native;
    if (deck === 'current') { const d = S.decksById.get(currentDid) || (S.fdecks?.get(currentDid)?.removed ? null : S.fdecks?.get(currentDid)); native = reEscape((d ? d.name : 'Default').split('::').join('\x1f')); }
    else native = toRe(deck).split('::').map(x => x.replace(RUST_WS, '') || 'blank').join('\x1f');
    const re = rustRe(`(?i)^${native}($|\x1f)`); if (!re) return () => false;
    const ids = new Set(decks.filter(d => re.test(d.native)).map(d => d.id));
    // Anki: 今いるデッキ（フィルターデッキの中ならそのデッキ）か、元のデッキ（odid）が当たれば当たる
    return c => ids.has(c.did) || ids.has(fltD(c));
  };
  const rated = (op, days, ease) => {
    const target = (t.nextDayAt + 86400 * days) * 1000, before = (t.nextDayAt + 86400 * (days - 1)) * 1000;
    const inRange = { '>': id => id >= target, '>=': id => id >= before, '<': id => id < before, '<=': id => id < target, '=': id => id >= before && id <= target - 1, '!=': id => !(id >= before && id <= target - 1) }[op];
    const okEase = ease === 'any' ? e => e > 0 : ease === 'manual' ? e => e === 0 : e => e === ease;
    return c => revs(c.id).some(r => inRange(r.id) && okEase(r.ease));
  };
  const cdOf = c => { const cd = c.data && c.data.cd; if (cd == null) return null; try { return typeof cd === 'string' ? JSON.parse(cd) : cd; } catch { return null; } };
  const cdVal = (c, key) => { const o = cdOf(c); if (!o || !(key in o)) return null; const v = o[key]; return typeof v === 'string' ? v : JSON.stringify(v); };
  const retrievability = c => {
    const d = c.data || {}; if (d.s == null || d.d == null) return null;
    const due = due0(c); let secs;
    if (d.lrt != null) secs = Math.max(0, now - d.lrt);
    else if (due > 365000) secs = Math.max(0, now - (due - c.ivl));
    else secs = Math.max(0, t.daysElapsed - (due - c.ivl)) * 86400;
    const decay = Math.fround(d.decay ?? 0.5), fr = Math.fround;
    const factor = fr(fr(Math.pow(0.9, fr(1 / -decay))) - 1);
    return fr(Math.pow(fr(fr(fr(fr(secs / 86400) / fr(d.s)) * factor) + 1), -decay));
  };
  const prop = (op, k) => {
    switch (k.k) {
      case 'due': { const day = k.v + t.daysElapsed; return c => (c.queue === 2 || c.queue === 3 ? CMP[op](due0(c), day) : c.queue === 1 || c.queue === 4 ? CMP[op](Math.trunc((due0(c) - t.nextDayAt) / 86400), k.v) : false); }
      case 'pos': return c => c.type === 0 && CMP[op](due0(c), k.v);
      case 'ivl': return c => CMP[op](c.ivl, k.v);
      case 'reps': return c => CMP[op](c.reps, k.v);
      case 'lapses': return c => CMP[op](c.lapses, k.v);
      case 'ease': { const x = Math.fround(k.v * 1000); const v = Number.isNaN(x) ? 0 : Math.min(4294967295, Math.max(0, Math.trunc(x))); return c => CMP[op](c.factor, v); }
      case 'rated': return rated(op, k.days, k.ease);
      case 's': { const v = f32ToSql(k.v); return c => cmpNull(c.data?.s ?? null, op, v); }
      case 'd': { const v = f32ToSql(Math.fround(Math.fround(k.v * 9) + 1)); return c => cmpNull(c.data?.d ?? null, op, v); }
      case 'r': { const v = f32ToSql(k.v); return c => cmpNull(retrievability(c), op, v); }
      case 'cdn': { const v = f32ToSql(k.v); return c => { const x = cdVal(c, k.key); if (x == null) return null; const n = Number(String(x).trim().match(/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i)?.[0] ?? 0); return cmpNull(n, op, v); }; }
      case 'cds': return c => { const x = cdVal(c, k.key); return x == null ? null : CMP[op](x, k.v); };
    }
  };
  const searchNode = n => {
    switch (n.t) {
      case 'WholeCollection': return () => true;
      case 'UnqualifiedText': return unqualified(normNote(n.text), ignoreAccents, false);
      case 'Field': return field(nfc(n.field), normNote(n.text), n.mode);
      case 'Dupe': { const tx = stripHtml(normNote(n.text)); return c => { const no = note(c); return no.mid === n.ntid && stripHtml(no.flds.split('\x1f')[0]) === tx; }; }
      case 'Regex': return regexAll(normNote(n.re), false);
      case 'NoCombining': return unqualified(normNote(n.text), true, false);
      case 'StripClozes': return unqualified(normNote(n.text), ignoreAccents, true);
      case 'WordBoundary': return regexAll(`\\b${toRe(normNote(n.text))}\\b`, ignoreAccents);
      case 'Added': { const cut = (t.nextDayAt - 86400 * n.days) * 1000; return c => c.id > cut; }
      case 'Edited': { const cut = t.nextDayAt - 86400 * n.days; return c => note(c).mod > cut; }
      case 'Introduced': { const cut = (t.nextDayAt - 86400 * n.days) * 1000; return c => { const a = revs(c.id).filter(r => r.ease !== 0); if (!a.length) return false; return Math.min(...a.map(r => r.id)) > cut && revs(c.id).some(r => r.id > cut); }; }
      case 'Template': {
        if (n.ord != null) return c => c.ord === n.ord;
        const name = nfc(n.name), ok = new Set();
        if (isGlob(name)) { const re = rustRe('(?i)^' + toRe(name) + '$'); for (const nt of nts) for (const tp of nt.templates || []) if (re && re.test(tp.name)) ok.add(nt.id + ':' + tp.ord); }
        else { const tx = toText(name); for (const nt of nts) for (const tp of nt.templates || []) if (tp.name === tx) ok.add(nt.id + ':' + tp.ord); }
        return c => ok.has(note(c).mid + ':' + c.ord);
      }
      case 'Deck': return deckMatch(nfc(n.deck));
      case 'NotetypeId': return c => note(c).mid === n.id;
      case 'DeckIds': { const s = new Set(n.ids); return c => s.has(c.did); }
      case 'Notetype': {
        const name = nfc(n.name); let ok;
        if (isGlob(name)) { const re = rustRe('(?i)^' + toRe(name) + '$'); ok = new Set(nts.filter(x => re && re.test(x.name)).map(x => x.id)); }
        else { const tx = toText(name); ok = new Set(nts.filter(x => x.name === tx).map(x => x.id)); }
        return c => ok.has(note(c).mid);
      }
      case 'Rated': return rated('>', -n.days, n.ease);
      case 'Tag': {
        const tag = nfc(n.tag);
        if (n.regex) { const re = rustRe('(?i)' + tag); if (!re) throw new SearchError('Other', { info: `<pre>${tag}</pre>` }); return c => note(c).tags.split(' ').some(x => re.test(x)); }
        if (tag === 'none') return c => note(c).tags === '';
        if (tag === '*') return () => true;
        if (tag.includes(' ')) return () => false;
        const re = rustRe(`(?i).* ${toCustomRe(tag, '\\S')}(::| ).*`); return c => !!re && re.test(note(c).tags);
      }
      case 'State': {
        switch (n.state) {
          case 'New': return c => c.type === 0;
          case 'Review': return c => c.type === 2 || c.type === 3;
          case 'Learning': return c => c.type === 1 || c.type === 3;
          case 'Buried': return c => c.queue === -2 || c.queue === -3;
          case 'Suspended': return c => c.queue === -1;
          case 'UserBuried': return c => c.queue === -3;
          case 'SchedBuried': return c => c.queue === -2;
          case 'Due': { const cut = now + learnAhead; return c => ((c.queue === 2 || c.queue === 3) && c.due <= t.daysElapsed) || ((c.queue === 1 || c.queue === 4) && c.due <= cut); }
        }
        break;
      }
      case 'Flag': return c => (c.flags & 7) === n.flag;
      case 'NoteIds': { const s = new Set(n.ids); return c => s.has(c.nid); }
      case 'CardIds': { const s = new Set(n.ids); return c => s.has(c.id); }
      case 'Prop': return prop(n.op, n.kind);
      case 'CustomData': return c => cdVal(c, n.key) != null;
      case 'Preset': { const p = Object.values(S.meta.presets || {}).find(x => x.name === n.name); if (!p) return () => false; const ids = new Set(S.meta.decks.filter(d => d.conf === p.id).map(d => d.id)); return c => ids.has(c.did); }
    }
    return () => false;
  };
  // 並び（ノードの列）→ SQL と同じく and が or より強い
  const compile = list => {
    const ors = [[]];
    for (const x of list) { if (x === 'Or') ors.push([]); else if (x !== 'And') ors[ors.length - 1].push(x); }
    const parts = ors.map(a => a.map(one));
    return c => { let r = false; for (const p of parts) { let a = true; for (const f of p) { a = AND(a, f(c)); if (a === false) break; } r = OR(r, a); if (r === true) break; } return r; };
  };
  const one = x => { if (x.not === 'And' || x.not === 'Or') { const w = x.not.toLowerCase(); throw Object.assign(new Error(`DbError { info: "SqlInputError { msg: near \"${w}\": syntax error }", kind: Other }`), { name: 'DBError' }); }
    if (x.not) { const f = one(x.not); return c => NOT(f(c)); } if (x.group) return compile(x.group); if (x === 'And' || x === 'Or') return () => false; return searchNode(x); };
  const pred = compile(nodes);
  return c => pred(c) === true;
}
export function searchCards(S, query, currentDid) { const p = compileSearch(S, query, currentDid); return S.cards.filter(p); }
// HTML を取り除く（重複の検索用。text.rs strip_html_preserving_media_filenames の簡略版）
function stripHtml(h) {
  return String(h).replace(/<\b(?:img|audio|video|object|source)\b[^>]*?\bsrc\s*=\s*["']?([^"'>\s]+)[^>]*>/gis, ' $1 ')
    .replace(/<!--[\s\S]*?-->|<style[\s\S]*?>[\s\S]*?<\/style>|<script[\s\S]*?>[\s\S]*?<\/script>|<[\s\S]*?>/gi, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
// ノートの生の中身を読む（ブラウザ・統計で初めて検索するとき）。束は Service Worker が端末に取っておく
export async function loadNotes(S, bundleUrl) {
  if (S.notes) return S.notes;
  if (!S._notesP) S._notesP = (async () => {
    const files = S.manifest?.notes || []; const m = new Map();
    const parts = await Promise.all(files.map(f => fetch(bundleUrl + f).then(r => { if (!r.ok) throw new Error(f + ': ' + r.status); return r.json(); })));
    for (const arr of parts) for (const [nid, mid, flds, sfld, csum, tags, mod, guid] of arr) m.set(nid, { mid, flds, sfld: sfld == null ? '' : sfld, csum, tags, mod, guid });
    S.onNotesLoaded?.(m);   // 端末で追加・編集・削除したノートを重ねる（notes.mjs）
    S.notes = m; return m;
  })().catch(e => { S._notesP = null; throw e; });
  return S._notesP;
}
