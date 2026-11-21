// アプリ側のペン。カードの上に1枚の透明な紙を重ね、Apple Pencil の入力だけを拾って描く（指はカードに素通し）。
// 縦書き・横書きに関係なく同じように書ける。消しゴムは線ごと消す。
export function createPen(host) {
  const cv = document.createElement('canvas');
  cv.className = 'pen-layer';
  host.appendChild(cv);
  const ctx = cv.getContext('2d');
  const st = { strokes: [], cur: null, tool: 'pen', color: null, sideColor: '#1a1a1a', lastPenAt: 0, mouse: false, off: false, onChange: () => {} };
  let dpr = 1;
  function fit() {
    const r = host.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    redraw();
  }
  function drawStroke(s) {
    if (!s.pts.length) return;
    ctx.strokeStyle = s.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < s.pts.length; i++) {
      const [x0, y0, f0] = s.pts[i - 1], [x1, y1, f1] = s.pts[i];
      ctx.lineWidth = s.width * (0.55 + 0.9 * ((f0 + f1) / 2));
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    if (s.pts.length === 1) { const [x, y] = s.pts[0]; ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, y, s.width / 2, 0, Math.PI * 2); ctx.fill(); }
  }
  function redraw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    for (const s of st.strokes) drawStroke(s); if (st.cur) drawStroke(st.cur);
  }
  function eraseAt(x, y) {
    const before = st.strokes.length;
    st.strokes = st.strokes.filter(s => !s.pts.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < 14 ** 2));
    if (st.strokes.length !== before) { redraw(); st.onChange(); }
  }
  // 座標はカードの枠（iframe）の中の位置 → 紙の上の位置に直す
  function begin(x, y, f) {
    st.lastPenAt = performance.now();
    if (st.tool === 'eraser') { eraseAt(x, y); return; }
    st.cur = { color: st.color || st.sideColor, width: 2.6, pts: [[x, y, f]] }; redraw();
  }
  function move(x, y, f) {
    st.lastPenAt = performance.now();
    if (st.tool === 'eraser') { eraseAt(x, y); return; }
    if (!st.cur) return;
    const p = st.cur.pts[st.cur.pts.length - 1];
    if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < 0.5) return;
    st.cur.pts.push([x, y, f]);
    drawStroke({ ...st.cur, pts: st.cur.pts.slice(-2) });
  }
  function end() {
    st.lastPenAt = performance.now();
    if (st.cur) { st.strokes.push(st.cur); st.cur = null; st.onChange(); }
  }
  // カードの文書（iframe の中）にペンの受け口をつける
  function attach(doc, offset) {
    const opt = { capture: true, passive: false };
    const stylus = e => st.off ? null : [...e.changedTouches].find(t => t.touchType === 'stylus');   // 手書きパッドが切ってあれば Pencil も素通し
    const pos = t => { const o = offset(); return [t.clientX + o.x, t.clientY + o.y, t.force || 0.5]; };
    doc.addEventListener('touchstart', e => { const t = stylus(e); if (!t) return; e.preventDefault(); e.stopPropagation(); begin(...pos(t)); }, opt);
    doc.addEventListener('touchmove', e => { const t = stylus(e); if (!t) return; e.preventDefault(); e.stopPropagation(); move(...pos(t)); }, opt);
    doc.addEventListener('touchend', e => { if (!stylus(e)) return; e.preventDefault(); end(); }, opt);
    doc.addEventListener('touchcancel', e => { if (!stylus(e)) return; end(); }, opt);
    // PC で試すとき用（マウスで書く）
    doc.addEventListener('pointerdown', e => { if (st.off || !st.mouse || e.pointerType !== 'mouse') return; e.preventDefault(); begin(...pos(e)); }, opt);
    doc.addEventListener('pointermove', e => { if (!st.mouse || e.pointerType !== 'mouse' || !(e.buttons & 1)) return; e.preventDefault(); move(...pos(e)); }, opt);
    doc.addEventListener('pointerup', e => { if (!st.mouse || e.pointerType !== 'mouse') return; end(); }, opt);
  }
  // 書いている途中で消しゴムに切り替わったら（スクイーズの合図は握り終えたときに届くので、書き始めてから来ることがある）、
  // その線は残さず、ここまでなぞった所も消す（消しゴムで書き始めたのと同じにする）
  function switchTo(t) {
    if (t === 'eraser' && st.tool !== 'eraser' && st.cur) {
      const pts = st.cur.pts; st.cur = null;
      const before = st.strokes.length;
      for (const [x, y] of pts) st.strokes = st.strokes.filter(s => !s.pts.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < 14 ** 2));
      redraw(); if (st.strokes.length !== before) st.onChange();
    }
    st.tool = t; st.onChange();
  }
  new ResizeObserver(fit).observe(host);
  return {
    attach, fit,
    clear() { st.strokes = []; st.cur = null; redraw(); st.onChange(); },
    undo() { st.strokes.pop(); redraw(); st.onChange(); },
    setTool(t) { switchTo(t); },
    setEnabled(on) { st.off = !on; if (!on) { st.cur = null; } },
    toggleEraser() { switchTo(st.tool === 'eraser' ? 'pen' : 'eraser'); },
    setColor(c) { st.color = c; st.tool = 'pen'; st.onChange(); },
    setSideColor(c) { st.sideColor = c; },
    recentlyUsed: (ms = 450) => performance.now() - st.lastPenAt < ms,
    // 書き込みを画像に（質問に添える用。幅は 1400px まで）
    image(bg = '#ffffff') {
      if (!cv.width) return null;
      const sc = Math.min(1, 1400 / cv.width), o = document.createElement('canvas');
      o.width = Math.round(cv.width * sc); o.height = Math.round(cv.height * sc);
      const g = o.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, o.width, o.height); g.drawImage(cv, 0, 0, o.width, o.height);
      return o.toDataURL('image/jpeg', 0.85);
    },
    get state() { return st; },
  };
}
