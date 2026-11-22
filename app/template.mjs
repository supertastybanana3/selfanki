// カードの表・裏を、ノートの中身とテンプレートから描く（端末で追加・編集したノート用）。
// Anki 25.09.4 の rslib template.rs・template_filters.rs・cloze.rs・image_occlusion/imageocclusion.rs・text.rs・
// card_rendering（音声の印の取り出し）と、pylib template.py（FrontSide・知らないフィルター）の写し。
// 書き出し（tools/export_anki.py）と同じ後処理（script を除く・on…= と javascript: を除く）、入力して答える（typ）、並べる欄（sfld）も作る。
// 文言は Anki の英語（書き出しを Python の anki で既定の言語のまま動かしたときと同じ）
import { blake3hex } from './blake3.mjs';

const FSI = '⁨', PDI = '⁩', arg = s => FSI + s + PDI;
const TR = {
  emptyFront: 'The front of this card is blank.',
  missingCloze: n => 'No cloze ' + arg(n) + ' found on card.\nPlease either add a cloze deletion, or use the Empty Cards tool.',
  moreInfo: 'More information', front: 'Front template has a problem:', back: 'Back template has a problem:',
  noSuchField: (tag, f) => "Found '" + arg(tag) + "', but there is no field called '" + arg(f) + "'",
  notClosed: t => "Missing '" + arg(t) + "'",
  notOpen: (c, o1, o2) => "Found '" + arg(c) + "', but missing '" + arg(o1) + "' or '" + arg(o2) + "'",
  wrongClosed: (c, o) => "Found '" + arg(c) + "', but expected '" + arg(o) + "'",
  blank: 'blank',
  badTts: "Error in directive '" + arg('anki:tts') + "': " + arg("'" + arg('lang') + "' not set"),
};
const LINK_ERR = 'https://docs.ankiweb.net/templates/errors.html#template-syntax-error';
const LINK_BLANK = 'https://docs.ankiweb.net/templates/errors.html#front-of-card-is-blank';
const LINK_BLANK_CLOZE = 'https://docs.ankiweb.net/templates/errors.html#no-cloze-filter-on-cloze-note-type';

// ---------- 文字参照（htmlescape の decode_html と同じく、知らない名前や壊れた参照があれば全体をそのまま返す） ----------
const ENT = Object.fromEntries('AElig:198,Aacute:193,Acirc:194,Agrave:192,Alpha:913,Aring:197,Atilde:195,Auml:196,Beta:914,Ccedil:199,Chi:935,Dagger:8225,Delta:916,ETH:208,Eacute:201,Ecirc:202,Egrave:200,Epsilon:917,Eta:919,Euml:203,Gamma:915,Iacute:205,Icirc:206,Igrave:204,Iota:921,Iuml:207,Kappa:922,Lambda:923,Mu:924,Ntilde:209,Nu:925,OElig:338,Oacute:211,Ocirc:212,Ograve:210,Omega:937,Omicron:927,Oslash:216,Otilde:213,Ouml:214,Phi:934,Pi:928,Prime:8243,Psi:936,Rho:929,Scaron:352,Sigma:931,THORN:222,Tau:932,Theta:920,Uacute:218,Ucirc:219,Ugrave:217,Upsilon:933,Uuml:220,Xi:926,Yacute:221,Yuml:376,Zeta:918,aacute:225,acirc:226,acute:180,aelig:230,agrave:224,alefsym:8501,alpha:945,amp:38,and:8743,ang:8736,aring:229,asymp:8776,atilde:227,auml:228,bdquo:8222,beta:946,brvbar:166,bull:8226,cap:8745,ccedil:231,cedil:184,cent:162,chi:967,circ:710,clubs:9827,cong:8773,copy:169,crarr:8629,cup:8746,curren:164,dArr:8659,dagger:8224,darr:8595,deg:176,delta:948,diams:9830,divide:247,eacute:233,ecirc:234,egrave:232,empty:8709,emsp:8195,ensp:8194,epsilon:949,equiv:8801,eta:951,eth:240,euml:235,euro:8364,exist:8707,fnof:402,forall:8704,frac12:189,frac14:188,frac34:190,frasl:8260,gamma:947,ge:8805,gt:62,hArr:8660,harr:8596,hearts:9829,hellip:8230,iacute:237,icirc:238,iexcl:161,igrave:236,image:8465,infin:8734,int:8747,iota:953,iquest:191,isin:8712,iuml:239,kappa:954,lArr:8656,lambda:955,lang:9001,laquo:171,larr:8592,lceil:8968,ldquo:8220,le:8804,lfloor:8970,lowast:8727,loz:9674,lrm:8206,lsaquo:8249,lsquo:8216,lt:60,macr:175,mdash:8212,micro:181,middot:183,minus:8722,mu:956,nabla:8711,nbsp:160,ndash:8211,ne:8800,ni:8715,not:172,notin:8713,nsub:8836,ntilde:241,nu:957,oacute:243,ocirc:244,oelig:339,ograve:242,oline:8254,omega:969,omicron:959,oplus:8853,or:8744,ordf:170,ordm:186,oslash:248,otilde:245,otimes:8855,ouml:246,para:182,part:8706,permil:8240,perp:8869,phi:966,pi:960,piv:982,plusmn:177,pound:163,prime:8242,prod:8719,prop:8733,psi:968,quot:34,rArr:8658,radic:8730,rang:9002,raquo:187,rarr:8594,rceil:8969,rdquo:8221,real:8476,reg:174,rfloor:8971,rho:961,rlm:8207,rsaquo:8250,rsquo:8217,sbquo:8218,scaron:353,sdot:8901,sect:167,shy:173,sigma:963,sigmaf:962,sim:8764,spades:9824,sub:8834,sube:8838,sum:8721,sup:8835,sup1:185,sup2:178,sup3:179,supe:8839,szlig:223,tau:964,there4:8756,theta:952,thetasym:977,thinsp:8201,thorn:254,tilde:732,times:215,trade:8482,uArr:8657,uacute:250,uarr:8593,ucirc:251,ugrave:249,uml:168,upsih:978,upsilon:965,uuml:252,weierp:8472,xi:958,yacute:253,yen:165,yuml:255,zeta:950,zwj:8205,zwnj:8204'.split(',').map(x => { const [k, v] = x.split(':'); return [k, +v]; }));
ENT.apos = 39;
function decodeStrict(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c !== '&') { out += c; i++; continue; }
    const m = /^&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.exec(s.slice(i, i + 40));
    if (!m) return null;
    let cp;
    if (m[1][0] === '#') cp = /^#[xX]/.test(m[1]) ? parseInt(m[1].slice(2), 16) : parseInt(m[1].slice(1), 10);
    else { cp = ENT[m[1]]; if (cp == null) return null; }
    if (!(cp >= 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp); i += m[0].length;
  }
  return out;
}
export function decodeEntities(h) { if (!h.includes('&')) return h; const d = decodeStrict(h); return d == null ? h : d.replace(/ /g, ' '); }
// 書き出しの並べる欄（Python の html.unescape と同じく、分からない参照はそのまま残す）
function unescapeLoose(s) {
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);?/g, (m, b) => {
    if (b[0] === '#') { const cp = /^#[xX]/.test(b) ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10); return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�'; }
    const cp = ENT[b]; return cp != null ? String.fromCodePoint(cp) : m;
  });
}
// htmlescape の encode_attribute（256 未満の英数字以外を &#xHH; に）と encode_minimal
const MIN_ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
export function encodeAttribute(s) { let o = ''; for (const ch of s) { const b = ch.codePointAt(0); o += MIN_ENT[ch] || (b < 256 && (b > 127 || !/[A-Za-z0-9]/.test(ch)) ? '&#x' + b.toString(16).toUpperCase().padStart(2, '0') + ';' : ch); } return o; }
const encodeMinimal = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]);

// ---------- text.rs ----------
const HTML = /(<!--[\s\S]*?-->)|(<style[\s\S]*?>[\s\S]*?<\/style>)|(<script[\s\S]*?>[\s\S]*?<\/script>)|(<[\s\S]*?>)/gi;
export const stripHtmlPreservingEntities = h => h.replace(HTML, '');
export const stripHtml = h => decodeEntities(stripHtmlPreservingEntities(h));
const LINEBREAK = /<\/?(?:br|address|article|aside|blockquote|canvas|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|noscript|ol|output|p|pre|section|table|tfoot|ul|video)>/gi;
const stripHtmlForTts = h => stripHtml(h.replace(LINEBREAK, ' '));
const RSPACE = '[\\t\\n\\v\\f\\r ]';
export const fieldIsEmpty = t => new RegExp('^(?:' + RSPACE + '|</?(?:br|div) ?/?>)*$', 'i').test(t);

// ---------- cloze.rs ----------
function clozeTokens(text) {
  const out = []; let i = 0;
  const open = j => { if (!text.startsWith('{{c', j)) return null; let k = j + 3; while (k < text.length && text.charCodeAt(k) >= 48 && text.charCodeAt(k) <= 57) k++; if (k === j + 3) return null; const n = parseInt(text.slice(j + 3, k), 10); if (n > 65535) return null; if (!text.startsWith('::', k)) return null; return { len: k + 2 - j, n }; };
  while (i < text.length) {
    const o = open(i); if (o) { out.push({ t: 'open', n: o.n }); i += o.len; continue; }
    if (text.startsWith('}}', i)) { out.push({ t: 'close' }); i += 2; continue; }
    let j = i + 1; while (j < text.length && !open(j) && !text.startsWith('}}', j)) j++;
    out.push({ t: 'text', s: text.slice(i, j) }); i = j;
  }
  return out;
}
function parseClozes(text) {
  const open = [], output = [];
  for (const tk of clozeTokens(text)) {
    if (tk.t === 'open') { if (open.length < 10) open.push({ ord: tk.n, nodes: [], hint: null }); }
    else if (tk.t === 'text') {
      let s = tk.s; const cur = open[open.length - 1];
      if (cur) { const k = s.indexOf('::'); if (k >= 0) { cur.hint = s.slice(k + 2); s = s.slice(0, k); } cur.nodes.push({ text: s }); }
      else output.push({ text: s });
    } else {
      const c = open.pop();
      if (c) (open.length ? open[open.length - 1].nodes : output).push({ cloze: c });
      else output.push({ text: '}}' });
    }
  }
  return output;
}
const hintOf = c => c.hint == null ? '...' : c.hint;
function clozedText(c) { if (c.nodes.length === 1 && c.nodes[0].text != null) return c.nodes[0].text; return c.nodes.map(n => n.text != null ? n.text : clozedText(n.cloze)).join(''); }
const ioText = c => { const f = c.nodes[0]; return f && f.text != null && f.text.startsWith('image-occlusion:') ? f.text.slice(16) : null; };
function parseImageCloze(text) {
  const k = text.indexOf(':'); if (k < 0) return null;
  const shape = text.slice(0, k), props = []; let rem = text.slice(k);
  for (;;) {
    const m = /^:([^=]+)=((?:[^\\:]|\\:)*)/.exec(rem); if (!m) break;
    let val = m[2]; if (/\\$/.test(val)) break;
    props.push([m[1], val.replace(/\\:/g, ':')]); rem = rem.slice(m[0].length);
  }
  return { shape, props };
}
const emptyOrZero = v => v === '' || v === '0';
function imageClozeData(text) {
  const o = parseImageCloze(text); if (!o) return '';
  let r = '';
  if (o.shape && ['rect', 'ellipse', 'polygon', 'text'].includes(o.shape)) r += 'data-shape="' + o.shape + '" ';
  for (const [n, v] of o.props) {
    if (['left', 'top', 'angle', 'fill'].includes(n)) { if (v) r += 'data-' + n + '="' + v + '" '; }
    else if (['width', 'height', 'rx', 'ry', 'scale'].includes(n)) { if (!emptyOrZero(v)) r += 'data-' + n + '="' + v + '" '; }
    else if (n === 'points') { if (v) { const pts = v.split(' ').map(p => { const i = p.indexOf(','); return i < 0 ? null : p.slice(0, i) + ',' + p.slice(i + 1); }).filter(x => x != null); const ps = pts.join(' '); if (ps) r += 'data-points="' + ps + '" '; } }
    else if (n === 'oi') { if (v) r += 'data-occludeInactive="' + v + '" '; }
    else if (n === 'text') { if (v) r += 'data-text="' + encodeAttribute(v) + '" '; }
    else if (n === 'fs') { if (v) r += 'data-font-size="' + v + '" '; }
  }
  return r;
}
function renderIo(text, q, active, ord) {
  if ((q && active) || ord === 0) return '<div class="cloze" data-ordinal="' + ord + '" ' + imageClozeData(text) + '></div>';
  if (!active) return '<div class="cloze-inactive" data-ordinal="' + ord + '" ' + imageClozeData(text) + '></div>';
  if (!q && active) return '<div class="cloze-highlight" data-ordinal="' + ord + '" ' + imageClozeData(text) + '></div>';
  return '';
}
function revealCloze(c, ord, q, st) {
  const active = c.ord === ord; st.found = st.found || active;
  const io = ioText(c); if (io != null) return renderIo(io, q, active, c.ord);
  const inner = () => c.nodes.map(n => n.text != null ? n.text : revealCloze(n.cloze, ord, q, st)).join('');
  if (q && active) { const content = inner(); return '<span class="cloze" data-cloze="' + encodeAttribute(content) + '" data-ordinal="' + c.ord + '">[' + hintOf(c) + ']</span>'; }
  if (!q && active) return '<span class="cloze" data-ordinal="' + c.ord + '">' + inner() + '</span>';
  return '<span class="cloze-inactive" data-ordinal="' + c.ord + '">' + inner() + '</span>';
}
export function revealClozeText(text, ord, q) {
  const st = { found: false }; let buf = '';
  for (const n of parseClozes(text)) buf += n.text != null ? n.text : revealCloze(n.cloze, ord, q, st);
  return st.found ? buf : '';
}
function revealOnlyNodes(n, ord, q, out) { if (n.cloze) { if (n.cloze.ord === ord) out.push(q ? hintOf(n.cloze) : clozedText(n.cloze)); for (const x of n.cloze.nodes) revealOnlyNodes(x, ord, q, out); } }
export function revealClozeTextOnly(text, ord, q) { const out = []; for (const n of parseClozes(text)) revealOnlyNodes(n, ord, q, out); return out.join(', '); }
export function extractClozeForTyping(text, ord) {
  const out = []; for (const n of parseClozes(text)) revealOnlyNodes(n, ord, false, out);
  if (!out.length) return '';
  const s = [...out].sort(); return s[0] === s[s.length - 1] ? out[out.length - 1] : out.join(', ');
}
export function clozeNumbers(fields) {
  const set = new Set();
  const add = nodes => { for (const n of nodes) if (n.cloze && n.cloze.ord !== 0) { set.add(n.cloze.ord); add(n.cloze.nodes); } };
  for (const f of fields) add(parseClozes(f));
  return set;
}
const MATHJAX = /(\\[(\[])([\s\S]*?)(\\[\])])/gi;
const stripHtmlInsideMathjax = t => t.replace(MATHJAX, (m, a, b, c) => a + stripHtmlPreservingEntities(b) + c);

// ---------- template.rs（字句と構文） ----------
const ALT = '{{=<% %>=}}';
function tokens(template) {
  let s = template, st = '{{', en = '}}';
  if (s.trimStart().startsWith(ALT)) { s = s.trimStart().slice(ALT.length); while (s.startsWith(ALT)) s = s.slice(ALT.length); st = '<%'; en = '%>'; }
  const out = []; let i = 0, textStart = 0;
  const flushText = j => { if (j > textStart) out.push({ t: 'text', s: s.slice(textStart, j) }); };
  while (i < s.length) {
    if (s.startsWith(st, i)) { const e = s.indexOf(en, i + st.length); if (e >= 0) { flushText(i); out.push(classify(s.slice(i + st.length, e))); i = e + en.length; textStart = i; continue; } }
    if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); if (e >= 0) { flushText(i); out.push({ t: 'comment', s: s.slice(i + 4, e) }); i = e + 3; textStart = i; continue; } }
    i += s.codePointAt(i) > 0xffff ? 2 : 1;
  }
  flushText(s.length);
  return out;
}
const utf8len = s => new TextEncoder().encode(s).length;
const rtrim = s => s.replace(/^[\s\u0085]+|[\s\u0085]+$/g, '').replace(/^﻿|﻿$/g, m => m);
function classify(raw) {
  const start = rtrim(raw.replace(/^\{+/, ''));
  if (utf8len(start) < 2) return { t: 'rep', s: start };
  if (start[0] === '#') return { t: 'open', s: start.slice(1).replace(/^[\s\u0085]+/, '') };
  if (start[0] === '/') return { t: 'close', s: start.slice(1).replace(/^[\s\u0085]+/, '') };
  if (start[0] === '^') return { t: 'neg', s: start.slice(1).replace(/^[\s\u0085]+/, '') };
  return { t: 'rep', s: start };
}
class TemplateError extends Error { constructor(kind, a, b) { super(kind); this.kind = kind; this.a = a; this.b = b; } }
function parse(template) {
  const it = tokens(template); let pos = 0;
  const inner = openTag => {
    const nodes = [];
    while (pos < it.length) {
      const tk = it[pos++];
      if (tk.t === 'text') nodes.push({ t: 'text', s: tk.s });
      else if (tk.t === 'comment') nodes.push({ t: 'comment', s: tk.s });
      else if (tk.t === 'rep') { const parts = tk.s.split(':').reverse(); nodes.push({ t: 'rep', key: parts[0], filters: parts.slice(1) }); }
      else if (tk.t === 'open') nodes.push({ t: 'cond', key: tk.s, children: inner(tk.s) });
      else if (tk.t === 'neg') nodes.push({ t: 'neg', key: tk.s, children: inner(tk.s) });
      else { if (openTag != null && openTag === tk.s) return nodes; throw new TemplateError('notOpen', tk.s, openTag); }
    }
    if (openTag != null) throw new TemplateError('notClosed', openTag);
    return nodes;
  };
  return inner(null);
}
function templateIsEmpty(nonempty, nodes, checkNeg) {
  for (const n of nodes) {
    if (n.t === 'rep') { if (nonempty.has(n.key)) return false; }
    else if (n.t === 'cond') { if (!nonempty.has(n.key)) continue; if (!templateIsEmpty(nonempty, n.children, checkNeg)) return false; }
    else if (n.t === 'neg') { if (checkNeg && nonempty.has(n.key)) continue; if (!templateIsEmpty(nonempty, n.children, checkNeg)) return false; }
  }
  return true;
}
export function rendersWithFields(qfmt, nonempty) { try { return !templateIsEmpty(nonempty, parse(qfmt), true); } catch { return false; } }
const isClozeCond = k => /^c[0-9]+$/.test(k) && Number.isFinite(parseInt(k.slice(1), 10)) && parseInt(k.slice(1), 10) <= 4294967295;

// ---------- template_filters.rs ----------
const FURI = / ?([^ >]+?)\[(.+?)\]/g;
const ruby = (text, f) => text.replace(/&nbsp;/g, ' ').replace(FURI, (m, a, b) => b.startsWith('sound:') ? m : f(a, b));
function hintFilter(text, field) {
  if (text.trim() === '') return text;
  const id = blake3hex(new Uint8Array([...new TextEncoder().encode(text), ...new TextEncoder().encode(field)]), 8);
  return '\n<a class=hint href="#"\nonclick="this.style.display=\'none\';\ndocument.getElementById(\'hint' + id + '\').style.display=\'block\';\nreturn false;" draggable=false>\n' + field + '</a>\n<div id="hint' + id + '" class=hint style="display: none">' + text + '</div>\n';
}
function applyFilter(name, text, field, ctx) {
  switch (name) {
    case 'text': return stripHtml(text);
    case 'furigana': return ruby(text, (a, b) => '<ruby><rb>' + a + '</rb><rt>' + b + '</rt></ruby>');
    case 'kanji': return ruby(text, a => a);
    case 'kana': return ruby(text, (a, b) => b);
    case 'type': return '[[type:' + field + ']]';
    case 'type-cloze': return '[[type:cloze:' + field + ']]';
    case 'type-nc': return '[[type:nc:' + field + ']]';
    case 'hint': return hintFilter(text, field);
    case 'cloze': return stripHtmlInsideMathjax(revealClozeText(text, ctx.cardOrd + 1, ctx.frontside == null));
    case 'cloze-only': return revealClozeTextOnly(text, ctx.cardOrd + 1, ctx.frontside == null);
    case '': return text;
    default: if (name.startsWith('tts ')) return '[anki:tts lang=' + name.slice(4) + ']' + text + '[/anki:tts]'; return undefined;
  }
}
function applyFilters(text, filters, field, ctx) {
  let fs = filters;
  const last = fs[fs.length - 1];
  if (fs.length === 2 && fs[0] === 'cloze' && fs[1] === 'type') fs = ['type-cloze'];
  else if (fs.length === 2 && fs[0] === 'nc' && fs[1] === 'type') fs = ['type-nc'];
  else if (last === 'type') fs = ['type'];
  for (let i = 0; i < fs.length; i++) {
    const out = applyFilter(fs[i], text, field, ctx);
    if (out === undefined) return { text, rest: fs.slice(i) };   // 知らないフィルター: ここで止め、残りは Python（何もしない）へ
    text = out;
  }
  return { text, rest: [] };
}

// ---------- 描く（partial_render=true のときの rslib と、そのあとの Python） ----------
function renderNodes(out, nodes, ctx) {
  const push = s => { const l = out[out.length - 1]; if (l && l.t === 'text') l.s += s; else out.push({ t: 'text', s }); };
  for (const n of nodes) {
    if (n.t === 'text') push(n.s);
    else if (n.t === 'comment') { push('<!--'); push(n.s); push('-->'); }
    else if (n.t === 'rep' && n.key === 'FrontSide') out.push({ t: 'rep', field: 'FrontSide', text: '', rest: [] });
    else if (n.t === 'rep') {
      if (n.key === '' && n.filters.length) { out.push({ t: 'rep', field: '', text: '', rest: n.filters }); continue; }
      if (!ctx.fields.has(n.key)) throw new TemplateError('noField', n.key, [...n.filters].reverse().concat(['']).join(':'));
      const r = applyFilters(ctx.fields.get(n.key), n.filters, n.key, ctx);
      if (!r.rest.length) push(r.text); else out.push({ t: 'rep', field: n.key, text: r.text, rest: r.rest });
    } else {
      const neg = n.t === 'neg';
      let v; if (ctx.nonempty.has(n.key)) v = true; else if (ctx.fields.has(n.key) || isClozeCond(n.key)) v = false; else throw new TemplateError('noCond', (neg ? '^' : '#') + n.key);
      if (v !== neg) renderNodes(out, n.children, ctx); else renderNodes([], n.children, ctx);
    }
  }
}
function errorHtml(e, q) {
  let d;
  if (e.kind === 'notClosed') d = TR.notClosed('{{/' + e.a + '}}');
  else if (e.kind === 'notOpen') d = e.b != null ? TR.wrongClosed('{{/' + e.a + '}}', '{{/' + e.b + '}}') : TR.notOpen('{{/' + e.a + '}}', '{{#' + e.a + '}}', '{{^' + e.a + '}}');
  else if (e.kind === 'noField') d = TR.noSuchField('{{' + e.b + e.a + '}}', e.a);
  else if (e.kind === 'noCond') d = TR.noSuchField('{{' + e.a + '}}', e.a.slice(1));
  else d = String(e.message);
  return (q ? TR.front : TR.back) + '<br>' + encodeMinimal(d) + "<br><a href='" + LINK_ERR + "'>" + TR.moreInfo + '</a>';
}
const finish = (nodes, frontSide) => nodes.map(n => n.t === 'text' ? n.s : (n.field === 'FrontSide' && frontSide != null ? frontSide : n.text)).join('');

// ---------- 音声の印（card_rendering の extract_av_tags） ----------
function avNodes(txt) {
  const nodes = []; let i = 0, textOnly = true;
  const isNot = (j, chars) => { let k = j; while (k < txt.length && !chars.includes(txt[k])) k++; return k; };
  while (i < txt.length) {
    if (txt.startsWith('[sound:', i)) { const k = isNot(i + 7, ']'); if (k > i + 7 && txt[k] === ']') { nodes.push({ sound: txt.slice(i + 7, k) }); textOnly = false; i = k + 1; continue; } }
    const tg = tagNode(txt, i);
    if (tg) { nodes.push(tg.node); textOnly = false; i = tg.end; continue; }
    const k = txt.indexOf('[', i + 1); const e = k < 0 ? txt.length : k;
    nodes.push({ text: txt.slice(i, e) }); i = e;
  }
  return { nodes, textOnly };
}
function tagNode(s, i) {
  if (!s.startsWith('[anki:', i)) return null;
  let k = i + 6; while (k < s.length && !'] \t\r\n'.includes(s[k])) k++;
  if (k === i + 6) return null;
  const name = s.slice(i + 6, k);
  let p = k; while (p < s.length && /\s/.test(s[p]) && '\t\n\r \f\v'.includes(s[p])) p++;
  const opts = [];
  for (;;) {
    let q = p; while (q < s.length && !'] \t\r\n='.includes(s[q])) q++;
    if (q === p || s[q] !== '=') break;
    const key = s.slice(p, q); let v = q + 1, val;
    if (s[v] === '"') { let e = v + 1; while (e < s.length && s[e] !== '"') e++; if (s[e] !== '"') break; val = s.slice(v + 1, e); v = e + 1; }
    else { let e = v; while (e < s.length && !'] \t\r\n"'.includes(s[e])) e++; val = s.slice(v, e); v = e; }
    opts.push([key, val]); p = v; while (p < s.length && '\t\n\r \f\v'.includes(s[p])) p++;
  }
  if (s[p] !== ']') return null;
  const close = '[/anki:' + name + ']'; const c0 = p + 1;
  let j = c0;
  while (j < s.length && !s.startsWith(close, j)) { const k2 = s.indexOf('[', j + 1); j = k2 < 0 ? s.length : k2; }
  if (!s.startsWith(close, j)) return null;
  return { end: j + close.length, node: { name, opts, content: s.slice(c0, j) } };
}
const f32 = x => Math.fround(x);
function f32str(x) { if (Number.isInteger(x)) return String(x); for (let p = 1; p <= 9; p++) { const s = x.toPrecision(p); if (f32(+s) === x) return String(+s); } return String(x); }
export function extractAvTags(text, q) {
  const { nodes, textOnly } = avNodes(text);
  if (textOnly) return { text, tags: [] };
  const side = q ? 'q' : 'a', tags = []; let buf = '';
  for (const n of nodes) {
    if (n.text != null) buf += n.text;
    else if (n.sound != null) { buf += '[anki:play:' + side + ':' + tags.length + ']'; tags.push({ sound: decodeEntities(n.sound) }); }
    else if (n.name === 'tts') {
      let lang = '', voices = [], speed = 1, blank = null;
      for (const [k, v] of n.opts) { if (k === 'lang') lang = v; else if (k === 'voices') voices = v.split(','); else if (k === 'speed') { const x = parseFloat(v); speed = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$|^[+-]?(inf|infinity|nan)$/i.test(v) && !Number.isNaN(x) ? x : 1; } else if (k === 'cloze_blank') blank = v; }
      if (!lang) { buf += '[' + TR.badTts + ']'; continue; }
      buf += '[anki:play:' + side + ':' + tags.length + ']';
      tags.push({ tts: stripHtmlForTts(n.content).split('[...]').join(blank != null ? blank : TR.blank), lang, voices, speed: f32(speed) });
    } else { buf += '[anki:' + n.name + n.opts.map(([k, v]) => /[\] \t\r\n]/.test(v) ? ' ' + k + '="' + v + '"' : ' ' + k + '=' + v).join('') + ']' + n.content + '[/anki:' + n.name + ']'; }
  }
  return { text: buf, tags };
}

// ---------- 書き出しと同じ後処理（tools/export_anki.py） ----------
const SCRIPT = /<script\b[\s\S]*?<\/script>/gi, ASK = /<!--ask:begin-->[\s\S]*?<!--ask:end-->/g;
const ONATTR = /(<[^>]*?)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JSURL = /(href|src|action|formaction)\s*=\s*(["']?)\s*javascript:/gi;
export function cleanHtml(h) {
  h = h.replace(SCRIPT, '').replace(ASK, '');
  for (let i = 0; i < 20; i++) { const h2 = h.replace(ONATTR, '$1'); if (h2 === h) break; h = h2; }
  return h.replace(JSURL, '$1=$2about:blank#');
}
const TYPE_PAT = /\[\[type:(.+?)\]\]/;
function typeInfo(nt, fields, ord, q) {
  const m = TYPE_PAT.exec(q); if (!m) return undefined;
  let fld = m[1], clozeIdx = null, combining = true;
  if (fld.startsWith('cloze:')) { clozeIdx = ord + 1; fld = fld.split(':')[1]; }
  if (fld.startsWith('nc:')) { combining = false; fld = fld.split(':')[1]; }
  let exp = null, font = 'Arial', size = 20;
  for (const f of nt.flds) if (f.name === fld) { exp = fields[f.ord] ?? ''; if (clozeIdx) exp = extractClozeForTyping(exp, clozeIdx) || null; font = f.font ?? 'Arial'; size = f.size ?? 20; break; }
  return { exp, nc: !combining, cloze: !!clozeIdx, fld, font, size };
}
// 並べる欄（書き出しの sort_text）
export function sortText(h) {
  h = h.replace(/<br\s*\/?>|<div>|\n/gi, ' ').replace(/\[\[type:[^\]]+\]\]/g, '').replace(/\[sound:[^\]]+\]/g, '');
  h = h.replace(/<!--[\s\S]*?-->|<style[\s\S]*?>[\s\S]*?<\/style>|<script[\s\S]*?>[\s\S]*?<\/script>|<[\s\S]*?>/gi, '');
  return [...unescapeLoose(h).trim().replace(/\s+/g, ' ')].slice(0, 300).join('');
}

// ---------- カード1枚を描く ----------
// nt: { name, type(1=穴埋め), flds:[{name, ord, font, size}], tmpls:[{name, ord, qfmt, afmt, did}] }
// note: { fields:[...], tags:[...] }, card: { ord, flags, id, deckName }
export function renderCard(nt, note, card) {
  const isCloze = nt.type === 1;
  const tmpl = isCloze ? nt.tmpls[0] : nt.tmpls[card.ord];
  const fields = new Map();
  nt.flds.forEach((f, i) => { if (!fields.has(f.name)) fields.set(f.name, note.fields[i] ?? ''); });
  const deck = card.deckName || '(Deck)';
  for (const [k, v] of [['Tags', (note.tags || []).join(' ')], ['Type', nt.name], ['Subdeck', deck.split('::').pop()], ['Deck', deck], ['CardFlag', 'flag' + ((card.flags || 0) & 0xff)], ['Card', tmpl ? tmpl.name : ''], ['CardID', String(card.id)]]) if (!fields.has(k)) fields.set(k, v);
  if (!fields.has('c' + (card.ord + 1))) fields.set('c' + (card.ord + 1), '1');
  const nonempty = new Set([...fields].filter(([, v]) => !fieldIsEmpty(v)).map(([k]) => k));
  const ctx = { fields, nonempty, cardOrd: card.ord, frontside: null };
  let qtext, atext, qnodes, qparsed;
  try {
    qparsed = parse(tmpl.qfmt); qnodes = []; renderNodes(qnodes, qparsed, ctx);
  } catch (e) { if (!(e instanceof TemplateError)) throw e; const t = errorHtml(e, true); return finishCard(nt, note, card, t, t, [], []); }
  let empty = null;
  if (isCloze && !clozeNumbers([...fields.values()]).has(card.ord + 1)) empty = '<div>' + TR.missingCloze(card.ord + 1) + "<br><a href='" + LINK_BLANK_CLOZE + "'>" + TR.moreInfo + '</a></div>';
  else if (!isCloze && templateIsEmpty(nonempty, qparsed, true)) empty = '<div>' + TR.emptyFront + "<br><a href='" + LINK_BLANK + "'>" + TR.moreInfo + '</a></div>';
  let anodes;
  if (empty) { qnodes.push({ t: 'text', s: empty }); anodes = [{ t: 'text', s: empty }]; }
  else {
    ctx.frontside = '';
    try { anodes = []; renderNodes(anodes, parse(tmpl.afmt), ctx); }
    catch (e) { if (!(e instanceof TemplateError)) throw e; const t = errorHtml(e, false); return finishCard(nt, note, card, t, t, [], []); }
  }
  qtext = finish(qnodes, null);
  const qo = extractAvTags(qtext, true);
  atext = finish(anodes, qo.text);
  const ao = extractAvTags(atext, false);
  return finishCard(nt, note, card, qo.text, ao.text, qo.tags, ao.tags);
}
function finishCard(nt, note, card, q, a, qav, aav) {
  q = cleanHtml(q); a = cleanHtml(a);
  const out = { q, a, qav, aav, tname: (nt.type === 1 ? nt.tmpls[0] : nt.tmpls[card.ord])?.name || '' };
  const typ = typeInfo(nt, note.fields, card.ord, q); if (typ) out.typ = typ;
  return out;
}

// ---------- カードの作り方（rslib notetype/cardgen.rs） ----------
// 返すのは、まだ無い ord（と、テンプレートのデッキ指定）。existing は今ある ord の集合
export function cardsRequired(nt, fieldsArr, existing = new Set(), ensureNotEmpty = true) {
  const out = [];
  if (nt.type === 1) {
    for (const n of clozeNumbers(fieldsArr)) { const ord = Math.min(Math.max(n - 1, 0), 499); if (!existing.has(ord) && !out.some(o => o.ord === ord)) out.push({ ord, did: null }); }
  } else {
    const nonempty = new Set(nt.flds.filter((f, i) => !fieldIsEmpty(fieldsArr[i] ?? '')).map(f => f.name));
    nt.tmpls.forEach((t, ord) => { if (!existing.has(ord) && rendersWithFields(t.qfmt, nonempty)) out.push({ ord, did: t.did || null }); });
  }
  if (!existing.size && !out.length && ensureNotEmpty) out.push({ ord: 0, did: null });
  return out;
}

// ---------- ノートタイプの変更で使う（rslib template.rs の rename_and_remove_fields・template_to_string・find_field_references） ----------
export function parseTemplate(s) { try { return parse(s ?? ''); } catch { return null; } }
export function templateToString(nodes) {
  let b = '';
  for (const n of nodes) {
    if (n.t === 'text') b += n.s;
    else if (n.t === 'comment') b += '<!--' + n.s + '-->';
    else if (n.t === 'rep') b += '{{' + [...n.filters].reverse().concat(n.key).join(':') + '}}';
    else b += '{{' + (n.t === 'cond' ? '#' : '^') + n.key + '}}' + templateToString(n.children) + '{{/' + n.key + '}}';
  }
  return b;
}
// map: 古い名前 → 新しい名前（null＝消した）
export function renameAndRemoveFields(nodes, map) {
  const out = [];
  for (const n of nodes) {
    if (n.t === 'text' || n.t === 'comment') out.push(n);
    else if (n.t === 'rep') { if (!map.has(n.key)) out.push(n); else if (map.get(n.key) != null) out.push({ ...n, key: map.get(n.key) }); }
    else {
      const children = renameAndRemoveFields(n.children, map);
      if (!map.has(n.key)) out.push({ ...n, children }); else if (map.get(n.key) == null) out.push(...children); else out.push({ ...n, key: map.get(n.key), children });
    }
  }
  return out;
}
const isClozeCondKey = k => /^c[0-9]+$/.test(k) && Number(k.slice(1)) <= 4294967295;
export function referencedFields(nodes, clozeOnly = false, withConds = true, set = new Set()) {
  for (const n of nodes) {
    if (n.t === 'rep') { if (!clozeOnly || n.filters.includes('cloze')) set.add(n.key); }
    else if (n.t === 'cond' || n.t === 'neg') { if (withConds && !isClozeCondKey(n.key)) set.add(n.key); referencedFields(n.children, clozeOnly, withConds, set); }
  }
  return set;
}
export const containsClozeReplacement = nodes => nodes.some(n => n.t === 'rep' && n.filters.includes('cloze'));
export const containsFieldReplacement = nodes => referencedFields(nodes, false, false).size > 0;
