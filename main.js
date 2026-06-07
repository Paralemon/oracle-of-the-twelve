import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ---------------------------------------------------------------------------
// Regular dodecahedron (d12) data — one source of truth shared by the visual
// mesh and the physics collider so they line up exactly.
// ---------------------------------------------------------------------------
const PHI = (1 + Math.sqrt(5)) / 2;
const B = 1 / PHI;
const C = PHI;
const DIE_SCALE = 0.5; // half-size; raw cube vertices have length ~1.73

const RAW_VERTS = [
  [ 1,  1,  1], [ 1,  1, -1], [ 1, -1,  1], [ 1, -1, -1],
  [-1,  1,  1], [-1,  1, -1], [-1, -1,  1], [-1, -1, -1],
  [ 0,  B,  C], [ 0,  B, -C], [ 0, -B,  C], [ 0, -B, -C],
  [ B,  C,  0], [ B, -C,  0], [-B,  C,  0], [-B, -C,  0],
  [ C,  0,  B], [ C,  0, -B], [-C,  0,  B], [-C,  0, -B],
].map(v => v.map(x => x * DIE_SCALE));

// 12 pentagonal faces (vertex indices). Winding is auto-corrected below.
const RAW_FACES = [
  [ 0,  8, 10,  2, 16],
  [ 0, 16, 17,  1, 12],
  [ 0, 12, 14,  4,  8],
  [ 1, 17,  3, 11,  9],
  [ 1,  9,  5, 14, 12],
  [ 2, 10,  6, 15, 13],
  [ 2, 13,  3, 17, 16],
  [ 3, 13, 15,  7, 11],
  [ 4, 14,  5, 19, 18],
  [ 4, 18,  6, 10,  8],
  [ 5,  9, 11,  7, 19],
  [ 6, 18, 19,  7, 15],
];

// Each die carries its own set of 12 face symbols (Unicode astrology glyphs).
const PLANET_GLYPHS = ['☉','☽','☿','♀','♂','♃','♄','♅','♆','♇','☊','☋'];
const ZODIAC_GLYPHS = ['♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓'];
const NUMBER_GLYPHS = ['1','2','3','4','5','6','7','8','9','10','11','12'];

const DIE_CONFIGS = [
  // 1: white body, black planet/node glyphs
  { bodyColor: 0xffffff, emissive: 0x555555, symbolColor: '#000000', edgeColor: 0xb9a874, symbols: PLANET_GLYPHS },
  // 2: black body, white zodiac glyphs
  { bodyColor: 0x0c0c10, symbolColor: '#f4f1e8', edgeColor: 0xd9b15a, symbols: ZODIAC_GLYPHS },
  // 3: medium grey body, white numbers 1–12 (a touch smaller)
  { bodyColor: 0x7c7c86, symbolColor: '#f4f1e8', edgeColor: 0xd9b15a, symbols: NUMBER_GLYPHS, glyphScale: 0.92 },
];

const SYMBOL_FONT = '"Apple Symbols", "Segoe UI Symbol", "STIXGeneral", serif';

function vec3(a) { return new THREE.Vector3(a[0], a[1], a[2]); }

// Ensure each face winds counter-clockwise as seen from outside, so both
// THREE normals and CANNON collision normals point outward.
function orientFaces(verts, faces) {
  const center = new THREE.Vector3();
  verts.forEach(v => center.add(vec3(v)));
  center.multiplyScalar(1 / verts.length);
  return faces.map(face => {
    const a = vec3(verts[face[0]]);
    const b = vec3(verts[face[1]]);
    const c = vec3(verts[face[2]]);
    const normal = new THREE.Vector3().subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a));
    const faceCenter = vec3(verts[face[0]]);
    const outward = faceCenter.clone().sub(center);
    return normal.dot(outward) < 0 ? [...face].reverse() : face;
  });
}

const FACES = orientFaces(RAW_VERTS, RAW_FACES);

// Per-face outward normals (local space) used to read which face lands up.
const FACE_NORMALS = FACES.map(face => {
  const a = vec3(RAW_VERTS[face[0]]);
  const b = vec3(RAW_VERTS[face[1]]);
  const c = vec3(RAW_VERTS[face[2]]);
  return new THREE.Vector3().subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a)).normalize();
});

const FACE_CENTERS = FACES.map(face => {
  const center = new THREE.Vector3();
  face.forEach(i => center.add(vec3(RAW_VERTS[i])));
  return center.multiplyScalar(1 / face.length);
});

// A pentagon symmetry axis per face: face centre -> first corner. Glyphs are
// aligned to this so they point at a corner instead of sitting at random rolls.
const FACE_UP = FACES.map((face, fi) =>
  vec3(RAW_VERTS[face[0]]).sub(FACE_CENTERS[fi]).normalize()
);

// Orientation that lays a plane on face `fi`: +Z -> outward normal,
// +Y -> the corner axis (FACE_UP).
function faceLabelQuaternion(fi) {
  const z = FACE_NORMALS[fi].clone();
  const y = FACE_UP[fi].clone();
  y.sub(z.clone().multiplyScalar(z.dot(y))).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(x, y, z)
  );
}

// --- Visual geometry: triangulate each pentagon as a fan -------------------
function buildDieMesh(config) {
  const positions = [];
  const normals = [];
  FACES.forEach((face, fi) => {
    const n = FACE_NORMALS[fi];
    for (let i = 1; i < face.length - 1; i++) {
      const tri = [face[0], face[i], face[i + 1]];
      tri.forEach(vi => {
        positions.push(...RAW_VERTS[vi]);
        normals.push(n.x, n.y, n.z);
      });
    }
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

  const material = new THREE.MeshStandardMaterial({
    color: config.bodyColor, metalness: 0.15, roughness: 0.55,
    emissive: config.emissive || 0x000000,
    flatShading: true,
  });

  const die = new THREE.Group();
  const body = new THREE.Mesh(geom, material);
  die.add(body);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geom, 1),
    new THREE.LineBasicMaterial({ color: config.edgeColor })
  );
  die.add(edges);

  // Symbol on each face (canvas texture on a small plane).
  FACES.forEach((face, fi) => {
    const label = makeSymbolPlane(config.symbols[fi], config.symbolColor, 0.82, config.glyphScale || 1);
    const center = FACE_CENTERS[fi];
    const normal = FACE_NORMALS[fi];
    label.position.copy(center.clone().add(normal.clone().multiplyScalar(0.005)));
    label.quaternion.copy(faceLabelQuaternion(fi));
    die.add(label);
  });

  return die;
}

const labelTextureCache = {};
const GLYPH_TARGET = 140; // normalized glyph extent (px) within the 256 canvas
function makeSymbolPlane(symbol, color, planeSize, glyphScale = 1) {
  const key = color + ':' + symbol + ':' + glyphScale;
  if (!labelTextureCache[key]) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Measure the glyph's true bounds, then scale every symbol to the same
    // on-canvas size so all three dice render at a matching visual size.
    let fontSize = 200;
    ctx.font = 'bold ' + fontSize + 'px ' + SYMBOL_FONT;
    let m = ctx.measureText(symbol);
    let gw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    let gh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    if (gw > 0 && gh > 0) fontSize *= (GLYPH_TARGET * glyphScale) / Math.max(gw, gh);
    ctx.font = 'bold ' + fontSize + 'px ' + SYMBOL_FONT;

    m = ctx.measureText(symbol);
    const x = 128 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const y = 128 - (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
    ctx.fillText(symbol, x, y);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    labelTextureCache[key] = tex;
  }
  const mat = new THREE.MeshBasicMaterial({
    map: labelTextureCache[key], transparent: true, depthWrite: false,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), mat);
}

// --- Physics collider ------------------------------------------------------
function buildDieShape() {
  const verts = RAW_VERTS.map(v => new CANNON.Vec3(v[0], v[1], v[2]));
  return new CANNON.ConvexPolyhedron({ vertices: verts, faces: FACES });
}

// ===========================================================================
// Scene setup
// ===========================================================================
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b14);
scene.fog = new THREE.FogExp2(0x0b0b14, 0.06);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
camera.position.set(0, 7.5, 5.5);
camera.lookAt(0, 0, 0);

// Lighting — warm key + cool fill for a mystical feel.
const key = new THREE.DirectionalLight(0xfff0d0, 1.4);
key.position.set(4, 9, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -6; key.shadow.camera.right = 6;
key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
scene.add(key);
scene.add(new THREE.AmbientLight(0x3a3a5a, 0.8));
const rim = new THREE.PointLight(0x8866ff, 0.6, 30);
rim.position.set(-5, 4, -4);
scene.add(rim);

// Casting surface.
const TRAY = 3.2;
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x14121f, roughness: 0.9, metalness: 0.1, transparent: true,
});
const floor = new THREE.Mesh(new THREE.CircleGeometry(TRAY + 1.2, 64), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const ring = new THREE.Mesh(
  new THREE.TorusGeometry(TRAY + 0.05, 0.06, 12, 80),
  new THREE.MeshStandardMaterial({ color: 0xd9b15a, metalness: 0.7, roughness: 0.3, transparent: true })
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.02;
scene.add(ring);

// Camera-mounted fill light so the presented faces read clearly.
scene.add(camera);
const headlight = new THREE.PointLight(0xffffff, 0.55, 60);
camera.add(headlight);

// ===========================================================================
// Physics world
// ===========================================================================
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -30, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;

const diceMat = new CANNON.Material('dice');
const groundMat = new CANNON.Material('ground');
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, groundMat, {
  friction: 0.35, restitution: 0.35,
}));
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, {
  friction: 0.2, restitution: 0.4,
}));

// Floor + invisible walls keep the dice contained.
const floorBody = new CANNON.Body({ mass: 0, material: groundMat });
floorBody.addShape(new CANNON.Plane());
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floorBody);

const WALL_H = 6;
const wallShape = new CANNON.Box(new CANNON.Vec3(TRAY, WALL_H, 0.1));
[[0, -TRAY, 0], [0, TRAY, Math.PI], [-TRAY, 0, Math.PI / 2], [TRAY, 0, -Math.PI / 2]]
  .forEach(([x, z, ry]) => {
    const w = new CANNON.Body({ mass: 0, material: groundMat });
    w.addShape(wallShape);
    w.position.set(x, WALL_H, z);
    w.quaternion.setFromEuler(0, ry, 0);
    world.addBody(w);
  });

// Ceiling so violent shakes don't fling dice out the top.
const ceil = new CANNON.Body({ mass: 0, material: groundMat });
ceil.addShape(new CANNON.Plane());
ceil.quaternion.setFromEuler(Math.PI / 2, 0, 0);
ceil.position.y = WALL_H * 2;
world.addBody(ceil);

// --- Build the three dice --------------------------------------------------
const dieShape = buildDieShape();
const dice = [];
const START = [[-1.4, 2.5, 0], [0, 3.2, -0.6], [1.4, 2.6, 0.5]];
for (let i = 0; i < 3; i++) {
  const config = DIE_CONFIGS[i];
  const mesh = buildDieMesh(config);
  mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 1, material: diceMat });
  body.addShape(dieShape);
  body.position.set(...START[i]);
  body.linearDamping = 0.1;
  body.angularDamping = 0.1;
  body.sleepSpeedLimit = 0.15;
  body.sleepTimeLimit = 0.4;
  world.addBody(body);

  dice.push({ mesh, body, symbols: config.symbols });
}

function randomizeDie(d, i) {
  d.body.wakeUp();
  d.body.position.set(
    START[i][0] + (rng() - 0.5),
    3 + rng() * 1.5,
    START[i][2] + (rng() - 0.5)
  );
  d.body.velocity.setZero();
  d.body.angularVelocity.set(rand(8), rand(8), rand(8));
  d.body.quaternion.setFromEuler(rand(6), rand(6), rand(6));
}

// Real randomness: draw from the Web Crypto entropy pool (OS-level hardware
// entropy), not Math.random()'s deterministic PRNG. Every value that shapes
// the tumble — positions, spins, impulses — flows through this, so the face
// that lands is decided by genuine chance.
function rng() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296; // 2^32 -> a float in [0, 1)
}
function rand(s) { return (rng() - 0.5) * s; }

// ===========================================================================
// Roll state machine: idle -> stirring -> settling -> read
// ===========================================================================
// idle -> stirring -> settling -> pause -> presenting -> presented
let phase = 'idle';
let stirTimer = 0;
let pauseTimer = 0;
let presentTime = 0;
const PAUSE_DUR = 0.6;     // beat after the dice settle
const PRESENT_DUR = 1.3;   // glide into alignment
const stateEl = document.getElementById('state');
const resultEl = document.getElementById('result');

function setState(text) { stateEl.textContent = text; }

function startStir() {
  if (phase === 'stirring') return;
  phase = 'stirring';
  stirTimer = 0;
  resultEl.classList.remove('show');
  interpretBtn.classList.add('hidden');
  hideReading();
  setArenaOpacity(1);
  dice.forEach((d, i) => randomizeDie(d, i));
  setState('the dice are stirring…');
}

function stir() {
  // Toss the dice around while shaking.
  dice.forEach(d => {
    d.body.wakeUp();
    d.body.applyImpulse(
      new CANNON.Vec3(rand(6), 4 + rng() * 6, rand(6)),
      new CANNON.Vec3(rand(0.3), rand(0.3), rand(0.3))
    );
    d.body.angularVelocity.set(rand(14), rand(14), rand(14));
  });
}

function settle() {
  if (phase !== 'stirring') return;
  phase = 'settling';
  setState('casting…');
}

function allAsleep() {
  return dice.every(d =>
    d.body.velocity.lengthSquared() < 0.04 &&
    d.body.angularVelocity.lengthSquared() < 0.04
  );
}

function readResult() {
  const up = new THREE.Vector3(0, 1, 0);
  dice.forEach(d => {
    const q = new THREE.Quaternion(
      d.body.quaternion.x, d.body.quaternion.y,
      d.body.quaternion.z, d.body.quaternion.w
    );
    let best = -Infinity, bestFace = 0;
    FACE_NORMALS.forEach((n, fi) => {
      const dot = n.clone().applyQuaternion(q).dot(up);
      if (dot > best) { best = dot; bestFace = fi; }
    });
    d.resultFace = bestFace;
  });
  setState('the dice have settled…');
  phase = 'pause';
  pauseTimer = 0;
}

const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Orientation that turns a die so its result face points at the camera,
// glyph upright.
function presentQuaternion(localNormal, localUp, diePos) {
  const aL = localNormal.clone().normalize();
  const bL = localUp.clone();
  bL.sub(aL.clone().multiplyScalar(aL.dot(bL))).normalize();
  const cL = new THREE.Vector3().crossVectors(aL, bL).normalize();
  const Lmat = new THREE.Matrix4().makeBasis(aL, bL, cL);

  const aW = camera.position.clone().sub(diePos).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, aW);
  if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
  right.normalize();
  const bW = new THREE.Vector3().crossVectors(aW, right).normalize();
  const cW = new THREE.Vector3().crossVectors(aW, bW).normalize();
  const Wmat = new THREE.Matrix4().makeBasis(aW, bW, cW);

  const M = Wmat.multiply(Lmat.transpose());
  return new THREE.Quaternion().setFromRotationMatrix(M);
}

// Lay the dice out in a vertical column in front of the camera:
// white (top), black (middle), grey (bottom).
function beginPresent() {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  const D = 9.0, TOP = 2.55, GAP = 2.0;
  const center = camera.position.clone().add(fwd.multiplyScalar(D));
  const offsets = [TOP, TOP - GAP, TOP - 2 * GAP];
  dice.forEach((d, i) => {
    d.targetPos = center.clone().add(up.clone().multiplyScalar(offsets[i]));
    d.targetQuat = presentQuaternion(FACE_NORMALS[d.resultFace], FACE_UP[d.resultFace], d.targetPos);
    d.startPos = d.mesh.position.clone();
    d.startQuat = d.mesh.quaternion.clone();
  });
  presentTime = 0;
  phase = 'presenting';
  setState('the oracle has spoken');
}

function onPresented() {
  // The three drawn faces: planet (die 0), sign (die 1), house number (die 2).
  lastDraw = {
    planet: dice[0].resultFace,
    sign: dice[1].resultFace,
    house: Number(dice[2].symbols[dice[2].resultFace]),
    glyphs: dice.map(d => d.symbols[d.resultFace]).join('  '),
  };
  interpretBtn.classList.remove('hidden');
}

function setArenaOpacity(o) {
  floorMat.opacity = o;
  ring.material.opacity = o;
  rim.intensity = 0.6 * o;
  const vis = o > 0.01;
  floor.visible = vis;
  ring.visible = vis;
}

// ===========================================================================
// Shake detection via DeviceMotion
// ===========================================================================
let stillTimer = 0;
let motionEnabled = false;

function handleMotion(e) {
  const a = e.acceleration && e.acceleration.x !== null
    ? e.acceleration
    : e.accelerationIncludingGravity;
  if (!a) return;
  // Subtract ~gravity baseline when only includingGravity is available.
  const useRaw = !!(e.acceleration && e.acceleration.x !== null);
  const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0) - (useRaw ? 0 : 9.81);
  const shake = Math.abs(mag);

  if (shake > 12) {
    stillTimer = 0;
    startStir();
  } else if (shake < 3) {
    if (phase === 'stirring') {
      stillTimer += 1;
      if (stillTimer > 12) { settle(); } // ~0.2s of stillness at 60Hz
    }
  }
}

async function enableMotion() {
  const note = document.getElementById('motionNote');
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const res = await DeviceMotionEvent.requestPermission();
      if (res === 'granted') {
        window.addEventListener('devicemotion', handleMotion);
        motionEnabled = true;
      } else {
        note.textContent = 'Motion denied — use the Cast button instead.';
      }
    } catch {
      note.textContent = 'Motion unavailable — use the Cast button.';
    }
  } else if (typeof DeviceMotionEvent !== 'undefined') {
    window.addEventListener('devicemotion', handleMotion);
    motionEnabled = true;
  } else {
    note.textContent = 'No motion sensor here — use the Cast button.';
  }
}

// Manual cast (desktop / fallback): stir for a beat, then let them settle.
function manualCast() {
  startStir();
  let t = 0;
  const iv = setInterval(() => {
    t++;
    if (t > 5) { clearInterval(iv); settle(); }
  }, 90);
}

// ===========================================================================
// Loop
// ===========================================================================
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 30);

  if (phase === 'stirring') {
    stirTimer += dt;
    stir();
    // Manual-mode safety: if no live motion, stop stirring after a while.
    if (!motionEnabled && stirTimer > 2.5) settle();
  }

  world.step(1 / 60, dt, 3);

  // While physics owns the dice, mirror the bodies onto the meshes.
  if (phase === 'idle' || phase === 'stirring' || phase === 'settling' || phase === 'pause') {
    dice.forEach(d => {
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
    });
  }

  if (phase === 'settling' && allAsleep()) readResult();

  if (phase === 'pause') {
    pauseTimer += dt;
    if (pauseTimer > PAUSE_DUR) beginPresent();
  }

  if (phase === 'presenting') {
    presentTime += dt;
    const t = Math.min(presentTime / PRESENT_DUR, 1);
    const e = easeInOutCubic(t);
    dice.forEach(d => {
      d.mesh.position.lerpVectors(d.startPos, d.targetPos, e);
      d.mesh.quaternion.copy(d.startQuat).slerp(d.targetQuat, e);
    });
    setArenaOpacity(1 - e);
    if (t >= 1) { phase = 'presented'; onPresented(); }
  }

  renderer.render(scene, camera);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
animate();

// ===========================================================================
// UI wiring
// ===========================================================================
document.getElementById('enterBtn').addEventListener('click', async () => {
  await enableMotion();
  document.getElementById('overlay').classList.add('hidden');
});
document.getElementById('rollBtn').addEventListener('click', manualCast);
window.addEventListener('keydown', e => { if (e.key === 'r' || e.key === 'R') manualCast(); });

// ===========================================================================
// Interpretation — ask the AI oracle to read the cast
// ===========================================================================
// Where the reading comes from. Defaults to a same-origin /interpret (the
// bundled server.py). Override without redeploying by opening the app with
// ?oracle=https://your-backend/interpret once — it's remembered thereafter.
const ORACLE_PARAM = new URLSearchParams(location.search).get('oracle');
if (ORACLE_PARAM !== null) {
  if (ORACLE_PARAM) localStorage.setItem('oracleApi', ORACLE_PARAM);
  else localStorage.removeItem('oracleApi');
}
// The hosted backend (Vercel) that holds the API key. Same-origin when the app
// itself is served from Vercel; used cross-origin (CORS) from other hosts like
// GitHub Pages so every link gets readings.
const PUBLIC_BACKEND = 'https://oracle-of-the-twelve.vercel.app/interpret';
const HAS_OWN_BACKEND = !/\.github\.io$/.test(location.hostname);
const ORACLE_API = window.ORACLE_API
  || localStorage.getItem('oracleApi')
  || (HAS_OWN_BACKEND ? '/interpret' : PUBLIC_BACKEND);

let lastDraw = null;
const interpretBtn = document.getElementById('interpretBtn');
const readingEl = document.getElementById('reading');
const readingDraw = document.getElementById('readingDraw');
const readingBody = document.getElementById('readingBody');

function showReading(text, dim) {
  readingDraw.textContent = lastDraw ? lastDraw.glyphs : '';
  readingBody.textContent = text;
  readingBody.classList.toggle('dim', !!dim);
  readingEl.classList.add('show');
  document.body.classList.add('reading-open');
}

function hideReading() {
  readingEl.classList.remove('show');
  document.body.classList.remove('reading-open');
}

interpretBtn.addEventListener('click', async () => {
  if (!lastDraw) return;
  if (!ORACLE_API) {
    showReading(
      'The cast is yours to keep — but spoken readings need the oracle ' +
      'connected. This public preview runs without one. (The full version ' +
      'reads your cast aloud through the stars.)', true);
    return;
  }
  interpretBtn.disabled = true;
  showReading('The oracle gazes into the cast…', true);
  try {
    const res = await fetch(ORACLE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planet: lastDraw.planet, sign: lastDraw.sign, house: lastDraw.house,
      }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON (e.g. 404 page) */ }
    if (res.ok && data && data.reading) showReading(data.reading, false);
    else if (data && data.error) showReading(data.error, true);
    else showReading('The oracle is silent just now. Try again shortly.', true);
  } catch (err) {
    showReading('The oracle could not be reached: ' + err.message, true);
  } finally {
    interpretBtn.disabled = false;
  }
});

document.getElementById('readingClose').addEventListener('click', hideReading);
