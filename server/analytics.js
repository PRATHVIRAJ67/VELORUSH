// Validation for anonymous gameplay analytics posted by the client (client/src/core/analytics.js).
// Shared by the Cloudflare Worker (stores rows in Analytics Engine) and the Node server (dev: no-op).
// Only whitelisted events and short, sanitised fields are accepted; nothing personal is stored.

export const EVENTS = new Set([
  'session_start', 'session_pause', 'session_end', 'menu_view', 'race_start', 'race_finish', 'race_quit',
  'race_again', 'personal_best', 'medal', 'level_up', 'daily_complete', 'goal_click', 'multiplayer_race', 'multiplayer_finish', 'auto_next', 'auto_cancel',
]);
const ID = /^[a-z0-9]{8,32}$/;
const clean = (s, n) => String(s ?? '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, n);
const num = (v) => (Number.isFinite(v) ? Math.max(-1e7, Math.min(1e7, v)) : 0);

/** Parses a posted batch. Returns {aid, rows:[{blobs, doubles}]} or null when invalid. */
export function parseBatch(text) {
  if (typeof text !== 'string' || text.length > 16 * 1024) return null;
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return null;
  }
  if (!b || !ID.test(b.aid) || !ID.test(b.sid) || !Array.isArray(b.ev)) return null;
  const pf = clean(b.pf, 12);
  const build = clean(b.b, 16);
  const rows = [];
  for (const e of b.ev.slice(0, 50)) {
    if (!e || !EVENTS.has(e.e)) continue;
    // blob order is the query schema: blob1 event, blob2 map, blob3 mode, blob4 detail,
    // blob5 platform, blob6 build, blob7 install id, blob8 session id; double1 v, double2 v2
    rows.push({ blobs: [e.e, clean(e.m, 16), clean(e.md, 16), clean(e.x, 32), pf, build, b.aid, b.sid], doubles: [num(e.v), num(e.v2)] });
  }
  return { aid: b.aid, rows };
}
