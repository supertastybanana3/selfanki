// 確かめる用の記録（iPad でキーが届いているか等）。中身は押したキーの種類・状態だけ（カードの本文は入れない）
export async function onRequestPost({ request, env }) {
  const t = await request.text(); if (t.length > 4000) return new Response('too large', { status: 413 });
  await env.DB.batch([
    env.DB.prepare('create table if not exists diag (id integer primary key autoincrement, at integer not null, body text not null)'),
    env.DB.prepare('insert into diag(at, body) values (?1, ?2)').bind(Date.now(), t),
    env.DB.prepare('delete from diag where id <= (select max(id) - 500 from diag)'),
  ]);
  return new Response('ok', { headers: { 'cache-control': 'no-store' } });
}
