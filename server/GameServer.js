// Platform-neutral multiplayer core: clients, sessions, rooms and the simulation tick.
// Hosted by the Node server (server/index.js) and the Cloudflare Durable Object (worker/index.js).
// A socket is anything with { send(str), isOpen(), close(code, reason), terminate() }.
import { getTrack, TRACK_IDS } from '@cyclegame/shared/tracks.js';
import { NET, BIKE_BY_ID, OUTFITS } from '@cyclegame/shared/constants.js';
import { C, S, PROTOCOL_VERSION } from '@cyclegame/shared/protocol.js';
import { Room, makeCode } from './Room.js';

const randomId = () => 'p' + [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');

class Client {
  constructor(socket) {
    this.ws = socket;
    this.id = randomId();
    this.session = crypto.randomUUID();
    this.name = 'Rider';
    this.look = {};
    this.bikeId = 'allround';
    this.room = null;
    this.alive = true;
    this.lastMsg = 0;
    this.msgCount = 0;
    this.offlineAt = null;
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

function applyProfile(client, m) {
  client.name = cleanName(m.name);
  client.look = cleanLook(m.look);
  client.bikeId = BIKE_BY_ID[m.bikeId] ? m.bikeId : 'allround';
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
        this.log(`room ${code} closed (empty)`);
      }
    }
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
      case C.CREATE: {
        if (client.room) client.room.remove(client.id);
        if (rooms.size > 500) return client.send(S.ERROR, { msg: 'Server is full, try again later.' });
        const code = makeCode(rooms);
        const room = new Room(code, this.track, log);
        rooms.set(code, room);
        if (this.debug) room.onViolation = (r, info) => log('violation', r.name, JSON.stringify(info));
        room.hostId = client.id;
        room.settings = {
          laps: Math.max(1, Math.min(3, Math.round(Number(m.laps)) || 2)),
          bots: Math.max(0, Math.min(7, Math.round(Number(m.bots)) || 0)),
          skill: ['easy', 'medium', 'hard', 'elite'].includes(m.skill) ? m.skill : 'medium',
          weather: ['clear', 'cloudy', 'fog', 'rain', 'random'].includes(m.weather) ? m.weather : 'clear',
          track: TRACK_IDS.includes(m.track) ? m.track : 'mountain',
        };
        room.add(client);
        log(`room ${code} created by ${client.name}`);
        return;
      }
      case C.JOIN: {
        const code = String(m.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return client.send(S.ERROR, { msg: `Room ${code} not found.` });
        if (room.members.size >= NET.maxPlayers) return client.send(S.ERROR, { msg: 'That room is full (8 riders).' });
        if (client.room && client.room !== room) client.room.remove(client.id);
        if (!room.members.has(client.id)) room.add(client);
        log(`${client.name} joined ${code}`);
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
      case C.PING:
        client.send(S.PONG, { c: m.c, s: Date.now() });
        return;
      default:
    }
  }
}
