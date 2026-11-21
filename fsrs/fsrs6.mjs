// FSRS-6 の計算（Anki が使う fsrs-rs の式をそのまま書いたもの）
export const DEFAULT_W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
export const S_MIN = 0.001, S_MAX = 36500;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function makeFsrs(w, f32 = false) {
  const F = f32 ? Math.fround : (x => x);
  const decay = -w[20];
  const factor = F(Math.pow(0.9, 1 / decay) - 1);
  const initD = g => F(w[4] - Math.exp(w[5] * (g - 1)) + 1);
  const retr = (t, s) => F(Math.pow(F(1 + F(factor * t / s)), decay));
  function init(g) { return { s: clamp(F(w[g - 1]), S_MIN, S_MAX), d: clamp(initD(g), 1, 10) }; }
  function nextD(d, g) {
    const delta = F(-w[6] * (g - 3));
    const nd = F(d + F(F((10 - d) / 9) * delta));
    return clamp(F(F(w[7] * F(initD(4) - nd)) + nd), 1, 10);
  }
  function step(st, g, dt) {
    let s;
    if (dt === 0) {
      let sinc = F(Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(st.s, -w[19]));
      if (g >= 3) sinc = Math.max(sinc, 1);
      s = F(st.s * sinc);
    } else {
      const r = retr(dt, st.s);
      if (g === 1) {
        const sf = F(w[11] * Math.pow(st.d, -w[12]) * F(Math.pow(st.s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]));
        s = Math.min(sf, F(st.s / Math.exp(w[17] * w[18])));
      } else {
        const hard = g === 2 ? w[15] : 1, easy = g === 4 ? w[16] : 1;
        s = F(st.s * F(1 + F(Math.exp(w[8]) * (11 - st.d) * Math.pow(st.s, -w[9]) * F(Math.exp((1 - r) * w[10]) - 1) * hard * easy)));
      }
    }
    return { s: clamp(s, S_MIN, S_MAX), d: nextD(st.d, g) };
  }
  function fromSm2(ease, ivl, ret) {
    const s = F(Math.max(ivl, S_MIN) * factor / F(Math.pow(ret, 1 / decay) - 1));
    const d = F(11 - (ease - 1) / F(Math.exp(w[8]) * Math.pow(s, -w[9]) * Math.expm1((1 - ret) * w[10])));
    return { s, d: clamp(d, 1, 10) };
  }
  // reviews: [{g, dt}]。start があればその状態から続ける
  function memoryState(reviews, start = null) {
    let st = start;
    for (const { g, dt } of reviews) st = st ? step(st, g, dt) : init(g);
    return st;
  }
  const interval = (s, dr) => s / factor * (Math.pow(dr, 1 / decay) - 1);
  return { init, step, nextD, fromSm2, memoryState, retr, interval, decay, factor };
}

// Anki の revlog から FSRS に渡す並びを作る（rslib の reviews_for_fsrs と同じ規則）
// revs: [id(ms), ease, ivl, lastIvl, factor, time, type]
export function revlogToItem(revs, nextDayAtSecs, ignoreBeforeMs = 0) {
  const E = revs.map(r => ({ id: r[0], ease: r[1], ivl: r[2], factor: r[4], type: r[6] }));
  let firstLearn = null, firstGrade = null, complete = false;
  for (let i = E.length - 1; i >= 0; i--) {
    const e = E[i];
    if (e.type === 3 && e.factor === 0) continue;               // 再スケジュールなしのフィルター復習
    const within = e.id > ignoreBeforeMs;
    const graded = e.ease >= 1 && e.ease <= 4;
    const interday = e.ivl >= 1 || e.ivl <= -86400;
    if (graded && within && interday) firstGrade = i;
    if (graded && e.type === 0) { firstLearn = i; complete = true; }
    else if (firstLearn !== null) break;
    else if ((e.type === 4 || e.ease === 0) && e.factor === 0) { // リセット
      if (firstLearn !== null) { complete = true; break; }
      else if (firstGrade !== null) { complete = false; break; }
      else return null;
    }
  }
  if (firstLearn !== null && E[firstLearn].id < ignoreBeforeMs) complete = false;
  const first = complete ? firstLearn : firstGrade;
  if (first === null) return null;
  const kept = E.slice(first).filter(e => !((e.type === 4 || e.ease === 0) || (e.type === 3 && e.factor === 0) || e.type === 5));
  const daysElapsed = e => Math.max(0, Math.floor((nextDayAtSecs - Math.floor(e.id / 1000)) / 86400));
  const reviews = kept.map((e, i) => ({ g: e.ease, dt: i === 0 ? 0 : Math.max(0, daysElapsed(kept[i - 1]) - daysElapsed(e)) }));
  return { reviews, complete, kept };
}

export function cardMemoryState(fsrs, revs, nextDayAtSecs, sm2Retention = 0.9, ignoreBeforeMs = 0) {
  const it = revlogToItem(revs, nextDayAtSecs, ignoreBeforeMs);
  if (!it || it.reviews.length === 0) return null;
  if (it.complete) return fsrs.memoryState(it.reviews);
  const f = it.kept[0];
  const start = fsrs.fromSm2((f.factor === 0 ? 2500 : f.factor) / 1000, Math.max(f.ivl, 1), sm2Retention);
  return fsrs.memoryState(it.reviews.slice(1), start);
}
