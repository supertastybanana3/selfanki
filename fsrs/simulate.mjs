// FSRS のシミュレーター・負荷の見積もり・最適な保持率（Anki 25.09.4 のデッキのオプションの「シミュレーター」「保持率を下げると何倍の手間か」）を写したもの。
//   fsrs-rs 5.1.0 simulation.rs（simulate・WorkloadEstimator・expected_workload_with_existing_cards・optimal_retention の brent・extract_simulator_config）
//   rslib scheduler/fsrs/simulator.rs（apply_load_balance_and_easy_days・create_review_priority_fn）
//   simulate が使う priority-queue 2.5.0 の PriorityQueue（同じ優先度の並びまで同じにするため、ヒープの動きをそのまま写す）
// 浮動小数は Rust と同じく f32 に丸めて計算する。乱数は rand 0.9.2 の StdRng（rng.mjs）
import { StdRng, weightedIndexSample } from './rng.mjs';
import { fuzzBounds } from './schedule.mjs';
import { memoryStateFromSm2 } from './history.mjs';
import { clipParameters } from './optimize.mjs';

const F = Math.fround;
const S_MIN = F(0.001), S_MAX = 36500, D_MIN = 1, D_MAX = 10, R_MIN = F(0.7), R_MAX = F(0.95);
const MAX_STEPS = 5, LEARNING = 0, REVIEW = 1, RELEARNING = 2;
const FSRS5_DEFAULT_DECAY = 0.5;
const DEFAULT_PARAMS = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542].map(F);

// ---------- f32 の道具 ----------
const dv = new DataView(new ArrayBuffer(4));
const nextUp = x => { dv.setFloat32(0, x); const b = dv.getUint32(0); if (x === 0) return F(1.401298464324817e-45); dv.setUint32(0, x > 0 ? b + 1 : b - 1); return dv.getFloat32(0); };
const nextDown = x => -nextUp(-x);
// f32 の mul_add（a·b+c を1回だけ丸める）
export function fma32(a, b, c) {
  const p = a * b, s = p + c, bb = s - p, t = (p - (s - bb)) + (c - bb), r = F(s);
  if (t === 0 || r === s || !Number.isFinite(s)) return r;
  const d = s - r, other = d > 0 ? nextUp(r) : nextDown(r);
  if (Math.abs(other - s) === Math.abs(d)) return (t > 0) === (d > 0) ? other : r;   // ちょうど中間なら、捨てた端数の向きで決める
  return r;
}
const expf = x => F(Math.exp(x)), powf = (a, b) => F(Math.pow(a, b)), lnf = x => F(Math.log(x));
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const roundF = x => F(Math.sign(x) * Math.round(Math.abs(x)));   // Rust の round（0 から遠い方へ）
// Rust の f32 → usize / i32（0 に向けて切り捨て、範囲の外は端に。NaN は 0）
const toUsize = x => (Number.isNaN(x) || x <= 0 ? 0 : x >= 2 ** 53 ? 2 ** 53 : Math.trunc(x));
const toI32 = x => (Number.isNaN(x) ? 0 : x <= -2147483648 ? -2147483648 : x >= 2147483647 ? 2147483647 : Math.trunc(x));

export function fillParams(p) {
  const w = (p || []).map(F);
  if (w.length === 0) return DEFAULT_PARAMS.slice();
  if (w.length === 17) {
    const x = w.slice(); x[4] = fma32(x[5], 2, x[4]); x[5] = F(F(Math.log(fma32(x[5], 3, 1))) / 3); x[6] = F(x[6] + 0.5);
    return [...x, 0, 0, 0, FSRS5_DEFAULT_DECAY];
  }
  if (w.length === 19) return [...w, 0, FSRS5_DEFAULT_DECAY];
  if (w.length === 21) return w;
  throw new Error('InvalidParameters');
}

// ---------- 記憶のモデル（simulation.rs の関数。訓練用の model.rs とは平均回帰の形が少し違う） ----------
function stabilityAfterSuccess(w, s, r, d, g) {
  const hp = g === 2 ? w[15] : 1, eb = g === 4 ? w[16] : 1;
  let x = F(expf(w[8]) * F(11 - d)); x = F(x * powf(s, F(-w[9]))); x = F(x * F(expf(F(F(1 - r) * w[10])) - 1)); x = F(x * hp);
  return clamp(F(s * fma32(x, eb, 1)), S_MIN, S_MAX);
}
function stabilityAfterFailure(w, s, r, d) {
  const min = F(s / expf(F(w[17] * w[18])));
  let ns = F(F(F(w[11] * powf(d, F(-w[12]))) * F(powf(F(s + 1), w[13]) - 1)) * expf(F(F(1 - r) * w[14])));
  ns = Number.isNaN(ns) ? min : Math.min(ns, min);
  return clamp(ns, S_MIN, S_MAX);
}
function stabilityShortTerm(w, s, g) {
  const sinc = F(expf(F(w[17] * F(F(g - 3) + w[18]))) * powf(s, F(-w[19])));
  return clamp(F(s * (g >= 3 ? Math.max(sinc, 1) : sinc)), S_MIN, S_MAX);
}
const initD = (w, g) => F(F(w[4] - expf(F(w[5] * (g - 1)))) + 1);
function nextD(w, d, g) {
  const delta = F(F(-w[6]) * F(g - 3));
  const nd = F(d + F(F(F(10 - d) / 9) * delta));
  return clamp(F(F(w[7] * initD(w, 4)) + F(F(1 - w[7]) * nd)), D_MIN, D_MAX);
}
// 忘却曲線の係数は w ごとに1回だけ計算しておく（値は毎回計算するのと同じ）
let cw = null, cDecay = 0, cFactor = 0, cInv = 0;
function curve(w) { if (w !== cw) { cw = w; cDecay = F(-w[20]); cInv = F(1 / cDecay); cFactor = F(powf(F(0.9), cInv) - 1); } }
function pfc(w, t, s) { curve(w); return powf(fma32(F(t / s), cFactor, 1), cDecay); }
function nextInterval(w, s, dr) { curve(w); return F(F(s / cFactor) * F(powf(dr, cInv) - 1)); }

// WeightedIndex（作るのは1回、引くたびに乱数を1つ）
function weighted(weights) {
  const cum = []; let total = F(weights[0]);
  for (let i = 1; i < weights.length; i++) { cum.push(total); total = F(total + F(weights[i])); }
  let scale = total; const maxRand = F(1 - 2 ** -23);
  while (F(F(scale * maxRand) + 0) > total) scale = nextDown(scale);
  return rng => { const x = F(F(rng.unitF32() * scale) + 0); let n = 0; while (n < cum.length && cum[n] <= x) n++; return n; };
}
// rng.random_bool(p)（rand 0.9.2 Bernoulli: p·2^64 を u64 にして next_u64 と比べる。p=1 は乱数を使わない）
function randomBool(rng, p) {
  if (p === 1) return true;
  const hiP = Math.floor(p * 4294967296), loP = Math.floor((p * 4294967296 - hiP) * 4294967296);
  const lo = rng.nextU32(), hi = rng.nextU32();
  return hi < hiP || (hi === hiP && lo < loP);
}
const nextU64 = rng => { const lo = BigInt(rng.nextU32()), hi = BigInt(rng.nextU32()); return (hi << 32n) | lo; };

function memoryStateShortTerm(w, s, d, initRating, costs, transitions, stepCount, rng) {
  let consecutive = 0, rating = initRating ?? 1, cost = initRating == null ? 0 : costs[rating - 1], ns = s, nd = d;
  const cmax = rating > 2 ? Math.max(stepCount - 1, 0) : stepCount;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (consecutive >= cmax || rating >= 4) break;
    rating = weightedIndexSample(transitions[rating - 1], rng) + 1;
    ns = stabilityShortTerm(w, ns, rating); nd = nextD(w, nd, rating); cost = F(cost + costs[rating - 1]);
    if (rating > 2) consecutive++; else if (rating === 1) consecutive = 0;
  }
  return [clamp(ns, S_MIN, S_MAX), clamp(nd, D_MIN, D_MAX), cost];
}

// ---------- 既定の設定（SimulatorConfig::default） ----------
export function defaultConfig() {
  return {
    deckSize: 10000, learnSpan: 365, maxCostPerday: F(1800), maxIvl: F(36500),
    firstRatingProb: [0.24, 0.094, 0.495, 0.171].map(F), reviewRatingProb: [0.224, 0.631, 0.145].map(F),
    learnLimit: Infinity, reviewLimit: Infinity, newCardsIgnoreReviewLimit: true, suspendAfterLapses: null,
    postSchedulingFn: null, reviewPriorityFn: null,
    learningStepTransitions: [[0.3686, 0.0628, 0.5108, 0.0577], [0.0442, 0.4553, 0.4457, 0.0549], [0.0519, 0.047, 0.8462, 0.055]].map(r => r.map(F)),
    relearningStepTransitions: [[0.2157, 0.0643, 0.6595, 0.0604], [0.05, 0.4638, 0.4475, 0.0387], [0.1057, 0.1434, 0.7266, 0.0244]].map(r => r.map(F)),
    stateRatingCosts: [[19.58, 18.79, 13.78, 10.71], [19.38, 17.59, 12.38, 8.94], [16.44, 15.25, 12.32, 8.03]].map(r => r.map(F)),
    learningStepCount: 2, relearningStepCount: 1,
  };
}

// ---------- 優先度つきの並び（priority-queue 2.5.0。一番大きい優先度が先頭） ----------
// この PQ の部分は priority-queue 2.5.0（Copyright Gianmarco Garrisi）を写したもので、Mozilla Public License 2.0 に従う。
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed
// with this file, You can obtain one at https://mozilla.org/MPL/2.0/ （LICENSES/priority-queue-MPL-2.0.txt）
// 優先度は Reverse((期日 as i32, 新規か, 並びの値))。小さい組ほど先に出る。配列3本に持つ（組を作らない）
class PQ {
  constructor(n) { this.keys = []; this.p0 = []; this.p1 = []; this.p2 = []; this.where = new Int32Array(n).fill(-1); this.heap = []; this.qp = []; }
  // a が b より「大きい優先度」なら正（＝組が小さい）
  cmpIdx(i, j) { const p0 = this.p0, p1 = this.p1, p2 = this.p2; return p0[i] !== p0[j] ? p0[j] - p0[i] : p1[i] !== p1[j] ? p1[j] - p1[i] : p2[j] - p2[i]; }
  swap(a, b) { const ia = this.heap[a], ib = this.heap[b]; const t = this.qp[ia]; this.qp[ia] = this.qp[ib]; this.qp[ib] = t; this.heap[a] = ib; this.heap[b] = ia; }
  bubbleUp(position, mapPos) {
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (!(this.cmpIdx(this.heap[parent], mapPos) < 0)) break;
      const pi = this.heap[parent]; this.heap[position] = pi; this.qp[pi] = position; position = parent;
    }
    this.heap[position] = mapPos; this.qp[mapPos] = position;
    return position;
  }
  heapify(i) {
    const n = this.heap.length, h = this.heap; if (n <= 1) return;
    let l = 2 * i + 1, r = 2 * i + 2, largest = i, lp = h[i];
    if (l < n) { if (this.cmpIdx(h[l], lp) > 0) { largest = l; lp = h[l]; } if (r < n && this.cmpIdx(h[r], lp) > 0) largest = r; }
    while (largest !== i) {
      this.swap(i, largest); i = largest; lp = h[i]; l = 2 * i + 1;
      if (l < n) { if (this.cmpIdx(h[l], lp) > 0) { largest = l; lp = h[l]; } r = 2 * i + 2; if (r < n && this.cmpIdx(h[r], lp) > 0) largest = r; }
    }
  }
  set(idx, a, b, c) { this.p0[idx] = a; this.p1[idx] = b; this.p2[idx] = c; }
  push(key, a, b, c) { const i = this.keys.length; this.keys.push(key); this.set(i, a, b, c); this.where[key] = i; this.qp.push(i); this.heap.push(i); this.bubbleUp(i, i); }
  peek() { return this.heap.length ? this.keys[this.heap[0]] : undefined; }
  changePriority(key, a, b, c) { const idx = this.where[key]; if (idx < 0) return; this.set(idx, a, b, c); const pos = this.qp[idx]; this.heapify(this.bubbleUp(pos, this.heap[pos])); }
  pop() {
    const n = this.heap.length; if (!n) return;
    // Store::swap_remove(0)
    const head = this.heap[0]; this.heap[0] = this.heap[n - 1]; this.heap.pop(); const size = n - 1;
    if (0 < size) this.qp[this.heap[0]] = 0;
    this.qp[head] = this.qp[this.qp.length - 1]; this.qp.pop();
    if (head < size) this.heap[this.qp[head]] = head;
    // IndexMap::swap_remove_index(head)
    const key = this.keys[head]; this.where[key] = -1;
    const last = this.keys.length - 1, lastK = this.keys[last];
    if (head < last) { this.keys[head] = lastK; this.set(head, this.p0[last], this.p1[last], this.p2[last]); this.where[lastK] = head; }
    this.keys.pop(); this.p0.pop(); this.p1.pop(); this.p2.pop();
    if (n > 1) this.heapify(0);
    return key;
  }
}

// ---------- シミュレーター（simulation.rs simulate） ----------
const retentionOn = (w, c, date) => pfc(w, F(date - c.lastDate), c.stability);
export const defaultPriority = c => toI32(F(c.difficulty * 100));
export function simulate(config, params, desiredRetention, seed = 42, existingCards = null) {
  const w = fillParams(params), dr = F(desiredRetention);
  if (config.deckSize === 0) throw new Error('InvalidDeckSize');
  const span = config.learnSpan;
  const reviewCnt = new Array(span).fill(0), learnCnt = new Array(span).fill(0), memorized = new Float32Array(span), costPerDay = new Float32Array(span);
  const dueCnt = new Array(span + Math.floor(span / 2)).fill(0), correctCnt = new Array(span).fill(0), introducedCnt = new Array(span).fill(0);
  const firstDist = weighted(config.firstRatingProb), reviewDist = weighted(config.reviewRatingProb);
  const rng = new StdRng(BigInt(seed));
  const cards = [];
  if (existingCards && existingCards.length > config.deckSize) throw new Error('InvalidDeckSize');
  if (existingCards) {
    for (const c of existingCards) if (c.stability > F(1e-9)) cards.push({ ...c });
    let n = 0; for (const c of cards) if (c.lastDate !== -Infinity) n++;
    if (n) for (let i = 0; i < span; i++) introducedCnt[i] += n;
  }
  for (const c of cards) { const i = toUsize(c.due); if (i < dueCnt.length) dueCnt[i]++; }
  if (config.learnLimit > 0) {
    const n = config.deckSize - cards.length;
    for (let i = 0; i < n; i++) cards.push({ id: -i, difficulty: -Infinity, stability: -Infinity, lastDate: -Infinity, due: F(Math.floor(i / config.learnLimit)), interval: -Infinity, lapses: 0 });
  }
  const maxLapses = config.suspendAfterLapses ?? Infinity;
  const prio = config.reviewPriorityFn || defaultPriority;
  const pq = new PQ(cards.length);
  cards.forEach((c, i) => { const learn = c.lastDate === -Infinity; pq.push(i, toI32(c.due), learn ? 1 : 0, prio(c, w)); });
  for (;;) {
    const ci = pq.peek(); if (ci === undefined) break;
    const card = cards[ci];
    const day = toUsize(card.due), isLearn = card.lastDate === -Infinity, lastIdx = toUsize(card.lastDate);
    if (card.due >= span || card.lapses >= maxLapses) {
      if (!isLearn) {
        const dt = Math.max(span, lastIdx) - lastIdx;
        for (let i = lastIdx; i < Math.min(span, lastIdx + dt); i++) memorized[i] = F(memorized[i] + retentionOn(w, card, i));
      }
      pq.pop(); continue;
    }
    const tl = learnCnt[day], tr = reviewCnt[day];
    const over = isLearn ? (config.newCardsIgnoreReviewLimit ? tl + 1 > config.learnLimit : tl + tr + 1 > config.reviewLimit || tl + 1 > config.learnLimit) : tr + 1 > config.reviewLimit;
    if (over || costPerDay[day] > config.maxCostPerday) {
      if (!isLearn) { dueCnt[day]--; if (day + 1 < dueCnt.length) dueCnt[day + 1]++; }
      card.due = F(day + 1);
      pq.changePriority(ci, toI32(card.due), isLearn ? 1 : 0, prio(card, w));
      continue;
    }
    if (isLearn) {
      const g = firstDist(rng) + 1;
      const [ns, nd, cost] = memoryStateShortTerm(w, w[g - 1], clamp(initD(w, g), D_MIN, D_MAX), g, config.stateRatingCosts[LEARNING], config.learningStepTransitions, config.learningStepCount, rng);
      card.stability = ns; card.difficulty = nd;
      learnCnt[day]++; costPerDay[day] = F(costPerDay[day] + cost);
      for (let i = day; i < span; i++) introducedCnt[i]++;
    } else {
      const lastS = card.stability, r = retentionOn(w, card, card.due);
      const forget = !randomBool(rng, r);
      if (forget) card.lapses++; else correctCnt[day]++;
      const g = forget ? 1 : reviewDist(rng) + 2;
      let ns, nd, cost;
      if (forget) {
        const pls = stabilityAfterFailure(w, lastS, r, card.difficulty), pld = nextD(w, card.difficulty, g);
        let c; [ns, nd, c] = memoryStateShortTerm(w, pls, pld, null, config.stateRatingCosts[RELEARNING], config.relearningStepTransitions, config.relearningStepCount, rng);
        cost = F(config.stateRatingCosts[REVIEW][0] + c);
      } else { ns = stabilityAfterSuccess(w, lastS, r, card.difficulty, g); nd = nextD(w, card.difficulty, g); cost = config.stateRatingCosts[REVIEW][g - 1]; }
      reviewCnt[day]++; costPerDay[day] = F(costPerDay[day] + cost);
      for (let i = lastIdx; i < Math.min(day, span); i++) memorized[i] = F(memorized[i] + retentionOn(w, card, i));
      card.stability = ns; card.difficulty = nd;
    }
    let ivl = clamp(roundF(nextInterval(w, card.stability, dr)), 1, config.maxIvl);
    card.lastDate = F(day); card.interval = ivl; card.due = F(day + ivl);
    if (config.postSchedulingFn) { ivl = config.postSchedulingFn(card, config.maxIvl, day, dueCnt, rng); card.interval = ivl; card.due = F(day + ivl); }
    if (card.due < dueCnt.length) dueCnt[toUsize(card.due)]++;
    pq.changePriority(ci, toI32(card.due), 0, prio(card, w));
  }
  return { memorized: Array.from(memorized), reviewCnt, learnCnt, costPerDay: Array.from(costPerDay), correctCnt, introducedCnt, cards };
}

// ---------- 負荷分散と「楽な日」（rslib simulator.rs apply_load_balance_and_easy_days・load_balancer.rs） ----------
const easyDay = x => (x === 1 ? 'N' : x === 0 ? 'M' : 'R');
const LOAD = { M: F(0.0001), R: F(0.5), N: 1 };
export function parseEasyDays(p) { if (!p || !p.length) return Array(7).fill('N'); if (p.length !== 7) throw new Error('expected 7 days'); return p.map(x => easyDay(F(x))); }
export function easyDaysModifiers(easy, weekdays, counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  let totalPct = 0; for (const wd of weekdays) totalPct = F(totalPct + LOAD[easy[wd]]);
  return weekdays.map((wd, i) => {
    let k = easy[wd];
    if (k === 'R') { const other = F(total - counts[i]), otherPct = F(totalPct - 0.5), norm = F(counts[i] / 0.5); k = norm > F(other / otherPct) ? 'M' : 'N'; }
    return LOAD[k];
  });
}
function powi32(a, n) { let r = F(1), b = F(a), k = n; while (k) { if (k & 1) r = F(r * b); b = F(b * b); k >>= 1; } return r; }
export function selectWeightedInterval(intervals, seed) {
  const weights = intervals.map(x => (x.count === 0 ? 1 : F(F(F(powf(F(1 / x.count), F(2.15)) * powi32(F(1 / x.target), 3)) * x.sibling) * x.easy)));
  const k = weightedIndexSample(weights, new StdRng(seed));
  return k == null ? null : intervals[k].target;
}
const wdCache = new Map();
const weekday = secs => { let v = wdCache.get(secs); if (v === undefined) { v = (new Date(secs * 1000).getDay() + 6) % 7; if (wdCache.size > 100000) wdCache.clear(); wdCache.set(secs, v); } return v; };   // 月曜 = 0（端末の時間帯）
export function loadBalanceFn(nextDayAt, easy) {
  return (card, maxInterval, dayElapsed, dueCnt, rng) => {
    const [lower, upper] = fuzzBounds(card.interval, 1, Math.trunc(maxInterval));
    const counts = new Array(upper - lower + 1).fill(0);
    const start = dayElapsed + lower, end = Math.min(dayElapsed + upper + 1, dueCnt.length);
    if (start < dueCnt.length) { const n = Math.min(end - start, counts.length); for (let i = 0; i < n; i++) counts[i] = dueCnt[start + i]; }
    const ivls = []; for (let i = lower; i <= upper; i++) ivls.push(i);
    const base = nextDayAt + dayElapsed * 86400;
    const wds = ivls.map(i => weekday(base + (i - 1) * 86400));
    const mods = easyDaysModifiers(easy, wds, counts);
    const seed = nextU64(rng);
    const sel = selectWeightedInterval(ivls.map((t, i) => ({ target: t, count: counts[i], sibling: 1, easy: mods[i] })), seed);
    if (sel == null) throw new Error('load balance failed');
    return F(sel);
  };
}
// 復習の並び（rslib create_review_priority_fn）。「ランダム」は Anki でも毎回変わる。追加順は未対応（Anki も同じ）
export function reviewPriorityFn(order, deckSize) {
  switch (order) {
    case 5: return c => toI32(F(-F(c.difficulty * 100)));
    case 6: return c => toI32(F(c.difficulty * 100));
    case 3: return c => toI32(c.interval);
    case 4: return c => { const v = toI32(c.interval); return v === -2147483648 ? 2147483647 : -v; };
    case 7: return (c, w) => toI32(F(retentionOn(w, c, c.due) * 1000));
    case 11: return (c, w) => toI32(F(-F(retentionOn(w, c, c.due) * 1000)));
    case 0: case 1: case 2: return c => toI32(F(c.lastDate + c.interval));
    case 8: return () => Math.floor(Math.random() * deckSize);
    default: return null;
  }
}

// ---------- 記録から設定を作る（simulation.rs extract_simulator_config） ----------
function calcTransitions(seqs) {
  const counts = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  for (const s of seqs) { if (!s.length) continue; for (let i = 0; i < s.length - 1; i++) counts[s[i] - 1][s[i + 1] - 1] += 1; }
  for (const row of counts) for (let j = 0; j < 4; j++) row[j] = F(row[j] + 1);
  const m = counts.map(row => { let sum = 0; for (const x of row) sum = F(sum + x); return sum > 0 ? row.map(x => F(x / sum)) : row.map(() => F(0.25)); });
  return [m, counts];
}
// 記録: { id(ms), cid, ease(button), time(ms), type }（type 5＝再スケジュールは 4 と同じ扱い）
export function extractSimulatorConfig(revlogs, dayCutoff, smooth) {
  if (!revlogs.length) return defaultConfig();
  const kind = r => (r.type === 5 ? 4 : r.type);
  const costs = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], cnts = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const durSum = new Map(), durN = new Map();
  for (const r of revlogs) {
    if (r.time > 0 && r.time < 1200000) {
      const st = kind(r), g = r.ease - 1;
      if (st < 3 && g >= 0 && g < 4) { const k = st * 4 + g; durSum.set(k, ((durSum.get(k) || 0) + r.time) >>> 0); durN.set(k, (durN.get(k) || 0) + 1); cnts[st][g]++; }
    }
  }
  for (const [k, s] of durSum) costs[k >> 2][k & 3] = F(Math.floor(s / durN.get(k)) / 1000);
  // カード×日ごとにまとめる（並びは数えるだけなので結果に影響しない）
  const groups = new Map();
  for (const r of revlogs) {
    if (!(r.time > 0 && r.time < 1200000)) continue;
    const realDays = Math.trunc((Math.trunc(r.id / 1000) - dayCutoff) / 86400);
    const key = r.cid + ':' + realDays; let g = groups.get(key); if (!g) groups.set(key, g = []); g.push(r);
  }
  const df1 = [...groups.values()].map(es => ({ state: kind(es[0]) + 1, rating: es[0].ease, ratings: es.map(e => e.ease) }));
  const usage = new Map(); for (const r of df1) { const k = r.state * 16 + r.rating; usage.set(k, (usage.get(k) || 0) + 1); }
  let learn = [1, 2, 3, 4].map(i => usage.get(16 + i) || 0); if (learn.every(x => x === 0)) learn = [1, 1, 1, 1];
  let review = [1, 2, 3, 4].map(i => usage.get(32 + i) || 0); if (review.slice(1).every(x => x === 0)) review = [review[0], 1, 1, 1];
  const ls = learn.reduce((a, b) => a + b, 0), rs = review.slice(1).reduce((a, b) => a + b, 0);
  let firstRatingProb = learn.map(x => F(F(x) / F(ls))), reviewRatingProb = review.slice(1).map(x => F(F(x) / F(rs)));
  const [lm, lc] = calcTransitions(df1.filter(r => r.state === 1).map(r => r.ratings));
  const [rm, rc] = calcTransitions(df1.filter(r => r.state === 2 && r.rating === 1).map(r => r.ratings));
  let lt = lm.slice(0, 3), rt = rm.slice(0, 3);
  let stateRatingCosts = costs.map(r => r.map(F));
  if (smooth) {
    const d = defaultConfig(), lerp = (v0, v1, t) => F(F(t * v0) + F(F(1 - t) * v1));
    let wgt = F(F(ls) / F(50 + ls)); firstRatingProb = firstRatingProb.map((p, i) => lerp(p, d.firstRatingProb[i], wgt));
    wgt = F(F(rs) / F(50 + rs)); reviewRatingProb = reviewRatingProb.map((p, i) => lerp(p, d.reviewRatingProb[i], wgt));
    const sm = (mat, def, counts) => mat.map((row, i) => { let tot = 0; for (const x of counts[i]) tot = F(tot + x); const wt = F(tot / F(50 + tot)); return row.map((p, j) => lerp(p, def[i][j], wt)); });
    lt = sm(lt, d.learningStepTransitions, lc); rt = sm(rt, d.relearningStepTransitions, rc);
    stateRatingCosts = stateRatingCosts.map((row, i) => row.map((c, j) => { const n = cnts[i][j], wt = F(F(n) / F(50 + n)); return F(Math.round(F(lerp(c, d.stateRatingCosts[i][j], wt) * 100)) / 100); }));
  }
  return { ...defaultConfig(), firstRatingProb, reviewRatingProb, learningStepTransitions: lt, relearningStepTransitions: rt, stateRatingCosts };
}

// ---------- 手間の見積もり（simulation.rs WorkloadEstimator） ----------
class WorkloadEstimator {
  constructor(config) {
    const sMax = 365, shortStep = F(F(Math.log(2)) / 25), longStep = 5;
    const target = Math.min(F(longStep / F(1 - expf(-shortStep))), sMax), logTarget = lnf(target), lnMin = lnf(S_MIN);
    const small = []; for (let i = 0; ; i++) { const ls = F(lnMin + F(shortStep * i)); if (!(ls < logTarget)) break; small.push(expf(ls)); }
    this.sMidSize = small.length; this.sMid = small[small.length - 1];
    const large = []; for (let i = 1; ; i++) { const s = F(this.sMid + F(longStep * i)); if (!(s < sMax)) break; large.push(s); }
    this.sState = [...small, ...large]; this.sSize = this.sState.length;
    this.dSize = Math.ceil(F(F(F(D_MAX - D_MIN) / F(0.3)) + 1));
    this.dState = Array.from({ length: this.dSize }, (_, i) => F(D_MIN + F(F(F(D_MAX - D_MIN) * i) / (this.dSize - 1))));
    this.tSize = config.learnSpan; this.shortStep = shortStep; this.longStep = longStep; this.lnMin = lnMin;
    this.reviewRatingProb = config.reviewRatingProb; this.costs = config.stateRatingCosts; this.dr = F(0.9);
  }
  s2i(s) { const i = s <= this.sMid ? Math.ceil(F(F(lnf(s) - this.lnMin) / this.shortStep)) : this.sMidSize - 1 + Math.ceil(F(F(s - this.sMid) / this.longStep)); return Math.min(toUsize(i), this.sSize - 1); }
  d2i(d) { return Math.min(toUsize(Math.floor(F(F(F(d - D_MIN) / F(D_MAX - D_MIN)) * this.dSize))), this.dSize - 1); }
  precompute(dr, w) {
    this.dr = dr;
    const S = this.sSize, D = this.dSize, T = this.tSize;
    const probs = new Float32Array(4 * S), nsI = new Int32Array(4 * S * D), ndI = new Int32Array(4 * S * D), nIv = new Int32Array(4 * S * D);
    for (let si = 0; si < S; si++) {
      const s = this.sState[si], ivl = roundF(Math.max(nextInterval(w, s, dr), 1)), r = pfc(w, ivl, s);
      for (let g = 1; g <= 4; g++) probs[(g - 1) * S + si] = g === 1 ? F(1 - r) : F(r * this.reviewRatingProb[g - 2]);
      for (let di = 0; di < D; di++) {
        const d = this.dState[di];
        for (let g = 1; g <= 4; g++) {
          const ns = g === 1 ? stabilityAfterFailure(w, s, r, d) : stabilityAfterSuccess(w, s, r, d, g);
          const k = ((g - 1) * S + si) * D + di;
          nsI[k] = this.s2i(ns); ndI[k] = this.d2i(nextD(w, d, g)); nIv[k] = toUsize(roundF(Math.max(nextInterval(w, ns, dr), 1)));
        }
      }
    }
    // 表は [t][s][d] の並び（同じ t の層をまとめて読む）。値の計算の順は Rust と同じ
    const SD = S * D, T1 = T + 1, cm = new Float32Array(SD * T1), rc = this.costs[REVIEW];
    const nb = new Int32Array(4 * SD), iv = new Int32Array(4 * SD), pr = new Float32Array(4 * SD);
    for (let g = 0; g < 4; g++) for (let si = 0; si < S; si++) for (let di = 0; di < D; di++) {
      const k = (g * S + si) * D + di, o = g * SD + si * D + di;
      nb[o] = nsI[k] * D + ndI[k]; iv[o] = nIv[k]; pr[o] = probs[g * S + si];
    }
    const c0 = F(rc[0]), c1 = F(rc[1]), c2 = F(rc[2]), c3 = F(rc[3]);
    for (let t = T - 1; t >= 0; t--) {
      const row = t * SD;
      for (let sd = 0; sd < SD; sd++) {
        let nt = t + iv[sd]; if (nt > T) nt = T;
        let cur = F(F(c0 + cm[nt * SD + nb[sd]]) * pr[sd]);
        nt = t + iv[SD + sd]; if (nt > T) nt = T;
        cur = F(cur + F(F(c1 + cm[nt * SD + nb[SD + sd]]) * pr[SD + sd]));
        nt = t + iv[2 * SD + sd]; if (nt > T) nt = T;
        cur = F(cur + F(F(c2 + cm[nt * SD + nb[2 * SD + sd]]) * pr[2 * SD + sd]));
        nt = t + iv[3 * SD + sd]; if (nt > T) nt = T;
        cur = F(cur + F(F(c3 + cm[nt * SD + nb[3 * SD + sd]]) * pr[3 * SD + sd]));
        cm[row + sd] = cur;
      }
    }
    this.cm = cm; this.SD = SD;
  }
  at(si, di, t) { return this.cm[t * this.SD + si * this.dSize + di]; }
  newCardCost(w, firstProbs, due) {
    if (due > this.tSize) return 0;
    let total = 0;
    for (let g = 1; g <= 4; g++) {
      const s = w[g - 1], d = initD(w, g), ivl = toUsize(roundF(Math.max(nextInterval(w, s, this.dr), 1)));
      total = F(total + F(F(this.at(this.s2i(s), this.d2i(d), Math.min(due + ivl, this.tSize)) + this.costs[LEARNING][g - 1]) * firstProbs[g - 1]));
    }
    return total;
  }
  inFlightCost(card, w) {
    if (card.due > this.tSize) return 0;
    const realDue = Math.max(card.due, 0), r = pfc(w, F(realDue - card.lastDate), card.stability);
    const probs = [F(1 - r), ...this.reviewRatingProb.map(p => F(r * p))];
    let expected = 0;
    for (let g = 1; g <= 4; g++) {
      const p = probs[g - 1]; if (p <= 0) continue;
      const ns = g === 1 ? stabilityAfterFailure(w, card.stability, r, card.difficulty) : stabilityAfterSuccess(w, card.stability, r, card.difficulty, g);
      const nd = nextD(w, card.difficulty, g);
      const nDue = toUsize(realDue) + toUsize(roundF(Math.max(nextInterval(w, ns, this.dr), 1)));
      const future = nDue > this.tSize ? 0 : this.at(this.s2i(ns), this.d2i(nd), nDue);
      expected = F(expected + F(p * F(this.costs[REVIEW][g - 1] + future)));
    }
    return expected;
  }
}
export function expectedWorkloadWithExistingCards(params, desiredRetention, config, existing) {
  const w = fillParams(params), est = new WorkloadEstimator(config);
  est.precompute(F(desiredRetention), w);
  const cards = existing.slice();
  if (config.learnLimit > 0) { const n = config.deckSize - cards.length; for (let i = 0; i < n; i++) cards.push({ stability: -Infinity, due: F(Math.floor(i / config.learnLimit)) }); }
  let sum = 0;
  for (const c of cards) sum = F(sum + (c.stability > 1e-9 ? est.inFlightCost(c, w) : est.newCardCost(w, config.firstRatingProb, toUsize(c.due))));
  return sum;
}

// ---------- 最適な保持率（simulation.rs optimal_retention の brent と sample） ----------
const cmrrTarget = res => { let total = 0; for (const c of res.costPerDay) total = F(total + c); return F(total / res.memorized[res.memorized.length - 1]); };
export const cmrr = res => cmrrTarget(res);
// 1回の評価で回すシミュレーションの数（simulation.rs brent の sample_size）
export function sampleSize(span) {
  if (span <= 30) return 180;
  if (span < 365) { const factor = fma32(F(F(span) * F(span)), F(8.2e-7), F(F(F(span) * F(2.41e-3)) + F(1.3e-2))); return Math.round(F(16 / factor)); }
  return 16;
}
// n 回のシミュレーションの目的の値を、種の順に f32 で足して平均（sample）
export function averageTargets(values) { let sum = 0; for (const v of values) sum = F(sum + v); return F(sum / values.length); }
// brent の手順。評価してほしい保持率を yield し、その値を受け取る
function* brentSteps() {
  const mintol = F(1e-10), cg = F(0.381966), maxiter = 64, tol = F(0.01);
  const xb = R_MIN, fb = yield R_MIN;
  let x = xb, v = xb, wv = xb, fx = fb, fv = fb, fw = fb, a = R_MIN, b = R_MAX, deltax = 0, iter = 0, rat = 0, u;
  while (iter < maxiter) {
    const tol1 = fma32(tol, Math.abs(x), mintol), tol2 = F(2 * tol1), xmid = F(F(0.5) * F(a + b));
    if (Math.abs(F(x - xmid)) < fma32(F(0.5), F(-F(b - a)), tol2)) break;
    if (Math.abs(deltax) <= tol1) { deltax = F((x >= xmid ? a : b) - x); rat = F(cg * deltax); }
    else {
      const tmp1 = F(F(x - wv) * F(fx - fv));
      let tmp2 = F(F(x - v) * F(fx - fw));
      let p = fma32(F(x - v), tmp2, F(-F(F(x - wv) * tmp1)));
      tmp2 = F(2 * F(tmp2 - tmp1));
      if (tmp2 > 0) p = -p;
      tmp2 = Math.abs(tmp2);
      const dtmp = deltax; deltax = rat;
      if (p > F(tmp2 * F(a - x)) && p < F(tmp2 * F(b - x)) && Math.abs(p) < Math.abs(F(F(F(0.5) * tmp2) * dtmp))) {
        rat = F(p / tmp2); u = F(x + rat);
        if (F(u - a) < tol2 || F(b - u) < tol2) rat = F(xmid - x) >= 0 ? tol1 : -tol1;
      } else { deltax = F((x >= xmid ? a : b) - x); rat = F(cg * deltax); }
    }
    u = F(x + (Math.abs(rat) < tol1 ? F(tol1 * (rat >= 0 ? 1 : -1)) : rat));
    const fu = yield u;
    if (fu > fx) {
      if (u < x) a = u; else b = u;
      if (fu <= fw || wv === x) { v = wv; wv = u; fv = fw; fw = fu; }
      else if (fu <= fv || v === x || v === wv) { v = u; fv = fu; }
    } else {
      if (u >= x) a = x; else b = x;
      v = wv; wv = x; x = u; fv = fw; fw = fx; fx = fu;
    }
    iter++;
  }
  if (iter < maxiter && x >= R_MIN && x <= R_MAX) return x;
  throw new Error('OptimalNotFound');
}
// evalAt(保持率) → その保持率の sample の値（同期でも Promise でもよい）
export async function optimalRetentionAsync(evalAt) {
  const g = brentSteps(); let r = g.next();
  while (!r.done) r = g.next(await evalAt(r.value));
  return r.value;
}
export function optimalRetention(config, paramsRaw, cards, progress) {
  const params = fillParams(paramsRaw), n = sampleSize(config.learnSpan);
  const g = brentSteps(); let r = g.next();
  while (!r.done) {
    if (progress && !progress()) throw new Error('Interrupted');
    const vals = []; for (let i = 0; i < n; i++) vals.push(cmrrTarget(simulate(config, params, r.value, i + 42, cards)));
    r = g.next(averageTargets(vals));
  }
  return r.value;
}

// ---------- 画面の頼み（SimulateFsrsReviewRequest）から設定とカードを作る（rslib simulator.rs simulate_request_to_config） ----------
// cards: 検索に合ったカード（アプリの形: id・queue・type・due・ivl・factor・lapses・inDyn・dynDue）
// mems: カード番号 → [s, d]（カードに無いものは呼ぶ側で計算して入れておく。Anki はここで計算して保存するが、こちらは保存しない）
// revlogs: 検索に合ったカードの記録（カード順・id 順）、introducedToday: 「検索 introduced:1」の枚数
const isIncluded = c => c.queue !== -1 && c.queue !== 4 && c.type !== 0;
export function convertCard(c, daysElapsed, ms) {
  if (c.queue === 3 || c.queue === 2) {
    const due = c.inDyn ? (c.due || c.dynDue || 0) : c.due, rel = due - daysElapsed;
    return { id: c.id, difficulty: F(ms.d), stability: F(ms.s), lastDate: F(Math.min(rel - c.ivl, 0)), due: F(rel), interval: F(c.ivl), lapses: c.lapses };
  }
  if (c.queue === 1 || c.queue === -2 || c.queue === -3) return { id: c.id, difficulty: F(ms.d), stability: F(ms.s), lastDate: 0, due: 0, interval: F(c.ivl), lapses: c.lapses };
  return null;
}
const memOf = (mems, c) => { const m = mems[c.id]; return m ? { s: m[0], d: m[1] } : null; };
const sm2State = (params, ease, ivl, ret) => { try { return memoryStateFromSm2(clipParameters(fillParams(params), 1, false), ease, ivl, ret); } catch { return null; } };
// extracted: 記録から作った設定（extractSimulatorConfig の結果）。渡されなければ revlogs から作る（Worker に記録を全部送らなくてよいように）
export function requestToConfig({ req, cards, revlogs, extracted, daysElapsed, nextDayAt, introducedToday, loadBalancer, mems }) {
  let newCards = req.deckSize; for (const c of cards) if (c.type === 0 && c.queue !== -1) newCards++;
  const converted = [];
  for (const c of cards) {
    if (!isIncluded(c)) continue;
    const ms = memOf(mems, c) || sm2State(req.params, F(c.factor / 1000), F(c.ivl), F(req.historicalRetention));
    if (!ms) continue;
    const x = convertCard(c, daysElapsed, ms); if (x) converted.push(x);
  }
  const intro = Math.min(introducedToday, req.newLimit);
  if (req.newLimit > 0) for (let i = 0; i < newCards; i++) converted.push({ id: -i, difficulty: -Infinity, stability: F(1e-8), lastDate: -Infinity, due: F(Math.floor((intro + i) / req.newLimit)), interval: -Infinity, lapses: 0 });
  const p = extracted || extractSimulatorConfig(revlogs, nextDayAt, true);
  const easy = parseEasyDays(req.easyDaysPercentages);
  const config = {
    ...p, deckSize: converted.length, learnSpan: req.daysToSimulate, maxCostPerday: 3.4028234663852886e38, maxIvl: F(req.maxInterval),
    learnLimit: req.newLimit, reviewLimit: req.reviewLimit, newCardsIgnoreReviewLimit: !!req.newCardsIgnoreReviewLimit,
    suspendAfterLapses: req.suspendAfterLapseCount ?? null,
    postSchedulingFn: loadBalancer ? loadBalanceFn(nextDayAt, easy) : null,
    reviewPriorityFn: reviewPriorityFn(req.reviewOrder || 0, converted.length),
    learningStepCount: req.learningStepCount, relearningStepCount: req.relearningStepCount,
  };
  return { config, cards: converted };
}
// rslib simulate_review・simulate_workload・compute_optimal_retention
export function simulateReview(req, ctx) {
  const { config, cards } = requestToConfig({ req, ...ctx });
  const r = simulate(config, req.params, req.desiredRetention, 42, cards);
  return { memorized: r.memorized, reviewCount: r.reviewCnt, newCount: r.learnCnt, cost: r.costPerDay };
}
export function simulateWorkload(req, ctx, onProgress, shouldAbort) {
  const { config, cards } = requestToConfig({ req, ...ctx });
  const out = { cost: {}, memorized: {}, reviewCount: {} };
  for (let dr = 70; dr <= 99; dr++) {
    if (shouldAbort && shouldAbort()) throw new Error('Interrupted');
    const r = simulate(config, req.params, F(dr / 100), 42, cards);
    let cost = 0; for (const c of r.costPerDay) cost = F(cost + c);
    out.memorized[dr] = r.memorized[r.memorized.length - 1] ?? 0; out.cost[dr] = cost;
    out.reviewCount[dr] = (r.reviewCnt.reduce((a, b) => a + b, 0) + r.learnCnt.reduce((a, b) => a + b, 0)) >>> 0;
    if (onProgress) onProgress(dr - 69, 30);
  }
  return out;
}
export function computeOptimalRetention(req, ctx, onProgress, shouldAbort) {
  if (!req.daysToSimulate) throw new Error('no days to simulate');
  const { config, cards } = requestToConfig({ req, ...ctx });
  let n = 0;
  const v = optimalRetention(config, req.params, cards, () => { n++; if (onProgress) onProgress(n, 0); return !(shouldAbort && shouldAbort()); });
  return Math.min(0.95, Math.max(0.7, v));
}
// rslib get_retention_workload（記憶の値のあるカードだけ。デッキの大きさは検索に合った全部）
export function workloadSetup({ cards, revlogs, extracted, daysElapsed, nextDayAt, mems }) {
  const config = { ...(extracted || extractSimulatorConfig(revlogs, nextDayAt, true)) };
  const fc = [];
  for (const c of cards) { if (!isIncluded(c)) continue; const ms = memOf(mems, c); if (!ms) continue; const x = convertCard(c, daysElapsed, ms); if (x) fc.push(x); }
  config.deckSize = cards.length;
  return { config, cards: fc };
}
export function retentionWorkload(params, ctx, onProgress, shouldAbort) {
  const { config, cards: fc } = workloadSetup(ctx);
  const costs = {};
  for (let dr = 70; dr <= 99; dr++) {
    if (shouldAbort && shouldAbort()) throw new Error('Interrupted');
    costs[dr] = expectedWorkloadWithExistingCards(params, F(dr / 100), config, fc);
    if (onProgress) onProgress(dr - 69, 30);
  }
  return costs;
}
