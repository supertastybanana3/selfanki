// デッキのオプションを保存したときの「記憶の値の計算し直し」と「パラメータが変わったら期日を付け直す」を写したもの。
//   rslib scheduler/fsrs/memory_state.rs（update_memory_state・get_last_revlog_info）、rescheduler.rs（Rescheduler）、
//   answering/mod.rs（get_fuzz_seed の for_reschedule）、revlog/mod.rs（log_rescheduled_review）、fsrs-rs の next_interval
// カードは書き換えずに、変わる中身（data・期日・間隔と、足す記録）を返す。書き換えと送信は呼ぶ側（app.mjs）
import { historicalStates } from './history.mjs';
import { clipParameters, fillParams } from './optimize.mjs';
import { fuzzBounds } from './schedule.mjs';
import { StdRng } from './rng.mjs';
import { parseEasyDays, easyDaysModifiers, selectWeightedInterval } from './simulate.mjs';

const F = Math.fround;
const FSRS6_DEFAULT_DECAY = 0.1542, FSRS5_DEFAULT_DECAY = 0.5;
export const roundPlaces = (v, places) => { const f = F(10 ** places); return F(Math.round(F(F(v) * f)) / f); };
// rslib get_decay_from_params
export const decayFromParams = p => (!p || !p.length ? FSRS6_DEFAULT_DECAY : p.length < 21 ? FSRS5_DEFAULT_DECAY : p[20]);
// fsrs-rs FSRS::new（17・19・21 個にそろえて範囲に切る）
export function modelParams(p) { const w = fillParams(p); if (!w) throw new Error('InvalidParameters'); return clipParameters(w, 1, false); }
// fsrs-rs model.rs next_interval（テンソルの演算の順に f32 で）
export function nextIntervalF32(w, s, dr) {
  const decay = F(-w[20]), inv = F(1 / decay), factor = F(F(Math.exp(F(inv * F(Math.log(F(0.9)))))) - 1);
  return F(F(s / factor) * F(F(Math.pow(F(dr), inv)) - 1));
}
const hasRatingAndAffects = r => r.ease > 0 && !(r.type === 3 && r.factor === 0);
const isReset = r => r.type === 4 && r.factor === 0;
// rslib get_last_revlog_info（評価があって期日に効く最後の答えの秒。手動の忘れさせで消える）
function lastReviewedAt(revs) { let last = null; for (const r of revs) { if (hasRatingAndAffects(r)) last = Math.trunc(r.id / 1000); else if (isReset(r)) last = null; } return last; }
const weekdayOf = secs => (new Date(secs * 1000).getDay() + 6) % 7;

// rslib Rescheduler（負荷分散が有効なとき）。期日ごとの復習の数をプリセットごとに数えておき、付け直しのたびに動かす
export class Rescheduler {
  constructor({ cards, revlog, decksById, presets, today, nextDayAt, extra = [] }) {
    this.today = today; this.nextDayAt = nextDayAt; this.due = new Map(); this.dueToday = new Map(); this.reviewed = new Map(); this.easy = new Map();
    const conf = did => decksById.get(did)?.conf;
    const add = (dc, due, n = 1) => { if (dc == null) return; let m = this.due.get(dc); if (!m) this.due.set(dc, m = new Map()); m.set(due, (m.get(due) || 0) + n); };
    for (const c of cards) if (c.type === 2 && c.queue !== -1) add(conf(c.did), c.due);   // deck_due_counts.sql（元のデッキ・元の期日）
    for (const [due, dc] of extra) add(dc, due);   // 移していないデッキの、同じプリセットのカード（今日から先の分だけ届いている）
    for (const [dc, m] of this.due) { let n = 0; for (const [d, k] of m) if (d <= today) n += k; this.dueToday.set(dc, n); }
    // studied_today_by_deck.sql（今日答えたカードの数。詰め込みは除く）
    const start = (nextDayAt - 86400) * 1000, seen = new Set(), byId = new Map(cards.map(c => [c.id, c]));
    for (const r of revlog) {
      if (!(r.id > start && r.ease > 0 && (r.type < 3 || r.factor !== 0)) || seen.has(r.cid)) continue;
      const c = byId.get(r.cid); if (!c) continue; seen.add(r.cid);
      const dc = conf(c.did); if (dc != null) this.reviewed.set(dc, (this.reviewed.get(dc) || 0) + 1);
    }
    for (const [id, p] of Object.entries(presets)) { try { this.easy.set(+id, parseEasyDays(p.easyDaysPercentages)); } catch { this.easy.set(+id, null); } }
  }
  // usize の引き算は Anki（リリース版）では 0 の下で一周する（休止中のカードは数に入っていないのに、付け直しで前の日から引かれる）。
  // ここでは負の数のまま持ち、読むときに 2^64 + 値 にする
  updateDue(before, after, dc) {
    const m = this.due.get(dc);
    if (m) { if (m.has(before)) m.set(before, m.get(before) - 1); m.set(after, (m.get(after) || 0) + 1); }
    if (before <= this.today && after > this.today && this.dueToday.has(dc)) this.dueToday.set(dc, this.dueToday.get(dc) - 1);
    if (before > this.today && after <= this.today) this.dueToday.set(dc, (this.dueToday.get(dc) || 0) + 1);
  }
  findInterval(interval, minimum, maximum, daysElapsed, dc, seed) {
    let [before, after] = fuzzBounds(interval, minimum, maximum);
    if (after < daysElapsed) return null;   // 期日を過ぎているものは付け直さない
    before = Math.max(before, daysElapsed);
    const ivls = []; for (let i = before; i <= after; i++) ivls.push(i);
    const u64 = v => (v < 0 ? 18446744073709551616 + v : v);
    const counts = ivls.map(ivl => u64(ivl > daysElapsed ? (this.due.get(dc)?.get(this.today + ivl - daysElapsed) || 0) : (this.dueToday.get(dc) || 0) + (this.reviewed.get(dc) || 0)));
    const wds = ivls.map(ivl => weekdayOf(this.nextDayAt - daysElapsed * 86400 + (ivl - 1) * 86400));
    const easy = this.easy.get(dc); if (!easy) return null;
    const mods = easyDaysModifiers(easy, wds, counts);
    return selectWeightedInterval(ivls.map((t, i) => ({ target: t, count: counts[i], sibling: 1, easy: mods[i] })), seed);
  }
}

// update_memory_state の1つの組。entry: { cards（その組のデッキの、新規でないカード）, req: { params, presetDr, deckDr: Map(did→保持率), historicalRetention, maxInterval, reschedule } | null（FSRS オフ）, ignoreBefore }
// revsOf(cid): そのカードの記録（id 順）。返すのは変わるカードだけ: { id, data, due?, ivl?, revlog? }
export function updateMemoryState(entry, { revsOf, nextDayAt, today, rescheduler, confOf, nowMs, onProgress }) {
  const { req, ignoreBefore } = entry;
  const w = req ? modelParams(req.params) : null, decay = req ? F(decayFromParams(req.params)) : null;
  const out = []; let ms = nowMs, i = 0;
  const withRevs = entry.cards.map(c => [c, revsOf(c.id)]).filter(([, r]) => r && r.length);   // 記録の無いカードは触らない（chunk_by）
  for (const [c, revs] of withRevs) {
    if (onProgress) onProgress(++i, withRevs.length);
    const data = { ...(c.data || {}) }, ch = { id: c.id };
    if (req) {
      const dr = req.deckDr.has(c.did) ? req.deckDr.get(c.did) : req.presetDr;
      data.dr = roundPlaces(dr, 2); data.decay = roundPlaces(decay, 3);
      const entries = revs.map(r => ({ id: r.id, button: r.ease, ivl: r.ivl, factor: r.factor, time: r.time, type: r.type }));
      const h = historicalStates(w, entries, nextDayAt, F(req.historicalRetention), ignoreBefore);
      if (h && h.states.length) {
        const st = h.states[h.states.length - 1];
        data.s = roundPlaces(st.s, 4); data.d = roundPlaces(st.d, 3);
        const last = req.reschedule ? lastReviewedAt(revs) : null;
        if (last != null && c.type === 2) {
          const daysElapsed = Math.floor(Math.max(0, nextDayAt - last) / 86400);
          const interval = nextIntervalF32(w, F(st.s), F(dr));
          const dc = confOf(c.did), seed = BigInt.asUintN(64, BigInt(c.id) + BigInt(Math.max(0, (c.reps || 0) - 1)));
          let ivl = rescheduler ? rescheduler.findInterval(interval, 1, req.maxInterval, daysElapsed, dc, seed) : null;
          if (ivl == null) {
            const [lo, hi] = fuzzBounds(interval, 1, req.maxInterval), ff = new StdRng(seed).rangeF32(0, 1);
            ivl = Math.floor(F(F(lo) + F(ff * F(1 + hi - lo))));
          }
          const newDue = today - daysElapsed + ivl;
          if (rescheduler) rescheduler.updateDue(c.due, newDue, dc);
          ch.ivl = ivl; ch.due = newDue;
          // 再スケジュールの記録（種類 5・ボタン 0・ease は難しさを 0.1〜1.1 にした値の千倍）
          const factor = Math.min(65535, Math.max(0, Math.trunc(F(F(F(F(F(st.d) - 1) / 9) + F(0.1)) * 1000))));
          ch.revlog = { id: ms++, cid: c.id, ease: 0, ivl, lastIvl: c.ivl, factor, time: 0, type: 5 };
        }
      } else { delete data.s; delete data.d; }
    } else { delete data.s; delete data.d; delete data.dr; delete data.decay; }
    const same = JSON.stringify(data) === JSON.stringify(c.data || {}) && ch.due == null;
    if (!same) { ch.data = data; out.push(ch); }
  }
  return out;
}
