// Headless stunt pilot + solver. The pilot produces the same inputs a player would
// (pedal/brake/steer/sprint/nitro on the ground, flip/spin/no-hander keys in the air) and the
// run applies the real physics and trick rules. The solver searches the pilot's choices
// (approach speed per jump, trick per jump) by forward simulation and finally replays the
// chosen plan from a fresh run: a level counts as completable only if that replay finishes
// with every objective met.

import { PHYSICS as P, SURFACE_BY_ID } from '../constants.js';
import { clamp, wrapAngle } from '../math.js';
import { StuntRun } from './run.js';
import { objectiveList, OBJECTIVES } from './objectives.js';
import { NITRO, TRICK } from './config.js';

const TAU = Math.PI * 2;
const _c = {};
const _w = {};
const _m = {};

export class StuntPilot {
  constructor(run, plan = []) {
    this.run = run;
    this.plan = plan; // per feature index: {v, trick}
    this.inp = { throttle: 0, brake: 0, steer: 0, sprint: false, boost: false, reset: false };
    this.prog = null; // active trick program
    this.chooser = null; // (pilot) => trick program, called at takeoff
  }

  nextFeature(u) {
    for (const f of this.run.course.features) if ((f.lipS ?? f.s1) + 2 > u) return f;
    return null;
  }

  /** Lane for barrel rows: centre of the open gap in the next row ahead. */
  laneAt(u) {
    let best = null;
    for (const o of this.run.course.obstacles) {
      if (o.s1 + 0.6 < u || o.s0 - u > 30) continue;
      if (!best || o.s0 < best.s0) best = o;
    }
    if (!best) return null;
    const row = this.run.course.obstacles.filter((o) => Math.abs(o.s0 - best.s0) < 0.01);
    const lim = this.run.track.limit;
    // open interval between the parts of this row
    const parts = row.map((o) => [o.d0, o.d1]).sort((a, b) => a[0] - b[0]);
    let lo = -lim;
    let gapC = null;
    for (const [a, b] of parts) {
      if (a > lo + 0.5) gapC = (lo + a) / 2;
      lo = Math.max(lo, b);
    }
    if (lim > lo + 0.5) gapC = gapC ?? (lo + lim) / 2;
    this.rowS = best.s0;
    return gapC;
  }

  input() {
    const run = this.run;
    const S = run.state;
    const b = S.bike;
    const inp = this.inp;
    inp.boost = false;
    inp.reset = false;
    if (b.airborne && S.T.air) return this.airInput();
    this.prog = null;
    const track = run.track;
    const f = this.nextFeature(b.u);
    const plan = f ? this.plan[f.i] || {} : {};
    // ---- target speed ----
    let target = 21;
    if (f && f.jump && f.lipS - b.u < 140) target = plan.v ?? f.designV ?? 18;
    if (f && f.t === 'rollers' && f.s0 - b.u < 40) target = Math.min(target, plan.v ?? 14);
    if (f && f.t === 'barrels' && f.s0 - b.u < 40) target = Math.min(target, plan.v ?? 10.5);
    // corner speed (same idea as the racing AI)
    const look = Math.max(35, b.v * 4);
    for (let a = 2; a < look; a += 3) {
      const c = track.sample(b.s + a, _c);
      const k = Math.abs(c.curv) + 1e-4;
      const grip = SURFACE_BY_ID[c.surf].grip * run.stats.handling;
      const vC = Math.sqrt((P.latGrip * grip * 0.9) / k) * 0.92;
      const vH = Math.sqrt(vC * vC + 2 * P.brakeDecel * grip * 0.5 * a);
      if (vH < target) target = vH;
    }
    // ---- lane ----
    let lane = 0;
    if (f && f.jump) lane = plan.d ?? (f.w < run.track.limit * 1.9 ? f.d : 0);
    const bl = this.laneAt(b.u);
    if (bl !== null) lane = bl;
    const lim = track.limit - 0.6;
    lane = clamp(lane, -lim, lim);
    // slalom: aim straight at the open lane of the next barrel row
    const aimDist = bl !== null ? clamp(this.rowS - b.u, 2.5, 4 + b.v * 0.45) : 4 + b.v * 0.45;
    const aim = track.toWorld(b.s + aimDist, lane, _w);
    const me = track.toWorld(b.s, b.d, _m);
    const err = wrapAngle(Math.atan2(aim.x - me.x, aim.z - me.z) - b.yaw);
    inp.steer = clamp(-err * 2.8, -1, 1);
    // ---- speed ----
    if (b.v < target - 0.15) {
      inp.throttle = 1;
      inp.brake = 0;
    } else if (b.v > target + 0.6) {
      inp.throttle = 0;
      inp.brake = clamp((b.v - target) / 3, 0.2, 1);
    } else {
      inp.throttle = 0.4;
      inp.brake = 0;
    }
    inp.sprint = b.v < target - 0.8 && b.stamina > 12 && !b.exhausted;
    if (inp.sprint) inp.throttle = 1;
    const near = f && f.jump && f.lipS - b.u < 90;
    if (b.v < target - 2.5 && S.nitro >= NITRO.cost && (near || b.v < target - 5)) inp.boost = true;
    return inp;
  }

  /** In the air: run the trick program chosen at takeoff. */
  airInput() {
    const run = this.run;
    const T = run.state.T;
    const inp = this.inp;
    if (!this.prog) {
      this.prog = (this.chooser ? this.chooser(this) : null) || { pitch: 0, spin: 0, style: 0, leadP: 0, leadS: 0 };
      this.prog.t = 0;
    }
    const pr = this.prog;
    pr.t += P.dt;
    inp.throttle = 0;
    inp.brake = 0;
    inp.steer = 0;
    inp.sprint = false;
    if (pr.t < 0.03) return inp; // let go of everything once (re-arm)
    if (pr.pitch) {
      const goal = Math.abs(pr.pitch) * TAU - pr.leadP;
      if (Math.abs(T.pitch) < goal) {
        if (pr.pitch > 0) inp.brake = 1;
        else inp.throttle = 1;
      }
    }
    if (pr.spin) {
      const goal = Math.abs(pr.spin) * TAU - pr.leadS;
      if (Math.abs(T.spin) < goal) inp.steer = pr.spin > 0 ? 1 : -1;
    }
    if (pr.style && pr.t < pr.style + 0.06) inp.sprint = true;
    return inp;
  }
}

// ------------------------------------------------------------------ solver
const STEP = P.dt;

/** What the objectives still need (deficits) for value scoring. */
function deficits(level, st) {
  const d = {};
  for (const o of objectiveList(level)) {
    const def = OBJECTIVES[o.type];
    if (def.cmp === 'ge') d[o.type] = Math.max(0, o.n - def.value(st));
  }
  return d;
}

function gain(before, after) {
  return {
    flips: after.flips - before.flips,
    backflips: after.backflips - before.backflips,
    frontflips: after.frontflips - before.frontflips,
    spins: after.spins - before.spins,
    corkscrew: after.corkscrews - before.corkscrews,
    flipJump: after.maxFlipsJump,
    spinJump: after.maxSpinsJump,
    style: after.maxStyle,
    air: after.maxAir,
    airTotal: after.airTotal - before.airTotal,
    dist: after.maxDist,
    perfect: after.perfects - before.perfects,
    targets: after.targets - before.targets,
    rings: after.rings - before.rings,
    combo: after.maxCombo,
    score: after.score - before.score,
  };
}

/** Value of an outcome stats-delta given the deficits. */
function value(level, before, after, crashed) {
  if (crashed) return -1e7;
  const need = deficits(level, before);
  const g = gain(before, after);
  let v = after.score - before.score;
  for (const k in need) {
    if (!need[k] || k === 'score') continue;
    const absolute = ['flipJump', 'spinJump', 'style', 'air', 'dist', 'combo'].includes(k);
    const got = absolute ? Math.max(0, g[k] - (OBJECTIVES[k].value(before))) : g[k];
    v += 40000 * Math.min(need[k], Math.max(0, got));
  }
  if (need.score) v += (after.score - before.score) * 2;
  return v;
}

/** Simulate a run (with pilot) until predicate or limit. Returns steps used. */
function simulate(run, pilot, until, maxSteps = 120 * 60) {
  for (let i = 0; i < maxSteps; i++) {
    if (until()) return i;
    const inp = pilot.input();
    run.step(inp, STEP);
    if (run.done) return i;
  }
  return maxSteps;
}

/** Trick candidates for an expected air time (s) and bike stats. */
function trickCandidates(air, stats) {
  const fl = TRICK.flipRate * stats.rot;
  const sp = TRICK.spinRate * stats.rot;
  const maxF = Math.max(0, Math.floor(((air - 0.2) * fl) / TAU));
  const maxS = Math.max(0, Math.floor(((air - 0.2) * sp) / TAU));
  const out = [{ pitch: 0, spin: 0, style: 0 }];
  if (air > 0.45) for (const k of [0.45, 0.32, 0.24]) out.push({ pitch: 0, spin: 0, style: Math.max(0.2, air - k) });
  for (let n = 1; n <= Math.min(4, maxF); n++) {
    out.push({ pitch: n, spin: 0, style: 0 }, { pitch: -n, spin: 0, style: 0 });
  }
  for (let n = 1; n <= Math.min(3, maxS); n++) out.push({ pitch: 0, spin: n, style: 0 });
  if (maxF >= 1 && maxS >= 1) out.push({ pitch: 1, spin: 1, style: 0 });
  if (maxF >= 1 && air > 1.2) out.push({ pitch: 1, spin: 0, style: 0.25 });
  return out;
}

const LEADS = [0.2, 0.4, 0.6, 0.75, 0.9, 1.05, 1.2, 1.4, 1.6];

/**
 * Pick the best trick program at takeoff by simulating each candidate to touchdown.
 * Restores the run afterwards.
 */
export function chooseTrick(pilot) {
  const run = pilot.run;
  const level = run.level;
  const snap = run.snapshot();
  const before = structuredClone(snap.st);
  const evalProg = (prog) => {
    run.restore(snap);
    const p2 = new StuntPilot(run, pilot.plan);
    p2.prog = { ...prog, t: 0 };
    let landed = false;
    simulate(run, p2, () => !run.state.bike.airborne || run.state.phase !== 'riding', 600);
    landed = run.state.phase === 'riding' || run.state.phase === 'finished';
    // roll a little so a cased landing still counts as crash
    const crashed = !landed;
    return { v: value(level, before, run.state.st, crashed), air: run.state.st.airTotal - before.airTotal, crashed };
  };
  const base = evalProg({ pitch: 0, spin: 0, style: 0, leadP: 0, leadS: 0 });
  let best = { prog: { pitch: 0, spin: 0, style: 0, leadP: 0, leadS: 0 }, v: base.v };
  const air = base.crashed ? 1.5 : run.state.T ? base.air : 1;
  for (const c of trickCandidates(air, run.stats)) {
    if (!c.pitch && !c.spin && !c.style) continue;
    const leads = c.pitch || c.spin ? LEADS : [0];
    for (const lp of leads) {
      const prog = { ...c, leadP: lp, leadS: lp };
      const r = evalProg(prog);
      if (r.v > best.v) best = { prog, v: r.v };
    }
  }
  run.restore(snap);
  return { ...best.prog };
}

/** Speeds worth trying for a feature. */
function speedCandidates(f, course) {
  const base = f.designV ?? 18;
  const set = new Set([base, base - 2, base + 2, base + 4, base - 4, 24, 16]);
  if (f.minV) for (const k of [0.5, 1.5, 3, 5]) set.add(f.minV + k);
  for (const r of course.rings) if (r.feature === f.i) set.add(r.v);
  for (const t of course.targets) if (t.feature === f.i) set.add(t.v);
  return [...set].filter((v) => v >= 8 && v <= 30).sort((a, b) => a - b);
}

/**
 * Solve a level: greedy per-jump search over approach speed (+ auto tricks), then a clean
 * replay of the chosen plan from a fresh run.
 * @returns {ok, result, stats, plan, replayTime, problems}
 */
export function solveLevel(course, { bikeId = 'allround', upgrades = null, maxSeconds = 600, tricks = true } = {}) {
  const level = course.level;
  const plan = course.features.map((f) => ({ v: f.designV ?? null }));
  const run = new StuntRun(course, { bikeId, upgrades, countdown: 0.01 });
  run.quiet = true;
  const pilot = new StuntPilot(run, plan);
  pilot.chooser = tricks ? chooseTrick : null;
  for (const f of course.features) {
    if (!f.jump) continue;
    // ride up to 150 m before this jump (with the plan chosen so far)
    // snapshot on the ground (the pilot keeps no state between jumps there)
    simulate(run, pilot, () => run.state.phase === 'riding' && !run.state.bike.airborne && run.state.bike.u > f.lipS - 150, 120 * maxSeconds);
    if (run.done) break;
    const snap = run.snapshot();
    let best = null;
    for (const v of speedCandidates(f, course)) {
      run.restore(snap);
      pilot.prog = null;
      plan[f.i] = { ...plan[f.i], v };
      const before = structuredClone(run.state.st);
      simulate(run, pilot, () => run.state.bike.u > (f.lipS ?? f.s1) + 6 && !run.state.bike.airborne || run.state.phase === 'crashed', 120 * 60);
      const crashed = run.state.phase === 'crashed' || run.state.st.crashes > before.crashes;
      const v2 = value(level, before, run.state.st, crashed);
      if (globalThis.STUNT_DEBUG) console.log('  cand', f.i, f.t, v, 'value', Math.round(v2), run.state.phase, run.state.crashReason, 'u', run.state.bike.u.toFixed(0));
      if (!best || v2 > best.v) best = { v: v2, speed: v };
    }
    plan[f.i] = { ...plan[f.i], v: best.speed };
    run.restore(snap);
    pilot.prog = null;
  }
  // replay the final plan from scratch: this is the proof
  const replay = new StuntRun(course, { bikeId, upgrades, countdown: 0.01 });
  replay.quiet = true;
  const rp = new StuntPilot(replay, plan);
  rp.chooser = tricks ? chooseTrick : null;
  simulate(replay, rp, () => false, 120 * maxSeconds);
  const res = replay.state.result;
  return {
    ok: !!res?.complete,
    result: res,
    stats: replay.state.st,
    plan,
    phase: replay.state.phase,
    u: replay.state.bike.u,
  };
}
