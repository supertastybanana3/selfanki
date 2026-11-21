// Anki 25.09.4 rslib/src/scheduler/states/{fuzz,review,learning,relearning}.rs の間隔の決め方
const RANGES = [[2.5, 7.0, 0.15], [7.0, 20.0, 0.1], [20.0, Infinity, 0.05]];
const fr = Math.fround;
export function fuzzDelta(ivl) {
  if (ivl < 2.5) return 0;
  // rslib fuzz.rs fuzz_delta と同じく全部 f32 で（係数も f32 に丸めてから掛ける）
  return RANGES.reduce((d, [s, e, f]) => fr(d + fr(fr(f) * Math.max(0, fr(Math.min(ivl, e) - s)))), 1.0);
}
// 揺らぎ幅（負荷分散もこの幅の中から選ぶ）
export function fuzzBounds(interval, minimum, maximum) {
  minimum = Math.min(minimum, maximum);
  const x = fr(Math.min(Math.max(fr(interval), minimum), maximum));
  const d = fuzzDelta(x);
  let lo = Math.round(fr(x - d)), hi = Math.round(fr(x + d));
  lo = Math.min(Math.max(lo, minimum), maximum); hi = Math.min(Math.max(hi, minimum), maximum);
  if (hi === lo && hi > 2 && hi < maximum) hi = lo + 1;
  return [lo, hi];
}
const range = ([lo, hi]) => { const a = []; for (let i = lo; i <= hi; i++) a.push(i); return a; };
const union = sets => [...new Set(sets.flat())].sort((a, b) => a - b);
// 復習カード（type=1）で Hard/Good/Easy を押したときに取りうる間隔の集合
export function reviewPassingChoices(I, scheduledDays, maximum) {
  const gtl = x => (x > scheduledDays ? scheduledDays + 1 : 0);
  const hard = range(fuzzBounds(I[2], Math.max(gtl(Math.round(I[2])), 1), maximum));
  const good = union(hard.map(h => range(fuzzBounds(I[3], Math.max(gtl(Math.round(I[3])), h + 1), maximum))));
  const easy = union(good.map(g => range(fuzzBounds(I[4], Math.max(gtl(Math.round(I[4])), g + 1), maximum))));
  return { 2: hard, 3: good, 4: easy };
}
// 学習中・再学習中のカードが卒業するとき（type=0/2）に取りうる間隔の集合
export function graduateChoices(I, maximum) {
  const r = x => Math.max(1, Math.round(x));
  const hard = range(fuzzBounds(r(I[2]), 1, maximum));
  const good = range(fuzzBounds(r(I[3]), 1, maximum));
  const goodForEasy = range(fuzzBounds(I[3], 1, maximum));
  const easy = union(goodForEasy.map(g => range(fuzzBounds(r(I[4]), g + 1, maximum))));
  return { 2: hard, 3: good, 4: easy };
}
