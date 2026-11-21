// FSRS の重い計算（最適化・評価・シミュレーター・負荷の見積もり）を画面と別のスレッドで回す Web Worker（type: module）。
// 受け取る: { id, op, ...引数 }。返す: { id, progress: [今, 全部] }（途中）・{ id, result }・{ id, error }
// 止めるときは画面の側が terminate する（計算の途中では知らせを受け取れないため）
import { computeParams, evaluateParamsLegacy } from './optimize.mjs';
import { requestToConfig, simulate, simulateReview, cmrr, workloadSetup, expectedWorkloadWithExistingCards, fillParams } from './simulate.mjs';

let sim = null, wl = null;   // 段取り（同じ Worker に何度も頼むとき用）
const F = Math.fround;
self.onmessage = e => {
  const m = e.data, id = m.id;
  let last = 0;
  const progress = (cur, total, reviews) => { const now = Date.now(); if (now - last < 80 && cur < total) return; last = now; self.postMessage({ id, progress: reviews == null ? [cur, total] : [cur, total, reviews] }); };
  try {
    let result;
    switch (m.op) {
      case 'computeParams': result = computeParams({ ...m.args, onProgress: progress }); break;
      case 'evaluate': result = evaluateParamsLegacy({ ...m.args, onProgress: progress }); break;
      case 'simulateReview': result = simulateReview(m.req, m.ctx); break;
      // シミュレーションを何本も（最適な保持率の sample・保持率ごとのシミュレーション）。設定は1回だけ作る
      case 'simSetup': { const { config, cards } = requestToConfig({ req: m.req, ...m.ctx }); sim = { config, cards, params: fillParams(m.req.params) }; result = true; break; }
      case 'simTargets': result = m.seeds.map(seed => cmrr(simulate(sim.config, sim.params, m.dr, seed, sim.cards))); break;
      case 'simWorkload': result = m.drs.map(dr => {
        const r = simulate(sim.config, sim.params, F(dr / 100), 42, sim.cards);
        let cost = 0; for (const c of r.costPerDay) cost = F(cost + c);
        return [dr, r.memorized[r.memorized.length - 1] ?? 0, cost, (r.reviewCnt.reduce((a, b) => a + b, 0) + r.learnCnt.reduce((a, b) => a + b, 0)) >>> 0];
      }); break;
      case 'wlSetup': wl = workloadSetup(m.ctx); result = true; break;
      case 'workload': result = m.drs.map(dr => [dr, expectedWorkloadWithExistingCards(m.params, F(dr / 100), wl.config, wl.cards)]); break;
      default: throw new Error('unknown op ' + m.op);
    }
    self.postMessage({ id, result });
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
