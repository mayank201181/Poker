// Turns game events into plain sentences for the ticker, log and toasts.

import { cardText, fmt } from './cards.js';

export function namer(v) {
  const names = new Map();
  for (const g of v.game?.gone ?? []) names.set(g.id, g.name);
  for (const m of v.members) names.set(m.id, m.name);
  for (const p of v.game?.players ?? []) names.set(p.id, p.name);
  return (pid, fallback = 'Someone') => (pid === v.me ? 'You' : names.get(pid) ?? fallback);
}

const ORD = ['th', 'st', 'nd', 'rd'];
export const ordinal = (n) => `${n}${(n % 100 >= 11 && n % 100 <= 13) || n % 10 > 3 ? 'th' : ORD[n % 10]}`;

const STREET = { flop: 'Flop', turn: 'Turn', river: 'River' };

// Famous lines for the computer players to say when they win a showdown.
export const QUIPS = {
  Mogambo: 'Mogambo khush hua!',
  Gabbar: 'Ab tera kya hoga?',
  Teja: 'Teja main hoon, mark idhar hai!',
  Lion: 'Saara shahar mujhe Lion ke naam se jaanta hai!',
  Sambha: 'Poore pachaas hazaar!',
};

export function describe(ev, v) {
  const name = namer(v);
  const me = ev.pid === v.me;
  const N = name(ev.pid, ev.name);
  // "You fold" / "Asha folds"
  const verb = (base, third = `${base}s`) => `${N} ${me ? base : third}`;
  const is = me ? 'are' : 'is';

  switch (ev.t) {
    case 'start': return ev.game === 'teenpatti' ? 'New game of Teen Patti! Good luck' : "New game of Texas Hold'em! Good luck";
    case 'hand':
      if (ev.boot) return `Hand ${ev.no}: ${name(ev.button)} ${ev.button === v.me ? 'deal' : 'deals'} · boot ${fmt(ev.boot)}`;
      return `Hand ${ev.no}: ${name(ev.button)} ${ev.button === v.me ? 'have' : 'has'} the button · blinds ${fmt(ev.blinds[0])}/${fmt(ev.blinds[1])}`;
    case 'boot': return `Everyone puts in the boot (${fmt(ev.n)})`;
    case 'see': return me ? 'You looked at your cards' : `${N} looked at their cards`;
    case 'blind':
      return `${verb('post')} the ${ev.kind === 'sb' ? 'small' : 'big'} blind (${fmt(ev.n)})${ev.allIn ? ', all in' : ''}`;
    case 'act':
      switch (ev.a) {
        case 'fold': return verb('fold');
        case 'check': return verb('check');
        case 'call': return `${verb('call')} ${fmt(ev.n)}${ev.allIn ? ', all in' : ''}`;
        case 'bet': return `${verb('bet')} ${fmt(ev.to)}${ev.allIn ? ', all in' : ''}`;
        case 'raise': return `${verb('raise')} to ${fmt(ev.to)}${ev.allIn ? ', all in' : ''}`;
        // Teen Patti
        case 'pack': return verb('pack');
        case 'blind':
        case 'chaal': {
          const what = `${ev.a === 'blind' ? 'blind' : 'chaal'} ${fmt(ev.n)}${ev.allIn ? ', all in' : ''}`;
          return ev.raise ? `${verb('double')} the stake: ${what}` : ev.a === 'blind' ? `${verb('play')} ${what}` : `${verb('chaal')} ${fmt(ev.n)}${ev.allIn ? ', all in' : ''}`;
        }
        case 'show': return `${verb('ask')} for a show (${fmt(ev.n)})`;
        case 'sideshow': return `${verb('ask')} ${ev.to === v.me ? 'you' : name(ev.to)} for a sideshow (${fmt(ev.n)})`;
        default: return null;
      }
    case 'sideshow': {
      const other = name(ev.with);
      if (!ev.accepted) return `${other} ${ev.with === v.me ? 'refuse' : 'refuses'} the sideshow`;
      return `${other} ${ev.with === v.me ? 'accept' : 'accepts'} the sideshow: ${ev.loser === v.me ? 'you pack' : `${name(ev.loser)} packs`}`;
    }
    case 'limit': return `The pot limit (${fmt(ev.n)}) is reached: everyone still in shows`;
    case 'return': return `${fmt(ev.n)} nobody called goes back to ${me ? 'you' : N}`;
    case 'street': return `${STREET[ev.street]}: ${ev.cards.map(cardText).join(' ')}`;
    case 'allin': return 'Nobody can bet any more: cards up!';
    case 'reveal': return `Cards up: ${ev.hands.map((x) => `${name(x.pid)} ${x.cards.map(cardText).join(' ')}`).join(' · ')}`;
    case 'show': return `${verb('show')} ${ev.cards.map(cardText).join(' ')}`;
    case 'win': {
      const pot = ev.pot === 'main' ? 'the main pot' : ev.pot === 'side' ? 'a side pot' : 'the pot';
      if (ev.split) return `${verb('split')} ${pot}: ${fmt(ev.n)}${ev.hand ? ` with ${ev.hand}` : ''}`;
      return `${verb('win')} ${ev.pot === 'pot' ? fmt(ev.n) : `${pot} (${fmt(ev.n)})`}${ev.hand ? ` with ${ev.hand}` : ''}`;
    }
    case 'bust':
      return ev.place ? `${N} ${is} out in ${ordinal(ev.place)} place` : `${N} ${is} out of chips`;
    case 'rebuy': return `${verb('buy', 'buys')} back in for ${fmt(ev.n)}`;
    case 'seated': return `${N} sat down with ${fmt(ev.n)} chips`;
    case 'sitout': return ev.why === 'away' ? `${N} ${is} away, sitting out` : `${N} ${is} sitting out`;
    case 'sitin': return `${N} ${is} back`;
    case 'level': return ev.boot ? `The boot is going up to ${fmt(ev.boot)} from the next hand` : `Blinds are going up: ${fmt(ev.sb)}/${fmt(ev.bb)} from the next hand`;
    case 'timeout': return `${N} ran out of time`;
    case 'waiting': return 'Waiting for at least 2 players with chips';
    case 'void': return 'The hand was called off and everyone got their bets back';
    case 'gameOver': {
      const names = ev.winners.map((id) => name(id));
      if (!names.length) return 'Game over';
      return `Game over: ${names.join(' & ')} ${names.length > 1 || names[0] === 'You' ? 'win' : 'wins'}!`;
    }
    case 'join': return ev.bot ? `${ev.name} (computer) joined` : ev.watching ? `${ev.name} is watching` : `${ev.name} joined`;
    case 'left': return `${ev.name} left`;
    case 'kicked': return `${ev.name} was removed by the host`;
    case 'host': return me ? 'You are now the host' : `${N} is now the host`;
    case 'pause': return `${N} paused the game`;
    case 'resume': return `${N} resumed the game`;
    case 'claim': return `${N} asked to take over ${name(ev.seat)}'s seat`;
    case 'claimDenied': return me ? 'The host said no to your request' : null;
    case 'takeover': return `${ev.name} took over ${ev.old}'s seat`;
    case 'lobby': return 'Back to the lobby';
    default: return null;
  }
}
