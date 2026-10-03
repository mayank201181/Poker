// Sound effects synthesised with Web Audio (no files to download), plus
// vibration and a spoken "All in!".

let ctx = null;
let noiseBuf = null;
let muted = false;
try {
  muted = localStorage.getItem('poker.muted') === '1';
} catch {}

export const isMuted = () => muted;

export function setMuted(on) {
  muted = on;
  try {
    localStorage.setItem('poker.muted', on ? '1' : '0');
  } catch {}
}

// Browsers only allow audio after a tap, so call this from tap handlers.
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}

function tone(freq, dur, { type = 'sine', vol = 0.12, at = 0, slide = null } = {}) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

function noise(dur, { vol = 0.2, at = 0, freq = 2000, q = 0.8 } = {}) {
  if (!ctx || muted) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// A clay chip landing: a short bright click with a little ring.
function clink(at = 0, vol = 0.1) {
  noise(0.035, { freq: 5200, vol: vol * 2.6, q: 2, at });
  tone(3100 + Math.random() * 500, 0.07, { vol, at, type: 'triangle' });
}

export const sfx = {
  deal: (n = 4) => {
    for (let i = 0; i < Math.min(n, 8); i++) noise(0.05, { freq: 3000, vol: 0.18, at: i * 0.07 });
  },
  flip: () => noise(0.05, { freq: 4200, vol: 0.26 }),
  chips: (n = 3) => {
    for (let i = 0; i < n; i++) clink(i * 0.055 + Math.random() * 0.02, 0.07 + Math.random() * 0.04);
  },
  check: () => {
    tone(150, 0.07, { type: 'square', vol: 0.06 });
    tone(150, 0.07, { type: 'square', vol: 0.06, at: 0.11 });
  },
  fold: () => noise(0.18, { freq: 1100, vol: 0.16, q: 0.5 }),
  turn: () => {
    tone(660, 0.14, { vol: 0.13 });
    tone(990, 0.24, { vol: 0.13, at: 0.12 });
  },
  tick: () => tone(1500, 0.03, { type: 'square', vol: 0.035 }),
  allin: () => {
    [196, 247, 294, 392].forEach((f, i) => tone(f, 0.5, { type: 'sawtooth', vol: 0.05, at: i * 0.05 }));
    tone(784, 0.4, { type: 'triangle', vol: 0.1, at: 0.22 });
  },
  oops: () => tone(200, 0.3, { type: 'sawtooth', vol: 0.07, slide: 110 }),
  error: () => tone(220, 0.14, { type: 'square', vol: 0.045 }),
  win: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, { type: 'triangle', vol: 0.13, at: i * 0.09 }));
    for (let i = 0; i < 6; i++) clink(0.45 + i * 0.06, 0.08);
  },
  ping: () => tone(880, 0.12, { vol: 0.08 }),
};

export function speak(text) {
  if (muted || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
}

export function haptic(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}
