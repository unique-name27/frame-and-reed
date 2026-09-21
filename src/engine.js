// Jaw harp case geometry engine — ported verbatim from the prototype (raster-mask 2D → contour → extrude).
// Units: mm inside build(); the returned group is scaled ×0.001 to metres. x across, z along (trigger toward +z), y up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DECO, makeDRaster, clearD, mmSpace, pxSpace, readD, edt, erodeM, dilateM, andM, countM, patternInk } from './decor.js';

export const IN = 25.4;

export const mats = {
  body:   Object.assign(new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.62, metalness: 0.02 }), { name: 'body-petg' }),
  felt:   Object.assign(new THREE.MeshStandardMaterial({ color: 0x5a0e38, roughness: 1.0, metalness: 0 }), { name: 'lining-felt' }),
  accent: Object.assign(new THREE.MeshStandardMaterial({ color: 0xd8b064, roughness: 0.45, metalness: 0.3 }), { name: 'accent-petg' }),
  ti:     Object.assign(new THREE.MeshStandardMaterial({ color: 0x8a5fc8, roughness: 0.32, metalness: 0.4 }), { name: 'anodized-titanium' }),
};

// Bow outlines by harp family. f = bow length ÷ width; neck = how far the shoulders taper before the arms run parallel.
export const SHAPES = {
  round:   { f: 1.0,  neck: 1.0 }, // European bow-frame, morchang: a round bow closing into two arms
  stamped: { f: 0.8,  neck: 0.55 }, // flat stamped steel (Hohner pattern): a wide squared-off oval, arms almost at once
  egg:     { f: 1.3,  neck: 0.5 }, // forged khomus / bass: a long loop, fuller at the back, arms running most of the length
};
export const PRESETS = {
  bowS:     { name: 'Bow-frame · small',    kind: 'European, forged round bow',  shape: 'round',   len: 3.0, wid: 1.0,  span: 0.45, arm: 3.5, trig: 0.7, tail: 0 },
  bowM:     { name: 'Bow-frame · medium',   kind: 'European, forged round bow',  shape: 'round',   len: 4,   wid: 1.25, span: 0.55, arm: 4,   trig: 0.9, tail: 0 },
  bowL:     { name: 'Bow-frame · large',    kind: 'European, forged round bow',  shape: 'round',   len: 5,   wid: 1.5,  span: 0.65, arm: 5,   trig: 1.1, tail: 0 },
  hohner:   { name: 'Stamped steel',        kind: 'Hohner pattern, flat frame',  shape: 'stamped', len: 3.5, wid: 1.1,  span: 0.85, arm: 4,   trig: 0.8, tail: 0 },
  khomus:   { name: 'Khomus',               kind: 'Yakut, reed tail past the bow', shape: 'egg',   len: 4.3, wid: 1.0,  span: 0.5,  arm: 5,   trig: 1.2, tail: 0.45 },
  morchang: { name: 'Morchang',             kind: 'Rajasthani, wide ring',       shape: 'round',   len: 3.3, wid: 1.4,  span: 0.45, arm: 3,   trig: 0.8, tail: 0 },
  bass:     { name: 'Bass harp',            kind: 'large forged loop, tailed',   shape: 'egg',     len: 6,   wid: 1.9,  span: 0.85, arm: 6,   trig: 1.4, tail: 0.4 },
};

// Bow outline as a polygon centred on (0,0); z runs from -b (back of the bow) to +b (toward the arms).
function bowPts(shape, a, b, n = 72) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * Math.PI * 2; let x, z;
    if (shape === 'stamped') { const e = 2 / 3.2; x = a * Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** e; z = -b * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** e; }
    else if (shape === 'egg') { x = a * Math.sin(t) * (1 + 0.28 * Math.cos(t)) / 1.04; z = -b * Math.cos(t); }
    else { x = a * Math.sin(t); z = -b * Math.cos(t); }
    pts.push({ x, z });
  }
  return pts;
}
// One harp as 2D primitives (mm, top view: x across, z along, trigger toward +z), from the slider values.
export function parametricHarp(P) {
  const hL = P.len * IN, hW = P.wid * IN, frameT = P.arm, sh = SHAPES[P.shape] || SHAPES.round;
  let span = Math.min(P.span * IN, hW); span = Math.max(span, 2 * frameT + 3);
  const reedW = Math.max(2.5, Math.min(6, span - 2 * frameT - 1.5));
  const a = hW / 2, b = a * sh.f, zRing = -hL / 2 + b;
  const zNeck0 = zRing + b + Math.max(4, 0.45 * hW) * sh.neck; let zTip = hL / 2 - 10; const zNeck = Math.min(zNeck0, zTip - 8); if (zTip < zNeck + 8) zTip = zNeck + 8;
  const armL = zTip - zRing, trigger = { x: 0, z: hL / 2 - 5 };
  const bowO = bowPts(P.shape, a, b).map(p => ({ x: p.x, z: p.z + zRing }));
  const bowI = bowPts(P.shape, Math.max(1, a - frameT), Math.max(1, b - frameT)).map(p => ({ x: p.x, z: p.z + zRing }));
  // shoulders leave the bow 60° forward of its widest point and taper to the arm span
  const att = bowO[Math.round(bowO.length / 3)], sx = Math.abs(att.x), sz = att.z;
  const shoulder = sg => ({ poly: [{ x: sg * sx, z: sz }, { x: sg * (sx - frameT), z: sz }, { x: sg * (span / 2 - frameT), z: zNeck }, { x: sg * span / 2, z: zNeck }] });
  // reed tail: the reed's fixed end carried past the back of the bow on a block (khomus, bass harps)
  const tailL = Math.max(0, (P.tail || 0) * IN), tailW = reedW + 3, zBack = zRing - b - tailL;
  const framePrims = [{ poly: bowO }, shoulder(1), shoulder(-1), rect(-span / 2, zNeck, -span / 2 + frameT, zTip), rect(span / 2 - frameT, zNeck, span / 2, zTip)];
  if (tailL > 0) framePrims.push(rect(-tailW / 2, zBack, tailW / 2, zRing - b + 2));
  const reedPrim = rect(-reedW / 2, zBack + 1, reedW / 2, trigger.z + 4);
  const harpPrims = framePrims.concat([reedPrim]);
  const bayPrims = harpPrims.concat([{ poly: [{ x: -a, z: zRing }, { x: a, z: zRing }, { x: span / 2, z: zNeck }, { x: -span / 2, z: zNeck }] }, rect(-span / 2, zNeck, span / 2, zTip)]);
  const ix = sx - frameT, ia = span / 2 - frameT;
  const holePrims = [{ poly: bowI }, { poly: [{ x: ix, z: sz }, { x: ia, z: zNeck }, { x: -ia, z: zNeck }, { x: -ix, z: sz }] }];
  // pendant floor windows: under the ring, and under the reed between the arms — the frame itself stays on solid floor
  const windows = [];
  if (a - 4.5 > 2.5) windows.push({ poly: bowPts(P.shape, a - 4.5, Math.max(2.5, b - 4.5)).map(p => ({ x: p.x, z: p.z + zRing })) });
  const slotHalf = span / 2 - frameT - 1; if (slotHalf * 2 >= 3 && zTip - zNeck > 12) windows.push(rect(-slotHalf, zNeck + 3, slotHalf, zTip - 3));
  return { hL, hW, frameT, span, reedW, a, b, zRing, zNeck, zTip, armL, trigger, framePrims, harpPrims, bayPrims, holePrims, windows, reedPrim, tailL, zBack };
}

// ---- 2D helpers: raster offsetting + contour tracing ----
const RES = 0.2; // mm per pixel
function makeRaster(bb, pad) {
  const x0 = bb.minX - pad, z0 = bb.minZ - pad;
  const w = Math.ceil((bb.maxX - bb.minX + 2 * pad) / RES), h = Math.ceil((bb.maxZ - bb.minZ + 2 * pad) / RES);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return { c, ctx, w, h, x0, z0, toPx: (x, z) => [(x - x0) / RES, (z - z0) / RES], toMm: (px, py) => ({ x: px * RES + x0, z: py * RES + z0 }) };
}
function paint(R, prims, d) {
  const { ctx } = R; ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(0.01, 2 * d / RES);
  for (const p of prims) {
    ctx.beginPath();
    if (p.circle) { const [x, z, r] = p.circle; const [px, py] = R.toPx(x, z); ctx.arc(px, py, r / RES, 0, Math.PI * 2); }
    else { p.poly.forEach((q, i) => { const [px, py] = R.toPx(q.x, q.z); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); }
    ctx.fill(); if (d > 0) ctx.stroke();
  }
}
function readMask(R) {
  const a = R.ctx.getImageData(0, 0, R.w, R.h).data, m = new Uint8Array(R.w * R.h);
  for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}
function maskOf(R, prims, d) { R.ctx.clearRect(0, 0, R.w, R.h); paint(R, prims, d); return readMask(R); }
export function traceMask(m, w, h) {
  const get = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x];
  let sx = -1, sy = -1;
  for (let i = 0; i < m.length; i++) if (m[i]) { sx = i % w; sy = (i / w) | 0; break; }
  if (sx < 0) return [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const pts = []; let cx = sx, cy = sy, bx = sx - 1, by = sy;
  do {
    pts.push([cx, cy]);
    const k = dirs.findIndex(d => d[0] === bx - cx && d[1] === by - cy);
    let found = false;
    for (let i = 1; i <= 8; i++) {
      const j = (k + i) % 8, nx = cx + dirs[j][0], ny = cy + dirs[j][1];
      if (get(nx, ny)) { const pj = (k + i - 1 + 8) % 8; bx = cx + dirs[pj][0]; by = cy + dirs[pj][1]; cx = nx; cy = ny; found = true; break; }
    }
    if (!found) break;
  } while (!(cx === sx && cy === sy) && pts.length < w * h);
  return pts;
}
export function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const d2 = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L; t = Math.max(0, Math.min(1, t)); const ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1]; return ex * ex + ey * ey; };
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let mi = -1, md = 0;
    for (let i = a + 1; i < b; i++) { const d = d2(pts[i], pts[a], pts[b]); if (d > md) { md = d; mi = i; } }
    if (md > eps * eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function chaikin(pts, n = 2) {
  for (let k = 0; k < n; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    pts = out;
  }
  return pts;
}
// split long edges so Chaikin's corner cutting (¼ of each adjacent edge) never rounds a corner by more than ~0.2 mm
function subdivide(pts, maxLen = 4) {
  const out = [];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / maxLen)); for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  return out;
}
function contour(R, mask) {
  const px = chaikin(subdivide(rdp(traceMask(mask, R.w, R.h), 1.4)), 2);
  return px.map(p => R.toMm(p[0] + 0.5, p[1] + 0.5));
}
// drop duplicate and collinear points before extruding: earcut silently skips them when it triangulates the caps,
// and if the walls still used them the caps and walls would not share edges (T-junctions → an "open" mesh for slicers)
function cleanPoly(pts) {
  let out = pts.slice(), changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const dup = Math.hypot(b.x - a.x, b.z - a.z) < 1e-7;
      const area = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
      if (dup || area < 1e-12) { out.splice(i, 1); i--; changed = true; }
    }
  }
  return out;
}
function shapeOf(pts) { pts = cleanPoly(pts); const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p.x, p.z) : s.moveTo(p.x, p.z)); s.closePath(); return s; }
function circlePath(x, z, r) { const h = new THREE.Path(); h.moveTo(x + r, z); h.absarc(x, z, r, 0, Math.PI * 2, true); return h; }
// a rounded slot (stadium) centred on (x, z), running along z
function slotPts(x, z, hw, hl, n = 10) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = Math.PI * i / n; pts.push({ x: x + hw * Math.cos(a), z: z + hl + hw * Math.sin(a) }); }
  for (let i = 0; i <= n; i++) { const a = Math.PI + Math.PI * i / n; pts.push({ x: x + hw * Math.cos(a), z: z - hl + hw * Math.sin(a) }); }
  return pts;
}
function pathOf(pts) { pts = cleanPoly(pts); const s = new THREE.Path(); pts.forEach((p, i) => i ? s.lineTo(p.x, p.z) : s.moveTo(p.x, p.z)); s.closePath(); return s; }
export function bboxOf(pts) { const b = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 }; for (const p of pts) { b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x); b.minZ = Math.min(b.minZ, p.z); b.maxZ = Math.max(b.maxZ, p.z); } return b; }
const rect = (x1, z1, x2, z2) => ({ poly: [{ x: x1, z: z1 }, { x: x2, z: z1 }, { x: x2, z: z2 }, { x: x1, z: z2 }] });
function hull(prims) {
  const pts = prims.flatMap(p => p.circle ? Array.from({ length: 48 }, (_, i) => ({ x: p.circle[0] + p.circle[2] * Math.cos(i / 48 * Math.PI * 2), z: p.circle[1] + p.circle[2] * Math.sin(i / 48 * Math.PI * 2) })) : p.poly);
  pts.sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// Body parts that sit on another body part are sunk 0.02 mm into it, so stacked solids overlap instead of sharing a face
// and a ring of identical vertices (slicers weld those and then see a non-manifold mesh). Moving parts are left exactly where they are.
const SINK = 0.02; let sinkFloor = 0.01; // parts starting at or below sinkFloor sit on the bed (or on the other half of a clamshell) and are not sunk
const sink = (mat, yBase, h) => (mat === mats.body && yBase > sinkFloor && h > 0.5) ? SINK : 0;
// Every extrusion's cap is test-triangulated first (see capArea): if earcut would leave a slit — three outline points
// that happen to line up, say — the outline is nudged a few microns and tried again.
function safeShape(shape) {
  if (capArea(shape)) return shape;
  const { shape: v0, holes: h0 } = shape.extractPoints(24);
  for (let k = 1; k <= 4; k++) {
    const jit = (pts, j) => pts.map((p, i) => new THREE.Vector2(p.x + (((i * 7919 + (k * 13 + j) * 104729) % 997) / 997 - 0.5) * 0.004, p.y + (((i * 104723 + (k * 13 + j) * 7907) % 991) / 991 - 0.5) * 0.004));
    const sh = new THREE.Shape(jit(v0, 0)); h0.forEach((hh, j) => sh.holes.push(new THREE.Path(jit(hh, j + 1))));
    if (capArea(sh)) return sh;
  }
  return shape;
}
function slab(shape, h, yBase, mat, name, bevel = 0, inset = 0) {
  shape = safeShape(shape);
  const d = sink(mat, yBase, h); yBase -= d; h += d;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h - 2 * bevel, steps: 1, curveSegments: 24,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel - inset, bevelSegments: 4,
  });
  g.rotateX(Math.PI / 2);
  g.translate(0, yBase + h - bevel, 0);
  const m = new THREE.Mesh(g, mat); m.name = name; return m;
}
// slab with a bevel on only the chosen faces: a plain extrusion plus a short beveled cap at each bevelled end.
// The cap's straight section is inset 0.05 mm and the plain part starts 0.03 mm inside it, so the two closed solids
// overlap without any coincident faces or edges — slicers union overlapping shells cleanly, coincident ones confuse them.
function slabB(shape, h, yBase, mat, name, bevTop = 0, bevBot = 0) {
  shape = safeShape(shape);
  const d = bevBot > 0 ? 0 : sink(mat, yBase, h); yBase -= d; h += d;
  const parts = [], ovB = bevBot > 0 ? Math.min(0.6, h - 2 * bevBot) : 0, ovT = bevTop > 0 ? Math.min(0.6, h - 2 * bevTop) : 0;
  const capB = ovB > 0.1, capT = ovT > 0.1;
  const y0 = yBase + (capB ? bevBot + 0.03 : 0), y1 = yBase + h - (capT ? bevTop + 0.03 : 0);
  const plain = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, steps: 1, curveSegments: 24, bevelEnabled: false });
  plain.rotateX(Math.PI / 2); plain.translate(0, y1, 0); parts.push(plain);
  if (capB) parts.push(slab(shape, 2 * bevBot + ovB, yBase, mat, name, bevBot, 0.05).geometry);
  if (capT) parts.push(slab(shape, 2 * bevTop + ovT, yBase + h - 2 * bevTop - ovT, mat, name, bevTop, 0.05).geometry);
  const m = new THREE.Mesh(parts.length > 1 ? mergeGeometries(parts) : parts[0], mat); m.name = name; return m;
}
// a hollow cylinder along z, centred on the origin
function tube(rOut, rIn, len) {
  const s = new THREE.Shape(); s.moveTo(rOut, 0); s.absarc(0, 0, rOut, 0, Math.PI * 2, false); if (rIn > 0) s.holes.push(circlePath(0, 0, rIn));
  const g = new THREE.ExtrudeGeometry(s, { depth: len, steps: 1, curveSegments: 32, bevelEnabled: false }); g.translate(0, 0, -len / 2); return g;
}
// every solid region of a mask as a Shape with its holes; a solid island inside a hole becomes its own shape
function maskToShapes(R, mask) {
  const { w, h } = R, out = [];
  for (const cm of components(mask, w, h)) {
    let n = 0; for (let i = 0; i < cm.length; i += 5) n += cm[i]; if (n < 12) continue; // skip specks (< ~2.4 mm²)
    const outerPts = contour(R, cm); if (outerPts.length < 8) continue;
    const shape = shapeOf(outerPts);
    // holes: pieces of "not this region" that never reach the raster border
    const inv = new Uint8Array(cm.length); for (let i = 0; i < cm.length; i++) inv[i] = cm[i] ? 0 : 1;
    // limit the search to the component's bounding box (+1 px) for speed
    let x0 = w, x1 = 0, y0 = h, y1 = 0; for (let i = 0; i < cm.length; i++) if (cm[i]) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const box = new Uint8Array(cm.length); for (let y = Math.max(0, y0 - 1); y <= Math.min(h - 1, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(w - 1, x1 + 1); x++) box[y * w + x] = inv[y * w + x];
    for (const hc of components(box, w, h)) {
      let border = 0; for (let i = 0; i < hc.length; i += 1) if (hc[i]) { const x = i % w, y = (i / w) | 0; if (x <= Math.max(0, x0 - 1) || x >= Math.min(w - 1, x1 + 1) || y <= Math.max(0, y0 - 1) || y >= Math.min(h - 1, y1 + 1)) { border = 1; break; } }
      if (border) continue;
      let hn = 0; for (let i = 0; i < hc.length; i += 5) hn += hc[i]; if (hn < 12) continue;
      const hp = contour(R, hc); if (hp.length > 6) shape.holes.push(pathOf(hp));
    }
    out.push({ shape, mask: cm });
  }
  return out;
}
// connected components (4-neighbour) of a mask, each as its own mask
function components(m, w, h) {
  const seen = new Uint8Array(m.length), out = [], stack = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || seen[i]) continue;
    const cm = new Uint8Array(m.length); stack.push(i); seen[i] = 1;
    while (stack.length) { const j = stack.pop(); cm[j] = 1; const x = j % w, y = (j / w) | 0; if (x > 0 && m[j - 1] && !seen[j - 1]) { seen[j - 1] = 1; stack.push(j - 1); } if (x < w - 1 && m[j + 1] && !seen[j + 1]) { seen[j + 1] = 1; stack.push(j + 1); } if (y > 0 && m[j - w] && !seen[j - w]) { seen[j - w] = 1; stack.push(j - w); } if (y < h - 1 && m[j + w] && !seen[j + w]) { seen[j + w] = 1; stack.push(j + w); } }
    out.push(cm);
  }
  return out;
}
// ---------------- decoration: a pattern cut into the top of the case ----------------
// Works on a fine raster (decor.js, 0.1 mm/px): the surface's region is painted there, the pattern drawn inside it, and
// the result traced back into shapes and extruded — as raised relief, as an engraving, or as pierced filigree.
// smoothed, then thinned: no two points closer than 0.4 px (0.04 mm) and no hairpin spikes. Walls between points
// that close are slivers the STL writer has to drop as degenerate, which would leave the shell open.
function tidyPx(pts) {
  let out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.4) out.push(p); }
  while (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.4) out.pop();
  // walk the outline measuring each point against the last one kept: drop hairpins, and points so nearly in line that
  // the cap triangle through them would be a sliver (twice its area under 0.5 px²)
  for (let pass = 0; pass < 2 && out.length > 8; pass++) {
    const keep = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const a = keep[keep.length - 1], b = out[i], c = out[(i + 1) % out.length];
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      const dot = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1), area2 = Math.abs(ux * (c[1] - a[1]) - uy * (c[0] - a[0]));
      if (dot > -0.94 && area2 > 0.5) keep.push(b);
    }
    if (keep.length < 4) break;
    out = keep;
  }
  return out;
}
// The tracer walks the centres of the edge pixels, so a traced outline sits half a pixel inside the true edge — on
// a 0.5 mm line that is a fifth of its width. Push every point out by half a pixel (d > 0 grows the traced region —
// the solid for an outline, the hole for a hole, since a hole is traced round its own pixels the same way).
function grow(pts, d) {
  const n = pts.length; if (n < 3) return pts;
  let a2 = 0; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a2 += p[0] * q[1] - q[0] * p[1]; }
  const sg = a2 > 0 ? -1 : 1; // which side of the walk is outside
  return pts.map((b, i) => {
    const a = pts[(i + n - 1) % n], c = pts[(i + 1) % n];
    let ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1]; const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1; ux /= lu; uy /= lu; vx /= lv; vy /= lv;
    let nx = -(uy + vy), ny = ux + vx; const ln = Math.hypot(nx, ny); if (ln < 1e-6) return b; nx /= ln; ny /= ln;
    return [b[0] + sg * nx * d, b[1] + sg * ny * d];
  });
}
const smoothPx = (px, d = 0.5) => tidyPx(grow(chaikin(subdivide(rdp(px, 1.25)), 2), d)); // rdp above 1 px: a digital straight edge wanders up to a pixel, and a finer tolerance keeps its stair-steps as a zigzag
// every solid piece of a fine mask as a Shape with its holes (cropped per piece, so hundreds of pieces stay fast)
// Two pixels touching only at a corner are one piece to the outline tracer (it steps diagonally) but a gap to a
// 4-way flood fill — the two disagree about whether the background there is a hole. Fill one pixel of every such
// corner-to-corner pinch so they agree, and no hole ever touches its outline at a single point.
function depinch(m, w, h) {
  const o = m.slice();
  for (let pass = 0; pass < 3; pass++) {
    let n = 0;
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
      const i = y * w + x, a = o[i], b = o[i + 1], c = o[i + w], d = o[i + w + 1];
      if (a && d && !b && !c) { o[i + 1] = 1; n++; } else if (b && c && !a && !d) { o[i] = 1; n++; }
    }
    if (!n) break;
  }
  return o;
}
// Earcut (which caps every extrusion) can leave part of a cap untriangulated when separate outlines line up exactly
// — two grooves cut off along the same straight edge, say — and the solid then has a hole in its top and bottom.
// It can also lay a flat triangle across three points that happen to line up. So each shape is test-triangulated here
// the way ExtrudeGeometry will do it. On a miss, the points are nudged a few
// microns (far below anything a printer resolves) and tried again; if that fails, the offending holes are left out.
function capArea(shape, div = 24) {
  const { shape: v0, holes: h0 } = shape.extractPoints(div);
  let v = v0.slice(); const holes = h0.map(h => h.slice());
  if (!THREE.ShapeUtils.isClockWise(v)) { v = v.reverse(); holes.forEach((h, i) => { if (THREE.ShapeUtils.isClockWise(h)) holes[i] = h.reverse(); }); }
  const faces = THREE.ShapeUtils.triangulateShape(v, holes), all = v.concat(...holes);
  let got = 0;
  for (const f of faces) {
    const a = all[f[0]], b = all[f[1]], c = all[f[2]], a2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (a2 < 1.2e-4) return false; // a flat triangle across three points in line: the STL writer would drop it and leave a slit
    got += a2 / 2;
  }
  const want = Math.abs(THREE.ShapeUtils.area(v)) - holes.reduce((t, h) => t + Math.abs(THREE.ShapeUtils.area(h)), 0);
  return Math.abs(got - want) <= Math.max(0.005, want * 0.001);
}
function solidShape(outer, holes) {
  const jit = (pts, k) => pts.map((p, i) => ({ x: p.x + (((i * 7919 + k * 104729) % 997) / 997 - 0.5) * 0.004, z: p.z + (((i * 104723 + k * 7907) % 991) / 991 - 0.5) * 0.004 }));
  const make = (k, hs) => { const sh = shapeOf(k ? jit(outer, k) : outer); hs.forEach((h, j) => sh.holes.push(pathOf(k ? jit(h, k * 31 + j + 1) : h))); return sh; };
  for (let k = 0; k < 5; k++) { const sh = make(k, holes); if (capArea(sh)) return sh; }
  // still failing: leave out, one at a time, holes whose removal makes it triangulate (small shapes only — it is slow)
  if (holes.length <= 24) for (let i = holes.length - 1; i >= 0; i--) { const trial = holes.slice(0, i).concat(holes.slice(i + 1)), sh = make(1, trial); if (capArea(sh)) return sh; }
  if (globalThis.__decoCheck) { globalThis.__decoCheck.push({ capFail: holes.length }); if (globalThis.__failShapes) globalThis.__failShapes.push({ outer, holes }); }
  return make(1, holes);
}
// One solid piece (cm: a crop with an empty 1 px border; crop pixel x,y is raster pixel x+ox, y+oy). A piece riddled with
// holes — an engraved skin can carry a thousand — is split in two, overlapping by 0.4 mm, until each half carries a
// sensible number: the cap triangulation slows down and gets fragile with very many holes, and overlapping solids
// print as one.
function traceCrop(D, cm, cw, ch, ox, oy, n, out, minPx, depth) {
  const hl = new Int32Array(cw * ch), hs = new Int32Array(cw * ch), holes = []; let hid = 0;
  for (let i = 0; i < cw * ch; i++) {
    if (cm[i] || hl[i]) continue;
    hid++; let sp = 0, border = false, hn = 0, hx0 = cw, hx1 = 0, hy0 = ch, hy1 = 0; hs[sp++] = i; hl[i] = hid;
    while (sp) {
      const j = hs[--sp], x = j % cw, y = (j / cw) | 0; hn++;
      if (x === 0 || y === 0 || x === cw - 1 || y === ch - 1) border = true;
      if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; if (y < hy0) hy0 = y; if (y > hy1) hy1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue; const k = ny * cw + nx; if (!cm[k] && !hl[k]) { hl[k] = hid; hs[sp++] = k; } }
    }
    if (!border && hn >= minPx * 0.5) holes.push({ hid, hx0, hx1, hy0, hy1 });
  }
  if (holes.length > 60 && depth < 7 && Math.max(cw, ch) > 60) {
    const vert = cw >= ch, mid = Math.floor((vert ? cw : ch) / 2);
    for (const [lo, hi] of [[0, mid + 2], [mid - 2, (vert ? cw : ch) - 1]]) {
      const sub = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const t = vert ? x : y; if (t >= lo && t <= hi) sub[y * cw + x] = cm[y * cw + x]; }
      // the half may fall apart into several pieces
      const lab = new Int32Array(cw * ch), st = new Int32Array(cw * ch); let id = 0;
      for (let i = 0; i < cw * ch; i++) {
        if (!sub[i] || lab[i]) continue; id++; let sp = 0, x0 = cw, x1 = 0, y0 = ch, y1 = 0, m = 0; st[sp++] = i; lab[i] = id;
        while (sp) { const j = st[--sp], x = j % cw, y = (j / cw) | 0; m++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (x > 0 && sub[j - 1] && !lab[j - 1]) { lab[j - 1] = id; st[sp++] = j - 1; } if (x < cw - 1 && sub[j + 1] && !lab[j + 1]) { lab[j + 1] = id; st[sp++] = j + 1; }
          if (y > 0 && sub[j - cw] && !lab[j - cw]) { lab[j - cw] = id; st[sp++] = j - cw; } if (y < ch - 1 && sub[j + cw] && !lab[j + cw]) { lab[j + cw] = id; st[sp++] = j + cw; } }
        if (m < minPx) continue;
        const sw = x1 - x0 + 3, sh = y1 - y0 + 3, sm = new Uint8Array(sw * sh);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (lab[y * cw + x] === id) sm[(y - y0 + 1) * sw + (x - x0 + 1)] = 1;
        traceCrop(D, sm, sw, sh, ox + x0 - 1, oy + y0 - 1, m, out, minPx, depth + 1);
      }
    }
    return;
  }
  const toMm = (dx, dy) => p => D.toMm(p[0] + dx + 0.5, p[1] + dy + 0.5);
  const outer = smoothPx(traceMask(cm, cw, ch)).map(toMm(ox, oy)); if (outer.length < 6) return;
  const holeList = [];
  for (const hh of holes) {
    const hw = hh.hx1 - hh.hx0 + 3, hH = hh.hy1 - hh.hy0 + 3, hm = new Uint8Array(hw * hH);
    for (let y = hh.hy0; y <= hh.hy1; y++) for (let x = hh.hx0; x <= hh.hx1; x++) if (hl[y * cw + x] === hh.hid) hm[(y - hh.hy0 + 1) * hw + (x - hh.hx0 + 1)] = 1;
    const hp = smoothPx(traceMask(hm, hw, hH), 0.5).map(toMm(ox + hh.hx0 - 1, oy + hh.hy0 - 1));
    if (hp.length > 5) holeList.push(hp);
  }
  const shape = solidShape(outer, holeList); if (!shape) return;
  out.push({ shape, n });
  // test builds: every traced piece must cover the pixels it came from
  if (globalThis.__decoCheck) { const A = Math.abs(THREE.ShapeUtils.area(shape.getPoints())) - shape.holes.reduce((t, q) => t + Math.abs(THREE.ShapeUtils.area(q.getPoints())), 0), px = n * D.res * D.res; if (Math.abs(A - px) > Math.max(0.6, px * 0.12)) globalThis.__decoCheck.push({ traced: +A.toFixed(2), pixels: +px.toFixed(2) }); }
}
function fastShapes(D, mask0, minPx = 30) {
  const mask = depinch(mask0, D.w, D.h);
  const { w, h } = D, lab = new Int32Array(w * h), stack = new Int32Array(w * h), comps = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i]) continue;
    const id = comps.length + 1; let sp = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, n = 0; stack[sp++] = i; lab[i] = id;
    while (sp) {
      const j = stack[--sp], x = j % w, y = (j / w) | 0; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[j - 1] && !lab[j - 1]) { lab[j - 1] = id; stack[sp++] = j - 1; }
      if (x < w - 1 && mask[j + 1] && !lab[j + 1]) { lab[j + 1] = id; stack[sp++] = j + 1; }
      if (y > 0 && mask[j - w] && !lab[j - w]) { lab[j - w] = id; stack[sp++] = j - w; }
      if (y < h - 1 && mask[j + w] && !lab[j + w]) { lab[j + w] = id; stack[sp++] = j + w; }
    }
    comps.push({ id, x0, x1, y0, y1, n });
  }
  const out = [];
  for (const c of comps) {
    if (c.n < minPx) continue;
    const cw = c.x1 - c.x0 + 3, ch = c.y1 - c.y0 + 3, cm = new Uint8Array(cw * ch);
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * w + x] === c.id) cm[(y - c.y0 + 1) * cw + (x - c.x0 + 1)] = 1;
    traceCrop(D, cm, cw, ch, c.x0 - 1, c.y0 - 1, c.n, out, minPx, 0);
  }
  if (globalThis.__decoCheck) { let tot = 0; for (let i = 0; i < mask.length; i++) tot += mask[i]; const kept = out.reduce((t, o) => t + o.n, 0); if (kept < tot * 0.97) globalThis.__decoCheck.push({ dropped: tot - kept, of: tot }); }
  return out;
}
function shapesToD(D, shapes) {
  clearD(D); mmSpace(D); const c = D.ctx; c.fillStyle = '#000'; c.beginPath();
  const add = pts => { pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); };
  for (const s of shapes) { add(s.getPoints(16)); s.holes.forEach(hh => add(hh.getPoints(16))); }
  c.fill('evenodd'); pxSpace(D); return readD(D);
}
function primsToD(D, prims) {
  clearD(D); mmSpace(D); const c = D.ctx; c.fillStyle = '#000';
  for (const p of prims) { c.beginPath(); if (p.circle) c.arc(p.circle[0], p.circle[1], p.circle[2], 0, Math.PI * 2); else { p.poly.forEach((q, i) => i ? c.lineTo(q.x, q.z) : c.moveTo(q.x, q.z)); c.closePath(); } c.fill(); }
  pxSpace(D); return readD(D);
}
// only the ink that is joined to the solid rim (pierced work: anything else would fall out)
function keepAttached(D, ink, band) {
  const { w, h } = D, lab = new Int32Array(w * h), stack = new Int32Array(w * h), keep = [0]; let id = 0;
  for (let i = 0; i < w * h; i++) {
    if (!ink[i] || lab[i]) continue; id++; let sp = 0, touch = false; stack[sp++] = i; lab[i] = id;
    while (sp) { const j = stack[--sp], x = j % w; if (band[j]) touch = true; for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) if (k >= 0 && k < w * h && ink[k] && !lab[k]) { lab[k] = id; stack[sp++] = k; } }
    keep.push(touch ? 1 : 0);
  }
  const o = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) o[i] = lab[i] && keep[lab[i]] ? 1 : 0; return o;
}
// s: { P, R, group, region (coarse mask of the surface), yTop, parts: [{shape, h, y, name, bevel, pierce?}],
//      window? (coarse mask that may be pierced), keep? (prims kept solid when pierced), keepOut? (prims never decorated) }
// Builds the parts themselves (plain, shortened under an engraving, or pierced) and the ornament; returns a note.
function decorate(s) {
  const { P, group } = s, pre = s.prefix || '', mat = mats.body, kind = P.deco; let cut = P.cut || 'relief'; const proc = P.proc === 'resin' ? 'resin' : 'fdm', S = DECO[proc];
  const seed = ((P.dseed | 0) || 1) * 101 + (s.seedOff || 0);
  const plainPart = pt => group.add(pt.useB ? slabB(pt.shape, pt.h, pt.y, mat, pt.name, pt.bevel, pt.bevBot || 0) : slab(pt.shape, pt.h, pt.y, mat, pt.name, pt.bevel));
  const plain = why => { s.parts.forEach(plainPart); return { done: false, why }; };
  if (!kind || kind === 'none') return plain('none');
  const regShapes = s.regionShapes || maskToShapes(s.R, s.region).map(r => r.shape); if (!regShapes.length) return plain('empty');
  const pts = regShapes.flatMap(sh => sh.getPoints(8)), bb = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
  pts.forEach(p => { bb.minX = Math.min(bb.minX, p.x); bb.maxX = Math.max(bb.maxX, p.x); bb.minZ = Math.min(bb.minZ, p.y); bb.maxZ = Math.max(bb.maxZ, p.y); });
  const D = makeDRaster(bb, 1.5);
  const keepOut = s.keepOut && s.keepOut.length ? primsToD(D, s.keepOut) : null;
  let fallback = false;
  if (cut === 'pierce' && s.window) {
    const winD = shapesToD(D, maskToShapes(s.R, s.window).map(r => r.shape)), keepD = s.keep && s.keep.length ? primsToD(D, s.keep) : null;
    const plans = s.parts.filter(pt => pt.pierce).map(pp => {
      const partD = shapesToD(D, [pp.shape]);
      const border = Math.max(S.ring * 0.75, 2 * (pp.bevel || 0) + 1.0); // the solid frame round the openwork, wide enough for its own edge rounding
      let W = andM(erodeM(D, winD, 0.3), erodeM(D, partD, border));
      if (keepD) W = andM(W, keepD, true); if (keepOut) W = andM(W, keepOut, true);
      return { pp, partD, W, area: countM(W) * D.res * D.res };
    });
    if (plans.some(pl => pl.area >= 20)) {
      let areaMm = 0;
      s.parts.filter(pt => !pt.pierce).forEach(plainPart);
      plans.forEach(({ pp, partD, W, area }, k) => {
        if (area < 20) { plainPart(pp); return; }
        const Wp = andM(dilateM(D, W, 1.0), partD);
        const ink = keepAttached(D, patternInk(kind, D, Wp, proc, seed + 17 * k, true), andM(Wp, W, true));
        fastShapes(D, andM(partD, W, true)).forEach(q => plainPart({ ...pp, shape: q.shape }));
        const onBed = pp.y < 0.01; // filigree in a floor starts on the bed with everything else
        fastShapes(D, ink).forEach(q => group.add(slab(q.shape, pp.h - (onBed ? 0.03 : 0.06), pp.y + (onBed ? 0 : 0.03), mat, pre + 'filigree')));
        areaMm += area;
      });
      return { done: true, cut, areaMm };
    }
  }
  // pierced work needs open space beneath it; where there is none, the pattern is engraved instead
  if (cut === 'pierce') { cut = 'engrave'; fallback = true; }
  const maxBev = Math.max(0, ...s.parts.map(pt => pt.bevel || 0));
  const ring = cut === 'engrave' ? Math.max(1.6, S.ring * 0.7) : Math.max(1.2, maxBev + 0.6, S.ring * 0.6);
  const reg = shapesToD(D, regShapes), dist = edt(reg, D.w, D.h, true), bPx = ring / D.res;
  let area = new Uint8Array(reg.length); for (let i = 0; i < area.length; i++) area[i] = dist[i] > bPx ? 1 : 0;
  if (keepOut) area = andM(area, keepOut, true);
  const areaMm = countM(area) * D.res * D.res; if (areaMm < 8) return plain('small');
  const ink = patternInk(kind, D, area, proc, seed, false);
  if (cut === 'relief') {
    s.parts.forEach(plainPart);
    fastShapes(D, ink).forEach(q => group.add(slab(q.shape, S.depth + 0.05, s.yTop - 0.05, mat, pre + 'decor-relief')));
    return { done: true, cut, areaMm, ring };
  }
  // engraved: the parts stop `depth` short of the top, and one top layer — the whole surface less the cuts — finishes it
  // (a part with the usual all-round rounding keeps it, shortened; the top layer reaches down past that rounding so
  //  it never shows as a groove round the case)
  const d = S.depth, under = Math.max(0, ...s.parts.filter(pt => !pt.useB).map(pt => pt.bevel || 0));
  s.parts.forEach(pt => group.add(pt.useB ? slabB(pt.shape, pt.h - d, pt.y, mat, pt.name, 0, pt.bevBot || 0) : slab(pt.shape, pt.h - d, pt.y, mat, pt.name, pt.bevel)));
  // the surface is re-traced here, and tracing can close a hole by a pixel: pulling every edge back a little over a pixel keeps
  // peg holes and slots at least as open as the parts below them
  const top = andM(erodeM(D, reg, Math.max(0.12, D.res * 1.3)), ink, true);
  fastShapes(D, top).forEach(q => group.add(slab(q.shape, d + under + 0.05, s.yTop - d - under - 0.05, mat, pre + 'decor-top')));
  return { done: true, cut, areaMm, ring, fallback };
}
const rowsCut = (mask, R, zc, keepAbove) => { const py = (zc - R.z0) / RES; const m = new Uint8Array(mask.length); for (let y = 0; y < R.h; y++) { const keep = keepAbove ? y >= py : y < py; if (keep) for (let x = 0; x < R.w; x++) m[y * R.w + x] = mask[y * R.w + x]; } return m; };
const or = (m1, m2) => { const m = new Uint8Array(m1.length); for (let i = 0; i < m.length; i++) m[i] = m1[i] || m2[i] ? 1 : 0; return m; };
const shrinkPx = (m0, R, n) => { let m = m0; for (let k = 0; k < n; k++) { const o = new Uint8Array(m.length); for (let y = 1; y < R.h - 1; y++) for (let x = 1; x < R.w - 1; x++) { const i = y * R.w + x; o[i] = m[i] && m[i - 1] && m[i + 1] && m[i - R.w] && m[i + R.w] ? 1 : 0; } m = o; } return m; };
const and = (m1, m2, not) => { const m = new Uint8Array(m1.length); for (let i = 0; i < m.length; i++) m[i] = m1[i] && (not ? !m2[i] : m2[i]) ? 1 : 0; return m; };
const halfMask = (mask, R, sign) => { const m = new Uint8Array(mask.length); const px0 = (0 - R.x0) / RES; for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) if (mask[y * R.w + x] && (sign > 0 ? x >= px0 : x < px0)) m[y * R.w + x] = 1; return m; };
const rowShift = (mask, R, dz) => { const dy = Math.round(dz / RES); const m = new Uint8Array(mask.length); for (let y = 0; y < R.h; y++) { const sy = y - dy; if (sy < 0 || sy >= R.h) continue; m.set(mask.subarray(sy * R.w, sy * R.w + R.w), y * R.w); } return m; };
const shift = (prims, dx) => prims.map(p => p.circle ? { circle: [p.circle[0] + dx, p.circle[1], p.circle[2]] } : { poly: p.poly.map(q => ({ x: q.x + dx, z: q.z })) });

function monogramTexture(txt, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 192; const x = c.getContext('2d');
  x.fillStyle = color; x.font = '400 170px "Instrument Serif", Georgia, "Times New Roman", serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, 256, 100);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// Engine state shared with the UI: which turn-buttons are locked, the button meshes, the traced outline, the lid group.
export const state = { locks: [true, true], buttons: [], trace: null, lidGroup: null };

// Draws a plausible "photo" of the current parametric harp on graph paper, for people who want to try the tracer.
export function sampleHarpImage(P) {
  const W = 1200, H = 800, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = '#f6f4ee'; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(70,110,170,.28)'; x.lineWidth = 1;
  for (let i = 0; i <= W; i += 40) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
  for (let i = 0; i <= H; i += 40) { x.beginPath(); x.moveTo(0, i); x.lineTo(W, i); x.stroke(); }
  const hp = parametricHarp(P);
  const k = 40 / 10; // 10 mm per grid square → 4 px/mm
  const X = z => W / 2 + z * k, Y = xx => H / 2 + xx * k;
  const poly = (p, fill) => { x.fillStyle = fill; x.beginPath(); p.poly.forEach((q, i) => i ? x.lineTo(X(q.z), Y(q.x)) : x.moveTo(X(q.z), Y(q.x))); x.closePath(); x.fill(); };
  x.save(); x.translate(6, 8); hp.framePrims.forEach(p => poly(p, 'rgba(0,0,0,.10)')); x.restore();
  hp.framePrims.forEach(p => poly(p, '#3a3140'));
  hp.holePrims.forEach(p => poly(p, '#f6f4ee'));
  poly(hp.reedPrim, '#7a62a8');
  x.fillStyle = '#7a62a8'; x.fillRect(X(hp.trigger.z), Y(-hp.reedW / 2 - 1), 3 * k, (hp.reedW + 2) * k);
  x.fillStyle = '#6b6672'; x.font = '22px "IBM Plex Mono", monospace'; x.fillText('1 square = 10 mm  ·  sample harp, ' + P.len.toFixed(1) + ' in', 24, H - 24);
  return c.toDataURL('image/png');
}

// A traced outline carries the photo's noise: the edge wanders a few tenths of a millimetre from pixel to pixel, and a
// shadow or a highlight can add or take away a millimetre over a short stretch. Cut a pocket straight from that and the
// wall copies every wobble. So the pocket is cut from a fitted outline instead: the trace grown by a photo allowance,
// blurred and re-thresholded (which rounds off the wobbles on a ~2 mm scale), then joined with the grown trace again,
// so the result is smooth and can only ever be roomier than the harp, never tighter.
export const PHOTO_ALLOWANCE = 0.6;
const HOOD_EDGE = 1.2; // the rounding along the top of the hood and its roof, the same on both so they read as one // mm on each side, on top of the pocket clearance: what a photo cannot measure to
function fitOutline(outline, allowance = PHOTO_ALLOWANCE, sigma = 1.8) {
  const Rt = makeRaster(bboxOf(outline), allowance + 4 * sigma + 3), m = maskOf(Rt, [{ poly: outline }], allowance), { w, h } = Rt;
  let f = Float32Array.from(m), g = new Float32Array(w * h);
  const r = Math.max(1, Math.round(sigma / RES)); // three box passes ≈ a Gaussian
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) { let acc = 0; const o = y * w; for (let x = -r; x < w + r; x++) { if (x + r < w && x + r >= 0) acc += f[o + x + r]; if (x - r - 1 >= 0 && x - r - 1 < w) acc -= f[o + x - r - 1]; if (x >= 0 && x < w) g[o + x] = acc / (2 * r + 1); } }
    for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y < h + r; y++) { if (y + r < h && y + r >= 0) acc += g[(y + r) * w + x]; if (y - r - 1 >= 0 && y - r - 1 < h) acc -= g[(y - r - 1) * w + x]; if (y >= 0 && y < h) f[y * w + x] = acc / (2 * r + 1); } }
  }
  const out = new Uint8Array(w * h); for (let i = 0; i < out.length; i++) out[i] = m[i] || f[i] > 0.42 ? 1 : 0;
  return contour(Rt, out);
}
export function build(P) {
  const style = P.style, tH = P.trig * IN, wall = P.wall, clr = P.clr, floorT = 3, frameH = Math.min(10, Math.max(2, +P.thick || 4)), bevel = 1.6, feltT = 0.6;
  // print-in-place: every moving part is separated from the body by `gap` of air; the captive head lives in a chamber between yC0 and yC1
  const gap = Math.min(0.6, Math.max(0.3, P.gap || 0.4)), pegR = 2, headR = 3, headH = 1.6, chamR = headR + gap, yC0 = floorT, chamH = headH + 2 * gap, yC1 = yC0 + chamH;
  const { locks, buttons } = state; const trace = state.trace;
  buttons.length = 0; // every clickable moving part registers here as it is built
  const g = new THREE.Group(); g.name = 'jaw-harp-case'; state.lidGroup = null; state.harpGroup = null;
  const decoOn = !!(P.deco && P.deco !== 'none'), decoNotes = []; // what the ornament ended up on, for the fit check
  const HOLDS = ['bladeSide', 'bladeTop', 'spine', 'twin', 'lash', 'slide', 'swing'];
  const holdKind = style === 'deck' || style === 'pendant' ? (HOLDS.includes(P.hold) ? P.hold : 'bladeSide') : null;
  const bladeHold = holdKind === 'bladeSide' || holdKind === 'bladeTop';
  const slideLatch = bladeHold || holdKind === 'spine' || holdKind === 'twin'; // the four sliding-latch holds share one set of dimensions
  const hasButtons = style === 'multi'; // the rack keeps captive turn-buttons (with a recess for the pad's sweep)

  let harpPrims, bayPrims, framePrims, holePrims, windows, trigger, reedW, frameT, hL, hW, zRing, armL, span, zNeck, zTip, bowB, zBack;
  if (trace && style !== 'multi') {
    harpPrims = [{ poly: trace.outline }]; bayPrims = [{ poly: fitOutline(trace.outline) }]; trigger = trace.trigger; // the pocket follows the fitted outline
    const bb = bboxOf(trace.outline); hL = bb.maxZ - bb.minZ; hW = bb.maxX - bb.minX; reedW = 6; frameT = P.arm;
    zRing = trace.outline.reduce((a, p) => p.x > a.x ? p : a, { x: -1e9 }).z; armL = hL * 0.55; bowB = hW / 2;
  } else {
    const hp = parametricHarp(P);
    ({ hL, hW, frameT, span, reedW, zRing, zNeck, zTip, armL, trigger, framePrims, harpPrims, bayPrims, holePrims, windows, zBack } = hp); bowB = hp.b;
  }
  const traced = !!(trace && style !== 'multi');
  const nb = style === 'multi' ? P.bays : 1, pitch = hW + 2 * clr + wall + 3;
  const offs = Array.from({ length: nb }, (_, i) => (i - (nb - 1) / 2) * pitch);
  const allBay = offs.flatMap(dx => shift(bayPrims, dx));
  const hb0 = bboxOf(allBay.flatMap(p => p.circle ? [{ x: p.circle[0] - p.circle[2], z: p.circle[1] - p.circle[2] }, { x: p.circle[0] + p.circle[2], z: p.circle[1] + p.circle[2] }] : p.poly));
  const chanPrims = style === 'sleeve' ? allBay.concat([rect(-hW / 2, hb0.minZ - 30, hW / 2, zRing)]) : allBay;
  const tabW = 18, holeR = 3.25, rT = 5;
  const LASH = { hw: 1.7, hl: 2.6, off: 3.7, groove: 4.5, deep: 2 }; // slot half-width/half-length, offset from the pocket, groove half-width and depth
  const holdD = slideLatch ? latchDims(holdKind, clr, frameT, gap, wall) : null;
  // the bail tab must carry the whole spine bolt groove and still leave 1.5 mm before the bail hole
  const tabL = style === 'clam' ? 24 : holdKind === 'spine' && holdD ? Math.max(24, Math.ceil(holdD.tunnelEnd + 12.75 - wall + 1)) : 14;
  const R = makeRaster(hb0, clr + wall + tabL + 12);

  const pockets = offs.map(dx => contour(R, maskOf(R, shift(bayPrims, dx), clr)));
  const felts = offs.map(dx => contour(R, maskOf(R, shift(bayPrims, dx), clr - 0.2)));
  let pocketMask = maskOf(R, allBay, clr);
  const pb = bboxOf(pockets.flat());
  const bailEnd = style === 'sleeve' ? 1 : -1;
  const tabX = bailEnd < 0 ? (() => { const end = pockets.flat().filter(p => p.z < pb.minZ + 3); return end.reduce((s, p) => s + p.x, 0) / (end.length || 1); })() : 0;
  const zOutMin = pb.minZ - wall, zOutMax = pb.maxZ + wall;
  const tab = bailEnd < 0 ? rect(tabX - tabW / 2 + rT, zOutMin - tabL + rT, tabX + tabW / 2 - rT, zOutMin + 6) : rect(tabX - tabW / 2 + rT, zOutMax - 6, tabX + tabW / 2 - rT, zOutMax + tabL - rT);
  const holeZ = bailEnd < 0 ? zOutMin - tabL + tabW / 2 - 1 : zOutMax + tabL - tabW / 2 + 1;
  const zc = pb.minZ + 2;
  const zStep = pb.maxZ - (P.hood / 100) * (pb.maxZ - pb.minZ);
  // Under the hood roof the harp can only leave by sliding back until its trigger end is out from under the roof strip,
  // then lifting. So the pocket under the hood is swept backwards by that slide (`slideOut`): a harp whose arm tips are
  // wider than the arms behind them would otherwise be locked in for good.
  const roofedStyle = style === 'deck' || style === 'pendant';
  const zRoof = Math.max(zStep + 1, trigger.z - 7);
  const roofOn = P.roof !== false; // the roof over the reed tip can be left off: then only the bow latches hold the harp
  const slideOut = roofedStyle && roofOn ? Math.max(0, hb0.maxZ + clr - zRoof + 1) : 0;
  if (slideOut > 0) {
    // only rows at or beyond the hood step are opened up; the deck pocket around the bow keeps its snug wall
    const cut = rowsCut(rowShift(pocketMask, R, -slideOut), R, zStep, true);
    pocketMask = or(pocketMask, cut);
    pockets[0] = contour(R, pocketMask);
  }
  const pivotOff = 4.25, bossR = 4.6, sides = [], lidT = 3;
  const gateOff = 5; // sleeve gate: pivot post just outside the mouth, clear of the channel
  // footprint: the hull of the pockets (the straight channel for the sleeve), offset by clearance + wall, cut at the sleeve mouth
  const footprint = [{ poly: hull(style === 'sleeve' ? chanPrims : allBay) }];
  let bodyMask = maskOf(R, footprint, clr + wall); if (style === 'sleeve') bodyMask = rowsCut(bodyMask, R, zc, true);
  if (style === 'sleeve') {
    sides.push({ x: -(hW / 2 + clr + gateOff), z: zc - 3, sg: -1, gate: true });
  } else if (holdKind === 'swing') {
    // a turn-button each side of the bow, on the same captive Ø4 peg the rack uses — the stoutest thing here
    sides.push({ x: pb.minX - pivotOff, z: zRing, sg: -1 }, { x: pb.maxX + pivotOff, z: zRing, sg: 1 });
  } else if (hasButtons) {
    if (traced) { /* rack never uses a traced outline */
      const wide = pockets[0].filter(p => p.z < zStep - 6);
      const rgt = wide.reduce((a, p) => p.x > a.x ? p : a, { x: -1e9 }), lft = wide.reduce((a, p) => p.x < a.x ? p : a, { x: 1e9 });
      sides.push({ x: rgt.x + pivotOff, z: rgt.z, sg: 1 }, { x: lft.x - pivotOff, z: lft.z, sg: -1 });
    } else {
      sides.push({ x: offs[0] - hW / 2 - clr - pivotOff, z: zRing, sg: -1 }, { x: offs[nb - 1] + hW / 2 + clr + pivotOff, z: zRing, sg: 1 });
      for (let i = 0; i < nb - 1; i++) sides.push({ x: (offs[i] + offs[i + 1]) / 2, z: zRing, sg: 1, double: true });
    }
  }
  const bosses = sides.map(s => ({ circle: [s.x, s.z, bossR] }));
  const bossMask = bosses.length ? maskOf(R, bosses, 0) : null;
  const outerNoTab = bossMask ? or(bodyMask, bossMask) : bodyMask;
  // the clamshell always has an end tab: it carries the bolt keeper (and the bail hole when wanted)
  const raise = style === 'multi' ? 1.5 : 0; // rack: pocket floor raised so the frame top meets the deck surface
  const frameTop = floorT + feltT + frameH;
  // deck height: 1.5 mm over the frame normally; the hidden blades need a 2.4 mm tunnel plus a 1.6 mm roof above the frame
  const Dlow = bladeHold ? frameTop + 4 : frameTop + 1.5;
  // hood height: deck styles get a roof over the trigger end (+3), so the harp's tips are held by the trigger under it
  const roofed = style === 'deck' || style === 'pendant' || style === 'multi';
  // tH is the harp's whole height lying flat, underside to the top of the trigger. Roofed styles leave 2 mm of play above it
  // (the tip end can lift that much before the trigger meets the roof), then the 3 mm roof itself.
  const D = floorT + feltT + Math.max(tH, frameH + 1.5) + (roofed && roofOn ? 5 : 3) + raise; // without a roof the walls only need to clear the trigger // a harp is always taller than its frame is thick
  // hold hardware lives on lugs added to the footprint: the tab for the spine bolt, side lugs for the top blades and twin bolts
  const pbx = { minX: pb.minX, maxX: pb.maxX }; // pocket extremes (widest at the bow)
  const lugPrims = [];
  const lugLen = 15.5, lugHalf = 6.5; // lug reaches 15.5 mm from the pocket edge; the wall already gives `wall` of that
  if (holdKind === 'lash') { // just enough pad each side to carry a slot: 2 mm of material inboard, 2.6 outboard
    const ext = LASH.off + LASH.hw + 2.6, half = LASH.hl + LASH.hw + 3;
    lugPrims.push(rect(pbx.minX - ext + rT, zRing - half + rT, pbx.minX + 2, zRing + half - rT), rect(pbx.maxX - 2, zRing - half + rT, pbx.maxX + ext - rT, zRing + half - rT));
  }
  if (holdKind === 'twin' || holdKind === 'bladeTop') {
    const ext = holdKind === 'twin' ? Math.max(lugLen, holdD.chanEnd + 1.5) : Math.max(19, holdD.tunnelEnd + 3); // the lug always reaches past the channel's back wall / the tunnel's end
    lugPrims.push(rect(pbx.minX - ext + rT, zRing - lugHalf + rT, pbx.minX + 2, zRing + lugHalf - rT), rect(pbx.maxX - 2, zRing - lugHalf + rT, pbx.maxX + ext - rT, zRing + lugHalf - rT));
  }
  // Cord lashing: the slots sit right against the pocket wall so the cord comes up beside the harp, and a groove
  // across the deck top sinks it below the frame's top face at both edges, so it clamps down instead of arching over.
  const lashAt = holdKind === 'lash' ? [{ x: pbx.minX - LASH.off, z: zRing }, { x: pbx.maxX + LASH.off, z: zRing }] : [];
  const lashGroove = holdKind === 'lash' ? maskOf(R, [rect(-2000, zRing - LASH.groove, 2000, zRing + LASH.groove)], 0) : null;
  const lugMask = lugPrims.length ? maskOf(R, lugPrims, rT) : null;
  let outerMask = outerNoTab; if (P.bail || style === 'clam' || holdKind === 'spine') outerMask = or(outerMask, maskOf(R, [tab], rT));
  if (lugMask) outerMask = or(outerMask, lugMask);
  const outer = contour(R, outerMask), ob = bboxOf(outer), obNT = bboxOf(contour(R, outerNoTab));
  const hoodRing = pb.minZ > zStep + 2;
  let hoodMask = rowsCut(outerNoTab, R, zStep, true); if (!hoodRing) hoodMask = and(hoodMask, pocketMask, true);
  const hood = contour(R, hoodMask);
  const addBail = s => { if (!P.bail) return; s.holes.push(circlePath(tabX, holeZ, holeR)); };

  const pegHole = sh => sides.forEach(s => sh.holes.push(circlePath(s.x, s.z, pegR + 0.3)));
  const chamHole = sh => sides.forEach(s => sh.holes.push(circlePath(s.x, s.z, chamR)));
  if (style === 'sleeve') {
    const chanMask = rowsCut(maskOf(R, chanPrims, clr), R, zc, true);
    const floorS = shapeOf(outer); addBail(floorS); g.add(slabB(floorS, floorT, 0, mats.body, 'floor', 0, 0.8));
    const wallPts = contour(R, and(outerMask, chanMask, true));
    const wMid = shapeOf(wallPts), wUp = shapeOf(wallPts); addBail(wMid); addBail(wUp); chamHole(wMid); pegHole(wUp);
    g.add(slab(wMid, chamH, yC0, mats.body, 'walls-lower')); g.add(slab(wUp, Dlow - yC1, yC1, mats.body, 'walls'));
    // the gate post stands above the roof line so the bar swings over it
    sides.forEach(s => { const ps = shapeOf(contour(R, and(outerMask, maskOf(R, [{ circle: [s.x, s.z, bossR] }], 0)))); ps.holes.push(circlePath(s.x, s.z, pegR + 0.3)); g.add(slab(ps, 2.4 + gap, Dlow, mats.body, 'gate-post')); });
    const roofT = 2.4, slotW = reedW + 2 * clr + 1.5;
    const roofMask = and(rowsCut(rowsCut(outerNoTab, R, zc, true), R, zStep + 0.01, false), maskOf(R, [rect(-slotW / 2, zc - 5, slotW / 2, zStep + 5)], 0), true);
    const halves = [1, -1].map(sg => ({ shape: shapeOf(contour(R, halfMask(roofMask, R, sg))), h: roofT, y: Dlow, name: 'roof-' + (sg > 0 ? 'right' : 'left'), bevel: 0.6, pierce: true }));
    if (decoOn) {
      decoNotes.push({ where: 'roof', ...decorate({ P, R, group: g, region: roofMask, yTop: Dlow + roofT, parts: halves, window: and(roofMask, chanMask), seedOff: 1 }) });
      decoNotes.push({ where: 'hood', ...decorate({ P, R, group: g, region: hoodMask, yTop: D, parts: [{ shape: shapeOf(hood), h: D - Dlow + 1, y: Dlow - 1, name: 'hood', bevel: HOOD_EDGE, bevBot: 0, useB: true }], seedOff: 2 }) });
    } else {
      halves.forEach(pt => g.add(slab(pt.shape, pt.h, pt.y, mats.body, pt.name, pt.bevel)));
      g.add(slabB(shapeOf(hood), D - Dlow + 1, Dlow - 1, mats.body, 'hood', HOOD_EDGE, 0)); // one piece with the walls below it
    }
    g.add(slab(shapeOf(contour(R, and(rowsCut(maskOf(R, chanPrims, clr - 0.2), R, zc + 0.2, true), chanMask))), feltT, floorT, mats.felt, 'lining'));
  } else {
    // a deck layer: the outline with the pockets (and bail) as holes, or — when a notch joins a pocket to the outside — traced from a mask
    // a deck layer as a list of {shape, mask}: the plain outline with pockets as holes, or — when a notch is cut into it —
    // every solid piece of the (outline − pockets − notch) mask, islands included
    const deckLayer = (notch, noSlots) => {
      if (!notch) { const d = shapeOf(outer); pockets.forEach(p => d.holes.push(pathOf(p))); if (!noSlots) lashAt.forEach(q => d.holes.push(pathOf(slotPts(q.x, q.z, LASH.hw, LASH.hl)))); addBail(d); return [{ shape: d, mask: outerMask }]; }
      const list = maskToShapes(R, and(and(outerMask, pocketMask, true), notch, true));
      list.sort((a, b) => b.mask.reduce((x, v) => x + v, 0) - a.mask.reduce((x, v) => x + v, 0));
      if (!noSlots) lashAt.forEach(q => slotAt(list, q.x, q.z));
      if (P.bail && list.length) holeAt(list, tabX, holeZ, holeR); // into whichever piece actually holds the bail tab (a hole outside its piece would be dropped by the triangulator and block the bail)
      return list;
    };
    // the deck's top layer is held back when it carries an ornament, and built by decorate() below
    const deckDecor = decoOn && (style === 'deck' || style === 'pendant' || style === 'multi') && holdKind !== 'slide', deckTops = [];
    const addLayer = (list, hgt, y, name, bt = 0, bb = 0) => {
      if (deckDecor && Math.abs(y + hgt - Dlow) < 1e-6 && name !== 'deck-floor') { deckTops.push({ list, hgt, y, name, bt, bb }); return; }
      list.forEach(l => g.add(slabB(l.shape, hgt, y, mats.body, name, bt, bb)));
    };
    // a hole at (x, z) goes into whichever piece of the layer contains that point
    const slotAt = (list, x, z) => { const [px, py] = R.toPx(x, z), k = (py | 0) * R.w + (px | 0); const l = list.find(q => q.mask[k]) || list[0]; if (l) l.shape.holes.push(pathOf(slotPts(x, z, LASH.hw, LASH.hl))); };
    const holeAt = (list, x, z, r) => { const [px, py] = R.toPx(x, z), k = (py | 0) * R.w + (px | 0); const l = list.find(q => q.mask[k]) || list[0]; if (l) l.shape.holes.push(circlePath(x, z, r)); };
    addLayer(deckLayer(), floorT, 0, 'deck-floor', 0, 0.8);
    if (style === 'clam') {
      addLayer(deckLayer(), Dlow - floorT, floorT, 'deck', 0.8, 0);
    } else if (style === 'multi' || holdKind === 'swing') {
      // rack: captive turn-buttons. The pocket floor is 1.5 mm higher than in the other styles, so the frame's top sits at the
      // deck surface and the bar itself bears on it — no pad hanging below the deck, nothing to sweep through.
      const dMid = deckLayer(), dUp = deckLayer(); sides.forEach(s => { holeAt(dMid, s.x, s.z, chamR); holeAt(dUp, s.x, s.z, pegR + 0.3); });
      addLayer(dMid, chamH, yC0, 'deck-chamber'); addLayer(dUp, Dlow - yC1, yC1, 'deck', 0.8, 0);
    } else {
      buildHold(g, holdKind, { P, deckLayer, addLayer, frameTop, Dlow, floorT, xL: pbx.minX, xR: pbx.maxX, zRing, clr, frameT, wall, gap, R, tabX, zEnd: pb.minZ, footprint, outerNoTab, zStep, obNT, pb, lashGroove, LASH });
    }
    if (deckTops.length) {
      // keep the ornament off anything that moves across or sits on the deck
      const keepOut = [];
      if (holdKind === 'bladeTop') [pbx.minX, pbx.maxX].forEach((x, k) => keepOut.push(k ? rect(x - 3, zRing - 10, x + 30, zRing + 10) : rect(x - 30, zRing - 10, x + 3, zRing + 10)));
      if (holdKind === 'twin' || holdKind === 'lash') keepOut.push(rect(-1e4, zRing - 9, 1e4, zRing + 9));
      if (holdKind === 'spine') keepOut.push(rect(tabX - 8, -1e4, tabX + 8, pb.minZ + (holdD ? holdD.tunnelEnd : 12) + 3));
      if (roofed) keepOut.push(rect(-1e4, zStep - 0.5, 1e4, 1e4)); // under the hood: covered, so not worth drawing
      sides.forEach(sd => { const reach = sd.double ? (wall + 3) / 2 + clr + frameT + 3 : pivotOff + clr + frameT + 3; keepOut.push({ circle: [sd.x, sd.z, reach + 5] }); });
      const parts = deckTops.flatMap(t => t.list.map(l => ({ shape: l.shape, h: t.hgt, y: t.y, name: t.name, bevel: t.bt, bevBot: t.bb, useB: true })));
      decoNotes.push({ where: 'deck', ...decorate({ P, R, group: g, regionShapes: parts.map(pt => pt.shape), yTop: Dlow, parts, keepOut, seedOff: 5 }) });
    }
    if (roofed) {
      const hoodS = shapeOf(hood); if (hoodRing) pockets.forEach(p => hoodS.holes.push(pathOf(p)));
      // the roof sits 0.4 mm inside the hood's outline, so its rounded top edge hides inside the hood's and the two never
      // share a vertex (shared vertices across separate shells get welded by slicers into a non-manifold mess)
      const roofM = shrinkPx(rowsCut(outerNoTab, R, zRoof, true), R, 2), roofS = shapeOf(contour(R, roofM));
      // The hood is one piece with the deck: it reaches 1 mm down into it (over the deck's rounded top edge, which
      // would otherwise leave a groove all round its foot) and is rounded only along its top. The roof likewise has
      // no rounding underneath, so no seam shows where it meets the walls.
      const hoodPart = { shape: hoodS, h: D - Dlow + 1, y: Dlow - 1, name: 'hood', bevel: HOOD_EDGE, bevBot: 0, useB: true };
      const roofPart = { shape: roofS, h: 3, y: D - 3, name: 'hood-roof', bevel: HOOD_EDGE, bevBot: 0, useB: true, pierce: true };
      if (decoOn) {
        // the ornament runs over the whole top of the hood; pierced, it opens the roof over the pocket, keeping a
        // solid pad where the trigger bears on it (that pad is what holds the harp's tip end down)
        const hw = reedW / 2 + 2.5, pads = offs.map(dx => rect(trigger.x + dx - hw, trigger.z - 4, trigger.x + dx + hw, trigger.z + 7));
        const hoodEff = hoodRing ? and(hoodMask, pocketMask, true) : hoodMask;
        decoNotes.push({ where: 'hood', ...decorate({ P, R, group: g, region: roofOn ? or(hoodEff, roofM) : hoodEff, yTop: D,
          parts: roofOn ? [hoodPart, roofPart] : [hoodPart], window: roofOn ? and(roofM, pocketMask) : null, keep: pads }) });
      } else {
        g.add(slabB(hoodPart.shape, hoodPart.h, hoodPart.y, mats.body, 'hood', HOOD_EDGE, 0));
        if (roofOn) g.add(slabB(roofS, 3, D - 3, mats.body, 'hood-roof', HOOD_EDGE, 0));
      }
    }
    pockets.forEach((p, i) => {
      const fS = shapeOf(p), lS = shapeOf(felts[i]), floorName = 'pocket-floor' + (nb > 1 ? '-' + (i + 1) : '');
      let floorDone = false;
      if (style === 'pendant') {
        // windows under the ring and under the reed only — every bar of the frame stays on solid floor
        const wins = (traced ? [contour(R, maskOf(R, [{ poly: trace.outline }], clr - 6))] : windows.map(w => contour(R, maskOf(R, shift([w], offs[i]), 0)))).filter(w => w.length > 8);
        wins.forEach(w => lS.holes.push(pathOf(w)));
        if (decoOn && P.cut === 'pierce' && wins.length) {
          // pierced: the windows fill with filigree instead of standing open. The floor prints flat on the bed, so this
          // works on a filament printer as well as in resin.
          decoNotes.push({ where: 'floor', bed: true, ...decorate({ P, R, group: g, regionShapes: [shapeOf(p)], yTop: floorT + raise, window: maskOf(R, wins.map(w => ({ poly: w })), 0), seedOff: 6 + i,
            parts: [{ shape: shapeOf(p), h: floorT + raise, y: 0.001, name: floorName, bevel: 0, pierce: true }] }) });
          floorDone = true;
        } else wins.forEach(w => fS.holes.push(pathOf(w)));
      }
      if (!floorDone) g.add(slab(fS, floorT + raise, 0.001, mats.body, floorName));
      g.add(slab(lS, feltT, floorT + raise, mats.felt, 'lining' + (nb > 1 ? '-' + (i + 1) : '')));
    });
  }

  // turn-buttons, print-in-place captive pivot
  const barW = 7, barT = 3, padH = Dlow + gap - (floorT + feltT + frameH + gap);
  sides.forEach((s, k) => {
    const reach = s.gate ? hW / 2 + clr + gateOff : s.double ? (wall + 3) / 2 + clr + frameT + 3 : pivotOff + clr + frameT + 3;
    const bar = new THREE.Shape(); const x0 = s.double ? -reach : 0;
    bar.moveTo(x0, barW / 2); bar.absarc(x0, 0, barW / 2, Math.PI / 2, -Math.PI / 2, false); bar.absarc(reach, 0, barW / 2, -Math.PI / 2, Math.PI / 2, false); bar.closePath();
    bar.holes.push(circlePath(3.2, 0, 0.6 + gap + 0.6)); // detent: a bump on the body sits in this hole when locked (the 0.6 bevel closes the hole to 0.6+gap at the faces); a 0.3 mm lift lets the bar turn
    const m = slab(bar, barT, 0, mats.accent, (s.gate ? 'gate-button' : 'turn-button-' + (k + 1)), 0.6);
    const yBar = s.gate ? Dlow + 2.4 + 2 * gap : Dlow + gap; // the gate bar clears the roof
    m.position.set(s.x, yBar, s.z);
    // gate: locked = bar across the mouth (+x), open = swung away from the case (−z)
    const base = s.gate ? 0 : s.double ? 0 : (s.sg > 0 ? Math.PI : 0);
    m.userData = { button: k, base, open: base + (s.gate ? 1 : s.double ? 1 : s.sg) * Math.PI / 2 };
    m.rotation.y = P.printPose ? base : (locks[k] ?? true) ? base : m.userData.open;
    const bump = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, gap + 0.3, 16), mats.body); bump.position.set(s.x + 3.2 * Math.cos(base), yBar - gap + (gap + 0.3) / 2, s.z - 3.2 * Math.sin(base)); bump.name = 'detent'; g.add(bump);
    if (s.gate) {
      // a deep pad hangs in front of the ring and blocks it from sliding back out
      const padG = yBar - (floorT + feltT + 0.3);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(Math.min(hW * 0.6, 12), padG, 3), mats.accent); pad.position.set(reach, -padG / 2, 0); pad.name = 'gate-pad'; m.add(pad);
    } else if (style !== 'multi') (s.double ? [1, -1] : [1]).forEach(d => { const padX = (s.double ? (wall + 3) / 2 : pivotOff) + clr + frameT / 2 + 0.7; /* pad sits clear of the pocket wall */ const pad = new THREE.Mesh(new THREE.BoxGeometry(frameT + 1, padH, barW - 1), mats.accent); pad.position.set(d * padX, -padH / 2, 0); pad.name = 'button-pad'; m.add(pad); });
    const yHead = yC0 + gap, pegL = yBar - yHead - headH;
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(pegR, pegR, pegL + 0.2, 32), mats.accent); peg.position.set(0, -pegL / 2 + 0.1, 0); peg.name = 'pivot-peg'; m.add(peg);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(headR, headR, headH, 32), mats.accent); head.position.set(0, -pegL - headH / 2, 0); head.name = 'captive-head'; m.add(head);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(barW - 2, 0.8, 1.2), mats.accent); grip.position.set(0, barT + 0.4, 0); grip.name = 'thumb-grip'; m.add(grip);
    buttons[k] = m; g.add(m);
  });
  while (locks.length < sides.length) locks.push(true);

  // clamshell: the lid is a flat plate carrying the hood as a closed box, so it prints plate-down with nothing beneath it;
  // the hinge axis sits one knuckle radius above the deck so the lid's knuckles end flush with its plate
  if (style === 'clam') {
    const hr = 3.2, bore = 1.0, axisX = obNT.maxX + hr + gap, axisY = Dlow + hr; // Ø2 bore for a 1.75 mm filament pin
    const lid = new THREE.Group(); lid.name = 'lid';
    sinkFloor = Dlow + 0.01; // lid parts that start at the deck top must not sink into the base
    const plateM = rowsCut(outerNoTab, R, zStep, false), plateS = shapeOf(contour(R, plateM));
    if (!decoOn) lid.add(slab(plateS, lidT, Dlow, mats.body, 'lid-plate', 0.8));
    const hoodWall = contour(R, and(rowsCut(outerNoTab, R, zStep, true), pocketMask, true));
    lid.add(slab(shapeOf(hoodWall), D + lidT - Dlow, Dlow, mats.body, 'lid-hood', 0.8, 0.01)); // 0.01 inset: no vertices shared with the plate's bevel
    const lroofM = rowsCut(outerNoTab, R, zStep - lidT, true), lroofS = shapeOf(contour(R, lroofM));
    if (decoOn) decoNotes.push({ where: 'lid-roof', ...decorate({ P, R, group: lid, prefix: 'lid-', region: lroofM, yTop: D + lidT, parts: [{ shape: lroofS, h: lidT, y: D, name: 'lid-roof', bevel: 0.8 }], seedOff: 3 }) });
    else lid.add(slab(lroofS, lidT, D, mats.body, 'lid-roof', 0.8));
    const capB = bboxOf(hood);
    const front = new THREE.Mesh(new THREE.BoxGeometry(capB.maxX - capB.minX - 0.6, D - Dlow - lidT + 0.01, lidT), mats.body); front.position.set((capB.maxX + capB.minX) / 2, Dlow + lidT + (D - Dlow - lidT) / 2, zStep - lidT / 2); front.name = 'lid-hood-front'; lid.add(front);
    // ---- sliding bolt latch: a bolt in a print-in-place channel on the plate slides 6 mm past the plate's end into a
    //      keeper tunnel standing on the end tab. Tunnel holds the bolt tip on four sides; a detent bump clicks it home. ----
    {
      const bW = 5, bH = 3, bL = 18, travel = 6, wallC = 1.6, roofC = 1.6, plateTop = Dlow + lidT, nubL = 2.4, nubU = 13, holeU = 9;
      const endPts = contour(R, rowsCut(outerNoTab, R, zStep, false)).filter(p => Math.abs(p.x - tabX) < bW / 2 + gap + wallC);
      const zE = endPts.length ? Math.min(...endPts.map(p => p.z)) : obNT.minZ; // the plate's end at the tab
      const chW = bW / 2 + gap + wallC, chH = gap + bH + gap, z0 = zE + 1, z1 = z0 + bL + gap + wallC;
      [1, -1].forEach(sg => { const wl = new THREE.Mesh(new THREE.BoxGeometry(wallC, chH, z1 - z0), mats.body); wl.position.set(tabX + sg * (chW - wallC / 2), plateTop + chH / 2, (z0 + z1) / 2); wl.name = 'bolt-channel'; lid.add(wl); });
      const back = new THREE.Mesh(new THREE.BoxGeometry(2 * chW, chH, wallC), mats.body); back.position.set(tabX, plateTop + chH / 2, z1 - wallC / 2); back.name = 'bolt-channel'; lid.add(back);
      const zLock = zE - travel, zOpen = zE + gap; // the bolt's front face, locked and retracted
      const roofS = new THREE.Shape(); roofS.moveTo(tabX - chW, z0); roofS.lineTo(tabX + chW, z0); roofS.lineTo(tabX + chW, z1); roofS.lineTo(tabX - chW, z1); roofS.closePath();
      const slot = new THREE.Path(); const sx0 = tabX - nubL / 2 - gap, sx1 = tabX + nubL / 2 + gap, sz0 = zLock + nubU - nubL / 2 - gap, sz1 = zOpen + nubU + nubL / 2 + gap;
      slot.moveTo(sx0, sz0); slot.lineTo(sx1, sz0); slot.lineTo(sx1, sz1); slot.lineTo(sx0, sz1); slot.closePath(); roofS.holes.push(slot);
      lid.add(slab(roofS, roofC, plateTop + chH, mats.body, 'bolt-channel-roof'));
      const boltS = new THREE.Shape(); boltS.moveTo(-bW / 2, 0); boltS.lineTo(bW / 2, 0); boltS.lineTo(bW / 2, bL); boltS.lineTo(-bW / 2, bL); boltS.closePath();
      boltS.holes.push(circlePath(0, holeU, 0.6 + gap));
      const bolt = slab(boltS, bH, 0, mats.accent, 'bolt', 0); bolt.geometry.translate(0, plateTop + gap, 0);
      const nub = new THREE.Mesh(new THREE.BoxGeometry(nubL, gap + roofC + 1.6, nubL), mats.accent); nub.position.set(0, plateTop + gap + bH + (gap + roofC + 1.6) / 2, nubU); nub.name = 'bolt-thumb'; bolt.add(nub);
      bolt.position.set(tabX, 0, P.printPose ? zLock : (locks[0] ?? true) ? zLock : zOpen);
      bolt.userData = { button: 0, slide: true, base: zLock, open: zOpen };
      buttons.length = 0; buttons[0] = bolt; lid.add(bolt); while (locks.length < 1) locks.push(true);
      const bump = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, gap + 0.3, 16), mats.body); bump.position.set(tabX, plateTop + (gap + 0.3) / 2, zLock + holeU); bump.name = 'bolt-detent'; lid.add(bump);
      // keeper: a block on the tab with a tunnel the bolt tip enters; built as a z-extrusion of its (x, y) section
      const kT = plateTop + chH + roofC, sec = new THREE.Shape(); sec.moveTo(tabX - chW, Dlow); sec.lineTo(tabX + chW, Dlow); sec.lineTo(tabX + chW, kT); sec.lineTo(tabX - chW, kT); sec.closePath();
      const tun = new THREE.Path(); tun.moveTo(tabX - bW / 2 - gap, plateTop); tun.lineTo(tabX + bW / 2 + gap, plateTop); tun.lineTo(tabX + bW / 2 + gap, plateTop + chH); tun.lineTo(tabX - bW / 2 - gap, plateTop + chH); tun.closePath(); sec.holes.push(tun);
      const kL = travel + 1.5, keeper = new THREE.Mesh(new THREE.ExtrudeGeometry(sec, { depth: kL, steps: 1, bevelEnabled: false }), mats.body); keeper.position.z = zE - gap - kL; keeper.name = 'bolt-keeper'; g.add(keeper);
      if (decoOn) {
        const keepOut = [rect(tabX - chW - 1.2, zE - kL - 2, tabX + chW + 1.2, z1 + 1.5), rect(-1e4, zStep - lidT - 1.5, 1e4, zStep + 1)];
        decoNotes.push({ where: 'lid', bed: true, ...decorate({ P, R, group: lid, prefix: 'lid-', region: plateM, yTop: Dlow + lidT, parts: [{ shape: plateS, h: lidT, y: Dlow, name: 'lid-plate', bevel: 0.8, pierce: true }], window: and(plateM, pocketMask), keepOut, seedOff: 4 }) });
      }
    }
    const zA = zc + 2, zB = zStep - 2, nK = 5, kl = (zB - zA) / nK, wx0 = obNT.maxX - 1.5, wx1 = axisX - bore - 0.4;
    for (let i = 0; i < nK; i++) {
      const zk = zA + kl * (i + 0.5), isLid = i % 2 === 1, len = kl - 0.4;
      const kn = new THREE.Mesh(tube(hr, bore, len), mats.body); kn.position.set(axisX, axisY, zk); kn.name = (isLid ? 'lid' : 'base') + '-knuckle';
      // a shelf under the whole hinge: solid up to the deck top, and for the base knuckles a block up to the axis beside the plate
      const shelfTop = isLid ? axisY - hr - gap : Dlow;
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(axisX + hr - wx0, shelfTop, len), mats.body); shelf.position.set((wx0 + axisX + hr) / 2, shelfTop / 2, zk); shelf.name = 'hinge-shelf'; g.add(shelf);
      if (isLid) {
        const web = new THREE.Mesh(new THREE.BoxGeometry(wx1 - wx0, lidT, len), mats.body); web.position.set((wx0 + wx1) / 2, Dlow + lidT / 2, zk); web.name = 'hinge-web'; lid.add(web); lid.add(kn);
      } else {
        const bx0 = obNT.maxX + gap, riser = new THREE.Mesh(new THREE.BoxGeometry(axisX + hr - bx0, axisY - Dlow, len), mats.body); riser.position.set((bx0 + axisX + hr) / 2, (Dlow + axisY) / 2, zk); riser.name = 'hinge-riser'; g.add(riser); g.add(kn);
      }
    }
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.875, 0.875, zB - zA + 4, 24), mats.accent); pin.rotation.x = Math.PI / 2; pin.position.set(axisX, axisY, (zA + zB) / 2); pin.name = 'hinge-pin'; g.add(pin);
    sinkFloor = 0.01;
    lid.children.forEach(c => { c.position.x -= axisX; c.position.y -= axisY; });
    lid.position.set(axisX, axisY, 0); lid.rotation.z = -P.open * Math.PI / 180;
    state.lidGroup = lid; g.add(lid);
  }

  // monogram on the hood end face
  if (P.mono) {
    const w = Math.min(hW * nb * 0.8, 34), h = w * 192 / 512;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: monogramTexture(P.mono, P.accentHex), transparent: true, depthWrite: false }));
    pl.position.set(0, Dlow + (D - Dlow) / 2, obNT.maxZ + 0.06); pl.name = 'monogram'; g.add(pl);
  }

  // the harp itself (visual only)
  if (P.harp) offs.forEach((dx, bi) => {
    const h = new THREE.Group(); h.name = 'jaw-harp' + (nb > 1 ? '-' + (bi + 1) : '');
    const y0 = floorT + raise + feltT + 0.05, reedT = 0.9;
    if (traced) {
      const bb = bboxOf(trace.outline);
      const tips = trace.outline.filter(p => p.z > bb.maxZ - 3), tipHalf = tips.reduce((m, p) => Math.max(m, Math.abs(p.x)), 0);
      const gapHalf = Math.max(1.5, tipHalf - frameT);
      const c = R.ctx; maskOf(R, [{ poly: trace.outline }], 0);
      c.globalCompositeOperation = 'destination-out';
      c.lineJoin = 'round'; c.lineWidth = 2 * frameT / RES; c.beginPath(); trace.outline.forEach((q, i) => { const [px, py] = R.toPx(q.x, q.z); i ? c.lineTo(px, py) : c.moveTo(px, py); }); c.closePath(); c.stroke();
      c.globalCompositeOperation = 'source-over';
      const inner = readMask(R), gapM = maskOf(R, [rect(-gapHalf, bb.maxZ - armL, gapHalf, bb.maxZ - 0.6)], 0);
      const hole = new Uint8Array(R.w * R.h); for (let i = 0; i < hole.length; i++) hole[i] = inner[i] || gapM[i] ? 1 : 0;
      const frameS = shapeOf(trace.outline); frameS.holes.push(pathOf(contour(R, hole)));
      h.add(slab(frameS, frameH, y0, mats.ti, 'harp-frame'));
      const zStart = bb.minZ + frameT - 1;
      const reed = new THREE.Mesh(new THREE.BoxGeometry(reedW, reedT, trigger.z - zStart), mats.ti); reed.position.set(0, y0 + frameH / 2, (zStart + trigger.z) / 2); reed.name = 'reed'; h.add(reed);
      const rivet = new THREE.Mesh(new THREE.BoxGeometry(reedW + 4, frameH + 1.2, 3.5), mats.ti); rivet.position.set(0, y0 + frameH / 2, zStart + 1.2); rivet.name = 'rivet-block'; h.add(rivet);
    } else {
      const fm = maskOf(R, framePrims, 0);
      const ix = hW / 2 * 0.866 - frameT, iz = zRing + hW / 4, ia = span / 2 - frameT;
      const throat = { poly: [{ x: ix, z: iz }, { x: ia, z: zNeck }, { x: -ia, z: zNeck }, { x: -ix, z: iz }] };
      const holeM = maskOf(R, [{ circle: [0, zRing, hW / 2 - frameT] }, throat], 0);
      h.add(slab(shapeOf(contour(R, and(fm, holeM, true))), frameH, y0, mats.ti, 'harp-frame'));
      const zStart = zBack + 1;
      const reed = new THREE.Mesh(new THREE.BoxGeometry(reedW, reedT, trigger.z - zStart), mats.ti); reed.position.set(0, y0 + frameH / 2, (zStart + trigger.z) / 2); reed.name = 'reed'; h.add(reed);
      const rivet = new THREE.Mesh(new THREE.BoxGeometry(reedW + 2, frameH + 1.2, 3.5), mats.ti); rivet.position.set(0, y0 + frameH / 2, zStart + 1.2); rivet.name = 'rivet-block'; h.add(rivet);
    }
    // the trigger rises from the reed to the harp's full height tH (measured from its underside), curling forward at the top
    const curlR = 3.5, tBot = y0 + frameH / 2, tTop = y0 + tH - curlR, tLen = Math.max(1, tTop - tBot);
    const trig = new THREE.Mesh(new THREE.BoxGeometry(reedW, tLen, reedT), mats.ti);
    trig.position.set(trigger.x, tBot + tLen / 2, trigger.z); trig.name = 'trigger'; h.add(trig);
    const curl = new THREE.Mesh(new THREE.TorusGeometry(curlR, reedT / 2, 8, 32, Math.PI * 0.9), mats.ti);
    curl.rotation.y = Math.PI / 2; curl.scale.set(1, 1, reedW / reedT);
    curl.position.set(trigger.x, tTop, trigger.z + 1.5); curl.name = 'trigger-curl'; h.add(curl);
    h.position.x = dx; g.add(h); if (bi === 0) state.harpGroup = h;
  });

  // mm -> metres for the preview. Sliding parts carry their two stop positions in userData, so those are millimetres
  // too and have to come along, or the viewer animates them a thousand times too far.
  g.traverse(o => {
    if (o !== g) o.position.multiplyScalar(0.001);
    if (o.isMesh) o.geometry.scale(0.001, 0.001, 0.001);
    if (o.userData && o.userData.slide) { o.userData.base *= 0.001; o.userData.open *= 0.001; }
  });
  const report = fitReport({ decoNotes, P, style, traced, trace, hb0, pb, zStep, zRoof, slideOut, trigger, tH, frameH, frameT, clr, floorT, feltT, Dlow, D, roofed, zRing, bowB, pocketMask, R, zc, holdKind });
  return { g, dims: { L: ob.maxZ - ob.minZ, W: ob.maxX - ob.minX, D: style === 'clam' ? D + 3 : D }, report };
}

// ---- the four ways of holding the harp in an open deck: slide latches in tunnels or roofed channels ----
// Each latch is built in a local frame: origin at the pocket edge, local +z pointing away from the pocket (into the deck),
// local x across the latch. The latch slides along local z; "locked" moves it toward −z, over the frame bar.
// A two-position detent: a bump on the tunnel wall sits in one of two notches cut into the latch's +x edge.
function latchShape(bW, bL, notches, rn, flange) {
  const sh = new THREE.Shape(), f = flange ? 2 : 0, fw = flange ? bW / 2 + 1.5 : bW / 2;
  sh.moveTo(-fw, 0); sh.lineTo(fw, 0); if (flange) { sh.lineTo(fw, f); sh.lineTo(bW / 2, f); }
  let z = f; notches.slice().sort((a, b) => a - b).forEach(u => { const c = f + u; sh.lineTo(bW / 2, c - rn); sh.absarc(bW / 2, c, rn, -Math.PI / 2, Math.PI / 2, true); z = c + rn; });
  sh.lineTo(bW / 2, f + bL); sh.lineTo(-bW / 2, f + bL); if (flange) { sh.lineTo(-bW / 2, f); sh.lineTo(-fw, f); } sh.closePath();
  return sh;
}
// every dimension of a slide latch that the footprint (lugs, bail tab) and the hardware must agree on
function latchDims(kind, clr, frameT, gap, wall) {
  const blade = kind === 'bladeSide' || kind === 'bladeTop', f = blade ? 2 : 0, wallC = 1.6;
  const over = clr + frameT + 2.5; // the latch body reaches 2.5 mm past the far side of the bar
  // Retracted, a latch has to sit clear of the harp itself or the harp cannot be lifted out past it. Positions are
  // measured from the pocket wall, and the harp's edge is one clearance inside that, so parking the tip 0.8 mm
  // outside the harp means openPos = 0.8 - clr. A blade's flange is wider than its tunnel, so the tunnel is opened
  // out to flange width for the first `mouthEnd` of its length and the detent bump sits beyond that.
  const openPos = blade ? 0.8 - clr : gap, lockPos = blade ? -(over + 2) : -over, travel = openPos - lockPos;
  const mouthEnd = blade ? openPos + f + 0.6 : 0;
  const bumpZ = blade ? mouthEnd + 1.5 : 2.5, uA = bumpZ - openPos - f, uB = uA + travel, rn = 0.6 + gap;
  const bL = Math.max(blade ? 17 : 12, uB + rn + 2); // both detent notches inside the latch with 2 mm to spare
  const tunnelEnd = kind === 'bladeSide' ? wall + 3 : blade ? openPos + f + bL + gap + 0.8 : openPos + bL + gap + 0.8; // +0.8: contour rounding at the end
  const chanEnd = openPos + bL + gap + wallC; // back wall of a bolt channel
  return { blade, f, wallC, over, openPos, lockPos, travel, bumpZ, mouthEnd, uA, uB, rn, bL, tunnelEnd, chanEnd };
}
// Cord lashing: no mechanism at all. The deck is plain, with a slot each side of the bow (cut in every layer by
// deckLayer), and the owner threads their own cord over the frame. Nothing printed can wear out, snap or seize.
function buildLash(g, c) {
  const { deckLayer, addLayer, Dlow, floorT, lashGroove, LASH } = c;
  addLayer(deckLayer(), Dlow - floorT - LASH.deep, floorT, 'deck');
  addLayer(deckLayer(lashGroove, true), LASH.deep, Dlow - LASH.deep, 'deck-top', 0.8, 0);
}

// Sliding cover: a plate that runs in a groove down both sides of the case and clicks shut over the bow. The plate
// prints flat beside the case (it would have to bridge the whole open pocket if it printed in place) and slides in
// from the open end afterwards.
function buildSlideCover(g, c) {
  const { P, deckLayer, addLayer, Dlow, floorT, gap, R, footprint, outerNoTab, clr, wall, zStep, obNT, pb } = c;
  const { locks, buttons } = state;
  const railW = 3, lipIn = 1.2, coverT = 2.4, lipT = 1.6, off = clr + wall; // off: the pocket-to-outer-edge offset
  addLayer(deckLayer(), Dlow - floorT, floorT, 'deck', 0.8, 0);
  const zMouth = obNT.minZ + 7; // the last 7 mm at the open end carry no rail, so the cover (and its thumb rib) can leave
  const rail = m => rowsCut(rowsCut(m, R, zStep, false), R, zMouth, true);
  const zD = pb.minZ - 1.2, rB = 1.2; // detent: a bump on the deck behind the pocket, a hole in the cover over it
  const coverM = and(rowsCut(maskOf(R, footprint, off - railW), R, zStep - gap, false), maskOf(R, [{ circle: [0, zD, rB + gap] }], 0), true);
  const sideM = rail(and(outerNoTab, maskOf(R, footprint, off - railW + gap), true)); // walls either side of the plate
  const lipM = rail(and(outerNoTab, maskOf(R, footprint, off - railW - lipIn), true)); // lip that overhangs it
  const yLip = Dlow + 2 * gap + coverT;
  maskToShapes(R, sideM).forEach(l => g.add(slab(l.shape, yLip - Dlow, Dlow, mats.body, 'cover-rail')));
  maskToShapes(R, lipM).forEach(l => g.add(slab(l.shape, lipT, yLip, mats.body, 'cover-lip', 0.6)));
  const bump = new THREE.Mesh(new THREE.CylinderGeometry(rB, rB, gap + 0.3, 16), mats.body);
  bump.position.set(0, Dlow + (gap + 0.3) / 2 - 0.02, zD); bump.name = 'cover-detent'; g.add(bump);
  const pieces = maskToShapes(R, coverM); if (!pieces.length) return;
  const cb = bboxOf(contour(R, coverM)), yCov = Dlow + gap;
  const cover = slab(pieces[0].shape, coverT, yCov, mats.accent, 'cover', 0);
  const rib = new THREE.Mesh(new THREE.BoxGeometry(Math.min(14, (cb.maxX - cb.minX) * 0.6), 2.2, 2.6), mats.accent);
  rib.position.set(0, yCov + coverT + 1.1, cb.minZ + 1.5); rib.name = 'cover-thumb'; cover.add(rib);
  const travel = zStep - cb.minZ + 4;
  cover.userData = { button: 0, slide: true, base: 0, open: -travel };
  if (P.printPose) cover.position.set(obNT.maxX - cb.minX + 8, -yCov, 0); // flat on the bed, beside the case
  else cover.position.z = (locks[0] ?? true) ? 0 : -travel;
  buttons[0] = cover; while (locks.length < 1) locks.push(true);
  g.add(cover);
}

function buildHold(g, kind, c) {
  if (kind === 'lash') return buildLash(g, c);
  if (kind === 'slide') return buildSlideCover(g, c);
  const { P, deckLayer, addLayer, frameTop, Dlow, xL, xR, zRing, clr, frameT, wall, gap, R, tabX, zEnd } = c;
  const { locks, buttons } = state;
  const yBot = frameTop + gap;
  const { blade, f, wallC, openPos, lockPos, bumpZ, mouthEnd, uA, uB, rn, bL, tunnelEnd } = latchDims(kind, clr, frameT, gap, wall);
  const bW = blade ? 8 : 5, bT = blade ? 1.6 : 3, nHalf = bW / 2 + gap + 0.15; // notch half-width (+0.15 for contour rounding)
  const flange = blade;
  // where each latch sits: [origin x, origin z, rotation.y]  (rotation maps local −z, the locking direction, onto the world)
  const places = kind === 'spine' ? [[tabX, zEnd, Math.PI]] : [[xL, zRing, -Math.PI / 2], [xR, zRing, Math.PI / 2]];
  const toWorld = (px, pz, rot, x, z) => ({ x: px + x * Math.cos(rot) + z * Math.sin(rot), z: pz - x * Math.sin(rot) + z * Math.cos(rot) });
  const rectW = (pl, x0, z0, x1, z1) => ({ poly: [toWorld(pl[0], pl[1], pl[2], x0, z0), toWorld(pl[0], pl[1], pl[2], x1, z0), toWorld(pl[0], pl[1], pl[2], x1, z1), toWorld(pl[0], pl[1], pl[2], x0, z1)] });
  const fHalf = bW / 2 + 1.5 + gap + 0.15; // the flange, plus print gap and contour rounding
  const notchPrims = places.flatMap(pl => blade
    ? [rectW(pl, -nHalf, -3, nHalf, tunnelEnd), rectW(pl, -fHalf, -3, fHalf, mouthEnd)] // wider mouth for the flange
    : [rectW(pl, -nHalf, -3, nHalf, tunnelEnd)]);
  const notchMask = maskOf(R, notchPrims, 0);
  // deck layers
  if (blade) {
    const tunTop = yBot + bT + gap; // tunnel: frameTop .. tunTop, roof above to Dlow
    addLayer(deckLayer(), frameTop - 3, 3, 'deck-body');
    addLayer(deckLayer(notchMask), tunTop - frameTop, frameTop, 'deck-tunnel');
    let top;
    if (kind === 'bladeTop') { // slot for the thumb tab, cut into the roof layer's mask (it may run into the pocket opening on thick frames)
      const uT = 13, sHalf = 1.2 + gap + 0.25, sEnd = 0.6; // the traced slot has rounded corners, so it is cut a little wider and longer than tab + gap
      const slotMask = maskOf(R, places.map(pl => rectW(pl, -sHalf, lockPos + f + uT - 1.2 - gap - sEnd, sHalf, openPos + f + uT + 1.2 + gap + sEnd)), 0);
      top = deckLayer(slotMask);
    } else top = deckLayer();
    addLayer(top, Dlow - tunTop, tunTop, 'deck', 0.8, 0);
  } else {
    addLayer(deckLayer(), frameTop - 3, 3, 'deck-body');
    addLayer(deckLayer(notchMask), Dlow - frameTop, frameTop, 'deck'); // top layer carries the groove (no bevel: it would pinch it); the bolt rides one gap above its floor
  }
  places.forEach((pl, k) => {
    const grp = new THREE.Group(); grp.position.set(pl[0], 0, pl[1]); grp.rotation.y = pl[2]; grp.name = 'latch-' + (k + 1); g.add(grp);
    const m = slab(latchShape(bW, bL, [uA, uB], rn, flange), bT, yBot, mats.accent, blade ? 'blade-' + (k + 1) : 'bolt-' + (k + 1), 0);
    m.position.z = P.printPose ? openPos : (locks[k] ?? true) ? lockPos : openPos;
    m.userData = { button: k, slide: true, base: lockPos, open: openPos };
    if (kind === 'bladeSide') { const nub = new THREE.Mesh(new THREE.BoxGeometry(bW, bT + 2.4, 2.4), mats.accent); nub.position.set(0, yBot + bT / 2 + 0.6, f + bL + 1.2); nub.name = 'blade-thumb'; m.add(nub); }
    else if (kind === 'bladeTop') { const h = Dlow + 1.5 - (yBot + bT), tab = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, 2.4), mats.accent); tab.position.set(0, yBot + bT + h / 2, f + 13); tab.name = 'blade-thumb'; m.add(tab); }
    else { const h = gap + 1.6 + 1.5, nub = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, 2.4), mats.accent); nub.position.set(0, yBot + bT + h / 2, 8); nub.name = 'bolt-thumb'; m.add(nub); }
    grp.add(m); buttons[k] = m;
    // detent bump on the tunnel / channel wall (+x side)
    const bump = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, bT - 0.3, 16), mats.body); bump.position.set(nHalf + 0.3, yBot + bT / 2, bumpZ); bump.name = 'detent'; grp.add(bump);
    if (!blade) { // roofed channel on the deck top
      const chH = yBot + bT + gap - Dlow, z0 = 0.8, z1 = openPos + bL + gap + wallC, xw = nHalf + wallC / 2;
      [1, -1].forEach(sg => { const w = new THREE.Mesh(new THREE.BoxGeometry(wallC, chH, z1 - z0), mats.body); w.position.set(sg * xw, Dlow + chH / 2, (z0 + z1) / 2); w.name = 'channel'; grp.add(w); });
      const back = new THREE.Mesh(new THREE.BoxGeometry(2 * nHalf + 2 * wallC, chH, wallC), mats.body); back.position.set(0, Dlow + chH / 2, z1 - wallC / 2); back.name = 'channel'; grp.add(back);
      // the thumb-nub slot in the roof: a closed slot when a rim of at least one wall thickness is left at the front,
      // otherwise the roof is a U that is open at the front edge (a hole crossing the outline would be dropped by the triangulator)
      const roof = new THREE.Shape(), sx = 1.2 + gap, sz0 = lockPos + 8 - 1.2 - gap, sz1 = openPos + 8 + 1.2 + gap, w = nHalf + wallC;
      if (sz0 >= z0 + wallC) {
        roof.moveTo(-w, z0); roof.lineTo(w, z0); roof.lineTo(w, z1); roof.lineTo(-w, z1); roof.closePath();
        const slot = new THREE.Path(); slot.moveTo(-sx, sz0); slot.lineTo(sx, sz0); slot.lineTo(sx, sz1); slot.lineTo(-sx, sz1); slot.closePath(); roof.holes.push(slot);
      } else {
        roof.moveTo(-w, z0); roof.lineTo(-sx, z0); roof.lineTo(-sx, sz1); roof.lineTo(sx, sz1); roof.lineTo(sx, z0); roof.lineTo(w, z0); roof.lineTo(w, z1); roof.lineTo(-w, z1); roof.closePath();
      }
      grp.add(slab(roof, 1.6, Dlow + chH, mats.body, 'channel-roof'));
    }
  });
  while (locks.length < places.length) locks.push(true);
}

// ---- export: binary STL + OBJ/MTL in millimetres, print parts only ----
const isHarp = o => /^jaw-harp(-\d+)?$/.test(o.name);
function printMeshes(g, part) {
  g.updateMatrixWorld(true);
  const out = [];
  g.traverse(o => {
    if (!o.isMesh) return;
    let p = o, skip = false, inLid = false;
    while (p && p !== g) { if (isHarp(p)) skip = true; if (p.name === 'lid') inLid = true; p = p.parent; }
    if (skip || /^lining|^monogram|^counterbore|^hinge-pin/.test(o.name)) return;
    if (part === 'lid' && !inLid) return;
    if (part === 'base' && inLid) return;
    out.push(o);
  });
  return out;
}
export function toSTL(g, part) {
  const meshes = printMeshes(g, part); let n = 0;
  const geos = meshes.map(m => { const ge = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry; n += ge.attributes.position.count / 3; return ge; });
  const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  const hdr = 'Jaw harp case, millimetres'; for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 0);
  dv.setUint32(80, n, true);
  let off = 84, skipped = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
  let yMin = Infinity; meshes.forEach((m, k) => { const pos = geos[k].attributes.position; for (let i = 0; i < pos.count; i++) yMin = Math.min(yMin, a.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).y * 1000); });
  meshes.forEach((m, k) => {
    const pos = geos[k].attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).multiplyScalar(1000); a.y -= yMin;
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(m.matrixWorld).multiplyScalar(1000); b.y -= yMin;
      c.fromBufferAttribute(pos, i + 2).applyMatrix4(m.matrixWorld).multiplyScalar(1000); c.y -= yMin;
      nn.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (nn.lengthSq() < 1e-8) { skipped++; continue; } // a degenerate (zero-area) triangle: slicers choke on them, and they carry no surface
      nn.normalize();
      // STL is z-up: rotate y-up to z-up as (x, -z, y) — a proper rotation, so triangle winding and normals stay outward
      [nn, a, b, c].forEach(v => { dv.setFloat32(off, v.x, true); dv.setFloat32(off + 4, -v.z, true); dv.setFloat32(off + 8, v.y, true); off += 12; });
      dv.setUint16(off, 0, true); off += 2;
    }
  });
  if (skipped) { dv.setUint32(80, n - skipped, true); return buf.slice(0, off); }
  return buf;
}
export function toOBJ(g) {
  const meshes = printMeshes(g); let base = 1; const v = new THREE.Vector3();
  const lines = ['# Jaw harp case, millimetres, y up', 'mtllib case.mtl'];
  const used = new Set();
  meshes.forEach(m => {
    const ge = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, pos = ge.attributes.position;
    lines.push('o ' + m.name, 'usemtl ' + m.material.name); used.add(m.material);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).multiplyScalar(1000); lines.push(`v ${v.x.toFixed(3)} ${v.y.toFixed(3)} ${v.z.toFixed(3)}`); }
    for (let i = 0; i < pos.count; i += 3) lines.push(`f ${base + i} ${base + i + 1} ${base + i + 2}`);
    base += pos.count;
  });
  const mtl = [...used].map(mt => { const c = mt.color; return `newmtl ${mt.name}\nKd ${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)}\nKs 0.1 0.1 0.1\nNs 30`; }).join('\n\n');
  return { obj: lines.join('\n'), mtl };
}

// ---------------- fit report: does this case actually work with this harp? ----------------
// Every check is a plain geometric statement about the model just built. `removal` is a simulated path for taking the
// harp out (deck and pendant: lift the bow, slide back until the trigger is out from under the roof, lift away), tested
// point by point against the pocket, the deck edge and the roof.
function fitReport(c) {
  const { P, style, traced, trace, hb0, pb, zStep, zRoof, slideOut, trigger, tH, frameH, frameT, clr, floorT, feltT, Dlow, D, zRing, bowB, pocketMask, R, zc, holdKind } = c;
  const checks = [], yF = floorT + feltT, yRoof = D - 3, zT = hb0.maxZ; // zT: the harp's trigger-end extreme
  const add = (id, ok, level, text, fix) => checks.push({ id, ok, level: ok ? 'ok' : level, text, fix });
  // lengths in the units the page is showing: L(mm, decimals in mm)
  const inch = P.units === 'in', U = (mm, d = 1) => { const v = +mm; if (!inch) return `${v.toFixed(d)} mm`; const i = v / IN; return `${i.toFixed(Math.abs(i) < 0.1 ? 3 : 2)} in`; };
  const roofedStyle = style === 'deck' || style === 'pendant', roofOn = P.roof !== false, roofHeld = roofedStyle && roofOn;
  // width profile of the harp along z (half-width), from the pocket mask minus clearance is close enough for the tests
  const halfW = z => { const py = Math.round((z - R.z0) / RES); if (py < 0 || py >= R.h) return -1; let a = 1e9, b = -1e9; for (let x = 0; x < R.w; x++) if (pocketMask[py * R.w + x]) { a = Math.min(a, x); b = Math.max(b, x); } return b < a ? -1 : ((b - a + 1) * RES) / 2; };
  const inPocket = (x, z) => { const [px, py] = R.toPx(x, z); const xi = Math.round(px), yi = Math.round(py); return xi >= 0 && yi >= 0 && xi < R.w && yi < R.h && !!pocketMask[yi * R.w + xi]; };

  // 1. the hood roof covers the trigger
  if (roofHeld) add('trigger-roof', trigger.z - zRoof >= 2, 'bad',
    trigger.z - zRoof >= 2 ? `The roof covers the trigger (it starts ${U(trigger.z - zRoof, 0)} before it).` : 'The hood is too short: the roof does not reach over the trigger, so nothing holds the tip end down.', { hood: Math.min(75, P.hood + 10) });
  // 2. the bow stays clear of the hood, so the latches cross it in the open and it can be lifted
  if (roofedStyle) { const m = zStep - (zRing + bowB); add('bow-clear', m >= 1.5, 'bad',
    m >= 1.5 ? `The bow sits ${U(m, 0)} clear of the hood, in the open deck.` : 'The hood reaches over the bow: the latches would run into the hood wall and the bow could not be lifted out.', { hood: Math.max(20, P.hood - 10) }); }
  // 3. trigger headroom under the roof
  if (roofHeld) { const room = yRoof - (yF + tH); add('headroom', room >= 1, 'bad', `${U(room)} of play between the top of the trigger and the roof.`); }
  // 4. frame thickness is a typed number, not measured from the photo
  add('thickness', true, 'info', `Frame thickness is set to ${U(frameH)}${traced ? ' — a photo cannot measure it, so check yours with a ruler' : ''}; the deck sits ${U(Dlow - (yF + frameH))} above the frame.`);
  // 5. traced: does the outline look the right way round? The bow is the widest part and belongs at the latch end.
  if (traced && trace) {
    const bb = bboxOf(trace.outline); let wz = 0, wx = -1; trace.outline.forEach(p => { if (Math.abs(p.x) > wx) { wx = Math.abs(p.x); wz = p.z; } });
    const frac = (wz - bb.minZ) / (bb.maxZ - bb.minZ); // 0 = bow end, 1 = trigger end
    add('orientation', frac < 0.55, 'warn', frac < 0.55 ? 'The widest point of the outline is at the bow end, where the latches are.' : 'The widest part of the outline is at the trigger end: the ends may be swapped. Retrace and swap them, or check the photo.', { swap: true });
  }
  // 5·. traced: the pocket is cut from a fitted outline, smoother and roomier than the photo's
  if (traced && trace) add('photo-fit', true, 'info', `The pocket follows a smoothed copy of your outline, ${U(PHOTO_ALLOWANCE)} roomier all round than the photo on top of the ${U(clr, 2)} clearance, so the photo's rough edges do not end up in the walls and the harp drops in without binding. If it is still tight, raise the pocket clearance.`);
  // 5a. a retracted latch has to be clear of the harp, or nothing can be lifted out
  if (holdKind && /blade|twin|spine/.test(holdKind)) {
    const d = latchDims(holdKind, clr, frameT, P.gap || 0.4, P.wall);
    const room = clr + d.openPos; // how far the parked latch sits outside the harp's edge
    add('retract', room >= 0.3, 'bad', room >= 0.3
      ? `Drawn back, the ${d.blade ? 'blades' : 'bolts'} park ${U(room)} clear of the harp.`
      : `Drawn back, the ${d.blade ? 'blades' : 'bolts'} still overlap the harp by ${U(-room)}, so it cannot be lifted out.`);
  }

  // 5b. what is actually holding the harp
  const holdNote = {
    lash: `The slots are the whole mechanism, and they sit ${U(2, 0)} off the pocket wall so the cord bears on the frame itself. Thread ${inch ? '3/32 to 1/8 in' : '2 to 3 mm'} cord or shock cord up through one, along the groove across the deck, down the other, and tie it under the case. The groove holds the cord below the top of the frame, so pulling it tight clamps the harp down.`,
    slide: 'The cover prints flat beside the case. Slide it in from the open end until it clicks over the bump; slide it back off to get the harp out.',
    swing: 'Two turn-buttons on captive pegs. A firm quarter-turn frees each one after printing, and it clicks into place on a detent.',
  }[holdKind];
  if (holdNote) add('hold', true, 'info', holdNote);

  // 5c. the ornament, and what the printing process means for it
  const proc = P.proc === 'resin' ? 'resin' : 'fdm', notes = c.decoNotes || [];
  if (P.deco && P.deco !== 'none') {
    const nm = { damascus: 'The Damascus pattern', scroll: 'The scrollwork', flowers: 'The flowering vine', seigaiha: 'The seigaiha pattern' }[P.deco] || 'The pattern';
    const WH = { hood: 'hood', roof: 'roof', lid: 'lid', 'lid-roof': 'lid', deck: 'deck', floor: 'floor windows' };
    const names = list => [...new Set(list.map(n => WH[n.where]))].join(' and ');
    const S = DECO[proc], done = notes.filter(n => n.done), pierced = done.filter(n => n.cut === 'pierce'), carved = done.filter(n => n.cut !== 'pierce');
    if (!done.length) add('decor', false, 'warn', 'There is not enough flat top on this case to carry a pattern, so it prints plain. More hood coverage or a wider wall makes room.');
    else if (P.cut === 'pierce') {
      if (pierced.length) {
        const mm2 = pierced.reduce((t, n) => t + (n.areaMm || 0), 0);
        add('decor', true, 'info', `${nm} is pierced right through the ${names(pierced)} (${inch ? (mm2 / (IN * IN)).toFixed(2) + ' sq in' : mm2.toFixed(0) + ' mm²'} of openwork) inside a solid border${pierced.some(n => n.where === 'hood') ? ', with a solid pad left over the trigger, which is what holds the tip end down' : ''}. Pieces that would have come loose are left out.${carved.length ? ` Where there is nothing open beneath it (the ${names(carved)}), it is engraved instead.` : ''}`);
      } else add('decor', true, 'info', `Nothing on this case has open space beneath it wide enough to pierce, so ${nm.toLowerCase()} is engraved into the ${names(carved)} instead. The clamshell lid, the sleeve roof and the pendant floor can be pierced.`);
      if (proc === 'fdm' && pierced.some(n => !n.bed)) add('decor-fdm', false, 'warn', 'Filigree over the open pocket would be printed in mid-air by a filament printer, and the strands would sag. Print this one in resin, or pick the clamshell or the pendant, whose openwork prints face down on the bed.', { proc: 'resin' });
    } else add('decor', true, 'info', `${nm} is ${P.cut === 'engrave' ? `cut ${U(S.depth)} into` : `raised ${U(S.depth)} off`} the ${names(done)}, inside a plain border. Nothing in it is finer than ${U(Math.min(S.line, S.gap), 2)}, sized for ${proc === 'resin' ? 'a resin printer' : 'a 0.4 mm filament nozzle'}.`);
  }
  if (proc === 'resin') {
    const moving = !(holdKind === 'lash' || holdKind === 'slide');
    if (moving) add('resin-gap', (P.gap || 0.4) >= 0.55, 'warn', (P.gap || 0.4) >= 0.55
      ? `Resin: the moving parts have ${U(P.gap || 0.6, 2)} of air around them. Wash well in IPA, and work every latch free before the final cure, while the resin is still a little soft.`
      : `Resin fills gaps narrower than about ${inch ? '0.02 in' : 'half a millimetre'}, which would weld the latches shut. Widen the print gap to ${U(0.6)}.`, { pgap: 0.6 });
  }

  // 6. removal path (deck / pendant): tilt about the tips, slide back `slideOut`, lift
  let removal = null;
  if (roofedStyle && !roofOn) {
    removal = { ok: true, liftOnly: true, problems: [] };
    add('no-roof', true, 'info', 'No roof over the reed tip: only the latches at the bow hold the harp, and the tip end can lift a little. That is fine in a bag or on a cord; put the roof back if the case will ride loose in a pocket.');
    add('removal', true, 'ok', 'Comes out: latches back, lift it straight out.');
  } else if (roofedStyle) {
    const L = zT - zRing, lift = Dlow + 1 - yF, theta = Math.asin(Math.min(1, lift / Math.max(L, 1)));
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const pose = (z, y, shift) => ({ z: zT - (zT - z) * cosT - (y - yF) * sinT - shift, y: yF + (y - yF) * cosT + (zT - z) * sinT }); // rotate about (zT, yF) lifting the bow, then slide back
    const problems = [];
    // the trigger top must stay under the roof while it is still under it
    for (const shift of [0, slideOut * 0.5, slideOut]) { const q = pose(trigger.z + 3, yF + tH, shift); if (q.z >= zRoof - 0.5 && q.y > yRoof - 0.5) problems.push('the trigger hits the roof while tilting'); }
    // every point of the harp, at the end of the slide, must be inside the (swept) pocket or above the deck edge
    let blocked = 0, n = 0;
    for (let z = hb0.minZ; z <= zT; z += 1) {
      const hw = halfW(z) - clr; if (hw <= 0) continue;
      for (const x of [-hw, hw]) { n++; const q = pose(z, yF + frameH, slideOut); const ok = q.z >= zStep ? inPocket(x * 0.98, q.z) || q.y >= D - 0.5 : inPocket(x * 0.98, q.z) || q.y >= Dlow + 0.3; if (!ok) blocked++; }
    }
    if (blocked > n * 0.03) problems.push('the outline is wider behind its tips than the pocket allows, so it cannot slide back out from under the roof');
    const ok = problems.length === 0;
    removal = { ok, theta, slide: slideOut, lift: D - yF + 12, pivot: { z: zT, y: yF }, problems };
    add('removal', ok, 'bad', ok ? `Comes out: latches back, lift the bow ${U(lift, 0)}, slide back ${U(slideOut, 0)} to free the trigger, lift away.` : 'The harp cannot be taken out: ' + problems.join('; ') + '.', null);
  } else if (style === 'sleeve') {
    removal = { ok: true, slideZ: -(hb0.maxZ - hb0.minZ + 10), problems: [] };
    add('removal', true, 'ok', 'Comes out: swing the gate open and slide the harp out of the mouth.');
  } else if (style === 'clam') {
    removal = { ok: true, liftOnly: true, problems: [] };
    add('removal', true, 'ok', 'Comes out: slide the bolt back, open the lid, lift the harp straight up.');
  }
  return { checks, removal, ok: checks.every(k => k.ok || k.level === 'info' || k.level === 'warn') };
}
