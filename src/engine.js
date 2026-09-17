// Jaw harp case geometry engine — ported verbatim from the prototype (raster-mask 2D → contour → extrude).
// Units: mm inside build(); the returned group is scaled ×0.001 to metres. x across, z along (trigger toward +z), y up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
function slab(shape, h, yBase, mat, name, bevel = 0, inset = 0) {
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
const rowsCut = (mask, R, zc, keepAbove) => { const py = (zc - R.z0) / RES; const m = new Uint8Array(mask.length); for (let y = 0; y < R.h; y++) { const keep = keepAbove ? y >= py : y < py; if (keep) for (let x = 0; x < R.w; x++) m[y * R.w + x] = mask[y * R.w + x]; } return m; };
const or = (m1, m2) => { const m = new Uint8Array(m1.length); for (let i = 0; i < m.length; i++) m[i] = m1[i] || m2[i] ? 1 : 0; return m; };
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

export function build(P) {
  const style = P.style, tH = P.trig * IN, wall = P.wall, clr = P.clr, floorT = 3, frameH = Math.min(8, Math.max(2, +P.thick || 4)), bevel = 1.6, feltT = 0.6;
  // print-in-place: every moving part is separated from the body by `gap` of air; the captive head lives in a chamber between yC0 and yC1
  const gap = Math.min(0.6, Math.max(0.3, P.gap || 0.4)), pegR = 2, headR = 3, headH = 1.6, chamR = headR + gap, yC0 = floorT, chamH = headH + 2 * gap, yC1 = yC0 + chamH;
  const { locks, buttons } = state; const trace = state.trace;
  const g = new THREE.Group(); g.name = 'jaw-harp-case'; state.lidGroup = null; state.harpGroup = null;
  const HOLDS = ['bladeSide', 'bladeTop', 'spine', 'twin'];
  const holdKind = style === 'deck' || style === 'pendant' ? (HOLDS.includes(P.hold) ? P.hold : 'bladeSide') : null;
  const bladeHold = holdKind === 'bladeSide' || holdKind === 'bladeTop';
  const hasButtons = style === 'multi'; // the rack keeps captive turn-buttons (with a recess for the pad's sweep)

  let harpPrims, bayPrims, framePrims, holePrims, windows, trigger, reedW, frameT, hL, hW, zRing, armL, span, zNeck, zTip, bowB, zBack;
  if (trace && style !== 'multi') {
    harpPrims = [{ poly: trace.outline }]; bayPrims = harpPrims; trigger = trace.trigger;
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
  const holdD = (style === 'deck' || style === 'pendant') ? latchDims(holdKind, clr, frameT, gap, wall) : null;
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
  const slideOut = roofedStyle ? Math.max(0, hb0.maxZ + clr - zRoof + 1) : 0;
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
  const D = floorT + feltT + tH + (roofed ? 5 : 3) + raise;
  // hold hardware lives on lugs added to the footprint: the tab for the spine bolt, side lugs for the top blades and twin bolts
  const pbx = { minX: pb.minX, maxX: pb.maxX }; // pocket extremes (widest at the bow)
  const lugPrims = [];
  const lugLen = 15.5, lugHalf = 6.5; // lug reaches 15.5 mm from the pocket edge; the wall already gives `wall` of that
  if (holdKind === 'twin' || holdKind === 'bladeTop') {
    const ext = holdKind === 'twin' ? Math.max(lugLen, holdD.chanEnd + 1.5) : Math.max(19, holdD.tunnelEnd + 3); // the lug always reaches past the channel's back wall / the tunnel's end
    lugPrims.push(rect(pbx.minX - ext + rT, zRing - lugHalf + rT, pbx.minX + 2, zRing + lugHalf - rT), rect(pbx.maxX - 2, zRing - lugHalf + rT, pbx.maxX + ext - rT, zRing + lugHalf - rT));
  }
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
    [1, -1].forEach(sg => g.add(slab(shapeOf(contour(R, halfMask(roofMask, R, sg))), roofT, Dlow, mats.body, 'roof-' + (sg > 0 ? 'right' : 'left'), 0.6)));
    g.add(slab(shapeOf(hood), D - Dlow, Dlow, mats.body, 'hood', bevel));
    g.add(slab(shapeOf(contour(R, and(rowsCut(maskOf(R, chanPrims, clr - 0.2), R, zc + 0.2, true), chanMask))), feltT, floorT, mats.felt, 'lining'));
  } else {
    // a deck layer: the outline with the pockets (and bail) as holes, or — when a notch joins a pocket to the outside — traced from a mask
    // a deck layer as a list of {shape, mask}: the plain outline with pockets as holes, or — when a notch is cut into it —
    // every solid piece of the (outline − pockets − notch) mask, islands included
    const deckLayer = (notch) => {
      if (!notch) { const d = shapeOf(outer); pockets.forEach(p => d.holes.push(pathOf(p))); addBail(d); return [{ shape: d, mask: outerMask }]; }
      const list = maskToShapes(R, and(and(outerMask, pocketMask, true), notch, true));
      list.sort((a, b) => b.mask.reduce((x, v) => x + v, 0) - a.mask.reduce((x, v) => x + v, 0));
      if (P.bail && list.length) holeAt(list, tabX, holeZ, holeR); // into whichever piece actually holds the bail tab (a hole outside its piece would be dropped by the triangulator and block the bail)
      return list;
    };
    const addLayer = (list, hgt, y, name, bt = 0, bb = 0) => list.forEach(l => g.add(slabB(l.shape, hgt, y, mats.body, name, bt, bb)));
    // a hole at (x, z) goes into whichever piece of the layer contains that point
    const holeAt = (list, x, z, r) => { const [px, py] = R.toPx(x, z), k = (py | 0) * R.w + (px | 0); const l = list.find(q => q.mask[k]) || list[0]; if (l) l.shape.holes.push(circlePath(x, z, r)); };
    addLayer(deckLayer(), floorT, 0, 'deck-floor', 0, 0.8);
    if (style === 'clam') {
      addLayer(deckLayer(), Dlow - floorT, floorT, 'deck', 0.8, 0);
    } else if (style === 'multi') {
      // rack: captive turn-buttons. The pocket floor is 1.5 mm higher than in the other styles, so the frame's top sits at the
      // deck surface and the bar itself bears on it — no pad hanging below the deck, nothing to sweep through.
      const dMid = deckLayer(), dUp = deckLayer(); sides.forEach(s => { holeAt(dMid, s.x, s.z, chamR); holeAt(dUp, s.x, s.z, pegR + 0.3); });
      addLayer(dMid, chamH, yC0, 'deck-chamber'); addLayer(dUp, Dlow - yC1, yC1, 'deck', 0.8, 0);
    } else {
      buildHold(g, holdKind, { P, deckLayer, addLayer, frameTop, Dlow, xL: pbx.minX, xR: pbx.maxX, zRing, clr, frameT, wall, gap, R, tabX, zEnd: pb.minZ });
    }
    if (roofed) {
      const hoodS = shapeOf(hood); if (hoodRing) pockets.forEach(p => hoodS.holes.push(pathOf(p))); g.add(slab(hoodS, D - Dlow, Dlow, mats.body, 'hood', bevel));
      g.add(slab(shapeOf(contour(R, rowsCut(outerNoTab, R, zRoof, true))), 3, D - 3, mats.body, 'hood-roof', 0.8));
    }
    pockets.forEach((p, i) => {
      const fS = shapeOf(p), lS = shapeOf(felts[i]);
      if (style === 'pendant') {
        // windows under the ring and under the reed only — every bar of the frame stays on solid floor
        const wins = traced ? [contour(R, maskOf(R, [{ poly: trace.outline }], clr - 6))] : windows.map(w => contour(R, maskOf(R, shift([w], offs[i]), 0)));
        wins.filter(w => w.length > 8).forEach(w => { fS.holes.push(pathOf(w)); lS.holes.push(pathOf(w)); });
      }
      g.add(slab(fS, floorT + raise, 0.001, mats.body, 'pocket-floor' + (nb > 1 ? '-' + (i + 1) : '')));
      g.add(slab(lS, feltT, floorT + raise, mats.felt, 'lining' + (nb > 1 ? '-' + (i + 1) : '')));
    });
  }

  // turn-buttons, print-in-place captive pivot
  const barW = 7, barT = 3, padH = Dlow + gap - (floorT + feltT + frameH + gap);
  buttons.length = 0;
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
    const plateS = shapeOf(contour(R, rowsCut(outerNoTab, R, zStep, false))); lid.add(slab(plateS, lidT, Dlow, mats.body, 'lid-plate', 0.8));
    const hoodWall = contour(R, and(rowsCut(outerNoTab, R, zStep, true), pocketMask, true));
    lid.add(slab(shapeOf(hoodWall), D + lidT - Dlow, Dlow, mats.body, 'lid-hood', 0.8, 0.01)); // 0.01 inset: no vertices shared with the plate's bevel
    lid.add(slab(shapeOf(contour(R, rowsCut(outerNoTab, R, zStep - lidT, true))), lidT, D, mats.body, 'lid-roof', 0.8));
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

  g.traverse(o => { if (o !== g) o.position.multiplyScalar(0.001); if (o.isMesh) o.geometry.scale(0.001, 0.001, 0.001); });
  const report = fitReport({ P, style, traced, trace, hb0, pb, zStep, zRoof, slideOut, trigger, tH, frameH, frameT, clr, floorT, feltT, Dlow, D, roofed, zRing, bowB, pocketMask, R, zc, holdKind });
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
  const openPos = blade ? -3.6 : gap, lockPos = blade ? -(over + 2) : -over, travel = openPos - lockPos;
  const bumpZ = blade ? 1.5 : 2.5, uA = bumpZ - openPos - f, uB = uA + travel, rn = 0.6 + gap;
  const bL = Math.max(blade ? 17 : 12, uB + rn + 2); // both detent notches inside the latch with 2 mm to spare
  const tunnelEnd = kind === 'bladeSide' ? wall + 3 : blade ? openPos + f + bL + gap + 0.8 : openPos + bL + gap + 0.8; // +0.8: contour rounding at the end
  const chanEnd = openPos + bL + gap + wallC; // back wall of a bolt channel
  return { blade, f, wallC, over, openPos, lockPos, travel, bumpZ, uA, uB, rn, bL, tunnelEnd, chanEnd };
}
function buildHold(g, kind, c) {
  const { P, deckLayer, addLayer, frameTop, Dlow, xL, xR, zRing, clr, frameT, wall, gap, R, tabX, zEnd } = c;
  const { locks, buttons } = state; buttons.length = 0;
  const yBot = frameTop + gap;
  const { blade, f, wallC, openPos, lockPos, bumpZ, uA, uB, rn, bL, tunnelEnd } = latchDims(kind, clr, frameT, gap, wall);
  const bW = blade ? 8 : 5, bT = blade ? 1.6 : 3, nHalf = bW / 2 + gap + 0.15; // notch half-width (+0.15 for contour rounding)
  const flange = blade;
  // where each latch sits: [origin x, origin z, rotation.y]  (rotation maps local −z, the locking direction, onto the world)
  const places = kind === 'spine' ? [[tabX, zEnd, Math.PI]] : [[xL, zRing, -Math.PI / 2], [xR, zRing, Math.PI / 2]];
  const toWorld = (px, pz, rot, x, z) => ({ x: px + x * Math.cos(rot) + z * Math.sin(rot), z: pz - x * Math.sin(rot) + z * Math.cos(rot) });
  const rectW = (pl, x0, z0, x1, z1) => ({ poly: [toWorld(pl[0], pl[1], pl[2], x0, z0), toWorld(pl[0], pl[1], pl[2], x1, z0), toWorld(pl[0], pl[1], pl[2], x1, z1), toWorld(pl[0], pl[1], pl[2], x0, z1)] });
  const notchPrims = places.map(pl => rectW(pl, -nHalf, -3, nHalf, tunnelEnd));
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
  const hdr = 'Frame & Reed jaw harp case — millimetres'; for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 0);
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
  const lines = ['# Frame & Reed jaw harp case — millimetres, y up', 'mtllib case.mtl'];
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
  const roofedStyle = style === 'deck' || style === 'pendant';
  // width profile of the harp along z (half-width), from the pocket mask minus clearance is close enough for the tests
  const halfW = z => { const py = Math.round((z - R.z0) / RES); if (py < 0 || py >= R.h) return -1; let a = 1e9, b = -1e9; for (let x = 0; x < R.w; x++) if (pocketMask[py * R.w + x]) { a = Math.min(a, x); b = Math.max(b, x); } return b < a ? -1 : ((b - a + 1) * RES) / 2; };
  const inPocket = (x, z) => { const [px, py] = R.toPx(x, z); const xi = Math.round(px), yi = Math.round(py); return xi >= 0 && yi >= 0 && xi < R.w && yi < R.h && !!pocketMask[yi * R.w + xi]; };

  // 1. the hood roof covers the trigger
  if (roofedStyle) add('trigger-roof', trigger.z - zRoof >= 2, 'bad',
    trigger.z - zRoof >= 2 ? `The roof covers the trigger (it starts ${(trigger.z - zRoof).toFixed(0)} mm before it).` : 'The hood is too short: the roof does not reach over the trigger, so nothing holds the tip end down.', { hood: Math.min(75, P.hood + 10) });
  // 2. the bow stays clear of the hood, so the latches cross it in the open and it can be lifted
  if (roofedStyle) { const m = zStep - (zRing + bowB); add('bow-clear', m >= 1.5, 'bad',
    m >= 1.5 ? `The bow sits ${m.toFixed(0)} mm clear of the hood, in the open deck.` : 'The hood reaches over the bow: the latches would run into the hood wall and the bow could not be lifted out.', { hood: Math.max(20, P.hood - 10) }); }
  // 3. trigger headroom under the roof
  if (roofedStyle) { const room = yRoof - (yF + tH); add('headroom', room >= 1, 'bad', `${room.toFixed(1)} mm of play between the top of the trigger and the roof.`); }
  // 4. frame thickness is a typed number, not measured from the photo
  add('thickness', true, 'info', `Frame thickness is set to ${frameH} mm${traced ? ' — a photo cannot measure it, so check yours with a ruler' : ''}; the deck sits ${(Dlow - (yF + frameH)).toFixed(1)} mm above the frame.`);
  // 5. traced: does the outline look the right way round? The bow is the widest part and belongs at the latch end.
  if (traced && trace) {
    const bb = bboxOf(trace.outline); let wz = 0, wx = -1; trace.outline.forEach(p => { if (Math.abs(p.x) > wx) { wx = Math.abs(p.x); wz = p.z; } });
    const frac = (wz - bb.minZ) / (bb.maxZ - bb.minZ); // 0 = bow end, 1 = trigger end
    add('orientation', frac < 0.55, 'warn', frac < 0.55 ? 'The widest point of the outline is at the bow end, where the latches are.' : 'The widest part of the outline is at the trigger end: the ends may be swapped. Retrace and swap them, or check the photo.', { swap: true });
  }
  // 6. removal path (deck / pendant): tilt about the tips, slide back `slideOut`, lift
  let removal = null;
  if (roofedStyle) {
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
    add('removal', ok, 'bad', ok ? `Comes out: latches back, lift the bow ${lift.toFixed(0)} mm, slide back ${slideOut.toFixed(0)} mm to free the trigger, lift away.` : 'The harp cannot be taken out: ' + problems.join('; ') + '.', null);
  } else if (style === 'sleeve') {
    removal = { ok: true, slideZ: -(hb0.maxZ - hb0.minZ + 10), problems: [] };
    add('removal', true, 'ok', 'Comes out: swing the gate open and slide the harp out of the mouth.');
  } else if (style === 'clam') {
    removal = { ok: true, liftOnly: true, problems: [] };
    add('removal', true, 'ok', 'Comes out: slide the bolt back, open the lid, lift the harp straight up.');
  }
  return { checks, removal, ok: checks.every(k => k.ok || k.level === 'info' || k.level === 'warn') };
}
