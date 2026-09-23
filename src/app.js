import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { zipSync, strToU8 } from 'fflate';
import { IN, PRESETS, mats, state, build, sampleHarpImage, toSTL, toOBJ, parametricHarp } from './engine.js';
import { openTracer, lastImage } from './tracer.js';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------- units ----------------
// The engine keeps its own units (harp sizes in inches, case sizes in millimetres). The page shows — and takes — every
// length in whichever the person picks. Slicer settings (nozzle, layer height, filament) stay in millimetres, as
// every slicer has them.
const NATIVE = { len: 'in', wid: 'in', span: 'in', trig: 'in', tail: 'in', arm: 'mm', thick: 'mm', wall: 'mm', clr: 'mm', pgap: 'mm' };
const LEN_IDS = Object.keys(NATIVE);
let units = (() => { try { const u = localStorage.getItem('jhcg-units'); if (u === 'mm' || u === 'in') return u; } catch (e) { /* no storage here */ } return /^en-(US|LR)\b/i.test(navigator.language || '') ? 'in' : 'mm'; })();
state.units = units;
const conv = (v, from, to) => from === to ? v : to === 'mm' ? v * IN : v / IN;
const NATIVE_RANGE = {}; LEN_IDS.forEach(id => { const el = $(id); NATIVE_RANGE[id] = { min: +el.min, max: +el.max, step: el.step }; });
// A slider in inches moves in 64ths, so a value set from outside (a preset, a design code, a link) would be rounded to
// the nearest stop and the design would change. Values set that way are kept exactly, for as long as the slider still
// shows what they were set to; the moment it is dragged, the slider's own value takes over.
const exact = {};
function getv(id) {
  if (!NATIVE[id]) return +$(id).value;
  const e = exact[id]; if (e && e.shown === $(id).value) return e.v;
  return conv(+$(id).value, units, NATIVE[id]); // in the engine's units
}
function setv(id, v) {
  const el = $(id); if (!NATIVE[id]) { el.value = v; return; }
  el.value = String(+conv(+v, NATIVE[id], units).toFixed(6)); exact[id] = { v: +v, shown: el.value };
}
// a length (given in mm) as text in the chosen units
function L(mm, d) {
  const v = +mm;
  if (units === 'mm') { const dd = d ?? (Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 1 : 2); return `${+v.toFixed(dd)} mm`; }
  const i = v / IN; return `${i.toFixed(Math.abs(i) < 0.1 ? 3 : Math.abs(i) < 10 ? 2 : 1)} in`;
}
// the nearest sixty-fourth, when a small inch value is close to one
function frac(i) { const n = Math.round(i * 64); if (!n || Math.abs(i * 64 - n) > 0.3) return ''; let a = n, b = 64; while (a % 2 === 0 && b > 1) { a /= 2; b /= 2; } return b === 1 ? '' : ` (${Math.abs(i * 64 - n) < 0.02 ? '' : '≈'}${a}/${b})`; }
function fmtLen(id, v) { // v in the slider's native unit
  const mm = NATIVE[id] === 'in' ? v * IN : v;
  if (id === 'tail' && v <= 0) return 'none';
  if (units === 'mm') return `${+mm.toFixed(mm >= 10 ? 1 : 2)} mm`;
  const i = mm / IN; return `${i.toFixed(i < 0.1 ? 3 : 2)} in` + (['thick', 'arm', 'wall'].includes(id) ? frac(i) : '');
}
function setUnits(u, fromNative) {
  const canon = Object.fromEntries(LEN_IDS.map(id => [id, fromNative ? +$(id).value : getv(id)]));
  const td = +$('t-dist').value, tdMm = (fromNative ? 'in' : units) === 'mm' ? td : td * IN;
  units = u; state.units = u; try { localStorage.setItem('jhcg-units', u); } catch (e) { /* fine */ }
  LEN_IDS.forEach(id => {
    const el = $(id), r = NATIVE_RANGE[id];
    if (NATIVE[id] === u) { el.min = r.min; el.max = r.max; el.step = r.step; }
    else if (u === 'in' && ['thick', 'arm', 'wall'].includes(id)) { // sixty-fourths, so 3/8 in is a stop on the slider
      el.min = Math.ceil(conv(r.min, 'mm', 'in') * 64) / 64; el.max = Math.floor(conv(r.max, 'mm', 'in') * 64) / 64; el.step = 1 / 64;
    } else { el.step = 'any'; el.min = +conv(r.min, NATIVE[id], u).toFixed(4); el.max = +conv(r.max, NATIVE[id], u).toFixed(4); }
    setv(id, canon[id]);
  });
  const t = $('t-dist'); t.step = u === 'mm' ? '0.5' : '0.05'; t.value = u === 'mm' ? +tdMm.toFixed(1) : +(tdMm / IN).toFixed(2);
  document.querySelectorAll('.u-len').forEach(e => { e.textContent = u; });
  document.querySelectorAll('#units button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.u === u)));
  document.querySelectorAll('.len').forEach(e => { const vals = e.dataset.mm.split(',').map(Number), unit = units === 'mm' ? ' mm' : ' in';
    const one = v => units === 'mm' ? String(+v.toFixed(2)) : (v / IN).toFixed(v / IN < 0.1 ? 3 : v / IN < 10 ? 2 : 1);
    e.textContent = (e.dataset.pre || '') + vals.map(one).join(e.dataset.sep || ' × ') + unit; });
  document.querySelectorAll('.alt').forEach(e => { e.textContent = units === 'mm' ? e.dataset.mm : e.dataset.in; });
}

// ---------------- stage ----------------
class Stage {
  constructor(el) {
    this.el = el;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    el.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.001, 50);
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(0.6, 1.2, 0.8); this.scene.add(key);
    // a low, raking light from the other side: it catches the walls of raised and engraved work so the ornament reads
    const rake = new THREE.DirectionalLight(0xfff4e6, 0.9); rake.position.set(-1, 0.32, -0.55); this.scene.add(rake);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8698, 0.5));
    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = 0.08; c.autoRotate = !reduced; c.autoRotateSpeed = 0.9; c.maxPolarAngle = Math.PI * 0.62;
    c.addEventListener('start', () => { c.autoRotate = false; $('hint').style.opacity = 0; });
    this.obj = null;
    new ResizeObserver(() => this.resize()).observe(el); this.resize();
    const tick = () => { c.update(); r.render(this.scene, this.camera); requestAnimationFrame(tick); }; tick();
  }
  resize() { const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  setObject(g, keepView) {
    if (this.obj) { this.scene.remove(this.obj); this.obj.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); } }); }
    this.obj = g; this.scene.add(g);
    if (!keepView) this.frame();
  }
  frame() {
    const box = new THREE.Box3().setFromObject(this.obj), s = new THREE.Sphere(); box.getBoundingSphere(s);
    const d = s.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.0;
    this.controls.target.copy(s.center);
    this.camera.position.copy(s.center).add(new THREE.Vector3(-0.55, 0.62, 0.85).normalize().multiplyScalar(d));
    this.camera.near = d / 100; this.camera.far = d * 20; this.camera.updateProjectionMatrix();
    this.controls.update();
  }
}
// A stage that works without WebGL: the model still builds (and downloads), it just cannot be shown.
class NullStage {
  constructor(el) { this.el = el; this.camera = new THREE.PerspectiveCamera(); this.controls = { autoRotate: false, target: new THREE.Vector3(), update() {} };
    el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font:italic 16px/1.5 var(--serif);color:var(--muted)">The 3D preview needs WebGL, which this browser has turned off.<br>Everything else works — the print files are built from the same model.</div>'; }
  setObject() {} frame() {} resize() {}
}
let stage;
try { stage = new Stage($('stage')); } catch (e) { console.warn('WebGL unavailable', e); stage = new NullStage($('stage')); }

// ---------------- data ----------------
const STYLES = [
  ['deck', 'Open deck', 'Two latches across the bow and a roof over the trigger end. Thinnest of the five, and the one to print first.', '',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 26h44v5H6z"/><path d="M8 26V15h40v11"/><path d="M8 15c0-3 3-4 6-4h6v15"/><path d="M12 20h7M37 20h7" stroke-width="3" stroke-linecap="round"/></svg>'],
  ['sleeve', 'Slide sleeve', 'Goes in bow first, under a slotted roof. A turn-button at the mouth stops it sliding back out.', '',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 26h44v5H6z"/><path d="M6 26V14h44v12"/><path d="M6 14c0-3 2-5 5-5h9v22"/><path d="M26 14h24" stroke-dasharray="3 3"/><path d="M22 9v17" opacity=".5"/></svg>'],
  ['clam', 'Hinged clamshell', 'Flat base, hinged lid, sliding bolt at the far end. Two prints and a bit of filament for the hinge pin.', '',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 27h40v5H6z"/><path d="M6 27V19h40v8"/><path d="M46 19l6-14h-30l-4 8" /><circle cx="46" cy="19" r="2.2"/></svg>'],
  ['pendant', 'Pendant', 'The deck with windows cut in the floor so the harp shows through. For wearing on a cord.', '',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 30h36v4H12z"/><path d="M14 30V19h32v11"/><path d="M14 19c0-3 3-4 6-4h6v15"/><path d="M28 30v4M40 30v4" opacity=".4"/><path d="M12 22H8c-3 0-4-2-4-4v-5" stroke-linecap="round"/><circle cx="4" cy="11" r="2.2"/></svg>'],
  ['multi', 'Collector rack', 'Two to five pockets in a row, sharing turn-buttons between neighbours. For a shelf or a gig bag.', '',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M4 26h48v5H4z"/><path d="M6 26V15h44v11"/><path d="M6 15c0-3 2-4 5-4h5v15M20 11h6v15M36 11h4v15"/><path d="M11 20h4M23 20h6M41 20h4" stroke-width="3" stroke-linecap="round"/></svg>'],
];
const HOLDS = [
  ['bladeSide', 'Hidden blades · side', 'Flat blades that slide in through the side walls and lie over the bow. Push them with a thumb. Nothing sticks up off the deck.',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 27h44v5H6z"/><path d="M8 27V15h40v12"/><circle cx="28" cy="20" r="5"/><path d="M2 19h18M36 19h18" stroke-width="3" stroke-linecap="round"/></svg>'],
  ['bladeTop', 'Hidden blades · top', 'The same blades, pushed from small tabs on top instead of from the sides. Smooth sides, slightly thicker deck.',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 27h44v5H6z"/><path d="M8 27V15h40v12"/><circle cx="28" cy="20" r="5"/><path d="M10 19h12M34 19h12" stroke-width="3" stroke-linecap="round"/><path d="M14 15v-3M42 15v-3" stroke-width="2.5"/></svg>'],
  ['spine', 'Spine bolt', 'One bolt at the cord end, pushed in over the back of the bow. Only one thing to move.',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 27h44v5H6z"/><path d="M8 27V15h40v12"/><circle cx="30" cy="20" r="5"/><path d="M4 20h20" stroke-width="3" stroke-linecap="round"/><path d="M6 15h10v-4H6z"/></svg>'],
  ['twin', 'Twin bolts', 'Two bolts in covered channels, one from each side. The most obvious of the sliding latches, and the most grip.',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 27h44v5H6z"/><path d="M8 27V15h40v12"/><circle cx="28" cy="20" r="5"/><path d="M4 12h12v4H4zM40 12h12v4H40z"/><path d="M14 18h8M42 18h-8" stroke-width="3" stroke-linecap="round"/></svg>'],
  ['lash', 'Cord lashing', 'Two slots hard against the pocket, joined by a groove across the deck. Your own cord sits in the groove, below the top of the frame, so pulling it tight clamps the harp down. Nothing printed can break.',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 27h44v5H6z"/><path d="M8 27V15h40v12"/><circle cx="28" cy="20" r="5"/><rect x="11" y="16" width="3.5" height="9" rx="1.75"/><rect x="41.5" y="16" width="3.5" height="9" rx="1.75"/><path d="M12.7 16c1-5 30.6-5 30.6 0" stroke-dasharray="3 2.5"/></svg>'],
  ['slide', 'Sliding cover', 'A plate that slides in from the open end and clicks shut over the bow. Prints flat beside the case.',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 27h44v5H6z"/><path d="M8 27V15h40v12"/><circle cx="34" cy="20" r="5" opacity=".45"/><rect x="18" y="12" width="32" height="7" rx="1.5"/><path d="M14 15.5H4M4 15.5l3.5-3.5M4 15.5l3.5 3.5" stroke-linecap="round"/></svg>'],
  ['swing', 'Turn-buttons', 'Two bars on captive pegs, a quarter turn each. The stoutest of the moving parts: a thick peg rather than a thin blade.',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 27h44v5H6z"/><path d="M8 27V15h40v12"/><circle cx="28" cy="20" r="5"/><circle cx="12" cy="19" r="2.4"/><circle cx="44" cy="19" r="2.4"/><path d="M12 19h11M44 19H33" stroke-width="3.5" stroke-linecap="round"/><path d="M15 13.5a5 5 0 0 0-4-2" stroke-width="1.2"/></svg>'],
];
let style = 'deck', preset = 'bowM', shape = 'round', hold = 'bladeSide';
let deco = 'none', cut = 'relief', proc = 'fdm', dseed = 1, finish = 'charcoal';
const DECOS = [
  ['none', 'Plain', 'Just the shell. Prints fastest.',
    '<svg viewBox="0 0 44 30" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="6" width="36" height="18" rx="5"/></svg>'],
  ['damascus', 'Damascus steel', 'Folded layers and raindrops, like forged steel.',
    '<svg viewBox="0 0 44 30" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 8c6-3 9 3 15 0s9-3 15 0 6 1 6 1M4 14c6-3 9 3 15 0s9-3 15 0 6 1 6 1M4 20c5-2 7 1 10 0M30 20c3 1 6 0 10-1M4 26c6-3 9 3 15 0s9-3 15 0"/><circle cx="22" cy="20" r="3.2"/><circle cx="22" cy="20" r="0.8"/></svg>'],
  ['scroll', 'Scrollwork', 'A vine of curling tendrils and leaves.',
    '<svg viewBox="0 0 44 30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 20c7 0 9-10 17-10s10 10 21 10"/><path d="M13 13c-1-5 5-7 7-4s-1 5-3 4"/><path d="M29 17c1 5 6 6 8 3s-1-5-3-4"/><path d="M21 10l3-5" /><path d="M24 5c2 0 3 1 3 3-2 0-3-1-3-3z" fill="currentColor"/></svg>'],
  ['flowers', 'Flowering vine', 'Blossoms on curving stalks.',
    '<svg viewBox="0 0 44 30" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 23c8 0 11-6 19-6s10 5 19 5"/><path d="M14 20l-1-8M30 18l2-7"/><g fill="currentColor" stroke="none"><circle cx="13" cy="8" r="2.4"/><circle cx="16.4" cy="10.4" r="2.4"/><circle cx="15" cy="14" r="2.4"/><circle cx="11" cy="14" r="2.4"/><circle cx="9.6" cy="10.4" r="2.4"/><circle cx="32" cy="7" r="2"/><circle cx="35" cy="9" r="2"/><circle cx="34" cy="12" r="2"/><circle cx="30.4" cy="12" r="2"/><circle cx="29.2" cy="9" r="2"/></g></svg>'],
  ['seigaiha', 'Japanese waves', 'Seigaiha wave arcs with drifting sakura.',
    '<svg viewBox="0 0 44 30" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 16a8 8 0 0 1 16 0M5 16a5 5 0 0 1 10 0M8 16a2 2 0 0 1 4 0M18 16a8 8 0 0 1 16 0M21 16a5 5 0 0 1 10 0M24 16a2 2 0 0 1 4 0M34 16a8 8 0 0 1 16 0M37 16a5 5 0 0 1 10 0M10 26a8 8 0 0 1 16 0M13 26a5 5 0 0 1 10 0M16 26a2 2 0 0 1 4 0M26 26a8 8 0 0 1 16 0M29 26a5 5 0 0 1 10 0M-6 26a8 8 0 0 1 16 0"/></svg>'],
];
const CUTS = [['relief', 'Raised'], ['engrave', 'Engraved'], ['pierce', 'Pierced']];
const PROCS = [['fdm', 'Filament', 'FDM, 0.4 mm nozzle'], ['resin', 'Resin', 'finer detail']];
const FINISHES = [['charcoal', 'Charcoal', 0x1c1917], ['ivory', 'Ivory', 0xe6dccb], ['jade', 'Jade', 0x3e7a66], ['oxblood', 'Oxblood', 0x6e2027], ['indigo', 'Indigo', 0x2f3d66], ['bronze', 'Bronze', 0x9a7442]];

// a top-view silhouette of a preset, drawn from the same primitives the engine cuts the pocket from
function silhouette(p) {
  const hp = parametricHarp(p), W = 120, H = 30, k = Math.min((W - 6) / hp.hL, (H - 4) / hp.hW);
  const pt = q => `${(W / 2 + q.z * k).toFixed(1)},${(H / 2 + q.x * k).toFixed(1)}`;
  const poly = (pr, fill) => `<polygon points="${pr.poly.map(pt).join(' ')}" fill="${fill}"/>`;
  const trig = hp.trigger.z;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${hp.framePrims.map(pr => poly(pr, 'currentColor')).join('')}${hp.holePrims.map(pr => poly(pr, 'var(--surface)')).join('')}${poly(hp.reedPrim, 'var(--accent)')}<rect x="${(W / 2 + trig * k).toFixed(1)}" y="${(H / 2 - (hp.reedW / 2 + 1) * k).toFixed(1)}" width="${(2.5 * k).toFixed(1)}" height="${((hp.reedW + 2) * k).toFixed(1)}" fill="var(--accent)"/></svg>`;
}

// ---------------- controls ----------------
const presetsEl = $('presets');
Object.entries(PRESETS).forEach(([k, p]) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'preset'; b.dataset.k = k;
  b.innerHTML = `<span class="n">${p.name}</span>${silhouette(p)}<span class="d">${p.kind}</span><span class="m"></span>`;
  b.addEventListener('click', () => { applyPreset(k); state.trace = null; setTraced(false); rebuildUI(); });
  presetsEl.appendChild(b);
});
const DIMS = ['len', 'wid', 'span', 'arm', 'trig', 'tail', 'thick'];
function applyPreset(k) { const p = PRESETS[k]; if (!p) return; preset = k; shape = p.shape; DIMS.forEach(id => { setv(id, p[id] ?? (id === 'thick' ? 4 : 0)); }); }
function syncPresets() { [...presetsEl.children].forEach(b => b.setAttribute('aria-pressed', String(!state.trace && b.dataset.k === preset))); }

const stylesEl = $('styles');
STYLES.forEach(([k, n, d, p, svg]) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'style'; b.dataset.k = k;
  b.innerHTML = `${svg}<span><span class="n">${n}</span><br><span class="d">${d}</span></span>`;
  b.addEventListener('click', () => { style = k; rebuildUI(); });
  stylesEl.appendChild(b);
});
function syncStyles() { [...stylesEl.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === style))); [...holdsEl.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === hold))); }
const holdsEl = $('holds');
HOLDS.forEach(([k, n, d, svg]) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'style'; b.dataset.k = k;
  b.innerHTML = `${svg}<span><span class="n">${n}</span><br><span class="d">${d}</span></span>`;
  b.addEventListener('click', () => { hold = k; rebuildUI(); });
  holdsEl.appendChild(b);
});
document.querySelectorAll('#units button').forEach(b => b.addEventListener('click', () => { if (b.dataset.u !== units) { setUnits(b.dataset.u); rebuild(); } }));
setUnits(units, true);
const decosEl = $('decos');
DECOS.forEach(([k, n, d, svg]) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'style'; b.dataset.k = k;
  b.innerHTML = `${svg}<span><span class="n">${n}</span><br><span class="d">${d}</span></span>`;
  b.addEventListener('click', () => { deco = k; rebuildUI(); });
  decosEl.appendChild(b);
});
const segs = (el, list, get, set) => { list.forEach(([k, n, sub]) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.k = k; b.innerHTML = n + (sub ? `<span class="sub">${sub}</span>` : ''); b.addEventListener('click', () => { set(k); rebuildUI(); }); el.appendChild(b); }); };
segs($('cuts'), CUTS, () => cut, k => { cut = k; });
segs($('procs'), PROCS, () => proc, k => {
  // resin fills narrow gaps, so the moving parts get the widest gap; back on filament, the usual one
  if (k === 'resin' && getv('pgap') < 0.55) setv('pgap', 0.6);
  if (k === 'fdm' && proc === 'resin' && getv('pgap') >= 0.6 - 1e-6) setv('pgap', 0.4);
  proc = k;
});
$('reroll').addEventListener('click', () => { dseed = (dseed % 9973) + 1; rebuildUI(); });
const finishEl = $('finish');
FINISHES.forEach(([k, n, hex]) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.k = k; b.title = n; b.setAttribute('aria-label', n); b.style.background = '#' + hex.toString(16).padStart(6, '0'); b.addEventListener('click', () => { finish = k; applyFinish(); writeHash(); }); finishEl.appendChild(b); });
const finishName = document.createElement('span'); finishName.className = 'name'; finishEl.appendChild(finishName);
function applyFinish() { const f = FINISHES.find(x => x[0] === finish) || FINISHES[0]; mats.body.color.setHex(f[2]); [...finishEl.querySelectorAll('button')].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === f[0]))); finishName.textContent = f[1]; }
function syncDeco() {
  [...decosEl.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === deco)));
  [...$('cuts').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === cut)));
  [...$('procs').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === proc)));
  document.querySelectorAll('.only-deco').forEach(el => el.hidden = deco === 'none');
  $('deco-hint').textContent = deco === 'none' ? '' : 'Same pattern, a new drawing.';
}

const ids = ['len', 'wid', 'span', 'trig', 'thick', 'arm', 'tail', 'hood', 'wall', 'clr', 'pgap', 'bays', 'open'];
const fmt = { ...Object.fromEntries(LEN_IDS.map(id => [id, v => fmtLen(id, v)])), hood: v => v + ' %', bays: v => v + '', open: v => v + '°' };

function setTraced(on) {
  document.querySelectorAll('.param').forEach(el => el.hidden = on);
  $('traced').classList.toggle('on', on);
}

// ---------------- build ----------------
// With an ornament on, a rebuild takes a moment: say so, and give the browser a frame to show it first.
let busyT = 0;
function rebuildUI() {
  if (deco === 'none') { rebuild(); return; }
  const boot = $('boot'); boot.className = ''; boot.textContent = 'Drawing the pattern…'; boot.hidden = false;
  clearTimeout(busyT); busyT = setTimeout(() => { try { rebuild(); } finally { boot.hidden = true; } }, 40);
}
const setStatus = (msg, err) => { const s = $('status'); s.textContent = msg; s.classList.toggle('err', !!err); };
let first = true, current = null, lastDims = null, lastReport = null, lastOpen = 0, lastStyle = '';
function params() {
  const P = { style, shape, hold, deco, cut, proc, dseed, harp: $('harp').checked, bail: $('bail').checked, roof: $('roof').checked, mono: '', accentHex: '#d8b064' };
  ids.forEach(id => { P[id] = getv(id); }); P.units = units;
  P.gap = P.pgap;
  return P;
}
function rebuild(draft) {
  stopDemo(); // put the latches back before the model is rebuilt from them
  const P = params(); if (draft) P.deco = 'none'; // while a slider is moving, skip the ornament; it is drawn once the slider stops
  ids.forEach(id => { const o = $('o-' + id); if (o) o.textContent = fmt[id](P[id]); });
  document.querySelectorAll('.only-multi').forEach(el => el.hidden = style !== 'multi');
  document.querySelectorAll('.only-clam').forEach(el => el.hidden = style !== 'clam');
  document.querySelectorAll('.only-roof').forEach(el => el.hidden = !(style === 'deck' || style === 'pendant' || style === 'multi'));
  document.querySelectorAll('.only-hold').forEach(el => el.hidden = !(style === 'deck' || style === 'pendant'));
  if (style !== lastStyle) { state.locks.fill(true); lastStyle = style; }
  if (style === 'clam') { if (P.open > 5) state.locks[0] = false; else if (lastOpen > 5) state.locks[0] = true; }
  lastOpen = style === 'clam' ? P.open : 0;
  syncPresets(); syncStyles(); syncDeco();
  let g, dims, report;
  try { ({ g, dims, report } = build(P)); }
  catch (e) { console.error(e); setStatus('That combination could not be built (' + (e.message || e) + '). The previous case is still shown — try a different setting.', true); return false; }
  current = g; lastDims = dims; lastReport = report; window.__scene = g; window.__report = report; window.__engine = { toSTL, toOBJ, build, THREE, state }; window.__stage = stage;
  stage.setObject(g, !first);
  first = false;
  const dv = v => units === 'mm' ? v.toFixed(0) : (v / IN).toFixed(2);
  $('dims').innerHTML = `<b>${dv(dims.L)} × ${dv(dims.W)} × ${dv(dims.D)} ${units === 'mm' ? 'mm' : 'in'}</b><br>outside`;
  [...presetsEl.children].forEach(b => { const p = PRESETS[b.dataset.k]; b.querySelector('.m').textContent = `${fmtLen('len', p.len)} × ${fmtLen('wid', p.wid)}`; });
  const sName = STYLES.find(s => s[0] === style)[1];
  const harpName = state.trace ? 'your traced harp' : PRESETS[preset] && !customised() ? PRESETS[preset].name : `a ${fmtLen('len', P.len)} harp${P.tail > 0 ? ' with a ' + fmtLen('tail', P.tail) + ' tail' : ''}`;
  const holdName = { bladeSide: 'two hidden blades (side thumbs)', bladeTop: 'two hidden blades (top sliders)', spine: 'a spine bolt at the cord end', twin: 'twin bolts across the bow', lash: 'a cord of your own through the lash slots', slide: 'a cover that slides over the bow', swing: 'two turn-buttons' }[hold];
  const held = { deck: holdName + (P.roof ? ' and the hood roof' : ', with open walls round the reed tip'), sleeve: 'a turn-button gate at the mouth', clam: 'a hinged lid with a sliding bolt', pendant: holdName + ' over a windowed floor', multi: 'shared turn-buttons' }[style];
  const dName = deco === 'none' ? '' : `, ${{ relief: 'raised', engrave: 'engraved', pierce: 'pierced' }[cut]} ${{ damascus: 'Damascus', scroll: 'scrollwork', flowers: 'flowering vine', seigaiha: 'seigaiha waves' }[deco]}`;
  $('summary').innerHTML = `<em>${sName}</em> for ${harpName}${style === 'multi' ? ` × ${P.bays}` : ''}, held by ${held}${P.bail ? ', with a bail' : ''}${dName}.`;
  document.querySelectorAll('.only-buttons').forEach(el => el.hidden = state.buttons.length === 0); // cord lashing has nothing to latch
  renderFit(report); renderOrderNote(P); stopDemo();
  writeHash(); syncBox();
  return true;
}
// ---------------- fit check ----------------
function renderFit(report) {
  const list = $('fitlist'), sum = $('fit-sum'); if (!list || !report) return;
  list.innerHTML = '';
  const icons = { ok: '✓', bad: '✕', warn: '!', info: 'i' };
  let bad = 0;
  report.checks.forEach(c => {
    const li = document.createElement('li'); li.className = c.level; if (c.level === 'bad') bad++;
    li.innerHTML = `<span class="ic">${icons[c.level]}</span><span>${c.text}</span>`;
    if (c.fix && !c.ok) {
      const b = document.createElement('button'); b.type = 'button';
      b.textContent = c.fix.hood !== undefined ? `Set hood to ${c.fix.hood} %` : c.fix.swap ? 'Swap ends' : c.fix.proc ? 'Switch to resin' : c.fix.pgap ? `Gap to ${L(c.fix.pgap)}` : 'Fix';
      b.addEventListener('click', () => {
        if (c.fix.hood !== undefined) { $('hood').value = c.fix.hood; rebuild(); }
        else if (c.fix.proc) { proc = c.fix.proc; if (proc === 'resin' && getv('pgap') < 0.55) setv('pgap', 0.6); rebuild(); }
        else if (c.fix.pgap) { setv('pgap', c.fix.pgap); rebuild(); }
        else if (c.fix.swap && state.trace) { state.trace = { outline: state.trace.outline.map(p => ({ x: p.x, z: -p.z })), trigger: { x: 0, z: -state.trace.trigger.z } }; rebuild(); }
      });
      li.appendChild(b);
    } else li.appendChild(document.createElement('span'));
    list.appendChild(li);
  });
  sum.textContent = bad ? `${bad} problem${bad > 1 ? 's' : ''}` : 'everything fits';
  sum.className = 'mono ' + (bad ? 'bad' : 'good');
  $('demo').hidden = !(report.removal);
}

// ---------------- "how it comes out": animate the harp along the simulated removal path ----------------
let demo = null;
function stopDemo() {
  if (!demo) return;
  const d = demo; demo = null; cancelAnimationFrame(d.raf);
  if (d.finish) d.finish(); // stopped part-way: harp back in the pocket, lid and latches as they were
}
function startDemo() {
  const rep = lastReport, h = state.harpGroup; if (!rep || !rep.removal || !h) return;
  if (!$('harp').checked) { $('harp').checked = true; rebuild(); return startDemo(); }
  stopDemo();
  const rm = rep.removal, saved = state.locks.slice();
  state.locks.fill(false); syncBox(); // latches back / gate open / bolt drawn
  const base = h.position.clone(), lid = state.lidGroup, lidRot = lid ? lid.rotation.z : 0;
  const K = 0.001; // the scene is in metres, the report in millimetres
  const pivot = rm.pivot ? new THREE.Vector3(0, rm.pivot.y * K, rm.pivot.z * K) : null;
  // pick the rotation sign that lifts the bow (the −z side)
  let sign = 1; if (pivot) { const t = new THREE.Vector3(0, pivot.y, pivot.z - 20).sub(pivot).applyAxisAngle(new THREE.Vector3(1, 0, 0), rm.theta); if (t.y < 0) sign = -1; }
  const T0 = performance.now(), LEAD = 800, DUR = 3600, HOLD = 900; // LEAD: let the hardware get out of the way first
  const pose = t => { // t in [0,3]
    h.position.copy(base); h.rotation.set(0, 0, 0); h.matrixAutoUpdate = true;
    if (rm.liftOnly) { if (lid) lid.rotation.z = lidRot - Math.min(1, t / 1.5) * Math.PI * 0.55; h.position.y = base.y + Math.max(0, t - 1.5) / 1.5 * 30 * K; return; }
    if (rm.slideZ !== undefined) { h.position.z = base.z + Math.min(1, t / 3) * rm.slideZ * K; return; }
    const phi = Math.min(1, t) * rm.theta, shift = Math.max(0, Math.min(1, t - 1)) * rm.slide * K, lift = Math.max(0, Math.min(1, t - 2)) * rm.lift * K;
    // rotate about the pivot (tips on the floor), then slide back, then lift: compose as T(lift, −shift) · T(p) · Rx(φ) · T(−p)
    const m = new THREE.Matrix4().makeTranslation(0, lift, -shift).multiply(new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)).multiply(new THREE.Matrix4().makeRotationX(sign * phi)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    h.matrixAutoUpdate = false; h.matrix.copy(new THREE.Matrix4().makeTranslation(base.x, base.y, base.z).multiply(m)); h.matrixWorldNeedsUpdate = true;
  };
  const step = () => {
    const e = performance.now() - T0 - LEAD; let t;
    if (e < 0) t = 0;
    else if (e < DUR) t = (e / DUR) * 3; else if (e < DUR + HOLD) t = 3; else if (e < 2 * DUR + HOLD) t = 3 - ((e - DUR - HOLD) / DUR) * 3; else { const f = demo.finish; demo = null; f(); return; }
    pose(t); demo.raf = requestAnimationFrame(step);
  };
  const finish = () => { pose(0); h.matrixAutoUpdate = true; h.updateMatrix(); if (lid) lid.rotation.z = lidRot; state.locks.splice(0, state.locks.length, ...saved); syncBox(); };
  demo = { raf: requestAnimationFrame(step), finish };
  stage.controls.autoRotate = false;
}
$('demo').addEventListener('click', () => { if (demo) { stopDemo(); rebuild(); } else startDemo(); });
function customised() { const p = PRESETS[preset]; return !p || DIMS.some(id => Math.abs(getv(id) - (p[id] ?? (id === 'thick' ? 4 : 0))) > (units === 'in' && NATIVE[id] === 'mm' ? 0.21 : 1e-4)); } // in inches the frame slider moves in 64ths
let queued = false;
let fullTimer = 0;
const rebuildSoon = () => { if (queued) return; queued = true; setTimeout(() => {
  queued = false; const heavy = deco !== 'none'; rebuild(heavy);
  if (heavy) { clearTimeout(fullTimer); fullTimer = setTimeout(rebuildUI, 350); }
}, 0); };
ids.concat('harp', 'bail', 'roof').forEach(id => $(id).addEventListener('input', rebuildSoon));
DIMS.forEach(id => $(id).addEventListener('input', () => { if (customised()) preset = ''; }));
// See inside: most of the hardware lives inside the case (that is the point of hidden blades), so fade the shell
// rather than move anything. The materials are shared, so one change covers every body part in the scene.
const xray = $('xray');
function applyXray() {
  const on = xray.checked;
  [mats.body, mats.felt].forEach(m => { m.transparent = on; m.opacity = on ? 0.16 : 1; m.depthWrite = !on; m.needsUpdate = true; });
}
xray.addEventListener('input', applyXray);
$('reset').addEventListener('click', () => { stage.frame(); stage.controls.autoRotate = !reduced; });

// ---------------- URL state (hash, so the link survives any host) ----------------
function designCode() {
  const P = params(), q = new URLSearchParams();
  q.set('style', style); if (preset && !state.trace) q.set('preset', preset); q.set('shape', shape); q.set('hold', hold);
  ['len', 'wid', 'span', 'arm', 'trig', 'thick', 'tail', 'hood', 'wall', 'clr', 'pgap'].forEach(id => q.set(id, String(+getv(id).toFixed(4))));
  if (style === 'multi') q.set('bays', $('bays').value);
  if (style === 'clam') q.set('open', $('open').value);
  if (!P.bail) q.set('bail', '0');
  if (!P.roof) q.set('roof', '0');
  if (deco !== 'none') { q.set('deco', deco); q.set('cut', cut); q.set('ds', String(dseed)); }
  if (proc !== 'fdm') q.set('proc', proc);
  if (finish !== 'charcoal') q.set('fin', finish);
  if (state.trace) q.set('tr', state.trace.trigger.z.toFixed(1) + ';' + state.trace.outline.map(p => p.x.toFixed(1) + ',' + p.z.toFixed(1)).join(';'));
  return q.toString();
}
let ownHash = '';
function writeHash() {
  ownHash = '#' + designCode();
  try { history.replaceState(null, '', ownHash); } catch (e) { /* some hosts forbid it; the design code still carries the state */ }
}
// a shared link pasted into a tab that already has the page open changes only the hash: load it
window.addEventListener('hashchange', () => { if (location.hash !== ownHash && readState(location.hash)) rebuild(); });
const SHAPE_KEYS = ['round', 'stamped', 'egg'];
function readState(str) {
  const Q = new URLSearchParams(str.replace(/^#/, '').trim());
  if (!(Q.has('style') || Q.has('len') || Q.has('preset'))) return false;
  if (Q.get('style') && STYLES.some(s => s[0] === Q.get('style'))) style = Q.get('style');
  applyPreset(Q.get('preset') || (preset || 'bowM'));
  ['len', 'wid', 'span', 'arm', 'trig', 'thick', 'tail', 'hood', 'wall', 'clr', 'pgap', 'bays', 'open'].forEach(id => { if (Q.get(id) !== null && !isNaN(+Q.get(id))) setv(id, +Q.get(id)); });
  if (Q.get('shape') && SHAPE_KEYS.includes(Q.get('shape'))) shape = Q.get('shape');
  if (Q.get('hold') && HOLDS.some(h => h[0] === Q.get('hold'))) hold = Q.get('hold');
  if (customised()) preset = '';
  $('bail').checked = Q.get('bail') !== '0';
  $('roof').checked = Q.get('roof') !== '0';
  deco = DECOS.some(d => d[0] === Q.get('deco')) ? Q.get('deco') : 'none';
  cut = CUTS.some(d => d[0] === Q.get('cut')) ? Q.get('cut') : 'relief';
  proc = PROCS.some(d => d[0] === Q.get('proc')) ? Q.get('proc') : 'fdm';
  dseed = Math.max(1, Math.min(9973, parseInt(Q.get('ds') || '1', 10) || 1));
  finish = FINISHES.some(d => d[0] === Q.get('fin')) ? Q.get('fin') : 'charcoal'; applyFinish();
  const tr = Q.get('tr'); let traced = false;
  if (tr) { try { const [tz, ...pts] = tr.split(';'); const outline = pts.map(s => { const [x, z] = s.split(',').map(Number); return { x, z }; }); if (outline.length >= 8 && outline.every(p => isFinite(p.x) && isFinite(p.z))) { state.trace = { outline, trigger: { x: 0, z: +tz } }; traced = true; } } catch (e) { /* ignore a malformed code */ } }
  if (!traced) state.trace = null;
  setTraced(traced);
  return true;
}
function readHash() { if (location.hash.length > 1) readState(location.hash); else applyPreset('bowM'); }

// ---------------- turn-buttons and lid in the viewer ----------------
const lockBox = $('lock');
const syncBox = () => { const { buttons, locks } = state; const all = buttons.every((_, k) => locks[k]), none = buttons.every((_, k) => !locks[k]); lockBox.indeterminate = !all && !none; lockBox.checked = all; };
lockBox.addEventListener('input', () => { state.buttons.forEach((_, k) => { state.locks[k] = lockBox.checked; }); syncBox(); });
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const pick = e => { const r = stage.el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, stage.camera); return ray.intersectObjects(state.buttons.concat(state.lidGroup ? [state.lidGroup] : []), true)[0]; };
let down = null;
stage.el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
stage.el.addEventListener('pointerup', e => {
  const ok = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4; down = null; if (!ok) return;
  const hit = pick(e); if (!hit) return;
  let o = hit.object; while (o && o.userData.button === undefined && o !== state.lidGroup) o = o.parent;
  if (o === state.lidGroup) { $('open').value = +$('open').value > 10 ? 0 : 75; rebuild(); return; }
  if (o) { state.locks[o.userData.button] = !state.locks[o.userData.button]; syncBox(); }
});
stage.el.addEventListener('pointermove', e => { if (!down) stage.el.style.cursor = pick(e) ? 'pointer' : ''; });
(function animate() {
  state.buttons.forEach((m, k) => { const t = state.locks[k] ? m.userData.base : m.userData.open; if (m.userData.slide) m.position.z += (t - m.position.z) * (reduced ? 1 : 0.18); else m.rotation.y += (t - m.rotation.y) * (reduced ? 1 : 0.18); });
  requestAnimationFrame(animate);
})();

// ---------------- photo tracer ----------------
// a new outline that can't be built puts the previous design back, rather than leaving every later build failing
const photoMsg = (msg, bad) => { const el = $('photo-status'); el.textContent = msg || ''; el.classList.toggle('err', !!bad); el.hidden = !msg; };
function traceWith(src) {
  const prev = state.trace, prevStyle = style; photoMsg('');
  openTracer(src, () => {
    if (style === 'multi') style = 'deck';
    setTraced(true);
    if (rebuild()) return;
    state.trace = prev; style = prevStyle; setTraced(!!prev); rebuild();
    photoMsg('That outline could not be turned into a case. Retrace it, check the two ends and the length, or trace it by hand.', true);
  }, msg => photoMsg(msg, true));
}
$('upload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) traceWith(URL.createObjectURL(f)); e.target.value = ''; });
$('sample').addEventListener('click', () => { const P = params(); $('t-dist').value = units === 'mm' ? +(P.len * IN).toFixed(1) : P.len; traceWith(sampleHarpImage(P)); });
$('retrace').addEventListener('click', () => traceWith(lastImage() || sampleHarpImage(params())));
$('untrace').addEventListener('click', () => { state.trace = null; setTraced(false); if (!preset) applyPreset('bowM'); rebuild(); });

// ---------------- files ----------------
const holdName2 = () => HOLDS.find(h => h[0] === hold)[1];
function settingsCard() {
  const P = params(), sName = STYLES.find(s => s[0] === style)[1];
  return [
    'JAW HARP CASE GENERATOR', '',
    `Style        ${sName}${(style === 'deck' || style === 'pendant') ? ' · held by ' + holdName2() : ''}`,
    `Harp         ${state.trace ? 'traced from a photo' : (PRESETS[preset] && !customised() ? PRESETS[preset].name : 'custom, ' + shape + ' bow')} · ${fmtLen('len', P.len)} × ${fmtLen('wid', P.wid)}, arm span ${fmtLen('span', P.span)}, bar ${fmtLen('arm', P.arm)}, height to trigger ${fmtLen('trig', P.trig)}, frame ${fmtLen('thick', P.thick)} thick${P.tail > 0 ? `, reed tail ${fmtLen('tail', P.tail)}` : ''}`,
    `Case         ${L(lastDims.L)} × ${L(lastDims.W)} × ${L(lastDims.D)} outside`,
    `Hood         ${P.hood} %   Wall ${fmtLen('wall', P.wall)}   Clearance ${fmtLen('clr', P.clr)}   Print gap ${fmtLen('pgap', P.pgap)}`,
    `Bail         ${P.bail ? 'yes' : 'no'}${style === 'multi' ? `   Harps ${P.bays}` : ''}`,
    `Decoration   ${deco === 'none' ? 'none' : DECOS.find(d => d[0] === deco)[1] + ', ' + CUTS.find(c => c[0] === cut)[1].toLowerCase() + ' (drawing ' + dseed + ')'}`,
    `Printed in   ${proc === 'resin' ? 'resin (SLA / MSLA): a tough or ABS-like resin, not standard, which is brittle' : 'filament (FDM)'}`, '',
    style === 'clam'
      ? `${fileTag()}-base.stl / ${fileTag()}-lid.stl   z-up, millimetres, each already on the bed. Print both flat, no supports: the base carries the hinge knuckles on a shelf and the bolt keeper on the end tab; the lid is a plate with the hood on top and the bolt printed in place in its channel. Slide the bolt back with its thumb-nub to free it, push a 40 mm length of 1.75 mm filament through the hinge knuckles as the pin and trim it flush.`
      : `${fileTag()}.stl   all printed parts, z-up, millimetres. Slice flat, no supports, 0.4 mm nozzle, 0.2 mm layers (the print gap is then two layers of air).`,
    'case.obj     the same parts named (case.mtl), y-up, millimetres.',
    style === 'clam' ? `The bolt prints in place in its channel with ${fmtLen('pgap', P.pgap)} of air all round; slide it back once after printing to break it free.`
      : style === 'sleeve' || style === 'multi' ? `The turn-buttons print in place on captive pegs with ${fmtLen('pgap', P.pgap)} of air all round. A firm quarter-turn frees each one after printing.`
      : hold === 'lash' ? 'No moving parts: thread your own cord or shock cord up through one slot, over the frame bar, down the other, and tie it under the case.'
      : hold === 'slide' ? `The cover is the separate flat plate beside the case on the bed. Slide it in from the open end until it clicks over the bump. Everything has ${fmtLen('pgap', P.pgap)} of air around it.`
      : `Moving parts print in place with ${fmtLen('pgap', P.pgap)} of air all round. Slide latches print retracted: push each one home after printing and it clicks into a detent at both ends of its travel. Print the first one in PLA (PETG welds across small gaps).`,
    'Felt lining and the harp are preview only and are not in these files.', '',
    'Design code (paste it under "Load a design code" to reopen this exact case): ' + designCode(),
  ].join('\n');
}
const fileTag = () => `jaw-harp-case-${style}-${state.trace ? 'traced' : (preset || shape)}`;
// the print files: STL(s) for the slicer, and — on request — everything as one zip
function buildFiles() {
  const saved = state.locks.slice(); state.locks.fill(true); // print pose: every button locked (detent engaged), lid closed, no harp
  // build() re-registers the clickable parts, the lid and the harp in the shared state; the print model is never shown,
  // so the on-screen ones are put back afterwards or the latches in the viewer would stop responding
  const keep = { buttons: state.buttons.slice(), lidGroup: state.lidGroup, harpGroup: state.harpGroup };
  let g;
  try { g = build({ ...params(), harp: false, open: 0, printPose: true }).g; } // slide latches retracted, buttons locked, lid closed
  finally {
    state.locks.splice(0, state.locks.length, ...saved);
    state.buttons.splice(0, state.buttons.length, ...keep.buttons); state.lidGroup = keep.lidGroup; state.harpGroup = keep.harpGroup;
  }
  const tag = fileTag();
  const stls = style === 'clam'
    ? [[`${tag}-base.stl`, toSTL(g, 'base')], [`${tag}-lid.stl`, toSTL(g, 'lid')]]
    : [[`${tag}.stl`, toSTL(g)]];
  return { g, tag, stls };
}
function makeZip(f) {
  const { obj, mtl } = toOBJ(f.g), files = {};
  f.stls.forEach(([n, buf]) => { files[n] = new Uint8Array(buf.slice(0)); });
  return zipSync({ ...files, 'case.obj': strToU8(obj), 'case.mtl': strToU8(mtl), 'README.txt': strToU8(settingsCard()) }, { level: 6 });
}
let downloads = null, downloadsResolved = false;
(async () => { try { downloads = window.claude?.use ? await window.claude.use('downloads') : null; } catch (e) { downloads = null; } downloadsResolved = true; })();
// hand one file to the viewer: through the host's save dialog when the page runs inside claude.ai, otherwise as a plain browser download
async function saveFile(name, data, mime) {
  if (downloads) { await downloads.save({ filename: name, data }); return 'saved'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); return 'download';
}
const dlError = e => setStatus(e && e.code === 'declined' ? 'Download cancelled.' : 'Could not save the file here' + (e && e.message ? ': ' + e.message : '.'), !(e && e.code === 'declined'));
$('dl').addEventListener('click', async () => {
  const btn = $('dl'); btn.disabled = true; setStatus('Building the print files…');
  try {
    const f = buildFiles();
    try {
      // the STL itself, no wrapper — what the slicer wants and what browsers and virus scanners are least fussy about
      for (const [n, buf] of f.stls) await saveFile(n, buf.slice(0), 'model/stl');
      setStatus(f.stls.length > 1 ? 'Saved both halves. Slice each flat on the bed, no supports.' : 'Saved. Slice it flat on the bed, no supports.');
    } catch (e) {
      if (e && e.code === 'rejected_extension') {
        // this host only hands out a fixed set of file types, and .stl is not one of them: the zip carries it instead
        try { await saveFile(f.tag + '.zip', makeZip(f), 'application/zip'); setStatus('This host can only save the files as a zip — your STL is inside it, along with the OBJ and a README.'); }
        catch (e2) { dlError(e2); }
      } else dlError(e);
    }
  } catch (e) { setStatus('Something went wrong building the files: ' + (e.message || e), true); }
  btn.disabled = false;
});
// ---------------- have it printed for you ----------------
// No backend and no money changing hands here: the STL goes to the viewer's own device and a printing
// marketplace opens beside it, so the order is theirs to place with whichever shop they pick.
function renderOrderNote(P) {
  const note = $('ordernote'); if (!note) return;
  const moving = !((style === 'deck' || style === 'pendant') && hold === 'lash');
  if (proc === 'resin') {
    note.innerHTML = `<b>What to choose there:</b> resin (SLA, DLP or MSLA), and a tough or ABS-like resin if they offer one — standard resin is brittle and a case gets dropped. Ask them not to hollow it.${moving ? ` The moving parts have ${fmtLen('pgap', P.pgap)} of air around them; free each latch after washing, before the final cure.` : ''}`;
    return;
  }
  note.innerHTML = moving
    ? `<b>What to choose there:</b> FDM (some sites call it FFF) in PLA or PETG, 0.2 mm layers, no supports. The latches and the lid print already assembled, with ${fmtLen('pgap', P.pgap)} of air around them — resin welds that air shut and nylon powder packs it solid. For SLS or MJF, widen the gap to 0.6 mm first${P.pgap < 0.55 ? ' <button id="gap6" class="btn ghost" type="button">set it to 0.6</button>' : ' (set)'} and expect to work the latches loose by hand.`
    : `<b>What to choose there:</b> whatever is cheapest — this one has no moving parts, only slots for your own cord, so any process prints it. FDM in PLA or PETG at 0.2 mm layers is the usual answer; nylon (SLS or MJF) costs more and is close to unbreakable.`;
}
$('order').addEventListener('click', async () => {
  setStatus('Saving the STL — upload it on the tab that just opened.');
  try {
    const f = buildFiles();
    try {
      for (const [n, buf] of f.stls) await saveFile(n, buf.slice(0), 'model/stl');
      setStatus(f.stls.length > 1
        ? 'Saved both halves. Upload the two files together — they are one case, quoted as two parts.'
        : 'Saved. Upload it on the other tab, then pick FDM in PLA or PETG, 0.2 mm layers, no supports.');
    } catch (e) {
      if (e && e.code === 'rejected_extension') {
        try { await saveFile(f.tag + '.zip', makeZip(f), 'application/zip'); setStatus('This host saves the files as a zip — unzip it and upload the .stl from inside.'); }
        catch (e2) { dlError(e2); }
      } else dlError(e);
    }
  } catch (e) { setStatus('Something went wrong building the files: ' + (e.message || e), true); }
});
$('printfor').addEventListener('click', e => {
  if (e.target && e.target.id === 'gap6') {
    setv('pgap', 0.6); rebuild();
    setStatus(`Print gap widened to ${L(0.6)}, which is what nylon needs. Save the STL again before you upload it.`);
  }
});
$('dlzip').addEventListener('click', async () => {
  const btn = $('dlzip'); btn.disabled = true; setStatus('Building the print files…');
  try { const f = buildFiles(); await saveFile(f.tag + '.zip', makeZip(f), 'application/zip'); setStatus('Saved: STL, OBJ + MTL and a README with your settings.'); }
  catch (e) { dlError(e); }
  btn.disabled = false;
});
$('share').addEventListener('click', async () => {
  const code = designCode();
  try { await navigator.clipboard.writeText(code); setStatus('Design code copied. Paste it under "Load a design code" on any copy of this page to get the same case.'); }
  catch (e) { const box = $('code'); box.value = code; box.closest('details').open = true; box.focus(); box.select(); setStatus('Copy the design code from the box under “Load a design code” — it is selected, ready to copy.'); }
});
$('load').addEventListener('click', () => {
  const v = $('code').value.trim(); if (!v) return;
  try { const ok = readState(v.includes('#') ? v.slice(v.indexOf('#')) : v); if (!ok) { setStatus('That does not look like a design code.', true); return; } rebuild(); setStatus('Design loaded.'); }
  catch (e) { setStatus('Could not read that design code.', true); }
});

// ---------------- boot ----------------
readHash();
// let the page paint before the first (heaviest) build, so the controls appear at once
setTimeout(() => {
  rebuild(); syncBox();
  window.__ready = true; const boot = $('boot'); if (boot) boot.hidden = true;
}, 30);
