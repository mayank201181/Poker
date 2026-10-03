// Card faces, chips and number formats shared by every screen.

import { h } from './h.js';

export const SUIT = { S: '♠', H: '♥', C: '♣', D: '♦' };
export const SUIT_HINDI = { S: 'Hukum', H: 'Paan', C: 'Chidi', D: 'Eent' };

export const isRed = (c) => c.s === 'H' || c.s === 'D';
export const cardText = (c) => `${c.r}${SUIT[c.s]}`;
export const sameCard = (a, b) => Boolean(a && b && a.r === b.r && a.s === b.s);

// Chips in the Indian style: 1,00,000. Short form for small seats: 12K, 1.2L.
const full = new Intl.NumberFormat('en-IN');
const short = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
export const fmt = (n) => full.format(n);
export const fmtShort = (n) => (Math.abs(n) >= 10000 ? short.format(n) : full.format(n));
export const fmtSigned = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');

// size: 'lg' (your cards), 'md' (the board), 'sm' (other players)
export function cardEl(c, { size = 'md', key, extra } = {}) {
  if (!c) return h('div.card.back', { class: [size, extra], dataset: key ? { key } : undefined });
  const court = c.r === 'J' || c.r === 'Q' || c.r === 'K';
  return h(
    'div.card.face',
    { class: [size, extra, { red: isRed(c), court }], dataset: key ? { key } : undefined, 'aria-label': cardText(c) },
    h('span.ix', c.r, h('i', SUIT[c.s])),
    h('span.pip', court ? c.r : SUIT[c.s]),
    court && h('span.pip-suit', SUIT[c.s]),
    size !== 'sm' && h('span.ix.br', c.r, h('i', SUIT[c.s])),
  );
}

export const backEl = (opts = {}) => cardEl(null, opts);

export const chipEl = (extra) => h('i.chip', { class: extra });
