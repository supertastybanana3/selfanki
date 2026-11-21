// 新規カードの位置を変える（ブラウザの「並び替える」）。Anki 25.09.4 rslib scheduler/new.rs の sort_cards と同じ:
//   既存のカードをずらす（shift）なら、先に「位置が開始位置以上の新規カード」を (間隔 × 選んだ枚数) だけ後ろへ
//   選んだカードはノートごとに、選んだ順（ランダムならノートを混ぜた順）に 開始位置, 開始位置+間隔, … の位置にする
// 暗記のカードは、フィルターデッキの中なら due に元の位置（Anki の odue）、dynDue にフィルターデッキの中の due を持つ
const isNew = c => c.type === 0;
// Anki の card.due（フィルターデッキの中なら、その中の due）
const ankiDue = c => (c.inDyn ? c.dynDue ?? c.due : c.due);
// set_new_position: 新規ならその位置へ（フィルターデッキの中なら元の位置のほう）。種類は新規でなくても queue が新規なら due へ
function setNewPosition(c, pos, out) {
  if (isNew(c)) { out.set(c.id, c.inDyn ? { due: pos } : { due: pos }); return true; }
  if (c.queue === 0) { out.set(c.id, c.inDyn ? { dynDue: pos } : { due: pos }); return true; }
  return false;
}
export function repositionNew(selected, allCards, { start, step, random = false, shift = false }, rand = Math.random) {
  const out = new Map();   // id → 変える値（{due} か {dynDue}）
  if (shift) {
    const by = step * selected.length;
    for (const c of allCards) if (isNew(c) && ankiDue(c) >= start) setNewPosition(c, ankiDue(c) + by, out);
  }
  const nids = [];
  if (random) {
    const set = [...new Set(selected.map(c => c.nid))];
    for (let i = set.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [set[i], set[j]] = [set[j], set[i]]; }
    nids.push(...set);
  } else { const seen = new Set(); for (const c of selected) if (!seen.has(c.nid)) { seen.add(c.nid); nids.push(c.nid); } }
  const pos = new Map(nids.map((nid, i) => [nid, i * step + start]));
  let count = 0;
  for (const c of selected) if (setNewPosition(c, pos.get(c.nid) ?? 0, out)) count++;
  return { changes: out, count };
}
