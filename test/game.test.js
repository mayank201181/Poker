import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError, BLINDS } from '../server/game.js';
import { seededRng } from '../server/util.js';
import { rig, seat, stacks, ev, chipsOk } from './helpers.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const throwsGame = (fn, re) => assert.throws(fn, (e) => e instanceof GameError && (!re || re.test(e.message)));

test('blinds, the deal and who acts first (3 players)', () => {
  const g = rig({ stacks: [1000, 1000, 1000], button: 0 });
  const h = g.hand;
  assert.equal(g.phase, 'hand');
  assert.equal(h.button, 'p0');
  assert.equal(h.sbPid, 'p1');
  assert.equal(h.bbPid, 'p2');
  assert.deepEqual(stacks(g), [1000, 990, 980]);
  assert.equal(h.toAct, 'p0', 'the button is first to act three-handed');
  for (const s of h.seats.values()) assert.equal(s.hole.length, 2);
  assert.equal(h.board.length, 0);
  assert.deepEqual(BLINDS[g.level], [10, 20]);
  assert.ok(chipsOk(g));
});

test('heads-up: the button posts the small blind, acts first before the flop and last after', () => {
  const g = rig({ stacks: [1000, 1000], button: 0 });
  assert.equal(g.hand.sbPid, 'p0');
  assert.equal(g.hand.bbPid, 'p1');
  assert.equal(g.hand.toAct, 'p0');
  g.act('p0', 'call');
  assert.equal(g.hand.toAct, 'p1', 'the big blind gets the option');
  g.act('p1', 'check');
  assert.equal(g.hand.board.length, 3);
  assert.equal(g.hand.toAct, 'p1', 'after the flop the big blind acts first');
  g.act('p1', 'check');
  g.act('p0', 'check');
  assert.equal(g.hand.board.length, 4);
});

test('the big blind gets the option; the round ends when everyone has matched', () => {
  const g = rig({ stacks: [1000, 1000, 1000, 1000], button: 0 });
  // p1 SB, p2 BB, p3 first to act
  assert.equal(g.hand.toAct, 'p3');
  g.act('p3', 'call');
  g.act('p0', 'call');
  g.act('p1', 'call');
  assert.equal(g.hand.toAct, 'p2');
  assert.equal(g.options(seat(g, 'p2')).canCheck, true);
  assert.equal(g.options(seat(g, 'p2')).canRaise, true);
  g.act('p2', 'check');
  assert.equal(g.hand.street, 1);
  assert.equal(g.hand.pot, 80);
  assert.equal(g.hand.toAct, 'p1', 'the small blind acts first after the flop');
  assert.ok(chipsOk(g));
});

test('raises: the minimum is the last full raise; bets must be whole chips in range', () => {
  const g = rig({ stacks: [1000, 1000, 1000], button: 0 });
  throwsGame(() => g.act('p1', 'call'), /not your turn/);
  throwsGame(() => g.act('p0', 'check'), /can't check/);
  throwsGame(() => g.act('p0', 'raise', 30), /between 40 and 1000/);
  throwsGame(() => g.act('p0', 'raise', 40.5));
  throwsGame(() => g.act('p0', 'raise', 1001));
  throwsGame(() => g.act('p0', 'shove'), /Unknown/);
  g.act('p0', 'raise', 100); // a raise of 80
  const o = g.options(seat(g, 'p1'));
  assert.equal(o.toCall, 90);
  assert.equal(o.minTo, 180);
  assert.equal(o.maxTo, 1000);
  throwsGame(() => g.act('p1', 'raise', 150), /between 180 and 1000/);
  g.act('p1', 'raise', 300); // a raise of 200
  assert.equal(g.options(seat(g, 'p2')).minTo, 500);
  g.act('p2', 'fold');
  g.act('p0', 'call');
  assert.equal(g.hand.street, 1);
  assert.equal(g.hand.pot, 620);
  // After the flop the minimum bet is the big blind.
  assert.equal(g.hand.toAct, 'p1');
  assert.equal(g.options(seat(g, 'p1')).minTo, 20);
  assert.equal(g.options(seat(g, 'p1')).kind, 'bet');
  throwsGame(() => g.act('p1', 'call'), /nothing to call/);
  g.act('p1', 'raise', 20);
  assert.ok(chipsOk(g));
});

test('an all-in for less than a full raise does not reopen the betting', () => {
  const g = rig({ stacks: [1000, 1000, 150, 1000], button: 3 });
  // p0 SB, p1 BB, p2 first to act. Everyone limps.
  g.act('p2', 'call');
  g.act('p3', 'call');
  g.act('p0', 'call');
  g.act('p1', 'check');
  // Flop: p0 bets 100, p1 folds, p2 all-in for 130 (only 30 more), p3 calls 130.
  g.act('p0', 'raise', 100);
  g.act('p1', 'fold');
  g.act('p2', 'raise', 130);
  assert.equal(seat(g, 'p2').allIn, true);
  assert.equal(g.options(seat(g, 'p3')).canRaise, true, "p3 hasn't acted yet, so may raise");
  g.act('p3', 'call');
  const o = g.options(seat(g, 'p0'));
  assert.equal(g.hand.toAct, 'p0');
  assert.equal(o.toCall, 30);
  assert.equal(o.canRaise, false);
  throwsGame(() => g.act('p0', 'raise', 300), /only call or fold/);
  g.act('p0', 'call');
  assert.equal(g.hand.street, 2);
});

test('incomplete all-ins that add up to a full raise do reopen the betting', () => {
  const g = rig({ stacks: [1000, 1000, 170, 240, 1000], button: 4 });
  // p0 SB, p1 BB, p2 first. Everyone limps to the flop.
  g.act('p2', 'call');
  g.act('p3', 'call');
  g.act('p4', 'call');
  g.act('p0', 'call');
  g.act('p1', 'check');
  g.act('p0', 'raise', 100);
  g.act('p1', 'fold');
  g.act('p2', 'raise', 150); // all in: 50 more
  g.act('p3', 'raise', 220); // all in: 120 over p0's bet, a full raise for p0 in total
  g.act('p4', 'call');
  assert.equal(g.hand.toAct, 'p0');
  assert.equal(g.options(seat(g, 'p0')).canRaise, true);
  assert.equal(g.options(seat(g, 'p0')).minTo, 320);
});

test("an uncalled bet goes back; the cards are turned up and the board runs out", () => {
  const g = rig({
    stacks: [1000, 300],
    button: 0,
    hole: [['AS', 'AH'], ['KS', 'KH']],
    board: ['2C', '7D', '9H', 'JC', '3S'],
  });
  g.act('p0', 'raise', 1000);
  g.act('p1', 'call');
  assert.equal(ev(g, 'return')[0].n, 700);
  assert.equal(ev(g, 'return')[0].pid, 'p0');
  assert.equal(g.hand.runout, true);
  assert.equal(g.hand.pot, 600);
  assert.deepEqual([...g.hand.shown].sort(), ['p0', 'p1']);
  throwsGame(() => g.act('p1', 'check'), /no betting/);
  g.runoutStep();
  assert.equal(g.hand.board.length, 3);
  g.runoutStep();
  g.runoutStep();
  assert.equal(g.hand.board.length, 5);
  assert.equal(g.phase, 'hand');
  g.runoutStep();
  assert.equal(g.phase, 'handOver');
  assert.deepEqual(stacks(g), [1300, 0]);
  assert.equal(g.hand.results.pots[0].hand, 'Pair of Aces');
  assert.equal(g.players[1].busted, true);
  assert.ok(chipsOk(g));
});

test('side pots: each player can only win what they covered', () => {
  // p1 SB, p2 BB, p3 first to act.
  const g = rig({
    stacks: [1000, 100, 300, 1000],
    button: 0,
    hole: [['QS', 'QH'], ['AS', 'AH'], ['KS', 'KH'], ['2C', '7D']],
    board: ['3C', '8D', '9H', 'JC', '4S'],
  });
  g.act('p3', 'call');
  g.act('p0', 'raise', 1000);
  g.act('p1', 'call'); // all in for 100
  g.act('p2', 'call'); // all in for 300
  g.act('p3', 'fold');
  // p0 put in 1000 but only 300 is covered.
  assert.equal(ev(g, 'return')[0].n, 700);
  const pots = g.pots().map((p) => [p.amount, p.seats.map((s) => s.pid)]);
  // Main pot: 100 from each of the three all-ins plus p3's 20. Side pot: 200 each from p2 and p0.
  assert.deepEqual(pots, [
    [320, ['p1', 'p2', 'p0']],
    [400, ['p2', 'p0']],
  ]);
  while (g.phase === 'hand') g.runoutStep();
  // Aces win the main pot, kings the side pot, queens get back only the uncalled 700.
  assert.deepEqual(stacks(g), [700, 320, 400, 980]);
  const [main, side] = g.hand.results.pots;
  assert.deepEqual(main.winners, [{ pid: 'p1', n: 320 }]);
  assert.equal(main.label, 'main');
  assert.deepEqual(side.winners, [{ pid: 'p2', n: 400 }]);
  assert.equal(side.label, 'side');
  assert.ok(chipsOk(g));
});

test('a split pot: the odd chip goes to the first winner left of the button', () => {
  const g = rig({
    stacks: [1000, 1000, 1000],
    button: 0,
    hole: [['2C', '3D'], ['AS', 'KD'], ['AH', 'KC']],
    board: ['QS', 'JH', '10C', '5D', '4S'],
  });
  g.act('p0', 'raise', 45);
  g.act('p1', 'call');
  g.act('p2', 'call');
  // flop, turn, river: check it down
  for (let i = 0; i < 3; i++) for (const pid of ['p1', 'p2', 'p0']) g.act(pid, 'check');
  assert.equal(g.phase, 'handOver');
  const pot = g.hand.results.pots[0];
  assert.equal(pot.amount, 135);
  assert.deepEqual(pot.winners, [{ pid: 'p1', n: 68 }, { pid: 'p2', n: 67 }]);
  assert.equal(pot.hand, 'Straight, Ace high');
  assert.deepEqual(stacks(g), [955, 1023, 1022]);
});

test('everyone folds: the last player wins without showing, and blinds come back right', () => {
  const g = rig({ stacks: [1000, 1000, 1000], button: 0 });
  g.act('p0', 'fold');
  g.act('p1', 'fold');
  assert.equal(g.phase, 'handOver');
  assert.deepEqual(stacks(g), [1000, 990, 1010]);
  assert.equal(g.hand.results.showdown, false);
  assert.equal(g.hand.shown.size, 0);
  const v = g.viewFor('p0');
  assert.deepEqual(v.players[2].cards, [null, null], "the winner's cards stay hidden");
  g.show('p2');
  assert.equal(g.viewFor('p0').players[2].cards.length, 2);
  assert.ok(g.viewFor('p0').players[2].cards[0].r);
});

test('a short big blind: callers still owe the full blind and the excess comes back', () => {
  const g = rig({ stacks: [1000, 1000, 15], button: 0, hole: [[], [], ['AS', 'AH']] });
  assert.equal(seat(g, 'p2').allIn, true);
  assert.equal(g.hand.currentBet, 20);
  assert.equal(g.options(seat(g, 'p0')).toCall, 20);
  g.act('p0', 'fold');
  g.act('p1', 'call');
  // p1's 20 is matched only up to 15.
  assert.equal(ev(g, 'return')[0].n, 5);
  assert.equal(g.hand.runout, true);
  while (g.phase === 'hand') g.runoutStep();
  assert.ok(chipsOk(g));
  assert.equal(g.players.reduce((a, p) => a + p.stack, 0), 2015);
});

test('timeouts check when they can and fold when they must', () => {
  const g = rig({ stacks: [1000, 1000, 1000], button: 0 });
  g.autoPlay('p0');
  assert.equal(seat(g, 'p0').folded, true);
  assert.equal(ev(g, 'timeout').length, 1);
  g.act('p1', 'call');
  g.autoPlay('p2');
  assert.equal(seat(g, 'p2').folded, false, 'the big blind checks');
  assert.equal(g.hand.street, 1);
  g.autoPlay('p0'); // not their turn: nothing happens
  assert.equal(ev(g, 'timeout').length, 2);
});

test('the button moves, skipping players who sit out; sitting out works from the next hand', () => {
  const g = rig({ stacks: [1000, 1000, 1000, 1000], button: 0 });
  g.sitOut('p1');
  assert.equal(g.hand.seats.has('p1'), true, 'p1 plays out this hand');
  g.act('p3', 'fold');
  g.act('p0', 'fold');
  g.act('p1', 'fold');
  g.nextHand();
  assert.equal(g.hand.seats.has('p1'), false);
  assert.equal(g.hand.button, 'p2', 'the button skips p1');
  assert.equal(g.hand.sbPid, 'p3');
  assert.equal(g.hand.bbPid, 'p0');
  g.sitIn('p1');
  g.act('p2', 'fold');
  g.act('p3', 'fold');
  g.nextHand();
  assert.equal(g.hand.button, 'p3');
  assert.ok(g.hand.seats.has('p1'));
});

test('waiting for players, rebuys in cash games and none in tournaments', () => {
  const g = rig({ stacks: [500, 500], button: 0, hole: [['AS', 'AH'], ['7C', '2D']], board: ['AC', 'KD', '9H', '4C', '3S'] });
  g.act('p0', 'raise', 500);
  g.act('p1', 'call');
  while (g.phase === 'hand') g.runoutStep();
  assert.deepEqual(stacks(g), [1000, 0]);
  throwsGame(() => g.rebuy('p0'), /run out of chips/);
  g.nextHand();
  assert.equal(g.phase, 'waiting');
  assert.equal(g.canDeal(), false);
  g.rebuy('p1');
  assert.equal(g.players[1].stack, 1000, 'a rebuy is the starting stack');
  assert.equal(g.players[1].buyins, 2);
  assert.equal(g.canDeal(), true);
  g.nextHand();
  assert.equal(g.phase, 'hand');
  assert.ok(chipsOk(g));

  const t = new Game(players(2), { mode: 'tourney' }, { rng: seededRng(3) });
  throwsGame(() => t.rebuy('p0'), /no rebuys/);
});

test('tournaments: places, two busts in one hand, and the winner', () => {
  const g = rig({
    stacks: [1000, 200, 300],
    button: 0,
    rules: { mode: 'tourney' },
    hole: [['AS', 'AH'], ['7C', '2D'], ['8C', '3D']],
    board: ['AC', 'KD', '9H', '4C', '5S'],
  });
  g.act('p0', 'raise', 1000);
  g.act('p1', 'call');
  g.act('p2', 'call');
  while (g.phase === 'hand') g.runoutStep();
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, ['p0']);
  assert.equal(g.players[0].place, 1);
  assert.equal(g.players[2].place, 2, 'p2 started the hand with more chips than p1');
  assert.equal(g.players[1].place, 3);
  throwsGame(() => g.nextHand());
});

test('new players sit down between hands; leaving mid-hand folds you', () => {
  const g = rig({ stacks: [1000, 1000, 1000], button: 0 });
  g.addPlayer({ id: 'p9', name: 'Late' });
  assert.equal(g.hand.seats.has('p9'), false);
  // p0 to act leaves: the action moves on.
  g.removePlayer('p0');
  assert.equal(g.hand.toAct, 'p1');
  assert.equal(g.gone[0].name, 'P0');
  g.act('p1', 'call');
  g.act('p2', 'check');
  assert.equal(g.hand.street, 1);
  // p2 leaves while p1 is to act: only p1 is left, and wins.
  g.removePlayer('p2');
  assert.equal(g.phase, 'handOver');
  assert.equal(g.players.find((p) => p.id === 'p1').stack, 1020);
  g.nextHand();
  assert.ok(g.hand.seats.has('p9'));
  assert.ok(chipsOk(g));
});

test('ending the game mid-hand gives everyone their bets back', () => {
  const g = rig({ stacks: [1000, 1000, 1000], button: 0 });
  g.act('p0', 'raise', 200);
  g.finishGame('host');
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(stacks(g), [1000, 1000, 1000]);
  assert.equal(g.hand.voided, true);
  assert.deepEqual(g.winners.sort(), ['p0', 'p1', 'p2']);
  assert.ok(chipsOk(g));
});

test('views: your own cards only, options only on your turn, nothing internal', () => {
  const g = rig({ stacks: [1000, 1000, 1000], button: 0, hole: [['AS', 'KS'], ['2C', '2D'], ['9H', '8H']] });
  const v0 = g.viewFor('p0');
  assert.deepEqual(v0.players[0].cards, [{ r: 'A', s: 'S' }, { r: 'K', s: 'S' }]);
  assert.deepEqual(v0.players[1].cards, [null, null]);
  assert.equal(v0.players[0].best.name, 'Ace high');
  assert.equal(v0.players[1].best, null);
  assert.ok(v0.hand.options);
  assert.equal(g.viewFor('p1').hand.options, null);
  const watcher = g.viewFor('someone');
  assert.ok(watcher.players.every((p) => p.cards.every((c) => c === null)));
  const json = JSON.stringify(v0);
  assert.ok(!/"id":\d/.test(json), 'internal card ids never reach clients');
  assert.ok(!json.includes('"code"') && !json.includes('"deck"'));
  g.act('p0', 'fold');
  assert.equal(g.viewFor('p0').players[0].cards.length, 2, 'you still see your own folded cards');
  assert.equal(g.viewFor('p1').players[0].cards, null, 'others see nothing of a folded hand');
});

test('the blind level goes up from the next hand', () => {
  const g = new Game(players(3), { mode: 'tourney', blinds: 1 }, { rng: seededRng(5) });
  assert.deepEqual(g.hand.blinds ?? [g.hand.sb, g.hand.bb], [10, 20]);
  g.raiseLevel();
  assert.deepEqual([g.hand.sb, g.hand.bb], [10, 20]);
  g.finishGame('host');
  const h = new Game(players(3), { mode: 'cash', blinds: 1 }, { rng: seededRng(5) });
  h.raiseLevel();
  while (h.phase === 'hand') h.autoPlay(h.hand.toAct);
  h.nextHand();
  assert.deepEqual([h.hand.sb, h.hand.bb], [15, 30]);
});
