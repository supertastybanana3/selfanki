// フィルターデッキ（Anki 25.09.4 rslib scheduler/filtered/{mod,card}.rs・storage/card/filtered.rs・
// states/{preview_filter,rescheduling_filter}.rs・answering/preview.rs の写し）
// 暗記ではカードを動かさず、カードの data.flt = {d: デッキの id, due: その中での due, q: その中での queue} で「中にある」ことを表す。
// card.due・queue などは元のデッキの値（Anki の odue・元の queue）のまま
import { fnvhash, fsrsRelativeRetrievability, intersperse } from './queue.mjs';
import { learningFuzzSecs, roundPlaces } from './sched.mjs';

// 並び順（proto decks.proto Filtered.SearchTerm.Order と同じ番号）。名前は Anki の日本語
export const ORDER_LABELS = ['前回表示日時が古い順', '無作為', '間隔が小さい順', '間隔が大きい順', '復習での忘却回数が多い順', '追加した順', '復習期日が古い順', '追加時期が新しい順', '正答可能性が低い順', '正答可能性が高い順'];
export const ORDER = { OLDEST_REVIEWED_FIRST: 0, RANDOM: 1, IVL_ASC: 2, IVL_DESC: 3, LAPSES: 4, ADDED: 5, DUE: 6, REVERSE_ADDED: 7, RETR_ASC: 8, RETR_DESC: 9 };

// カードが今いる（消していない）フィルターデッキの印。fdecks は id → 定義（removed なら消したデッキ）
export function fltIn(fdecks, c) {
  const f = c?.data?.flt; if (!f) return null;
  const d = fdecks?.get(f.d); return d && !d.removed ? f : null;
}

// 新しいフィルターデッキの既定（decks/filtered.rs new_filtered・filtered/mod.rs new_filtered_deck_for_adding）
export function newFilteredDeck(currentDeckName, nowDate = new Date()) {
  const hh = String(nowDate.getHours()).padStart(2, '0'), mm = String(nowDate.getMinutes()).padStart(2, '0');
  const ds = currentDeckName ? deckSearch(currentDeckName) : '';
  return {
    name: `Filtered Deck ${hh}:${mm}`,
    terms: [{ search: ds ? `${ds} is:due` : '', limit: 100, order: ORDER.RANDOM }, { search: ds ? `${ds} is:new` : '', limit: 20, order: ORDER.DUE }],
    second: false, resched: true, previewAgain: 60, previewHard: 600, previewGood: 0,
  };
}
// search/writer.rs deck_search: deck:"名前"（" と \ と * _ をエスケープ）
export function deckSearch(name) {
  const esc = String(name).replace(/[\\"]/g, m => '\\' + m).replace(/\*/g, '\\*').replace(/_/g, '\\_');
  return `deck:"${esc}"`;
}

// storage/card/filtered.rs order_and_limit_for_search の並び（最後に fnvhash(c.id, c.mod)）。SQL と同じく NULL は小さいものとして扱う
export function orderComparator(order, { today, nextDayAt, now, fsrs, lastReview, rand = Math.random }) {
  const num = (a, b) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : 1);
  const mod = c => c.mod ?? Math.floor((c.rev ?? 0) / 1000);
  const hk = new Map(), rk = new Map();
  const hash = c => { let k = hk.get(c.id); if (k === undefined) { k = fnvhash(c.id, mod(c)); hk.set(c.id, k); } return k; };
  const rnd = c => { let k = rk.get(c.id); if (k === undefined) { k = rand(); rk.set(c.id, k); } return k; };
  const asc = f => (a, b) => num(f(a), f(b)), desc = f => (a, b) => num(f(b), f(a));
  const retr = c => (fsrs ? fsrsRelativeRetrievability(c, today, nextDayAt, now)
    : (c.queue === 2 && c.due <= today ? c.ivl / (today - c.due + 0.001) : 100000 + c.due));   // SQLite の REAL（倍精度）
  const keys = {
    0: [asc(c => lastReview(c.id))],
    1: [asc(rnd)],
    2: [asc(c => c.ivl)],
    3: [desc(c => c.ivl)],
    4: [desc(c => c.lapses)],
    5: [asc(c => c.nid), asc(c => c.ord)],
    6: [asc(c => (c.due > 1000000000 ? c.due : (c.due - today) * 86400 + now)), asc(c => c.ord)],
    7: [desc(c => c.nid), asc(c => c.ord)],
    8: [asc(retr)],
    9: [desc(retr)],
  }[order] || [asc(rnd)];
  keys.push((a, b) => { const x = hash(a), y = hash(b); return x < y ? -1 : x > y ? 1 : 0; });
  return (a, b) => { for (const k of keys) { const r = k(a, b); if (r) return r; } return 0; };
}

// 組む（filtered/mod.rs build_filtered_deck・move_cards_matching_term・card.rs move_into_filtered_deck）
// matcher(search) は「(検索) -is:suspended -is:buried -deck:filtered」に当たるかの関数を返す（呼んだ時点の flt を見ること）
// 返り値: [{ card, flt }]（入る順）。カードの書き換えは呼んだ側がする（1つ目の条件で入ったものを2つ目から外すため、ここで flt を入れていく）
export function buildFiltered(id, def, cards, { matcher, today, nextDayAt, now, fsrs, lastReview, rand }) {
  const out = []; let position = -100000;
  const terms = (def.second ? def.terms.slice(0, 2) : def.terms.slice(0, 1));
  for (const term of terms) {
    const q = `${term.search.trim() ? `(${term.search})` : ''} -is:suspended -is:buried -deck:filtered`;
    const pred = matcher(q);
    const hits = cards.filter(pred).sort(orderComparator(term.order, { today, nextDayAt, now, fsrs, lastReview, rand })).slice(0, Math.max(0, term.limit | 0));
    for (const c of hits) {
      const flt = { d: id, due: c.due > 0 ? position : c.due, q: def.resched ? c.queue : 2 };
      c.data = { ...(c.data || {}), flt };   // 2つ目の条件の -deck:filtered で外れるように、すぐ入れる
      out.push({ card: c, flt });
      position++;
    }
  }
  return out;
}

// そのデッキを開いたときの並び（queue builder。フィルターデッキは既定の並び・上限なし・兄弟の埋めなし）
// 返り値は buildQueues と同じ形（learning・main・counts・learnAheadSecs）。並びに使う due・queue は flt のもの
export const fq = c => c.data?.flt?.q ?? c.queue;
export const fdue = c => c.data?.flt?.due ?? c.due;
export function filteredQueues(id, cards, { today, nextDayAt, learnAheadSecs = 1200 }) {
  const inDeck = cards.filter(c => c.data?.flt?.d === id && c.queue >= 0);
  const learning = inDeck.filter(c => (fq(c) === 1 || fq(c) === 4) && fdue(c) < nextDayAt).sort((a, b) => fdue(a) - fdue(b) || a.id - b.id);
  const mod = c => c.mod ?? Math.floor((c.rev ?? 0) / 1000);
  const byDue = (a, b) => fdue(a) - fdue(b) || (fnvhash(a.id, mod(a)) < fnvhash(b.id, mod(b)) ? -1 : 1);
  const dayLearn = inDeck.filter(c => fq(c) === 3 && fdue(c) <= today).sort(byDue);
  const reviews = inDeck.filter(c => fq(c) === 2 && fdue(c) <= today).sort(byDue);
  const newCards = inDeck.filter(c => fq(c) === 0).sort((a, b) => fdue(a) - fdue(b) || a.id - b.id);
  const main = intersperse(intersperse(reviews, dayLearn), newCards);
  return { learning, main, counts: { new: newCards.length, learn: learning.length + dayLearn.length, review: reviews.length }, learnAheadSecs, filtered: id };
}
// 次に出すカード（queue.mjs nextCard と同じ決まりを、flt の due で）
export function nextFilteredCard(q, now) {
  const dueLearn = q.learning.find(c => fdue(c) <= now);
  if (dueLearn) return { card: dueLearn, from: 'learning' };
  if (q.main.length) return { card: q.main[0], from: 'main' };
  const ahead = q.learning.find(c => fdue(c) <= now + q.learnAheadSecs);
  if (ahead) return { card: ahead, from: 'learning' };
  return null;
}

// 再スケジュールするデッキで答えたあと（rescheduling_filter.rs maybe_wrap・answering/mod.rs apply_study_state）:
// 次の状態が復習なら元のデッキへ（remove_from_filtered_deck_before_reschedule）、学習中・再学習中なら残る（original_due = due）
export function afterRescheduling(card, nextKind) {
  const flt = card.data?.flt; if (!flt) return card;
  if (nextKind === 'review') { const data = { ...card.data }; delete data.flt; return { ...card, data }; }
  return { ...card, data: { ...card.data, flt: { ...flt, due: card.due, q: card.queue } } };
}

// プレビュー（再スケジュールしないデッキ。preview_filter.rs・answering/preview.rs）。もう一度・難しい・正解はその秒数後にまた出す（0 なら終わり）、簡単はいつも終わり
export const previewDelays = def => ({ 1: def.previewAgain ?? 60, 2: def.previewHard ?? 600, 3: def.previewGood ?? 0, 4: 0 });
// decay: FSRS がオンなら元のデッキのプリセットの decay（Anki は答える前に card.decay を入れて、プレビューでもそのまま保存する。answering/mod.rs card_state_updater）
export function answerPreview(card, rating, def, { nextDayAt, now, takenMillis = 0, answeredAtMs = now * 1000, decay = null }) {
  const secs = previewDelays(def)[rating], untilRollover = nextDayAt - now;
  const asIvl = s => (s >= untilRollover ? Math.floor((s - untilRollover) / 86400) + 1 : -s);
  const c = { ...card, data: { ...(card.data || {}) } };
  if (decay != null) c.data.decay = roundPlaces(decay, 3);
  if (secs === 0) delete c.data.flt;   // 終わり: 元のデッキへ（queue は元のまま＝restore_queue_from_type と同じ）
  else c.data.flt = { ...c.data.flt, q: 4, due: now + learningFuzzSecs(card.id, card.reps, secs) };
  const revlog = { id: answeredAtMs, cid: card.id, ease: rating, ivl: secs === 0 ? 0 : asIvl(secs), lastIvl: asIvl(previewDelays(def)[1]), factor: 0, time: takenMillis, type: 3 };
  return { card: c, revlog };
}

// 空にする（return_all_cards_in_filtered_deck・remove_from_filtered_deck_restoring_queue）: flt を消すだけ（queue・due は元のデッキの値のまま持っている）
export function emptiedCard(card) { const data = { ...(card.data || {}) }; delete data.flt; return { ...card, data }; }
