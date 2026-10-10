// Stunt garage: the 4 original road bikes (unchanged, used as-is by normal racing) plus 30
// stunt-mode bikes. New bikes are only ridden in stunt mode — normal races keep using
// constants.js BIKES, so the racing roster, AI bike picks and the server's racing bike
// validation are untouched.
//
// Racing-style stats (power, top, climb, handling, stamina) feed the same formula as
// physics.js makeStats and stay inside the original roster's envelope (power <= 1.06), so the
// server's anti-cheat speed envelope (maxAccel, which assumes power 1.1) still holds.
// Stunt stats only affect stunt mode: air (rotation response), rot (rotation speed),
// land (landing tolerance), nitro (nitro gain + burn time).

import { BIKES } from '../constants.js';
import { UPGRADES } from './config.js';

const ORIGINAL_STUNT = {
  allround: { air: 1, rot: 1, land: 1, nitro: 1 },
  aero: { air: 0.9, rot: 0.92, land: 0.95, nitro: 1.05 },
  climber: { air: 1.08, rot: 1.05, land: 0.95, nitro: 0.95 },
  sprint: { air: 0.95, rot: 0.98, land: 1, nitro: 1.1 },
};

export const BIKE_CATEGORIES = [
  { id: 'road', name: 'Road', desc: 'The original race bikes and their stunt-tuned siblings' },
  { id: 'bmx', name: 'BMX', desc: 'Small, flickable, fastest rotation' },
  { id: 'dirt', name: 'Dirt jump', desc: 'Suspension fork, forgiving landings' },
  { id: 'aero', name: 'Aero / TT', desc: 'Top speed for the long gaps, lazy in the air' },
  { id: 'fat', name: 'Fat bike', desc: 'Huge tyres: lands almost anything, rotates slowly' },
  { id: 'trial', name: 'Street trials', desc: 'Pure air control, short on top speed' },
];

// geo.family selects the frame build in CyclistModel; 'road' reuses the original geometry.
// [id, name, category, desc, [power, top, climb, handling, stamina], [air, rot, land, nitro], geo, unlock]
const NEW = [
  // ---- road family (original geometry, new wheels / tubes / paint) ----
  ['road_volt', 'Volt Strada', 'road', 'Road frame with a stunt tune and deep carbon wheels.', [1.0, 1.01, 1.0, 1.0, 1.0], [1.05, 1.04, 1.02, 1.08], { family: 'road', thick: 1.1, deep: 0.05, frame: '#00d1ff', accent: '#ffe94d' }, { coins: 400 }],
  ['road_nebula', 'Nebula Gran Fondo', 'road', 'Comfort road geometry: stable on every landing.', [0.98, 0.99, 1.02, 1.03, 1.06], [1.0, 0.98, 1.15, 1.0], { family: 'road', thick: 0.9, deep: 0.022, frame: '#6a4cff', accent: '#ffffff', attach: ['fenders'] }, { coins: 600 }],
  ['road_ember', 'Ember Criterium', 'road', 'Twitchy crit racer: quick to rotate.', [1.03, 1.0, 0.97, 1.08, 0.94], [1.12, 1.1, 0.92, 1.0], { family: 'road', thick: 1.2, deep: 0.04, frame: '#ff4d1f', accent: '#1d1d1f' }, { coins: 900, level: 8 }],
  ['road_glacier', 'Glacier Endurance', 'road', 'Steady all-day bike with a big nitro tank.', [0.99, 1.0, 1.04, 1.0, 1.08], [0.98, 0.97, 1.08, 1.22], { family: 'road', thick: 1.0, deep: 0.022, frame: '#e8f4ff', accent: '#2a9dff', attach: ['light'] }, { coins: 1100, level: 14 }],
  ['road_onyx', 'Onyx Superleggera', 'road', 'Featherweight carbon: climbs and flips.', [1.04, 0.99, 1.1, 1.06, 1.0], [1.15, 1.12, 0.95, 0.98], { family: 'road', thick: 0.75, deep: 0.03, frame: '#1a1a1f', accent: '#d4af37' }, { coins: 1800, stars: 45 }],
  ['road_aurora', 'Aurora Gravel', 'road', 'Gravel-ready road bike with chunky tyres.', [1.0, 0.98, 1.03, 1.05, 1.04], [1.04, 1.02, 1.2, 1.02], { family: 'road', thick: 1.15, deep: 0.022, tire: 0.026, frame: '#3fb950', accent: '#f1faee', attach: ['fenders'] }, { coins: 1400, level: 20 }],
  // ---- BMX ----
  ['bmx_rookie', 'Kickflip 20', 'bmx', 'Entry BMX: light, quick, easy to spin.', [0.97, 0.95, 0.96, 1.08, 1.0], [1.15, 1.15, 1.0, 1.0], { family: 'bmx', frame: '#ff006e', accent: '#ffffff', attach: ['pegs'] }, { coins: 300 }],
  ['bmx_street', 'Gutter Street', 'bmx', 'Street BMX with pegs and a number plate.', [0.98, 0.95, 0.97, 1.09, 0.98], [1.18, 1.2, 0.98, 1.02], { family: 'bmx', frame: '#ffd23f', accent: '#1d1d1f', attach: ['pegs', 'plate'] }, { coins: 700, level: 5 }],
  ['bmx_park', 'Halfpipe Pro', 'bmx', 'Park BMX: the fastest flips in the garage.', [0.98, 0.95, 0.96, 1.1, 0.97], [1.22, 1.28, 0.95, 1.0], { family: 'bmx', frame: '#4cc9f0', accent: '#ff7b00', attach: ['plate'] }, { coins: 1500, level: 16 }],
  ['bmx_race', 'Gate Drop RX', 'bmx', 'Race BMX: more speed, a little less spin.', [1.03, 0.98, 0.98, 1.06, 1.0], [1.1, 1.12, 1.0, 1.08], { family: 'bmx', frame: '#e63946', accent: '#f1faee', attach: ['plate'] }, { coins: 1300, level: 12 }],
  ['bmx_chrome', 'Chrome Bandit', 'bmx', 'Polished chromoly classic.', [0.99, 0.96, 0.97, 1.08, 1.0], [1.18, 1.18, 1.05, 1.05], { family: 'bmx', frame: '#c9ccd1', accent: '#e63946', metal: true, attach: ['pegs'] }, { coins: 2200, stars: 60 }],
  ['bmx_legend', 'Superman 360', 'bmx', 'Signature frame of the stunt legends.', [1.0, 0.97, 0.98, 1.1, 1.0], [1.28, 1.3, 1.05, 1.1], { family: 'bmx', frame: '#8338ec', accent: '#ffd23f', attach: ['pegs', 'plate'] }, { coins: 4200, level: 40 }],
  // ---- dirt jump (suspension fork) ----
  ['dirt_loam', 'Loam Hopper', 'dirt', 'Hardtail dirt jumper. Forgiving.', [0.99, 0.96, 1.0, 1.04, 1.02], [1.05, 1.02, 1.22, 1.0], { family: 'dirt', frame: '#2a9d8f', accent: '#e9c46a' }, { coins: 450 }],
  ['dirt_berm', 'Berm Slayer', 'dirt', 'Long travel fork soaks up flat landings.', [1.0, 0.97, 1.02, 1.05, 1.0], [1.04, 1.03, 1.3, 1.02], { family: 'dirt', frame: '#f4a261', accent: '#264653', attach: ['plate'] }, { coins: 1000, level: 10 }],
  ['dirt_mudslide', 'Mudslide DJ', 'dirt', 'Dirt jumper with a big nitro appetite.', [1.01, 0.97, 1.0, 1.04, 1.0], [1.06, 1.05, 1.2, 1.2], { family: 'dirt', frame: '#6b4f2a', accent: '#ffb000' }, { coins: 1250, level: 18 }],
  ['dirt_storm', 'Stormfront DJ', 'dirt', 'Stiff frame, sharp rotation.', [1.02, 0.98, 1.0, 1.05, 0.98], [1.12, 1.12, 1.18, 1.04], { family: 'dirt', frame: '#3a86ff', accent: '#ffffff', attach: ['light'] }, { coins: 1900, level: 25 }],
  ['dirt_ridge', 'Ridgeline Enduro', 'dirt', 'Climbs like a goat, lands like a cat.', [1.01, 0.97, 1.08, 1.04, 1.06], [1.05, 1.02, 1.32, 1.02], { family: 'dirt', frame: '#606c38', accent: '#fefae0', attach: ['fenders'] }, { coins: 2400, stars: 75 }],
  ['dirt_venom', 'Venom Freeride', 'dirt', 'Pro freeride rig.', [1.03, 0.99, 1.02, 1.06, 1.0], [1.18, 1.15, 1.3, 1.1], { family: 'dirt', frame: '#06d6a0', accent: '#1d1d1f', attach: ['plate'] }, { coins: 4000, level: 35 }],
  // ---- aero / time trial ----
  ['tt_arrow', 'Arrow TT', 'aero', 'Time trial bike: built for the long gaps.', [1.02, 1.05, 0.94, 0.94, 1.0], [0.88, 0.86, 0.95, 1.12], { family: 'tt', frame: '#1d3557', accent: '#e63946' }, { coins: 800, level: 6 }],
  ['tt_comet', 'Comet Disc', 'aero', 'Rear disc wheel, enormous top speed.', [1.03, 1.06, 0.93, 0.93, 0.98], [0.86, 0.84, 0.95, 1.18], { family: 'tt', frame: '#ff7b00', accent: '#1d1d1f', disc: true }, { coins: 1600, level: 22 }],
  ['tt_photon', 'Photon Triathlon', 'aero', 'Tri-spoke wheels and a long tank.', [1.02, 1.05, 0.95, 0.95, 1.06], [0.9, 0.88, 1.0, 1.25], { family: 'tt', frame: '#f1faee', accent: '#06d6a0', disc: true }, { coins: 2600, level: 30 }],
  ['tt_vortex', 'Vortex Hour Record', 'aero', 'The fastest machine in the game.', [1.05, 1.07, 0.92, 0.93, 1.0], [0.9, 0.9, 0.98, 1.3], { family: 'tt', frame: '#8338ec', accent: '#4cc9f0', disc: true }, { coins: 4500, stars: 110 }],
  // ---- fat bikes ----
  ['fat_yeti', 'Yeti Fat', 'fat', 'Four-inch tyres. Lands nearly anything.', [0.97, 0.94, 0.98, 1.0, 1.06], [0.9, 0.85, 1.45, 1.0], { family: 'fat', frame: '#f1faee', accent: '#3a86ff' }, { coins: 350 }],
  ['fat_tundra', 'Tundra Cruiser', 'fat', 'Fat tyres, fenders and a lamp.', [0.98, 0.95, 1.0, 1.0, 1.08], [0.92, 0.88, 1.45, 1.06], { family: 'fat', frame: '#2a9d8f', accent: '#f4a261', attach: ['fenders', 'light'] }, { coins: 950, level: 9 }],
  ['fat_magma', 'Magma Fat', 'fat', 'Fat bike with extra punch.', [1.02, 0.96, 0.98, 1.0, 1.0], [0.95, 0.9, 1.4, 1.1], { family: 'fat', frame: '#d00000', accent: '#ffba08' }, { coins: 1700, level: 24 }],
  ['fat_glacier', 'Moonwalker Fat', 'fat', 'Low-gravity feel, the softest landings.', [1.0, 0.96, 1.0, 1.02, 1.04], [1.0, 0.95, 1.5, 1.08], { family: 'fat', frame: '#adb5bd', accent: '#7209b7', metal: true }, { coins: 3200, stars: 90 }],
  // ---- street trials ----
  ['trial_pogo', 'Pogo Trials', 'trial', 'Tiny trials bike: max air control.', [0.97, 0.94, 0.97, 1.1, 0.98], [1.3, 1.2, 1.0, 0.95], { family: 'trial', frame: '#ffd23f', accent: '#3a86ff' }, { coins: 650, level: 4 }],
  ['trial_gecko', 'Gecko Street', 'trial', 'Grippy street trials frame.', [0.98, 0.95, 1.0, 1.1, 1.0], [1.3, 1.22, 1.08, 0.98], { family: 'trial', frame: '#70e000', accent: '#1d1d1f', attach: ['plate'] }, { coins: 1350, level: 15 }],
  ['trial_ninja', 'Ninja Gap', 'trial', 'Precision machine for the narrowest zones.', [0.99, 0.95, 0.98, 1.1, 1.0], [1.35, 1.25, 1.1, 1.0], { family: 'trial', frame: '#1d1d1f', accent: '#ff006e' }, { coins: 2800, level: 32 }],
  ['trial_phantom', 'Phantom Pro', 'trial', 'The ultimate air-control frame.', [1.0, 0.96, 1.0, 1.1, 1.0], [1.4, 1.3, 1.15, 1.05], { family: 'trial', frame: '#e5e5e5', accent: '#ff7b00', metal: true }, { coins: 5000, stars: 130 }],
];

function original(b) {
  return {
    ...b,
    category: 'road',
    stunt: ORIGINAL_STUNT[b.id],
    geo: { family: 'road', original: true },
    unlock: null,
    original: true,
  };
}

export const STUNT_BIKES = [
  ...BIKES.map(original),
  ...NEW.map(([id, name, category, desc, r, s, geo, unlock]) => ({
    id,
    name,
    category,
    desc,
    power: r[0],
    top: r[1],
    climb: r[2],
    handling: r[3],
    stamina: r[4],
    stunt: { air: s[0], rot: s[1], land: s[2], nitro: s[3] },
    geo,
    unlock,
    original: false,
  })),
];
export const STUNT_BIKE_BY_ID = Object.fromEntries(STUNT_BIKES.map((b) => [b.id, b]));
/** Geometry spec for the renderer (undefined for the original four: they keep their exact build). */
export const BIKE_GEO = Object.fromEntries(STUNT_BIKES.filter((b) => !b.original).map((b) => [b.id, b.geo]));

/**
 * Physics + stunt stats for a stunt-mode rider.
 * Same formula as physics.js makeStats for the racing part (kept separate so racing code is untouched).
 * @param upgrades {power, air, rot, land, nitro} levels (0..5) — pass null for challenges (base stats)
 */
export function stuntStats(bikeId, upgrades = null, assist = 0) {
  const b = STUNT_BIKE_BY_ID[bikeId] || STUNT_BIKE_BY_ID.allround;
  const up = (id) => (upgrades ? Math.max(0, Math.min(5, upgrades[id] | 0)) * UPGRADES.find((u) => u.id === id).per : 0);
  const powerMul = 1 + up('power');
  const top = b.top * Math.pow(powerMul, 0.7);
  return {
    assist,
    power: b.power * powerMul,
    top,
    aero: 1 / Math.pow(top, 2.2),
    climb: b.climb,
    handling: b.handling,
    stamina: b.stamina,
    air: b.stunt.air * (1 + up('air')),
    rot: b.stunt.rot * (1 + up('rot')),
    land: b.stunt.land * (1 + up('land')),
    nitro: b.stunt.nitro * (1 + up('nitro')),
  };
}

/** Upper bound of any stunt rider's stats (server-side plausibility for challenges). */
export const STUNT_STAT_MAX = (() => {
  const m = { power: 0, rot: 0, air: 0, land: 0, nitro: 0 };
  for (const b of STUNT_BIKES) {
    m.power = Math.max(m.power, b.power);
    for (const k of ['rot', 'air', 'land', 'nitro']) m[k] = Math.max(m[k], b.stunt[k]);
  }
  return m;
})();
