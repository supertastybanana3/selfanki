// 書き込みのデザインの見本（作者が使っているもの）。左下に道具の帯を置く: 一画戻す・消しゴム・色3つ・キーボードモード・全部消す。
// 表は白（ライトでは黒）、裏は赤で書く。iOS の殻があれば、Apple Pencil Pro のスクイーズで消しゴム、ダブルタップで一画戻す。
// 自分のデザインを作るときは、このフォルダを写して名前を変え、config.json の extras.pen_design にその名前を書く（app/designs/README.md）
const CSS = "#pentools{left:14px;bottom:14px;display:flex;gap:10px;align-items:center}\n#pentools button{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--st-plus);opacity:.9}\n#pentools button.on{background:color-mix(in srgb,var(--st-tab) 22%,transparent);outline:1.5px solid var(--st-tab)}\n#pentools .color::before{content:\"\";width:16px;height:16px;border-radius:50%;background:var(--c);display:block}\n@media (max-width:460px){#pentools{gap:6px;left:10px} #pentools button{width:34px;height:36px}}\n@media (max-width:599px){body.noshell #pentools{display:none}}\nbody.nopen #pentools{display:none}\n";
const MARKUP = "<button id=\"tool-undo\" title=\"一画戻す\"><svg class=\"ico\" viewBox=\"0 0 24 24\"><path d=\"M9 14 4 9l5-5\"/><path d=\"M4 9h10a6 6 0 0 1 0 12h-3\"/></svg></button>\n<button id=\"tool-eraser\" title=\"消しゴム（スクイーズでも切り替え）\"><svg class=\"ico\" viewBox=\"0 0 24 24\"><path d=\"M7.5 20h12\"/><path d=\"M15.2 4.3a1.6 1.6 0 0 1 2.3 0l3.2 3.2a1.6 1.6 0 0 1 0 2.3L11 19.5H7.3l-3.6-3.6a1.6 1.6 0 0 1 0-2.3z\"/><path d=\"m9.4 9.8 5.8 5.8\"/></svg></button>\n<button class=\"color\" data-c=\"\" style=\"--c:conic-gradient(var(--st-plus) 0 50%,#ff5a52 0)\" title=\"表は白（黒）・裏は赤\"></button>\n<button class=\"color\" data-c=\"#4a90e2\" style=\"--c:#4a90e2\" title=\"青\"></button>\n<button class=\"color\" data-c=\"#2eaa5c\" style=\"--c:#2eaa5c\" title=\"緑\"></button>\n<button id=\"tool-kbd\" title=\"キーボードモード（指で触れてもめくれない。キーボードをつなぐと自動で入る）\"><svg class=\"ico\" viewBox=\"0 0 24 24\"><rect x=\"2.5\" y=\"6\" width=\"19\" height=\"12\" rx=\"2\"/><path d=\"M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6 12.5h.01M9 12.5h.01M12 12.5h.01M15 12.5h.01M18 12.5h.01M8 15.2h8\"/></svg></button>\n<button id=\"tool-clear\" title=\"全部消す\"><svg class=\"ico\" viewBox=\"0 0 24 24\"><path d=\"M4 7h16\"/><path d=\"M9 7V4.5h6V7\"/><path d=\"M6.5 7l1 13h9l1-13\"/><path d=\"M10 11v5.5M14 11v5.5\"/></svg></button>";

export function mount(api) {
  const { pen, host } = api;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const bar = document.createElement('div'); bar.id = 'pentools'; bar.className = 'float'; bar.innerHTML = MARKUP; host.appendChild(bar);
  const $ = q => bar.querySelector(q);
  const paint = () => {
    $('#tool-eraser').classList.toggle('on', pen.state.tool === 'eraser');
    bar.querySelectorAll('.color').forEach(b => b.classList.toggle('on', pen.state.tool === 'pen' && pen.state.color === (b.dataset.c || null)));
  };
  pen.state.onChange = paint;
  $('#tool-undo').onclick = () => pen.undo();
  $('#tool-eraser').onclick = () => pen.toggleEraser();
  $('#tool-clear').onclick = () => pen.clear();
  $('#tool-kbd').onclick = () => api.keyboardMode.toggle();
  bar.querySelectorAll('.color').forEach(b => b.onclick = () => pen.setColor(b.dataset.c || null));
  paint();
  // 表と裏で墨の色を変える（明るさのテーマに合わせる）
  const ink = (side, dark) => (side === 'a' ? (dark ? '#ff5a52' : '#d0342c') : (dark ? '#f2f2f2' : '#1a1a1a'));
  return {
    onSide(side, dark) { pen.setSideColor(ink(side, dark)); },
    onSqueeze() { pen.toggleEraser(); },
    onTap() { pen.undo(); },
    onKeyboardMode(on) { $('#tool-kbd').classList.toggle('on', on); },
    keyboardMode: true,   // キーボードモード（キーボードで答えるあいだ、指で触れてもめくらない）を使う
  };
}
