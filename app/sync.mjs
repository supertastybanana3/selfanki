// サーバー（Cloudflare の D1）との同期。送る（outbox）→ 取る（差分）の順。
// ネットが無いときは何もしない（答えは outbox に積まれたまま、次につながったときに送る）
import * as store from './store.mjs';
const API = new URL('../api/', location.href).href;
let running = null;
export const state = { online: null, lastOk: 0, lastError: '', pending: 0, serverless: false };

async function call(path, opt = {}) {
  // 設定＞同期の「ネットワークタイムアウト」（秒。既定 60）を過ぎたら止める
  let secs = 60; try { secs = Math.max(5, parseInt(localStorage.getItem('netTimeout') || '60', 10) || 60); } catch {}
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(secs * 1000) : undefined;
  const r = await fetch(API + path, { cache: 'no-store', credentials: 'same-origin', ...(signal ? { signal } : {}), ...opt });
  if (r.status === 404) { state.serverless = true; throw new Error('サーバーなし'); }
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function push() {
  const ops = await store.outbox();
  state.pending = ops.length;
  for (let i = 0; i < ops.length; i += 200) {
    const part = ops.slice(i, i + 200);
    await call('push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: part.map(x => x.op) }) });
    await store.dropOps(part.map(x => x.key));
    state.pending -= part.length;
  }
}
// 取ってきた差分を返す（画面の中のカードに重ねるため）
async function pull() {
  let cur = { ns: 0, ni: 0, ...((await store.get('kv', 'cursor')) || { cs: 0, ci: 0, rs: 0, ri: 0 }) };
  const cards = [], revlog = [], notes = []; let conf = null;
  for (let guard = 0; guard < 200; guard++) {
    const j = await call(`pull?cs=${cur.cs}&ci=${cur.ci}&rs=${cur.rs}&ri=${cur.ri}&ns=${cur.ns}&ni=${cur.ni}&n=3000`);
    if (j.conf && !conf) { conf = j.conf.map(([k, v, rev, src]) => ({ k, v: JSON.parse(v), rev, src })); await store.set('kv', conf, 'conf'); }
    const cs = j.cards.map(([id, st, rev, src, seq]) => ({ id, st: JSON.parse(st), rev, src, seq }));
    const rs = j.revlog.map(([id, cid, ease, ivl, lastIvl, factor, time, type, src, del, seq]) => ({ id, cid, ease, ivl, lastIvl, factor, time, type, src, del, seq }));
    if (cs.length) { const l = cs[cs.length - 1]; cur = { ...cur, cs: l.seq, ci: l.id }; }
    if (rs.length) { const l = rs[rs.length - 1]; cur = { ...cur, rs: l.seq, ri: l.id }; }
    // ノート（端末で追加・編集・削除したもの）。{id, mid, flds:[…], tags, did, cards:[[cid, ord, did, due], …], rev, src, del, added}
    const ns = (j.notes || []).map(([id, mid, flds, tags, did, cards, rev, src, del, added, seq, guid, imp]) => ({ id, mid, flds: JSON.parse(flds), tags, did, cards: JSON.parse(cards), rev, src, del, added, seq, ...(guid ? { guid } : {}), ...(imp ? { imp: 1 } : {}) }));
    if (ns.length) { const l = ns[ns.length - 1]; cur = { ...cur, ns: l.seq, ni: l.id }; }
    await store.savePulled(cs, rs, cur, ns);
    cards.push(...cs); revlog.push(...rs); notes.push(...ns);
    if (!j.more) break;
  }
  return { cards, revlog, conf, notes };
}
// 1回ぶんの同期。同時に2つは走らせない
export function syncNow() {
  if (running) return running;
  running = (async () => {
    try {
      await push();
      const got = await pull();
      state.online = true; state.lastOk = Date.now(); state.lastError = '';
      return got;
    } catch (e) {
      state.online = false; state.lastError = e.message;
      return null;
    } finally { running = null; }
  })();
  return running;
}
// サーバー側に、まだ取っていない変更があるか（AnkiMobile の同期ボタンは、AnkiWeb 側に変更があるときも色が変わる）。1件だけ問い合わせる
export async function remoteHasChanges() {
  const cur = { ns: 0, ni: 0, ...((await store.get('kv', 'cursor')) || { cs: 0, ci: 0, rs: 0, ri: 0 }) };
  const j = await call(`pull?cs=${cur.cs}&ci=${cur.ci}&rs=${cur.rs}&ri=${cur.ri}&ns=${cur.ns}&ni=${cur.ni}&n=1`);
  return !!(j.cards.length || j.revlog.length || (j.notes || []).length);
}
export async function pendingCount() { state.pending = (await store.outbox()).length; return state.pending; }
