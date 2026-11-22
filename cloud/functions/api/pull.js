// 差分を取る: seq と id の組で続きから。cs/ci＝カードの続き、rs/ri＝記録の続き、ns/ni＝ノートの続き
import { ensureNotes } from './_notes.js';
export async function onRequestGet({ request, env }) {
  await ensureNotes(env.DB);
  const u = new URL(request.url);
  const n = Math.max(1, Math.min(5000, +u.searchParams.get('n') || 3000));
  const num = k => Math.max(0, +u.searchParams.get(k) || 0);
  const [c, r, s, f, nt] = await env.DB.batch([
    env.DB.prepare('select id, st, rev, src, seq from cards where (seq, id) > (?1, ?2) order by seq, id limit ?3').bind(num('cs'), num('ci'), n),
    env.DB.prepare('select id, cid, ease, ivl, lastIvl, factor, time, type, src, del, seq from revlog where (seq, id) > (?1, ?2) order by seq, id limit ?3').bind(num('rs'), num('ri'), n),
    env.DB.prepare("select v from kv where k = 'seq'"),
    env.DB.prepare('select k, v, rev, src, seq from conf'),
    env.DB.prepare('select id, mid, flds, tags, did, cards, rev, src, del, added, seq, guid, imp, fn from notes where (seq, id) > (?1, ?2) order by seq, id limit ?3').bind(num('ns'), num('ni'), n),
  ]);
  return Response.json({
    seq: s.results[0]?.v ?? 0,
    cards: c.results.map(x => [x.id, x.st, x.rev, x.src, x.seq]),
    revlog: r.results.map(x => [x.id, x.cid, x.ease, x.ivl, x.lastIvl, x.factor, x.time, x.type, x.src, x.del, x.seq]),
    conf: f.results.map(x => [x.k, x.v, x.rev, x.src, x.seq]),
    notes: nt.results.map(x => [x.id, x.mid, x.flds, x.tags, x.did, x.cards, x.rev, x.src, x.del, x.added, x.seq, x.guid ?? null, x.imp || 0, x.fn ?? null]),   // guid・imp はあとから足した列（古い端末は読まない）
    more: c.results.length === n || r.results.length === n || nt.results.length === n,
  }, { headers: { 'cache-control': 'no-store' } });
}
