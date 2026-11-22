// 書き出し・読み込みを画面につなぐ（AnkiMobile 25.09 の「追加/エクスポート」→「iTunesからインポート」「コレクションをエクスポート」と、デッキを左へスワイプ→「エクスポート」）。
// 中身は app/exchange.mjs（集める・計画・記録にする）と app/pkg.mjs（パッケージの読み書き）。ここは、sql.js・fzstd の読み込み、端末に置く画像・音声、選ぶ小窓と共有だけ。
// 文言は Anki 本体の翻訳（exporting-*・importing-*）のとおり。AnkiMobile の画面そのものは実機で比べていない
import { createExchange } from './exchange.mjs';
import { sha1hex } from './pkg.mjs';

const MEDIA_CACHE = 'media-v1';   // app/sw.js の画像・音声の控えと同じ名前（ここに置けば、束の画像と同じ道で出る）
const PART = 1_048_576;            // サーバーへ送るかけらの大きさ（functions/api/media.js と同じ）
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };
const mimeOf = n => MIME[(n.match(/\.([^.]+)$/) || [])[1]?.toLowerCase()] || 'application/octet-stream';
const pref = (k, d) => { try { const v = localStorage.getItem('x:' + k); return v == null ? d : v === '1'; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('x:' + k, v ? '1' : '0'); } catch {} };

// ctx: { S, BUNDLE, MEDIA, API, alive, loadNotes, nextNewPos, store, notes, applyConf, applyOp, iosPrompt, iosAlert, toast, afterImport() }
export function setupExchange(ctx) {
  const { S, store } = ctx;
  const VENDOR = new URL('../vendor/', location.href).href;
  // ---------- sql.js・fzstd（初めて使うときに読む） ----------
  let sqlP = null;
  const sql = () => sqlP || (sqlP = new Promise((res, rej) => {
    if (window.initSqlJs) { res(); return; }
    const s = document.createElement('script'); s.src = VENDOR + 'sqljs/sql-wasm-browser.js'; s.onload = res; s.onerror = () => rej(new Error('sql.js を読めませんでした（tools/fetch_vendor.py を動かしてから、組み直してください）。')); document.head.append(s);
  }).then(() => window.initSqlJs({ locateFile: f => VENDOR + 'sqljs/' + f })).catch(e => { sqlP = null; throw e; }));
  const zstd = async () => (await import(VENDOR + 'fzstd/index.mjs')).decompress;
  // ---------- 端末で読み込んだ画像・音声 ----------
  // 置き場: Service Worker の画像・音声の控え（束の画像と同じ URL）。サーバーへ送るまで kv の mediaq に名前を積む
  const queue = async () => (await store.get('kv', 'mediaq')) || [];
  async function saveMedia(name, bytes) {
    const sha1 = await sha1hex(bytes);
    let kept = false;
    try { const c = await caches.open(MEDIA_CACHE); await c.put(ctx.MEDIA + encodeURIComponent(name), new Response(new Blob([bytes], { type: mimeOf(name) }), { headers: { 'content-type': mimeOf(name), 'x-sa-h': sha1.slice(0, 10) } })); kept = true; } catch {}
    if (!kept) uploadBytes.set(name, bytes);   // 控えが使えない（Cache Storage の無い）ときは、送るまで覚えておく
    localMedia.set(name, sha1);
    const q = await queue(); if (!q.some(x => x.name === name)) { q.push({ name, sha1, size: bytes.length }); await store.set('kv', q, 'mediaq'); }
  }
  const localMedia = new Map(), uploadBytes = new Map();
  // まだ送っていない画像・音声をサーバーへ（同期のたびに。かけらごとに送り、全部届いたら積んだ名前を消す）
  let uploading = null;
  async function uploadPending() {
    if (uploading) return uploading;
    uploading = (async () => {
      let q = await queue(); if (!q.length) return 0; let n = 0;
      for (const m of [...q]) {
        let bytes = uploadBytes.get(m.name);
        if (!bytes) { try { const c = await caches.open(MEDIA_CACHE); const r = await c.match(ctx.MEDIA + encodeURIComponent(m.name)); if (r) bytes = new Uint8Array(await r.arrayBuffer()); } catch {} }
        if (!bytes) { q = q.filter(x => x.name !== m.name); await store.set('kv', q, 'mediaq'); continue; }   // 控えが消えた（もう送れない）
        const parts = Math.max(1, Math.ceil(bytes.length / PART));
        for (let i = 0; i < parts; i++) {
          const u = `${ctx.API}media?name=${encodeURIComponent(m.name)}&i=${i}&n=${parts}&sha1=${m.sha1}&size=${bytes.length}`;
          const r = await fetch(u, { method: 'POST', body: bytes.subarray(i * PART, (i + 1) * PART), credentials: 'same-origin' });
          if (!r.ok) throw new Error(`画像・音声を送れませんでした（${r.status}）`);
        }
        q = (await queue()).filter(x => x.name !== m.name); await store.set('kv', q, 'mediaq'); uploadBytes.delete(m.name); n++;
      }
      return n;
    })().finally(() => { uploading = null; });
    return uploading;
  }
  // 端末にある画像・音声の名前と中身の指紋（束の一覧は sha1 の先頭 10 桁、サーバーと端末で読み込んだものは sha1）
  async function mediaIndex() {
    const m = new Map();
    try { const list = await (await fetch(ctx.BUNDLE + S.manifest.media)).json(); for (const x of list) { if (Array.isArray(x)) m.set(x[0], x[1] || ''); else m.set(x, ''); } } catch {}
    try { const r = await fetch(ctx.API + 'media', { cache: 'no-store', credentials: 'same-origin' }); if (r.ok) for (const [name, , sha1] of await r.json()) m.set(name, sha1); } catch {}
    for (const x of await queue()) m.set(x.name, x.sha1);
    for (const [n, h] of localMedia) m.set(n, h);
    return m;
  }
  const mediaNames = async () => [...(await mediaIndex()).keys()];
  const fetchMedia = async name => { const r = await fetch(ctx.MEDIA + encodeURIComponent(name)); if (!r.ok) return null; const ct = r.headers.get('content-type') || ''; if (ct.includes('text/html') && !/\.html?$/i.test(name)) return null; return r.blob(); };

  // ---------- 進み具合（画面の真ん中の小窓） ----------
  let hud = null;
  function progress(text) {
    if (text == null) { hud?.remove(); hud = null; return; }
    if (!hud) {
      hud = document.createElement('div'); hud.id = 'xprog';
      hud.innerHTML = '<div class="box"><svg class="spin" viewBox="0 0 36 36" width="36" height="36"><circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="60 30"/></svg><p></p></div>';
      const st = document.createElement('style');
      st.textContent = '#xprog{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.25)}#xprog .box{min-width:200px;max-width:280px;padding:18px 20px;border-radius:14px;background:rgba(40,40,42,.94);color:#fff;text-align:center;font:15px -apple-system,system-ui,sans-serif}#xprog p{margin:10px 0 0}#xprog .spin{animation:xspin 1s linear infinite}@keyframes xspin{to{transform:rotate(360deg)}}';
      hud.append(st); document.body.append(hud);
    }
    hud.querySelector('p').textContent = text;
  }
  const ex = createExchange({ S, alive: ctx.alive, loadNotes: ctx.loadNotes, mediaNames, fetchMedia, mediaIndex, nextNewPos: ctx.nextNewPos, sql, zstd, progress });

  // ---------- 共有（iOS の共有シート。できなければファイルを保存） ----------
  async function share(blob, name) {
    const file = new File([blob], name, { type: 'application/octet-stream' });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return 'shared'; } } catch (e) { if (e?.name === 'AbortError') return 'cancel'; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
    return 'saved';
  }
  ctx.lastExport = null;
  // ---------- 書き出す ----------
  async function exportDeck(did) {
    const d = S.decksById.get(did) || S.fdecks.get(did); if (!d) return;
    const r = await ctx.iosPrompt({ title: 'Anki デッキパッケージ', message: d.name, ok: 'エクスポート', toggles: [
      { label: 'スケジュール情報を含める', on: pref('sched', true) }, { label: 'デッキのプリセットを含める', on: pref('configs', true) }, { label: 'メディアファイルを含める', on: pref('media', true) }] });
    if (!r) return;
    const [sched, configs, media] = r.toggles; setPref('sched', sched); setPref('configs', configs); setPref('media', media);
    try {
      const out = await ex.exportDeck(did, { sched, configs, media });
      ctx.lastExport = out;
      const how = await share(out.blob, out.name);
      if (how !== 'cancel') ctx.toast(`${out.cards}枚のカードを書き出しました。`);
    } catch (e) { progress(null); ctx.iosAlert('エクスポート', String(e?.message || e)); }
  }
  async function exportCollection() {
    const r = await ctx.iosPrompt({ title: 'Anki コレクションパッケージ', message: 'すべてのデッキ', ok: 'エクスポート', toggles: [{ label: 'メディアファイルを含める', on: pref('colmedia', true) }] });
    if (!r) return;
    setPref('colmedia', r.toggles[0]);
    try {
      const out = await ex.exportCollection({ media: r.toggles[0] });
      ctx.lastExport = out;
      const how = await share(out.blob, out.name);
      if (how !== 'cancel') ctx.toast('コレクションを書き出しました。');
    } catch (e) { progress(null); ctx.iosAlert('エクスポート', String(e?.message || e)); }
  }
  // ---------- 読み込む ----------
  function pickFile() {
    return new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.apkg,.colpkg,.zip,application/octet-stream,application/zip';
      inp.style.display = 'none'; document.body.append(inp);
      inp.onchange = () => { res(inp.files?.[0] || null); inp.remove(); };
      inp.addEventListener('cancel', () => { res(null); inp.remove(); });
      inp.click();
    });
  }
  const hooks = {
    commitConf: async rows => { ctx.applyConf(rows); await store.addOps(rows.map(r => ({ t: 'conf', ...r }))); },
    commitImported: x => ctx.notes.importRecords(x),
    addOps: async ops => { for (const op of ops) ctx.applyOp(op); await store.addOps(ops); },
    saveMedia,
    done: () => ctx.afterImport(),
  };
  function report(log) {
    const lines = [`ファイル内にあるノート: ${log.found}枚`];
    if (log.new) lines.push(`ファイルから追加したノート: ${log.new}枚`);
    if (log.updated) lines.push(`既存のノートを更新しました（より新しい版がファイル内にあるため）: ${log.updated}個`);
    if (log.duplicate) lines.push(`すでにコレクション内に最新版が存在するためスキップされたノート: ${log.duplicate}枚`);
    if (log.conflicting) lines.push(`ノートタイプが変更されたためインポートできなかったノート：${log.conflicting}`);
    if (log.media) lines.push(`${log.media}個のメディアファイルをインポートしました`);
    return lines.join('\n');
  }
  async function importFile(file) {
    if (!file) return;
    if (/\.colpkg$/i.test(file.name)) return importCollection(file);
    const r = await ctx.iosPrompt({ title: 'インポートのオプション', message: file.name, ok: 'インポート', toggles: [
      { label: '学習履歴を含める', on: pref('isched', false) }, { label: 'デッキのプリセットを含める', on: pref('iconfigs', false) }] });
    if (!r) return;
    const [sched, configs] = r.toggles; setPref('isched', sched); setPref('iconfigs', configs);
    try {
      const log = await ex.importPackage(file, { sched, configs }, hooks);
      ctx.iosAlert('インポート', report(log));
    } catch (e) { progress(null); console.error(e); ctx.iosAlert('インポート', String(e?.message || e)); }
  }
  async function importCollection(file) {
    const ok = await ctx.iosPrompt({ title: 'コレクションをインポート', message: 'この処理は、既存のコレクションを削除し、今からインポートするファイルのデータに置き換えます。本当に実行しますか？', ok: 'インポート', danger: true });
    if (!ok) return;
    try {
      const log = await ex.replaceCollection(file, hooks);
      ctx.iosAlert('インポート', `コレクションをインポートしました。\n${report(log)}`);
    } catch (e) { progress(null); console.error(e); ctx.iosAlert('インポート', String(e?.message || e)); }
  }
  return { exportDeck, exportCollection, importFile, pickFile, uploadPending, mediaIndex, ex, share };
}
