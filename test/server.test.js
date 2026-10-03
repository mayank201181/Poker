// End-to-end: real Socket.IO clients against the real server, with short
// timers so timeouts, run-outs and the next hand happen quickly.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createApp } from '../server/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let srv;
let url;

before(async () => {
  srv = createApp({
    timing: {
      botMin: 5,
      botMax: 15,
      offlineGrace: 400,
      awayDelay: 40,
      hostGrace: 300,
      runout: 20,
      nextHand: 40,
      showdown: 60,
      waiting: 20,
      minute: 150,
    },
  });
  await new Promise((r) => srv.server.listen(0, r));
  url = `http://localhost:${srv.server.address().port}`;
});

after(() => {
  srv.rooms.close();
  srv.io.close();
  srv.server.close();
});

let tokenSeq = 0;
class Client {
  constructor(name, token = `test-token-${name}-${++tokenSeq}`) {
    this.name = name;
    this.token = token;
    this.view = null;
    this.events = [];
    this.removed = null;
    this.connect();
  }

  connect() {
    this.socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.on('state', (m) => {
      this.view = m.view;
      this.events.push(...m.events);
      checkNoLeaks(m.view);
    });
    this.socket.on('removed', (m) => (this.removed = m.why));
  }

  emit(ev, data) {
    return new Promise((res) => this.socket.emit(ev, data, res));
  }

  create() {
    return this.emit('create', { name: this.name, token: this.token });
  }

  join(code) {
    return this.emit('join', { code, name: this.name, token: this.token });
  }

  cmd(type, args = {}) {
    return this.emit('cmd', { type, ...args });
  }

  async until(pred, ms = 4000) {
    const t0 = Date.now();
    while (!(this.view && pred(this.view))) {
      if (Date.now() - t0 > ms) throw new Error(`${this.name}: timed out waiting`);
      await sleep(5);
    }
    return this.view;
  }

  close() {
    this.socket.close();
  }
}

// Other players' cards only show when they're turned up for everyone, and
// betting options only go to the player whose turn it is.
function checkNoLeaks(v) {
  const g = v.game;
  if (!g) return;
  for (const p of g.players) {
    if (p.id === v.me || !p.cards) continue;
    if (p.cards.some(Boolean)) assert.ok(p.shown, `${p.name}'s hidden cards leaked to ${v.me}`);
  }
  if (g.hand?.options) assert.equal(g.hand.toAct, v.me, 'betting options leaked');
  assert.ok(!JSON.stringify(v).includes('"deck"'), 'the deck must never reach a client');
}

// A legal (if not clever) move for whoever is looking at this view.
function chooseMove(v) {
  const o = v.game?.hand?.options;
  if (!o || v.paused) return null;
  const r = Math.random();
  if (r < 0.1 && !o.canCheck) return { type: 'fold' };
  if (r < 0.2 && o.canRaise) return { type: 'raise', to: o.minTo };
  return { type: o.canCheck ? 'check' : 'call' };
}

// Let every client make its moves until `done` says stop.
async function playUntil(clients, done, ms = 15000) {
  const t0 = Date.now();
  const busy = new Set();
  while (!done()) {
    assert.ok(Date.now() - t0 < ms, 'the game did not progress in time');
    for (const c of clients) {
      if (busy.has(c) || !c.view) continue;
      const mv = chooseMove(c.view);
      if (!mv) continue;
      busy.add(c);
      c.cmd(mv.type, mv).then((res) => {
        busy.delete(c);
        // Racing a state update is fine; anything else is a bug.
        if (!res.ok) assert.match(res.error, /not your turn|no betting|nothing to call|can't check|paused/i);
      });
    }
    await sleep(3);
  }
}

test('create, join, set up the table, start and play hands', async () => {
  const a = new Client('Asha');
  const b = new Client('Bunty');
  const c = new Client('Chintu');
  const res = await a.create();
  assert.ok(res.ok);
  assert.match(res.code, /^[A-Z]{4}$/);
  assert.ok((await b.join(res.code.toLowerCase())).ok, 'codes are case-insensitive');
  assert.ok((await c.join(res.code)).ok);
  assert.equal((await b.join('ZZZZ')).ok, false);
  const twin = new Client('asha');
  assert.ok((await twin.join(res.code)).ok);
  await a.until((v) => v.members.length === 4);
  assert.deepEqual(a.view.members.map((m) => m.name), ['Asha', 'Bunty', 'Chintu', 'asha 2']);
  assert.ok((await twin.cmd('leave')).ok);
  twin.close();

  await a.until((v) => v.members.length === 3);
  assert.equal(a.view.host, a.view.me);
  assert.equal((await b.cmd('settings', { settings: { stack: 2000 } })).ok, false, 'only the host sets the table');
  assert.ok((await a.cmd('settings', { settings: { stack: 2000, blinds: 3, turnTimer: 0, mode: 'nope', bogus: 1 } })).ok);
  await b.until((v) => v.settings.stack === 2000);
  assert.equal(b.view.settings.blinds, 3);
  assert.equal(b.view.settings.turnTimer, 0);
  assert.equal(b.view.settings.mode, 'cash', 'bad values are ignored');

  assert.equal((await b.cmd('start')).ok, false);
  assert.ok((await a.cmd('start')).ok);
  await c.until((v) => v.game?.phase === 'hand');
  assert.deepEqual(c.view.game.blinds, [25, 50]);
  assert.equal(c.view.game.players.reduce((s, p) => s + p.stack + p.bet, 0), 6000);
  const mine = c.view.game.players.find((p) => p.id === c.view.me);
  assert.ok(mine.cards.every((x) => x && x.r && x.s), 'you see your own cards');

  // Hands are dealt one after another without anyone pressing a button.
  await playUntil([a, b, c], () => (a.view.game?.handNo ?? 0) >= 4);
  const g = a.view.game;
  const total = g.players.reduce((s, p) => s + p.stack + p.bet, 0) + (g.hand.pot ?? 0);
  assert.equal(total, 6000, 'no chips appear or vanish');
  assert.ok(a.events.some((e) => e.t === 'win'));
  for (const x of [a, b, c]) x.close();
});

test('a practice tournament against computer players runs to the end', async () => {
  const a = new Client('Solo');
  const { code } = await a.create();
  for (let i = 0; i < 3; i++) assert.ok((await a.cmd('addBot')).ok);
  assert.ok((await a.cmd('settings', { settings: { mode: 'tourney', stack: 500, blindsUp: 10 } })).ok);
  await a.until((v) => v.members.length === 4 && v.settings.mode === 'tourney');
  assert.ok(a.view.members.slice(1).every((m) => m.bot && m.name.length <= 8));
  assert.ok((await a.cmd('start')).ok);
  await a.until((v) => v.game?.phase === 'hand');
  assert.ok(a.view.clock, 'tournaments show when the blinds go up');
  assert.equal((await a.cmd('addBot')).ok, false, 'no new players during a tournament');
  await playUntil([a], () => a.view.game?.phase === 'gameOver', 60000);
  assert.ok(a.events.some((e) => e.t === 'level'), 'the blinds went up');
  assert.equal(a.view.game.winners.length, 1);
  const places = a.view.game.players.map((p) => p.place).sort();
  assert.deepEqual(places, [1, 2, 3, 4]);
  assert.ok((await a.cmd('toLobby')).ok);
  await a.until((v) => !v.game);
  assert.ok(code);
  a.close();
});

test('dropping out: your turns are skipped, you sit out, and you are dealt back in on return', async () => {
  const a = new Client('Host');
  const b = new Client('Dropper');
  const c = new Client('Third');
  const { code } = await a.create();
  await b.join(code);
  await c.join(code);
  await a.until((v) => v.members.length === 3);
  await a.cmd('settings', { settings: { turnTimer: 0 } });
  await a.cmd('start');
  await b.until((v) => v.game?.phase === 'hand');
  const seat = b.view.me;

  b.close();
  await a.until((v) => v.members.find((m) => m.id === seat)?.connected === false);
  // Play on: the offline player is checked or folded, then sits out.
  await playUntil([a, c], () => a.view.game.players.find((p) => p.id === seat)?.out === 'away', 8000);
  assert.ok(a.events.some((e) => e.t === 'timeout' && e.pid === seat));
  await playUntil([a, c], () => a.view.game.phase === 'hand' && !a.view.game.players.find((p) => p.id === seat).inHand, 8000);

  b.connect();
  const back = await b.emit('rejoin', { code, token: b.token });
  assert.ok(back.ok);
  await b.until((v) => v.game && v.me === seat);
  await a.until((v) => v.game.players.find((p) => p.id === seat).out === null);
  const bad = await new Client('Stranger').emit('rejoin', { code, token: 'not-a-member-token' });
  assert.equal(bad.ok, false);
  for (const x of [a, b, c]) x.close();
});

test('host controls: pause, skip, kick, hand over, end the game', async () => {
  const a = new Client('A');
  const b = new Client('B');
  const c = new Client('C');
  const { code } = await a.create();
  await b.join(code);
  await c.join(code);
  await a.until((v) => v.members.length === 3);
  await a.cmd('settings', { settings: { turnTimer: 0 } });
  await a.cmd('start');
  await a.until((v) => v.game?.phase === 'hand' && v.game.hand.toAct);

  assert.ok((await a.cmd('pause')).ok);
  await b.until((v) => v.paused);
  const actor = [a, b, c].find((x) => x.view.game.hand.toAct === x.view.me);
  const blocked = await actor.cmd('fold');
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /paused/);
  assert.ok((await a.cmd('resume')).ok);
  await b.until((v) => !v.paused);

  const who = a.view.game.hand.toAct;
  assert.ok((await a.cmd('skip')).ok);
  await a.until((v) => v.game.hand.toAct !== who || v.game.phase !== 'hand');
  assert.ok(a.events.some((e) => e.t === 'timeout' && e.pid === who));

  assert.ok((await a.cmd('kick', { id: c.view.me })).ok);
  await c.until(() => c.removed === 'kicked');
  await a.until((v) => v.members.length === 2 && v.game.players.length === 2);
  assert.equal(a.view.game.gone[0].name, 'C');

  a.close();
  await b.until((v) => v.host === v.me, 3000);
  assert.ok((await b.cmd('end')).ok);
  await b.until((v) => v.game.phase === 'gameOver');
  assert.equal(b.view.game.endReason, 'host');
  b.close();
});

test('people who arrive late watch, then sit down in a cash game or take over a seat', async () => {
  const a = new Client('Host');
  const b = new Client('Phone-died');
  const { code } = await a.create();
  await b.join(code);
  await a.until((v) => v.members.length === 2);
  await a.cmd('settings', { settings: { turnTimer: 0 } });
  await a.cmd('start');
  await b.until((v) => v.game?.phase === 'hand');

  const late = new Client('Late');
  assert.ok((await late.join(code)).ok);
  await late.until((v) => v.game && !v.members.find((m) => m.id === v.me).playing);
  assert.equal((await late.cmd('call')).ok, false, 'watchers cannot bet');
  assert.ok((await late.cmd('sit')).ok);
  await late.until((v) => v.game.players.some((p) => p.id === v.me));
  assert.equal((await late.cmd('sit')).ok, false);

  const seat = b.view.me;
  b.close();
  await a.until((v) => v.members.find((m) => m.id === seat)?.connected === false);
  const d = new Client('New-phone');
  assert.ok((await d.join(code)).ok);
  assert.ok((await d.cmd('claim', { seat })).ok);
  const req = await a.until((v) => v.claims.length === 1);
  assert.ok((await a.cmd('resolveClaim', { id: req.claims[0].id, allow: true })).ok);
  await d.until((v) => v.me === seat);
  assert.equal(d.view.game.players.find((p) => p.id === seat).name, 'New-phone');
  assert.equal((await d.cmd('rebuy')).ok, false, 'you can only rebuy with no chips');
  for (const x of [a, d, late]) x.close();
});

test('junk input is rejected without taking the server down', async () => {
  const a = new Client('Junk');
  for (const data of [null, 42, 'x', [], { name: 'x' }, { token: 'short' }]) {
    const r = await a.emit('create', data);
    assert.equal(r.ok, false);
  }
  await a.create();
  await a.cmd('addBot');
  await a.cmd('start');
  await a.until((v) => v.game?.phase === 'hand');
  for (const cmd of [null, {}, { type: 'nope' }, { type: 'raise', to: 'all' }, { type: 'raise', to: 1e12 }, { type: 'raise', to: -5 }, { type: 'kick', id: {} }]) {
    const r = await a.emit('cmd', cmd);
    assert.equal(r.ok, false);
  }
  const before = JSON.stringify(a.view.settings);
  await a.cmd('settings', { settings: 'x' });
  await a.cmd('settings', { settings: { turnTimer: 7, stack: 3 } });
  await sleep(20);
  assert.equal(JSON.stringify(a.view.settings), before, 'junk settings change nothing');
  const health = await fetch(`${url}/healthz`).then((r) => r.text());
  assert.equal(health, 'ok');
  const page = await fetch(`${url}/ABCD`);
  assert.equal(page.status, 200);
  a.close();
});
