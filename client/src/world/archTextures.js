// Procedural architecture textures per map style (houses, city facades, street details).
import { makeRng, makeNoise2D } from '@shared/math.js';
import { canvas, toTexture } from './textures.js';

function speckle(ctx, w, h, count, rng, colors, sizeMin, sizeMax) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const s = sizeMin + rng() * (sizeMax - sizeMin);
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
}

/** House wall with windows. style: stone | plaster | log | adobe. One tile ≈ 6 m x 6 m. */
export function makeWall(style, seed = 1, tint = null) {
  const w = 256;
  const h = 256;
  const rng = makeRng(seed * 13 + 7);
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  if (style === 'stone') {
    ctx.fillStyle = '#8e877c';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      for (let x = -((y / 16) % 2) * 14; x < w; x += 28) {
        const g = 110 + rng() * 55;
        ctx.fillStyle = `rgb(${g},${g - 6},${g - 14})`;
        ctx.fillRect(x + 1.5, y + 1.5, 25 + rng() * 3, 13);
      }
    }
    if (rng() < 0.5) {
      // timber upper floor
      ctx.fillStyle = '#6b4a30';
      ctx.fillRect(0, 0, w, h * 0.42);
      ctx.strokeStyle = 'rgba(30,18,8,0.5)';
      for (let x = 0; x < w; x += 12) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h * 0.42);
        ctx.stroke();
      }
    }
  } else if (style === 'plaster') {
    const pastel = tint || rng.pick(['#e8c9a0', '#e3a785', '#f1e3c6', '#d98f6a', '#efd9a8', '#e8b9a0', '#f4efe4']);
    ctx.fillStyle = pastel;
    ctx.fillRect(0, 0, w, h);
    const noise = makeNoise2D(seed);
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const p = i / 4;
      const v = noise((p % w) / 30, Math.floor(p / w) / 30) * 14 + (rng() - 0.5) * 8;
      img.data[i] += v;
      img.data[i + 1] += v;
      img.data[i + 2] += v;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(80,60,40,0.12)';
    ctx.fillRect(0, h * 0.93, w, h * 0.07);
  } else if (style === 'log') {
    for (let y = 0; y < h; y += 14) {
      const g = ctx.createLinearGradient(0, y, 0, y + 14);
      const b = 70 + rng() * 25;
      g.addColorStop(0, `rgb(${b + 30},${b + 12},${b - 12})`);
      g.addColorStop(0.5, `rgb(${b + 55},${b + 32},${b + 5})`);
      g.addColorStop(1, `rgb(${b},${b - 12},${b - 26})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, y, w, 14);
    }
  } else {
    ctx.fillStyle = tint || '#c89468';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 2600, rng, ['rgba(90,50,30,0.12)', 'rgba(255,230,200,0.1)'], 1, 3);
  }
  const shutter = style === 'plaster' ? rng.pick(['#3f6b3f', '#2f5d73', '#6b4a2a']) : style === 'log' ? '#3a2a1c' : '#5a3a24';
  const rows = style === 'plaster' ? [0.12, 0.45, 0.76] : [0.2, 0.62];
  for (const ry of rows) {
    for (const rx of [0.18, 0.62]) {
      const x = rx * w;
      const y = ry * h;
      const ww = style === 'stone' ? 30 : 34;
      const wh = style === 'plaster' ? 46 : 38;
      if (style === 'plaster' || style === 'stone') {
        ctx.fillStyle = shutter;
        ctx.fillRect(x - ww * 0.5, y, ww * 0.45, wh);
        ctx.fillRect(x + ww * 1.05, y, ww * 0.45, wh);
      }
      ctx.fillStyle = style === 'adobe' ? '#3a2a20' : '#27313b';
      ctx.fillRect(x, y, ww, wh);
      ctx.fillStyle = 'rgba(170,200,225,0.35)';
      ctx.fillRect(x + 3, y + 3, ww / 2 - 4, wh - 6);
      ctx.fillStyle = style === 'log' ? '#e6dccb' : '#efe9dd';
      ctx.fillRect(x + ww / 2 - 1, y, 2, wh);
      if (style === 'plaster' && ry < 0.7 && rng() < 0.6) {
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(x - 6, y + wh, ww + 12, 3);
        for (let k = 0; k < 8; k++) ctx.fillRect(x - 6 + k * ((ww + 12) / 7), y + wh - 12, 1.5, 12);
      }
    }
  }
  return toTexture(c, { wrap: true });
}

export function makeRoofTiles(kind) {
  const w = 128;
  const c = canvas(w, w);
  const ctx = c.getContext('2d');
  const rng = makeRng(kind === 'terracotta' ? 3 : 5);
  ctx.fillStyle = kind === 'terracotta' ? '#8e3f22' : '#3b3f45';
  ctx.fillRect(0, 0, w, w);
  for (let y = 0; y < w; y += 9) {
    for (let x = (y / 9) % 2 ? 0 : -6; x < w; x += 12) {
      const g = rng() * 30;
      ctx.fillStyle = kind === 'terracotta' ? `rgb(${170 + g},${78 + g * 0.6},${45 + g * 0.3})` : `rgb(${62 + g},${66 + g},${72 + g})`;
      ctx.fillRect(x + 1, y + 1, 10, 7);
    }
  }
  return toTexture(c);
}

/** City facade: colour + emissive lit windows. style: glass | apartment | brick */
export function makeFacade(style, seed = 1) {
  const w = 256;
  const h = 512;
  const rng = makeRng(seed * 31 + 3);
  const c = canvas(w, h);
  const e = canvas(w, h);
  const ctx = c.getContext('2d');
  const ex = e.getContext('2d');
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, w, h);
  const base = style === 'glass' ? '#1d2630' : style === 'brick' ? '#5a3a30' : rng.pick(['#8b8680', '#a39c90', '#6f6a66', '#b2aa9c']);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  if (style === 'brick') speckle(ctx, w, h, 4000, rng, ['rgba(0,0,0,0.12)', 'rgba(255,200,170,0.07)'], 1, 3);
  const cols = style === 'glass' ? 10 : 7;
  const rows = style === 'glass' ? 20 : 16;
  const cw = w / cols;
  const rh = h / rows;
  const warm = ['#ffd9a0', '#ffe6bd', '#fff1d6', '#ffcf8a'];
  const cool = ['#cfe6ff', '#e6f2ff', '#bcd8ff'];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * cw + (style === 'glass' ? 1 : cw * 0.2);
      const y = r * rh + (style === 'glass' ? 1 : rh * 0.22);
      const ww = style === 'glass' ? cw - 2 : cw * 0.6;
      const wh = style === 'glass' ? rh - 2 : rh * 0.56;
      ctx.fillStyle = style === 'glass' ? `rgba(60,85,110,${0.55 + rng() * 0.3})` : '#1b222a';
      ctx.fillRect(x, y, ww, wh);
      // a believable night: roughly one window in five lit, at varied brightness
      if (rng() < (style === 'glass' ? 0.22 : 0.2)) {
        const col = style === 'glass' ? rng.pick(cool) : rng.pick(warm);
        ex.fillStyle = col;
        ex.globalAlpha = 0.25 + rng() * 0.55;
        ex.fillRect(x, y, ww, wh);
        ex.globalAlpha = 1;
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, y, ww, wh);
        ctx.globalAlpha = 1;
      }
      if (style === 'apartment' && rng() < 0.4) {
        ctx.fillStyle = 'rgba(40,40,40,0.8)';
        ctx.fillRect(x - 3, y + wh, ww + 6, 3);
      }
    }
  }
  if (style === 'glass') {
    ctx.fillStyle = 'rgba(200,210,220,0.25)';
    for (let k = 0; k <= cols; k++) ctx.fillRect(k * cw - 1, 0, 2, h);
  }
  return { map: toTexture(c, { wrap: true }), emissiveMap: toTexture(e, { wrap: true }) };
}

/** Ground-floor shopfronts (emissive), repeated along building bases. */
export function makeShopfront(seed = 1) {
  const w = 512;
  const h = 64;
  const rng = makeRng(seed + 99);
  const c = canvas(w, h);
  const e = canvas(w, h);
  const ctx = c.getContext('2d');
  const ex = e.getContext('2d');
  ctx.fillStyle = '#222326';
  ctx.fillRect(0, 0, w, h);
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, w, h);
  for (let x = 4; x < w; x += 64) {
    const col = rng.pick(['#ffe2b0', '#fff3de', '#dfefff', '#ffd0a0']);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, 16, 56, 44);
    ctx.globalAlpha = 1;
    ex.fillStyle = col;
    ex.globalAlpha = 0.45 + rng() * 0.4;
    ex.fillRect(x, 16, 56, 44);
    ex.globalAlpha = 1;
    const sign = rng.pick(['#b8322c', '#2b6cb0', '#2f855a', '#b7791f', '#553c9a']);
    ctx.fillStyle = sign;
    ctx.fillRect(x + 6, 4, 44, 9);
    ex.fillStyle = sign;
    ex.globalAlpha = 0.5;
    ex.fillRect(x + 6, 4, 44, 9);
    ex.globalAlpha = 1;
  }
  return { map: toTexture(c, { wrap: true }), emissiveMap: toTexture(e, { wrap: true }) };
}

export function makeZebra() {
  const c = canvas(128, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(240,240,232,0.92)';
  for (let x = 4; x < 128; x += 16) ctx.fillRect(x, 0, 8, 64);
  return toTexture(c, { wrap: true });
}

/** Soft warm pool of light on the road under a street lamp (additive decal). */
export function makeLightPool() {
  const s = 128;
  const c = canvas(s, s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,214,160,0.55)');
  g.addColorStop(0.45, 'rgba(255,196,130,0.22)');
  g.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return toTexture(c, { wrap: false });
}

/** Horizontal sedimentary bands (canyon arches). */
export function makeStrata(bands) {
  const w = 64;
  const h = 256;
  const rng = makeRng(71);
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  let y = 0;
  while (y < h) {
    const bh = 6 + rng() * 22;
    ctx.fillStyle = bands[Math.floor(rng() * bands.length)];
    ctx.fillRect(0, y, w, bh);
    y += bh;
  }
  speckle(ctx, w, h, 900, rng, ['rgba(0,0,0,0.15)', 'rgba(255,240,220,0.1)'], 1, 2);
  return toTexture(c);
}
