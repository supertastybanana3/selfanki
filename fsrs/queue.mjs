// その日に出すカードの集め方（Anki 25.09.4 rslib/src/scheduler/queue/builder/* の v3 を写したもの）
// 並び順のオプション（選んだデッキのプリセットの newGatherPriority・newSortOrder・reviewOrder・newMix・interdayLearningMix）、
// 上限の木（decks/limits.rs の LimitTreeMap。全体の設定 applyAllParentLimits なら、選んだデッキの親の上限も効かせる）、
// 「新規は復習の上限を無視」（newCardsIgnoreReviewLimit）に対応。並べる式は storage/card/mod.rs の SQL を写した
const DAY = 86400;
const sep = n => n.split('::').join('\x1f');
// デッキの名前の並び（decks の name は unicase＝大文字小文字を区別しない並び。ORDER BY name）
export const deckCmp = (a, b) => { const x = sep(a.name).toLowerCase(), y = sep(b.name).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; };

// FNV-1a を使った決まった並べ替え用の値
// Anki の SQL 関数 fnvhash（rslib storage/sqlite.rs: fnv クレートの FNV-1a 64 ビットに、引数を i64 のリトルエンディアン 8 バイトずつ入れ、i64 で返す）
export function fnvhash(...vals) {
  let h = 0xcbf29ce484222325n;
  for (const v of vals) { let x = BigInt.asUintN(64, BigInt(v)); for (let i = 0; i < 8; i++) { h ^= x & 0xffn; h = (h * 0x100000001b3n) & 0xffffffffffffffffn; x >>= 8n; } }
  return BigInt.asIntN(64, h);
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

// 上限の木（rslib decks/limits.rs）。子は作るときに親の残りで頭打ち、数を減らすと親もたどって減らし、0 になったらその下を頭打ちにする
function limitTree(decks, nodeLimits) {
  // decks は上から名前順（親が先）。それぞれの親は、木の中でいちばん近い先祖
  const nodes = new Map();
  for (const d of decks) {
    const parts = d.name.split('::');
    let parent = null;
    for (let k = parts.length - 1; k >= 1 && !parent; k--) parent = nodes.get(parts.slice(0, k).join('::')) || null;
    const lim = nodeLimits(d);
    if (parent) { lim.review = Math.min(lim.review, parent.lim.review); lim.new = Math.min(lim.new, parent.lim.new); }
    const n = { id: d.id, name: d.name, lim, parent, children: [] };
    if (parent) parent.children.push(n);
    nodes.set(d.name, n);
  }
  const byId = new Map([...nodes.values()].map(n => [n.id, n]));
  const root = nodes.get(decks[0].name);
  const cap = (n, l) => { n.lim.review = Math.min(n.lim.review, l.review); n.lim.new = Math.min(n.lim.new, l.new); for (const c of n.children) cap(c, l); };
  const decOne = (n, kind) => {
    const before = { ...n.lim };
    if (kind === 'rev') { n.lim.review = Math.max(n.lim.review - 1, 0); if (n.lim.capNew) n.lim.new = Math.min(n.lim.new, n.lim.review); }
    else n.lim.new = Math.max(n.lim.new - 1, 0);
    if ((before.review > 0 && n.lim.review === 0) || (before.new > 0 && n.lim.new === 0)) cap(n, { ...n.lim });
  };
  return {
    rootReached: kind => (kind === 'rev' ? root.lim.review : root.lim.new) === 0,
    reached: (did, kind) => { const n = byId.get(did); return !n || (kind === 'rev' ? n.lim.review : n.lim.new) === 0; },
    dec: (did, kind) => { for (let n = byId.get(did); n; n = n.parent) decOne(n, kind); },
  };
}

// 0〜2^32 の数（u32 として扱う）
const u32 = x => ((x % 4294967296) + 4294967296) % 4294967296;
const satSubU32 = (a, b) => Math.max(u32(a) - u32(b), 0);
// storage/sqlite.rs の extract_fsrs_relative_retrievability（引数の取り違えも含めて、そのとおりに）
export function fsrsRelativeRetrievability(c, today, nextDayAt, now) {
  const fr = Math.fround, due = c.due, ivl = c.ivl, d = c.data || {};
  const daysElapsed = due > 365000 ? Math.floor(satSubU32(nextDayAt, due) / DAY) : satSubU32(today, due - ivl);
  if (d.s != null && d.d != null && d.dr != null) {
    const desired = fr(Math.max(d.dr, 0.0001)), decay = fr(d.decay ?? 0.5);
    let secs;
    if (d.lrt != null) secs = u32(Math.max(now - d.lrt, 0));
    else if (due > 365000) secs = u32(Math.max(now - (due - today), 0));
    else secs = u32(Math.max(ivl - (due - today), 0) * DAY);
    const factor = fr(fr(Math.pow(0.9, fr(1 / -decay))) - 1);
    const r = Math.max(fr(Math.pow(fr(fr(fr(fr(secs / 86400) / fr(d.s)) * factor) + 1), -decay)), 0.0001);
    return fr(-fr(fr(Math.pow(fr(r), fr(-1 / decay))) - 1) / fr(fr(Math.pow(desired, fr(-1 / decay))) - 1));
  }
  return fr(-fr(fr(daysElapsed) + fr(0.001)) / Math.max(fr(ivl), 1));
}

// 復習・日をまたぐ学習の並び（storage/card/mod.rs review_order_sql）。どの並びでも最後に fnvhash(id, mod)
// 返すのは比べる関数。SQL と同じく NULL（null）は小さいものとして扱う
function reviewComparator(order, fsrs, timing, now, deckRow) {
  const rk = new Map();
  const mod = c => c.mod ?? Math.floor((c.rev ?? 0) / 1000);
  const rand = c => { let k = rk.get(c.id); if (k === undefined) { k = fnvhash(c.id, mod(c)); rk.set(c.id, k); } return k; };
  const num = (a, b) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : 1);
  const asc = f => (x, y) => num(f(x), f(y)), desc = f => (x, y) => num(f(y), f(x));
  const dd = c => (c.data && c.data.d != null ? c.data.d : null);
  const rsm2 = c => (c.ivl ? -(1 + (timing.daysElapsed - c.due + 0.001) / c.ivl) : null);
  const rf = c => fsrsRelativeRetrievability(c, timing.daysElapsed, timing.nextDayAt, now);
  const keys = {
    0: [asc(c => c.due)],
    1: [asc(c => c.due), asc(deckRow)],
    2: [asc(deckRow), asc(c => c.due)],
    3: [asc(c => c.ivl)],
    4: [desc(c => c.ivl)],
    5: [fsrs ? desc(dd) : asc(c => c.factor)],
    6: [fsrs ? asc(dd) : desc(c => c.factor)],
    7: [asc(fsrs ? rf : rsm2)],
    11: [desc(fsrs ? rf : rsm2)],
    8: [],
    9: [asc(c => c.nid), asc(c => c.ord)],
    10: [desc(c => c.nid), asc(c => c.ord)],
  }[order] ?? [asc(c => c.due)];
  keys.push((x, y) => (rand(x) < rand(y) ? -1 : rand(x) > rand(y) ? 1 : 0));
  return (x, y) => { for (const k of keys) { const r = k(x, y); if (r) return r; } return x.id - y.id; };
}

// 2つの並びをつなぐ（ReviewMix: 0＝混ぜる・1＝後に・2＝先に）。混ぜるのは intersperse(主, 足すもの)
const mix = (mode, main, extra) => (mode === 1 ? [...main, ...extra] : mode === 2 ? [...extra, ...main] : intersperse(main, extra));
// 新規の並べ替え（queue/builder/sorting.rs sort_new）。種は今日の日数（FnvHasher に i64 を2つ）。比べるのは u64
const fnvU = (a, b) => BigInt.asUintN(64, fnvhash(a, b));
function sortNew(list, order, days) {
  if (order === 1) return list;   // 集めた順のまま
  if (order === 0) return list.sort((a, b) => a.ord - b.ord);   // テンプレート順（安定）
  const h = new Map(list.map(c => [c.id, fnvU(order === 3 ? c.nid : c.id, days)]));
  const ch = (a, b) => { const x = h.get(a.id), y = h.get(b.id); return x < y ? -1 : x > y ? 1 : 0; };
  if (order === 2) return list.sort((a, b) => a.ord - b.ord || ch(a, b));
  if (order === 3) return list.sort((a, b) => ch(a, b) || a.ord - b.ord);
  return list.sort(ch);
}

export function buildQueues({ selectedDid, decks, presets, cards, timing, now, counts, extend = new Map(), learnAheadSecs = 1200, newIgnoresReviewLimit = false, applyAllParentLimits = false, fsrs = true }) {
  const byId = new Map(decks.map(d => [d.id, d]));
  const root = byId.get(selectedDid);
  const isUnder = (d, top) => d.name === top.name || d.name.toLowerCase().startsWith(top.name.toLowerCase() + '::');
  const active = decks.filter(d => !d.dyn && isUnder(d, root)).sort(deckCmp);
  const activeIds = new Set(active.map(d => d.id));
  const preset = d => presets[d.conf] || presets[1];
  const opts = preset(root);
  // 上限の木に入れるデッキ: 全体の設定 applyAllParentLimits なら、選んだデッキの親（上から）も
  const parents = [];
  if (applyAllParentLimits) { const parts = root.name.split('::'); for (let k = 1; k < parts.length; k++) { const n = parts.slice(0, k).join('::'); const d = decks.find(x => x.name === n); if (d) parents.push(d); } }
  // デッキごとの上限（Anki のデッキのオプション「このデッキ」「今日だけ」）。無ければプリセットの1日の上限
  const lim = (d, k, base) => { const t = d[k + 'LimitToday']; if (t && t.today === timing.daysElapsed) return t.limit; return d[k + 'Limit'] ?? base; };
  const ignoreRev = !!newIgnoresReviewLimit;
  // カスタム学習で増やした分。applyAllParentLimits なら、子で増やした分は親の数も減らしている（decks/stats.rs extend_limits）
  const extOf = d => {
    if (!applyAllParentLimits) return extend.get(d.id) ?? { new: 0, rev: 0 };
    const o = { new: 0, rev: 0 }; for (const [did, e] of extend) { const x = byId.get(did); if (x && isUnder(x, d)) { o.new += e.new || 0; o.rev += e.rev || 0; } } return o;
  };
  const tree = limitTree([...parents, ...active], d => {
    const p = preset(d);
    // 子デッキで答えた分は親にも数える（Anki は答えるたびに親の「今日の数」も増やす）
    const c = { new: 0, rev: 0 };
    for (const [did, v] of counts) { const x = byId.get(did); if (x && isUnder(x, d)) { c.new += v.new; c.rev += v.rev; } }
    const ex = extOf(d);
    const newToday = c.new - ex.new, revToday = c.rev - ex.rev;
    let revLeft = lim(d, 'review', p.rev.perDay) - revToday, newLeft = lim(d, 'new', p.new.perDay) - newToday;
    if (!ignoreRev) { revLeft -= newToday; newLeft = Math.min(newLeft, revLeft); }   // rslib d_limits.rs RemainingLimits::new
    return { review: Math.max(0, revLeft), new: Math.max(0, newLeft), capNew: !ignoreRev };
  });

  const inActive = cards.filter(c => activeIds.has(c.did) && c.queue >= 0);
  // 兄弟の埋め（rslib queue/builder/burying.rs・gathering.rs）: 集めた順に、同じノートのカードを見たら、そのノートの埋め方（プリセットの
  // 新規・復習・日をまたぐ学習の「兄弟を埋める」を、それまでに見たカードの分だけ OR したもの）で、後から来たカードを出さない
  const buryMode = c => { const p = preset(byId.get(c.did) ?? { conf: 1 }); return { n: !!p.new?.bury, r: !!p.rev?.bury, i: !!p.buryInterdayLearning }; };
  const seen = new Map();
  const seenBefore = c => { const m = buryMode(c), prev = seen.get(c.nid); seen.set(c.nid, prev ? { n: prev.n || m.n, r: prev.r || m.r, i: prev.i || m.i } : m); return prev; };
  // 1) 今日中の学習（分単位）。埋めないが、そのノートの埋め方は覚える
  const learning = inActive.filter(c => c.queue === 1 && c.due < timing.nextDayAt).sort((a, b) => a.due - b.due || a.id - b.id);
  for (const c of learning) seenBefore(c);
  // 2) 日をまたぐ学習 → 3) 復習（並びはプリセットの reviewOrder。active_decks の並び＝名前順を「デッキ」の順に使う）
  const deckRowMap = new Map(active.map((d, i) => [d.id, i]));
  const cmp = reviewComparator(opts.reviewOrder ?? 0, fsrs, timing, now, c => deckRowMap.get(c.did));
  const gatherDue = (queue, kind) => {
    const out = [];
    if (tree.rootReached('rev')) return out;
    for (const c of inActive.filter(c => c.queue === queue && c.due <= timing.daysElapsed).sort(cmp)) {
      if (tree.rootReached('rev')) break;
      if (tree.reached(c.did, 'rev')) continue;
      if (seenBefore(c)?.[kind]) continue;
      out.push(c); tree.dec(c.did, 'rev');
    }
    return out;
  };
  const dayLearn = gatherDue(3, 'i');
  const reviews = gatherDue(2, 'r');
  // 4) 新規（プリセットの newGatherPriority）。乱数の種は knuth_salt(今日)
  const salt = u32(Math.imul(timing.daysElapsed, 2654435761) >>> 0);
  const gp = opts.newGatherPriority ?? 0;
  const posAsc = (a, b) => a.due - b.due || a.ord - b.ord || a.id - b.id;
  const posDesc = (a, b) => b.due - a.due || a.ord - b.ord || a.id - b.id;
  const fk = new Map(); const fh = (k, x) => { const key = k + ':' + x; let v = fk.get(key); if (v === undefined) { v = fnvhash(x, salt); fk.set(key, v); } return v; };
  const bi = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const rNotes = (a, b) => bi(fh('n', a.nid), fh('n', b.nid)) || a.ord - b.ord || a.id - b.id;
  const rCards = (a, b) => bi(fh('c', a.id), fh('c', b.id)) || a.id - b.id;
  const newCards = [];
  const allNew = inActive.filter(c => c.queue === 0);
  if (gp === 0 || gp === 5) {
    const byDeck = new Map(); for (const c of allNew) (byDeck.get(c.did) ?? byDeck.set(c.did, []).get(c.did)).push(c);
    for (const d of active) {
      if (tree.rootReached('new')) break;
      if (tree.reached(d.id, 'new')) continue;
      for (const c of (byDeck.get(d.id) ?? []).sort(gp === 0 ? posAsc : rNotes)) {
        if (tree.reached(d.id, 'new')) break;
        if (seenBefore(c)?.n) continue;
        newCards.push(c); tree.dec(d.id, 'new');
      }
    }
  } else {
    for (const c of allNew.sort(gp === 1 ? posAsc : gp === 2 ? posDesc : gp === 3 ? rNotes : rCards)) {
      if (tree.rootReached('new')) break;
      if (tree.reached(c.did, 'new')) continue;
      if (seenBefore(c)?.n) continue;
      newCards.push(c); tree.dec(c.did, 'new');
    }
  }
  sortNew(newCards, opts.newSortOrder ?? 0, timing.daysElapsed);
  // 混ぜる（日をまたぐ学習を復習に → それに新規を。intersperser.rs と sized_chain.rs）
  const main = mix(opts.newMix ?? 0, mix(opts.interdayLearningMix ?? 0, reviews, dayLearn), newCards);
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
