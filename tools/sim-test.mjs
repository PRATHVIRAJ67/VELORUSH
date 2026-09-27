// Headless race simulation: verifies track, physics and AI produce a sane race.
// Usage: node tools/sim-test.mjs
import { getTrack } from '../shared/tracks.js';
import { Race } from '../shared/race.js';
import { consumeEvents } from '../shared/physics.js';

const track = getTrack(process.argv[2] || 'mountain');
const race = new Race(track, { laps: 2, countdown: 1 });
const skills = ['easy', 'medium', 'medium', 'hard', 'hard', 'elite', 'elite', 'medium'];
const bikes = ['allround', 'aero', 'climber', 'sprint'];
skills.forEach((skill, i) =>
  race.addRacer({ id: `bot${i}`, name: `${skill}-${i}`, isBot: true, skill, bikeId: bikes[i % 4] }),
);

const stats = new Map(race.racers.map((r) => [r.id, { maxV: 0, walls: 0, jumps: 0, resets: 0, air: 0, sprintT: 0, draftT: 0 }]));
let t = 0;
const dt = 1 / 120;
let lastU = new Map();
while (!race.allDone && t < 900) {
  race.step(dt);
  t += dt;
  for (const r of race.racers) {
    const st = stats.get(r.id);
    st.maxV = Math.max(st.maxV, r.bike.v);
    const ev = consumeEvents(r.bike);
    if (ev.wall) st.walls++;
    if (ev.jump) st.jumps++;
    if (r.bike.sprinting) st.sprintT += dt;
    if (r.bike.draft > 0.3) st.draftT += dt;
    if (r.bike.resetCooldown > 1.99) st.resets++;
  }
  race.drainEvents();
}
if (!race.allDone) {
  console.error('FAIL: race did not finish within 900 s');
  for (const r of race.racers) console.error(r.name, 'u', r.bike.u.toFixed(0), 'v', r.bike.v.toFixed(1), 'lap', r.lap);
  process.exit(1);
}
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
console.log(`Track ${track.length.toFixed(0)} m x ${race.laps} laps`);
for (const r of race.standings()) {
  const st = stats.get(r.id);
  const avg = (race.totalDistance / r.finishTime) * 3.6;
  console.log(
    `${String(r.place).padStart(2)}. ${r.name.padEnd(10)} ${r.bikeId.padEnd(9)} ${fmt(r.finishTime)} avg ${avg.toFixed(1)} km/h max ${(st.maxV * 3.6).toFixed(0)} km/h  best lap ${fmt(r.bestLap)} walls ${st.walls} jumps ${st.jumps} resets ${st.resets} sprint ${st.sprintT.toFixed(0)}s draft ${st.draftT.toFixed(0)}s`,
  );
}
const spread = race.standings().at(-1).finishTime - race.standings()[0].finishTime;
console.log(`spread first->last ${spread.toFixed(1)} s`);
if (race.racers.some((r) => stats.get(r.id).resets > 3)) {
  console.error('FAIL: bots needed too many resets');
  process.exit(1);
}
console.log('OK');
