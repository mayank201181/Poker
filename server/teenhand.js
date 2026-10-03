// Teen Patti hands, best to worst:
//   Trail (three of a kind) · Pure Sequence (a run in one suit) · Sequence
//   (a run) · Color (one suit) · Pair · High Card
// Runs: A-K-Q is the highest, then A-2-3, then K-Q-J and down to 4-3-2.
// tpScore() returns one integer: higher is better, equal hands tie.

import { makeDeck } from './cards.js';

export const TP_CATEGORIES = ['High Card', 'Pair', 'Color', 'Sequence', 'Pure Sequence', 'Trail'];

const pack = (cat, a = 0, b = 0, c = 0) => (cat << 12) | (a << 8) | (b << 4) | c;

// cards: objects with v (2–14, Ace high) and s (suit)
export function tpScore(cards) {
  const v = cards.map((c) => c.v).sort((a, b) => b - a);
  const color = cards[0].s === cards[1].s && cards[1].s === cards[2].s;
  let run = 0;
  if (v[0] - v[1] === 1 && v[1] - v[2] === 1) run = v[0] === 14 ? 15 : v[0];
  else if (v[0] === 14 && v[1] === 3 && v[2] === 2) run = 14; // A-2-3: second only to A-K-Q
  if (v[0] === v[2]) return pack(5, v[0]);
  if (run && color) return pack(4, run);
  if (run) return pack(3, run);
  if (color) return pack(2, v[0], v[1], v[2]);
  if (v[0] === v[1]) return pack(1, v[0], v[2]);
  if (v[1] === v[2]) return pack(1, v[1], v[0]);
  return pack(0, v[0], v[1], v[2]);
}

const NAME = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
const plural = (v) => (v === 6 ? 'Sixes' : `${NAME[v]}s`);
const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const r = (v) => RANK[v] ?? String(v);
const RUN = (top) => (top === 15 ? 'A-K-Q' : top === 14 ? 'A-2-3' : `${r(top)}-${r(top - 1)}-${r(top - 2)}`);

const decode = (sc) => ({ cat: sc >> 12, a: (sc >> 8) & 15, b: (sc >> 4) & 15 });

// "Pure Sequence, A-2-3"
export function tpName(sc) {
  const { cat, a } = decode(sc);
  switch (cat) {
    case 5: return `Trail of ${plural(a)}`;
    case 4: return `Pure Sequence, ${RUN(a)}`;
    case 3: return `Sequence, ${RUN(a)}`;
    case 2: return `Color, ${NAME[a]} high`;
    case 1: return `Pair of ${plural(a)}`;
    default: return `${NAME[a]} high`;
  }
}

// Short enough for a small seat on the table.
export function tpShort(sc) {
  const { cat, a } = decode(sc);
  if (cat === 5) return `Trail of ${plural(a)}`;
  if (cat === 1) return `Pair of ${plural(a)}`;
  if (cat === 0) return `${NAME[a]} high`;
  return TP_CATEGORIES[cat];
}

// How a hand ranks against every possible three-card hand: 0 (the worst) to 1
// (the best). Computer players use it to judge their cards.
const ALL = (() => {
  const deck = makeDeck();
  const out = [];
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) out.push(tpScore([deck[a], deck[b], deck[c]]));
  return out.sort((x, y) => x - y);
})();

export function tpPercentile(sc) {
  let lo = 0;
  let hi = ALL.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ALL[mid] < sc) lo = mid + 1;
    else hi = mid;
  }
  let eq = lo;
  while (eq < ALL.length && ALL[eq] === sc) eq++;
  return (lo + (eq - lo) / 2) / ALL.length;
}

export const TP_HANDS = ALL.length;
