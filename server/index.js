// Velo Rush multiplayer server: WebSocket rooms + (optional) static hosting of the built client.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { NET } from '@cyclegame/shared/constants.js';
import { GameServer } from './GameServer.js';
import { parseBatch } from './analytics.js';

const PORT = Number(process.env.PORT) || NET.port;
const DIST = resolve(fileURLToPath(new URL('../client/dist', import.meta.url)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const game = new GameServer({ log, debug: !!process.env.VR_DEBUG });

// ---------------------------------------------------------------- static files
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const http = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // anonymous analytics (production stores them in Cloudflare Analytics Engine); dev: validate + optional log
  if (url.pathname === '/a') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body.length < 20000 ? (body += d) : null));
      req.on('end', () => {
        const batch = parseBatch(body);
        if (batch && process.env.VR_ANALYTICS) for (const r of batch.rows) log('event', r.blobs.slice(0, 6).join(' '), r.doubles.join(' '));
      });
    }
    res.writeHead(204, { 'access-control-allow-origin': '*' });
    res.end();
    return;
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...game.stats(), uptime: process.uptime() }));
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

// ---------------------------------------------------------------- sockets
const wss = new WebSocketServer({ server: http, maxPayload: 16 * 1024 });
wss.on('connection', (ws, req) => {
  const client = game.connect(
    {
      send: (str) => ws.send(str),
      isOpen: () => ws.readyState === 1,
      close: (code, reason) => ws.close(code, reason),
      terminate: () => ws.terminate(),
    },
    req.socket.remoteAddress,
  );
  ws.client = client;
  ws.on('pong', () => (client.alive = true));
  ws.on('message', (data) => game.message(client, data.toString()));
  ws.on('close', () => game.disconnect(client));
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

http.listen(PORT, () => {
  log(`Velo Rush server listening on http://localhost:${PORT} (ws://localhost:${PORT})`);
  log(`track "${game.track.name}" ${game.track.length.toFixed(0)} m`);
});

// graceful shutdown: tell everyone, close sockets, exit
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${sig} received, shutting down…`);
  clearInterval(heartbeat);
  game.shutdown();
  setTimeout(() => process.exit(0), 300);
  http.close();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
