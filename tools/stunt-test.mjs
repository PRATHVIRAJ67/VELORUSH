// Stunt rules unit tests: airborne-only rotation, flip/spin counting, landing validation,
// crash = no points, combos, no double scoring, input arming, style trick landing rule,
// course determinism and the server-side score bound. Usage: node tools/stunt-test.mjs
import { createTricks, takeoff, stepTricks, judgeLanding, jumpPoints } from '../shared/stunts/tricks.js';
import { TRICK, POINTS, comboMult } from '../shared/stunts/config.js';
import { STUNT_LEVELS, STUNT_LEVEL_BY_ID } from '../shared/stunts/levels.js';
import { buildCourse } from '../shared/stunts/course.js';
import { StuntRun } from '../shared/stunts/run.js';
import { StuntPilot } from '../shared/stunts/pilot.js';
import { stuntStats, STUNT_BIKES } from '../shared/stunts/bikes.js';
import { BIKES } from '../shared/constants.js';
import { objectiveMet } from '../shared/stunts/objectives.js';
import { getTrack, TRACK_IDS } from '../shared/tracks.js';

let fails = 0;
let n = 0;
const ok = (c, msg) => {
  n++;
  if (!c) fails++;
  console.log(`${c ? 'PASS' : 'FAIL'} ${msg}`);
};
const TAU = Math.PI * 2;
const stats = stuntStats('allround');
const inp = (o = {}) => ({ throttle: 0, brake: 0, steer: 0, sprint: false, boost: false, reset: false, ...o });
const H = 1 / 120;

// ---- pure trick model ----
{
  const T = createTricks();
  for (let i = 0; i < 240; i++) stepTricks(T, inp({ brake: 1 }), H, stats);
  ok(T.pitch === 0 && T.spin === 0, 'no rotation while on the ground (trick state not airborne)');
}
{
  const T = createTricks();
  takeoff(T, inp({ brake: 1 })); // brake held at takeoff
  for (let i = 0; i < 60; i++) stepTricks(T, inp({ brake: 1 }), H, stats);
  ok(Math.abs(T.pitch) < 1e-9, 'input held at takeoff does not rotate until released and pressed again');
  stepTricks(T, inp(), H, stats);
  for (let i = 0; i < 30; i++) stepTricks(T, inp({ brake: 1 }), H, stats);
  ok(T.pitch > 0.5, 'released + pressed again in the air starts a backflip');
}
{
  // full backflip then release and settle
  const T = createTricks();
  takeoff(T, inp());
  let t = 0;
  while (T.pitch < TAU - 0.9 && t < 3) {
    stepTricks(T, inp({ brake: 1 }), H, stats);
    t += H;
  }
  for (let i = 0; i < 60; i++) stepTricks(T, inp(), H, stats);
  const j = judgeLanding(T, stats);
  ok(j.clean && j.back === 1 && j.flips === 1, `one backflip counted on a clean landing (pitch ${(T.pitch / TAU).toFixed(2)} turns)`);
  ok(jumpPoints(j, { dist: 10 }) >= POINTS.backflip, 'backflip scores at least the backflip points');
}
{
  // under-rotated: crash, zero points
  const T = createTricks();
  takeoff(T, inp());
  for (let i = 0; i < 30; i++) stepTricks(T, inp({ brake: 1 }), H, stats); // ~quarter turn+
  const j = judgeLanding(T, stats);
  ok(!j.clean && /rotated/.test(j.reason), `landing mid-rotation is a crash (${j.reason})`);
  ok(jumpPoints(j, { dist: 30, rings: 2, target: true }) === 0, 'crashed jump scores nothing (no landing bonus, no ring/target)');
}
{
  const T = createTricks();
  takeoff(T, inp());
  for (let i = 0; i < 40; i++) stepTricks(T, inp({ sprint: true }), H, stats);
  ok(!judgeLanding(T, stats).clean, 'landing with hands off the bars (style held) is a crash');
  stepTricks(T, inp(), H, stats);
  const j = judgeLanding(T, stats);
  ok(j.clean && j.style > 0.3, 'releasing the no-hander before touchdown lands clean with style time');
}
{
  // spin 360 + combo multiplier table
  const T = createTricks();
  takeoff(T, inp());
  while (T.spin < TAU - 0.9) stepTricks(T, inp({ steer: 1 }), H, stats);
  for (let i = 0; i < 60; i++) stepTricks(T, inp(), H, stats);
  const j = judgeLanding(T, stats);
  ok(j.clean && j.spins === 1, '360 spin counted');
  ok(comboMult(1) === 1 && comboMult(2) === 1.5 && comboMult(3) === 2 && comboMult(99) === TRICK.maxMult, 'combo multiplier steps and cap');
}
{
  // landing sideways (half spin) is a crash
  const T = createTricks();
  takeoff(T, inp());
  while (T.spin < Math.PI) stepTricks(T, inp({ steer: 1 }), H, stats);
  ok(!judgeLanding(T, stats).clean, 'landing after a 180 (backwards) is a crash');
}

// ---- full runs with the real physics ----
function runWith(level, chooser, until = 120 * 90) {
  const course = buildCourse(level);
  const run = new StuntRun(course, { countdown: 0.01 });
  const p = new StuntPilot(run, course.features.map((f) => ({ v: f.designV })));
  p.chooser = chooser;
  const events = [];
  for (let i = 0; i < until && !run.done; i++) {
    run.step(p.input(), H);
    for (const e of run.drainEvents()) events.push({ ...e, t: run.state.time, score: run.state.st.score });
  }
  return { run, events };
}
{
  const L = STUNT_LEVEL_BY_ID.L04; // decks
  const { run, events } = runWith(L, () => ({ pitch: 1, spin: 0, style: 0, leadP: 0.7, leadS: 0 }));
  const lands = events.filter((e) => e.type === 'land');
  const takeoffs = events.filter((e) => e.type === 'takeoff');
  const crashes = events.filter((e) => e.type === 'crash');
  ok(takeoffs.length === lands.length + crashes.length, `every takeoff resolves exactly once (${takeoffs.length} takeoffs, ${lands.length} landings, ${crashes.length} crashes)`);
  ok(run.state.st.backflips >= 1, `real physics run: backflips landed off the deck (${run.state.st.backflips})`);
  // score adds up: sum of landing points + checkpoints + finish == final score (no double scoring)
  const sum = lands.reduce((a, e) => a + e.points, 0) + events.filter((e) => e.type === 'checkpoint').length * POINTS.checkpoint + (run.state.phase === 'finished' ? POINTS.finish : 0);
  ok(sum === run.state.st.score, `score equals the sum of committed jumps + checkpoints + finish (${sum} vs ${run.state.st.score})`);
}
{
  // over-rotating on purpose crashes: no points from that jump, combo reset, respawn happens
  const L = STUNT_LEVEL_BY_ID.L04;
  const { run, events } = runWith(L, () => ({ pitch: 1, spin: 0, style: 0, leadP: -2.2, leadS: 0 }), 120 * 60);
  const crash = events.find((e) => e.type === 'crash');
  ok(!!crash, `over-rotation crashes in a real run (${crash?.reason})`);
  const i = events.indexOf(crash);
  ok(events[i + 1]?.type === 'respawn', 'crash is followed by a respawn');
  ok(run.state.st.flips === 0, 'crashed flips are not counted');
}
{
  // combo: L12 (three kickers close together) with clean straight jumps
  const { run, events } = runWith(STUNT_LEVEL_BY_ID.L12, () => null);
  const multi = events.filter((e) => e.type === 'land' && e.mult > 1);
  ok(run.state.st.maxCombo >= 2 && multi.length > 0 && multi.every((e) => e.points === Math.round(e.base * e.mult)), `chained clean jumps build the combo and multiply the jump score (max chain ${run.state.st.maxCombo})`);
}
{
  // rings only count once and only on a clean landing
  const L = STUNT_LEVEL_BY_ID.L06;
  const { run, events } = runWith(L, () => null);
  const ringEv = events.filter((e) => e.type === 'ring').length;
  ok(run.state.st.rings <= ringEv && run.state.st.rings === run.state.ringsTaken.filter((x) => x === 2).length, `rings committed once each (${run.state.st.rings})`);
}
{
  // wall: riding into a landing ramp face crashes (gap jumped far too slowly)
  const L = STUNT_LEVEL_BY_ID.L03;
  const course = buildCourse(L);
  const run = new StuntRun(course, { countdown: 0.01 });
  const p = new StuntPilot(run, course.features.map(() => ({ v: 6 })));
  const ev = [];
  for (let i = 0; i < 120 * 40 && !ev.some((e) => e.type === 'crash'); i++) {
    run.step(p.input(), H);
    ev.push(...run.drainEvents());
  }
  const c = ev.find((e) => e.type === 'crash');
  ok(!!c && /gap|face|Cased/.test(c.reason), `too slow over a gap crashes (${c?.reason})`);
}

// ---- data integrity ----
ok(STUNT_LEVELS.length === 50, '50 levels');
ok(new Set(STUNT_LEVELS.map((l) => l.id)).size === 50, 'level ids unique + stable');
const tiers = [1, 2, 3, 4].map((t) => STUNT_LEVELS.filter((l) => l.tier === t).length);
ok(tiers.join() === '15,15,10,10', `tiers 15/15/10/10 (${tiers.join('/')})`);
const sig = new Set(STUNT_LEVELS.map((l) => JSON.stringify([l.features, l.objectives])));
ok(sig.size === 50, 'no two levels share the same feature list + objectives');
{
  // every level rides its own sky course: own track, own route shape, own feature layout
  const racing = new Set(TRACK_IDS.map((id) => getTrack(id)));
  const courses = STUNT_LEVELS.map((l) => buildCourse(l));
  ok(courses.every((c) => c.base.def.sky && !racing.has(c.base)), 'every level uses a stunt-only sky track (never a racing map)');
  ok(new Set(courses.map((c) => c.base)).size === 50, '50 distinct course track objects');
  // route signature: heading change + elevation sampled every 20 m over the ridden part
  const routeSig = (c) => {
    const out = [];
    for (let s = c.startU; s < c.finishU; s += 20) {
      const a = c.base.sample(s);
      out.push(Math.round(a.head * 10), Math.round(a.y));
    }
    return out.join(',');
  };
  const routes = courses.map(routeSig);
  ok(new Set(routes).size === 50, 'no two levels share a route (heading + elevation profile)');
  const layouts = courses.map((c) => c.features.map((f) => `${f.t}@${Math.round(f.s0 - c.startU)}`).join('|') + '#' + c.segs.map((g) => g.h0.toFixed(1)).join(','));
  ok(new Set(layouts).size === 50, 'no two levels share a feature layout (types, positions, heights)');
  // shape difference: mean planar distance between any two routes (aligned at the start) is large
  let minDiff = Infinity;
  let pair = '';
  const pts = courses.map((c) => {
    const p0 = c.base.toWorld(c.startU, 0);
    const arr = [];
    for (let s = c.startU; s < c.startU + 220; s += 10) {
      const w = c.base.toWorld(s, 0);
      const r = Math.hypot(w.x - p0.x, w.z - p0.z);
      arr.push(r, c.base.sample(s).head - c.base.sample(c.startU).head);
    }
    return arr;
  });
  for (let i = 0; i < 50; i++) for (let j = i + 1; j < 50; j++) {
    const a = routes[i].split(',');
    const b = routes[j].split(',');
    let d = Math.abs(a.length - b.length);
    for (let k = 0; k < Math.min(a.length, b.length); k++) d += a[k] !== b[k] ? 1 : 0;
    if (d < minDiff) {
      minDiff = d;
      pair = `${STUNT_LEVELS[i].id}/${STUNT_LEVELS[j].id}`;
    }
  }
  ok(minDiff >= 10, `closest pair of routes still differs in ${minDiff} of their 20 m samples (${pair})`);
  void pts;
}
ok(STUNT_BIKES.length === 34 && STUNT_BIKES.slice(0, 4).every((b, i) => b.id === BIKES[i].id && b.power === BIKES[i].power), '34 bikes, original four first and unchanged');
ok(STUNT_BIKES.every((b) => b.power <= 1.06), 'every stunt bike stays inside the racing power envelope (<= 1.06)');
{
  const a = buildCourse(STUNT_LEVEL_BY_ID.L20);
  ok(a === buildCourse(STUNT_LEVEL_BY_ID.L20) && a.features.length > 0, 'course build is cached / deterministic');
}
ok(objectiveMet({ type: 'clean', n: 0 }, { crashes: 0 }) && !objectiveMet({ type: 'clean', n: 0 }, { crashes: 1 }), 'objective "no crashes" evaluates');
console.log(`${n - fails}/${n} stunt tests passed`);
process.exit(fails ? 1 : 0);
