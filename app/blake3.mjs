// BLAKE3（ハッシュ）。Anki のテンプレートの hint フィルターが、隠す欄の id を作るのに使う（rslib template_filters.rs の hint_filter）。
// 仕様（https://github.com/BLAKE3-team/BLAKE3-specs）どおりの小さな写し。出力は先頭 n バイト
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1, CHUNK_END = 2, PARENT = 4, ROOT = 8, BLOCK = 64, CHUNK = 1024;
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
function g(s, a, b, c, d, x, y) {
  s[a] = (s[a] + s[b] + x) | 0; s[d] = rotr(s[d] ^ s[a], 16); s[c] = (s[c] + s[d]) | 0; s[b] = rotr(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b] + y) | 0; s[d] = rotr(s[d] ^ s[a], 8); s[c] = (s[c] + s[d]) | 0; s[b] = rotr(s[b] ^ s[c], 7);
}
function compress(cv, m, counter, len, flags) {
  const s = [...cv, IV[0], IV[1], IV[2], IV[3], counter >>> 0, Math.floor(counter / 4294967296) >>> 0, len, flags];
  let w = m.slice();
  for (let r = 0; r < 7; r++) {
    g(s, 0, 4, 8, 12, w[0], w[1]); g(s, 1, 5, 9, 13, w[2], w[3]); g(s, 2, 6, 10, 14, w[4], w[5]); g(s, 3, 7, 11, 15, w[6], w[7]);
    g(s, 0, 5, 10, 15, w[8], w[9]); g(s, 1, 6, 11, 12, w[10], w[11]); g(s, 2, 7, 8, 13, w[12], w[13]); g(s, 3, 4, 9, 14, w[14], w[15]);
    if (r < 6) w = PERM.map(i => w[i]);
  }
  for (let i = 0; i < 8; i++) { s[i] ^= s[i + 8]; s[i + 8] ^= cv[i]; }
  return s.map(x => x >>> 0);
}
const words = (b, off, len) => { const w = new Array(16).fill(0); for (let i = 0; i < len; i++) w[i >> 2] |= b[off + i] << (8 * (i & 3)); return w.map(x => x >>> 0); };
// 1つの塊（1024 バイトまで）の、最後の圧縮の入力（根なら ROOT を足して出力にする）
function chunkOutput(bytes, off, len, counter) {
  let cv = IV.slice(); const nb = Math.max(1, Math.ceil(len / BLOCK));
  for (let i = 0; i < nb - 1; i++) cv = compress(cv, words(bytes, off + i * BLOCK, BLOCK), counter, BLOCK, i === 0 ? CHUNK_START : 0).slice(0, 8);
  const last = len - (nb - 1) * BLOCK;
  return { cv, m: words(bytes, off + (nb - 1) * BLOCK, last), counter, len: last, flags: (nb === 1 ? CHUNK_START : 0) | CHUNK_END };
}
const outCv = o => compress(o.cv, o.m, o.counter, o.len, o.flags).slice(0, 8);
const parentOut = (l, r) => ({ cv: IV.slice(), m: [...l, ...r], counter: 0, len: BLOCK, flags: PARENT });
export function blake3(bytes, n = 32) {
  const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK));
  const stack = []; let out = null;
  for (let i = 0; i < chunks; i++) {
    const o = chunkOutput(bytes, i * CHUNK, Math.min(CHUNK, bytes.length - i * CHUNK), i);
    if (i === chunks - 1) { out = o; break; }
    let cv = outCv(o), total = i + 1;
    while ((total & 1) === 0) { cv = outCv(parentOut(stack.pop(), cv)); total >>= 1; }
    stack.push(cv);
  }
  while (stack.length) out = parentOut(stack.pop(), outCv(out));
  const res = new Uint8Array(n);
  for (let blk = 0, k = 0; k < n; blk++) {
    const s = compress(out.cv, out.m, blk, out.len, out.flags | ROOT);
    for (let i = 0; i < 16 && k < n; i++) for (let j = 0; j < 4 && k < n; j++) res[k++] = (s[i] >>> (8 * j)) & 255;
  }
  return res;
}
export const blake3hex = (bytes, n = 32) => [...blake3(bytes, n)].map(b => b.toString(16).padStart(2, '0')).join('');
