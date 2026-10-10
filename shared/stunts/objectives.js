// Level objectives: data -> live progress + pass/fail. Every objective reads the run's stats,
// which are only ever updated from judged landings / physics events (see run.js).

const S = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const OBJECTIVES = {
  score: { label: (n) => `Score ${n.toLocaleString('en-US')} points`, value: (st) => st.score, cmp: 'ge' },
  flips: { label: (n) => `Land ${S(n, 'flip', 'flips')}`, value: (st) => st.flips, cmp: 'ge' },
  backflips: { label: (n) => `Land ${S(n, 'backflip', 'backflips')}`, value: (st) => st.backflips, cmp: 'ge' },
  frontflips: { label: (n) => `Land ${S(n, 'frontflip', 'frontflips')}`, value: (st) => st.frontflips, cmp: 'ge' },
  spins: { label: (n) => `Land ${S(n, '360 spin', '360 spins')}`, value: (st) => st.spins, cmp: 'ge' },
  flipJump: { label: (n) => (n === 2 ? 'Land a double flip' : n === 3 ? 'Land a triple flip' : `Land a ${n}x flip`), value: (st) => st.maxFlipsJump, cmp: 'ge' },
  spinJump: { label: (n) => `Land a ${n * 360} spin`, value: (st) => st.maxSpinsJump, cmp: 'ge' },
  corkscrew: { label: (n) => `Land ${S(n, 'corkscrew', 'corkscrews')} (flip + spin)`, value: (st) => st.corkscrews, cmp: 'ge' },
  air: { label: (n) => `${n.toFixed(1)} s of air in one jump`, value: (st) => st.maxAir, cmp: 'ge', fmt: (v) => v.toFixed(1) + ' s' },
  airTotal: { label: (n) => `${n} s total air time`, value: (st) => st.airTotal, cmp: 'ge', fmt: (v) => v.toFixed(1) + ' s' },
  dist: { label: (n) => `Jump ${n} m in one go`, value: (st) => st.maxDist, cmp: 'ge', fmt: (v) => Math.floor(v) + ' m' },
  style: { label: (n) => `Hold a no-hander ${n.toFixed(1)} s`, value: (st) => st.maxStyle, cmp: 'ge', fmt: (v) => v.toFixed(1) + ' s' },
  perfect: { label: (n) => `${S(n, 'perfect landing', 'perfect landings')}`, value: (st) => st.perfects, cmp: 'ge' },
  targets: { label: (n) => `Land in ${S(n, 'target zone', 'target zones')}`, value: (st) => st.targets, cmp: 'ge' },
  rings: { label: (n) => `Fly through ${S(n, 'ring', 'rings')}`, value: (st) => st.rings, cmp: 'ge' },
  combo: { label: (n) => `Reach a x${(1 + (n - 1) * 0.5).toFixed(1)} combo`, value: (st) => st.maxCombo, cmp: 'ge' },
  clean: { label: (n) => (n === 0 ? 'No crashes' : `At most ${S(n, 'crash', 'crashes')}`), value: (st) => st.crashes, cmp: 'le' },
  time: { label: (n) => `Finish in under ${n} s`, value: (st) => st.time, cmp: 'le', fmt: (v) => v.toFixed(1) + ' s', atFinish: true },
};

/** [{type, n}] from a level's objective map {type: n}. */
export function objectiveList(level) {
  return Object.entries(level.objectives || {}).map(([type, n]) => ({ type, n }));
}

export function objectiveLabel(o) {
  return OBJECTIVES[o.type].label(o.n);
}

/** Is an objective met by these stats? (finished = rider crossed the line) */
export function objectiveMet(o, st, finished = true) {
  const def = OBJECTIVES[o.type];
  const v = def.value(st);
  if (def.cmp === 'ge') return v >= o.n - 1e-9;
  if (def.atFinish && !finished) return false;
  return v <= o.n + 1e-9;
}

/** Live progress strings for the HUD: [{label, done, progress}] */
export function objectiveProgress(level, st, finished = false) {
  return objectiveList(level).map((o) => {
    const def = OBJECTIVES[o.type];
    const v = def.value(st);
    const done = objectiveMet(o, st, finished);
    const f = def.fmt || ((x) => String(Math.floor(x)));
    let progress;
    if (def.cmp === 'ge') progress = `${f(Math.min(v, o.n))}/${def.fmt ? def.fmt(o.n) : o.n}`;
    else progress = o.type === 'clean' ? `${v} crash${v === 1 ? '' : 'es'}` : f(v);
    return { type: o.type, label: objectiveLabel(o), done, progress };
  });
}

export function allObjectivesMet(level, st) {
  return objectiveList(level).every((o) => objectiveMet(o, st, true));
}

/** 1-3 stars for a completed run (score thresholds from the level data). */
export function starsFor(level, completed, score) {
  if (!completed) return 0;
  const [s2, s3] = level.stars;
  return score >= s3 ? 3 : score >= s2 ? 2 : 1;
}
