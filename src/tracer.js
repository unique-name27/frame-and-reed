// Photo → outline. Auto mode: threshold the photo, keep the biggest blob, trace its edge, propose the long axis;
// the person checks the outline, confirms the two ends and types the harp's length. Hand mode is the fallback.
import { IN, state, bboxOf, traceMask, rdp } from './engine.js';

const $ = id => document.getElementById(id);
const tracer = $('tracer'), tc = $('tcanvas'), tctx = tc.getContext('2d');
const T = { img: null, mode: 'auto', step: 0, scale: [], outline: [], trig: [], det: null };
let view = { s: 1, ox: 0, oy: 0 }, drag = null, onDone = null;

const STEPS = {
  auto: [
    ['1 · Outline', 'The harp’s edge, found from the photo. Drag a point to fix it, or click on the line to add one. If the wrong thing is outlined, press Try another outline, or trace it by hand.'],
    ['2 · Ends and length', 'Check the labels: the trigger end must say TIPS and the ring end BOW — press Swap ends if they are the wrong way round. Drag the dots if they are off the ends, then type the harp’s overall length.'],
  ],
  hand: [
    ['1 · Axis', 'Click the two ends of the harp on its centreline — the arm tips first, then the far end — and type that length. Everything mirrors across this line.'],
    ['2 · One side', 'Trace ONE side only, from the arm tip round to the far end (5 or more points). Drag a point to fine-tune, click on the line to insert one, scroll to zoom, right-drag to pan.'],
    ['3 · Trigger', 'Click where the trigger bends up from the reed.'],
  ],
};
const list = () => T.mode === 'auto' ? [T.outline, T.scale][T.step] : [T.scale, T.outline, T.trig][T.step];

// ---- detection ----
// Several ways of separating the harp from what it lies on are tried — darker / lighter than the surroundings, greyer /
// more coloured — each cleaned up and reduced to its biggest blob. The blob that looks most like a harp lying in the
// middle of the frame wins; the others stay available behind "Try another outline".
function analyse(img) {
  const s = Math.min(1, 640 / Math.max(img.width, img.height)), w = Math.max(2, Math.round(img.width * s)), h = Math.max(2, Math.round(img.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data, n = w * h;
  const L0 = new Float32Array(n), S0 = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); L0[i] = 0.299 * r + 0.587 * g + 0.114 * b; S0[i] = mx > 0 ? (mx - mn) / mx * 255 : 0; }
  const L = boxMean(L0, w, h, 1), S = boxMean(S0, w, h, 1);
  const cands = [];
  for (const [name, ch, pen] of [['L', L, 0], ['S', S, 0.03]]) {
    const t = otsu(ch), loc = boxMean(ch, w, h, Math.round(Math.min(100, Math.max(w, h) * 0.2)));
    cands.push({ name: name + ' global dark', pen, fg: ch.map(v => v < t ? 1 : 0) }, { name: name + ' global light', pen, fg: ch.map(v => v >= t ? 1 : 0) });
    for (const dd of [10, 16]) cands.push({ name: name + ' local below ' + dd, pen, fg: ch.map((v, i) => v - loc[i] < -dd ? 1 : 0) }, { name: name + ' local above ' + dd, pen, fg: ch.map((v, i) => v - loc[i] > dd ? 1 : 0) });
  }
  const results = [];
  for (const cd of cands) {
    const m = closeMask(openMask(Uint8Array.from(cd.fg), w, h, 2), w, h, 3);
    const bl = largestBlob(m, w, h); if (!bl) continue;
    const area = bl.area / n, border = bl.border / (2 * w + 2 * h), cen = Math.hypot(bl.cx / w - 0.5, bl.cy / h - 0.5);
    const score = border * 3 + 0.5 * cen + (area < 0.015 ? 0.3 : 0) + (area > 0.5 ? 0.6 : 0) - 0.08 * Math.min(bl.aspect, 4.5) + (bl.aspect > 6 ? 0.3 : 0) - 0.6 * Math.sqrt(area) + cd.pen;
    results.push({ score, name: cd.name, mask: bl.mask, stats: bl });
  }
  results.sort((p, q) => p.score - q.score);
  T.det = { w, h, s, results, pick: 0 };
}
function otsu(g) {
  const hist = new Float64Array(256); for (let i = 0; i < g.length; i++) hist[Math.min(255, Math.max(0, g[i] | 0))]++;
  let total = g.length, sumAll = 0; for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break; sumB += t * hist[t]; const mB = sumB / wB, mF = (sumAll - sumB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = t; } }
  return thr;
}
function boxMean(src, w, h, r) { // separable box filter with edge clamping
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { const row = y * w; let acc = 0; for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { tmp[row + x] = acc / (2 * r + 1); acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { out[y * w + x] = acc / (2 * r + 1); acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}
function morph(m, w, h, r, isMax) { // separable square min/max filter
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = isMax ? 0 : 1; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= w) continue; const u = m[y * w + xx]; if (isMax ? u > v : u < v) v = u; } tmp[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = isMax ? 0 : 1; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= h) continue; const u = tmp[yy * w + x]; if (isMax ? u > v : u < v) v = u; } out[y * w + x] = v; }
  return out;
}
const openMask = (m, w, h, r) => morph(morph(m, w, h, r, false), w, h, r, true);
const closeMask = (m, w, h, r) => morph(morph(m, w, h, r, true), w, h, r, false);
function largestBlob(fg, w, h) {
  const lab = new Int32Array(w * h).fill(-1); let best = null, nl = 0; const stack = [];
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i] || lab[i] >= 0) continue; let area = 0, border = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0; stack.push(i); lab[i] = nl;
    while (stack.length) { const j = stack.pop(); area++; const xq = j % w, y = (j / w) | 0; sx += xq; sy += y; sxx += xq * xq; sxy += xq * y; syy += y * y; if (xq === 0 || y === 0 || xq === w - 1 || y === h - 1) border++; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = xq + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const k = yy * w + xx; if (fg[k] && lab[k] < 0) { lab[k] = nl; stack.push(k); } } }
    if (!best || area > best.area) {
      const mx = sx / area, my = sy / area, cxx = sxx / area - mx * mx, cxy = sxy / area - mx * my, cyy = syy / area - my * my;
      const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det)), e1 = tr / 2 + disc, e2 = Math.max(1e-6, tr / 2 - disc);
      best = { area, border, cx: mx, cy: my, label: nl, aspect: Math.sqrt(e1 / e2), ang: 0.5 * Math.atan2(2 * cxy, cxx - cyy) };
    }
    nl++;
  }
  if (!best || best.area < 50) return null;
  const mask = new Uint8Array(w * h); for (let i = 0; i < mask.length; i++) if (lab[i] === best.label) mask[i] = 1;
  return { ...best, mask };
}
function detect() {
  const { w, h, s, results, pick } = T.det;
  if (!results.length) { T.outline = []; T.scale = []; return; }
  const r = results[pick % results.length], bl = r.stats;
  const px = rdp(traceMask(r.mask, w, h), 1.6);
  T.outline = px.map(p => [(p[0] + 0.5) / s, (p[1] + 0.5) / s]);
  // long axis of the blob; the ends are the outline points that reach furthest along it
  const mx = bl.cx, my = bl.cy, ux = Math.cos(bl.ang), uy = Math.sin(bl.ang);
  let lo = 1e9, hi = -1e9, plo = px[0], phi = px[0];
  for (const p of px) { const t = (p[0] - mx) * ux + (p[1] - my) * uy; if (t < lo) { lo = t; plo = p; } if (t > hi) { hi = t; phi = p; } }
  const A = [(plo[0] + 0.5) / s, (plo[1] + 0.5) / s], B = [(phi[0] + 0.5) / s, (phi[1] + 0.5) / s];
  // arm tips first: the narrower end. Compare the blob's width over the outer third at each end.
  const width = (t0, t1) => { let a = 1e9, b = -1e9; for (const p of px) { const t = (p[0] - mx) * ux + (p[1] - my) * uy; if (t >= t0 && t <= t1) { const v = -(p[0] - mx) * uy + (p[1] - my) * ux; a = Math.min(a, v); b = Math.max(b, v); } } return b - a; };
  // The bow is the widest part of any jaw harp and sits at one end; the tips (and trigger) are at the other. Find the
  // widest 10 % window along the axis: the end it is nearer is the bow end. Fall back to "narrower end = tips" only
  // when the widest point sits in the middle.
  const span = hi - lo; let wBest = -1, tBest = 0;
  for (let k = 0; k <= 18; k++) { const t0 = lo + span * (k / 20), wk = width(t0, t0 + span * 0.1); if (wk > wBest) { wBest = wk; tBest = t0 + span * 0.05; } }
  const f = (tBest - lo) / span; // 0 = A end, 1 = B end
  if (f < 0.42) T.scale = [B, A]; else if (f > 0.58) T.scale = [A, B];
  else { const wLo = width(lo, lo + span * 0.3), wHi = width(hi - span * 0.3, hi); T.scale = wLo < wHi ? [A, B] : [B, A]; }
}

// ---- overlay ----
let returnFocus = null;
export function openTracer(src, done, fail) {
  onDone = done;
  const img = new Image();
  img.onload = () => {
    if (!img.width || !img.height) { img.onerror(); return; }
    // a new photo replaces the last one: let go of the old upload's memory
    if (T.img && T.img.src !== src && T.img.src.startsWith('blob:')) URL.revokeObjectURL(T.img.src);
    T.img = img; T.mode = 'auto'; T.step = 0; T.scale = []; T.outline = []; T.trig = [];
    showTracer(true); fitTracer();
    analyse(img); detect(); syncBar(); drawTracer();
  };
  img.onerror = () => {
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    if (fail) fail('That file could not be opened as a picture. Use a JPEG or PNG photo (on an iPhone, set the camera to Most Compatible, or share the photo as JPEG).');
  };
  img.src = src;
}
// the overlay is a modal dialog: focus moves in, the page behind can't be reached, Escape closes it
function showTracer(on) {
  if (on) { returnFocus = document.activeElement; tracer.hidden = false; document.querySelectorAll('body > :not(#tracer):not(#boot):not(script)').forEach(el => el.inert = true); setTimeout(() => $('t-next').focus(), 0); }
  else { tracer.hidden = true; document.querySelectorAll('[inert]').forEach(el => el.inert = false); if (returnFocus && returnFocus.focus) returnFocus.focus(); returnFocus = null; drag = null; }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !tracer.hidden) showTracer(false); });
function fitTracer() {
  tc.width = tc.clientWidth * devicePixelRatio; tc.height = tc.clientHeight * devicePixelRatio;
  const s = Math.min(tc.width / T.img.width, tc.height / T.img.height) * 0.94;
  view = { s, ox: (tc.width - T.img.width * s) / 2, oy: (tc.height - T.img.height * s) / 2 };
}
function syncBar() {
  const steps = STEPS[T.mode];
  $('t-step').textContent = steps[T.step][0]; $('t-hint').textContent = steps[T.step][1];
  $('t-scale-wrap').hidden = !(T.mode === 'auto' ? T.step === 1 : T.step === 0);
  $('t-detect').hidden = !(T.mode === 'auto' && T.step === 0);
  $('t-hand').hidden = !(T.mode === 'auto');
  $('t-swap').hidden = !(T.scale.length === 2 && (T.mode === 'auto' ? T.step === 1 : T.step === 0));
  $('t-next').textContent = (T.mode === 'auto' ? T.step === 1 : T.step === 2) ? 'Build the case' : 'Next';
}
const toImg = e => { const r = tc.getBoundingClientRect(); return [((e.clientX - r.left) * devicePixelRatio - view.ox) / view.s, ((e.clientY - r.top) * devicePixelRatio - view.oy) / view.s]; };
const toCv = p => [p[0] * view.s + view.ox, p[1] * view.s + view.oy];
function measureNote() {
  const el = $('t-meas'); if (!el) return;
  const len = +$('t-dist').value, ok = T.scale.length === 2 && len > 0 && T.outline.length >= 3;
  if (!ok) { el.textContent = ''; return; }
  const [a, b] = T.scale, px = Math.hypot(b[0] - a[0], b[1] - a[1]); if (px < 1) { el.textContent = ''; return; }
  const k = len / px, u = [(b[0] - a[0]) / px, (b[1] - a[1]) / px];
  let lo = 1e9, hi = -1e9, wMax = 0;
  for (const p of T.outline) { const x = (p[0] - a[0]) * -u[1] + (p[1] - a[1]) * u[0], z = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]; lo = Math.min(lo, z); hi = Math.max(hi, z); wMax = Math.max(wMax, Math.abs(x)); }
  let wid; if (T.mode === 'hand') wid = 2 * wMax; else { let l2 = 1e9, h2 = -1e9; for (const p of T.outline) { const x = (p[0] - a[0]) * -u[1] + (p[1] - a[1]) * u[0]; l2 = Math.min(l2, x); h2 = Math.max(h2, x); } wid = h2 - l2; }
  const unit = state.units === 'mm' ? 'mm' : 'in', f = v => unit === 'mm' ? (v * k).toFixed(0) : (v * k).toFixed(2);
  el.textContent = `Outline measures ${f(hi - lo)} × ${f(wid)} ${unit}`;
}
function drawTracer() {
  measureNote();
  tctx.clearRect(0, 0, tc.width, tc.height);
  tctx.drawImage(T.img, view.ox, view.oy, T.img.width * view.s, T.img.height * view.s);
  const css = getComputedStyle(document.body), acc = css.getPropertyValue('--accent').trim() || '#1d4e89', axis = '#d6006c', dpr = devicePixelRatio;
  const dot = (p, col, r = 5) => { const [x, y] = toCv(p); tctx.beginPath(); tctx.arc(x, y, r * dpr, 0, Math.PI * 2); tctx.fillStyle = col; tctx.fill(); tctx.lineWidth = 2 * dpr; tctx.strokeStyle = '#fff'; tctx.stroke(); };
  const path = (pts, close) => { tctx.beginPath(); pts.forEach((p, i) => { const [x, y] = toCv(p); i ? tctx.lineTo(x, y) : tctx.moveTo(x, y); }); if (close) tctx.closePath(); tctx.stroke(); };
  tctx.lineWidth = 2 * dpr;
  const editingOutline = T.mode === 'auto' ? T.step === 0 : T.step === 1;
  if (T.outline.length) {
    tctx.strokeStyle = acc; path(T.outline, T.mode === 'auto');
    if (editingOutline) T.outline.forEach(p => dot(p, acc, T.mode === 'auto' ? 3.5 : 5));
    if (T.mode === 'hand' && T.scale.length === 2) { tctx.globalAlpha = 0.55; path(T.outline.map(mirrorPx)); tctx.globalAlpha = 1; }
  }
  if (T.scale.length) { tctx.strokeStyle = axis; tctx.setLineDash([8 * dpr, 6 * dpr]); path(T.scale); tctx.setLineDash([]); T.scale.forEach((p, i) => dot(p, axis, 6)); if (T.scale.length === 2) { tctx.font = `bold ${13 * dpr}px system-ui`; tctx.fillStyle = axis; const label = (txt, [x, y]) => { const w = tctx.measureText(txt).width, lx = Math.min(Math.max(4 * dpr, x + 10 * dpr), tc.width - w - 4 * dpr), ly = Math.min(Math.max(16 * dpr, y - 8 * dpr), tc.height - 6 * dpr); tctx.fillText(txt, lx, ly); }; label('TIPS / trigger end', toCv(T.scale[0])); label('BOW', toCv(T.scale[1])); } }
  T.trig.forEach(p => dot(p, '#201e1d'));
}
function mirrorPx(p) {
  const [a, b] = T.scale, ux = b[0] - a[0], uy = b[1] - a[1], L2 = ux * ux + uy * uy || 1;
  const t = ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / L2, fx = a[0] + t * ux, fy = a[1] + t * uy;
  return [2 * fx - p[0], 2 * fy - p[1]];
}
function nearPoint(e) { const r = tc.getBoundingClientRect(), cx = (e.clientX - r.left) * devicePixelRatio, cy = (e.clientY - r.top) * devicePixelRatio; let best = null, bd = 12 * devicePixelRatio; list().forEach((p, i) => { const [x, y] = toCv(p), d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = i; } }); return best; }
function nearSegment(e) {
  const editingOutline = T.mode === 'auto' ? T.step === 0 : T.step === 1;
  if (!editingOutline || T.outline.length < 2) return null;
  const r = tc.getBoundingClientRect(), cx = (e.clientX - r.left) * devicePixelRatio, cy = (e.clientY - r.top) * devicePixelRatio; let best = null, bd = 8 * devicePixelRatio;
  const n = T.outline.length, segs = T.mode === 'auto' ? n : n - 1;
  for (let i = 0; i < segs; i++) { const a = toCv(T.outline[i]), b = toCv(T.outline[(i + 1) % n]), dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1; let t = ((cx - a[0]) * dx + (cy - a[1]) * dy) / L; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(a[0] + t * dx - cx, a[1] + t * dy - cy); if (d < bd) { bd = d; best = i + 1; } }
  return best;
}
const touches = new Map(), capture = e => { try { tc.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ } };
const pinchState = () => { const [a, b] = [...touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
tc.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { // a second finger: whatever the first one started becomes a pinch instead
      if (drag && drag.created) { list().splice(drag.i, 1); }
      const r = tc.getBoundingClientRect(), st = pinchState();
      drag = { pinch: true, d0: Math.max(10, st.d), s0: view.s, ox0: view.ox, oy0: view.oy, mx0: (st.mx - r.left) * devicePixelRatio, my0: (st.my - r.top) * devicePixelRatio };
      capture(e); drawTracer(); return;
    }
    if (touches.size > 2) return;
  }
  if (e.button === 1 || e.button === 2 || e.altKey || e.shiftKey) { drag = { pan: true, x: e.clientX, y: e.clientY }; capture(e); return; }
  const p = toImg(e), L = list(), hit = nearPoint(e);
  if (hit !== null) drag = { i: hit };
  else { const seg = nearSegment(e); if (seg !== null) { L.splice(seg, 0, p); drag = { i: seg, created: true }; }
  else if (L === T.scale) { if (T.scale.length < 2) { T.scale.push(p); drag = { i: T.scale.length - 1, created: true }; } }
  else if (L === T.outline && T.mode === 'hand') { T.outline.push(p); drag = { i: T.outline.length - 1, created: true }; }
  else if (L === T.trig) { T.trig = [p]; drag = { i: 0 }; } }
  if (drag) capture(e);
  drawTracer();
});
tc.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) { tc.style.cursor = nearPoint(e) !== null ? 'grab' : 'crosshair'; return; }
  if (drag.pinch) {
    if (touches.size < 2) return;
    const r = tc.getBoundingClientRect(), st = pinchState(), mx = (st.mx - r.left) * devicePixelRatio, my = (st.my - r.top) * devicePixelRatio;
    const s1 = Math.min(Math.max(drag.s0 * st.d / drag.d0, 0.05), 40), k = s1 / drag.s0;
    view.s = s1; view.ox = mx - (drag.mx0 - drag.ox0) * k; view.oy = my - (drag.my0 - drag.oy0) * k; // the photo point under the fingers stays under them
    drawTracer(); return;
  }
  if (drag.pan) { view.ox += (e.clientX - drag.x) * devicePixelRatio; view.oy += (e.clientY - drag.y) * devicePixelRatio; drag.x = e.clientX; drag.y = e.clientY; }
  else list()[drag.i] = toImg(e);
  drawTracer();
});
const lift = e => { touches.delete(e.pointerId); if (!drag || !drag.pinch || touches.size === 0) drag = null; };
tc.addEventListener('pointerup', lift);
tc.addEventListener('pointercancel', lift);
tc.addEventListener('contextmenu', e => e.preventDefault());
tc.addEventListener('wheel', e => {
  e.preventDefault();
  const r = tc.getBoundingClientRect(), cx = (e.clientX - r.left) * devicePixelRatio, cy = (e.clientY - r.top) * devicePixelRatio;
  const f = Math.exp(-e.deltaY * 0.0015), s = Math.min(Math.max(view.s * f, 0.05), 40) / view.s;
  view.ox = cx - (cx - view.ox) * s; view.oy = cy - (cy - view.oy) * s; view.s *= s;
  drawTracer();
}, { passive: false });
$('t-alt').addEventListener('click', () => { if (T.det) { T.det.pick++; detect(); drawTracer(); } });
$('t-swap').addEventListener('click', () => { if (T.scale.length === 2) { T.scale.reverse(); drawTracer(); } });
$('t-hand').addEventListener('click', () => { T.mode = 'hand'; T.step = 0; T.scale = []; T.outline = []; T.trig = []; syncBar(); drawTracer(); });
$('t-undo').addEventListener('click', () => { const L = list(); if (L === T.outline && T.mode === 'auto') { detect(); } else L.pop(); drawTracer(); });
$('t-cancel').addEventListener('click', () => showTracer(false));
$('t-next').addEventListener('click', () => {
  if (T.mode === 'auto') {
    if (T.step === 0) { if (T.outline.length < 8) { flashHint('No outline yet — press Try another outline, or trace it by hand.'); return; } T.step = 1; }
    else { if (T.scale.length < 2 || !(+$('t-dist').value > 0)) { flashHint('Place both ends and give the length.'); return; } if (!scaleOk()) return; finishAuto(); return; }
  } else {
    if (T.step === 0) { if (T.scale.length < 2 || !(+$('t-dist').value > 0)) { flashHint('Click both ends of the harp first, and give the length.'); return; } if (!scaleOk()) return; T.step = 1; }
    else if (T.step === 1) { if (T.outline.length < 5) { flashHint('Trace at least five points along one side.'); return; } T.step = 2; }
    else { if (!T.trig.length) { flashHint('Click where the trigger bends up.'); return; } finishHand(); return; }
  }
  syncBar(); drawTracer();
});
function flashHint(msg) { const h = $('t-hint'); const old = h.textContent; h.textContent = msg; h.style.color = 'var(--accent)'; setTimeout(() => { h.style.color = ''; if (h.textContent === msg) h.textContent = old; }, 2600); }
window.addEventListener('resize', () => { if (!tracer.hidden) { fitTracer(); drawTracer(); } });

// the two ends must be well apart on the photo, and the typed length has to be a harp's (about 1.2 to 10 inches)
function scaleOk() {
  const [a, b] = T.scale, px = Math.hypot(b[0] - a[0], b[1] - a[1]), mm = +$('t-dist').value * (state.units === 'mm' ? 1 : IN);
  if (px < Math.max(T.img.width, T.img.height) * 0.05) { flashHint('The two ends are almost on top of each other. Drag them out to the two ends of the harp.'); return false; }
  if (mm < 30 || mm > 250) { flashHint(`A harp length of ${$('t-dist').value} ${state.units === 'mm' ? 'mm' : 'in'} is outside what the case builder handles (30–250 mm, about 1.2–10 in). Check the number and the mm / inches switch.`); return false; }
  return true;
}
// ---- finish: photo px → mm in (across, along) axis coordinates ----
function axisMap() {
  const [a, b] = T.scale, pxLen = Math.hypot(b[0] - a[0], b[1] - a[1]), k = (+$('t-dist').value * (state.units === 'mm' ? 1 : IN)) / pxLen; // the length box is in the page's units
  const u = [(b[0] - a[0]) / pxLen, (b[1] - a[1]) / pxLen], v = [-u[1], u[0]];
  return p => ({ x: ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1]) * k, z: ((p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1]) * k });
}
function commit(outline, trigger) {
  const bb = bboxOf(outline), mz = (bb.minZ + bb.maxZ) / 2, mx = (bb.minX + bb.maxX) / 2;
  state.trace = { outline: outline.map(p => ({ x: p.x - mx, z: p.z - mz })), trigger: { x: 0, z: trigger.z - mz } };
  showTracer(false);
  if (onDone) onDone();
}
function finishAuto() {
  const map = axisMap(); let pts = T.outline.map(map);
  // the tips were clicked first, so they sit at z ≈ 0 and the bow at z ≈ length: flip so the trigger end is +z
  pts = pts.map(p => ({ x: p.x, z: -p.z }));
  // symmetrise: a half-width profile along the axis, from both sides averaged, then rebuilt as a clean closed polygon
  const bb = bboxOf(pts), step = 0.5, n = Math.max(4, Math.ceil((bb.maxZ - bb.minZ) / step)), wR = new Float32Array(n).fill(-1), wL = new Float32Array(n).fill(-1);
  const N = pts.length;
  for (let i = 0; i < N; i++) { // walk edges so thin regions get samples too
    const p = pts[i], q = pts[(i + 1) % N], segs = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / (step / 2)));
    for (let s = 0; s <= segs; s++) { const t = s / segs, x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t, b = Math.min(n - 1, Math.max(0, Math.round((z - bb.minZ) / step))); if (x >= 0) wR[b] = Math.max(wR[b], x); else wL[b] = Math.max(wL[b], -x); }
  }
  const w = new Float32Array(n); for (let i = 0; i < n; i++) { const r = wR[i], l = wL[i]; w[i] = r >= 0 && l >= 0 ? (r + l) / 2 : Math.max(r, l, 0); }
  for (let i = 1; i < n - 1; i++) if (w[i] <= 0) { let j = i + 1; while (j < n && w[j] <= 0) j++; const a = w[i - 1], b2 = j < n ? w[j] : a; for (let k = i; k < j; k++) w[k] = a + (b2 - a) * (k - i + 1) / (j - i + 1); }
  const outline = []; for (let i = 0; i < n; i++) outline.push({ x: Math.max(0, w[i]), z: bb.minZ + i * step }); for (let i = n - 1; i >= 0; i--) outline.push({ x: -Math.max(0, w[i]), z: bb.minZ + i * step });
  outline[0].x = 0; outline[n - 1].x = 0; outline[n].x = 0; outline[2 * n - 1].x = 0;
  commit(outline, { x: 0, z: bb.maxZ - 4 });
}
function finishHand() {
  const map = axisMap();
  let half = T.outline.map(map), trigger = map(T.trig[0]);
  const side = Math.sign(half.reduce((s, p) => s + p.x, 0)) || 1; half = half.map(p => ({ x: Math.max(0, p.x * side), z: p.z }));
  half.sort((p, q) => p.z - q.z);
  half[0] = { x: 0, z: half[0].z }; half[half.length - 1] = { x: 0, z: half[half.length - 1].z };
  let outline = [...half, ...half.slice(1, -1).reverse().map(p => ({ x: -p.x, z: p.z }))];
  trigger = { x: 0, z: trigger.z };
  if (!(trigger.z > (bboxOf(outline).minZ + bboxOf(outline).maxZ) / 2)) { outline = outline.map(p => ({ x: p.x, z: -p.z })); trigger = { x: 0, z: -trigger.z }; }
  commit(outline, trigger);
}
export function lastImage() { return T.img ? T.img.src : null; }
window.__tracer = T;
$('t-dist').addEventListener('input', measureNote);
