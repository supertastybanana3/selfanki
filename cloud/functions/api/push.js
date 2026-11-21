// 端末（や書き戻し）からの変更を受け取る。1回の送信を1つの取引にして、同じ seq を振る
//   {t:'ans',  r:記録, c:{id, st, rev}}  答えた。記録は既にあれば無視、状態は今より新しい（rev が大きいか同じ）ときだけ置き換える
//   {t:'undo', rid, c:{id, st, rev}}     元に戻した。記録 rid に削除の印、状態は今が rid の答えのままなら前の状態に戻す
//   {t:'state', c:{...}} / {t:'rev', r:記録}  書き戻し（Anki 側）から。src:'anki'
//   {t:'set', c:{...}}                    非表示・休止・フラグなど（答えではない変更）
//   'set'・'state' に base（送った側が知っている、そのカードの最後の答えの記録 id）があれば、それより新しい答え（種類 0〜4、消していないもの）が
//   もう届いているときは状態を置き換えない（古い期日で、別の端末や Anki の答えを上書きしないように）
const SEQ = "(select v from kv where k = 'seq')";
const isInt = x => Number.isSafeInteger(x);
export async function onRequestPost({ request, env }) {
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (ops.length > 1000) return Response.json({ error: 'too many ops' }, { status: 413 });
  const DB = env.DB;
  const st = [DB.prepare("update kv set v = v + 1 where k = 'seq'")];
  for (const o of ops) {
    const src = o.src === 'anki' ? 'anki' : 'app';
    const r = o.r;
    if (r) {
      if (![r.id, r.cid, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type].every(isInt)) return Response.json({ error: 'bad revlog', r }, { status: 400 });
      st.push(DB.prepare(`insert into revlog(id, cid, ease, ivl, lastIvl, factor, time, type, src, del, seq) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ${SEQ}) on conflict(id) do nothing`)
        .bind(r.id, r.cid, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type, src));
    }
    if (o.t === 'undo') {
      if (!isInt(o.rid)) return Response.json({ error: 'bad rid' }, { status: 400 });
      st.push(DB.prepare(`update revlog set del = 1, seq = ${SEQ} where id = ?1 and del = 0`).bind(o.rid));
    }
    if (o.t === 'conf') {
      // デッキのオプション。今より新しい（rev が大きいか同じ）ときだけ置き換える
      if (typeof o.k !== 'string' || !/^(preset|deck):-?\d+$|^global$/.test(o.k) || !isInt(o.rev) || typeof o.v !== 'object' || !o.v) return Response.json({ error: 'bad conf' }, { status: 400 });
      st.push(DB.prepare(`insert into conf(k, v, rev, src, seq) values (?1, ?2, ?3, ?4, ${SEQ}) on conflict(k) do update set v = excluded.v, rev = excluded.rev, src = excluded.src, seq = excluded.seq where excluded.rev >= conf.rev`)
        .bind(o.k, JSON.stringify(o.v), o.rev, src));
      continue;
    }
    const c = o.c;
    if (c) {
      if (!isInt(c.id) || !isInt(c.rev) || typeof c.st !== 'object' || !c.st) return Response.json({ error: 'bad card', c }, { status: 400 });
      const when = o.t === 'undo' ? 'cards.rev = ?5' : 'excluded.rev >= cards.rev';
      const args = [c.id, JSON.stringify(c.st), c.rev, src]; if (o.t === 'undo') args.push(o.rid);
      const guard = o.t !== 'undo' && o.t !== 'ans' && isInt(o.base);
      if (guard) args.push(o.base);
      const pick = guard ? 'where not exists (select 1 from revlog where cid = ?1 and del = 0 and type <= 4 and id > ?5)' : 'where true';
      st.push(DB.prepare(`insert into cards(id, st, rev, src, seq) select ?1, ?2, ?3, ?4, ${SEQ} ${pick} on conflict(id) do update set st = excluded.st, rev = excluded.rev, src = excluded.src, seq = excluded.seq where ${when}`)
        .bind(...args));
    }
  }
  st.push(DB.prepare("select v from kv where k = 'seq'"));
  const out = await DB.batch(st);
  return Response.json({ ok: true, seq: out[out.length - 1].results[0].v, n: ops.length }, { headers: { 'cache-control': 'no-store' } });
}
