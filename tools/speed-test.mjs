// Physics speed report: controlled equilibrium/acceleration/braking tests + a per-section
// speed profile of a solo elite lap. Usage: node tools/speed-test.mjs
import { FLAG } from '../shared/track.js';
import { getTrack } from '../shared/tracks.js';
import { createBike, stepBike, makeStats, emptyInput } from '../shared/physics.js';
import { AIBrain } from '../shared/ai.js';
import { PHYSICS } from '../shared/constants.js';

const track = getTrack();
const kmh = (v) => (v * 3.6).toFixed(1);
const dt = PHYSICS.dt;

// A fake straight track with a constant slope for controlled tests.
function straight(slope) {
  const L = 100000;
  return {
    length: L,
    halfWidth: 5.5,
    limit: 7.6,
    wrap: (s) => ((s % L) + L) % L,
    sample: (s, o = {}) => Object.assign(o, { x: 0, y: -slope * s, z: s, hx: 0, hz: 1, head: 0, curv: 0, slope: -0, surf: 0, flags: 0, rline: 0, ...{ slope } }),
    rampHeight: () => 0,
    boostAt: () => false,
  };
}
function run(slope, input, seconds, v0 = 0, stop = null) {
  const t = straight(slope);
  const b = createBike(t, 0, 0);
  b.v = v0;
  b.y = 0;
  const stats = makeStats('allround');
  let time = 0;
  const marks = {};
  let dist = 0;
  while (time < seconds) {
    const u0 = b.u;
    // keep stamina topped so sprint equilibria are measurable
    if (input.infinite) b.stamina = 100;
    stepBike(b, input, dt, t, stats);
    b.y = t.sample(b.u).y;
    dist += b.u - u0;
    time += dt;
    for (const k of [40, 60, 80, 100, 110, 120]) if (!marks[k] && b.v * 3.6 >= k) marks[k] = time.toFixed(1) + 's';
    if (stop && stop(b)) break;
  }
  return { v: b.v, time, dist, marks };
}

const pedal = { ...emptyInput(), throttle: 1 };
const sprint = { ...pedal, sprint: true, infinite: true };
const coast = emptyInput();
console.log('--- equilibrium speeds (allround bike) ---');
console.log('flat pedalling        ', kmh(run(0, pedal, 60).v), 'km/h');
console.log('flat full sprint      ', kmh(run(0, sprint, 60).v), 'km/h');
console.log('uphill 6% pedalling   ', kmh(run(0.06, pedal, 60).v), 'km/h');
console.log('uphill 9% pedalling   ', kmh(run(0.09, pedal, 60).v), 'km/h');
console.log('downhill 5% pedalling ', kmh(run(-0.05, pedal, 90).v), 'km/h');
console.log('downhill 8% coasting  ', kmh(run(-0.08, coast, 90, 15).v), 'km/h');
console.log('downhill 8% pedalling ', kmh(run(-0.08, pedal, 90).v), 'km/h');
console.log('downhill 12% pedalling', kmh(run(-0.12, pedal, 90).v), 'km/h');
console.log('downhill 15% pedalling', kmh(run(-0.15, pedal, 90).v), 'km/h');
console.log('--- acceleration times ---');
console.log('flat pedal from 0     ', JSON.stringify(run(0, pedal, 40).marks));
console.log('flat sprint from 0    ', JSON.stringify(run(0, sprint, 40).marks));
console.log('downhill 10% from 40  ', JSON.stringify(run(-0.1, pedal, 60, 40 / 3.6).marks));
console.log('--- braking distances (flat, upright) ---');
for (const v0 of [60, 80, 100, 120]) {
  const r = run(0, { ...emptyInput(), brake: 1 }, 30, v0 / 3.6, (b) => b.v * 3.6 <= 30);
  console.log(`${v0} -> 30 km/h: ${r.dist.toFixed(0)} m in ${r.time.toFixed(1)} s`);
}

console.log('--- solo elite lap, speed per section ---');
const b = createBike(track, -5, 0);
const stats = makeStats('allround', 1.015);
const brain = new AIBrain('elite', 5);
const sections = new Map();
const nameOf = (s) => {
  const f = track.FLAGS[track.idx(s)];
  if (f & FLAG.VILLAGE) return 'village';
  if (f & FLAG.TUNNEL) return 'tunnel';
  if (f & FLAG.BRIDGE) return 'bridge';
  if (f & FLAG.FOREST) return 'forest gravel';
  if (f & FLAG.LAKE) return 'lakeside';
  if (f & FLAG.CLIFF) return 'descent (cliffs)';
  const sl = track.sample(s).slope;
  return sl > 0.03 ? 'climbs' : sl < -0.03 ? 'descents' : 'rolling';
};
let t = 0;
let maxV = 0;
while (b.u < track.length && t < 400) {
  const inp = brain.update(b, [], track, dt, { stats, progress: b.u / track.length, lap: 0, laps: 1 });
  stepBike(b, inp, dt, track, stats);
  t += dt;
  maxV = Math.max(maxV, b.v);
  const n = nameOf(b.s);
  const e = sections.get(n) || { sum: 0, n: 0, max: 0 };
  e.sum += b.v;
  e.n++;
  e.max = Math.max(e.max, b.v);
  sections.set(n, e);
  if (!Number.isFinite(b.v) || !Number.isFinite(b.u)) throw new Error('NaN in physics');
}
for (const [n, e] of sections) console.log(n.padEnd(17), 'avg', kmh(e.sum / e.n).padStart(6), 'max', kmh(e.max).padStart(6), 'km/h');
console.log(`lap ${t.toFixed(1)} s, avg ${kmh(track.length / t)} km/h, max ${kmh(maxV)} km/h`);

if (process.argv[2] === 'profile') {
  console.log('--- descent profile (s, slope, corner-limit, elite speed) ---');
  const b2 = createBike(track, 1200, 0);
  b2.v = 15;
  const br = new AIBrain('elite', 9);
  let next = 1225;
  while (b2.u < 1800) {
    const inp = br.update(b2, [], track, dt, { stats, progress: 0.5, lap: 0, laps: 1 });
    stepBike(b2, inp, dt, track, stats);
    if (b2.u >= next) {
      next += 25;
      const c = track.sample(b2.s);
      const lim = Math.sqrt(PHYSICS.latGrip / (Math.abs(c.curv) + 1e-4));
      console.log(`s=${b2.u.toFixed(0)} slope ${(c.slope * 100).toFixed(1)}% corner-limit ${kmh(Math.min(lim, 60))} v ${kmh(b2.v)} brake ${inp.brake.toFixed(2)}`);
    }
  }
}
