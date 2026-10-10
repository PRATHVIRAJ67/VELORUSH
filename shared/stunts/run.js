// One rider's stunt run: the real bike physics (stepBike on the course's wrapper track) plus
// the airborne trick model, checkpoints, crashes + respawn, nitro, combo scoring and
// objectives. Used by the client (solo + challenge), the headless solver and the unit tests,
// so the same rules are checked everywhere.

import { createBike, stepBike } from '../physics.js';
import { PHYSICS } from '../constants.js';
import { wrapAngle } from '../math.js';
import { TRICK, POINTS, NITRO, RESPAWN, comboMult } from './config.js';
import { createTricks, takeoff, stepTricks, judgeLanding, jumpPoints, trickNames, resetTricks } from './tricks.js';
import { stuntStats } from './bikes.js';
import { allObjectivesMet } from './objectives.js';

const H = PHYSICS.dt;
const _c = {};
const physIn = { throttle: 0, brake: 0, steer: 0, sprint: false, boost: false, reset: false };

export function emptyStats() {
  return {
    score: 0,
    jumps: 0,
    flips: 0,
    backflips: 0,
    frontflips: 0,
    spins: 0,
    maxFlipsJump: 0,
    maxSpinsJump: 0,
    corkscrews: 0,
    airTotal: 0,
    maxAir: 0,
    maxDist: 0,
    styleTotal: 0,
    maxStyle: 0,
    perfects: 0,
    targets: 0,
    rings: 0,
    combo: 0,
    maxCombo: 0,
    crashes: 0,
    respawns: 0,
    time: 0,
  };
}

export class StuntRun {
  /**
   * @param course from buildCourse(level)
   * @param opts {bikeId, upgrades (null = base stats), assist, countdown, d (lateral start)}
   */
  constructor(course, opts = {}) {
    this.course = course;
    this.level = course.level;
    this.track = course.track;
    this.stats = stuntStats(opts.bikeId || 'allround', opts.upgrades || null, opts.assist || 0);
    this.timeLimit = this.level.time || 0;
    const bike = createBike(this.track, course.startU, opts.d || 0);
    bike.frozen = true;
    this.state = {
      bike,
      T: createTricks(),
      phase: 'countdown',
      time: -(opts.countdown ?? 3),
      gate: 0, // next course gate to pass
      crashT: 0,
      crashReason: '',
      nitro: NITRO.start,
      nitroT: 0,
      nitroCd: 0,
      comboT: 0, // time left to chain the next jump
      jump: null, // current jump record
      ringsTaken: course.rings.map(() => 0),
      targetsTaken: course.targets.map(() => 0),
      wrongT: 0,
      st: emptyStats(),
      result: null,
      finishTime: null,
    };
    this.events = [];
    this.acc = 0;
    this.quiet = false; // solver: no event list
  }

  get bike() {
    return this.state.bike;
  }

  /** Deep copy of the whole run state (solver search). */
  snapshot() {
    return structuredClone(this.state);
  }

  restore(snap) {
    this.state = structuredClone(snap);
  }

  emit(e) {
    if (!this.quiet) this.events.push(e);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Variable dt -> fixed physics steps (client frame loop). */
  update(input, dt) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= H && n < 30) {
      this.step(input, H);
      input.boost = false;
      input.reset = false;
      this.acc -= H;
      n++;
    }
    if (n >= 30) this.acc = 0;
  }

  groundAt(s, d) {
    return this.track.sample(s, _c).y + this.track.rampHeight(s, d);
  }

  /** One fixed physics step. input {throttle, brake, steer, sprint, boost(edge), reset(edge)} */
  step(input, dt = H) {
    const S = this.state;
    const b = S.bike;
    const course = this.course;
    S.time += dt;
    if (S.phase === 'countdown') {
      if (S.time >= 0) {
        S.phase = 'riding';
        b.frozen = false;
        this.emit({ type: 'go' });
      } else {
        stepBike(b, physIn, dt, this.track, this.stats); // frozen: wheels/pedals only
        return;
      }
    }
    if (S.phase === 'finished' || S.phase === 'failed') {
      // roll out after the line
      physIn.throttle = 0;
      physIn.brake = 0.35;
      physIn.steer = 0;
      physIn.sprint = false;
      if (!b.frozen) stepBike(b, physIn, dt, this.track, this.stats);
      return;
    }
    S.st.time = S.time;
    if (S.phase === 'crashed') {
      S.crashT -= dt;
      if (S.crashT <= 0) this.respawn();
      return;
    }
    if (this.timeLimit && S.time > this.timeLimit) {
      this.fail('time', 'Out of time');
      return;
    }
    // manual respawn (R) — back to the last checkpoint, no crash counted
    if (input.reset) {
      this.respawn(true);
      return;
    }

    // ---- nitro (stunt boost meter drives the existing physics boost force) ----
    S.nitroCd = Math.max(0, S.nitroCd - dt);
    if (input.boost && S.nitroCd <= 0 && S.nitro >= NITRO.cost && !b.airborne) {
      S.nitro -= NITRO.cost;
      S.nitroCd = NITRO.cooldown;
      b.boostTimer = Math.max(b.boostTimer, NITRO.duration * this.stats.nitro);
      this.emit({ type: 'nitro' });
    }

    // ---- physics ----
    const air0 = b.airborne;
    const y0 = b.y;
    const u0 = b.u;
    const g0 = this.groundAt(b.s, b.d);
    if (air0) {
      physIn.throttle = 0;
      physIn.brake = 0;
      physIn.steer = 0;
      physIn.sprint = false;
    } else {
      physIn.throttle = input.throttle;
      physIn.brake = input.brake;
      physIn.steer = input.steer;
      physIn.sprint = input.sprint;
    }
    physIn.boost = false; // stamina burst boost is replaced by nitro in stunt mode
    physIn.reset = false;
    stepBike(b, physIn, dt, this.track, this.stats);
    const g1 = this.groundAt(b.s, b.d);
    const T = S.T;

    // ---- airborne / tricks ----
    if (b.airborne && !air0) {
      takeoff(T, input);
      // a takeoff after the combo window closed starts a new combo
      if (S.comboT <= 0) S.st.combo = 0;
      S.jump = { u0, rings: 0, maxH: 0 };
      this.emit({ type: 'takeoff' });
    }
    if (b.airborne) {
      stepTricks(T, input, dt, this.stats);
      if (S.jump) S.jump.maxH = Math.max(S.jump.maxH, b.y - g1);
      this._rings(u0, b);
      if (course.obstacles.length && course.obstacleAt(b.s, b.d, b.y - this.track.sample(b.s, _c).y)) return this.crash('Hit the barrels');
    } else {
      if (S.comboT > 0) S.comboT -= dt;
      if (air0) {
        // touchdown: judge it once, commit the jump once
        const wall = g1 - y0 > TRICK.wallStep;
        this._land(b, { wall, pit: course.pitAt(b.s, b.d) });
        if (S.phase === 'crashed') return;
      } else if (g1 - g0 > TRICK.wallStep) {
        return this.crash('Hit the ramp face');
      } else if (course.pits.length && course.pitAt(b.s, b.d)) {
        return this.crash('Fell into the gap');
      }
      if (course.obstacles.length && course.obstacleAt(b.s, b.d, b.y - this.track.sample(b.s, _c).y)) return this.crash('Hit the barrels');
    }

    // ---- wrong way: automatic respawn ----
    const rel = wrapAngle(b.yaw - this.track.sample(b.s, _c).head);
    S.wrongT = Math.abs(rel) > 1.9 && b.v > 1 ? S.wrongT + dt : 0;
    if (S.wrongT > RESPAWN.wrongWay) return this.respawn(true);

    // ---- checkpoints + finish (by distance along the road) ----
    const gates = course.gates;
    while (S.gate < gates.length && b.u >= gates[S.gate].u) {
      S.st.score += POINTS.checkpoint;
      this.emit({ type: 'checkpoint', gate: S.gate, total: gates.length, time: S.time });
      S.gate++;
    }
    if (b.u >= course.finishU && S.gate >= gates.length && !b.airborne) this.finish();
  }

  _rings(u0, b) {
    const S = this.state;
    const rings = this.course.rings;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (S.ringsTaken[i] || u0 > r.u || b.u < r.u) continue;
      const c = this.track.sample(this.track.wrap(r.u), _c);
      const dy = b.y + 0.85 - (c.y + r.y);
      const dd = b.d - r.d;
      if (dy * dy + dd * dd <= r.r * r.r) {
        S.ringsTaken[i] = 1; // pending: confirmed (scored) on a clean landing
        if (S.jump) S.jump.rings++;
        this.emit({ type: 'ring', i });
      }
    }
  }

  _land(b, surface) {
    const S = this.state;
    const T = S.T;
    const j = judgeLanding(T, this.stats, surface);
    const jump = S.jump || { u0: b.u, rings: 0 };
    S.jump = null;
    T.air = false;
    if (!j.clean) {
      // rings flown through on a crashed jump don't count: free them again
      for (let i = 0; i < S.ringsTaken.length; i++) if (S.ringsTaken[i] === 1) S.ringsTaken[i] = 0;
      this.crash(j.reason);
      return;
    }
    const st = S.st;
    const dist = b.u - jump.u0;
    // precision target: touchdown inside a zone (each zone counts once per run)
    let target = false;
    const tg = this.course.targets;
    for (let i = 0; i < tg.length; i++) {
      const z = tg[i];
      if (!S.targetsTaken[i] && b.u >= z.u0 && b.u <= z.u1 && Math.abs(b.d - z.d) <= z.w / 2) {
        S.targetsTaken[i] = 1;
        target = true;
        st.targets++;
      }
    }
    for (let i = 0; i < S.ringsTaken.length; i++) {
      if (S.ringsTaken[i] === 1) {
        S.ringsTaken[i] = 2; // committed
        st.rings++;
      }
    }
    const scoring = j.air >= TRICK.minAir;
    const pts = jumpPoints(j, { dist, rings: jump.rings, target });
    let mult = 1;
    if (scoring) {
      st.combo++;
      st.maxCombo = Math.max(st.maxCombo, st.combo);
      mult = comboMult(st.combo);
      S.comboT = TRICK.comboWindow;
      st.jumps++;
      st.airTotal += j.air;
      st.maxAir = Math.max(st.maxAir, j.air);
      st.maxDist = Math.max(st.maxDist, dist);
    }
    const total = Math.round(pts * mult);
    st.score += total;
    st.flips += j.flips;
    st.backflips += j.back;
    st.frontflips += j.front;
    st.spins += j.spins;
    st.maxFlipsJump = Math.max(st.maxFlipsJump, j.flips);
    st.maxSpinsJump = Math.max(st.maxSpinsJump, j.spins);
    if (j.flips && j.spins) st.corkscrews++;
    st.styleTotal += j.style;
    st.maxStyle = Math.max(st.maxStyle, j.style);
    if (j.perfect) st.perfects++;
    // nitro refill from what was landed
    const k = this.stats.nitro;
    S.nitro = Math.min(
      100,
      S.nitro + k * (j.air * NITRO.gainAirPerSec + j.flips * NITRO.gainFlip + j.spins * NITRO.gainSpin + j.style * NITRO.gainStylePerSec + (j.perfect ? NITRO.gainPerfect : 0) + jump.rings * NITRO.gainRing),
    );
    this.emit({ type: 'land', clean: true, perfect: j.perfect, names: trickNames(j), points: total, base: pts, mult, air: j.air, dist, target, rings: jump.rings, scoring });
    resetTricks(T);
  }

  crash(reason) {
    const S = this.state;
    const b = S.bike;
    S.phase = 'crashed';
    S.crashT = TRICK.crashTime;
    S.crashReason = reason;
    S.st.crashes++;
    S.st.combo = 0;
    S.comboT = 0;
    S.jump = null;
    for (let i = 0; i < S.ringsTaken.length; i++) if (S.ringsTaken[i] === 1) S.ringsTaken[i] = 0;
    // keep the crash pose (rotation) for the visuals, stop the bike on the ground
    b.airborne = false;
    b.vy = 0;
    b.y = this.groundAt(b.s, b.d);
    b.v = 0;
    b.frozen = true;
    b.ev.land = true;
    S.T.air = false;
    this.emit({ type: 'crash', reason });
  }

  /** Back to the last checkpoint passed (or the start) with a rolling restart speed. */
  respawn(manual = false) {
    const S = this.state;
    const b = S.bike;
    const course = this.course;
    const g = S.gate > 0 ? course.gates[S.gate - 1] : null;
    const u = g ? g.u : course.startU;
    b.u = u;
    b.s = this.track.wrap(u);
    b.d = 0;
    const c = this.track.sample(b.s, _c);
    b.yaw = c.head;
    b.y = c.y + this.track.rampHeight(b.s, 0);
    b.vy = 0;
    b.airborne = false;
    b.v = g ? g.respawnV : 6;
    b.lean = 0;
    b.steer = 0;
    b.frozen = false;
    b.boostTimer = 0;
    b.wrongWay = 0;
    resetTricks(S.T);
    S.jump = null;
    S.phase = 'riding';
    S.wrongT = 0;
    S.st.respawns++;
    this.emit({ type: 'respawn', manual, gate: g ? g.i : -1 });
  }

  finish() {
    const S = this.state;
    S.st.score += POINTS.finish;
    S.finishTime = S.time;
    S.st.time = S.time;
    const complete = allObjectivesMet(this.level, S.st);
    S.phase = 'finished';
    S.result = { complete, score: S.st.score, time: S.time };
    this.emit({ type: 'finish', complete, score: S.st.score, time: S.time });
  }

  fail(kind, reason) {
    const S = this.state;
    S.phase = 'failed';
    S.result = { complete: false, score: S.st.score, time: S.time, fail: kind, reason };
    this.emit({ type: 'fail', kind, reason });
  }

  get done() {
    return this.state.phase === 'finished' || this.state.phase === 'failed';
  }

  /** Visual trick angles for the renderer (radians). */
  pose() {
    const S = this.state;
    return { pitch: S.T.pitch, spin: S.T.spin, style: S.T.styleOn, crashed: S.phase === 'crashed' };
  }
}
