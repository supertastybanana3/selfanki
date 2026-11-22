// FSRS のパラメータの最適化と評価（Anki 25.09.4 の「最適化」「評価」）を写したもの。
//   rslib scheduler/fsrs/params.rs の compute_params・fsrs_items_for_training・reviews_for_fsrs（training=true）・evaluate_params_legacy
//   fsrs-rs 5.1.0 の compute_parameters（dataset.rs・parameter_initialization.rs・training.rs・batch_shuffle.rs・cosine_annealing.rs・
//   parameter_clipper.rs）と evaluate（inference.rs）
// 学習は burn（自動微分）の代わりに、モデルの式を手で微分して前向きに勾配を運ぶ。Adam・学習率・バッチの並び・乱数は Rust と同じ。
// 浮動小数は、状態と最適化（Adam）は f32 に丸め、勾配の計算は f64（Rust は全部 f32 なので、最後の数桁はずれる）
import { StdRng } from './rng.mjs';

const F = Math.fround;
export const DEFAULT_PARAMS = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542].map(F);
const PARAMS_STDDEV = [6.43, 9.66, 17.58, 27.85, 0.57, 0.28, 0.6, 0.12, 0.39, 0.18, 0.33, 0.3, 0.09, 0.16, 0.57, 0.25, 1.03, 0.31, 0.32, 0.14, 0.27].map(F);
const S_MIN = F(0.001), S_MAX = 36500, D_MIN = 1, D_MAX = 10, INIT_S_MAX = 100;
const FSRS5_DEFAULT_DECAY = 0.5;
const CFG = { epochs: 5, batchSize: 512, seed: 2023, lr: 4e-2, maxSeqLen: 64, gamma: 1.0 };

// ---------- 記録から学習用の項目へ（rslib params.rs） ----------
// 記録: { id(ms), cid, ease(=button_chosen), ivl, factor, type(0 学習 1 復習 2 再学習 3 フィルター 4 手動 5 再スケジュール) }
const isCramming = e => e.type === 3 && e.factor === 0;
const hasRating = e => e.ease > 0;
const isReset = e => e.type === 4 && e.factor === 0;
const affectsScheduling = e => hasRating(e) && !isCramming(e);
const daysElapsed = (e, nextDayAt) => Math.max(0, Math.trunc((nextDayAt - Math.trunc(e.id / 1000)) / 86400));

export function reviewsForFsrs(entriesIn, nextDayAt, training, ignoreBeforeMs) {
  let entries = entriesIn;
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
  if (training) {
    if (firstLearn !== null && entries[firstLearn].id < ignoreBeforeMs) return null;
  } else if (firstLearn !== null && entries[firstLearn].id < ignoreBeforeMs && firstLearn < entries.length - 1) { complete = false; firstLearn = null; }
  if (firstLearn !== null) { if (firstLearn > 0) entries = entries.slice(firstLearn); }
  else if (training) return null;
  else if (firstGrade !== null) { if (firstGrade > 0) entries = entries.slice(firstGrade); }
  else return null;
  entries = entries.filter(affectsScheduling);
  const dts = entries.map((e, i) => (i === 0 ? 0 : daysElapsed(entries[i - 1], nextDayAt) - daysElapsed(e, nextDayAt)));
  const skip = training ? 1 : 0, items = [];
  for (let k = skip; k < entries.length; k++) {
    const reviews = [];
    for (let j = 0; j <= k; j++) reviews.push({ g: entries[j].ease, dt: dts[j] });
    if (training && !(reviews[reviews.length - 1].dt > 0)) continue;
    items.push({ id: entries[k].id, reviews });
  }
  if (!items.length) return null;
  return { items, complete, filtered: entries };
}

// 記録はカードの番号の順（同じカードの中は id の順）で渡す。返す項目は記録の id の順
export function itemsForTraining(revlogs, nextDayAt, ignoreBeforeMs) {
  const all = []; let reviewCount = 0;
  for (let i = 0; i < revlogs.length;) {
    let j = i; while (j < revlogs.length && revlogs[j].cid === revlogs[i].cid) j++;
    const r = reviewsForFsrs(revlogs.slice(i, j), nextDayAt, true, ignoreBeforeMs);
    if (r) { reviewCount += r.filtered.length; for (const it of r.items) all.push(it); }
    i = j;
  }
  all.sort((a, b) => a.id - b.id);   // Rust の sort_by_key は安定
  return { items: all.map(x => ({ reviews: x.reviews })), reviewCount };
}

// ---------- 項目の扱い（dataset.rs） ----------
const longTermCnt = it => { let n = 0; for (const r of it.reviews) if (r.dt > 0) n++; return n; };
const firstLongTerm = it => it.reviews.find(r => r.dt > 0);
const current = it => it.reviews[it.reviews.length - 1];

function filterOutlier(init, trainset) {
  const groups = new Map();
  for (const it of init) {
    const r = it.reviews[0].g, dt = current(it).dt;
    if (!groups.has(r)) groups.set(r, new Map());
    const g = groups.get(r); if (!g.has(dt)) g.set(dt, []); g.get(dt).push(it);
  }
  const filtered = [], removed = [new Set(), new Set(), new Set(), new Set(), new Set()];
  for (const rating of [...groups.keys()].sort((a, b) => a - b)) {
    const subs = [...groups.get(rating).entries()];
    subs.sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
    const total = subs.reduce((s, x) => s + x[1].length, 0);
    let removedN = 0;
    for (let k = subs.length - 1; k >= 0; k--) {
      const [dt, sub] = subs[k];
      if (removedN + sub.length >= Math.max(20, Math.floor(total / 20))) {
        if (sub.length >= 6 && dt <= (rating !== 4 ? 100 : 365)) filtered.push(...sub);
        else removed[rating].add(dt);
      } else { removedN += sub.length; removed[rating].add(dt); }
    }
  }
  const train = trainset.filter(it => !removed[it.reviews[0].g].has(firstLongTerm(it).dt));
  return { init: filtered, train };
}
export function prepareTrainingData(items) {
  const init = items.filter(it => longTermCnt(it) === 1);
  return filterOutlier(init, items);
}
export function averageRecall(items) {
  if (!items.length) return 0;
  let ok = 0; for (const it of items) if (current(it).g > 1) ok++;
  return F(F(ok) / F(items.length));
}
function recencyWeighted(items) {
  const length = F(Math.max(F(items.length - 1), 1));
  return items.map((item, idx) => { const x = F(F(idx) / length); return { weight: F(F(0.25) + F(F(0.75) * F(F(x * x) * x))), item }; });
}

// ---------- 最初の安定度（parameter_initialization.rs） ----------
const DEC64 = -DEFAULT_PARAMS[20];
const FACTOR64 = Math.pow(0.9, 1 / DEC64) - 1;
function initLoss(data, s0, defaultS0) {
  let sum = 0;
  for (const x of data) {
    const y = Math.pow(x.dt / s0 * FACTOR64 + 1, DEC64);
    sum += -(x.recall * Math.log(y) + (1 - x.recall) * Math.log(1 - y)) * x.count;
  }
  return sum + Math.abs(s0 - defaultS0) / 16;
}
export function initializeStability(items, avgRecall) {
  const groups = new Map();
  for (const it of items) {
    if (longTermCnt(it) !== 1) continue;
    const fr = it.reviews[0].g, flt = firstLongTerm(it);
    if (!groups.has(fr)) groups.set(fr, new Map());
    const g = groups.get(fr); if (!g.has(flt.dt)) g.set(flt.dt, []); g.get(flt.dt).push(flt.g > 1 ? 1 : 0);
  }
  const ratingCount = new Map(), rs = new Map();
  for (const [fr, inner] of groups) {
    const data = [...inner.entries()].map(([dt, labels]) => ({ dt, recall: labels.reduce((a, b) => a + b, 0) / labels.length, count: labels.length }));
    data.sort((a, b) => a.dt - b.dt);
    ratingCount.set(fr, Math.trunc(data.reduce((s, d) => s + d.count, 0)));
    const ar = avgRecall;   // f32 → f64
    for (const d of data) d.recall = (d.recall * d.count + ar) / (d.count + 1);
    const defaultS0 = DEFAULT_PARAMS[fr - 1];
    let low = S_MIN, high = INIT_S_MAX, opt = defaultS0, iter = 0;
    while (high - low > Number.EPSILON && iter < 1000) {
      iter++;
      const m1 = low + (high - low) / 3, m2 = high - (high - low) / 3;
      if (initLoss(data, m1, defaultS0) < initLoss(data, m2, defaultS0)) high = m2; else low = m1;
      opt = (high + low) / 2;
    }
    rs.set(fr, F(opt));
  }
  if (!rs.size) return null;
  return { s0: smoothAndFill(rs, ratingCount), ratingCount };
}
const fpow = (a, b) => F(Math.pow(a, b));
export function smoothAndFill(rsIn, ratingCount) {
  const rs = new Map([...rsIn].filter(([k]) => ratingCount.has(k)));
  for (const [a, b] of [[1, 2], [2, 3], [3, 4], [1, 3], [2, 4], [1, 4]]) {
    if (rs.has(a) && rs.has(b)) {
      const sv = rs.get(a), bv = rs.get(b);
      if (sv > bv) { if (ratingCount.get(a) > ratingCount.get(b)) rs.set(b, sv); else rs.set(a, bv); }
    }
  }
  const w1 = F(0.41), w2 = F(0.54);
  const arr = [null, rs.get(1) ?? null, rs.get(2) ?? null, rs.get(3) ?? null, rs.get(4) ?? null];
  let s0 = [];
  const has = i => arr[i] !== null;
  const one = F(1);
  const inv = x => F(one / x), om = x => F(one - x);
  if (rs.size === 0) return null;
  if (rs.size === 1) {
    const [rating, val] = [...rs][0]; const factor = F(val / DEFAULT_PARAMS[rating - 1]);
    s0 = DEFAULT_PARAMS.slice(0, 4).map(x => F(x * factor)).sort((a, b) => a - b);
  } else if (rs.size === 2) {
    const [, r1, r2, r3, r4] = arr;
    const den = F(Math.fround(w1 * F(-w2)) + F(w1 + w2));   // w1.mul_add(-w2, w1 + w2)（fma は丸め1回）
    const fma = F(w1 * -w2 + F(w1 + w2));
    if (!has(1) && !has(2) && has(3) && has(4)) { const x2 = F(fpow(r3, inv(om(w2))) * fpow(r4, om(inv(om(w2))))); arr[2] = x2; arr[1] = F(fpow(x2, inv(w1)) * fpow(r3, om(inv(w1)))); }
    else if (!has(1) && has(2) && !has(3) && has(4)) { const x3 = F(fpow(r2, om(w2)) * fpow(r4, w2)); arr[3] = x3; arr[1] = F(fpow(r2, inv(w1)) * fpow(x3, om(inv(w1)))); }
    else if (!has(1) && has(2) && has(3) && !has(4)) { arr[4] = F(fpow(r2, om(inv(w2))) * fpow(r3, inv(w2))); arr[1] = F(fpow(r2, inv(w1)) * fpow(r3, om(inv(w1)))); }
    else if (has(1) && !has(2) && !has(3) && has(4)) { const e1 = F(w1 / fma), e2 = F(w2 / fma); const x2 = F(fpow(r1, e1) * fpow(r4, om(e1))); arr[2] = x2; arr[3] = F(fpow(r1, om(e2)) * fpow(r4, e2)); void den; }
    else if (has(1) && !has(2) && has(3) && !has(4)) { const x2 = F(fpow(r1, w1) * fpow(r3, om(w1))); arr[2] = x2; arr[4] = F(fpow(x2, om(inv(w2))) * fpow(r3, inv(w2))); }
    else if (has(1) && has(2) && !has(3) && !has(4)) { const x3 = F(fpow(r1, om(inv(om(w1)))) * fpow(r2, inv(om(w1)))); arr[3] = x3; arr[4] = F(fpow(r2, om(inv(w2))) * fpow(x3, inv(w2))); }
    s0 = arr.slice(1).filter(x => x !== null);
  } else if (rs.size === 3) {
    const [, r1, r2, r3, r4] = arr;
    if (!has(1) && has(2) && has(3)) arr[1] = F(fpow(r2, inv(w1)) * fpow(r3, om(inv(w1))));
    else if (has(1) && !has(2) && has(3)) arr[2] = F(fpow(r1, w1) * fpow(r3, om(w1)));
    else if (has(2) && !has(3) && has(4)) arr[3] = F(fpow(r2, om(w2)) * fpow(r4, w2));
    else if (has(2) && has(3) && !has(4)) arr[4] = F(fpow(r2, om(inv(w2))) * fpow(r3, inv(w2)));
    s0 = arr.slice(1).filter(x => x !== null);
  } else s0 = arr.slice(1).filter(x => x !== null);
  return s0.map(v => Math.min(INIT_S_MAX, Math.max(S_MIN, v))).slice(0, 4);
}

// ---------- 範囲で切る（parameter_clipper.rs） ----------
export function clipParameters(w, numRelearningSteps, enableShortTerm) {
  const p = w.map(F);
  let c1718 = 2;
  if (numRelearningSteps > 1) {
    const v = F(-F(F(F(Math.log(p[11])) + F(Math.log(F(fpow(2, p[13]) - 1)))) + F(p[14] * F(0.3))) / F(numRelearningSteps));
    c1718 = Math.min(2, F(Math.sqrt(Math.max(v, F(0.01)))));
  }
  const w19floor = enableShortTerm ? F(0.01) : 0;
  const clamps = [[S_MIN, INIT_S_MAX], [S_MIN, INIT_S_MAX], [S_MIN, INIT_S_MAX], [S_MIN, INIT_S_MAX], [D_MIN, D_MAX], [0.001, 4], [0.001, 4], [0.001, 0.75], [0, 4.5], [0, 0.8],
    [0.001, 3.5], [0.001, 5], [0.001, 0.25], [0.001, 0.9], [0, 4], [0, 1], [1, 6], [0, c1718], [0, c1718], [w19floor, 0.8], [0.1, 0.8]];
  return p.map((x, i) => Math.min(F(clamps[i][1]), Math.max(F(clamps[i][0]), x)));
}
export function fillParams(p) {
  const w = (p || []).map(F);
  if (w.length === 0) return DEFAULT_PARAMS.slice();
  if (w.length === 17) {
    const x = w.slice(); x[4] = F(x[5] * 2 + x[4]); x[5] = F(F(Math.log(F(x[5] * 3 + 1))) / 3); x[6] = F(x[6] + 0.5);
    return [...x, 0, 0, 0, FSRS5_DEFAULT_DECAY];
  }
  if (w.length === 19) return [...w, 0, FSRS5_DEFAULT_DECAY];
  if (w.length === 21) return w;
  return null;
}

// ---------- モデル（model.rs）。f32 の前向き（評価用） ----------
const fexp = x => F(Math.exp(x));
function model32(w) {
  const decay = F(-w[20]);
  const factor = F(fexp(F(F(1 / decay) * F(Math.log(F(0.9))))) - 1);
  const pfc = (t, s) => fpow(F(F(F(F(t) / s) * factor) + 1), decay);
  const initD = g => F(F(w[4] - fexp(F(w[5] * F(g - 1)))) + 1);
  const clampS = x => Math.min(S_MAX, Math.max(S_MIN, x)), clampD = x => Math.min(D_MAX, Math.max(D_MIN, x));
  function step(st, g, dt) {
    if (!st) return { s: clampS(F(w[g - 1])), d: clampD(initD(g)) };
    const s = st.s, d = st.d, r = pfc(dt, s);
    let ns;
    if (g === 1) {
      const a = F(F(F(w[11] * fpow(d, F(-w[12]))) * F(fpow(F(s + 1), w[13]) - 1)) * fexp(F(F(-r + 1) * w[14])));
      const m = F(s / fexp(F(w[17] * w[18]))); ns = m < a ? m : a;
    } else {
      let x = F(fexp(w[8]) * F(-d + 11)); x = F(x * fpow(s, F(-w[9]))); x = F(x * F(fexp(F(F(-r + 1) * w[10])) - 1));
      x = F(x * (g === 2 ? w[15] : 1)); x = F(x * (g === 4 ? w[16] : 1)); x = F(x + 1); ns = F(s * x);
    }
    if (dt === 0) { const sinc = F(fexp(F(w[17] * F(F(g - 3) + w[18]))) * fpow(s, F(-w[19]))); ns = F(s * (g >= 3 ? Math.max(sinc, 1) : sinc)); }
    const delta = F(F(-w[6]) * F(g - 3)), nd0 = F(d + F(F(F(-d) + 10) * F(delta / 9)));
    const nd = clampD(F(F(w[7] * F(initD(4) - nd0)) + nd0));
    return { s: clampS(ns), d: nd };
  }
  return { step, pfc };
}
function predict(w, item) {
  const m = model32(w); let st = null;
  for (let i = 0; i < item.reviews.length - 1; i++) st = m.step(st, item.reviews[i].g, item.reviews[i].dt);
  return m.pfc(current(item).dt, st.s);
}

// ---------- 評価（inference.rs evaluate。重みは記録の新しさ） ----------
function rMatrixIndex(item) {
  const dt = current(item).dt;
  const dtBin = Math.round(2.48 * Math.pow(3.62, Math.floor(Math.log(dt) / Math.log(3.62))) * 100);
  const length = longTermCnt(item) + 1;
  const lenBin = Math.round(1.99 * Math.pow(1.89, Math.floor(Math.log(length) / Math.log(1.89))));
  let lapse = 0; for (let i = 0; i < item.reviews.length - 1; i++) if (item.reviews[i].g === 1 && item.reviews[i].dt > 0) lapse++;
  if (!lapse) return `${dtBin},${lenBin},0`;
  return `${dtBin},${lenBin},${Math.round(1.65 * Math.pow(1.73, Math.floor(Math.log(lapse) / Math.log(1.73))))}`;
}
export function evaluate(items, paramsRaw, onProgress) {
  if (!items.length) throw new Error('NotEnoughData');
  const filled = fillParams(paramsRaw); if (!filled) throw new Error('InvalidParameters');
  const w = clipParameters(filled, 1, false);
  const weighted = recencyWeighted(items);
  const bins = new Map(); let lossSum = 0, wSum = 0;
  weighted.forEach(({ weight, item }, i) => {
    const p = predict(w, item), y = current(item).g > 1 ? 1 : 0;
    const key = rMatrixIndex(item); let v = bins.get(key); if (!v) bins.set(key, v = { pred: 0, act: 0, count: 0, weight: 0 });
    v.pred = F(v.pred + p); v.act = F(v.act + y); v.count = F(v.count + 1); v.weight = F(v.weight + weight);
    lossSum += F(F(F(y * F(Math.log(p))) + F(F(1 - y) * F(Math.log(F(1 - p))))) * weight); wSum += weight;
    if (onProgress && i % 512 === 511) onProgress(i + 1, weighted.length);
  });
  let num = 0, den = 0;
  for (const v of bins.values()) { const d = F(F(v.pred / v.count) - F(v.act / v.count)); num = F(num + F(F(d * d) * v.weight)); den = F(den + v.weight); }
  return { logLoss: F(-lossSum / wSum), rmseBins: F(Math.sqrt(F(num / den))) };
}

// ---------- 学習（training.rs）。前向きに勾配を運ぶ ----------
const N = 21;
// 1つの項目の損失と、w についての勾配（grad に足す）。返すのは損失（重み付き）
function itemLossGrad(w, wi, item, grad, gs, gd, tmp) {
  const decay = -w[20], ln09 = Math.log(0.9);
  const fac = Math.pow(0.9, 1 / decay) - 1;            // factor = 0.9^(1/decay) − 1
  const dfac = (fac + 1) * ln09 / (w[20] * w[20]);      // ∂factor/∂w20
  // R = (1 + fac·t/s)^(−w20) と、その s・w20 についての偏微分
  const R = (t, s) => {
    const base = 1 + fac * t / s, r = Math.pow(base, -w[20]);
    return { r, ds: w[20] * Math.pow(base, -w[20] - 1) * fac * t / (s * s), dw20: r * (-Math.log(base) - w[20] / base * t / s * dfac) };
  };
  const rv = item.reviews, L = rv.length - 1;
  let s, d;
  gs.fill(0); gd.fill(0);
  { // 最初の評価（init_stability・init_difficulty）
    const g = rv[0].g;
    s = w[g - 1];
    if (s < S_MIN) s = S_MIN; else if (s > S_MAX) s = S_MAX; else gs[g - 1] = 1;
    const e = Math.exp(w[5] * (g - 1)); d = w[4] - e + 1;
    if (d < D_MIN) d = D_MIN; else if (d > D_MAX) d = D_MAX; else { gd[4] = 1; gd[5] = -(g - 1) * e; }
    s = F(s); d = F(d);
  }
  const ns_ = new Float64Array(N), nd_ = new Float64Array(N);
  for (let k = 1; k < L; k++) {
    const g = rv[k].g, t = rv[k].dt;
    let s1, dsds, dsdd; ns_.fill(0);
    if (t === 0) { // 同じ日（short-term）
      const sinc = Math.exp(w[17] * (g - 3 + w[18])) * Math.pow(s, -w[19]);
      if (g >= 3 && sinc < 1) { s1 = s; dsds = 1; dsdd = 0; }
      else {
        s1 = s * sinc; dsds = sinc * (1 - w[19]); dsdd = 0;
        ns_[17] = s1 * (g - 3 + w[18]); ns_[18] = s1 * w[17]; ns_[19] = s1 * -Math.log(s);
      }
    } else {
      const rr = R(t, s);
      if (g === 1) {
        const E = Math.exp((1 - rr.r) * w[14]), dpw = Math.pow(d, -w[12]), sp = Math.pow(s + 1, w[13]);
        const a = w[11] * dpw * (sp - 1) * E;
        const em = Math.exp(w[17] * w[18]), m = s / em;
        if (m < a) { s1 = m; dsds = 1 / em; dsdd = 0; ns_[17] = -w[18] * m; ns_[18] = -w[17] * m; }
        else {
          s1 = a;
          dsds = w[11] * dpw * w[13] * Math.pow(s + 1, w[13] - 1) * E + a * -w[14] * rr.ds;
          dsdd = a * -w[12] / d;
          ns_[11] = a / w[11]; ns_[12] = a * -Math.log(d); ns_[13] = w[11] * dpw * sp * Math.log(s + 1) * E; ns_[14] = a * (1 - rr.r);
          ns_[20] = a * -w[14] * rr.dw20;
        }
      } else {
        const hp = g === 2 ? w[15] : 1, eb = g === 4 ? w[16] : 1;
        const E = Math.exp((1 - rr.r) * w[10]), A = Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * hp * eb, sinc = A * (E - 1);
        s1 = s * (sinc + 1);
        const dSincDr = A * E * -w[10];
        dsds = (sinc + 1) + s * (sinc * -w[9] / s + dSincDr * rr.ds);
        dsdd = s * (-sinc / (11 - d));
        ns_[8] = s * sinc; ns_[9] = s * sinc * -Math.log(s); ns_[10] = s * A * E * (1 - rr.r); ns_[20] = s * dSincDr * rr.dw20;
        if (g === 2) ns_[15] = s * sinc / w[15];
        if (g === 4) ns_[16] = s * sinc / w[16];
      }
    }
    // 難しさ
    const delta = -w[6] * (g - 3), nd0 = d + (10 - d) * delta / 9, e5 = Math.exp(w[5] * 3), D04 = w[4] - e5 + 1;
    let d1 = w[7] * (D04 - nd0) + nd0;
    const dnd0dd = 1 - delta / 9, dd1dnd0 = 1 - w[7];
    nd_.fill(0);
    let ddd = dd1dnd0 * dnd0dd, dClamped = false;
    if (d1 < D_MIN) { d1 = D_MIN; dClamped = true; } else if (d1 > D_MAX) { d1 = D_MAX; dClamped = true; }
    if (!dClamped) { nd_[6] = dd1dnd0 * (10 - d) * -(g - 3) / 9; nd_[7] = D04 - nd0; nd_[4] = w[7]; nd_[5] = w[7] * -3 * e5; }
    // 安定度の範囲
    let sClamped = false;
    if (s1 < S_MIN) { s1 = S_MIN; sClamped = true; } else if (s1 > S_MAX) { s1 = S_MAX; sClamped = true; }
    for (let j = 0; j < N; j++) {
      const a = sClamped ? 0 : dsds * gs[j] + dsdd * gd[j] + ns_[j];
      const b = dClamped ? 0 : ddd * gd[j] + nd_[j];
      tmp[j] = a; gd[j] = b;
    }
    gs.set(tmp);
    s = F(s1); d = F(d1);
  }
  const rr = R(rv[L].dt, s), y = rv[L].g > 1 ? 1 : 0, p = rr.r;
  const loss = -wi * (y * Math.log(p) + (1 - y) * Math.log(1 - p));
  const dLdR = -wi * (y / p - (1 - y) / (1 - p));
  for (let j = 0; j < N; j++) grad[j] += dLdR * rr.ds * gs[j];
  grad[20] += dLdR * rr.dw20;
  return loss;
}
function itemLoss32(w, wi, item) {
  const p = predict(w, item), y = current(item).g > 1 ? 1 : 0;
  return -wi * (y * Math.log(p) + (1 - y) * Math.log(1 - p));
}
// f32 の powi（compiler-rt __powisf2 と同じ二乗の繰り返し）
function powi32(a, n) { let r = F(1); let b = F(a); let k = n; while (k) { if (k & 1) r = F(r * b); b = F(b * b); k >>= 1; } return r; }
// IncreasingUniform で並べ替える（rand 0.9.2 SliceRandom::shuffle）
function shuffleIdx(arr, rng) {
  if (arr.length <= 1) return;
  let n = 0, chunk = 0, rem = 1;   // m = 0 なので最初の1つは乱数を使わない
  for (let i = 0; i < arr.length; i++) {
    const next = n + 1;
    let nextRem;
    if (rem === 0) {
      // calculate_bound_u32(next): next·(next+1)·… が u32 に収まる限り掛ける
      let product = next, cur = next + 1;
      for (;;) { const p = product * cur; if (p > 0xffffffff) break; product = p; cur++; }
      const remaining = cur - next;
      chunk = rng.rangeU32(0, product); nextRem = remaining - 1;
    } else nextRem = rem - 1;
    let idx;
    if (nextRem === 0) idx = chunk;
    else { idx = chunk % next; chunk = Math.floor(chunk / next); }
    rem = nextRem; n = next;
    const t = arr[i]; arr[i] = arr[idx]; arr[idx] = t;
  }
}
function cosineLR(tMax, initLr) {
  let step = -1, cur = initLr;
  return () => {
    step += 1;
    if (step === 0) cur = initLr;
    else if ((step - 1 - tMax) % (2 * tMax) === 0) cur = initLr * (1 - Math.cos(Math.PI / tMax)) / 2;
    else cur = (1 + Math.cos(Math.PI * step / tMax)) / (1 + Math.cos(Math.PI * (step - 1) / tMax)) * cur;   // mul_add(lr − 0, 0)
    return cur;
  };
}
function train(weightedIn, initS0, numRelearningSteps, onProgress, shouldAbort) {
  // 長さの順（安定）に並べて 512 ずつのバッチ
  const items = weightedIn.map((x, i) => ({ ...x, i })).sort((a, b) => a.item.reviews.length - b.item.reviews.length || a.i - b.i);
  const batches = []; for (let i = 0; i < items.length; i += CFG.batchSize) batches.push(items.slice(i, i + CFG.batchSize));
  const total = items.length, iterations = (Math.floor(total / CFG.batchSize) + 1) * CFG.epochs;
  const rng = new StdRng(BigInt(CFG.seed));
  const lr = cosineLR(iterations, CFG.lr);
  let w = [...initS0, ...DEFAULT_PARAMS.slice(4)].map(F);
  const initW = w.slice();
  const m1 = new Float32Array(N), m2 = new Float32Array(N); let time = 0;
  const b1 = F(0.9), b2 = F(0.999), f1 = F(1 - b1), f2 = F(1 - b2), eps = F(1e-8);
  const grad = new Float64Array(N), gs = new Float64Array(N), gd = new Float64Array(N), tmp = new Float64Array(N);
  let best = Infinity, bestW = w.slice();
  for (let epoch = 1; epoch <= CFG.epochs; epoch++) {
    const order = batches.map((_, i) => i); shuffleIdx(order, rng);
    let processed = 0;
    order.forEach(bi => {
      if (shouldAbort && shouldAbort()) throw new Error('Interrupted');
      const batch = batches[bi], rate = lr();
      grad.fill(0);
      for (const { weight, item } of batch) itemLossGrad(w, weight, item, grad, gs, gd, tmp);
      const pen = CFG.gamma * batch.length / total;
      for (let j = 0; j < N; j++) grad[j] += 2 * (w[j] - initW[j]) / (PARAMS_STDDEV[j] * PARAMS_STDDEV[j]) * pen;
      // Adam（burn 0.17.1 の AdaptiveMomentum と同じ順に f32 で）
      time += 1;
      const c1 = F(1 - powi32(b1, time)), c2 = F(1 - powi32(b2, time)), lr32 = F(rate);
      for (let j = 0; j < N; j++) {
        const g = F(grad[j]);
        if (time === 1) { m1[j] = F(g * f1); m2[j] = F(F(g * g) * f2); }
        else { m1[j] = F(F(m1[j] * b1) + F(g * f1)); m2[j] = F(F(m2[j] * b2) + F(F(g * g) * f2)); }
        const u = F(F(m1[j] / c1) / F(F(Math.sqrt(F(m2[j] / c2))) + eps));
        w[j] = F(w[j] - F(u * lr32));
      }
      w = clipParameters(w, numRelearningSteps, true);
      processed += batch.length;   // fsrs-rs の ProgressState（回目−1）×項目数＋この回に済んだ項目数
      if (onProgress) onProgress((epoch - 1) * total + processed, CFG.epochs * total);
    });
    // その回の終わりの損失（学習に使った全部で。罰則つき）
    let lossValid = 0;
    for (const batch of batches) {
      let l = 0; for (const { weight, item } of batch) l += itemLoss32(w, weight, item);
      let pen = 0; for (let j = 0; j < N; j++) pen += (w[j] - initW[j]) ** 2 / (PARAMS_STDDEV[j] * PARAMS_STDDEV[j]);
      lossValid += F(l) + F(pen * CFG.gamma * batch.length / total);
    }
    lossValid /= total;
    if (lossValid < best) { best = lossValid; bestW = w.slice(); }
  }
  return bestW;
}

// fsrs-rs compute_parameters
export function computeParameters(itemsIn, { numRelearningSteps = 1, onProgress, shouldAbort } = {}) {
  const { init, train: trainSet } = prepareTrainingData(itemsIn);
  const avg = averageRecall(trainSet);
  if (trainSet.length < 8) return DEFAULT_PARAMS.slice();
  const ini = initializeStability(init, avg);
  if (!ini) throw new Error('NotEnoughData');
  const initialized = [...ini.s0, ...DEFAULT_PARAMS.slice(4)];
  if (trainSet.length === init.length || trainSet.length < 64) return initialized;
  const weighted = recencyWeighted(trainSet).filter(x => x.item.reviews.length <= CFG.maxSeqLen);
  const w = train(weighted, ini.s0, numRelearningSteps, onProgress, shouldAbort);
  if (w.some(x => !Number.isFinite(x))) throw new Error('InvalidInput');
  const opt = new Map(w.slice(0, 4).map((v, i) => [i + 1, v]));
  const s0 = smoothAndFill(opt, ini.ratingCount);
  return [...s0, ...w.slice(4)];
}

// ---------- 健康診断（inference.rs evaluate_with_time_series_splits と、重みなしの evaluate） ----------
function evaluatePredictions(preds) {
  const bins = new Map(); let lossSum = 0;
  for (const { item, p } of preds) {
    const y = current(item).g > 1 ? 1 : 0;
    const key = rMatrixIndex(item); let v = bins.get(key); if (!v) bins.set(key, v = { pred: 0, act: 0, count: 0, weight: 0 });
    v.pred = F(v.pred + p); v.act = F(v.act + y); v.count = F(v.count + 1); v.weight = F(v.weight + 1);
    lossSum += F(F(y * F(Math.log(p))) + F(F(1 - y) * F(Math.log(F(1 - p)))));
  }
  let num = 0, den = 0;
  for (const v of bins.values()) { const d = F(F(v.pred / v.count) - F(v.act / v.count)); num = F(num + F(F(d * d) * v.weight)); den = F(den + v.weight); }
  return { logLoss: F(-lossSum / preds.length), rmseBins: F(Math.sqrt(F(num / den))) };
}
export function evaluateTimeSeriesSplits(items, { numRelearningSteps = 1, onProgress, shouldAbort } = {}) {
  if (!items.length) throw new Error('NotEnoughData');
  const n = 5, seg = Math.floor(items.length / (n + 1));
  if (!seg) throw new Error('NotEnoughData');
  const preds = [];
  for (let i = 0; i < n; i++) {
    const testStart = (i + 1) * seg, testEnd = i === n - 1 ? items.length : (i + 2) * seg;
    const params = computeParameters(items.slice(0, testStart), { numRelearningSteps, shouldAbort });
    const w = clipParameters(fillParams(params), 1, false);
    for (const item of items.slice(testStart, testEnd)) preds.push({ item, p: predict(w, item) });
    if (onProgress) onProgress(i + 1, n);
  }
  return evaluatePredictions(preds);
}

// fsrs-rs next_states の「もう一度」「正解」の記憶の値だけ（rslib compute_params の確かめ用）
function nextMemory(w, st, g, daysElapsed) { return model32(w).step(st, g, daysElapsed); }

// rslib compute_params（今のパラメータのほうが良ければ今のまま）
export function computeParams({ revlogs, nextDayAt, ignoreBeforeMs = 0, currentParams = [], numRelearningSteps = 1, healthCheck = false, onProgress, shouldAbort }) {
  const { items, reviewCount } = itemsForTraining(revlogs, nextDayAt, ignoreBeforeMs);
  if (!items.length) return { params: currentParams.slice(), fsrsItems: 0, reviewCount };
  if (onProgress) onProgress(0, 0, reviewCount);   // rslib は学習の前から記録の数を知らせる
  let params = computeParameters(items, { numRelearningSteps, onProgress, shouldAbort });
  const cur = fillParams(currentParams);
  if (cur) {
    const curLoss = evaluate(items, currentParams).logLoss, newLoss = evaluate(items, params).logLoss;
    if (curLoss <= newLoss) {
      if (numRelearningSteps <= 1) params = currentParams.slice();
      else {
        const w = clipParameters(cur, 1, false);
        let st = nextMemory(w, { s: 1, d: 1 }, 1, 2);
        for (let i = 0; i < numRelearningSteps; i++) st = nextMemory(w, st, 3, 0);
        if (st.s < 1) params = currentParams.slice();
      }
    }
  }
  // 健康診断（項目が 300 より多いときだけ。rslib の log_loss_adjustment・rmse_adjustment）
  let healthCheckPassed = null;
  if (healthCheck && items.length > 300) {
    try {
      const ev = evaluateTimeSeriesSplits(items, { numRelearningSteps, shouldAbort });
      let ok = 0; for (const it of items) if (current(it).g > 1) ok++;
      const r = F(F(ok) / F(items.length)), c = items.length;
      const llAdj = F(F(0.623) * fpow(F(F(4 * r) * F(1 - r)), F(0.738)));
      const rmseAdj = F(F(F(F(0.0135) / F(fpow(r, F(0.504)) - F(1.14))) + F(F(0.176) / F(fpow(F(F(c) / 1000), F(0.825)) + F(2.22)))) + F(0.101));
      healthCheckPassed = F(ev.logLoss / llAdj) <= F(1.11) || F(ev.rmseBins / rmseAdj) <= F(1.53);
    } catch (e) { if (String(e.message) === 'Interrupted') throw e; healthCheckPassed = null; }
  }
  return { params, fsrsItems: items.length, reviewCount, healthCheckPassed };
}
// rslib evaluate_params_legacy
export function evaluateParamsLegacy({ revlogs, nextDayAt, ignoreBeforeMs = 0, params, onProgress }) {
  const { items, reviewCount } = itemsForTraining(revlogs, nextDayAt, ignoreBeforeMs);
  if (onProgress) onProgress(0, 0, reviewCount);
  return evaluate(items, params, onProgress);
}
