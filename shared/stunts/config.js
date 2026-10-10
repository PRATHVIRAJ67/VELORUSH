// Stunt mode tuning + scoring + economy. Pure data shared by client, server (challenge
// validation) and the headless solver. Nothing here is used by normal racing.

export const STUNT_VERSION = 1;

/** Airborne rotation model (rad, s). Bike stunt stats scale these (see bikes.js statsFor). */
export const TRICK = {
  flipRate: 11.5, // pitch rad/s at full input (backflip / frontflip)
  spinRate: 12.5, // yaw rad/s at full input (360 spins)
  rotAccel: 48, // rad/s^2: how fast the rotation reaches the input rate (air control scales it)
  rotDecay: 10, // 1/s: rotation slows down when the input is released
  assistZone: 0.5, // rad: released close to upright -> the rider settles level by themselves
  assistRate: 2.6, // rad/s of that settling (landing stability scales it)
  landTol: 0.44, // rad (~25 deg): residual rotation still counted as a clean landing
  perfectTol: 0.14, // rad (~8 deg): "perfect" landing
  styleGrace: 0.12, // s: a style trick released this long before touchdown is still clean
  minAir: 0.32, // s: shorter hops do not score or extend a combo
  comboWindow: 4, // s from a clean landing to the next takeoff to keep the combo alive
  maxMult: 5,
  crashTime: 1.25, // s on the ground before the respawn
  wallStep: 0.38, // m: ground rising more than this in one physics step = ran into a face
};

/** Points (all awarded only on a clean landing, then multiplied by the combo). */
export const POINTS = {
  airPerSec: 150,
  distPerM: 12, // beyond distFree metres
  distFree: 6,
  backflip: 500,
  frontflip: 650,
  spin: 400,
  corkscrew: 350, // flip + spin in the same jump
  multiFlip: [1, 1, 1.5, 2, 2.6, 3.2], // per-flip multiplier by flip count in one jump
  stylePerSec: 400, // no-hander held in the air
  perfect: 250,
  target: 400, // landing inside a precision zone
  ring: 250, // flying through a ring
  clean: 50,
  checkpoint: 100,
  finish: 500,
};

/** Combo multiplier for n consecutive clean scoring landings. */
export const comboMult = (n) => Math.min(TRICK.maxMult, 1 + Math.max(0, n - 1) * 0.5);

/** Nitro (stunt boost) meter. Replaces the stamina burst boost in stunt mode only. */
export const NITRO = {
  max: 100,
  start: 40,
  cost: 34,
  duration: 1.5, // s of PHYSICS.boostPower (the existing boost force)
  cooldown: 0.6,
  gainAirPerSec: 14,
  gainFlip: 18,
  gainSpin: 14,
  gainStylePerSec: 10,
  gainPerfect: 10,
  gainRing: 8,
};

export const RESPAWN = {
  speedMax: 26, // m/s cap for the rolling restart speed
  wrongWay: 2.2, // s riding the wrong way before an automatic respawn
};

/** Stunt-only upgrades (solo play). Challenges always use base bike stats. */
export const UPGRADES = [
  { id: 'power', name: 'Drivetrain', desc: 'Pedal power in stunt levels', per: 0.015, unit: '% power' },
  { id: 'air', name: 'Air control', desc: 'Rotation response in the air', per: 0.07, unit: '% air control' },
  { id: 'rot', name: 'Rotation', desc: 'Flip and spin speed', per: 0.04, unit: '% rotation speed' },
  { id: 'land', name: 'Suspension', desc: 'Landing tolerance', per: 0.06, unit: '% landing tolerance' },
  { id: 'nitro', name: 'Nitro tank', desc: 'Nitro gain and burn time', per: 0.08, unit: '% nitro' },
];
export const UPGRADE_MAX = 5;
export const UPGRADE_COST = [150, 300, 550, 900, 1400];

export const ECONOMY = {
  replayDivisor: 400, // coins per replay = score / divisor (capped)
  replayCap: 40,
  challengeBase: 30, // coins for finishing a challenge
  challengeWin: 60, // extra for winning a challenge with 2+ riders
};

export const TIER_NAMES = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
