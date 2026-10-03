// Randomised games: random (often silly or illegal) moves, players leaving,
// sitting down, sitting out and rebuying, and bot-only games. After every
// step we check that no chip or card is lost or made up, that every pot went
// to the best hand that could win it, and that no view shows a hidden card.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError } from '../server/game.js';
import { botAct } from '../server/bot.js';
import { seededRng } from '../server/util.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

function checkInvariants(g) {
  const onTable = g.players.reduce((a, p) => a + p.stack, 0) + g.chipsInPlay();
  assert.equal(onTable, g.chipsIn - g.chipsOut, 'chips were lost or made up');
  for (const p of g.players) assert.ok(Number.isInteger(p.stack) && p.stack >= 0, 'bad stack');

  const h = g.hand;
  if (!h) return;
  const seats = [...h.seats.values()];
  const cards = [...h.deck, ...h.board, ...seats.flatMap((s) => s.hole)].map((c) => c.id);
  assert.equal(new Set(cards).size, cards.length, 'a card is in two places');
  assert.ok(cards.length <= 52 && cards.length >= 52 - 3, 'cards went missing');
  assert.ok(h.board.length <= 5);

  if (g.phase === 'hand') {
    const live = seats.filter((s) => !s.folded);
    assert.ok(live.length >= 2, 'a hand with one player left should be over');
    if (h.runout) assert.equal(h.toAct, null);
    else {
      const s = h.seats.get(h.toAct);
      assert.ok(s && !s.folded && !s.allIn, 'the player to act must be able to act');
    }
    for (const s of seats) assert.ok(s.bet <= h.currentBet || s.bet === 0 || h.currentBet >= s.bet, 'bet above the current bet');
  } else {
    for (const s of seats) assert.equal(s.bet, 0, 'bets left on the table after the hand');
  }

  // Showdown: each pot went to the best hand(s) among the players who could win it.
  if (g.phase !== 'hand' && h.results?.showdown && !h.voided) {
    const pots = g.pots();
    assert.equal(pots.length, h.results.pots.length);
    pots.forEach((pot, i) => {
      const res = h.results.pots[i];
      assert.equal(res.amount, pot.amount);
      const best = Math.max(...pot.seats.map((s) => g.best(s).score));
      const winners = pot.seats.filter((s) => g.best(s).score === best).map((s) => s.pid);
      assert.deepEqual(res.winners.map((w) => w.pid), winners);
      assert.equal(res.winners.reduce((a, w) => a + w.n, 0), pot.amount);
    });
  }

  for (const viewer of [...g.players.map((p) => p.id), 'watcher']) {
    const v = g.viewFor(viewer);
    const json = JSON.stringify(v);
    assert.ok(!/"id":\d/.test(json) && !json.includes('"code"'), 'internal card data must never reach clients');
    v.players.forEach((p) => {
      const s = h.seats.get(p.id);
      if (!p.cards) return;
      p.cards.forEach((c, i) => {
        if (!c) return;
        assert.ok(p.id === viewer || h.shown.has(p.id), `hidden card leaked to ${viewer}`);
        assert.deepEqual(c, { r: s.hole[i].r, s: s.hole[i].s }, 'view shows the wrong card');
      });
    });
    if (v.hand?.options) assert.equal(v.hand.toAct, viewer, 'options leaked to someone else');
  }
}

function randomBet(g, pid, rng) {
  const s = g.hand.seats.get(pid);
  const o = g.options(s);
  const r = rng();
  if (r < 0.15) return g.act(pid, 'fold');
  if (r < 0.4) return g.act(pid, o.canCheck ? 'check' : 'call');
  if (r < 0.45) return g.act(pid, pick(['check', 'call', 'raise', 'bogus'], rng), Math.floor(rng() * 3000) - 500);
  if (!o.canRaise) return g.act(pid, o.canCheck ? 'check' : 'call');
  const to = rng() < 0.2 ? o.maxTo : o.minTo + Math.floor(rng() * (o.maxTo - o.minTo + 1));
  return g.act(pid, 'raise', to);
}

function randomMove(g, rng, nextId) {
  const r = rng();
  const someone = () => pick(g.players, rng).id;
  if (r < 0.015 && g.players.length > 2) return g.removePlayer(someone());
  if (r < 0.03 && g.players.length < 10) return g.addPlayer({ id: nextId(), name: 'New' });
  if (r < 0.05) return g.sitOut(someone(), rng() < 0.5 ? 'self' : 'away');
  if (r < 0.08) return g.sitIn(someone());
  if (r < 0.1) return g.rebuy(someone());
  if (r < 0.11) return g.show(someone());
  if (r < 0.115) return g.raiseBlinds();
  if (g.phase === 'hand') {
    if (g.hand.runout) return g.runoutStep();
    if (rng() < 0.05) return g.act(someone(), 'call'); // usually not their turn
    if (rng() < 0.05) return g.autoPlay(g.hand.toAct);
    return randomBet(g, g.hand.toAct, rng);
  }
  if (g.phase === 'waiting') for (const p of g.players) if (p.out) g.sitIn(p.id);
  if (g.rules.mode === 'cash' && rng() < 0.5) for (const p of g.players) if (p.stack === 0) g.rebuy(p.id);
  return g.nextHand();
}

test('random games keep every chip and card and leak nothing', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const rng = seededRng(seed);
    const n = 2 + (seed % 9);
    const mode = seed % 3 === 0 ? 'tourney' : 'cash';
    const g = new Game(players(n), { mode, stack: [500, 1000, 2000][seed % 3], blinds: seed % 4 }, { rng });
    let ids = n;
    const nextId = () => `p${ids++}`;
    for (let step = 0; step < 900 && g.phase !== 'gameOver'; step++) {
      try {
        randomMove(g, rng, nextId);
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
      }
      checkInvariants(g);
    }
    if (g.phase !== 'gameOver') {
      g.finishGame('host');
      checkInvariants(g);
    }
    assert.equal(g.phase, 'gameOver');
    assert.ok(g.winners.length >= 1 || g.players.length === 0);
  }
});

test('computer players always make a legal move, and their games finish', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const rng = seededRng(1000 + seed);
    const n = 2 + (seed % 9);
    const g = new Game(players(n), { mode: 'tourney', stack: 500, blinds: 1 }, { rng });
    for (let step = 0; g.phase !== 'gameOver'; step++) {
      assert.ok(step < 40000, 'a bot game should end');
      if (g.phase === 'hand') {
        if (g.hand.runout) g.runoutStep();
        else {
          const pid = g.hand.toAct;
          const before = g.hand.actions;
          botAct(g, pid, rng, { loose: rng() * 2 - 1, aggro: 0.7 + rng() * 0.7 });
          assert.ok(g.phase !== 'hand' || g.hand.actions > before || g.hand.runout, 'the bot did nothing');
        }
      } else {
        if (g.handNo % 15 === 0) g.raiseBlinds();
        g.nextHand();
      }
      if (step % 7 === 0) checkInvariants(g);
    }
    assert.equal(g.winners.length, 1);
    assert.equal(g.players.filter((p) => p.stack > 0).length, 1);
    assert.equal(g.players.reduce((a, p) => a + p.stack, 0), 500 * n);
  }
});
