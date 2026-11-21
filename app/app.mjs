// 自作の暗記アプリ（試作）本体
import { makeContext, nextStates, answer, forgetCard, setDueDate, parseDueDate, timingToday, learningSteps, buildLoadBalancer, lbAdd, learningFuzzSecs } from '../fsrs/sched.mjs';
import { buildQueues, todayCounts, nextCard, deckCmp } from '../fsrs/queue.mjs';
import { installAnkiBackend } from './ankiweb.mjs';
import { compileSearch, loadNotes, displayText } from './search.mjs';
import * as store from './store.mjs';
import * as sync from './sync.mjs';
import { createPen } from './pen.mjs';
import { createAsk } from './ask.mjs';
import { typeQuestion, typeAnswer } from './typeans.mjs';
import { createScratchpad, spPref, SP_WIDTH, SP_SIZE, SP_ALPHA } from './scratchpad.mjs';

const BUNDLE = new URL('../bundle/', location.href).href;
const MEDIA = BUNDLE + 'media/';
const MATHJAX_URL = new URL('../vendor/mathjax/tex-chtml.js', location.href).href;
const $ = s => document.querySelector(s);
const S = { meta: null, all: [], cards: [], byId: new Map(), revlog: [], revIds: new Set(), deck: null, q: null, card: null, side: 'q', undo: [], shownAt: 0, open: new Set() };
let pen, ask, sp;
// ---------- 画面の明るさ（自動／ダーク／ライト） ----------
const THEMES = ['auto', 'dark', 'light'], THEME_LABEL = { auto: '自動', dark: 'ダーク', light: 'ライト' };
const mq = matchMedia('(prefers-color-scheme: dark)');
const theme = () => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } };
const isDark = () => theme() === 'dark' || (theme() === 'auto' && mq.matches);
const barStyle = () => { try { return localStorage.getItem('bar') || 'gray'; } catch { return 'gray'; } };
const barDark = () => { try { return localStorage.getItem('barDark') || 'translucent'; } catch { return 'translucent'; } };
// 学習の設定（AnkiMobile の「設定＞学習」と同じ項目。既定値も AnkiMobile と同じ）
// 本家に無い、このアプリ独自の機能は、組み立てのとき（config.json の extras → bundle/manifest.json の features）に入れたものだけが出る。
//   features.pen      … 書き込みのデザインの名前（app/designs/<名前>/design.mjs）。空なら書き込みは無い（道具も出ず、Pencil でも書けない）
//   features.autoSync … 答えるたびに自動で同期するのを既定にするか。入れていなければ本家と同じく「同期」を押したときだけ
// 入れた機能は「設定」→「このアプリ独自の機能」で端末ごとに切れる
const FEAT = { pen: '', autoSync: false, lang: 'ja' };   // lang … 画面の言語（Anki の言語の番号の形 ja・de-DE など。tools/build_site.py が config.json の language から入れる）
let DESIGN = null;   // 読み込んだ書き込みのデザイン（mount の返り値）
const PREF_DEFAULT = { neverType: false, replayBtn: true, stopQAudio: true, topbar: true, bottombar: true, counts: true, answerBtn: true, ivl: true, pen: true, autoSync: false, ticks: true, ticksByType: false, toolsBtn: true, noPad: false, extLinks: true };
// autoSync: 既定は本家の Anki と同じく、下の「同期」を押したときだけ送受信する。オンにすると、答えるたびに数秒後に送り、開いたとき・戻ったとき・5分ごとにも同期する（このアプリ独自の方式）
const pref = k => { try { const v = localStorage.getItem('pref:' + k); return v == null ? PREF_DEFAULT[k] : v === '1'; } catch { return PREF_DEFAULT[k]; } };
// 学習の設定を画面に映す（トップバー・ボトムバー・残り枚数・回答ボタン・次回までの間隔）
function applyPrefs() {
  const c = document.body.classList;
  c.toggle('notopbar', !pref('topbar')); c.toggle('nobottombar', !pref('bottombar'));
  c.toggle('nocounts', !pref('counts')); c.toggle('noanswerbtn', !pref('answerBtn')); c.toggle('noivl', !pref('ivl'));
  const penOn = !!DESIGN && pref('pen');
  c.toggle('nopen', !penOn); if (typeof pen !== 'undefined' && pen) pen.setEnabled(penOn);
  // ツールアイコン（歯車）を出すか・左右どちらか（設定＞学習）。左に置くときは、手書きパッドの元に戻すは右へ
  c.toggle('notools', !pref('toolsBtn')); c.toggle('toolsleft', toolsLeft());
  if (typeof sp !== 'undefined' && sp) sp.refresh();
}
const toolsLeft = () => { try { return localStorage.getItem('toolsPos') === 'left'; } catch { return false; } };
// 回答確認用のマーク（AnkiMobile 25.09 の実機で測った: カードの右上、上の帯の下 27.5pt・右から 20.5pt を中心に、
// 「もう一度」は赤い×（25pt）、それ以外は緑のチェック（30×25pt）。出てすぐ約 0.53 秒かけて同じ速さで消える）
// 「表示位置を種類別にする」をオンにすると、その答えのボタンの真上（横の中心をそろえる）に、ボタンと同じ色で出る（もう一度＝赤の×・難しい＝橙・正解＝緑・簡単＝青の✓。実機で測った）
const TICK_COLOR = { 1: 'rgb(255,78,78)', 2: 'rgb(255,150,0)', 3: 'rgb(0,255,0)', 4: 'rgb(0,135,255)' };
function flashTick(g) {
  if (!pref('ticks')) return;
  let el = $('#tick'); if (!el) { el = document.createElement('div'); el.id = 'tick'; el.className = 'float'; $('#cardhost').append(el); }
  const byType = pref('ticksByType'), color = byType ? TICK_COLOR[g] : (g === 1 ? TICK_COLOR[1] : TICK_COLOR[3]);
  el.innerHTML = g === 1
    ? `<svg viewBox="0 0 30 30" width="30" height="30"><path d="M8 8 22 22M22 8 8 22" stroke="#2e2e2e" stroke-width="6.6" stroke-linecap="square"/><path d="M8 8 22 22M22 8 8 22" stroke="${color}" stroke-width="5" stroke-linecap="square"/></svg>`
    : `<svg viewBox="0 0 30 30" width="30" height="30"><path d="M4 16.5 11.2 23.5 26.5 7.5" fill="none" stroke="#2e2e2e" stroke-width="6.6" stroke-linejoin="miter" stroke-linecap="square"/><path d="M4 16.5 11.2 23.5 26.5 7.5" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="miter" stroke-linecap="square"/></svg>`;
  const btn = byType && document.querySelector(`#answerbar .rate:nth-child(${g})`);
  if (btn) { const r = btn.getBoundingClientRect(), h = $('#cardhost').getBoundingClientRect(); el.style.right = 'auto'; el.style.left = (r.left + r.width / 2 - h.left - 15) + 'px'; }
  else { el.style.left = ''; el.style.right = ''; }
  el.style.transition = 'none'; el.style.opacity = '1'; void el.offsetWidth;
  el.style.transition = 'opacity 530ms linear'; el.style.opacity = '0';
}
// ダブルタップ防止（設定＞学習）。標準は実機で 0.15 秒を無視・0.3 秒を受け付けた。短い・長いは測っていない（目安）
const DTP = { short: ['短い', 120], normal: ['標準', 250], long: ['長い', 450] };
const dtpKey = () => { try { const v = localStorage.getItem('dtp'); return DTP[v] ? v : 'normal'; } catch { return 'normal'; } };
// シェイク（端末を振る）。既定は「元に戻す」（マニュアル）。iPhone・iPad の Safari は、設定で選んだときに動きの使用を許可してもらう
function setupShake() {
  let last = 0, hits = [];
  window.addEventListener('devicemotion', e => {
    const a = e.acceleration; if (!a || a.x == null) return;
    const m = Math.hypot(a.x, a.y, a.z), now = Date.now();
    if (m < 14) return;
    hits = hits.filter(t => now - t < 600); hits.push(now);
    if (hits.length >= 2 && now - last > 1200) { last = now; hits = []; const k = shakeAct(); if (k !== 'off') runAction(k); }
  });
}
function applyTheme() {
  const t = theme();
  const bs = barStyle(); if (bs === 'gray') delete document.documentElement.dataset.bar; else document.documentElement.dataset.bar = bs;
  if (barDark() === 'black') document.documentElement.dataset.bard = 'black'; else delete document.documentElement.dataset.bard;
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  penSide(S.side); sp?.refresh();
  if (S.card) setFrame(cardHtml(S.card, S.side), S.card.mid, S.card.ord);
}
// 書き込みのデザインに、いま表と裏のどちらか・暗いテーマかを知らせる（墨の色はデザインが決める）
const penSide = side => { try { DESIGN?.onSide?.(side, isDark()); } catch {} };
async function loadDesign(name) {
  if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) return;
  try {
    const mod = await import(new URL(`./designs/${name}/design.mjs`, import.meta.url));
    const host = $('#corner').parentElement;
    DESIGN = mod.mount({ pen, host, isDark, isShell: !!window.webkit?.messageHandlers?.sa,
      keyboardMode: { active: () => kbdActive(), toggle: () => { const a = kbdActive(); KBD.on = !a; KBD.keyAt = 0; paintKbd(); } } }) || {};
  } catch (e) { console.error('書き込みのデザインを読めませんでした', name, e); DESIGN = null; }
  applyPrefs(); penSide(S.side); paintKbd();
}
mq.addEventListener('change', applyTheme);

async function fetchJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); }
const nowSecs = () => Math.floor(Date.now() / 1000);
const presetOf = did => S.meta.presets[S.decksById.get(did).conf];
const cfg = () => ({ crt: S.meta.crt, meta: S.meta, fsrs: !!S.meta.config.fsrs, fsrsShortTermWithStepsEnabled: !!S.meta.config.fsrsShortTermWithStepsEnabled });

// ---------- 読み込み ----------
// カードの中身＝配ったファイル（c/*.json）。状態は「移行した時点（state.*.json）」に「サーバーの差分（D1 の写し）」と
// 「まだ送っていない自分の答え（outbox）」を順に重ねたもの
const STATE_KEYS = ['type', 'queue', 'due', 'ivl', 'factor', 'reps', 'lapses', 'left', 'data'];
// flags（フラグ）と mark（ノートのマーク＝タグ marked）も状態として運ぶ。mark はアプリで付け外ししたときだけ入る
const pickState = c => { const o = {}; for (const k of STATE_KEYS) o[k] = c[k]; o.flags = c.flags || 0; if (c.mark !== undefined) o.mark = c.mark ? 1 : 0; if (c.leeched) o.leech = 1; return o; };
function applyState(c, st, rev) { for (const k of STATE_KEYS) if (k in st) c[k] = st[k]; if ('flags' in st) c.flags = st.flags; if ('mark' in st) c.mark = !!st.mark; if (st.leech) c.leeched = true; c.rev = rev; }
const REV_KEYS = ['id', 'cid', 'ease', 'ivl', 'lastIvl', 'factor', 'time', 'type'];
function addRev(r) { if (S.revIds.has(r.id)) return; S.revIds.add(r.id); const o = {}; for (const k of REV_KEYS) o[k] = r[k]; S.revlog.push(o); }
function delRev(id) { if (!S.revIds.delete(id)) return; S.revlog = S.revlog.filter(r => r.id !== id); }
function applyOp(op) {
  const c = S.byId.get(op.c?.id); if (!c) return;
  if (op.t === 'ans') { applyState(c, op.c.st, op.c.rev); addRev(op.r); }
  else if (op.t === 'undo') { applyState(c, op.c.st, op.c.rev); delRev(op.rid); }
  else if (op.t === 'set') applyState(c, op.c.st, op.c.rev);   // 休止・非表示・フラグ・マーク・元に戻す
}
// ---------- デッキのオプション（サーバーの conf 表）。Anki 側（配った中身）より新しいものだけ重ねる ----------
function applyConf(rows) {
  if (!Array.isArray(rows)) return;
  if (rows.length) S.mainQ = null;   // 上限・並びが変わるので組み直す
  for (const { k, v, rev } of rows) {
    if (k.startsWith('preset:')) {
      const id = +k.slice(7), cur = S.meta.presets[id];
      if (cur && rev <= (cur.mod || 0) * 1000) continue;
      if (v.removed) delete S.meta.presets[id]; else S.meta.presets[id] = { ...v, id, mod: Math.floor(rev / 1000) };
    } else if (k.startsWith('deck:')) {
      const d = S.decksById.get(+k.slice(5)); if (!d || rev <= (d.mod || 0) * 1000) continue;
      Object.assign(d, v); d.mod = Math.floor(rev / 1000);
    } else if (k === 'global') Object.assign(S.meta.config, v);
  }
}
async function saveConf(k, v, rev) { applyConf([{ k, v, rev }]); await store.addOp({ t: 'conf', k, v, rev }); }
// Anki の「デッキのオプション」画面で保存したとき（rslib deckconfig/update.rs と同じ考え方）
async function updateDeckConfigs(req) {
  const rev = Date.now(), today = timingToday(nowSecs(), S.meta).daysElapsed; let lastId = null, n = 0;
  for (const p of req.configs) { const id = p.id || rev + n++; await saveConf('preset:' + id, { ...p, id }, rev); lastId = id; }
  for (const id of req.removed) if (id !== 1) await saveConf('preset:' + id, { removed: true }, rev);
  for (const d of S.meta.decks) if (req.removed.includes(d.conf) && d.id !== req.target) await saveConf('deck:' + d.id, { conf: 1 }, rev);
  const deck = S.decksById.get(req.target);
  if (deck) {
    const L = req.limits;
    const dv = { reviewLimit: L.reviewLimit, newLimit: L.newLimit, desiredRetention: L.desiredRetention,
      reviewLimitToday: L.reviewToday != null ? { limit: L.reviewToday, today: L.reviewTodayActive ? today : (deck.reviewLimitToday?.today ?? 0) } : null,
      newLimitToday: L.newToday != null ? { limit: L.newToday, today: L.newTodayActive ? today : (deck.newLimitToday?.today ?? 0) } : null };
    if (lastId != null) dv.conf = lastId;
    await saveConf('deck:' + deck.id, dv, rev);
    if (req.mode === 1 && lastId != null) for (const d of S.meta.decks) if (d.name.startsWith(deck.name + '::') && !d.dyn) await saveConf('deck:' + d.id, { conf: lastId }, rev);
  }
  await saveConf('global', { fsrs: req.fsrs, applyAllParentLimits: req.applyAllParentLimits, newCardsIgnoreReviewLimit: req.newCardsIgnoreReviewLimit }, rev);
  scheduleSync(500);
  if (document.body.dataset.view === 'decks') showDecks(); else if (S.card) { const { c } = countsFor(S.deck); paintCounts(c, S.card); }
  toast('オプションを保存しました');
}
function applyServer(cards, revlog) {
  for (const row of cards) { const c = S.byId.get(row.id); if (c) applyState(c, row.st, row.rev); }
  for (const r of revlog) { if (r.del) delRev(r.id); else addRev(r); }
}
const refreshCards = () => { S.cards = S.all.filter(c => c.type != null); };
async function load() {
  $('#status').textContent = '読み込み中…';
  const man = await fetchJSON(BUNDLE + 'manifest.json');
  Object.assign(FEAT, man.features || {}); PREF_DEFAULT.autoSync = !!FEAT.autoSync;
  if (FEAT.lang && !/^ja/.test(FEAT.lang)) import('./i18n.mjs').then(m => m.start(FEAT.lang)).catch(() => {});
  if (FEAT.pen) loadDesign(FEAT.pen);
  const [meta, chunks, base, baseRev] = await Promise.all([fetchJSON(BUNDLE + man.meta), Promise.all(man.chunks.map(c => fetchJSON(BUNDLE + c.f))),
    fetchJSON(BUNDLE + man.base.state), fetchJSON(BUNDLE + man.base.revlog)]);
  S.meta = meta; S.manifest = man; S.decksById = new Map(meta.decks.map(d => [d.id, d]));
  // 「今のデッキ」（統計・ブラウザの deck:current）: この端末で最後に開いたデッキ、無ければ Anki の curDeck（Anki と同じく開き直しても覚えている）
  if (typeof S.lastDeck !== 'number') { let d = null; try { d = +localStorage.getItem('lastDeck') || null; } catch {} if (!S.decksById.has(d)) d = meta.config?.curDeck; if (S.decksById.has(d)) S.lastDeck = d; }
  // 開いた親デッキは開き直しても残す（AnkiMobile と同じ）。この端末で一度も触っていなければ Anki の「畳んだ」印に従う
  try { const o = JSON.parse(localStorage.getItem('openDecks') || 'null'); S.open = new Set(Array.isArray(o) ? o : meta.decks.filter(d => !d.collapsed).map(d => d.id)); } catch { S.open = new Set(meta.decks.filter(d => !d.collapsed).map(d => d.id)); }
  S.all = chunks.flat(); S.byId = new Map(S.all.map(c => [c.id, c]));
  for (const row of base) { const c = S.byId.get(row[0]); if (!c) continue; STATE_KEYS.forEach((k, i) => { c[k] = row[i + 1]; }); c.rev = row[STATE_KEYS.length + 1]; }
  // 移行した時点のあとに Anki で足したカードの状態（tools/build_site.py が配る）。移行時点の状態が無いカードにだけ入れる
  S.revlog = []; S.revIds = new Set();
  const add = man.base.add ? await fetchJSON(BUNDLE + man.base.add) : null;
  if (add) {
    for (const row of add.state) { const c = S.byId.get(row[0]); if (!c || c.type != null) continue; STATE_KEYS.forEach((k, i) => { c[k] = row[i + 1]; }); c.rev = row[STATE_KEYS.length + 1]; }
    for (const r of add.revlog) addRev({ id: r[0], cid: r[1], ease: r[2], ivl: r[3], lastIvl: r[4], factor: r[5], time: r[6], type: r[7] });
  }
  for (const r of baseRev) addRev({ id: r[0], cid: r[1], ease: r[2], ivl: r[3], lastIvl: r[4], factor: r[5], time: r[6], type: r[7] });
  if ((await store.get('kv', 'base')) !== man.base.state) await store.resetServerCopy(man.base.state);
  applyServer(await store.getAll('srv_cards'), (await store.getAll('srv_revlog')).sort((a, b) => a.seq - b.seq));
  applyConf(await store.get('kv', 'conf')); applyConf((await store.outbox()).map(x => x.op).filter(o => o.t === 'conf'));
  for (const { op } of await store.outbox()) applyOp(op);
  refreshCards();
  checkDay(true);
  $('#status').textContent = '';
  showDecks();
  startSyncLoop();
  prefetchAll(man);
  if (man.askhist) fetchJSON(BUNDLE + man.askhist).then(list => ask.importHistory(list)).catch(() => {});
}
// ネットが無いところでも出せるように、画像・音声と今の束を全部端末に取っておく（Service Worker に頼む）
async function prefetchAll(man) {
  if (!navigator.serviceWorker || new URLSearchParams(location.search).has('noprefetch')) return;
  try { await navigator.storage?.persist?.(); } catch {}
  const reg = await navigator.serviceWorker.ready.catch(() => null); if (!reg?.active) return;
  // スマホが携帯の回線（またはデータセーバー）のときは画像・音声を先に全部は取らない（量はコレクションによる）。出てきたカードの分だけ取る。Wi-Fi になったら取り直す
  const conn = navigator.connection;
  if (conn && !prefetchAll.hooked) { prefetchAll.hooked = true; conn.addEventListener?.('change', () => { if (conn.type !== 'cellular' && !conn.saveData) prefetchAll(man); }); }
  const metered = !!conn && (conn.type === 'cellular' || conn.saveData);
  const names = metered ? [] : await fetchJSON(BUNDLE + man.media).catch(() => []);
  const data = [man.meta, man.base.state, man.base.revlog, ...(man.base.add ? [man.base.add] : []), man.media, ...man.chunks.map(c => c.f), ...(man.notes || [])].map(f => BUNDLE + f);
  // 一覧は [名前, 中身の指紋]（古い形の 名前だけ にも対応）
  reg.active.postMessage({ type: 'prefetch', data, media: names.map(x => Array.isArray(x) ? { u: MEDIA + encodeURIComponent(x[0]), h: x[1] } : { u: MEDIA + encodeURIComponent(x), h: '' }) });
}

// ---------- 同期（サーバーへ送る・差分を取る） ----------
let syncT = null;
function scheduleSync(ms = 4000) {
  if (!autoSyncOn() && !syncNeverDone()) { paintSync(); return; }   // 手動のとき: 送らずに、未送信の数だけ出し直す
  clearTimeout(syncT); syncT = setTimeout(runSync, ms);
}
// この端末でまだ一度も同期していなければ、最初の1回だけは自動でする（本家でも、使い始めに同期する）
const autoSyncOn = () => !!FEAT.autoSync && pref('autoSync');
const syncNeverDone = () => { try { return !localStorage.getItem('syncedOnce'); } catch { return false; } };
// 手で同期したときの小窓（AnkiMobile 25.09 の実機と同じ「同期中... 追加/変更: N↑ N↓ 削除: N↑ N↓」）。キャンセルは小窓を閉じるだけ（同期は続く）
async function runSync(manual = false) {
  const btn = $('#nav-sync'); btn.classList.add('busy');
  let dlg = null;
  if (manual) {
    const ops = (await store.outbox()).map(x => x.op);
    const up = ops.filter(o => o.t !== 'undo').length, upDel = ops.filter(o => o.t === 'undo').length;
    dlg = document.createElement('div'); dlg.id = 'syncdlg';
    dlg.innerHTML = `<div class="box"><b>同期中...</b><p>追加/変更： ${up}↑ <span class="dn">0</span>↓<br>削除：${upDel}↑ <span class="dd">0</span>↓</p><svg class="spin" viewBox="0 0 36 36"><line x1="18" y1="4" x2="18" y2="11" stroke="#fff" stroke-width="3.6" stroke-linecap="round" opacity="0.25" transform="rotate(0 18 18)"/><line x1="18" y1="4" x2="18" y2="11" stroke="#fff" stroke-width="3.6" stroke-linecap="round" opacity="0.36" transform="rotate(45 18 18)"/><line x1="18" y1="4" x2="18" y2="11" stroke="#fff" stroke-width="3.6" stroke-linecap="round" opacity="0.46" transform="rotate(90 18 18)"/><line x1="18" y1="4" x2="18" y2="11" stroke="#fff" stroke-width="3.6" stroke-linecap="round" opacity="0.57" transform="rotate(135 18 18)"/><line x1="18" y1="4" x2="18" y2="11" stroke="#fff" stroke-width="3.6" stroke-linecap="round" opacity="0.68" transform="rotate(180 18 18)"/><line x1="18" y1="4" x2="18" y2="11" stroke="#fff" stroke-width="3.6" stroke-linecap="round" opacity="0.79" transform="rotate(225 18 18)"/><line x1="18" y1="4" x2="18" y2="11" stroke="#fff" stroke-width="3.6" stroke-linecap="round" opacity="0.89" transform="rotate(270 18 18)"/><line x1="18" y1="4" x2="18" y2="11" stroke="#fff" stroke-width="3.6" stroke-linecap="round" opacity="1.00" transform="rotate(315 18 18)"/></svg><button>キャンセル</button></div>`;
    dlg.querySelector('button').onclick = () => dlg.remove(); document.body.append(dlg);
  }
  const t0 = Date.now(), got = await sync.syncNow();
  if (dlg) {
    if (got) { dlg.querySelector('.dn').textContent = got.cards.length + got.revlog.filter(r => !r.del).length; dlg.querySelector('.dd').textContent = got.revlog.filter(r => r.del).length; }
    setTimeout(() => dlg.remove(), Math.max(0, 600 - (Date.now() - t0)));
  }
  btn.classList.remove('busy');
  if (sync.state.online) { try { localStorage.setItem('syncedOnce', '1'); } catch {} }
  if (got && (got.cards.length || got.revlog.length || got.conf?.length)) {
    applyServer(got.cards, got.revlog);
    if (got.conf) { applyConf(got.conf); applyConf((await store.outbox()).map(x => x.op).filter(o => o.t === 'conf')); }
    for (const { op } of await store.outbox()) applyOp(op); // 同期の最中に答えた分を重ね直す
    refreshCards(); S.mainQ = null; unburyOld();
    if (document.body.dataset.view === 'decks') showDecks(); else if (S.deck) paintCounts(countsFor(S.deck).c, S.card);
  }
  paintSync();
}
async function paintSync() {
  const btn = $('#nav-sync'); const n = await sync.pendingCount();
  btn.classList.toggle('err', sync.state.online === false && !sync.state.serverless);
  btn.dataset.n = n ? String(n) : '';
  btn.title = sync.state.serverless ? 'サーバーなし' : sync.state.online === false ? `同期できません: ${sync.state.lastError}` : n ? `未送信 ${n}` : '同期済み';
}
function startSyncLoop() {
  const btn = $('#nav-sync'); btn.disabled = false; btn.onclick = () => runSync(true);
  const auto = autoSyncOn;
  window.addEventListener('online', () => { if (auto()) scheduleSync(500); });
  document.addEventListener('visibilitychange', () => { if (!auto()) return; if (!document.hidden) scheduleSync(500); else runSync(); });
  setInterval(() => { if (auto() && !document.hidden) runSync(); }, 5 * 60 * 1000);
  scheduleSync(300); paintSync();
}

// ---------- カスタム学習セッション ----------
const SESSION_NAME = 'カスタム学習セッション';
function loadSession() { try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch { return null; } }
function saveSession(x) { try { x ? localStorage.setItem('session', JSON.stringify(x)) : localStorage.removeItem('session'); } catch {} }
function sessionCards() { const se = loadSession(); return se ? se.ids.map(id => S.byId.get(id)).filter(c => c && c.queue >= 0) : []; }
function sessionCounts() {
  const now = nowSecs(); const t = timingToday(now, S.meta);
  const cards = sessionCards();
  const learning = cards.filter(c => c.queue === 1 && c.due < t.nextDayAt).sort((a, b) => a.due - b.due);
  const main = cards.filter(c => c.queue === 2 || c.queue === 3 || c.queue === 0).sort((a, b) => a.due - b.due || a.id - b.id);
  const q = { learning, main, counts: { new: main.filter(c => c.queue === 0).length, learn: learning.length, review: main.filter(c => c.queue !== 0).length }, learnAheadSecs: S.meta.config.collapseTime ?? 1200 };
  return { q, c: [q.counts.new, learning.filter(c => c.due <= now + q.learnAheadSecs).length, q.counts.review] };
}
// 先取り学習: deck:そのデッキ prop:due<=N（復習・日をまたぐ学習）、休止中を除く、期日順
function createReviewAhead(did, days) {
  const root = S.decksById.get(did); const t = timingToday(nowSecs(), S.meta);
  const inDeck = c => { const n = S.decksById.get(c.did)?.name; return n === root.name || n?.startsWith(root.name + '::'); };
  const ids = S.cards.filter(c => inDeck(c) && (c.queue === 2 || c.queue === 3) && c.due - t.daysElapsed <= days).sort((a, b) => a.due - b.due).map(c => c.id);
  saveSession({ kind: 'ahead', from: did, days, ids, created: Date.now() });
  return ids.length;
}
function leaveSessionIfDone(card) {
  const se = loadSession(); if (!se) return;
  // 答えて先の日の復習になったカードはセッションから抜ける（元のデッキに戻る）
  if (card.queue === 2 && card.due > timingToday(nowSecs(), S.meta).daysElapsed) { se.ids = se.ids.filter(id => id !== card.id); saveSession(se.ids.length ? se : null); }
}

// ---------- デッキ一覧 ----------
const extKey = (day, did) => `ext:${day}:${did}`;
function getExt(day, did) { try { return JSON.parse(localStorage.getItem(extKey(day, did)) || 'null') || { new: 0, rev: 0 }; } catch { return { new: 0, rev: 0 }; } }
function addExt(did, kind, n) { S.mainQ = null; const day = timingToday(nowSecs(), S.meta).daysElapsed; const e = getExt(day, did); e[kind] += n; try { localStorage.setItem(extKey(day, did), JSON.stringify(e)); } catch {} }
function countsFor(did) {
  if (did === 'session') return sessionCounts();
  const now = nowSecs(); const timing = timingToday(now, S.meta);
  const counts = todayCounts(S.revlog, S.byId, (timing.nextDayAt - 86400) * 1000);
  const extend = new Map(S.meta.decks.map(d => [d.id, getExt(timing.daysElapsed, d.id)]).filter(([, e]) => e.new || e.rev));
  const ahead = S.meta.config.collapseTime ?? 1200;   // 学習中を先取りする秒数（Anki の「先取りの時間」）
  const q = buildQueues({ selectedDid: did, decks: S.meta.decks, presets: S.meta.presets, cards: S.cards, timing, now, counts, extend, learnAheadSecs: ahead, newIgnoresReviewLimit: !!S.meta.config.newCardsIgnoreReviewLimit, applyAllParentLimits: !!S.meta.config.applyAllParentLimits, fsrs: !!S.meta.config.fsrs });
  const learnNow = q.learning.filter(c => c.due <= now + ahead).length + (q.counts.learn - q.learning.length);
  return { q, c: [q.counts.new, learnNow, q.counts.review] };
}
// 道具の画面（歯車のメニュー）を開く
function openTools() {
  if (document.body.dataset.view !== 'study') return;
  const u = $('#menu-undo'); u.disabled = !S.undo.length; u.textContent = S.undo.length ? 'カードへの回答 を元に戻す' : '元に戻す';
  $('#menu').classList.add('open');
}
function showDecks() {
  if (ask) ask.onCard(null);
  if (typeof stopAv === 'function') stopAv();
  S.deck = null; document.body.dataset.view = 'decks'; sp?.setCard(null); S.auto = false; autoClear();
  checkDay();
  const decks = [...S.meta.decks].sort(deckCmp);
  const kids = name => decks.filter(d => d.name.startsWith(name + '::') && !d.name.slice(name.length + 2).includes('::'));
  const ul = $('#decklist'); ul.innerHTML = '';
  const chev = '<svg width="7.7" height="12.8" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5 7.5 7.5 1.5 13.5"/></svg>';
  const row = (group, d, depth) => {
    const ch = kids(d.name); const el = document.createElement('div'); el.className = 'row'; el.style.setProperty('--depth', depth);
    const [n, l, r] = countsFor(d.id).c; const due = l + r;
    el.innerHTML = `${ch.length ? `<button class="tw">${S.open.has(d.id) ? '−' : '+'}</button>` : ''}<button class="dname"></button>
      <span class="nums" lang="en"><span class="${due ? 'due' : 'zero'}">${due}</span><span class="${n ? 'newc' : 'zero'}">${n}</span></span><button class="chev" title="デッキの設定">${chev}</button>`;
    el.querySelector('.dname').textContent = d.name.split('::').pop(); if (d.dyn) el.querySelector('.dname').classList.add('dyn');
    el.querySelector('.dname').onclick = () => startStudy(d.id);
    const tw = el.querySelector('.tw'); if (tw) tw.onclick = () => { S.open.has(d.id) ? S.open.delete(d.id) : S.open.add(d.id); try { localStorage.setItem('openDecks', JSON.stringify([...S.open])); } catch {} showDecks(); };
    group.appendChild(el);
    if (S.open.has(d.id)) for (const c of ch) row(group, c, depth + 1);
  };
  // AnkiMobile と同じく、カスタム学習セッションも名前の順に並べて青字にする。空の「デフォルト」は出さない
  const used = new Set(S.cards.map(c => c.did));
  const tops = decks.filter(d => !d.name.includes('::') && !(d.id === 1 && !used.has(1) && !kids(d.name).length));
  if (loadSession() && sessionCards().length) tops.push({ id: 'session', name: SESSION_NAME, dyn: true });
  for (const d of tops.sort(deckCmp)) {
    const g = document.createElement('li'); g.className = 'group'; ul.appendChild(g); row(g, d, 0);
  }
}

// ---------- 出題 ----------
// ---------- ブラウザ（AnkiMobile 25.09 と同じ並べ替え項目・カードの種類・期日の3列。休止は黄色地で期日をかっこ書き） ----------
const BR = { list: [], rowH: 30, sel: null };   // sel: 選ぶ状態のとき、選んだカードの id の Set
const pad2 = n => String(n).padStart(2, '0');
const ymd = secs => { const d = new Date(secs * 1000); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
function dueText(c, t, now) {
  let s;
  if (c.type === 0 || c.queue === 0) s = `新規 #${c.due}`;
  else if (c.queue === 1 || (c.type === 1 || c.type === 3) && c.due > 1e9) s = ymd(c.due);
  else s = ymd(now + (c.due - t.daysElapsed) * 86400);
  return c.queue < 0 ? `(${s})` : s;
}
let measureCtx = null;
function fitMiddle(text, width) {
  // iOS の「真ん中を省略」と同じく、前と後ろに幅を半分ずつ使う
  if (!measureCtx) { measureCtx = document.createElement('canvas').getContext('2d'); measureCtx.font = '16px -apple-system, "Hiragino Sans", sans-serif'; }
  const w = x => measureCtx.measureText(x).width;
  if (w(text) <= width) return text;
  const half = (width - w('…')) / 2;
  const fit = f => { let lo = 0, hi = text.length; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f(m)) lo = m; else hi = m - 1; } return lo; };
  const a = fit(k => w(text.slice(0, k)) <= half);
  const b = Math.min(text.length - a, fit(k => w(text.slice(text.length - k)) <= half));
  return text.slice(0, a) + '…' + text.slice(text.length - b);
}
// ブラウザの「選択」（AnkiMobile 25.09: 右上が「アクション」「すべて選択」「キャンセル」、題が「N/M 件選択」、選んだ行の左に ✓）
function setBrowseSelect(on) {
  BR.sel = on ? new Set() : null;
  const nav = $('#browse > .pnav'); nav.classList.toggle('selmode', on);
  paintBrowseTitle(); paintBrowse(true);
}
function paintBrowseTitle() { $('#browse > .pnav .ptitle').textContent = BR.sel ? `${BR.sel.size}/${BR.list.length} 件選択` : 'ブラウザ'; }
// 「アクション」の一覧（実機の並び）。暗記で写せないもの（デッキ・タグ・ノートの変更、削除など）は薄く出して押せない
const BROWSE_ACTIONS = [
  ['deck', 'デッキの変更', null],
  ['flag', 'フラグを変更', cs => pickFlag(cs)],
  ['suspend', '休止 / 休止解除', cs => { const un = cs.length && cs[0].queue === -1; return changeCards(cs, c => { c.queue = un ? (c.type === 0 ? 0 : c.type === 2 ? 2 : (c.due > 1e9 ? 1 : 3)) : -1; }, un ? `${cs.length}枚の休止を解除しました` : `${cs.length}枚を休止しました`, '休止 / 休止解除', false); }],
  ['due', '期日を指定', cs => manualMany(cs, 'due')],
  ['reposition', '並び替える', null],
  ['reset', 'カードをリセット', cs => manualMany(cs, 'reset')],
  ['replace', '検索して置換', null],
  ['tagAdd', 'タグを追加', null],
  ['tagDel', 'タグを解除', null],
  ['notetype', 'ノートタイプを変更', null],
  ['delete', 'ノートを削除する', null],
];
function openBrowseActions() {
  if (!BR.sel || !BR.sel.size) return;
  const cs = BR.list.filter(c => BR.sel.has(c.id));
  let pop = $('#bactions'); if (pop) { pop.remove(); return; }
  pop = document.createElement('div'); pop.id = 'bactions';
  pop.innerHTML = '<div class="h">アクション</div>';
  for (const [k, t, fn] of BROWSE_ACTIONS) {
    const b = document.createElement('button'); b.textContent = t; if (k === 'delete') b.className = 'red'; if (!fn) b.disabled = true;
    b.onclick = async () => { pop.remove(); await fn(cs); paintBrowse(true); };   // 全部を書き終えてから描き直す
    pop.append(b);
  }
  const close = e => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', close, true); } };
  document.addEventListener('pointerdown', close, true);
  $('#browse').append(pop);
  // 「アクション」の真下に、中心をそろえて出す（画面からはみ出さないように）
  const r = $('#browse > .pnav .sel-act').getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(innerWidth - 312, r.left + r.width / 2 - 152)) + 'px';
}
// 「フラグを変更」の小窓（実機: フラグ1 (レッド)〜フラグ7 (パープル)・フラグを消去・キャンセル）
function pickFlag(cs) {
  const d = document.createElement('div'); d.id = 'flagdlg';
  d.innerHTML = '<div class="box"><b>フラグを変更</b></div>';
  const box = d.firstChild;
  const add = (t, fn, cls) => { const b = document.createElement('button'); b.textContent = t; if (cls) b.className = cls; b.onclick = () => { d.remove(); fn && fn(); }; box.append(b); };
  for (let n = 1; n <= 7; n++) add(`フラグ${n} (${FLAG_NAMES[n]})`, () => changeCards(cs, c => { c.flags = (c.flags & ~7) | n; }, `フラグ${n}（${FLAG_NAMES[n]}）を付けました`, 'フラグ', false).then(() => paintBrowse(true)));
  add('フラグを消去', () => changeCards(cs, c => { c.flags = c.flags & ~7; }, 'フラグを外しました', 'フラグ', false).then(() => paintBrowse(true)));
  add('キャンセル', null, 'cancel');
  document.body.append(d);
}
function openBrowse(query) {
  $('#browse').hidden = false; $('#bprev').hidden = true; if (BR.sel) setBrowseSelect(false);
  if (query != null) $('#bq').value = query;
  runBrowse();
}
async function runBrowse() {
  const cur = typeof S.deck === 'number' ? S.deck : S.lastDeck;
  let pred;
  try { await loadNotes(S, BUNDLE); pred = compileSearch(S, $('#bq').value, cur); }
  catch (e) { iosAlert('Error', displayText(String(e && e.message || e))); return; } // AnkiMobile と同じく、一覧は前の結果のまま
  BR.list = S.cards.filter(pred).sort((x, y) => { const a = x.sfld || '', b = y.sfld || ''; return a < b ? -1 : a > b ? 1 : x.ord - y.ord || x.id - y.id; });
  const box = $('#blist'); box.scrollTop = 0;
  box.querySelector('.spacer').style.height = BR.list.length * BR.rowH + 'px';
  if (BR.sel) paintBrowseTitle();
  box.querySelectorAll('.br,.empty').forEach(e => e.remove());
  if (!BR.list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = '一致するカードはありません'; box.appendChild(e); }
  paintBrowse(true);
}
function paintBrowse(force = false) {
  const box = $('#blist'), sp = box.querySelector('.spacer'); const h = BR.rowH;
  const from = Math.max(0, Math.floor(box.scrollTop / h) - 10), to = Math.min(BR.list.length, Math.ceil((box.scrollTop + box.clientHeight) / h) + 10);
  if (!force && BR.from === from && BR.to === to) return; BR.from = from; BR.to = to;
  sp.querySelectorAll('.br').forEach(e => e.remove());
  const now = nowSecs(), t = timingToday(now, S.meta), frag = document.createDocumentFragment();
  const c1w = Math.max(40, box.clientWidth / 3 - 16); // 1列目の幅（窓の 1/3 から余白を引いたもの）
  for (let i = from; i < to; i++) {
    const c = BR.list[i]; const r = document.createElement('div');
    r.className = 'br' + (c.queue === -1 ? ' susp' : (c.flags & 7) ? ` f${c.flags & 7}` : isMarked(c) ? ' mark' : '') + (BR.sel ? ' selmode' : '') + (BR.sel?.has(c.id) ? ' on' : '');
    r.style.top = i * h + 'px'; r.dataset.i = i;
    r.innerHTML = '<span class="c1"></span><span class="c2"></span><span class="c3"></span>';
    r.children[0].textContent = fitMiddle(c.sfld || '', c1w); r.children[1].textContent = c.tname || ''; r.children[2].textContent = dueText(c, t, now);
    frag.appendChild(r);
  }
  sp.appendChild(frag);
}
async function previewCard(c) {
  $('#bprev').hidden = false;
  const f = $('#bprevf'); const css = S.meta.notetypes[c.mid]?.css || ''; const dark = isDark();
  const math = /\\\(|\\\[/.test(c.a) ? `<script>${MATHJAX_CONFIG}</script><script src="${MATHJAX_URL}" async></script>` : '';
  const body = c.a.replace(/\[\[type:[^\]]*\]\]/g, '').replace(/\[anki:play:(q|a):(\d+)\]/g, '');
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${MEDIA}"><style id="sa-base">${BASE_LIGHT}</style><style>${CARD_EXTRA}</style><style>${css}</style><style id="sa-dark"></style>${math}</head><body class="card${dark ? ' nightMode night_mode' : ''}">${body}</body></html>`;
  await new Promise(r => { f.onload = r; });
  if (dark) try { darkify(f.contentDocument); } catch {}
}
function openAnkiPage(route, title, did) {
  $('#awpage .ptitle').textContent = title; $('#awframe').src = `/${route}/` + (typeof did === 'number' ? `?did=${did}` : '');
  $('#awpage').hidden = false;
}
// 負荷分散の数（rslib は出題の並びを作るときに作り直す＝デッキを開いたとき・日付が変わったとき）
function rebuildLB() {
  if (S.meta.config.loadBalancerEnabled === false) { S.lb = null; return; }
  const t = timingToday(nowSecs(), S.meta);
  const cards = S.all.map(c => ({ due: c.due, nid: c.nid, conf: c.inDyn ? null : S.decksById.get(c.did)?.conf }));
  for (const [due, conf, nid] of S.meta.lbExtra || []) cards.push({ due, conf, nid });
  S.lb = buildLoadBalancer(cards, t.daysElapsed, t.nextDayAt, S.meta.presets);
}
function startStudy(did) { if (typeof did === 'number') { S.lastDeck = did; try { localStorage.setItem('lastDeck', String(did)); } catch {} } S.deck = did; S.mainQ = null; S.auto = false; autoClear(); document.body.dataset.view = 'study'; rebuildLB(); advance(); }
// 下の帯の「新規 + 学習中 + 復習」。今のカードの種類に下線（AnkiMobile と同じ）
function paintCounts(c, card) {
  const cur = !card ? null : card.queue === 0 ? 'new' : (card.queue === 1 || card.queue === 3) ? 'lrn' : 'rev';
  $('#counts').innerHTML = `<span class="c-new ${cur === 'new' ? 'cur' : ''}">${c[0]}</span> + <span class="c-lrn ${cur === 'lrn' ? 'cur' : ''}">${c[1]}</span> + <span class="c-rev ${cur === 'rev' ? 'cur' : ''}">${c[2]}</span>`;
}
// force: 元に戻したカード。並びから選び直さずにそのカードを出す（Anki と同じ。選び直すと期限の来た学習中のカードが先に出てしまう）
// 本体（日をまたぐ学習・復習・新規）は、集めたときの顔ぶれと並びのまま、答えた分だけ減らしていく（rslib queue/mod.rs: 答えたあとは
// pop_entry するだけで組み直さない）。組み直すのは、デッキや日付が変わったとき・同期で中身が変わったとき・非表示や休止やフラグを
// 変えたとき・オプションやカスタム学習を変えたとき（Anki もこれらの操作のあとはキューを捨てる）。今日中の学習は毎回見直す
function fixMain(q) {
  const key = `${S.deck}|${S.day}`;
  if (!S.mainQ || S.mainQ.key !== key) { S.mainQ = { key, ids: q.main.map(c => c.id) }; return; }
  const day = timingToday(nowSecs(), S.meta).daysElapsed;
  const still = c => !!c && (c.queue === 0 || ((c.queue === 2 || c.queue === 3) && c.due <= day));
  q.main = S.mainQ.ids.map(id => S.byId.get(id)).filter(still);
  S.mainQ.ids = q.main.map(c => c.id);
  const dayLearn = q.main.filter(c => c.queue === 3).length;
  q.counts = { new: q.main.filter(c => c.queue === 0).length, review: q.main.filter(c => c.queue === 2).length, learn: q.learning.length + dayLearn };
}
function advance(force = null) {
  checkDay();
  let { q, c } = countsFor(S.deck);
  if (S.deck !== 'session') { fixMain(q); c = [q.counts.new, q.learning.filter(x => x.due <= nowSecs() + q.learnAheadSecs).length + (q.counts.learn - q.learning.length), q.counts.review]; }
  S.q = q;
  const nx = force ? { card: force } : nextCard(q, nowSecs());
  $('#donebox').classList.toggle('show', !nx);
  if (!nx) {
    S.card = null; S.side = 'q'; pen.clear(); sp?.setCard(null); autoClear(); paintCounts(c, null); setButtons('q'); ask.onCard(null); paintMarks();
    const soon = q.learning[0];
    // 課題を終えた画面は Anki 本体の画面（/congrats/）。中のリンク（カスタム学習・非表示を戻す）は ankiBridge で受ける
    { const f = $('#doneframe'); const u = `/congrats/?did=${S.deck}`; if (!f.src.endsWith(u)) f.src = u; else f.contentWindow?.location.reload(); }
    return;
  }
  S.card = nx.card; S.side = 'q'; S.shownAt = performance.now(); S.shownState = curState(S.card, nowSecs()); sp?.setCard(S.card);
  pen.clear(); penSide('q'); paintCounts(c, S.card); ask.onCard(S.card); paintMarks();
  S.typed = null; setFrame(cardHtml(S.card, 'q'), S.card.mid, S.card.ord); setButtons('q'); if (autoplay(S.card)) playAv(S.card.qav);
  autoArm();
}
// 裏が画面に出た時刻。キーで答えるのは、裏が出てから少し（GUARD ms）経ってから（スペースの押し直しで「正解」になってしまうのを防ぐ）
const GUARD = 250;
// デッキのオプション「音声を自動で再生しない」（autoplay が false のとき鳴らさない）・「答えの面で再生するとき問題の音声を飛ばす」（replayq が false のとき飛ばす）
const autoplay = card => presetOf(card.did).autoplay !== false;
const replayList = card => S.side === 'a' ? (presetOf(card.did).replayq === false ? card.aav : [...card.qav, ...card.aav]) : card.qav;
function showAnswer() {
  if (!S.card || S.side !== 'q' || S.busy) return;
  S.typed = typedNow();   // 入力して答える: 打ったもの（入力欄が無ければ空）
  S.side = 'a'; S.answerAt = 0; penSide('a');
  const card = S.card;
  setFrame(cardHtml(card, 'a'), card.mid, card.ord, true).then(() => { if (S.card === card && S.side === 'a') S.answerAt = performance.now(); });
  setButtons('a'); if (autoplay(card)) { if (card.aav.length || pref('stopQAudio')) playAv(card.aav); } else if (pref('stopQAudio')) stopAv();
  autoArm();
}
const answerReady = () => S.answerAt && performance.now() - S.answerAt >= GUARD;
const TAP_GUARD = 250; let lastTapAt = 0;
// 答えのボタンを AnkiMobile（UIKit のボタン）と同じ押し方にする（実機で測った）:
//   押しても色は変わらない／離したときに答える／押したまま指をずらしても、ボタンの外 70pt まで（56pt は答え・76pt は取り消し）で離せば答える
const PRESS_SLOP = 70;
function pressButton(el, fn) {
  let id = null, sel = false;
  el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; id = e.pointerId; sel = selAtDown; try { el.setPointerCapture(id); } catch {} e.preventDefault(); });
  el.addEventListener('pointerup', e => {
    if (e.pointerId !== id) return; id = null;
    if (sel) { sel = false; selAtDown = false; clearSel(); return; }   // 文字を選んでいたときは、選択を外すだけ（答えない）
    const r = el.getBoundingClientRect();
    if (e.clientX >= r.left - PRESS_SLOP && e.clientX <= r.right + PRESS_SLOP && e.clientY >= r.top - PRESS_SLOP && e.clientY <= r.bottom + PRESS_SLOP) fn();
  });
  el.addEventListener('pointercancel', () => { id = null; });
  el.addEventListener('click', e => { if (e.detail === 0) fn(); });   // キーボードでボタンを押したとき（指・マウスの click は上で済ませている）
}
function ctxFor(card) {
  let last = null; for (const r of S.revlog) if (r.cid === card.id && (!last || r.id > last.id)) last = r;
  // 負荷分散はフィルターデッキ（カスタム学習セッション・Anki 側でフィルターデッキにあるカード）では使わない（デッキにプリセットが無いため）
  const lb = S.deck === 'session' || card.inDyn ? null : S.lb;
  return makeContext(card, presetOf(card.did), cfg(), nowSecs(), last ? Math.floor(last.id / 1000) : null, { lb, conf: S.decksById.get(card.did)?.conf, filtered: S.deck === 'session' });
}
async function rate(g, byKey = false) {
  if (!S.card || S.side !== 'a' || S.busy) return;
  if (byKey && !answerReady()) return; // 裏が出る前・出た直後のキーは数えない
  if (!checkModified(S.card)) return;
  S.busy = true; try { await rateInner(g); } finally { S.busy = false; }
}
async function rateInner(g) {
  const prev = structuredClone(S.card);
  const maxMs = (presetOf(S.card.did).maxTaken || 60) * 1000;   // 解答時間の上限（デッキのオプション。既定 60 秒）
  const res = answer(S.card, g, ctxFor(S.card), Math.min(maxMs, Math.round(performance.now() - S.shownAt)), Date.now());
  const c = S.byId.get(prev.id); Object.assign(c, res.card); c.rev = res.revlog.id; addRev(res.revlog); flashTick(g);
  if (res.card.leeched && res.card.lapses !== prev.lapses) toast(c.queue === -1 ? '回答したカードは「leech」（苦戦、忘却多発）のカードです。 カードを休止しました' : '回答したカードは「leech」（苦戦、忘却多発）のカードです。');
  if (c.queue === 2 && S.lb && S.deck !== 'session' && !c.inDyn) lbAdd(S.lb, c.nid, S.decksById.get(c.did)?.conf, c.ivl); // 復習になったら負荷分散の数に足す（answer_card_inner）
  if (S.deck === 'session') leaveSessionIfDone(c);
  const sibs = burySiblings(prev);   // 兄弟を翌日まで埋める（プリセットの「兄弟を埋める」）
  S.undo.push({ prev, revlogId: res.revlog.id, sibs }); if (S.undo.length > 30) S.undo.shift(); // 続けて戻せるように（30回まで）
  await store.addOp({ t: 'ans', r: res.revlog, c: { id: c.id, st: pickState(c), rev: c.rev } });
  const base = lastRevIds(sibs.map(s => s.id));
  for (const s of sibs) { const x = S.byId.get(s.id); await store.addOp({ t: 'set', c: { id: x.id, st: pickState(x), rev: x.rev }, base: base.get(x.id) || 0 }); }
  advance(); scheduleSync();
}
async function undoAnswer() {
  if (!S.undo.length || S.busy) return;
  S.busy = true; try { await undoInner(); } finally { S.busy = false; }
}
async function undoInner() {
  const top = S.undo[S.undo.length - 1];
  if (top.kind === 'set') { // 非表示・休止・フラグ・マークを戻す（新しい時刻で前の状態を送る）
    S.undo.pop(); const now = Date.now();
    const base = lastRevIds(top.prevs.map(p => p.id));
    for (const p of top.prevs) { const c = S.byId.get(p.id); Object.assign(c, p); c.rev = now; await store.addOp({ t: 'set', c: { id: c.id, st: pickState(c), rev: now }, base: base.get(c.id) || 0 }); }
    if (top.rebuild) S.mainQ = null;
    toast(`元に戻しました（${top.label}）`); advance(S.byId.get(top.prevs[0].id)); scheduleSync(); return;
  }
  const { prev, revlogId, sibs = [] } = S.undo.pop();
  const c = S.byId.get(prev.id); Object.assign(c, prev); if (!prev.leeched) delete c.leeched; delRev(revlogId);
  await store.addOp({ t: 'undo', rid: revlogId, c: { id: c.id, st: pickState(c), rev: c.rev } });
  const now = Date.now(), base = lastRevIds(sibs.map(s => s.id));   // 答えと一緒に埋めた兄弟も戻す
  for (const s of sibs) { const x = S.byId.get(s.id); if (x.queue !== -2) continue; x.queue = s.queue; x.rev = now; await store.addOp({ t: 'set', c: { id: x.id, st: pickState(x), rev: now }, base: base.get(x.id) || 0 }); }
  if (S.lb) rebuildLB();   // 答えたときに足した負荷分散の数を戻す
  if (S.mainQ && [0, 2, 3].includes(c.queue) && !S.mainQ.ids.includes(c.id)) S.mainQ.ids.unshift(c.id);   // 本体の並びの先頭に戻す（rslib push_main）
  advance(c); scheduleSync();
}

// ---------- 今日は非表示・休止・フラグ・マーク（PC 版 Anki の - = @ ! Ctrl+1〜7 * と同じ） ----------
// 状態を変えて送る（t:'set'）。毎晩の書き戻しで Anki にも入る。元に戻すでも戻せる
// msg＝した直後に出す文、name＝元に戻したときの文に使う操作の名前
// 答えたカードの兄弟を「自動で非表示」（queue -2）にする（rslib answering の maybe_bury_siblings・bury_and_suspend.rs bury_siblings）。
// 答えたカードより先に集める種類の兄弟は埋めない（復習を答えたら日をまたぐ学習は埋めない、新規を答えたら新規だけ）。休止中は触らない
function burySiblings(answered) {
  const p = presetOf(answered.did);
  const ord = q => (q === 1 || q === 4 ? 0 : q === 3 ? 1 : q === 2 ? 2 : q === 0 ? 3 : 255), o = ord(answered.queue);
  const n = !!p.new?.bury, r = !!p.rev?.bury && o <= 2, i = !!p.buryInterdayLearning && o <= 1;
  if (!n && !r && !i) return [];
  const now = Date.now(), out = [];
  for (const x of S.cards) {
    if (x.nid !== answered.nid || x.id === answered.id) continue;
    if ((n && x.queue === 0) || (r && x.queue === 2) || (i && x.queue === 3)) { out.push({ id: x.id, queue: x.queue }); x.queue = -2; x.rev = now; }
  }
  return out;
}
// 状態だけを変える送り物には、この端末が知っている最後の答えの時刻（base）を付ける。サーバーは、それより新しい答えが別の端末・Anki から
// 届いていたら、この変更を捨てる（古い期日で上書きしないように）
function lastRevIds(ids) {
  const want = new Set(ids), out = new Map();
  for (const r of S.revlog) if (want.has(r.cid) && r.type <= 4 && r.id > (out.get(r.cid) || 0)) out.set(r.cid, r.id);
  return out;
}
async function changeCards(cards, fn, msg, name, next = true, rebuild = true) {
  if (!cards.length || S.busy) return;
  S.busy = true;
  try {
    const now = Date.now(), prevs = cards.map(c => structuredClone(c)), base = lastRevIds(cards.map(c => c.id));
    for (const c of cards) { fn(c); c.rev = now; await store.addOp({ t: 'set', c: { id: c.id, st: pickState(c), rev: now }, base: base.get(c.id) || 0 }); }
    S.undo.push({ kind: 'set', prevs, label: name, rebuild }); if (S.undo.length > 30) S.undo.shift();
    if (rebuild) S.mainQ = null;   // 非表示・休止・フラグは Anki でもキューを組み直す（マークはノートの変更なので組み直さない）
  } finally { S.busy = false; }
  toast(msg); scheduleSync();
  if (next) advance(); else paintMarks();
}
const siblings = c => S.cards.filter(x => x.nid === c.nid);
const QUEUE_SUSPENDED = -1, QUEUE_USER_BURIED = -3; // rslib の QueueType
function buryCard() { if (S.card) changeCards([S.card], c => { c.queue = QUEUE_USER_BURIED; }, 'カードを今日は非表示にしました', 'カードを今日は非表示'); }
function buryNote() { if (!S.card) return; const cs = siblings(S.card).filter(c => c.queue >= 0); changeCards(cs, c => { c.queue = QUEUE_USER_BURIED; }, `ノートを今日は非表示にしました（${cs.length}枚）`, 'ノートを今日は非表示'); }
function suspendCard() { if (S.card) changeCards([S.card], c => { c.queue = QUEUE_SUSPENDED; }, 'カードを休止しました', 'カードを休止'); }
function suspendNote() { if (S.card) changeCards(siblings(S.card), c => { c.queue = QUEUE_SUSPENDED; }, 'ノートを休止しました', 'ノートを休止'); }
const FLAG_NAMES = ['', 'レッド', 'オレンジ', 'グリーン', 'ブルー', 'ピンク', 'ターコイズ', 'パープル'];
const FLAG_COLORS = ['', '#e8453c', '#f39c26', '#4caf50', '#3d8bfd', '#f06ac0', '#2ec4b6', '#9b6bdf'];
function setFlag(n) { if (!S.card) return; const off = (S.card.flags & 7) === n; changeCards([S.card], c => { c.flags = (c.flags & ~7) | (off ? 0 : n); }, off ? 'フラグを外しました' : `フラグ${n}（${FLAG_NAMES[n]}）を付けました`, 'フラグ', false); }
const isMarked = c => c.mark !== undefined ? c.mark : (c.tags || []).some(t => t.toLowerCase() === 'marked');
function toggleMark() { if (!S.card) return; const on = !isMarked(S.card); changeCards(siblings(S.card), c => { c.mark = on; }, on ? 'マークを付けました' : 'マークを外しました', 'マーク', false, false); }
function paintMarks() {
  const c = S.card, f = c ? c.flags & 7 : 0, el = $('#marks');
  el.innerHTML = (f ? `<span class="flag" style="color:${FLAG_COLORS[f]}" title="フラグ${f}">⚑</span>` : '') + (c && isMarked(c) ? '<span class="star" title="マーク">★</span>' : '');
}
let toastT = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1600); }
// ---------- 日付が変わったとき（rslib 25.09.4 と同じ考え方） ----------
// ・出題中に次のカードを取るとき、並びが前の日のもの（q_queue_mod.rs clear_queues_if_day_changed）→ 元に戻す履歴を捨て、非表示を戻す
// ・一覧を描くとき（decks/tree.rs → bury_and_suspend.rs unbury_if_day_rolled_over）→ 前の日までに非表示にしたものを戻す
// Anki は「最後に非表示を戻した日」をコレクションに1つ持つ。暗記は端末が複数あるので、代わりに「非表示にした時刻（状態の rev）が今日の始まりより前」のものを戻す
// （別の端末で今日非表示にしたものを、ほかの端末が戻してしまわないように）
function checkDay(first = false) {
  const t = timingToday(nowSecs(), S.meta), d = t.daysElapsed;
  if (!first && S.day === d) return false;
  const changed = S.day != null && S.day !== d; S.day = d;
  if (changed) { S.undo = []; if (S.lb) rebuildLB(); }
  unburyOld();
  return changed;
}
function unburyOld() {
  const t = timingToday(nowSecs(), S.meta), start = (t.nextDayAt - 86400) * 1000, now = Date.now();
  const cs = S.cards.filter(c => (c.queue === -2 || c.queue === -3) && (c.rev || 0) < start);
  if (!cs.length) return;
  const base = lastRevIds(cs.map(c => c.id)), ops = [];
  for (const c of cs) {
    c.queue = c.type === 0 ? 0 : c.type === 2 ? 2 : (c.due > 1e9 ? 1 : 3); c.rev = now;
    ops.push({ t: 'set', c: { id: c.id, st: pickState(c), rev: now }, base: base.get(c.id) || 0 });
  }
  S.mainQ = null;
  (async () => { for (const op of ops) await store.addOp(op); scheduleSync(); })();
}
// ---------- 出したときと答えたときの状態の照合（rslib answering_mod.rs answer_card_inner の require!(current_state == answer.current_state)） ----------
// AnkiMobile はカードを出したときに状態を計算しておき、答えたときの状態と違えば「card was modified」で答えを断る（日付をまたいだ・同期で中身が変わった）。
// 状態の作り方は ans_current.rs current_card_state。学習中の経過秒は比べない（set_elapsed_secs_equal）。カスタム学習セッションはフィルターデッキ扱い
function curState(card, now) {
  const t = timingToday(now, S.meta), p = presetOf(card.did), filtered = S.deck === 'session';
  const mem = card.data && card.data.s != null ? { stability: card.data.s, difficulty: card.data.d } : null;
  const rem = (card.left || 0) % 1000;
  const learn = steps => { const sec = steps.currentDelay(rem);
    const el = card.queue === 1 ? Math.max(0, now - (card.due - learningFuzzSecs(card.id, (card.reps - 1) >>> 0, sec))) : card.queue === 3 ? (t.daysElapsed - card.due + Math.max(1, Math.floor(sec / 86400))) * 86400 : 0;
    return { remaining_steps: rem, scheduled_secs: sec, elapsed_secs: Math.max(0, el), memory_state: mem }; };
  const review = el => ({ scheduled_days: card.ivl, elapsed_days: el, ease_factor: card.factor / 1000, lapses: card.lapses, leeched: false, memory_state: mem });
  let st;
  if (card.type === 0) st = { k: 'New', v: { position: Math.max(0, card.due) } };
  else if (card.type === 1) st = { k: 'Learning', v: learn(learningSteps(p.new.delays)) };
  else if (card.type === 2) { const due = filtered ? card.due : Math.min(card.due, t.daysElapsed); st = { k: 'Review', v: review(Math.max(0, card.ivl - (due - t.daysElapsed))) }; }
  else st = { k: 'Relearning', v: { learning: learn(learningSteps(p.lapse.delays)), review: review(card.ivl) } };
  st.filtered = filtered; return st;
}
const sameState = (a, b) => { const z = s => JSON.stringify(s, (k, v) => (k === 'elapsed_secs' ? 0 : v)); return z(a) === z(b); };
// Rust の {:#?} と同じ書き方（AnkiMobile のエラーの文面）
function rustDebug(st) {
  const I = n => '    '.repeat(n), f32 = x => (Number.isInteger(x) ? x.toFixed(1) : String(x));
  const mem = (m, n) => (m ? `Some(\n${I(n + 1)}FsrsMemoryState {\n${I(n + 2)}stability: ${f32(m.stability)},\n${I(n + 2)}difficulty: ${f32(m.difficulty)},\n${I(n + 1)}},\n${I(n)})` : 'None');
  const struct = (name, fs, n) => `${name} {\n${fs.map(([k, v]) => `${I(n + 1)}${k}: ${v},\n`).join('')}${I(n)}}`;
  const learnS = (l, n) => struct('LearnState', [['remaining_steps', l.remaining_steps], ['scheduled_secs', l.scheduled_secs], ['elapsed_secs', l.elapsed_secs], ['memory_state', mem(l.memory_state, n + 1)]], n);
  const reviewS = (r, n) => struct('ReviewState', [['scheduled_days', r.scheduled_days], ['elapsed_days', r.elapsed_days], ['ease_factor', f32(r.ease_factor)], ['lapses', r.lapses], ['leeched', r.leeched], ['memory_state', mem(r.memory_state, n + 1)]], n);
  const inner = (n) => st.k === 'New' ? struct('NewState', [['position', st.v.position]], n) : st.k === 'Learning' ? learnS(st.v, n) : st.k === 'Review' ? reviewS(st.v, n)
    : struct('RelearnState', [['learning', learnS(st.v.learning, n + 1)], ['review', reviewS(st.v.review, n + 1)]], n);
  const normal = b => `${st.k}(\n${I(b + 1)}${inner(b + 1)},\n${I(b)})`;
  return st.filtered ? `Filtered(\n${I(1)}Rescheduling(\n${I(2)}ReschedulingFilterState {\n${I(3)}original_state: ${normal(3)},\n${I(2)}},\n${I(1)}),\n)` : `Normal(\n${I(1)}${normal(1)},\n)`;
}
function checkModified(card) {
  const cur = curState(card, nowSecs()), shown = S.shownState;
  if (!shown || sameState(cur, shown)) return true;
  iosAlert('Error', `card was modified: ${rustDebug(cur)} ${rustDebug(shown)}`);
  return false;
}
// iOS の警告の小窓（AnkiMobile のエラー表示と同じ見た目: 幅270pt・見出し太字・本文13pt中央・区切り線の下に OK）
// iOS の確認の小窓（見出し・説明・入力欄かスイッチ・キャンセル／OK）。OK なら { value, toggles }、キャンセルなら null
function iosPrompt({ title, message = '', input = null, toggles = [] }) {
  let el = $('#iosDialog');
  if (!el) {
    const st = document.createElement('style');
    st.textContent = `#iosDialog{position:fixed;inset:0;z-index:81;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center}
#iosDialog[hidden]{display:none}
#iosDialog .box{width:270px;max-height:calc(100% - 40px);display:flex;flex-direction:column;border-radius:14px;background:var(--al-bg);color:var(--al-text);overflow:hidden;font-family:-apple-system,system-ui,sans-serif}
#iosDialog .t{font-size:17px;font-weight:600;text-align:center;padding:19px 16px 0;line-height:22px}
#iosDialog .m{font-size:13px;line-height:16px;text-align:left;white-space:pre-wrap;padding:2px 16px 12px;overflow:auto}
#iosDialog .m:empty{display:none}
#iosDialog input[type=text]{margin:0 16px 16px;height:26px;border:.5px solid var(--al-line);border-radius:7px;padding:0 6px;font-size:13px;background:var(--al-bg);color:var(--al-text)}
#iosDialog label{display:flex;align-items:center;gap:8px;font-size:13px;padding:0 16px 12px}
#iosDialog .bt{display:flex;border-top:.5px solid var(--al-line)} #iosDialog .bt button{flex:1;height:44px;font-size:17px;color:var(--al-blue)}
#iosDialog .bt button+button{border-left:.5px solid var(--al-line);font-weight:600}`;
    document.head.append(st);
    el = document.createElement('div'); el.id = 'iosDialog'; el.hidden = true;
    el.innerHTML = '<div class="box"><div class="t"></div><div class="m"></div><div class="f"></div><div class="bt"><button class="no">キャンセル</button><button class="yes">OK</button></div></div>';
    document.body.append(el);
  }
  el.querySelector('.t').textContent = title; el.querySelector('.m').textContent = message;
  const f = el.querySelector('.f'); f.innerHTML = '';
  let inp = null; const tgs = [];
  if (input != null) { inp = document.createElement('input'); inp.type = 'text'; inp.value = input; inp.setAttribute('inputmode', 'text'); f.append(inp); }
  for (const t of toggles) { const l = document.createElement('label'); const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!t.on; l.append(c, document.createTextNode(t.label)); f.append(l); tgs.push(c); }
  el.hidden = false; if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 0);
  return new Promise(res => {
    const done = ok => { el.hidden = true; el.onkeydown = null; res(ok ? { value: inp ? inp.value : null, toggles: tgs.map(c => c.checked) } : null); };
    el.querySelector('.no').onclick = () => done(false); el.querySelector('.yes').onclick = () => done(true);
    el.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } };
  });
}
// 記録の id（ミリ秒）を、ほかの記録と重ならないように選ぶ（rslib の add_revlog_entry の uniquify と同じ考え方）
function freshRevId() { let id = Date.now(); while (S.revIds.has(id)) id++; return id; }
// 手で決めた期日・リセット（記録は種類 4「手動」）を、答えと同じ形で残して送る（元に戻すでも戻せる）
async function applyManual(prevCard, res, msg, quiet = false) {
  const c = S.byId.get(prevCard.id), prev = structuredClone(prevCard);
  Object.assign(c, res.card); if (!('inDyn' in res.card)) delete c.inDyn; c.rev = res.revlog.id; addRev(res.revlog);
  S.undo.push({ prev, revlogId: res.revlog.id, sibs: [] }); if (S.undo.length > 30) S.undo.shift();
  await store.addOp({ t: 'ans', r: res.revlog, c: { id: c.id, st: pickState(c), rev: c.rev } });
  if (quiet) return;   // ブラウザでまとめてするとき（最後に一度だけ知らせる）
  toast(msg); S.mainQ = null; refreshCards(); if (document.body.dataset.view === 'study' && S.deck != null) advance(); scheduleSync();
}
// ブラウザで選んだカードにまとめて（「カードをリセット」「期日を指定」。聞く小窓は1回だけ）
async function manualMany(cs, kind) {
  if (!cs.length || S.busy) return;
  const one = S.card; S.card = cs[0];
  try {
    if (kind === 'reset') {
      const lsb = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v === '1'; } catch { return d; } };
      const r = await iosPrompt({ title: '新規カードにリセット', toggles: [{ label: '可能な限り元の位置に復元', on: lsb('restorePositionReviewer', S.meta.config.restorePositionReviewer ?? true) }, { label: '学習回数と復習での忘却回数をリセット', on: lsb('resetCountsReviewer', S.meta.config.resetCountsReviewer ?? false) }] });
      if (!r) return;
      const [rp, rc] = r.toggles;
      try { localStorage.setItem('restorePositionReviewer', rp ? '1' : '0'); localStorage.setItem('resetCountsReviewer', rc ? '1' : '0'); } catch {}
      for (const card of cs) { const nextPos = nextNewPos(); const res = forgetCard(card, { restorePosition: rp, resetCounts: rc, nextPos, nowMs: freshRevId() }); if (res.usedNextPos) bumpNewPos(nextPos + 1); await applyManual(card, res, '', true); }
      toast(`${cs.length}枚のカードを新規カードに戻しました。`);
    } else {
      let last = S.meta.config.setDueReviewer ?? ''; try { last = localStorage.getItem('setDueReviewer') ?? last; } catch {}
      const r = await iosPrompt({ title: '期日を指定', message: '何日後にカードを表示しますか？\n\n入力例）\n　0    = 今日\n　1!   = 明日。かつ、復習間隔を1日に変更\n　3-7 = 3日後～7日後からランダムに選択', input: last });
      if (!r) return;
      const sp = parseDueDate(r.value.trim()); if (!sp) { iosAlert('Error', `invalid input: ${r.value}`); return; }
      try { localStorage.setItem('setDueReviewer', r.value.trim()); } catch {}
      const t = timingToday(nowSecs(), S.meta);
      for (const card of cs) { const days = sp.min + Math.floor(Math.random() * (sp.max - sp.min + 1)); const res = setDueDate(card, { today: t.daysElapsed, nextDayAt: t.nextDayAt, days, forceReset: sp.forceReset, initialFactor: presetOf(card.did)?.new?.initialFactor ?? 2500, nowMs: freshRevId() }); await applyManual(card, res, '', true); }
      toast(`${cs.length}枚のカードの期日を設定しました。`);
    }
    S.mainQ = null; refreshCards(); scheduleSync();
  } finally { S.card = one; }
}
// 新規カードにリセット（Anki の「リセット」。元の位置に戻す・回数をリセットは、前に選んだもの。初めは Anki の既定＝戻す・リセットしない）
async function resetAction() {
  const card = S.card; if (!card || S.busy) return;
  const lsb = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v === '1'; } catch { return d; } };
  const rp0 = lsb('restorePositionReviewer', S.meta.config.restorePositionReviewer ?? true), rc0 = lsb('resetCountsReviewer', S.meta.config.resetCountsReviewer ?? false);
  const r = await iosPrompt({ title: '新規カードにリセット', toggles: [{ label: '可能な限り元の位置に復元', on: rp0 }, { label: '学習回数と復習での忘却回数をリセット', on: rc0 }] });
  if (!r || S.card !== card) return;
  const [rp, rc] = r.toggles;
  try { localStorage.setItem('restorePositionReviewer', rp ? '1' : '0'); localStorage.setItem('resetCountsReviewer', rc ? '1' : '0'); } catch {}
  const nextPos = nextNewPos();
  const res = forgetCard(card, { restorePosition: rp, resetCounts: rc, nextPos, nowMs: freshRevId() });
  if (res.usedNextPos) bumpNewPos(nextPos + 1);
  await applyManual(card, res, '1枚のカードを新規カードに戻しました。');
}
// 次の新規の位置（コレクションの nextPos。この端末で使った分は覚えておく）
function nextNewPos() { let ls = 0; try { ls = +localStorage.getItem('nextPos') || 0; } catch {} return Math.max(+S.meta.config.nextPos || 0, ls); }
function bumpNewPos(n) { S.meta.config.nextPos = n; try { localStorage.setItem('nextPos', String(n)); } catch {} }
// 期日を指定（"0"＝今日、"1!"＝明日にして間隔も1日に、"3-7"＝3〜7日後からランダム。前に入れたものを出しておく）
async function dueAction() {
  const card = S.card; if (!card || S.busy) return;
  let last = S.meta.config.setDueReviewer ?? '';
  try { last = localStorage.getItem('setDueReviewer') ?? last; } catch {}
  const r = await iosPrompt({ title: '期日を指定', message: '何日後にカードを表示しますか？\n\n入力例）\n　0    = 今日\n　1!   = 明日。かつ、復習間隔を1日に変更\n　3-7 = 3日後～7日後からランダムに選択', input: last });
  if (!r || S.card !== card) return;
  const sp = parseDueDate(r.value.trim());
  if (!sp) { iosAlert('Error', `invalid input: ${r.value}`); return; }
  try { localStorage.setItem('setDueReviewer', r.value.trim()); } catch {}
  const t = timingToday(nowSecs(), S.meta), days = sp.min + Math.floor(Math.random() * (sp.max - sp.min + 1));
  const res = setDueDate(card, { today: t.daysElapsed, nextDayAt: t.nextDayAt, days, forceReset: sp.forceReset, initialFactor: presetOf(card.did)?.new?.initialFactor ?? 2500, nowMs: freshRevId() });
  await applyManual(card, res, '1枚のカードの期日を設定しました。');
}
function iosAlert(title, msg) {
  const el = $('#iosAlert'); el.querySelector('.t').textContent = title; el.querySelector('.m').textContent = msg; el.querySelector('.m').hidden = !msg; el.hidden = false;
  el.querySelector('.m').scrollTop = 0;
}
// ---------- カード情報（PC 版の i） ----------
const TYPE_NAME = ['新規', '学習中', '復習', '再学習'], REV_KIND = ['学習', '復習', '再学習', 'フィルター', '手動', '再スケジュール'];
const EASE_NAME = ['', 'もう一度', '難しい', '正解', '簡単'];
function fmtDate(ms) { const d = new Date(ms); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; }
function fmtTime(ms) { const d = new Date(ms); return `${fmtDate(ms)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; }
function fmtDays(ivl) { if (ivl < 0) return fmtIvl(-ivl); return fmtIvl(ivl * 86400); }
function cardInfo(c) {
  if (!c) return;
  const revs = S.revlog.filter(r => r.cid === c.id).sort((a, b) => b.id - a.id);
  const t = timingToday(nowSecs(), S.meta);
  const d = c.data || {}, nt = S.meta.notetypes[c.mid];
  const due = c.queue === -1 ? '（休止中）' : c.queue < -1 ? '（今日は非表示）' : c.type === 0 ? `新規 #${c.due}` : c.queue === 1 ? fmtTime(c.due * 1000) : fmtDate((t.nextDayAt - 86400 + (c.due - t.daysElapsed) * 86400) * 1000);
  let R = '';
  if (d.s && d.lrt) { const decay = d.decay || 0.5, f = Math.pow(0.9, -1 / decay) - 1, el = (nowSecs() - d.lrt) / 86400; R = (100 * Math.pow(1 + f * el / d.s, -decay)).toFixed(0) + '%'; }
  const sum = revs.reduce((a, r) => a + r.time, 0);
  const rows = [['追加日', fmtDate(c.nid)], ['最初の復習', revs.length ? fmtDate(revs[revs.length - 1].id) : '—'], ['最新の復習', revs.length ? fmtDate(revs[0].id) : '—'],
    ['期日', due], ['間隔', c.type === 2 || c.type === 3 ? fmtDays(c.ivl) : '—'], ['難易度', d.d ? Math.round((d.d - 1) / 9 * 100) + '%' : '—'], ['安定度', d.s ? fmtDays(Math.round(d.s)) : '—'], ['想起確率', R || '—'],
    ['復習回数', c.reps], ['失敗回数', c.lapses], ['平均時間', revs.length ? (sum / revs.length / 1000).toFixed(1) + '秒' : '—'], ['合計時間', (sum / 1000 / 60).toFixed(1) + '分'],
    ['カードの種類', TYPE_NAME[c.type] ?? c.type], ['ノートの種類', nt?.name || ''], ['デッキ', S.decksById.get(c.did)?.name || ''], ['カード ID', c.id], ['ノート ID', c.nid]];
  const log = revs.map(r => `<tr><td>${fmtTime(r.id)}</td><td>${REV_KIND[r.type] ?? r.type}</td><td class="e${r.ease}">${EASE_NAME[r.ease] || r.ease}</td><td>${r.ivl ? fmtDays(r.ivl) : '—'}</td><td>${r.factor ? (r.factor / 10).toFixed(0) + '%' : '—'}</td><td>${(r.time / 1000).toFixed(1)}秒</td></tr>`).join('');
  $('#cardInfo .ci-body').innerHTML = `<table class="ci-kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`
    + (revs.length ? `<table class="ci-log"><tr><th>日時</th><th>種類</th><th>評価</th><th>間隔</th><th>難易度</th><th>時間</th></tr>${log}</table>` : '');
  $('#cardInfo').classList.add('open');
}

// ---------- カードの表示 ----------
const CARD_EXTRA = `
html,body{margin:0}
#image-occlusion-container{position:relative;margin:0 auto;max-height:calc(95vh - 40px)}
#image-occlusion-container img{position:absolute;top:0;left:0;width:100%;height:100%;max-width:unset;max-height:unset}
#image-occlusion-canvas{position:absolute;top:0;left:0;width:100%;height:100%}
body{padding:14.5px 15px 40px;overflow-wrap:break-word;-webkit-text-size-adjust:100%}
img{max-width:100%;height:auto}
#typeans{width:100%;box-sizing:border-box;line-height:1.75}
code#typeans{white-space:pre-wrap;font-variant-ligatures:none}
.typeGood{background:#afa;color:black} .typeBad{color:black;background:#faa} .typeMissed{color:black;background:#ccc}
.replay-button{display:inline-block;width:2.57em;height:2.57em;vertical-align:middle;margin:0 .1em;text-decoration:none}
.replay-button svg{width:100%;height:100%;display:block}`;
const MATHJAX_CONFIG = `window.MathJax={tex:{inlineMath:[['\\\\(','\\\\)']],displayMath:[['\\\\[','\\\\]']],processEscapes:false,processEnvironments:false,processRefs:false,packages:{'[+]':['noerrors','mathtools','mhchem'],'[-]':['textmacros']}},loader:{load:['[tex]/noerrors','[tex]/mathtools','[tex]/mhchem']},startup:{typeset:true}};`;
const BASE_LIGHT = 'html{background:#fff;color:#000}', BASE_DARK = 'html{background:#000 !important;color:#f2f2f2}';
// カードの iframe は1回だけ作り、以後は CSS と本文だけ差し替える（めくるたびに文書を作り直すと、描き終わるまで一瞬白くなる）
let frameP = null, frameSeq = 0;
// カードの html に端末の印（.ipad .iphone .android .ios .mobile .win .mac .linux）を付ける。テンプレートの「端末ごとの CSS」用（Anki の reviewer.js の gf と同じ規則）
function platformClasses(doc) {
  const t = navigator.userAgent.toLowerCase(), add = c => doc.documentElement.classList.add(c), has = r => r.test(t);
  const ipad = has(/ipad/) || (has(/macintosh/) && navigator.maxTouchPoints > 1);
  if (ipad) add('ipad'); else if (has(/iphone/)) add('iphone'); else if (has(/android/)) add('android');
  if (ipad || has(/iphone|ipod/)) add('ios');
  if (ipad || has(/iphone|ipod|android/)) add('mobile'); else if (has(/linux/)) add('linux'); else if (has(/windows/)) add('win'); else if (has(/mac/)) add('mac');
  if (has(/firefox\//)) add('firefox'); else if (has(/chrome\//)) add('chrome'); else if (has(/safari\//)) add('safari');
}
function cardDoc() {
  if (frameP) return frameP;
  const fr = $('#card');
  frameP = new Promise(res => {
    fr.onload = () => {
      const doc = fr.contentDocument;
      platformClasses(doc);
      pen.attach(doc, () => ({ x: 0, y: 0 }));
      watchSel(doc);
      doc.addEventListener('click', e => {
        if (selAtDown) { selAtDown = false; e.preventDefault(); clearSel(); return; } // 選択を外すタップでめくったり覆ったりしない
        if (hasSel()) return;   // ドラッグで文字を選んだ（パソコンのマウス）。選んだまま残す
        const a = e.target.closest && e.target.closest('a');
        if (a && a.classList.contains('replay-button')) { e.preventDefault(); const [s, i] = a.dataset.av.split(':'); playAv([(s === 'q' ? S.card.qav : S.card.aav)[+i]]); return; }
        if (a && /^(https?|mailto):/i.test(a.getAttribute('href') || '') && !a.closest('.replay-button')) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); return; }   // リンクはこのアプリの外で開く（AnkiMobile の既定）
        if (a && a.getAttribute('href')) e.preventDefault(); // カードの中のリンクで iframe が別のページへ行かないように
        if (pen.recentlyUsed()) return;
        const hint = e.target.closest && e.target.closest('a.hint');
        if (hint) { e.preventDefault(); hint.style.display = 'none'; const d = hint.nextElementSibling; if (d && d.classList.contains('hint')) d.style.display = 'block'; return; }
        if (isCtl(e.target)) return;   // カードの中のボタン・リンク・入力欄
        // ダブルタップ防止（AnkiMobile の「標準」: 前のタップから 0.15 秒は無視、0.3 秒なら受け付けた＝実機で測った）
        const now = performance.now(); if (now - lastTapAt < DTP[dtpKey()][1]) return; lastTapAt = now;
        const w = doc.documentElement.clientWidth || 1, hh = doc.documentElement.clientHeight || 1;
        const zone = (e.clientY < hh / 3 ? 0 : e.clientY < 2 * hh / 3 ? 3 : 6) + (e.clientX < w / 3 ? 0 : e.clientX < 2 * w / 3 ? 1 : 2);   // 左上〜右下の9区画
        if (S.side === 'q') { if (!kbdActive()) runAction(tapAct('q', zone)); return; }   // 表: 既定はどこを押しても答えを出す
        // 裏: 区切り線（hr#answer）より下を指でタップすると答えを覆う／もう一度で外す（書き込みのデザインを入れたときだけ。本家に無い）
        const hr = doc.getElementById('answer');
        if (DESIGN && pref('pen') && hr && (e.target.closest('#sa-mask') || e.clientY > hr.getBoundingClientRect().top)) { toggleMask(doc); return; }
        if (kbdActive()) return;
        // 裏: 既定は、左の3区画＝「もう一度」、右の3区画＝「正解」、真ん中＝何もしない（設定＞学習＞タップで変えられる）
        runAction(tapAct('a', zone));
      });
      // スワイプ（本家の既定: 左へ＝道具の画面、右へ＝デッキ一覧。横のスワイプは画面のどこから始めてもよい。縦は既定でオフ）
      let sw = null;
      const hScroll = el => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const ox = doc.defaultView.getComputedStyle(n).overflowX; if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true; } const se = doc.scrollingElement; return !!se && se.scrollWidth > se.clientWidth + 1; };
      doc.addEventListener('touchstart', e => {
        const t = e.touches[0];
        sw = e.touches.length === 1 && t.touchType !== 'stylus' && !kbdActive() && !pen.recentlyUsed() && !isCtl(e.target) && !hScroll(e.target) ? { x: t.clientX, y: t.clientY, t: performance.now() } : null;
      }, { passive: true });
      doc.addEventListener('touchcancel', () => { sw = null; }, { passive: true });
      doc.addEventListener('touchend', e => {
        if (!sw) return; const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y, dt = performance.now() - sw.t; sw = null;
        if (dt > 800) return;
        if (doc.getSelection && String(doc.getSelection()).length) return;   // 文字を選んでいた
        const w = doc.documentElement.clientWidth || 1, sx = t.clientX - dx, edge = sx < w * 0.12 || sx > w * 0.88;
        let dir = null;
        if (Math.abs(dx) >= 60 && Math.abs(dx) >= 2 * Math.abs(dy)) dir = dx < 0 ? 'left' : 'right';
        else if (edge && Math.abs(dy) >= 60 && Math.abs(dy) >= 2 * Math.abs(dx)) dir = dy < 0 ? 'up' : 'down';   // 縦は左右の端から始めたときだけ
        if (!dir || swipeAct(dir) === 'off') return;
        lastTapAt = performance.now();
        runAction(swipeAct(dir));
      }, { passive: true });
      doc.defaultView.addEventListener('resize', () => { if (doc.getElementById('sa-mask')) { toggleMask(doc); toggleMask(doc); } }); // 向きを変えたら測り直す
      doc.addEventListener('keydown', onKey);
      doc.addEventListener('keyup', onKeyUp, true);
      res(doc);
    };
  });
  fr.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${MEDIA}"><style id="sa-base">${isDark() ? BASE_DARK : BASE_LIGHT}</style><style>${CARD_EXTRA}</style><style id="sa-nt"></style><style id="sa-dark"></style><style id="sa-kbd">${kbdActive() ? KBD_CSS : ''}</style></head><body><div id="qa"></div></body></html>`;
  return frameP;
}
// 入力して答える（{{type:…}}）を差し込んだ、表か裏の HTML（aqt reviewer.py の typeAnsFilter と同じ）
const cardHtml = (card, side) => side === 'q' ? typeQuestion(card.q, card.typ, pref('neverType')) : typeAnswer(card.a, card.typ, S.typed ?? '');
function typedNow() { const el = $('#card').contentDocument?.getElementById('typeans'); return el && el.tagName === 'INPUT' ? el.value : ''; }
async function setFrame(html, mid, ord, scrollToAnswer = false) {
  const my = ++frameSeq;
  const doc = await cardDoc(); if (my !== frameSeq) return;
  const css = mid ? S.meta.notetypes[mid].css : '';
  const body = html.replace(/\[\[type:[^\]]*\]\]/g, '').replace(/\[anki:play:(q|a):(\d+)\]/g, (m, s, i) => pref('replayBtn') ? `<a class="replay-button" data-av="${s}:${i}" href="#"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#fff"/><path d="M25 18.5v27L46.5 32z" fill="#000"/></svg></a>` : '');
  const dark = isDark();
  // ここから描き終わるまでは同じ処理の中で済ませる（途中で画面に出ない）
  const base = doc.getElementById('sa-base'); base.textContent = BASE_LIGHT;
  const nt = doc.getElementById('sa-nt'); if (nt.textContent !== css) nt.textContent = css;
  doc.getElementById('sa-dark').textContent = ''; doc.body.removeAttribute('data-dk');
  doc.body.className = `card card${(ord || 0) + 1}${dark ? ' nightMode night_mode' : ''}`;
  doc.getElementById('sa-mask')?.remove();
  const qa = doc.getElementById('qa'); qa.innerHTML = body;
  if (dark) darkify(doc); else base.textContent = BASE_LIGHT;
  const se = doc.scrollingElement; se.scrollTop = 0;
  if (scrollToAnswer) { const hr = doc.getElementById('answer'); if (hr && hr.offsetTop > $('#card').clientHeight * 0.6) se.scrollTop = hr.offsetTop - 40; }
  if (/\\\(|\\\[/.test(body)) typesetMath(doc, qa);
  if (doc.getElementById('image-occlusion-container')) setupOcclusion(doc, my);
  // 入力欄: Enter で答えを出す（日本語の変換を確定する Enter は除く）。Anki と同じく出したら入力欄に移る
  const ti = doc.getElementById('typeans');
  if (ti && ti.tagName === 'INPUT') { ti.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); showAnswer(); } }); setTimeout(() => { if (doc.getElementById('typeans') === ti) ti.focus(); }, 0); }
  applyAa();
}
// 画像穴埋め（Image Occlusion）: テンプレートのスクリプトは書き出しで外しているので、Anki 25.9.4 の reviewer.js（aqt の
// _aqt/data/web/js/reviewer.js そのもの。ankiweb/js に置いてある）を最初の1回だけカードの枠に読み込み、Anki と同じ anki.imageOcclusion.setup() を呼ぶ
function setupOcclusion(doc, my) {
  const run = () => { if (my !== frameSeq) return; try { doc.defaultView.anki.imageOcclusion.setup(); } catch (e) { const er = doc.getElementById('err'); if (er) er.textContent = String(e); } };
  if (doc.defaultView.anki?.imageOcclusion) { run(); return; }
  let s = doc.getElementById('sa-reviewer');
  if (!s) { s = doc.createElement('script'); s.id = 'sa-reviewer'; s.src = new URL('../js/reviewer.js', location.href).href; doc.head.appendChild(s); }
  s.addEventListener('load', run, { once: true });
}
// ---------- 文字を選んでいるときのタップ（選択を外すだけにする） ----------
// 押し始めの時点で選択があったかを覚えておく（iOS はタップの途中で選択を消すので、click の時点では分からない）
const selDocs = () => [document, $('#card')?.contentDocument].filter(Boolean);
const hasSel = () => selDocs().some(d => { try { const s = d.getSelection(); return s && !s.isCollapsed && String(s).trim() !== ''; } catch { return false; } });
const clearSel = () => selDocs().forEach(d => { try { d.getSelection().removeAllRanges(); } catch {} });
let selAtDown = false;
// pointerdown だけを見る（iOS は touch のあとに互換の mousedown を出すが、その時点では選択がもう消えている）
function watchSel(d) { d.addEventListener('pointerdown', () => { selAtDown = hasSel(); }, { capture: true, passive: true }); }
// ---------- キーボードモード（書き込みのデザインの ⌨: 指でカードに触れても めくれない・スクロールしない。ペン・答えを覆うタップ・キー操作は効く） ----------
// 殻（暗記 0.4〜）がキーボードのつなぎ／外しを知らせてくれる: つながったら ON、外れたら OFF。⌨ で手で切り替えもできる。
// 知らせが無いとき（Safari・古い殻）は、キーを押してから60秒は ON とみなす
const KBD = { on: false, known: false, keyAt: 0, t: null };
const KBD_CSS = 'html,body{touch-action:none}';
// キーボードモード（カードを触ってもめくらない・スクロールしない）は書き込みの道具の一部で、本家に無い。書き込みを切っているときは使わない
function kbdActive() { if (!DESIGN?.keyboardMode || !pref('pen')) return false; return KBD.on || (!KBD.known && Date.now() - KBD.keyAt < 60000); }
function paintKbd() {
  const a = kbdActive(); try { DESIGN?.onKeyboardMode?.(a); } catch {}
  const st = $('#card').contentDocument?.getElementById('sa-kbd'); if (st) st.textContent = a ? KBD_CSS : '';
  clearTimeout(KBD.t); if (!KBD.on && !KBD.known && a) KBD.t = setTimeout(paintKbd, 60000 - (Date.now() - KBD.keyAt) + 50);
}
function noteKey() { if (KBD.known) return; const was = kbdActive(); KBD.keyAt = Date.now(); if (!was) paintKbd(); else { clearTimeout(KBD.t); KBD.t = setTimeout(paintKbd, 60050); } }
// ---------- 答えを覆う（答えの文字が占める範囲だけを #222 で覆う。押せる部品には穴をあける） ----------
const CTL = 'a,button,audio,video,input,select,textarea,[onclick],[role="button"],[class*="replay"],[class*="Replay"],[class*="sound"],[class*="Sound"]';
function isCtl(t) { if (t && t.nodeType !== 1) t = t.parentNode; return !!(t && t.closest && !t.closest('#sa-mask') && t.closest(CTL)); }
function toggleMask(doc) {
  const old = doc.getElementById('sa-mask'); if (old) { old.remove(); return; }
  const hr = doc.getElementById('answer'); if (!hr) return;
  const w = doc.defaultView, sx = w.scrollX, sy = w.scrollY;
  let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity, hit = false; const holes = [];
  const add = r => { if (!r || r.width <= 0 || r.height <= 0) return; L = Math.min(L, r.left); T = Math.min(T, r.top); R = Math.max(R, r.right); B = Math.max(B, r.bottom); hit = true; };
  const walk = n => {
    if (n.nodeType === 3) { if (!/\S/.test(n.nodeValue)) return; const rg = doc.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) add(r); return; }
    if (n.nodeType !== 1) return;
    const tg = n.tagName.toUpperCase(); if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(tg)) return;
    if (n.matches(CTL)) { const r = n.getBoundingClientRect(); if (r.width > 0 && r.height > 0) holes.push(r); return; }
    add(n.getBoundingClientRect());
    if (['IMG', 'SVG', 'CANVAS', 'VIDEO', 'MATH', 'MJX-CONTAINER'].includes(tg)) return;
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  };
  for (let n = hr.nextSibling; n; n = n.nextSibling) walk(n);
  if (!hit) { const r = hr.getBoundingClientRect(); L = r.left; T = r.bottom + 4; R = r.right; B = w.innerHeight - 4; }
  const pad = 4; L -= pad; T -= pad; R += pad; B += pad;
  const hs = [], ys = [T, B];
  for (const q of holes) { const a = [Math.max(L, q.left - 3), Math.max(T, q.top - 3), Math.min(R, q.right + 3), Math.min(B, q.bottom + 3)]; if (a[2] > a[0] && a[3] > a[1]) { hs.push(a); ys.push(a[1], a[3]); } }
  ys.sort((a, b) => a - b);
  const mask = doc.createElement('div'); mask.id = 'sa-mask';
  mask.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483645';
  const piece = (x0, y0, x1, y1) => { if (x1 - x0 < 1 || y1 - y0 < 1) return; const d = doc.createElement('div');
    d.style.cssText = `position:absolute;left:${x0 + sx}px;top:${y0 + sy}px;width:${x1 - x0}px;height:${y1 - y0}px;background:#222;border-radius:${hs.length ? 0 : 4}px`; mask.appendChild(d); };
  for (let k = 0; k + 1 < ys.length; k++) {
    const y0 = ys[k], y1 = ys[k + 1]; if (y1 - y0 < 1) continue;
    let xs = [[L, R]];
    for (const e of hs) { if (e[1] >= y1 || e[3] <= y0) continue; const nx = []; for (const a of xs) { if (e[2] <= a[0] || e[0] >= a[1]) { nx.push(a); continue; } if (e[0] > a[0]) nx.push([a[0], e[0]]); if (e[2] < a[1]) nx.push([e[2], a[1]]); } xs = nx; }
    for (const [x0, x1] of xs) piece(x0, y0, x1, y1);
  }
  doc.documentElement.appendChild(mask);
}
function typesetMath(doc, el) {
  const w = doc.defaultView;
  if (w.MathJax?.startup?.promise) { w.MathJax.startup.promise.then(() => w.MathJax.typesetPromise([el])).catch(() => {}); return; }
  if (doc.getElementById('sa-mj')) return; // 読み込み中（読み終わったときに今の本文を組む）
  const c = doc.createElement('script'); c.textContent = MATHJAX_CONFIG; doc.head.appendChild(c);
  const s = doc.createElement('script'); s.id = 'sa-mj'; s.src = MATHJAX_URL; s.async = true; doc.head.appendChild(s);
}
// ---------- ダークモード ----------
// カードを丸ごと反転すると色相がずれて赤が白っぽくなる（invert+hue-rotate は色を正確には戻さない）。
// 代わりに要素ごとの文字・背景・罫線の色を OKLab で付け替える: 無彩色は明暗を逆に、色のある文字は色相と彩度を保ったまま暗い背景で読める明るさまで上げる、
// 色のある背景は暗くする。画像はそのまま。カード側にダーク用の指定があって背景がもともと暗いときは何もしない
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = x => Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
function toLab({ r, g, b }) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function labToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
function fromLab(L, a, b, alpha) {
  let rgb = labToLinear(L, a, b);
  for (let k = 0; k < 24 && rgb.some(x => x < -1e-4 || x > 1 + 1e-4); k++) { a *= 0.9; b *= 0.9; rgb = labToLinear(L, a, b); } // 出せない色は彩度を落とす
  const [r, g, bb] = rgb.map(x => gam(Math.max(0, Math.min(1, x))));
  return alpha < 1 ? `rgba(${r},${g},${bb},${alpha})` : `rgb(${r},${g},${bb})`;
}
function parseColor(s) {
  const m = s && s.match(/^rgba?\(([^)]+)\)$/); if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
const NEUTRAL = 0.04;
function darkText(c) {
  const [L, a, b] = toLab(c); const C = Math.hypot(a, b);
  // 無彩色の字は RGB をそのまま反転（黒→白・#555→#aaa）。灰色の注記が暗くなりすぎないよう明るさは 0.72 以上に
  if (C < NEUTRAL) { const [Li, ai, bi] = toLab({ r: 255 - c.r, g: 255 - c.g, b: 255 - c.b }); return fromLab(Math.max(Li, 0.72), ai, bi, c.a); }
  return fromLab(Math.max(L, 0.62), a, b, c.a);
}
function darkBg(c) {
  const [L, a, b] = toLab(c); const C = Math.hypot(a, b);
  if (C < NEUTRAL) return c.a < 1 ? `rgba(${255 - c.r},${255 - c.g},${255 - c.b},${c.a})` : `rgb(${255 - c.r},${255 - c.g},${255 - c.b})`;
  const L2 = c.a < 0.6 ? 0.55 : Math.min(0.42, Math.max(0.2, 1 - L));
  return fromLab(L2, a * 0.8, b * 0.8, c.a);
}
const SKIP_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'SVG', 'svg', 'STYLE', 'SCRIPT', 'BR', 'AUDIO', 'SOURCE']);
const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
function darkify(doc) {
  const w = doc.defaultView, base = doc.getElementById('sa-base');
  const pageBg = parseColor(w.getComputedStyle(doc.body).backgroundColor);
  const bg0 = pageBg && pageBg.a > 0 ? pageBg : parseColor(w.getComputedStyle(doc.documentElement).backgroundColor);
  if (bg0 && toLab(bg0)[0] < 0.45) { base.textContent = BASE_DARK; return; } // カードがもともと暗い
  // 先に全部読んでから書く（読み書きを交互にすると遅い）
  const plan = [];
  for (const el of [doc.body, ...doc.body.querySelectorAll('*')]) {
    if (SKIP_TAGS.has(el.tagName) || el.closest('svg') || el.closest('.replay-button')) continue;
    const cs = w.getComputedStyle(el);
    const bd = [];
    for (const s of SIDES) if (parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none') bd.push([s.toLowerCase(), parseColor(cs[`border${s}Color`])]);
    plan.push([el, parseColor(cs.color), parseColor(cs.backgroundColor), bd]);
  }
  // 色は要素に直接書かず（WebKit は直接書いた色を、次のカードの同じ形の要素にも使い回して返すことがある）、
  // 要素に番号を振って1枚のスタイル表にまとめる。同じ色の組み合わせは同じ番号
  const rules = new Map(), out = [];
  for (const [el, c, bg, bd] of plan) {
    const decl = [];
    if (c) decl.push(`color:${darkText(c)}!important`);
    if (bg && bg.a > 0) decl.push(`background-color:${darkBg(bg)}!important`);
    for (const [s, bc] of bd) if (bc && bc.a > 0) decl.push(`border-${s}-color:${darkText(bc)}!important`);
    if (!decl.length) continue;
    const key = decl.join(';'); let n = rules.get(key); if (n == null) { n = rules.size; rules.set(key, n); out.push(`[data-dk="${n}"]{${key}}`); }
    el.setAttribute('data-dk', n);
  }
  doc.getElementById('sa-dark').textContent = out.join('\n');
  base.textContent = BASE_DARK;
}
if (new URLSearchParams(location.search).has('debug')) window.__selfanki = { S, setFrame, darkText, darkBg, parseColor, get ask() { return ask; } };
// 音声。殻（0.7〜）が鳴らせるときは殻に任せる: 殻は「ほかの音と混ぜる」で鳴らすので、裏で流している音楽などを止めずに上に重なる。
// WKWebView の中で鳴らすと WebKit が音声の扱いを切り替えて、ほかのアプリの再生を止めてしまう。
// 音声ファイルはページが端末の控え（Service Worker）から取り出して渡すので、オフラインでも鳴る
let audio = null, avSeq = 0, avWait = null;
// ---------- 殻の外（スマホのブラウザなど）の音声: Web Audio で鳴らす ----------
// <audio> で鳴らすと、Android の Chrome は音声の優先権を取り、裏で流している音楽の音量を下げる。
// Web Audio（AudioContext）での再生は優先権を取らないので、ほかのアプリの音に重なる。Audio Session API がある環境では ambient（ほかの音と混ぜる）も指定する
try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch {}
const WA = { ctx: null, src: null, buf: null, startAt: 0, offset: 0, playing: false, onend: null };
function waCtx() {
  if (!WA.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; try { WA.ctx = new C(); } catch { return null; } }
  if (WA.ctx.state !== 'running') WA.ctx.resume().catch(() => {});
  return WA.ctx;
}
// 最初に触ったとき・戻ってきたときに AudioContext を起こしておく（自動再生の決まりで、触る前は鳴らせない）
document.addEventListener('pointerdown', () => { if (!window.webkit?.messageHandlers?.sa) waCtx(); }, { capture: true, passive: true });
function waStopSrc() { const sr = WA.src; WA.src = null; WA.playing = false; if (sr) { sr.onended = null; try { sr.stop(); } catch {} } }
function waStart(offset) {
  const ctx = WA.ctx; waStopSrc();
  const sr = ctx.createBufferSource(); sr.buffer = WA.buf; sr.connect(ctx.destination);
  sr.onended = () => { if (WA.src !== sr) return; WA.src = null; WA.playing = false; WA.offset = 0; const f = WA.onend; WA.onend = null; WA.buf = null; f && f(); };
  WA.src = sr; WA.offset = offset; WA.startAt = ctx.currentTime; WA.playing = true; sr.start(0, offset);
}
const waPos = () => (WA.playing ? WA.offset + (WA.ctx.currentTime - WA.startAt) : WA.offset);
function waPauseToggle() { if (!WA.buf) return false; if (WA.playing) { const p = waPos(); waStopSrc(); WA.offset = p; } else waStart(WA.offset); return true; }
function waSeek(d) { if (!WA.buf) return false; const p = Math.max(0, Math.min(WA.buf.duration - 0.01, waPos() + d)); if (WA.playing) waStart(p); else WA.offset = p; return true; }
// 鳴らせたら true。できなければ false（そのときは <audio> で鳴らす）
async function waPlay(url, my, onend) {
  const ctx = waCtx(); if (!ctx) return false;
  try {
    const ab = await (await fetch(url)).arrayBuffer(); if (my !== avSeq) return true;
    const buf = await ctx.decodeAudioData(ab); if (my !== avSeq) return true;
    WA.buf = buf; WA.onend = onend; waStart(0); return true;
  } catch { return false; }
}
const NATIVE_AUDIO = { ok: false, asked: 0, logged: false };
// 殻が鳴らせるかは、ページから殻に空の音声を頼んで確かめる（0.7 の殻は鳴らせないと分かるとすぐ audioEnded を返す・0.6 以前は何も返さない）。
// 殻が読み込み完了のときに送る 'caps' は届かないことがあるので、それだけに頼らない
const PROBE = -1;
function probeNative() {
  const n = window.webkit?.messageHandlers?.sa;
  if (!n || NATIVE_AUDIO.ok || Date.now() - NATIVE_AUDIO.asked < 2000) return;
  NATIVE_AUDIO.asked = Date.now();
  try { n.postMessage({ audio: 'play', data: '', id: PROBE }); } catch {}
}
const nativeAudio = () => NATIVE_AUDIO.ok && window.webkit?.messageHandlers?.sa;
function b64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
let avActive = false;   // 音声の列を鳴らしている最中か（カードの自動送りの「音声を待つ」で使う）
function avDone() { avActive = false; const f = aaWaitAudio; aaWaitAudio = null; if (f) setTimeout(f, 100); }
function stopAv() { avActive = false; avSeq++; avWait = null; waStopSrc(); WA.buf = null; WA.onend = null; if (audio) { audio.pause(); audio = null; } try { if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel(); } catch {} const n = nativeAudio(); if (n) n.postMessage({ audio: 'stop' }); }
function playAv(list) {
  stopAv();
  const items = (list || []).filter(Boolean); let i = 0; const my = avSeq;
  avActive = items.length > 0;
  const step = async () => {
    if (my !== avSeq) return;
    const it = items[i++]; if (!it) { avDone(); return; }
    const n = nativeAudio();
    if (!NATIVE_AUDIO.logged) { NATIVE_AUDIO.logged = true; diag({ ev: 'av', nat: !!n, sa: !!window.webkit?.messageHandlers?.sa }); }
    if (n) {
      avWait = { id: my, step };
      try {
        if (it.sound) { const buf = await (await fetch(MEDIA + encodeURIComponent(it.sound))).arrayBuffer(); if (my !== avSeq) return; n.postMessage({ audio: 'play', data: b64(buf), id: my }); }
        else if (it.tts) n.postMessage({ audio: 'speak', text: it.tts.replace(/<[^>]+>/g, ''), lang: (it.lang || 'ja_JP').replace('_', '-'), id: my });
        else step();
      } catch { step(); }
      return;
    }
    if (it.sound) {
      const url = MEDIA + encodeURIComponent(it.sound);
      if (await waPlay(url, my, step)) return;
      if (my !== avSeq) return;
      audio = new Audio(url); audio.onended = step; audio.play().catch(() => {});
    }
    else if (it.tts) { const u = new SpeechSynthesisUtterance(it.tts.replace(/<[^>]+>/g, '')); u.lang = (it.lang || 'ja_JP').replace('_', '-'); u.onend = step; speechSynthesis.speak(u); }
  };
  step();
}

// ---------- ボタン ----------
// 答えのボタンの間隔の書き方（rslib/src/scheduler/timespan.rs の answer_button_time_collapsible と同じ）
const MIN = 60, HOUR = 3600, DAYS = 86400, YEAR = 365 * DAYS, MONTH = YEAR / 12;
function fmtIvl(secs, collapse = 0) {
  const a = Math.abs(secs);
  const [unit, div, txt] = a < MIN ? ['s', 1, '秒'] : a < HOUR ? ['m', MIN, '分'] : a < DAYS ? ['h', HOUR, '時間'] : a < MONTH ? ['d', DAYS, '日'] : a < YEAR ? ['mo', MONTH, 'か月'] : ['y', YEAR, '年'];
  const v = secs / div;
  const amount = ['s', 'm', 'd'].includes(unit) ? Math.round(v) : Math.round(v * 10) / 10;
  const pat = window.SA_IVL?.[unit];   // 日本語以外のとき（i18n.mjs が入れる Anki の訳の単位）
  const str = pat ? pat.replace('{}', amount) : `${amount}${txt}`;
  if (secs === 0) return window.SA_IVL?.end || '終了';
  return secs < collapse ? `<${str}` : str;
}
function setButtons(mode) {
  const box = $('#answerbar'); box.innerHTML = '';
  // 問題の面は AnkiMobile と同じくカードをタップで答え。下の帯は枚数だけ
  $('#counts').hidden = mode === 'a'; box.hidden = mode !== 'a';
  if (mode === 'a') {
    const { next } = nextStates(S.card, ctxFor(S.card));
    // 1日の境目をまたぐ学習ステップは日に直してから書く（describe_next_states と同じ）
    const t = timingToday(nowSecs(), S.meta); const untilRollover = t.nextDayAt - nowSecs();
    const secsOf = st => { if (st.kind === 'review') return st.days * 86400; const x = st.kind === 'relearn' ? st.learn.secs : st.secs; return x >= untilRollover ? (Math.floor((x - untilRollover) / 86400) + 1) * 86400 : x; };
    const collapse = S.meta.config.collapseTime ?? 1200;
    [[1, 'もう一度', 'again'], [2, '難しい', 'hard'], [3, '正解', 'good'], [4, '簡単', 'easy']].forEach(([g, name, cls]) => {
      const b = document.createElement('button'); b.className = `rate ${cls}`; b.innerHTML = `<span>${fmtIvl(secsOf(next[g]), collapse)}</span><span>${name}</span>`; pressButton(b, () => rate(g)); box.appendChild(b);
    });
  }
}
// 確かめる用: 殻の中で、届いたキーの種類と殻からの知らせを最初の数回だけサーバーに残す（本文は送らない）
// 確かめる用の記録（押したキーの種類など）は、既定では送らない。localStorage の diag に 1 を入れたときだけ自分の D1 に送る
const DIAG = { n: 0, on: (() => { try { return localStorage.getItem('diag') === '1'; } catch { return false; } })() };
// 「？」（AI に質問）は別の中継サーバーが要る。サーバーに ASK_URL と ASK_TOKEN が入っているときだけボタンを出す（前回わかった結果を覚えておく）
function setupAskButton() {
  const b = document.getElementById('ask'); if (!b) return;
  let known = null; try { known = localStorage.getItem('askOK'); } catch {}
  b.style.display = known === '1' ? '' : 'none';
  fetch(new URL('../api/ask?probe=1', location.href), { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => {
    if (!j) return; const ok = !!j.ok; b.style.display = ok ? '' : 'none'; try { localStorage.setItem('askOK', ok ? '1' : '0'); } catch {}
  }).catch(() => {});
}
function diag(o) { if (!DIAG.on || DIAG.n++ > 30) return; try { fetch(new URL('../api/diag', location.href), { method: 'POST', body: JSON.stringify({ ...o, t: Date.now(), view: document.body.dataset.view, kbd: kbdActive() }), keepalive: true }).catch(() => {}); } catch {} }
// キー操作（PC 版 Anki 25.09.4 の qt/aqt/reviewer.py _shortcutKeys と同じ割り当て。アプリに無い機能＝e 編集・o オプション・v 録音・
// Ctrl+Alt+N リセット・Ctrl+Alt+E 複製・Ctrl+Delete 削除・Ctrl+Shift+D 期日・Shift+A 自動で進む は未対応）
// 日本語入力のままのキーボードでは e.key が全角（スペースは「　」、数字は「１」、記号は「＠」など）や かな になる。
// 全角を半角に直し、文字と数字は押したキーの位置（e.code）で読む
const toHalf = s => s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ').replace(/[ー−]/g, '-');
function keyOf(e) {
  const c = e.code || '', k = (e.key || '').length === 1 ? toHalf(e.key) : (e.key || '');
  if (c === 'Space') return ' ';
  if (c === 'Enter' || c === 'NumpadEnter') return 'Enter';
  if (/^Key[A-Z]$/.test(c) && !/^[a-z]$/i.test(k)) return e.shiftKey ? c.slice(3) : c.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(c) && !e.shiftKey && !/^[0-9]$/.test(k)) return c.slice(5);
  return k;
}
function onKey(e) {
  noteKey();
  if (DIAG.n < 25) diag({ ev: 'key', key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, comp: e.isComposing, nat: !!e.native, tgt: e.target && (e.target.id || e.target.tagName), inFrame: e.target && e.target.ownerDocument !== document });
  if (e.target && e.target.closest && e.target.closest('textarea,input,#askPanel')) return; // 質問を打っている最中はめくらない
  // 警告の小窓が出ている間は Enter・Space・Esc で閉じるだけ（iPad の標準の小窓と同じく、Enter は OK）
  if ($('#iosDialog') && !$('#iosDialog').hidden) return;   // 確認の小窓（入力欄・OK はその中で受ける）
  if (!$('#iosAlert').hidden) { if (['Enter', 'Escape'].includes(e.key) || e.code === 'Space' || keyOf(e) === ' ') { e.preventDefault(); $('#iosAlert').hidden = true; } return; }
  // ブラウザ・設定・統計などを開いているあいだは、下の出題に答えない（Esc で閉じる）
  const over = ['#bprev', '#browse', '#awpage', '#prefs'].map(q => $(q)).find(el => el && !el.hidden);
  if (over) { if (e.key === 'Escape') { e.preventDefault(); over.querySelector('.back')?.click(); } return; }
  // 日本語入力のままのキーボードで、処理しなかったキー（表の面の数字など）を iPad が文字入力として変換に回し、候補が出て
  // 以後のキーが全部変換に吸われてしまう。入力欄の外では、文字・数字・スペース・Enter・Backspace は全部ここで止める
  if (!e.ctrlKey && !e.metaKey && !e.altKey && ((e.key || '').length === 1 || ['Enter', 'Backspace', 'Process', 'Unidentified'].includes(e.key) || e.code === 'Space')) e.preventDefault();
  if (document.body.dataset.view !== 'study' || e.isComposing) return;
  if ($('#cardInfo').classList.contains('open')) { if (e.key === 'Escape' || keyOf(e) === 'i') { e.preventDefault(); $('#cardInfo').classList.remove('open'); } return; }
  const k = keyOf(e), ctrl = e.ctrlKey || e.metaKey, done = () => { e.preventDefault(); e.stopPropagation(); };
  if (ctrl && !e.altKey && /^[1-7]$/.test(k)) { done(); setFlag(+k); return; }        // Ctrl+1〜7 フラグ（同じフラグならはずす）
  if (ctrl && !e.altKey && (k === 'z' || k === 'Z')) { done(); undoAnswer(); return; } // 元に戻す
  if (ctrl && e.altKey && (k === 'i' || k === 'I' || e.code === 'KeyI')) { done(); cardInfo(S.undo.length ? S.byId.get(S.undo[S.undo.length - 1].prev?.id ?? S.undo[S.undo.length - 1].prevs[0].id) : null); return; } // 前のカードの情報
  if (ctrl || e.altKey) return;
  switch (k) {
    case ' ': case 'Enter': done(); S.side === 'q' ? showAnswer() : rate(3, true); return;
    case '1': case '2': case '3': case '4': if (S.side === 'a') { done(); rate(+k, true); } return;
    case 'u': case 'z': done(); undoAnswer(); return;
    case 'r': case 'F5': done(); if (S.card) playAv(replayList(S.card)); return;
    case '5': done(); if (nativeAudio()) nativeAudio().postMessage({ audio: 'pause' }); else if (waPauseToggle()) {} else if (audio) audio.paused ? audio.play().catch(() => {}) : audio.pause(); else if (speechSynthesis.speaking) speechSynthesis.paused ? speechSynthesis.resume() : speechSynthesis.pause(); return;
    case '6': case '7': done(); if (nativeAudio()) nativeAudio().postMessage({ audio: 'seek', d: k === '6' ? -5 : 5 }); else if (waSeek(k === '6' ? -5 : 5)) {} else if (audio) audio.currentTime = Math.max(0, audio.currentTime + (k === '6' ? -5 : 5)); return;
    case 'm': done(); $('#gear').click(); return;
    case '-': done(); buryCard(); return;
    case '=': done(); buryNote(); return;
    case '@': done(); suspendCard(); return;
    case '!': done(); suspendNote(); return;
    case '*': done(); toggleMark(); return;
    case 'i': done(); cardInfo(S.card); return;
    case 'A': done(); toggleAuto(); return;   // Shift+A カードの自動送り
  }
}
// スペース・Enter を離したときに、押してあったボタン（前に触った評価ボタンなど）が押されないように
function onKeyUp(e) { if (e.target && e.target.closest && e.target.closest('textarea,input,#askPanel')) return; if (!e.ctrlKey && !e.metaKey && ((e.key || '').length === 1 || e.key === 'Enter' || e.code === 'Space')) e.preventDefault(); }

// ---------- 勉強時間（デッキごと・日ごと。画面に出ている間だけ数える） ----------
let timerT = null;
function startTimer() {
  clearInterval(timerT);
  const key = () => `t:${new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10)}:${S.deck}`;
  timerT = setInterval(() => {
    if (document.hidden || document.body.dataset.view !== 'study') return;
    const v = (+localStorage.getItem(key()) || 0) + 1; localStorage.setItem(key(), v);
    const m = Math.floor(v / 60), s = v % 60; $('#timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, 1000);
}

// ---------- カスタム学習の画面（rslib scheduler/filtered/custom_study.rs と同じ動き。見た目は AnkiMobile） ----------
function openCustom() {
  const did = S.deck === 'session' ? loadSession()?.from : S.deck; if (!did) return;
  const d = S.decksById.get(did);
  // 上乗せ可能＝そのデッキそのものにある新規（子デッキは含まない。custom_study_defaults の available_new と同じ）
  const own = q => S.cards.filter(c => c.did === did && q(c)).length;
  const t = timingToday(nowSecs(), S.meta);
  const availNew = own(c => c.queue === 0), availRev = own(c => c.queue === 2 && c.due <= t.daysElapsed);
  const last = k => { try { return +localStorage.getItem(`cs:${k}:${did}`) || 0; } catch { return 0; } };
  const OPT = {
    new: ['今日の新規カードの上限に上乗せ', last('new') || d.extendNew || 0, `上乗せ可能な新規カード: ${availNew} 枚`],
    rev: ['今日の復習カードの上限に上乗せ', last('rev') || d.extendRev || 0, `上乗せ可能な復習カード: ${availRev} 枚`],
    ahead: ['先取りする日数', last('ahead') || 1, ''],
  };
  const pick = k => {
    if (!OPT[k]) return;
    document.querySelectorAll('#cp-types li').forEach(li => li.classList.toggle('on', li.dataset.k === k));
    $('#cp-label').textContent = OPT[k][0]; $('#cp-n').value = OPT[k][1]; $('#cp-foot').textContent = OPT[k][2];
    $('#customPage').dataset.k = k;
  };
  document.querySelectorAll('#cp-types li').forEach(li => li.onclick = () => pick(li.dataset.k));
  pick('new');
  const close = () => $('#customPage').classList.remove('open');
  $('#cp-back').onclick = close;
  $('#cp-done').onclick = () => {
    const k = $('#customPage').dataset.k; const n = Math.max(1, Math.min(9999, parseInt($('#cp-n').value, 10) || 0));
    if (k === 'ahead' && !createReviewAhead(did, n)) { iosAlert('Error', '指定した条件に一致するカードはありませんでした。'); return; } // rslib CustomStudyError::NoMatchingCards。画面はそのまま
    try { localStorage.setItem(`cs:${k}:${did}`, n); } catch {}
    close();
    if (k === 'new') addExt(did, 'new', n); else if (k === 'rev') addExt(did, 'rev', n);
    else if (k === 'ahead') { startStudy('session'); return; }
    if (document.body.dataset.view === 'study') advance(); else showDecks();
  };
  $('#customPage').classList.add('open');
}
// ---------- アクション（AnkiMobile 25.09 の「すべてのアクション」。タップ・スワイプ・トップバーにも割り当てる。名前と並びは実機の日本語のとおり） ----------
// 3つ目が null のものは、まだ写していない（一覧では薄く出して選べない）
const ACTIONS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [`ua${n}`, `User Action ${n}`, null]),
  ['redo', 'やり直す', null],
  ['off', 'オフ', () => {}],
  ['options', 'オプション', () => { if (typeof S.deck === 'number') openAnkiPage('deck-options', 'オプション', S.deck); }],
  ['custom', 'カスタム学習', () => openCustom()],
  ['auto', 'カードの自動送り', () => toggleAuto()],
  ['reset', 'カードをリセット', () => resetAction()],
  ['buryCard', 'カードを今日は非表示', () => buryCard()],
  ['suspendCard', 'カードを休止', () => suspendCard()],
  ['template', 'カードテンプレート', null],
  ['info', 'カード情報', () => cardInfo(S.card)],
  ['tools', 'ツールアイコン', () => openTools()],
  ['decks', 'デッキ', () => showDecks()],
  ['stats', 'デッキの統計', () => openAnkiPage('graphs', S.deck === 'session' ? 'カスタム学習セッション' : S.decksById.get(S.deck)?.name.split('::').pop() || '統計', S.deck)],
  ['unburyDeck', 'デッキ内非表示解除', () => window.ankiBridge('unbury')],
  ['topbar', 'トップバー', () => flipPref('topbar')],
  ['night', 'ナイトモード', () => { try { localStorage.setItem('theme', isDark() ? 'light' : 'dark'); } catch {} applyTheme(); }],
  ['buryNote', 'ノートを今日は非表示', () => buryNote()],
  ['suspendNote', 'ノートを休止', () => suspendNote()],
  ['deleteNote', 'ノートを削除', null],
  ['filter', 'フィルター / 詰め込み', null],
  ...[1, 2, 3, 4, 5, 6, 7].map(n => [`flag${n}`, `フラグ${n}`, () => setFlag(n)]),
  ['browse', 'ブラウザ', () => openBrowse('deck:current')],
  ['bottombar', 'ボトムバー', () => flipPref('bottombar')],
  ['mark', 'マークする', () => toggleMark()],
  ['markBury', 'マーク＋今日は非表示', () => markThen(buryCard)],
  ['markSuspend', 'マーク＋休止', () => markThen(suspendCard)],
  ['scrollUp', '上にスクロール', () => scrollCard(-1)],
  ['scrollDown', '下にスクロール', () => scrollCard(1)],
  ['undo', '元に戻す', () => undoAnswer()],
  ['rebuild', '再構築', null],
  ['sync', '同期', () => runSync(true)],
  ['again', '回答 (もう一度)', () => answerBy(1)],
  ['good', '回答 (正解)', () => answerBy(3)],
  ['easy', '回答 (簡単)', () => answerBy(4)],
  ['hard', '回答 (難しい)', () => answerBy(2)],
  ['record', '声を録音', null],
  ['spSize', '手書きサイズ', () => sp.cycleSize()],
  ['scratchpad', '手書きパッド', () => sp.toggle()],
  ['due', '期日を指定', () => dueAction()],
  ['empty', '空にする', null],
  ['edit', '編集', null],
  ['show', '解答を表示', () => { if (S.side === 'q') showAnswer(); }],
  ['showGood', '解答を表示 / 回答 (正解)', () => { if (S.side === 'q') showAnswer(); else answerBy(3); }],
  ['add', '追加', null],
  ['playRec', '録音した声を再生', null],
  ['recMenu', '録音メニュー', null],
  ['fwd5', '音声 +5秒', () => avSeek(5)],
  ['back5', '音声 -5秒', () => avSeek(-5)],
  ['pause', '音声を一時停止/再開', () => avPause()],
  ['replay', '音声を再生', () => { if (S.card) playAv(replayList(S.card)); }],
];
const ACT = new Map(ACTIONS.map(a => [a[0], a]));
const actName = k => ACT.get(k)?.[1] ?? 'オフ';
function runAction(k) { const a = ACT.get(k); if (a && a[2] && document.body.dataset.view === 'study') a[2](); }
function flipPref(k) { try { localStorage.setItem('pref:' + k, pref(k) ? '0' : '1'); } catch {} applyPrefs(); renderTopbar(); }
function answerBy(g) { if (S.card && S.side === 'a') rate(g); }
async function markThen(fn) { if (!S.card) return; if (!isMarked(S.card)) await changeCards(siblings(S.card), c => { c.mark = true; }, 'マークを付けました', 'マーク', false, false); fn(); }
function scrollCard(dir) { const d = $('#card').contentDocument, se = d?.scrollingElement; if (se) se.scrollBy({ top: dir * se.clientHeight * 0.8, behavior: 'smooth' }); }
function avPause() { if (nativeAudio()) nativeAudio().postMessage({ audio: 'pause' }); else if (waPauseToggle()) {} else if (audio) audio.paused ? audio.play().catch(() => {}) : audio.pause(); else if (speechSynthesis.speaking) speechSynthesis.paused ? speechSynthesis.resume() : speechSynthesis.pause(); }
function avSeek(d) { if (nativeAudio()) nativeAudio().postMessage({ audio: 'seek', d }); else if (waSeek(d)) {} else if (audio) audio.currentTime = Math.max(0, audio.currentTime + d); }
// タップ（9区画×表裏）・スワイプ・トップバーの割り当て。既定は AnkiMobile のマニュアルと実機のとおり
const ZONE_N = 9;
const TAP_DEF = { q: Array(ZONE_N).fill('show'), a: ['again', 'off', 'good', 'again', 'off', 'good', 'again', 'off', 'good'] };
const SWIPE_DEF = { left: 'tools', right: 'decks', up: 'off', down: 'off' };
const shakeAct = () => lsGet('shake', 'undo');
const TOP_DEF = ['decks', 'add', 'edit', 'browse', 'off', 'off', 'off', 'off', 'off'];
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v != null && ACT.has(v) ? v : d; } catch { return d; } };
const tapAct = (side, i) => lsGet(`tap:${side}:${i}`, TAP_DEF[side][i]);
const swipeAct = dir => lsGet(`swipe:${dir}`, SWIPE_DEF[dir]);
const topAct = i => lsGet(`top:${i}`, TOP_DEF[i]);
function renderTopbar() {
  const box = $('#tabs'); if (!box) return;
  const ks = TOP_DEF.map((_, i) => topAct(i)).filter(k => k !== 'off');
  box.style.gridTemplateColumns = `repeat(${Math.max(1, ks.length)},1fr)`;
  box.innerHTML = '';
  for (const k of ks) {
    const b = document.createElement('button'); b.textContent = actName(k); b.dataset.act = k;
    if (k === 'decks') b.id = 'tab-decks'; else if (k === 'browse') b.id = 'tab-browse';
    if (!ACT.get(k)?.[2]) b.disabled = true;
    b.onclick = () => runAction(k); box.append(b);
  }
}
// 文字の大きさ（歯車メニューの「Aa 1.0x Aa」）。全デッキ共通。0.1〜2.0 は 0.1、2.0〜4.0 は 0.2、4.0〜10.0 は 0.5 刻み（実機で測った）。
// カードの中身をページごと拡大し、幅に合わせて折り返し直す（AnkiMobile と同じく文字・数式・画像とも）
const aaGet = () => { let v = 1; try { v = +localStorage.getItem('aa') || 1; } catch {} return Math.min(10, Math.max(0.1, v)); };
function aaStep(dir) {
  const v = aaGet(), r = x => Math.round(x * 10) / 10;
  const n = dir > 0 ? (v < 1.95 ? v + 0.1 : v < 3.95 ? v + 0.2 : v + 0.5) : (v > 4.05 ? v - 0.5 : v > 2.05 ? v - 0.2 : v - 0.1);
  try { localStorage.setItem('aa', String(Math.min(10, Math.max(0.1, r(n))))); } catch {}
  applyAa();
}
function applyAa() {
  const v = aaGet(), el = $('#menu .fs .v'); if (el) el.textContent = v.toFixed(1) + 'x';
  const d = $('#card').contentDocument; if (d && d.documentElement) d.documentElement.style.zoom = v === 1 ? '' : String(v);
}
// カードの自動送り（aqt reviewer.py の auto_advance と同じ: デッキのオプションの秒数・音声を待つ・問題と解答のときの動き）。学習の画面に入り直すと切れる
let aaTimer = null, aaWaitAudio = null;
function autoClear() { clearTimeout(aaTimer); aaTimer = null; aaWaitAudio = null; }
function toggleAuto() { S.auto = !S.auto; toast(S.auto ? 'カードの自動送りを開始しました' : 'カードの自動送りを停止しました'); autoArm(); }
function autoArm() {
  autoClear();
  if (!S.auto || !S.card || S.deck == null) return;
  const p = presetOf(S.card.did), secs = S.side === 'q' ? p.secondsToShowQuestion : p.secondsToShowAnswer;
  if (!secs) return;
  const card = S.card, side = S.side;
  aaTimer = setTimeout(() => autoFire(card, side), secs * 1000);
}
function autoFire(card, side) {
  if (S.card !== card || S.side !== side) return;
  if (!S.auto || document.hidden) { S.auto = false; return; }
  const p = presetOf(card.did);
  if (p.waitForAudio !== false && avActive) { aaWaitAudio = () => autoFire(card, side); return; }   // 音声が鳴り終わってから
  if (side === 'q') { if ((p.questionAction || 0) === 1) toast('質問表示時間が経過しました'); else showAnswer(); return; }
  const a = p.answerAction || 0;
  if (a === 1) rate(1); else if (a === 3) rate(2); else if (a === 2) rate(3); else if (a === 4) toast('回答する時間になりました'); else buryCard();
}

window.ankiBridge = cmd => {
  if (cmd === 'customStudy') openCustom();
  else if (cmd === 'unbury' && typeof S.deck === 'number') {
    const root = S.decksById.get(S.deck); const ids = new Set(S.meta.decks.filter(d => d.name === root.name || d.name.startsWith(root.name + '::')).map(d => d.id));
    changeCards(S.cards.filter(c => ids.has(c.did) && (c.queue === -2 || c.queue === -3)), c => { c.queue = c.type === 0 ? 0 : c.type === 2 ? 2 : (c.due > 1e9 ? 1 : 3); }, '非表示のカードを戻しました', '非表示を戻す');
  }
};

// ---------- 起動 ----------
function setupTools() {
  pen = createPen($('#cardhost')); pen.setEnabled(false);   // 書き込みのデザインを読み込むまでは書けない
  sp = createScratchpad({ study: $('#study'), host: $('#cardhost'), bottom: $('#bottom'), corner: $('#corner'), isDark });   // 手書きパッド（本家の機能）
  // 歯車のメニュー
  const closeMenu = () => $('#menu').classList.remove('open');
  $('#gear').onclick = () => openTools();
  $('#menu').onclick = e => { if (e.target.id === 'menu') closeMenu(); };
  // 「すべてのアクション」は AnkiMobile と同じ並びで全部出す（まだ写していないものは薄く）
  { const g = $('#menu-all'); g.innerHTML = ''; for (const [k, t, fn] of ACTIONS) { if (k === 'off') continue; const b = document.createElement('button'); b.textContent = t; b.dataset.all = k; if (!fn) b.disabled = true; b.onclick = () => { closeMenu(); runAction(k); }; g.append(b); } }
  $('#menu .fs .s').onclick = e => { e.stopPropagation(); aaStep(-1); }; $('#menu .fs .b').onclick = e => { e.stopPropagation(); aaStep(1); };
  applyAa(); renderTopbar(); setupShake();
  $('#nav-help').onclick = () => window.open('https://docs.ankiweb.net/ankimobile/intro', '_blank', 'noopener');   // 「？」＝AnkiMobile のマニュアル（実機と同じページ）
  document.querySelectorAll('#menu [data-act]').forEach(b => b.onclick = () => {
    const a = b.dataset.act; closeMenu();
    if (a === 'undo') undoAnswer();
    else if (a === 'decks') showDecks();
    else if (a === 'options' && typeof S.deck === 'number') openAnkiPage('deck-options', 'オプション', S.deck);
    else if (a === 'stats') openAnkiPage('graphs', S.deck === 'session' ? 'カスタム学習セッション' : S.decksById.get(S.deck)?.name.split('::').pop() || '統計', S.deck);
    else if (a === 'custom') openCustom();
    else if (a === 'scratchpad') sp.toggle();
    else if (a === 'topbar') { try { localStorage.setItem('pref:topbar', pref('topbar') ? '0' : '1'); } catch {} applyPrefs(); }
    else if (a === 'flag') setFlag(1);
    else if (a === 'bury') buryNote();
    else if (a === 'suspend') suspendCard();
    else if (a === 'info') cardInfo(S.card);
  });
  const setLS = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const chevR = '<svg width="7.7" height="12.8" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5 7.5 7.5 1.5 13.5"/></svg>';
  const NIGHT = { auto: 'システムに従う', light: '強制オフ', dark: '強制オン' };
  const BAR_L = { light: 'ライト & 半透明', gray: 'グレー', dark: 'ダーク', black: 'ブラック' }, BAR_D = { translucent: 'ダーク & 半透明', black: 'ブラック' };
  const setPref = (k, v) => setLS('pref:' + k, v ? '1' : '0');
  const tgl = (t, k, after) => ({ t, tg: pref(k), run: () => { setPref(k, !pref(k)); if (after) after(); } });
  const ZONES = ['左上', '中央上', '右上', '左中央', '中央', '右中央', '左下', '中央下', '右下'];
  // AnkiMobile の「設定」と同じ並び。まだ作っていない項目は薄く出して押せない
  const PAGES = {
    root: () => ({ title: '設定', groups: [
      [{ t: '同期', go: 'sync' }, { t: '学習', go: 'study' }, { t: '編集', go: 'edit' }, { t: 'テーマ', go: 'theme' }, { t: 'プロファイル', go: 'profile' }, { t: 'バックアップ', go: 'backup' }, { t: 'このアプリについて', go: 'about' }],
      [{ t: 'データベースをチェック', act: 1, off: 1 }, { t: 'メディアをチェック', act: 1, off: 1 }, { t: '白紙カード', act: 1, off: 1 }],
      ...(FEAT.pen || FEAT.autoSync ? [[{ t: 'このアプリ独自の機能', go: 'extras' }]] : [])] }),
    // 本家の AnkiMobile に無い機能（どれも最初は切ってある）
    extras: () => ({ title: 'このアプリ独自の機能', groups: [
      ...(FEAT.pen ? [[tgl('書き込み（Apple Pencil でカードに直接書く）', 'pen', applyPrefs)],
        { note: `入れたデザイン「${FEAT.pen}」で、カードの上に Apple Pencil で書けます。歯車メニューの「手書きパッド」（本家の機能）とは別のものです。` }] : []),
      ...(FEAT.autoSync ? [[tgl('答えるたびに自動で同期', 'autoSync', () => { if (pref('autoSync')) scheduleSync(300); })],
        { note: 'オフにすると本家と同じく、下の「同期」を押したときだけ送受信します。同期していない答えは、パソコンの Anki への書き戻しに入りません。' }] : [])] }),
    theme: () => ({ title: 'テーマ', groups: [
      [{ t: 'ナイトモード', v: NIGHT[theme()], go: 'night' }],
      { note: 'ナイトモード（夜間モード）を使用すると、インターフェースが暗くなり、カードは黒い背景に白文字で表示されます。' },
      [{ t: 'バーの外観', v: isDark() ? BAR_D[barDark()] : BAR_L[barStyle()], go: 'bar' }]] }),
    night: () => ({ title: 'ナイトモード', groups: [Object.entries(NIGHT).map(([k, t]) => ({ t, ck: theme() === k, run: () => { setLS('theme', k); applyTheme(); } }))] }),
    bar: () => ({ title: 'バーの外観', groups: [isDark()
      ? Object.entries(BAR_D).map(([k, t]) => ({ t, ck: barDark() === k, run: () => { setLS('barDark', k); applyTheme(); } }))
      : Object.entries(BAR_L).map(([k, t]) => ({ t, ck: barStyle() === k, run: () => { setLS('bar', k); applyTheme(); } }))] }),
    study: () => ({ title: '学習', groups: [
      [{ t: 'スケジュール', go: 'x', off: 1 }, { t: '通知', go: 'notify' }, { t: 'トップバー', go: 'topbar' }, { t: 'ボトムバー', go: 'bottombar' }, { t: 'タップ', go: 'tap' }, { t: 'スワイプ', go: 'swipe' }, { t: '手書きパッド', go: 'pad' }, { t: 'ゲームパッド', go: 'x', off: 1 }],
      [tgl('ツールアイコンを表示', 'toolsBtn', applyPrefs), { t: 'ツールアイコンの配置', v: toolsLeft() ? '左側' : '右側', go: 'toolspos' }],
      [tgl('回答確認用のマークを表示', 'ticks'), tgl('回答確認用マークの表示位置を種類別にする', 'ticksByType')],
      [tgl('音声再生ボタンを表示', 'replayBtn', () => { if (S.card) setFrame(cardHtml(S.card, S.side), S.card.mid, S.card.ord, S.side === 'a'); }),
       tgl('質問の音声・動画の再生を解答表示で停止', 'stopQAudio'),
       { t: 'サイレントモードでも音声を自動再生', tg: true, off: 1 }, { t: '他アプリの音（BGMなど）の音量を常に抑えめにする', tg: false, off: 1 }],
      [{ t: '動画をループ再生', tg: false, off: 1 }, { t: '動画再生コントローラーを表示', tg: true, off: 1 }],
      [tgl('文字入力で解答しない', 'neverType', () => { if (S.card && S.side === 'q') setFrame(cardHtml(S.card, 'q'), S.card.mid, S.card.ord); }),
       tgl('手書きパッドを表示しない', 'noPad', () => sp.refresh())],
      [{ t: 'シェイクアクション', v: actName(shakeAct()), go: 'shake' }, { t: 'ダブルタップ防止', v: DTP[dtpKey()][0], go: 'dtp' }, tgl('リンクをこのアプリの外部で開く', 'extLinks')]] }),
    toolspos: () => ({ title: 'ツールアイコンの配置', groups: [[['left', '左側'], ['right', '右側']].map(([k, t]) => ({ t, ck: (toolsLeft() ? 'left' : 'right') === k, run: () => { setLS('toolsPos', k); applyPrefs(); } }))] }),
    dtp: () => ({ title: 'ダブルタップ防止', groups: [Object.entries(DTP).map(([k, [t]]) => ({ t, ck: dtpKey() === k, run: () => setLS('dtp', k) }))] }),
    notify: () => ({ title: '通知', groups: [
      [{ t: 'アプリのアイコンに課題枚数を表示', tg: false, off: 1 }],
      [{ t: '定時に、課題があれば枚数を通知', tg: false, off: 1 }, { t: '通知時刻', v: '10:00', go: 'x', off: 1 }]] }),
    topbar: () => ({ title: 'トップバー', groups: [
      [tgl('トップバーを表示', 'topbar', applyPrefs)],
      TOP_DEF.map((_, i) => ({ t: `ボタン${i + 1}`, v: actName(topAct(i)), go: 'tb' + i }))] }),
    bottombar: () => ({ title: 'ボトムバー', groups: [
      [tgl('ボトムバーを表示', 'bottombar', applyPrefs), { t: 'ボトムバーのサイズ', v: '標準', go: 'x', off: 1 }],
      { sec: '質問側' }, [tgl('残りのカード枚数', 'counts', applyPrefs)],
      { sec: '解答側' }, [tgl('回答ボタン', 'answerBtn', applyPrefs), tgl('次回の学習までの間隔', 'ivl', applyPrefs)]] }),
    tap: () => ({ title: 'タップ', groups: [
      { sec: '質問側だけが表示されているとき' }, ZONES.map((t, i) => ({ t, v: actName(tapAct('q', i)), go: 'tapq' + i })),
      { sec: '解答側も表示されているとき' }, ZONES.map((t, i) => ({ t, v: actName(tapAct('a', i)), go: 'tapa' + i }))] }),
    swipe: () => ({ title: 'スワイプ', groups: [SWIPES.map(([d, t]) => ({ t, v: actName(swipeAct(d)), go: 'sw_' + d }))] }),
    pad: () => {
      const tg = (t, k) => ({ t, tg: spPref.flag(k), run: () => { spPref.set(k, !spPref.flag(k)); sp.refresh(); } });
      return { title: '手書きパッド', groups: [
        [{ t: 'ペンの太さ', v: SP_WIDTH[spPref.width()][0], go: 'padw' }, { t: 'パッドの大きさ', v: spPref.size() + '%', go: 'pads' }, { t: '手書きパッドの透明度', v: SP_ALPHA[spPref.alpha()][0], go: 'pada' },
         tg('グリッドを表示', 'grid'), tg('指での入力を無視', 'finger'), tg('「元に戻す」アイコンですべて消去', 'undoAll'), tg('手書きパッドをボトムバーの下に表示', 'below')]] };
    },
    padw: () => ({ title: 'ペンの太さ', groups: [Object.entries(SP_WIDTH).map(([k, [t]]) => ({ t, ck: spPref.width() === k, run: () => { spPref.set('width', k); sp.refresh(); } }))] }),
    pads: () => ({ title: 'パッドの大きさ', groups: [SP_SIZE.map(n => ({ t: n + '%', ck: spPref.size() === n, run: () => { spPref.set('size', n); sp.refresh(); } }))] }),
    pada: () => ({ title: '手書きパッドの透明度', groups: [Object.entries(SP_ALPHA).map(([k, [t]]) => ({ t, ck: spPref.alpha() === k, run: () => { spPref.set('alpha', k); sp.refresh(); } }))] }),
    edit: () => ({ title: '編集', groups: [
      [{ t: '最大画像サイズ（長辺）', v: '1024', off: 1 }, { t: 'クリップボード画像を PNG 形式で貼り付ける', tg: false, off: 1 }, { t: '貼り付けの際にリサイズ', tg: false, off: 1 }, { t: 'カメラで撮影した写真をクロップ（切り出し）', tg: false, off: 1 }, { t: 'カメラで撮影する動画を高画質にする', tg: false, off: 1 }],
      [{ t: '英字入力時に文頭を自動で大文字にする', tg: true, off: 1 }, { t: 'オートコレクト', tg: true, off: 1 }, { t: 'スマート引用符とダッシュを自動変換', tg: true, off: 1 }],
      [{ t: '手書きスクリーンで指での入力を無視', tg: false, off: 1 }]] }),
    profile: () => ({ title: 'プロファイル', groups: [[{ t: 'ユーザー 1', ck: true }]] }),
    backup: () => ({ title: 'バックアップ', groups: [
      [{ t: '自動バックアップの間隔（分）', v: '30', off: 1 }, { t: '各日代表のバックアップ保管数（何日分）', v: '12', off: 1 }, { t: '各週代表のバックアップ保管数（何週分）', v: '10', off: 1 }, { t: '各月代表のバックアップ保管数（何か月分）', v: '9', off: 1 }],
      { note: 'このアプリにはバックアップの機能がありません。パソコンの Anki に書き戻している場合は、Anki 側のバックアップに入ります。' }] }),
    about: () => ({ title: 'このアプリについて', about: ['Anki のカードと学習の記録をそのまま使う暗記アプリです。', '復習の間隔の計算と出題の順番は、Anki のソースコード（AGPL）をもとに書き直したもので、Anki 本体と同じ結果になることを確かめています。', '答えた記録をパソコンの Anki に書き戻せば、Anki や AnkiMobile と並行して使えます。'] }),
    sync: () => ({ title: '同期', groups: [
      [{ t: '音声と画像を同期', tg: true, off: 1 }, { t: 'メディア同期の進捗を表示', tg: true, off: 1 }],
      [{ t: '今すぐ同期', act: 1, run: () => { closePrefs(); runSync(true); } }]] }),
  };
  // 割り当てを選ぶページ（AnkiMobile と同じく全アクションの一覧。まだ写していないものは薄く出して選べない）
  const SWIPES = [['left', '左にスワイプ'], ['right', '右にスワイプ'], ['up', '上にスワイプ'], ['down', '下にスワイプ']];
  const picker = (title, cur, key) => () => ({ title, groups: [ACTIONS.map(([k, t, fn]) => ({ t, ck: cur() === k, off: fn ? 0 : 1, run: () => { setLS(key, k); renderTopbar(); } }))] });
  for (const side of ['q', 'a']) for (let i = 0; i < ZONES.length; i++) PAGES['tap' + side + i] = picker(ZONES[i], () => tapAct(side, i), `tap:${side}:${i}`);
  for (const [d, t] of SWIPES) PAGES['sw_' + d] = picker(t, () => swipeAct(d), 'swipe:' + d);
  for (let i = 0; i < TOP_DEF.length; i++) PAGES['tb' + i] = picker(`ボタン${i + 1}`, () => topAct(i), 'top:' + i);
  PAGES.shake = () => { const pg = picker('シェイクアクション', shakeAct, 'shake')(); for (const it of pg.groups[0]) { const run = it.run; it.run = () => { run(); try { DeviceMotionEvent.requestPermission?.(); } catch {} }; } return pg; };
  let stack = [];
  const closePrefs = () => { $('#prefs').hidden = true; stack = []; };
  const renderPrefs = () => {
    const pg = PAGES[stack.at(-1)](); const body = $('#prefs .pbody'); body.innerHTML = '';
    if (pg.about) { $('#prefs .ptitle').textContent = pg.title; $('#prefs .bl').textContent = '設定'; body.innerHTML = '<div class="about">' + pg.about.map(t => `<p>${t}</p>`).join('') + '</div>'; return; }
    $('#prefs .ptitle').textContent = pg.title; $('#prefs .bl').textContent = stack.length > 1 ? PAGES[stack.at(-2)]().title : '戻る';
    for (const g of pg.groups) {
      if (!Array.isArray(g)) { const n = document.createElement('div'); n.className = g.sec ? 'sec' : 'note'; n.textContent = g.sec || g.note; body.appendChild(n); continue; }
      const box = document.createElement('div'); box.className = 'grp'; body.appendChild(box);
      for (const it of g) {
        const b = document.createElement('button'); b.className = 'it' + (it.act ? ' act' : '') + (it.off ? ' off' : '') + (it.tg != null ? ' tgr' : ''); if (it.off) b.disabled = true;
        b.innerHTML = '<span class="lab"></span>' + (it.v != null ? '<span class="val"></span>' : '') + (it.go ? `<span class="chev">${chevR}</span>` : '') + (it.ck ? '<span class="ck">✓</span>' : '') + (it.tg != null ? `<span class="tg${it.tg ? ' on' : ''}"></span>` : '');
        b.querySelector('.lab').textContent = it.t; if (it.v != null) b.querySelector('.val').textContent = it.v;
        if (!it.off) b.onclick = () => { if (it.go) { stack.push(it.go); renderPrefs(); } else if (it.run) { it.run(); if (!$('#prefs').hidden) renderPrefs(); } };
        box.appendChild(b);
      }
    }
  };
  $('#prefs .back').onclick = () => { stack.pop(); if (stack.length) renderPrefs(); else closePrefs(); };
  $('#nav-settings').onclick = () => { stack = ['root']; renderPrefs(); $('#prefs').hidden = false; };
  // Anki 本体の画面（統計など）を全画面で開く。中身は /graphs などの Anki の画面、データは ankiweb.mjs が答える
  installAnkiBackend(() => S, () => (typeof S.deck === 'number' ? S.deck : S.lastDeck), { updateDeckConfigs, close: () => $('#awpage .back').click() });
  $('#awpage .back').onclick = () => { $('#awpage').hidden = true; $('#awframe').src = 'about:blank'; };
  for (const f of [$('#awframe'), $('#doneframe')]) f.addEventListener('load', () => { try { f.contentWindow.alert = m => iosAlert(String(m), ''); } catch {} });
  $('#nav-stats').onclick = () => openAnkiPage('graphs', '統計', S.lastDeck);
  $('#nav-search').onclick = () => openBrowse('deck:current');
  $('#browse > .pnav .back').onclick = () => { $('#browse').hidden = true; };
  $('#bprev .back').onclick = () => { $('#bprev').hidden = true; $('#bprevf').srcdoc = ''; };
  $('#bq').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); runBrowse(); } });
  $('#browse .clr').onclick = e => { e.preventDefault(); $('#bq').value = ''; $('#bq').focus(); };
  $('#blist').addEventListener('scroll', () => paintBrowse(), { passive: true });
  $('#blist').addEventListener('click', e => {
    const r = e.target.closest('.br'); if (!r) return; const c = BR.list[+r.dataset.i];
    if (BR.sel) { if (BR.sel.has(c.id)) BR.sel.delete(c.id); else BR.sel.add(c.id); paintBrowseTitle(); paintBrowse(true); return; }
    previewCard(c);
  });
  { const nr = $('#browse > .pnav .nr'); const selBtn = nr.querySelector('[title="選択"]'); selBtn.disabled = false; selBtn.onclick = () => setBrowseSelect(true);
    const mk = (t, cls, fn) => { const b = document.createElement('button'); b.className = 'tx ' + cls; b.textContent = t; b.onclick = fn; nr.append(b); };
    mk('アクション', 'sel-act', openBrowseActions);
    mk('すべて選択', 'sel-all', () => { BR.sel = new Set(BR.list.map(c => c.id)); paintBrowseTitle(); paintBrowse(true); });
    mk('キャンセル', 'sel-cancel', () => setBrowseSelect(false)); }
  // 一覧の左下「追加/エクスポート」（AnkiMobile と同じ吹き出し。中の機能はまだ）
  $('#nav-add').onclick = () => { $('#addpop').hidden = false; document.body.classList.add('addopen'); };
  $('#addpop').onclick = e => { if (e.target.id === 'addpop') { $('#addpop').hidden = true; document.body.classList.remove('addopen'); } };
  setupAskButton();
  ask = createAsk({ getCard: () => S.card, getSide: () => S.side, deckName: did => S.decksById.get(did)?.name || '', penImage: () => pen.image(isDark() ? '#000000' : '#ffffff'), hasStrokes: () => pen.state.strokes.length > 0, cardById: id => S.byId.get(id) });
  watchSel(document);
  // 文字を選んでいるときのタップは選択を外すだけ（評価ボタン・メニューなどに貫通させない）。質問の入力欄と答えの欄の中は除く
  document.addEventListener('click', e => {
    if (!selAtDown) return;
    if (e.target.closest && e.target.closest('#ask-q,#ask-log')) return;
    selAtDown = false; e.preventDefault(); e.stopPropagation(); clearSel();
  }, true);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp, true);
  // 文字を打つ欄（質問欄・カスタム学習の数）に入っている間は、殻にキーを取らないよう知らせる（殻 0.6〜。殻はそれ以外のときキーを日本語入力より先に取る）
  const tellTyping = () => { const a = document.activeElement; const t = !!(a && a.matches && a.matches('textarea,input,[contenteditable]')); try { window.webkit?.messageHandlers?.sa?.postMessage({ typing: t }); } catch {} };
  document.addEventListener('focusin', tellTyping); document.addEventListener('focusout', () => setTimeout(tellTyping, 0));
  tellTyping();   // 起動したときにも知らせる（番号の入力画面から来たとき、殻がキーを取らないままにならないように）
  $('#cardInfo .close').onclick = () => $('#cardInfo').classList.remove('open');
  $('#iosAlert .ok').onclick = () => { $('#iosAlert').hidden = true; };
  $('#cardInfo').onclick = e => { if (e.target.id === 'cardInfo') $('#cardInfo').classList.remove('open'); };
  // iPad の入れ物（殻）から届く Apple Pencil Pro のスクイーズとダブルタップ
  // kbd: 殻からキーボードの有無（1＝つながった・0＝外れた）。つながったらとりあえず ON（⌨ で手で切れる）
  window.onNative = (kind, v) => {
    if (kind !== 'audioEnded') probeNative();
    if (kind === 'squeeze') { if (!document.body.classList.contains('nopen')) DESIGN?.onSqueeze?.(); } else if (kind === 'tap') { if (!document.body.classList.contains('nopen')) DESIGN?.onTap?.(); }
    else if (kind === 'fr') diag({ ev: 'fr', v });
    else if (kind === 'caps') { NATIVE_AUDIO.ok = !!(v && v.audio); diag({ ev: 'caps', v }); }
    else if (kind === 'audioEnded' && v === PROBE) { if (!NATIVE_AUDIO.ok) { NATIVE_AUDIO.ok = true; diag({ ev: 'probe', ms: Date.now() - NATIVE_AUDIO.asked }); } }
    else if (kind === 'audioEnded') { if (avWait && avWait.id === v) { const w = avWait; avWait = null; w.step(); } }
    else if (kind === 'key') { const o = v || {}; onKey({ key: o.key, code: '', ctrlKey: !!o.ctrl, metaKey: !!o.meta, altKey: !!o.alt, shiftKey: !!o.shift, isComposing: false, target: document.body, native: true, preventDefault() {}, stopPropagation() {} }); }
    else if (kind === 'kbd') { const was = KBD.known ? KBD.dev : null; KBD.known = true; KBD.dev = !!v; if (was !== KBD.dev) KBD.on = KBD.dev; paintKbd(); }
  };
  if (new URLSearchParams(location.search).has('mouse')) pen.state.mouse = true;
  applyTheme(); applyPrefs();
  if (window.webkit?.messageHandlers?.sa) { diag({ ev: 'boot' }); probeNative(); window.addEventListener('load', () => diag({ ev: 'load' })); }
}
// 一覧の画面ではつまんで縮小・拡大させない（Safari の gesture は止める）。出題中は拡大だけ許す
const VP_LOCK = 'width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
const VP_STUDY = 'width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=5,viewport-fit=cover';
new MutationObserver(() => { const vp = document.getElementById('vp'); if (vp) vp.content = document.body.dataset.view === 'decks' ? VP_LOCK : VP_STUDY; })
  .observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => { if (document.body.dataset.view === 'decks') e.preventDefault(); }, { passive: false });
document.addEventListener('touchmove', e => { if (document.body.dataset.view === 'decks' && e.touches.length > 1) e.preventDefault(); }, { passive: false });
// ---------- 戻るボタン（Android のスマホ。殻＝iPad には戻るボタンが無いので何もしない） ----------
// 一覧より奥（出題・ブラウザ・設定・メニューなど）にいる間は履歴に1つ積んでおき、戻るで一番上のものを閉じる。
// 一覧に戻ったら積んだ分を消す（でないと、一覧で戻るを2回押さないとアプリが閉じない）
const OVERLAYS = [
  ['#cardInfo', el => el.classList.contains('open'), () => $('#cardInfo').classList.remove('open')],
  ['#menu', el => el.classList.contains('open'), () => $('#menu').classList.remove('open')],
  ['#addpop', el => !el.hidden, () => $('#addpop').click()],
  ['#customPage', el => el.classList.contains('open'), () => $('#cp-back').click()],
  ['#askPanel', el => !el.hidden, () => $('#ask-close').click()],
  ['#bprev', el => !el.hidden, () => $('#bprev .back').click()],
  ['#browse', el => !el.hidden, () => $('#browse > .pnav .back').click()],
  ['#awpage', el => !el.hidden, () => $('#awpage .back').click()],
  ['#prefs', el => !el.hidden, () => $('#prefs .back').click()],
];
function setupBack() {
  if (window.webkit?.messageHandlers?.sa) return;
  document.body.classList.add('noshell'); // 殻の外＝スマホなど（Pencil が無い）
  const top = () => OVERLAYS.find(([q, open]) => { const el = $(q); return el && open(el); });
  const atRoot = () => document.body.dataset.view === 'decks' && !top();
  let skip = false, t = null;
  const sync = () => {
    if (atRoot()) { if (history.state?.sa) { skip = true; history.back(); } }
    else if (!history.state?.sa) history.pushState({ sa: 1 }, '');
  };
  addEventListener('popstate', () => {
    if (skip) { skip = false; return; }
    const o = top(); if (o) o[2](); else if (document.body.dataset.view === 'study') showDecks();
    setTimeout(sync, 0);
  });
  const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(sync, 50); });
  mo.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
  for (const [q] of OVERLAYS) { const el = $(q); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden', 'class'] }); }
}
setupTools();
setupBack();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
load().catch(e => { $('#status').textContent = '読み込みに失敗: ' + e.message; });
