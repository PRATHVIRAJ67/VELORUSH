// Track definition + generation. Pure math so both client (rendering) and
// server (bots, validation, race progress) build the identical track.
//
// Bikes live in track space: s = distance along the centre line (metres),
// d = lateral offset (positive = right of travel direction). This keeps riders
// glued to the road, makes progress trivial to measure and shortcuts impossible.

import { clamp, lerp, wrapAngle } from './math.js';
import { SURFACES } from './constants.js';

export const FLAG = {
  TUNNEL: 1,
  BRIDGE: 2,
  VILLAGE: 4,
  FOREST: 8,
  LAKE: 16,
  CLIFF: 32,
  URBAN: 64,
  COAST: 128,
};

// Control points: [x, y(elevation), z]. Feature ranges refer to control point
// indices (fractional values allowed) so the layout can be tweaked freely.
export const MOUNTAIN_GP = {
  id: 'mountain',
  name: 'Mountain Grand Prix',
  seed: 4242,
  laps: 2,
  roadWidth: 11,
  shoulder: 2.6,
  points: [
    [0, 4, 0], // 0 start / finish line in the village
    [110, 4, 6],
    [205, 6, -22],
    [262, 11, -100],
    [255, 18, -185],
    [185, 25, -222], // climb west along the mountain face
    [70, 32, -214],
    [8, 36, -226],
    [-4, 38, -262], // hairpin 1
    [48, 42, -284],
    [160, 50, -294],
    [214, 54, -318],
    [210, 56, -352], // hairpin 2
    [150, 60, -372],
    [40, 64, -384], // tunnel through the rock spur
    [-70, 70, -392],
    [-165, 73, -372], // summit
    [-238, 64, -322],
    [-278, 50, -244], // fast descent (ramp)
    [-276, 37, -168],
    [-228, 29, -108], // bridge over the gorge
    [-162, 25, -64],
    [-172, 18, 8], // forest gravel sector
    [-236, 12, 72],
    [-232, 8, 150], // lakeside road
    [-160, 6, 196],
    [-70, 5, 182],
    [-42, 4.5, 110],
    [-80, 4, 48],
    [-70, 4, 8],
  ],
  surfaces: [
    { from: 27.6, to: 1.2, surface: 'cobble' },
    { from: 21.6, to: 23.4, surface: 'gravel' },
  ],
  zones: [
    { from: 27.5, to: 1.4, flag: FLAG.VILLAGE },
    { from: 14.15, to: 14.85, flag: FLAG.TUNNEL },
    { from: 19.55, to: 20.35, flag: FLAG.BRIDGE },
    { from: 21.3, to: 23.8, flag: FLAG.FOREST },
    { from: 23.8, to: 26.6, flag: FLAG.LAKE },
    { from: 16.3, to: 18.6, flag: FLAG.CLIFF },
  ],
  // Boost pads: s at control-point position, lateral centre d
  boosts: [
    { at: 2.3, d: -2.5 },
    { at: 10.2, d: 2.5 },
    { at: 17.4, d: 0 },
    { at: 21.1, d: -2.5 },
    { at: 25.3, d: 2.5 },
  ],
  ramps: [
    { at: 18.35, d: 2.6 },
    { at: 23.2, d: -2.6 },
  ],
  checkpoints: [4.0, 9.6, 14.9, 19.0, 23.0, 26.5],
  waterfall: { at: 20.0, side: -1, offset: 46 },
  lake: { center: [-140, 110], radius: [120, 70] },
};

const RAMP_LEN = 5.5;
const RAMP_W = 3.6;
const RAMP_H = 0.95;
const BOOST_LEN = 7;
const BOOST_W = 3.4;

function catmullRom(p0, p1, p2, p3, t) {
  // centripetal-ish uniform Catmull-Rom (points are well spaced)
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export function buildTrack(def = MOUNTAIN_GP) {
  const pts = def.points;
  const n = pts.length;
  const SUB = 400;
  // Dense sample of the closed spline
  const dense = [];
  const cpDenseIndex = [];
  for (let i = 0; i < n; i++) {
    cpDenseIndex.push(dense.length);
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let k = 0; k < SUB; k++) {
      const t = k / SUB;
      dense.push([
        catmullRom(p0[0], p1[0], p2[0], p3[0], t),
        catmullRom(p0[1], p1[1], p2[1], p3[1], t),
        catmullRom(p0[2], p1[2], p2[2], p3[2], t),
      ]);
    }
  }
  // Arc length (horizontal distance drives progress)
  const cum = new Float64Array(dense.length + 1);
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum[i] = cum[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  const length = cum[dense.length];
  const cpS = cpDenseIndex.map((i) => cum[i]);
  cpS.push(length);

  // Uniform resample, 1 sample per metre
  const step = 1;
  const count = Math.floor(length / step);
  const ds = length / count;
  const X = new Float32Array(count);
  const Y = new Float32Array(count);
  const Z = new Float32Array(count);
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    while (j < dense.length - 1 && cum[j + 1] < s) j++;
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    const t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    X[i] = lerp(a[0], b[0], t);
    Y[i] = lerp(a[1], b[1], t);
    Z[i] = lerp(a[2], b[2], t);
  }
  // Smooth elevation to avoid kinks
  for (let pass = 0; pass < 6; pass++) {
    const copy = Y.slice();
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let k = -6; k <= 6; k++) sum += copy[(i + k + count) % count];
      Y[i] = sum / 13;
    }
  }

  const HX = new Float32Array(count);
  const HZ = new Float32Array(count);
  const HEAD = new Float32Array(count);
  const CURV = new Float32Array(count);
  const SLOPE = new Float32Array(count);
  const SURF = new Uint8Array(count);
  const FLAGS = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const a = (i - 2 + count) % count;
    const b = (i + 2) % count;
    const dx = X[b] - X[a];
    const dz = Z[b] - Z[a];
    const l = Math.hypot(dx, dz) || 1;
    HX[i] = dx / l;
    HZ[i] = dz / l;
    HEAD[i] = Math.atan2(HX[i], HZ[i]);
    SLOPE[i] = (Y[b] - Y[a]) / (4 * ds);
  }
  for (let i = 0; i < count; i++) {
    const a = (i - 3 + count) % count;
    const b = (i + 3) % count;
    CURV[i] = wrapAngle(HEAD[b] - HEAD[a]) / (6 * ds);
  }
  // Smooth curvature a little (used by AI + signs)
  {
    const copy = CURV.slice();
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let k = -4; k <= 4; k++) sum += copy[(i + k + count) % count];
      CURV[i] = sum / 9;
    }
  }

  const cpToS = (c) => {
    const i = Math.floor(c);
    const f = c - i;
    const a = cpS[((i % n) + n) % n];
    let b = cpS[(((i % n) + n) % n) + 1];
    return lerp(a, b, f) % length;
  };

  const inRange = (s, from, to) => (from <= to ? s >= from && s <= to : s >= from || s <= to);

  for (const r of def.surfaces) {
    const from = cpToS(r.from);
    const to = cpToS(r.to);
    const sid = SURFACES[r.surface].id;
    for (let i = 0; i < count; i++) if (inRange(i * ds, from, to)) SURF[i] = sid;
  }
  const zones = def.zones.map((z) => ({ ...z, s0: cpToS(z.from), s1: cpToS(z.to) }));
  for (const z of zones) {
    for (let i = 0; i < count; i++) if (inRange(i * ds, z.s0, z.s1)) FLAGS[i] |= z.flag;
  }

  const boosts = def.boosts.map((b) => ({ s: cpToS(b.at), d: b.d, len: BOOST_LEN, w: BOOST_W }));
  const ramps = def.ramps.map((r) => ({ s: cpToS(r.at), d: r.d, len: RAMP_LEN, w: RAMP_W, h: RAMP_H }));
  const checkpoints = def.checkpoints.map((c) => cpToS(c)).sort((a, b) => a - b);

  // Racing line: drift toward the inside of upcoming corners
  const RLINE = new Float32Array(count);
  const half = def.roadWidth / 2;
  for (let i = 0; i < count; i++) {
    let k = 0;
    for (let a = -10; a <= 25; a++) k += CURV[(i + a + count) % count];
    k /= 36;
    RLINE[i] = clamp(-k * 90, -1, 1) * (half - 1.4);
  }
  {
    const copy = RLINE.slice();
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let k = -12; k <= 12; k++) sum += copy[(i + k + count) % count];
      RLINE[i] = sum / 25;
    }
  }

  const track = {
    def,
    id: def.id,
    name: def.name,
    length,
    count,
    ds,
    halfWidth: half,
    shoulder: def.shoulder,
    limit: half + def.shoulder - 0.45, // barrier position (rider centre)
    X, Y, Z, HX, HZ, HEAD, CURV, SLOPE, SURF, FLAGS, RLINE,
    cpS,
    cpToS,
    zones,
    boosts,
    ramps,
    checkpoints,
    inRange,
    /** wrap s into [0, length) */
    wrap(s) {
      s %= length;
      return s < 0 ? s + length : s;
    },
    idx(s) {
      const w = this.wrap(s) / ds;
      return Math.floor(w) % count;
    },
    /** Interpolated centre-line sample. Writes into out {x,y,z,hx,hz,head,curv,slope,surf,flags} */
    sample(s, out = {}) {
      const w = this.wrap(s) / ds;
      const i = Math.floor(w) % count;
      const i2 = (i + 1) % count;
      const t = w - Math.floor(w);
      out.x = lerp(X[i], X[i2], t);
      out.y = lerp(Y[i], Y[i2], t);
      out.z = lerp(Z[i], Z[i2], t);
      const hx = lerp(HX[i], HX[i2], t);
      const hz = lerp(HZ[i], HZ[i2], t);
      const l = Math.hypot(hx, hz) || 1;
      out.hx = hx / l;
      out.hz = hz / l;
      out.head = Math.atan2(out.hx, out.hz);
      out.curv = lerp(CURV[i], CURV[i2], t);
      out.slope = lerp(SLOPE[i], SLOPE[i2], t);
      out.surf = SURF[i];
      out.flags = FLAGS[i];
      out.rline = lerp(RLINE[i], RLINE[i2], t);
      return out;
    },
    /** World position of track-space coordinate (s, d). */
    toWorld(s, d, out = {}) {
      const c = this.sample(s, _tmp);
      out.x = c.x - c.hz * d;
      out.z = c.z + c.hx * d;
      out.y = c.y;
      out.head = c.head;
      return out;
    },
    /** Extra ground height from ramps at (s,d). */
    rampHeight(s, d) {
      const sw = this.wrap(s);
      for (const r of ramps) {
        let rel = sw - r.s;
        if (rel < -length / 2) rel += length;
        if (rel >= 0 && rel <= r.len && Math.abs(d - r.d) <= r.w / 2) return (rel / r.len) * r.h;
      }
      return 0;
    },
    boostAt(s, d) {
      const sw = this.wrap(s);
      for (const b of boosts) {
        let rel = sw - b.s;
        if (rel < -length / 2) rel += length;
        if (rel >= 0 && rel <= b.len && Math.abs(d - b.d) <= b.w / 2) return true;
      }
      return false;
    },
    /** Find nearest s to a world xz point (brute force, used rarely). */
    nearestS(x, z) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < count; i += 2) {
        const dd = (X[i] - x) ** 2 + (Z[i] - z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      }
      return best * ds;
    },
  };
  const _tmp = {};
  return track;
}
