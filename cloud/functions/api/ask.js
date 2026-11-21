// 「？」（AI に質問）の取り次ぎ。アプリからの質問に中継の合言葉を付けて、環境変数 ASK_URL の中継へ送り、答え（少しずつ届く文字）をそのまま返す。
// 中継そのものはこのリポジトリには入っていない。ASK_URL と ASK_TOKEN が無ければ、アプリは「？」ボタンを出さない（GET /api/ask?probe=1 で確かめる）
const base = env => String(env.ASK_URL || '').replace(/\/+$/, '');
export async function onRequestPost({ request, env }) {
  if (!env.ASK_TOKEN || !env.ASK_URL) return Response.json({ error: 'no_ask_token' }, { status: 501 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  body.token = env.ASK_TOKEN;
  const r = await fetch(base(env) + '/api/ask', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
  const h = new Headers({ 'content-type': r.headers.get('content-type') || 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  return new Response(r.body, { status: r.status, headers: h });
}
// GET /api/ask?probe=1 → {ok: 中継が設定されているか}
// GET /api/ask?rid=… → 裏に回っていた間の答えを中継から取る（{a, done, err} か {missing:true}）
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const ok = !!(env.ASK_TOKEN && env.ASK_URL);
  if (u.searchParams.has('probe')) return Response.json({ ok }, { headers: { 'cache-control': 'no-store' } });
  const rid = u.searchParams.get('rid');
  if (!rid) return new Response('not found', { status: 404 });
  if (!ok) return Response.json({ error: 'no_ask_token' }, { status: 501 });
  const r = await fetch(`${base(env)}/api/ans?token=${encodeURIComponent(env.ASK_TOKEN)}&rid=${encodeURIComponent(rid)}`);
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
