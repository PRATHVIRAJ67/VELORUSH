// Automated completability check for every stunt level: builds each course on its map,
// checks placement, then lets the headless solver (real physics + trick rules) find and
// replay a run that finishes with every objective met. Also checks the star thresholds are
// reachable (3-star score <= solver score) and reports timing.
// Usage: node tools/stunt-validate.mjs [levelId ...] [--bike=id] [--verbose]
import { STUNT_LEVELS } from '../shared/stunts/levels.js';
import { buildCourse } from '../shared/stunts/course.js';
import { solveLevel } from '../shared/stunts/pilot.js';
import { objectiveProgress } from '../shared/stunts/objectives.js';

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const bike = (args.find((a) => a.startsWith('--bike=')) || '--bike=allround').slice(7);
const verbose = args.includes('--verbose');
const calibrate = args.includes('--stars');
const suggested = {};
const levels = only.length ? STUNT_LEVELS.filter((l) => only.includes(l.id)) : STUNT_LEVELS;
let fails = 0;
const t0 = Date.now();
for (const level of levels) {
  const t = Date.now();
  const course = buildCourse(level);
  const line = `${level.id} T${level.tier} ${level.name.padEnd(24)} ${level.map.padEnd(8)}`;
  if (course.problems.length) {
    fails++;
    console.log(`FAIL ${line} placement: ${course.problems.join('; ')}`);
    continue;
  }
  const sol = solveLevel(course, { bikeId: bike });
  const st = sol.stats;
  // what a rider gets by just riding cleanly with no tricks (star calibration)
  const plain = solveLevel(course, { bikeId: bike, tricks: false });
  let dead = 0;
  let prev = course.startU;
  for (const f of course.features) {
    dead = Math.max(dead, f.s0 - prev);
    prev = f.s1;
  }
  if (calibrate) {
    const k = [0, 0.55, 0.62, 0.68, 0.72][level.tier];
    const r = (x) => Math.round(x / 100) * 100;
    const s3 = r(st.score * k);
    const s2 = Math.min(s3 - 300, r(Math.max(plain.stats.score * 1.1, st.score * 0.35)));
    suggested[level.name] = [s2, s3, st.score, level.objectives.score || 0];
  }
  const starOk = st.score >= level.stars[1];
  const ok = sol.ok && starOk;
  if (!ok) fails++;
  const objs = objectiveProgress(level, st, true).map((o) => `${o.done ? '✓' : '✗'}${o.label} [${o.progress}]`).join(', ');
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${line} len ${course.length.toFixed(0)}m feats ${course.features.length} gates ${course.gates.length} | ${sol.phase} t=${(sol.result?.time ?? 0).toFixed(1)}s score ${st.score} (3★ ${level.stars[1]}${starOk ? '' : ' UNREACHED'}) crashes ${st.crashes} | plain ${plain.stats.score}${plain.ok ? ' ok' : ''} | dead ${dead.toFixed(0)}m | ${objs} | ${((Date.now() - t) / 1000).toFixed(1)}s`,
  );
  if (verbose || !ok) {
    console.log('   features', course.features.map((f) => `${f.t}@${f.s0.toFixed(0)} v${f.designV}${f.minV ? ' min' + f.minV : ''}`).join(' '), 'finish', course.finishU.toFixed(0));
    console.log('   plan', sol.plan.map((p) => p.v).join(','), 'stats', JSON.stringify(st));
  }
}
if (calibrate) console.log('STARS ' + JSON.stringify(suggested));
console.log(`${levels.length - fails}/${levels.length} levels validated in ${((Date.now() - t0) / 1000).toFixed(1)} s (bike ${bike})`);
process.exit(fails ? 1 : 0);
