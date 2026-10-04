// Authoritative race rules: grid, countdown, checkpoints, laps, finish order.
// Used by the client for offline modes and by the server for online rooms.

import { PHYSICS, NET, AI_SKILLS, WEATHER } from './constants.js';
import { createBike, stepBike, makeStats, interactBikes, emptyInput } from './physics.js';
import { AIBrain } from './ai.js';

export function gridSlot(slot) {
  const row = Math.floor(slot / 4);
  const col = slot % 4;
  const ds = [-3.6, -1.2, 1.2, 3.6];
  return { u: -4 - row * 5 - (col % 2) * 1.2, d: ds[col] };
}

export class Race {
  /**
   * @param track built track
   * @param opts {laps, countdown}
   */
  constructor(track, opts = {}) {
    this.track = track;
    this.laps = opts.laps ?? 2;
    this.countdown = opts.countdown ?? NET.countdown;
    this.weather = WEATHER[opts.weather] ? opts.weather : 'clear';
    this.grip = WEATHER[this.weather].grip;
    this.time = -this.countdown; // race clock, 0 == GO
    this.phase = 'countdown';
    this.racers = [];
    this.byId = new Map();
    this.events = [];
    this.finishOrder = [];
    this.winnerTime = null;
    this.gates = [...track.checkpoints, track.length];
    this.acc = 0;
  }

  addRacer(cfg) {
    const slot = cfg.slot ?? this.racers.length;
    const g = gridSlot(slot);
    const bike = createBike(this.track, g.u, g.d);
    bike.frozen = true;
    const stats = makeStats(
      cfg.bikeId,
      cfg.powerMul ?? (cfg.isBot ? (AI_SKILLS[cfg.skill] || AI_SKILLS.medium).power : 1),
      cfg.assist ?? 0,
    );
    stats.grip = this.grip;
    stats.ai = !!cfg.isBot; // AI riders manage their own corner speed (no rider aids)
    const r = {
      id: cfg.id,
      name: cfg.name,
      isBot: !!cfg.isBot,
      external: !!cfg.external, // state supplied externally (network client)
      slot,
      look: cfg.look || {},
      bikeId: cfg.bikeId || 'allround',
      stats,
      brain: cfg.isBot ? new AIBrain(cfg.skill || 'medium', cfg.seed ?? slot * 97 + 13) : null,
      input: emptyInput(),
      bike,
      lap: 0,
      gate: 0,
      lapStart: 0,
      lapTimes: [],
      splits: [],
      bestLap: null,
      finished: false,
      finishTime: null,
      place: 0,
      dnf: false,
      connected: true,
      autopilot: null,
    };
    this.racers.push(r);
    this.byId.set(r.id, r);
    return r;
  }

  removeRacer(id) {
    const r = this.byId.get(id);
    if (!r) return;
    this.racers.splice(this.racers.indexOf(r), 1);
    this.byId.delete(id);
  }

  get totalDistance() {
    return this.laps * this.track.length;
  }

  progressOf(r) {
    return Math.max(0, Math.min(1, r.bike.u / this.totalDistance));
  }

  /** Fixed-step advance. */
  update(dt) {
    this.acc += dt;
    const h = PHYSICS.dt;
    let steps = 0;
    while (this.acc >= h && steps < 30) {
      this.step(h);
      this.acc -= h;
      steps++;
    }
    if (steps >= 30) this.acc = 0;
  }

  step(dt) {
    this.time += dt;
    if (this.phase === 'countdown' && this.time >= 0) {
      this.phase = 'racing';
      for (const r of this.racers) r.bike.frozen = false;
      this.events.push({ type: 'go' });
    }
    const L = this.track.length;
    const bikes = this.racers.map((r) => r.bike);
    for (const r of this.racers) {
      if (r.external) continue;
      let input = r.input;
      const brain = r.brain || r.autopilot;
      if (brain && this.phase !== 'countdown') {
        const others = [];
        for (const b of bikes) if (b !== r.bike) others.push(b);
        input = brain.update(r.bike, others, this.track, dt, {
          stats: r.stats,
          progress: this.progressOf(r),
          lap: r.lap,
          laps: this.laps,
        });
        if (r.finished) {
          input.sprint = false;
          input.boost = false;
          input.throttle *= 0.45;
        }
      }
      stepBike(r.bike, input, dt, this.track, r.stats);
      if (r.input.boost) r.input.boost = false; // edge-triggered
      if (r.input.reset) r.input.reset = false;
    }
    interactBikes(
      this.racers.map((r) => ({ bike: r.bike, movable: !r.external })),
      this.track,
      dt,
    );
    if (this.phase !== 'countdown') for (const r of this.racers) this.checkProgress(r, L);
    this.updatePlaces();
  }

  checkProgress(r, L = this.track.length) {
    if (r.finished || r.dnf) return;
    let guard = 0;
    while (r.bike.u >= r.lap * L + this.gates[r.gate] && guard++ < 4) {
      const isLine = r.gate === this.gates.length - 1;
      if (!isLine) {
        r.splits.push(this.time);
        this.events.push({ type: 'checkpoint', id: r.id, gate: r.gate, lap: r.lap, time: this.time });
        r.gate++;
      } else {
        const lapTime = this.time - r.lapStart;
        r.lapTimes.push(lapTime);
        if (r.bestLap === null || lapTime < r.bestLap) r.bestLap = lapTime;
        r.lapStart = this.time;
        r.lap++;
        r.gate = 0;
        if (r.lap >= this.laps) {
          this.finish(r);
          break;
        }
        this.events.push({ type: 'lap', id: r.id, lap: r.lap, time: this.time, lapTime });
      }
    }
  }

  finish(r) {
    r.finished = true;
    r.finishTime = this.time;
    this.finishOrder.push(r.id);
    r.place = this.finishOrder.length;
    if (this.winnerTime === null) this.winnerTime = this.time;
    if (!r.isBot && !r.external && !r.autopilot) {
      // local human: autopilot rides the cool-down lap
      r.autopilot = new AIBrain('easy', 999);
    }
    if (r.external) r.bike.frozen = false;
    this.events.push({ type: 'finish', id: r.id, place: r.place, time: this.time });
  }

  markDnf(r) {
    if (r.finished) return;
    r.dnf = true;
    this.events.push({ type: 'dnf', id: r.id });
  }

  get allDone() {
    return this.racers.every((r) => r.finished || r.dnf);
  }

  standings() {
    return [...this.racers].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      return b.bike.u - a.bike.u;
    });
  }

  updatePlaces() {
    const s = this.standings();
    for (let i = 0; i < s.length; i++) s[i].place = i + 1;
  }

  /** Fast-forward remaining racers (used when the player skips the cool-down). */
  simulateToEnd(maxSeconds = 240) {
    const h = PHYSICS.dt * 2;
    let t = 0;
    while (!this.allDone && t < maxSeconds) {
      this.step(h);
      t += h;
    }
    for (const r of this.racers) if (!r.finished) this.markDnf(r);
    this.updatePlaces();
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
