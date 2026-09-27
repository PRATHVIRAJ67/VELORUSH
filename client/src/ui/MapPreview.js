// Map card previews drawn from the real track data: route outline, start line, elevation profile.
import { getTrack, TRACK_DEFS } from '@shared/tracks.js';

const LOOK = {
  mountain: ['#1f3b2a', '#3d6b3f', '#ff5a1f'],
  alpine: ['#1b2f45', '#5a7f9e', '#ffffff'],
  coast: ['#0b3a5c', '#1f7fb3', '#ffd27a'],
  forest: ['#0f2016', '#2d4a30', '#9fe07a'],
  canyon: ['#5a2a14', '#b0603a', '#ffe0b0'],
  city: ['#070b16', '#1b2740', '#ffc86a'],
};

export function trackStats(track) {
  let gain = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < track.count; i++) {
    const dy = track.Y[(i + 1) % track.count] - track.Y[i];
    if (dy > 0) gain += dy;
    minY = Math.min(minY, track.Y[i]);
    maxY = Math.max(maxY, track.Y[i]);
  }
  return { km: track.length / 1000, gain: Math.round(gain), minY, maxY };
}

export function drawMapPreview(cv, id) {
  const t = getTrack(id);
  const theme = t.def.env?.theme || 'mountain';
  const [bg0, bg1, line] = LOOK[theme] || LOOK.mountain;
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, bg0);
  g.addColorStop(1, bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // outline fitted in the upper 70%
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < t.count; i++) {
    minX = Math.min(minX, t.X[i]);
    maxX = Math.max(maxX, t.X[i]);
    minZ = Math.min(minZ, t.Z[i]);
    maxZ = Math.max(maxZ, t.Z[i]);
  }
  const areaH = H * 0.68;
  const sc = Math.min((W - 24) / (maxX - minX), (areaH - 18) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * sc) / 2 - minX * sc;
  const oz = 10 + (areaH - 18 - (maxZ - minZ) * sc) / 2 - minZ * sc;
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= t.count; i += 4) {
    const k = i % t.count;
    const x = ox + t.X[k] * sc;
    const y = oz + t.Z[k] * sc;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.strokeStyle = line;
  ctx.lineWidth = 3;
  ctx.shadowColor = line;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(ox + t.X[0] * sc, oz + t.Z[0] * sc, 4, 0, Math.PI * 2);
  ctx.fill();
  // elevation profile along the bottom
  const st = trackStats(t);
  const top = H * 0.74;
  const bh = H * 0.22;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let i = 0; i < t.count; i += 6) {
    const x = (i / t.count) * W;
    const y = top + bh - ((t.Y[i] - st.minY) / Math.max(1, st.maxY - st.minY)) * bh;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  const pg = ctx.createLinearGradient(0, top, 0, H);
  pg.addColorStop(0, line + 'cc');
  pg.addColorStop(1, line + '22');
  ctx.fillStyle = pg;
  ctx.fill();
  return st;
}

export const MAP_LIST = TRACK_DEFS.map((d) => ({ id: d.id, name: d.name, meta: d.meta, laps: d.laps }));
