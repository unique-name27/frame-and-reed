import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { zipSync, strToU8 } from 'fflate';
import { IN, PRESETS, mats, state, build, sampleHarpImage, toSTL, toOBJ, parametricHarp } from './engine.js';
import { openTracer, lastImage } from './tracer.js';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(0.6, 1.2, 0.8); this.scene.add(key);
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
  ['swing', 'Turn-buttons', 'Two bars on captive pegs, a quarter turn each. The stoutest of the moving parts: a 4 mm peg instead of a 1.6 mm blade.',
    '<svg viewBox="0 0 56 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 27h44v5H6z"/><path d="M8 27V15h40v12"/><circle cx="28" cy="20" r="5"/><circle cx="12" cy="19" r="2.4"/><circle cx="44" cy="19" r="2.4"/><path d="M12 19h11M44 19H33" stroke-width="3.5" stroke-linecap="round"/><path d="M15 13.5a5 5 0 0 0-4-2" stroke-width="1.2"/></svg>'],
];
let style = 'deck', preset = 'bowM', shape = 'round', hold = 'bladeSide';

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
  b.innerHTML = `<span class="n">${p.name}</span>${silhouette(p)}<span class="d">${p.kind}</span><span class="m">${p.len.toFixed(1)} × ${p.wid.toFixed(2)} in</span>`;
  b.addEventListener('click', () => { applyPreset(k); state.trace = null; setTraced(false); rebuild(); });
  presetsEl.appendChild(b);
});
const DIMS = ['len', 'wid', 'span', 'arm', 'trig', 'tail', 'thick'];
function applyPreset(k) { const p = PRESETS[k]; if (!p) return; preset = k; shape = p.shape; DIMS.forEach(id => { $(id).value = p[id] ?? (id === 'thick' ? 4 : 0); }); }
function syncPresets() { [...presetsEl.children].forEach(b => b.setAttribute('aria-pressed', String(!state.trace && b.dataset.k === preset))); }

const stylesEl = $('styles');
STYLES.forEach(([k, n, d, p, svg]) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'style'; b.dataset.k = k;
  b.innerHTML = `${svg}<span><span class="n">${n}</span><br><span class="d">${d}</span></span>`;
  b.addEventListener('click', () => { style = k; rebuild(); });
  stylesEl.appendChild(b);
});
function syncStyles() { [...stylesEl.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === style))); [...holdsEl.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === hold))); }
const holdsEl = $('holds');
HOLDS.forEach(([k, n, d, svg]) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'style'; b.dataset.k = k;
  b.innerHTML = `${svg}<span><span class="n">${n}</span><br><span class="d">${d}</span></span>`;
  b.addEventListener('click', () => { hold = k; rebuild(); });
  holdsEl.appendChild(b);
});

const ids = ['len', 'wid', 'span', 'trig', 'thick', 'arm', 'tail', 'hood', 'wall', 'clr', 'pgap', 'bays', 'open'];
const fmt = { len: v => v.toFixed(2) + ' in', wid: v => v.toFixed(2) + ' in', span: v => v.toFixed(2) + ' in', trig: v => v.toFixed(2) + ' in', tail: v => v > 0 ? v.toFixed(2) + ' in' : 'none', arm: v => v + ' mm', thick: v => v + ' mm', hood: v => v + ' %', wall: v => v + ' mm', clr: v => v + ' mm', pgap: v => v.toFixed(2) + ' mm', bays: v => v + '', open: v => v + '°' };

function setTraced(on) {
  document.querySelectorAll('.param').forEach(el => el.hidden = on);
  $('traced').classList.toggle('on', on);
}

// ---------------- build ----------------
const setStatus = (msg, err) => { const s = $('status'); s.textContent = msg; s.classList.toggle('err', !!err); };
let first = true, current = null, lastDims = null, lastReport = null, lastOpen = 0, lastStyle = '';
function params() {
  const P = { style, shape, hold, harp: $('harp').checked, bail: $('bail').checked, mono: '', accentHex: '#d8b064' };
  ids.forEach(id => { P[id] = +$(id).value; });
  P.gap = P.pgap;
  return P;
}
function rebuild() {
  const P = params();
  ids.forEach(id => { const o = $('o-' + id); if (o) o.textContent = fmt[id](P[id]); });
  document.querySelectorAll('.only-multi').forEach(el => el.hidden = style !== 'multi');
  document.querySelectorAll('.only-clam').forEach(el => el.hidden = style !== 'clam');
  document.querySelectorAll('.only-hold').forEach(el => el.hidden = !(style === 'deck' || style === 'pendant'));
  if (style !== lastStyle) { state.locks.fill(true); lastStyle = style; }
  if (style === 'clam') { if (P.open > 5) state.locks[0] = false; else if (lastOpen > 5) state.locks[0] = true; }
  lastOpen = style === 'clam' ? P.open : 0;
  syncPresets(); syncStyles();
  let g, dims, report;
  try { ({ g, dims, report } = build(P)); }
  catch (e) { console.error(e); setStatus('That combination could not be built (' + (e.message || e) + '). The previous case is still shown — try a different setting.', true); return; }
  current = g; lastDims = dims; lastReport = report; window.__scene = g; window.__report = report; window.__engine = { toSTL, toOBJ, build, THREE, state }; window.__stage = stage;
  stage.setObject(g, !first);
  first = false;
  const mm = v => v.toFixed(0), inch = v => (v / IN).toFixed(2);
  $('dims').innerHTML = `<b>${mm(dims.L)} × ${mm(dims.W)} × ${mm(dims.D)} mm</b><br>${inch(dims.L)} × ${inch(dims.W)} × ${inch(dims.D)} in, outside`;
  const sName = STYLES.find(s => s[0] === style)[1];
  const harpName = state.trace ? 'your traced harp' : PRESETS[preset] && !customised() ? PRESETS[preset].name : `a ${P.len.toFixed(1)} in harp${P.tail > 0 ? ' with a ' + P.tail.toFixed(2) + ' in tail' : ''}`;
  const holdName = { bladeSide: 'two hidden blades (side thumbs)', bladeTop: 'two hidden blades (top sliders)', spine: 'a spine bolt at the cord end', twin: 'twin bolts across the bow', lash: 'a cord of your own through the lash slots', slide: 'a cover that slides over the bow', swing: 'two turn-buttons' }[hold];
  const held = { deck: holdName + ' and the hood roof', sleeve: 'a turn-button gate at the mouth', clam: 'a hinged lid with a sliding bolt', pendant: holdName + ' over a windowed floor', multi: 'shared turn-buttons' }[style];
  $('summary').innerHTML = `<em>${sName}</em> for ${harpName}${style === 'multi' ? ` × ${P.bays}` : ''}, held by ${held}${P.bail ? ', with a bail' : ''}.`;
  document.querySelectorAll('.only-buttons').forEach(el => el.hidden = state.buttons.length === 0); // cord lashing has nothing to latch
  renderFit(report); stopDemo();
  writeHash(); syncBox();
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
      b.textContent = c.fix.hood !== undefined ? `Set hood to ${c.fix.hood} %` : c.fix.swap ? 'Swap ends' : 'Fix';
      b.addEventListener('click', () => {
        if (c.fix.hood !== undefined) { $('hood').value = c.fix.hood; rebuild(); }
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
function stopDemo() { if (demo) { cancelAnimationFrame(demo.raf); demo = null; } }
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
  const T0 = performance.now(), DUR = 3600, HOLD = 900;
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
    const e = performance.now() - T0; let t;
    if (e < DUR) t = (e / DUR) * 3; else if (e < DUR + HOLD) t = 3; else if (e < 2 * DUR + HOLD) t = 3 - ((e - DUR - HOLD) / DUR) * 3; else { pose(0); h.matrixAutoUpdate = true; h.updateMatrix(); if (lid) lid.rotation.z = lidRot; state.locks.splice(0, state.locks.length, ...saved); syncBox(); demo = null; return; }
    pose(t); demo.raf = requestAnimationFrame(step);
  };
  demo = { raf: requestAnimationFrame(step) };
  stage.controls.autoRotate = false;
}
$('demo').addEventListener('click', () => { if (demo) { stopDemo(); rebuild(); } else startDemo(); });
function customised() { const p = PRESETS[preset]; return !p || DIMS.some(id => Math.abs(+$(id).value - (p[id] ?? (id === 'thick' ? 4 : 0))) > 1e-6); }
let queued = false;
const rebuildSoon = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; rebuild(); }, 0); };
ids.concat('harp', 'bail').forEach(id => $(id).addEventListener('input', rebuildSoon));
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
  ['len', 'wid', 'span', 'arm', 'trig', 'thick', 'tail', 'hood', 'wall', 'clr', 'pgap'].forEach(id => q.set(id, $(id).value));
  if (style === 'multi') q.set('bays', $('bays').value);
  if (style === 'clam') q.set('open', $('open').value);
  if (!P.bail) q.set('bail', '0');
  if (state.trace) q.set('tr', state.trace.trigger.z.toFixed(1) + ';' + state.trace.outline.map(p => p.x.toFixed(1) + ',' + p.z.toFixed(1)).join(';'));
  return q.toString();
}
function writeHash() {
  try { history.replaceState(null, '', '#' + designCode()); } catch (e) { /* some hosts forbid it; the design code still carries the state */ }
}
const SHAPE_KEYS = ['round', 'stamped', 'egg'];
function readState(str) {
  const Q = new URLSearchParams(str.replace(/^#/, '').trim());
  if (!(Q.has('style') || Q.has('len') || Q.has('preset'))) return false;
  if (Q.get('style') && STYLES.some(s => s[0] === Q.get('style'))) style = Q.get('style');
  applyPreset(Q.get('preset') || (preset || 'bowM'));
  ['len', 'wid', 'span', 'arm', 'trig', 'thick', 'tail', 'hood', 'wall', 'clr', 'pgap', 'bays', 'open'].forEach(id => { if (Q.get(id) !== null && !isNaN(+Q.get(id))) $(id).value = Q.get(id); });
  if (Q.get('shape') && SHAPE_KEYS.includes(Q.get('shape'))) shape = Q.get('shape');
  if (Q.get('hold') && HOLDS.some(h => h[0] === Q.get('hold'))) hold = Q.get('hold');
  if (customised()) preset = '';
  $('bail').checked = Q.get('bail') !== '0';
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
function traceDone() { if (style === 'multi') style = 'deck'; setTraced(true); rebuild(); }
$('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) openTracer(URL.createObjectURL(f), traceDone); e.target.value = ''; });
$('sample').addEventListener('click', () => { const P = params(); $('t-dist').value = P.len; openTracer(sampleHarpImage(P), traceDone); });
$('retrace').addEventListener('click', () => openTracer(lastImage() || sampleHarpImage(params()), traceDone));
$('untrace').addEventListener('click', () => { state.trace = null; setTraced(false); if (!preset) applyPreset('bowM'); rebuild(); });

// ---------------- files ----------------
const holdName2 = () => HOLDS.find(h => h[0] === hold)[1];
function settingsCard() {
  const P = params(), sName = STYLES.find(s => s[0] === style)[1];
  return [
    'JAW HARP CASE GENERATOR', '',
    `Style        ${sName}${(style === 'deck' || style === 'pendant') ? ' · held by ' + holdName2() : ''}`,
    `Harp         ${state.trace ? 'traced from a photo' : (PRESETS[preset] && !customised() ? PRESETS[preset].name : 'custom, ' + shape + ' bow')} · ${P.len} × ${P.wid} in, arm span ${P.span} in, bar ${P.arm} mm, height to trigger ${P.trig} in, frame ${P.thick} mm thick${P.tail > 0 ? `, reed tail ${P.tail} in` : ''}`,
    `Case         ${lastDims.L.toFixed(1)} × ${lastDims.W.toFixed(1)} × ${lastDims.D.toFixed(1)} mm outside`,
    `Hood         ${P.hood} %   Wall ${P.wall} mm   Clearance ${P.clr} mm   Print gap ${P.pgap} mm`,
    `Bail         ${P.bail ? 'yes' : 'no'}${style === 'multi' ? `   Harps ${P.bays}` : ''}`, '',
    style === 'clam'
      ? 'case-base.stl / case-lid.stl   z-up, millimetres, each already on the bed. Print both flat, no supports: the base carries the hinge knuckles on a shelf and the bolt keeper on the end tab; the lid is a plate with the hood on top and the bolt printed in place in its channel. Slide the bolt back with its thumb-nub to free it, push a 40 mm length of 1.75 mm filament through the hinge knuckles as the pin and trim it flush.'
      : 'case.stl     all printed parts, z-up, millimetres. Slice flat, no supports, 0.4 mm nozzle, 0.2 mm layers (the print gap is then two layers of air).',
    'case.obj     the same parts named (case.mtl), y-up, millimetres.',
    hold === 'lash' ? 'No moving parts: thread your own cord or shock cord up through one slot, over the frame bar, down the other, and tie it under the case.'
      : hold === 'slide' ? `The cover is the separate flat plate beside the case on the bed. Slide it in from the open end until it clicks over the bump. Everything has ${P.pgap} mm of air around it.`
      : `Moving parts print in place with ${P.pgap} mm of air all round. Slide latches print retracted: push each one home after printing and it clicks into a detent at both ends of its travel. Print the first one in PLA (PETG welds across small gaps).`,
    'Felt lining and the harp are preview only and are not in these files.', '',
    'Design code (paste it under "Load a design code" to reopen this exact case): ' + designCode(),
  ].join('\n');
}
// the print files: STL(s) for the slicer, and — on request — everything as one zip
function buildFiles() {
  const saved = state.locks.slice(); state.locks.fill(true); // print pose: every button locked (detent engaged), lid closed, no harp
  const g = build({ ...params(), harp: false, open: 0, printPose: true }).g; // slide latches retracted, buttons locked, lid closed
  state.locks.splice(0, state.locks.length, ...saved);
  const tag = `jaw-harp-case-${style}-${state.trace ? 'traced' : (preset || shape)}`;
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
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: mime })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
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
$('dlzip').addEventListener('click', async () => {
  const btn = $('dlzip'); btn.disabled = true; setStatus('Building the print files…');
  try { const f = buildFiles(); await saveFile(f.tag + '.zip', makeZip(f), 'application/zip'); setStatus('Saved: STL, OBJ + MTL and a README with your settings.'); }
  catch (e) { dlError(e); }
  btn.disabled = false;
});
$('share').addEventListener('click', async () => {
  const code = designCode();
  try { await navigator.clipboard.writeText(code); setStatus('Design code copied. Paste it under "Load a design code" on any copy of this page to get the same case.'); }
  catch (e) { $('code').value = code; setStatus('Copy the design code from the box below — it holds this design.'); }
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
