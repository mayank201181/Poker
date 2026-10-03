import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, decode, handName, handShort, bestFive, CATEGORIES } from '../server/hand.js';
import { makeDeck } from '../server/cards.js';
import { seededRng, shuffle } from '../server/util.js';

const DECK = makeDeck();
const C = (code) => DECK.find((c) => c.r + c.s === code);
const S = (...codes) => score(codes.map((x) => C(x).code));
const name = (...codes) => handName(S(...codes));

test('every five-card hand: textbook counts and 7,462 distinct ranks', () => {
  const counts = new Array(9).fill(0);
  const distinct = new Set();
  const c = [0, 0, 0, 0, 0];
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let d = b + 1; d < 52; d++)
        for (let e = d + 1; e < 52; e++)
          for (let f = e + 1; f < 52; f++) {
            c[0] = a;
            c[1] = b;
            c[2] = d;
            c[3] = e;
            c[4] = f;
            const s = score(c);
            counts[decode(s).cat]++;
            distinct.add(s);
          }
  assert.deepEqual(counts, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
  assert.equal(distinct.size, 7462);
});

test('seven cards score the same as their best five', () => {
  const rng = seededRng(11);
  for (let i = 0; i < 3000; i++) {
    const seven = shuffle(DECK, rng).slice(0, 7);
    const direct = score(seven.map((c) => c.code));
    let best = 0;
    for (let x = 0; x < 7; x++)
      for (let y = x + 1; y < 7; y++) {
        const five = seven.filter((_, k) => k !== x && k !== y);
        best = Math.max(best, score(five.map((c) => c.code)));
      }
    assert.equal(direct, best);
    const b = bestFive(seven);
    assert.equal(b.cards.length, 5);
    assert.equal(score(b.cards.map((c) => c.code)), direct);
  }
});

test('names and the order of hands', () => {
  assert.equal(name('AS', 'KS', 'QS', 'JS', '10S', '2H', '3D'), 'Royal Flush');
  assert.equal(name('9H', '8H', '7H', '6H', '5H', 'AH', 'KD'), 'Straight Flush, Nine high');
  assert.equal(name('5D', '4D', '3D', '2D', 'AD', 'KC', 'KH'), 'Straight Flush, Five high');
  assert.equal(name('7S', '7H', '7C', '7D', 'KS', 'KH', 'KC'), 'Four of a Kind, Sevens');
  assert.equal(name('KS', 'KH', 'KC', '6D', '6S', '6H', '2C'), 'Full House, Kings full of Sixes');
  assert.equal(name('QS', 'QH', '4C', '4D', '4S', 'QC', '9H'), 'Full House, Queens full of Fours');
  assert.equal(name('AC', '10C', '7C', '4C', '2C', 'KH', 'QD'), 'Flush, Ace high');
  assert.equal(name('AC', '2D', '3H', '4S', '5C', 'KH', 'QD'), 'Straight, Five high');
  assert.equal(name('10C', 'JD', 'QH', 'KS', 'AC', '2H', '2D'), 'Straight, Ace high');
  assert.equal(name('8C', '8D', '8H', 'KS', '2C', '4H', '6D'), 'Three of a Kind, Eights');
  assert.equal(name('KS', 'KH', '5C', '5D', '2S', '2H', '9C'), 'Two Pair, Kings and Fives');
  assert.equal(name('6S', '6H', 'AC', '9D', '4S', '3H', '2C'), 'Pair of Sixes');
  assert.equal(name('AS', 'JH', '9C', '7D', '4S', '3H', '2C'), 'Ace high');
  assert.equal(handShort(S('KS', 'KH', '5C', '5D', '2S', '2H', '9C')), 'Two Pair');
  assert.equal(handShort(S('6S', '6H', 'AC', '9D', '4S')), 'Pair of Sixes');
  assert.equal(handShort(S('AS', 'KS', 'QS', 'JS', '10S')), 'Royal Flush');
  assert.equal(CATEGORIES.length, 9);

  const ladder = [
    S('AS', 'JH', '9C', '7D', '4S'),
    S('2S', '2H', '9C', '7D', '4S'),
    S('2S', '2H', '3C', '3D', '4S'),
    S('2S', '2H', '2C', '7D', '4S'),
    S('AS', '2H', '3C', '4D', '5S'),
    S('2S', '3S', '4S', '5S', '7S'),
    S('2S', '2H', '2C', '3D', '3S'),
    S('2S', '2H', '2C', '2D', '3S'),
    S('AS', '2S', '3S', '4S', '5S'),
  ];
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] > ladder[i - 1], `${CATEGORIES[i]} beats ${CATEGORIES[i - 1]}`);
});

test('kickers and ties', () => {
  // Same pair, better kicker.
  assert.ok(S('KS', 'KH', 'AC', '7D', '4S') > S('KC', 'KD', 'QC', '7H', '4H'));
  // Third pair can't beat a higher kicker... but can be the kicker.
  assert.equal(S('KS', 'KH', '5C', '5D', '4S', '4H', '2C'), S('KS', 'KH', '5C', '5D', '4S'));
  assert.ok(S('KS', 'KH', '5C', '5D', 'QS', '2H', '2C') > S('KS', 'KH', '5C', '5D', '4S', '4H', '2C'));
  // The board plays: a tie.
  assert.equal(S('2S', '3H', 'AC', 'KD', 'QS', 'JH', '9C'), S('2C', '3D', 'AC', 'KD', 'QS', 'JH', '9C'));
  // The wheel loses to a six-high straight; a flush beats a straight; quads' kicker counts.
  assert.ok(S('2S', '3H', '4C', '5D', '6S') > S('AS', '2H', '3C', '4D', '5S'));
  assert.ok(S('2S', '3S', '4S', '5S', '9S') > S('10S', 'JH', 'QC', 'KD', 'AS'));
  assert.ok(S('7S', '7H', '7C', '7D', 'KS') > S('7S', '7H', '7C', '7D', 'QS'));
  // Two trips make a full house with the higher trips on top.
  assert.equal(handName(S('9S', '9H', '9C', '4D', '4S', '4H', 'AC')), 'Full House, Nines full of Fours');
  // Six suited cards: the flush uses the top five.
  assert.ok(S('AH', 'KH', '9H', '7H', '4H', '2H', 'QC') > S('AH', 'KH', '9H', '7H', '3H', '2H', 'QC'));
});

test('two cards (before the flop) still get a name', () => {
  assert.equal(name('7S', '7H'), 'Pair of Sevens');
  assert.equal(name('AS', '9H'), 'Ace high');
});
