// Anki 25.09.4 の v3 スケジューラの「答えたら次にどうなるか」を写したもの（FSRS をオンにしたときと、オフにしたとき＝SM-2）。
// 元: rslib/src/scheduler/states/{steps,learning,relearning,review,normal,interval_kind}.rs,
//     rslib/src/scheduler/answering/{mod,current,learning,review,relearning,revlog}.rs
// 揺らぎの乱数は Anki と同じ ChaCha12（rng.mjs）、負荷分散は load_balancer.rs を写した findInterval。
import { makeFsrs, DEFAULT_W } from './fsrs6.mjs';
import { fuzzBounds } from './schedule.mjs';
import { StdRng, weightedIndexSample, fuzzSeed, fuzzFactor } from './rng.mjs';

const DAY = 86400;
const fr = Math.fround;
// rslib の round_to_places（f32 で掛けて丸めて割る）
export function roundPlaces(v, places) { const f = fr(10 ** places); return fr(Math.round(fr(fr(v) * f)) / f); }
const MIN_EASE = 1.3, EASE_AGAIN = -0.2, EASE_HARD = -0.15, EASE_EASY = 0.15;

// ---- 日付（rslib scheduler/timing.rs の sched_timing_today と、scheduler/mod.rs の timing_for_timestamp） ----
// 2つ目の引数は、コレクションの情報 { crt, config: { rollover, creationOffset } }（S.meta）か、crt の数だけ。
// 次の日の開始時刻 rollover（無ければ 4 時）と、作ったときの時差 creationOffset（分・西向きが正）を使い、今の時差は端末の時計から取る
// （Anki のパソコン版・AnkiMobile と同じく、localOffset の設定ではなく、いま動いている端末のタイムゾーン）。
// creationOffset が無い古いコレクションは v2 の古い計算（crt をその日の rollover 時刻にそろえて 86400 秒で割る）
const localOffsetSecs = secs => -new Date(secs * 1000).getTimezoneOffset() * 60;   // 東向きが正（秒）
const localDayNum = (secs, offEast) => Math.floor((secs + offEast) / DAY);           // その時差での暦の日の番号（num_days_from_ce の差に使う）
const rolloverAt = (secs, offEast, hour) => localDayNum(secs, offEast) * DAY + (hour % 24) * 3600 - offEast;   // その日の rollover 時刻（UTC 秒）
export function timingToday(nowSecs, meta) {
  const crt = typeof meta === 'number' ? meta : meta.crt;
  const conf = (typeof meta === 'number' ? null : meta.config) || {};
  const hour = conf.rollover == null ? 4 : Math.min(Number(conf.rollover), 23);
  const nowOff = localOffsetSecs(nowSecs);
  if (conf.creationOffset == null) {
    // sched_timing_today_v2_legacy
    const crtAt = rolloverAt(crt, nowOff, hour);
    const daysElapsed = Math.trunc((nowSecs - crtAt) / DAY);
    let nextDayAt = rolloverAt(nowSecs, nowOff, hour);
    if (nextDayAt < nowSecs) nextDayAt += DAY;
    return { daysElapsed: Math.max(daysElapsed, 0), nextDayAt };
  }
  // sched_timing_today_v2_new
  const crtOff = -Math.max(-23 * 60, Math.min(23 * 60, Number(conf.creationOffset))) * 60;
  const today = rolloverAt(nowSecs, nowOff, hour);
  const passed = today <= nowSecs;
  let days = localDayNum(nowSecs, nowOff) - localDayNum(crt, crtOff);
  if (!passed) days -= 1;
  return { daysElapsed: Math.max(days, 0), nextDayAt: passed ? today + DAY : today };
}

// ---- 学習ステップ（steps.rs） ----
export function learningSteps(mins) {
  const toSecs = v => Math.trunc(fr(v * 60));
  const len = mins.length;
  const idx = rem => Math.min(Math.max(len - (rem % 1000), 0), Math.max(len - 1, 0));
  const at = i => (i >= 0 && i < len ? toSecs(mins[i]) : null);
  const roundDays = s => (s > DAY ? Math.round(s / DAY) * DAY : s);
  return {
    isEmpty: len === 0,
    againDelay: () => at(0),
    hardDelay(rem) {
      const i = idx(rem);
      const cur = at(i) ?? (len ? toSecs(mins[0]) : null);
      if (cur === null) return null;
      if (i !== 0) return cur;
      const next = at(1);
      if (next !== null) return roundDays(Math.floor((cur + next) / 2));
      return roundDays(Math.min(Math.floor((cur * 3) / 2), cur + DAY));
    },
    goodDelay: rem => at(idx(rem) + 1),
    currentDelay: rem => at(idx(rem)) ?? 0,
    remainingForGood: rem => Math.max(len - (idx(rem) + 1), 0),
    remainingForFailed: () => len,
  };
}

function leechMet(lapses, threshold) {
  if (threshold <= 0) return false;
  const half = Math.max(1, Math.ceil(threshold / 2));
  return lapses >= threshold && (lapses - threshold) % half === 0;
}

// ---- 揺らぎ ----
// 0〜1 の決まった乱数（rslib get_fuzz_factor: StdRng::seed_from_u64(カード番号＋回数).random_range(0.0..1.0) の f32）
export const fuzzFactorFor = (cardId, reps) => fuzzFactor(cardId, reps);
// rslib fuzz.rs StateContext::with_review_fuzz: 負荷分散があればそれで日を選び、無いか選べなければ揺らぎ（f32 で計算）
function withReviewFuzz(ctx, interval, minimum, maximum) {
  if (ctx.lb) { const d = findInterval(ctx.lb, interval, minimum, maximum, ctx.lbConf, ctx.fuzzSeed, ctx.lbNote); if (d != null) return d; }
  if (ctx.fuzzFactor == null) return Math.min(Math.max(Math.round(interval), minimum), maximum);
  const [lo, hi] = fuzzBounds(interval, minimum, maximum);
  return Math.floor(fr(fr(lo) + fr(fr(ctx.fuzzFactor) * fr(1 + hi - lo))));
}
// ---- 負荷分散（rslib scheduler/states/load_balancer.rs） ----
// 勉強を始めたとき（出題の並びを作ったとき）に、期日の番号が 今日〜今日+98 のカードをプリセットごと・日ごとに数えておく
// （Anki の SQL は queue を見ないので、休止・非表示・新規の並び番号もその範囲なら数に入る）。復習で答えたら add で足す
const MAX_LB_IVL = 90, LB_DAYS = 99, SIBLING_PENALTY = fr(0.001);
export function buildLoadBalancer(cards, today, nextDayAt, presets) {
  const days = new Map();
  for (const c of cards) {
    const i = c.due - today; if (!(i >= 0 && i < LB_DAYS) || c.conf == null) continue;
    let a = days.get(c.conf); if (!a) days.set(c.conf, a = Array.from({ length: LB_DAYS }, () => ({ n: 0, notes: new Map() })));
    a[i].n++; a[i].notes.set(c.nid, (a[i].notes.get(c.nid) || 0) + 1);
  }
  const easy = new Map();
  for (const [id, p] of Object.entries(presets)) { const e = p.easyDaysPercentages || []; easy.set(+id, e.length === 7 ? e.map(x => (x === 1 ? 'N' : x === 0 ? 'M' : 'R')) : Array(7).fill('N')); }
  return { days, easy, today, nextDayAt };
}
export function lbAdd(lb, nid, conf, interval) { const d = lb?.days.get(conf)?.[interval]; if (d) { d.n++; d.notes.set(nid, (d.notes.get(nid) || 0) + 1); } }
const LOAD = { M: fr(0.0001), R: fr(0.5), N: 1 };
function findInterval(lb, interval, minimum, maximum, conf, seed, noteId) {
  if (Math.trunc(fr(interval)) > MAX_LB_IVL || minimum > MAX_LB_IVL) return null;
  const [before, after] = fuzzBounds(interval, minimum, maximum);
  const days = lb.days.get(conf); if (!days) return null;
  const easy = lb.easy.get(conf); if (!easy) return null;
  const span = days.slice(before, after + 1);
  // 曜日（月曜=0）。interval_to_weekday: next_day_at + (間隔-1) 日の現地の曜日
  const wd = span.map((_, i) => (new Date((lb.nextDayAt + (i + before - 1) * 86400) * 1000).getDay() + 6) % 7);
  const counts = span.map(d => d.n);
  const total = counts.reduce((a, b) => a + b, 0);
  const totalPct = wd.reduce((a, w) => fr(a + LOAD[easy[w]]), 0);
  const easyMod = wd.map((w, i) => {
    let k = easy[w];
    if (k === 'R') { const other = fr(total - counts[i]), otherPct = fr(totalPct - 0.5), norm = fr(counts[i] / 0.5); k = norm > fr(other / otherPct) ? 'M' : 'N'; }
    return LOAD[k];
  });
  const weights = span.map((d, i) => {
    if (d.n === 0) return 1;
    const a = fr(Math.pow(fr(1 / d.n), fr(2.15))), b0 = fr(1 / (i + before)), b = fr(fr(b0 * b0) * b0);
    const sib = noteId != null && d.notes.has(noteId) ? SIBLING_PENALTY : 1;
    return fr(fr(fr(a * b) * sib) * easyMod[i]);
  });
  if (seed == null) return null;
  const k = weightedIndexSample(weights, new StdRng(seed));
  return k == null ? null : before + k;
}
const minMax = (ctx, minimum) => {
  const maximum = Math.max(ctx.maxIvl, 1);
  return [Math.min(Math.max(minimum, 1), maximum), maximum];
};

// ---- 状態 ----
// {kind:'new', position} / {kind:'learn', remaining, secs, elapsedSecs, mem}
// {kind:'review', days, elapsedDays, ease, lapses, leeched, mem} / {kind:'relearn', learn:{...}, review:{...}}
const learn = (remaining, secs, mem) => ({ kind: 'learn', remaining, secs, elapsedSecs: 0, mem });

function learnNext(st, ctx) {
  if (!ctx.fsrs) return learnNextSm2(st, ctx);
  const N = ctx.fsrs;
  const shortTerm = iv => ctx.allowShortTerm && (ctx.shortTermWithSteps || ctx.steps.isEmpty) && iv < 0.5;
  const graduate = (g, mem) => {
    const [mn, mx] = minMax(ctx, 1);
    const iv = N[g].interval;
    if (shortTerm(iv)) return learn(g === 1 ? ctx.steps.remainingForFailed() : st.remaining, Math.trunc(fr(iv * DAY)), mem);
    return { kind: 'review', days: withReviewFuzz(ctx, Math.max(Math.round(iv), 1), mn, mx), elapsedDays: 0, ease: ctx.initialEase, lapses: 0, leeched: false, mem };
  };
  const again = (() => {
    const d = ctx.steps.againDelay();
    return d !== null ? learn(ctx.steps.remainingForFailed(), d, N[1].memory) : graduate(1, N[1].memory);
  })();
  const hard = (() => {
    const d = ctx.steps.hardDelay(st.remaining);
    return d !== null ? { ...learn(st.remaining, d, N[2].memory) } : graduate(2, N[2].memory);
  })();
  const good = (() => {
    const d = ctx.steps.goodDelay(st.remaining);
    return d !== null ? learn(ctx.steps.remainingForGood(st.remaining), d, N[3].memory) : graduate(3, N[3].memory);
  })();
  const easy = (() => {
    let [mn, mx] = minMax(ctx, 1);
    const good = withReviewFuzz(ctx, N[3].interval, mn, mx);
    mn = good + 1;
    const iv = Math.max(Math.round(N[4].interval), 1);
    return { kind: 'review', days: withReviewFuzz(ctx, iv, mn, mx), elapsedDays: 0, ease: ctx.initialEase, lapses: 0, leeched: false, mem: N[4].memory };
  })();
  return { 1: again, 2: hard, 3: good, 4: easy };
}

function reviewNext(st, ctx) {
  if (!ctx.fsrs) return reviewNextSm2(st, ctx);
  const N = ctx.fsrs;
  // again（review.rs answer_again）
  const lapses = st.lapses + 1;
  const leeched = leechMet(lapses, ctx.leechThreshold);
  const sched = N[1].interval;
  const againReview = { kind: 'review', days: Math.max(Math.round(sched), 1), elapsedDays: 0, ease: Math.max(st.ease + EASE_AGAIN, MIN_EASE), lapses, leeched, mem: N[1].memory };
  let again;
  const rd = ctx.relearnSteps.againDelay();
  if (rd !== null) again = { kind: 'relearn', learn: learn(ctx.relearnSteps.remainingForFailed(), rd, N[1].memory), review: againReview };
  else if (ctx.allowShortTerm && (ctx.shortTermWithSteps || ctx.relearnSteps.isEmpty) && sched < 0.5)
    again = { kind: 'relearn', learn: learn(ctx.relearnSteps.remainingForFailed(), Math.trunc(fr(sched * DAY)), N[1].memory), review: againReview };
  else again = againReview;
  // hard/good/easy（passing_fsrs_review_intervals）
  const gtl = x => (x > st.days ? st.days + 1 : 0);
  const cpi = (iv, minimum) => { const [mn, mx] = minMax(ctx, minimum); return withReviewFuzz(ctx, iv, mn, mx); };
  const h = cpi(N[2].interval, Math.max(gtl(Math.round(N[2].interval)), 1));
  const g = cpi(N[3].interval, Math.max(gtl(Math.round(N[3].interval)), h + 1));
  const e = cpi(N[4].interval, Math.max(gtl(Math.round(N[4].interval)), g + 1));
  const rv = (days, ease, mem) => ({ kind: 'review', days, elapsedDays: 0, ease, lapses: st.lapses, leeched: false, mem });
  return { 1: again, 2: rv(h, Math.max(st.ease + EASE_HARD, MIN_EASE), N[2].memory), 3: rv(g, st.ease, N[3].memory), 4: rv(e, st.ease + EASE_EASY, N[4].memory) };
}

function relearnNext(st, ctx) {
  if (!ctx.fsrs) return relearnNextSm2(st, ctx);
  const N = ctx.fsrs; const rs = ctx.relearnSteps;
  const shortTerm = iv => ctx.allowShortTerm && (ctx.shortTermWithSteps || rs.isEmpty) && iv < 0.5;
  const toReview = (g, keepLapses = true) => {
    const [mn, mx] = minMax(ctx, 1);
    const iv = N[g].interval;
    const review = { ...st.review, days: withReviewFuzz(ctx, Math.max(Math.round(iv), 1), mn, mx), elapsedDays: 0, mem: N[g].memory };
    if (shortTerm(iv)) return { kind: 'relearn', learn: { ...st.learn, secs: Math.trunc(fr(iv * DAY)), elapsedSecs: 0, mem: N[g].memory, remaining: g === 1 ? rs.remainingForFailed() : st.learn.remaining }, review };
    return { ...review, kind: 'review' };
  };
  const again = (() => {
    const d = rs.againDelay();
    if (d !== null) return { kind: 'relearn', learn: learn(rs.remainingForFailed(), d, N[1].memory), review: { ...st.review, days: Math.max(Math.round(N[1].interval), 1), elapsedDays: 0, mem: N[1].memory } };
    return toReview(1);
  })();
  const hard = (() => {
    const d = rs.hardDelay(st.learn.remaining);
    if (d !== null) return { kind: 'relearn', learn: { ...st.learn, secs: d, elapsedSecs: 0, mem: N[2].memory }, review: { ...st.review, elapsedDays: 0, mem: N[2].memory } };
    return toReview(2);
  })();
  const good = (() => {
    const d = rs.goodDelay(st.learn.remaining);
    if (d !== null) return { kind: 'relearn', learn: learn(rs.remainingForGood(st.learn.remaining), d, N[3].memory), review: { ...st.review, elapsedDays: 0, mem: N[3].memory } };
    return toReview(3);
  })();
  const easy = (() => {
    let [mn, mx] = minMax(ctx, 1);
    const gd = withReviewFuzz(ctx, N[3].interval, mn, mx);
    mn = gd + 1;
    return { ...st.review, kind: 'review', days: withReviewFuzz(ctx, Math.max(Math.round(N[4].interval), 1), mn, mx), elapsedDays: 0, mem: N[4].memory };
  })();
  return { 1: again, 2: hard, 3: good, 4: easy };
}

// ---- FSRS をオフにしたとき（SM-2。states/{learning,review,relearning}.rs の fsrs_next_states が None の分岐） ----
// 値はすべて f32（rslib の DeckConfig の中身は f32）
function learnNextSm2(st, ctx) {
  const toReview = days => ({ kind: 'review', days, elapsedDays: 0, ease: ctx.initialEase, lapses: 0, leeched: false, mem: null });
  const grad = () => { const [mn, mx] = minMax(ctx, 1); return toReview(withReviewFuzz(ctx, Math.max(Math.round(fr(ctx.gradGood)), 1), mn, mx)); };
  const ad = ctx.steps.againDelay(), hd = ctx.steps.hardDelay(st.remaining), gd = ctx.steps.goodDelay(st.remaining);
  const again = ad !== null ? learn(ctx.steps.remainingForFailed(), ad, null) : grad();
  const hard = hd !== null ? learn(st.remaining, hd, null) : grad();
  const good = gd !== null ? learn(ctx.steps.remainingForGood(st.remaining), gd, null) : grad();
  const [mn, mx] = minMax(ctx, 1);
  const easy = toReview(withReviewFuzz(ctx, fr(ctx.gradEasy), mn, mx));
  return { 1: again, 2: hard, 3: good, 4: easy };
}
// review.rs failing_review_interval（SM-2）: 前の間隔×「失敗後の新しい間隔」、最小は「最小間隔」
function failingIntervalSm2(review, ctx) {
  const [mn, mx] = minMax(ctx, ctx.minLapse);
  return withReviewFuzz(ctx, fr(fr(Math.max(review.days, 1)) * ctx.lapseMult), mn, mx);
}
// review.rs constrain_passing_interval（SM-2 は間隔に「間隔の倍率」を掛ける）
function constrainSm2(ctx, interval, minimum, fuzz) {
  const iv = fr(interval * ctx.ivlMult);
  const [mn, mx] = minMax(ctx, minimum);
  return fuzz ? withReviewFuzz(ctx, iv, mn, mx) : Math.min(Math.max(Math.round(iv), mn), mx);
}
function reviewNextSm2(st, ctx) {
  const lapses = st.lapses + 1;
  const againReview = { kind: 'review', days: Math.max(Math.round(failingIntervalSm2(st, ctx)), 1), elapsedDays: 0, ease: fr(Math.max(fr(st.ease + fr(EASE_AGAIN)), fr(MIN_EASE))), lapses, leeched: leechMet(lapses, ctx.leechThreshold), mem: null };
  const rd = ctx.relearnSteps.againDelay();
  const again = rd !== null ? { kind: 'relearn', learn: learn(ctx.relearnSteps.remainingForFailed(), rd, null), review: againReview } : againReview;
  let h, g, e;
  const H = ctx.hardMult, E = ctx.easyMult, ease = st.ease;
  if (st.elapsedDays - st.days < 0) {
    // 期日前（フィルターデッキ＝カスタム学習セッション）: passing_early_review_intervals
    const sched = fr(Math.max(st.days, 1)), el = fr(st.elapsedDays);
    h = constrainSm2(ctx, Math.max(fr(el * H), fr(sched * fr(H / 2))), 0, false);
    g = constrainSm2(ctx, Math.max(fr(el * ease), sched), 0, false);
    const reduced = fr(E - fr(fr(E - 1) / 2));
    e = constrainSm2(ctx, fr(Math.max(fr(el * ease), sched) * reduced), 0, false);
  } else {
    // passing_nonearly_review_intervals
    const cur = fr(Math.max(st.days, 1)), late = fr(Math.max(st.elapsedDays - st.days, 0));
    h = constrainSm2(ctx, fr(cur * H), H <= 1 ? 0 : st.days + 1, true);
    g = constrainSm2(ctx, fr(fr(cur + fr(late / 2)) * ease), H <= 1 ? st.days + 1 : h + 1, true);
    e = constrainSm2(ctx, fr(fr(fr(cur + late) * ease) * E), g + 1, true);
  }
  const rv = (days, es) => ({ kind: 'review', days, elapsedDays: 0, ease: es, lapses: st.lapses, leeched: false, mem: null });
  return { 1: again, 2: rv(h, fr(Math.max(fr(ease + fr(EASE_HARD)), fr(MIN_EASE)))), 3: rv(g, ease), 4: rv(e, fr(ease + fr(EASE_EASY))) };
}
function relearnNextSm2(st, ctx) {
  const rs = ctx.relearnSteps;
  const back = { ...st.review, kind: 'review', mem: null };   // 段が終われば、前の復習の状態のまま戻る
  const ad = rs.againDelay(), hd = rs.hardDelay(st.learn.remaining), gd = rs.goodDelay(st.learn.remaining);
  const again = ad !== null
    ? { kind: 'relearn', learn: learn(rs.remainingForFailed(), ad, null), review: { ...st.review, days: Math.max(Math.round(failingIntervalSm2(st.review, ctx)), 1), elapsedDays: 0, mem: null } }
    : back;
  const hard = hd !== null ? { kind: 'relearn', learn: { ...st.learn, secs: hd, mem: null }, review: { ...st.review, elapsedDays: 0, mem: null } } : back;
  const good = gd !== null ? { kind: 'relearn', learn: learn(rs.remainingForGood(st.learn.remaining), gd, null), review: { ...st.review, elapsedDays: 0, mem: null } } : back;
  const easy = { ...st.review, kind: 'review', days: st.review.days + 1, elapsedDays: 0, mem: null };
  return { 1: again, 2: hard, 3: good, 4: easy };
}

// ---- カードから今の状態（answering/current.rs） ----
export function currentState(card, ctx) {
  const t = ctx.timing;
  // 普通のデッキでは期日を今日より後にしない。フィルターデッキ（カスタム学習セッション）では元の期日のまま（ans_current.rs）＝期日前の復習は「早めの復習」になる
  const due = card.type === 2 && !ctx.filtered ? Math.min(card.due, t.daysElapsed) : card.due;
  const mem = card.data && card.data.s != null ? { s: card.data.s, d: card.data.d } : null;
  const ease = fr(fr(card.factor) / 1000);
  if (card.type === 0) return { kind: 'new', position: Math.max(due, 0) };
  if (card.type === 1) return { ...learn(card.left, ctx.steps.currentDelay(card.left), mem) };
  if (card.type === 2) return { kind: 'review', days: card.ivl, elapsedDays: Math.max(card.ivl - (due - t.daysElapsed), 0), ease, lapses: card.lapses, leeched: false, mem };
  return { kind: 'relearn', learn: learn(card.left, ctx.relearnSteps.currentDelay(card.left), mem), review: { kind: 'review', days: card.ivl, elapsedDays: card.ivl, ease, lapses: card.lapses, leeched: false, mem } };
}

// ---- 1枚ぶんの文脈（answering/mod.rs card_state_updater） ----
export function makeContext(card, preset, cfg, nowSecs, lastReviewSecs, opts = {}) {
  const w = preset.fsrsParams6 && preset.fsrsParams6.length ? preset.fsrsParams6 : DEFAULT_W;
  const f = makeFsrs(w, true);
  const timing = timingToday(nowSecs, cfg.meta || cfg.crt);
  const dr = preset.desiredRetention;
  const lrt = card.data?.lrt ?? lastReviewSecs;
  const daysElapsed = lrt != null ? Math.floor((timing.nextDayAt - lrt) / DAY) : 0;
  const mem = card.data && card.data.s != null ? { s: card.data.s, d: card.data.d } : null;
  // FSRS のオン・オフはコレクションの設定 fsrs（cfg.fsrs。無ければオン＝これまでどおり）
  const fsrsOn = cfg.fsrs !== false;
  let fsrs = null;
  if (fsrsOn) {
    fsrs = {};
    for (const g of [1, 2, 3, 4]) {
      const m = mem ? f.step(mem, g, daysElapsed) : f.init(g);
      fsrs[g] = { memory: m, interval: fr(f.interval(m.s, dr)) };
    }
  }
  const ints = preset.new?.ints || [1, 4, 0];
  return {
    fsrsOn, gradGood: ints[0] ?? 1, gradEasy: ints[1] ?? 4,
    hardMult: fr(preset.rev?.hardFactor ?? 1.2), easyMult: fr(preset.rev?.ease4 ?? 1.3), ivlMult: fr(preset.rev?.ivlFct ?? 1),
    lapseMult: fr(preset.lapse?.mult ?? 0), minLapse: preset.lapse?.minInt ?? 1,
    timing, now: nowSecs, f, dr, decay: w[20], fsrs, daysElapsedSinceReview: daysElapsed, filtered: !!opts.filtered,
    steps: learningSteps(preset.new.delays), relearnSteps: learningSteps(preset.lapse.delays),
    maxIvl: preset.rev.maxIvl, leechThreshold: preset.lapse.leechFails, leechAction: preset.lapse.leechAction,
    initialEase: fr(fr(preset.new.initialFactor) / 1000),
    allowShortTerm: fsrsOn && w[17] > 0 && w[18] > 0, shortTermWithSteps: !!cfg.fsrsShortTermWithStepsEnabled,
    fuzzFactor: fuzzFactorFor(card.id, card.reps), fuzzSeed: fuzzSeed(card.id, card.reps),
    // 負荷分散（opts.lb があれば。フィルターデッキ＝カスタム学習セッションでは使わない。兄弟の印はプリセットの「復習の兄弟を埋める」がオンのときだけ）
    lb: opts.lb || null, lbConf: opts.conf, lbNote: opts.lb && preset.rev?.bury ? card.nid : null,
  };
}

export function nextStates(card, ctx) {
  const cur = currentState(card, ctx);
  const next = cur.kind === 'review' ? reviewNext(cur, ctx) : cur.kind === 'relearn' ? relearnNext(cur, ctx)
    : learnNext(cur.kind === 'new' ? learn(ctx.steps.remainingForFailed(), 0, null) : cur, ctx);
  return { current: cur, next };
}

// ---- 答えをカードに反映（answering/{learning,review,relearning}.rs と revlog.rs） ----
const intervalKind = st => (st.kind === 'review' ? { days: st.days } : st.kind === 'relearn' ? { secs: st.learn.secs } : st.kind === 'new' ? { secs: 0 } : { secs: st.secs });
const maybeAsDays = (k, untilRollover) => (k.secs != null && k.secs >= untilRollover ? { days: Math.floor((k.secs - untilRollover) / DAY) + 1 } : k);
const asRevlogIvl = k => (k.days != null ? k.days : -k.secs);
// 記録の種類: 0 学習・1 復習・2 再学習・3 フィルター（期日前の復習＝days_late < 0。review.rs revlog_kind）
const revlogKind = st => (st.kind === 'review' ? (st.elapsedDays < st.days ? 3 : 1) : st.kind === 'relearn' ? 2 : 0);

// 学習ステップの揺らぎ（rslib ans_learning.rs learning_ivl_with_fuzz）: 25% まで（5分まで）足す。種は答える前の回数
export function learningFuzzSecs(cardId, reps, secs) {
  const upper = secs + Math.floor(Math.min(fr(secs * 0.25), 300));
  if (secs >= upper) return secs;
  return new StdRng(fuzzSeed(cardId, reps)).rangeU32(secs, upper);
}

export function answer(card, rating, ctx, takenMillis = 0, answeredAtMs = ctx.now * 1000) {
  const { current, next } = nextStates(card, ctx);
  const st = next[rating];
  const c = { ...card, data: { ...(card.data || {}) } };
  const untilRollover = ctx.timing.nextDayAt - ctx.now;
  c.reps = card.reps + 1;
  // Anki はカードを保存するときに s を小数4桁・d を3桁・dr を2桁・decay を3桁に丸める（rslib storage/card/data.rs の convert_to_json）。
  // 次の答えは丸めた値から計算されるので、ここでも同じく丸めておく
  const setMem = mem => { if (mem) { c.data.s = roundPlaces(mem.s, 4); c.data.d = roundPlaces(mem.d, 3); c.data.dr = roundPlaces(ctx.dr, 2); c.data.decay = roundPlaces(ctx.decay, 3); } };
  if (current.kind === 'new' && c.data.pos == null) c.data.pos = card.due;
  let mem;
  if (st.kind === 'learn' || st.kind === 'relearn') {
    const L = st.kind === 'learn' ? st : st.learn;
    c.left = L.remaining;
    c.type = st.kind === 'learn' ? 1 : 3;
    if (st.kind === 'relearn') { c.ivl = st.review.days; c.lapses = st.review.lapses; c.factor = Math.round(fr(st.review.ease * 1000)); }
    mem = L.mem;
    const k = maybeAsDays({ secs: L.secs }, untilRollover);
    if (k.secs != null) { c.queue = 1; c.due = ctx.now + learningFuzzSecs(card.id, card.reps, k.secs); }
    else { c.queue = 3; c.due = ctx.timing.daysElapsed + k.days; }
  } else {
    c.type = 2; c.queue = 2; c.ivl = st.days; c.due = ctx.timing.daysElapsed + st.days;
    c.factor = Math.round(fr(st.ease * 1000)); c.lapses = st.lapses; c.left = 0; mem = st.mem;
  }
  if (ctx.fsrsOn) setMem(mem);
  else { delete c.data.s; delete c.data.d; delete c.data.dr; }   // FSRS がオフなら記憶の値と目標の保持率を消す（decay はそのまま。answering/mod.rs）
  if (st.leeched || st.review?.leeched) { c.leeched = true; if (ctx.leechAction === 0) c.queue = -1; }
  c.data.lrt = Math.floor(answeredAtMs / 1000);
  const ease = mem ? ((mem.d - 1) / 9 + 0.1) : (st.ease ?? st.review?.ease ?? 0);
  const revlog = {
    id: answeredAtMs, cid: card.id, ease: rating,
    ivl: asRevlogIvl(maybeAsDays(intervalKind(st), untilRollover)),
    lastIvl: asRevlogIvl(maybeAsDays(intervalKind(current), untilRollover)),
    factor: Math.round(fr(ease) * 1000), time: takenMillis, type: revlogKind(current),
  };
  return { card: c, revlog, state: st };
}

// ---- 新規カードにリセット（rslib scheduler/new.rs reschedule_cards_as_new → Card::schedule_as_new、記録は revlog/mod.rs log_manually_scheduled_review） ----
// card は暗記の形（due はフィルターデッキの中でも元のデッキの値、data に pos・s・d・dr・decay・lrt）。nextPos はコレクションの「次の新規の位置」
// 返り値: { card, revlog, usedNextPos }（usedNextPos が true なら、呼んだ側で次の位置を 1 進める）
export function forgetCard(card, { restorePosition = true, resetCounts = false, nextPos = 0, nowMs = Date.now() } = {}) {
  const c = { ...card, data: { ...(card.data || {}) } };
  const lastPos = restorePosition ? (card.type === 0 ? card.due : (card.data?.pos ?? null)) : null;
  c.due = lastPos ?? nextPos;
  c.type = 0; c.queue = 0; c.ivl = 0; c.factor = 0;
  delete c.data.pos;
  if (resetCounts) { c.reps = 0; c.lapses = 0; }
  delete c.data.s; delete c.data.d;   // memory_state = None（dr・decay・最後に答えた時刻はそのまま）
  delete c.inDyn;                      // フィルターデッキから元のデッキへ
  const revlog = { id: nowMs, cid: card.id, ease: 0, ivl: 0, lastIvl: Math.min(card.ivl, 2147483647), factor: 0, time: 0, type: 4 };
  return { card: c, revlog, usedNextPos: lastPos == null };
}

// ---- 期日を指定（rslib scheduler/reviews.rs set_due_date。書式は "0"・"1-3"・"5!"） ----
export function parseDueDate(s) {
  const m = /^(\d+)(?:-(\d+))?(!)?$/.exec(String(s ?? ''));
  if (!m) return null;
  const a = +m[1], b = m[2] != null ? +m[2] : a;
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a > 4294967295 || b > 4294967295) return null;
  return { min: Math.min(a, b), max: Math.max(a, b), forceReset: !!m[3] };
}
// days は min〜max から選んだ日数（rand の Uniform。呼んだ側で選ぶ）。initialFactor はプリセットの new.initialFactor（2500 など）
export function setDueDate(card, { today, nextDayAt, days, forceReset = false, initialFactor = 2500, nowMs = Date.now() }) {
  const c = { ...card, data: { ...(card.data || {}) } };
  const newDue = today + days;
  const fsrs = card.data?.s != null && card.data?.d != null;
  let ivl;
  if (fsrs) {
    if (card.data?.lrt != null) ivl = Math.floor(Math.max(0, nextDayAt - card.data.lrt) / 86400) + days;
    else {
      let due = card.due;
      if (due > 1000000000) due = today + Math.trunc((due - nextDayAt) / 86400);
      ivl = Math.min(4294967295, Math.max(0, card.ivl + (newDue - due)));
    }
  } else if (forceReset || !(card.type === 2 || card.type === 3)) ivl = Math.max(days, 1);
  else ivl = Math.max(card.ivl, 1);
  // schedule_as_review: 元の位置を覚え（新規なら今の位置）、復習にする。易しさが 0 ならプリセットの初期値
  const lastPos = card.type === 0 ? card.due : (card.data?.pos ?? null);
  if (lastPos == null) delete c.data.pos; else c.data.pos = lastPos;
  delete c.inDyn;
  c.ivl = ivl; c.due = newDue; c.type = 2; c.queue = 2;
  if (!card.factor) c.factor = Math.round(Math.fround(Math.fround(initialFactor / 1000) * 1000));
  const fr = Math.fround;
  const factor = fsrs ? Math.trunc(fr(fr(fr(fr(fr(card.data.d) - 1) / 9) + fr(0.1)) * 1000)) : c.factor;
  const revlog = { id: nowMs, cid: card.id, ease: 0, ivl: Math.min(ivl, 2147483647), lastIvl: Math.min(card.ivl, 2147483647), factor, time: 0, type: 4 };
  return { card: c, revlog };
}
