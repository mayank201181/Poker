// The table: other players on top, the board and pot in the middle, your
// cards at the bottom, and buttons for whatever you can do right now.

import { h } from '../h.js';
import { cardEl, backEl, fmt, fmtShort, sameCard, chipEl } from '../cards.js';
import { isMuted } from '../sound.js';
import { ordinal } from '../text.js';

const ACTION = { sb: 'SB', bb: 'BB', fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', allin: 'All in' };
const STREET = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River' };

export function renderTable(ctx) {
  const v = ctx.view;
  const g = v.game;
  const hand = g.hand;
  const me = g.players.find((p) => p.id === v.me) ?? null;
  const at = me ? g.players.indexOf(me) : -1;
  const others = me ? [...g.players.slice(at + 1), ...g.players.slice(0, at)] : g.players;
  const st = {
    ctx,
    v,
    g,
    hand,
    me,
    others,
    playing: g.phase === 'hand',
    over: g.phase === 'handOver' || g.phase === 'gameOver' || g.phase === 'waiting',
    myTurn: Boolean(hand?.options),
    isHost: v.host === v.me,
    win: winningCards(g),
    name: (pid) => (pid === v.me ? 'You' : g.players.find((p) => p.id === pid)?.name ?? v.members.find((m) => m.id === pid)?.name ?? g.gone.find((x) => x.id === pid)?.name ?? 'Someone'),
  };
  const n = others.length;
  return h(
    'main.screen.table',
    { class: { 'my-turn': st.myTurn, raising: st.myTurn && ctx.S.ui.raise !== null, paused: Boolean(v.paused) } },
    topBar(st),
    h('button.ticker', { onClick: () => ctx.openSheet('log') }, ctx.S.log.at(-1)?.text ?? 'Hand history'),
    h('section.opps', h('div.opps-grid', { class: `n${Math.min(n, 9)}` }, others.map((p) => seat(st, p)))),
    felt(st),
    status(st),
    me ? hero(st) : watching(st),
    actions(st),
  );
}

// After a showdown: the five cards that won the main pot, to light them up.
function winningCards(g) {
  const res = g.hand?.results;
  if (!res?.showdown || g.phase === 'hand') return null;
  const pid = res.pots[0]?.winners[0]?.pid;
  return g.players.find((p) => p.id === pid)?.best?.cards ?? null;
}

function topBar(st) {
  const { ctx, v, g, hand } = st;
  const [sb, bb] = hand && st.playing ? hand.blinds : g.blinds;
  return h(
    'header.topbar',
    h('button.icon-btn', { 'aria-label': 'Menu', onClick: () => ctx.openSheet('menu') }, '☰'),
    h(
      'div.tb-mid',
      h('b', 'Poker'),
      h('span', v.code),
      hand && h('span', `Hand ${hand.no}`),
      h('span.blinds', `${fmtShort(sb)}/${fmtShort(bb)}`),
    ),
    h('button.icon-btn', { 'aria-label': 'Standings', onClick: () => ctx.openSheet('standings') }, '🏆'),
    h('button.icon-btn', { 'aria-label': 'Sound on or off', onClick: () => ctx.toggleSound() }, isMuted() ? '🔇' : '🔊'),
  );
}

// ------------------------------------------------------------- players

function label(st, p) {
  const { g, hand } = st;
  if (st.playing && hand.toAct === p.id && p.id !== st.v.me) return { text: 'Thinking…', cls: 'thinking' };
  if (p.inHand && st.over && hand.results && !hand.voided) {
    if (p.best && p.cards?.[0]) return { text: p.best.short, cls: p.won ? 'won' : '' };
    if (p.folded) return { text: 'Fold', cls: 'muted' };
    return { text: '', cls: '' };
  }
  if (p.inHand && p.action && !p.allIn) return { text: ACTION[p.action.t] ?? '', cls: p.action.t };
  if (p.busted) return { text: g.rules.mode === 'tourney' && p.place ? `Out · ${ordinal(p.place)}` : 'Out of chips', cls: 'muted' };
  if (p.out) return { text: p.out === 'away' ? 'Away' : 'Sitting out', cls: 'muted' };
  if (!p.inHand && st.playing) return { text: 'Next hand', cls: 'muted' };
  return { text: '', cls: '' };
}

function holeCards(st, p, size) {
  if (!p.cards) return [];
  return p.cards.map((c, i) => {
    const key = `hole:${p.id}:${i}`;
    const lit = st.win && c && st.win.some((w) => sameCard(w, c));
    return c ? cardEl(c, { size, key, extra: { lit, dim: st.win && !lit && p.won > 0 } }) : backEl({ size, key });
  });
}

function seat(st, p) {
  const { v, hand } = st;
  const m = v.members.find((x) => x.id === p.id);
  const lab = label(st, p);
  const turn = st.playing && hand.toAct === p.id;
  return h(
    'div.seat',
    {
      class: {
        turn,
        folded: p.inHand && p.folded,
        allin: p.allIn,
        out: !p.inHand,
        won: st.over && p.won > 0,
        off: m && !m.connected && !m.bot,
      },
      dataset: { key: `seat:${p.id}` },
    },
    h(
      'div.seat-top',
      h('span.dot', { class: { on: m?.connected } }),
      h('span.nm', p.name),
      m?.bot && h('span.bot', '🤖'),
      hand?.button === p.id && h('span.dealer', { title: 'Dealer button' }, 'D'),
    ),
    h('div.seat-mid', h('div.hole', holeCards(st, p, 'sm')), h('span.stack', fmtShort(p.stack))),
    h(
      'div.seat-bot',
      h('span.act', { class: lab.cls }, lab.text),
      p.allIn && h('span.allin-tag', 'ALL IN'),
      st.over && p.won > 0 ? h('span.won-amt', `+${fmtShort(p.won)}`) : p.bet > 0 && h('span.bet', { dataset: { key: `bet:${p.id}` } }, chipEl(), fmtShort(p.bet)),
    ),
  );
}

function hero(st) {
  const { ctx, g, hand, me } = st;
  const lab = label(st, me);
  const showHand = me.cards && me.best && !(me.folded && !st.over);
  let note = null;
  if (!me.inHand) {
    if (me.busted) note = g.rules.mode === 'cash' ? 'You are out of chips' : `You finished ${ordinal(me.place ?? 0)}`;
    else if (me.out) note = me.out === 'away' ? 'You were away, so you are sitting out' : 'You are sitting out';
    else if (st.playing) note = 'You will be dealt in next hand';
  }
  return h(
    'section.hero',
    { class: { turn: st.myTurn, folded: me.inHand && me.folded, won: st.over && me.won > 0 }, dataset: { key: `seat:${me.id}` } },
    h('div.me-cards', me.cards ? holeCards(st, me, 'lg') : [h('div.card.lg.empty'), h('div.card.lg.empty')]),
    h(
      'div.me-info',
      h(
        'div.me-top',
        h('b', 'You'),
        hand?.button === me.id && h('span.dealer', 'D'),
        h('span.stack', chipEl(), fmt(me.stack)),
      ),
      showHand && h('div.me-hand', { class: { won: st.over && me.won > 0 } }, me.best.name),
      note && h('div.me-note', note),
      me.inHand && me.folded && !st.over && h('div.me-note', 'You folded'),
      h(
        'div.me-bet',
        lab.text && !(st.over && me.best) && h('span.act', { class: lab.cls }, lab.text),
        me.allIn && h('span.allin-tag', 'ALL IN'),
        st.over && me.won > 0 ? h('span.won-amt', `+${fmt(me.won)}`) : me.bet > 0 && h('span.bet', { dataset: { key: `bet:${me.id}` } }, chipEl(), fmt(me.bet)),
      ),
    ),
    ctx.S.pre && h('span.pre-flag', ctx.S.pre.kind === 'checkFold' ? 'Check / fold' : 'Check'),
  );
}

function watching(st) {
  const { ctx, v, g } = st;
  const pending = v.claims.find((c) => c.from === v.me);
  const free = g.players.filter((p) => {
    const m = v.members.find((x) => x.id === p.id);
    return m && !m.bot && !m.connected;
  });
  const canSit = g.rules.mode === 'cash' && g.phase !== 'gameOver' && g.players.length < 10;
  return h(
    'section.hero.watch',
    h('b', "You're watching this game"),
    canSit
      ? h('button.btn.primary', { onClick: () => ctx.send('sit') }, `Sit down with ${fmt(g.rules.stack)} chips`)
      : h('span', g.rules.mode === 'tourney' ? 'This is a tournament: you can play in the next game.' : 'You can play in the next game.'),
    pending
      ? h('span', 'Asked the host to let you take over a seat…')
      : free.map((p) => h('button.btn', { onClick: () => ctx.send('claim', { seat: p.id }) }, `Take over ${p.name}'s seat`)),
  );
}

// --------------------------------------------------------------- middle

function felt(st) {
  const { g, hand } = st;
  const board = hand && !hand.voided ? hand.board : [];
  const pot = st.playing ? hand.total : 0;
  const lastPot = hand?.results ? hand.results.pots.reduce((a, p) => a + p.amount, 0) : 0;
  return h(
    'section.felt',
    h(
      'div.felt-top',
      h('span.deck', { dataset: { key: 'deck' } }, backEl({ size: 'xs' })),
      h('span.pot', { dataset: { key: 'pot' }, class: { empty: !pot } }, chipEl('big'), st.playing ? `Pot ${fmt(pot)}` : lastPot ? `Pot ${fmt(lastPot)}` : 'Pot'),
      st.playing && hand.pots.length > 1 && h('span.side', hand.pots.map((x, i) => `${i ? 'Side' : 'Main'} ${fmtShort(x)}`).join(' · ')),
    ),
    h(
      'div.board',
      Array.from({ length: 5 }, (_, i) => {
        const c = board[i];
        if (!c) return h('div.card.md.slot', { dataset: { key: `board:${i}` } });
        const lit = st.win?.some((w) => sameCard(w, c));
        return cardEl(c, { size: 'md', key: `board:${i}`, extra: { lit, dim: st.win && !lit } });
      }),
    ),
    h('div.felt-msg', feltMessage(st)),
  );
}

function feltMessage(st) {
  const { g, hand, name } = st;
  if (g.phase === 'waiting') {
    const busted = g.players.filter((p) => p.busted).length;
    return [h('b', 'Waiting for players'), h('span', busted && g.rules.mode === 'cash' ? 'At least 2 players need chips. Busted players can rebuy.' : 'At least 2 players need chips and must be sitting in.')];
  }
  if (!hand) return null;
  if (hand.voided) return [h('b', 'Hand called off'), h('span', 'Everyone got their bets back')];
  if (st.playing) {
    if (hand.runout) return [h('b', 'All in!'), h('span', 'Dealing the rest of the board…')];
    const street = STREET[hand.street];
    if (st.myTurn) return [h('b', 'Your turn'), h('span', street)];
    return [h('b', `${name(hand.toAct)}${hand.toAct === st.v.me ? '' : "'s"} turn`), h('span', street)];
  }
  const res = hand.results;
  if (!res) return null;
  // Pots won by the same people read as one line: "Asha wins 3,500".
  const groups = [];
  for (const pot of res.pots) {
    const key = pot.winners.map((w) => w.pid).join(',');
    const last = groups.at(-1);
    if (last && last.key === key) last.amount += pot.amount;
    else groups.push({ key, ...pot });
  }
  return groups.map((pot) => {
    const who = pot.winners.map((w) => name(w.pid)).join(' & ');
    const verb = pot.winners.length > 1 ? 'split' : who === 'You' ? 'win' : 'wins';
    const what = groups.length === 1 ? '' : pot.label === 'side' ? 'a side pot of ' : 'the main pot, ';
    return h('span.result', h('b', `${who} ${verb} ${what}${fmt(pot.amount)}`), pot.hand && h('small', pot.hand));
  });
}

function status(st) {
  const { ctx, v, g, name } = st;
  const kids = [];
  const timer = v.timer;
  if (v.paused) kids.push(h('span.paused-flag', '⏸ Paused'));
  else if (timer) {
    const who = timer.pid === v.me ? 'You' : name(timer.pid);
    const lab = timer.reason === 'offline' ? `${who} ${timer.pid === v.me ? 'are' : 'is'} offline` : timer.reason === 'away' ? `${who} ${timer.pid === v.me ? 'are' : 'is'} away` : null;
    kids.push(
      h(
        'div.timer-wrap',
        { dataset: { deadline: String(ctx.S.deadline), total: String(timer.total), mine: timer.pid === v.me ? '1' : '0' } },
        lab && h('span.tlabel', lab),
        h('div.timer', h('i')),
        h('span.secs', `${Math.ceil(timer.left / 1000)}s`),
      ),
    );
  } else if (v.next?.kind === 'next') {
    kids.push(
      h(
        'div.timer-wrap.next',
        { dataset: { deadline: String(ctx.S.nextAt), total: String(v.next.total), calm: '1' } },
        h('span.tlabel', 'Next hand in'),
        h('div.timer', h('i')),
        h('span.secs', `${Math.ceil(v.next.left / 1000)}s`),
      ),
    );
  }
  if (v.clock && g.phase !== 'gameOver') {
    const [sb, bb] = g.nextBlinds;
    kids.push(
      h(
        'span.clock',
        { dataset: { deadline: String(ctx.S.clockAt), total: String(v.clock.total), fmt: 'clock', calm: '1', left: String(v.clock.left), ...(v.clock.paused ? { frozen: '1' } : {}) } },
        `Blinds ${fmtShort(sb)}/${fmtShort(bb)} in `,
        h('span.secs', ''),
      ),
    );
  }
  return h('div.status', kids);
}

// ------------------------------------------------------------- buttons

function actions(st) {
  const { ctx, v, g, hand, me } = st;
  const bar = (...kids) => h('footer.actions', ...kids);
  const hint = (text) => h('p.hint', text);

  if (g.phase === 'gameOver') return bar(h('button.btn.primary', { onClick: () => ctx.showOver() }, 'Final results'));
  if (!me) return bar();
  if (v.paused) {
    return bar(
      hint(`${v.members.find((m) => m.id === v.paused.by)?.name ?? 'The host'} paused the game`),
      st.isHost && h('button.btn.primary', { onClick: () => ctx.send('resume') }, '▶ Resume'),
    );
  }
  if (st.myTurn) return st.ctx.S.ui.raise !== null && hand.options.canRaise ? raisePanel(st) : turnBar(st, bar);

  const mine = st.playing && me.inHand ? me : null;
  const rows = [];
  if (me.stack === 0 && !mine) {
    if (g.rules.mode === 'cash') {
      rows.push(hint('Out of chips. Buy back in to keep playing.'), h('button.btn.primary', { onClick: () => ctx.send('rebuy') }, `Rebuy ${fmt(g.rules.stack)}`));
    } else rows.push(hint(me.place ? `You finished ${ordinal(me.place)}. Stay and watch the rest!` : 'You are out of chips'));
    return bar(...rows);
  }
  if (me.out) {
    return bar(hint(me.out === 'away' ? 'You missed your turn, so you are sitting out' : 'You are sitting out'), h('button.btn.primary', { onClick: () => ctx.send('sitIn') }, "I'm back"));
  }
  if (mine && !mine.folded && !mine.allIn && !hand.runout) {
    const pre = ctx.S.pre?.kind;
    const free = hand.currentBet <= mine.bet;
    return bar(
      h('button.btn.pre', { class: { on: pre === 'checkFold' }, onClick: () => ctx.togglePre('checkFold') }, h('i.box'), free ? 'Check / Fold' : 'Fold'),
      free && h('button.btn.pre', { class: { on: pre === 'check' }, onClick: () => ctx.togglePre('check') }, h('i.box'), 'Check'),
    );
  }
  if (mine?.allIn) return bar(hint(hand.runout ? 'Good luck!' : "You're all in. Good luck!"));
  if (mine?.folded) return bar(hint('You folded. Waiting for the hand to finish…'));
  if (g.phase === 'handOver' && me.inHand && !hand.voided && me.cards && !me.shown) {
    return bar(h('button.btn', { onClick: () => ctx.send('show') }, me.won ? 'Show my cards (I won!)' : 'Show my cards'));
  }
  if (g.phase === 'waiting') return bar(hint('Waiting for more players with chips…'));
  return bar(hint(st.playing ? 'You will be dealt in next hand' : 'Next hand coming up…'));
}

function turnBar(st, bar) {
  const { ctx, hand } = st;
  const o = hand.options;
  const armed = ctx.S.ui.armed && Date.now() - ctx.S.ui.armed.at < 3000 ? ctx.S.ui.armed.what : null;
  // Going all in takes two taps, so a slip of the finger can't cost you everything.
  const arm = (what, fn) => () => {
    if (armed === what) return fn();
    ctx.S.ui.armed = { what, at: Date.now() };
    ctx.render();
    setTimeout(() => ctx.render(), 3100);
  };
  const kids = [];
  if (!o.canCheck) kids.push(h('button.btn.fold', { onClick: () => ctx.act('fold') }, 'Fold'));
  if (o.canCheck) kids.push(h('button.btn.check', { onClick: () => ctx.act('check') }, 'Check'));
  else if (o.callAllIn) {
    kids.push(h('button.btn.call', { class: { armed: armed === 'call' }, onClick: arm('call', () => ctx.act('call')) }, armed === 'call' ? 'Tap again: all in' : `Call ${fmt(o.toCall)} (all in)`));
  } else kids.push(h('button.btn.call', { onClick: () => ctx.act('call') }, `Call ${fmt(o.toCall)}`));
  if (o.canRaise) {
    if (o.minTo === o.maxTo) {
      kids.push(h('button.btn.raise', { class: { armed: armed === 'raise' }, onClick: arm('raise', () => ctx.act('raise', o.maxTo)) }, armed === 'raise' ? 'Tap again: all in' : `All in ${fmt(o.maxTo)}`));
    } else kids.push(h('button.btn.raise', { onClick: () => ctx.openRaise(o.minTo) }, o.kind === 'bet' ? 'Bet…' : 'Raise…'));
  }
  return bar(...kids);
}

// The chips to round raises to: the biggest of these that divides the small blind.
function unitFor(sb) {
  return [1000, 500, 100, 50, 25, 10, 5, 1].find((u) => sb % u === 0) ?? 1;
}

function raisePanel(st) {
  const { ctx, hand } = st;
  const o = hand.options;
  const [sb, bb] = hand.blinds;
  const unit = unitFor(sb);
  const clamp = (x) => Math.max(o.minTo, Math.min(o.maxTo, x));
  const snap = (x) => clamp(x >= o.maxTo ? o.maxTo : Math.round(x / unit) * unit);
  const amount = clamp(ctx.S.ui.raise);
  const potTo = (f) => snap(hand.currentBet + (o.pot + o.toCall) * f);
  const presets = [
    ['Min', o.minTo],
    ['½ pot', potTo(0.5)],
    ['¾ pot', potTo(0.75)],
    ['Pot', potTo(1)],
    ['All in', o.maxTo],
  ];
  const allIn = amount === o.maxTo;
  const word = o.kind === 'bet' ? 'Bet' : 'Raise to';
  return h(
    'footer.actions.raise-panel',
    h(
      'div.raise-amt',
      h('button.step', { 'aria-label': 'Less', disabled: amount <= o.minTo, onClick: () => ctx.setRaise(snap(amount - bb)) }, '−'),
      h('div.amt', h('small', allIn ? 'All in' : word), h('b', fmt(amount)), h('small', `Pot ${fmt(o.pot)}`)),
      h('button.step', { 'aria-label': 'More', disabled: amount >= o.maxTo, onClick: () => ctx.setRaise(snap(amount + bb)) }, '+'),
    ),
    h('input.slider', {
      style: { '--pct': `${((amount - o.minTo) / Math.max(1, o.maxTo - o.minTo)) * 100}%` },
      type: 'range',
      min: o.minTo,
      max: o.maxTo,
      step: unit,
      value: amount,
      'aria-label': 'Amount',
      onInput: (e) => {
        const x = Number(e.target.value);
        ctx.setRaise(x > o.maxTo - unit ? o.maxTo : x);
      },
    }),
    h(
      'div.presets',
      presets.map(([text, x]) => h('button', { type: 'button', class: { on: x === amount }, onClick: () => ctx.setRaise(x) }, text)),
    ),
    h(
      'div.raise-go',
      h('button.btn', { onClick: () => ctx.closeRaise() }, 'Back'),
      h('button.btn.primary', { class: { allin: allIn }, onClick: () => ctx.act('raise', amount) }, allIn ? `All in ${fmt(amount)}` : `${word} ${fmt(amount)}`),
    ),
  );
}
