// Anki 本体のウェブ画面（統計・デッキのオプション・カード情報・課題を終えた画面）を自作アプリの中で動かすための「裏方」。
// 画面は Anki 25.09.4 の SvelteKit の組み上がり（/_app・/graphs など、aqt の wheel から取り出したもの）をそのまま使い、
// 画面が /_anki/<名前> に送る問い合わせ（protobuf）を、ここで端末の中のデータから答える。
// 統計の計算は rslib/src/stats/graphs/*.rs（AGPL-3.0）を JavaScript に写したもの。
import { timingToday } from '../fsrs/sched.mjs';
import { historicalStates, retrievability, FSRS5_DEFAULT_DECAY } from '../fsrs/history.mjs';
import { searchCards, loadNotes, displayText } from './search.mjs';
import * as jobs from './fsrsjobs.mjs';

// ---------- protobuf（必要な分だけ） ----------
class W {
  constructor() { this.b = []; }
  varint(n) {
    let v = BigInt.asUintN(64, BigInt(Math.trunc(n)));
    while (v >= 0x80n) { this.b.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
    this.b.push(Number(v));
  }
  tag(f, wt) { this.varint((f << 3) | wt); }
  u32(f, n) { if (n) { this.tag(f, 0); this.varint(n); } }
  i32(f, n) { if (n) { this.tag(f, 0); this.varint(n); } }
  bool(f, v) { if (v) { this.tag(f, 0); this.varint(1); } }
  f32(f, x) { if (x) { this.tag(f, 5); const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, x, true); this.b.push(...new Uint8Array(dv.buffer)); } }
  bytes(f, arr) { this.tag(f, 2); this.varint(arr.length); for (const x of arr) this.b.push(x); }
  str(f, s) { if (s) this.bytes(f, new TextEncoder().encode(s)); }
  msg(f, fn) { const w = new W(); fn(w); this.bytes(f, w.b); }
  packed(f, arr) { const w = new W(); for (const x of arr) w.varint(x); this.bytes(f, w.b); }
  // map<K,V>: 1 項目ずつ { 1: key, 2: value }
  mapNum(f, obj, vfn) { for (const [k, v] of Object.entries(obj)) this.msg(f, w => { w.tag(1, 0); w.varint(+k); vfn(w, v); }); }
  u32o(f, n) { this.tag(f, 0); this.varint(n); }
  f32o(f, x) { this.tag(f, 5); const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, x, true); this.b.push(...new Uint8Array(dv.buffer)); }
  floats(f, arr) { if (!arr || !arr.length) return; const dv = new DataView(new ArrayBuffer(4 * arr.length)); arr.forEach((x, i) => dv.setFloat32(i * 4, x, true)); this.bytes(f, new Uint8Array(dv.buffer)); }
  done() { return new Uint8Array(this.b); }
}
function read(buf) {
  // { 番号: [値…] }。varint は Number、長さ付きは Uint8Array
  const out = {}; let i = 0;
  const vint = () => { let r = 0n, s = 0n; for (;;) { const c = buf[i++]; r |= BigInt(c & 0x7f) << s; if (!(c & 0x80)) break; s += 7n; } return Number(BigInt.asIntN(64, r)); };
  while (i < buf.length) {
    const t = vint(); const f = t >> 3, wt = t & 7; let v;
    if (wt === 0) v = vint();
    else if (wt === 2) { const n = vint(); v = buf.subarray(i, i + n); i += n; }
    else if (wt === 5) { v = new DataView(buf.buffer, buf.byteOffset + i, 4).getFloat32(0, true); i += 4; }
    else if (wt === 1) { i += 8; v = 0; }
    else throw new Error('wire type ' + wt);
    (out[f] ||= []).push(v);
  }
  return out;
}
const str = b => (b ? new TextDecoder().decode(b) : '');
const floatsOf = vals => { const out = []; for (const v of vals || []) { if (v instanceof Uint8Array) { const dv = new DataView(v.buffer, v.byteOffset, v.byteLength); for (let i = 0; i + 4 <= v.byteLength; i += 4) out.push(Math.round(dv.getFloat32(i, true) * 1e6) / 1e6); } else out.push(Math.round(v * 1e6) / 1e6); } return out; };
const f32sOf = vals => { const out = []; for (const v of vals || []) { if (v instanceof Uint8Array) { const dv = new DataView(v.buffer, v.byteOffset, v.byteLength); for (let i = 0; i + 4 <= v.byteLength; i += 4) out.push(dv.getFloat32(i, true)); } else out.push(v); } return out; };
const intsOf = vals => { const out = []; for (const v of vals || []) { if (v instanceof Uint8Array) { /* packed varints */ let i = 0; const b = v; while (i < b.length) { let r = 0n, sh = 0n; for (;;) { const c = b[i++]; r |= BigInt(c & 0x7f) << sh; if (!(c & 0x80)) break; sh += 7n; } out.push(Number(BigInt.asIntN(64, r))); } } else out.push(v); } return out; };
const f1 = (m, k, d = 0) => (m[k] ? m[k][m[k].length - 1] : d);
const r6 = x => Math.round(x * 1e6) / 1e6;

// ---------- デッキのオプション（rslib deckconfig/schema11.rs の古い JSON ⇔ DeckConfig.Config） ----------
function writeConfig(w, p) {
  const n = p.new || {}, rv = p.rev || {}, l = p.lapse || {};
  w.floats(1, n.delays); w.floats(2, l.delays); w.floats(3, p.fsrsWeights); w.floats(4, p.easyDaysPercentages); w.floats(5, p.fsrsParams5); w.floats(6, p.fsrsParams6);
  w.u32(9, n.perDay); w.u32(10, rv.perDay); w.f32(11, (n.initialFactor ?? 2500) / 1000); w.f32(12, rv.ease4); w.f32(13, rv.hardFactor); w.f32(14, l.mult); w.f32(15, rv.ivlFct);
  w.u32(16, rv.maxIvl); w.u32(17, l.minInt); w.u32(18, (n.ints || [])[0]); w.u32(19, (n.ints || [])[1]);
  w.u32(20, n.order === 0 ? 1 : 0); w.u32(21, l.leechAction); w.u32(22, l.leechFails); w.bool(23, p.autoplay === false); w.u32(24, Math.max(0, p.maxTaken ?? 60)); w.bool(25, !!p.timer);
  w.bool(26, p.replayq === false); w.bool(27, !!n.bury); w.bool(28, !!rv.bury); w.bool(29, !!p.buryInterdayLearning); w.u32(30, p.newMix); w.u32(31, p.interdayLearningMix);
  w.u32(32, p.newSortOrder); w.u32(33, p.reviewOrder); w.u32(34, p.newGatherPriority); w.u32(35, p.newPerDayMinimum); w.u32(36, p.questionAction);
  if (p.desiredRetention != null) w.f32o(37, p.desiredRetention); w.bool(38, !!p.stopTimerOnAnswer); if (p.sm2Retention != null) w.f32o(40, p.sm2Retention);
  w.f32(41, p.secondsToShowQuestion); w.f32(42, p.secondsToShowAnswer); w.u32(43, p.answerAction); w.bool(44, p.waitForAudio !== false);
  w.str(45, p.paramSearch ?? p.weightSearch ?? ''); w.str(46, p.ignoreRevlogsBeforeDate ?? '');
}
function readConfig(m, base) {
  const p = structuredClone(base || {}); p.new ||= {}; p.rev ||= {}; p.lapse ||= {};
  p.new.delays = floatsOf(m[1]); p.lapse.delays = floatsOf(m[2]); p.fsrsWeights = floatsOf(m[3]); p.easyDaysPercentages = floatsOf(m[4]); p.fsrsParams5 = floatsOf(m[5]); p.fsrsParams6 = floatsOf(m[6]);
  p.new.perDay = f1(m, 9); p.rev.perDay = f1(m, 10); p.new.initialFactor = Math.round(r6(f1(m, 11, 2.5)) * 1000); p.rev.ease4 = r6(f1(m, 12)); p.rev.hardFactor = r6(f1(m, 13)); p.lapse.mult = r6(f1(m, 14)); p.rev.ivlFct = r6(f1(m, 15));
  p.rev.maxIvl = f1(m, 16); p.lapse.minInt = f1(m, 17); p.new.ints = [f1(m, 18), f1(m, 19), (p.new.ints || [])[2] ?? 0];
  p.new.order = f1(m, 20) === 1 ? 0 : 1; p.lapse.leechAction = f1(m, 21); p.lapse.leechFails = f1(m, 22); p.autoplay = !f1(m, 23); p.maxTaken = f1(m, 24); p.timer = f1(m, 25) ? 1 : 0;
  p.replayq = !f1(m, 26); p.new.bury = !!f1(m, 27); p.rev.bury = !!f1(m, 28); p.buryInterdayLearning = !!f1(m, 29); p.newMix = f1(m, 30); p.interdayLearningMix = f1(m, 31);
  p.newSortOrder = f1(m, 32); p.reviewOrder = f1(m, 33); p.newGatherPriority = f1(m, 34); p.newPerDayMinimum = f1(m, 35); p.questionAction = f1(m, 36);
  p.desiredRetention = r6(f1(m, 37, 0.9)); p.stopTimerOnAnswer = !!f1(m, 38); p.sm2Retention = r6(f1(m, 40, 0.9)); p.secondsToShowQuestion = r6(f1(m, 41)); p.secondsToShowAnswer = r6(f1(m, 42));
  p.answerAction = f1(m, 43); p.waitForAudio = !!f1(m, 44); if ('weightSearch' in p) p.weightSearch = str(f1(m, 45, null)); else p.paramSearch = str(f1(m, 45, null)); p.ignoreRevlogsBeforeDate = str(f1(m, 46, null)) || '1970-01-01';
  return p;
}
const DEFAULT_PRESET = { id: 1, name: 'デフォルト', mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 },
  rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 }, lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
  newMix: 0, newPerDayMinimum: 0, interdayLearningMix: 0, reviewOrder: 0, newSortOrder: 0, newGatherPriority: 0, buryInterdayLearning: false, fsrsWeights: [], fsrsParams5: [], fsrsParams6: [],
  desiredRetention: 0.9, ignoreRevlogsBeforeDate: '1970-01-01', easyDaysPercentages: [1, 1, 1, 1, 1, 1, 1], stopTimerOnAnswer: false, secondsToShowQuestion: 0, secondsToShowAnswer: 0, questionAction: 0, answerAction: 0, waitForAudio: true, sm2Retention: 0.9, weightSearch: '' };
function writeDeckConfig(w, f, p) { w.msg(f, x => { x.i32(1, p.id); x.str(2, p.name); x.i32(3, p.mod || 0); x.i32(4, p.usn || 0); x.msg(5, y => writeConfig(y, p)); }); }
function deckConfigsForUpdate(S, did) {
  const deck = S.decksById.get(did); const today = timingToday(Math.floor(Date.now() / 1000), S.meta).daysElapsed;
  const w = new W();
  const uses = {}; for (const d of S.meta.decks) if (!d.dyn) uses[d.conf] = (uses[d.conf] || 0) + 1;
  for (const p of Object.values(S.meta.presets)) w.msg(1, x => { writeDeckConfig(x, 1, p); x.u32(2, uses[p.id] || 0); });
  if (deck) w.msg(2, x => {
    x.str(1, deck.name); x.i32(2, deck.conf);
    const parents = []; const parts = deck.name.split('::'); for (let i = 1; i < parts.length; i++) { const pd = S.meta.decks.find(d => d.name === parts.slice(0, i).join('::')); if (pd) parents.push(pd.conf); }
    if (parents.length) { const y = new W(); for (const id of parents) y.varint(id); x.bytes(3, y.b); }
    x.msg(4, y => {
      if (deck.reviewLimit != null) y.u32o(1, deck.reviewLimit); if (deck.newLimit != null) y.u32o(2, deck.newLimit);
      if (deck.reviewLimitToday) { y.u32o(3, deck.reviewLimitToday.limit); y.bool(5, deck.reviewLimitToday.today === today); }
      if (deck.newLimitToday) { y.u32o(4, deck.newLimitToday.limit); y.bool(6, deck.newLimitToday.today === today); }
      if (deck.desiredRetention != null) y.f32o(7, deck.desiredRetention);
    });
  });
  writeDeckConfig(w, 3, DEFAULT_PRESET);
  w.bool(7, !!S.meta.config.newCardsIgnoreReviewLimit); w.bool(8, !!S.meta.config.fsrs); w.bool(9, !!S.meta.config.applyAllParentLimits);
  // 最後に「全プリセットを最適化」した日からの日数（rslib: 0 なら 0）・健康診断（既定オン）・古い評価ボタン（既定オフ）
  const last = S.meta.config.lastFsrsOptimize | 0; w.u32(10, last > 0 ? Math.max(0, today - last) : 0);
  w.bool(11, S.meta.config.fsrsHealthCheck !== false); w.bool(12, !!S.meta.config.fsrsLegacyEvaluate);
  return w.done();
}
function parseUpdate(S, body) {
  const m = read(body);
  const configs = (m[2] || []).map(b => { const d = read(b); const id = f1(d, 1); const base = S.meta.presets[id] || { ...structuredClone(DEFAULT_PRESET), id: 0 }; const p = readConfig(read(f1(d, 5, new Uint8Array())), base); p.id = id; p.name = str(f1(d, 2, null)) || p.name; return p; });
  const lim = m[6] ? read(f1(m, 6)) : {};
  const limits = { reviewLimit: lim[1] ? f1(lim, 1) : null, newLimit: lim[2] ? f1(lim, 2) : null, reviewToday: lim[3] ? f1(lim, 3) : null, newToday: lim[4] ? f1(lim, 4) : null, reviewTodayActive: !!f1(lim, 5), newTodayActive: !!f1(lim, 6), desiredRetention: lim[7] ? r6(f1(lim, 7)) : null };
  return { target: f1(m, 1), configs, removed: intsOf(m[3]), mode: f1(m, 4), limits, newCardsIgnoreReviewLimit: !!f1(m, 7), fsrs: !!f1(m, 8), applyAllParentLimits: !!f1(m, 9),
    fsrsReschedule: !!f1(m, 10), fsrsHealthCheck: !!f1(m, 11) };
}


// ---------- 統計の計算（rslib stats/graphs） ----------
const KIND = { LEARN: 0, REVIEW: 1, RELEARN: 2, FILTERED: 3, MANUAL: 4, RESCHEDULED: 5 };
const percentToBin = x => (x === 100 ? 95 : Math.floor(x / 5) * 5);
const median = a => { if (!a.length) return 0; a.sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
function graphs(S, search, days, currentDid) {
  const nowSecs = Date.now() / 1000;
  const t = timingToday(Math.floor(nowSecs), S.meta);
  const nextDayStart = t.nextDayAt, daysElapsed = t.daysElapsed;
  const localOffset = -new Date().getTimezoneOffset() * 60;
  const all = !search.trim();
  // 検索の書き間違いは Anki と同じく失敗として返す（画面側が「Error: 500: 無効な検索:…」の警告を出す。文面のバッククォートは AnkiMobile と同じく除く）
  let cards; try { cards = all ? S.cards : searchCards(S, search, currentDid); } catch (e) { throw new Error(displayText(e.message)); }
  const cids = new Set(cards.map(c => c.id));
  const revStartMs = days > 0 ? (nextDayStart - (days + 1) * 86400) * 1000 : 0;
  const revlog = S.revlog.filter(r => r.id >= revStartMs && (all || cids.has(r.cid))).sort((a, b) => a.id - b.id);
  const secs = r => Math.floor(r.id / 1000);
  // today
  const today = { answer_count: 0, answer_millis: 0, correct_count: 0, mature_correct: 0, mature_count: 0, learn_count: 0, review_count: 0, relearn_count: 0, early_review_count: 0 };
  for (const r of revlog) {
    if (r.id < (nextDayStart - 86400) * 1000 || r.type === KIND.MANUAL || r.type === KIND.RESCHEDULED) continue;
    today.answer_count++; today.answer_millis += r.time;
    if (r.ease > 1) today.correct_count++;
    if (r.lastIvl >= 21) { today.mature_count++; if (r.ease > 1) today.mature_correct++; }
    if (r.type === KIND.LEARN) today.learn_count++; else if (r.type === KIND.REVIEW) today.review_count++; else if (r.type === KIND.RELEARN) today.relearn_count++; else if (r.type === KIND.FILTERED) today.early_review_count++;
  }
  // future_due
  const futureDue = {}; let haveBacklog = false, dailyLoad = 0;
  for (const c of cards) {
    if (c.type === 0 || c.queue === -1) continue;
    const due = c.due; const dueDay = due > 1e9 ? Math.trunc((due - nextDayStart) / 86400) : due - daysElapsed;
    dailyLoad += 1 / Math.max(1, c.ivl);
    if (dueDay <= 0 && (c.queue === -2 || c.queue === -3)) continue;
    haveBacklog ||= dueDay < 0; futureDue[dueDay] = (futureDue[dueDay] || 0) + 1;
  }
  // intervals・stability・eases・difficulty
  const intervals = {}, stability = {}, eases = {}, difficulty = {}; const easeVals = [], diffVals = [];
  const mem = c => (c.data && c.data.s != null && c.data.d != null ? c.data : null);
  for (const c of cards) {
    if (c.type === 2 || c.type === 3) intervals[c.ivl] = (intervals[c.ivl] || 0) + 1;
    const m = mem(c);
    if (m) { const k = Math.round(m.s); stability[k] = (stability[k] || 0) + 1; const d = (m.d - 1) / 9; const b = percentToBin(d * 100); difficulty[b] = (difficulty[b] || 0) + 1; diffVals.push(d); }
    else if (c.type === 2 || c.type === 3) { const b = Math.trunc(c.factor / 10); eases[b] = (eases[b] || 0) + 1; easeVals.push(c.factor); }
  }
  // retrievability
  const retr = {}; let rSum = 0, rN = 0; const byNote = new Map();
  for (const c of cards) {
    const e = byNote.get(c.nid) || [0, 0]; e[1]++;
    const m = mem(c);
    if (m) {
      let el = 0;
      if (m.lrt) el = Math.max(0, nowSecs - m.lrt);
      else if (c.type === 2 || c.type === 3) el = Math.max(0, (daysElapsed - (c.due - c.ivl)) * 86400);
      const decay = m.decay ?? 0.5; const factor = Math.pow(0.9, 1 / -decay) - 1;
      const r = Math.pow(1 + factor * (el / 86400) / m.s, -decay);
      const b = percentToBin(r * 100); retr[b] = (retr[b] || 0) + 1; rSum += r; rN++; e[0] += r;
    }
    byNote.set(c.nid, e);
  }
  let sumByNote = 0; for (const [s, n] of byNote.values()) sumByNote += s / n;
  // hours・buttons
  const hour = () => Array.from({ length: 24 }, () => ({ total: 0, correct: 0 }));
  const hours = { one_month: hour(), three_months: hour(), one_year: hour(), all_time: hour() };
  const btn = () => ({ learning: [0, 0, 0, 0], young: [0, 0, 0, 0], mature: [0, 0, 0, 0] });
  const buttons = { one_month: btn(), three_months: btn(), one_year: btn(), all_time: btn() };
  const since = n => nextDayStart - 86400 * n;
  for (const r of revlog) {
    const s = secs(r);
    if (!(r.type === KIND.FILTERED || r.type === KIND.MANUAL || r.type === KIND.RESCHEDULED)) {
      const h = Math.floor((s + localOffset) / 3600) % 24; const ok = r.ease > 1;
      const inc = arr => { arr[h].total++; if (ok) arr[h].correct++; };
      inc(hours.all_time); if (s >= since(365)) { inc(hours.one_year); if (s >= since(90)) { inc(hours.three_months); if (s >= since(30)) inc(hours.one_month); } }
    }
    const bucket = r.type === KIND.REVIEW ? (r.lastIvl < 21 ? 'young' : 'mature') : (r.type === KIND.LEARN || r.type === KIND.RELEARN || r.type === KIND.FILTERED) ? 'learning' : null;
    if (!bucket || r.ease < 1 || r.ease > 4) continue;
    const i = r.ease - 1;
    buttons.all_time[bucket][i]++; if (s >= since(365)) { buttons.one_year[bucket][i]++; if (s >= since(90)) { buttons.three_months[bucket][i]++; if (s >= since(30)) buttons.one_month[bucket][i]++; } }
  }
  // card_counts
  const counts = () => ({ newCards: 0, learn: 0, relearn: 0, young: 0, mature: 0, suspended: 0, buried: 0 });
  const incl = counts(), excl = counts();
  const incC = (o, c) => { if (c.type === 0) o.newCards++; else if (c.type === 1) o.learn++; else if (c.type === 2) { if (c.ivl < 21) o.young++; else o.mature++; } else if (c.type === 3) o.relearn++; };
  for (const c of cards) { if (c.queue === -1) excl.suspended++; else if (c.queue === -2 || c.queue === -3) excl.buried++; else incC(excl, c); incC(incl, c); }
  // added
  const added = {}; for (const c of cards) { const d = Math.ceil((Math.floor(c.id / 1000) - nextDayStart) / 86400); added[d] = (added[d] || 0) + 1; }
  // reviews（回数と時間）
  const rc = {}, rt = {};
  for (const r of revlog) {
    if (r.type === KIND.MANUAL || r.type === KIND.RESCHEDULED) continue;
    const d = Math.trunc((secs(r) - nextDayStart) / 86400);
    const c = (rc[d] ||= { learn: 0, relearn: 0, young: 0, mature: 0, filtered: 0 }), tm = (rt[d] ||= { learn: 0, relearn: 0, young: 0, mature: 0, filtered: 0 });
    const k = r.type === KIND.LEARN ? 'learn' : r.type === KIND.RELEARN ? 'relearn' : r.type === KIND.REVIEW ? (r.lastIvl < 21 ? 'young' : 'mature') : 'filtered';
    c[k]++; tm[k] += r.time;
  }
  // true_retention
  const per = [['today', since(1), nextDayStart], ['yesterday', since(2), since(1)], ['week', since(7), nextDayStart], ['month', since(30), nextDayStart], ['year', since(365), nextDayStart], ['all_time', 0, nextDayStart]];
  const tr = Object.fromEntries(per.map(([n]) => [n, { young_passed: 0, young_failed: 0, mature_passed: 0, mature_failed: 0 }]));
  for (const r of revlog) {
    const affects = r.ease >= 1 && r.ease <= 4 && r.type !== KIND.MANUAL && r.type !== KIND.RESCHEDULED && !(r.type === KIND.FILTERED && r.factor === 0);
    if (!affects || !(r.type === KIND.REVIEW || r.lastIvl <= -86400 || r.lastIvl >= 1)) continue;
    const s = secs(r);
    for (const [n, a, b] of per) if (s >= a && s < b) { const o = tr[n]; const young = r.lastIvl < 21; if (r.ease === 1) young ? o.young_failed++ : o.mature_failed++; else young ? o.young_passed++ : o.mature_passed++; }
  }
  // 書き出し（GraphsResponse）
  const w = new W();
  const btnCounts = (w2, b) => { w2.packed(1, b.learning); w2.packed(2, b.young); w2.packed(3, b.mature); };
  w.msg(1, x => { x.msg(1, y => btnCounts(y, buttons.one_month)); x.msg(2, y => btnCounts(y, buttons.three_months)); x.msg(3, y => btnCounts(y, buttons.one_year)); x.msg(4, y => btnCounts(y, buttons.all_time)); });
  const cnt = (x, o) => { x.u32(1, o.newCards); x.u32(2, o.learn); x.u32(3, o.relearn); x.u32(4, o.young); x.u32(5, o.mature); x.u32(6, o.suspended); x.u32(7, o.buried); };
  w.msg(2, x => { x.msg(1, y => cnt(y, incl)); x.msg(2, y => cnt(y, excl)); });
  const hrs = (x, f, arr) => { for (const h of arr) x.msg(f, y => { y.u32(1, h.total); y.u32(2, h.correct); }); };
  w.msg(3, x => { hrs(x, 1, hours.one_month); hrs(x, 2, hours.three_months); hrs(x, 3, hours.one_year); hrs(x, 4, hours.all_time); });
  w.msg(4, x => { const o = today; [o.answer_count, o.answer_millis, o.correct_count, o.mature_correct, o.mature_count, o.learn_count, o.review_count, o.relearn_count, o.early_review_count].forEach((v, i) => x.u32(i + 1, v)); });
  const u32map = (x, f, obj) => x.mapNum(f, obj, (y, v) => { y.tag(2, 0); y.varint(v); });
  w.msg(5, x => { u32map(x, 1, eases); x.f32(2, median(easeVals) / 10); });
  w.msg(11, x => { u32map(x, 1, difficulty); x.f32(2, median(diffVals) * 100); });
  w.msg(6, x => u32map(x, 1, intervals));
  w.msg(7, x => { u32map(x, 1, futureDue); x.bool(2, haveBacklog); x.u32(3, Math.trunc(dailyLoad)); });
  w.msg(8, x => u32map(x, 1, added));
  const rv = (y, o) => { y.u32(1, o.learn); y.u32(2, o.relearn); y.u32(3, o.young); y.u32(4, o.mature); y.u32(5, o.filtered); };
  w.msg(9, x => { x.mapNum(1, rc, (y, v) => y.msg(2, z => rv(z, v))); x.mapNum(2, rt, (y, v) => y.msg(2, z => rv(z, v))); });
  w.u32(10, S.meta.config.rollover ?? 4);
  w.msg(12, x => { u32map(x, 1, retr); x.f32(2, rN ? rSum * 100 / rN : 0); x.f32(3, rSum); x.f32(4, sumByNote); });
  w.bool(13, !!S.meta.config.fsrs);
  w.msg(14, x => u32map(x, 1, stability));
  const trm = (y, o) => { y.u32(1, o.young_passed); y.u32(2, o.young_failed); y.u32(3, o.mature_passed); y.u32(4, o.mature_failed); };
  w.msg(15, x => per.forEach(([n], i) => x.msg(i + 1, y => trm(y, tr[n]))));
  return w.done();
}

// ---------- 課題を終えた画面（rslib scheduler/congrats.rs と storage/card/congrats.sql） ----------
function congrats(S, did) {
  const deck = S.decksById.get(did);
  const ids = deck ? new Set(S.meta.decks.filter(d => d.name === deck.name || d.name.startsWith(deck.name + '::')).map(d => d.id)) : null;
  const cards = ids ? S.cards.filter(c => ids.has(c.did)) : [];
  const t = timingToday(Math.floor(Date.now() / 1000), S.meta);
  let review = 0, nw = 0, sb = 0, ub = 0, learn = 0, firstLearn = null;
  for (const c of cards) {
    if ((c.queue === 2 || c.queue === 3) && c.due <= t.daysElapsed) review++;
    if (c.queue === 0) nw++; if (c.queue === -2) sb++; if (c.queue === -3) ub++;
    if (c.queue === 1) { learn++; if (firstLearn == null || c.due < firstLearn) firstLearn = c.due; }
  }
  const nextDue = Math.max(0, firstLearn ?? 0);
  const secsUntil = nextDue === 0 ? 86400 : Math.max(60, Math.trunc(nextDue - (S.meta.config.collapseTime ?? 1200) - Date.now() / 1000));
  const w = new W();
  w.u32(1, learn); w.u32(2, secsUntil); w.bool(3, review > 0); w.bool(4, nw > 0); w.bool(5, sb > 0); w.bool(6, ub > 0); w.bool(7, did === 'session'); w.bool(8, true); w.str(9, deck?.desc || '');
  return w.done();
}

// ---------- 画面の好み（GraphPreferences） ----------
const PREF_KEY = 'graphPrefs';
function getPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } }

let i18nCache = null;
// ---------- カード情報（rslib stats/card.rs の card_stats → CardStatsResponse） ----------
const presetParams = p => (p?.fsrsParams6?.length ? p.fsrsParams6 : p?.fsrsParams5?.length ? p.fsrsParams5 : p?.fsrsWeights || []);
function ignoreBeforeMs(p) { const s = p?.ignoreRevlogsBeforeDate || ''; if (!s) return 0; const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : 0; }
export function cardStatsData(S, cid, nowSecs = Math.floor(Date.now() / 1000)) {
  const F = Math.fround;
  const c = S.byId.get(cid); if (!c) throw new Error('card not found: ' + cid);
  const nt = S.meta.notetypes[c.mid] || {}, home = S.decksById.get(c.did);
  const preset = S.meta.presets[home?.conf] || S.meta.presets[1] || {};
  const revs = S.revlog.filter(r => r.cid === cid).sort((a, b) => a.id - b.id)
    .map(r => ({ id: r.id, button: r.ease, ivl: r.ivl, factor: r.factor, time: r.time, type: r.type }));
  const t = timingToday(nowSecs, S.meta), d = c.data || {};
  // 平均・合計の時間（f32 で足す）
  let total = 0; for (const r of revs) total = F(total + F(r.time / 1000));
  const n = revs.filter(r => r.button > 0).length;
  const [avg, tot] = n === 0 || total === 0 ? [0, 0] : [F(total / n), total];
  // 最後に答えた時刻（カードに無ければ記録から: 評価 1〜4・詰め込みを除く）
  let lrt = d.lrt;
  if (lrt == null) { let last = null; for (const r of revs) if (r.button >= 1 && r.button <= 4 && (r.type !== 3 || r.factor !== 0)) last = Math.trunc(r.id / 1000); lrt = last ?? 0; }
  const secs = Number(BigInt.asUintN(32, BigInt(nowSecs - lrt)));
  const ms = d.s != null && d.d != null ? { s: F(d.s), d: F(d.d) } : null;
  // 期日・位置（フィルターデッキの中なら、元の期日。無ければそのデッキの期日）
  let dueDate = null;
  if (c.type !== 0) {
    const due = c.inDyn ? (c.due || c.dynDue || 0) : c.due;
    dueDate = due > 1e9 ? due : nowSecs + (due - t.daysElapsed) * 86400;
  }
  const position = d.pos != null ? d.pos : c.type === 0 ? (c.inDyn ? (c.dynDue ?? c.due) : c.due) : null;
  // 記録ごとの記憶の値
  const hist = historicalStates(presetParams(preset), revs, t.nextDayAt, F(preset.sm2Retention ?? 0.9), ignoreBeforeMs(preset));
  const rows = revs.map(e => ({ e, ms: undefined }));
  if (hist) {
    let i = 0; const st = hist.states, fl = hist.filtered;
    for (const r of rows) {
      if (i >= st.length) r.ms = st[st.length - 1];
      else if (r.e.id === fl[i].id) { i++; r.ms = st[i - 1]; }
      else if (i === 0) r.ms = null;
      else r.ms = st[i];
    }
  }
  const tmpl = (nt.type === 1 ? nt.templates?.[0] : nt.templates?.find(x => x.ord === c.ord) ?? nt.templates?.[c.ord]) || {};
  return {
    revlog: rows.reverse().map(({ e, ms }) => ({ time: Math.trunc(e.id / 1000), reviewKind: e.type, buttonChosen: e.button, interval: e.ivl > 0 ? e.ivl * 86400 : -e.ivl, ease: e.factor, takenSecs: F(e.time / 1000), memoryState: ms || null })),
    cardId: c.id, noteId: c.nid, deck: c.inDyn && c.dynName ? c.dynName : home?.name || '',
    added: Math.trunc(c.id / 1000), firstReview: revs.length ? Math.trunc(revs[0].id / 1000) : null, latestReview: revs.length ? Math.trunc(revs[revs.length - 1].id / 1000) : null,
    dueDate, duePosition: position, interval: c.ivl, ease: c.factor, reviews: c.reps, lapses: c.lapses, averageSecs: avg, totalSecs: tot,
    cardType: tmpl.name || c.tname || '', notetype: nt.name || '', memoryState: ms,
    fsrsRetrievability: ms ? retrievability(ms.s, secs, F(d.decay ?? FSRS5_DEFAULT_DECAY)) : null,
    customData: d.cd || '', preset: preset.name || '', originalDeck: c.inDyn && c.dynName ? home?.name || '' : null,
    desiredRetention: d.dr != null ? F(d.dr) : null, fsrsParams: presetParams(preset).map(F),
  };
}
export function cardStatsBytes(x) {
  const w = new W();
  const msg = (ww, f, m) => ww.msg(f, y => { y.f32(1, m.s); y.f32(2, m.d); });
  for (const r of x.revlog) w.msg(1, y => { y.i32(1, r.time); y.i32(2, r.reviewKind); y.u32(3, r.buttonChosen); y.u32(4, r.interval); y.u32(5, r.ease); y.f32(6, r.takenSecs); if (r.memoryState) msg(y, 7, r.memoryState); });
  w.i32(2, x.cardId); w.i32(3, x.noteId); w.str(4, x.deck); w.i32(5, x.added);
  if (x.firstReview != null) w.u32o(6, x.firstReview); if (x.latestReview != null) w.u32o(7, x.latestReview);
  if (x.dueDate != null) w.u32o(8, x.dueDate); if (x.duePosition != null) w.u32o(9, x.duePosition);
  w.u32(10, x.interval); w.u32(11, x.ease); w.u32(12, x.reviews); w.u32(13, x.lapses); w.f32(14, x.averageSecs); w.f32(15, x.totalSecs);
  w.str(16, x.cardType); w.str(17, x.notetype); if (x.memoryState) msg(w, 18, x.memoryState);
  if (x.fsrsRetrievability != null) w.f32o(19, x.fsrsRetrievability); w.str(20, x.customData); w.str(21, x.preset);
  if (x.originalDeck != null) w.str(22, x.originalDeck); if (x.desiredRetention != null) w.f32o(23, x.desiredRetention); w.floats(24, x.fsrsParams);
  return w.done();
}

// ---------- FSRS の計算の頼みと進み具合 ----------
function simRequest(m) {
  return { params: f32sOf(m[1]), desiredRetention: f1(m, 2), deckSize: f1(m, 3), daysToSimulate: f1(m, 4), newLimit: f1(m, 5), reviewLimit: f1(m, 6), maxInterval: f1(m, 7),
    search: str(f1(m, 8, null)), newCardsIgnoreReviewLimit: !!f1(m, 9), easyDaysPercentages: f32sOf(m[10]), reviewOrder: f1(m, 11), suspendAfterLapseCount: m[12] ? f1(m, 12) : null,
    historicalRetention: f1(m, 13), learningStepCount: f1(m, 14), relearningStepCount: f1(m, 15) };
}
// collection.proto Progress（oneof: none=1・compute_params=9・compute_retention=10・compute_memory=11）
function progressBytes(p) {
  const w = new W();
  if (!p) w.msg(1, () => {});
  else if (p.kind === 'computeParams') w.msg(9, y => { y.u32(1, p.current); y.u32(2, p.total); y.u32(3, p.reviews); y.u32(4, p.currentPreset); y.u32(5, p.totalPresets); });
  else if (p.kind === 'computeRetention') w.msg(10, y => { y.u32(1, p.current); y.u32(2, p.total); });
  else if (p.kind === 'computeMemory') w.msg(11, y => { y.u32(1, p.current); y.u32(2, p.total); y.str(3, p.label || ''); });
  else w.msg(1, () => {});
  return w.done();
}

export function installAnkiBackend(getS, currentDid, hooks = {}) {
  window.ankiBackend = async (method, body, query) => {
    body = Uint8Array.from(body || []); // 画面（iframe）側で作られた配列は instanceof が効かないので、こちらの側で作り直す
    const S = getS();
    const q = new URLSearchParams(query || '');
    const did = q.get('did') === 'session' ? 'session' : q.get('did') ? +q.get('did') : currentDid();
    if (method === 'graphs') { const m = read(body); const q = str(m[1]?.[0]); if (q.trim()) await loadNotes(S, new URL('../bundle/', location.href).href); return graphs(S, q, m[2]?.[0] || 0, did); }
    if (method === 'congratsInfo') return congrats(S, did);
    if (method === 'cardStats') { const m = read(body); return cardStatsBytes(cardStatsData(S, f1(m, 1))); }
    if (method === 'getGraphPreferences') {
      const p = getPrefs(); const w = new W();
      w.i32(1, p.firstDay ?? 0); w.bool(2, !!p.separateInactive); w.bool(3, false); w.bool(4, p.showBacklog ?? true); return w.done();
    }
    if (method === 'setGraphPreferences') {
      const m = read(body); try { localStorage.setItem(PREF_KEY, JSON.stringify({ firstDay: m[1]?.[0] || 0, separateInactive: !!m[2]?.[0], showBacklog: !!m[4]?.[0] })); } catch {}
      return new Uint8Array();
    }
    if (method === 'i18nResources') {
      if (!i18nCache) i18nCache = new Uint8Array(await (await fetch(new URL('../i18n_anki.json', location.href))).arrayBuffer());
      const w = new W(); w.bytes(1, i18nCache); return w.done();
    }
    if (method === 'getDeckConfigsForUpdate') { const m = read(body); return deckConfigsForUpdate(S, f1(m, 1) || did); }
    if (method === 'updateDeckConfigs') { const req = parseUpdate(S, body); await hooks.updateDeckConfigs?.(req); setTimeout(() => hooks.close?.(), 50); return new Uint8Array(); }
    if (method === 'deckOptionsRequireClose') { hooks.close?.(); return new Uint8Array(); }
    if (method === 'deckOptionsReady') return new Uint8Array();
    // ---- FSRS の計算（最適化・評価・シミュレーター・保持率）。重い計算は Web Worker で（app/fsrsjobs.mjs） ----
    if (method === 'latestProgress') return progressBytes(jobs.latestProgress());
    if (method === 'setWantsAbort') { jobs.wantAbort(); return new Uint8Array(); }
    if (method === 'computeFsrsParams') {
      const m = read(body);
      const r = await jobs.computeFsrsParams(S, did, { search: str(f1(m, 1, null)), currentParams: f32sOf(m[2]), ignoreBeforeMs: f1(m, 3), numRelearningSteps: f1(m, 4), healthCheck: !!f1(m, 5) });
      const w = new W(); w.floats(1, r.params); w.u32(2, r.fsrsItems); if (r.healthCheckPassed != null) { w.tag(3, 0); w.varint(r.healthCheckPassed ? 1 : 0); } return w.done();
    }
    if (method === 'evaluateParamsLegacy') {
      const m = read(body);
      const r = await jobs.evaluateParams(S, did, { params: f32sOf(m[1]), search: str(f1(m, 2, null)), ignoreBeforeMs: f1(m, 3) });
      const w = new W(); w.f32(1, r.logLoss); w.f32(2, r.rmseBins); return w.done();
    }
    if (method === 'simulateFsrsReview' || method === 'simulateFsrsWorkload' || method === 'computeOptimalRetention') {
      const req = simRequest(read(body));
      if (method === 'simulateFsrsReview') {
        const r = await jobs.simulateFsrsReview(S, did, req);
        const w = new W(); w.floats(1, r.memorized); w.packed(2, r.reviewCount); w.packed(3, r.newCount); w.floats(4, r.cost); return w.done();
      }
      if (method === 'simulateFsrsWorkload') {
        const r = await jobs.simulateFsrsWorkload(S, did, req);
        const w = new W(); w.mapNum(1, r.cost, (y, v) => y.f32o(2, v)); w.mapNum(2, r.memorized, (y, v) => y.f32o(2, v)); w.mapNum(3, r.reviewCount, (y, v) => y.u32o(2, v)); return w.done();
      }
      const v = await jobs.computeOptimalRetention(S, did, req);
      const w = new W(); w.f32o(1, v); return w.done();
    }
    if (method === 'getRetentionWorkload') {
      const m = read(body);
      const costs = await jobs.getRetentionWorkload(S, did, f32sOf(m[1]), str(f1(m, 2, null)));
      const w = new W(); w.mapNum(1, costs, (y, v) => y.f32o(2, v)); return w.done();
    }
    if (method === 'getIgnoredBeforeCount') {
      const m = read(body);
      const r = await jobs.ignoredBeforeCount(S, did, str(f1(m, 1, null)), str(f1(m, 2, null)));
      const w = new W(); w.u32(1, r.included); w.u32(2, r.total); return w.done();
    }
    throw new Error('この画面の機能はまだありません: ' + method);
  };
  window.ankiIsDark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}
