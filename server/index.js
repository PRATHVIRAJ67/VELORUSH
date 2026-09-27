// Velo Rush multiplayer server: WebSocket rooms + (optional) static hosting of the built client.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { getTrack, TRACK_IDS } from '@cyclegame/shared/tracks.js';
import { NET, BIKE_BY_ID, OUTFITS } from '@cyclegame/shared/constants.js';
import { C, S, PROTOCOL_VERSION } from '@cyclegame/shared/protocol.js';
import { Room, makeCode } from './Room.js';

const PORT = Number(process.env.PORT) || NET.port;
const DIST = resolve(fileURLToPath(new URL('../client/dist', import.meta.url)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const track = getTrack();
const rooms = new Map(); // code -> Room
const sessions = new Map(); // session token -> Client (kept briefly after disconnect)

// ---------------------------------------------------------------- static files
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: wss.clients.size, uptime: process.uptime() }));
    return;
  }
  // serve the production client build if present
  try {
    let p = normalize(decodeURIComponent(url.pathname));
    if (p.endsWith('/') || p === sep) p = join(p, 'index.html');
    const file = resolve(join(DIST, p));
    if (!file.startsWith(DIST)) throw new Error('bad path');
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Velo Rush multiplayer server is running.\nRun the client with "npm run dev:client" (http://localhost:5173) or build it with "npm run build" to serve it from here.');
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  }
});

// ---------------------------------------------------------------- clients
class Client {
  constructor(ws) {
    this.ws = ws;
    this.id = 'p' + randomBytes(4).toString('hex');
    this.session = randomUUID();
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
    if (this.ws && this.ws.readyState === 1) this.ws.send(str);
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

function handle(client, m) {
  switch (m.t) {
    case C.HELLO: {
      if (m.v !== PROTOCOL_VERSION) return client.send(S.ERROR, { msg: 'Game version mismatch — please reload the page.' });
      // reconnection: adopt the previous identity if the session is still known
      const prev = m.session && sessions.get(m.session);
      if (prev && prev !== client) {
        if (prev.ws && prev.ws.readyState === 1) prev.ws.terminate(); // stale socket
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
      const room = new Room(code, track, log);
      rooms.set(code, room);
      if (process.env.VR_DEBUG) room.onViolation = (r, info) => log('violation', r.name, JSON.stringify(info));
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

const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 });
wss.on('connection', (ws, req) => {
  const client = new Client(ws);
  ws.client = client;
  log(`connect ${req.socket.remoteAddress} (${wss.clients.size} online)`);
  ws.on('pong', () => (client.alive = true));
  ws.on('message', (data) => {
    // basic flood protection
    const now = Date.now();
    if (now - client.lastMsg > 1000) {
      client.lastMsg = now;
      client.msgCount = 0;
    }
    if (++client.msgCount > 120) return;
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    try {
      handle(client, m);
    } catch (err) {
      log('handler error', err);
    }
  });
  ws.on('close', () => {
    client.offlineAt = Date.now();
    // only if this socket still owns the seat (a reconnect may have replaced it)
    if (client.room && client.room.members.get(client.id)?.client === client) client.room.disconnected(client.id);
    log(`disconnect ${client.name} (${wss.clients.size} online)`);
  });
});

// heartbeat: drop dead sockets
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const c = ws.client;
    if (!c.alive) {
      ws.terminate();
      continue;
    }
    c.alive = false;
    ws.ping();
  }
}, 10000);

// simulation loop for all rooms
const loop = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    try {
      room.tick();
    } catch (err) {
      log(`room ${code} tick error`, err);
    }
    if (!room.members.size && room.emptySince && now - room.emptySince > 60000) {
      rooms.delete(code);
      log(`room ${code} closed (empty)`);
    }
  }
  // forget sessions that have been offline too long
  for (const [k, c] of sessions) if (c.offlineAt && now - c.offlineAt > NET.reconnectGrace * 1000 + 5000) sessions.delete(k);
}, 1000 / NET.tickRate);

http.listen(PORT, () => {
  log(`Velo Rush server listening on http://localhost:${PORT} (ws://localhost:${PORT})`);
  log(`track "${track.name}" ${track.length.toFixed(0)} m`);
});

// graceful shutdown: tell everyone, close sockets, exit
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${sig} received, shutting down…`);
  clearInterval(loop);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    try {
      ws.send(JSON.stringify({ t: S.SHUTDOWN, msg: 'Server restarting' }));
      ws.close(1012, 'server restart');
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 300);
  http.close();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
