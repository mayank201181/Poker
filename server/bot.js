// Computer players. A bot only uses what a person in its seat would know:
// its own two cards, the board, the bets and the pot.

import { score } from './hand.js';

// Bill Chen's quick preflop rating: about −1 (7-2 offsuit) to 20 (A-A).
export function chen(a, b) {
  const hi = Math.max(a.v, b.v);
  const lo = Math.min(a.v, b.v);
  const base = (v) => (v === 14 ? 10 : v === 13 ? 8 : v === 12 ? 7 : v === 11 ? 6 : v / 2);
  if (hi === lo) return Math.max(5, Math.ceil(base(hi) * 2));
  let pts = base(hi);
  if (a.s === b.s) pts += 2;
  const gap = hi - lo - 1;
  pts -= [0, 1, 2, 4][gap] ?? 5;
  if (gap <= 1 && hi < 12) pts += 1;
  return Math.ceil(pts);
}

const DECK = Array.from({ length: 52 }, (_, i) => i);
const mine = new Array(7);
const theirs = new Array(7);

// Chance of winning against `opponents` random hands, by simulation.
export function equity(hole, board, opponents, iters, rng) {
  const known = new Set([...hole, ...board].map((c) => c.code));
  const rest = DECK.filter((c) => !known.has(c));
  const need = 5 - board.length;
  const deal = need + 2 * opponents;
  mine[0] = hole[0].code;
  mine[1] = hole[1].code;
  board.forEach((c, i) => {
    mine[2 + i] = c.code;
    theirs[2 + i] = c.code;
  });
  let won = 0;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < deal; i++) {
      const j = i + Math.floor(rng() * (rest.length - i));
      const t = rest[i];
      rest[i] = rest[j];
      rest[j] = t;
    }
    for (let i = 0; i < need; i++) {
      mine[2 + board.length + i] = rest[i];
      theirs[2 + board.length + i] = rest[i];
    }
    const me = score(mine);
    let tied = 0;
    let lost = false;
    for (let o = 0; o < opponents && !lost; o++) {
      theirs[0] = rest[need + 2 * o];
      theirs[1] = rest[need + 2 * o + 1];
      const sc = score(theirs);
      if (sc > me) lost = true;
      else if (sc === me) tied++;
    }
    if (!lost) won += 1 / (tied + 1);
  }
  return won / iters;
}

// Makes exactly one betting decision for the bot whose turn it is.
// style: { loose: −1 (tight) … 1 (loose), aggro: ~0.7 (passive) … 1.4 (aggressive) }
export function botAct(game, pid, rng = Math.random, style = {}) {
  const h = game.hand;
  if (game.phase !== 'hand' || h.runout || h.toAct !== pid) return false;
  const s = h.seats.get(pid);
  const o = game.options(s);
  const loose = style.loose ?? 0;
  const aggro = style.aggro ?? 1;
  const { bb, sb } = h;
  const stack = s.p.stack;
  const opponents = Math.max(1, game.live().length - 1);
  const toCall = o.toCall;

  const passive = () => game.act(pid, o.canCheck ? 'check' : 'fold');
  const call = () => game.act(pid, o.canCheck ? 'check' : 'call');
  const raiseTo = (to) => {
    if (!o.canRaise) return call();
    let x = Math.round(to / sb) * sb;
    x = Math.min(o.maxTo, Math.max(o.minTo, x));
    // If most of the stack goes in anyway, put it all in.
    if (x - o.bet > stack * 0.7) x = o.maxTo;
    return game.act(pid, 'raise', x);
  };

  if (!h.board.length) {
    let c = chen(s.hole[0], s.hole[1]) + loose * 1.5 + (rng() - 0.5) * 2;
    if (opponents <= 2) c += 1.5;
    if (opponents <= 1) c += 1.5;
    const depth = (stack + s.bet) / bb;
    // Short-stacked: all in or out.
    if (depth <= 10) {
      if (c >= 8.5 || (o.canCheck && c >= 6)) return raiseTo(o.maxTo ?? 0);
      return passive();
    }
    if (h.currentBet <= bb) {
      if (c >= 9.5) return raiseTo(bb * (2.5 + rng()) + (o.pot - sb - bb) * 0.5);
      if (c >= 7 && rng() < 0.3 * aggro) return raiseTo(bb * 3);
      if (c >= 6 || o.canCheck) return call();
      if (c >= 4.5 && toCall <= sb) return call();
      return passive();
    }
    const cost = toCall / bb;
    if (c >= 13) return rng() < 0.6 * aggro ? raiseTo(h.currentBet * 3) : call();
    if (c >= 11) return cost <= 30 ? (rng() < 0.15 * aggro ? raiseTo(h.currentBet * 3) : call()) : passive();
    if (c >= 9) return cost <= 8 ? call() : passive();
    if (c >= 7.5) return cost <= 3 ? call() : passive();
    return passive();
  }

  const e = equity(s.hole, h.board, opponents, 260, rng) + loose * 0.04;
  const pot = o.pot;
  if (o.canCheck) {
    if (e >= 0.72) return raiseTo(pot * (0.55 + rng() * 0.35));
    if (e >= 0.52 && rng() < 0.5 * aggro) return raiseTo(pot * (0.4 + rng() * 0.25));
    if (e < 0.3 && h.street < 3 && rng() < 0.08 * aggro) return raiseTo(pot * 0.5); // a bluff
    return call();
  }
  const odds = toCall / (pot + toCall);
  if (e >= 0.82 && rng() < 0.6 * aggro) return raiseTo(h.currentBet * 2.5 + pot * 0.3);
  if (e >= odds + 0.1) return call();
  if (e >= odds && toCall <= stack * 0.05) return call();
  return passive();
}
