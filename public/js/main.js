// Poker client: keeps the connection, holds the latest view from the server,
// and redraws the screen. The server decides everything; this only shows it.

import { h, morph } from './h.js';
import { backEl, cardEl } from './cards.js';
import { describe, namer, QUIPS } from './text.js';
import { sfx, haptic, speak, unlockAudio, isMuted, setMuted } from './sound.js';
import { snapshot, fly, flyChips, keyed, pulse } from './anim.js';
import { renderHome } from './screens/home.js';
import { renderLobby } from './screens/lobby.js';
import { renderTable } from './screens/table.js';
import { renderSheet, gameOverSheet, claimSheet } from './screens/sheets.js';

const store = {
  get(k, d = null) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

function newToken() {
  const t = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  store.set('poker.token', t);
  return t;
}

const pathCode = (location.pathname.match(/^\/([A-Za-z]{4})\/?$/) || [])[1]?.toUpperCase() ?? null;

const S = {
  view: null,
  ui: { key: '', raise: null }, // raise: the amount while the raise slider is open
  pre: null, // { key, kind: 'checkFold' | 'check' } chosen before your turn
  log: [],
  sheet: null, // { name, data } opened by the player
  overHidden: false, // game-over sheet tucked away to look at the table
  connected: false,
  busy: false,
  homeError: null,
  deadline: 0,
  nextAt: 0,
  clockAt: 0,
  token: store.get('poker.token') || newToken(),
  name: store.get('poker.name', ''),
  joinCode: '',
  urlCode: pathCode,
};

// --------------------------------------------------------------- network

const socket = io({ reconnectionDelayMax: 4000 });

function emit(event, data) {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: 'Not connected. Trying to reconnect…' });
    socket.timeout(8000).emit(event, data, (err, res) => resolve(err ? { ok: false, error: 'No answer from the server. Check your connection.' } : res));
  });
}

async function send(type, args = {}) {
  unlockAudio();
  const res = await emit('cmd', { type, ...args });
  if (!res?.ok) {
    toast(res?.error ?? 'Something went wrong', 'error');
    sfx.error();
  }
  return res;
}

socket.on('connect', async () => {
  S.connected = true;
  const code = S.view?.code ?? store.get('poker.room');
  if (code && (!S.urlCode || S.urlCode === code || S.view)) {
    const res = await emit('rejoin', { code, token: S.token });
    if (!res.ok) {
      store.del('poker.room');
      if (S.view || S.urlCode === code) toast(res.error, 'error');
      if (/closed/.test(res.error ?? '') && S.urlCode === code) {
        S.urlCode = null;
        history.replaceState(null, '', '/');
      }
      S.view = null;
    }
  }
  render();
});

socket.on('disconnect', () => {
  S.connected = false;
  render();
});

socket.on('removed', ({ why }) => {
  store.del('poker.room');
  S.view = null;
  S.sheet = null;
  S.urlCode = null;
  S.log = [];
  history.replaceState(null, '', '/');
  toast(why === 'kicked' ? 'The host removed you from the room' : 'You left the room');
  keepAwake(false);
  render();
});

socket.on('state', ({ view, events, replay }) => {
  const before = S.view && !replay ? snapshot() : null;
  const prevGame = S.view?.game ?? null;
  S.view = view;
  S.urlCode = view.code;
  store.set('poker.room', view.code);
  if (location.pathname !== `/${view.code}`) history.replaceState(null, '', `/${view.code}`);
  const now = performance.now();
  if (view.timer) S.deadline = now + view.timer.left;
  if (view.next) S.nextAt = now + view.next.left;
  if (view.clock) S.clockAt = now + view.clock.left;

  if (replay) S.log = [];
  for (const ev of events) {
    const text = describe(ev, view);
    if (text) S.log.push({ seq: ev.seq, text, hand: ev.t === 'hand' });
  }
  if (S.log.length > 250) S.log.splice(0, S.log.length - 250);

  syncUi(view, prevGame);
  render();
  if (before && events.length) {
    // Nothing flies across a sheet someone is reading.
    if (!document.querySelector('#sheets .sheet')) animate(events, before, view);
    react(events, view);
  }
  runPreAction(view);
  keepAwake(Boolean(view.game));
});

// Choices in progress reset whenever the turn moves on.
function syncUi(v, prevGame) {
  const g = v.game;
  const h = g?.hand;
  const key = h ? `${h.no}:${h.street}:${h.toAct ?? ''}` : g ? g.phase : 'lobby';
  if (key !== S.ui.key) S.ui = { key, raise: null };
  if (S.pre && (!h || S.pre.key !== `${h.no}:${h.street}` || g.phase !== 'hand')) S.pre = null;
  if (!g || (prevGame && prevGame.phase === 'gameOver' && g.phase !== 'gameOver')) S.overHidden = false;
  if (!g && S.sheet?.name === 'standings') S.sheet = null;
}

// "Check / Fold" or "Check" picked before your turn: done as soon as it's your turn.
function runPreAction(v) {
  const h = v.game?.hand;
  const o = h?.options;
  if (!S.pre || !o || v.paused) return;
  const { kind } = S.pre;
  S.pre = null;
  if (o.canCheck) send('check');
  else if (kind === 'checkFold') send('fold');
  else {
    toast('Someone bet, so it’s your decision', 'warn');
    render();
  }
}

// --------------------------------------------------------------- render

const ctx = {
  S,
  get view() {
    return S.view;
  },
  send,
  render: () => render(),
  openSheet(name, data) {
    S.sheet = { name, data };
    render();
  },
  closeSheet() {
    S.sheet = null;
    render();
  },
  confirm(data) {
    S.sheet = { name: 'confirm', data };
    render();
  },
  confirmLeave() {
    ctx.confirm({ title: 'Leave this room?', text: '', yes: 'Leave', onYes: () => send('leave') });
  },
  openRaise(amount) {
    unlockAudio();
    S.ui.raise = amount;
    render();
  },
  setRaise(amount) {
    S.ui.raise = amount;
    render();
  },
  closeRaise() {
    S.ui.raise = null;
    render();
  },
  act(type, to) {
    S.ui.raise = null;
    S.pre = null;
    render();
    return send(type, to === undefined ? {} : { to });
  },
  togglePre(kind) {
    unlockAudio();
    const h = S.view?.game?.hand;
    if (!h) return;
    S.pre = S.pre?.kind === kind ? null : { key: `${h.no}:${h.street}`, kind };
    render();
  },
  hideOver() {
    S.overHidden = true;
    render();
  },
  showOver() {
    S.overHidden = false;
    S.sheet = null;
    render();
  },
  toggleSound() {
    setMuted(!isMuted());
    unlockAudio();
    if (!isMuted()) sfx.ping();
    render();
  },
  async start(kind, code) {
    unlockAudio();
    const name = (S.name || '').trim();
    if (!name) {
      S.homeError = 'Please type your name first';
      return render();
    }
    const joinCode = kind === 'join' ? (code || S.joinCode || '').toUpperCase() : null;
    if (kind === 'join' && !/^[A-Z]{4}$/.test(joinCode)) {
      S.homeError = 'Room codes have 4 letters';
      return render();
    }
    store.set('poker.name', name);
    S.homeError = null;
    S.busy = true;
    render();
    const res = await emit(kind, { name, token: S.token, code: joinCode });
    S.busy = false;
    if (!res.ok) {
      S.homeError = res.error;
      render();
    }
  },
  forgetUrlCode() {
    S.urlCode = null;
    history.replaceState(null, '', '/');
    render();
  },
  roomLink: () => `${location.origin}/${S.view?.code ?? ''}`,
  whatsappLink: () => `https://wa.me/?text=${encodeURIComponent(`Come play poker with me! Room ${S.view?.code}: ${ctx.roomLink()}`)}`,
  async shareLink() {
    const url = ctx.roomLink();
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Poker', text: `Come play poker with me! Room ${S.view?.code}`, url });
      } catch {}
    } else ctx.copyLink();
  },
  async copyLink() {
    try {
      await navigator.clipboard.writeText(ctx.roomLink());
      toast('Link copied. Paste it into WhatsApp.');
    } catch {
      window.prompt('Copy this link:', ctx.roomLink());
    }
  },
};

// Redraw by patching the current screen; switching screens starts afresh.
function patch(root, next) {
  const cur = root.firstElementChild;
  if (cur && next && cur.className.split(' ')[1] === next.className.split(' ')[1]) morph(cur, next);
  else root.replaceChildren(...(next ? [next] : []));
}

function render() {
  const v = S.view;
  patch(document.getElementById('app'), !v ? renderHome(ctx) : !v.game ? renderLobby(ctx) : renderTable(ctx));
  renderSheets();
  document.getElementById('conn').hidden = S.connected || !v;
  document.body.classList.toggle('in-game', Boolean(v?.game));
}

function renderSheets() {
  const root = document.getElementById('sheets');
  const v = S.view;
  const g = v?.game;
  let el = null;
  const claim = v && v.host === v.me && v.claims.find((c) => c.from !== v.me);
  if (claim) el = claimSheet(ctx, claim);
  else if (S.sheet) el = renderSheet(ctx, S.sheet.name, S.sheet.data);
  else if (g?.phase === 'gameOver' && !S.overHidden) el = gameOverSheet(ctx);
  const old = root.querySelector('.sheet');
  const same = old && el && old.dataset.sheet === el.querySelector('.sheet')?.dataset.sheet;
  if (same) morph(root.firstElementChild, el);
  else root.replaceChildren(...(el ? [el] : []));
}

// ------------------------------------------------------- feedback

function toast(text, kind = 'info') {
  const root = document.getElementById('toasts');
  const el = h('div.toast', { class: kind }, text);
  root.append(el);
  while (root.children.length > 2) root.firstChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }, kind === 'error' ? 3800 : 2800);
}

function banner(title, sub) {
  const el = h('div.banner', h('b', title), sub && h('span', sub));
  document.getElementById('fx').append(el);
  setTimeout(() => el.remove(), 2400);
}

// Sounds, vibration and pop-ups for things worth noticing.
function react(events, v) {
  const name = namer(v);
  const me = v.me;
  let chips = 0;
  const allIn = [];
  for (const ev of events) {
    switch (ev.t) {
      case 'deal':
        sfx.deal(ev.n);
        break;
      case 'turn':
        if (ev.pid === me) {
          sfx.turn();
          haptic(70);
        }
        break;
      case 'blind':
        chips += 1;
        break;
      case 'act':
        if (ev.a === 'fold') sfx.fold();
        else if (ev.a === 'check') sfx.check();
        else chips += ev.a === 'call' ? 2 : 3;
        if (ev.allIn) allIn.push(ev.pid);
        break;
      case 'street':
        sfx.flip();
        break;
      case 'reveal':
      case 'show':
        sfx.flip();
        break;
      case 'win': {
        if (ev.pid === me) {
          sfx.win();
          haptic([80, 50, 80]);
        } else chips += 4;
        const m = v.members.find((x) => x.id === ev.pid);
        if (m?.bot && ev.hand && QUIPS[m.name] && ev.n >= 10 * (v.game?.hand?.blinds[1] ?? 0)) toast(`🤖 ${m.name}: “${QUIPS[m.name]}”`);
        break;
      }
      case 'bust':
        if (ev.pid === me) {
          sfx.oops();
          toast(v.game?.rules.mode === 'cash' ? 'You are out of chips. Tap Rebuy to buy back in.' : describe(ev, v), 'warn');
        } else if (ev.place || !v.members.find((m) => m.id === ev.pid)?.bot) toast(describe(ev, v));
        break;
      case 'level':
        sfx.ping();
        toast(describe(ev, v), 'warn');
        break;
      case 'timeout':
        if (ev.pid === me) toast('You ran out of time', 'warn');
        break;
      case 'sitout':
        if (ev.pid === me && ev.why === 'away') toast('You are sitting out. Tap “I’m back” to play again.', 'warn');
        break;
      case 'gameOver':
        if (ev.winners.includes(me)) sfx.win();
        break;
      case 'join':
        sfx.ping();
        if (!v.game && !ev.bot) toast(describe(ev, v));
        break;
      case 'rebuy':
      case 'seated':
      case 'left':
      case 'kicked':
      case 'host':
      case 'pause':
      case 'resume':
      case 'takeover':
      case 'claimDenied': {
        if (ev.pid === me && (ev.t === 'rebuy' || ev.t === 'seated')) break;
        const text = describe(ev, v);
        if (text) toast(text);
        break;
      }
      case 'claim':
        if (v.host === me) sfx.ping();
        break;
      default:
    }
  }
  if (chips) sfx.chips(Math.min(chips, 6));
  if (allIn.length) {
    sfx.allin();
    speak('All in!');
    haptic([60, 40, 60]);
    const who = allIn.map((pid) => name(pid));
    banner('ALL IN', who.length === 1 ? (who[0] === 'You' ? 'You pushed all your chips in' : `${who[0]} pushed all their chips in`) : `${who.join(' & ')} are all in`);
  }
}

// Cards and chips fly between their old and new places.
function animate(events, before, v) {
  const after = snapshot();
  const g = v.game;
  let delay = 0;
  let swept = false;
  // Bets on the table slide into the pot (once per update).
  const sweep = (to) => {
    if (swept) return;
    swept = true;
    for (const [key, rect] of before) if (key.startsWith('bet:')) flyChips({ from: rect, to, n: 2, delay });
  };
  for (const ev of events) {
    switch (ev.t) {
      case 'deal': {
        const seats = (g?.players ?? []).filter((p) => p.inHand);
        const from = after.get('deck');
        seats.forEach((p, i) => {
          for (let k = 0; k < 2; k++) {
            const key = `hole:${p.id}:${k}`;
            const target = keyed(key);
            fly({ from, to: after.get(key), card: backEl({ size: 'sm' }), delay: delay + (k * seats.length + i) * 70, duration: 380, hide: target });
          }
        });
        delay += 140;
        break;
      }
      case 'blind':
      case 'act':
        if (ev.t === 'blind' || ev.a === 'call' || ev.a === 'bet' || ev.a === 'raise') {
          flyChips({ from: before.get(`seat:${ev.pid}`) ?? after.get(`seat:${ev.pid}`), to: after.get(`bet:${ev.pid}`), n: ev.allIn ? 4 : 2, delay });
          delay += 60;
        }
        break;
      case 'street': {
        // Bets are swept into the pot, then the new cards are dealt.
        sweep(after.get('pot'));
        const board = g?.hand?.board ?? [];
        ev.cards.forEach((c, i) => {
          const key = `board:${board.length - ev.cards.length + i}`;
          const target = keyed(key);
          fly({ from: after.get('deck'), to: after.get(key), card: cardEl(c, { size: 'md' }), delay: delay + 250 + i * 120, hide: target });
        });
        delay += 300;
        break;
      }
      case 'reveal':
      case 'show':
        for (const x of ev.hands ?? [{ pid: ev.pid }]) {
          pulse(keyed(`hole:${x.pid}:0`), 'flip');
          pulse(keyed(`hole:${x.pid}:1`), 'flip');
        }
        break;
      case 'win': {
        sweep(before.get('pot') ?? after.get('pot'));
        flyChips({ from: before.get('pot') ?? after.get('pot'), to: after.get(`seat:${ev.pid}`), n: 5, delay: delay + 250, duration: 600 });
        delay += 200;
        break;
      }
      default:
    }
  }
}

// --------------------------------------------------------- timers etc.

let lastTick = 0;
const clockText = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
setInterval(() => {
  const now = performance.now();
  for (const el of document.querySelectorAll('[data-deadline]')) {
    const left = el.dataset.frozen ? Number(el.dataset.left) : Math.max(0, Number(el.dataset.deadline) - now);
    const total = Number(el.dataset.total) || 1;
    const bar = el.querySelector('.timer i');
    if (bar) bar.style.width = `${Math.min(100, (left / total) * 100)}%`;
    const secs = el.querySelector('.secs');
    if (secs) secs.textContent = el.dataset.fmt === 'clock' ? clockText(left) : `${Math.ceil(left / 1000)}s`;
    el.classList.toggle('low', left < 10_000 && !el.dataset.calm);
    if (el.dataset.mine === '1' && left > 0 && left < 5_500) {
      const s = Math.ceil(left / 1000);
      if (s !== lastTick) {
        lastTick = s;
        sfx.tick();
      }
    }
  }
}, 200);

// Keep the phone screen on during a game (a locked screen drops the connection).
let wake = null;
async function keepAwake(on) {
  try {
    if (on && !wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => (wake = null));
    } else if (!on && wake) {
      await wake.release();
      wake = null;
    }
  } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  keepAwake(Boolean(S.view?.game));
  if (!socket.connected) socket.connect();
});

document.addEventListener('pointerdown', unlockAudio, { passive: true });

render();
