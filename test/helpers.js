import { Game } from '../server/game.js';
import { TeenPatti } from '../server/teenpatti.js';
import { makeDeck } from '../server/cards.js';
import { seededRng } from '../server/util.js';

// Build a game with a stacked first hand.
//   stacks: chips per player (players are p0, p1, … in seat order)
//   button: index of the first button
//   hole:   cards per player index, e.g. [['AS', 'KS'], ['2C', '7D']] (missing = any)
//   board:  up to five cards in the order they come out (burn cards are added)
export function rig({ stacks, button = 0, hole = [], board = [], rules = {}, emit } = {}) {
  const ids = stacks.map((stack, i) => ({ id: `p${i}`, name: `P${i}`, stack }));
  const pool = new Map(makeDeck().map((c) => [c.r + c.s, c]));
  const take = (code) => {
    const c = pool.get(code);
    if (!c) throw new Error(`card ${code} is unknown or used twice`);
    pool.delete(code);
    return c;
  };
  const holes = stacks.map((_, i) => (hole[i] ? hole[i].map(take) : null));
  const boardCards = board.map(take);
  const spare = () => {
    const [code, c] = pool.entries().next().value;
    pool.delete(code);
    return c;
  };
  // Deal order: two rounds starting left of the button (everyone has chips here).
  const order = stacks.map((_, k) => (button + 1 + k) % stacks.length).filter((i) => stacks[i] > 0);
  const firstRound = order.map((i) => holes[i]?.[0] ?? null);
  const secondRound = order.map((i) => holes[i]?.[1] ?? null);
  const seq = [...firstRound, ...secondRound];
  const run = [null, boardCards[0], boardCards[1], boardCards[2], null, boardCards[3], null, boardCards[4]];
  const filled = [...seq, ...run].map((c) => c ?? null);
  const cards = filled.map((c) => c ?? spare());
  const rigged = [...pool.values(), ...cards.reverse()]; // the deck deals from the end
  const g = new Game(ids, { blinds: 1, ...rules }, {
    rng: seededRng(7),
    emit,
    button: `p${button}`,
    deck: (no) => (no === 1 ? rigged : null),
  });
  return g;
}

export const seat = (g, pid) => g.hand.seats.get(pid);
export const stacks = (g) => g.players.map((p) => p.stack);
export const ev = (g, t) => g.events.filter((e) => e.t === t);

// Chips are never created or lost.
export function chipsOk(g) {
  return g.players.reduce((a, p) => a + p.stack, 0) + g.chipsInPlay() === g.chipsIn - g.chipsOut;
}

// The same for Teen Patti: three cards each, dealt one at a time starting
// left of the button, no burn cards.
export function rigTP({ stacks, button = 0, hole = [], rules = {}, emit } = {}) {
  const ids = stacks.map((stack, i) => ({ id: `p${i}`, name: `P${i}`, stack }));
  const pool = new Map(makeDeck().map((c) => [c.r + c.s, c]));
  const take = (code) => {
    const c = pool.get(code);
    if (!c) throw new Error(`card ${code} is unknown or used twice`);
    pool.delete(code);
    return c;
  };
  const holes = stacks.map((_, i) => (hole[i] ? hole[i].map(take) : null));
  const spare = () => {
    const [code, c] = pool.entries().next().value;
    pool.delete(code);
    return c;
  };
  const order = stacks.map((_, k) => (button + 1 + k) % stacks.length).filter((i) => stacks[i] > 0);
  const seq = [0, 1, 2].flatMap((r) => order.map((i) => holes[i]?.[r] ?? null));
  const cards = seq.map((c) => c ?? spare());
  const rigged = [...pool.values(), ...cards.reverse()];
  return new TeenPatti(ids, { boot: 1, potLimit: 0, ...rules }, {
    rng: seededRng(7),
    emit,
    button: `p${button}`,
    deck: (no) => (no === 1 ? rigged : null),
  });
}
