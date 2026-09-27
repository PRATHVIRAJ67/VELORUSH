// Track registry. Every map is pure data (control points, zones, environment
// parameters) so all clients and the server build identical geometry from a
// short map id — geometry never travels over the network.

import { buildTrack, MOUNTAIN_GP, FLAG } from './track.js';

/**
 * Engineered gradients: assign each control point's elevation by linear
 * interpolation of keyframes [pointIndex, y] along horizontal arc length.
 */
function profile(points, keys) {
  const n = points.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) {
    const a = points[i - 1];
    const b = points[i % n];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  const L = cum[n];
  const at = (i) => cum[i];
  for (let k = 0; k < keys.length; k++) {
    const [i0, y0] = keys[k];
    const [i1, y1] = keys[(k + 1) % keys.length];
    const s0 = at(i0);
    let s1 = at(i1);
    if (k === keys.length - 1) s1 = L + at(i1);
    for (let i = i0; i !== (k === keys.length - 1 ? n + i1 : i1); i++) {
      const si = i < n ? at(i) : L + at(i - n);
      const t = (si - s0) / Math.max(1e-6, s1 - s0);
      points[i % n][1] = y0 + (y1 - y0) * t;
    }
  }
  return points;
}

// ------------------------------------------------------------------ ALPINE
const ALPINE_GT = {
  id: 'alpine',
  name: 'Alpine Grand Tour',
  seed: 9171,
  laps: 1,
  roadWidth: 10.5,
  shoulder: 2.4,
  meta: { location: 'High Alps · Switzerland', style: 'Climbing + long descent', difficulty: 4, theme: 'alpine' },
  points: [
    [0, 10, 0], // 0 start: stone village
    [150, 12, 10],
    [280, 20, -30],
    [350, 32, -120],
    [300, 42, -195], // switchbacks up the face
    [170, 52, -205],
    [100, 58, -235],
    [120, 64, -290],
    [270, 76, -295],
    [335, 82, -330],
    [305, 90, -385],
    [160, 102, -390],
    [95, 108, -420],
    [125, 116, -475],
    [270, 128, -485],
    [345, 136, -530],
    [305, 145, -600], // summit
    [180, 142, -625],
    [40, 128, -605], // long descent
    [-80, 110, -565], // tunnel
    [-190, 94, -505],
    [-265, 80, -420],
    [-305, 64, -320], // gorge bridge + waterfall
    [-295, 50, -215],
    [-245, 38, -135],
    [-180, 26, -60],
    [-100, 15, -10],
  ],
  surfaces: [{ from: 25.8, to: 0.7, surface: 'cobble' }],
  zones: [
    { from: 25.6, to: 1.0, flag: FLAG.VILLAGE },
    { from: 18.55, to: 19.6, flag: FLAG.TUNNEL },
    { from: 21.75, to: 22.3, flag: FLAG.BRIDGE },
    { from: 3.4, to: 15.5, flag: FLAG.CLIFF },
    { from: 23.3, to: 25.2, flag: FLAG.FOREST },
  ],
  boosts: [{ at: 1.4, d: 2.5 }, { at: 8.4, d: -2.5 }, { at: 17.3, d: 0 }, { at: 24.1, d: -2.5 }],
  ramps: [{ at: 20.4, d: 2.4 }],
  checkpoints: [3.5, 8.0, 12.6, 16.5, 20.5, 24.0],
  env: {
    theme: 'alpine',
    gorge: { depth: 30, upper: 16, waterfallAlong: -70 },
    peaks: 'auto',
    peakHeight: [700, 1300],
  },
};

// ------------------------------------------------------------------ COAST
const COAST = {
  id: 'coast',
  name: 'Riviera Coast',
  seed: 5230,
  laps: 1,
  roadWidth: 10,
  shoulder: 2.2,
  meta: { location: 'Mediterranean · Liguria', style: 'Flowing high-speed corners', difficulty: 3, theme: 'coast' },
  points: [
    [0, 62, 150], // 0 start: cliff-top village
    [110, 60, 178],
    [205, 56, 150], // cove
    [300, 52, 186], // headland
    [395, 50, 164],
    [455, 54, 96], // tunnel through the cape
    [478, 60, 10],
    [446, 72, -72],
    [360, 86, -124],
    [245, 98, -146],
    [118, 106, -170], // olive-grove ridge
    [-20, 104, -152],
    [-150, 96, -174],
    [-255, 88, -150],
    [-238, 80, -80], // switchback descent to the sea
    [-320, 72, -50],
    [-350, 64, 40],
    [-308, 54, 150], // cove bridge
    [-196, 48, 192],
    [-98, 54, 170],
  ],
  surfaces: [{ from: 19.4, to: 0.6, surface: 'cobble' }],
  zones: [
    { from: 19.3, to: 0.8, flag: FLAG.VILLAGE },
    { from: 3.6, to: 4.5, flag: FLAG.TUNNEL },
    { from: 17.2, to: 17.75, flag: FLAG.BRIDGE },
    { from: 0.8, to: 3.6, flag: FLAG.COAST },
    { from: 4.5, to: 6.0, flag: FLAG.COAST },
    { from: 16.0, to: 19.3, flag: FLAG.COAST },
  ],
  boosts: [{ at: 1.5, d: -2.4 }, { at: 10.0, d: 2.4 }, { at: 16.3, d: 0 }],
  ramps: [],
  checkpoints: [2.6, 5.6, 8.6, 11.6, 14.6, 17.9],
  env: {
    theme: 'coast',
    sea: { level: 0, nx: 0, nz: 1, d: 232, wobble: 34 },
    gorge: { depth: 60, upper: 60, waterfallAlong: -1e9, toSea: true },
    peaks: 'auto',
    peakHeight: [260, 520],
    peakSide: 'north',
    lighthouse: { at: 3.0, side: 1, offset: 34 },
  },
};

// ------------------------------------------------------------------ FOREST
const FOREST = {
  id: 'forest',
  name: 'Black Forest Storm',
  seed: 7703,
  laps: 2,
  roadWidth: 8,
  shoulder: 1.8,
  meta: { location: 'Schwarzwald · Germany', style: 'Technical braking + precision', difficulty: 5, theme: 'forest' },
  points: [
    [0, 40, 0], // 0 start: forest clearing
    [90, 42, -8],
    [160, 48, -58],
    [172, 56, -140],
    [122, 64, -198],
    [42, 70, -210],
    [-22, 76, -258],
    [8, 84, -330],
    [110, 92, -342],
    [205, 95, -302], // crest
    [272, 88, -230], // fast downhill
    [300, 74, -130],
    [282, 62, -40],
    [322, 52, 40],
    [262, 44, 112], // wooden bridge over the stream
    [160, 38, 122],
    [60, 34, 142],
    [-40, 32, 102],
    [-100, 34, 42],
    [-72, 38, -6],
  ],
  surfaces: [{ from: 16.4, to: 17.6, surface: 'gravel' }],
  zones: [
    { from: 19.2, to: 0.6, flag: FLAG.VILLAGE },
    { from: 13.65, to: 14.15, flag: FLAG.BRIDGE },
    { from: 0.6, to: 19.2, flag: FLAG.FOREST },
  ],
  boosts: [{ at: 1.2, d: 1.8 }, { at: 10.4, d: 0 }, { at: 15.5, d: -1.8 }],
  ramps: [{ at: 11.4, d: -1.8 }],
  checkpoints: [3.0, 6.4, 9.2, 12.0, 15.0, 17.6],
  env: {
    theme: 'forest',
    gorge: { depth: 9, upper: 9, waterfallAlong: -1e9, stream: true },
    peaks: 'auto',
    peakHeight: [220, 420],
    weather: 'rain',
  },
};

// ------------------------------------------------------------------ CANYON
const CANYON = {
  id: 'canyon',
  name: 'Grand Canyon Rim',
  seed: 3319,
  laps: 1,
  roadWidth: 11,
  shoulder: 2.8,
  meta: { location: 'Arizona · Colorado Plateau', style: 'Long straights · drafting · momentum', difficulty: 2, theme: 'canyon' },
  points: [
    [0, 150, 0], // 0 start on the rim
    [260, 152, 0],
    [520, 150, -20],
    [680, 146, -100],
    [735, 140, -240],
    [680, 128, -360], // down the canyon wall
    [545, 112, -392],
    [478, 100, -440],
    [545, 90, -490],
    [660, 80, -505],
    [705, 72, -555],
    [620, 64, -600],
    [420, 62, -600], // canyon floor, dry riverbed
    [210, 62, -595],
    [40, 68, -572],
    [-120, 84, -505], // technical climb
    [-205, 102, -415],
    [-172, 118, -325],
    [-262, 132, -262],
    [-282, 144, -160],
    [-205, 150, -62],
    [-105, 150, -12],
  ],
  surfaces: [],
  zones: [
    { from: 21.3, to: 0.5, flag: FLAG.VILLAGE },
    { from: 1.35, to: 1.8, flag: FLAG.BRIDGE },
    { from: 4.6, to: 11.4, flag: FLAG.CLIFF },
  ],
  boosts: [{ at: 0.9, d: -2.5 }, { at: 12.5, d: 2.5 }, { at: 13.5, d: -2.5 }, { at: 20.4, d: 0 }],
  ramps: [{ at: 13.0, d: 2.6 }],
  checkpoints: [2.6, 5.6, 9.6, 13.2, 16.4, 19.3],
  env: {
    theme: 'canyon',
    gorge: { depth: 70, upper: 70, waterfallAlong: -1e9, dry: true },
    peaks: 'auto',
    peakHeight: [120, 220],
    mesas: true,
  },
};

// ------------------------------------------------------------------ CITY
const CITY = {
  id: 'city',
  name: 'City Night Criterium',
  seed: 6602,
  laps: 2,
  roadWidth: 12,
  shoulder: 1.2,
  meta: { location: 'Night city · riverside downtown', style: 'Technical urban · acceleration', difficulty: 3, theme: 'city' },
  points: [
    [0, 10, 0], // 0 start: boulevard
    [200, 10, 0],
    [360, 10, 2],
    [432, 10, -38], // 90° corner
    [446, 10, -160],
    [422, 11, -224],
    [320, 12, -236],
    [238, 12, -238],
    [196, 12, -286],
    [190, 12, -380],
    [166, 12, -448], // hairpin around the plaza
    [104, 12, -468],
    [62, 13, -420],
    [58, 16, -320],
    [42, 24, -208], // elevated bridge over the river
    [18, 24, -128],
    [-62, 17, -118],
    [-176, 7, -130], // underpass
    [-276, 7, -92],
    [-300, 8, 14],
    [-160, 9, 6],
  ],
  surfaces: [],
  zones: [
    { from: 0, to: 20.99, flag: FLAG.URBAN },
    { from: 13.7, to: 14.75, flag: FLAG.BRIDGE },
    { from: 16.55, to: 17.45, flag: FLAG.TUNNEL },
  ],
  boosts: [{ at: 1.2, d: -3 }, { at: 9.2, d: 0 }, { at: 19.6, d: 3 }],
  ramps: [],
  checkpoints: [2.6, 6.2, 9.8, 13.2, 16.4, 19.0],
  env: {
    theme: 'city',
    gorge: { depth: 12, upper: 12, waterfallAlong: -1e9, river: true },
    peaks: 'auto',
    peakHeight: [140, 320],
    night: true,
  },
};

profile(ALPINE_GT.points, [[0, 10], [2, 16], [3, 24], [15, 136], [16, 145], [17, 142], [26, 15]]);
profile(COAST.points, [[0, 62], [4, 50], [6, 58], [10, 106], [12, 98], [17, 50], [18, 48], [19, 54]]);
profile(FOREST.points, [[0, 40], [2, 46], [9, 95], [10, 90], [13, 52], [15, 38], [17, 32], [19, 38]]);
profile(CANYON.points, [[0, 150], [3, 147], [4, 142], [12, 62], [13, 62], [14, 68], [19, 146], [20, 150]]);
profile(CITY.points, [[0, 10], [12, 13], [13, 18], [14, 25], [15, 25], [16, 16], [17, 6], [18, 6], [19, 8]]);

MOUNTAIN_GP.meta = { location: 'Alpine valley · original course', style: 'All-rounder: climbs, jumps, gravel', difficulty: 3, theme: 'mountain' };
MOUNTAIN_GP.env = {
  theme: 'mountain',
  lake: { x: -140, z: 118, rx: 62, rz: 40, level: 2.2 },
  gorge: { depth: 24, upper: 11, waterfallAlong: -78 },
  peaks: [
    [60, -1250, 720, 520],
    [-1150, -700, 640, 480],
    [-900, -1500, 820, 600],
    [1250, -450, 600, 460],
    [1000, -1300, 760, 520],
    [900, 800, 520, 420],
    [-1250, 600, 560, 480],
    [-200, 1300, 480, 420],
    [1700, 300, 700, 600],
    [-1800, -200, 700, 600],
  ],
};

export const TRACK_DEFS = [MOUNTAIN_GP, ALPINE_GT, COAST, FOREST, CANYON, CITY];
export const TRACK_BY_ID = Object.fromEntries(TRACK_DEFS.map((d) => [d.id, d]));
export const TRACK_IDS = TRACK_DEFS.map((d) => d.id);

const cache = new Map();
/** Build (once) and return the track for a map id. Unknown ids fall back to the original course. */
export function getTrack(id = 'mountain') {
  const def = TRACK_BY_ID[id] || MOUNTAIN_GP;
  if (!cache.has(def.id)) cache.set(def.id, buildTrack(def));
  return cache.get(def.id);
}
