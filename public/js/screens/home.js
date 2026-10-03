import { h } from '../h.js';
import { cardEl } from '../cards.js';

export function renderHome(ctx) {
  const { S } = ctx;
  const code = S.urlCode;

  const nameInput = h('input.inp', {
    dataset: { focusKey: 'name' },
    value: S.name,
    maxLength: 16,
    placeholder: 'e.g. Mayank',
    autocomplete: 'nickname',
    enterKeyHint: 'go',
    onInput: (e) => (S.name = e.target.value),
  });
  const codeInput = h('input.inp.code-inp', {
    dataset: { focusKey: 'code' },
    value: S.joinCode,
    maxLength: 4,
    placeholder: 'ABCD',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    onInput: (e) => {
      S.joinCode = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      e.target.value = S.joinCode;
    },
  });

  const fan = h(
    'div.fan',
    [{ r: '10', s: 'S' }, { r: 'J', s: 'S' }, { r: 'Q', s: 'S' }, { r: 'K', s: 'S' }, { r: 'A', s: 'S' }].map((c, i) =>
      h('div.fan-card', { style: { '--i': String(i) } }, cardEl(c, { size: 'md' })),
    ),
    h('div.fan-chips', h('i.chip.c1'), h('i.chip.c2'), h('i.chip.c3')),
  );

  return h(
    'main.screen.home',
    h('div.brand', fan, h('h1', 'Poker'), h('p.tagline', "Texas Hold'em and Teen Patti with family and friends. Chips only, no money.")),
    h(
      'form.panel',
      {
        onSubmit: (e) => {
          e.preventDefault();
          ctx.start(code ? 'join' : 'create', code);
        },
      },
      h('label.field', h('span', 'Your name'), nameInput),
      code
        ? [
            h('button.btn.primary.big', { type: 'submit', disabled: S.busy }, `Join room ${code}`),
            h('button.btn.link', { type: 'button', onClick: () => ctx.forgetUrlCode() }, 'Create or join a different room'),
          ]
        : [
            h('button.btn.primary.big', { type: 'submit', disabled: S.busy }, 'Create a table'),
            h('div.or', h('span', 'or join one')),
            h('div.row', codeInput, h('button.btn', { type: 'button', disabled: S.busy, onClick: () => ctx.start('join') }, 'Join')),
          ],
      S.homeError && h('p.err', S.homeError),
    ),
    h('button.btn.link', { onClick: () => ctx.openSheet('rules') }, 'How to play'),
    !S.connected && h('p.muted.center-text', 'Connecting to the server…'),
  );
}
