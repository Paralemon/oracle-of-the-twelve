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
  const dur = 0.06;
  const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.2);
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  // Harder hits ring slightly higher and louder, like real resin dice.
  bp.frequency.value = 1400 + Math.min(impact, 8) * 220 + (Math.random() - 0.5) * 400;
  bp.Q.value = 1.1;
  const g = audioCtx.createGain();
  g.gain.value = Math.min(0.5, 0.06 + impact * 0.045);
  src.connect(bp); bp.connect(g); g.connect(audioCtx.destination);
  src.start();
}

export function playChime() {
  if (muted || !audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  // A low, breath-like swell — G3 and D4 rising slowly out of silence and
  // settling back into it over ~3s, rounded by a lowpass. The slow attack is
  // the point: with no percussive onset there is nothing to "ding". More felt
  // than heard — a presence entering the room, not an elevator arriving.
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 750;
  lp.Q.value = 0.5;
  lp.connect(audioCtx.destination);
  [[196.0, 0, 0.042], [293.66, 0.06, 0.028]].forEach(([f, dt, amp]) => {
    const o = audioCtx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t + dt);
    g.gain.linearRampToValueAtTime(amp, t + dt + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 3.0);
    o.connect(g); g.connect(lp);
    o.start(t + dt); o.stop(t + dt + 3.2);
  });
}
