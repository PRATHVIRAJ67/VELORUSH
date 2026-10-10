// Stunt courses: a level is a stretch of one of the six existing roads plus data-placed
// features (kickers, tabletops, gaps, decks, step-ups, rollers, barrels, rings, landing
// targets, nitro pads). Features only exist in a wrapper track handed to the physics in stunt
// mode — the racing track object, its ramps and every racing code path stay untouched.
//
// Placement is deterministic (same result on client, server and the solver): each feature
// is put on the next stretch of road that is straight enough, outside tunnels/bridges and
// clear of the map's overhead structures (gantries, checkpoint arches) and racing ramps/pads.

import { getTrack } from '../tracks.js';
import { FLAG } from '../track.js';
import { createBike, stepBike, makeStats } from '../physics.js';
import { PHYSICS } from '../constants.js';
import { clamp } from '../math.js';
import { POINTS, TRICK, comboMult, RESPAWN } from './config.js';

const SLOPE_UP = 0.28; // kicker face (physics clamps launch vy at 0.3 * v)
const SLOPE_LAND = 0.17; // landing ramps
const FULL = 'full';
// how straight the road must be around a feature (lateral drift in the air stays small)
const CURV_LIMIT = { kick: 0.011, table: 0.011, gap: 0.0065, step: 0.0065, deck: 0.009, rollers: 0.02, barrels: 0.02, pad: 0.03 };

// ------------------------------------------------------------------ map suitability
const maskCache = new Map();

/** Per-metre flags for a map: excluded (overhead structures, tunnels, bridges, racing ramps/pads). */
function mapMask(track) {
  if (maskCache.has(track.id)) return maskCache.get(track.id);
  const n = track.count;
  const ex = new Uint8Array(n);
  const mark = (s0, s1) => {
    for (let s = Math.floor(s0); s <= Math.ceil(s1); s++) ex[((Math.floor(s / track.ds) % n) + n) % n] = 1;
  };
  for (let i = 0; i < n; i++) if (track.FLAGS[i] & (FLAG.TUNNEL | FLAG.BRIDGE)) mark(i * track.ds - 30, i * track.ds + 30);
  for (const cp of track.checkpoints) mark(cp - 18, cp + 18); // racing checkpoint arches
  mark(-40, 45); // start gantry + grid
  mark(track.length - 318, track.length - 282); // flamme rouge gantry
  // King of the Mountain gantry (same rule as the client's Props)
  let maxY = -Infinity;
  let minY = Infinity;
  let maxI = 0;
  for (let i = 0; i < n; i++) {
    if (track.Y[i] > maxY) {
      maxY = track.Y[i];
      maxI = i;
    }
    minY = Math.min(minY, track.Y[i]);
  }
  const summit = track.def.id === 'mountain' ? track.cpToS(15.6) : maxY - minY > 40 ? maxI * track.ds : null;
  if (summit !== null) mark(summit - 18, summit + 18);
  for (const r of track.ramps) mark(r.s - 12, r.s + r.len + 25);
  for (const b of track.boosts) mark(b.s - 8, b.s + b.len + 8);
  const res = { ex, summit };
  maskCache.set(track.id, res);
  return res;
}

function windowOk(track, mask, s0, s1, maxCurv) {
  for (let s = Math.floor(s0); s <= Math.ceil(s1); s++) {
    const i = ((Math.floor(s / track.ds) % track.count) + track.count) % track.count;
    if (mask.ex[i] || Math.abs(track.CURV[i]) > maxCurv) return false;
  }
  return true;
}

// ------------------------------------------------------------------ feature geometry
/**
 * Expand one feature spec at road position s into geometry.
 * Returns {segs, pits, obstacles, pads, lipS, len, post, jump}.
 */
function expand(f, s, track) {
  const lim = track.limit;
  const fullW = f.w === FULL || f.w === undefined;
  const w = fullW ? lim * 2 : f.w;
  const d = fullW ? 0 : f.d || 0;
  const d0 = d - w / 2;
  const d1 = d + w / 2;
  const segs = [];
  const pits = [];
  const obstacles = [];
  const pads = [];
  // segments are quadratic in s: h = h0 + a*x + b*x^2 (x = metres into the segment)
  const up = (a, h0, h1, slope = SLOPE_UP) => {
    const len = Math.abs(h1 - h0) / slope;
    segs.push({ s0: a, s1: a + len, d0, d1, h0, a: (h1 - h0) / len, b: 0 });
    return a + len;
  };
  const flat = (a, len, h) => {
    segs.push({ s0: a, s1: a + len, d0, d1, h0: h, a: 0, b: 0 });
    return a + len;
  };
  // rounded crest from `slope` to level over L metres: the bike rolls over it instead of launching
  const crest = (a, h0, slope, L) => {
    segs.push({ s0: a, s1: a + L, d0, d1, h0, a: slope, b: -slope / (2 * L) });
    return a + L;
  };
  let e = s;
  let lipS = null;
  let post = 30;
  let jump = true;
  switch (f.t) {
    case 'kick': {
      e = up(s, 0, f.h, f.slope || SLOPE_UP);
      lipS = e;
      post = 16 + f.h * 7;
      break;
    }
    case 'table': {
      e = up(s, 0, f.h);
      lipS = e;
      e = flat(e, f.top, f.h);
      e = up(e, f.h, 0, SLOPE_LAND);
      post = 14;
      break;
    }
    case 'gap': {
      e = up(s, 0, f.h);
      lipS = e;
      pits.push({ s0: e, s1: e + f.gap, d0, d1 });
      e += f.gap;
      e = flat(e, 3, f.land ?? f.h);
      e = up(e, f.land ?? f.h, 0, SLOPE_LAND);
      post = 14;
      break;
    }
    case 'step': {
      // kicker -> gap -> higher landing deck -> roll down
      e = up(s, 0, f.h);
      lipS = e;
      pits.push({ s0: e, s1: e + f.gap, d0, d1 });
      e += f.gap;
      e = flat(e, f.deck || 10, f.h2);
      e = up(e, f.h2, 0, SLOPE_LAND);
      post = 14;
      break;
    }
    case 'deck': {
      // ramp onto a raised deck (rounded top: no launch), ride it, launch off the lip into a big drop
      const sl = 0.22;
      const L = Math.min(10, f.h / sl);
      e = up(s, 0, f.h - (sl * L) / 2, sl);
      e = crest(e, f.h - (sl * L) / 2, sl, L);
      e = flat(e, f.deck, f.h);
      e = up(e, f.h, f.h + (f.lip ?? 0.7));
      lipS = e;
      post = 22 + f.h * 6;
      break;
    }
    case 'rollers': {
      const h = f.h ?? 0.55;
      for (let i = 0; i < (f.n || 3); i++) {
        e = up(e, 0, h, 0.24);
        e = up(e, h, 0, 0.24);
        e += f.space ?? 3;
      }
      lipS = null;
      jump = false;
      post = 12;
      break;
    }
    case 'barrels': {
      // rows of barrels with one open lane per row (alternating): weave through or jump over
      const n = f.n || 3;
      const sp = f.space || 16;
      const lane = f.lane ?? 2.6;
      for (let i = 0; i < n; i++) {
        const open = (i % 2 ? 1 : -1) * (f.offset ?? lim * 0.45);
        const a = s + i * sp;
        if (open - lane / 2 > -lim) obstacles.push({ s0: a, s1: a + 1.2, d0: -lim - 0.5, d1: open - lane / 2, h: 1.05 });
        if (open + lane / 2 < lim) obstacles.push({ s0: a, s1: a + 1.2, d0: open + lane / 2, d1: lim + 0.5, h: 1.05 });
      }
      e = s + (n - 1) * sp + 1.2;
      jump = false;
      post = 10;
      break;
    }
    case 'pad': {
      pads.push({ s, d: f.d || 0, len: 7, w: 3.4 });
      e = s + 7;
      jump = false;
      post = 6;
      break;
    }
    default:
      throw new Error('unknown stunt feature ' + f.t);
  }
  return { segs, pits, obstacles, pads, lipS, len: e - s, post, jump, d, w };
}

// ------------------------------------------------------------------ course object
function makeCourse(level, base) {
  const course = {
    level,
    base,
    segs: [],
    pits: [],
    obstacles: [],
    pads: [],
    rings: [],
    targets: [],
    features: [],
    gates: [],
    startU: level.from,
    finishU: 0,
    /** Extra ground height of the stunt features at (s, d). */
    heightAt(s, d) {
      let h = 0;
      const segs = this.segs;
      for (let i = 0; i < segs.length; i++) {
        const g = segs[i];
        if (s < g.s0) break;
        if (s > g.s1 || d < g.d0 || d > g.d1) continue;
        const x = s - g.s0;
        const v = g.h0 + x * (g.a + g.b * x);
        if (v > h) h = v;
      }
      return h;
    },
    pitAt(s, d) {
      for (const p of this.pits) if (s >= p.s0 && s <= p.s1 && d >= p.d0 && d <= p.d1) return true;
      return false;
    },
    /** Barrel row hit: rider within the row footprint and lower than the barrels. */
    obstacleAt(s, d, above) {
      for (const o of this.obstacles) if (s >= o.s0 - 0.4 && s <= o.s1 + 0.4 && d >= o.d0 - 0.35 && d <= o.d1 + 0.35 && above < o.h) return true;
      return false;
    },
    padAt(s, d) {
      for (const p of this.pads) if (s >= p.s && s <= p.s + p.len && Math.abs(d - p.d) <= p.w / 2) return true;
      return false;
    },
  };
  // physics wrapper: the racing track plus the stunt features (Object.create keeps every
  // racing field/method; only ground height and boost pads are extended)
  const track = Object.create(base);
  track.rampHeight = (s, d) => base.rampHeight(s, d) + course.heightAt(s, d);
  track.boostAt = (s, d) => base.boostAt(s, d) || course.padAt(s, d);
  track.stunt = course;
  course.track = track;
  return course;
}

/**
 * Fly a probe rider over a jump at speed v (real physics) and return its flight path.
 * Used to put rings/landing targets where a rider actually flies, and to find gap speeds.
 */
export function probeJump(course, feat, v, d = feat.d) {
  const track = course.track;
  // decks: probe the lip (the rider has already rolled onto the deck)
  const start = feat.t === 'deck' ? feat.lipS - 10 : feat.s0 - 3;
  const b = createBike(track, start, d);
  const c = track.sample(b.s);
  b.v = v;
  b.y = c.y + track.rampHeight(b.s, d);
  const stats = makeStats('allround');
  const inp = { throttle: 0, brake: 0, steer: 0, sprint: false, boost: false, reset: false };
  const dt = PHYSICS.dt;
  const path = [];
  let launched = false;
  let prevG = b.y;
  let wall = false;
  for (let i = 0; i < 1200; i++) {
    // hold the speed like a rider would on the run-up (probe only)
    if (!launched) b.v = v;
    const wasAir = b.airborne;
    const yPrev = b.y;
    stepBike(b, inp, dt, track, stats);
    const g = track.sample(b.s).y + track.rampHeight(b.s, b.d);
    if (b.airborne && !wasAir) launched = true;
    if (launched) path.push({ u: b.u, d: b.d, y: b.y, road: track.sample(b.s).y, air: b.airborne });
    if (!b.airborne && wasAir) {
      if (g - yPrev > TRICK.wallStep) wall = true;
      break;
    }
    if (!b.airborne && g - prevG > TRICK.wallStep) wall = true;
    prevG = g;
    if (wall) break;
  }
  const land = path.at(-1);
  return { path, launched, wall, landU: land?.u ?? null, pit: land ? course.pitAt(track.wrap(land.u), land.d) : false, air: path.length * dt };
}

/** Lowest speed (0.25 m/s steps) that clears a gap/step cleanly. */
function minClearSpeed(course, feat) {
  for (let v = 8; v <= 40; v += 0.25) {
    const p = probeJump(course, feat, v);
    if (p.launched && !p.wall && !p.pit) return v;
  }
  return null;
}

// ------------------------------------------------------------------ build
const courseCache = new Map();

/** Build (once) the course for a level definition. */
export function buildCourse(level) {
  if (courseCache.has(level.id)) return courseCache.get(level.id);
  const base = getTrack(level.map);
  const mask = mapMask(base);
  const course = makeCourse(level, base);
  let cursor = level.from + (level.runup ?? 70);
  let lastGateU = level.from;
  let lastJump = null;
  const problems = [];
  for (let fi = 0; fi < level.features.length; fi++) {
    const spec = level.features[fi];
    if (spec.t === 'ring' || spec.t === 'target') {
      // attached to the previous jump: placed on a real probe flight at the design speed
      if (!lastJump) {
        problems.push(`${spec.t} without a jump before it`);
        continue;
      }
      const v = spec.v ?? lastJump.designV;
      const pr = probeJump(course, lastJump, v);
      if (!pr.launched || pr.path.length < 6) {
        problems.push(`${spec.t}: probe did not fly at ${v} m/s`);
        continue;
      }
      if (spec.t === 'ring') {
        const p = pr.path[Math.min(pr.path.length - 2, Math.floor(pr.path.length * (spec.f ?? 0.5)))];
        course.rings.push({ i: course.rings.length, u: p.u, s: base.wrap(p.u), d: p.d, y: p.y - p.road + 0.85, r: spec.r ?? 1.8, v, feature: lastJump.i });
      } else {
        const len = spec.len ?? 6;
        const lu = pr.landU + (spec.shift ?? 0);
        course.targets.push({ i: course.targets.length, u0: lu - len / 2, u1: lu + len / 2, s0: base.wrap(lu - len / 2), s1: base.wrap(lu + len / 2), d: pr.path.at(-1).d, w: spec.w ?? Math.min(5, base.limit * 1.3), v, feature: lastJump.i });
      }
      continue;
    }
    const geo0 = expand(spec, 0, base);
    const pre = spec.t === 'barrels' || spec.t === 'pad' ? 8 : 18;
    // jumps carrying a ring or a landing target get a straighter road and more room after them
    const nextT = level.features[fi + 1]?.t;
    const aimed = nextT === 'ring' || nextT === 'target';
    const maxCurv = spec.curv ?? (aimed ? Math.min(0.006, CURV_LIMIT[spec.t]) : CURV_LIMIT[spec.t]);
    if (aimed) geo0.post += 10;
    let s = cursor + (spec.gap ?? 15);
    let found = false;
    const limitU = base.length - 60;
    // straight around the takeoff and the first part of the flight; the rest of the landing
    // area only has to be clear of overhead structures (and not a hairpin)
    const core = geo0.jump ? Math.min(geo0.post, 14 + (spec.h ?? 1) * 5) : geo0.post;
    for (; s < limitU; s += 2) {
      if (windowOk(base, mask, s - pre, s + geo0.len + core, maxCurv) && windowOk(base, mask, s + geo0.len + core, s + geo0.len + geo0.post, 0.03)) {
        found = true;
        break;
      }
    }
    if (!found) {
      problems.push(`feature ${fi} (${spec.t}) found no room after ${cursor.toFixed(0)}`);
      break;
    }
    const geo = expand(spec, s, base);
    const feat = { i: course.features.length, t: spec.t, spec, s0: s, s1: s + geo.len, lipS: geo.lipS, d: geo.d, w: geo.w, jump: geo.jump, designV: spec.v ?? null, minV: null };
    course.segs.push(...geo.segs);
    course.pits.push(...geo.pits);
    course.obstacles.push(...geo.obstacles);
    course.pads.push(...geo.pads);
    course.segs.sort((a, b) => a.s0 - b.s0);
    course.features.push(feat);
    if (feat.jump) {
      if (spec.t === 'gap' || spec.t === 'step') {
        feat.minV = minClearSpeed(course, feat);
        if (feat.minV === null) problems.push(`feature ${fi} (${spec.t}) cannot be cleared at any speed`);
        feat.designV = spec.v ?? Math.min(30, (feat.minV ?? 20) + 2);
      } else feat.designV = spec.v ?? (spec.t === 'deck' ? 15 : 18);
      lastJump = feat;
    }
    // checkpoint (respawn point) ahead of every big feature, spaced out
    const wantGate = spec.cp ?? (feat.jump && (spec.t !== 'kick' || spec.h >= 1.8));
    // the respawn spot must be plain road: slide it back before anything built there
    let gu = s - (level.cpLead ?? 40);
    for (let k = 0; k < 8; k++) {
      const hit = course.features.find((o) => o !== feat && gu > o.s0 - 25 && gu < o.s1 + 12);
      if (!hit) break;
      gu = hit.s0 - 26;
    }
    if (wantGate && gu - lastGateU > 60 && gu > level.from + 30) {
      course.gates.push({ u: gu, i: course.gates.length, feature: feat.i });
      lastGateU = gu;
    }
    cursor = s + geo.len + geo.post + (aimed ? 10 : 0);
  }
  course.finishU = cursor + (level.runout ?? 35);
  if (course.finishU > base.length - 40) problems.push('course runs past the end of the map');
  // respawn speed for each gate: enough for the next jump (a rolling restart)
  for (const g of course.gates) {
    const ahead = course.features.filter((f) => f.s0 > g.u);
    const next = ahead.find((f) => f.jump);
    g.respawnV = clamp((next?.designV ?? 14) + 0.5, 10, RESPAWN.speedMax);
    // barrels or rollers before that jump: restart slower
    if (ahead.length && !ahead[0].jump) g.respawnV = 9;
  }
  course.startRespawnV = 0;
  course.problems = problems;
  course.length = course.finishU - course.startU;
  course.maxScore = scoreBound(course);
  courseCache.set(level.id, course);
  return course;
}

/**
 * Generous upper bound of the score any rider could reach on a course: every jump flown at
 * 36 m/s for its longest possible air time, rotating at the fastest bike's maximum rate the whole
 * time, max combo, every ring and target. Used by the server to reject impossible challenge scores.
 */
function scoreBound(course) {
  const G = PHYSICS.gravity * 1.25;
  const vy = 0.3 * 36;
  let total = POINTS.finish + course.gates.length * POINTS.checkpoint;
  const rate = (TRICK.flipRate + TRICK.spinRate) * 1.4 * 1.25; // fastest bike + full upgrades, both axes
  for (const f of course.features) {
    if (!f.jump) continue;
    const h = (f.spec.h ?? 1) + (f.spec.lip ?? 0.7) + 12; // + descent of the road below
    const air = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
    const rots = (air * rate) / (Math.PI * 2);
    const per = POINTS.airPerSec * air + POINTS.distPerM * 36 * air + rots * POINTS.frontflip * 3.2 + POINTS.corkscrew + POINTS.stylePerSec * air + POINTS.perfect + POINTS.clean;
    total += per * comboMult(99);
  }
  total += (course.rings.length * POINTS.ring + course.targets.length * POINTS.target) * comboMult(99);
  return Math.ceil(total);
}

/** @internal map exclusion mask (tools) */
export const _mask = mapMask;
