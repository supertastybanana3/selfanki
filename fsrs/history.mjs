// カード情報の「復習の記録ごとの記憶の値」（Anki 25.09.4 rslib stats/card.rs の stats_revlog_entries_with_memory_state）を写したもの。
// rslib scheduler/fsrs/params.rs の reviews_for_fsrs（training=false）、memory_state.rs の fsrs_item_for_memory_state、
// fsrs-rs 5.1.0 の check_and_fill_parameters・memory_state_from_sm2・historical_memory_states・current_retrievability と同じ計算
import { DEFAULT_W, S_MIN } from './fsrs6.mjs';

const F = Math.fround;
export const FSRS5_DEFAULT_DECAY = 0.5;

// fsrs-rs check_and_fill_parameters（17・19 個の古い形を 21 個に。0 個は既定）
export function fillParams(p) {
  const w = (p || []).map(F);
  if (w.length === 0) return DEFAULT_W.map(F);
  if (w.length === 17) {
    const x = w.slice();
    x[4] = F(x[5] * 2 + x[4]);   // mul_add(2.0, w4)
    x[5] = F(F(Math.log(F(x[5] * 3 + 1))) / 3);   // mul_add は丸めが1回（fma）
    x[6] = F(x[6] + 0.5);
    return [...x, 0, 0, 0, FSRS5_DEFAULT_DECAY];
  }
  if (w.length === 19) return [...w, 0, FSRS5_DEFAULT_DECAY];
  if (w.length === 21) return w;
  return null;
}

// 記録（id 昇順）: { id(ms), button(ease 1..4・0), ivl, factor, time, type }
const isCramming = e => e.type === 3 && e.factor === 0;
const hasRating = e => e.button > 0;
const isReset = e => e.type === 4 && e.factor === 0;
const affectsScheduling = e => hasRating(e) && !isCramming(e);
const daysElapsed = (e, nextDayAt) => Math.max(0, Math.trunc((nextDayAt - Math.trunc(e.id / 1000)) / 86400));

export function reviewsForFsrs(entriesIn, nextDayAt, ignoreBeforeMs) {
  let entries = entriesIn.slice();
  let firstLearn = null, firstGrade = null, complete = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (isCramming(e)) continue;
    const within = e.id > ignoreBeforeMs, graded = hasRating(e), interday = e.ivl >= 1 || e.ivl <= -86400;
    if (graded && within && interday) firstGrade = i;
    if (graded && e.type === 0) { firstLearn = i; complete = true; }
    else if (isReset(e)) {
      if (firstLearn !== null) { complete = true; break; }
      else if (firstGrade !== null) { complete = false; break; }
      else return null;
    } else if (firstLearn !== null) break;
  }
  // 復習のとき: 最初の学習の段が「この日より前は無視」より前なら、それを使わず SM-2 の値と最初の評価から
  if (firstLearn !== null && entries[firstLearn].id < ignoreBeforeMs && firstLearn < entries.length - 1) { complete = false; firstLearn = null; }
  if (firstLearn !== null) { if (firstLearn > 0) entries = entries.slice(firstLearn); }
  else if (firstGrade !== null) { if (firstGrade > 0) entries = entries.slice(firstGrade); }
  else return null;
  entries = entries.filter(affectsScheduling);
  const dts = entries.map((e, i) => (i === 0 ? 0 : daysElapsed(entries[i - 1], nextDayAt) - daysElapsed(e, nextDayAt)));
  if (!entries.length) return null;
  return { reviews: entries.map((e, i) => ({ g: e.button, dt: dts[i] })), complete, filtered: entries };
}

export function memoryStateFromSm2(w, ease, ivl, ret) {
  const decay = F(-w[20]);
  const factor = F(F(Math.pow(F(0.9), F(1 / decay))) - 1);
  const s = F(F(F(Math.max(ivl, S_MIN)) * factor) / F(F(Math.pow(F(ret), F(1 / decay))) - 1));
  const d = F(11 - F(F(ease - 1) / F(F(F(Math.exp(w[8])) * F(Math.pow(s, F(-w[9])))) * F(Math.expm1(F(F(1 - F(ret)) * w[10]))))));
  if (!Number.isFinite(s) || !Number.isFinite(d)) return null;
  return { s, d: Math.min(10, Math.max(1, d)) };
}

// fsrs-rs 5.1.0 model.rs の step を、テンソルの演算の順のまま f32 で（1つずつ丸める）
const fexp = x => F(Math.exp(x)), fpow = (a, b) => F(Math.pow(a, b));
function model(w) {
  const decay = F(-w[20]);
  const factor = F(fexp(F(F(1 / decay) * F(Math.log(F(0.9))))) - 1);
  const pfc = (t, s) => fpow(F(F(F(F(t) / s) * factor) + 1), decay);
  const initDraw = g => F(F(w[4] - fexp(F(w[5] * F(g - 1)))) + 1);
  const clampS = x => Math.min(36500, Math.max(S_MIN, x)), clampD = x => Math.min(10, Math.max(1, x));
  function success(s, d, r, g) {
    let x = F(fexp(w[8]) * F(-d + 11));
    x = F(x * fpow(s, F(-w[9])));
    x = F(x * F(fexp(F(F(-r + 1) * w[10])) - 1));
    x = F(x * (g === 2 ? w[15] : 1)); x = F(x * (g === 4 ? w[16] : 1)); x = F(x + 1);
    return F(s * x);
  }
  function failure(s, d, r) {
    const ns = F(F(F(w[11] * fpow(d, F(-w[12]))) * F(fpow(F(s + 1), w[13]) - 1)) * fexp(F(F(-r + 1) * w[14])));
    const nmin = F(s / fexp(F(w[17] * w[18])));
    return nmin < ns ? nmin : ns;
  }
  function shortTerm(s, g) {
    const sinc = F(fexp(F(w[17] * F(F(g - 3) + w[18]))) * fpow(s, F(-w[19])));
    return F(s * (g >= 3 ? Math.max(sinc, 1) : sinc));
  }
  function nextD(d, g) {
    const delta = F(F(-w[6]) * F(g - 3));
    const nd = F(d + F(F(F(-d) + 10) * F(delta / 9)));
    return clampD(F(F(w[7] * F(initDraw(4) - nd)) + nd));
  }
  function step(st, g, dt) {
    if (!st) return { s: clampS(F(w[g - 1])), d: clampD(initDraw(g)) };
    const r = pfc(dt, st.s);
    let ns = g === 1 ? failure(st.s, st.d, r) : success(st.s, st.d, r, g);
    if (dt === 0) ns = shortTerm(st.s, g);
    return { s: clampS(ns), d: nextD(st.d, g) };
  }
  return { step };
}

// fsrs_item_for_memory_state → historical_memory_states。返すのは filtered（記録）と、その記録ごとの記憶の値
export function historicalStates(paramsRaw, entries, nextDayAt, historicalRetention, ignoreBeforeMs) {
  const w = fillParams(paramsRaw); if (!w) return null;
  const out = reviewsForFsrs(entries, nextDayAt, ignoreBeforeMs); if (!out) return null;
  const fs = model(w);
  let reviews = out.reviews, start = null;
  if (!out.complete) {
    const f = out.filtered[0]; if (!f) return null;
    const ease = F((f.factor === 0 ? 2500 : f.factor) / 1000);
    start = memoryStateFromSm2(w, ease, F(Math.max(f.ivl, 1)), historicalRetention);
    if (!start) return null;
    if (ease <= 1.1) start.d = F(F(F(ease - 0.1) * 9) + 1);   // FSRS が作った記録（ease が 1.1 以下）
    reviews = reviews.slice(1);
  }
  const states = []; if (start) states.push(start);
  let st = start;
  for (const r of reviews) { st = fs.step(st, r.g, r.dt); states.push(st); }
  return { filtered: out.filtered, states };
}

// fsrs-rs current_retrievability（decay は正の数で渡す）
export function retrievability(s, secondsElapsed, decay) {
  const factor = F(F(Math.pow(F(0.9), F(1 / F(-decay)))) - 1);
  const days = F(F(secondsElapsed) / 86400);
  return F(Math.pow(F(F(F(days / s) * factor) + 1), F(-decay)));
}
