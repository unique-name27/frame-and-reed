// Ornament for the top of the case: Damascus steel, botanical scrollwork and flowers.
// Everything here is 2D and works on a fine raster (DRES mm per pixel). A pattern is drawn as an "ink" mask inside an
// "area" mask; engine.js turns the ink into raised relief, engraving or pierced filigree. Units are millimetres, with
// x across the case and z along it, exactly as in the engine.

export const DRES = 0.1;

// ---------- rasters ----------
export function makeDRaster(bb, pad) {
  const x0 = bb.minX - pad, z0 = bb.minZ - pad, W = bb.maxX - bb.minX + 2 * pad, H = bb.maxZ - bb.minZ + 2 * pad;
  // 0.1 mm per pixel, coarser only for very large surfaces (a five-harp rack) so they stay quick to draw
  const px = W * H / (DRES * DRES), res = px > 6e6 ? 0.2 : px > 2.5e6 ? 0.15 : DRES;
  const w = Math.max(4, Math.ceil(W / res)), h = Math.max(4, Math.ceil(H / res));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return { c, ctx, w, h, x0, z0, res, toPx: (x, z) => [(x - x0) / res, (z - z0) / res], toMm: (px, py) => ({ x: px * res + x0, z: py * res + z0 }) };
}
// draw in millimetres from here on
export function mmSpace(D) { D.ctx.setTransform(1 / D.res, 0, 0, 1 / D.res, -D.x0 / D.res, -D.z0 / D.res); }
export function pxSpace(D) { D.ctx.setTransform(1, 0, 0, 1, 0, 0); }
export function clearD(D) { pxSpace(D); D.ctx.globalCompositeOperation = 'source-over'; D.ctx.clearRect(0, 0, D.w, D.h); }
export function readD(D) {
  const a = D.ctx.getImageData(0, 0, D.w, D.h).data, m = new Uint8Array(D.w * D.h);
  for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3] > 127 ? 1 : 0;
  return m;
}

// ---------- exact Euclidean distance transform (Felzenszwalb & Huttenlocher) ----------
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
// For every pixel with m = 1: distance in pixels to the nearest m = 0 pixel (0 where m = 0).
// borderIsZero: whether the world outside the raster counts as m = 0.
export function edt(m, w, h, borderIsZero = true) {
  const INF = 1e20, B = borderIsZero ? 0 : INF, g = new Float64Array(w * h);
  const n = Math.max(w, h) + 2, f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    f[0] = B; for (let y = 0; y < h; y++) f[y + 1] = m[y * w + x] ? INF : 0; f[h + 1] = B;
    edt1d(f, h + 2, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y + 1];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    f[0] = B; for (let x = 0; x < w; x++) f[x + 1] = g[y * w + x]; f[w + 1] = B;
    edt1d(f, w + 2, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(Math.min(d[x + 1], 1e12));
  }
  return out;
}
export const notM = m => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1; return o; };
export const andM = (a, b, not) => { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] && (not ? !b[i] : b[i]) ? 1 : 0; return o; };
export const orM = (a, b) => { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] || b[i] ? 1 : 0; return o; };
export const countM = m => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; };
// erode / dilate by r millimetres
export function erodeM(D, m, r) { const d = edt(m, D.w, D.h, true), rp = r / D.res, o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = d[i] > rp ? 1 : 0; return o; }
export function dilateM(D, m, r) { const d = edt(notM(m), D.w, D.h, false), rp = r / D.res, o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] || d[i] <= rp ? 1 : 0; return o; }
// opening removes ink thinner than 2r; closing fills gaps narrower than 2r
export const openM = (D, m, r) => dilateM(D, erodeM(D, m, r), r);
export const closeM = (D, m, r) => erodeM(D, dilateM(D, m, r), r);

// ---------- randomness ----------
export function rng(seed) {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function perlin(seed) {
  const r = rng(seed), P = Array.from({ length: 256 }, (_, i) => i), p = new Uint8Array(512);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = P[i]; P[i] = P[j]; P[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = P[i & 255];
  const grad = (hsh, x, y) => { switch (hsh & 7) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y; case 4: return x; case 5: return -x; case 6: return y; default: return -y; } };
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    let X = Math.floor(x), Y = Math.floor(y); x -= X; y -= Y; X &= 255; Y &= 255;
    const u = fade(x), v = fade(y), aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const g00 = grad(aa, x, y), g10 = grad(ba, x - 1, y), g01 = grad(ab, x, y - 1), g11 = grad(bb, x - 1, y - 1);
    const l1 = g00 + u * (g10 - g00), l2 = g01 + u * (g11 - g01);
    return (l1 + v * (l2 - l1)) * 0.7;
  };
}

// helpers shared by the vector patterns
function areaTools(D, area) {
  const { w, h, res } = D, dist = edt(area, w, h, true);
  const dmm = (x, z) => { const px = Math.round((x - D.x0) / res), py = Math.round((z - D.z0) / res); if (px < 0 || py < 0 || px >= w || py >= h) return 0; return dist[py * w + px] * res; };
  const idx = []; for (let i = 0; i < area.length; i += 7) if (area[i]) idx.push(i); // a thinned list of area pixels, for random picks
  const at = i => D.toMm(i % w + 0.5, ((i / w) | 0) + 0.5);
  let maxD = 0; for (let i = 0; i < dist.length; i++) if (dist[i] > maxD) maxD = dist[i];
  return { dist, dmm, idx, at, maxD: maxD * res };
}
// principal axis of the area (unit vector) and its extent along it
function principal(D, area) {
  let n = 0, sx = 0, sz = 0;
  for (let i = 0; i < area.length; i += 3) if (area[i]) { const p = D.toMm(i % D.w, (i / D.w) | 0); sx += p.x; sz += p.z; n++; }
  if (!n) return null;
  const cx = sx / n, cz = sz / n; let xx = 0, zz = 0, xz = 0;
  for (let i = 0; i < area.length; i += 3) if (area[i]) { const p = D.toMm(i % D.w, (i / D.w) | 0), dx = p.x - cx, dz = p.z - cz; xx += dx * dx; zz += dz * dz; xz += dx * dz; }
  const th = 0.5 * Math.atan2(2 * xz, xx - zz);
  return { cx, cz, ux: Math.cos(th), uz: Math.sin(th), th };
}
function drawStrokes(ctx, strokes) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000';
  for (const s of strokes) {
    if (s.poly) { ctx.beginPath(); s.poly.forEach((p, i) => i ? ctx.lineTo(p.x, p.z) : ctx.moveTo(p.x, p.z)); ctx.closePath(); ctx.fill(); continue; }
    if (s.dot) { ctx.beginPath(); ctx.arc(s.dot.x, s.dot.z, s.dot.r, 0, Math.PI * 2); ctx.fill(); continue; }
    const L = s.line; if (L.length < 2) continue;
    for (let i = 1; i < L.length; i++) { ctx.lineWidth = 2 * L[i].r; ctx.beginPath(); ctx.moveTo(L[i - 1].x, L[i - 1].z); ctx.lineTo(L[i].x, L[i].z); ctx.stroke(); }
  }
}
// an almond leaf from (x, z) along heading th: length len, widest width wd, a slight curl k
function leafPoly(x, z, th, len, wd, k = 0.12) {
  const pts = [], N = 18, side = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, a = th + k * (u - 0.5) * 2, mx = x + Math.cos(th) * len * u + Math.cos(th + Math.PI / 2) * k * len * u * (1 - u), mz = z + Math.sin(th) * len * u + Math.sin(th + Math.PI / 2) * k * len * u * (1 - u);
    const hw = 0.5 * wd * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.75) * (1 - 0.25 * u);
    pts.push({ x: mx + Math.cos(a + Math.PI / 2) * hw, z: mz + Math.sin(a + Math.PI / 2) * hw });
    side.push({ x: mx - Math.cos(a + Math.PI / 2) * hw, z: mz - Math.sin(a + Math.PI / 2) * hw, mx, mz, hw });
  }
  return { poly: pts.concat(side.slice().reverse()), mid: side.map(s => ({ x: s.mx, z: s.mz, r: s.hw })) };
}

// A growing-vine engine: strokes are laid down sample by sample, each one checked against the area edge and against
// every stroke already placed, so the ornament packs itself into whatever shape the case has.
function vineSpace(D, area, o) {
  const T = areaTools(D, area), cell = 1.0, grid = new Map(), strokes = [];
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  const add = (x, z, r, sid, i, flag) => { const cx = Math.floor(x / cell), cz = Math.floor(z / cell), k = key(cx, cz); let L = grid.get(k); if (!L) grid.set(k, L = []); L.push({ x, z, r, sid, i, blob: flag === 'blob', leaf: flag === 'leaf' }); };
  const free = (x, z, r, sid, i, skip, ignore) => {
    const reach = r + o.sep + o.maxR, c0 = Math.floor((x - reach) / cell), c1 = Math.floor((x + reach) / cell), d0 = Math.floor((z - reach) / cell), d1 = Math.floor((z + reach) / cell);
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
      const L = grid.get(key(cx, cz)); if (!L) continue;
      for (const p of L) {
        if (p.sid === sid && i - p.i < skip) continue;
        if (ignore && ignore.has(p.sid)) continue;
        const need = r + p.r + o.sep; if ((p.x - x) ** 2 + (p.z - z) ** 2 < need * need) return false;
      }
    }
    return true;
  };
  let sidN = 1;
  const STEP = 0.25;
  // grow one stroke. curv(t) gives the curvature at arc length t; returns the samples laid down
  function grow(x, z, th, g) {
    const sid = g.dry ? -7 : (g.sid || sidN++), line = [{ x, z, r: g.r0, th }], skip = Math.ceil((2 * g.r0 + o.sep) / STEP) + 3;
    let t = 0, i = 0;
    while (t < g.len) {
      const f = t / g.len, r = g.r0 + (g.r1 - g.r0) * f;
      th += g.curv(t, f, th) * STEP;
      if (g.steer) { // look ahead and lean away from the edge
        const la = 1.5 + r, ax = x + Math.cos(th) * la, az = z + Math.sin(th) * la;
        if (T.dmm(ax, az) < r + o.edge + 0.8) { const l = T.dmm(x + Math.cos(th + 0.6) * la, z + Math.sin(th + 0.6) * la), rr = T.dmm(x + Math.cos(th - 0.6) * la, z + Math.sin(th - 0.6) * la); th += (l > rr ? 1 : -1) * 0.09; }
      }
      const nx = x + Math.cos(th) * STEP, nz = z + Math.sin(th) * STEP;
      const inGrace = t < (g.grace || 0);
      if (!inGrace && T.dmm(nx, nz) < r + o.edge) break;
      if (!free(nx, nz, r, sid, i, skip, t < (g.ignoreFor || 0) ? g.ignore : null)) break;
      x = nx; z = nz; t += STEP; i++;
      line.push({ x, z, r, th }); if (!g.dry) add(x, z, r, sid, i);
    }
    return { sid, line };
  }
  // place a leaf if it fits
  function leaf(x, z, th, len, wd, parentSid, k) {
    const L = leafPoly(x, z, th, len, wd, k);
    for (const p of L.poly) if (T.dmm(p.x, p.z) < o.edge + 0.05) return false;
    const sid = sidN++, ign = new Set([parentSid]);
    for (let i = 3; i < L.mid.length; i++) { const m = L.mid[i]; if (!free(m.x, m.z, Math.max(m.r, 0.3), sid, i, 99, ign)) return false; }
    L.mid.forEach((m, i) => add(m.x, m.z, Math.max(m.r, 0.2), sid, i, 'leaf'));
    strokes.push({ poly: L.poly });
    return true;
  }
  return { T, grid, strokes, grow, leaf, add, free, newSid: () => sidN++ };
}

// ---------- 1. Damascus steel ----------
// Pattern-welded steel: layers folded into waves, with a few "raindrops" where the billet was drilled and flattened.
export function damascus(D, area, o) {
  const { w, h } = D, R = rng(o.seed * 7919 + 1), n1 = perlin(o.seed * 31 + 11), n2 = perlin(o.seed * 31 + 23);
  const per = o.period, th = R() * Math.PI, c = Math.cos(th), s = Math.sin(th);
  const T = areaTools(D, area), mm2 = T.idx.length * 7 * D.res * D.res;
  const drops = [], nDrops = Math.max(0, Math.round(mm2 / 260 * (o.drops ?? 1)));
  for (let k = 0, tries = 0; k < nDrops && tries < 400; tries++) {
    const p = T.at(T.idx[Math.floor(R() * T.idx.length)]); if (!p) break;
    const rad = per * (2.5 + 2 * R()); if (T.dmm(p.x, p.z) < rad * 0.6 || drops.some(q => Math.hypot(q.x - p.x, q.z - p.z) < q.rad + rad + 2 * per)) continue;
    drops.push({ x: p.x, z: p.z, rad, ph: R() }); k++;
  }
  const ink = new Uint8Array(w * h), duty = o.duty ?? 0.5;
  // the layers are bent by pushing the sample point around (domain warping), which keeps every layer about one
  // period thick — adding noise to the layer count instead folds them into blobs a printer cannot hold
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!area[i]) continue;
    let X = D.x0 + (x + 0.5) * D.res, Z = D.z0 + (y + 0.5) * D.res;
    const wx = 3.2 * n1(X / 15, Z / 15) + 0.9 * n2(X / 5 + 17, Z / 5), wz = 3.2 * n1(X / 15 + 53, Z / 15 + 29) + 0.9 * n2(X / 5 + 71, Z / 5 + 3);
    let v = ((X + wx) * c + (Z + wz) * s) / per;
    for (const q of drops) {
      const dx = X - q.x, dz = Z - q.z, r = Math.hypot(dx, dz);
      if (r < q.rad + per) { const t = Math.min(1, Math.max(0, (q.rad - r) / (0.7 * per))); v = v * (1 - t) + (r / per + q.ph) * t; }
    }
    if (v - Math.floor(v) < duty) ink[i] = 1;
  }
  return ink;
}

// ---------- shared: a main stem that meanders along the case ----------
function mainStem(V, D, area, o, R) {
  const T = V.T, ax = principal(D, area), W = Math.max(2 * T.maxD, 4);
  const lam = Math.min(Math.max(2.2 * W, 11), 34), A = 0.8, ph = R() * Math.PI * 2;
  let lo = 1e9, hi = -1e9; for (const i of T.idx) { const p = T.at(i), pr = (p.x - ax.cx) * ax.ux + (p.z - ax.cz) * ax.uz; if (pr < lo) lo = pr; if (pr > hi) hi = pr; }
  // grow from one end of the principal axis toward the other, starting as near the middle of that end as possible
  const attempt = dir => {
    const ux = ax.ux * dir, uz = ax.uz * dir, th0 = Math.atan2(uz, ux), end = dir > 0 ? lo : -hi;
    const cands = T.idx.map(T.at).filter(p => (p.x - ax.cx) * ux + (p.z - ax.cz) * uz < end + 2.5);
    cands.sort((a, b) => T.dmm(b.x, b.z) - T.dmm(a.x, a.z));
    const st = cands[0] || T.at(T.idx[0]);
    let sx = st.x, sz = st.z; for (let k = 0; k < 80 && T.dmm(sx, sz) > 0.05; k++) { sx -= ux * 0.2; sz -= uz * 0.2; } // back to the rim
    // the stem steers toward a heading that swings either side of the axis, so it waves along the case instead of wandering off
    return V.grow(sx, sz, th0, { len: 900, r0: o.stem / 2, r1: o.stem / 2 * 0.8, steer: true, grace: 1.5, dry: true,
      curv: (t, f, th) => { const thd = th0 + A * Math.sin(2 * Math.PI * t / lam + ph); let d = thd - th; d = Math.atan2(Math.sin(d), Math.cos(d)); return 0.9 * d; } });
  };
  // try from both ends without laying anything down, then grow the longer one for real
  const a1 = attempt(1), a2 = attempt(-1), dir = a1.line.length >= a2.line.length ? 1 : -1;
  const ux = ax.ux * dir, uz = ax.uz * dir, th0 = Math.atan2(uz, ux), end = dir > 0 ? lo : -hi;
  const cands = T.idx.map(T.at).filter(p => (p.x - ax.cx) * ux + (p.z - ax.cz) * uz < end + 2.5);
  cands.sort((a, b) => T.dmm(b.x, b.z) - T.dmm(a.x, a.z));
  const st = cands[0] || T.at(T.idx[0]);
  let sx = st.x, sz = st.z; for (let k = 0; k < 80 && T.dmm(sx, sz) > 0.05; k++) { sx -= ux * 0.2; sz -= uz * 0.2; }
  const main = V.grow(sx, sz, th0, { len: 900, r0: o.stem / 2, r1: o.stem / 2 * 0.8, steer: true, grace: 1.5,
    curv: (t, f, th) => { const thd = th0 + A * Math.sin(2 * Math.PI * t / lam + ph); let d = thd - th; d = Math.atan2(Math.sin(d), Math.cos(d)); return 0.9 * d; } });
  return { main, lam, W, ax };
}
// fill the largest empty spaces: spawn(nearest stroke sample, target x, z, clearance, distance) grows something there
function fillVoids(D, area, V, minVoid, spawn, rimFactor = 0.8) {
  const f = 4, fw = Math.ceil(D.w / f), fh = Math.ceil(D.h / f), fres = D.res * f;
  const cv = document.createElement('canvas'); cv.width = fw; cv.height = fh; const cx = cv.getContext('2d', { willReadFrequently: true });
  const areaC = new Uint8Array(fw * fh); for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) areaC[y * fw + x] = area[Math.min(D.h - 1, y * f + 1) * D.w + Math.min(D.w - 1, x * f + 1)];
  for (let it = 0; it < 60; it++) {
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, fw, fh); cx.setTransform(1 / fres, 0, 0, 1 / fres, -D.x0 / fres, -D.z0 / fres);
    drawStrokes(cx, V.strokes); cx.fillStyle = '#000';
    for (const L of V.grid.values()) for (const p of L) if (p.blob) { cx.beginPath(); cx.arc(p.x, p.z, p.r, 0, Math.PI * 2); cx.fill(); }
    const a = cx.getImageData(0, 0, fw, fh).data, freeM = new Uint8Array(fw * fh);
    for (let i = 0; i < freeM.length; i++) freeM[i] = areaC[i] && a[i * 4 + 3] < 64 ? 1 : 0;
    const d = edt(freeM, fw, fh, true); let bi = -1, bd = 0; for (let i = 0; i < d.length; i++) if (d[i] > bd) { bd = d[i]; bi = i; }
    const clear = bd * fres; if (clear < minVoid || bi < 0) break;
    const tx = D.x0 + (bi % fw + 0.5) * fres, tz = D.z0 + (((bi / fw) | 0) + 0.5) * fres;
    let np = null, nd = 1e9; for (const L of V.grid.values()) for (const p of L) { if (p.blob || p.leaf) continue; const dd = (p.x - tx) ** 2 + (p.z - tz) ** 2; if (dd < nd) { nd = dd; np = p; } }
    // or the rim, if that is nearer: walk down the distance field to the area's edge
    { const T = V.T; let x = tx, z = tz; for (let k = 0; k < 400 && T.dmm(x, z) > 0.05; k++) { const e = 0.3, gx = T.dmm(x + e, z) - T.dmm(x - e, z), gz = T.dmm(x, z + e) - T.dmm(x, z - e), gl = Math.hypot(gx, gz) || 1; x -= gx / gl * 0.25; z -= gz / gl * 0.25; }
      const dd = (x - tx) ** 2 + (z - tz) ** 2; if (dd < nd * rimFactor) { nd = dd; np = { x, z, r: 0.5, sid: -3, rim: true }; } }
    if (!np || !spawn(np, tx, tz, clear, Math.sqrt(nd))) V.add(tx, tz, Math.min(clear * 0.9, 2.5), V.newSid(), 0, 'blob'); // could not fill it: mark the spot taken
  }
}
function strokeInk(D, strokes) { clearD(D); mmSpace(D); drawStrokes(D.ctx, strokes); pxSpace(D); return readD(D); }

// ---------- 2. Botanical scrollwork ----------
// A rinceau: one main stem waves along the case, throwing off tendrils that curl into spirals, with leaves at the
// forks; then the biggest empty spaces get more curls, branching off whatever stroke is nearest.
export function scrollwork(D, area, o) {
  const R = rng(o.seed * 104729 + 3), V = vineSpace(D, area, o), T = V.T;
  if (!T.idx.length) return new Uint8Array(D.w * D.h);
  const { main, lam, W } = mainStem(V, D, area, o, R); V.strokes.push({ line: main.line });
  const stemR = o.stem / 2, minR = o.minW / 2;
  const curl = (p, side, rho0, r0, parentSid, len) => {
    let rho = rho0; const tau = rho0 * (2.0 + R() * 0.8);
    const s = V.grow(p.x, p.z, p.th + side * (0.9 + 0.35 * R()), { len: len || 7 * rho0, r0, r1: minR, curv: t => { rho = Math.max(minR * 2.2, rho0 * Math.exp(-t / tau)); return side / rho; }, ignore: new Set([parentSid]), ignoreFor: r0 * 2 + o.sep + 1.2 });
    if (s.line.length > 6) { V.strokes.push({ line: s.line }); const e = s.line[s.line.length - 1]; V.strokes.push({ dot: { x: e.x, z: e.z, r: Math.max(e.r * 1.4, minR * 1.3) } }); }
    return s;
  };
  const Lm = main.line; let side = R() < 0.5 ? 1 : -1;
  const every = Math.max(10, Math.round(lam / 2 / 0.25));
  const room = (p, sd, a, b) => { const an = p.th + sd * Math.PI / 2; let r = 0; for (const dd of [a, b]) r += Math.min(T.dmm(p.x + Math.cos(an) * dd, p.z + Math.sin(an) * dd), b); return r; };
  for (let j = Math.round(every * 0.5); j < Lm.length - 4; j += every) {
    const p = Lm[j];
    side = room(p, 1, W * 0.15, W * 0.3) >= room(p, -1, W * 0.15, W * 0.3) ? 1 : -1;
    const t = curl(p, side, Math.min(W * 0.2, lam * 0.2) * (0.85 + 0.3 * R()), stemR * 0.85, main.sid);
    if (t.line.length > 30 && R() < 0.75) { const q = t.line[Math.floor(t.line.length * 0.3)]; curl(q, -side, Math.min(W * 0.11, lam * 0.11), Math.max(minR, stemR * 0.6), t.sid); }
    const q = Lm[Math.min(Lm.length - 1, j + Math.round(every * 0.4))];
    V.leaf(p.x, p.z, p.th - side * 0.75, o.leaf * (0.9 + 0.25 * R()), o.leaf * 0.42, main.sid, 0.15 * -side);
    V.leaf(q.x, q.z, q.th + side * 0.8, o.leaf * (0.75 + 0.2 * R()), o.leaf * 0.38, main.sid, 0.15 * side);
    side = -side;
  }
  fillVoids(D, area, V, o.leaf * 0.5, (np, tx, tz, clear, dist) => {
    const th = Math.atan2(tz - np.z, tx - np.x), sd = R() < 0.5 ? 1 : -1;
    // a stem out to the space, then a curl that fills it. The stem is only kept if the curl grows: a bare stub
    // poking out of the rim is not an ornament.
    let base = { x: np.x, z: np.z, th, sid: np.sid }, stem = null;
    const reach = dist - clear * 0.55;
    if (reach > 1.0) {
      stem = V.grow(np.x, np.z, th, { len: reach, r0: np.rim ? stemR * 0.9 : Math.max(minR, Math.min(stemR, np.r) * 0.9), r1: Math.max(minR, stemR * 0.7), curv: () => sd * 0.04, ignore: new Set([np.sid]), ignoreFor: stemR * 2 + o.sep + 1.2, grace: np.rim ? 1.5 : 0, dry: true });
      if (stem.line.length < 4) return !np.rim && V.leaf(np.x, np.z, th, Math.min(o.leaf, dist + clear * 0.6), o.leaf * 0.4, np.sid, 0.1);
      const e = stem.line[stem.line.length - 1]; base = { x: e.x, z: e.z, th: e.th, sid: -7 };
    }
    const made = curl({ x: base.x, z: base.z, th: base.th - sd * 1.0 }, sd, Math.max(minR * 3, clear * 0.62), Math.max(minR, stemR * 0.7), base.sid, 8 * clear);
    if (made.line.length < 8) return !np.rim && !!stem;
    if (stem) {
      const sid = V.newSid(); stem.line.forEach((q, i) => V.add(q.x, q.z, q.r, sid, i)); V.strokes.push({ line: stem.line });
      if (R() < 0.7) { const q = stem.line[Math.floor(stem.line.length * 0.5)]; V.leaf(q.x, q.z, q.th + sd * 0.8, o.leaf * 0.8, o.leaf * 0.36, sid, -0.12 * sd); }
    }
    return true;
  }, o.edge < 0 ? 0.8 : 0.2);
  return andM(strokeInk(D, V.strokes), area);
}

// ---------- blossoms (flowers, and the sakura on the Japanese waves) ----------
// f: {x, z, rad, th (the direction the stem arrives from, or any), n (5 = sakura, more = daisy)}
function drawBlossom(ctx, f, o) {
  const { x, z, rad, n } = f, rot = f.th + Math.PI; // a petal faces straight down the stem, so the stem lands on solid petal
  ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineCap = 'round';
  if (n === 5) {
    ctx.beginPath(); for (let k = 0; k < n; k++) { const a = rot + k * 2 * Math.PI / n, px = x + Math.cos(a) * rad * 0.55, pz = z + Math.sin(a) * rad * 0.55; ctx.moveTo(px + rad * 0.47, pz); ctx.arc(px, pz, rad * 0.47, 0, Math.PI * 2); } ctx.fill();
  } else {
    for (let k = 0; k < n; k++) { const a = rot + k * 2 * Math.PI / n; ctx.save(); ctx.translate(x + Math.cos(a) * rad * 0.56, z + Math.sin(a) * rad * 0.56); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, 0, rad * 0.45, Math.max(o.minW * 0.62, rad * 0.17), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  }
  ctx.beginPath(); ctx.arc(x, z, rad * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = o.gap;
  const r0 = o.pierce ? rad * 0.5 : rad * 0.32 + o.gap * 0.5;
  if (n === 5) {
    for (let k = 0; k < n; k++) { const a = rot + (k + 0.5) * 2 * Math.PI / n; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, z + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * (rad + 1), z + Math.sin(a) * (rad + 1)); ctx.stroke(); }
    const nr = rad * 0.15; if (nr > o.gap * 0.7) for (let k = 1; k < n; k++) { const a = rot + k * 2 * Math.PI / n; ctx.beginPath(); ctx.arc(x + Math.cos(a) * rad * 1.05, z + Math.sin(a) * rad * 1.05, nr, 0, Math.PI * 2); ctx.fill(); } // the sakura notch (not on the stem's petal)
  }
  if (o.pierce || rad * 0.32 < o.gap * 2.2) { ctx.beginPath(); ctx.arc(x, z, Math.max(o.gap * 0.6, rad * 0.12), 0, Math.PI * 2); ctx.fill(); } // a pierced eye
  else { ctx.beginPath(); ctx.arc(x, z, rad * 0.32 + o.gap * 0.5, 0, Math.PI * 2); ctx.stroke(); } // the pistil stands apart
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- 3. Flowers ----------
// A flowering vine: the same waving stem, but its side shoots end in blossoms (notched five-petal ones, and daisies
// where the printer can hold the thin petals), with leaves between; empty spaces get more shoots and flowers.
export function flowers(D, area, o) {
  const R = rng(o.seed * 15485863 + 7), V = vineSpace(D, area, { ...o, maxR: o.R * 1.3 + o.stem }), T = V.T;
  if (!T.idx.length) return new Uint8Array(D.w * D.h);
  const { main, lam } = mainStem(V, D, area, o, R); V.strokes.push({ line: main.line });
  const blossoms = [], twigs = [];
  const fits = (x, z, rad) => T.dmm(x, z) >= rad * 0.92 + o.edge && V.free(x, z, rad * 0.88, -1, 0, 0, null);
  // a curved stalk from p to the blossom's edge, registered so later pieces keep clear of it
  const stalk = (p, cx, cz, rad) => {
    const th = Math.atan2(cz - p.z, cx - p.x), L = Math.hypot(cx - p.x, cz - p.z) - rad * 0.55, bend = (R() - 0.5) * 0.5 * L;
    const P1 = { x: p.x + Math.cos(th) * L, z: p.z + Math.sin(th) * L }, C = { x: (p.x + P1.x) / 2 - Math.sin(th) * bend, z: (p.z + P1.z) / 2 + Math.cos(th) * bend };
    const n = Math.max(4, Math.ceil(L / 0.25)), line = [], sid = V.newSid(), r = Math.max(o.minW / 2, o.stem / 2 * 0.85);
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t, x = u * u * p.x + 2 * u * t * C.x + t * t * P1.x, z = u * u * p.z + 2 * u * t * C.z + t * t * P1.z; line.push({ x, z, r, th }); if (i > 3) V.add(x, z, r, sid, i); }
    for (let i = 1; i < line.length; i++) line[i].th = Math.atan2(line[i].z - line[i - 1].z, line[i].x - line[i - 1].x);
    V.strokes.push({ line }); twigs.push(line); return line;
  };
  const bloom = (x, z, th, rad) => { V.add(x, z, rad, V.newSid(), 0, 'blob'); blossoms.push({ x, z, rad, th, n: o.daisy && R() < 0.35 ? 9 + Math.floor(R() * 3) : 5 }); };
  // a flower off the stem at p, toward direction dir: nearer and smaller until one fits
  const flowerAt = p => (dir) => {
    for (const [dk, rk] of [[1.9, 1], [1.6, 0.85], [2.4, 0.95], [1.45, 0.7], [2.0, 0.62]]) {
      const rad = o.R * rk * (0.92 + 0.16 * R()); if (rad < o.minBloom) continue;
      const cx = p.x + Math.cos(dir) * rad * dk, cz = p.z + Math.sin(dir) * rad * dk;
      if (fits(cx, cz, rad)) { const l = stalk(p, cx, cz, rad); bloom(cx, cz, l[l.length - 1].th, rad); return true; }
    }
    return false;
  };
  const room = (p, sd) => { const an = p.th + sd * Math.PI / 2; let r = 0; for (const dd of [o.R * 1.3, o.R * 2.4]) r += Math.min(T.dmm(p.x + Math.cos(an) * dd, p.z + Math.sin(an) * dd), o.R * 2); return r; };
  const Lm = main.line, every = Math.max(10, Math.round(lam / 4 / 0.25));
  for (let j = Math.round(every * 0.6); j < Lm.length - 4; j += every) {
    const p = Lm[j], side = room(p, 1) >= room(p, -1) ? 1 : -1;
    const ok = flowerAt(p)(p.th + side * (0.9 + 0.4 * R())) || flowerAt(p)(p.th - side * (0.9 + 0.4 * R()));
    if (!ok) V.leaf(p.x, p.z, p.th + side * 0.8, o.leaf * (0.85 + 0.25 * R()), o.leaf * 0.4, main.sid, 0.14 * side);
    else if (R() < 0.7) V.leaf(p.x, p.z, p.th - side * 0.8, o.leaf * 0.8, o.leaf * 0.36, main.sid, -0.14 * side);
  }
  // the biggest gaps left: a flower right in the middle, on a stalk back to the nearest stem
  fillVoids(D, area, V, o.minBloom * 0.95, (np, tx, tz, clear, dist) => {
    const rad = Math.min(o.R * 1.15, clear * 0.95);
    if (rad >= o.minBloom && fits(tx, tz, rad)) { const l = stalk(np, tx, tz, rad); bloom(tx, tz, l[l.length - 1].th, rad); return true; }
    return !np.rim && V.leaf(np.x, np.z, Math.atan2(tz - np.z, tx - np.x), Math.min(o.leaf, dist + clear * 0.7), o.leaf * 0.4, np.sid, 0.1); // no stray leaves stuck on the rim
  });
  clearD(D); mmSpace(D); drawStrokes(D.ctx, V.strokes);
  for (const b of blossoms) drawBlossom(D.ctx, b, o);
  // stalks are drawn again over the blossoms' cuts, so each flower stays joined to its stem
  D.ctx.lineCap = 'round'; for (const L of twigs) for (let i = Math.max(1, L.length - 6); i < L.length; i++) { D.ctx.lineWidth = 2 * L[i].r; D.ctx.beginPath(); D.ctx.moveTo(L[i - 1].x, L[i - 1].z); D.ctx.lineTo(L[i].x, L[i].z); D.ctx.stroke(); }
  pxSpace(D);
  return andM(readD(D), area);
}

// ---------- 4. Japanese: seigaiha waves with drifting sakura ----------
// Seigaiha ("blue sea waves"): rows of concentric arcs, each row laid over the one behind it. A few cherry blossoms
// float on top, each cleared a margin in the waves (in pierced work they sit straight on the waves, to stay attached).
export function seigaiha(D, area, o) {
  const R = rng(o.seed * 2654435 + 11), T = areaTools(D, area);
  if (!T.idx.length) return new Uint8Array(D.w * D.h);
  const pitch = o.line + o.gap, rw = pitch * o.rings + o.line * 0.5; // outer radius of one wave
  const bx0 = D.x0, bx1 = D.x0 + D.w * D.res, bz0 = D.z0, bz1 = D.z0 + D.h * D.res;
  const up = R() < 0.5 ? 1 : -1, x0 = bx0 - rw * R(); // arcs open toward +z or −z; a random phase across
  const ctx = D.ctx; clearD(D); mmSpace(D); ctx.lineCap = 'butt';
  const rows = []; for (let j = 0, z = up > 0 ? bz1 + rw : bz0 - rw; j < 400; j++, z -= up * rw / 2) { rows.push({ z, odd: j % 2 }); if (up > 0 ? z < bz0 - rw : z > bz1 + rw) break; }
  for (const row of rows) {
    for (let x = x0 + (row.odd ? rw : 0) - 2 * rw; x < bx1 + 2 * rw; x += 2 * rw) {
      ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(x, row.z, rw, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = o.line;
      for (let k = 0; k < o.rings; k++) { const r = rw - o.line / 2 - k * pitch; if (r < o.line) break; ctx.beginPath(); ctx.arc(x, row.z, r, 0, Math.PI * 2); ctx.stroke(); }
      const rc = rw - o.line / 2 - o.rings * pitch; if (rc > o.line * 0.6) { ctx.beginPath(); ctx.arc(x, row.z, rc, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  // sakura drifting on the water
  const fl = [], want = Math.max(1, Math.min(6, Math.round(T.idx.length * 7 * D.res * D.res / 380)));
  for (let t = 0; t < 3000 && fl.length < want; t++) {
    const p = T.at(T.idx[Math.floor(R() * T.idx.length)]), rad = o.R * (0.85 + 0.45 * R());
    if (T.dmm(p.x, p.z) < rad * 0.7) continue; if (fl.some(q => Math.hypot(q.x - p.x, q.z - p.z) < q.rad + rad + rw)) continue;
    fl.push({ x: p.x, z: p.z, rad, th: R() * Math.PI * 2, n: 5 });
  }
  for (const f of fl) {
    if (!o.pierce) { ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(f.x, f.z, f.rad + o.gap * 1.2, 0, Math.PI * 2); ctx.fill(); }
    drawBlossom(ctx, f, o);
  }
  pxSpace(D);
  return andM(readD(D), area);
}

// sizes by printing process: what a 0.4 mm FDM nozzle can hold, and what an MSLA resin printer can
export const DECO = {
  fdm:   { line: 1.0, gap: 0.9, period: 2.2, R: 3.4, minBloom: 2.5, leaf: 4.6, stem: 1.1, minW: 0.85, sep: 0.9, ring: 2.4, depth: 0.6, clean: 0.35, rings: 3, daisy: false },
  resin: { line: 0.55, gap: 0.5, period: 1.3, R: 2.9, minBloom: 1.5, leaf: 3.3, stem: 0.7, minW: 0.5, sep: 0.55, ring: 2.0, depth: 0.6, clean: 0.2, rings: 4, daisy: true },
};
export const PATTERNS = ['damascus', 'scroll', 'flowers', 'seigaiha'];
// draw the ink for a pattern inside `area`
export function patternInk(kind, D, area, proc, seed, pierce) {
  const S = DECO[proc] || DECO.fdm, k = pierce ? 1.3 : 1;
  let ink;
  if (kind === 'damascus') ink = damascus(D, area, { seed, period: S.period * (pierce ? 1.35 : 1), duty: pierce ? 0.55 : 0.5 });
  else if (kind === 'scroll') ink = scrollwork(D, area, { seed, stem: S.stem * k, minW: S.minW * k, leaf: S.leaf, sep: S.sep * (pierce ? 1.2 : 1), edge: pierce ? -0.2 : 0.15, maxR: S.leaf * 0.3 + S.stem });
  else if (kind === 'flowers') ink = flowers(D, area, { seed, R: S.R, gap: S.gap * (pierce ? 1.15 : 1), stem: S.stem * k, minW: S.minW * k, leaf: S.leaf * 0.85, sep: S.sep * (pierce ? 1.2 : 1), edge: pierce ? -0.2 : 0.15, maxR: S.leaf * 0.3 + S.stem, pierce, daisy: S.daisy, minBloom: S.minBloom * (pierce ? 1.15 : 1) });
  else if (kind === 'seigaiha') ink = seigaiha(D, area, { seed, line: S.line * k, gap: S.gap * (pierce ? 1.15 : 1), rings: S.rings, R: S.R * 1.25, minW: S.minW * k, pierce });
  else return new Uint8Array(D.w * D.h);
  // nothing thinner than the printer can hold, no gap narrower than it can open
  const r = S.clean * (pierce ? 1.2 : 1);
  ink = andM(closeM(D, openM(D, ink, r), r), area);
  // clipping to the area can leave slivers where a stroke grazes its edge: open once more to clear them
  return openM(D, ink, r * 0.8);
}
