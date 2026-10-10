// Instanced, chunked vegetation with distance-based LOD.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng, makeNoise2D, smoothstep } from '@shared/math.js';
import { FLAG } from '@shared/track.js';
import { makeGrassBlade } from './textures.js';
import { themeFor } from './themes.js';
import { isMobile } from '../core/device.js';

const CHUNK = 200;

function colored(geo, color, jitter = 0, rng = null, darkenBottom = 0) {
  geo = geo.toNonIndexed();
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const pos = geo.attributes.position.array;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, pos[i * 3 + 1]);
    maxY = Math.max(maxY, pos[i * 3 + 1]);
  }
  for (let i = 0; i < n; i++) {
    const j = rng ? 1 + (rng() - 0.5) * jitter : 1;
    const t = (pos[i * 3 + 1] - minY) / Math.max(1e-3, maxY - minY);
    const shadeV = 1 - darkenBottom * (1 - t);
    col[i * 3] = c.r * j * shadeV;
    col[i * 3 + 1] = c.g * j * shadeV;
    col[i * 3 + 2] = c.b * j * shadeV;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function jitterVerts(geo, amt, rng) {
  const p = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(k)) map.set(k, [(rng() - 0.5) * amt, (rng() - 0.5) * amt, (rng() - 0.5) * amt]);
    const o = map.get(k);
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

function pineGeometry(lod) {
  const rng = makeRng(5);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.32, 2.6, lod ? 5 : 7).translate(0, 1.3, 0);
  parts.push(colored(trunk, '#5a3b24'));
  if (lod === 0) {
    const layers = [
      [2.7, 3.8, 2.4],
      [2.1, 3.4, 4.4],
      [1.45, 3.0, 6.3],
      [0.8, 2.2, 7.9],
    ];
    for (const [r, h, y] of layers) {
      const cone = new THREE.ConeGeometry(r, h, 9, 1).translate(0, y, 0);
      jitterVerts(cone, 0.25, rng);
      parts.push(colored(cone, '#2f5a2c', 0.18, rng, 0.45));
    }
  } else {
    const cone = new THREE.ConeGeometry(2.5, 7.6, 6, 1).translate(0, 5.1, 0);
    parts.push(colored(cone, '#2d5629', 0.1, rng, 0.35));
  }
  return mergeGeometries(parts);
}

function broadleafGeometry(lod) {
  const rng = makeRng(9);
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.35, 3.2, lod ? 5 : 7).translate(0, 1.6, 0);
  parts.push(colored(trunk, '#6b4a2f'));
  const blobs = lod
    ? [[0, 4.6, 0, 2.6]]
    : [
        [0, 4.5, 0, 2.2],
        [1.2, 5.2, 0.4, 1.7],
        [-1.0, 5.4, -0.5, 1.8],
        [0.2, 6.3, 0.2, 1.5],
      ];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, lod ? 0 : 1).translate(x, y, z);
    if (!lod) jitterVerts(g, 0.35, rng);
    parts.push(colored(g, '#4e7d2f', 0.2, rng, 0.4));
  }
  return mergeGeometries(parts);
}

function spruceGeometry(lod) {
  const rng = makeRng(7);
  const parts = [colored(new THREE.CylinderGeometry(0.15, 0.28, 3, lod ? 5 : 7).translate(0, 1.5, 0), '#4a3322')];
  const layers = lod ? [[1.9, 9.5, 5.6]] : [[1.9, 3.2, 2.6], [1.6, 3, 4.3], [1.3, 2.8, 5.9], [1.0, 2.6, 7.4], [0.65, 2.2, 8.8], [0.3, 1.6, 10]];
  for (const [r, h, y] of layers) {
    const cone = new THREE.ConeGeometry(r, h, lod ? 6 : 8, 1).translate(0, y, 0);
    if (!lod) jitterVerts(cone, 0.18, rng);
    parts.push(colored(cone, '#24452b', 0.16, rng, 0.5));
  }
  return mergeGeometries(parts);
}

function birchGeometry(lod) {
  const rng = makeRng(11);
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 5.5, lod ? 5 : 7).translate(0, 2.75, 0);
  const parts = [colored(trunk, '#e6e1d4', lod ? 0 : 0.35, rng)];
  const blobs = lod ? [[0, 5.6, 0, 2.1]] : [[0, 5.2, 0, 1.6], [0.8, 6.1, 0.3, 1.2], [-0.7, 6.4, -0.3, 1.3], [0.1, 7.2, 0.1, 1.0]];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, lod ? 0 : 1).translate(x, y, z);
    if (!lod) jitterVerts(g, 0.3, rng);
    parts.push(colored(g, '#8bb043', 0.22, rng, 0.35));
  }
  return mergeGeometries(parts);
}

function oliveGeometry(lod) {
  const rng = makeRng(23);
  const parts = [];
  // gnarled, leaning twin trunk
  parts.push(colored(new THREE.CylinderGeometry(0.16, 0.34, 2.2, lod ? 5 : 7).rotateZ(0.18).translate(0.15, 1.05, 0), '#6d6150'));
  if (!lod) parts.push(colored(new THREE.CylinderGeometry(0.12, 0.2, 1.8, 6).rotateZ(-0.35).translate(-0.35, 1.3, 0.1), '#6d6150'));
  const blobs = lod ? [[0, 2.8, 0, 2.2]] : [[0.3, 2.6, 0.2, 1.5], [-0.8, 2.9, -0.3, 1.3], [0.6, 3.2, -0.6, 1.2], [-0.2, 3.4, 0.6, 1.1], [0.1, 3.8, 0, 0.9]];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, lod ? 0 : 1).scale(1.25, 0.72, 1.25).translate(x, y, z);
    if (!lod) jitterVerts(g, 0.28, rng);
    parts.push(colored(g, '#7b8a5c', 0.2, rng, 0.35));
  }
  return mergeGeometries(parts);
}

function cypressGeometry(lod) {
  const rng = makeRng(29);
  const parts = [colored(new THREE.CylinderGeometry(0.12, 0.2, 1.5, 5).translate(0, 0.75, 0), '#4d3b2a')];
  const g = new THREE.SphereGeometry(1, lod ? 6 : 10, lod ? 5 : 9).scale(0.95, 5.2, 0.95).translate(0, 5.6, 0);
  if (!lod) jitterVerts(g, 0.12, rng);
  parts.push(colored(g, '#2d4a26', 0.15, rng, 0.4));
  return mergeGeometries(parts);
}

function cactusGeometry(lod) {
  const rng = makeRng(31);
  const seg = lod ? 6 : 10;
  const parts = [colored(new THREE.CapsuleGeometry(0.34, 5.5, 3, seg).translate(0, 3.1, 0), '#5f7a45', 0.12, rng)];
  if (!lod) {
    // saguaro arms: out, then up
    parts.push(colored(new THREE.CapsuleGeometry(0.22, 0.7, 3, seg).rotateZ(Math.PI / 2).translate(0.62, 2.9, 0), '#5f7a45'));
    parts.push(colored(new THREE.CapsuleGeometry(0.22, 1.5, 3, seg).translate(1.05, 3.8, 0), '#5f7a45'));
    parts.push(colored(new THREE.CapsuleGeometry(0.2, 0.6, 3, seg).rotateZ(Math.PI / 2).translate(-0.55, 3.6, 0), '#5f7a45'));
    parts.push(colored(new THREE.CapsuleGeometry(0.2, 1.1, 3, seg).translate(-0.9, 4.2, 0), '#5f7a45'));
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
}

function shrubGeometry() {
  const rng = makeRng(37);
  const parts = [];
  for (const [x, z, r] of [[0, 0, 0.6], [0.5, 0.2, 0.45], [-0.4, 0.3, 0.42], [0.1, -0.45, 0.4]]) {
    const g = new THREE.IcosahedronGeometry(r, 0).scale(1, 0.7, 1).translate(x, r * 0.55, z);
    jitterVerts(g, 0.18, rng);
    parts.push(colored(g, '#8c8f63', 0.25, rng, 0.45));
  }
  return mergeGeometries(parts);
}

function juniperGeometry(lod) {
  const rng = makeRng(41);
  const parts = [colored(new THREE.CylinderGeometry(0.14, 0.26, 1.4, 5).rotateZ(0.2).translate(0.1, 0.7, 0), '#5c4a3a')];
  const blobs = lod ? [[0, 2.0, 0, 1.4]] : [[0, 1.7, 0, 1.1], [0.5, 2.4, 0.2, 0.8], [-0.4, 2.3, -0.2, 0.85]];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, lod ? 0 : 1).translate(x, y, z);
    if (!lod) jitterVerts(g, 0.3, rng);
    parts.push(colored(g, '#4f5f3a', 0.2, rng, 0.4));
  }
  return mergeGeometries(parts);
}

function rockGeometry() {
  const rng = makeRng(13);
  const g = new THREE.DodecahedronGeometry(1, 1);
  jitterVerts(g, 0.45, rng);
  g.scale(1, 0.62, 1);
  return colored(g, '#8a857c', 0.15, rng, 0.3);
}

function bushGeometry() {
  const rng = makeRng(17);
  const g = new THREE.IcosahedronGeometry(1, 1);
  jitterVerts(g, 0.35, rng);
  g.scale(1, 0.7, 1).translate(0, 0.45, 0);
  return colored(g, '#446f2b', 0.25, rng, 0.5);
}

function grassGeometry() {
  const a = new THREE.PlaneGeometry(1.1, 0.7).translate(0, 0.35, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const c = a.clone().rotateY(Math.PI / 4);
  return mergeGeometries([a, b, c]);
}

/** Adds subtle wind sway to instanced foliage. */
const WIND = { value: 0.35 };

function addWind(material, amp) {
  material.userData.time = { value: 0 };
  material.userData.wind = WIND;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = material.userData.time;
    shader.uniforms.uWind = WIND;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ph = instanceMatrix[3].xz * 0.05;
        #else
          vec2 ph = vec2(0.0);
        #endif
        float sway = (sin(uTime * (1.0 + uWind) + ph.x + ph.y) * 0.6 + sin(uTime * (2.0 + uWind * 2.0) + ph.x * 1.7) * 0.3) * (0.4 + uWind * 1.8);
        transformed.x += sway * ${amp.toFixed(4)} * transformed.y * transformed.y;
        transformed.z += sway * ${(amp * 0.6).toFixed(4)} * transformed.y * transformed.y;`,
      );
  };
  return material;
}

export class Vegetation {
  constructor(terrain, track, exclusions = [], crowd = null) {
    this.terrain = terrain;
    this.track = track;
    this.exclusions = exclusions; // [{x,z,r}]
    this.crowd = crowd; // Set of "x,z" 1 m cells where spectators stand
    this.group = new THREE.Group();
    this.chunks = [];
    this.materials = [];
    this.quality = 'high';
  }

  _excluded(x, z) {
    if (this.crowd?.has(`${Math.floor(x)},${Math.floor(z)}`)) return true;
    for (const e of this.exclusions) if ((x - e.x) ** 2 + (z - e.z) ** 2 < e.r * e.r) return true;
    return false;
  }

  build() {
    const T = this.terrain;
    const W = T.W;
    const TH = themeFor(this.track);
    const V = TH.vegetation;
    const rng = makeRng(2024);
    const noise = makeNoise2D(606);
    const types = {
      pine: { geo: [pineGeometry(0), pineGeometry(1)], items: [] },
      leaf: { geo: [broadleafGeometry(0), broadleafGeometry(1)], items: [] },
      spruce: { geo: [spruceGeometry(0), spruceGeometry(1)], items: [] },
      birch: { geo: [birchGeometry(0), birchGeometry(1)], items: [] },
      rock: { geo: [rockGeometry()], items: [] },
      bush: { geo: [bushGeometry()], items: [] },
      grass: { geo: [grassGeometry()], items: [] },
      olive: { geo: [oliveGeometry(0), oliveGeometry(1)], items: [] },
      cypress: { geo: [cypressGeometry(0), cypressGeometry(1)], items: [] },
      cactus: { geo: [cactusGeometry(0), cactusGeometry(1)], items: [] },
      juniper: { geo: [juniperGeometry(0), juniperGeometry(1)], items: [] },
      shrub: { geo: [shrubGeometry()], items: [] },
    };
    // footprint radius of each type at scale 1 (from its geometry), so nothing overhangs the riding area
    for (const ty of Object.values(types)) {
      const g = ty.geo[0];
      g.computeBoundingBox();
      const b = g.boundingBox;
      ty.radius = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z);
    }
    const reach = this.track.limit + 0.4; // riders reach |d| <= limit; keep a little air beyond it
    /** Size that keeps the item clear of the riding area (0 = does not fit). */
    const fit = (ty, dist, sz) => {
      const room = dist - reach;
      if (ty.radius * sz <= room) return sz;
      const smaller = room / ty.radius;
      return smaller >= sz * 0.55 ? smaller : 0;
    };
    // weighted species picker for this map
    const species = Object.entries(V.species).filter(([k]) => types[k] && k !== 'shrub' && k !== 'bush');
    const totalW = species.reduce((a, [, w]) => a + w, 0);
    const pickSpecies = (h, n3) => {
      let r = n3 * totalW;
      for (const [k, w] of species) {
        if ((k === 'leaf' || k === 'birch') && h > V.leafyBelow + 40) continue;
        r -= w;
        if (r <= 0) return types[k];
      }
      return types[species[0][0]];
    };
    const isMountain = this.track.def.env?.theme === 'mountain';
    const seaLevel = T.sea ? T.sea.level : -1e9;
    const inner = T.innerBounds;
    const lakeLevel = T.lake ? T.lake.level : -1e9;

    const place = (x, z, dist, flags) => {
      const h = T.heightAt(x, z);
      if (h < lakeLevel + 0.8 || h < T.riverLow + 2 || h < seaLevel + 1.5) return;
      const slope = T.slopeAt(x, z);
      const forestZone = flags & FLAG.FOREST ? 1 : 0;
      const village = flags & FLAG.VILLAGE;
      const n = noise.fbm(x / 160, z / 160, 3) * 0.5 + 0.5;
      const n2 = noise(x / 40 + 9, z / 40) * 0.5 + 0.5;
      if (this._excluded(x, z)) return;
      const minRoad = village ? W + 26 : V.closeToRoad ? W + 2.5 : W + 5;
      if (dist < minRoad) return;
      // rocks on steep ground & near cliffs
      if (slope > 0.55 || (flags & FLAG.CLIFF && rng() < 0.12)) {
        if (rng() < 0.18) {
          const sz = fit(types.rock, dist, 0.8 + rng() * 2.8);
          if (sz) types.rock.items.push([x, h, z, sz, rng()]);
        }
        return;
      }
      if (h > V.treeLine + n * 60) {
        if (rng() < 0.04) {
          const sz = fit(types.rock, dist, 1 + rng() * 3);
          if (sz) types.rock.items.push([x, h, z, sz, rng()]);
        }
        return;
      }
      let density = (smoothstep(0.42, 0.72, n) * 0.85 + forestZone * 0.55 + (dist < 60 ? 0.1 : 0)) * V.density;
      if (village) density *= 0.25;
      if (species.length && rng() < density) {
        const n3 = noise(x / 70 - 13, z / 70 + 5) * 0.5 + 0.5;
        let kind;
        if (isMountain) {
          const leafy = h < 30 && n2 > 0.55;
          kind = leafy ? (n3 > 0.55 ? types.birch : types.leaf) : n3 > 0.52 || h > 55 ? types.spruce : types.pine;
        } else kind = pickSpecies(h, (n3 + rng() * 0.35) % 1);
        // natural size variation: a few veterans, many young trees
        const sz = fit(kind, dist, 0.65 + rng() * 0.6 + (rng() < 0.08 ? 0.45 : 0));
        if (sz) kind.items.push([x, h, z, sz, rng()]);
      } else if (rng() < 0.06 * Math.max(0.4, V.density) + (V.species.shrub || 0) * 0.08) {
        const ty = V.species.shrub ? types.shrub : types.bush;
        const sz = fit(ty, dist, 0.7 + rng() * 1.1);
        if (sz) ty.items.push([x, h, z, sz, rng()]);
      } else if (rng() < 0.015) {
        const sz = fit(types.rock, dist, 0.4 + rng() * 1.2);
        if (sz) types.rock.items.push([x, h, z, sz, rng()]);
      }
    };

    // inner detailed area
    const sp = 8;
    for (let z = inner.cz - inner.half + 4; z < inner.cz + inner.half - 4; z += sp) {
      for (let x = inner.cx - inner.half + 4; x < inner.cx + inner.half - 4; x += sp) {
        const jx = x + (rng() - 0.5) * sp * 0.9;
        const jz = z + (rng() - 0.5) * sp * 0.9;
        place(jx, jz, T.roadDistSmooth(jx, jz), T.roadFlagsAt(jx, jz));
      }
    }
    // grass tufts along the road
    for (let i = 0; i < this.track.count; i += 1) {
      const f = this.track.FLAGS[i];
      if (f & (FLAG.TUNNEL | FLAG.BRIDGE | FLAG.URBAN)) continue;
      for (let k = 0; k < V.grassPerMetre; k++) {
        if (k >= 1 && rng() > V.grassPerMetre - Math.floor(V.grassPerMetre)) continue;
        const side = rng() < 0.5 ? -1 : 1;
        const d = side * (W + 0.8 + rng() * 14);
        const p = this.track.toWorld(i * this.track.ds + rng(), d);
        const h = T.heightAt(p.x, p.z);
        if (h < lakeLevel + 0.5) continue;
        if (Math.abs(h - p.y) > 3 && rng() < 0.7) continue;
        types.grass.items.push([p.x, h, p.z, 0.8 + rng() * 0.9, rng()]);
      }
    }
    // outer ring: sparse far forests (low LOD only) in the map's dominant tree
    const farKind = V.species.spruce ? 'spruce' : V.species.pine ? 'pine' : V.species.olive ? 'olive' : V.species.juniper ? 'juniper' : null;
    for (let i = 0; farKind && i < 9000 * Math.min(1.4, V.density); i++) {
      const a = rng() * Math.PI * 2;
      const r = inner.half + rng() * 1300;
      const x = inner.cx + Math.cos(a) * r;
      const z = inner.cz + Math.sin(a) * r;
      const h = T.heightAt(x, z);
      if (h > V.treeLine - 30 || h < seaLevel + 2 || T.slopeAt(x, z) > 0.6) continue;
      if (noise.fbm(x / 200, z / 200, 2) < -0.05) continue;
      types[farKind].items.push([x, h, z, 0.9 + rng() * 0.9, rng(), true]);
    }

    // ---- materials ----
    const foliage = addWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: false }), 0.0022);
    const foliageFar = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const grassTex = makeGrassBlade();
    const grassMat = addWind(
      new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, color: V.grass }),
      0.06,
    );
    this.materials = [foliage, grassMat];

    // ---- chunk + instance ----
    const chunkMap = new Map();
    const getChunk = (x, z) => {
      const cx = Math.floor(x / CHUNK);
      const cz = Math.floor(z / CHUNK);
      const k = `${cx},${cz}`;
      if (!chunkMap.has(k)) {
        chunkMap.set(k, {
          center: new THREE.Vector3((cx + 0.5) * CHUNK, 0, (cz + 0.5) * CHUNK),
          lists: {},
          meshes: [],
        });
      }
      return chunkMap.get(k);
    };
    for (const [name, t] of Object.entries(types)) {
      for (const it of t.items) {
        const c = getChunk(it[0], it[2]);
        (c.lists[name] ||= []).push(it);
      }
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const mk = (geo, mat, items, opts) => {
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      let sumY = 0;
      items.forEach((it, i) => {
        q.setFromAxisAngle(yAxis, it[4] * Math.PI * 2);
        const s = it[3];
        if (opts.rock) {
          sc.set(s * (0.8 + it[4] * 0.6), s * (0.7 + (1 - it[4]) * 0.5), s);
          p.set(it[0], it[1] - s * 0.2, it[2]);
        } else {
          sc.set(s, s * (0.9 + it[4] * 0.25), s);
          p.set(it[0], it[1] - 0.15, it[2]);
        }
        m4.compose(p, q, sc);
        mesh.setMatrixAt(i, m4);
        const v = 0.85 + it[4] * 0.3;
        col.setRGB(v, v * (0.95 + it[4] * 0.1), v * 0.9);
        mesh.setColorAt(i, col);
        sumY += it[1];
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = !!opts.shadow;
      mesh.receiveShadow = false;
      mesh.userData.lod = opts.lod;
      mesh.userData.kind = opts.kind;
      mesh.userData.avgY = sumY / Math.max(1, items.length);
      return mesh;
    };
    for (const c of chunkMap.values()) {
      const L = c.lists;
      if (L.pine) {
        const near = L.pine.filter((it) => !it[5]);
        if (near.length) c.meshes.push(mk(types.pine.geo[0], foliage, near, { lod: 0, shadow: true, kind: 'tree' }));
        c.meshes.push(mk(types.pine.geo[1], foliageFar, L.pine, { lod: 1, kind: 'tree' }));
      }
      for (const name of ['leaf', 'spruce', 'birch', 'olive', 'cypress', 'cactus', 'juniper']) {
        if (!L[name]) continue;
        const near = L[name].filter((it) => !it[5]);
        if (near.length) c.meshes.push(mk(types[name].geo[0], foliage, near, { lod: 0, shadow: true, kind: 'tree' }));
        c.meshes.push(mk(types[name].geo[1], foliageFar, L[name], { lod: 1, kind: 'tree' }));
      }
      if (L.shrub) c.meshes.push(mk(types.shrub.geo[0], foliageFar, L.shrub, { lod: 2, kind: 'bush' }));
      if (L.rock) c.meshes.push(mk(types.rock.geo[0], rockMat, L.rock, { lod: 2, shadow: true, rock: true, kind: 'rock' }));
      if (L.bush) c.meshes.push(mk(types.bush.geo[0], foliageFar, L.bush, { lod: 2, kind: 'bush' }));
      if (L.grass) c.meshes.push(mk(types.grass.geo[0], grassMat, L.grass, { lod: 3, kind: 'grass' }));
      let y = 0;
      for (const m of c.meshes) {
        this.group.add(m);
        y += m.userData.avgY;
      }
      c.center.y = y / Math.max(1, c.meshes.length);
      this.chunks.push(c);
    }
    this.stats = Object.fromEntries(Object.entries(types).map(([k, v]) => [k, v.items.length]));
    return this.group;
  }

  setWind(w) {
    WIND.value = w;
  }

  setQuality(q) {
    this.quality = q;
  }

  update(camPos, time) {
    for (const m of this.materials) m.userData.time.value = time;
    const q = this.quality;
    // mobile: same forests, slightly shorter detail distances (fog hides the difference)
    const m = isMobile() ? 0.8 : 1;
    const nearR = (q === 'low' ? 150 : q === 'medium' ? 240 : q === 'high' ? 330 : 460) * m;
    const farR = (q === 'low' ? 900 : q === 'ultra' ? 2400 : 1900) * m;
    const grassR = (q === 'low' ? 0 : q === 'medium' ? 110 : q === 'high' ? 170 : 240) * m;
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - camPos.x, c.center.z - camPos.z) - CHUNK * 0.7;
      for (const m of c.meshes) {
        const lod = m.userData.lod;
        if (lod === 0) m.visible = d < nearR;
        else if (lod === 1) m.visible = d >= nearR && d < farR;
        else if (lod === 2) m.visible = d < (q === 'low' ? 350 : 700);
        else m.visible = d < grassR;
      }
    }
  }
}
