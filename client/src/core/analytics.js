// Anonymous gameplay analytics (retention measurement). Events are batched and sent with
// sendBeacon to the game server's /a endpoint (Cloudflare Analytics Engine in production).
// Identity is a random install id: no names, no profile data, no IP/user agent stored by us.
// Failures are silent; the game never waits on analytics.

const KEY_ID = 'velorush.aid';
const KEY_SEEN = 'velorush.seen'; // {first: day, last: day, sessions}
const FLUSH_MS = 15000;
const MAX_QUEUE = 40;

const day = () => Math.floor(Date.now() / 86400000);
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 16);
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key, v) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage blocked: ids live for this page only */
  }
}

class Analytics {
  constructor() {
    this.queue = [];
    this.url = null;
    this.sid = rid();
    this.t0 = performance.now();
    this.races = 0;
    this.ctx = {};
    this.timer = null;
  }

  /** @param serverUrl ws(s):// game server; @param ctx {platform, build} */
  init(serverUrl, ctx) {
    try {
      this.url = serverUrl.replace(/^ws/, 'http').replace(/\/+$/, '') + '/a';
    } catch {
      return;
    }
    this.ctx = ctx;
    this.aid = read(KEY_ID) || rid();
    write(KEY_ID, this.aid);
    let seen = null;
    try {
      seen = JSON.parse(read(KEY_SEEN) || 'null');
    } catch {
      seen = null;
    }
    const today = day();
    const returning = !!seen;
    const first = seen?.first ?? today;
    const sessions = (seen?.sessions || 0) + 1;
    write(KEY_SEEN, JSON.stringify({ first, last: today, sessions }));
    // v: days since first play (0 = first day), v2: lifetime session number, x: days since last visit
    this.track('session_start', { x: returning ? String(today - seen.last) : 'new', v: today - first, v2: sessions });
    const end = () => {
      if (this.ended) return;
      this.ended = true;
      this.track('session_end', { v: Math.round((performance.now() - this.t0) / 1000), v2: this.races });
      this.flush();
    };
    // pagehide fires on tab close/navigation; hidden covers phones that kill the tab in the background
    addEventListener('pagehide', end);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.track('session_pause', { v: Math.round((performance.now() - this.t0) / 1000), v2: this.races });
        this.flush();
      } else if (this.ended) {
        this.ended = false; // back from the background (bfcache): same session continues
      }
    });
  }

  /**
   * @param e event name
   * @param p {m: map, md: mode, x: detail, v: number, v2: number}
   */
  track(e, p = {}) {
    if (!this.url) return;
    if (e === 'race_finish') this.races++;
    this.queue.push({ e, m: p.m || '', md: p.md || '', x: p.x == null ? '' : String(p.x).slice(0, 32), v: Number.isFinite(p.v) ? p.v : 0, v2: Number.isFinite(p.v2) ? p.v2 : 0 });
    if (this.queue.length >= MAX_QUEUE) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.queue.length || !this.url) return;
    const body = JSON.stringify({ aid: this.aid, sid: this.sid, pf: this.ctx.platform, b: this.ctx.build, ev: this.queue.splice(0, MAX_QUEUE) });
    try {
      // text/plain keeps it a simple cross-origin request (no CORS preflight from portals)
      const blob = new Blob([body], { type: 'text/plain' });
      if (!navigator.sendBeacon?.(this.url, blob)) fetch(this.url, { method: 'POST', body, keepalive: true, mode: 'no-cors' }).catch(() => {});
    } catch {
      /* analytics must never break the game */
    }
  }
}

export const analytics = new Analytics();
