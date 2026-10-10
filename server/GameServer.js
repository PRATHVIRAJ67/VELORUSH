// Platform-neutral multiplayer core: clients, sessions, rooms and the simulation tick.
// Hosted by the Node server (server/index.js) and the Cloudflare Durable Object (worker/index.js).
// A socket is anything with { send(str), isOpen(), close(code, reason), terminate() }.
import { getTrack, TRACK_IDS } from '@cyclegame/shared/tracks.js';
import { NET, BIKE_BY_ID, OUTFITS, AI_SKILLS, WEATHER } from '@cyclegame/shared/constants.js';
import { C, S, PROTOCOL_VERSION } from '@cyclegame/shared/protocol.js';
import { Room, makeCode } from './Room.js';
import { STUNT_LEVEL_BY_ID } from '@cyclegame/shared/stunts/levels.js';
import { STUNT_BIKE_BY_ID } from '@cyclegame/shared/stunts/bikes.js';

const randomId = () => 'p' + [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');

class Client {
  constructor(socket) {
    this.ws = socket;
    this.id = randomId();
    this.session = crypto.randomUUID();
    this.name = 'Rider';
    this.look = {};
    this.bikeId = 'allround';
    this.stuntBikeId = 'allround'; // stunt challenges only (any of the 34 stunt garage bikes)
    this.room = null;
    this.alive = true;
    this.lastMsg = 0;
    this.msgCount = 0;
    this.offlineAt = null;
    this.lastMatchAt = 0; // matchmaking cooldown
  }
  send(type, payload = {}) {
    this.sendRaw(JSON.stringify({ t: type, ...payload }));
  }
  sendRaw(str) {
    if (this.ws && this.ws.isOpen()) this.ws.send(str);
  }
}

const cleanName = (n) =>
  String(n || '')
    .replace(/[^\p{L}\p{N} _\-.]/gu, '')
    .trim()
    .slice(0, 16) || 'Rider';
const cleanColor = (c, d) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);
function cleanLook(l = {}) {
  return {
    frame: cleanColor(l.frame, '#e63946'),
    jersey: cleanColor(l.jersey, '#3a86ff'),
    accent: cleanColor(l.accent, '#ffffff'),
    skin: cleanColor(l.skin, '#e0ac8a'),
    outfit: OUTFITS.some((o) => o.id === l.outfit) ? l.outfit : 'classic',
  };
}

/** Room settings from a create request (all fields validated, defaults for the rest). */
function roomSettings(m, defaults) {
  // stunt challenge: a level instead of laps/bots/map (the level decides the map)
  if (m.mode === 'stunt') {
    const level = STUNT_LEVEL_BY_ID[m.level] ? m.level : 'L01';
    return { mode: 'stunt', level, laps: 1, bots: 0, skill: 'medium', weather: 'clear', track: STUNT_LEVEL_BY_ID[level].map };
  }
  return {
    laps: Math.max(1, Math.min(3, Math.round(Number(m.laps)) || defaults.laps)),
    bots: Math.max(0, Math.min(NET.maxPlayers - 1, Math.round(Number(m.bots ?? defaults.bots)) || 0)),
    skill: AI_SKILLS[m.skill] ? m.skill : defaults.skill,
    weather: WEATHER[m.weather] || m.weather === 'random' ? m.weather : 'clear',
    track: TRACK_IDS.includes(m.track) ? m.track : defaults.track,
  };
}
const PUBLIC_DEFAULTS = { laps: 1, bots: 3, skill: 'medium', track: 'mountain' };
const MAX_LISTED = 30;

function applyProfile(client, m) {
  client.name = cleanName(m.name);
  client.look = cleanLook(m.look);
  client.bikeId = BIKE_BY_ID[m.bikeId] ? m.bikeId : 'allround';
  client.stuntBikeId = STUNT_BIKE_BY_ID[m.stuntBikeId] ? m.stuntBikeId : 'allround';
}

export class GameServer {
  /** @param opts {log, debug} */
  constructor({ log = console.log, debug = false } = {}) {
    this.log = log;
    this.debug = debug;
    this.track = getTrack();
    this.rooms = new Map(); // code -> Room
    this.sessions = new Map(); // session token -> Client (kept briefly after disconnect)
    this.clients = new Set();
    this.timer = null;
    this.watchers = new Set(); // clients on the multiplayer screen (receive the public list)
    this.publicDirty = false;
    this.publicSentAt = 0;
    this.publicLast = '';
  }

  // ---------------------------------------------------------------- socket lifecycle
  connect(socket, remote = '') {
    const client = new Client(socket);
    this.clients.add(client);
    this.log(`connect ${remote} (${this.clients.size} online)`);
    this._startLoop();
    return client;
  }

  message(client, data) {
    // basic flood protection
    const now = Date.now();
    if (now - client.lastMsg > 1000) {
      client.lastMsg = now;
      client.msgCount = 0;
    }
    if (++client.msgCount > 120) return;
    if (typeof data === 'string' ? data.length > 16 * 1024 : data.byteLength > 16 * 1024) return;
    let m;
    try {
      m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    try {
      this._handle(client, m);
    } catch (err) {
      this.log('handler error', err);
    }
  }

  disconnect(client) {
    this.watchers.delete(client);
    if (!this.clients.delete(client)) return;
    client.offlineAt = Date.now();
    // only if this socket still owns the seat (a reconnect may have replaced it)
    if (client.room && client.room.members.get(client.id)?.client === client) client.room.disconnected(client.id);
    this.log(`disconnect ${client.name} (${this.clients.size} online)`);
  }

  stats() {
    return { ok: true, rooms: this.rooms.size, clients: this.clients.size };
  }

  // ---------------------------------------------------------------- simulation loop
  _startLoop() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000 / NET.tickRate);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      try {
        room.tick();
      } catch (err) {
        this.log(`room ${code} tick error`, err);
      }
      if (!room.members.size && room.emptySince && now - room.emptySince > 60000) {
        this.rooms.delete(code);
        this.publicDirty ||= room.isPublic;
        this.log(`room ${code} closed (empty)`);
      }
    }
    this._pushPublic(now);
    // forget sessions that have been offline too long
    for (const [k, c] of this.sessions) if (c.offlineAt && now - c.offlineAt > NET.reconnectGrace * 1000 + 5000) this.sessions.delete(k);
    // idle: nobody connected and nothing left to keep → let the host sleep
    if (!this.clients.size && !this.rooms.size && !this.sessions.size) this.stop();
  }

  /** Tell everyone the server is going away and close their sockets. */
  shutdown(msg = 'Server restarting') {
    this.stop();
    for (const c of this.clients) {
      try {
        c.send(S.SHUTDOWN, { msg });
        c.ws.close(1012, 'server restart');
      } catch {
        /* ignore */
      }
    }
  }

  // ---------------------------------------------------------------- rooms + public pool
  _createRoom(client, settings, isPublic) {
    if (client.room) client.room.remove(client.id);
    if (this.rooms.size > 500) {
      client.send(S.ERROR, { msg: 'Server is full, try again later.' });
      return null;
    }
    const code = makeCode(this.rooms);
    const room = new Room(code, this.track, this.log);
    this.rooms.set(code, room);
    if (this.debug) room.onViolation = (r, info) => this.log('violation', r.name, JSON.stringify(info));
    room.isPublic = isPublic;
    room.onChange = (r) => (this.publicDirty ||= r.isPublic);
    room.hostId = client.id;
    room.settings = settings;
    room.add(client);
    this.log(`${isPublic ? 'public ' : ''}room ${code} created by ${client.name}`);
    return room;
  }

  /** Move a client into a room (leaving any other room first). Capacity is checked by the caller. */
  _enter(client, room) {
    if (client.room && client.room !== room) client.room.remove(client.id);
    if (!room.members.has(client.id)) room.add(client);
    this.log(`${client.name} joined ${room.isPublic ? 'public ' : ''}${room.code}`);
  }

  /**
   * Server-side matchmaking. Messages are handled one at a time, so the capacity check and the
   * join below are atomic: two players can never both take the last seat.
   * Preference: most riders waiting (never an emptier lobby when a fuller one has room), then the
   * oldest lobby, then the requested map. Nothing suitable -> open a public lobby for this player.
   */
  _quickJoin(client, track, fallback = false) {
    const mine = client.room;
    if (mine?.isPublic && mine.phase === 'lobby') return this._matched(client, mine, { fallback, created: false });
    const best = [...this.rooms.values()]
      .filter((r) => r.listable && r !== mine)
      .sort((a, b) => b.members.size - a.members.size || a.createdAt - b.createdAt || (b.settings.track === track) - (a.settings.track === track))[0];
    if (best) {
      this._enter(client, best);
      return this._matched(client, best, { fallback, created: false });
    }
    const room = this._createRoom(client, roomSettings({ track }, PUBLIC_DEFAULTS), true);
    if (room) this._matched(client, room, { fallback, created: true });
  }

  _matched(client, room, { fallback, created }) {
    client.send(S.MATCH, { code: room.code, created, fallback, players: room.members.size, max: NET.maxPlayers });
  }

  /** One matchmaking request per second per client (no room churn, no duplicate joins). */
  _matchCooldown(client) {
    const now = Date.now();
    if (now - client.lastMatchAt < 1000) return true;
    client.lastMatchAt = now;
    return false;
  }

  _publicList() {
    return [...this.rooms.values()]
      .filter((r) => r.listable)
      .sort((a, b) => b.members.size - a.members.size || a.createdAt - b.createdAt)
      .slice(0, MAX_LISTED)
      .map((r) => r.publicInfo());
  }

  /** Push the public list to watchers only when it changed, at most twice a second. */
  _pushPublic(now) {
    if (!this.publicDirty || !this.watchers.size || now - this.publicSentAt < 500) return;
    this.publicDirty = false;
    this.publicSentAt = now;
    const rooms = this._publicList();
    const json = JSON.stringify(rooms);
    if (json === this.publicLast) return;
    this.publicLast = json;
    const msg = JSON.stringify({ t: S.PUBLIC, rooms });
    for (const c of this.watchers) c.sendRaw(msg);
  }

  // ---------------------------------------------------------------- protocol
  _handle(client, m) {
    const { rooms, sessions, log } = this;
    switch (m.t) {
      case C.HELLO: {
        if (m.v !== PROTOCOL_VERSION) return client.send(S.ERROR, { msg: 'Game version mismatch — please reload the page.' });
        // reconnection: adopt the previous identity if the session is still known
        const prev = m.session && sessions.get(m.session);
        if (prev && prev !== client) {
          if (prev.ws && prev.ws.isOpen()) prev.ws.terminate(); // stale socket
          prev.offlineAt = prev.offlineAt || Date.now();
          client.id = prev.id;
          client.session = prev.session;
          client.room = null;
          applyProfile(client, m);
          sessions.set(client.session, client);
          const room = prev.room;
          client.send(S.WELCOME, { id: client.id, session: client.session, resumed: !!room });
          if (room && rooms.has(room.code) && room.reconnected(client)) log(`${client.name} reconnected to ${room.code}`);
          return;
        }
        applyProfile(client, m);
        sessions.set(client.session, client);
        client.send(S.WELCOME, { id: client.id, session: client.session, resumed: false });
        return;
      }
      case C.PROFILE:
        if (client.room?.phase === 'lobby' || !client.room) {
          applyProfile(client, m);
          client.room?.broadcastRoom();
        }
        return;
      case C.CREATE:
        // stunt challenges are private (friends join by code), never in the public pool
        this._createRoom(client, roomSettings(m, { laps: 2, bots: 0, skill: 'medium', track: 'mountain' }), !!m.public && m.mode !== 'stunt');
        return;
      case C.QUICK:
        if (this._matchCooldown(client)) return;
        this._quickJoin(client, m.track);
        return;
      case C.JOIN_PUBLIC: {
        if (this._matchCooldown(client)) return;
        const room = rooms.get(String(m.code || '').toUpperCase().trim());
        // re-validated here: the list the client saw may be stale (filled up, started, closed)
        if (room && (room === client.room || room.listable)) {
          if (room !== client.room) this._enter(client, room);
          this._matched(client, room, { fallback: false, created: false });
        } else this._quickJoin(client, m.track, true);
        return;
      }
      case C.WATCH:
        if (m.on) {
          this.watchers.add(client);
          client.send(S.PUBLIC, { rooms: this._publicList() });
        } else this.watchers.delete(client);
        return;
      case C.JOIN: {
        const code = String(m.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return client.send(S.ERROR, { msg: `Room ${code} not found.` });
        if (room.members.size >= NET.maxPlayers) return client.send(S.ERROR, { msg: 'That room is full (8 riders).' });
        this._enter(client, room);
        return;
      }
      case C.LEAVE:
        if (client.room) {
          client.room.remove(client.id);
          client.send(S.LEFT);
        }
        return;
      case C.READY:
        client.room?.setReady(client.id, m.ready);
        return;
      case C.SETTINGS:
        client.room?.updateSettings(client.id, m);
        return;
      case C.START: {
        const r = client.room?.start(client.id);
        if (r?.error) client.send(S.ERROR, { msg: r.error });
        return;
      }
      case C.STATE:
        client.room?.onState(client.id, m.q, Number(m.ct));
        return;
      case C.LOBBY:
        client.room?.backToLobby(client.id, m.ready);
        return;
      case C.STUNT_DONE:
        client.room?.onStuntDone(client.id, m);
        return;
      case C.PING:
        client.send(S.PONG, { c: m.c, s: Date.now() });
        return;
      default:
    }
  }
}
