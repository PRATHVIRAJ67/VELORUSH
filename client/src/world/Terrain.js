// Procedural terrain shaped around the track, driven by the map definition (env)
// and its visual theme: alpine relief, sea cliffs, canyon strata, forest hills, city ground.
import * as THREE from 'three';
import { makeNoise2D, makeRng, smoothstep, clamp, lerp } from '@shared/math.js';
import { FLAG } from '@shared/track.js';
import { makeTerrainDetail } from './textures.js';
import { themeFor } from './themes.js';

const r25 = (v) => Math.round(v / 25) * 25;

export class Terrain {
  constructor(track) {
    this.track = track;
    this.env = track.def.env || {};
    this.theme = themeFor(track);
    this.noise = makeNoise2D(track.def.seed);
    this.noise2 = makeNoise2D(track.def.seed + 17);
    this.W = track.halfWidth + track.shoulder; // flattened corridor half width
    this._bounds();
    this._prepRoad();
    this._prepFeatures();
  }

  _bounds() {
    const t = this.track;
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
    const cx = r25((minX + maxX) / 2);
    const cz = r25((minZ + maxZ) / 2);
    const half = Math.max(600, Math.ceil((Math.max(maxX - minX, maxZ - minZ) / 2 + 320) / 25) * 25);
    // keep the detailed grid around ~250 cells per side (5 m or 6.25 m cells, aligned to the 25 m outer grid)
    const cell = half <= 650 ? 5 : 6.25;
    this.INNER = { cx, cz, half, cell };
    this.OUTER = { cx, cz, half: half + 2000, cell: 25 };
    this.extent = { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, r: Math.max(maxX - minX, maxZ - minZ) / 2 };
  }

  _prepRoad() {
    const t = this.track;
    const step = 3;
    const fine = [];
    const bridgeSamples = [];
    for (let i = 0; i < t.count; i += step) {
      const f = t.FLAGS[i];
      const rec = { x: t.X[i], y: t.Y[i], z: t.Z[i], hx: t.HX[i], hz: t.HZ[i], flags: f, s: i * t.ds };
      if (f & FLAG.BRIDGE) bridgeSamples.push(rec);
      else fine.push(rec);
    }
    this.fine = fine;
    this.bridgeSamples = bridgeSamples;
    this.cellSize = 30;
    this.hash = new Map();
    for (const r of fine) {
      const k = this._key(Math.floor(r.x / this.cellSize), Math.floor(r.z / this.cellSize));
      if (!this.hash.has(k)) this.hash.set(k, []);
      this.hash.get(k).push(r);
    }
    this.coarse = [];
    for (let i = 0; i < t.count; i += 24) {
      if (t.FLAGS[i] & FLAG.BRIDGE) continue;
      this.coarse.push({ x: t.X[i], y: t.Y[i], z: t.Z[i] });
    }
  }

  _key(ix, iz) {
    return ix * 73856093 + iz * 19349663;
  }

  _prepFeatures() {
    const env = this.env;
    // --- gorge under the bridge (waterfall / river / stream / dry wash / sea inlet) ---
    const b = this.bridgeSamples;
    if (b.length && env.gorge) {
      const mid = b[Math.floor(b.length / 2)];
      const g = env.gorge;
      this.bridge = { x: mid.x, z: mid.z, y: mid.y, tx: mid.hx, tz: mid.hz, rx: -mid.hz, rz: mid.hx, len: b.length * 3 };
      const seaLevel = env.sea ? env.sea.level : null;
      this.riverLow = g.toSea ? seaLevel - 3 : mid.y - g.depth;
      this.riverHigh = g.toSea ? seaLevel - 3 : mid.y - g.upper;
      this.waterfallAlong = g.waterfallAlong;
      this.gorge = g;
    } else {
      this.bridge = null;
      this.riverLow = -1e9;
      this.riverHigh = -1e9;
    }
    // --- lake ---
    this.lake = env.lake || null;
    // --- sea ---
    this.sea = env.sea || null;
    // --- backdrop mountain ranges ---
    if (Array.isArray(env.peaks)) this.peaks = env.peaks;
    else {
      const rng = makeRng(this.track.def.seed + 5);
      const [hMin, hMax] = env.peakHeight || [500, 800];
      const E = this.extent;
      this.peaks = [];
      for (let i = 0; i < 14; i++) {
        let a = (i / 14) * Math.PI * 2 + rng() * 0.35;
        if (env.peakSide === 'north') a = Math.PI + (i / 13) * Math.PI; // inland only (sea to the south)
        const R = E.r + 650 + rng() * 1100;
        this.peaks.push([E.cx + Math.cos(a) * R, E.cz + Math.sin(a) * R, hMin + rng() * (hMax - hMin), 380 + rng() * 360]);
      }
    }
    // --- great canyon beyond the rim (canyon map) ---
    if (env.mesas) this.trench = { z0: this.extent.maxZ + 260, amp: 70, width: 210, floor: 4 };
  }

  riverInfo(x, z) {
    const B = this.bridge;
    const px = x - B.x;
    const pz = z - B.z;
    const along = px * B.rx + pz * B.rz;
    let across = px * B.tx + pz * B.tz;
    across -= Math.sin(along / 70) * 9 * smoothstep(20, 120, Math.abs(along));
    const floorY = along < this.waterfallAlong ? this.riverHigh : this.riverLow;
    return { along, across, floorY };
  }

  /** Signed distance past the (wobbly) coastline: > 0 is sea. */
  seaDist(x, z) {
    const S = this.sea;
    const n = this.noise;
    return x * S.nx + z * S.nz - S.d - Math.sin(x / 140) * S.wobble - n(x / 260, 3.3) * S.wobble * 0.8;
  }

  /** The master height function. Returns {h, dist, flags}. */
  compute(x, z) {
    const W = this.W;
    const T = this.theme;
    const R = T.relief;
    // ---- nearby road (fine IDW) ----
    const cs = this.cellSize;
    const ix = Math.floor(x / cs);
    const iz = Math.floor(z / cs);
    let minD2 = Infinity;
    let near = null;
    let sw = 0;
    let swy = 0;
    for (let a = -3; a <= 3; a++) {
      for (let b = -3; b <= 3; b++) {
        const list = this.hash.get(this._key(ix + a, iz + b));
        if (!list) continue;
        for (const r of list) {
          const dx = r.x - x;
          const dz = r.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < minD2) {
            minD2 = d2;
            near = r;
          }
          const w = 1 / ((d2 + 9) * (d2 + 9));
          sw += w;
          swy += w * r.y;
        }
      }
    }
    // ---- coarse global IDW (smooth far field) ----
    let cw = 0;
    let cwy = 0;
    let cMin = Infinity;
    for (const r of this.coarse) {
      const dx = r.x - x;
      const dz = r.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < cMin) cMin = d2;
      const w = 1 / Math.pow(d2 + 900, 1.6);
      cw += w;
      cwy += w * r.y;
    }
    const coarseY = cwy / cw;
    const dist = near ? Math.sqrt(minD2) : Math.sqrt(cMin);
    const fineY = sw > 0 ? swy / sw : coarseY;
    let baseY = lerp(fineY, coarseY, smoothstep(40, 85, dist));
    if (near) baseY = lerp(near.y - 0.2, baseY, smoothstep(W - 1, W + 6, dist));
    const flags = near ? near.flags : 0;

    // ---- natural relief ----
    const n = this.noise;
    // relief may only start one full grid cell beyond the road edge (no triangle leans over the shoulder)
    const pad = this.INNER.cell;
    let corridor = W + pad;
    if (flags & FLAG.VILLAGE) corridor = W + 22;
    if (T.flatCity) corridor = W + 70; // city blocks sit on level ground
    const rise = smoothstep(corridor, corridor + 40, dist);
    const hills = (n.fbm(x / R.hillScale, z / R.hillScale, 4) * 0.5 + 0.55) * R.hills * rise;
    const farD = Math.sqrt(cMin);
    let mountains = n.ridged(x / R.mountScale, z / R.mountScale, 5) * R.mountains * smoothstep(R.near, R.far, farD);
    let peaks = 0;
    for (const [px, pz, h, r] of this.peaks) {
      const d2 = ((x - px) ** 2 + (z - pz) ** 2) / (r * r);
      if (d2 < 9) peaks += h * Math.exp(-d2 * 1.4) * (0.85 + 0.3 * n.ridged(x / 160, z / 160, 3));
    }
    mountains += peaks * smoothstep(corridor, corridor + 160, dist);
    if (this.env.mesas) {
      // flat-topped plateaus: relief is capped at a noisy mesa-top height
      const cap = 60 + (n.fbm(x / 500 + 9, z / 500) * 0.5 + 0.5) * 110;
      mountains = Math.min(mountains, cap);
    }
    let offset = hills + mountains;

    if (near && flags & FLAG.CLIFF) {
      const side = (x - near.x) * -near.hz + (z - near.z) * near.hx;
      const wall = smoothstep(W + pad, W + 9 + pad, dist);
      if (side < 0) offset += wall * (38 + n.fbm(x / 20, z / 20, 3) * 10);
      else offset -= smoothstep(W + 1 + pad, W + 21 + pad, dist) * 26;
    }
    if (near && flags & FLAG.TUNNEL) {
      offset = Math.max(offset, smoothstep(W + pad, W + 9 + pad, dist) * (56 + n.fbm(x / 25, z / 25) * 6));
    }
    let h = baseY - 0.35 + offset;

    // ---- sedimentary terraces (canyon): benches + steep risers away from the road ----
    if (T.strata) {
      const step = T.strata.step;
      const t = h / step;
      const fl = Math.floor(t);
      const terr = (fl + smoothstep(0.55, 1, t - fl)) * step;
      h = lerp(h, terr, smoothstep(W + 4, W + 30, dist));
    }
    // ---- the great canyon trench beyond the rim ----
    if (this.trench) {
      const C = this.trench;
      const across = Math.abs(z - (C.z0 + Math.sin(x / 300) * C.amp + n(x / 200, 7) * 30));
      if (across < C.width) {
        const k = Math.pow(across / C.width, 0.85);
        const step = T.strata ? T.strata.step : 14;
        let cut = C.floor + k * (h - C.floor);
        const tt = cut / step;
        cut = (Math.floor(tt) + smoothstep(0.5, 1, tt - Math.floor(tt))) * step;
        h = lerp(h, Math.min(h, cut), smoothstep(W + 40, W + 120, dist));
      }
    }

    // ---- gorge + river ----
    if (this.bridge) {
      const Rv = this.riverInfo(x, z);
      const toSea = this.gorge.toSea;
      const a0 = toSea ? -260 : -330;
      const a1 = toSea ? 900 : 420;
      if (Rv.along > a0 && Rv.along < a1) {
        const endFade = smoothstep(a0, a0 + 80, Rv.along) * (toSea ? 1 : 1 - smoothstep(a1 - 90, a1, Rv.along));
        const wf = this.waterfallAlong;
        const wallSteep = Rv.along < wf + 30 && Rv.along > wf - 40 ? 2.4 : this.gorge.stream ? 0.9 : 1.25;
        const floorW = this.gorge.stream ? 4 : 8;
        const canyon = Rv.floorY + Math.max(0, Math.abs(Rv.across) - floorW) * wallSteep + n.fbm(x / 30, z / 30) * 3;
        const protect = smoothstep(W + 2, W + 20, dist);
        h = lerp(h, Math.min(h, canyon), endFade * protect);
      }
      let dB = Infinity;
      let bY = 0;
      for (const r of this.bridgeSamples) {
        const d2 = (r.x - x) ** 2 + (r.z - z) ** 2;
        if (d2 < dB) {
          dB = d2;
          bY = r.y;
        }
      }
      dB = Math.sqrt(dB);
      if (dB < W + 16) h = Math.min(h, lerp(bY - 4, h, smoothstep(W + 3, W + 16, dB)));
    }
    // ---- sea cliffs ----
    if (this.sea) {
      const sd = this.seaDist(x, z);
      // seaward flank: the land falls away from the road toward the cliff edge (no ridge hiding the sea)
      const seaSide = smoothstep(-110, -35, sd);
      if (seaSide > 0) {
        const flank = baseY - 0.35 - Math.max(0, dist - W - 4) * 0.22;
        h = lerp(h, Math.min(h, flank), seaSide);
      }
      if (sd > -45) {
        const lvl = this.sea.level;
        // steep rock cliffs above the waterline, shelving seabed below
        const cliff = sd < 0 ? lvl + 1.5 + -sd * (2.2 + n(x / 60, z / 60) * 0.8) : lvl - 3 - sd * 0.28;
        const protect = smoothstep(W + 3, W + 24, dist);
        h = lerp(h, Math.min(h, cliff), protect);
      }
    }
    // ---- lake ----
    const L = this.lake;
    if (L) {
      const le = Math.hypot((x - L.x) / L.rx, (z - L.z) / L.rz);
      if (le < 1.6) {
        const bed = L.level - 5 * (1 - smoothstep(0, 1, le)) - 0.5;
        h = lerp(Math.min(h, bed), h, smoothstep(0.95, 1.55, le));
      }
    }
    return { h, dist, flags };
  }

  _buildGrid(G, withDist) {
    const I = this.INNER;
    const n = Math.round((G.half * 2) / G.cell) + 1;
    const heights = new Float32Array(n * n);
    const dists = withDist ? new Float32Array(n * n) : null;
    const flags = withDist ? new Uint8Array(n * n) : null;
    for (let j = 0; j < n; j++) {
      const z = G.cz - G.half + j * G.cell;
      for (let i = 0; i < n; i++) {
        const x = G.cx - G.half + i * G.cell;
        const res = this.compute(x, z);
        // hidden under the detailed inner terrain: sink it
        if (!withDist && Math.abs(x - I.cx) < I.half - 1 && Math.abs(z - I.cz) < I.half - 1) res.h -= 45;
        heights[j * n + i] = res.h;
        if (dists) {
          dists[j * n + i] = res.dist;
          flags[j * n + i] = res.flags;
        }
      }
    }
    return { n, heights, dists, flags, G };
  }

  build(onProgress) {
    onProgress?.(0.1);
    this.inner = this._buildGrid(this.INNER, true);
    onProgress?.(0.6);
    this.outer = this._buildGrid(this.OUTER, false);
    onProgress?.(0.8);
    const detail = makeTerrainDetail();
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0 });
    const group = new THREE.Group();
    const innerMesh = this._mesh(this.inner, 4);
    innerMesh.receiveShadow = true;
    group.add(innerMesh);
    const outerMesh = this._mesh(this.outer, 40);
    group.add(outerMesh);
    this.group = group;
    onProgress?.(1);
    return group;
  }

  _mesh(grid, uvScale) {
    const { n, heights, G } = grid;
    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = G.cx - G.half + i * G.cell;
        const z = G.cz - G.half + j * G.cell;
        pos[k * 3] = x;
        pos[k * 3 + 1] = heights[k];
        pos[k * 3 + 2] = z;
        uv[k * 2] = x / uvScale;
        uv[k * 2 + 1] = z / uvScale;
      }
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let p = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        idx[p++] = a;
        idx[p++] = c;
        idx[p++] = b;
        idx[p++] = b;
        idx[p++] = c;
        idx[p++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    this._colorize(geo, grid);
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, this.material);
  }

  _colorize(geo, grid) {
    const T = this.theme;
    const P = T.palette;
    const pos = geo.attributes.position.array;
    const nrm = geo.attributes.normal.array;
    const count = pos.length / 3;
    const col = new Float32Array(count * 3);
    const n2 = this.noise2;
    const c = new THREE.Color();
    const C = (h) => new THREE.Color(h);
    const grassA = C(P.grassA);
    const grassB = C(P.grassB);
    const dry = C(P.dry);
    const forest = C(P.forest);
    const rock = C(P.rock);
    const rockDark = C(P.rockDark);
    const snow = C(P.snow);
    const dirt = C(P.dirt);
    const sand = C(P.sand);
    const bands = T.strata ? T.strata.bands.map(C) : null;
    const urban = C('#2f3134');
    const pave = C('#45474b');
    for (let k = 0; k < count; k++) {
      const x = pos[k * 3];
      const y = pos[k * 3 + 1];
      const z = pos[k * 3 + 2];
      const ny = nrm[k * 3 + 1];
      const nv = n2.fbm(x / 90, z / 90, 3) * 0.5 + 0.5;
      const nv2 = n2(x / 14, z / 14) * 0.5 + 0.5;
      c.copy(grassA).lerp(grassB, nv);
      c.lerp(dry, smoothstep(0.62, 0.9, n2(x / 300 + 7, z / 300)) * 0.6);
      c.lerp(forest, smoothstep(0.55, 0.8, nv2) * 0.35);
      c.lerp(rock, smoothstep(T.alpineRock[0], T.alpineRock[1], y) * 0.5);
      const steep = smoothstep(0.86, 0.66, ny);
      if (bands) {
        // sedimentary layering: bands by altitude, wobbling with noise; benches stay dusty
        const bi = Math.floor((y + n2(x / 120, z / 120) * 5) / (T.strata.step / 2));
        const band = bands[((bi % bands.length) + bands.length) % bands.length];
        c.lerp(band, 0.35 + steep * 0.65);
      } else c.lerp(nv2 > 0.5 ? rock : rockDark, steep);
      if (T.snowLine) {
        const snowLine = T.snowLine + nv * 90;
        c.lerp(snow, smoothstep(snowLine, snowLine + 40, y) * smoothstep(0.45, 0.7, ny));
      }
      let d = 999;
      if (grid.dists) {
        d = grid.dists[k];
        c.lerp(dirt, smoothstep(this.W + 4, this.W + 0.5, d) * 0.7);
      }
      if (T.flatCity) {
        // paved city blocks near the streets, parks further out
        const park = smoothstep(0.62, 0.75, n2(x / 160, z / 160) * 0.5 + 0.5);
        c.lerp(nv2 > 0.45 ? pave : urban, smoothstep(this.W + 95, this.W + 40, d) * (1 - park));
      }
      if (this.lake) {
        const L = this.lake;
        const le = Math.hypot((x - L.x) / L.rx, (z - L.z) / L.rz);
        if (le < 1.25 && y < L.level + 1.6) c.lerp(sand, 0.8);
      }
      if (this.bridge && y < this.riverLow + 2.5) c.lerp(sand, 0.8);
      if (this.sea && y < this.sea.level + 3.5) c.lerp(sand, smoothstep(this.sea.level - 2, this.sea.level + 1, y) * 0.9);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  _sampleGrid(grid, x, z) {
    const { n, heights, G } = grid;
    const fx = (x - (G.cx - G.half)) / G.cell;
    const fz = (z - (G.cz - G.half)) / G.cell;
    const i = clamp(Math.floor(fx), 0, n - 2);
    const j = clamp(Math.floor(fz), 0, n - 2);
    const tx = clamp(fx - i, 0, 1);
    const tz = clamp(fz - j, 0, 1);
    const a = heights[j * n + i];
    const b = heights[j * n + i + 1];
    const c = heights[(j + 1) * n + i];
    const d = heights[(j + 1) * n + i + 1];
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  _inInner(x, z) {
    const I = this.INNER;
    return Math.abs(x - I.cx) < I.half && Math.abs(z - I.cz) < I.half;
  }

  heightAt(x, z) {
    return this._sampleGrid(this._inInner(x, z) ? this.inner : this.outer, x, z);
  }

  roadDistAt(x, z) {
    if (!this._inInner(x, z)) return 999;
    const I = this.INNER;
    const g = this.inner;
    const fx = Math.round((x - (I.cx - I.half)) / I.cell);
    const fz = Math.round((z - (I.cz - I.half)) / I.cell);
    return g.dists[fz * g.n + fx];
  }

  /** Distance to the road centre line, interpolated between grid nodes (roadDistAt snaps to the nearest node). */
  roadDistSmooth(x, z) {
    if (!this._inInner(x, z)) return 999;
    const I = this.INNER;
    const { n, dists } = this.inner;
    const fx = (x - (I.cx - I.half)) / I.cell;
    const fz = (z - (I.cz - I.half)) / I.cell;
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(n - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i));
    const tz = Math.max(0, Math.min(1, fz - j));
    const a = dists[j * n + i];
    const b = dists[j * n + i + 1];
    const c = dists[(j + 1) * n + i];
    const d = dists[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  roadFlagsAt(x, z) {
    if (!this._inInner(x, z)) return 0;
    const I = this.INNER;
    const g = this.inner;
    const fx = Math.round((x - (I.cx - I.half)) / I.cell);
    const fz = Math.round((z - (I.cz - I.half)) / I.cell);
    return g.flags[fz * g.n + fx];
  }

  slopeAt(x, z) {
    const e = 2;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(hx, hz) / (2 * e);
  }

  get innerBounds() {
    return this.INNER;
  }
}
