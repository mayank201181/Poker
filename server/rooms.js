// Rooms: who is at the table, which game (Texas Hold'em or Teen Patti), the
// host's controls, turn timers, dealing the next hand, blind and boot levels,
// bots, and sending each connected device its own view of the game.

import { Game, GameError, DEFAULT_RULES } from './game.js';
import { TeenPatti, TP_RULES } from './teenpatti.js';
import { botAct } from './bot.js';
import { teenBotAct } from './teenbot.js';
import { cleanName, makeRoomCode, newId, cryptoRandom } from './util.js';

export const MAX_SEATS = 10;
const MAX_MEMBERS = 24;
const MAX_ROOMS = 2000;
const LOG_LIMIT = 300;
const IDLE_ROOM_MS = 60 * 60_000;

// Bollywood villains, short enough for a crowded table.
const BOT_NAMES = ['Gabbar', 'Mogambo', 'Shakaal', 'Teja', 'Gogo', 'Kancha', 'Sambha', 'Kaalia', 'Lion'];

// Starting blinds the host can pick (indexes into BLINDS): 5/10, 10/20, 25/50, 50/100, 100/200.
export const BLIND_CHOICES = [0, 1, 3, 5, 7];
// Starting boots (indexes into BOOTS): 5, 10, 20, 50, 100.
export const BOOT_CHOICES = [0, 1, 3, 5, 7];
export const DEFAULT_SETTINGS = Object.freeze({ game: 'holdem', ...DEFAULT_RULES, ...TP_RULES, turnTimer: 45, blindsUp: 15 });
const CHOICES = {
  game: ['holdem', 'teenpatti'],
  mode: ['cash', 'tourney'],
  stack: [500, 1000, 2000, 5000, 10000],
  blinds: BLIND_CHOICES,
  boot: BOOT_CHOICES,
  potLimit: [0, 50, 100, 200, 500],
  turnTimer: [0, 20, 30, 45, 60, 90],
  blindsUp: [10, 15, 20, 30],
};
const GAMES = {
  holdem: { Engine: Game, rules: DEFAULT_RULES, bot: botAct },
  teenpatti: { Engine: TeenPatti, rules: TP_RULES, bot: teenBotAct },
};

const DEFAULT_TIMING = {
  botMin: 1100,         // bots pause like people do, so the betting can be followed
  botMax: 2600,
  offlineGrace: 30_000, // an offline player's turn is checked or folded after this long
  awayDelay: 1500,      // a player who timed out earlier is folded quickly
  hostGrace: 30_000,    // an offline host hands over after this long
  runout: 1800,         // between streets when everyone is all in
  nextHand: 4000,       // after a hand everyone folded
  showdown: 7500,       // after a showdown, time to look at the cards
  waiting: 1500,        // dealing again after someone sits in or rebuys
  minute: 60_000,       // blind levels are counted in these
};

const need = (cond, msg) => {
  if (!cond) throw new GameError(msg);
};

export class Room {
  constructor(code, { rng = cryptoRandom, timing = {} } = {}) {
    this.code = code;
    this.rng = rng;
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.members = new Map();
    this.order = []; // member ids in seat order (join order)
    this.hostId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.game = null;
    this.paused = null;
    this.claims = [];
    this.log = [];
    this.seq = 0;
    this.sockets = new Map();
    this.timers = { turn: null, bot: null, host: null, step: null, level: null };
    this.stage = { key: '', at: Date.now() };
    this.botPlan = null;
    this.deadlineInfo = null;
    this.stepInfo = null;
    this.levelAt = Date.now();
    this.lastSeen = Date.now();
    this.absentSince = null;
  }

  // ------------------------------------------------------------- members

  push(ev) {
    this.log.push({ seq: ++this.seq, ...ev });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  list() {
    return this.order.map((id) => this.members.get(id));
  }

  seated() {
    return this.list().filter((m) => m.seat);
  }

  byToken(token) {
    if (!token) return null;
    for (const m of this.members.values()) if (m.token === token) return m;
    return null;
  }

  // Two people called Asha become "Asha" and "Asha 2".
  uniqueName(raw, ...except) {
    const base = cleanName(raw);
    const taken = new Set(this.list().filter((m) => !except.includes(m.id)).map((m) => m.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) {
      const name = `${[...base].slice(0, 13).join('').trim()} ${i}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
  }

  join(name, token, socket) {
    let m = this.byToken(token);
    if (m) {
      if (!this.game) m.name = this.uniqueName(name, m.id);
    } else {
      need(this.members.size < MAX_MEMBERS, 'This room is full');
      const seat = !this.game && this.seated().length < MAX_SEATS;
      m = { id: newId(), name: this.uniqueName(name), token, bot: false, seat, sockets: new Set(), connected: false, offlineSince: null, timeouts: 0 };
      this.members.set(m.id, m);
      this.order.push(m.id);
      if (!this.hostId) this.hostId = m.id;
      this.push({ t: 'join', pid: m.id, name: m.name, watching: !seat });
    }
    this.attach(m, socket);
    return m;
  }

  attach(m, socket) {
    socket.data.room = this.code;
    socket.data.mid = m.id;
    socket.data.fresh = true;
    m.sockets.add(socket.id);
    this.sockets.set(socket.id, socket);
    m.connected = true;
    m.offlineSince = null;
    // Back after being folded for being away: deal them in again.
    const p = this.game?.players.find((x) => x.id === m.id);
    if (p?.out === 'away') {
      m.timeouts = 0;
      this.game.sitIn(m.id);
    }
  }

  detach(socket) {
    this.sockets.delete(socket.id);
    const m = this.members.get(socket.data.mid);
    socket.data.room = null;
    socket.data.mid = null;
    if (!m) return;
    m.sockets.delete(socket.id);
    if (m.sockets.size === 0 && !m.bot) {
      m.connected = false;
      m.offlineSince = Date.now();
    }
    this.afterChange();
  }

  addBot() {
    const g = this.game;
    need(!g || g.rules.mode === 'cash', 'Add computer players before a tournament starts');
    need(!g || g.phase !== 'gameOver', 'The game is over');
    const seats = g ? g.players.length : this.seated().length;
    need(seats < MAX_SEATS, `The table is full (${MAX_SEATS} players)`);
    need(this.members.size < MAX_MEMBERS, 'This room is full');
    const used = new Set(this.list().map((m) => m.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.members.size + 1}`;
    // Each bot plays a little differently: tighter or looser, calmer or pushier.
    const style = { loose: this.rng() * 2 - 1, aggro: 0.75 + this.rng() * 0.6 };
    const m = { id: newId(), name, token: null, bot: true, seat: true, sockets: new Set(), connected: true, offlineSince: null, timeouts: 0, style };
    this.members.set(m.id, m);
    this.order.push(m.id);
    this.push({ t: 'join', pid: m.id, name, bot: true });
    if (g) g.addPlayer({ id: m.id, name });
  }

  remove(m, why) {
    if (this.game?.has(m.id)) this.game.removePlayer(m.id);
    this.members.delete(m.id);
    this.order = this.order.filter((id) => id !== m.id);
    this.claims = this.claims.filter((c) => c.from !== m.id && c.seat !== m.id);
    for (const sid of m.sockets) {
      const s = this.sockets.get(sid);
      if (s) {
        s.emit('removed', { why });
        s.data.room = null;
        s.data.mid = null;
      }
      this.sockets.delete(sid);
    }
    this.push({ t: why, pid: m.id, name: m.name });
    if (this.hostId === m.id) {
      const humans = this.list().filter((x) => !x.bot);
      this.setHost((humans.find((x) => x.connected) ?? humans[0])?.id ?? null);
    }
  }

  setHost(id) {
    if (id === this.hostId) return;
    this.hostId = id;
    if (id) this.push({ t: 'host', pid: id });
  }

  // An offline host hands over to the next connected person after a grace period.
  ensureHost() {
    const host = this.members.get(this.hostId);
    if (host?.connected) {
      clearTimeout(this.timers.host);
      this.timers.host = null;
      return;
    }
    const next = this.list().find((m) => !m.bot && m.connected);
    if (!host) {
      if (next) this.setHost(next.id);
      return;
    }
    if (!next || this.timers.host) return;
    const wait = Math.max(0, host.offlineSince + this.timing.hostGrace - Date.now());
    this.timers.host = setTimeout(() => {
      this.timers.host = null;
      const h = this.members.get(this.hostId);
      const n = this.list().find((m) => !m.bot && m.connected);
      if (h && !h.connected && n) {
        this.setHost(n.id);
        this.afterChange();
      }
    }, wait);
  }

  // ------------------------------------------------------------ commands

  command(mid, cmd = {}) {
    const m = this.members.get(mid);
    need(m, 'You are no longer in this room');
    const isHost = mid === this.hostId;
    const needHost = () => need(isHost, 'Only the host can do that');
    const g = this.game;

    switch (cmd.type) {
      case 'settings':
        needHost();
        this.applySettings(cmd.settings);
        return;
      case 'addBot':
        needHost();
        return this.addBot();
      case 'kick': {
        needHost();
        const t = this.members.get(cmd.id);
        need(t, 'That player has already left');
        need(t.id !== mid, 'Use “Leave room” to leave');
        return this.remove(t, 'kicked');
      }
      case 'makeHost': {
        needHost();
        const t = this.members.get(cmd.id);
        need(t && !t.bot, 'Pick a person to be the host');
        return this.setHost(t.id);
      }
      case 'start':
        needHost();
        return this.start();
      case 'end':
        needHost();
        need(g && g.phase !== 'gameOver', 'No game is running');
        this.paused = null;
        return g.finishGame('host');
      case 'toLobby':
        needHost();
        return this.toLobby();
      case 'pause':
        needHost();
        need(g && g.phase !== 'gameOver', 'No game is running');
        if (!this.paused) {
          this.paused = { by: mid, at: Date.now() };
          this.push({ t: 'pause', pid: mid });
        }
        return;
      case 'resume':
        needHost();
        if (this.paused) {
          const d = Date.now() - this.paused.at;
          this.stage.at += d;
          this.levelAt += d;
          this.paused = null;
          this.push({ t: 'resume', pid: mid });
        }
        return;
      case 'skip':
        needHost();
        need(g && g.phase === 'hand' && g.hand.toAct && !g.hand.runout, 'Nobody is deciding right now');
        need(!this.paused, 'The game is paused');
        return g.autoPlay(g.hand.toAct);
      case 'sit':
        return this.sitDown(m);
      case 'claim':
        return this.claim(m, cmd.seat);
      case 'resolveClaim':
        needHost();
        return this.resolveClaim(cmd.id, cmd.allow === true);
      case 'leave':
        return this.remove(m, 'left');
      default:
        return this.play(m, cmd);
    }
  }

  play(m, cmd) {
    const g = this.game;
    need(g, "The game hasn't started yet");
    need(g.has(m.id), "You're watching this game");
    const id = m.id;
    switch (cmd.type) {
      // Hold'em: fold, check, call, raise (to). Teen Patti: pack, bet, raise (2x), askShow, sideshow, reply.
      case 'fold':
      case 'check':
      case 'call':
      case 'raise':
      case 'pack':
      case 'bet':
      case 'askShow':
      case 'sideshow':
      case 'reply':
        need(!this.paused, 'The game is paused');
        g.act(id, cmd.type, cmd.type === 'reply' ? cmd.accept === true : cmd.to);
        m.timeouts = 0;
        return;
      case 'see':
        need(g.kind === 'teenpatti', 'Unknown action');
        return g.see(id);
      case 'show':
        return g.show(id);
      case 'sitOut':
        return g.sitOut(id);
      case 'sitIn':
        m.timeouts = 0;
        return g.sitIn(id);
      case 'rebuy':
        return g.rebuy(id);
      default:
        throw new GameError('Unknown action');
    }
  }

  // The turn timer and blind clock can change at any time; the rest only between games.
  applySettings(s = {}) {
    const next = { ...this.settings };
    if (CHOICES.turnTimer.includes(s.turnTimer)) next.turnTimer = s.turnTimer;
    if (CHOICES.blindsUp.includes(s.blindsUp)) next.blindsUp = s.blindsUp;
    if (!this.game) {
      for (const k of ['game', 'mode', 'stack', 'blinds', 'boot', 'potLimit']) if (CHOICES[k].includes(s[k])) next[k] = s[k];
    }
    this.settings = next;
  }

  start() {
    need(!this.game, 'A game is already running');
    const seats = this.seated().filter((m) => m.bot || m.connected);
    need(seats.length >= 2, 'You need at least 2 players (add a computer player to practise)');
    need(seats.length <= MAX_SEATS, `At most ${MAX_SEATS} players`);
    const { Engine, rules: defaults } = GAMES[this.settings.game];
    const rules = Object.fromEntries(Object.keys(defaults).map((k) => [k, this.settings[k]]));
    this.paused = null;
    this.levelAt = Date.now();
    this.push({ t: 'start', game: this.settings.game });
    this.game = new Engine(seats.map((m) => ({ id: m.id, name: m.name })), rules, {
      rng: this.rng,
      emit: (ev) => this.push(ev),
    });
  }

  toLobby() {
    need(this.game, 'No game is running');
    this.game = null;
    this.paused = null;
    this.claims = [];
    let seated = 0;
    for (const m of this.list()) {
      m.seat = seated < MAX_SEATS;
      if (m.seat) seated++;
    }
    this.push({ t: 'lobby' });
  }

  // Someone watching a cash game takes a seat; they're dealt in from the next hand.
  sitDown(m) {
    const g = this.game;
    need(g, 'No game is running');
    need(!g.has(m.id), "You're already playing");
    need(g.phase !== 'gameOver', 'The game is over');
    need(g.rules.mode === 'cash', 'This is a tournament, so you can join the next game');
    need(g.players.length < MAX_SEATS, `The table is full (${MAX_SEATS} players)`);
    g.addPlayer({ id: m.id, name: m.name });
    m.seat = true;
    m.timeouts = 0;
    this.claims = this.claims.filter((c) => c.from !== m.id);
  }

  // Someone watching asks to take over an offline player's seat (e.g. their
  // phone died and they're back on another device). The host decides.
  claim(m, seatId) {
    const g = this.game;
    need(g, 'No game is running');
    need(!g.has(m.id), "You're already playing");
    const seat = this.members.get(seatId);
    need(seat && !seat.bot && g.has(seat.id) && !seat.connected, 'That seat is not free');
    this.claims = this.claims.filter((c) => c.from !== m.id);
    this.claims.push({ id: newId(), from: m.id, seat: seat.id });
    this.push({ t: 'claim', pid: m.id, seat: seat.id });
  }

  resolveClaim(id, allow) {
    const c = this.claims.find((x) => x.id === id);
    need(c, 'That request has expired');
    this.claims = this.claims.filter((x) => x !== c);
    const from = this.members.get(c.from);
    const seat = this.members.get(c.seat);
    if (!allow || !from || !seat || seat.connected || !this.game?.has(seat.id)) {
      if (from) this.push({ t: 'claimDenied', pid: from.id });
      return;
    }
    const old = seat.name;
    seat.token = from.token;
    seat.name = this.uniqueName(from.name, from.id, seat.id);
    for (const sid of from.sockets) {
      const s = this.sockets.get(sid);
      if (!s) continue;
      s.data.mid = seat.id;
      s.data.fresh = true;
      seat.sockets.add(sid);
    }
    seat.connected = seat.sockets.size > 0;
    seat.offlineSince = seat.connected ? null : Date.now();
    seat.timeouts = 0;
    this.members.delete(from.id);
    this.order = this.order.filter((x) => x !== from.id);
    this.claims = this.claims.filter((x) => x.from !== from.id && x.seat !== seat.id);
    this.game.renamePlayer(seat.id, seat.name);
    if (seat.connected && this.game.player(seat.id).out === 'away') this.game.sitIn(seat.id);
    this.push({ t: 'takeover', pid: seat.id, name: seat.name, old });
  }

  // -------------------------------------------------------- timers & bots

  stageKey() {
    const g = this.game;
    if (!g) return 'lobby';
    const h = g.hand;
    if (g.phase === 'hand') return `${g.handNo}:hand:${h.street}:${h.runout ? 'runout' : h.toAct}:${h.actions}`;
    if (g.phase === 'waiting') return `${g.handNo}:waiting:${g.canDeal()}`;
    return `${g.handNo}:${g.phase}`;
  }

  deadline() {
    const g = this.game;
    if (!g || this.paused || g.phase !== 'hand' || g.hand.runout || !g.hand.toAct) return null;
    const pid = g.hand.toAct;
    const m = this.members.get(pid);
    if (!m || m.bot) return null;
    const { awayDelay, offlineGrace } = this.timing;
    if (g.player(pid).out === 'away') return { at: this.stage.at + awayDelay, pid, total: awayDelay, reason: 'away' };
    const T = this.settings.turnTimer * 1000;
    let d = T ? { at: this.stage.at + T, pid, total: T, reason: 'turn' } : null;
    if (!m.connected) {
      const off = Math.max(this.stage.at, m.offlineSince) + offlineGrace;
      if (!d || off < d.at) d = { at: off, pid, total: offlineGrace, reason: 'offline' };
    }
    return d;
  }

  armTimer() {
    clearTimeout(this.timers.turn);
    this.timers.turn = null;
    const d = this.someoneHere() ? this.deadline() : null;
    this.deadlineInfo = d;
    if (d) this.timers.turn = setTimeout(() => this.onDeadline(), Math.max(0, d.at - Date.now()) + 25);
  }

  // Out of time: check if possible, otherwise fold. Twice in a row (or while
  // offline) and you sit out until you're back.
  onDeadline() {
    const g = this.game;
    if (!g || this.paused) return;
    const d = this.deadline();
    if (d && d.at <= Date.now()) {
      const m = this.members.get(d.pid);
      try {
        g.autoPlay(d.pid);
        if (m && d.reason !== 'away' && g.phase !== 'gameOver') {
          m.timeouts += 1;
          if (!m.connected || m.timeouts >= 2) g.sitOut(d.pid, 'away');
        }
      } catch (e) {
        console.error('timeout handling failed', e);
      }
    }
    this.afterChange();
  }

  armBots() {
    clearTimeout(this.timers.bot);
    this.timers.bot = null;
    const g = this.game;
    // Bots (and timers) wait while nobody is connected.
    if (!g || this.paused || !this.someoneHere()) return;
    if (g.phase !== 'hand' || g.hand.runout || !g.hand.toAct) return;
    const pid = g.hand.toAct;
    const m = this.members.get(pid);
    if (!m?.bot) return;
    const key = this.stage.key;
    if (this.botPlan?.key !== key) {
      const { botMin, botMax } = this.timing;
      this.botPlan = { key, wait: botMin + this.rng() * (botMax - botMin) };
    }
    this.timers.bot = setTimeout(() => {
      this.timers.bot = null;
      if (this.game !== g || this.paused || this.stage.key !== key) return;
      try {
        GAMES[g.kind].bot(g, pid, this.rng, m.style);
      } catch (e) {
        console.error('bot move failed', e);
        try {
          g.autoPlay(pid);
        } catch (e2) {
          console.error('bot fallback failed', e2);
        }
      }
      this.afterChange();
    }, Math.max(0, this.stage.at + this.botPlan.wait - Date.now()));
  }

  // Dealing that happens on its own: all-in run-outs and the next hand.
  armStep() {
    clearTimeout(this.timers.step);
    this.timers.step = null;
    this.stepInfo = null;
    const g = this.game;
    if (!g || this.paused || !this.someoneHere()) return;
    let wait = null;
    if (g.phase === 'hand' && g.hand.runout) wait = this.timing.runout;
    else if (g.phase === 'handOver') wait = g.hand.results?.showdown ? this.timing.showdown : this.timing.nextHand;
    else if (g.phase === 'waiting' && g.canDeal()) wait = this.timing.waiting;
    if (wait === null) return;
    const key = this.stage.key;
    const at = this.stage.at + wait;
    this.stepInfo = { at, total: wait, kind: g.phase === 'hand' ? 'runout' : 'next' };
    this.timers.step = setTimeout(() => {
      this.timers.step = null;
      if (this.game !== g || this.paused || this.stage.key !== key) return;
      try {
        this.step();
      } catch (e) {
        console.error('dealing failed', e);
      }
      this.afterChange();
    }, Math.max(0, at - Date.now()));
  }

  step() {
    const g = this.game;
    if (g.phase === 'hand' && g.hand.runout) return g.runoutStep();
    // Computer players who ran out of chips buy back in.
    if (g.rules.mode === 'cash') {
      for (const p of g.players) if (p.stack === 0 && this.members.get(p.id)?.bot) g.rebuy(p.id);
    }
    if (g.phase === 'handOver' || g.phase === 'waiting') g.nextHand();
  }

  // Tournaments: the blinds go up every few minutes (from the next hand).
  armLevel() {
    clearTimeout(this.timers.level);
    this.timers.level = null;
    const g = this.game;
    if (!g || g.rules.mode !== 'tourney' || g.phase === 'gameOver' || this.paused || !this.someoneHere()) return;
    if (g.level >= g.levels.length - 1) return;
    const at = this.levelAt + this.settings.blindsUp * this.timing.minute;
    this.timers.level = setTimeout(() => {
      this.timers.level = null;
      if (this.game !== g || this.paused || g.phase === 'gameOver') return;
      g.raiseLevel();
      this.levelAt = Date.now();
      this.afterChange();
    }, Math.max(0, at - Date.now()));
  }

  someoneHere() {
    return this.list().some((m) => !m.bot && m.connected);
  }

  afterChange() {
    // While nobody is connected the clocks stop, like a pause.
    const here = this.someoneHere();
    if (here) this.lastSeen = Date.now();
    if (!here && this.absentSince == null) this.absentSince = Date.now();
    if (here && this.absentSince != null) {
      const d = Date.now() - this.absentSince;
      this.stage.at += d;
      this.levelAt += d;
      this.absentSince = null;
    }
    const key = this.stageKey();
    if (key !== this.stage.key) this.stage = { key, at: Date.now() };
    this.ensureHost();
    this.armTimer();
    this.armBots();
    this.armStep();
    this.armLevel();
    this.broadcast();
  }

  // ---------------------------------------------------------------- views

  broadcast() {
    for (const socket of this.sockets.values()) {
      const mid = socket.data.mid;
      if (!mid || !this.members.has(mid)) continue;
      let events;
      let replay = false;
      if (socket.data.fresh) {
        events = this.log.slice(-40);
        replay = true;
        socket.data.fresh = false;
      } else {
        events = this.log.filter((e) => e.seq > (socket.data.lastSeq ?? 0));
      }
      socket.data.lastSeq = this.seq;
      socket.emit('state', { view: this.viewFor(mid), events, replay });
    }
  }

  viewFor(mid) {
    const now = Date.now();
    const d = this.deadlineInfo;
    const st = this.stepInfo;
    const g = this.game;
    const isHost = mid === this.hostId;
    const tourney = g?.rules.mode === 'tourney' && g.phase !== 'gameOver';
    const levelEnd = this.levelAt + this.settings.blindsUp * this.timing.minute;
    return {
      code: this.code,
      me: mid,
      host: this.hostId,
      members: this.list().map((m) => ({
        id: m.id,
        name: m.name,
        bot: m.bot,
        connected: m.connected,
        playing: g ? g.has(m.id) : m.seat,
      })),
      settings: { ...this.settings },
      paused: this.paused ? { by: this.paused.by } : null,
      timer: d ? { pid: d.pid, left: Math.max(0, d.at - now), total: d.total, reason: d.reason } : null,
      next: st ? { left: Math.max(0, st.at - now), total: st.total, kind: st.kind } : null,
      clock:
        tourney && g.level < g.levels.length - 1
          ? { left: Math.max(0, (this.paused ? levelEnd + now - this.paused.at : levelEnd) - now), total: this.settings.blindsUp * this.timing.minute, paused: Boolean(this.paused) }
          : null,
      claims: this.claims.filter((c) => isHost || c.from === mid).map((c) => ({ ...c })),
      game: g ? g.viewFor(mid) : null,
    };
  }

  isIdle(now = Date.now()) {
    if (this.members.size === 0) return true;
    return !this.someoneHere() && now - this.lastSeen > IDLE_ROOM_MS;
  }

  destroy() {
    for (const t of Object.values(this.timers)) clearTimeout(t);
    for (const s of this.sockets.values()) {
      s.data.room = null;
      s.data.mid = null;
    }
    this.sockets.clear();
  }
}

// ------------------------------------------------------------------ sockets

function respond(ack, fn) {
  try {
    const out = fn();
    if (typeof ack === 'function') ack({ ok: true, ...out });
  } catch (e) {
    if (!(e instanceof GameError)) console.error(e);
    if (typeof ack === 'function') ack({ ok: false, error: e instanceof GameError ? e.message : 'Something went wrong' });
  }
}

const validToken = (t) => typeof t === 'string' && t.length >= 8 && t.length <= 100;

export class RoomManager {
  constructor({ rng = cryptoRandom, timing = {} } = {}) {
    this.rooms = new Map();
    this.rng = rng;
    this.timing = timing;
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  get(code) {
    return this.rooms.get(String(code ?? '').trim().toUpperCase());
  }

  create() {
    need(this.rooms.size < MAX_ROOMS, 'The server is busy, please try again later');
    let code;
    do code = makeRoomCode(this.rng);
    while (this.rooms.has(code));
    const room = new Room(code, { rng: this.rng, timing: this.timing });
    this.rooms.set(code, room);
    return room;
  }

  sweep() {
    for (const [code, room] of this.rooms) {
      if (room.isIdle()) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }

  close() {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }

  // A device can only be in one room at a time.
  leaveCurrent(socket) {
    const room = this.get(socket.data.room);
    if (room) room.detach(socket);
  }

  attach(socket) {
    // Generous rate limit: a misbehaving client can't flood the server.
    let budget = 40;
    let last = Date.now();
    socket.use((packet, next) => {
      const now = Date.now();
      budget = Math.min(40, budget + (now - last) / 50);
      last = now;
      if (budget < 1) return next(new Error('Slow down'));
      budget -= 1;
      next();
    });

    socket.on('create', (data, ack) =>
      respond(ack, () => {
        need(validToken(data?.token), 'Please reload the page');
        this.leaveCurrent(socket);
        const room = this.create();
        room.join(data.name, data.token, socket);
        room.afterChange();
        return { code: room.code };
      }),
    );

    socket.on('join', (data, ack) =>
      respond(ack, () => {
        need(validToken(data?.token), 'Please reload the page');
        const room = this.get(data?.code);
        need(room, "Couldn't find that room. Check the code?");
        if (socket.data.room !== room.code) this.leaveCurrent(socket);
        room.join(data.name, data.token, socket);
        room.afterChange();
        return { code: room.code };
      }),
    );

    socket.on('rejoin', (data, ack) =>
      respond(ack, () => {
        const room = this.get(data?.code);
        need(room, 'That room has closed');
        const m = validToken(data?.token) ? room.byToken(data.token) : null;
        need(m, 'You are no longer in that room');
        if (socket.data.room !== room.code) this.leaveCurrent(socket);
        room.attach(m, socket);
        room.afterChange();
        return { code: room.code };
      }),
    );

    socket.on('cmd', (data, ack) =>
      respond(ack, () => {
        const room = this.get(socket.data.room);
        need(room && socket.data.mid, 'You are not in a room');
        try {
          room.command(socket.data.mid, data ?? {});
        } finally {
          room.afterChange();
          if (room.members.size === 0) {
            room.destroy();
            this.rooms.delete(room.code);
          }
        }
        return {};
      }),
    );

    socket.on('disconnect', () => {
      const room = this.get(socket.data.room);
      if (room) room.detach(socket);
    });
  }
}
