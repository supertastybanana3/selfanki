// Anki 25.09.4（rslib）が揺らぎと負荷分散に使う乱数を、そのまま写したもの。
//   rand 0.9.2 の StdRng ＝ rand_chacha 0.9.0 の ChaCha12（カウンタ64ビット・ストリーム0。4ブロックずつまとめて作り、32ビットずつ順に使う）
//   種は rand_core 0.9.3 の SeedableRng::seed_from_u64（PCG32 で 32 バイトの鍵に広げる）
//   範囲の取り方は rand 0.9.2 の UniformFloat::sample_single・UniformInt::sample_single（"unbiased" なし）・WeightedIndex
// Rust の本物の rand 0.9.2 と突き合わせて、出てくる数が一致することを確かめてある
const fr = Math.fround;
const M64 = (1n << 64n) - 1n;

// 64 ビットの掛け算を 32 ビットずつで（BigInt を使わない。下位 64 ビットだけ）
function mul64(aHi, aLo, bHi, bLo) {
  const a0 = aLo & 0xffff, a1 = aLo >>> 16, b0 = bLo & 0xffff, b1 = bLo >>> 16;
  const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  const lo = ((mid & 0xffff) << 16 | (p00 & 0xffff)) >>> 0;
  const hi = (p11 + (p01 >>> 16) + (p10 >>> 16) + Math.floor(mid / 65536) + Math.imul(aLo, bHi) + Math.imul(aHi, bLo)) >>> 0;
  return [hi, lo];
}
function add64(aHi, aLo, bHi, bLo) { const lo = aLo + bLo; return [(aHi + bHi + (lo > 0xffffffff ? 1 : 0)) >>> 0, lo >>> 0]; }
function keyFromU64(seed) {
  const s = BigInt.asUintN(64, BigInt(seed));
  let hi = Number(s >> 32n), lo = Number(s & 0xffffffffn);
  const MH = 0x5851f42d, ML = 0x4c957f2d, IH = 0xa17654e4, IL = 0x6fbe17f3;   // 6364136223846793005, 11634580027462260723
  const key = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    [hi, lo] = mul64(hi, lo, MH, ML); [hi, lo] = add64(hi, lo, IH, IL);
    // x = ((st >> 18) ^ st) >> 27 の下位 32 ビット、rot = st >> 59
    const s18h = hi >>> 18, s18l = ((hi << 14) | (lo >>> 18)) >>> 0;
    const xh = (s18h ^ hi) >>> 0, xl = (s18l ^ lo) >>> 0;
    const x = ((xh << 5) | (xl >>> 27)) >>> 0, rot = hi >>> 27;
    key[i] = ((x >>> rot) | (x << ((32 - rot) & 31))) >>> 0;
  }
  return key;
}
const rotl = (v, n) => ((v << n) | (v >>> (32 - n))) >>> 0;
function qr(x, a, b, c, d) {
  x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 12);
  x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 8);
  x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 7);
}
const BS = new Uint32Array(16), BX = new Uint32Array(16);
function block(key, ctr, out, off) {
  const s = BS;
  s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
  s.set(key, 4); s[12] = ctr % 4294967296; s[13] = Math.floor(ctr / 4294967296); s[14] = 0; s[15] = 0;
  const x = BX; x.set(s);
  for (let r = 0; r < 6; r++) { // ChaCha12 = 6 回の二重ラウンド
    qr(x, 0, 4, 8, 12); qr(x, 1, 5, 9, 13); qr(x, 2, 6, 10, 14); qr(x, 3, 7, 11, 15);
    qr(x, 0, 5, 10, 15); qr(x, 1, 6, 11, 12); qr(x, 2, 7, 8, 13); qr(x, 3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) out[off + i] = (x[i] + s[i]) >>> 0;
}
// f32 を1目盛り小さくする（UniformFloat::new_bounded の decrease_masked）
const f32buf = new DataView(new ArrayBuffer(4));
function f32Down(v) { f32buf.setFloat32(0, v); const b = f32buf.getUint32(0); f32buf.setUint32(0, v > 0 ? b - 1 : v < 0 ? b + 1 : 0x80000001); return f32buf.getFloat32(0); }

export class StdRng {
  // 4 ブロック（64 語）ずつ使うが、作るのは使うところまで（中身は 4 つまとめて作るのと同じ）
  constructor(seed) { this.key = keyFromU64(seed); this.ctr = 0; this.base = 0; this.have = 4; this.buf = new Uint32Array(64); this.idx = 64; }
  nextU32() {
    if (this.idx >= 64) { this.base = this.ctr; this.ctr += 4; this.idx = 0; this.have = 0; }
    if (this.idx >= this.have * 16) { block(this.key, this.base + this.have, this.buf, this.have * 16); this.have++; }
    return this.buf[this.idx++];
  }
  // [0,1) の f32（value0_1 = (u32 >> 9) / 2^23）
  unitF32() { return (this.nextU32() >>> 9) / 8388608; }
  // random_range(low..high) の f32（UniformFloat::sample_single → sample_single_inclusive）
  rangeF32(low, high) { const scale = fr(fr(high) - fr(low)); return fr(fr(this.unitF32() * scale) + fr(low)); }
  // random_range(low..high) の u32（UniformInt::sample_single。偏りを1回だけ直す方式）
  rangeU32(low, high) {
    const range = (high - low) >>> 0;
    if (range === 0) return this.nextU32();
    const m = BigInt(this.nextU32()) * BigInt(range);
    let result = Number(m >> 32n); const lo = Number(m & 0xffffffffn);
    if (lo > 2 ** 32 - range) {
      const hi2 = Number((BigInt(this.nextU32()) * BigInt(range)) >> 32n);
      if (lo + hi2 > 0xffffffff) result += 1;
    }
    return (low + result) >>> 0;
  }
}
// WeightedIndex::new(weights).sample(rng)（f32 の重み）。重みが全部0なら null
export function weightedIndexSample(weights, rng) {
  if (!weights.length) return null;
  const cum = []; let total = fr(weights[0]);
  for (let i = 1; i < weights.length; i++) { cum.push(total); total = fr(total + fr(weights[i])); }
  if (!(total > 0)) return null;
  let scale = total; const maxRand = fr(1 - 2 ** -23);
  while (fr(fr(scale * maxRand) + 0) > total) scale = f32Down(scale);
  const chosen = fr(fr(rng.unitF32() * scale) + 0);
  let n = 0; while (n < cum.length && cum[n] <= chosen) n++;
  return n;
}
// 揺らぎの種（rslib answering/mod.rs get_fuzz_seed_for_id_and_reps）＝カード番号＋回数
export const fuzzSeed = (cardId, reps) => BigInt.asUintN(64, BigInt(cardId) + BigInt(reps >>> 0));
// 揺らぎの係数（get_fuzz_factor）＝StdRng::seed_from_u64(種).random_range(0.0..1.0) の f32
export const fuzzFactor = (cardId, reps) => new StdRng(fuzzSeed(cardId, reps)).rangeF32(0, 1);
