// Hand evaluator: the best five-card poker hand from 2–7 cards.
// score() returns one integer: a higher score is a better hand and equal
// scores split the pot. It works on card codes ((rank − 2) × 4 + suit) and
// allocates nothing, so computer players can call it thousands of times.

const B = 15;
const CAT = B ** 5;

export const CATEGORIES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
];

const counts = new Int8Array(15);
const suitCount = new Int8Array(4);
const suitMask = new Int32Array(4);
const kick = [0, 0, 0, 0, 0];

function pack(cat, a = 0, b = 0, c = 0, d = 0, e = 0) {
  return ((((cat * B + a) * B + b) * B + c) * B + d) * B + e;
}

// Top card of the highest five-in-a-row in a rank bitmask (an Ace also plays low).
function straightHigh(mask) {
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let h = 14; h >= 5; h--) if (((mask >> (h - 4)) & 31) === 31) return h;
  return 0;
}

// Fills `kick` with the k highest ranks in `mask`, skipping `x` and `y`.
function top(mask, k, x = 0, y = 0) {
  kick.fill(0);
  let n = 0;
  for (let v = 14; v >= 2 && n < k; v--) {
    if (v !== x && v !== y && (mask >> v) & 1) kick[n++] = v;
  }
  return kick;
}

export function score(codes) {
  counts.fill(0);
  suitCount.fill(0);
  suitMask.fill(0);
  let mask = 0;
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    const v = (c >> 2) + 2;
    const s = c & 3;
    counts[v]++;
    suitCount[s]++;
    suitMask[s] |= 1 << v;
    mask |= 1 << v;
  }
  let flush = -1;
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) flush = s;
  if (flush >= 0) {
    const h = straightHigh(suitMask[flush]);
    if (h) return pack(8, h);
  }
  let quad = 0;
  let t1 = 0;
  let t2 = 0;
  let p1 = 0;
  let p2 = 0;
  for (let v = 14; v >= 2; v--) {
    const n = counts[v];
    if (n === 4) quad = v;
    else if (n === 3) {
      if (!t1) t1 = v;
      else if (!t2) t2 = v;
    } else if (n === 2) {
      if (!p1) p1 = v;
      else if (!p2) p2 = v;
    }
  }
  if (quad) return pack(7, quad, top(mask, 1, quad)[0]);
  if (t1 && (t2 || p1)) return pack(6, t1, Math.max(t2, p1));
  if (flush >= 0) {
    const k = top(suitMask[flush], 5);
    return pack(5, k[0], k[1], k[2], k[3], k[4]);
  }
  const st = straightHigh(mask);
  if (st) return pack(4, st);
  if (t1) {
    const k = top(mask, 2, t1);
    return pack(3, t1, k[0], k[1]);
  }
  // With three pairs, the third pair can be the kicker.
  if (p2) return pack(2, p1, p2, top(mask, 1, p1, p2)[0]);
  if (p1) {
    const k = top(mask, 3, p1);
    return pack(1, p1, k[0], k[1], k[2]);
  }
  const k = top(mask, 5);
  return pack(0, k[0], k[1], k[2], k[3], k[4]);
}

export function decode(sc) {
  const vals = [];
  let rest = sc % CAT;
  for (let p = B ** 4; p >= 1; p /= B) {
    vals.push(Math.floor(rest / p));
    rest %= p;
  }
  return { cat: Math.floor(sc / CAT), vals };
}

const NAME = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
const plural = (v) => (v === 6 ? 'Sixes' : `${NAME[v]}s`);

// "Two Pair, Kings and Fives"
export function handName(sc) {
  const {
    cat,
    vals: [a, b],
  } = decode(sc);
  switch (cat) {
    case 8: return a === 14 ? 'Royal Flush' : `Straight Flush, ${NAME[a]} high`;
    case 7: return `Four of a Kind, ${plural(a)}`;
    case 6: return `Full House, ${plural(a)} full of ${plural(b)}`;
    case 5: return `Flush, ${NAME[a]} high`;
    case 4: return `Straight, ${NAME[a]} high`;
    case 3: return `Three of a Kind, ${plural(a)}`;
    case 2: return `Two Pair, ${plural(a)} and ${plural(b)}`;
    case 1: return `Pair of ${plural(a)}`;
    default: return `${NAME[a]} high`;
  }
}

// "Two Pair": short enough for a small seat on the table.
export function handShort(sc) {
  const {
    cat,
    vals: [a],
  } = decode(sc);
  if (cat === 8 && a === 14) return 'Royal Flush';
  if (cat === 1) return `Pair of ${plural(a)}`;
  if (cat === 0) return `${NAME[a]} high`;
  return CATEGORIES[cat];
}

function* fives(n, from = 0, picked = []) {
  if (picked.length === 5) {
    yield picked;
    return;
  }
  for (let i = from; i <= n - (5 - picked.length); i++) yield* fives(n, i + 1, [...picked, i]);
}

// The best hand from these cards (objects with .code), and the five cards that make it.
export function bestFive(cards) {
  const best = score(cards.map((c) => c.code));
  if (cards.length <= 5) return { score: best, cards: [...cards] };
  for (const idx of fives(cards.length)) {
    if (score(idx.map((i) => cards[i].code)) === best) return { score: best, cards: idx.map((i) => cards[i]) };
  }
  throw new Error('best five not found');
}
