// オフライン用の Service Worker（site の根元に置く）。
//   名前にハッシュの入ったファイル・画像音声・MathJax … 一度取ったら端末から出す（中身が変わると名前が変わる）
//   アプリ本体・manifest.json … まずネットに取りに行き、4秒で返事が無いか、つながらなければ端末の控えを出す
//   /api/・/pair … いつもネット（アプリ側がつながらないときの扱いを持つ）
const DATA = 'data-v1', MEDIA = 'media-v1', CODE = 'code-v1';
// 入ったときにアプリ本体を控えておく（最初に開いたページは Service Worker を通っていないため）
const SHELL = ['/app/', '/app/app.mjs', '/app/pen.mjs', '/app/scratchpad.mjs', '/js/reviewer.js', '/app/typeans.mjs', '/app/ankiweb.mjs', '/app/search.mjs', '/app/i18n.mjs', '/i18n_anki.json', '/app/store.mjs', '/app/sync.mjs', '/app/ask.mjs', '/app/notes.mjs', '/app/decks.mjs', '/app/template.mjs', '/app/ntedit.mjs', '/app/ntscreen.mjs', '/app/xui.mjs', '/app/exchange.mjs', '/app/pkg.mjs', '/vendor/sqljs/sql-wasm-browser.js', '/vendor/sqljs/sql-wasm-browser.wasm', '/vendor/fzstd/index.mjs', '/app/blake3.mjs', '/fsrs/sched.mjs', '/fsrs/queue.mjs', '/fsrs/fsrs6.mjs', '/fsrs/schedule.mjs', '/fsrs/rng.mjs', '/fsrs/history.mjs', '/fsrs/reposition.mjs', '/fsrs/filtered.mjs', '/app/fsrsjobs.mjs', '/fsrs/optimize.mjs', '/fsrs/simulate.mjs', '/fsrs/memory.mjs', '/fsrs/worker.mjs', '/bundle/manifest.json'];
self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(CODE);
  await Promise.all(SHELL.map(async u => { try { const r = await fetch(u, { credentials: 'same-origin', cache: 'no-cache' }); if (r.ok) await c.put(u, r); } catch {} }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const immutable = p => /^\/bundle\/(c\/|n\/|state\.|stateadd\.|revlog\.|meta\.|media\.)/.test(p) || p.startsWith('/vendor/');
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  const p = u.pathname;
  if (p.startsWith('/api/') || p === '/pair') return;
  if (p.startsWith('/bundle/media/')) e.respondWith(cacheFirst(e.request, MEDIA));
  else if (immutable(p)) e.respondWith(cacheFirst(e.request, DATA));
  else e.respondWith(networkFirst(e.request));
});
async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req, { ignoreSearch: true }); if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) await c.put(req, r.clone());
  return r;
}
async function networkFirst(req) {
  const c = await caches.open(CODE);
  try {
    const r = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if (r.ok) await c.put(req, r.clone());
    return r;
  } catch (err) {
    const p = new URL(req.url).pathname;
    const hit = await c.match(req, { ignoreSearch: true }) || (p === '/app/index.html' || p === '/app' ? await c.match('/app/') : null);
    if (hit) return hit;
    throw err;
  }
}
// アプリから「この一覧を先に取っておいて」と頼まれる（画像音声の全部・今の束）。終わったら古い束を消す
let busy = null;
self.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type === 'prefetch' && !busy) busy = prefetch(m).finally(() => { busy = null; });
});
async function prefetch({ data = [], media = [] }) {
  const report = async x => { for (const cl of await self.clients.matchAll()) cl.postMessage({ type: 'prefetch', ...x }); };
  const dc = await caches.open(DATA), mc = await caches.open(MEDIA);
  // 今の一覧に無い束（古い版）を消す。画像音声と MathJax は消さない
  const keep = new Set(data.map(u => new URL(u, location.href).pathname));
  for (const req of await dc.keys()) { const p = new URL(req.url).pathname; if (p.startsWith('/bundle/') && !keep.has(p)) await dc.delete(req); }
  const todo = [];
  for (const u of data) if (!(await dc.match(u))) todo.push([dc, u]);
  // 画像・音声は名前が同じでも中身が変わることがある: 控えに付けた指紋（x-sa-h）が一覧と違えば取り直す
  for (const m of media) {
    const u = typeof m === 'string' ? m : m.u, h = typeof m === 'string' ? '' : m.h;
    const hit = await mc.match(u);
    if (!hit || (h && hit.headers.get('x-sa-h') !== h)) todo.push([mc, u, h]);
  }
  let done = 0, fail = 0;
  const worker = async () => {
    while (todo.length) {
      const [c, u, h] = todo.shift();
      try {
        const r = await fetch(u, { credentials: 'same-origin', cache: h ? 'reload' : 'default' });
        if (!r.ok) { fail++; continue; }
        if (h) { const hd = new Headers(r.headers); hd.set('x-sa-h', h); await c.put(u, new Response(await r.blob(), { status: 200, headers: hd })); }
        else await c.put(u, r);
      } catch { fail++; }
      if (++done % 100 === 0) await report({ done, left: todo.length, fail });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await report({ done, left: 0, fail, end: true });
}
