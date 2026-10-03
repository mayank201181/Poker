// One standard 52-card pack.
// Suits in Hindi: Hukum ♠ (S), Paan ♥ (H), Chidi ♣ (C), Eent ♦ (D).

export const SUITS = ['S', 'H', 'C', 'D'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// v: 2–14 (Ace high). code: a small integer the hand evaluator works on.
export function makeDeck() {
  const deck = [];
  let id = 0;
  for (const s of SUITS) {
    RANKS.forEach((r, i) => {
      const v = i + 2;
      deck.push({ id: id++, r, s, v, code: (v - 2) * 4 + SUITS.indexOf(s) });
    });
  }
  return deck;
}

// What clients get to see of a card: never the internal id.
export const face = (c) => ({ r: c.r, s: c.s });
