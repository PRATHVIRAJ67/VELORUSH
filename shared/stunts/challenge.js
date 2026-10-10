// Friend challenge on a stunt level, run inside the existing multiplayer Room (server). Same
// interface the Room uses for a Race (racers, update, events, standings, markDnf...), but the
// clock covers one stunt course: checkpoints are the course gates, the line is the course finish,
// and the ranking is by stunt score. Clients simulate their own run and report their score; the
// server only accepts what it can check: finish after every gate in order (from validated
// states), and a score no higher than what the observed air time could possibly earn.

import { createBike } from '../physics.js';
import { buildCourse } from './course.js';
import { POINTS, TRICK, comboMult } from './config.js';
import { STUNT_STAT_MAX } from './bikes.js';

const TAU = Math.PI * 2;
const LANES = [0, -2.4, 2.4, -4.2, 4.2, -1.2, 1.2, 3.3];

/**
 * Upper bound for one jump's points (before the combo multiplier) from what the server observed:
 * air time (20 Hz sampling slack added) and the largest streamed flip/spin angles. Rotations are
 * also capped by what the fastest bike could physically turn in that air time.
 */
export function jumpBound(air, maxPitch = Infinity, maxSpin = Infinity) {
  const a = Math.max(0, air) + 0.15;
  const turn = (rate, seen) => Math.min(Math.floor((a * rate * STUNT_STAT_MAX.rot) / TAU) + 1, Math.round(seen / TAU) + 1);
  const flips = turn(TRICK.flipRate, maxPitch);
  const spins = turn(TRICK.spinRate, maxSpin);
  const flipPts = flips ? POINTS.frontflip * flips * (POINTS.multiFlip[flips] ?? POINTS.multiFlip.at(-1)) : 0;
  return POINTS.clean + POINTS.airPerSec * a + POINTS.distPerM * 40 * a + flipPts + POINTS.spin * spins + POINTS.corkscrew + POINTS.stylePerSec * a + POINTS.perfect + POINTS.target + POINTS.ring * 2;
}

export class StuntChallenge {
  constructor(level, { countdown = 4.2 } = {}) {
    this.level = level;
    this.course = buildCourse(level);
    this.track = this.course.track;
    this.laps = 1;
    this.countdown = countdown;
    this.weather = this.track.def.env?.weather || 'clear';
    this.time = -countdown;
    this.phase = 'countdown';
    this.racers = [];
    this.byId = new Map();
    this.events = [];
    this.finishOrder = [];
    this.winnerTime = null;
    this.gates = [...this.course.gates.map((g) => g.u), this.course.finishU];
    this.timeLimit = level.time || 0;
  }

  addRacer(cfg) {
    const slot = cfg.slot ?? this.racers.length;
    const bike = createBike(this.track, this.course.startU, LANES[slot % LANES.length]);
    bike.frozen = true;
    const r = {
      id: cfg.id,
      name: cfg.name,
      isBot: false,
      external: true,
      slot,
      look: cfg.look || {},
      bikeId: cfg.bikeId || 'allround',
      bike,
      lap: 0,
      gate: 0,
      lapTimes: [],
      bestLap: null,
      finished: false, // crossed the line after every gate (server-observed)
      finishTime: null,
      reported: false, // client sent its final score
      score: 0,
      complete: false,
      adjusted: false,
      place: 0,
      dnf: false,
      connected: true,
      // server observations for plausibility
      jumps: [], // per observed jump: {air, p, s} (air time, largest |flip| and |spin| angle)
      airT: 0,
      jp: 0,
      js: 0,
      wasAir: false,
      maxPitch: 0,
      maxSpin: 0,
      tp: 0,
      ts: 0,
      sfl: 0,
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

  /** Respawn points a rider may legally jump back to (start + gates already passed). */
  respawnPoints(r) {
    const pts = [this.course.startU];
    for (let i = 0; i < r.gate && i < this.course.gates.length; i++) pts.push(this.course.gates[i].u);
    return pts;
  }

  /** Called by the Room for every accepted state: air time + rotation observations. */
  observe(r, air, tp, ts, sfl, dt) {
    if (air) {
      r.airT += dt;
      r.jp = Math.max(r.jp, Math.abs(tp));
      r.js = Math.max(r.js, Math.abs(ts));
      r.maxPitch = Math.max(r.maxPitch, r.jp);
      r.maxSpin = Math.max(r.maxSpin, r.js);
    } else if (r.wasAir) this._closeJump(r);
    r.wasAir = air;
    r.tp = tp;
    r.ts = ts;
    r.sfl = sfl;
  }

  _closeJump(r) {
    r.jumps.push({ air: r.airT, p: r.jp, s: r.js });
    r.airT = r.jp = r.js = 0;
  }

  update(dt) {
    this.time += dt;
    if (this.phase === 'countdown' && this.time >= 0) {
      this.phase = 'racing';
      for (const r of this.racers) r.bike.frozen = false;
      this.events.push({ type: 'go' });
    }
    if (this.phase !== 'countdown') for (const r of this.racers) this.checkProgress(r);
    this.updatePlaces();
  }

  checkProgress(r) {
    if (r.finished || r.dnf) return;
    let guard = 0;
    while (r.gate < this.gates.length && r.bike.u >= this.gates[r.gate] && guard++ < 4) {
      if (r.gate === this.gates.length - 1) {
        r.finished = true;
        r.finishTime = this.time;
        r.gate++;
        break;
      }
      this.events.push({ type: 'checkpoint', id: r.id, gate: r.gate, lap: 0, time: this.time });
      r.gate++;
    }
  }

  /**
   * Final score from a client. Returns {ok, score, adjusted, reason}.
   * The score is capped by the level bound and by what the server saw this rider fly.
   */
  report(r, m) {
    if (r.reported || r.dnf) return { ok: false, reason: 'already reported' };
    let score = Math.max(0, Math.floor(Number(m.score) || 0));
    if (r.airT > 0) this._closeJump(r);
    // best case: every observed jump scored, chained into one combo (k-th jump at comboMult(k))
    let observed = POINTS.finish + this.course.gates.length * POINTS.checkpoint;
    r.jumps.forEach((j, k) => (observed += jumpBound(j.air, j.p, j.s) * comboMult(k + 1)));
    const bound = Math.min(this.course.maxScore, Math.ceil(observed));
    let adjusted = false;
    let reason = '';
    if (score > bound) {
      score = bound;
      adjusted = true;
      reason = 'score above what the observed jumps allow';
    }
    // claimed rotations must have been seen in the streamed trick angles
    const st = m.st || {};
    if ((st.maxFlipsJump | 0) > Math.round(r.maxPitch / TAU) + 1 || (st.maxSpinsJump | 0) > Math.round(r.maxSpin / TAU) + 1) {
      adjusted = true;
      reason = 'claimed rotations not observed';
      score = Math.min(score, Math.floor(bound / 2));
    }
    r.reported = true;
    r.score = score;
    r.adjusted = adjusted;
    // completion counts only if the server saw the rider cross the line after every gate
    r.complete = !!m.complete && r.finished && !m.fail;
    if (!r.finished) {
      r.dnf = true;
      r.bike.frozen = true;
    }
    this.finishOrder.push(r.id);
    if (r.finished && this.winnerTime === null) this.winnerTime = this.time;
    this.events.push({ type: 'finish', id: r.id, place: 0, time: r.finishTime ?? this.time, score });
    return { ok: true, score, adjusted, reason };
  }

  markDnf(r) {
    if (r.reported) return;
    if (r.finished) {
      // crossed the line but never reported: server-side zero score
      r.reported = true;
      return;
    }
    r.dnf = true;
    this.events.push({ type: 'dnf', id: r.id });
  }

  get allDone() {
    return this.racers.every((r) => r.reported || r.dnf);
  }

  standings() {
    return [...this.racers].sort((a, b) => {
      const ga = a.complete ? 0 : a.finished ? 1 : 2;
      const gb = b.complete ? 0 : b.finished ? 1 : 2;
      if (ga !== gb) return ga - gb;
      if (b.score !== a.score) return b.score - a.score;
      return (a.finishTime ?? 1e9) - (b.finishTime ?? 1e9);
    });
  }

  updatePlaces() {
    const s = this.standings();
    for (let i = 0; i < s.length; i++) s[i].place = i + 1;
  }

  simulateToEnd() {
    for (const r of this.racers) if (!r.reported) this.markDnf(r);
    this.updatePlaces();
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
