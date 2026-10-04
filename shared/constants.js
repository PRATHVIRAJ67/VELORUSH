// Gameplay + network constants shared by client and server.

export const GAME_NAME = 'VELO RUSH';

export const PHYSICS = {
  dt: 1 / 120, // fixed simulation step
  gravity: 9.81,
  gravityDown: 1.6, // arcade-strong descents: 60 -> 120-135 km/h within the mountain descent
  gravityUp: 0.68, // climbs slow you, but stay fast and raceable
  // Power model (per kg): pedal accel = min(peak, power / v). Equilibrium on the
  // flat is where power / v == drag v^2 + rolling resistance.
  riderPower: 8.8, // ~64 km/h cruising on flat asphalt
  sprintPower: 44, // ~110 km/h flat-out sprint equilibrium; ~95-100 within one stamina bar
  boostPower: 16, // extra power while a burst/pad boost is active
  peakAccel: 4.6, // m/s^2 cap at low speed (traction / gearing)
  sprintPeakAccel: 7.5,
  // gearing band: extra drive at low/mid speed (rider in low gears), fades out by bandSpeed
  bandAccel: 2.4,
  bandSpeed: 18.5, // quadratic taper: strong pull to ~50 km/h, gone by ~67 km/h
  drag: 0.0014, // aerodynamic v^2 coefficient
  draftDrag: 0.45, // fraction of drag removed when fully in a slipstream
  slingshot: 1.6, // m/s^2 released when pulling out of a long draft
  // nominal speeds used by AI / UI (the physics has no speed targets)
  cruiseSpeed: 16.7,
  sprintSpeed: 22.2,
  boostSpeed: 26,
  safetyMaxSpeed: 60, // numeric safety net only (216 km/h), never reached in play
  brakeDecel: 6.2, // ~0.63 g at full grip, upright; fades at very high speed
  latGrip: 9.2, // max lateral accel (m/s^2) -> limits corner speed
  maxYawRate: 2.3,
  steerRate: 5.5, // how fast steering input ramps
  // holding the turn into a corner taken too fast bleeds speed instead of running wide
  // (kept below brakeDecel: braking before the corner is still the quicker line)
  cornerScrub: 4.8,
  assistAlign: 0.55, // gentle auto-align toward road direction when not steering
  maxLean: 0.74, // rad (~42 deg)
  staminaMax: 100,
  sprintDrain: 10, // per second while holding sprint (~10 s full effort)
  boostCost: 32,
  boostDuration: 1.6,
  boostCooldown: 2.5,
  staminaRegen: 9,
  draftRegenBonus: 7,
  exhaustedThreshold: 18,
  draftMin: 1.4,
  draftMax: 10,
  draftLateral: 1.3,
  bikeLength: 1.75,
  bikeWidth: 0.85,
  resetCooldown: 2,
};

export const SURFACES = {
  asphalt: { id: 0, roll: 0.05, grip: 1.0, rough: 0.02, name: 'Asphalt' },
  cobble: { id: 1, roll: 0.15, grip: 0.9, rough: 0.35, name: 'Cobblestone' },
  gravel: { id: 2, roll: 0.22, grip: 0.8, rough: 0.22, name: 'Gravel' },
  grass: { id: 3, roll: 1.2, grip: 0.7, rough: 0.3, name: 'Grass' },
};
export const SURFACE_BY_ID = Object.values(SURFACES).sort((a, b) => a.id - b.id);

export const BIKES = [
  {
    id: 'allround',
    name: 'Strada Allround',
    desc: 'Balanced frame for every road.',
    power: 1.0,
    top: 1.0,
    climb: 1.0,
    handling: 1.0,
    stamina: 1.0,
  },
  {
    id: 'aero',
    name: 'Falco Aero',
    desc: 'Deep rims and slippery tubes. Fastest on the flats.',
    power: 0.98,
    top: 1.05,
    climb: 0.93,
    handling: 0.95,
    stamina: 1.0,
  },
  {
    id: 'climber',
    name: 'Stelvio Climber',
    desc: 'Featherweight. Flies uphill, nimble in hairpins.',
    power: 1.02,
    top: 0.97,
    climb: 1.12,
    handling: 1.07,
    stamina: 1.05,
  },
  {
    id: 'sprint',
    name: 'Tempesta Sprint',
    desc: 'Stiff and explosive. Brutal sprints, hungry legs.',
    power: 1.06,
    top: 1.02,
    climb: 0.96,
    handling: 0.98,
    stamina: 0.9,
  },
];
export const BIKE_BY_ID = Object.fromEntries(BIKES.map((b) => [b.id, b]));

export const COLORS = [
  '#e63946', '#f4a261', '#ffd23f', '#2a9d8f', '#3a86ff', '#8338ec', '#ff006e', '#f1faee',
  '#1d1d1f', '#06d6a0', '#ff7b00', '#4cc9f0',
];

export const OUTFITS = [
  { id: 'classic', name: 'Classic Team', jersey: 'solid' },
  { id: 'stripe', name: 'Chest Stripe', jersey: 'stripe' },
  { id: 'polka', name: 'King of the Mountains', jersey: 'polka' },
  { id: 'split', name: 'Two Tone', jersey: 'split' },
  { id: 'champion', name: 'Rainbow Bands', jersey: 'rainbow' },
];

export const AI_SKILLS = {
  easy: { power: 0.86, corner: 0.8, noise: 0.35, sprintiness: 0.3, reaction: 0.35, name: 'Rookie' },
  medium: { power: 0.93, corner: 0.88, noise: 0.22, sprintiness: 0.55, reaction: 0.22, name: 'Pro' },
  hard: { power: 0.985, corner: 0.95, noise: 0.12, sprintiness: 0.8, reaction: 0.12, name: 'Elite' },
  elite: { power: 1.015, corner: 0.99, noise: 0.06, sprintiness: 1.0, reaction: 0.06, name: 'Legend' },
};

export const NET = {
  port: 8080,
  tickRate: 30, // server simulation ticks per second
  snapshotRate: 20, // server -> client snapshots per second
  clientSendRate: 20, // client -> server state updates per second
  interpDelay: 0.12, // seconds remote players are rendered in the past
  maxPlayers: 8,
  minPlayersToStart: 1, // humans; bots fill the grid
  reconnectGrace: 30, // seconds a disconnected racer is kept
  countdown: 4.2, // seconds from start signal to GO
  finishTimeout: 60, // seconds after the winner before remaining racers are DNF
  roomIdleTimeout: 60 * 20,
};

export const RACE_MODES = {
  quick: { id: 'quick', name: 'Quick Race', laps: 1, ai: 5, skill: 'medium' },
  ai: { id: 'ai', name: 'AI Race', laps: 2, ai: 7, skill: 'hard' },
  timetrial: { id: 'timetrial', name: 'Time Trial', laps: 1, ai: 0, skill: 'medium' },
  multiplayer: { id: 'multiplayer', name: 'Multiplayer Race', laps: 2, ai: 0, skill: 'medium' },
};

export const AI_NAMES = [
  'Marco Veloce', 'Anna Berg', 'Luc Moreau', 'Kenji Arai', 'Sofia Rossi', 'Tom Kessler',
  'Iris Van Dijk', 'Rafa Ortega', 'Mia Lindqvist', 'Oskar Nowak', 'Zoe Laurent', 'Diego Paz',
  'Nora Fjell', 'Alex Kova', 'Pip Carter', 'Yuki Mori',
];

export const WEATHER = {
  clear: { name: 'Clear', grip: 1 },
  cloudy: { name: 'Cloudy', grip: 1 },
  fog: { name: 'Fog', grip: 0.97 },
  rain: { name: 'Rain', grip: 0.85 },
};
export const pickWeather = (w) => (w === 'random' || !WEATHER[w] ? Object.keys(WEATHER)[Math.floor(Math.random() * 4)] : w);

export const XP = {
  finishBase: 60,
  perPositionAhead: 25,
  win: 120,
  bestLap: 40,
  perLevel: (level) => 250 + level * 120,
};
