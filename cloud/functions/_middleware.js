// 合言葉が無い人には何も見せない（カードの本文・画像が入っているため）。
// 合言葉はクッキー sa（端末）か Authorization: Bearer（パソコンの書き戻し）で渡す。
// 端末にクッキーを置くには、パソコンで tools/pair_code.py を動かして出た6桁の番号を /pair で入れる（合言葉そのものを URL や画面に出す入口は無い）
const enc = new TextEncoder();
async function same(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i]; return d === 0;
}
const text = (s, status) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
// ---------- 別の端末（スマホ）を足す: 使い捨ての6桁の番号でクッキーを置く ----------
// 番号はパソコンの tools/pair_code.py が D1 の pair 表に「番号のハッシュ・期限」で入れる（合言葉そのものは画面に出さない）。
// 1回使ったら消える・15分で切れる・5回まちがえたら全部消す
const hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const html = (body, status = 200) => new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>暗記 — この端末を足す</title><link rel="manifest" href="/app/manifest.webmanifest"><link rel="apple-touch-icon" href="/app/icons/icon-192.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#000000">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#eee;font:17px -apple-system,system-ui,sans-serif}form{display:flex;flex-direction:column;gap:14px;width:min(320px,90vw)}
input{font-size:28px;letter-spacing:.3em;text-align:center;padding:10px;border-radius:12px;border:1px solid #444;background:#1c1c1e;color:#fff}button{font-size:18px;padding:12px;border-radius:12px;border:0;background:#0a84ff;color:#fff}p{margin:0;color:#aaa;font-size:15px;line-height:1.6}.e{color:#ff6961}</style></head>
<body><script>/* iOS の殻: 入力欄にいるあいだはキーを殻に取らせない（数字がそのまま入るように） */(function(){var h=window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.sa;if(!h)return;var t=function(v){try{h.postMessage({typing:v})}catch(e){}};document.addEventListener('focusin',function(){t(true)});document.addEventListener('focusout',function(){t(false)});t(true)})();</script><form method="post" action="/pair">${body}<input name="c" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required autofocus><button>この端末で使う</button></form></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
async function pair(request, env, T) {
  const DB = env.DB;
  if (request.method !== 'POST') return html('<p>パソコンで <code>python tools/pair_code.py</code> を動かすと出る6桁の番号を入れてください（15分・1回きり）。<br>Enter the 6-digit code shown by <code>python tools/pair_code.py</code> (valid for 15 minutes, once).</p>');
  const f = await request.formData().catch(() => null); const code = String(f?.get('c') || '').replace(/\D/g, '');
  const now = Date.now();
  // 先に試した回数を数えてから照合する（同時にたくさん投げても、5回を超えた分は照合しない）
  const [, tries] = await DB.batch([DB.prepare('delete from pair where exp < ?1').bind(now),
    DB.prepare("insert into kv(k, v) values ('pairfail', 1) on conflict(k) do update set v = v + 1 returning v")]);
  const n = tries.results?.[0]?.v || 0;
  if (n > 5) { await DB.batch([DB.prepare('delete from pair'), DB.prepare("update kv set v = 0 where k = 'pairfail'")]); return html('<p class="e">番号を5回まちがえたので、出してある番号は全部消しました。パソコンで出し直してください。<br>Too many attempts. Make a new code on your computer.</p>', 403); }
  const row = code.length === 6 ? await DB.prepare('delete from pair where h = ?1 and exp >= ?2 returning h').bind(await hex('pair:' + code), now).first() : null;
  if (!row) return html('<p class="e">番号が違うか、期限が切れています。<br>Wrong or expired code.</p>', 403);
  await DB.prepare("update kv set v = 0 where k = 'pairfail'").run();
  return new Response(null, { status: 303, headers: { Location: '/app/index.html', 'Set-Cookie': `sa=${T}; Path=/; Max-Age=34560000; Secure; HttpOnly; SameSite=Lax`, 'cache-control': 'no-store' } });
}
// 教材の入っていないもの（ホーム画面に置くための manifest とアイコン）は合言葉なしで出す
const isPublic = p => p === '/app/manifest.webmanifest' || p.startsWith('/app/icons/');
export async function onRequest({ request, env, next }) {
  const T = env.SA_TOKEN; if (!T) return text('合言葉が設定されていません', 500);
  const url = new URL(request.url);
  if (url.pathname === '/pair') {
    // もうつないである端末（正しいクッキーがある）なら、番号は要らないのでアプリへ
    const c = (request.headers.get('cookie') || '').match(/(?:^|;\s*)sa=([^;]+)/);
    if (request.method === 'GET' && c && await same(c[1], T)) return new Response(null, { status: 302, headers: { Location: '/app/index.html', 'cache-control': 'no-store' } });
    return pair(request, env, T);
  }
  if (isPublic(url.pathname)) return next();
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)sa=([^;]+)/);
  const auth = request.headers.get('authorization') || '';
  const given = m ? m[1] : auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!given || !(await same(given, T))) {
    // 画面を開こうとしたとき（ブラウザ・iOS の殻）は、番号の入力画面へ回す。データの取得（fetch）は 401 のまま
    const nav = request.method === 'GET' && (request.headers.get('sec-fetch-mode') === 'navigate' || (request.headers.get('accept') || '').includes('text/html'));
    if (nav && !url.pathname.startsWith('/api/')) return new Response(null, { status: 303, headers: { Location: '/pair', 'cache-control': 'no-store' } });
    return text('Unauthorized', 401);
  }
  const res = await next();
  // 名前に中身の印（ハッシュ）が入ったファイルは変わらないので端末に長く置かせる。ほかは毎回確かめさせる
  const p = url.pathname;
  const out = new Response(res.body, res);
  // 外への通信（fetch など）は自分のサイトだけ。カードの中身が端末の記録を外へ送れないように
  if ((out.headers.get('content-type') || '').includes('text/html')) out.headers.set('content-security-policy', "connect-src 'self'; form-action 'self'; base-uri 'self'");
  if (/^\/bundle\/(c\/|n\/|state\.|stateadd\.|revlog\.|meta\.)/.test(p) || p.startsWith('/bundle/media/') || p.startsWith('/vendor/')) out.headers.set('cache-control', 'private, max-age=31536000, immutable');
  else out.headers.set('cache-control', 'no-cache');
  return out;
}
