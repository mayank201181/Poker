import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TeenPatti, BOOTS } from '../server/teenpatti.js';
import { GameError } from '../server/table.js';
import { tpScore, tpName, tpShort, tpPercentile, TP_CATEGORIES } from '../server/teenhand.js';
import { makeDeck } from '../server/cards.js';
import { seededRng } from '../server/util.js';
import { rigTP, seat, stacks, ev, chipsOk } from './helpers.js';

const DECK = makeDeck();
const C = (code) => DECK.find((c) => c.r + c.s === code);
const S = (...codes) => tpScore(codes.map(C));
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const throwsGame = (fn, re) => assert.throws(fn, (e) => e instanceof GameError && (!re || re.test(e.message)));

test('every three-card hand: textbook counts and 741 distinct ranks', () => {
  const counts = new Array(6).fill(0);
  const distinct = new Set();
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let c = b + 1; c < 52; c++) {
        const s = tpScore([DECK[a], DECK[b], DECK[c]]);
        counts[s >> 12]++;
        distinct.add(s);
      }
  // High card, pair, color, sequence, pure sequence, trail
  assert.deepEqual(counts, [16440, 3744, 1096, 720, 48, 52]);
  assert.equal(distinct.size, 741);
  assert.equal(TP_CATEGORIES.length, 6);
});

test('Teen Patti hand order, names and runs', () => {
  const ladder = [
    S('AC', 'QD', '9S'), // high card
    S('2C', '2D', '5S'), // pair
    S('2S', '7S', '9S'), // color
    S('4C', '5D', '6S'), // sequence
    S('2H', '3H', '4H'), // pure sequence
    S('2C', '2D', '2S'), // trail
  ];
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] > ladder[i - 1], `${TP_CATEGORIES[i]} beats ${TP_CATEGORIES[i - 1]}`);
  // A sequence beats a color (the opposite of poker), and A-K-Q > A-2-3 > K-Q-J > … > 4-3-2.
  assert.ok(S('4C', '5D', '6S') > S('AS', 'KS', 'JS'));
  assert.ok(S('AS', 'KD', 'QC') > S('AH', '2D', '3C'));
  assert.ok(S('AH', '2D', '3C') > S('KS', 'QD', 'JC'));
  assert.ok(S('5S', '4D', '3C') > S('4H', '3D', '2C'));
  assert.ok(S('QH', 'KH', 'AH') > S('AS', '2S', '3S'));
  assert.equal(tpName(S('AS', 'AH', 'AD')), 'Trail of Aces');
  assert.equal(tpName(S('QH', 'KH', 'AH')), 'Pure Sequence, A-K-Q');
  assert.equal(tpName(S('3S', 'AS', '2S')), 'Pure Sequence, A-2-3');
  assert.equal(tpName(S('10C', 'JD', 'QH')), 'Sequence, Q-J-10');
  assert.equal(tpName(S('2S', '8S', 'JS')), 'Color, Jack high');
  assert.equal(tpName(S('KD', 'KC', '7H')), 'Pair of Kings');
  assert.equal(tpName(S('AC', '9D', '4H')), 'Ace high');
  assert.equal(tpShort(S('3S', 'AS', '2S')), 'Pure Sequence');
  // Pairs: the pair first, then the odd card; colors and high cards card by card.
  assert.ok(S('KD', 'KC', '2H') > S('QD', 'QC', 'AH'));
  assert.ok(S('KD', 'KC', '8H') > S('KS', 'KH', '7H'));
  assert.ok(S('AS', '9S', '3S') > S('AH', '8H', '7H'));
  assert.ok(S('AS', '9D', '4C') > S('AH', '9C', '3D'));
  assert.equal(S('AS', '9D', '4C'), S('AH', '9C', '4D'), 'suits never break a tie');
  // Percentiles rise with the hand.
  assert.ok(tpPercentile(S('2S', '3H', '5D')) < 0.01);
  assert.ok(tpPercentile(S('AS', 'AH', 'AD')) > 0.999);
  assert.ok(tpPercentile(S('KD', 'KC', '7H')) > tpPercentile(S('AC', '9D', '4H')));
});

test('the boot, the deal and who goes first', () => {
  const g = rigTP({ stacks: [1000, 1000, 1000, 1000], button: 0 });
  const h = g.hand;
  assert.equal(g.kind, 'teenpatti');
  assert.equal(h.boot, 10);
  assert.equal(h.stake, 10);
  assert.equal(h.pot, 40);
  assert.deepEqual(stacks(g), [990, 990, 990, 990]);
  assert.equal(h.toAct, 'p1', 'left of the dealer starts');
  for (const s of h.seats.values()) {
    assert.equal(s.hole.length, 3);
    assert.equal(s.seen, false);
  }
  assert.ok(chipsOk(g));
});

test('blind pays the stake, seen pays double, and 2x doubles the stake', () => {
  const g = rigTP({ stacks: [1000, 1000, 1000, 1000], button: 0 });
  throwsGame(() => g.act('p2', 'bet'), /not your turn/);
  throwsGame(() => g.act('p1', 'askShow'), /only two players/);
  throwsGame(() => g.act('p1', 'shove'), /Unknown/);
  g.act('p1', 'bet'); // blind 10
  g.see('p2');
  assert.equal(g.options(seat(g, 'p2')).bet, 20);
  g.act('p2', 'bet'); // chaal 20
  g.act('p3', 'raise'); // blind 2x: 20, the stake is now 20
  assert.equal(g.hand.stake, 20);
  g.see('p0');
  g.act('p0', 'raise'); // seen 2x: 80, the stake is now 40
  assert.equal(g.hand.stake, 40);
  g.act('p1', 'bet'); // blind 40
  g.act('p2', 'bet'); // chaal 80
  assert.deepEqual(stacks(g), [990 - 80, 990 - 10 - 40, 990 - 20 - 80, 990 - 20]);
  assert.equal(g.hand.pot, 40 + 10 + 20 + 20 + 80 + 40 + 80);
  const acts = ev(g, 'act').map((e) => [e.a, e.n, e.raise]);
  assert.deepEqual(acts, [
    ['blind', 10, false],
    ['chaal', 20, false],
    ['blind', 20, true],
    ['chaal', 80, true],
    ['blind', 40, false],
    ['chaal', 80, false],
  ]);
  assert.ok(chipsOk(g));
});

test('everyone else packs: the last player wins the pot', () => {
  const g = rigTP({ stacks: [1000, 1000, 1000], button: 0 });
  g.act('p1', 'bet');
  g.act('p2', 'pack');
  g.act('p0', 'pack');
  assert.equal(g.phase, 'handOver');
  assert.deepEqual(stacks(g), [990, 1020, 990]);
  assert.equal(g.hand.results.showdown, false);
  assert.equal(g.hand.shown.size, 0);
});

test('a show between the last two: better hand wins, a tie goes against whoever asked', () => {
  let g = rigTP({ stacks: [1000, 1000], button: 0, hole: [['AS', 'AH', 'AD'], ['KS', 'QS', 'JS']] });
  assert.equal(g.hand.toAct, 'p1');
  assert.equal(g.options(seat(g, 'p1')).canShow, true);
  g.act('p1', 'askShow'); // blind: the show costs the stake (10)
  assert.equal(g.phase, 'handOver');
  assert.deepEqual(stacks(g), [1020, 980]);
  assert.equal(g.hand.results.pots[0].hand, 'Trail of Aces');
  assert.deepEqual([...g.hand.shown].sort(), ['p0', 'p1']);

  g = rigTP({ stacks: [1000, 1000], button: 0, hole: [['AS', 'KD', '9C'], ['AH', 'KC', '9D']] });
  g.see('p1');
  g.act('p1', 'askShow'); // seen: costs 20; an exact tie, so p1 (who asked) loses
  assert.deepEqual(stacks(g), [1030, 970]);
  assert.deepEqual(g.hand.results.pots[0].winners, [{ pid: 'p0', n: 40 }]);
});

test('sideshow: compare privately with the seen player before you; the lower hand packs', () => {
  // p1, p2, p0 in turn. p2's pair beats p1's high card.
  const g = rigTP({ stacks: [1000, 1000, 1000], button: 0, hole: [['2C', '3D', '7S'], ['AS', 'JD', '9C'], ['KS', 'KH', '4D']] });
  throwsGame(() => g.act('p1', 'sideshow'), /See your cards first/);
  g.see('p1');
  g.act('p1', 'bet');
  g.see('p2');
  assert.equal(g.options(seat(g, 'p2')).canSideshow, true);
  assert.equal(g.options(seat(g, 'p2')).sideshowWith, 'p1');
  g.act('p2', 'sideshow'); // pays a chaal (20)
  assert.equal(g.hand.toAct, 'p1', 'p1 decides');
  assert.deepEqual(g.hand.sideshow, { from: 'p2', to: 'p1' });
  assert.ok(g.viewFor('p1').hand.options.reply);
  throwsGame(() => g.act('p1', 'bet'), /Answer the sideshow/);
  g.act('p1', 'reply', true);
  assert.equal(seat(g, 'p1').folded, true, 'the lower hand packs');
  assert.equal(g.hand.toAct, 'p0', 'play carries on after the player who asked');
  // The two saw each other's cards; nobody else did.
  assert.ok(g.viewFor('p1').players.find((p) => p.id === 'p2').cards[0]);
  assert.ok(g.viewFor('p2').players.find((p) => p.id === 'p1').cards[0]);
  assert.equal(g.viewFor('p0').players.find((p) => p.id === 'p2').cards[0], null);
  assert.equal(ev(g, 'sideshow')[0].loser, 'p1');
  assert.ok(chipsOk(g));
});

test('sideshow: a refusal, a tie, and when you cannot ask', () => {
  let g = rigTP({ stacks: [1000, 1000, 1000], button: 0, hole: [['2C', '3D', '7S'], ['AS', 'KD', '9C'], ['AH', 'KC', '9D']] });
  g.see('p1');
  g.act('p1', 'bet');
  g.see('p2');
  g.act('p2', 'sideshow');
  g.act('p1', 'reply', false);
  assert.equal(g.hand.toAct, 'p0');
  assert.ok(!seat(g, 'p1').folded && !seat(g, 'p2').folded);
  assert.equal(ev(g, 'sideshow')[0].accepted, false);

  // A tie: the one who asked packs.
  g = rigTP({ stacks: [1000, 1000, 1000], button: 0, hole: [['2C', '3D', '7S'], ['AS', 'KD', '9C'], ['AH', 'KC', '9D']] });
  g.see('p1');
  g.act('p1', 'bet');
  g.see('p2');
  g.act('p2', 'sideshow');
  g.act('p1', 'reply', true);
  assert.equal(seat(g, 'p2').folded, true);
  assert.equal(seat(g, 'p1').folded, false);

  // The player before you is blind: no sideshow. Two players left: a show instead.
  g = rigTP({ stacks: [1000, 1000, 1000], button: 0 });
  g.act('p1', 'bet');
  g.see('p2');
  assert.equal(g.options(seat(g, 'p2')).canSideshow, false);
  throwsGame(() => g.act('p2', 'sideshow'), /before you/);
  g.act('p2', 'bet');
  g.act('p0', 'pack');
  g.see('p1');
  throwsGame(() => g.act('p1', 'sideshow'), /show instead/);
});

test('the pot limit: once the pot reaches it, everyone left shows', () => {
  const g = rigTP({
    stacks: [1000, 1000, 1000],
    button: 0,
    rules: { potLimit: 5 },
    hole: [['2C', '3D', '7S'], ['AS', 'AH', 'AD'], ['KS', 'KH', '4D']],
  });
  assert.equal(g.hand.limit, 50);
  g.act('p1', 'bet'); // 40
  g.act('p2', 'bet'); // 50: the limit
  assert.equal(g.phase, 'handOver');
  assert.equal(ev(g, 'limit').length, 1);
  assert.deepEqual([...g.hand.shown].sort(), ['p0', 'p1', 'p2']);
  assert.deepEqual(stacks(g), [990, 1030, 980]);
});

test('short of chips: all in wins the pot as it stood, later bets are a side pot', () => {
  // p1, p2, p0 in turn. p1 has 25: after the boot, 15 left.
  const g = rigTP({ stacks: [1000, 25, 1000], button: 0, hole: [['QS', 'QH', '3C'], ['AS', 'AH', 'AD'], ['KS', 'KH', '2C']] });
  g.see('p1');
  assert.equal(g.options(seat(g, 'p1')).betAllIn, true);
  g.act('p1', 'bet'); // a chaal would be 20: all in for 15
  assert.equal(seat(g, 'p1').allIn, true);
  g.see('p2');
  g.act('p2', 'bet'); // 20, into the side pot
  g.see('p0');
  g.act('p0', 'bet'); // 20, into the side pot
  assert.deepEqual(g.viewFor('p0').hand.pots, [45, 40]);
  assert.equal(g.hand.toAct, 'p2');
  g.act('p2', 'pack'); // p1 is all in, so p0 is alone: cards up
  assert.equal(g.phase, 'handOver');
  // The trail wins the main pot (45); the side pot (40) goes back to p0, the only one in it.
  assert.deepEqual(stacks(g), [1010, 45, 970]);
  const [main, side] = g.hand.results.pots;
  assert.deepEqual([main.amount, main.winners[0].pid, main.hand], [45, 'p1', 'Trail of Aces']);
  assert.deepEqual([side.amount, side.winners[0].pid], [40, 'p0']);
  assert.ok(chipsOk(g));
});

test('all in on the boot: the hand goes on and the short player shows down', () => {
  const g = rigTP({ stacks: [1000, 5, 1000], button: 0, hole: [['2C', '3D', '7S'], ['AS', 'AH', 'AD'], ['KS', 'KH', '4D']] });
  assert.equal(seat(g, 'p1').allIn, true);
  assert.equal(g.hand.toAct, 'p2', 'the all-in player is skipped');
  g.act('p2', 'bet');
  g.act('p0', 'pack'); // p1 all in and p2 alone: cards up
  assert.equal(g.phase, 'handOver');
  // p1 can win 5 + 10 + 10 (the boots); p2's later bet is theirs again.
  assert.deepEqual(stacks(g), [990, 25, 990]);
  assert.ok(chipsOk(g));
});

test('timeouts pack, or refuse a sideshow; leaving mid-hand packs you', () => {
  let g = rigTP({ stacks: [1000, 1000, 1000], button: 0 });
  g.autoPlay('p1');
  assert.equal(seat(g, 'p1').folded, true);
  assert.equal(ev(g, 'timeout').length, 1);

  g = rigTP({ stacks: [1000, 1000, 1000], button: 0 });
  g.see('p1');
  g.act('p1', 'bet');
  g.see('p2');
  g.act('p2', 'sideshow');
  g.autoPlay('p1');
  assert.equal(seat(g, 'p1').folded, false);
  assert.equal(g.hand.toAct, 'p0');

  g = rigTP({ stacks: [1000, 1000, 1000], button: 0 });
  g.removePlayer('p1'); // their turn
  assert.equal(g.hand.toAct, 'p2');
  g.removePlayer('p0'); // p2 is the last one in: they win, and alone at the table the game is over
  assert.equal(g.players.find((p) => p.id === 'p2').stack, 1020);
  assert.equal(g.phase, 'gameOver');
  assert.ok(chipsOk(g));
});

test('views: blind players do not see their own cards; nothing leaks', () => {
  const g = rigTP({ stacks: [1000, 1000, 1000], button: 0, hole: [['2C', '3D', '7S'], ['AS', 'AH', 'AD'], ['KS', 'KH', '4D']] });
  const blind = g.viewFor('p1');
  assert.deepEqual(blind.players.find((p) => p.id === 'p1').cards, [null, null, null]);
  assert.equal(blind.players.find((p) => p.id === 'p1').best, null);
  assert.ok(blind.hand.options);
  assert.equal(g.viewFor('p2').hand.options, null);
  g.see('p1');
  const seen = g.viewFor('p1').players.find((p) => p.id === 'p1');
  assert.deepEqual(seen.cards, [{ r: 'A', s: 'S' }, { r: 'A', s: 'H' }, { r: 'A', s: 'D' }]);
  assert.equal(seen.best.name, 'Trail of Aces');
  assert.equal(g.viewFor('p2').players.find((p) => p.id === 'p1').seen, true, 'everyone knows who has seen');
  assert.deepEqual(g.viewFor('p2').players.find((p) => p.id === 'p1').cards, [null, null, null]);
  const json = JSON.stringify(g.viewFor('watcher'));
  assert.ok(!/"id":\d/.test(json) && !json.includes('"code"') && !json.includes('"deck"'));
  g.act('p1', 'bet');
  g.act('p2', 'pack'); // packed blind
  g.act('p0', 'pack');
  // After the hand you may look at your own cards, even the ones you packed blind.
  assert.ok(g.viewFor('p2').players.find((p) => p.id === 'p2').cards[0]);
  assert.equal(g.viewFor('p0').players.find((p) => p.id === 'p2').cards, null);
});

test('tournaments: the boot goes up, places, and ending mid-hand refunds', () => {
  const t = new TeenPatti(players(3), { mode: 'tourney', boot: 1 }, { rng: seededRng(3) });
  assert.equal(t.hand.boot, 10);
  t.raiseLevel();
  assert.deepEqual(ev(t, 'level').at(-1), { t: 'level', boot: BOOTS[2] });
  throwsGame(() => t.rebuy('p0'), /no rebuys/);

  const g = rigTP({
    stacks: [1000, 30, 40],
    button: 0,
    rules: { mode: 'tourney' },
    hole: [['AS', 'AH', 'AD'], ['2C', '3D', '7S'], ['KS', 'KH', '4D']],
  });
  g.see('p1');
  g.act('p1', 'bet'); // a chaal of 20: all in
  g.see('p2');
  g.act('p2', 'raise'); // 2x would be 40: all in for 30
  assert.equal(g.hand.stake, 10, 'an all-in short of 2x does not double the stake');
  // p0 alone with chips: cards up, the trail takes everything.
  assert.equal(g.phase, 'gameOver');
  assert.deepEqual(g.winners, ['p0']);
  assert.equal(g.players[2].place, 2, 'p2 started the hand with more chips');
  assert.equal(g.players[1].place, 3);

  const v = rigTP({ stacks: [1000, 1000, 1000], button: 0 });
  v.act('p1', 'raise');
  v.finishGame('host');
  assert.deepEqual(stacks(v), [1000, 1000, 1000]);
  assert.ok(chipsOk(v));
});
