import { h } from '../h.js';
import { fmt } from '../cards.js';

export const TIMER_CHOICES = [
  [0, 'Off'],
  [20, '20s'],
  [30, '30s'],
  [45, '45s'],
  [60, '60s'],
  [90, '90s'],
];
export const BLINDS_UP_CHOICES = [
  [10, '10 min'],
  [15, '15 min'],
  [20, '20 min'],
  [30, '30 min'],
];
// Starting blinds the host can pick: [index into the server's blind ladder, label, big blind]
const BLIND_CHOICES = [
  [0, '5/10', 10],
  [1, '10/20', 20],
  [3, '25/50', 50],
  [5, '50/100', 100],
  [7, '100/200', 200],
];
const STACK_CHOICES = [
  [500, '500'],
  [1000, '1,000'],
  [2000, '2,000'],
  [5000, '5,000'],
  [10000, '10,000'],
];

export function seg(options, value, onPick, disabled = false) {
  return h(
    'div.seg',
    options.map(([val, label]) =>
      h('button', { type: 'button', class: { on: val === value }, disabled, onClick: () => val !== value && onPick(val) }, label),
    ),
  );
}

export function memberRow(ctx, m, { tools = false } = {}) {
  const v = ctx.view;
  const isMe = m.id === v.me;
  return h(
    'li.member',
    h('span.dot', { class: { on: m.connected } }),
    h('span.nm', m.name),
    m.bot && h('span.tag', 'computer'),
    m.id === v.host && h('span.tag.host', 'host'),
    isMe && h('span.tag.you', 'you'),
    !m.connected && !m.bot && h('span.tag', 'offline'),
    tools &&
      !isMe && [
        !m.bot && h('button.mini-btn', { onClick: () => ctx.send('makeHost', { id: m.id }) }, 'Make host'),
        h(
          'button.mini-btn.danger',
          {
            onClick: () =>
              ctx.confirm({
                title: `Remove ${m.name}?`,
                text: v.game ? 'If they are in a hand, they fold. Their chips leave the table.' : '',
                yes: 'Remove',
                onYes: () => ctx.send('kick', { id: m.id }),
              }),
          },
          'Remove',
        ),
      ],
  );
}

export function renderLobby(ctx) {
  const v = ctx.view;
  const s = v.settings;
  const isHost = v.host === v.me;
  const players = v.members.filter((m) => m.playing);
  const watchers = v.members.filter((m) => !m.playing);
  const ready = players.filter((m) => m.bot || m.connected).length;
  const hostName = v.members.find((m) => m.id === v.host)?.name ?? 'the host';
  const set = (patch) => ctx.send('settings', { settings: patch });
  const ro = !isHost;
  const bb = BLIND_CHOICES.find((b) => b[0] === s.blinds)?.[2] ?? 20;
  const tourney = s.mode === 'tourney';

  return h(
    'main.screen.lobby',
    h(
      'header.lobby-head',
      h('button.icon-btn', { 'aria-label': 'Leave room', onClick: () => ctx.confirmLeave() }, '←'),
      h('div.room', h('span.label', 'Room code'), h('span.code', v.code)),
      h('button.icon-btn', { 'aria-label': 'How to play', onClick: () => ctx.openSheet('rules') }, '?'),
    ),
    h(
      'section.invite.panel',
      h('p', 'Invite everyone. They open the link on their phone and type their name.'),
      h(
        'div.row',
        h('a.btn.wa', { href: ctx.whatsappLink(), target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        navigator.share && h('button.btn', { onClick: () => ctx.shareLink() }, 'Share'),
        h('button.btn', { onClick: () => ctx.copyLink() }, 'Copy link'),
      ),
      h('p.link', ctx.roomLink()),
    ),
    h(
      'section.panel',
      h('h2', 'Players ', h('span.count', `${players.length}/10`)),
      h('ul.plist', players.map((m) => memberRow(ctx, m, { tools: isHost }))),
      isHost &&
        players.length < 10 &&
        h('button.btn.ghost.wide', { onClick: () => ctx.send('addBot') }, '+ Add a computer player'),
      watchers.length > 0 && [h('h3', 'Watching'), h('ul.plist', watchers.map((m) => memberRow(ctx, m, { tools: isHost })))],
    ),
    h(
      'section.panel.rules-panel',
      h('h2', 'Table', ro && h('small', ` (set by ${hostName})`)),
      h(
        'div.setting',
        h('span', 'Game'),
        seg(
          [
            ['cash', 'Cash game'],
            ['tourney', 'Tournament'],
          ],
          s.mode,
          (x) => set({ mode: x }),
          ro,
        ),
        h(
          'small.hint',
          tourney
            ? 'No rebuys and the blinds go up. Last player with chips wins.'
            : 'Run out of chips? Rebuy and keep playing. Fixed blinds; the host ends the game, and whoever is up the most wins.',
        ),
      ),
      h('div.setting', h('span', 'Starting chips'), seg(STACK_CHOICES, s.stack, (x) => set({ stack: x }), ro)),
      h(
        'div.setting',
        h('span', 'Blinds (small/big)'),
        seg(BLIND_CHOICES.map(([i, label]) => [i, label]), s.blinds, (x) => set({ blinds: x }), ro),
        h('small.hint', `Everyone starts with ${fmt(s.stack)} chips, which is ${fmt(Math.floor(s.stack / bb))} big blinds.`),
      ),
      tourney && h('div.setting', h('span', 'Blinds go up every'), seg(BLINDS_UP_CHOICES, s.blindsUp, (x) => set({ blindsUp: x }), ro)),
      h('div.setting', h('span', 'Turn timer'), seg(TIMER_CHOICES, s.turnTimer, (x) => set({ turnTimer: x }), ro)),
    ),
    h(
      'footer.lobby-foot',
      isHost
        ? h(
            'button.btn.primary.big',
            { disabled: ready < 2, onClick: () => ctx.send('start') },
            ready < 2 ? 'Waiting for at least 2 players' : `Deal! (${ready} players)`,
          )
        : h('p.wait', `Waiting for ${hostName} to start the game…`),
    ),
  );
}
