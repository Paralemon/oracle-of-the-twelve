// Sound — procedural WebAudio, no audio files.
// A dice impact is a short burst of band-passed noise (a "clack") whose pitch
// and loudness scale with impact speed; the oracle's pronouncement is a low,
// breath-like swell of tone. The context is created/resumed on a user gesture
// (browser requirement), and a persisted mute toggle lives in the topbar.
// This is also the iOS substitute for haptics (no vibrate API there).

let audioCtx = null;
let muted = localStorage.getItem('oracleMuted') === '1';

export function isMuted() { return muted; }

export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('oracleMuted', m ? '1' : '0'); } catch { /* blocked */ }
  if (!m) armAudio();
}

export function armAudio() {
  if (muted) return;
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

let lastClackAt = 0;
export function playClack(impact) {
  if (muted || !audioCtx || audioCtx.state !== 'running') return;
  const now = performance.now();
  if (now - lastClackAt < 40) return; // a flurry reads as one clack
  lastClackAt = now;
  const t = audioCtx.currentTime;
  const i = Math.min(impact, 8);

  // Two layers make a rounded "tok" instead of a thin high "tick":
  //   (1) a low sine BODY — the deep thud you feel, ~110–160Hz, fast decay;
  //   (2) a brief, low-passed noise TEXTURE — the soft wooden/resin rattle.
  // Both are gently lowpassed and kept quiet, so it reads as dice on felt, not
  // a click.

  // (1) Body thud.
  const body = audioCtx.createOscillator();
  body.type = 'sine';
  const f0 = 110 + i * 7; // harder hits a touch higher, still deep
  body.frequency.setValueAtTime(f0 * 1.6, t);
  body.frequency.exponentialRampToValueAtTime(f0, t + 0.05); // tiny downward "thunk"
  const bg = audioCtx.createGain();
  bg.gain.setValueAtTime(Math.min(0.34, 0.08 + i * 0.03), t);
  bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  body.connect(bg); bg.connect(audioCtx.destination);
  body.start(t); body.stop(t + 0.16);

  // (2) Noise texture, lowpassed (no high tick).
  const dur = 0.05;
  const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let n = 0; n < data.length; n++) {
    data[n] = (Math.random() * 2 - 1) * Math.pow(1 - n / data.length, 2.5);
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 800 + i * 90; // capped low so it stays soft, not clicky
  lp.Q.value = 0.6;
  const ng = audioCtx.createGain();
  ng.gain.value = Math.min(0.16, 0.03 + i * 0.018);
  src.connect(lp); lp.connect(ng); ng.connect(audioCtx.destination);
  src.start(t);
}

export function playChime() {
  if (muted || !audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  // A deep, slow swell — felt more than heard. Two sines an octave below the
  // old chime (G2 + D3), rising over ~0.8s and dissolving over ~4s, behind a
  // low cutoff so there is no bright "ding" at all. A soft presence settling
  // into the room, not a bell or an alert.
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  lp.Q.value = 0.4;
  lp.connect(audioCtx.destination);
  [[98.0, 0, 0.05], [146.83, 0.10, 0.032]].forEach(([f, dt, amp]) => {
    const o = audioCtx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t + dt);
    g.gain.linearRampToValueAtTime(amp, t + dt + 0.8); // slow, glow-on attack
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 4.0);
    o.connect(g); g.connect(lp);
    o.start(t + dt); o.stop(t + dt + 4.2);
  });
}
