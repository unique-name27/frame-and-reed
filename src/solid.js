// Solid export: every printed piece as one closed, clean body.
// The model is built from many overlapping slabs (a deck layer, the hood on it, the ornament on that), which a slicer
// for a filament printer unions without complaint — but a print bureau's checks see "a part sitting on a part" and
// internal walls that could trap resin. So before a file is written, everything is run through a proper boolean union
// (manifold-3d, compiled to WebAssembly and carried inside the page), and the result is split into its separate
// pieces: the case, and each loose or moving part.
import Module from 'manifold-3d';
import wasmGz from './manifold.wasm.gz';

let ready = null;
export function manifoldReady() {
  if (!ready) ready = (async () => {
    const ds = new DecompressionStream('gzip');
    const bytes = new Uint8Array(await new Response(new Blob([wasmGz]).stream().pipeThrough(ds)).arrayBuffer());
    const wasm = await Module({ wasmBinary: bytes, locateFile: () => '' });
    wasm.setup();
    return wasm;
  })();
  return ready;
}

// one THREE mesh → indexed triangles in millimetres (world space), with coincident corners welded
function meshTriangles(m, THREE) {
  const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, pos = g.attributes.position, v = new THREE.Vector3();
  const map = new Map(), verts = [], tris = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).multiplyScalar(1000);
    const key = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
    let k = map.get(key); if (k === undefined) { k = verts.length / 3; map.set(key, k); verts.push(v.x, v.y, v.z); }
    tris[i] = k;
  }
  // drop triangles that collapsed to a line or a point when their corners were welded
  const keep = []; for (let i = 0; i < tris.length; i += 3) { const a = tris[i], b = tris[i + 1], c = tris[i + 2]; if (a !== b && b !== c && a !== c) keep.push(a, b, c); }
  return { verts: new Float32Array(verts), tris: new Uint32Array(keep) };
}

// A slab whose triangle mesh is not a closed solid (its outline pinches, and the rounded edge folds over itself there)
// is rebuilt straight from its outline: manifold's 2D boolean resolves the pinch, and the part is extruded square-edged.
function fromOutline(wasm, m, THREE) {
  const src = m.userData && m.userData.src; if (!src) return null;
  const { shape: outer, holes } = src.shape.extractPoints(24);
  const polys = [outer, ...holes].map(pts => pts.map(p => [p.x, -p.y])); // mirrored, so the turn below lands the right way round
  const cs = new wasm.CrossSection(polys, 'EvenOdd');
  const ex = cs.extrude(src.h); cs.delete();
  const turned = ex.rotate([-90, 0, 0]); ex.delete(); // extrusion axis z → the model's y (up); the outline's y → the model's z
  const lifted = turned.translate([0, src.yBase, 0]); turned.delete();
  // the outline is in millimetres; the mesh's own geometry was scaled to metres for the viewer, then placed by its matrix
  const M = new THREE.Matrix4().makeScale(1000, 1000, 1000).multiply(m.matrixWorld).multiply(new THREE.Matrix4().makeScale(0.001, 0.001, 0.001));
  const out = lifted.transform(Array.from(M.elements)); lifted.delete();
  return out;
}

// Where the solid touches itself along an edge or at a point (two walls meeting exactly), the union keeps two separate
// vertices at the same spot. A mesh file only has positions, so a reader welds them and sees an edge shared by four
// faces — "not manifold", and the file gets held. Each such copy is moved 2 µm toward the faces it belongs to, which
// opens the contact by a hair and leaves every edge with exactly two faces.
function separateTouching(q) {
  const np = q.numProp || 3, nv = q.verts.length / np, key = i => `${Math.round(q.verts[i * np] * 1e4)},${Math.round(q.verts[i * np + 1] * 1e4)},${Math.round(q.verts[i * np + 2] * 1e4)}`;
  const at = new Map(); for (let i = 0; i < nv; i++) { const k = key(i); const l = at.get(k); if (l) l.push(i); else at.set(k, [i]); }
  const dup = new Set(); for (const l of at.values()) if (l.length > 1) l.forEach(i => dup.add(i));
  if (!dup.size) return 0;
  const acc = new Map(); dup.forEach(i => acc.set(i, [0, 0, 0, 0]));
  for (let t = 0; t < q.tris.length; t += 3) {
    const a = q.tris[t], b = q.tris[t + 1], c = q.tris[t + 2];
    for (const v of [a, b, c]) { const s = acc.get(v); if (!s) continue; for (let k = 0; k < 3; k++) s[k] += (q.verts[a * np + k] + q.verts[b * np + k] + q.verts[c * np + k]) / 3; s[3]++; }
  }
  for (const [i, s] of acc) {
    if (!s[3]) continue;
    const dx = s[0] / s[3] - q.verts[i * np], dy = s[1] / s[3] - q.verts[i * np + 1], dz = s[2] / s[3] - q.verts[i * np + 2], l = Math.hypot(dx, dy, dz) || 1;
    q.verts[i * np] += dx / l * 0.002; q.verts[i * np + 1] += dy / l * 0.002; q.verts[i * np + 2] += dz / l * 0.002;
  }
  return dup.size;
}

// Union a list of meshes and split the result into pieces. Each piece: { verts, tris, volume, min, max }. Meshes that
// are not closed solids on their own (none should be) cannot take part in a union; they are returned in `raw` untouched.
export async function solidPieces(meshes, THREE) {
  const wasm = await manifoldReady(), { Manifold, Mesh } = wasm;
  const solids = [], raw = [];
  for (const m of meshes) {
    const t = meshTriangles(m, THREE); if (!t.tris.length) continue;
    try {
      let s = null;
      try { const mesh = new Mesh({ numProp: 3, vertProperties: t.verts, triVerts: t.tris }); mesh.merge(); s = new Manifold(mesh); }
      catch (e) { s = fromOutline(wasm, m, THREE); } // an outline that touches itself extrudes to a mesh with a seam; rebuild it
      if (!s || s.isEmpty()) { if (s) s.delete(); raw.push({ name: m.name, ...t }); continue; }
      // one mesh can hold several closed shells that overlap (a slab and its rounded cap): a Manifold takes its input as
      // one non-overlapping solid, so the shells go into the union one by one
      const shells = s.decompose(); s.delete(); solids.push(...shells);
    } catch (e) { raw.push({ name: m.name, ...t }); }
  }
  if (!solids.length) return { pieces: [], raw };
  const all = solids.length > 1 ? Manifold.union(solids) : solids[0];
  const pieces = [];
  for (const p of all.decompose()) {
    const vol = p.volume();
    if (Math.abs(vol) > 0.05) { // anything smaller is a numerical sliver where two faces met, not a piece of the case
      const mm = p.getMesh(), bb = p.boundingBox();
      const piece = { verts: mm.vertProperties.slice(), tris: mm.triVerts.slice(), numProp: mm.numProp, volume: vol, min: bb.min, max: bb.max };
      separateTouching(piece); pieces.push(piece);
    }
    p.delete();
  }
  solids.forEach(s => { if (s !== all) s.delete(); }); all.delete();
  pieces.sort((a, b) => b.volume - a.volume);
  return { pieces, raw };
}

// Enclosed voids: a piece whose surface falls into more than one closed shell has a cavity inside it. Counted by
// walking the triangle adjacency.
export function surfaceCount(piece) {
  const n = piece.tris.length / 3, parent = new Int32Array(piece.verts.length / piece.numProp).map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < n; i++) { const a = find(piece.tris[3 * i]), b = find(piece.tris[3 * i + 1]), c = find(piece.tris[3 * i + 2]); parent[b] = a; parent[find(c)] = a; }
  const roots = new Set(); for (let i = 0; i < n; i++) roots.add(find(piece.tris[3 * i]));
  return roots.size;
}

// binary STL, z up, sitting on z = 0 (the pieces are in y-up millimetres); shift: extra x/z offset for layout
export function piecesToSTL(pieces, raw = [], center = false) {
  const all = pieces.map(p => ({ verts: p.verts, tris: p.tris, np: p.numProp || 3 })).concat(raw.map(r => ({ verts: r.verts, tris: r.tris, np: 3 })));
  let n = 0, yMin = Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  all.forEach(q => { n += q.tris.length / 3; for (let i = 0; i < q.verts.length; i += q.np) { yMin = Math.min(yMin, q.verts[i + 1]); x0 = Math.min(x0, q.verts[i]); x1 = Math.max(x1, q.verts[i]); z0 = Math.min(z0, q.verts[i + 2]); z1 = Math.max(z1, q.verts[i + 2]); } });
  const cx = center ? (x0 + x1) / 2 : 0, cz = center ? (z0 + z1) / 2 : 0; // a file of its own sits in the middle of the plate
  const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  const hdr = 'Jaw harp case, millimetres, solid'; for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 0);
  let off = 84, count = 0;
  const P = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const q of all) for (let t = 0; t < q.tris.length; t += 3) {
    for (let k = 0; k < 3; k++) { const i = q.tris[t + k] * q.np; P[3 * k] = q.verts[i] - cx; P[3 * k + 1] = -(q.verts[i + 2] - cz); P[3 * k + 2] = q.verts[i + 1] - yMin; } // (x, y, z) → (x, −z, y): z up
    const ux = P[3] - P[0], uy = P[4] - P[1], uz = P[5] - P[2], vx = P[6] - P[0], vy = P[7] - P[1], vz = P[8] - P[2];
    // a sliver triangle stays in: dropping it would leave a hole the size of that sliver in an otherwise closed surface
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
    if (l > 0) { nx /= l; ny /= l; nz /= l; }
    dv.setFloat32(off, nx, true); dv.setFloat32(off + 4, ny, true); dv.setFloat32(off + 8, nz, true); off += 12;
    for (let k = 0; k < 9; k++) { dv.setFloat32(off, P[k], true); off += 4; }
    dv.setUint16(off, 0, true); off += 2; count++;
  }
  dv.setUint32(80, count, true);
  return buf.slice(0, off);
}
