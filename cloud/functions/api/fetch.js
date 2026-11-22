// よそのサイトのファイルを、端末の代わりに取ってくる（「追加/エクスポート」の「リンク先からダウンロード」と、URL で足すノートの画像・音声）。
// 端末のページは自分のサイトとしか通信できない（_middleware.js の connect-src 'self'）ため、ここを通す。合言葉のある人しか届かない（_middleware.js）。
//   POST /api/fetch  本文 { "url": "https://…" }  ヘッダー x-sa-fetch: 1（カードの中の画像のタグやフォームからは呼べないように）
//   返す: 中身そのまま（application/octet-stream）。x-sa-name＝ファイル名（Content-Disposition か URL の最後）。300MB まで
const CAP = 300 * 1024 * 1024;
const err = (m, status) => Response.json({ error: m }, { status, headers: { 'cache-control': 'no-store' } });
export async function onRequestPost({ request }) {
  if (request.headers.get('x-sa-fetch') !== '1') return err('bad request', 400);
  let url; try { url = new URL(String((await request.json()).url || '')); } catch { return err('URL が正しくありません', 400); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return err('URL が正しくありません', 400);
  let r; try { r = await fetch(url.href, { redirect: 'follow', headers: { 'user-agent': 'selfanki' } }); } catch (e) { return err(String(e?.message || e), 502); }
  if (!r.ok || !r.body) return err(`HTTP ${r.status}`, 502);
  if (Number(r.headers.get('content-length') || 0) > CAP) return err('ファイルが大きすぎます（300MB まで）', 413);
  let seen = 0;
  const cap = new TransformStream({ transform(chunk, c) { seen += chunk.byteLength; if (seen > CAP) c.error(new Error('too large')); else c.enqueue(chunk); } });
  const cd = r.headers.get('content-disposition') || '';
  let name = (cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/) || [])[1] || (cd.match(/filename\s*=\s*"?([^";]+)"?/i) || [])[1] || '';
  try { name = decodeURIComponent(name); } catch {}
  if (!name) { const last = new URL(r.url || url.href).pathname.split('/').pop() || ''; try { name = decodeURIComponent(last); } catch { name = last; } }
  return new Response(r.body.pipeThrough(cap), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-sa-name': encodeURIComponent(name.slice(0, 200)) } });
}
export const onRequestGet = () => err('POST で', 405);
