import { randomInt, randomUUID } from 'node:crypto';

// Uniform float in [0, 1) from the OS CSPRNG, so shuffles can't be predicted.
export const cryptoRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;

// Deterministic PRNG (mulberry32) for tests.
export function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// No I or O, so codes read cleanly over a phone call.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function makeRoomCode(rng = cryptoRandom) {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(rng() * CODE_LETTERS.length)];
  return code;
}

// Drop control, zero-width and bidi-override characters; collapse spaces.
const UNSAFE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069<>]', 'g');

export function cleanName(name) {
  const s = String(name ?? '').replace(UNSAFE, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, 16).join('').trim() || 'Player';
}

export const newId = () => randomUUID().replace(/-/g, '').slice(0, 10);
