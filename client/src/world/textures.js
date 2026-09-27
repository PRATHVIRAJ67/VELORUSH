// Procedural canvas textures — the game ships with zero external image assets.
import * as THREE from 'three';
import { makeRng, makeNoise2D } from '@shared/math.js';

let maxAniso = 4;
export function setMaxAnisotropy(a) {
  maxAniso = a;
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(cv, { repeat = null, srgb = true, aniso = true, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  if (aniso) t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Derive a tangent-space normal map from a grayscale height canvas. */
export function heightToNormal(heightCanvas, strength = 2) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (-dx / l) * 127 + 128;
      img.data[i + 1] = (dy / l) * 127 + 128;
      img.data[i + 2] = (1 / l) * 127 + 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function speckle(ctx, w, h, count, rng, colors, sizeMin, sizeMax) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    const s = sizeMin + rng() * (sizeMax - sizeMin);
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
}

// ---------------- Road surfaces ----------------
// Road textures map u across the road (0..1) and v along it; 1 tile = 12 m.

function roadMarkings(ctx, w, h, { centre = true, edge = true } = {}) {
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#f2f2ea';
  if (edge) {
    ctx.fillRect(w * 0.03, 0, w * 0.018, h);
    ctx.fillRect(w * 0.952, 0, w * 0.018, h);
  }
  if (centre) {
    const dash = h / 4;
    for (let y = 0; y < h; y += dash) ctx.fillRect(w * 0.494, y, w * 0.012, dash * 0.55);
  }
  ctx.globalAlpha = 1;
}

export function makeAsphalt() {
  const w = 512;
  const h = 1024;
  const rng = makeRng(11);
  const noise = makeNoise2D(5);
  const col = canvas(w, h);
  const ctx = col.getContext('2d');
  const hc = canvas(w, h);
  const hctx = hc.getContext('2d');
  const rc = canvas(w, h);
  const rctx = rc.getContext('2d');
  const img = ctx.createImageData(w, h);
  const himg = hctx.createImageData(w, h);
  const rimg = rctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const big = noise.fbm(x / 90, y / 90, 3) * 0.5 + 0.5; // large tonal variation
      const mid = noise.fbm(x / 14 + 40, y / 14, 2) * 0.5 + 0.5; // aggregate clumps
      const grain = rng();
      const stone = grain > 0.965 ? 1 : 0; // light aggregate chips
      // tyre-polished wheel paths: darker and smoother
      const lane = Math.exp(-(((u - 0.29) * 10) ** 2)) + Math.exp(-(((u - 0.71) * 10) ** 2));
      // dust/dirt drifts toward the edges
      const edge = Math.max(0, 1 - Math.min(u, 1 - u) / 0.09);
      let v = 54 + big * 20 + mid * 10 + grain * 18 + stone * 45 - lane * 9;
      const i = (y * w + x) * 4;
      img.data[i] = v + edge * 26;
      img.data[i + 1] = v + 1 + edge * 20;
      img.data[i + 2] = v + 4 + edge * 8;
      img.data[i + 3] = 255;
      const hv = grain * 150 + mid * 70 + stone * 35;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv;
      himg.data[i + 3] = 255;
      // roughness (green channel): polished lanes are smoother
      const r = 235 - lane * 70 + grain * 20 - stone * 30;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = Math.max(0, Math.min(255, r));
      rimg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  // repair patches (subtle tone shift + seam)
  for (let i = 0; i < 4; i++) {
    const px = rng() * w * 0.8;
    const py = rng() * h;
    const pw = 40 + rng() * 110;
    const ph = 60 + rng() * 160;
    ctx.fillStyle = `rgba(${20 + rng() * 25},${20 + rng() * 25},${24 + rng() * 25},0.13)`;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = 'rgba(15,15,17,0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px, py, pw, ph);
  }
  // sealed cracks: glossy black tar snakes
  for (let i = 0; i < 16; i++) {
    let x = rng() * w;
    let y = rng() * h;
    ctx.beginPath();
    rctx.beginPath();
    ctx.moveTo(x, y);
    rctx.moveTo(x, y);
    for (let k = 0; k < 10; k++) {
      x += (rng() - 0.5) * 36;
      y += (rng() - 0.25) * 36;
      ctx.lineTo(x, y);
      rctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(12,12,14,0.6)';
    ctx.lineWidth = 1 + rng() * 2.2;
    ctx.stroke();
    rctx.strokeStyle = 'rgba(70,70,70,1)';
    rctx.lineWidth = 3;
    rctx.stroke();
  }
  // skid / tyre marks
  for (let i = 0; i < 3; i++) {
    const x = w * (0.25 + rng() * 0.5);
    const y = rng() * h;
    const g = ctx.createLinearGradient(0, y, 0, y + 220);
    g.addColorStop(0, 'rgba(10,10,12,0)');
    g.addColorStop(0.5, 'rgba(10,10,12,0.22)');
    g.addColorStop(1, 'rgba(10,10,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 5, 220);
    ctx.fillRect(x + 14, y + 8, 5, 210);
  }
  // loose grit near the kerbs
  speckle(ctx, w * 0.07, h, 900, rng, ['#8a8170', '#6d665a', '#a39b88'], 1, 2.5);
  ctx.save();
  ctx.translate(w * 0.93, 0);
  speckle(ctx, w * 0.07, h, 900, rng, ['#8a8170', '#6d665a', '#a39b88'], 1, 2.5);
  ctx.restore();
  roadMarkings(ctx, w, h);
  // worn paint: grain shows through the markings
  ctx.globalCompositeOperation = 'multiply';
  speckle(ctx, w, h, 9000, rng, ['rgba(120,120,120,0.35)'], 1, 2);
  ctx.globalCompositeOperation = 'source-over';
  const roughnessMap = toTexture(rc, { srgb: false });
  return { map: toTexture(col), normalMap: toTexture(heightToNormal(hc, 3.5), { srgb: false }), roughnessMap };
}

export function makeCobble() {
  const w = 512;
  const h = 1024;
  const rng = makeRng(21);
  const col = canvas(w, h);
  const ctx = col.getContext('2d');
  const hc = canvas(w, h);
  const hctx = hc.getContext('2d');
  ctx.fillStyle = '#3b3833';
  ctx.fillRect(0, 0, w, h);
  hctx.fillStyle = '#000';
  hctx.fillRect(0, 0, w, h);
  const sw = 26;
  const sh = 22;
  for (let row = 0; row * sh < h + sh; row++) {
    const off = (row % 2) * (sw / 2);
    for (let x = -sw; x < w + sw; x += sw) {
      const cx = x + off + (rng() - 0.5) * 3;
      const cy = row * sh + (rng() - 0.5) * 3;
      const g = 95 + rng() * 60;
      const tint = rng() * 14;
      ctx.fillStyle = `rgb(${g + tint},${g + tint * 0.6},${g - 6})`;
      roundRect(ctx, cx + 1.5, cy + 1.5, sw - 3, sh - 3, 6);
      ctx.fill();
      const grad = hctx.createRadialGradient(cx + sw / 2, cy + sh / 2, 1, cx + sw / 2, cy + sh / 2, sw * 0.6);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(1, '#222');
      hctx.fillStyle = grad;
      roundRect(hctx, cx + 1.5, cy + 1.5, sw - 3, sh - 3, 6);
      hctx.fill();
    }
  }
  speckle(ctx, w, h, 3000, rng, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.06)'], 1, 2);
  // worn painted edge lines
  ctx.globalAlpha = 0.6;
  roadMarkings(ctx, w, h, { centre: false });
  ctx.globalAlpha = 1;
  return { map: toTexture(col), normalMap: toTexture(heightToNormal(hc, 5), { srgb: false }) };
}

export function makeGravel() {
  const w = 512;
  const h = 1024;
  const rng = makeRng(31);
  const noise = makeNoise2D(8);
  const col = canvas(w, h);
  const ctx = col.getContext('2d');
  const img = ctx.createImageData(w, h);
  const hc = canvas(w, h);
  const hctx = hc.getContext('2d');
  const himg = hctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = noise.fbm(x / 40, y / 40, 3) * 0.5 + 0.5;
      const g = rng();
      const rut = Math.exp(-(((x / w - 0.35) * 8) ** 2)) + Math.exp(-(((x / w - 0.65) * 8) ** 2));
      const i = (y * w + x) * 4;
      const base = 120 + n * 40 + g * 30 - rut * 18;
      img.data[i] = base + 18;
      img.data[i + 1] = base + 6;
      img.data[i + 2] = base - 16;
      img.data[i + 3] = 255;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = g * 255 * (1 - rut * 0.5);
      himg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  hctx.putImageData(himg, 0, 0);
  speckle(ctx, w, h, 5000, rng, ['#6d6152', '#a89a86', '#524a3f', '#c2b59e'], 1.5, 3.5);
  return { map: toTexture(col), normalMap: toTexture(heightToNormal(hc, 4), { srgb: false }) };
}

export function makeVerge() {
  const w = 256;
  const h = 512;
  const rng = makeRng(41);
  const noise = makeNoise2D(9);
  const col = canvas(w, h);
  const ctx = col.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const n = noise.fbm(x / 30, y / 30, 3) * 0.5 + 0.5;
      // gravel near road (u=0) blending to grass at u=1
      const t = Math.min(1, Math.max(0, (u - 0.25 + (n - 0.5) * 0.5) * 2.2));
      const g = rng() * 25;
      const i = (y * w + x) * 4;
      img.data[i] = (1 - t) * (118 + g) + t * (72 + g * 0.6 + n * 20);
      img.data[i + 1] = (1 - t) * (108 + g) + t * (104 + g + n * 30);
      img.data[i + 2] = (1 - t) * (92 + g) + t * (46 + g * 0.3);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(col) };
}

/** Tiled grayscale detail for terrain (multiplied with vertex colours). */
export function makeTerrainDetail() {
  const w = 256;
  const rng = makeRng(51);
  const noise = makeNoise2D(12);
  const col = canvas(w, w);
  const ctx = col.getContext('2d');
  const img = ctx.createImageData(w, w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const n = noise.fbm(x / 22, y / 22, 4, 2, 0.55) * 0.5 + 0.5;
      const v = 175 + n * 60 + rng() * 20;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, v);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // grass blade strokes
  ctx.strokeStyle = 'rgba(40,40,40,0.18)';
  for (let i = 0; i < 1400; i++) {
    const x = rng() * w;
    const y = rng() * w;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 3, y - 3 - rng() * 4);
    ctx.stroke();
  }
  return toTexture(col, { srgb: true });
}

export function makeRockTexture() {
  const w = 256;
  const rng = makeRng(61);
  const noise = makeNoise2D(14);
  const col = canvas(w, w);
  const ctx = col.getContext('2d');
  const img = ctx.createImageData(w, w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const n = noise.ridged(x / 50, y / 30, 4);
      const v = 90 + n * 110 + rng() * 18;
      const i = (y * w + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v * 0.97;
      img.data[i + 2] = v * 0.92;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(col);
}

export function makeConcrete() {
  const w = 256;
  const rng = makeRng(71);
  const noise = makeNoise2D(15);
  const col = canvas(w, w);
  const ctx = col.getContext('2d');
  const img = ctx.createImageData(w, w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const n = noise.fbm(x / 30, y / 30, 3) * 0.5 + 0.5;
      const v = 125 + n * 45 + rng() * 14;
      const i = (y * w + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v * 0.97;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, w, 2);
  ctx.fillRect(0, 0, 2, w);
  return toTexture(col);
}

// ---------------- Bike ----------------
export function makeSpokes(blur = false) {
  const s = 256;
  const c = canvas(s, s);
  const ctx = c.getContext('2d');
  ctx.translate(s / 2, s / 2);
  if (!blur) {
    ctx.strokeStyle = 'rgba(210,214,220,1)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const off = (i % 2 ? 1 : -1) * 0.12;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a + off) * 12, Math.sin(a + off) * 12);
      ctx.lineTo(Math.cos(a) * 122, Math.sin(a) * 122);
      ctx.stroke();
    }
  } else {
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 124);
    g.addColorStop(0, 'rgba(200,205,212,0.55)');
    g.addColorStop(1, 'rgba(200,205,212,0.25)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 124, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#9aa0a8';
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c, { wrap: false });
}

// ---------------- Jersey ----------------
export function makeJersey(pattern, main, accent) {
  const w = 256;
  const h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = main;
  ctx.fillRect(0, 0, w, h);
  // capsule UV: u around, v bottom->top (canvas y is flipped: top of canvas = top of torso)
  if (pattern === 'stripe') {
    ctx.fillStyle = accent;
    ctx.fillRect(0, h * 0.35, w, h * 0.16);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, h * 0.51, w, h * 0.03);
  } else if (pattern === 'polka') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = main === '#f1faee' ? '#e63946' : main;
    for (let y = 8; y < h; y += 26) for (let x = ((y / 26) % 2) * 13; x < w; x += 26) {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'split') {
    ctx.fillStyle = accent;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, h * 0.48, w, h * 0.04);
  } else if (pattern === 'rainbow') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const cols = ['#1f5fbf', '#d62828', '#111111', '#f7c21a', '#2a9d3f'];
    cols.forEach((cc, i) => {
      ctx.fillStyle = cc;
      ctx.fillRect(0, h * (0.36 + i * 0.045), w, h * 0.045);
    });
  }
  // side panels + collar
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(w * 0.22, 0, w * 0.06, h);
  ctx.fillRect(w * 0.72, 0, w * 0.06, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, h * 0.05);
  // race number on the back
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(w * 0.4, h * 0.56, w * 0.2, h * 0.14);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(1 + Math.floor(Math.random() * 98)), w * 0.5, h * 0.67);
  return toTexture(c, { wrap: true });
}

// ---------------- Signs / banners ----------------
export function makeChevron(dir = 1) {
  const w = 256;
  const h = 128;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d7263d';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 3; i++) {
    const x = 40 + i * 70;
    ctx.beginPath();
    if (dir > 0) {
      ctx.moveTo(x, 18);
      ctx.lineTo(x + 32, 64);
      ctx.lineTo(x, 110);
      ctx.lineTo(x + 20, 110);
      ctx.lineTo(x + 52, 64);
      ctx.lineTo(x + 20, 18);
    } else {
      ctx.moveTo(x + 52, 18);
      ctx.lineTo(x + 20, 64);
      ctx.lineTo(x + 52, 110);
      ctx.lineTo(x + 32, 110);
      ctx.lineTo(x, 64);
      ctx.lineTo(x + 32, 18);
    }
    ctx.fill();
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  return toTexture(c, { wrap: false });
}

export function makeBanner(text, { bg = '#ff5a1f', fg = '#ffffff', w = 1024, h = 160, sub = '', font = 'Russo One' } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, bg);
  g.addColorStop(1, shade(bg, -0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // checker edges
  const cs = h / 8;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 3; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    ctx.fillRect(x * cs, y * cs, cs, cs);
    ctx.fillRect(w - (x + 1) * cs, y * cs, cs, cs);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(h * (sub ? 0.46 : 0.58))}px "${font}", Impact, sans-serif`;
  ctx.fillText(text, w / 2, sub ? h * 0.4 : h / 2);
  if (sub) {
    ctx.font = `600 ${Math.floor(h * 0.2)}px Rajdhani, sans-serif`;
    ctx.fillText(sub, w / 2, h * 0.8);
  }
  return toTexture(c, { wrap: false });
}

export function makeBoard(title, colors) {
  const w = 512;
  const h = 128;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = colors[1];
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w * 0.28, 0);
  ctx.lineTo(w * 0.36, 0);
  ctx.lineTo(w * 0.08, h);
  ctx.fill();
  ctx.fillStyle = colors[2] || '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '64px "Russo One", Impact, sans-serif';
  ctx.fillText(title, w * 0.6, h / 2 + 4);
  return toTexture(c, { wrap: false });
}

export function makeChecker(nx = 16, ny = 2) {
  const s = 32;
  const c = canvas(nx * s, ny * s);
  const ctx = c.getContext('2d');
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    ctx.fillRect(x * s, y * s, s, s);
  }
  return toTexture(c, { wrap: false });
}

export function makeBoostPad() {
  const w = 128;
  const h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,200,255,0.35)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#9ff4ff';
  for (let i = 0; i < 2; i++) {
    const y = i * 128 + 20;
    ctx.beginPath();
    ctx.moveTo(14, y + 80);
    ctx.lineTo(64, y + 20);
    ctx.lineTo(114, y + 80);
    ctx.lineTo(114, y + 104);
    ctx.lineTo(64, y + 44);
    ctx.lineTo(14, y + 104);
    ctx.fill();
  }
  ctx.strokeStyle = '#e0fcff';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, -10, w - 6, h + 20);
  return toTexture(c, { wrap: true });
}

export function makeHazard() {
  const s = 128;
  const c = canvas(s, s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffc300';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#161616';
  for (let i = -s; i < s * 2; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 16, 0);
    ctx.lineTo(i + 16 + s, s);
    ctx.lineTo(i + s, s);
    ctx.fill();
  }
  return toTexture(c);
}

export function makeChaletWall(seed = 1) {
  const w = 256;
  const h = 256;
  const rng = makeRng(seed);
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  // plaster lower half, timber upper half
  ctx.fillStyle = '#efe6d6';
  ctx.fillRect(0, h * 0.45, w, h * 0.55);
  ctx.fillStyle = '#7a4a2a';
  ctx.fillRect(0, 0, w, h * 0.45);
  ctx.strokeStyle = 'rgba(40,20,10,0.5)';
  for (let x = 0; x < w; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h * 0.45);
    ctx.stroke();
  }
  ctx.fillStyle = '#5c351d';
  ctx.fillRect(0, h * 0.43, w, h * 0.04);
  const shutter = rng.pick(['#2f6b3a', '#a23b2a', '#2d4f8a']);
  const win = (x, y, ww, hh) => {
    ctx.fillStyle = shutter;
    ctx.fillRect(x - ww * 0.45, y, ww * 0.4, hh);
    ctx.fillRect(x + ww * 1.05, y, ww * 0.4, hh);
    ctx.fillStyle = '#2b3440';
    ctx.fillRect(x, y, ww, hh);
    ctx.fillStyle = 'rgba(160,200,230,0.5)';
    ctx.fillRect(x + 3, y + 3, ww / 2 - 4, hh - 6);
    ctx.fillStyle = '#f5f0e6';
    ctx.fillRect(x + ww / 2 - 1, y, 2, hh);
    // flower box
    ctx.fillStyle = '#6b3e1f';
    ctx.fillRect(x - 4, y + hh, ww + 8, 8);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = rng.pick(['#e63946', '#ff4fa3', '#ffd23f', '#ffffff']);
      ctx.beginPath();
      ctx.arc(x + i * (ww / 5), y + hh - 1, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  win(40, 150, 40, 50);
  win(170, 150, 40, 50);
  win(40, 40, 36, 44);
  win(170, 40, 36, 44);
  return toTexture(c, { wrap: true });
}

export function makeRoof() {
  const w = 128;
  const c = canvas(w, w);
  const ctx = c.getContext('2d');
  const rng = makeRng(81);
  ctx.fillStyle = '#5b3a2e';
  ctx.fillRect(0, 0, w, w);
  for (let y = 0; y < w; y += 10) {
    for (let x = (y / 10) % 2 ? 0 : -8; x < w; x += 16) {
      const g = 70 + rng() * 40;
      ctx.fillStyle = `rgb(${g + 25},${g * 0.6},${g * 0.45})`;
      ctx.fillRect(x + 1, y + 1, 14, 8);
    }
  }
  return toTexture(c);
}

export function makeCloud(seed) {
  const s = 256;
  const c = canvas(s, s);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  for (let i = 0; i < 22; i++) {
    const x = s * 0.2 + rng() * s * 0.6;
    const y = s * 0.35 + rng() * s * 0.3;
    const r = 25 + rng() * 55;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const shadeV = 235 - (y / s) * 40;
    g.addColorStop(0, `rgba(${shadeV + 20},${shadeV + 20},${shadeV + 25},0.55)`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, { wrap: false });
}

export function makeGrassBlade() {
  const w = 64;
  const h = 64;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const rng = makeRng(91);
  for (let i = 0; i < 16; i++) {
    const x = 8 + rng() * 48;
    const lean = (rng() - 0.5) * 16;
    const g = 110 + rng() * 80;
    ctx.strokeStyle = `rgb(${g * 0.55},${g},${g * 0.3})`;
    ctx.lineWidth = 2 + rng() * 2;
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.quadraticCurveTo(x + lean * 0.3, h * 0.5, x + lean, 6 + rng() * 20);
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = rng.pick(['#fff4f0', '#ffd23f', '#c77dff', '#ff6b6b']);
    ctx.beginPath();
    ctx.arc(10 + rng() * 44, 10 + rng() * 25, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, { wrap: false });
}

export function makeNameTag(name, color = '#ff5a1f') {
  const w = 256;
  const h = 64;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.font = '600 34px Rajdhani, sans-serif';
  const tw = Math.min(w - 12, ctx.measureText(name).width + 34);
  const x0 = (w - tw) / 2;
  ctx.fillStyle = 'rgba(8,12,20,0.72)';
  roundRect(ctx, x0, 10, tw, 44, 10);
  ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, x0, 10, 8, 44, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, w / 2 + 4, 33);
  const t = toTexture(c, { wrap: false });
  return t;
}

export function makeWaterNormal() {
  const w = 256;
  const noise = makeNoise2D(101);
  const hc = canvas(w, w);
  const ctx = hc.getContext('2d');
  const img = ctx.createImageData(w, w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    // tileable by sampling on a torus-ish domain
    const a = (x / w) * Math.PI * 2;
    const b = (y / w) * Math.PI * 2;
    const n = noise.fbm(Math.cos(a) * 2 + Math.sin(b) * 1.3, Math.sin(a) * 2 + Math.cos(b) * 1.3, 4) * 0.5 + 0.5;
    const i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(heightToNormal(hc, 6), { srgb: false });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt < 0) c.multiplyScalar(1 + amt);
  else c.lerp(new THREE.Color(1, 1, 1), amt);
  return '#' + c.getHexString();
}

// ---------------- Bike materials ----------------
/** 2x2 twill carbon weave (colour + normal). */
export function makeCarbon() {
  const s = 128;
  const col = canvas(s, s);
  const ctx = col.getContext('2d');
  const hc = canvas(s, s);
  const hctx = hc.getContext('2d');
  const n = 8;
  const cell = s / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const horiz = (x + y) % 4 < 2;
      const g = ctx.createLinearGradient(x * cell, y * cell, horiz ? x * cell : (x + 1) * cell, horiz ? (y + 1) * cell : y * cell);
      g.addColorStop(0, horiz ? '#2a2d33' : '#16181c');
      g.addColorStop(0.5, horiz ? '#3a3e46' : '#22252a');
      g.addColorStop(1, horiz ? '#24272c' : '#131417');
      ctx.fillStyle = g;
      ctx.fillRect(x * cell, y * cell, cell, cell);
      const hg = hctx.createLinearGradient(x * cell, y * cell, horiz ? x * cell : (x + 1) * cell, horiz ? (y + 1) * cell : y * cell);
      hg.addColorStop(0, '#333');
      hg.addColorStop(0.5, '#ddd');
      hg.addColorStop(1, '#333');
      hctx.fillStyle = hg;
      hctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const map = toTexture(col);
  map.repeat.set(6, 6);
  const normalMap = toTexture(heightToNormal(hc, 1.2), { srgb: false });
  normalMap.repeat.set(6, 6);
  return { map, normalMap };
}

/** Helmet shell: base colour with dark vent channels + a stripe. */
export function makeHelmet(color) {
  const w = 256;
  const h = 128;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, h * 0.8, w, h * 0.2);
  ctx.fillStyle = '#15171b';
  for (let i = 0; i < 7; i++) {
    const x = (i / 7) * w + 6;
    ctx.beginPath();
    ctx.ellipse(x + 12, h * 0.38, 7, h * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(0, h * 0.08, w, 5);
  return toTexture(c, { wrap: true });
}

/** Brake rotor with drilled holes (alpha). */
export function makeRotor() {
  const s = 128;
  const c = canvas(s, s);
  const ctx = c.getContext('2d');
  ctx.translate(s / 2, s / 2);
  ctx.fillStyle = '#c9ccd2';
  ctx.beginPath();
  ctx.arc(0, 0, 62, 0, Math.PI * 2);
  ctx.arc(0, 0, 18, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 48, Math.sin(a) * 48, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(Math.cos(a + 0.17) * 36, Math.sin(a + 0.17) * 36, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, { wrap: false });
}
