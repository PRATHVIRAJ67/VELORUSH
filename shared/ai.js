// AI rider brain. Produces the same input a human would (throttle/brake/steer/
// sprint/boost) so bots obey identical physics — no teleporting, no fixed speed.

import { AI_SKILLS, PHYSICS as P, SURFACE_BY_ID } from './constants.js';
import { clamp, makeRng, wrapAngle, makeNoise2D } from './math.js';
import { trackDelta, resetBike } from './physics.js';

const _c = {};
const _w = {};

export class AIBrain {
  constructor(skillKey = 'medium', seed = 1) {
    this.skill = AI_SKILLS[skillKey] || AI_SKILLS.medium;
    this.rng = makeRng(seed);
    this.noise = makeNoise2D(seed * 7 + 3);
    this.t = this.rng() * 100;
    this.input = { throttle: 0, brake: 0, steer: 0, sprint: false, boost: false, reset: false };
    this.passOffset = 0;
    this.passTimer = 0;
    this.decisionTimer = 0;
    this.stuckTime = 0;
    this.attackTimer = 0;
    this.personalLine = (this.rng() - 0.5) * 2.2;
    this.cornerMul = this.skill.corner * (0.97 + this.rng() * 0.05);
  }

  /**
   * @param bike this bot's bike state
   * @param others array of other bike states
   * @param raceInfo {lap, laps, trackLength, stats}
   */
  update(bike, others, track, dt, raceInfo) {
    const inp = this.input;
    inp.boost = false;
    inp.reset = false;
    this.t += dt;
    const sk = this.skill;
    const stats = raceInfo.stats;

    // ---- target speed from upcoming curvature (brake before hairpins) ----
    const look = Math.max(35, bike.v * 4.2);
    let target = P.safetyMaxSpeed;
    for (let a = 2; a < look; a += 3) {
      const c = track.sample(bike.s + a, _c);
      const k = Math.abs(c.curv) + 1e-4;
      const grip = SURFACE_BY_ID[c.surf].grip * stats.handling * (stats.grip ?? 1);
      const vCorner = Math.sqrt((P.latGrip * grip * this.cornerMul) / k) * 0.92;
      const vHere = Math.sqrt(vCorner * vCorner + 2 * P.brakeDecel * grip * 0.5 * a);
      if (vHere < target) target = vHere;
    }

    // ---- lateral plan: racing line, overtakes, drafting ----
    this.decisionTimer -= dt;
    this.passTimer -= dt;
    let blocker = null;
    let blockerAhead = Infinity;
    let draftCand = null;
    for (const o of others) {
      const ahead = trackDelta(track, bike.s, o.s);
      const lat = o.d - bike.d;
      if (ahead > 0 && ahead < 16 && Math.abs(lat) < 1.8 && ahead < blockerAhead) {
        blocker = o;
        blockerAhead = ahead;
      }
      if (ahead > 2 && ahead < 9 && Math.abs(lat) < 3) draftCand = o;
    }
    const lim = track.halfWidth - 1.1;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = sk.reaction + this.rng() * 0.25;
      if (blocker && (bike.v > blocker.v - 0.2 || blockerAhead < 5)) {
        // choose the side with more room
        const left = blocker.d - 2.3;
        const right = blocker.d + 2.3;
        const leftOk = left > -lim;
        const rightOk = right < lim;
        let side;
        if (leftOk && rightOk) side = Math.abs(left - bike.d) < Math.abs(right - bike.d) ? left : right;
        else side = leftOk ? left : right;
        this.passOffset = side;
        this.passTimer = 2.2;
      } else if (draftCand && this.rng() < 0.6 && raceInfo.progress < 0.8) {
        this.passOffset = draftCand.d; // tuck in behind for the slipstream
        this.passTimer = 1.5;
      }
    }
    const cAhead = track.sample(bike.s + 12, _c);
    let targetD = cAhead.rline + this.personalLine * 0.5;
    if (this.passTimer > 0) targetD = this.passOffset;
    targetD = clamp(targetD, -lim, lim);

    // ---- pure pursuit steering ----
    const aimDist = 5 + bike.v * 0.55;
    const aim = track.toWorld(bike.s + aimDist, targetD, _w);
    const me = track.toWorld(bike.s, bike.d, {});
    const desired = Math.atan2(aim.x - me.x, aim.z - me.z);
    let err = wrapAngle(desired - bike.yaw);
    const wobble = this.noise(this.t * 0.6, 0.5) * sk.noise * 0.25;
    inp.steer = clamp(-(err + wobble) * 2.6, -1, 1);

    // ---- throttle / brake ----
    if (blocker && blockerAhead < 3 && Math.abs(blocker.d - bike.d) < 1) target = Math.min(target, blocker.v);
    if (bike.v < target - 0.2) {
      inp.throttle = 1;
      inp.brake = 0;
    } else if (bike.v > target + 1.0) {
      inp.throttle = 0;
      inp.brake = clamp((bike.v - target) / 4, 0.15, 1);
    } else {
      inp.throttle = 0.35;
      inp.brake = 0;
    }

    // ---- sprint / boost tactics ----
    const prog = raceInfo.progress; // 0..1 of full race
    const c0 = track.sample(bike.s, _c);
    const straight = Math.abs(c0.curv) < 0.012 && target > P.cruiseSpeed;
    this.attackTimer -= dt;
    let wantSprint = false;
    if (prog > 0.82 && bike.stamina > 8) wantSprint = true; // final sprint
    else if (c0.slope > 0.04 && bike.stamina > 55 && this.rng() < sk.sprintiness * dt * 3) this.attackTimer = 2.5;
    else if (straight && bike.stamina > 80 && this.rng() < sk.sprintiness * dt * 0.6) this.attackTimer = 3;
    if (this.attackTimer > 0) wantSprint = true;
    inp.sprint = wantSprint && inp.throttle > 0.5 && !bike.exhausted;
    if (straight && bike.stamina > 85 && bike.boostCooldown <= 0 && this.rng() < sk.sprintiness * dt * 0.5) inp.boost = true;
    if (prog > 0.93 && bike.stamina > 40 && bike.boostCooldown <= 0) inp.boost = true;

    // ---- stuck / wrong way recovery ----
    if (bike.v < 1.2 && !bike.frozen) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 2.5 || bike.wrongWay > 1.2) {
      resetBike(bike, track);
      this.stuckTime = 0;
    }
    return inp;
  }
}
