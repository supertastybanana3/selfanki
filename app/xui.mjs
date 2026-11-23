// 書き出し・読み込みを画面につなぐ（AnkiMobile 25.09 の「追加/エクスポート」→「iTunesからインポート」「コレクションをエクスポート」と、デッキを左へスワイプ→「エクスポート」）。
// 中身は app/exchange.mjs（集める・計画・記録にする）と app/pkg.mjs（パッケージの読み書き）。ここは、sql.js・fzstd の読み込み、端末に置く画像・音声、選ぶ小窓と共有だけ。
// 文言は Anki 本体の翻訳（exporting-*・importing-*）のとおり。AnkiMobile の画面そのものは実機で比べていない
import { createExchange } from './exchange.mjs';
import { sha1hex } from './pkg.mjs';
import { BK_DEF, backupName, parseBackupName, obsoleteBackups } from './backup.mjs';

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
  // メディアログ（設定＞同期）: 送った画像・音声の最近の200件（端末の中だけ）
  const logMedia = (name, size) => { try { const l = JSON.parse(localStorage.getItem('mediaLog') || '[]'); l.unshift([Date.now(), name, size]); localStorage.setItem('mediaLog', JSON.stringify(l.slice(0, 200))); } catch {} };
  const mediaLog = () => { try { return JSON.parse(localStorage.getItem('mediaLog') || '[]'); } catch { return []; } };
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
          if (r.status === 409 && (await r.clone().json().catch(() => ({}))).error === 'exists') { console.warn('同じ名前で中身の違うファイルがサーバーにあるので送らない', m.name); break; }   // ほかの端末が先に同じ名前で送った（相手のを守る）
          if (!r.ok) throw new Error(`画像・音声を送れませんでした（${r.status}）`);
          if ((await r.clone().json().catch(() => ({}))).have) break;   // 同じ中身がもうある
        }
        q = (await queue()).filter(x => x.name !== m.name); await store.set('kv', q, 'mediaq'); uploadBytes.delete(m.name); n++;
        logMedia(m.name, bytes.length);
      }
      return n;
    })().finally(() => { uploading = null; });
    return uploading;
  }
  // 端末にある画像・音声の名前と中身の指紋（束の一覧は sha1 の先頭 10 桁、サーバーと端末で読み込んだものは sha1）
  async function mediaIndex() {
    const m = new Map();
    try { const list = await (await fetch(ctx.BUNDLE + S.manifest.media)).json(); for (const x of list) { if (Array.isArray(x)) m.set(x[0], x[1] || ''); else m.set(x, ''); } } catch {}
    try { const r = await fetch(ctx.API + 'media', { cache: 'no-store', credentials: 'same-origin' }); if (r.ok) { for (const [name, , sha1] of await r.json()) m.set(name, sha1); m.serverOk = true; } } catch {}
    for (const x of await queue()) m.set(x.name, x.sha1);
    for (const [n, h] of localMedia) m.set(n, h);
    return m;
  }
  const mediaNames = async () => [...(await mediaIndex()).keys()];
  // 編集の画面で足す画像・音声（rslib media/files.rs の add_data_to_folder_uniquely と normalize_filename と同じ決まり:
  // 使えない文字 [ ] < > : " / ? * ^ \ | と制御文字を除き、NFC にして 120 バイトまで。同じ名前で中身が違えば「名前-<sha1>.拡張子」）。返す: 使う名前
  async function addMedia(name0, bytes) {
    let name = String(name0 || '').normalize('NFC').replace(/[\[\]<>:"/?*^\\|\x00-\x1f\x7f]/g, '').trim() || 'media';
    const enc = new TextEncoder(); if (enc.encode(name).length > 120) { const dot = name.lastIndexOf('.'), ext = dot > 0 ? name.slice(dot) : ''; let stem = dot > 0 ? name.slice(0, dot) : name; while (enc.encode(stem + ext).length > 120) stem = stem.slice(0, -1); name = stem + ext; }
    const sha1 = await sha1hex(bytes), idx = await mediaIndex();
    const same = h => !!h && (h === sha1 || (h.length < 40 && sha1.startsWith(h)));   // 束の一覧は sha1 の先頭 10 桁
    // サーバーの一覧が取れない（オフライン）ときは、ほかの端末が同じ名前で足したかもしれないので、元の名前に sha1 を付ける（中身で決まる名前は重ならない）
    if (!idx.serverOk && !name.includes(sha1) && !idx.has(name)) { const dot = name.lastIndexOf('.'); name = dot > 0 ? `${name.slice(0, dot)}-${sha1}${name.slice(dot)}` : `${name}-${sha1}`; }
    if (idx.has(name)) {
      if (same(idx.get(name))) return name;
      const dot = name.lastIndexOf('.'); name = dot > 0 ? `${name.slice(0, dot)}-${sha1}${name.slice(dot)}` : `${name}-${sha1}`;
      if (idx.has(name)) return name;
    }
    await saveMedia(name, bytes);
    if (ctx.syncMedia?.() !== false) try { await uploadPending(); } catch {}   // その場で送る（Service Worker が受け持っていなくても、サーバーから出せるように）。送れなければ次の同期で
    return name;
  }
  const sha1Of = bytes => sha1hex(bytes);
  // 中身を取る: 端末の控え（読み込んだばかりでまだ送っていないものも）→ ネット
  const fetchMedia = async name => {
    const u = ctx.MEDIA + encodeURIComponent(name);
    try { const hit = await (await caches.open(MEDIA_CACHE)).match(u); if (hit) return hit.blob(); } catch {}
    if (uploadBytes.has(name)) return new Blob([uploadBytes.get(name)]);
    const r = await fetch(u); if (!r.ok) return null; const ct = r.headers.get('content-type') || ''; if (ct.includes('text/html') && !/\.html?$/i.test(name)) return null; return r.blob();
  };

  // ---------- 進み具合（画面の真ん中の小窓） ----------
  let hud = null;
  let quiet = false;   // 自動バックアップの最中は、真ん中の小窓を出さない
  function progress(text) {
    if (quiet) return;
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
    deleteNotes: nids => ctx.notes.removeNotes(nids),
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
      const R = await ex.readForReplace(file), L = R.log, k = L.skipped;
      // 消す数が多いことがあるので、数を見せてもう一度たずねる（同期で Anki のコレクションにも同じことが起きる）
      const lines = [`ファイル内にあるノート: ${L.found}枚`, `追加: ${L.new}・更新: ${L.updated}・削除: ${L.removed}`, `カードの状態を合わせる: ${L.cards}枚・学習履歴を足す: ${L.revlog}件`];
      if (k.ntSchema || k.noteType || k.cardsLeft || k.revLeft || k.decksKept || k.media) lines.push(`そのままにするもの: ノートタイプ ${k.ntSchema}・ノート ${k.noteType}・カード ${k.cardsLeft}・学習履歴 ${k.revLeft}・デッキ ${k.decksKept}・メディア ${k.media}`);
      lines.push('次の同期で、パソコンの Anki にも同じ変更が入ります。');
      const go = await ctx.iosPrompt({ title: 'コレクションをインポート', message: lines.join('\n'), ok: '置き換える', danger: true });
      if (!go) return;
      progress('コレクションをインポート中...');
      const log = await ex.applyReplace(R, hooks);
      progress(null);
      ctx.iosAlert('インポート', `コレクションをインポートしました。\n追加: ${log.new}・更新: ${log.updated}・削除: ${log.removed}・カード: ${log.cards}・メディア: ${log.media}`);
    } catch (e) { progress(null); console.error(e); ctx.iosAlert('インポート', String(e?.message || e)); }
  }
  // ---------- バックアップ（app/backup.mjs の決まり。端末の kv に bk:list＝[{ name, size }] と bk:<名前>＝中身） ----------
  const bkLimits = () => { const g = k => { try { const v = localStorage.getItem('bk:' + k); return v == null ? BK_DEF[k] : Math.max(0, parseInt(v, 10) || 0); } catch { return BK_DEF[k]; } }; return { mins: g('mins'), daily: g('daily'), weekly: g('weekly'), monthly: g('monthly') }; };
  const setBkLimit = (k, v) => { try { localStorage.setItem('bk:' + k, String(Math.max(0, parseInt(v, 10) || 0))); } catch {} };
  let bkCache = null, bkRunning = null;
  async function backups() { bkCache = ((await store.get('kv', 'bk:list')) || []).filter(b => parseBackupName(b.name)).sort((a, b) => b.name.localeCompare(a.name)); return bkCache; }
  // 作る。force＝「バックアップを作成」（間隔は見ない）。sig＝コレクションの今の印（前のバックアップと同じなら作らない＝rslib changed_since_last_backup）
  // 返す: 'created' | 'unchanged' | 'recent' | 'busy'
  async function backup(force, sig) {
    if (bkRunning) return 'busy';
    bkRunning = (async () => {
      const list = await backups(), now = new Date(), lim = bkLimits();
      if (sig != null && sig === (await store.get('kv', 'bk:sig'))) return 'unchanged';
      if (!force && list.some(b => now - parseBackupName(b.name) < lim.mins * 60000)) return 'recent';
      quiet = !force; if (force) progress('バックアップを作成中…');
      let out; try { out = await ex.exportCollection({ media: false }); } finally { quiet = false; progress(null); }
      const name = backupName(now);
      // 置き場の上限: 端末の容量の目安の 1/4（分からなければ 500MB）までに収める。超えるなら古いものから消す（未送信の答えを入れる場所を食いつぶさないように）
      let budget = 500 * 1048576; try { const est = await navigator.storage?.estimate?.(); if (est?.quota) budget = Math.min(budget * 4, est.quota / 4); } catch {}
      if (out.blob.size > budget) return 'toolarge';
      try { await store.set('kv', out.blob, 'bk:' + name); }
      catch (e) { for (const b of [...list].sort((a, c) => a.name.localeCompare(c.name)).slice(0, 3)) await store.del('kv', 'bk:' + b.name).catch(() => {}); throw e; }   // 入りきらない: 古いものを少し消して、今回はあきらめる
      const all = [...list.filter(b => b.name !== name), { name, size: out.blob.size }];
      const gone = obsoleteBackups(all.map(b => ({ ...b, date: parseBackupName(b.name) })), now, lim);
      let keep0 = all.filter(b => !gone.some(g => g.name === b.name)).sort((a, c) => a.name.localeCompare(c.name));
      while (keep0.length > 1 && keep0.reduce((t, b) => t + (b.size || 0), 0) > budget) gone.push(keep0.shift());   // 間引いても多すぎるときは、古いものから
      for (const b of gone) await store.del('kv', 'bk:' + b.name);
      const keep = all.filter(b => !gone.some(g => g.name === b.name));
      await store.set('kv', keep, 'bk:list'); if (sig != null) await store.set('kv', sig, 'bk:sig');
      bkCache = keep.sort((a, b) => b.name.localeCompare(a.name));
      return 'created';
    })().finally(() => { bkRunning = null; });
    return bkRunning;
  }
  // 戻す: .colpkg の読み込み（置き換え）と同じ道で
  async function restoreBackup(name) {
    const blob = await store.get('kv', 'bk:' + name);
    if (!blob) { ctx.iosAlert('バックアップ', 'ファイルが壊れています。バックアップから復元してください。'); return; }
    await importCollection(new File([blob], name));
  }
  return { mediaLog, pendingMedia: queue, backup, backups, backupsCached: () => bkCache, bkLimits, setBkLimit, restoreBackup, exportDeck, exportCollection, importFile, pickFile, uploadPending, mediaIndex, addMedia, sha1Of, ex, share };
}
