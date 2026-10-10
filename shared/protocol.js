// Network protocol shared by client and server (JSON over WebSocket).

export const PROTOCOL_VERSION = 1;

// client -> server
export const C = {
  HELLO: 'hello', // {v, name, look, bikeId, session}
  CREATE: 'create', // {laps, bots, skill, weather, track, public?, mode?: 'stunt', level?}
  JOIN: 'join', // {code}
  QUICK: 'quick', // {track?} server picks a public lobby (or opens one) — the client never chooses
  JOIN_PUBLIC: 'joinpub', // {code} join a listed public lobby; falls back to QUICK if it's gone
  WATCH: 'watch', // {on} receive the public lobby list while on the multiplayer screen
  LEAVE: 'leave',
  READY: 'ready', // {ready}
  SETTINGS: 'settings', // {laps?, bots?, skill?}
  START: 'start',
  STATE: 'state', // {q: packed bike state, ct: client send time ms}
  LOBBY: 'lobby', // {ready} return to lobby after results
  PROFILE: 'profile', // {name, look, bikeId}
  PING: 'ping', // {c}
  STUNT_DONE: 'stuntdone', // {score, complete, fail, time, u, st} stunt challenge: final result of my run
};

// server -> client
export const S = {
  WELCOME: 'welcome', // {id, session, resumed}
  ROOM: 'room', // {room}
  ERROR: 'error', // {msg}
  START: 'start', // {goAt, laps, track, weather, grid:[{id,name,look,bikeId,slot,bot}], spectator, resume?, mode?, level?}
  SNAP: 'snap', // {ts, rt, p: [packed racer]}
  EVENT: 'event', // {e, id, ...}
  CORRECT: 'correct', // {u, d, v}
  RESULTS: 'results', // {rows, laps}
  PONG: 'pong', // {c, s}
  LEFT: 'left', // you left the room
  PUBLIC: 'public', // {rooms: [{code, track, weather, laps, players, max, host, state}]} joinable public lobbies
  MATCH: 'match', // {code, created, fallback, players, max} result of QUICK / JOIN_PUBLIC
  SHUTDOWN: 'shutdown', // server going down
};

export const FL = { SPRINT: 1, BRAKE: 2, AIR: 4, BOOST: 8, THROTTLE: 16, FINISHED: 32, DNF: 64, OFFLINE: 128, EXHAUSTED: 256 };

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

/** Pack a bike state into a compact array for STATE / SNAP. */
export function packBike(b) {
  let fl = 0;
  if (b.sprinting) fl |= FL.SPRINT;
  if (b.brake > 0.1) fl |= FL.BRAKE;
  if (b.airborne) fl |= FL.AIR;
  if (b.boostTimer > 0) fl |= FL.BOOST;
  if (b.throttle > 0.05) fl |= FL.THROTTLE;
  if (b.exhausted) fl |= FL.EXHAUSTED;
  return [r2(b.u), r2(b.d), r3(b.yaw), r2(b.v), r2(b.y), r3(b.lean), r2(b.steer), fl, Math.round(b.stamina), r2(b.draft)];
}

export function unpackBike(a, out = {}) {
  out.u = a[0];
  out.d = a[1];
  out.yaw = a[2];
  out.v = a[3];
  out.y = a[4];
  out.lean = a[5];
  out.steer = a[6];
  out.fl = a[7];
  out.stamina = a[8];
  out.draft = a[9] || 0;
  return out;
}

export const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
