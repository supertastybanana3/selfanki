// 端末の中の保存（IndexedDB）。
//   srv_cards / srv_revlog … サーバー（D1）から取ってきた「移行時点より後の変化」の写し
//   outbox                 … まだサーバーに送っていない自分の操作（答えた・元に戻した）。送れたら消す
//   srv_notes              … サーバーから取ってきた、端末で追加・編集・削除したノート（束の上に重ねる）
//   kv                     … 差分の続きの位置など
// 版1（試作）の cards / revlog は試しに答えた分なので、版2に上げるときに捨てる（本番の開始）。
const DB_NAME = 'selfanki', VERSION = 3;
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const old of ['cards', 'revlog']) if (db.objectStoreNames.contains(old)) db.deleteObjectStore(old);
      if (!db.objectStoreNames.contains('srv_cards')) db.createObjectStore('srv_cards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('srv_revlog')) db.createObjectStore('srv_revlog', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { autoIncrement: true });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('srv_notes')) db.createObjectStore('srv_notes', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
export async function getAll(store) { const db = await open(); return req(db.transaction(store).objectStore(store).getAll()); }
export async function get(store, key) { const db = await open(); return req(db.transaction(store).objectStore(store).get(key)); }
export async function set(store, value, key) { const db = await open(); const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key); return done(tx); }
// 送る前の操作を積む
export async function addOp(op) { const db = await open(); const tx = db.transaction('outbox', 'readwrite'); tx.objectStore('outbox').add({ ...op, at: Date.now() }); return done(tx); }
// まとめて足す（フィルターデッキを組む・空にするときなど、たくさんのカードを一度に）
export async function addOps(ops) { if (!ops.length) return; const db = await open(); const tx = db.transaction('outbox', 'readwrite'); const at = Date.now(); for (const op of ops) tx.objectStore('outbox').add({ ...op, at }); return done(tx); }
export async function outbox() {
  const db = await open(); const tx = db.transaction('outbox'); const st = tx.objectStore('outbox');
  const [keys, vals] = await Promise.all([req(st.getAllKeys()), req(st.getAll())]);
  return keys.map((k, i) => ({ key: k, op: vals[i] }));
}
export async function dropOps(keys) { const db = await open(); const tx = db.transaction('outbox', 'readwrite'); for (const k of keys) tx.objectStore('outbox').delete(k); return done(tx); }
// サーバーから取った差分をまとめて書く（続きの位置も同じ取引で）
export async function savePulled(cards, revlog, cursor, notes = []) {
  const db = await open(); const tx = db.transaction(['srv_cards', 'srv_revlog', 'srv_notes', 'kv'], 'readwrite');
  for (const c of cards) tx.objectStore('srv_cards').put(c);
  for (const r of revlog) tx.objectStore('srv_revlog').put(r);
  for (const n of notes) tx.objectStore('srv_notes').put(n);
  tx.objectStore('kv').put(cursor, 'cursor');
  return done(tx);
}
// 移行時点のファイルが作り直されたら、差分の写しを捨てて最初から取り直す
export async function resetServerCopy(baseName) {
  const db = await open(); const tx = db.transaction(['srv_cards', 'srv_revlog', 'srv_notes', 'kv'], 'readwrite');
  tx.objectStore('srv_cards').clear(); tx.objectStore('srv_revlog').clear(); tx.objectStore('srv_notes').clear();
  tx.objectStore('kv').put({ cs: 0, ci: 0, rs: 0, ri: 0, ns: 0, ni: 0 }, 'cursor'); tx.objectStore('kv').put(baseName, 'base');
  return done(tx);
}
