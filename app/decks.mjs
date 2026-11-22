// デッキの作成・名前変更・削除（端末の上で、Anki 25.09.4 と同じ結果になるようになぞる）
// rslib decks/name.rs（名前の正規化・重なったら「+」）・decks/addupdate.rs（親を合わせる・足りない親を作る・子の名前も変える）・decks/remove.rs（子も消す・既定のデッキは名前を戻すだけ）
// デッキの名前は「A::B」の形で持つ（Anki の中では \x1f 区切り）。名前の比べ方は Anki と同じく大文字小文字を区別しない（unicase）

// Rust の char::is_whitespace と同じ空白（JS の \s とは \u0085 と ﻿ が違う）と「:」を、名前の部品の両端から取る
const EDGE = '[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000:]+';
const TRIM = new RegExp(`^${EDGE}|${EDGE}$`, 'gu');
// 部品ひとつ（normalized_deck_name_component）: NFC にして、ASCII の制御文字を消し、両端の空白と「:」を取る。空なら blank
export function normComponent(c) {
  let o = String(c).normalize('NFC').replace(/[\x00-\x1f\x7f]/g, '');
  o = o.replace(TRIM, '');
  return o === '' ? 'blank' : o;
}
// 人の書いた名前（「::」区切り）を Anki と同じ形に（NativeDeckName::from_human_name）
export const normalizeName = human => String(human ?? '').split('::').map(normComponent).join('::');
// Anki は名前を unicase（大文字小文字を区別しない）で比べる
export const fold = s => String(s).toUpperCase().toLowerCase();
const parentOf = name => { const i = name.lastIndexOf('::'); return i < 0 ? null : name.slice(0, i); };

// W: 作業用のデッキの一覧 [{ id, name, dyn }]（書き換えながらなぞる）
const byName = (W, name) => W.find(d => fold(d.name) === fold(name));
function firstExistingParent(W, name, level = 0) {
  if (level >= 11) throw new Error('deck nesting level too deep');
  const p = parentOf(name); if (p == null) return null;
  return byName(W, p) || firstExistingParent(W, p, level + 1);
}
function createMissingParents(W, name, newId, made) {
  let m = name;
  for (let p = parentOf(m); p != null; m = p, p = parentOf(m)) if (!byName(W, p)) { const d = { id: newId(), name: p, dyn: 0, created: true }; W.push(d); made.push(d.id); }
}
// 親を合わせる（match_or_create_parents）。いちばん近い今ある親の名前の書き方（大文字小文字）に合わせ、足りない親を作る
function matchOrCreateParents(W, deck, newId, made) {
  const comps = deck.name.split('::');
  const p = firstExistingParent(W, deck.name);
  if (p) {
    if (p.dyn) throw new DeckError('フィルターデッキの下にはデッキを作れません。');
    const pc = p.name.split('::').length;
    deck.name = p.name + '::' + comps.slice(pc).join('::');
    if (pc !== comps.length - 1) createMissingParents(W, deck.name, newId, made);
  } else if (comps.length > 1) createMissingParents(W, deck.name, newId, made);
}
// 名前が重なったら後ろに「+」を足していく（ensure_deck_name_unique）
function ensureUnique(W, deck) { while (W.some(d => d.id !== deck.id && fold(d.name) === fold(deck.name))) deck.name += '+'; }
export class DeckError extends Error {}

// 作業用の一覧を作り、なぞったあとの差（作ったもの・名前が変わったもの・消したもの）を返す
function diff(before, W) {
  const old = new Map(before.map(d => [d.id, d.name])), now = new Map(W.map(d => [d.id, d]));
  const created = W.filter(d => !old.has(d.id)).map(d => ({ id: d.id, name: d.name }));
  const renamed = W.filter(d => old.has(d.id) && old.get(d.id) !== d.name).map(d => ({ id: d.id, name: d.name, from: old.get(d.id) }));
  const removed = before.filter(d => !now.has(d.id)).map(d => ({ id: d.id, name: d.name }));
  return { created, renamed, removed };
}
const work = decks => decks.map(d => ({ id: d.id, name: d.name, dyn: d.dyn ? 1 : 0 }));
// 新しい id（Anki のデッキの id と同じく、ミリ秒の時刻。今ある id と重ならないように）
function idMaker(decks) { const used = new Set(decks.map(d => d.id)); let t = Date.now(); return () => { while (used.has(t)) t++; used.add(t); return t++; }; }

// デッキを作る（add_deck_inner）。返すのは { created, renamed, removed, id }
export function planAdd(decks, humanName) {
  const W = work(decks), newId = idMaker(decks), made = [];
  const deck = { id: newId(), name: normalizeName(humanName), dyn: 0 };
  ensureUnique(W, deck);
  matchOrCreateParents(W, deck, newId, made);
  W.push(deck);
  return { ...diff(decks, W), id: deck.id };
}
// 名前を変える（update_deck_inner）。子のデッキの名前も一緒に変わる
export function planRename(decks, did, humanName) {
  const W = work(decks), newId = idMaker(decks), made = [];
  const deck = W.find(d => d.id === did); if (!deck) throw new DeckError('デッキがありません。');
  const original = deck.name, cand = { id: did, name: normalizeName(humanName), dyn: deck.dyn };
  ensureUnique(W, cand);
  if (cand.name === original) return { created: [], renamed: [], removed: [] };
  matchOrCreateParents(W, cand, newId, made);
  // 子（rename_child_decks: 前の名前の下にあったデッキ）は、頭の部分を新しい名前に付け替える
  const pre = fold(original + '::');
  for (const c of W) if (c.id !== did && fold(c.name).startsWith(pre)) c.name = cand.name + c.name.slice(original.length);
  deck.name = cand.name;
  createMissingParents(W, deck.name, newId, made);
  return diff(decks, W);
}
// デッキを消す（remove_decks_and_child_decks）。子も消える。既定のデッキ（id 1）は消えずに名前が既定の名前に戻る
export function planRemove(decks, did, defaultName = 'デフォルト') {
  const W = work(decks), deck = W.find(d => d.id === did); if (!deck) throw new DeckError('デッキがありません。');
  const pre = fold(deck.name + '::'), targets = [deck, ...W.filter(c => c.id !== did && fold(c.name).startsWith(pre))];
  const gone = new Set(), reset = [];
  for (const t of targets) { if (t.id === 1) reset.push(t); else gone.add(t.id); }
  const W2 = W.filter(d => !gone.has(d.id));
  for (const t of reset) { const d = W2.find(x => x.id === 1); d.name = defaultName; ensureUnique(W2, d); }
  return { ...diff(decks, W2), emptied: targets.map(t => t.id) };   // emptied＝カードが消えるデッキ（既定のデッキも含む）
}

// ---------- 端末での記録と画面 ----------
// 記録はオプションと同じ conf 表に、デッキごとに1行（k＝'dname:<デッキの id>'）。中身は「そのデッキの今の姿」:
//   { name }                       … 名前（変えた）
//   { name, created: 1 }           … この端末で作ったデッキ（束にはまだ無い）
//   { name, removed: 1 [, created: 1] } … 消した（カードと、カードが無くなったノートも Anki で消える）
//   { name, cleared: rev }         … 既定のデッキ（id 1）を消した＝消えずに名前が戻り、そのとき入っていたカード（id < rev）が消える
// 束（Anki から配ったデッキ）のほうが新しければ（記録の rev ≦ 束のデッキの mod × 1000）、束に従う
export function createDecks(env) {
  const { S } = env;
  const base = new Map();     // 束のデッキ: id → { obj, name, mod }
  const recs = new Map();     // id → { v, rev }
  const local = new Map();    // この端末で作ったデッキ: id → デッキ（束の形に合わせた入れ物）
  function reset() {
    base.clear(); recs.clear(); local.clear();
    for (const d of S.meta.decks) base.set(d.id, { obj: d, name: d.name, mod: d.mod || 0 });
  }
  const effective = did => { const r = recs.get(did), b = base.get(did); if (!r) return null; if (b && r.rev <= b.mod * 1000) return null; if (!b && !r.v.created) return null; return r; };
  const newDeckObj = (did, r) => ({ id: did, mod: Math.floor(r.rev / 1000), name: r.v.name, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
    collapsed: false, browserCollapsed: false, desc: '', dyn: 0, conf: 1, extendNew: 0, extendRev: 0, reviewLimit: null, newLimit: null, reviewLimitToday: null, newLimitToday: null, desiredRetention: null, local: true });
  // 記録から、デッキの一覧（S.meta.decks）と id の表（S.decksById。消したデッキも、カードから引けるように残す）を作り直す
  function rebuild() {
    const list = [];
    for (const [did, b] of base) {
      const r = effective(did), d = b.obj;
      d.gone = !!(r?.v.removed && did !== 1); d.cleared = r?.v.cleared || 0;
      d.name = r ? r.v.name : b.name;
      S.decksById.set(did, d); if (!d.gone) list.push(d);
    }
    for (const [did, r] of recs) {
      if (base.has(did) || !r.v.created) continue;
      let d = local.get(did); if (!d) local.set(did, d = newDeckObj(did, r));
      d.name = r.v.name; d.gone = !!r.v.removed;
      S.decksById.set(did, d); if (!d.gone) list.push(d);
    }
    S.meta.decks = list;
  }
  // 記録を重ねる（同期で届いたもの・この端末で作ったもの）。新しいものだけを使う
  function applyRows(rows) {
    let changed = false;
    for (const { k, v, rev } of rows) {
      const did = +k.slice(6), cur = recs.get(did);
      if (cur && cur.rev > rev) continue;
      recs.set(did, { v, rev }); changed = true;
    }
    if (changed) rebuild();
    return changed;
  }
  // そのカードを隠すか（消したデッキのカード・既定のデッキを消したときに入っていたカード）
  const hides = c => { const d = S.decksById.get(c.did); return !!d && (d.gone || (d.cleared > 0 && c.id < d.cleared)); };
  const rev0 = ids => Math.max(Date.now(), ...ids.map(id => (recs.get(id)?.rev || 0) + 1), ...ids.map(id => ((base.get(id)?.mod ?? -1) + 1) * 1000));
  const isLocal = did => !base.has(did);
  // 計画（plan*）を記録にして書く。元に戻す用に、前の記録を覚えておく
  // フィルターデッキ（S.fdecks・conf の fdeck:<id>。Anki には書かない）は、名前を変えるなら fdeck の name を、消すなら deleteFDeck（中のカードを元のデッキに戻してから消す）
  const fids = () => new Set(env.fdecks().map(f => f.id));
  async function commit(plan, label, extra = {}) {
    const F = fids(), fren = plan.renamed.filter(x => F.has(x.id)), frem = plan.removed.filter(x => F.has(x.id));
    plan = { created: plan.created, renamed: plan.renamed.filter(x => !F.has(x.id)), removed: plan.removed.filter(x => !F.has(x.id)) };
    const ids = [...plan.created.map(x => x.id), ...plan.renamed.map(x => x.id), ...plan.removed.map(x => x.id), ...(extra.cleared || [])];
    if (!ids.length && !fren.length && !frem.length) return null;
    const rev = rev0(ids), rows = [], items = [];
    for (const x of frem) await env.deleteFDeck(x.id);   // Anki と同じく、消すデッキの下のフィルターデッキは、カードを戻してから消す（これは元に戻せない）
    for (const x of fren) { items.push({ fdeck: x.id, prev: x.from }); await env.renameFDeck(x.id, x.name, rev); }
    const cur = id => effective(id)?.v;
    for (const x of plan.created) rows.push({ k: 'dname:' + x.id, v: { name: x.name, created: 1 }, rev });
    for (const x of plan.renamed) { const p = cur(x.id) || {}; rows.push({ k: 'dname:' + x.id, v: { ...p, name: x.name, ...(isLocal(x.id) ? { created: 1 } : {}) }, rev }); }
    for (const x of plan.removed) rows.push({ k: 'dname:' + x.id, v: { name: x.name, removed: 1, ...(isLocal(x.id) ? { created: 1 } : {}) }, rev });
    for (const id of extra.cleared || []) { const r = rows.find(y => y.k === 'dname:' + id); const name = r ? r.v.name : S.decksById.get(id).name; if (r) r.v.cleared = rev; else rows.push({ k: 'dname:' + id, v: { ...(cur(id) || {}), name, cleared: rev }, rev }); }
    for (const r of rows) { const id = +r.k.slice(6); items.push({ did: id, prev: recs.has(id) ? structuredClone(recs.get(id)) : null }); }
    if (rows.length) await env.commitConf(rows);
    env.pushUndo({ kind: 'deck', label, items });
    return rows;
  }
  // 元に戻す: 前の記録の中身を、新しい rev で書き直す（前に記録が無ければ、束の名前に戻す・作ったデッキなら消す）
  async function undo(entry) {
    const rev = rev0(entry.items.filter(x => x.did != null).map(x => x.did)), rows = [];
    for (const { did, prev, fdeck } of entry.items) {
      if (fdeck != null) { if (env.fdecks().some(f => f.id === fdeck)) await env.renameFDeck(fdeck, prev, rev); continue; }
      let v;
      if (prev && (base.has(did) ? prev.rev > base.get(did).mod * 1000 : prev.v.created)) v = prev.v;
      else if (base.has(did)) v = { name: base.get(did).name };
      else v = { name: recs.get(did)?.v.name ?? '', removed: 1, created: 1 };
      rows.push({ k: 'dname:' + did, v, rev });
    }
    if (rows.length) await env.commitConf(rows);
  }
  const names = () => [...S.meta.decks.map(d => ({ id: d.id, name: d.name, dyn: 0 })), ...env.fdecks().map(f => ({ id: f.id, name: f.name, dyn: 1 }))];
  const deckOf = did => S.meta.decks.find(d => d.id === did) || env.fdecks().find(f => f.id === did);
  const humanErr = e => (e instanceof DeckError ? e.message : String(e?.message || e));
  // 空のデッキを作る（Anki の「デッキを作成」と同じく、同じ名前のデッキがあればそれを使う＝何も作らない）
  async function create() {
    const r = await env.prompt({ title: 'デッキを作成', message: '新しいデッキ名', input: '' });
    const name = r?.value?.trim(); if (!name) return;
    const want = normalizeName(name);
    if (names().some(d => fold(d.name) === fold(want))) return;
    let plan; try { plan = planAdd(names(), name); } catch (e) { env.alert('エラー', humanErr(e)); return; }
    await commit(plan, 'デッキの追加');
    for (const x of plan.created) S.open.add(x.id);   // 新しいデッキは開いた状態（Anki の collapsed: false）
    env.saveOpen(); env.done();
  }
  async function rename(did) {
    const d = deckOf(did); if (!d) return;
    const r = await env.prompt({ title: 'デッキ名の変更', message: '新しいデッキ名', input: d.name });
    const name = r?.value; if (!name || name === d.name) return;
    let plan; try { plan = planRename(names(), did, name); } catch (e) { env.alert('エラー', humanErr(e)); return; }
    await commit(plan, 'デッキ名の変更');
    for (const x of plan.created) S.open.add(x.id); env.saveOpen();
    env.done();
  }
  // 消したら消えるカード（デッキとその子のデッキのカード。既定のデッキは名前が戻るだけでカードは消える）
  const cardsIn = ids => S.cards.filter(c => ids.has(c.did));
  async function remove(did) {
    const d = deckOf(did); if (!d) return;
    const ok = await env.prompt({ title: 'デッキを削除', message: `${d.name} を削除しますか？`, ok: '削除', danger: true });
    if (!ok) return;
    if (fids().has(did)) { await env.deleteFDeck(did); env.done(`デッキ「${d.name}」（カード0枚）を削除しました`); return; }   // フィルターデッキ: カードは元のデッキに戻る（rslib remove_single_deck は 0 枚と数える）
    const plan = planRemove(names(), did, env.defaultName());
    const ids = new Set(plan.emptied), n = cardsIn(ids).length;
    await commit(plan, 'デッキを削除', { cleared: plan.emptied.filter(x => x === 1) });
    if (S.lastDeck != null && !S.meta.decks.some(x => x.id === S.lastDeck)) S.lastDeck = 1;
    env.done(`デッキ「${d.name}」（カード${n}枚）を削除しました`);
  }
  return { reset, applyRows, rebuild, hides, create, rename, remove, undo, recs, base };
}

// ---------- デッキの一覧の行を左へスワイプ（iOS の表と同じ）: 右から「エクスポート」「名前変更」「削除」が出る ----------
const ACTS = [['export', 'エクスポート', false], ['rename', '名前変更', false], ['delete', '削除', false]];
export function attachSwipe(row, { onAct, isOpen, setOpen }) {
  const acts = document.createElement('div'); acts.className = 'acts';
  for (const [k, label, disabled] of ACTS) { const b = document.createElement('button'); b.className = 'act-' + k; b.textContent = label; b.disabled = disabled; b.onclick = e => { e.stopPropagation(); setOpen(null); onAct(k); }; acts.append(b); }
  row.append(acts);
  const W = () => acts.offsetWidth || 240;
  let x0 = null, y0 = 0, start = 0, dx = 0, dragging = false, pid = null;
  const set = (x, anim) => { row.style.transition = anim ? 'transform .25s ease' : 'none'; row.style.transform = x ? `translateX(${-x}px)` : ''; };
  row.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.acts')) return;
    x0 = e.clientX; y0 = e.clientY; start = isOpen() ? W() : 0; dx = start; dragging = false; pid = e.pointerId;
  });
  row.addEventListener('pointermove', e => {
    if (x0 == null || e.pointerId !== pid) return;
    const mx = x0 - e.clientX, my = Math.abs(e.clientY - y0);
    if (!dragging) { if (Math.abs(mx) < 8 || my > Math.abs(mx)) { if (my > 10) x0 = null; return; } dragging = true; setOpen(row); try { row.setPointerCapture(pid); } catch {} }
    dx = Math.max(0, Math.min(W() * 1.15, start + mx)); set(dx, false);
  });
  const end = e => {
    if (x0 == null || e.pointerId !== pid) return;
    x0 = null;
    if (!dragging) return;
    row.dataset.swiped = '1'; setTimeout(() => { delete row.dataset.swiped; }, 0);
    const open = dx > W() / 2; set(open ? W() : 0, true); setOpen(open ? row : null);
  };
  row.addEventListener('pointerup', end); row.addEventListener('pointercancel', end);
  // ドラッグのあとの click（デッキを開く・＋−）を止める。開いているときに行を押したら閉じるだけ
  row.addEventListener('click', e => { if (row.dataset.swiped || (isOpen() && !e.target.closest('.acts'))) { e.stopPropagation(); e.preventDefault(); if (!row.dataset.swiped) setOpen(null); } }, true);
  return { close: () => set(0, true), open: () => set(W(), true) };
}
