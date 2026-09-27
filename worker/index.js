// Cloudflare deployment: the Worker serves the built client (client/dist) and hands every
// WebSocket to one Durable Object that runs the same GameServer as the Node server.
import { DurableObject } from 'cloudflare:workers';
import { GameServer } from '../server/GameServer.js';

const log = (...a) => console.log(...a);

export class GameServerDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = new GameServer({ log, debug: env.VR_DEBUG === '1' });
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/health') return Response.json(this.game.stats());
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const [clientSide, ws] = Object.values(new WebSocketPair());
    ws.accept();
    const client = this.game.connect(
      {
        send: (str) => ws.send(str),
        isOpen: () => ws.readyState === WebSocket.OPEN,
        close: (code, reason) => ws.close(code, reason),
        terminate: () => ws.close(4000, 'replaced'),
      },
      request.headers.get('CF-Connecting-IP') || '',
    );
    ws.addEventListener('message', (e) => this.game.message(client, e.data));
    ws.addEventListener('close', () => this.game.disconnect(client));
    ws.addEventListener('error', () => this.game.disconnect(client));
    return new Response(null, { status: 101, webSocket: clientSide });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') === 'websocket' || url.pathname === '/health') {
      return env.GAME.get(env.GAME.idFromName('global')).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
