// The Teen Patti table: the same layout as Hold'em (other players on top,
// the pot in the middle, your cards at the bottom) with three cards each,
// blind and seen players, and the Teen Patti buttons.

import { h } from '../h.js';
import { cardEl, backEl, fmt, fmtShort, chipEl } from '../cards.js';
import { ordinal } from '../text.js';
import { tableState, topBar, ticker, watching, outcome, status, bar, hint, commonActions, betweenHands } from './table.js';

const ACTION = { boot: 'Boot', blind: 'Blind', chaal: 'Chaal', pack: 'Packed', fold: 'Packed', show: 'Show', sideshow: 'Sideshow', refuse: 'Refused', allin: 'All in' };

export function renderTeenPatti(ctx) {
  const st = tableState(ctx);
  const { v, g, hand } = st;
  const boot = hand && st.playing ? hand.boot : g.boot;
  return h(
    'main.screen.table.tp',
    { class: { 'my-turn': st.myTurn, paused: Boolean(v.paused) } },
    topBar(st, `Boot ${fmtShort(boot)}`),
    ticker(st),
    h('section.opps', h('div.opps-grid', { class: `n${Math.min(st.others.length, 9)}` }, st.others.map((p) => seat(st, p)))),
    felt(st),
    status(st),
    st.me ? hero(st) : watching(st),
    actions(st),
  );
}

// ------------------------------------------------------------- players

function label(st, p) {
  const { g, hand } = st;
  if (st.playing && hand.toAct === p.id && p.id !== st.v.me) {
    return { text: hand.sideshow ? 'Sideshow?' : 'Thinking…', cls: 'thinking' };
  }
  if (p.inHand && st.over && hand.results && !hand.voided) {
    if (p.best && p.shown) return { text: p.best.short, cls: p.won ? 'won' : '' };
    if (p.folded) return { text: 'Packed', cls: 'muted' };
    return { text: '', cls: '' };
  }
  if (p.inHand && p.folded) return { text: 'Packed', cls: 'muted' };
  if (p.inHand && p.action && p.action.t !== 'boot' && !p.allIn) {
    const a = p.action;
    const amount = a.n && a.t !== 'boot' ? ` ${fmtShort(a.n)}` : '';
    return { text: `${a.raise ? '2x ' : ''}${ACTION[a.t] ?? ''}${amount}`, cls: a.raise ? 'raise' : a.t };
  }
  if (p.busted) return { text: g.rules.mode === 'tourney' && p.place ? `Out · ${ordinal(p.place)}` : 'Out of chips', cls: 'muted' };
  if (p.out) return { text: p.out === 'away' ? 'Away' : 'Sitting out', cls: 'muted' };
  if (!p.inHand && st.playing) return { text: 'Next hand', cls: 'muted' };
  return { text: '', cls: '' };
}

function cardsOf(p, size) {
  if (!p.cards) return [];
  return p.cards.map((c, i) => (c ? cardEl(c, { size, key: `hole:${p.id}:${i}` }) : backEl({ size, key: `hole:${p.id}:${i}` })));
}

// Blind or seen: everyone can see which.
const seenTag = (p) => h('span.seen-tag', { class: { seen: p.seen } }, p.seen ? 'Seen' : 'Blind');

function seat(st, p) {
  const { v, hand } = st;
  const m = v.members.find((x) => x.id === p.id);
  const lab = label(st, p);
  const live = st.playing && p.inHand && !p.folded;
  return h(
    'div.seat',
    {
      class: {
        turn: st.playing && hand.toAct === p.id,
        folded: p.inHand && p.folded,
        allin: p.allIn,
        out: !p.inHand,
        won: st.over && p.won > 0,
        off: m && !m.connected && !m.bot,
        asked: Boolean(hand?.sideshow && (hand.sideshow.from === p.id || hand.sideshow.to === p.id)),
      },
      dataset: { key: `seat:${p.id}` },
    },
    h(
      'div.seat-top',
      h('span.dot', { class: { on: m?.connected } }),
      h('span.nm', p.name),
      m?.bot && h('span.bot', '🤖'),
      hand?.button === p.id && h('span.dealer', { title: 'Dealer' }, 'D'),
    ),
    // Three cards leave little room, so 1,810 shows as 1.8K here (the standings have it exactly).
    h('div.seat-mid', h('div.hole.three', cardsOf(p, 'sm')), h('span.stack', fmtShort(p.stack, 1000))),
    h(
      'div.seat-bot',
      live && seenTag(p),
      h('span.act', { class: lab.cls }, lab.text),
      p.allIn && h('span.allin-tag', 'ALL IN'),
      st.over && p.won > 0 && h('span.won-amt', `+${fmtShort(p.won)}`),
    ),
  );
}

function hero(st) {
  const { ctx, g, hand, me } = st;
  const lab = label(st, me);
  const live = st.playing && me.inHand && !me.folded;
  const blind = live && !me.seen;
  let note = null;
  if (!me.inHand) {
    if (me.busted) note = g.rules.mode === 'cash' ? 'You are out of chips' : `You finished ${ordinal(me.place ?? 0)}`;
    else if (me.out) note = me.out === 'away' ? 'You were away, so you are sitting out' : 'You are sitting out';
    else if (st.playing) note = 'You will be dealt in next hand';
  } else if (blind) note = 'Playing blind: you haven’t looked';
  else if (me.folded && st.playing) note = 'You packed';
  const cards = me.cards ? cardsOf(me, 'lg') : [h('div.card.lg.empty'), h('div.card.lg.empty'), h('div.card.lg.empty')];
  return h(
    'section.hero.tp',
    { class: { turn: st.myTurn, folded: me.inHand && me.folded, won: st.over && me.won > 0 }, dataset: { key: `seat:${me.id}` } },
    blind
      ? h('button.me-cards.three.see', { 'aria-label': 'See my cards', onClick: () => ctx.send('see') }, cards, h('span.see-cta', 'Tap to see'))
      : h('div.me-cards.three', cards),
    h(
      'div.me-info',
      h('div.me-top', h('b', 'You'), hand?.button === me.id && h('span.dealer', 'D'), h('span.stack', chipEl(), fmt(me.stack))),
      me.best && !(me.folded && st.playing) && h('div.me-hand', { class: { won: st.over && me.won > 0 } }, me.best.name),
      note && h('div.me-note', note),
      h(
        'div.me-bet',
        live && seenTag(me),
        lab.text && !(st.over && me.best) && !(me.folded && st.playing) && h('span.act', { class: lab.cls }, lab.text),
        me.allIn && h('span.allin-tag', 'ALL IN'),
        st.over && me.won > 0 ? h('span.won-amt', `+${fmt(me.won)}`) : me.inHand && st.playing && h('span.in-pot', `In the pot: ${fmt(me.total)}`),
      ),
    ),
  );
}

// --------------------------------------------------------------- middle

function felt(st) {
  const { hand, name } = st;
  const playing = st.playing && !hand.voided;
  const lastPot = hand?.results ? hand.results.pots.reduce((a, p) => a + p.amount, 0) : 0;
  let msg;
  if (playing) {
    const ss = hand.sideshow;
    if (ss) msg = [h('b', 'Sideshow?'), h('span', ss.to === st.v.me ? `${name(ss.from)} asked you` : `${name(ss.from)} asked ${name(ss.to)}`)];
    else if (st.myTurn) msg = [h('b', 'Your turn')];
    else msg = [h('b', `${name(hand.toAct)}${hand.toAct === st.v.me ? '' : "'s"} turn`)];
  } else msg = outcome(st);
  return h(
    'section.felt.tp',
    h(
      'div.felt-top',
      h('span.deck', { dataset: { key: 'deck' } }, backEl({ size: 'xs' })),
      h('span.pot', { dataset: { key: 'pot' }, class: { empty: !playing } }, chipEl('big'), playing ? `Pot ${fmt(hand.pot)}` : lastPot ? `Pot ${fmt(lastPot)}` : 'Pot'),
      playing && hand.limit > 0 && h('span.side', `Limit ${fmtShort(hand.limit)}`),
    ),
    playing && hand.pots.length > 1 && h('div.side', hand.pots.map((x, i) => `${i ? 'Side' : 'Main'} ${fmtShort(x)}`).join(' · ')),
    playing &&
      h(
        'div.tp-stake',
        h('span', 'Blind ', h('b', fmt(hand.stake))),
        h('span', 'Chaal ', h('b', fmt(hand.stake * 2))),
      ),
    h('div.felt-msg', msg),
  );
}

// ------------------------------------------------------------- buttons

function actions(st) {
  const { ctx, hand, me } = st;
  const common = commonActions(st);
  if (common) return common;
  if (st.myTurn) return hand.options.reply ? replyBar(st) : turnBar(st);
  const mine = st.playing && me.inHand ? me : null;
  if (mine && !mine.folded) {
    // You can look at your cards any time, even when it isn't your turn.
    if (!mine.seen) return bar(h('button.btn.see', { onClick: () => ctx.send('see') }, '👀 See my cards'));
    return bar(hint(mine.allIn ? "You're all in. Good luck!" : `Waiting for ${st.name(hand.toAct)}…`));
  }
  if (mine?.folded) return bar(hint('You packed. Waiting for the hand to finish…'));
  return betweenHands(st);
}

function turnBar(st) {
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
  const word = o.seen ? 'Chaal' : 'Blind';
  const main = [
    h('button.btn.fold', { onClick: () => ctx.act('pack') }, 'Pack'),
    o.betAllIn
      ? h('button.btn.call', { class: { armed: armed === 'bet' }, onClick: arm('bet', () => ctx.act('bet')) }, armed === 'bet' ? 'Tap again: all in' : `All in ${fmt(o.bet)}`)
      : h('button.btn.call', { onClick: () => ctx.act('bet') }, `${word} ${fmt(o.bet)}`),
    o.canRaise &&
      (o.raiseAllIn
        ? h('button.btn.raise', { class: { armed: armed === 'raise' }, onClick: arm('raise', () => ctx.act('raise')) }, armed === 'raise' ? 'Tap again: all in' : `All in ${fmt(o.raise)}`)
        : h('button.btn.raise', { onClick: () => ctx.act('raise') }, `2x · ${fmt(o.raise)}`)),
  ];
  const extra = [
    !o.seen && h('button.btn.see', { onClick: () => ctx.send('see') }, '👀 See'),
    o.canShow && h('button.btn.show', { onClick: () => ctx.act('askShow') }, `Show · ${fmt(o.show)}`),
    o.canSideshow && h('button.btn.side', { onClick: () => ctx.act('sideshow') }, `Sideshow · ${fmt(o.sideshow)}`),
  ].filter(Boolean);
  return h('footer.actions.tp-turn', h('div.tp-row', main), extra.length > 0 && h('div.tp-row.extra', extra));
}

function replyBar(st) {
  const { ctx, hand, name } = st;
  const from = name(hand.options.reply.from);
  return bar(
    hint(`${from} wants a sideshow: you see each other's cards and the lower hand packs (on a tie, ${from} packs).`),
    h('button.btn.primary', { onClick: () => ctx.act('reply', true) }, 'Accept'),
    h('button.btn', { onClick: () => ctx.act('reply', false) }, 'Refuse'),
  );
}
