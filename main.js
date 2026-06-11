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

// Inradius = distance from die center to a face center. When a die lies flat on
// a face, its center sits exactly this high above the floor. Used to place the
// dice resting on the tray at startup instead of dropping them from midair.
const INRADIUS = FACE_CENTERS[0].length();

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
// Gravity at ~3× Earth — heavier than real life so the dice fall snappily and
// feel like dense objects in a confined space, but not the leaden -62 that
// made them rocket and overshoot. Combined with the higher damping and tighter
// sleep threshold below, this is the right balance between "weighty" and
// "lively".
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
// Solver iterations — the default 10 causes the jitter you see when dice
// collide: under-resolved contact constraints overshoot, then correct, then
// overshoot again. 22 lands them quietly.
world.solver.iterations = 22;
// Slightly relaxed contact equations — sharper than default reduces the
// "bouncing in place" buzz before sleep.
world.defaultContactMaterial.contactEquationStiffness = 1e7;
world.defaultContactMaterial.contactEquationRelaxation = 4;

const diceMat = new CANNON.Material('dice');
const groundMat = new CANNON.Material('ground');
// Lower restitution = less bouncy = settles faster, no buzz. Higher friction =
// rolls less after a collision, sticks where it lands.
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, groundMat, {
  friction: 0.75, restitution: 0.05,
  contactEquationStiffness: 1e7, contactEquationRelaxation: 3,
}));
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, {
  // A touch more bounce between dice so they push apart instead of stacking.
  friction: 0.5, restitution: 0.22,
  contactEquationStiffness: 1e7, contactEquationRelaxation: 3,
}));

// Floor + invisible walls keep the dice contained.
const floorBody = new CANNON.Body({ mass: 0, material: groundMat });
floorBody.addShape(new CANNON.Plane());
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floorBody);

const WALL_H = 6;
// NOTE: the arena wall is a *circle* handled manually in containDice() (see
// the radial bounce there), not a set of box walls. Box walls form a square,
// whose corners reach radius ~TRAY*√2 — well outside the round ring — which is
// why dice used to escape past the ring and pile in a corner. A circular
// boundary that matches the visible ring fixes that and gives a real bounce.

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
  // Higher damping bleeds off the small residual velocities that cause the
  // post-collision buzz; angular damping especially keeps a landed die from
  // spinning in place. A bit more than before, but still lively while tumbling.
  body.linearDamping = 0.10;
  body.angularDamping = 0.14;
  // Sleep threshold raised so dice actually fall asleep instead of trembling
  // forever just above the old 0.15 limit. sleepTimeLimit shortened so they
  // commit to sleep quickly once slow.
  body.sleepSpeedLimit = 0.45;
  body.sleepTimeLimit = 0.25;
  world.addBody(body);

  // Haptics — a solid tap when a die hits a wall, the floor, or another die,
  // as if the real object struck the inside of the phone. Strength scales with
  // impact speed. (Web only exposes navigator.vibrate, which Android honors;
  // iOS Safari ignores it — there is no web haptic API on iOS.)
  body.addEventListener('collide', onDiceCollide);

  dice.push({ mesh, body, symbols: config.symbols, restPose: null });
}

// Constants used by layDieFlat — declared before the init call below so they
// aren't in the temporal dead zone when layDieFlat first runs.
const _downVec = new THREE.Vector3(0, -1, 0);
const REST_RADIUS = 1.35; // distance of each resting die from tray center

// Start with the dice lying at rest on the tray (not dropping from midair).
dice.forEach((d, i) => layDieFlat(d, i));

// --- Haptics ---------------------------------------------------------------
// Whether the user has opted into motion (vibration follows the same gesture
// permission on iOS-style flows; on Android it's just available). We only buzz
// after the experience has started so the page doesn't vibrate on load.
let hapticsArmed = false;
const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
let lastHapticAt = 0;
function onDiceCollide(e) {
  if (!hapticsArmed || !canVibrate) return;
  // Throttle so a burst of simultaneous contacts reads as one solid tap rather
  // than a continuous buzz.
  const now = performance.now();
  if (now - lastHapticAt < 45) return;
  let impact = 0;
  try { impact = Math.abs(e.contact.getImpactVelocityAlongNormal()); } catch { impact = 0; }
  if (impact < 1.2) return; // ignore feather-light touches and resting jostle
  lastHapticAt = now;
  // Map impact speed → a short, solid pulse. Clamp so even a hard slam stays a
  // crisp tap (~32ms) rather than a long rumble.
  const ms = Math.round(Math.min(32, 6 + impact * 2.2));
  navigator.vibrate(ms);
}

function randomizeDie(d, i) {
  d.body.wakeUp();
  // A modest toss height — enough to read as a fresh throw, but low enough that
  // the (now lighter) dice don't slam the ceiling. They tumble down and the
  // per-frame stir() impulses fling them around the tray.
  d.body.position.set(
    START[i][0] + (rng() - 0.5),
    1.6 + rng() * 0.8,
    START[i][2] + (rng() - 0.5)
  );
  d.body.velocity.setZero();
  d.body.angularVelocity.set(rand(9), rand(9), rand(9));
  d.body.quaternion.setFromEuler(rand(6), rand(6), rand(6));
}

// Lay a die flat on a random face, resting on the tray floor, dead still. Used
// at startup so the dice simply lie there until the user shakes or taps Cast —
// no more dropping-from-midair on page load.
function layDieFlat(d, i) {
  // Pick a random face to rest on; orient so that face's outward normal points
  // straight down, then add a random spin about the vertical axis for variety.
  const fi = Math.floor(rng() * FACE_NORMALS.length);
  const q = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[fi], _downVec);
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
  q.premultiply(yaw);
  d.body.quaternion.set(q.x, q.y, q.z, q.w);
  // Lay the three dice on the points of a triangle so they DON'T overlap. At
  // REST_RADIUS = 1.35 the pairwise gap is ~2.3, comfortably more than two die
  // silhouettes (~0.87 radius each). A small per-load angle jitter keeps the
  // arrangement from looking identical every time. INRADIUS + a hair keeps the
  // resting face just touching the floor without interpenetrating it.
  const angle = (i / 3) * Math.PI * 2 + Math.PI / 2 + (rng() - 0.5) * 0.5;
  d.body.position.set(
    Math.cos(angle) * REST_RADIUS,
    INRADIUS + 0.02,
    Math.sin(angle) * REST_RADIUS,
  );
  d.body.velocity.setZero();
  d.body.angularVelocity.setZero();
  d.body.sleep();
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

let stirSource = 'button'; // 'shake' (live motion) or 'button' (tap/desktop)

function startStir(source) {
  if (phase === 'stirring') { if (source) stirSource = source; return; }
  phase = 'stirring';
  stirSource = source || 'button';
  stirTimer = 0;
  stillSeconds = 0;
  resultEl.classList.remove('show');
  interpretBtn.classList.add('hidden');
  document.body.classList.remove('spoken'); // reset the state-line halo
  hideReading();
  setArenaOpacity(1);
  dice.forEach((d, i) => randomizeDie(d, i));
  setState(stirSource === 'shake' ? 'the dice are tumbling…' : 'the dice are stirring…');
}

// Toss the dice. `power` scales the energy so a harder shake tumbles them more.
// When the shake came from real device motion, `shakeVec` carries the *world*
// direction of the shake, so the dice fly the way the phone is moving — shake
// left/right and they slam the left/right walls. A random component keeps the
// tumble lively and stops all three from moving in lockstep.
function stir(power, shakeVec) {
  power = power == null ? 1 : power;
  // Directional push (0 when there's no live motion vector, e.g. button cast).
  const dirX = shakeVec ? shakeVec.x : 0;
  const dirZ = shakeVec ? shakeVec.z : 0;
  const hasDir = (dirX * dirX + dirZ * dirZ) > 1e-4;
  dice.forEach(d => {
    d.body.wakeUp();
    if (hasDir) {
      // Direction now dominates so the dice genuinely fly the way you shake —
      // possible because gravity no longer biases the direction (see the
      // high-pass filter in handleMotion) and the direction decays fast, so a
      // back-and-forth shake reverses the push each half-stroke instead of
      // piling everything against one wall. The bouncing circular wall and the
      // remaining scatter keep it lively.
      d.body.applyImpulse(
        new CANNON.Vec3(
          dirX * 2.8 * power + rand(1.5 * power),
          rand(1.1 * power),
          dirZ * 2.8 * power + rand(1.5 * power),
        ),
        new CANNON.Vec3(rand(0.25), rand(0.25), rand(0.25)),
      );
    } else {
      d.body.applyImpulse(
        new CANNON.Vec3(rand(2.6 * power), rand(1.2 * power), rand(2.6 * power)),
        new CANNON.Vec3(rand(0.25), rand(0.25), rand(0.25)),
      );
    }
    d.body.angularVelocity.set(rand(11 * power), rand(11 * power), rand(11 * power));
  });
}

// Keep dice on stage WITHOUT robbing them of weight: a circular wall that
// matches the visible ring and *bounces* them inward, plus gentle upward and
// ceiling caps. Downward fall is left free so gravity reads on the eye.
const DIE_CIRCUMRADIUS = DIE_SCALE * Math.sqrt(3); // farthest vertex from center
const RING_RADIUS = TRAY + 0.05;                   // matches the torus ring mesh
// Clamp die *centers* so the die body stays inside the ring. Using circumradius
// keeps even the corners from poking over the ring line.
const ARENA_R = RING_RADIUS - DIE_CIRCUMRADIUS;
const WALL_BOUNCE = 0.55;   // how much radial speed is kept on a wall hit
const MAX_HORIZONTAL = 7.0; // safety cap so a violent shake can't tunnel
const MAX_UPWARD = 3.5;
const TUMBLE_CEILING = 2.6;
function containDice() {
  dice.forEach(d => {
    const p = d.body.position;
    const v = d.body.velocity;

    // Safety speed cap (prevents tunneling through the radial wall in one step).
    const hs = Math.hypot(v.x, v.z);
    if (hs > MAX_HORIZONTAL) { const k = MAX_HORIZONTAL / hs; v.x *= k; v.z *= k; }

    // --- Circular wall with bounce -----------------------------------------
    // If the die center passes the arena radius, snap it back to the wall and
    // reflect the *outward* component of its velocity so it rebounds inward
    // instead of sticking. Tangential motion is preserved (it slides along).
    const r = Math.hypot(p.x, p.z);
    if (r > ARENA_R && r > 1e-4) {
      const nx = p.x / r, nz = p.z / r;       // outward unit normal
      p.x = nx * ARENA_R; p.z = nz * ARENA_R; // clamp to the wall
      const vn = v.x * nx + v.z * nz;         // outward velocity component
      if (vn > 0) {                            // moving outward → bounce inward
        const j = (1 + WALL_BOUNCE) * vn;
        v.x -= j * nx; v.z -= j * nz;
      }
      d.body.wakeUp(); // a wall hit should never leave it asleep mid-tumble
    }

    if (v.y > MAX_UPWARD) v.y = MAX_UPWARD;
    if (p.y > TUMBLE_CEILING && v.y > 0) v.y = 0;
    // Downward velocity is intentionally uncapped — heavy objects fall fast.
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
  document.body.classList.add('spoken'); // brightens the state-line halo
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
// Shake detection via DeviceMotion — the dice respond to how hard you shake.
// ===========================================================================
let motionEnabled = false;
let shakeEnergy = 0;     // peak-held shake intensity (m/s² above gravity)
let stillSeconds = 0;    // how long the phone has been ~still while tumbling
// World-space direction of the latest shake, normalized. The loop reads this so
// the dice fly the way the phone is being shaken. Decays toward zero each frame.
const shakeDir = { x: 0, z: 0 };
// Low-pass estimate of the gravity vector in the device frame. Subtracting it
// from accelerationIncludingGravity yields the *dynamic* (shake) component with
// gravity removed — without this, gravity dominated the direction vector and
// the dice always leaned the same way (the "upper-left" drift).
const gravEst = { x: 0, y: 0, z: 0 };
let gravInit = false;
const START_SHAKE = 6;   // begin tumbling at/above this dynamic intensity
const STILL_SHAKE = 3;   // below this counts as "held still"
const SETTLE_AFTER = 0.45; // seconds of stillness before the dice fall

function handleMotion(e) {
  const af = e.acceleration;               // gravity-free (may be null/zero)
  const ag = e.accelerationIncludingGravity;
  let dx, dy, dz;
  if (af && af.x != null && (Math.abs(af.x) + Math.abs(af.y) + Math.abs(af.z)) > 0.05) {
    // Device supplies a real gravity-free reading — already the dynamic signal.
    dx = af.x; dy = af.y; dz = af.z;
  } else if (ag) {
    // Only with-gravity available (common on Android). High-pass it: track the
    // slow gravity vector with a low-pass filter, then subtract to get the fast
    // shake component. This is what removes the constant directional bias.
    const ax = ag.x || 0, ay = ag.y || 0, az = ag.z || 0;
    if (!gravInit) { gravEst.x = ax; gravEst.y = ay; gravEst.z = az; gravInit = true; }
    const A = 0.9; // closer to 1 = slower gravity tracking, more shake passes
    gravEst.x = A * gravEst.x + (1 - A) * ax;
    gravEst.y = A * gravEst.y + (1 - A) * ay;
    gravEst.z = A * gravEst.z + (1 - A) * az;
    dx = ax - gravEst.x; dy = ay - gravEst.y; dz = az - gravEst.z;
  } else {
    return;
  }

  const mag = Math.hypot(dx, dy, dz);
  // Peak-hold: spikes register instantly; the loop decays this over time.
  if (mag > shakeEnergy) shakeEnergy = mag;
  // Map the phone's (gravity-free) acceleration frame onto the tray's world
  // frame. Device-x (left/right across the screen) drives world-x (left/right
  // across the tray); device-y (up/down the screen) drives world-z (toward/away
  // on the tray), negated so pushing the phone "up" sends the dice "away". Only
  // update on a real shake so resting sensor noise doesn't nudge the dice.
  if (mag > STILL_SHAKE) {
    const n = mag || 1;
    shakeDir.x = dx / n;
    shakeDir.z = -dy / n;
  }
  if (mag > START_SHAKE) {
    if (phase === 'stirring') stirSource = 'shake';
    else if (phase === 'idle' || phase === 'settling' || phase === 'presented') startStir('shake');
  }
}

function setHint(text) {
  const h = document.getElementById('hint');
  if (h) h.textContent = text;
}

async function enableMotion() {
  const note = document.getElementById('motionNote');
  // This runs from the Enter tap — a user gesture — so it's a valid moment to
  // arm vibration (browsers gate navigator.vibrate behind a prior interaction).
  hapticsArmed = true;
  const enabled = () => {
    window.addEventListener('devicemotion', handleMotion);
    motionEnabled = true;
    setHint('Shake your phone to tumble the dice — hold it still to let them fall.');
  };
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    // iOS 13+: must ask, in response to this tap.
    try {
      const res = await DeviceMotionEvent.requestPermission();
      if (res === 'granted') enabled();
      else { note.textContent = 'Motion denied — use the Cast button instead.'; setHint('Tap “Cast the Dice”.'); }
    } catch {
      note.textContent = 'Motion unavailable — use the Cast button.';
      setHint('Tap “Cast the Dice”.');
    }
  } else if (typeof DeviceMotionEvent !== 'undefined') {
    // Android / others: no prompt needed over HTTPS.
    enabled();
  } else {
    note.textContent = 'No motion sensor here — use the Cast button.';
    setHint('Tap “Cast the Dice”.');
  }
}

// Manual cast (desktop / tap): tumble for a beat, then let them settle.
function manualCast() { hapticsArmed = true; startStir('button'); }

// ===========================================================================
// Loop
// ===========================================================================
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 30);

  if (phase === 'stirring') {
    stirTimer += dt;
    if (stirSource === 'shake') {
      // Tumble harder the harder you shake; decay the peak each frame so the
      // dice settle once you hold the phone still. Pass the live shake direction
      // so the dice fly the way the phone is moving.
      // A harder shake throws harder: lower divisor + higher ceiling than
      // before so vigorous shaking really flings the dice across the ring.
      const power = Math.min(2.2, Math.max(0.4, shakeEnergy / 11));
      stir(power, shakeDir);
      shakeEnergy *= Math.pow(0.86, dt * 60);
      // Decay direction quickly so a single left-shake gives a brief left lean
      // (not a sustained one-way push); a continued shake keeps refreshing it.
      shakeDir.x *= Math.pow(0.62, dt * 60);
      shakeDir.z *= Math.pow(0.62, dt * 60);
      if (shakeEnergy < STILL_SHAKE) {
        stillSeconds += dt;
        if (stillSeconds > SETTLE_AFTER) settle();
      } else {
        stillSeconds = 0;
      }
    } else {
      // Button / desktop: a fixed lively tumble, then settle.
      stir(1);
      if (stirTimer > 1.2) settle();
    }
  }

  world.step(1 / 60, dt, 3);

  if (phase === 'stirring' || phase === 'settling') containDice();

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
// Interpretation — look up the cast in the pre-generated reading bundle
// ===========================================================================
// All 1,728 readings (12 planets × 12 signs × 12 houses) live in readings.json
// next to this script. Fetched lazily on first use, then cached by the service
// worker, so every later cast is instant and works offline.
//
// The live /interpret backend is still wired up as a fallback (in case the
// bundle fails to load) and stays reserved for the future paid "ask the oracle
// a follow-up question" feature — that's why we keep server.py and the Vercel
// deployment around. Override without redeploying by opening the app with
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
// The follow-up "ask the oracle" endpoint lives next to /interpret — derive
// from ORACLE_API so an `?oracle=` override flips both endpoints together.
const ASK_API = ORACLE_API ? ORACLE_API.replace(/\/interpret(\/?)$/, '/ask$1') : null;

// Lazy-loaded reading bundle. Keyed by `${planet}-${sign}-${house}` where
// planet and sign are 0–11 face indices matching die order (Sun…Ketu,
// Aries…Pisces) and house is 1–12.
let readingsBundle = null;
let readingsPromise = null;
function loadReadings() {
  if (readingsBundle) return Promise.resolve(readingsBundle);
  if (readingsPromise) return readingsPromise;
  readingsPromise = fetch('./readings.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => { readingsBundle = j; return j; })
    .catch(err => { readingsPromise = null; throw err; });
  return readingsPromise;
}

let lastDraw = null;
const interpretBtn = document.getElementById('interpretBtn');
const readingEl = document.getElementById('reading');
const readingDraw = document.getElementById('readingDraw');
const readingBody = document.getElementById('readingBody');
const readingDialog = document.getElementById('readingDialog');
const askToggle = document.getElementById('askToggle');
const askForm = document.getElementById('askForm');
const askInput = document.getElementById('askInput');
const askSubmit = document.getElementById('askSubmit');
const askCancel = document.getElementById('askCancel');

// Active reveals — there can be more than one in flight at once (the main
// reading + any in-progress oracle answer), so we track them as a Set and
// cancel them en masse when the panel closes or the user starts a new cast.
const activeReveals = new Set();
function cancelAllReveals() {
  activeReveals.forEach(r => r.cancel && r.cancel());
  activeReveals.clear();
}

function openReadingPanel() {
  readingDraw.textContent = lastDraw ? lastDraw.glyphs : '';
  readingEl.classList.add('show');
  document.body.classList.add('reading-open');
}

// Dim italic centered text for "loading" and "error" states. Used while the
// oracle is gathering, and for any short status message that isn't a reading.
function showReadingStatus(text, withDots) {
  cancelAllReveals();
  readingBody.classList.remove('fading', 'revealing');
  readingBody.classList.add('dim');
  readingBody.textContent = '';
  readingBody.appendChild(document.createTextNode(withDots ? text + ' ' : text));
  if (withDots) {
    // Hopping dots tell the user the app is working, not frozen.
    const dots = document.createElement('span');
    dots.className = 'dots';
    dots.innerHTML = '<span>.</span><span>.</span><span>.</span>';
    readingBody.appendChild(dots);
  }
  // Hide the question UI during loading / error — only show it after a real
  // reading has actually revealed.
  hideAskUI();
  openReadingPanel();
}

// Reveal the reading word-by-word with a soft fade trail. Wraps revealInto()
// with the loading-dots fade-out beat. Fires `onComplete` (which surfaces the
// ask-the-oracle button) after the last word settles.
function revealReading(text) {
  cancelAllReveals();
  openReadingPanel();
  hideAskUI();
  // Fade out whatever's currently in the body before swapping in word spans.
  readingBody.classList.add('fading');
  const FADE_OUT_MS = 380;
  const fadeTimer = setTimeout(
    () => revealInto(readingBody, text, { onComplete: showAskToggle }),
    FADE_OUT_MS,
  );
  // Track this preliminary timer so canceling mid-fade also works.
  const handle = {
    cancel: () => {
      clearTimeout(fadeTimer);
      // Skip to the full reveal immediately.
      revealInto(readingBody, text, { instant: true, onComplete: showAskToggle });
    },
  };
  activeReveals.add(handle);
}

// Pacing of the word reveal. Step is per-character (not per-word) so longer
// words consume more time before the next starts — visually that means the
// reveal cadence stays even instead of feeling jumpy across word lengths.
// Combined with the long .9s word fade in CSS, many words are always in-flight
// at once, giving a continuous wave of opacity rather than discrete pops.
// Tuned so a ~210-word / ~1300-char reading takes roughly 12s overall.
const REVEAL_STEP_PER_CHAR  = 7;   // ms added per character of the word
const REVEAL_MIN_STEP       = 18;  // floor for very short words ("a", "is")
const REVEAL_SENTENCE_PAUSE = 220; // extra pause after `.` / `!` / `?`
const REVEAL_PARAGRAPH_PAUSE = 600; // extra pause between paragraphs

// Generic word-reveal — targets any element, so it works for the main reading
// body AND for individual oracle-answer turns appended in the dialog area.
// Returns a handle with .cancel() that skips to the fully-revealed state.
function revealInto(target, text, opts) {
  opts = opts || {};
  target.classList.remove('dim', 'fading');
  target.classList.add('revealing');
  target.textContent = '';

  // Split on blank lines so paragraph breaks survive in the rendered output
  // (the target uses `white-space: pre-wrap`, so the `\n\n` we re-insert below
  // renders as a real blank line).
  const paragraphs = text.split(/\n\n+/);
  const words = [];
  paragraphs.forEach((para, pi) => {
    if (pi > 0) target.appendChild(document.createTextNode('\n\n'));
    // Keep whitespace runs as their own tokens so spacing inside the paragraph
    // is preserved exactly when we re-assemble the DOM.
    const tokens = para.split(/(\s+)/);
    let lastWordSpan = null;
    tokens.forEach(tok => {
      if (!tok) return;
      if (/^\s+$/.test(tok)) {
        target.appendChild(document.createTextNode(tok));
      } else {
        const s = document.createElement('span');
        s.className = 'word';
        s.textContent = tok;
        target.appendChild(s);
        words.push({ el: s, text: tok, endsParagraph: false });
        lastWordSpan = words[words.length - 1];
      }
    });
    if (lastWordSpan && pi < paragraphs.length - 1) lastWordSpan.endsParagraph = true;
  });

  if (opts.instant) {
    words.forEach(w => w.el.classList.add('shown'));
    target.classList.remove('revealing');
    if (opts.onComplete) opts.onComplete();
    return { cancel: () => {} };
  }

  // Schedule each word's fade-in at an accumulating delay.
  const timers = [];
  let delay = 0;
  words.forEach((w) => {
    timers.push(setTimeout(() => w.el.classList.add('shown'), delay));
    delay += Math.max(REVEAL_MIN_STEP, w.text.length * REVEAL_STEP_PER_CHAR);
    if (/[.!?]$/.test(w.text)) delay += REVEAL_SENTENCE_PAUSE;
    if (w.endsParagraph) delay += REVEAL_PARAGRAPH_PAUSE;
  });
  // One more timer to drop the `revealing` class (and pointer cursor) and
  // fire onComplete once the last word has had time to finish its fade-in.
  const handle = {
    cancel: () => {
      timers.forEach(clearTimeout);
      words.forEach(w => w.el.classList.add('shown'));
      target.classList.remove('revealing');
      activeReveals.delete(handle);
      if (opts.onComplete) opts.onComplete();
    },
  };
  timers.push(setTimeout(() => {
    target.classList.remove('revealing');
    activeReveals.delete(handle);
    if (opts.onComplete) opts.onComplete();
  }, delay + 600));

  // Tap on the target during reveal skips to the full text.
  const tapToSkip = () => handle.cancel();
  target.addEventListener('click', tapToSkip, { once: true });

  activeReveals.add(handle);
  return handle;
}

function hideReading() {
  cancelAllReveals();
  hideAskUI();
  // Clear any prior dialog turns so the next cast starts clean.
  if (readingDialog) readingDialog.textContent = '';
  readingEl.classList.remove('show');
  document.body.classList.remove('reading-open');
}

// Minimum time the "oracle gazes..." state is held even when the reading is
// already in memory. Gives every cast the same ceremonial beat — a tiny breath
// between the question and the answer.
const CEREMONY_PAUSE_MS = 800;

interpretBtn.addEventListener('click', async () => {
  if (!lastDraw) return;
  const key = `${lastDraw.planet}-${lastDraw.sign}-${lastDraw.house}`;
  interpretBtn.disabled = true;
  showReadingStatus('The oracle gazes into the cast', /* withDots = */ true);
  const ceremonyStart = performance.now();

  let reading = null;
  let errorMsg = null;
  try {
    const bundle = await loadReadings();
    reading = bundle[key];
    if (!reading) errorMsg = 'The oracle has no words for this particular cast yet.';
  } catch (err) {
    // Bundle failed — fall back to the live API if available so the user
    // still gets a reading instead of an error. (Same path the future paid
    // "ask the oracle a follow-up question" feature will use.)
    if (!ORACLE_API) {
      errorMsg = 'The oracle could not be reached: ' + err.message;
    } else {
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
        if (res.ok && data && data.reading) reading = data.reading;
        else if (data && data.error) errorMsg = data.error;
        else errorMsg = 'The oracle is silent just now. Try again shortly.';
      } catch (err2) {
        errorMsg = 'The oracle could not be reached: ' + err2.message;
      }
    }
  }

  // Hold the loading state for at least CEREMONY_PAUSE_MS so the answer never
  // feels like a snap, even when the bundle is already cached and lookup is
  // effectively instant.
  const elapsed = performance.now() - ceremonyStart;
  if (elapsed < CEREMONY_PAUSE_MS) {
    await new Promise(r => setTimeout(r, CEREMONY_PAUSE_MS - elapsed));
  }

  if (reading) {
    currentReading = reading;
    revealReading(reading);
  } else {
    currentReading = '';
    showReadingStatus(errorMsg, /* withDots = */ false);
  }
  interpretBtn.disabled = false;
});

document.getElementById('readingClose').addEventListener('click', hideReading);

// =============================================================================
// About panel — explains the oracle (what it is, the lineage, how to use it).
// Opens from either the topbar "About" link or the entry-overlay "What this
// is" link; closes on Close button, Escape, or click on the scrim outside the
// inner column.
// =============================================================================
const aboutEl = document.getElementById('about');
function openAbout() {
  aboutEl.classList.add('show');
  document.body.classList.add('about-open');
  aboutEl.scrollTop = 0;
}
function closeAbout() {
  aboutEl.classList.remove('show');
  document.body.classList.remove('about-open');
}
document.getElementById('aboutToggle').addEventListener('click', openAbout);
document.getElementById('aboutFromOverlay').addEventListener('click', openAbout);
document.getElementById('aboutClose').addEventListener('click', closeAbout);
document.getElementById('aboutCloseX').addEventListener('click', closeAbout);
// Click on the dark scrim (the panel itself, outside .inner) closes too.
aboutEl.addEventListener('click', e => {
  if (e.target === aboutEl) closeAbout();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && aboutEl.classList.contains('show')) closeAbout();
});

// =============================================================================
// Ask the Oracle — follow-up question against the same cast/reading
// =============================================================================
// The static bundle answers "what does this cast mean?" — the /ask endpoint
// answers a specific follow-up the user types in, anchored in the placement
// they were given. Different rate/cost shape than /interpret (live API call,
// Claude Opus 4.7), so it sits behind an opt-in button that only surfaces
// after the static reading has finished revealing.

// Last static reading text, fed to /ask as context so the model can honor
// (not repeat) what the user already saw.
let currentReading = '';

function showAskToggle() {
  if (!ASK_API) return; // public preview without a backend — keep hidden
  askToggle.classList.remove('hidden');
  askForm.classList.add('hidden');
}

function hideAskUI() {
  askToggle.classList.add('hidden');
  askForm.classList.add('hidden');
  askInput.value = '';
}

function openAskForm() {
  askToggle.classList.add('hidden');
  askForm.classList.remove('hidden');
  // Focus on next tick — Safari sometimes ignores focus inside a click handler
  // when the element transitions from display:none.
  setTimeout(() => askInput.focus(), 50);
}

askToggle.addEventListener('click', openAskForm);
askCancel.addEventListener('click', () => {
  askForm.classList.add('hidden');
  askToggle.classList.remove('hidden');
});

// Enter (without Shift) submits — Shift+Enter inserts a newline like a normal
// textarea. Esc cancels.
askInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    askSubmit.click();
  } else if (e.key === 'Escape') {
    askCancel.click();
  }
});

askSubmit.addEventListener('click', async () => {
  if (!lastDraw || !currentReading || !ASK_API) return;
  const question = askInput.value.trim();
  if (!question) return;
  if (question.length > 2000) {
    alert('That question is too long — please trim it to 2000 characters.');
    return;
  }
  // Build the dialog turn immediately so the user sees their own question land,
  // with the oracle's answer area below it showing the "considering" dots.
  const turn = document.createElement('div');
  turn.className = 'dialog-turn';
  const q = document.createElement('div');
  q.className = 'question';
  q.textContent = question;
  const answer = document.createElement('div');
  answer.className = 'answer dim';
  // Build the same loading-text + hopping-dots structure used by the main
  // reading, so the visual language matches.
  answer.appendChild(document.createTextNode('The oracle considers your question '));
  const dots = document.createElement('span');
  dots.className = 'dots';
  dots.innerHTML = '<span>.</span><span>.</span><span>.</span>';
  answer.appendChild(dots);
  turn.appendChild(q);
  turn.appendChild(answer);
  readingDialog.appendChild(turn);
  // Clear and disable input; collapse the form so the dots have center stage.
  askInput.value = '';
  askForm.classList.add('hidden');
  askToggle.classList.add('hidden');
  askSubmit.disabled = true;
  askCancel.disabled = true;
  // Scroll the new turn into view so the user follows the dialog naturally.
  turn.scrollIntoView({ behavior: 'smooth', block: 'center' });

  try {
    const res = await fetch(ASK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planet: lastDraw.planet,
        sign: lastDraw.sign,
        house: lastDraw.house,
        reading: currentReading,
        question,
      }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON response */ }
    if (res.ok && data && data.answer) {
      // Fade out the loading text, then reveal the answer word-by-word in the
      // same gold inscription style as the static reading.
      answer.classList.add('fading');
      setTimeout(() => {
        answer.classList.remove('dim');
        revealInto(answer, data.answer, { onComplete: showAskToggle });
      }, 380);
    } else {
      // Error state — replace the dots with the error message in dim italic.
      answer.classList.remove('fading');
      answer.textContent = (data && data.error)
        || 'The oracle is silent just now. Try again shortly.';
      showAskToggle();
    }
  } catch (err) {
    answer.textContent = 'The oracle could not be reached: ' + err.message;
    showAskToggle();
  } finally {
    askSubmit.disabled = false;
    askCancel.disabled = false;
  }
});

// Cast Again — recast directly from the reading panel. startStir() hides the
// reading and sets phase to stirring, so a single tap dismisses + recasts.
document.getElementById('readingRecast').addEventListener('click', manualCast);

// Universal tap-confirmation flash: any .btn gets a brief `.pressed` class on
// click so the user always sees their tap landed, even when the underlying
// action does nothing (e.g. tapping while a network reading is loading).
document.addEventListener('click', e => {
  const b = e.target && e.target.closest && e.target.closest('.btn');
  if (!b) return;
  b.classList.add('pressed');
  setTimeout(() => b.classList.remove('pressed'), 180);
});
