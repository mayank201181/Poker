// Teen Patti computer players. Like the Hold'em bots, a bot only uses what a
// person in its seat would know: its own cards (once it has seen them), the
// stake, the pot and how many players are left.

import { tpPercentile } from './teenhand.js';

export function teenBotAct(game, pid, rng = Math.random, style = {}) {
  const h = game.hand;
  if (game.phase !== 'hand' || h.toAct !== pid) return false;
  const s = h.seats.get(pid);
  const o = game.options(s);
  const loose = style.loose ?? 0; // −1 (tight) … 1 (loose)
  const aggro = style.aggro ?? 1; // ~0.7 (calm) … 1.4 (pushy)
  const act = (type, arg) => game.act(pid, type, arg);

  // Asked for a sideshow (both of us have seen): accept with a decent hand.
  if (o.reply) return act('reply', tpPercentile(s.score) > 0.6 - loose * 0.1);

  const opponents = game.live().length - 1;
  const cheap = (x) => x <= s.p.stack * 0.15;

  // Play blind for a round or two while it's cheap, then look.
  if (!s.seen) {
    const rounds = 1 + Math.round((loose + 1) * 1.5 * rng());
    if (s.blinds < rounds && h.stake <= 4 * h.boot && cheap(o.bet)) {
      if (opponents === 1 && h.pot >= 16 * h.boot && rng() < 0.3) return act('askShow');
      if (o.canRaise && rng() < 0.1 * aggro) return act('raise');
      return act('bet');
    }
    game.see(pid);
  }

  const now = game.options(s); // seeing doubles what a bet costs
  // Rough chance that this hand beats everyone still in.
  const pct = tpPercentile(s.score);
  const strength = pct ** Math.max(1, opponents * 0.85) + loose * 0.05;
  const pricey = now.bet > s.p.stack * 0.35;

  if (opponents === 1) {
    if (strength > 0.8) return now.canRaise && rng() < 0.45 * aggro ? act('raise') : act(rng() < 0.35 ? 'askShow' : 'bet');
    if (strength > 0.55) return act(h.pot >= 30 * h.boot || rng() < 0.35 ? 'askShow' : 'bet');
    if (strength > 0.35 && !pricey) return act(rng() < 0.6 ? 'askShow' : 'bet');
    return rng() < 0.08 * aggro && !pricey ? act('bet') : act('pack');
  }
  if (strength > 0.7) return now.canRaise && rng() < 0.35 * aggro ? act('raise') : act('bet');
  if (strength > 0.4 && !pricey) return act('bet');
  if (now.canSideshow && strength > 0.18 && rng() < 0.55) return act('sideshow');
  if (strength > 0.25 && !pricey && rng() < 0.45 + loose * 0.2) return act('bet');
  return rng() < 0.05 * aggro && cheap(now.bet) ? act('bet') : act('pack');
}
