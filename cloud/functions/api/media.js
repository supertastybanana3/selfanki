// 端末で読み込んだ画像・音声（.apkg の中の、束に無いもの）の置き場（D1 の media・media_part）。
//   POST /api/media?name=<名前>&i=<番号>&n=<個数>&sha1=<16進>&size=<バイト数>  本文＝中身の i 番目のかけら（1MB まで）。最後のかけらが届き、全部そろったら一覧に載せる
//   GET  /api/media                                                                一覧 [[名前, 大きさ, sha1, seq], …]（アドオンが Anki の collection.media に取ってくる）
// 中身は /bundle/media/<名前> で出す（束に無いときだけ。_middleware.js）
import { ensureNotes } from './_notes.js';
export const PART = 1_048_576;
// 名前の見張り: / \ と、Windows でドライブや別のストリームを指す : と、使えない文字 < > " | ? *・制御文字・末尾の点と空白・予約名（CON など）を通さない（アドオンの _safe_media と同じ）
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const safeMediaName = n => typeof n === 'string' && n.length > 0 && n.length <= 255 && !/[/\\:<>"|?*\x00-\x1f]/.test(n) && n !== '.' && n !== '..' && !n.startsWith('.') && !/[. ]$/.test(n) && !WIN_RESERVED.test(n.split('.')[0].trim());
export async function onRequestGet({ env }) {
  await ensureNotes(env.DB);
  const r = await env.DB.prepare('select name, size, sha1, seq from media order by seq, name').all();
  return Response.json(r.results.map(x => [x.name, x.size, x.sha1, x.seq]), { headers: { 'cache-control': 'no-store' } });
}
export async function onRequestPost({ request, env }) {
  const u = new URL(request.url), q = k => u.searchParams.get(k);
  const name = q('name'), i = Number(q('i')), n = Number(q('n')), sha1 = String(q('sha1') || '').toLowerCase(), size = Number(q('size'));
  if (!safeMediaName(name) || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || n > 4096 || i < 0 || i >= n || !/^[0-9a-f]{40}$/.test(sha1) || !Number.isSafeInteger(size) || size < 0)
    return Response.json({ error: 'bad media' }, { status: 400 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > PART) return Response.json({ error: 'too large' }, { status: 413 });
  const DB = env.DB;
  await ensureNotes(DB);
  // 同じ名前がもうある: 中身が同じなら受け取ったことにし、違えば断る（かけらを書く前に。書くと、あるファイルの中身が置き換わってしまう）
  const ex = await DB.prepare('select sha1 from media where name = ?1').bind(name).first();
  if (ex) return ex.sha1 === sha1 ? Response.json({ ok: true, done: true, have: true }) : Response.json({ error: 'exists' }, { status: 409 });
  await DB.prepare('insert into media_part(name, i, data) values (?1, ?2, ?3) on conflict(name, i) do update set data = excluded.data').bind(name, i, body).run();
  if (i !== n - 1) return Response.json({ ok: true, part: i });
  // 最後のかけら: そろっているか（数と大きさ。20MB までは中身の sha1 も）確かめてから一覧に載せる
  const parts = (await DB.prepare('select i, length(data) as l from media_part where name = ?1 and i < ?2 order by i').bind(name, n).all()).results;
  if (parts.length !== n || parts.reduce((a, p) => a + p.l, 0) !== size) return Response.json({ error: 'incomplete', have: parts.length }, { status: 409 });
  if (size <= 20 * PART) {
    const buf = new Uint8Array(size); let off = 0;
    for (let k = 0; k < n; k++) { const row = await DB.prepare('select data from media_part where name = ?1 and i = ?2').bind(name, k).first(); const d = new Uint8Array(row.data); buf.set(d, off); off += d.length; }
    const got = [...new Uint8Array(await crypto.subtle.digest('SHA-1', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (got !== sha1) return Response.json({ error: 'sha1 mismatch' }, { status: 409 });
  }
  const SEQ = "(select v from kv where k = 'seq')";
  await DB.batch([
    DB.prepare("update kv set v = v + 1 where k = 'seq'"),
    DB.prepare(`insert into media(name, size, sha1, parts, rev, src, seq) values (?1, ?2, ?3, ?4, ?5, 'app', ${SEQ}) on conflict(name) do update set size = excluded.size, sha1 = excluded.sha1, parts = excluded.parts, rev = excluded.rev, seq = excluded.seq`)
      .bind(name, size, sha1, n, Date.now()),
    DB.prepare('delete from media_part where name = ?1 and i >= ?2').bind(name, n),
  ]);
  return Response.json({ ok: true, done: true });
}
