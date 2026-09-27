// Dev tool: prints track stats and writes an SVG top-down preview.
// Usage: node tools/track-preview.mjs [out.svg]
import { writeFileSync } from 'node:fs';
import { FLAG } from '../shared/track.js';
import { getTrack } from '../shared/tracks.js';

const t = getTrack(process.argv[3] || 'mountain');
console.log(`Track "${t.name}" length ${t.length.toFixed(0)} m, samples ${t.count}`);

let minR = Infinity;
let minRAt = 0;
let maxUp = 0;
let maxDown = 0;
let minY = Infinity;
let maxY = -Infinity;
for (let i = 0; i < t.count; i++) {
  const r = 1 / Math.max(1e-5, Math.abs(t.CURV[i]));
  if (r < minR) {
    minR = r;
    minRAt = i;
  }
  maxUp = Math.max(maxUp, t.SLOPE[i]);
  maxDown = Math.min(maxDown, t.SLOPE[i]);
  minY = Math.min(minY, t.Y[i]);
  maxY = Math.max(maxY, t.Y[i]);
}
console.log(`min radius ${minR.toFixed(1)} m at s=${minRAt}, slope +${(maxUp * 100).toFixed(1)}% / ${(maxDown * 100).toFixed(1)}%`);
console.log(`elevation ${minY.toFixed(1)}..${maxY.toFixed(1)}`);

// Self-proximity check: non-adjacent parts of the road closer than road width + margin
const clearance = t.halfWidth * 2 + t.shoulder * 2 + 6;
let worst = Infinity;
let worstPair = null;
for (let i = 0; i < t.count; i += 3) {
  for (let j = i + 1; j < t.count; j += 3) {
    let gap = Math.abs(i - j) * t.ds;
    gap = Math.min(gap, t.length - gap);
    if (gap < 80) continue;
    const d = Math.hypot(t.X[i] - t.X[j], t.Z[i] - t.Z[j]);
    const dy = Math.abs(t.Y[i] - t.Y[j]);
    if (d < worst && dy < 12) {
      worst = d;
      worstPair = [i, j];
    }
  }
}
console.log(`closest non-adjacent approach: ${worst.toFixed(1)} m (need > ${clearance.toFixed(1)}) at s=${worstPair}`);
console.log('checkpoints', t.checkpoints.map((c) => c.toFixed(0)).join(', '));
console.log('zones', t.zones.map((z) => `${z.flag}:${z.s0.toFixed(0)}-${z.s1.toFixed(0)}`).join(' '));

const out = process.argv[2];
if (out) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < t.count; i++) {
    minX = Math.min(minX, t.X[i]); maxX = Math.max(maxX, t.X[i]);
    minZ = Math.min(minZ, t.Z[i]); maxZ = Math.max(maxZ, t.Z[i]);
  }
  const pad = 40;
  const w = maxX - minX + pad * 2;
  const h = maxZ - minZ + pad * 2;
  let segs = '';
  for (let i = 0; i < t.count; i += 2) {
    const j = (i + 2) % t.count;
    const e = (t.Y[i] - minY) / (maxY - minY);
    let col = `hsl(${120 - e * 120},70%,45%)`;
    if (t.FLAGS[i] & FLAG.TUNNEL) col = '#222';
    if (t.FLAGS[i] & FLAG.BRIDGE) col = '#39f';
    segs += `<line x1="${t.X[i] - minX + pad}" y1="${t.Z[i] - minZ + pad}" x2="${t.X[j] - minX + pad}" y2="${t.Z[j] - minZ + pad}" stroke="${col}" stroke-width="11" stroke-linecap="round"/>`;
  }
  let marks = '';
  t.def.points.forEach((p, i) => {
    marks += `<text x="${p[0] - minX + pad + 8}" y="${p[2] - minZ + pad}" font-size="14" fill="#000">${i}</text>`;
  });
  for (const c of t.checkpoints) {
    const p = t.toWorld(c, 0);
    marks += `<circle cx="${p.x - minX + pad}" cy="${p.z - minZ + pad}" r="7" fill="none" stroke="#f0f" stroke-width="3"/>`;
  }
  const s0 = t.toWorld(0, 0);
  marks += `<circle cx="${s0.x - minX + pad}" cy="${s0.z - minZ + pad}" r="9" fill="#000"/>`;
  writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="background:#eee">${segs}${marks}</svg>`);
  console.log('wrote', out);
}
