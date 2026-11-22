// デッキのオプションの FSRS の計算（最適化・評価・シミュレーター・最適な保持率・保持率ごとの手間）を、端末の中のデータから組み立てて Web Worker で回す。
// rslib の Collection 側（検索して記録を集める・記憶の値の無いカードを補う・進み具合 LatestProgress・中止 SetWantsAbort）にあたる部分
import { searchCards, loadNotes } from './search.mjs';
import { timingToday } from '../fsrs/sched.mjs';
import { historicalStates } from '../fsrs/history.mjs';
import { computeParams, evaluateParamsLegacy } from '../fsrs/optimize.mjs';
import * as simlib from '../fsrs/simulate.mjs';
import { modelParams } from '../fsrs/memory.mjs';

const WORKER_URL = new URL('../fsrs/worker.mjs', import.meta.url);
const F = Math.fround;

// ---------- 進み具合と中止 ----------
let progress = null;            // { kind: 'computeParams'|'computeRetention'|'computeMemory', ... }
const live = new Set();         // 動いている Worker
let abortFlag = false;
export const latestProgress = () => progress;
export function setProgress(p) { progress = p; }
export function wantAbort() {
  abortFlag = true;
  for (const w of live) { try { w.terminate(); } catch {} w._fail?.(new Error('Interrupted')); }
  live.clear();
}
const poolSize = () => Math.max(1, Math.min(8, (globalThis.navigator?.hardwareConcurrency || 2) - 1));
const canWork = () => typeof Worker !== 'undefined';
function spawn() {
  const w = new Worker(WORKER_URL, { type: 'module' });
  const waits = new Map(); let seq = 0;
  w._fail = err => { for (const [, x] of waits) x.reject(err); waits.clear(); };
  w.onmessage = e => { const m = e.data, x = waits.get(m.id); if (!x) return; if (m.progress) { x.onProgress?.(...m.progress); return; } waits.delete(m.id); if ('error' in m) x.reject(new Error(m.error)); else x.resolve(m.result); };
  w.onerror = e => { e.preventDefault?.(); w._fail(new Error(e.message || 'worker error')); };
  w.call = (msg, onProgress) => new Promise((resolve, reject) => { const id = ++seq; waits.set(id, { resolve, reject, onProgress }); w.postMessage({ ...msg, id }); });
  live.add(w);
  return w;
}
const done = w => { live.delete(w); try { w.terminate(); } catch {} };
async function withWorkers(n, fn) {
  abortFlag = false;
  const ws = Array.from({ length: n }, spawn);
  try { return await fn(ws); }
  catch (e) { if (abortFlag) throw new Error('Interrupted'); throw e; }
  finally { ws.forEach(done); }
}

// ---------- 端末のデータから集める ----------
const REV = r => ({ id: r.id, cid: r.cid, ease: r.ease, ivl: r.ivl, lastIvl: r.lastIvl, factor: r.factor, time: r.time, type: r.type });
// 検索に合ったカードの記録（カード番号の順・id の順。rslib get_revlog_entries_for_searched_cards_in_card_order）
function revlogsFor(S, cards) {
  const ids = new Set(cards.map(c => c.id));
  return S.revlog.filter(r => ids.has(r.cid)).sort((a, b) => a.cid - b.cid || a.id - b.id).map(REV);
}
async function find(S, search, did) {
  if (search.trim()) await loadNotes(S, new URL('../bundle/', location.href).href);
  return searchCards(S, search, did);
}
const presetOf = (S, c) => { const home = S.decksById.get(c.did); return S.meta.presets[home?.conf] || S.meta.presets[1] || {}; };
export const presetParams = p => (p?.fsrsParams6?.length ? p.fsrsParams6 : p?.fsrsParams5?.length ? p.fsrsParams5 : p?.fsrsWeights || []);
// rslib ignore_revlogs_before_date_to_ms（日付の 0 時 UTC）
export function ignoreBeforeMs(p) { const s = p?.ignoreRevlogsBeforeDate || ''; const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : 0; }
function revsByCard(S) {
  const by = new Map();
  for (const r of S.revlog) { let a = by.get(r.cid); if (!a) by.set(r.cid, a = []); a.push(r); }
  for (const a of by.values()) a.sort((x, y) => x.id - y.id);
  return by;
}
// rslib compute_memory_state（カードのプリセットのパラメータ・過去の保持率・「この日より前は無視」で記録から）
export function memoryFromRevlog(S, c, revs, nextDayAt) {
  const p = presetOf(S, c);
  const entries = (revs || []).map(r => ({ id: r.id, button: r.ease, ivl: r.ivl, factor: r.factor, time: r.time, type: r.type }));
  let w; try { w = modelParams(presetParams(p)); } catch { return null; }
  const h = historicalStates(w, entries, nextDayAt, F(p.sm2Retention ?? 0.9), ignoreBeforeMs(p));
  return h && h.states.length ? h.states[h.states.length - 1] : null;
}
const isIncluded = c => c.queue !== -1 && c.queue !== 4 && c.type !== 0;
const slim = c => ({ id: c.id, queue: c.queue, type: c.type, due: c.due, ivl: c.ivl, factor: c.factor, lapses: c.lapses, inDyn: c.inDyn ? 1 : 0, dynDue: c.dynDue });
function memsFor(S, cards, nextDayAt, computeMissing) {
  const mems = {}; let by = null;
  for (const c of cards) {
    const d = c.data || {};
    if (d.s != null && d.d != null) { mems[c.id] = [d.s, d.d]; continue; }
    if (!computeMissing || !isIncluded(c)) continue;
    by ||= revsByCard(S);
    const m = memoryFromRevlog(S, c, by.get(c.id), nextDayAt); if (m) mems[c.id] = [m.s, m.d];
  }
  return mems;
}
async function simCtx(S, req, did) {
  const t = timingToday(Math.floor(Date.now() / 1000), S.meta);
  const cards = await find(S, req.search, did);
  const intro = searchCards(S, `${req.search} introduced:1`, did).length;
  // 記録から作る設定（押した時間・評価の割合）はここで作り、Worker には記録を送らない
  return { cards: cards.map(slim), extracted: simlib.extractSimulatorConfig(revlogsFor(S, cards), t.nextDayAt, true), daysElapsed: t.daysElapsed, nextDayAt: t.nextDayAt, introducedToday: intro,
    loadBalancer: S.meta.config?.loadBalancerEnabled !== false, mems: memsFor(S, cards, t.nextDayAt, true) };
}

// ---------- 画面からの頼み ----------
// ComputeFsrsParams（rslib compute_fsrs_params → compute_params）
export async function computeFsrsParams(S, did, q, { preset = 1, presets = 1 } = {}) {
  const t = timingToday(Math.floor(Date.now() / 1000), S.meta);
  const cards = await find(S, q.search, did);
  const args = { revlogs: revlogsFor(S, cards), nextDayAt: t.nextDayAt, ignoreBeforeMs: q.ignoreBeforeMs, currentParams: q.currentParams, numRelearningSteps: q.numRelearningSteps, healthCheck: q.healthCheck };
  progress = { kind: 'computeParams', current: 0, total: 0, reviews: 0, currentPreset: preset, totalPresets: presets };
  const onProgress = (cur, total, reviews) => { progress = { ...progress, current: cur, total, ...(reviews != null ? { reviews } : {}) }; };
  if (!canWork()) return computeParams({ ...args, onProgress });
  return withWorkers(1, async ([w]) => {
    const r = await w.call({ op: 'computeParams', args }, onProgress);
    progress = { ...progress, reviews: r.reviewCount };
    return r;
  });
}
export async function evaluateParams(S, did, q) {
  const t = timingToday(Math.floor(Date.now() / 1000), S.meta);
  const cards = await find(S, q.search, did);
  const args = { revlogs: revlogsFor(S, cards), nextDayAt: t.nextDayAt, ignoreBeforeMs: q.ignoreBeforeMs, params: q.params };
  progress = { kind: 'computeParams', current: 0, total: 0, reviews: 0, currentPreset: 0, totalPresets: 0 };
  const onProgress = (cur, total, reviews) => { progress = { ...progress, current: cur, total, ...(reviews != null ? { reviews } : {}) }; };
  if (!canWork()) return evaluateParamsLegacy({ ...args, onProgress });
  return withWorkers(1, ([w]) => w.call({ op: 'evaluate', args }, onProgress));
}
export async function simulateFsrsReview(S, did, req) {
  const ctx = await simCtx(S, req, did);
  if (!canWork()) return simlib.simulateReview(req, ctx);
  return withWorkers(1, ([w]) => w.call({ op: 'simulateReview', req, ctx }));
}
// 保持率 70〜99% ごとのシミュレーション（rslib simulate_workload）。保持率を Worker に分けて並べて回す
export async function simulateFsrsWorkload(S, did, req) {
  const ctx = await simCtx(S, req, did);
  const drs = []; for (let dr = 70; dr <= 99; dr++) drs.push(dr);
  if (!canWork()) return simlib.simulateWorkload(req, ctx);
  return withWorkers(Math.min(poolSize(), drs.length), async ws => {
    await Promise.all(ws.map(w => w.call({ op: 'simSetup', req, ctx })));
    const parts = ws.map((_, i) => drs.filter((_, j) => j % ws.length === i));
    const rows = (await Promise.all(ws.map((w, i) => w.call({ op: 'simWorkload', drs: parts[i] })))).flat();
    const out = { cost: {}, memorized: {}, reviewCount: {} };
    for (const [dr, mem, cost, n] of rows) { out.memorized[dr] = mem; out.cost[dr] = cost; out.reviewCount[dr] = n; }
    return out;
  });
}
// 最適な保持率（rslib compute_optimal_retention → fsrs-rs optimal_retention の brent）。1回の評価の n 本のシミュレーションを Worker に分ける
export async function computeOptimalRetention(S, did, req) {
  if (!req.daysToSimulate) throw new Error('no days to simulate');
  const ctx = await simCtx(S, req, did);
  progress = { kind: 'computeRetention', current: 0, total: 0 };
  const n = simlib.sampleSize(req.daysToSimulate);
  if (!canWork()) return Math.min(0.95, Math.max(0.7, simlib.computeOptimalRetention(req, ctx)));
  return withWorkers(Math.min(poolSize(), n), async ws => {
    await Promise.all(ws.map(w => w.call({ op: 'simSetup', req, ctx })));
    let count = 0;
    const v = await simlib.optimalRetentionAsync(async dr => {
      if (abortFlag) throw new Error('Interrupted');
      progress = { kind: 'computeRetention', current: ++count, total: 0 };
      const seeds = Array.from({ length: n }, (_, i) => i + 42);
      const parts = ws.map((_, i) => seeds.filter((_, j) => j % ws.length === i));
      const got = await Promise.all(ws.map((w, i) => (parts[i].length ? w.call({ op: 'simTargets', dr, seeds: parts[i] }) : [])));
      const vals = seeds.map((_, j) => got[j % ws.length][Math.floor(j / ws.length)]);   // 種の順に並べ直して足す
      return simlib.averageTargets(vals);
    });
    return Math.min(0.95, Math.max(0.7, v));
  });
}
// 保持率を変えたときの手間の倍率（rslib get_retention_workload）
export async function getRetentionWorkload(S, did, w, search) {
  const t = timingToday(Math.floor(Date.now() / 1000), S.meta);
  const cards = await find(S, search, did);
  const ctx = { cards: cards.map(slim), extracted: simlib.extractSimulatorConfig(revlogsFor(S, cards), t.nextDayAt, true), daysElapsed: t.daysElapsed, nextDayAt: t.nextDayAt, mems: memsFor(S, cards, t.nextDayAt, false) };
  const drs = []; for (let dr = 70; dr <= 99; dr++) drs.push(dr);
  if (!canWork()) return simlib.retentionWorkload(w, ctx);
  return withWorkers(Math.min(poolSize(), drs.length), async ws => {
    await Promise.all(ws.map(x => x.call({ op: 'wlSetup', ctx })));
    const parts = ws.map((_, i) => drs.filter((_, j) => j % ws.length === i));
    const rows = (await Promise.all(ws.map((x, i) => x.call({ op: 'workload', params: w, drs: parts[i] })))).flat();
    return Object.fromEntries(rows);
  });
}
// 「この日より前は無視」で残るカードの数（rslib get_ignored_before_count）
export async function ignoredBeforeCount(S, did, dateStr, search) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  const ms = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : 0;
  const cards = await find(S, `${search} -is:new`, did);
  const ids = new Set(cards.map(c => c.id)), inc = new Set();
  for (const r of S.revlog) if (r.id > ms && r.type === 0 && ids.has(r.cid)) inc.add(r.cid);
  return { included: inc.size, total: cards.length };
}
