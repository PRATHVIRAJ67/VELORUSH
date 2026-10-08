// WebSocket client: connection, clock sync, reconnection, lobby/race message routing.
import { C, S, PROTOCOL_VERSION, packBike } from '@shared/protocol.js';
import { NET } from '@shared/constants.js';
import { NetSession } from '../race/NetSession.js';

const SESSION_KEY = 'velorush.session';

function loadSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function storeSession(s) {
  try {
    sessionStorage.setItem(SESSION_KEY, s);
  } catch {
    /* ignore */
  }
}

export class NetClient {
  constructor(app) {
    this.app = app;
    this.ws = null;
    this.status = 'offline';
    this.id = null;
    this.session = loadSession();
    this.room = null;
    this.offset = 0;
    this.samples = [];
    this.rtt = 0;
    this.retry = 0;
    this.wantRoom = false; // are we (supposed to be) in a room?
    this.lostAt = 0;
    this.pingTimer = null;
    this.connecting = null;
    this.watching = false; // receiving the public lobby list (multiplayer screen open)
  }

  get online() {
    return this.status === 'online';
  }

  serverNow() {
    return performance.now() + this.offset;
  }

  // ---------------------------------------------------------------- connection
  connect() {
    if (this.online) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const url = this.app.settings.server;
    this._status('wait', `Connecting to ${url}…`);
    this.connecting = new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        this.connecting = null;
        this._status('err', 'Invalid server address');
        reject(err);
        return;
      }
      this.ws = ws;
      const timeout = setTimeout(() => ws.close(), 6000);
      ws.onopen = () => {
        const p = this.app.profile;
        this._send(C.HELLO, { v: PROTOCOL_VERSION, name: p.name, look: this._look(), bikeId: p.bikeId, session: this.session });
      };
      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.t === S.WELCOME) {
          clearTimeout(timeout);
          this.connecting = null;
          resolve();
        }
        this._onMessage(m);
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        const wasOnline = this.online;
        this.status = 'offline';
        this.ws = null;
        clearInterval(this.pingTimer);
        if (this.connecting) {
          this.connecting = null;
          reject(new Error('Could not reach the server'));
        }
        this._status('err', 'Offline');
        if (this.wantRoom) this._scheduleReconnect(wasOnline);
      };
      ws.onerror = () => {};
    });
    return this.connecting;
  }

  _scheduleReconnect(justLost) {
    if (justLost) {
      this.lostAt = performance.now();
      this.app.ui.toast('Connection lost — reconnecting…', 4000);
      this.app.session?.onConnectionLost?.();
    }
    const elapsed = (performance.now() - this.lostAt) / 1000;
    if (elapsed > NET.reconnectGrace) {
      this._roomLost('Could not reconnect to the server.');
      return;
    }
    const delay = Math.min(8000, 800 * 2 ** this.retry++);
    setTimeout(() => {
      if (!this.wantRoom || this.online) return;
      this.connect().catch(() => {});
    }, delay);
  }

  _roomLost(msg) {
    this.wantRoom = false;
    this.room = null;
    this.retry = 0;
    if (this.app.session?.isNet) this.app.quitToMenu('mp');
    else if (this.app.ui.currentMenu === 'lobby') this.app.ui.showMenu('mp');
    setTimeout(() => this.app.ui.toast(msg, 5000), 350);
  }

  _status(state, text) {
    this.app.ui.setNetStatus(state, text);
  }

  _look() {
    const p = this.app.profile;
    return { frame: p.frame, jersey: p.jersey, accent: p.accent, outfit: p.outfit, skin: p.skin };
  }

  _send(t, payload = {}) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...payload }));
  }

  _ping() {
    this._send(C.PING, { c: performance.now() });
  }

  // ---------------------------------------------------------------- actions
  async createRoom(opts) {
    try {
      await this.connect();
      this.wantRoom = true;
      this._send(C.CREATE, opts);
    } catch {
      this.app.ui.toast('Cannot reach the multiplayer server. Is it running? (npm run dev:server)', 5000);
    }
  }

  /** Server-side matchmaking: join the best public lobby, or open one (track = preferred map). */
  async quickJoin(track) {
    try {
      await this.connect();
      this.wantRoom = true;
      this._send(C.QUICK, { track });
      return true;
    } catch {
      this.app.ui.toast('Cannot reach the multiplayer server right now.', 4000);
      return false;
    }
  }

  /** Join a lobby from the public list (the server re-checks it and falls back to Quick Join). */
  async joinPublic(code, track) {
    try {
      await this.connect();
      this.wantRoom = true;
      this._send(C.JOIN_PUBLIC, { code, track });
      return true;
    } catch {
      this.app.ui.toast('Cannot reach the multiplayer server right now.', 4000);
      return false;
    }
  }

  /** Receive public lobby updates only while the multiplayer screen is open. */
  watchPublic(on) {
    if (this.watching === on) return;
    this.watching = on;
    if (this.online) this._send(C.WATCH, { on });
  }

  async joinRoom(code) {
    try {
      await this.connect();
      this.wantRoom = true;
      this._send(C.JOIN, { code });
    } catch {
      this.app.ui.toast('Cannot reach the multiplayer server. Is it running? (npm run dev:server)', 5000);
    }
  }

  leaveRoom(silent = false) {
    this.wantRoom = false;
    this._send(C.LEAVE);
    this.room = null;
    if (!silent) this.app.ui.showMenu('mp');
  }

  toggleReady() {
    const me = this.room?.players.find((p) => p.id === this.id);
    this._send(C.READY, { ready: !me?.ready });
  }

  startRace() {
    this._send(C.START);
  }

  updateSettings(s) {
    this._send(C.SETTINGS, s);
  }

  backToLobby(ready) {
    this._send(C.LOBBY, { ready });
  }

  sendProfile() {
    if (!this.online) return;
    const p = this.app.profile;
    this._send(C.PROFILE, { name: p.name, look: this._look(), bikeId: p.bikeId });
  }

  sendState(bike) {
    this._send(C.STATE, { q: packBike(bike), ct: Math.round(performance.now()) });
  }

  /** Called on app start: nothing to do unless a room was active before a reload. */
  autoReconnect() {}

  // ---------------------------------------------------------------- messages
  _onMessage(m) {
    const app = this.app;
    switch (m.t) {
      case S.WELCOME: {
        const hadRoom = this.wantRoom && (this.room || app.session?.isNet);
        this.id = m.id;
        this.session = m.session;
        storeSession(m.session);
        this.status = 'online';
        this.retry = 0;
        this._status('ok', `Online · ${app.settings.server}`);
        this.samples = [];
        this._ping();
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this._ping(), 2000);
        if (this.watching) this._send(C.WATCH, { on: true });
        if (hadRoom && !m.resumed) this._roomLost('Your room was closed (the server restarted).');
        else if (hadRoom) app.ui.toast('Reconnected!', 1500);
        break;
      }
      case S.PONG: {
        const now = performance.now();
        const rtt = now - m.c;
        this.samples.push({ rtt, off: m.s + rtt / 2 - now });
        if (this.samples.length > 8) this.samples.shift();
        const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        // first sample snaps, later ones ease in to avoid clock jumps
        this.offset = this.samples.length === 1 ? best.off : this.offset + (best.off - this.offset) * 0.3;
        this.rtt = best.rtt;
        break;
      }
      case S.ROOM:
        this.room = m.room;
        if (!this.wantRoom) break;
        // preload the host's map while waiting in the lobby
        if (!app.session && m.room.settings.track && m.room.settings.track !== app.track.id) {
          app.loadTrack(m.room.settings.track).then(() => app.ui.currentMenu !== 'lobby' && app.ui.showMenu('lobby'));
        }
        if (!app.session) {
          if (app.ui.currentMenu !== 'lobby') app.ui.showMenu('lobby');
          app.ui.renderLobby(m.room, this.id);
        } else if (app.session.isNet) app.session.onRoom?.(m.room);
        break;
      case S.START:
        if (app.session?.isNet && m.resume) app.session.onResume(m);
        else if (app.session?.isNet && app.session.goAt === m.goAt) app.session.onResume(m);
        else {
          const begin = () => {
            app.startSession(new NetSession(app, this, m));
            app.ui.renderLobbyTrack?.();
          };
          if (m.track && m.track !== app.track.id) app.loadTrack(m.track).then(begin);
          else begin();
        }
        break;
      case S.SNAP:
        if (app.session?.isNet) app.session.onSnap(m);
        break;
      case S.EVENT:
        if (app.session?.isNet) app.session.onEvent(m);
        break;
      case S.CORRECT:
        if (app.session?.isNet) app.session.onCorrect(m);
        break;
      case S.RESULTS:
        if (app.session?.isNet) app.session.onResults(m);
        break;
      case S.ERROR:
        app.ui.toast(m.msg, 3500);
        if (/not found|full/.test(m.msg)) this.wantRoom = !!this.room;
        break;
      case S.LEFT:
        this.room = null;
        break;
      case S.PUBLIC:
        app.ui.renderPublicList(m.rooms);
        break;
      case S.MATCH:
        app.ui.onMatch(m);
        break;
      case S.SHUTDOWN:
        app.ui.toast('Server is restarting…', 3000);
        break;
      default:
    }
  }
}
