// 入力して答える（{{type:Field}}・{{type:cloze:Field}}・{{type:nc:Field}}）。Anki 25.09.4 の写し:
// ・入力欄と比べた結果の差し込み方は aqt reviewer.py の typeAnsQuestionFilter／typeAnsAnswerFilter
// ・比べ方と HTML は rslib typeanswer.rs の compare_answer（difflib の SequenceMatcher で並べ、typeGood／typeBad／typeMissed）
// ・正しい答え（フィールドの中身。穴埋めなら extract_cloze_for_typing で取り出したもの）は、書き出しのときに Anki で作って card.typ に入れてある
export const TYPE_PAT = /\[\[type:(.+?)\]\]/;
const TYPE_PAT_G = /\[\[type:(.+?)\]\]/g;

// htmlescape::encode_minimal（& < > " ' だけ）
const encodeMinimal = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]);
// Rust の str::trim と同じ空白（Unicode の White_Space。JS の trim と違い U+FEFF は含まない）
const WS = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const rustTrim = s => s.replace(new RegExp(`^[${WS}]+|[${WS}]+$`, 'g'), '');
// rslib text.rs の HTML（コメント・style・script・タグを除く）と decode_entities（htmlescape::decode_html。おかしな & が1つでもあれば何もしない）
const HTML = /(<!--.*?-->)|(<style.*?>.*?<\/style>)|(<script.*?>.*?<\/script>)|(<.*?>)/gsi;
let entityBox = null;
function decodeEntity(e) {
  // 数の参照は htmlescape と同じくそのままの文字にする（ブラウザは &#0; や &#128; を別の文字に置き換えるので任せない）
  const m = /^&#([xX])?([0-9a-fA-F]+);$/.exec(e);
  if (m) { const n = parseInt(m[2], m[1] ? 16 : 10); return n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? null : String.fromCodePoint(n); }
  if (!entityBox) entityBox = document.createElement('textarea');
  entityBox.innerHTML = e; const v = entityBox.value;
  return v === e ? null : v;
}
function decodeEntities(s) {
  if (!s.includes('&')) return s;
  let ok = true;
  const out = s.replace(/&[^&;]*;?/g, m => {
    if (!ok) return m;
    if (!/^&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);$/.test(m)) { ok = false; return m; }
    const v = decodeEntity(m); if (v == null) { ok = false; return m; }
    return v;
  });
  return ok ? out.replace(/ /g, ' ') : s;
}
const stripHtml = s => decodeEntities(s.replace(HTML, ''));
// card_rendering の strip_av_tags（[sound:…] と読み上げのタグを除く）
const stripAvTags = s => s.replace(/\[sound:.+?\]/gs, '').replace(/\[anki:tts(?:\][^\]]*\]|[^\]]*\]).*?\[\/anki:tts\]/gs, '');
const LINEBREAKS = /(\n|<br\s?\/?>|<\/?div>)+/gsi;
export function stripExpected(expected) {
  return rustTrim(stripHtml(stripAvTags(expected).replace(LINEBREAKS, ' ')));
}

const isMark = c => /\p{M}/u.test(c);
const chars = s => Array.from(s);

// difflib の SequenceMatcher（junk 無し）。Anki が使う Rust の difflib クレートは、Python の autojunk（よく出る文字を外す）をしないので、ここでもしない
function opcodes(a, b) {
  const b2j = new Map();
  b.forEach((x, i) => { let l = b2j.get(x); if (!l) b2j.set(x, l = []); l.push(i); });
  const longest = (alo, ahi, blo, bhi) => {
    let besti = alo, bestj = blo, bestsize = 0; let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const nj = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue; if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1; nj.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = nj;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  };
  const queue = [[0, a.length, 0, b.length]], blocks = [];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      blocks.push([i, j, k]);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const merged = []; let [i1, j1, k1] = [0, 0, 0];
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
    else { if (k1) merged.push([i1, j1, k1]); [i1, j1, k1] = [i2, j2, k2]; }
  }
  if (k1) merged.push([i1, j1, k1]);
  merged.push([a.length, b.length, 0]);
  const out = []; let i = 0, j = 0;
  for (const [ai, bj, size] of merged) {
    const tag = i < ai && j < bj ? 'replace' : i < ai ? 'delete' : j < bj ? 'insert' : '';
    if (tag) out.push([tag, i, ai, j, bj]);
    i = ai + size; j = bj + size;
    if (size) out.push(['equal', ai, i, bj, j]);
  }
  return out;
}

function tokens(typed, expected) {
  const T = [], E = [];
  for (const [tag, i1, i2, j1, j2] of opcodes(typed, expected)) {
    const ts = typed.slice(i1, i2).join(''), es = expected.slice(j1, j2).join('');
    if (tag === 'equal') { T.push(['typeGood', ts]); E.push(['typeGood', es]); }
    else if (tag === 'delete') T.push(['typeBad', ts]);
    else if (tag === 'insert') { T.push(['typeMissed', '-'.repeat(chars(es).length)]); E.push(['typeMissed', es]); }
    else { T.push(['typeBad', ts]); E.push(['typeMissed', es]); }
  }
  return [T, E];
}
// 先頭が結合文字なら、前の塊とくっつかないように NBSP を前に置く
const renderTokens = toks => toks.map(([cls, t]) => `<span class=${cls}>${encodeMinimal(t && isMark(chars(t)[0]) ? ' ' + t : t)}</span>`).join('');
const wrap = s => `<code id=typeans>${s}</code>`;

export function compareAnswer(expected, typed, combining) {
  const stripped = stripExpected(expected);
  if (typed === '') return wrap(encodeMinimal(stripped));
  let T, E, original, renderExpected;
  if (combining) {
    T = chars(typed.normalize('NFC')); E = chars(stripped.normalize('NFC')); original = E.join('');
    renderExpected = renderTokens;
  } else {
    // 結合文字を除いて比べ、正しい答えの行には結合文字をつけたまま出す（DiffNonCombining）
    T = chars(typed.normalize('NFKD')).filter(c => !isMark(c));
    E = []; const split = [];
    for (const c of chars(stripped.normalize('NFKD'))) { if (isMark(c)) { if (split.length) split[split.length - 1] += c; } else { E.push(c); split.push(c); } }
    original = stripped;
    renderExpected = toks => { let idx = 0; return toks.map(([cls, t]) => { const end = idx + chars(t).length; const txt = split.slice(idx, end).join(''); idx = end; return `<span class=${cls}>${encodeMinimal(txt)}</span>`; }).join(''); };
  }
  if (T.length === E.length && T.every((c, i) => c === E[i])) return wrap(`<span class=typeGood>${original}</span>`);
  const [tt, et] = tokens(T, E);
  return wrap(`${renderTokens(tt)}<br><span id=typearrow>&darr;</span><br>${renderExpected(et)}`);
}

// 問題の面: 入力欄に置き換える（正しい答えが無いときは注意書きか、消すだけ）
export function typeQuestion(html, typ, never) {
  if (!TYPE_PAT.test(html)) return html;
  if (!typ || never) return html.replace(TYPE_PAT_G, '');
  if (!typ.exp) {
    if (typ.exp == null) {
      const warn = typ.cloze ? '[ツール] から [白紙カードをチェック] を実行してください。' : `解答キー入力: 不明なフィールド ⁨${typ.fld}⁩`;
      return html.replace(TYPE_PAT_G, () => warn);
    }
    return html.replace(TYPE_PAT_G, '');
  }
  const font = String(typ.font || 'Arial').replace(/['"<>]/g, ''), size = +typ.size || 20;
  return html.replace(TYPE_PAT_G, () => `\n<center>\n<input type=text id=typeans\n   style="font-family: '${font}'; font-size: ${size}px;">\n</center>\n`);
}
// 答えの面: 打ったものと比べた結果に置き換える（{{FrontSide}} の区切り線は比べた結果の前に出す）
export function typeAnswer(html, typ, typed) {
  if (!typ || !typ.exp) return html.replace(TYPE_PAT_G, '');
  const orig = html;
  const buf = html.split('<hr id=answer>').join('');
  const hadHR = buf.length !== orig.length;
  const output = compareAnswer(typ.exp, typed ?? '', !typ.nc);
  const font = String(typ.font || 'Arial').replace(/['"<>]/g, ''), size = +typ.size || 20;
  let s = `\n<div style="font-family: '${font}'; font-size: ${size}px">${output}</div>`;
  if (hadHR) s = `<hr id=answer>${s}`;
  if (hadHR && !TYPE_PAT.test(buf)) return orig;
  return buf.replace(TYPE_PAT_G, () => s);
}
