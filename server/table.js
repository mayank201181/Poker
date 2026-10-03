// What every game at the table shares: seats and stacks, the dealer button,
// rebuys, sitting out, people arriving and leaving, running out of chips,
// tournament places and the end of the game. Texas Hold'em (game.js) and
// Teen Patti (teenpatti.js) build their hands on top of this.
//
// Like the games themselves this is a pure state machine with no timers and
// no I/O: actions either change state (emitting public events) or throw a
// GameError whose message is safe to show the player.

import { makeDeck, face } from './cards.js';
import { shuffle } from './util.js';

export class GameError extends Error {}

export class Table {
  // Tests can pass `deck(handNo)` to stack the deck (null = shuffle) and the first `button`.
  // Subclasses set `levels` and `level`, then call startHand().
  constructor(players, rules, { rng = Math.random, emit, deck = null, button = null } = {}) {
    if (players.length < 2) throw new GameError('Need at least 2 players');
    this.rules = rules;
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

  newDeck() {
    return this.deckFor?.(this.handNo) ?? shuffle(makeDeck(), this.rng);
  }

  // Who is dealt into the next hand: everyone with chips who isn't sitting
  // out, starting left of the button (which moves one player each hand; the
  // first hand: someone at random). Null when fewer than two can play.
  seatHand() {
    const ready = this.players.filter((p) => this.canPlay(p));
    if (ready.length < 2) {
      if (this.phase !== 'waiting') this.emit({ t: 'waiting' });
      this.phase = 'waiting';
      return null;
    }
    this.handNo += 1;
    const button =
      this.buttonSeat === null
        ? ready[Math.floor(this.rng() * ready.length)]
        : ready.find((p) => p.seat > this.buttonSeat) ?? ready[0];
    this.buttonSeat = button.seat;
    const bi = ready.indexOf(button);
    return { button, order: [...ready.slice(bi + 1), ...ready.slice(0, bi + 1)] };
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

  // Pays a pot to its winners; an odd chip goes to the first winner left of the button.
  pay(amount, winners) {
    const share = Math.floor(amount / winners.length);
    let odd = amount - share * winners.length;
    return winners.map((s) => {
      const n = share + (odd-- > 0 ? 1 : 0);
      s.p.stack += n;
      s.won += n;
      return { pid: s.pid, n };
    });
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

  // Tournaments: the stakes go up a level (from the next hand).
  raiseLevel() {
    if (this.level >= this.levels.length - 1) return false;
    this.level += 1;
    this.emit({ t: 'level', ...this.stakes() });
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
    const wasLive = Boolean(s && !s.folded);
    if (wasLive) {
      s.folded = true;
      s.action = { t: 'fold' };
    }
    this.players.splice(idx, 1);
    this.chipsOut += p.stack;
    this.gone.push({ id: p.id, name: p.name, stack: p.stack, buyins: p.buyins, place: p.place });
    this.emit({ t: 'removed', pid, name: p.name });

    if (this.phase === 'gameOver') return;
    if (wasLive) this.leaveHand(s, wasTurn);
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

  // The parts of a seat everyone may see, whatever the game.
  seatBase(p, s) {
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
      shown: Boolean(s && this.hand.shown.has(p.id)),
      won: s?.won ?? 0,
      action: s?.action ?? null,
    };
  }
}
