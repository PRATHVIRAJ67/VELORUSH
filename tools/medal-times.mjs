// Calibrates the medal target times in client/src/core/progress.js by simulating solo time trials
// on every map: a first-time rider (holds pedal + sprint, steers to stay on the road, steering
// assist on) and the game's own AI at Pro and Elite. Usage: node tools/medal-times.mjs
// Prints the MEDAL_TIMES table: [gold, silver, bronze] seconds per map and lap count.
import { Race } from '../shared/race.js';
import { getTrack, TRACK_IDS } from '../shared/tracks.js';
import { PHYSICS } from '../shared/constants.js';
import { wrapAngle, clamp } from '../shared/math.js';

const H = PHYSICS.dt;

function soloTime(trackId, laps, who) {
  const track = getTrack(trackId);
  const race = new Race(track, { laps, countdown: 0.01 });
  const r = who.skill
    ? race.addRacer({ id: 'r', name: 'r', isBot: true, skill: who.skill, seed: who.seed, slot: 1, bikeId: 'allround' })
    : race.addRacer({ id: 'r', name: 'r', slot: 1, bikeId: 'allround', assist: 0.85 });
  for (let t = 0; t < 900 && !r.finished; t += H) {
    if (!who.skill) {
      const b = r.bike;
      const ahead = track.sample(b.s + Math.max(4, b.v * 0.5));
      const err = wrapAngle(b.yaw - ahead.head) - clamp(b.d * 0.12, -0.45, 0.45);
      Object.assign(r.input, { throttle: 1, brake: 0, steer: clamp(err * 5, -1, 1), sprint: true, boost: false, reset: false });
    }
    race.step(H);
  }
  return r.finishTime;
}

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const rows = [];
for (const id of TRACK_IDS) {
  const cells = [];
  for (const laps of [1, 2, 3]) {
    const gold = avg([11, 29, 47].map((seed) => soloTime(id, laps, { skill: 'hard', seed })));
    const silver = avg([11, 29, 47].map((seed) => soloTime(id, laps, { skill: 'medium', seed })));
    const bronze = soloTime(id, laps, {}) * 1.02; // a little slack over a first clean ride
    cells.push(`${laps}: [${Math.ceil(gold)}, ${Math.ceil(silver)}, ${Math.ceil(bronze)}]`);
  }
  rows.push(`  ${id}: { ${cells.join(', ')} },`);
}
console.log(rows.join('\n'));
