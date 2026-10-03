// Teen Patti rules engine, on the same table as Hold'em (seats, stacks,
// rebuys, tournaments). Everyone puts in the boot and gets three cards face
// down. You can bet blind, without looking, or see your cards first; once
// you've seen them every bet costs twice as much.
//
//   - The stake starts at the boot. A blind player bets the stake; a seen
//     player bets twice the stake (chaal). 2x doubles the stake.
//   - Pack (fold) whenever it's your turn.
//   - Two players left: either can ask for a show, for the price of a bet.
//     The better hand wins; on an exact tie the player who asked loses.
//   - Sideshow: a seen player can pay a chaal and ask the seen player before
//     them to compare cards privately. The lower hand packs (a tie: the one
//     who asked packs). The other player may refuse.
//   - Pot limit (if set): once the pot reaches it, everyone left shows.
//   - Short of chips? Bet what you have (all in). You can win the pot as it
//     stood then; later bets go into a side pot for the others.

import { face } from './cards.js';
import { tpScore, tpName, tpShort } from './teenhand.js';
import { Table, GameError } from './table.js';

// Boot amounts. Tournaments climb this ladder.
export const BOOTS = [5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000];

export const TP_RULES = Object.freeze({
  mode: 'cash',  // as in Hold'em: 'cash' (rebuys) or 'tourney'
  stack: 1000,   // starting chips (and what a rebuy gives you)
  boot: 1,       // starting boot, an index into BOOTS (10)
  potLimit: 100, // the pot limit in boots (0: no limit)
});

export class TeenPatti extends Table {
  constructor(players, rules = {}, opts = {}) {
    super(players, { ...TP_RULES, ...rules }, opts);
    this.kind = 'teenpatti';
    this.levels = BOOTS;
    this.level = this.rules.boot;
    this.startHand();
  }

  stakes(level = this.level) {
    return { boot: BOOTS[level] };
  }

  chipsInPlay() {
    return this.phase === 'hand' ? this.hand.pot : 0;
  }

  // ------------------------------------------------------------------ hands

  startHand() {
    const seated = this.seatHand();
    if (!seated) return;
    const { button, order } = seated;
    const boot = BOOTS[this.level];
    const seats = new Map(
      order.map((p) => [
        p.id,
        { p, pid: p.id, hole: [], seen: false, blinds: 0, folded: false, allIn: false, total: 0, won: 0, action: null, start: p.stack, score: 0 },
      ]),
    );
    const h = (this.hand = {
      no: this.handNo,
      boot,
      button: button.id,
      order: order.map((p) => p.id),
      seats,
      deck: this.newDeck(),
      stake: boot,
      pot: 0,
      limit: this.rules.potLimit ? this.rules.potLimit * boot : 0,
      // The pot in parts: each part can be won by the players in `eligible`.
      // A new part starts whenever someone is all in.
      parts: [{ amount: 0, eligible: new Set(order.map((p) => p.id)) }],
      toAct: null,
      sideshow: null, // { from, to } while waiting for an answer
      peeks: [], // pairs of players who saw each other's cards in a sideshow
      shown: new Set(),
      runout: false,
      results: null,
      voided: false,
      actions: 0,
    });
    this.phase = 'hand';
    this.emit({ t: 'hand', no: this.handNo, button: button.id, boot });
    // Everyone puts in the boot together; anyone short is all in for what they have.
    for (const s of seats.values()) {
      const x = Math.min(boot, s.p.stack);
      s.p.stack -= x;
      s.total += x;
      h.pot += x;
      h.parts[0].amount += x;
      s.allIn = s.p.stack === 0;
      s.action = { t: 'boot', n: x };
    }
    const short = this.seats().filter((s) => s.allIn);
    if (short.length) h.parts.push({ amount: 0, eligible: new Set(order.filter((p) => !seats.get(p.id).allIn).map((p) => p.id)) });
    this.emit({ t: 'boot', n: boot, pot: h.pot });
    for (let r = 0; r < 3; r++) for (const p of order) seats.get(p.id).hole.push(h.deck.pop());
    for (const s of seats.values()) s.score = tpScore(s.hole);
    this.emit({ t: 'deal', n: order.length, cards: 3 });
    this.advance(button.id);
  }

  // What a bet costs you now: the stake if you're blind, twice that once you've seen.
  cost(s) {
    return (s.seen ? 2 : 1) * this.hand.stake;
  }

  put(s, x) {
    const h = this.hand;
    s.p.stack -= x;
    s.total += x;
    h.pot += x;
    h.parts.at(-1).amount += x;
    if (s.p.stack === 0 && !s.allIn) {
      s.allIn = true;
      // Bets from now on go into a side pot this player can't win.
      const open = h.parts.at(-1);
      h.parts.push({ amount: 0, eligible: new Set([...open.eligible].filter((pid) => pid !== s.pid)) });
    }
  }

  pack(s) {
    s.folded = true;
    s.action = { t: 'pack' };
    for (const part of this.hand.parts) part.eligible.delete(s.pid);
  }

  // The nearest player before you who is still in: your sideshow partner, if
  // they've seen their cards and aren't all in.
  sideshowPartner(s) {
    const h = this.hand;
    const o = h.order;
    const i = o.indexOf(s.pid);
    for (let k = 1; k < o.length; k++) {
      const x = h.seats.get(o[(i - k + o.length) % o.length]);
      if (!x.folded) return x.seen && !x.allIn ? x : null;
    }
    return null;
  }

  options(s) {
    const h = this.hand;
    if (h.sideshow) return { reply: { from: h.sideshow.from }, pot: h.pot, stake: h.stake, seen: s.seen };
    const bet = this.cost(s);
    const live = this.live();
    const partner = s.seen && live.length >= 3 ? this.sideshowPartner(s) : null;
    return {
      seen: s.seen,
      stake: h.stake,
      pot: h.pot,
      limit: h.limit,
      bet: Math.min(bet, s.p.stack),
      betAllIn: s.p.stack <= bet,
      canRaise: s.p.stack > bet,
      raise: Math.min(2 * bet, s.p.stack),
      raiseAllIn: s.p.stack <= 2 * bet,
      canShow: live.length === 2,
      show: Math.min(bet, s.p.stack),
      canSideshow: Boolean(partner) && s.p.stack > bet,
      sideshowWith: partner?.pid ?? null,
      sideshow: bet,
    };
  }

  // Look at your cards. Any time during the hand, even when it isn't your turn.
  see(pid) {
    const h = this.hand;
    this.need(this.phase === 'hand', 'There are no cards to see right now');
    const s = h.seats.get(pid);
    this.need(s && !s.folded, "You aren't in this hand");
    if (s.seen) return;
    s.seen = true;
    this.emit({ t: 'see', pid });
  }

  // pack | bet | raise (2x) | askShow | sideshow | reply (accept: true/false)
  act(pid, type, arg) {
    const h = this.hand;
    this.need(this.phase === 'hand' && h.toAct, "There's no betting right now");
    this.need(h.toAct === pid, "It's not your turn");
    const s = h.seats.get(pid);
    if (h.sideshow) {
      this.need(type === 'reply', 'Answer the sideshow first: accept or refuse');
      return this.answerSideshow(s, arg === true);
    }
    switch (type) {
      case 'pack':
        this.pack(s);
        this.emit({ t: 'act', pid, a: 'pack' });
        break;
      case 'bet':
      case 'raise': {
        const double = type === 'raise';
        const base = this.cost(s);
        this.need(!double || s.p.stack > base, "You don't have enough chips to raise");
        const want = double ? 2 * base : base;
        const x = Math.min(want, s.p.stack);
        if (double && x === want) h.stake *= 2;
        if (!s.seen) s.blinds += 1;
        this.put(s, x);
        const a = s.seen ? 'chaal' : 'blind';
        s.action = { t: s.allIn ? 'allin' : a, n: x, raise: double };
        this.emit({ t: 'act', pid, a, n: x, raise: double, allIn: s.allIn });
        break;
      }
      case 'askShow': {
        const live = this.live();
        this.need(live.length === 2, 'You can ask for a show when only two players are left');
        const x = Math.min(this.cost(s), s.p.stack);
        this.put(s, x);
        s.action = { t: 'show', n: x };
        this.emit({ t: 'act', pid, a: 'show', n: x, allIn: s.allIn });
        h.actions += 1;
        return this.showdown(pid);
      }
      case 'sideshow': {
        this.need(s.seen, 'See your cards first: only seen players can ask for a sideshow');
        this.need(this.live().length >= 3, 'With two players left, ask for a show instead');
        const partner = this.sideshowPartner(s);
        this.need(partner, 'The player before you has to have seen their cards');
        const x = this.cost(s);
        this.need(s.p.stack > x, "You don't have enough chips for a sideshow");
        this.put(s, x);
        s.action = { t: 'sideshow', n: x };
        h.sideshow = { from: pid, to: partner.pid };
        h.toAct = partner.pid;
        h.actions += 1;
        this.emit({ t: 'act', pid, a: 'sideshow', n: x, to: partner.pid });
        this.emit({ t: 'turn', pid: partner.pid });
        return;
      }
      default:
        throw new GameError('Unknown action');
    }
    h.actions += 1;
    this.advance(pid);
  }

  answerSideshow(s, accept) {
    const h = this.hand;
    const asker = h.seats.get(h.sideshow.from);
    h.sideshow = null;
    h.actions += 1;
    if (!accept) {
      s.action = { t: 'refuse' };
      this.emit({ t: 'sideshow', pid: asker.pid, with: s.pid, accepted: false });
      return this.advance(asker.pid);
    }
    // They compare cards privately; the lower hand packs (on a tie, the one who asked).
    h.peeks.push([asker.pid, s.pid]);
    const loser = asker.score > s.score ? s : asker;
    this.pack(loser);
    this.emit({ t: 'sideshow', pid: asker.pid, with: s.pid, accepted: true, loser: loser.pid });
    this.advance(asker.pid);
  }

  // Out of time (or away): refuse a sideshow, otherwise pack.
  autoPlay(pid) {
    const h = this.hand;
    if (this.phase !== 'hand' || h.toAct !== pid) return;
    this.emit({ t: 'timeout', pid });
    if (h.sideshow) this.act(pid, 'reply', false);
    else this.act(pid, 'pack');
  }

  advance(from) {
    const h = this.hand;
    h.sideshow = null;
    const live = this.live();
    if (live.length === 1) return this.winUncontested(live[0]);
    if (h.limit && h.pot >= h.limit) {
      this.emit({ t: 'limit', n: h.limit });
      return this.showdown(null);
    }
    // Nobody left to bet against: everyone still in shows.
    if (live.filter((s) => !s.allIn).length <= 1) return this.showdown(null);
    h.toAct = this.nextPid(from, (s) => !s.folded && !s.allIn);
    this.emit({ t: 'turn', pid: h.toAct });
  }

  // Everyone still in turns their cards up and each part of the pot goes to
  // the best hand that can win it. `asker`: who asked for a two-player show
  // (they lose an exact tie).
  showdown(asker) {
    const h = this.hand;
    h.toAct = null;
    h.sideshow = null;
    const live = this.live();
    this.reveal(live);
    const won = [];
    let carry = 0;
    for (const part of h.parts) {
      const amount = part.amount + carry;
      if (!amount) continue;
      const elig = live.filter((s) => part.eligible.has(s.pid));
      if (!elig.length) {
        carry = amount; // only possible when people left the table; it goes on to the next part
        continue;
      }
      carry = 0;
      const top = Math.max(...elig.map((s) => s.score));
      let winners = elig.filter((s) => s.score === top);
      if (asker && winners.length > 1 && elig.length === 2) winners = winners.filter((s) => s.pid !== asker);
      won.push({ amount, hand: elig.length > 1 ? tpName(top) : null, winners });
    }
    if (carry) {
      if (won.length) won.at(-1).amount += carry;
      else won.push({ amount: carry, hand: null, winners: live });
    }
    const results = won.map((w, i) => {
      const label = won.length === 1 ? 'pot' : i === 0 ? 'main' : 'side';
      const paid = this.pay(w.amount, w.winners);
      for (const x of paid) this.emit({ t: 'win', pid: x.pid, n: x.n, pot: label, hand: w.hand, split: paid.length > 1 });
      return { amount: w.amount, label, hand: w.hand, winners: paid };
    });
    h.pot = 0;
    this.endHand(results, true);
  }

  winUncontested(s) {
    const h = this.hand;
    const n = h.pot;
    s.p.stack += n;
    s.won += n;
    h.pot = 0;
    h.toAct = null;
    h.sideshow = null;
    this.emit({ t: 'win', pid: s.pid, n, pot: 'pot', hand: null, split: false });
    this.endHand([{ amount: n, label: 'pot', hand: null, winners: [{ pid: s.pid, n }] }], false);
  }

  // Someone left mid-hand (they've already packed): the hand carries on without them.
  leaveHand(s, wasTurn) {
    const h = this.hand;
    for (const part of h.parts) part.eligible.delete(s.pid);
    const ss = h.sideshow;
    if (ss && (ss.from === s.pid || ss.to === s.pid)) return this.advance(ss.from);
    if (wasTurn) return this.advance(s.pid);
    const live = this.live();
    if (live.length === 1) return this.winUncontested(live[0]);
    if (live.filter((x) => !x.allIn).length <= 1) return this.showdown(null);
  }

  // ------------------------------------------------------------------ views

  peeked(viewer, pid) {
    return this.hand.peeks.some(([a, b]) => (a === viewer && b === pid) || (b === viewer && a === pid));
  }

  seatView(p, viewer) {
    const h = this.hand;
    const s = h?.seats.get(p.id) ?? null;
    let cards = null;
    let best = null;
    if (s && !h.voided) {
      const mine = p.id === viewer;
      // Blind players don't see their own cards either, until the hand is over.
      const open = (mine && (s.seen || this.phase !== 'hand')) || h.shown.has(p.id) || this.peeked(viewer, p.id);
      if (open) {
        cards = s.hole.map(face);
        best = { name: tpName(s.score), short: tpShort(s.score) };
      } else if (!s.folded || mine) cards = [null, null, null];
    }
    return { ...this.seatBase(p, s), seen: Boolean(s?.seen), total: s?.total ?? 0, cards, best };
  }

  // Everything `viewer` is allowed to know right now, and nothing more.
  viewFor(viewer) {
    const h = this.hand;
    const playing = this.phase === 'hand';
    const me = h?.seats.get(viewer);
    const parts = playing ? h.parts.filter((x) => x.amount > 0).map((x) => x.amount) : [];
    return {
      kind: this.kind,
      phase: this.phase,
      rules: { ...this.rules },
      handNo: this.handNo,
      level: this.level,
      boot: BOOTS[this.level],
      nextBoot: BOOTS[Math.min(this.level + 1, BOOTS.length - 1)],
      players: this.players.map((p) => this.seatView(p, viewer)),
      gone: this.gone.map((g) => ({ ...g })),
      hand: h
        ? {
            no: h.no,
            boot: h.boot,
            button: h.button,
            pot: playing ? h.pot : 0,
            pots: parts.length > 1 ? parts : [],
            stake: h.stake,
            limit: h.limit,
            toAct: h.toAct,
            sideshow: h.sideshow ? { ...h.sideshow } : null,
            runout: false,
            voided: h.voided,
            options: playing && me && h.toAct === viewer ? this.options(me) : null,
            results: h.results,
          }
        : null,
      winners: this.winners,
      endReason: this.endReason,
    };
  }
}
