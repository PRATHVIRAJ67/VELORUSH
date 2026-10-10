// Stunt-only course tracks: every level gets its own route high above the clouds, generated
// deterministically from the level data (same on client, server and solver). The route is a
// closed spline built with the existing shared/track.js buildTrack, so the bike physics,
// ramps (rampHeight), pits, checkpoints and the finish work exactly as before — only the road is
// new. Racing tracks (tracks.js) are never touched.
//
// Layout: a straight run-up, then for every feature a straight section long enough for it (and
// its landing), joined by bends whose angle, radius and direction come from the level's seed.
// The loop closes back to the start far behind the finish; that part is never ridden or drawn.

import { buildTrack } from '../track.js';
import { makeRng } from '../math.js';

export const SKY_ROAD = { width: 9, shoulder: 1.3 }; // limit = 4.5 + 1.3 - 0.45 = 5.35 m
export const SKY_START = 60; // course start (spawn) s
const LIMIT = SKY_ROAD.width / 2 + SKY_ROAD.shoulder - 0.45;

// slope (rise per metre) of the straight carrying each feature type: big drops go down hill
const SLOPE = { kick: [-0.03, 0.0], table: [-0.03, 0.0], gap: [-0.04, -0.01], step: [-0.02, 0.0], deck: [-0.09, -0.05], rollers: [-0.01, 0.02], barrels: [-0.01, 0.02], pad: [-0.02, 0.0] };

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Track definition (control points etc.) for a level.
 * @param level level data; @param featureSpan (spec) => {len, post} metres (from course.js)
 */
export function skyTrackDef(level, featureSpan) {
  const rng = makeRng(hashStr(level.id + ':' + level.name) ^ (level.n * 2654435761));
  const pts = [];
  let x = 0;
  let z = 0;
  let y = 330 + rng() * 120;
  let head = rng() * Math.PI * 2;
  const push = () => pts.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(z * 100) / 100]);
  const straight = (len, slope) => {
    const n = Math.max(1, Math.round(len / 30));
    for (let i = 0; i < n; i++) {
      x += (Math.sin(head) * len) / n;
      z += (Math.cos(head) * len) / n;
      y += (slope * len) / n;
      push();
    }
  };
  const bend = (angle, radius, slope) => {
    const arc = Math.abs(angle) * radius;
    const n = Math.max(2, Math.round(arc / 12));
    for (let i = 0; i < n; i++) {
      head += angle / n;
      x += (Math.sin(head) * arc) / n;
      z += (Math.cos(head) * arc) / n;
      y += (slope * arc) / n;
      push();
    }
  };
  push();
  // run-up (spawn at SKY_START) — long enough that the loop closure never reaches it
  straight(SKY_START + (level.runup ?? 70) + 40, -0.01);
  const feats = level.features.filter((f) => f.t !== 'ring' && f.t !== 'target');
  feats.forEach((f, i) => {
    const sp = featureSpan(f, LIMIT);
    const aimed = level.features[level.features.indexOf(f) + 1]?.t === 'ring' || level.features[level.features.indexOf(f) + 1]?.t === 'target';
    const [lo, hi] = SLOPE[f.t] || [-0.02, 0];
    const need = 18 + sp.len + sp.post + (aimed ? 30 : 0) + (f.gap ?? 15) + 26;
    const r = rng();
    straight(need, f.slope ?? lo + (hi - lo) * r); // a level can ask for a steeper drop (more air)
    if (i < feats.length - 1) {
      // bend between sections: tight hairpins to sweeping curves, either way
      const close = (f.gap ?? 15) < 13; // combo sequences: gentle kinks keep the chain flowing
      const ang = (close ? 0.15 + rng() * 0.35 : 0.35 + rng() * 1.5) * (rng() < 0.5 ? -1 : 1);
      bend(ang, close ? 90 + rng() * 60 : 45 + rng() * 60, -0.01 - rng() * 0.03);
    }
  });
  // finish straight + run-out
  straight((level.runout ?? 35) + 140, -0.01);
  return {
    id: 'sky-' + level.id,
    name: `Sky Course ${level.n}`,
    seed: level.n,
    laps: 1,
    sky: true,
    roadWidth: SKY_ROAD.width,
    shoulder: SKY_ROAD.shoulder,
    points: pts,
    surfaces: [],
    zones: [],
    boosts: [],
    ramps: [],
    checkpoints: [],
    env: { theme: 'sky', sky: level.map },
    meta: { location: 'Sky course', style: 'Stunt', difficulty: level.tier, theme: 'sky' },
  };
}

const cache = new Map();
/** Build (once) the course track of a level. */
export function getSkyTrack(level, featureSpan) {
  if (!cache.has(level.id)) cache.set(level.id, buildTrack(skyTrackDef(level, featureSpan)));
  return cache.get(level.id);
}
