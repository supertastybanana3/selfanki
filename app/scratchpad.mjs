// AnkiMobile の「手書きパッド」（本家の機能）。歯車メニューの「手書きパッド」で出す／消す。カードの上に書く「書き込み」（このアプリの独自機能）とは別物。
// AnkiMobile 25.09 の実機（iPad）で測った決まり:
// ・出す／消すはノートタイプごとに覚える。次のカードに進むと線は消える。答えを出しても線は残る
// ・高さ＝floor(大きさの割合 × カードの欄の高さ ÷ 40) × 40（カードの欄＝上の帯の下から画面の下端まで）。方眼は 40pt おきで、パッドの上端・下端も線
//   縦の線は左右の余りを半分ずつにした位置から。方眼は「グリッドを表示」がオフでも出た（25.09 の実機のとおり、設定に関わらず出す）
// ・「ボトムバーの下に表示」オフ＝下の帯の上にカードへ重ねる。オン＝下の帯の下に置く
// ・元に戻す（↺）と歯車は、パッド（か下の帯）の上に左右に並ぶ
// ・地の不透明さ: 不透明 1・透明（少）0.73・透明（中）0.45・完全透明 0（カードに重なったときに効く）
// ・線の太さ: 細い 1・標準 3・太い 5.5pt（指のとき。Apple Pencil は筆圧で変わる）
// ・元に戻すを短く押す＝最後の1本を消す、0.5 秒押し続ける＝全部消す（「元に戻すですべて消去」で逆）
const GRID = 40, LONG_MS = 500;
export const SP_WIDTH = { thin: ['細い', 1], normal: ['標準', 3], thick: ['太い', 5.5] };
export const SP_SIZE = [25, 33, 40, 50, 60, 75, 80, 90];
export const SP_ALPHA = { opaque: ['不透明', 1], low: ['透明（少）', 0.73], mid: ['透明（中）', 0.45], clear: ['完全透明', 0] };
// AnkiMobile の ↺（太い弧と、左上の塗りの三角）に形と大きさ（31pt）を合わせた
const UNDO_SVG = '<svg viewBox="0 0 30 30"><path d="M4.4 19.3A11.5 11.5 0 1 0 6.7 8.9" fill="none" stroke="currentColor" stroke-width="5"/><path d="M2.5 1.5V13H14Z" fill="currentColor"/></svg>';

const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
export const spPref = {
  width: () => (SP_WIDTH[get('sp:width', 'normal')] ? get('sp:width', 'normal') : 'normal'),
  size: () => { const n = +get('sp:size', 25); return SP_SIZE.includes(n) ? n : 25; },
  alpha: () => (SP_ALPHA[get('sp:alpha', 'low')] ? get('sp:alpha', 'low') : 'low'),
  flag: (k, d = false) => get('sp:' + k, d ? '1' : '0') === '1',
  set: (k, v) => put('sp:' + k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)),
};

export function createScratchpad({ study, host, bottom, corner, isDark }) {
  const wrap = document.createElement('div'); wrap.id = 'scratch'; wrap.hidden = true;
  const cv = document.createElement('canvas'); wrap.append(cv);
  const undo = document.createElement('button'); undo.id = 'sp-undo'; undo.className = 'float'; undo.title = '元に戻す'; undo.innerHTML = UNDO_SVG; undo.hidden = true;
  host.append(undo);
  const ctx = cv.getContext('2d');
  let strokes = [], cur = null, mid = null, cardId = null, on = false, h = 0;

  const onKey = m => 'sp:on:' + m;
  function place() {
    const below = spPref.flag('below');
    if (below) { if (wrap.parentNode !== study || wrap.previousElementSibling !== bottom) bottom.after(wrap); wrap.classList.add('below'); }
    else { if (wrap.parentNode !== host) host.append(wrap); wrap.classList.remove('below'); }
  }
  function layout() {
    if (!on) { wrap.hidden = true; undo.hidden = true; corner.style.bottom = ''; return; }
    place(); wrap.hidden = false; undo.hidden = false;
    const base = window.innerHeight - host.getBoundingClientRect().top;   // カードの欄の高さ（上の帯の下から画面の下端まで）
    h = Math.max(GRID, Math.floor(spPref.size() / 100 * base / GRID) * GRID);
    wrap.style.height = h + 'px';
    const lift = spPref.flag('below') ? 0 : h;   // 帯の上に重ねるときは、元に戻すと歯車をパッドの上へ
    undo.style.bottom = `calc(${lift}px + 2.75px)`; corner.style.bottom = `calc(${lift}px + 2.75px)`;
    const left = get('toolsPos', 'right') === 'left'; undo.style.left = left ? 'auto' : ''; undo.style.right = left ? '2.75px' : '';   // 歯車を左に置いたら、元に戻すは右へ
    redraw();
  }
  function redraw() {
    const dpr = window.devicePixelRatio || 1, w = wrap.clientWidth, hh = wrap.clientHeight;
    if (!w || !hh) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hh);
    const dark = isDark();
    ctx.fillStyle = dark ? `rgba(0,0,0,${SP_ALPHA[spPref.alpha()][1]})` : `rgba(255,255,255,${SP_ALPHA[spPref.alpha()][1]})`;
    ctx.fillRect(0, 0, w, hh);
    // 方眼（40pt おき、1pt。縦の線は左右の余りを半分ずつに）
    ctx.fillStyle = dark ? '#333333' : '#cccccc';
    const off = (w % GRID) / 2;
    for (let x = off; x <= w; x += GRID) ctx.fillRect(Math.round(x) - 0.5, 0, 1, hh);
    for (let y = 0; y <= hh; y += GRID) ctx.fillRect(0, Math.min(y, hh - 1), w, 1);
    ctx.strokeStyle = dark ? '#ffffff' : '#000000'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokes) drawStroke(s);
    if (cur) drawStroke(cur);
  }
  function drawStroke(s) {
    const p = s.pts;
    if (p.length === 1) { ctx.beginPath(); ctx.fillStyle = ctx.strokeStyle; ctx.arc(p[0].x, p[0].y, p[0].w / 2, 0, Math.PI * 2); ctx.fill(); return; }
    for (let i = 1; i < p.length; i++) {
      ctx.beginPath(); ctx.lineWidth = (p[i - 1].w + p[i].w) / 2;
      const a = p[i - 1], b = p[i], m0 = i > 1 ? { x: (p[i - 2].x + a.x) / 2, y: (p[i - 2].y + a.y) / 2 } : a, m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.moveTo(m0.x, m0.y); ctx.quadraticCurveTo(a.x, a.y, m1.x, m1.y); if (i === p.length - 1) ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  const width = e => { const base = SP_WIDTH[spPref.width()][1]; return e.pointerType === 'pen' && e.pressure > 0 ? base * (0.35 + 1.3 * e.pressure) : base; };
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: width(e) }; };
  cv.addEventListener('pointerdown', e => {
    if (spPref.flag('finger') && e.pointerType !== 'pen') return;   // 指での入力を無視（Apple Pencil だけ）
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch {}
    cur = { id: e.pointerId, pts: [pt(e)] }; redraw();
  });
  cv.addEventListener('pointermove', e => {
    if (!cur || e.pointerId !== cur.id) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const x of evs.length ? evs : [e]) cur.pts.push(pt(x));
    redraw();
  });
  const end = e => { if (!cur || e.pointerId !== cur.id) return; strokes.push(cur); cur = null; redraw(); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  // 元に戻す: 短く＝1本、0.5 秒押し続ける＝全部（「元に戻すですべて消去」で逆）
  let timer = null, long = false;
  const act = isLong => { if (isLong !== spPref.flag('undoAll')) strokes = []; else strokes.pop(); redraw(); };
  undo.addEventListener('pointerdown', e => { e.preventDefault(); long = false; clearTimeout(timer); timer = setTimeout(() => { long = true; act(true); }, LONG_MS); });
  undo.addEventListener('pointerup', () => { clearTimeout(timer); if (!long) act(false); long = true; });
  undo.addEventListener('pointercancel', () => { clearTimeout(timer); long = true; });
  undo.addEventListener('click', e => { if (e.detail === 0) act(false); });
  window.addEventListener('resize', () => { if (on) layout(); });

  return {
    // 出すカードが変わったとき（null＝学習の画面を離れた）。ノートタイプごとの出す／消すを読み、カードが変われば線を消す
    setCard(card) {
      if (!card) { on = false; mid = null; cardId = null; strokes = []; cur = null; layout(); return; }
      if (card.id !== cardId) { strokes = []; cur = null; }
      cardId = card.id; mid = card.mid; on = get(onKey(mid), '0') === '1' && get('pref:noPad', '0') !== '1'; layout();   // 「手書きパッドを表示しない」なら出さない
    },
    toggle() { if (mid == null || get('pref:noPad', '0') === '1') return; on = !on; put(onKey(mid), on ? '1' : '0'); layout(); },
    // アクション「手書きサイズ」: 25% → 50% → 75% → 25%（実機。ほかの大きさのときは 25% へ）
    cycleSize() { const n = spPref.size(); spPref.set('size', n === 25 ? 50 : n === 50 ? 75 : 25); layout(); },
    refresh() { if (get('pref:noPad', '0') === '1') on = false; else if (mid != null) on = get(onKey(mid), '0') === '1'; layout(); },
    get on() { return on; },
  };
}
