// Bottom sheets: menu, how to play, standings, hand history, game over, prompts.

import { h } from '../h.js';
import { cardEl, fmt, fmtSigned, SUIT, SUIT_HINDI } from '../cards.js';
import { isMuted } from '../sound.js';
import { namer, ordinal } from '../text.js';
import { seg, memberRow, TIMER_CHOICES, BLINDS_UP_CHOICES } from './lobby.js';

function sheet(ctx, title, body, { closable = true, id = '' } = {}) {
  const close = () => ctx.closeSheet();
  return h(
    'div.sheet-wrap',
    { onClick: (e) => closable && e.target === e.currentTarget && close() },
    h(
      'div.sheet',
      { dataset: { sheet: id || title } },
      h('header', h('h2', title), closable && h('button.icon-btn', { 'aria-label': 'Close', onClick: close }, '✕')),
      h('div.sheet-body', body),
    ),
  );
}

export function renderSheet(ctx, name, data) {
  switch (name) {
    case 'rules': return rulesSheet(ctx);
    case 'standings': return standingsSheet(ctx);
    case 'log': return logSheet(ctx);
    case 'menu': return menuSheet(ctx);
    case 'confirm': return confirmSheet(ctx, data);
    default: return null;
  }
}

// ------------------------------------------------------------------ rules

const parse = (s) => s.split(' ').map((x) => ({ r: x.slice(0, -1), s: x.slice(-1) }));
const RANKINGS = [
  ['Royal Flush', 'AS KS QS JS 10S', 'A, K, Q, J, 10, all the same suit'],
  ['Straight Flush', '9H 8H 7H 6H 5H', 'Five in a row, all the same suit'],
  ['Four of a Kind', '7C 7D 7H 7S KD', 'Four cards of the same rank'],
  ['Full House', 'KS KH KD 6C 6S', 'Three of a kind plus a pair'],
  ['Flush', 'AD JD 8D 5D 2D', 'Any five of the same suit'],
  ['Straight', '10C 9D 8S 7H 6C', 'Five in a row (A-2-3-4-5 counts too)'],
  ['Three of a Kind', '8S 8H 8D KC 3S', 'Three cards of the same rank'],
  ['Two Pair', 'JH JC 4S 4D AH', 'Two different pairs'],
  ['Pair', '10S 10H KD 7C 4H', 'Two cards of the same rank'],
  ['High Card', 'AC QD 9S 6H 3C', 'None of the above: highest card plays'],
];

function rankings() {
  return h(
    'ol.rankings',
    RANKINGS.map(([name, cards, what]) =>
      h('li', h('div.rk-cards', parse(cards).map((c) => cardEl(c, { size: 'sm' }))), h('div.rk-txt', h('b', name), h('small', what))),
    ),
  );
}

function rulesSheet(ctx) {
  return sheet(ctx, 'How to play', [
    h('p.lead', "Texas Hold'em: make the best five-card hand from your 2 cards and the 5 cards everyone shares in the middle. Win chips by having the best hand, or by betting so that everyone else folds."),
    h('h3', 'A hand, step by step'),
    h(
      'ol.rules',
      h('li', h('b', 'Blinds. '), 'The two players to the left of the dealer button (D) put in the small and big blind, so there is something to win.'),
      h('li', h('b', 'Your 2 cards. '), 'Everyone gets two cards that only they can see.'),
      h('li', h('b', 'Betting. '), 'Starting left of the big blind, each player folds, calls or raises.'),
      h('li', h('b', 'The flop. '), 'Three cards are turned up in the middle. Another round of betting.'),
      h('li', h('b', 'The turn, then the river. '), 'One more card each, with a round of betting after each.'),
      h('li', h('b', 'Showdown. '), 'Players still in show their cards. The best five-card hand wins the pot; equal hands split it.'),
    ),
    h('p', 'The dealer button moves one seat to the left after every hand.'),
    h('h3', 'On your turn'),
    h(
      'ul.rules',
      h('li', h('b', 'Fold: '), 'give up this hand.'),
      h('li', h('b', 'Check: '), 'pass without betting (only when nobody has bet).'),
      h('li', h('b', 'Call: '), 'match the bet.'),
      h('li', h('b', 'Bet or raise: '), 'put in more. A raise must be at least as big as the last bet or raise. Use the slider, or ½ pot, Pot and All in.'),
      h('li', h('b', 'All in: '), 'put in all your chips. You can never lose more than you put in.'),
    ),
    h('p.muted', 'Waiting for others? Tick Check / Fold and it happens as soon as it is your turn.'),
    h('h3', 'Hands, best to worst'),
    rankings(),
    h('p.muted', 'Under your cards you always see the best hand you have right now.'),
    h('h3', 'All in and side pots'),
    h('p', 'If someone is all in with fewer chips, they can only win as much from each player as they put in themselves. The extra bets go into a side pot that only the others can win.'),
    h('h3', 'Cash game or tournament'),
    h(
      'ul.rules',
      h('li', h('b', 'Cash game: '), 'run out of chips and you can rebuy. The blinds stay the same. The host ends the game, and whoever is up the most wins.'),
      h('li', h('b', 'Tournament: '), 'no rebuys, and the blinds go up every few minutes. Run out of chips and you are out. The last player with chips wins.'),
    ),
    h('h3', 'Good to know'),
    h(
      'ul.rules',
      h('li', 'Chips only. No real money is involved.'),
      h('li', 'If you are offline or out of time, you check if you can and fold if not. Miss two turns in a row and you sit out until you tap I’m back.'),
      h('li', 'After a hand, anyone who played it can tap Show my cards.'),
      h('li', `Suits: ${SUIT.S} ${SUIT_HINDI.S}, ${SUIT.H} ${SUIT_HINDI.H}, ${SUIT.C} ${SUIT_HINDI.C}, ${SUIT.D} ${SUIT_HINDI.D}. All four suits are equal.`),
    ),
  ]);
}

// -------------------------------------------------------------- standings

function rows(v) {
  const g = v.game;
  const stack = g.rules.stack;
  const list = [
    ...g.players.map((p) => ({ id: p.id, name: p.name, stack: p.stack, buyins: p.buyins, place: p.place, left: false })),
    ...g.gone.map((p) => ({ ...p, left: true })),
  ];
  for (const r of list) r.net = r.stack - r.buyins * stack;
  if (g.rules.mode === 'tourney') list.sort((a, b) => (a.place ?? 0) - (b.place ?? 0) || b.stack - a.stack);
  else list.sort((a, b) => b.net - a.net);
  return list;
}

function standingsTable(ctx) {
  const v = ctx.view;
  const g = v.game;
  const name = namer(v);
  const tourney = g.rules.mode === 'tourney';
  return h(
    'div.scroll-x',
    h(
      'table.scores',
      h('thead', h('tr', h('th', 'Player'), h('th', 'Chips'), tourney ? h('th', 'Place') : [h('th', 'Buy-ins'), h('th', '+/−')])),
      h(
        'tbody',
        rows(v).map((r) =>
          h(
            'tr',
            { class: { me: r.id === v.me, gone: r.left } },
            h('td', name(r.id, r.name), r.left && h('small', ' (left)')),
            h('td', fmt(r.stack)),
            tourney
              ? h('td', r.place ? ordinal(r.place) : '—')
              : [h('td', String(r.buyins)), h('td.tot', { class: { up: r.net > 0, down: r.net < 0 } }, fmtSigned(r.net))],
          ),
        ),
      ),
    ),
  );
}

function standingsSheet(ctx) {
  const g = ctx.view?.game;
  if (!g) return sheet(ctx, 'Standings', h('p', 'No game yet.'));
  return sheet(ctx, 'Standings', [
    standingsTable(ctx),
    h(
      'p.muted',
      g.rules.mode === 'tourney'
        ? 'Tournament: the last player with chips wins.'
        : `Cash game: everyone bought in for ${fmt(g.rules.stack)} chips a time. +/− is chips now minus chips bought.`,
    ),
  ]);
}

// -------------------------------------------------------------------- log

function logSheet(ctx) {
  const lines = [...ctx.S.log].reverse();
  return sheet(ctx, 'Hand history', lines.length ? h('ol.log', lines.map((l) => h('li', { class: { head: l.hand } }, l.text))) : h('p.muted', 'Nothing yet.'));
}

// ------------------------------------------------------------------- menu

function menuSheet(ctx) {
  const v = ctx.view;
  const g = v?.game;
  const isHost = v?.host === v?.me;
  const me = g?.players.find((p) => p.id === v.me);
  const item = (icon, label, onClick) => h('button.menu-item', { onClick }, h('span.mi-icon', icon), h('span', label));
  const current = g?.phase === 'hand' && g.hand.toAct && !g.hand.runout ? namer(v)(g.hand.toAct) : null;
  const done = (fn) => () => {
    ctx.closeSheet();
    fn();
  };
  return sheet(ctx, 'Menu', [
    h(
      'div.menu-grid',
      item('📖', 'How to play', () => ctx.openSheet('rules')),
      g && item('🏆', 'Standings', () => ctx.openSheet('standings')),
      g && item('📜', 'Hand history', () => ctx.openSheet('log')),
      item(isMuted() ? '🔇' : '🔊', isMuted() ? 'Sound is off' : 'Sound is on', () => ctx.toggleSound()),
      v && item('🔗', `Invite (${v.code})`, () => ctx.shareLink()),
      me && g.phase !== 'gameOver' && (me.out ? item('▶️', "I'm back", done(() => ctx.send('sitIn'))) : item('☕', 'Sit out', done(() => ctx.send('sitOut')))),
      me && g.rules.mode === 'cash' && me.stack === 0 && g.phase !== 'gameOver' && item('🪙', `Rebuy ${fmt(g.rules.stack)}`, done(() => ctx.send('rebuy'))),
    ),
    me?.out && h('p.muted', 'Sitting out: you are not dealt in until you tap I’m back.'),
    isHost &&
      g &&
      g.phase !== 'gameOver' &&
      h(
        'section.host-tools',
        h('h3', 'Host controls'),
        h('div.setting', h('span', 'Turn timer'), seg(TIMER_CHOICES, v.settings.turnTimer, (x) => ctx.send('settings', { settings: { turnTimer: x } }))),
        g.rules.mode === 'tourney' &&
          h('div.setting', h('span', 'Blinds go up every'), seg(BLINDS_UP_CHOICES, v.settings.blindsUp, (x) => ctx.send('settings', { settings: { blindsUp: x } }))),
        h(
          'div.row.wrap',
          v.paused
            ? h('button.btn', { onClick: () => ctx.send('resume') }, '▶ Resume')
            : h('button.btn', { onClick: () => ctx.send('pause') }, '⏸ Pause'),
          current && h('button.btn', { onClick: () => ctx.send('skip') }, `⏭ ${current === 'You' ? 'Skip my turn' : `Skip ${current}`}`),
          g.rules.mode === 'cash' && g.players.length < 10 && h('button.btn', { onClick: () => ctx.send('addBot') }, '+ Computer player'),
        ),
        current && h('p.muted', 'Skip checks if possible, otherwise folds.'),
        h(
          'button.btn.danger.wide',
          {
            onClick: () =>
              ctx.confirm({
                title: 'End this game?',
                text: g.phase === 'hand' ? 'The hand being played is called off and everyone gets their bets back. Then you see the final standings.' : 'You will see the final standings.',
                yes: 'End game',
                onYes: () => ctx.send('end'),
              }),
          },
          'End game',
        ),
      ),
    v && h('section', h('h3', 'People in this room'), h('ul.plist', v.members.map((m) => memberRow(ctx, m, { tools: isHost })))),
    v &&
      h(
        'button.btn.danger.ghost.wide',
        {
          onClick: () =>
            ctx.confirm({
              title: 'Leave this room?',
              text: me ? 'If you are in a hand, you fold. Your chips leave the table with you.' : '',
              yes: 'Leave',
              onYes: () => ctx.send('leave'),
            }),
        },
        'Leave room',
      ),
  ]);
}

function confirmSheet(ctx, { title, text, yes, onYes }) {
  return sheet(ctx, title, [
    text && h('p', text),
    h(
      'div.sheet-actions',
      h(
        'button.btn.primary',
        {
          onClick: () => {
            ctx.closeSheet();
            onYes();
          },
        },
        yes,
      ),
      h('button.btn', { onClick: () => ctx.closeSheet() }, 'Cancel'),
    ),
  ]);
}

// ------------------------------------------------------ game over, claims

export function gameOverSheet(ctx) {
  const v = ctx.view;
  const g = v.game;
  const name = namer(v);
  const isHost = v.host === v.me;
  const winners = (g.winners ?? []).map((id) => name(id));
  const iWon = g.winners?.includes(v.me);
  const tourney = g.rules.mode === 'tourney';
  const list = rows(v);
  return sheet(
    ctx,
    'Game over',
    [
      h('div.trophy', iWon ? '🎉' : '🏆'),
      h('p.winner', winners.length ? `${winners.join(' & ')} ${winners.length > 1 || iWon ? 'win' : 'wins'}!` : 'Game over'),
      h('p.muted.center-text', tourney ? 'Last player with chips' : 'Most chips won'),
      h(
        'ol.standings',
        list.map((r) =>
          h(
            'li',
            { class: { me: r.id === v.me, win: g.winners?.includes(r.id) } },
            h('span', name(r.id, r.name), r.left && h('small', ' (left)')),
            h('b', tourney ? fmt(r.stack) : fmtSigned(r.net)),
          ),
        ),
      ),
      h(
        'div.sheet-actions',
        isHost
          ? h('button.btn.primary.big', { onClick: () => ctx.send('toLobby') }, 'Play again')
          : h('p.wait', 'Waiting for the host to start a new game…'),
        h('button.btn', { onClick: () => ctx.hideOver() }, 'Look at the table'),
      ),
    ],
    { closable: false, id: 'gameover' },
  );
}

export function claimSheet(ctx, claim) {
  const name = namer(ctx.view);
  return sheet(
    ctx,
    'Seat request',
    [
      h('p', `${name(claim.from)} wants to take over ${name(claim.seat)}'s seat (${name(claim.seat)} is offline).`),
      h('p.muted', 'Say yes if it is the same person on a new phone, or someone playing on their behalf.'),
      h(
        'div.sheet-actions',
        h('button.btn.primary', { onClick: () => ctx.send('resolveClaim', { id: claim.id, allow: true }) }, 'Allow'),
        h('button.btn', { onClick: () => ctx.send('resolveClaim', { id: claim.id, allow: false }) }, 'Say no'),
      ),
    ],
    { closable: false, id: 'claim' },
  );
}
