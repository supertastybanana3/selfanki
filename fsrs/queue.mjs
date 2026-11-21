// その日に出すカードの集め方（Anki 25.09.4 rslib/src/scheduler/queue/builder/* の v3 を写したもの）
// 対応している設定: 新規の集め方＝デッキ順（位置の小さい順）、並び＝テンプレート順、復習＝期日順、
// 新規と復習は混ぜる、日をまたぐ学習は復習と混ぜる、新規は復習の上限にも数える（既定）、
// 上限は選んだデッキとその下だけ（applyAllParentLimits=false）。
const DAY = 86400;
const sep = n => n.split('::').join('\x1f');
export const deckCmp = (a, b) => { const x = sep(a.name), y = sep(b.name); return x < y ? -1 : x > y ? 1 : 0; };

// FNV-1a を使った決まった並べ替え用の値
// Anki の SQL 関数 fnvhash（rslib storage/sqlite.rs: fnv クレートの FNV-1a 64 ビットに、引数を i64 のリトルエンディアン 8 バイトずつ入れ、i64 で返す）
export function fnvhash(...vals) {
  let h = 0xcbf29ce484222325n;
  for (const v of vals) { let x = BigInt.asUintN(64, BigInt(v)); for (let i = 0; i < 8; i++) { h ^= x & 0xffn; h = (h * 0x100000001b3n) & 0xffffffffffffffffn; x >>= 8n; } }
  return BigInt.asIntN(64, h);
}
function hash32(n, salt) {
  let h = 0x811c9dc5; const s = `${n}:${salt}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

// 今日の分の数（デッキごと）を復習記録から数える
export function todayCounts(revlog, cardsById, dayStartMs) {
  const seen = new Set(); const firstNew = new Map(); const out = new Map();
  const bump = (did, k) => { const o = out.get(did) ?? { new: 0, rev: 0 }; o[k]++; out.set(did, o); };
  const sorted = [...revlog].sort((a, b) => a.id - b.id);
  for (const r of sorted) {
    const c = cardsById.get(r.cid); if (!c) continue;
    const isFirst = !seen.has(r.cid); seen.add(r.cid);
    if (r.id < dayStartMs) continue;
    if (isFirst && r.type === 0) bump(c.did, 'new');
    else if (r.type === 1 || ((r.type === 0 || r.type === 2) && r.lastIvl > 0)) bump(c.did, 'rev');   // 日をまたぐ学習・再学習（queue 3）を答えた分も、Anki は復習の数に足す（update_deck_stats_from_answer）
  }
  return out;
}

export function buildQueues({ selectedDid, decks, presets, cards, timing, now, counts, extend = new Map(), learnAheadSecs = 1200, newIgnoresReviewLimit = false }) {
  const byId = new Map(decks.map(d => [d.id, d]));
  const root = byId.get(selectedDid);
  const active = decks.filter(d => !d.dyn && (d.id === root.id || d.name.startsWith(root.name + '::'))).sort(deckCmp);
  const activeIds = new Set(active.map(d => d.id));
  const byName = new Map(decks.map(d => [d.name, d]));
  // 選んだデッキまでの親をたどる
  const chain = did => { const out = []; let d = byId.get(did); while (d) { out.push(d.id); if (d.id === root.id) break; const i = d.name.lastIndexOf('::'); d = i < 0 ? null : byName.get(d.name.slice(0, i)); } return out; };
  const preset = d => presets[d.conf] || presets[1];
  // デッキごとの上限（Anki のデッキのオプション「このデッキ」「今日だけ」）。無ければプリセットの1日の上限
  const lim = (d, k, base) => { const t = d[k + 'LimitToday']; if (t && t.today === timing.daysElapsed) return t.limit; return d[k + 'Limit'] ?? base; };
  // 「新規は復習の上限を無視」は全体の設定（rslib q_queue_builder_mod.rs は config の bool から読む）
  const ignoreRev = !!newIgnoresReviewLimit;
  const remaining = new Map();
  for (const d of active) {
    const p = preset(d);
    // 子デッキで答えた分は親にも数える（Anki は答えるたびに親の「今日の数」も増やす）
    const c = { new: 0, rev: 0 };
    for (const [did, v] of counts) { const dn = byId.get(did)?.name; if (dn && (dn === d.name || dn.startsWith(d.name + '::'))) { c.new += v.new; c.rev += v.rev; } }
    const ex = extend.get(d.id) ?? { new: 0, rev: 0 }; // カスタム学習で増やした分（そのデッキの「今日の数」から引く）
    const newToday = c.new - ex.new, revToday = c.rev - ex.rev;
    let revLeft = lim(d, 'review', p.rev.perDay) - revToday, newLeft = lim(d, 'new', p.new.perDay) - newToday;
    if (!ignoreRev) { revLeft -= newToday; newLeft = Math.min(newLeft, revLeft); }   // rslib d_limits.rs RemainingLimits::new
    remaining.set(d.id, { new: Math.max(0, newLeft), rev: Math.max(0, revLeft) });
  }
  // 親の残りで子を頭打ちにする
  for (const d of active) { const ch = chain(d.id); const r = remaining.get(d.id); for (const a of ch.slice(1)) { const ra = remaining.get(a); r.new = Math.min(r.new, ra.new); r.rev = Math.min(r.rev, ra.rev); } }
  const reached = (did, kind) => chain(did).some(a => { const r = remaining.get(a); return kind === 'new' ? (r.new <= 0 || (!ignoreRev && r.rev <= 0)) : r.rev <= 0; });
  const dec = (did, kind) => { for (const a of chain(did)) { const r = remaining.get(a); if (kind === 'new') { r.new--; if (!ignoreRev) r.rev--; } else r.rev--; } };

  const inActive = cards.filter(c => activeIds.has(c.did) && c.queue >= 0);
  // 兄弟の埋め（rslib queue/builder/burying.rs・gathering.rs）: 集めた順に、同じノートのカードを見たら、そのノートの埋め方（プリセットの
  // 新規・復習・日をまたぐ学習の「兄弟を埋める」を、それまでに見たカードの分だけ OR したもの）で、後から来たカードを出さない
  const buryMode = c => { const p = preset(byId.get(c.did) ?? { conf: 1 }); return { n: !!p.new?.bury, r: !!p.rev?.bury, i: !!p.buryInterdayLearning }; };
  const seen = new Map();
  const seenBefore = c => { const m = buryMode(c), prev = seen.get(c.nid); seen.set(c.nid, prev ? { n: prev.n || m.n, r: prev.r || m.r, i: prev.i || m.i } : m); return prev; };
  // 1) 今日中の学習（分単位）。埋めないが、そのノートの埋め方は覚える
  const learning = inActive.filter(c => c.queue === 1 && c.due < timing.nextDayAt).sort((a, b) => a.due - b.due || a.id - b.id);
  for (const c of learning) seenBefore(c);
  // 2) 日をまたぐ学習 → 3) 復習（期日順、同じ日は決まった乱数順）
  const salt = timing.daysElapsed;
  // 復習・日をまたぐ学習の並び（既定「期日→ランダム」）: ORDER BY due, fnvhash(id, mod)（rslib storage/card/mod.rs review_order_sql）。
  // 更新時刻（mod）は、無ければ状態の新しさ（rev＝更新時刻か最後の答えのミリ秒の遅いほう）から秒にして使う
  const rkey = new Map();
  const rk = c => { let k = rkey.get(c.id); if (k === undefined) { k = fnvhash(c.id, c.mod ?? Math.floor((c.rev ?? 0) / 1000)); rkey.set(c.id, k); } return k; };
  const dueOrder = (a, b) => a.due - b.due || (rk(a) < rk(b) ? -1 : rk(a) > rk(b) ? 1 : 0);
  const dayLearn = []; const reviews = [];
  for (const c of inActive.filter(c => c.queue === 3 && c.due <= timing.daysElapsed).sort(dueOrder)) {
    if (reached(c.did, 'rev')) continue; if (seenBefore(c)?.i) continue; dayLearn.push(c); dec(c.did, 'rev');
  }
  for (const c of inActive.filter(c => c.queue === 2 && c.due <= timing.daysElapsed).sort(dueOrder)) {
    if (reached(c.did, 'rev')) continue; if (seenBefore(c)?.r) continue; reviews.push(c); dec(c.did, 'rev');
  }
  // 4) 新規（デッキ順に、位置の小さい順）
  const newCards = [];
  const newByDeck = new Map();
  for (const c of inActive) if (c.queue === 0) (newByDeck.get(c.did) ?? newByDeck.set(c.did, []).get(c.did)).push(c);
  for (const d of active) {
    const list = (newByDeck.get(d.id) ?? []).sort((a, b) => a.due - b.due || a.ord - b.ord || a.id - b.id);
    for (const c of list) { if (reached(d.id, 'new')) break; if (seenBefore(c)?.n) continue; newCards.push(c); dec(d.id, 'new'); }
  }
  newCards.sort((a, b) => a.ord - b.ord); // テンプレート順（安定ソート）
  // 混ぜる（intersperser.rs と同じ割り振り）
  const main = intersperse(intersperse(reviews, dayLearn), newCards);
  return { learning, main, counts: { new: newCards.length, learn: learning.length + dayLearn.length, review: reviews.length }, learnAheadSecs };
}

// a の間に b を均等に差し込む
export function intersperse(a, b) {
  if (!b.length) return [...a]; if (!a.length) return [...b];
  // rslib queue/builder/intersperser.rs と同じ: ratio＝(a の数+1)/(b の数+1)（f32）。両方残っていれば (b の番号+1)×ratio < (a の番号+1) のとき b を出す
  const fr = Math.fround, out = []; const total = a.length + b.length; const ratio = fr(fr(a.length + 1) / fr(b.length + 1));
  let ai = 0, bi = 0;
  for (let i = 0; i < total; i++) {
    const wantB = bi < b.length && (ai >= a.length || fr(fr(bi + 1) * ratio) < fr(ai + 1));
    if (wantB) out.push(b[bi++]); else out.push(a[ai++]);
  }
  return out;
}

// 次に出すカード（学習中で期限が来ていればそれ、なければ本体、なければ先取り）
export function nextCard(q, now) {
  const dueLearn = q.learning.find(c => c.due <= now);
  if (dueLearn) return { card: dueLearn, from: 'learning' };
  if (q.main.length) return { card: q.main[0], from: 'main' };
  const ahead = q.learning.find(c => c.due <= now + q.learnAheadSecs);
  if (ahead) return { card: ahead, from: 'learning' };
  return null;
}
