// Arcade bicycle physics in track space (s, d). Shared by client + server so
// local riders, server bots and server-side validation all agree.

import { PHYSICS as P, SURFACE_BY_ID, SURFACES, BIKE_BY_ID } from './constants.js';
import { clamp, damp, wrapAngle, smoothstep } from './math.js';

const G = P.gravity * 1.25; // snappier arcade airtime
const WHEEL_R = 0.34;

export function makeStats(bikeId = 'allround', powerMul = 1, assist = 0) {
  const b = BIKE_BY_ID[bikeId] || BIKE_BY_ID.allround;
  return {
    assist,
    power: b.power * powerMul,
    top: b.top * Math.pow(powerMul, 0.7),
    // aero efficiency: drag multiplier derived from the bike's top-speed rating
    aero: 1 / Math.pow(b.top * Math.pow(powerMul, 0.7), 2.2),
    climb: b.climb,
    handling: b.handling,
    stamina: b.stamina,
  };
}

export function createBike(track, u = 0, d = 0) {
  const s = track.wrap(u);
  const c = track.sample(s);
  return {
    u,
    s,
    d,
    yaw: c.head,
    v: 0,
    y: c.y,
    vy: 0,
    airborne: false,
    airTime: 0,
    steer: 0,
    lean: 0,
    throttle: 0,
    brake: 0,
    stamina: P.staminaMax,
    exhausted: false,
    sprinting: false,
    boostTimer: 0,
    boostCooldown: 0,
    boostPad: false,
    draft: 0,
    draftCharge: 0, // seconds spent tucked in a slipstream (slingshot fuel)
    sling: 0, // active slingshot time
    effort: 0, // 0..1 smoothed sprint effort
    tired: 0, // 0..1 smoothed exhaustion
    cadence: 0, // crank rad/s (visual + audio)
    brakeT: 0, // smoothed brake pressure (visual weight transfer)
    surf: 0,
    offroad: false,
    crank: 0,
    wheel: 0,
    bump: 0, // visual impulse, decays
    wallHit: 0,
    wrongWay: 0,
    resetCooldown: 0,
    landing: 0,
    frozen: false,
    // events consumed by client audio/fx (set true for one step)
    ev: { boost: false, pad: false, land: false, wall: false, jump: false, collide: false, sling: false },
  };
}

export const emptyInput = () => ({ throttle: 0, brake: 0, steer: 0, sprint: false, boost: false, reset: false });

const _c = {};
const _cA = {};

/** Read + clear accumulated one-shot events (audio/fx). */
export function consumeEvents(b, out = {}) {
  const ev = b.ev;
  for (const k in ev) {
    out[k] = ev[k];
    ev[k] = false;
  }
  return out;
}

/** Place bike back on the road centre facing forward (R key / stuck bots). */
export function resetBike(b, track) {
  const c = track.sample(b.s, _c);
  b.d = clamp(b.d * 0.3, -2, 2);
  b.yaw = c.head;
  b.v = 0;
  b.y = c.y;
  b.vy = 0;
  b.airborne = false;
  b.steer = 0;
  b.lean = 0;
  b.wrongWay = 0;
  b.resetCooldown = P.resetCooldown;
}

/**
 * Advance one bike by dt.
 * @param b bike state
 * @param input {throttle, brake, steer(-1 left .. +1 right), sprint, boost(edge), reset}
 * @param stats from makeStats
 */
export function stepBike(b, input, dt, track, stats) {
  const ev = b.ev;
  b.resetCooldown = Math.max(0, b.resetCooldown - dt);
  b.boostCooldown = Math.max(0, b.boostCooldown - dt);
  b.boostTimer = Math.max(0, b.boostTimer - dt);
  b.bump *= Math.exp(-6 * dt);
  b.wallHit = Math.max(0, b.wallHit - dt);
  b.landing = Math.max(0, b.landing - dt * 3);

  if (b.frozen) {
    b.v = 0;
    b.throttle = input.throttle;
    b.steer += (input.steer - b.steer) * damp(P.steerRate, dt);
    if (input.throttle > 0) b.crank += 3 * dt; // impatient pedal spin at the line
    return;
  }

  if (input.reset && b.resetCooldown <= 0) {
    resetBike(b, track);
    return;
  }

  const c = track.sample(b.s, _c);
  b.offroad = Math.abs(b.d) > track.halfWidth;
  const surf = b.offroad ? SURFACES.grass : SURFACE_BY_ID[c.surf];
  b.surf = b.offroad ? SURFACES.grass.id : c.surf;
  const grip = surf.grip * stats.handling * (stats.grip ?? 1);

  // ---- steering / lean ----
  const steerIn = clamp(input.steer, -1, 1);
  b.steer += (steerIn - b.steer) * damp(P.steerRate, dt);
  const vAbs = Math.max(b.v, 0);
  const lowSpeedFactor = clamp(0.35 + vAbs / 3, 0.35, 1);
  const maxYaw = Math.min(P.maxYawRate * stats.handling, (P.latGrip * grip) / Math.max(vAbs, 2)) * lowSpeedFactor;
  let yawRate = -b.steer * maxYaw;
  const rel0 = wrapAngle(b.yaw - c.head);
  // assist: road-following nudge that fades out as the rider steers (accessibility)
  const assist = (stats.assist ?? 0) * clamp(1 - Math.abs(b.steer) * 2.5, 0, 1);
  if (assist > 0 && Math.abs(rel0) < 0.9 && !b.airborne) {
    yawRate += assist * (-rel0 * P.assistAlign * clamp(vAbs / 6, 0, 1) + c.curv * vAbs * 0.8);
  }
  yawRate = clamp(yawRate, -maxYaw, maxYaw);
  if (b.airborne) yawRate *= 0.35;
  // speed wobble above ~95 km/h: the bike gets nervous and needs a steady hand
  const wob = smoothstep(26, 38, vAbs);
  if (wob > 0 && !b.airborne) {
    b.wobbleT = (b.wobbleT || 0) + dt;
    yawRate += (Math.sin(b.wobbleT * 7.3) + Math.sin(b.wobbleT * 11.9) * 0.6) * 0.035 * wob;
  }
  b.yaw = wrapAngle(b.yaw + yawRate * dt);
  const leanTarget = clamp(Math.atan2(vAbs * -yawRate, P.gravity), -P.maxLean, P.maxLean);
  b.lean += (leanTarget - b.lean) * damp(7, dt);

  // ---- stamina / sprint / boost ----
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  b.throttle = throttle;
  b.brake = brake;
  b.sprinting = !!input.sprint && !b.exhausted && b.stamina > 0 && throttle > 0.2 && !b.airborne;
  if (b.sprinting) {
    b.stamina -= (P.sprintDrain / stats.stamina) * dt;
    if (b.stamina <= 0) {
      b.stamina = 0;
      b.exhausted = true;
    }
  } else {
    const regen = (P.staminaRegen + b.draft * P.draftRegenBonus) * (throttle > 0.5 ? 0.7 : 1.15) * stats.stamina;
    b.stamina = Math.min(P.staminaMax, b.stamina + regen * dt);
  }
  if (b.exhausted && b.stamina >= P.exhaustedThreshold) b.exhausted = false;
  if (input.boost && b.boostCooldown <= 0 && b.stamina >= P.boostCost && !b.exhausted) {
    b.stamina -= P.boostCost;
    b.boostTimer = P.boostDuration;
    b.boostCooldown = P.boostCooldown;
    ev.boost = true;
  }
  if (!b.airborne && track.boostAt(b.s, b.d)) {
    if (!b.boostPad) ev.pad = true;
    b.boostPad = true;
    b.boostTimer = Math.max(b.boostTimer, 1.4);
  } else b.boostPad = false;

  // ---- longitudinal: power model ----
  // Sprint effort ramps in/out and fades as stamina drains (no sudden speed drops).
  const fatigue = b.exhausted ? 0 : smoothstep(0, 22, b.stamina);
  const effortT = b.sprinting ? fatigue : 0;
  b.effort += (effortT - b.effort) * damp(effortT > b.effort ? 3.5 : 2.2, dt);
  b.tired += ((b.exhausted ? 1 : 0) - b.tired) * damp(1.5, dt);
  const boosting = b.boostTimer > 0;
  const power =
    (P.riderPower + (P.sprintPower - P.riderPower) * b.effort) * stats.power * (1 - 0.15 * b.tired) + (boosting ? P.boostPower : 0);
  const peak = (P.peakAccel + (P.sprintPeakAccel - P.peakAccel) * b.effort) * stats.power + (boosting ? 3 : 0);
  // slipstream slingshot: time spent in the draft is released when pulling out
  if (b.draft > 0.45) b.draftCharge = Math.min(3, b.draftCharge + dt);
  else if (b.draft < 0.15 && b.draftCharge > 1 && throttle > 0.5) {
    b.sling = Math.min(1.4, b.draftCharge * 0.55);
    b.draftCharge = 0;
    ev.sling = true;
  } else b.draftCharge = Math.max(0, b.draftCharge - dt * 0.4);
  b.sling = Math.max(0, b.sling - dt);
  b.brakeT += (brake - b.brakeT) * damp(8, dt);
  let a = 0;
  let scrub = 0;
  if (!b.airborne) {
    if (throttle > 0) {
      const band = P.bandAccel * (1 + b.effort * 0.5) * stats.power * Math.max(0, 1 - (vAbs / P.bandSpeed) ** 2)
        // already in a low gear on climbs: no spare drive left to cancel gravity
        * Math.max(0.2, 1 - Math.max(0, c.slope) * 10);
      a += throttle * Math.min(peak, power / Math.max(vAbs, 1) + band);
    }
    else if (boosting) a += Math.min(3, P.boostPower / Math.max(vAbs, 1));
    if (b.sling > 0) a += P.slingshot;
    a -= surf.roll;
    const slope = c.slope;
    a -= P.gravity * slope * (slope > 0 ? P.gravityUp / stats.climb : P.gravityDown);
    // braking is grip-limited and weaker while leaned over
    // brakes fade from ~70 km/h: stopping from 120+ takes real distance
    const fade = 1 - 0.3 * smoothstep(19, 36, vAbs);
    const brakeGrip = grip * fade * (1 - 0.45 * clamp(Math.abs(b.lean) / P.maxLean, 0, 1));
    a -= brake * P.brakeDecel * brakeGrip;
    a -= Math.abs(yawRate) * vAbs * 0.03; // cornering scrub
    // corners taken too fast: bleed speed so the bike makes the turn instead of running wide.
    // Sets the net deceleration (pedalling or a descent can't cancel it), never stronger than the brakes.
    if ((stats.assist ?? 0) > 0) {
      // steering assist on: look one scrub distance ahead and ease off so the next corner fits
      const kGrip = P.latGrip * grip * 0.97;
      const L = Math.min(90, (vAbs * vAbs) / (2 * P.cornerScrub) + 8);
      for (let x = 2; x <= L; x += 2.5) {
        const k = Math.abs(track.sample(b.s + x, _cA).curv);
        if (k < 0.004) continue;
        const need = (vAbs * vAbs - kGrip / k) / (2 * x);
        if (need > scrub) scrub = need;
      }
    } else if (!stats.ai) {
      // assist off: only while the rider holds the turn into a corner the tyres can't follow
      // and is already drifting towards the outside edge
      const cA = track.sample(b.s + Math.max(3, vAbs * 0.45), _cA);
      const curvIn = Math.abs(c.curv) > Math.abs(cA.curv) ? c.curv : cA.curv;
      const into = clamp(-b.steer * Math.sign(curvIn), 0, 1);
      const over = Math.abs(curvIn) * vAbs - maxYaw * 0.92; // rad/s the tyres can't give
      const wide = b.d * Math.sign(curvIn) > track.halfWidth * 0.35;
      if (over > 0 && into > 0.5 && wide) scrub = over * vAbs * smoothstep(0.5, 0.9, into);
    }
  }
  a -= P.drag * (stats.aero ?? 1) * vAbs * vAbs * (1 - P.draftDrag * b.draft);
  if (scrub > 0) a = Math.min(a, -Math.min(P.cornerScrub, scrub));
  b.v = clamp(b.v + a * dt, 0, P.safetyMaxSpeed);
  if (!Number.isFinite(b.v)) b.v = 0;
  if (b.v < 0.05 && throttle === 0) b.v = 0;

  // ---- integrate position in track space ----
  const rel = wrapAngle(b.yaw - c.head);
  const denom = Math.max(0.3, 1 + c.curv * b.d);
  const du = (b.v * Math.cos(rel) * dt) / denom;
  b.u += du;
  b.s = track.wrap(b.u);
  b.d += -b.v * Math.sin(rel) * dt;

  // Barriers: deflect + scrub speed (light arcade)
  const lim = track.limit;
  if (Math.abs(b.d) > lim) {
    const side = Math.sign(b.d);
    b.d = side * lim;
    const into = -side * Math.sin(rel); // >0 when moving into the wall
    if (into > 0) {
      const impact = b.v * into;
      const c2 = track.sample(b.s, _c);
      const r = wrapAngle(b.yaw - c2.head);
      b.yaw = wrapAngle(c2.head + r * -0.25);
      b.v *= 1 - clamp(impact * 0.05, 0.03, 0.45);
      if (impact > 1.5) {
        b.bump = Math.min(1, b.bump + impact * 0.08);
        b.wallHit = 0.4;
        ev.wall = true;
      }
    }
  }

  // ---- vertical (road contact, ramps, jumps) ----
  const c3 = track.sample(b.s, _c);
  const ground = c3.y + track.rampHeight(b.s, b.d);
  if (b.airborne) {
    b.airTime += dt;
    b.vy -= G * dt;
    b.y += b.vy * dt;
    if (b.y <= ground) {
      const impact = -b.vy;
      b.y = ground;
      b.airborne = false;
      b.vy = 0;
      b.landing = clamp(impact / 7, 0.2, 1);
      b.bump = Math.min(1, b.bump + impact * 0.07);
      if (impact > 7) b.v *= 0.94;
      ev.land = true;
    }
  } else {
    const gvy = (ground - b.y) / dt;
    if (gvy < b.vy - G * dt * 2 && b.v > 4 && b.vy > 0.5) {
      // ground fell away faster than gravity: launch!
      b.airborne = true;
      b.airTime = 0;
      ev.jump = true;
      b.y += b.vy * dt;
    } else {
      if (ground - b.y > 0.08) b.bump = Math.min(1, b.bump + 0.15);
      b.y = ground;
      b.vy = clamp(gvy, -b.v * 0.3, b.v * 0.3);
    }
  }

  // surface rumble for visuals
  if (!b.airborne) b.bump = Math.max(b.bump, surf.rough * clamp(vAbs / 12, 0, 1) * 0.35);

  // ---- animation drivers ----
  // cadence rises with speed then tops out (~110 rpm, ~125 rpm sprinting): riders spin out on descents
  const pedalling = throttle > 0.05 && !b.airborne;
  const cadT = pedalling ? Math.min(11.5 + b.effort * 1.6, 3.5 + vAbs * 0.45 + b.effort * 1.5) : 0;
  b.cadence += (cadT - b.cadence) * damp(6, dt);
  b.crank += b.cadence * dt;
  b.wheel += (b.v / WHEEL_R) * dt;
  b.wrongWay = Math.abs(rel) > 1.9 && b.v > 2 ? b.wrongWay + dt : 0;
}

/**
 * Most generous acceleration any legal rider could have (best bike, elite power,
 * full draft, slingshot). The server integrates this as a speed envelope to
 * reject impossible client states without ever flagging an honest rider.
 */
export function maxAccel(v, slope, { sprint = false, boost = false, draft = 1 } = {}) {
  const pw = 1.1;
  const power = (sprint ? P.sprintPower : P.riderPower) * pw + (boost ? P.boostPower : 0);
  const peak = (sprint ? P.sprintPeakAccel : P.peakAccel) * pw + (boost ? 3 : 0);
  const band = P.bandAccel * (sprint ? 1.5 : 1) * pw * Math.max(0, 1 - (v / P.bandSpeed) ** 2);
  let a = Math.min(peak, power / Math.max(v, 1) + band) + P.slingshot;
  a -= P.gravity * slope * (slope > 0 ? P.gravityUp / 1.12 : P.gravityDown);
  a -= P.drag * 0.8 * v * v * (1 - P.draftDrag * draft);
  return a;
}

/** Signed shortest distance along track from a to b (b ahead => positive). */
export function trackDelta(track, sa, sb) {
  let d = sb - sa;
  const L = track.length;
  if (d > L / 2) d -= L;
  else if (d < -L / 2) d += L;
  return d;
}

/**
 * Drafting + light arcade collisions between riders.
 * bikes: array of {bike, movable}
 */
export function interactBikes(list, track, dt) {
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const A = list[i].bike;
    let draftTarget = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const B = list[j].bike;
      const ahead = trackDelta(track, A.s, B.s);
      const lat = Math.abs(B.d - A.d);
      if (ahead > P.draftMin && ahead < P.draftMax && lat < P.draftLateral && B.v > 6) {
        const f = 1 - (ahead - P.draftMin) / (P.draftMax - P.draftMin);
        draftTarget = Math.max(draftTarget, clamp(f * 1.4, 0, 1) * (1 - lat / P.draftLateral * 0.5));
      }
    }
    A.draft += (draftTarget - A.draft) * damp(3, dt);
  }
  // collisions
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = list[i].bike;
      const B = list[j].bike;
      if (A.frozen && B.frozen) continue;
      const ds = trackDelta(track, A.s, B.s);
      const dd = B.d - A.d;
      if (Math.abs(ds) < P.bikeLength && Math.abs(dd) < P.bikeWidth && Math.abs(A.y - B.y) < 1.2) {
        const push = (P.bikeWidth - Math.abs(dd)) * 0.5 + 0.01;
        const dir = dd === 0 ? (i % 2 ? 1 : -1) : Math.sign(dd);
        const ma = list[i].movable;
        const mb = list[j].movable;
        const wa = ma && mb ? 1 : ma ? 2 : 0;
        const wb = ma && mb ? 1 : mb ? 2 : 0;
        A.d -= dir * push * wa;
        B.d += dir * push * wb;
        // rear rider bumps into the one ahead -> loses speed
        const rear = ds > 0 ? A : B;
        const front = ds > 0 ? B : A;
        const rearMov = ds > 0 ? ma : mb;
        if (Math.abs(ds) > P.bikeLength * 0.45 && rear.v > front.v && rearMov) rear.v = front.v * 0.97;
        if (ma) A.bump = Math.min(1, A.bump + 0.25);
        if (mb) B.bump = Math.min(1, B.bump + 0.25);
        if (ma) A.ev.collide = true;
        if (mb) B.ev.collide = true;
      }
    }
  }
}
