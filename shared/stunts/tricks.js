// Airborne trick model. Rotations are a real state integrated only while the physics says the
// bike is airborne (bike.airborne from stepBike), driven by the rider's input. Landing is
// validated from the accumulated angles: a jump scores only if the bike comes down upright
// (pitch and yaw within tolerance of a whole turn) with the hands back on the bars.
//
// Conventions: pitch > 0 = backflip direction, spin > 0 = clockwise (steer right).
// Inputs only count once pressed in the air: whatever was held at takeoff (pedal, steering)
// must be released and pressed again, so riding normally never starts a trick by accident.

import { TRICK, POINTS, comboMult } from './config.js';

const TAU = Math.PI * 2;
const residual = (a) => a - Math.round(a / TAU) * TAU;

export function createTricks() {
  return {
    air: false,
    pitch: 0,
    spin: 0,
    pitchVel: 0,
    spinVel: 0,
    styleOn: false,
    styleT: 0,
    airT: 0,
    armF: false,
    armB: false,
    armL: false,
    armR: false,
    armS: false,
  };
}

export function resetTricks(T) {
  T.air = false;
  T.pitch = T.spin = T.pitchVel = T.spinVel = 0;
  T.styleOn = false;
  T.styleT = 0;
  T.airT = 0;
}

/** Called on the physics step the bike leaves the ground. */
export function takeoff(T, input) {
  resetTricks(T);
  T.air = true;
  // held inputs are disarmed until released
  T.armF = !(input.throttle > 0.5);
  T.armB = !(input.brake > 0.5);
  T.armL = !(input.steer < -0.5);
  T.armR = !(input.steer > 0.5);
  T.armS = !input.sprint;
}

/**
 * Integrate one physics step of airborne rotation. Does nothing unless T.air (set by takeoff,
 * which the run calls only when the physics reports a launch).
 * @param stats stunt stats {air, rot, land}
 */
export function stepTricks(T, input, dt, stats) {
  if (!T.air) return;
  T.airT += dt;
  const fwd = input.throttle > 0.5;
  const back = input.brake > 0.5;
  const left = input.steer < -0.5;
  const right = input.steer > 0.5;
  if (!fwd) T.armF = true;
  if (!back) T.armB = true;
  if (!left) T.armL = true;
  if (!right) T.armR = true;
  if (!input.sprint) T.armS = true;
  const pIn = (T.armB && back ? 1 : 0) - (T.armF && fwd ? 1 : 0);
  const sIn = (T.armR && right ? 1 : 0) - (T.armL && left ? 1 : 0);
  const acc = TRICK.rotAccel * stats.air * dt;
  const decay = Math.exp(-TRICK.rotDecay * dt);
  const settle = TRICK.assistRate * stats.land * dt;
  // pitch
  if (pIn) {
    const target = pIn * TRICK.flipRate * stats.rot;
    T.pitchVel += Math.max(-acc, Math.min(acc, target - T.pitchVel));
  } else {
    T.pitchVel *= decay;
    const r = residual(T.pitch);
    if (Math.abs(r) < TRICK.assistZone && Math.abs(T.pitchVel) < 2.5) T.pitch -= Math.sign(r) * Math.min(Math.abs(r), settle);
  }
  T.pitch += T.pitchVel * dt;
  // spin
  if (sIn) {
    const target = sIn * TRICK.spinRate * stats.rot;
    T.spinVel += Math.max(-acc, Math.min(acc, target - T.spinVel));
  } else {
    T.spinVel *= decay;
    const r = residual(T.spin);
    if (Math.abs(r) < TRICK.assistZone && Math.abs(T.spinVel) < 2.5) T.spin -= Math.sign(r) * Math.min(Math.abs(r), settle);
  }
  T.spin += T.spinVel * dt;
  // style (no-hander): hold sprint, re-pressed in the air
  const style = T.armS && input.sprint;
  if (style) T.styleT += dt;
  T.styleOn = style;
}

/**
 * Judge a touchdown. Pure function of the trick state (+ surface facts from the course).
 * @returns {clean, perfect, reason, flips, spins, back, front, style, air}
 */
export function judgeLanding(T, stats, { pit = false, wall = false } = {}) {
  const rp = residual(T.pitch);
  const rs = residual(T.spin);
  const tol = TRICK.landTol * stats.land;
  const flipsSigned = Math.round(T.pitch / TAU);
  const spins = Math.abs(Math.round(T.spin / TAU));
  let reason = '';
  if (wall) reason = 'Cased the landing';
  else if (pit) reason = 'Fell into the gap';
  else if (Math.abs(rp) > tol) reason = Math.abs(T.pitch) > Math.PI && rp * Math.sign(T.pitch) > 0 ? 'Over-rotated' : 'Under-rotated';
  else if (Math.abs(rs) > tol) reason = 'Landed sideways';
  else if (T.styleOn) reason = 'Hands off the bars';
  const clean = !reason;
  return {
    clean,
    reason,
    perfect: clean && Math.max(Math.abs(rp), Math.abs(rs)) <= TRICK.perfectTol * stats.land,
    flips: Math.abs(flipsSigned),
    back: flipsSigned > 0 ? flipsSigned : 0,
    front: flipsSigned < 0 ? -flipsSigned : 0,
    spins,
    style: T.styleT,
    air: T.airT,
  };
}

/** Trick names for a judged jump (for popups / results). */
export function trickNames(j) {
  const out = [];
  const mult = ['', '', 'DOUBLE ', 'TRIPLE ', 'QUAD ', 'QUINT '];
  if (j.back) out.push(`${mult[j.back] || j.back + 'x '}BACKFLIP`);
  if (j.front) out.push(`${mult[j.front] || j.front + 'x '}FRONTFLIP`);
  if (j.spins) out.push(`${j.spins * 360}`);
  if (j.flips && j.spins) out.push('CORKSCREW');
  if (j.style >= 0.25) out.push('NO-HANDER');
  return out;
}

/**
 * Points for one clean jump before the combo multiplier.
 * @param j judged landing, extra {dist, rings, target}
 */
export function jumpPoints(j, { dist = 0, rings = 0, target = false } = {}) {
  if (!j.clean) return 0;
  let p = POINTS.clean;
  if (j.air >= TRICK.minAir) p += POINTS.airPerSec * j.air;
  p += POINTS.distPerM * Math.max(0, dist - POINTS.distFree);
  const n = j.flips;
  if (n) p += (j.back ? POINTS.backflip : POINTS.frontflip) * n * (POINTS.multiFlip[n] ?? POINTS.multiFlip.at(-1));
  p += POINTS.spin * j.spins;
  if (j.flips && j.spins) p += POINTS.corkscrew;
  p += POINTS.stylePerSec * j.style;
  if (j.perfect) p += POINTS.perfect;
  if (target) p += POINTS.target;
  p += POINTS.ring * rings;
  return Math.round(p);
}

export { comboMult, residual };
