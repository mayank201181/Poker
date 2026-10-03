// Texas Hold'em rules engine: a pure state machine with no timers and no
// I/O. Every public action validates who is acting and either changes state
// (emitting public events) or throws a GameError whose message is safe to
// show the player. Hole cards only leave through viewFor().
//
// No-limit betting, following the usual cardroom rules:
//   - the button moves one player each hand; heads-up, the button is the small blind
//   - a raise must be at least the size of the last full bet or raise
//   - an all-in that is less than a full raise does not reopen the betting
//     for players who have already acted
//   - an uncalled bet goes back to the player who made it
//   - side pots for all-ins; a split pot's odd chip goes to the first winner
//     to the left of the button

import { makeDeck, face } from './cards.js';
import { bestFive, handName, handShort } from './hand.js';
import { shuffle } from './util.js';

export class GameError extends Error {}

// Blind levels as [small blind, big blind]. Tournaments climb this ladder.
export const BLINDS = [
  [5, 10], [10, 20], [15, 30], [25, 50], [40, 80], [50, 100], [75, 150], [100, 200],
  [150, 300], [200, 400], [300, 600], [400, 800], [500, 1000], [750, 1500], [1000, 2000],
  [1500, 3000], [2000, 4000], [3000, 6000], [4000, 8000], [5000, 10000], [7500, 15000],
  [10000, 20000], [15000, 30000], [20000, 40000], [30000, 60000], [50000, 100000],
];

export const DEFAULT_RULES = Object.freeze({
  mode: 'cash', // 'cash': busted players can rebuy, the host ends the game; 'tourney': no rebuys, last player with chips wins
  stack: 1000,  // starting chips (and what a rebuy gives you)
  blinds: 1,    // starting blind level, an index into BLINDS (10/20)
});

const STREETS = ['preflop', 'flop', 'turn', 'river'];

export class Game {
  // Tests can pass `deck(handNo)` to stack the deck (null = shuffle) and the first `button`.
  constructor(players, rules = {}, { rng = Math.random, emit, deck = null, button = null } = {}) {
    if (players.length < 2) throw new GameError('Need at least 2 players');
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.rng = rng;
    this.sink = emit ?? null;
    this.deckFor = deck;
    this.events = [];
    this.tick = 0;
    this.seatSeq = 0;
    this.chipsIn = 0;  // every chip bought in…
    this.chipsOut = 0; // …and every chip that left with a player (for the tests)
    this.players = [];
    for (const p of players) this.seatPlayer(p);
    this.level = this.rules.blinds;
    this.handNo = 0;
    this.hand = null;
    this.phase = 'waiting';
    this.buttonSeat = null;
    if (button) {
      const at = this.players.findIndex((p) => p.id === button);
      this.buttonSeat = this.players.at(at - 1).seat; // so the first hand's button lands on `button`
    }
    this.gone = [];
    this.winners = null;
    this.endReason = null;
    this.startHand();
  }

  // ---------------------------------------------------------------- helpers

  emit(ev) {
    this.tick += 1;
    if (this.sink) this.sink(ev);
    else this.events.push(ev);
  }

  need(cond, msg) {
    if (!cond) throw new GameError(msg);
  }

  has(pid) {
    return this.players.some((p) => p.id === pid);
  }

  player(pid) {
    const p = this.players.find((x) => x.id === pid);
    this.need(p, 'You are not playing in this game');
    return p;
  }

  seatPlayer({ id, name, stack = this.rules.stack }) {
    const p = { id, name, seat: this.seatSeq++, stack, buyins: 1, out: null, busted: false, place: null };
    this.chipsIn += stack;
    this.players.push(p);
    return p;
  }

  canPlay(p) {
    return p.stack > 0 && !p.out;
  }

  canDeal() {
    return this.phase !== 'gameOver' && this.players.filter((p) => this.canPlay(p)).length >= 2;
  }

  seats() {
    return [...this.hand.seats.values()];
  }

  live() {
    return this.seats().filter((s) => !s.folded);
  }

  // Next seat clockwise from `from` (in this hand) that passes `test`.
  nextPid(from, test) {
    const o = this.hand.order;
    const i = o.indexOf(from);
    for (let k = 1; k <= o.length; k++) {
      const pid = o[(i + k) % o.length];
      if (test(this.hand.seats.get(pid))) return pid;
    }
    return null;
  }

  // Chips on the table right now (for the tests: nothing is ever lost or made up).
  chipsInPlay() {
    if (this.phase !== 'hand') return 0;
    return this.hand.pot + this.seats().reduce((a, s) => a + s.bet, 0);
  }

  // ------------------------------------------------------------------ hands

  startHand() {
    const ready = this.players.filter((p) => this.canPlay(p));
    if (ready.length < 2) {
      if (this.phase !== 'waiting') this.emit({ t: 'waiting' });
      this.phase = 'waiting';
      return;
    }
    const [sb, bb] = BLINDS[this.level];
    this.handNo += 1;
    // The button moves to the next player dealt in (the first hand: someone at random).
    const button =
      this.buttonSeat === null
        ? ready[Math.floor(this.rng() * ready.length)]
        : ready.find((p) => p.seat > this.buttonSeat) ?? ready[0];
    this.buttonSeat = button.seat;
    const bi = ready.indexOf(button);
    const order = [...ready.slice(bi + 1), ...ready.slice(0, bi + 1)]; // left of the button first, button last
    const heads = order.length === 2;
    const sbP = heads ? button : order[0];
    const bbP = heads ? order[0] : order[1];
    const seats = new Map(
      order.map((p) => [
        p.id,
        { p, pid: p.id, hole: [], bet: 0, total: 0, lastBet: 0, won: 0, folded: false, allIn: false, acted: false, action: null, start: p.stack, cache: null },
      ]),
    );
    this.hand = {
      no: this.handNo,
      sb,
      bb,
      button: button.id,
      sbPid: sbP.id,
      bbPid: bbP.id,
      order: order.map((p) => p.id),
      seats,
      deck: this.deckFor?.(this.handNo) ?? shuffle(makeDeck(), this.rng),
      board: [],
      street: 0,
      toAct: null,
      currentBet: 0,
      lastRaise: bb,
      pot: 0,
      shown: new Set(),
      runout: false,
      results: null,
      voided: false,
      actions: 0,
    };
    this.phase = 'hand';
    this.emit({ t: 'hand', no: this.handNo, button: button.id, sb: sbP.id, bb: bbP.id, blinds: [sb, bb] });
    this.post(seats.get(sbP.id), sb, 'sb');
    this.post(seats.get(bbP.id), bb, 'bb');
    // Callers owe the full big blind even if the big blind was short.
    this.hand.currentBet = bb;
    for (let r = 0; r < 2; r++) for (const p of order) seats.get(p.id).hole.push(this.hand.deck.pop());
    this.emit({ t: 'deal', n: order.length });
    this.advance(bbP.id);
  }

  post(s, amount, kind) {
    const x = Math.min(amount, s.p.stack);
    this.put(s, x);
    s.action = { t: kind, n: x };
    this.emit({ t: 'blind', pid: s.pid, kind, n: x, allIn: s.allIn });
  }

  put(s, x) {
    s.p.stack -= x;
    s.bet += x;
    s.total += x;
    s.allIn = s.p.stack === 0;
  }

  needsAction(s) {
    return !s.folded && !s.allIn && (!s.acted || s.bet < this.hand.currentBet);
  }

  // The betting round is over when everyone still able to bet has acted and
  // matched the bet, or when nobody is left to bet against.
  roundOver() {
    const live = this.live();
    const able = live.filter((s) => !s.allIn);
    if (able.length === 0) return true;
    if (able.length === 1) {
      const [s] = able;
      return s.bet >= Math.max(0, ...live.filter((x) => x !== s).map((x) => x.bet));
    }
    return !able.some((s) => this.needsAction(s));
  }

  canRaise(s) {
    const h = this.hand;
    if (s.p.stack <= h.currentBet - s.bet) return false; // can't put in more than a call
    if (!this.live().some((x) => x !== s && !x.allIn)) return false; // everyone else is all-in
    // A player who has acted may only raise again if they now face at least a full raise.
    return !s.acted || h.currentBet - s.lastBet >= h.lastRaise;
  }

  options(s) {
    const h = this.hand;
    const toCall = Math.max(0, h.currentBet - s.bet);
    const canRaise = this.canRaise(s);
    const max = s.bet + s.p.stack;
    return {
      toCall: Math.min(toCall, s.p.stack),
      canCheck: toCall === 0,
      callAllIn: toCall > 0 && toCall >= s.p.stack,
      canRaise,
      minTo: canRaise ? Math.min(max, h.currentBet + h.lastRaise) : null,
      maxTo: canRaise ? max : null,
      kind: h.currentBet === 0 ? 'bet' : 'raise',
      bet: s.bet,
      pot: h.pot + this.seats().reduce((a, x) => a + x.bet, 0),
    };
  }

  // fold | check | call | raise (to = your total bet for this round, so "bet 100" is raise to 100)
  act(pid, type, to) {
    const h = this.hand;
    this.need(this.phase === 'hand' && !h.runout && h.toAct, "There's no betting right now");
    this.need(h.toAct === pid, "It's not your turn");
    const s = h.seats.get(pid);
    const toCall = h.currentBet - s.bet;
    switch (type) {
      case 'fold':
        s.folded = true;
        s.action = { t: 'fold' };
        this.emit({ t: 'act', pid, a: 'fold' });
        break;
      case 'check':
        this.need(toCall <= 0, `You can't check: it's ${toCall} to call`);
        s.action = { t: 'check' };
        this.emit({ t: 'act', pid, a: 'check' });
        break;
      case 'call': {
        this.need(toCall > 0, 'There is nothing to call: check instead');
        const x = Math.min(toCall, s.p.stack);
        this.put(s, x);
        s.action = { t: s.allIn ? 'allin' : 'call', n: s.bet };
        this.emit({ t: 'act', pid, a: 'call', n: x, to: s.bet, allIn: s.allIn });
        break;
      }
      case 'raise': {
        this.need(
          this.canRaise(s),
          s.p.stack <= toCall ? "You don't have enough chips to raise" : 'You can only call or fold now',
        );
        const max = s.bet + s.p.stack;
        const min = Math.min(max, h.currentBet + h.lastRaise);
        this.need(
          Number.isInteger(to) && to >= min && to <= max,
          min === max ? `You can only go all-in (${max})` : `${h.currentBet ? 'Raise to' : 'Bet'} between ${min} and ${max}`,
        );
        const opening = h.currentBet === 0;
        const added = to - s.bet;
        const inc = to - h.currentBet;
        if (inc >= h.lastRaise) h.lastRaise = inc; // a full raise; anything less doesn't change the minimum
        h.currentBet = to;
        this.put(s, added);
        s.action = { t: s.allIn ? 'allin' : opening ? 'bet' : 'raise', n: to };
        this.emit({ t: 'act', pid, a: opening ? 'bet' : 'raise', n: added, to, allIn: s.allIn });
        break;
      }
      default:
        throw new GameError('Unknown action');
    }
    s.acted = true;
    s.lastBet = s.bet;
    h.actions += 1;
    this.advance(pid);
  }

  // A player who runs out of time (or is away) checks if they can, otherwise folds.
  autoPlay(pid) {
    const h = this.hand;
    if (this.phase !== 'hand' || h.runout || h.toAct !== pid) return;
    const s = h.seats.get(pid);
    this.emit({ t: 'timeout', pid });
    this.act(pid, s.bet >= h.currentBet ? 'check' : 'fold');
  }

  advance(from) {
    const h = this.hand;
    const live = this.live();
    if (live.length === 1) return this.winUncontested(live[0]);
    if (this.roundOver()) return this.closeRound();
    h.toAct = this.nextPid(from, (s) => this.needsAction(s));
    this.emit({ t: 'turn', pid: h.toAct });
  }

  // The bet nobody matched goes back to whoever made it (unless they left
  // the table after betting: then it stays in the pot).
  returnUncalled() {
    let top = null;
    let second = 0;
    for (const s of this.seats()) {
      if (!top || s.bet > top.bet) {
        if (top) second = Math.max(second, top.bet);
        top = s;
      } else second = Math.max(second, s.bet);
    }
    if (!top || top.bet <= second || top.folded) return;
    const x = top.bet - second;
    top.bet -= x;
    top.total -= x;
    top.p.stack += x;
    top.allIn = top.p.stack === 0;
    if (top.action?.t === 'allin' && !top.allIn) top.action = { ...top.action, t: 'raise', n: top.bet };
    this.emit({ t: 'return', pid: top.pid, n: x });
  }

  closeRound() {
    const h = this.hand;
    this.returnUncalled();
    for (const s of this.seats()) {
      h.pot += s.bet;
      s.bet = 0;
      s.lastBet = 0;
      s.acted = false;
    }
    h.currentBet = 0;
    h.lastRaise = h.bb;
    h.toAct = null;
    const live = this.live();
    if (h.street === 3) return this.showdown();
    if (live.filter((s) => !s.allIn).length <= 1) {
      // Nobody can bet any more: cards up, then the rest of the board comes out one street at a time.
      h.runout = true;
      this.emit({ t: 'allin' });
      this.reveal(live);
      return;
    }
    this.dealStreet();
    this.advance(h.button);
  }

  dealStreet() {
    const h = this.hand;
    h.street += 1;
    h.deck.pop(); // burn a card
    const cards = [];
    for (let i = 0; i < (h.street === 1 ? 3 : 1); i++) cards.push(h.deck.pop());
    h.board.push(...cards);
    for (const s of this.seats()) if (!s.folded && !s.allIn) s.action = null;
    this.emit({ t: 'street', street: STREETS[h.street], cards: cards.map(face) });
  }

  // While everyone is all-in, the room deals one street per call, then the showdown.
  runoutStep() {
    const h = this.hand;
    this.need(this.phase === 'hand' && h.runout, 'There is nothing to deal');
    if (h.board.length < 5) this.dealStreet();
    else this.showdown();
  }

  reveal(seats) {
    const hands = [];
    for (const s of seats) {
      if (this.hand.shown.has(s.pid)) continue;
      this.hand.shown.add(s.pid);
      hands.push({ pid: s.pid, cards: s.hole.map(face) });
    }
    if (hands.length) this.emit({ t: 'reveal', hands });
  }

  // Main pot first, then side pots. Each pot: its chips and the players who can win it.
  pots(amount = (s) => s.total) {
    const seats = this.seats();
    const levels = [...new Set(seats.map(amount).filter((x) => x > 0))].sort((a, b) => a - b);
    const out = [];
    let prev = 0;
    let carry = 0;
    for (const level of levels) {
      let chips = carry;
      for (const s of seats) chips += Math.min(amount(s), level) - Math.min(amount(s), prev);
      prev = level;
      const elig = seats.filter((s) => !s.folded && amount(s) >= level);
      if (!elig.length) {
        carry = chips;
        continue;
      }
      carry = 0;
      // Eligibility only shrinks as the levels rise, so the same count means the same players.
      const last = out.at(-1);
      if (last && last.seats.length === elig.length) last.amount += chips;
      else out.push({ amount: chips, seats: elig });
    }
    if (carry && out.length) out.at(-1).amount += carry;
    return out;
  }

  best(s) {
    const h = this.hand;
    if (s.cache?.n !== h.board.length) s.cache = { n: h.board.length, ...bestFive([...s.hole, ...h.board]) };
    return s.cache;
  }

  showdown() {
    const h = this.hand;
    const live = this.live();
    this.reveal(live);
    const results = this.pots().map((pot, i, all) => {
      const top = Math.max(...pot.seats.map((s) => this.best(s).score));
      const winners = pot.seats.filter((s) => this.best(s).score === top); // in order from the button's left
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      const paid = winners.map((s) => {
        const n = share + (odd-- > 0 ? 1 : 0);
        s.p.stack += n;
        s.won += n;
        return { pid: s.pid, n };
      });
      const contested = pot.seats.length > 1;
      const hand = contested ? handName(top) : null;
      const label = all.length === 1 ? 'pot' : i === 0 ? 'main' : 'side';
      for (const w of paid) this.emit({ t: 'win', pid: w.pid, n: w.n, pot: label, hand, split: winners.length > 1 });
      return { amount: pot.amount, label, hand, winners: paid };
    });
    h.pot = 0;
    this.endHand(results, true);
  }

  winUncontested(s) {
    const h = this.hand;
    this.returnUncalled();
    for (const x of this.seats()) {
      h.pot += x.bet;
      x.bet = 0;
    }
    const n = h.pot;
    s.p.stack += n;
    s.won += n;
    h.pot = 0;
    h.toAct = null;
    this.emit({ t: 'win', pid: s.pid, n, pot: 'pot', hand: null, split: false });
    this.endHand([{ amount: n, label: 'pot', hand: null, winners: [{ pid: s.pid, n }] }], false);
  }

  endHand(pots, showdown) {
    const h = this.hand;
    h.toAct = null;
    h.runout = false;
    h.results = { pots, showdown };
    this.phase = 'handOver';
    const busted = this.players.filter((p) => p.stack === 0 && !p.busted && h.seats.has(p.id));
    if (busted.length) {
      if (this.rules.mode === 'tourney') {
        // Two out in the same hand: whoever started it with more chips finishes higher.
        const left = this.players.filter((p) => p.stack > 0).length;
        busted.sort((a, b) => h.seats.get(b.id).start - h.seats.get(a.id).start);
        busted.forEach((p, i) => (p.place = left + i + 1));
      }
      for (const p of busted) {
        p.busted = true;
        this.emit({ t: 'bust', pid: p.id, place: p.place });
      }
    }
    this.emit({ t: 'handEnd', no: h.no });
    if (this.rules.mode === 'tourney' && this.players.filter((p) => p.stack > 0).length <= 1) this.finishGame('last');
  }

  nextHand() {
    this.need(this.phase === 'handOver' || this.phase === 'waiting', 'This hand is still being played');
    this.startHand();
  }

  // The host ends the game in the middle of a hand: everyone gets their bets back.
  voidHand() {
    const h = this.hand;
    for (const s of this.seats()) {
      if (this.players.includes(s.p)) s.p.stack += s.total;
      else this.chipsOut += s.total;
      s.bet = 0;
      s.total = 0;
    }
    h.pot = 0;
    h.toAct = null;
    h.runout = false;
    h.voided = true;
    this.phase = 'handOver';
    this.emit({ t: 'void', no: h.no });
  }

  // --------------------------------------------------------- between hands

  // After a hand anyone who was dealt in may show their cards (a bluff, say).
  show(pid) {
    const h = this.hand;
    this.need(h && this.phase !== 'hand', 'You can show your cards when the hand is over');
    const s = h.seats.get(pid);
    this.need(s && !h.voided, "You weren't dealt in that hand");
    if (h.shown.has(pid)) return;
    h.shown.add(pid);
    this.emit({ t: 'show', pid, cards: s.hole.map(face) });
  }

  raiseBlinds() {
    if (this.level >= BLINDS.length - 1) return false;
    this.level += 1;
    const [sb, bb] = BLINDS[this.level];
    this.emit({ t: 'level', sb, bb });
    return true;
  }

  rebuy(pid) {
    const p = this.player(pid);
    this.need(this.rules.mode === 'cash', 'There are no rebuys in a tournament');
    this.need(this.phase !== 'gameOver', 'The game is over');
    this.need(p.stack === 0, 'You can rebuy when you run out of chips');
    const s = this.phase === 'hand' ? this.hand.seats.get(pid) : null;
    this.need(!s || s.folded, 'Wait for this hand to finish');
    p.stack = this.rules.stack;
    p.buyins += 1;
    p.busted = false;
    this.chipsIn += this.rules.stack;
    this.emit({ t: 'rebuy', pid, n: this.rules.stack });
  }

  // Takes effect from the next hand; a hand you're in carries on.
  sitOut(pid, why = 'self') {
    const p = this.player(pid);
    this.need(this.phase !== 'gameOver', 'The game is over');
    if (p.out) return;
    p.out = why;
    this.emit({ t: 'sitout', pid, why });
  }

  sitIn(pid) {
    const p = this.player(pid);
    if (!p.out) return;
    p.out = null;
    this.emit({ t: 'sitin', pid });
  }

  // Someone sits down during a cash game: they're dealt in from the next hand.
  addPlayer({ id, name }) {
    this.need(!this.has(id), 'You are already playing');
    this.need(this.phase !== 'gameOver', 'The game is over');
    this.seatPlayer({ id, name });
    this.emit({ t: 'seated', pid: id, name, n: this.rules.stack });
  }

  renamePlayer(pid, name) {
    const p = this.player(pid);
    const old = p.name;
    p.name = name;
    this.emit({ t: 'renamed', pid, name, old });
  }

  // A player leaves or is removed. In a hand, they fold; their bets stay in the pot.
  removePlayer(pid) {
    const idx = this.players.findIndex((p) => p.id === pid);
    if (idx < 0) return;
    const p = this.players[idx];
    const h = this.hand;
    const s = this.phase === 'hand' ? h.seats.get(pid) : null;
    const wasTurn = Boolean(s && h.toAct === pid);
    if (s && !s.folded) {
      s.folded = true;
      s.action = { t: 'fold' };
    }
    this.players.splice(idx, 1);
    this.chipsOut += p.stack;
    this.gone.push({ id: p.id, name: p.name, stack: p.stack, buyins: p.buyins, place: p.place });
    this.emit({ t: 'removed', pid, name: p.name });

    if (this.phase === 'gameOver') return;
    if (s) {
      const live = this.live();
      if (live.length === 1) this.winUncontested(live[0]);
      else if (!h.runout && wasTurn) this.advance(pid);
      else if (!h.runout && h.toAct && this.roundOver()) this.closeRound();
    }
    if (this.phase === 'gameOver') return;
    const withChips = this.players.filter((x) => x.stack > 0).length;
    if (this.players.length < 2 || (this.rules.mode === 'tourney' && withChips <= 1 && this.phase !== 'hand')) {
      this.finishGame(this.players.length < 2 ? 'few' : 'last');
    }
  }

  // ------------------------------------------------------------- game over

  finishGame(reason) {
    if (this.phase === 'gameOver') return;
    if (this.phase === 'hand') this.voidHand();
    this.phase = 'gameOver';
    this.endReason = reason;
    if (this.rules.mode === 'tourney') {
      // Whoever still has chips: more chips, better place.
      const alive = this.players.filter((p) => p.place === null).sort((a, b) => b.stack - a.stack);
      let place = 1;
      alive.forEach((p, i) => {
        if (i > 0 && p.stack < alive[i - 1].stack) place = i + 1;
        p.place = place;
      });
      this.winners = alive.filter((p) => p.place === 1).map((p) => p.id);
    } else {
      const net = (p) => p.stack - p.buyins * this.rules.stack;
      const best = Math.max(...this.players.map(net));
      this.winners = this.players.filter((p) => net(p) === best).map((p) => p.id);
    }
    this.emit({ t: 'gameOver', winners: this.winners, reason });
  }

  // ------------------------------------------------------------------ views

  seatView(p, viewer) {
    const h = this.hand;
    const s = h?.seats.get(p.id) ?? null;
    let cards = null;
    let best = null;
    if (s && !h.voided) {
      const open = p.id === viewer || h.shown.has(p.id);
      if (open) {
        cards = s.hole.map(face);
        if (!s.folded || h.shown.has(p.id)) {
          const b = this.best(s);
          best = { name: handName(b.score), short: handShort(b.score), cards: b.cards.map(face) };
        }
      } else if (!s.folded) cards = [null, null];
    }
    return {
      id: p.id,
      name: p.name,
      stack: p.stack,
      buyins: p.buyins,
      out: p.out,
      busted: p.busted,
      place: p.place,
      inHand: Boolean(s),
      folded: Boolean(s?.folded),
      allIn: Boolean(s?.allIn) && this.phase === 'hand',
      shown: Boolean(s && h.shown.has(p.id)),
      bet: s?.bet ?? 0,
      won: s?.won ?? 0,
      action: s?.action ?? null,
      cards,
      best,
    };
  }

  // Everything `viewer` is allowed to know right now, and nothing more.
  viewFor(viewer) {
    const h = this.hand;
    const playing = this.phase === 'hand';
    const me = h?.seats.get(viewer);
    const pots = playing ? this.pots((s) => s.total - s.bet).map((x) => x.amount) : [];
    return {
      phase: this.phase,
      rules: { ...this.rules },
      handNo: this.handNo,
      level: this.level,
      blinds: BLINDS[this.level],
      nextBlinds: BLINDS[Math.min(this.level + 1, BLINDS.length - 1)],
      players: this.players.map((p) => this.seatView(p, viewer)),
      gone: this.gone.map((g) => ({ ...g })),
      hand: h
        ? {
            no: h.no,
            blinds: [h.sb, h.bb],
            button: h.button,
            sb: h.sbPid,
            bb: h.bbPid,
            board: h.board.map(face),
            street: STREETS[h.street],
            pot: playing ? h.pot : 0,
            pots: pots.length > 1 ? pots : [],
            total: playing ? this.chipsInPlay() : 0,
            currentBet: h.currentBet,
            toAct: h.toAct,
            runout: h.runout,
            voided: h.voided,
            options: playing && me && h.toAct === viewer && !h.runout ? this.options(me) : null,
            results: h.results,
          }
        : null,
      winners: this.winners,
      endReason: this.endReason,
    };
  }
}
