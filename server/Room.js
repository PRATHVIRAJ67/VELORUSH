// A multiplayer room: lobby -> countdown -> racing -> results.
// The server owns the race clock, checkpoints, laps, finish order and bots.
// Clients simulate their own rider (for responsiveness) and stream state that
// the server validates before accepting.

import { Race } from '@cyclegame/shared/race.js';
import { NET, PHYSICS, AI_NAMES, BIKES, COLORS, OUTFITS, AI_SKILLS, WEATHER, pickWeather } from '@cyclegame/shared/constants.js';
import { S, packBike, unpackBike, FL, ROOM_CODE_CHARS } from '@cyclegame/shared/protocol.js';
import { maxAccel } from '@cyclegame/shared/physics.js';
import { getTrack, TRACK_IDS } from '@cyclegame/shared/tracks.js';
import { makeRng } from '@cyclegame/shared/math.js';

export function makeCode(existing) {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    if (!existing.has(c)) return c;
  }
}

const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

export class Room {
  constructor(code, track, log) {
    this.code = code;
    this.track = track;
    this.log = log;
    this.phase = 'lobby';
    this.hostId = null;
    this.members = new Map(); // id -> {client, ready, spectator, connected, leftAt}
    this.settings = { laps: 2, bots: 2, skill: 'medium', weather: 'clear', track: 'mountain' };
    this.race = null;
    this.goAt = 0;
    this.createdAt = Date.now();
    this.emptySince = null;
    this.snapAcc = 0;
    this.lastTick = Date.now();
    this.finishDeadline = null;
    this.resultsAt = null;
    this.botLooks = [];
  }

  // ---------------- membership ----------------
  get humanCount() {
    return this.members.size;
  }

  add(client) {
    const late = this.phase !== 'lobby';
    this.members.set(client.id, { client, ready: false, spectator: late, connected: true, leftAt: null });
    client.room = this;
    if (!this.hostId) this.hostId = client.id;
    this.emptySince = null;
    this.broadcastRoom();
    if (late && this.race) this.sendStart(client, true);
  }

  remove(id, reason = 'left') {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    if (m.client.room === this) m.client.room = null;
    if (this.race) {
      const r = this.race.byId.get(id);
      if (r && !r.finished) {
        this.race.markDnf(r);
        r.bike.frozen = true;
      }
    }
    if (this.hostId === id) {
      const next = [...this.members.values()].find((x) => x.connected) || [...this.members.values()][0];
      this.hostId = next ? next.client.id : null;
    }
    if (!this.members.size) this.emptySince = Date.now();
    this.log(`room ${this.code}: ${m.client.name} ${reason}`);
    this.broadcastRoom();
    this.checkRaceEnd();
  }

  disconnected(id) {
    const m = this.members.get(id);
    if (!m) return;
    m.connected = false;
    m.leftAt = Date.now();
    const r = this.race?.byId.get(id);
    if (r) r.connected = false;
    this.broadcastRoom();
  }

  reconnected(client) {
    const m = this.members.get(client.id);
    if (!m) return false;
    m.client = client;
    m.connected = true;
    m.leftAt = null;
    client.room = this;
    const r = this.race?.byId.get(client.id);
    if (r) r.connected = true;
    this.send(client, S.ROOM, { room: this.snapshot() });
    if (this.race && (this.phase === 'countdown' || this.phase === 'racing')) this.sendStart(client, !r, r);
    else if (this.phase === 'results') this.send(client, S.RESULTS, this.resultsPayload());
    this.broadcastRoom();
    return true;
  }

  // ---------------- lobby actions ----------------
  setReady(id, ready) {
    const m = this.members.get(id);
    if (!m || this.phase !== 'lobby') return;
    m.ready = !!ready;
    this.broadcastRoom();
  }

  updateSettings(id, s) {
    if (id !== this.hostId || this.phase !== 'lobby') return;
    if (s.laps !== undefined) this.settings.laps = clampInt(s.laps, 1, 3, 2);
    if (s.bots !== undefined) this.settings.bots = clampInt(s.bots, 0, NET.maxPlayers - 1, 2);
    if (s.skill !== undefined && AI_SKILLS[s.skill]) this.settings.skill = s.skill;
    if (s.weather !== undefined && (WEATHER[s.weather] || s.weather === 'random')) this.settings.weather = s.weather;
    if (s.track !== undefined && TRACK_IDS.includes(s.track)) this.settings.track = s.track;
    this.broadcastRoom();
  }

  botCount() {
    return Math.max(0, Math.min(this.settings.bots, NET.maxPlayers - this.members.size));
  }

  canStart() {
    const humans = [...this.members.values()].filter((m) => m.connected);
    return this.phase === 'lobby' && humans.length >= NET.minPlayersToStart && humans.every((m) => m.ready);
  }

  start(id) {
    if (id !== this.hostId) return { error: 'Only the host can start the race' };
    if (!this.canStart()) return { error: 'Everyone must be ready first' };
    this.track = getTrack(this.settings.track);
    const race = new Race(this.track, { laps: this.settings.laps, countdown: NET.countdown, weather: pickWeather(this.settings.weather) });
    const rng = makeRng(Date.now() & 0xffffff);
    let slot = 0;
    const humans = [...this.members.values()].filter((m) => m.connected);
    for (const m of humans) {
      m.spectator = false;
      const c = m.client;
      race.addRacer({ id: c.id, name: c.name, external: true, slot: slot++, bikeId: c.bikeId, look: c.look });
    }
    for (const m of this.members.values()) if (!m.connected) m.spectator = true;
    const names = [...AI_NAMES].sort(() => rng() - 0.5);
    for (let i = 0; i < this.botCount(); i++) {
      race.addRacer({
        id: `bot${i}`,
        name: names[i] + ' (AI)',
        isBot: true,
        skill: this.settings.skill,
        slot: slot++,
        seed: Math.floor(rng() * 1e6),
        bikeId: BIKES[Math.floor(rng() * BIKES.length)].id,
        look: {
          frame: COLORS[Math.floor(rng() * COLORS.length)],
          jersey: COLORS[Math.floor(rng() * COLORS.length)],
          accent: COLORS[Math.floor(rng() * COLORS.length)],
          outfit: OUTFITS[Math.floor(rng() * OUTFITS.length)].id,
        },
      });
    }
    for (const r of race.racers) {
      r.lastStateAt = 0;
      r.violations = 0;
    }
    this.race = race;
    this.phase = 'countdown';
    this.goAt = Date.now() + NET.countdown * 1000;
    this.lastTick = Date.now();
    this.finishDeadline = null;
    this.resultsAt = null;
    this.log(`room ${this.code}: race start, ${race.racers.length} riders, ${race.laps} laps`);
    for (const m of this.members.values()) if (m.connected) this.sendStart(m.client, m.spectator);
    this.broadcastRoom();
    return { ok: true };
  }

  sendStart(client, spectator, racer = null) {
    const race = this.race;
    this.send(client, S.START, {
      goAt: this.goAt,
      laps: race.laps,
      weather: race.weather,
      track: this.track.id,
      spectator: !!spectator,
      grid: race.racers.map((r) => ({ id: r.id, name: r.name, look: r.look, bikeId: r.bikeId, slot: r.slot, bot: r.isBot })),
      resume: racer ? { u: racer.bike.u, d: racer.bike.d, yaw: racer.bike.yaw, v: racer.bike.v, lap: racer.lap, gate: racer.gate, finished: racer.finished } : null,
    });
  }

  backToLobby(id, ready) {
    if (this.phase === 'results') {
      this.phase = 'lobby';
      this.race = null;
      for (const m of this.members.values()) {
        m.ready = false;
        m.spectator = false;
      }
    }
    if (this.phase === 'lobby') {
      const m = this.members.get(id);
      if (m) m.ready = !!ready;
      this.broadcastRoom();
    }
  }

  // ---------------- client state (validated) ----------------
  /** q: packed bike state; ct: client send time (ms) for jitter-proof timing */
  onState(id, q, ct) {
    const race = this.race;
    if (!race || !Array.isArray(q) || q.length < 8) return;
    const r = race.byId.get(id);
    if (!r || r.dnf) return;
    const now = Date.now();
    if (this.phase === 'countdown') return; // riders are held on the grid
    const st = unpackBike(q, {});
    for (const k of ['u', 'd', 'yaw', 'v', 'y', 'lean', 'steer']) if (!Number.isFinite(st[k])) return;
    const b = r.bike;
    // Time between the client's own send stamps is immune to network bursts. A client can't
    // claim more time than really passed: its total is capped at server time + 1 s.
    let dt;
    const arrivalDt = r.lastStateAt ? Math.min(1, Math.max(0.02, (now - r.lastStateAt) / 1000)) : 0.05;
    if (Number.isFinite(ct) && Number.isFinite(r.lastCt) && ct > r.lastCt) {
      const claimed = (ct - r.lastCt) / 1000;
      r.clientClock = (r.clientClock || 0) + claimed;
      r.serverClock = (r.serverClock || 0) + (now - r.lastStateAt) / 1000;
      const budget = r.serverClock + 1 - (r.clientClock - claimed);
      dt = Math.min(1, Math.max(0.005, Math.min(claimed, budget)));
    } else dt = arrivalDt;
    if (Number.isFinite(ct)) r.lastCt = ct;
    r.lastStateAt = now;
    const vMax = PHYSICS.safetyMaxSpeed;
    const vPrev = b.v;
    // --- physics envelope: the fastest this rider could legally be going ---
    const pad = this.track.boostAt(st.u, st.d) || this.track.boostAt(b.u, b.d);
    const wantsBoost = !!(st.fl & FL.BOOST);
    const wantsSprint = !!(st.fl & FL.SPRINT);
    if (r.stam === undefined) {
      r.stam = PHYSICS.staminaMax;
      r.vUB = vPrev;
      r.boostT = 0;
    }
    if (wantsBoost && !r.prevBoost && !pad) {
      if (r.stam >= PHYSICS.boostCost - 4) {
        r.stam -= PHYSICS.boostCost;
        r.boostT = PHYSICS.boostDuration + 0.3;
      }
    }
    if (pad) r.boostT = Math.max(r.boostT, 1.7);
    r.prevBoost = wantsBoost;
    if (wantsSprint) r.stam -= (PHYSICS.sprintDrain / 1.05) * dt;
    else r.stam += (PHYSICS.staminaRegen + PHYSICS.draftRegenBonus) * 1.25 * dt;
    r.stam = Math.max(-8, Math.min(PHYSICS.staminaMax, r.stam));
    const canBoost = r.boostT > 0;
    const canSprint = wantsSprint && r.stam > -8;
    r.boostT = Math.max(0, r.boostT - dt);
    const slope = this.track.sample(b.s).slope;
    let vUB = r.vUB;
    const steps = Math.max(1, Math.ceil(dt / 0.05));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) vUB = Math.max(0, vUB + maxAccel(vUB, slope, { sprint: canSprint, boost: canBoost }) * h);
    vUB = Math.min(vUB, PHYSICS.safetyMaxSpeed);
    // plausibility: speed within the envelope + distance consistent with speed
    const vOk = st.v >= 0 && st.v <= vMax && st.v <= vUB * 1.06 + 1;
    const du = st.u - b.u;
    const maxDu = ((vPrev + Math.min(st.v, vUB + 1)) / 2) * dt * 1.3 + 2;
    const duOk = du <= maxDu && du >= -(maxDu + 6);
    // envelope restarts from what the rider actually reported (can't bank slack)
    r.vUB = vOk ? Math.min(vUB, st.v + 1.5) : Math.min(vUB, vPrev + 1.5);
    const c = this.track.sample(b.s);
    const yOk = st.y > c.y - 3 && st.y < c.y + 8;
    // Marginal deviations (network bursts, rounding) earn decaying strikes; clear cheats are rejected at once.
    const hard = !yOk || st.v > vMax || st.v > vUB * 1.15 + 2.5 || du > maxDu * 1.6 + 2 || du < -(maxDu + 6);
    r.strikes = Math.max(0, (r.strikes || 0) - dt * 1.5);
    const soft = !vOk || !duOk;
    if (soft || hard) {
      if (!hard) r.strikes += 1;
      this.onViolation?.(r, { hard, strikes: r.strikes, vOk, duOk, yOk, v: st.v, vPrev, vUB, du, maxDu, dt, y: st.y, roadY: c.y, s: b.s, fl: st.fl, stam: r.stam });
    }
    if (hard || r.strikes > 3) {
      r.violations++;
      // reject + tell the client where the server believes it is
      if (r.violations % 3 === 1) this.send(this.members.get(id)?.client, S.CORRECT, { u: b.u, d: b.d, v: Math.min(b.v, vMax) });
      return;
    }
    b.u = st.u;
    b.s = this.track.wrap(st.u);
    b.d = Math.max(-this.track.limit - 0.3, Math.min(this.track.limit + 0.3, st.d));
    b.yaw = st.yaw;
    b.v = st.v;
    b.y = st.y;
    b.lean = st.lean;
    b.steer = st.steer;
    b.sprinting = !!(st.fl & FL.SPRINT);
    b.brake = st.fl & FL.BRAKE ? 1 : 0;
    b.airborne = !!(st.fl & FL.AIR);
    b.boostTimer = st.fl & FL.BOOST ? 0.5 : 0;
    b.throttle = st.fl & FL.THROTTLE ? 1 : 0;
    b.exhausted = !!(st.fl & FL.EXHAUSTED);
    b.stamina = Math.max(0, Math.min(100, st.stamina || 0));
    b.draft = st.draft;
  }

  // ---------------- simulation tick ----------------
  tick() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    // drop riders that never came back
    for (const [id, m] of this.members) {
      if (!m.connected && m.leftAt) {
        const grace = this.phase === 'lobby' || this.phase === 'results' ? 8 : NET.reconnectGrace;
        if (now - m.leftAt > grace * 1000) this.remove(id, 'timed out');
      }
    }
    if (this.phase === 'results' && this.resultsAt && now - this.resultsAt > 45000) this.backToLobby(null, false);
    const race = this.race;
    if (!race || (this.phase !== 'countdown' && this.phase !== 'racing')) return;
    // race clock is derived from the authoritative GO time
    const targetTime = (now - this.goAt) / 1000;
    race.update(Math.max(0, targetTime - race.time));
    if (this.phase === 'countdown' && race.phase === 'racing') this.phase = 'racing';
    for (const e of race.drainEvents()) {
      if (e.type === 'go') continue;
      this.broadcast(S.EVENT, { e: e.type, id: e.id, time: e.time, lap: e.lap, gate: e.gate, place: e.place, lapTime: e.lapTime });
      if (e.type === 'finish' && this.finishDeadline === null) this.finishDeadline = now + NET.finishTimeout * 1000;
    }
    // external riders that stopped sending (disconnected) coast to a stop
    for (const r of race.racers) {
      if (!r.external || r.finished) continue;
      if (now - r.lastStateAt > 1500 && r.lastStateAt) r.bike.v *= 0.9;
    }
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / NET.snapshotRate) {
      this.snapAcc = 0;
      this.broadcastSnapshot(now);
    }
    this.checkRaceEnd();
  }

  checkRaceEnd() {
    const race = this.race;
    if (!race || this.phase !== 'racing') return;
    const now = Date.now();
    const humans = race.racers.filter((r) => r.external && !r.dnf);
    const humansDone = humans.every((r) => r.finished);
    if ((humansDone && humans.length) || (this.finishDeadline && now > this.finishDeadline) || !humans.length) {
      // bots still racing get a fast-forwarded (server simulated) finish
      if (humansDone) {
        for (const r of race.racers) if (r.external && !r.finished) race.markDnf(r);
        race.simulateToEnd(90);
      }
      for (const r of race.racers) if (!r.finished && !r.dnf) race.markDnf(r);
      race.updatePlaces();
      race.drainEvents();
      this.phase = 'results';
      this.resultsAt = now;
      this.broadcast(S.RESULTS, this.resultsPayload());
      this.broadcastRoom();
      this.log(`room ${this.code}: race finished`);
    }
  }

  resultsPayload() {
    const s = this.race.standings();
    const win = s[0]?.finishTime ?? null;
    return {
      laps: this.race.laps,
      rows: s.map((r, i) => ({
        place: i + 1,
        id: r.id,
        name: r.name,
        color: r.look?.jersey || '#888',
        time: r.finished ? r.finishTime : null,
        gap: r.finished && i > 0 && win != null ? r.finishTime - win : null,
        best: r.bestLap,
        status: r.dnf ? 'DNF' : '',
        bot: r.isBot,
      })),
    };
  }

  broadcastSnapshot(now) {
    const race = this.race;
    const p = race.racers.map((r) => {
      const a = packBike(r.bike);
      if (r.finished) a[7] |= FL.FINISHED;
      if (r.dnf) a[7] |= FL.DNF;
      if (r.connected === false) a[7] |= FL.OFFLINE;
      return [r.id, ...a, r.lap, r.gate, r.place, r.finishTime ?? -1];
    });
    this.broadcast(S.SNAP, { ts: now, rt: race.time, p });
  }

  // ---------------- messaging ----------------
  snapshot() {
    const players = [...this.members.values()].map((m) => ({
      id: m.client.id,
      name: m.client.name,
      look: m.client.look,
      bikeId: m.client.bikeId,
      ready: m.ready,
      connected: m.connected,
      spectator: m.spectator && this.phase !== 'lobby',
    }));
    for (let i = 0; i < this.botCount(); i++) {
      players.push({ id: `bot${i}`, name: `AI rider ${i + 1}`, bot: true, skill: AI_SKILLS[this.settings.skill].name, look: { jersey: '#5c6b85' }, ready: true });
    }
    return { code: this.code, hostId: this.hostId, phase: this.phase, settings: this.settings, players };
  }

  broadcastRoom() {
    this.broadcast(S.ROOM, { room: this.snapshot() });
  }

  send(client, type, payload) {
    if (!client) return;
    client.send(type, payload);
  }

  broadcast(type, payload) {
    const msg = JSON.stringify({ t: type, ...payload });
    for (const m of this.members.values()) if (m.connected) m.client.sendRaw(msg);
  }
}
