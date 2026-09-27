// Trackside props: barriers, signs, gantries, village, spectators, tunnel, bridge, waterfall.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLAG } from '@shared/track.js';
import { makeRng } from '@shared/math.js';
import {
  makeBanner, makeBoard, makeChevron, makeChaletWall, makeRoof, makeRockTexture, makeConcrete, makeWaterNormal, canvas, toTexture,
} from './textures.js';
import { makeWall, makeRoofTiles } from './archTextures.js';
import { themeFor } from './themes.js';
import { buildEnvironment } from './builders/index.js';

/** Collects geometry per material and merges it into few draw calls. */
export class Batch {
  constructor() {
    this.lists = new Map();
  }
  add(mat, geo, matrix) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (matrix) g.applyMatrix4(matrix);
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push(g);
  }
  build(parent, { cast = true, receive = true } = {}) {
    for (const [mat, list] of this.lists) {
      const merged = mergeGeometries(list);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      parent.add(mesh);
    }
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0);

export class Props {
  constructor(track, terrain) {
    this.track = track;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.exclusions = [];
    this.spectatorGroups = [];
    this.animated = [];
    this.W = track.halfWidth + track.shoulder;
    this.tmp = {};
    this.theme = themeFor(track);
    this.night = !!this.theme.night;
    // summit (King of the Mountain) only where the course genuinely climbs
    let maxY = -Infinity;
    let maxI = 0;
    let minY = Infinity;
    for (let i = 0; i < track.count; i++) {
      if (track.Y[i] > maxY) {
        maxY = track.Y[i];
        maxI = i;
      }
      minY = Math.min(minY, track.Y[i]);
    }
    this.summitS = track.def.id === 'mountain' ? track.cpToS(15.6) : maxY - minY > 40 ? maxI * track.ds : null;
    this.summitY = Math.round(maxY);
    this.mats = {
      metal: new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
      post: new THREE.MeshStandardMaterial({ color: '#5a5e66', metalness: 0.4, roughness: 0.6 }),
      white: new THREE.MeshStandardMaterial({ color: '#f1f1ec', roughness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: '#23262b', roughness: 0.7 }),
      wood: new THREE.MeshStandardMaterial({ color: '#7b5534', roughness: 0.85 }),
      stone: new THREE.MeshStandardMaterial({ map: makeRockTexture(), color: '#b5ab9c', roughness: 0.92 }),
      concrete: new THREE.MeshStandardMaterial({ map: makeConcrete(), color: '#aaa69e', roughness: 0.9, side: THREE.DoubleSide }),
      rock: new THREE.MeshStandardMaterial({ map: makeRockTexture(), color: '#8f887d', roughness: 0.95 }),
      straw: new THREE.MeshStandardMaterial({ color: '#d8b562', roughness: 1 }),
      roof: new THREE.MeshStandardMaterial({ map: makeRoof(), roughness: 0.9 }),
      lamp: new THREE.MeshBasicMaterial({ color: '#ffe2b0' }),
      orange: new THREE.MeshStandardMaterial({ color: '#ff5a1f', roughness: 0.45 }),
      cyan: new THREE.MeshStandardMaterial({ color: '#18c8ff', roughness: 0.45 }),
      red: new THREE.MeshStandardMaterial({ color: '#e0202c', roughness: 0.45 }),
    };
  }

  P(s, d, h = 0, out = new THREE.Vector3()) {
    const w = this.track.toWorld(s, d, this.tmp);
    return out.set(w.x, w.y + h, w.z);
  }

  head(s) {
    return this.track.sample(s).head;
  }

  build() {
    this._barriers();
    this._signs();
    this._gantries();
    this._checkpoints();
    if (this.theme.buildings !== 'city') this._village();
    if (this.zone(FLAG.TUNNEL)) this._tunnel();
    if (this.zone(FLAG.BRIDGE)) this._bridge();
    if (this.terrain.bridge && !this.terrain.gorge.dry && !this.terrain.gorge.toSea) this._waterfallAndRiver();
    if (this.terrain.lake) this._lake();
    buildEnvironment(this);
    this._spectators();
    this._flags();
    this._photographers();
    this._teamCars();
    if (this.waterfallPos) this._waterfallFoam();
    return this.group;
  }

  zone(flag) {
    return this.track.zones.find((z) => z.flag === flag) || null;
  }

  // ------------------------------------------------------------------
  _barriers() {
    const t = this.track;
    const W = this.W;
    const batch = new Batch();
    const sides = { '-1': new Uint8Array(t.count), 1: new Uint8Array(t.count) };
    const lake = this.terrain.lake;
    const T = this.terrain;
    for (let i = 0; i < t.count; i++) {
      const f = t.FLAGS[i];
      if (f & (FLAG.VILLAGE | FLAG.TUNNEL | FLAG.BRIDGE | FLAG.URBAN)) continue;
      if (f & FLAG.COAST && T.sea) {
        // always protect the sea-side drop
        const rx = -t.HZ[i];
        const rz = t.HX[i];
        const sR = T.seaDist(t.X[i] + rx * 20, t.Z[i] + rz * 20);
        const sL = T.seaDist(t.X[i] - rx * 20, t.Z[i] - rz * 20);
        sides[sR > sL ? 1 : -1][i] = 1;
      }
      const k = t.CURV[i];
      if (Math.abs(k) > 0.008) sides[k > 0 ? 1 : -1][i] = 1;
      if (Math.abs(k) > 0.03) sides[k > 0 ? -1 : 1][i] = 1;
      if (f & FLAG.CLIFF) sides[1][i] = sides[-1][i] = 1;
      if (f & FLAG.LAKE && lake) {
        const rx = -t.HZ[i];
        const rz = t.HX[i];
        const side = (lake.x - t.X[i]) * rx + (lake.z - t.Z[i]) * rz > 0 ? 1 : -1;
        sides[side][i] = 1;
      }
    }
    const posts = [];
    const delins = [];
    for (const side of [-1, 1]) {
      const arr = sides[side];
      // close small gaps
      for (let i = 0; i < t.count; i++) {
        if (!arr[i]) continue;
        for (let g = 1; g < 10; g++) if (arr[(i + g) % t.count]) {
          for (let h = 1; h < g; h++) arr[(i + h) % t.count] = 2;
          break;
        }
      }
      let i = 0;
      while (i < t.count) {
        if (!arr[i]) {
          if (i % 16 === 0 && !(t.FLAGS[i] & (FLAG.VILLAGE | FLAG.TUNNEL | FLAG.BRIDGE | FLAG.URBAN))) delins.push([i * t.ds, side * (W + 0.5)]);
          i++;
          continue;
        }
        let j = i;
        while (j < t.count && arr[j]) j++;
        if (j - i >= 12) {
          const s0 = i * t.ds;
          const s1 = j * t.ds;
          const d = side * (W + 0.35);
          const pos = [];
          const uv = [];
          const idx = [];
          let row = 0;
          for (let s = s0; s <= s1 + 0.01; s += 2, row++) {
            const a = this.P(s, d, 0.5);
            const b = this.P(s, d, 0.88);
            pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
            uv.push(s / 4, 0, s / 4, 1);
            if (row > 0) {
              const o = (row - 1) * 2;
              idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
            }
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
          g.setIndex(idx);
          g.computeVertexNormals();
          if (this.theme.stoneParapets) {
            // Mediterranean-style low stone parapet instead of a steel rail
            const d0 = side * (W + 0.1);
            const d1 = side * (W + 0.65);
            const prof = side > 0 ? [[d0, -0.3], [d0, 0.85], [d1, 0.85], [d1, -0.3]] : [[d1, -0.3], [d1, 0.85], [d0, 0.85], [d0, -0.3]];
            batch.add(this.mats.stone, this._extrude(s0, s1, 2, prof));
          } else {
            batch.add(this.mats.metal, g);
            for (let s = s0; s <= s1; s += 4) posts.push([s, side * (W + 0.45)]);
          }
        }
        i = j;
      }
    }
    batch.build(this.group, { cast: true });
    // posts (instanced)
    const postGeo = new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(postGeo, this.mats.post, posts.length);
    posts.forEach(([s, d], k) => {
      this.P(s, d, -0.05, _v);
      _q.setFromAxisAngle(Y, this.head(s));
      pm.setMatrixAt(k, _m.compose(_v, _q, _s));
    });
    pm.castShadow = true;
    this.group.add(pm);
    // delineators (white posts w/ black band + reflector)
    const dg = mergeGeometries([
      new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0),
    ]);
    const dm = new THREE.InstancedMesh(dg, this.mats.white, delins.length);
    const band = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.22, 0.13).translate(0, 0.9, 0), this.mats.dark, delins.length);
    delins.forEach(([s, d], k) => {
      this.P(s, d, 0, _v);
      _v.y = Math.max(_v.y, this.terrain.heightAt(_v.x, _v.z));
      _q.setFromAxisAngle(Y, this.head(s));
      _m.compose(_v, _q, _s);
      dm.setMatrixAt(k, _m);
      band.setMatrixAt(k, _m);
    });
    dm.castShadow = true;
    this.group.add(dm, band);
    // hay bales on the outside of the tightest bends
    const bales = [];
    for (let i = 0; i < t.count; i += 3) {
      const k = t.CURV[i];
      if (Math.abs(k) > 0.04 && !(t.FLAGS[i] & (FLAG.TUNNEL | FLAG.BRIDGE | FLAG.URBAN | FLAG.COAST)) && this.theme.bales !== false) bales.push([i * t.ds, (k > 0 ? 1 : -1) * (W + 1.4)]);
    }
    const bg = new THREE.CylinderGeometry(0.65, 0.65, 1.3, 12).rotateZ(Math.PI / 2).translate(0, 0.62, 0);
    const bm = new THREE.InstancedMesh(bg, this.mats.straw, bales.length);
    bales.forEach(([s, d], k) => {
      this.P(s, d, 0, _v);
      _q.setFromAxisAngle(Y, this.head(s) + Math.PI / 2);
      bm.setMatrixAt(k, _m.compose(_v, _q, _s));
    });
    bm.castShadow = true;
    this.group.add(bm);
  }

  // ------------------------------------------------------------------
  _signs() {
    const t = this.track;
    const W = this.W;
    const chevL = new THREE.MeshStandardMaterial({ map: makeChevron(-1), roughness: 0.5 });
    const chevR = new THREE.MeshStandardMaterial({ map: makeChevron(1), roughness: 0.5 });
    const batch = new Batch();
    const plane = new THREE.PlaneGeometry(1.6, 0.8);
    const pole = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6).translate(0, 0.8, 0);
    // local curvature peaks
    let last = -999;
    for (let i = 0; i < t.count; i++) {
      const k = t.CURV[i];
      if (Math.abs(k) < 0.025) continue;
      let peak = true;
      for (let a = -25; a <= 25; a++) if (Math.abs(t.CURV[(i + a + t.count) % t.count]) > Math.abs(k)) peak = false;
      if (!peak || i - last < 40) continue;
      if (t.FLAGS[i] & (FLAG.TUNNEL | FLAG.BRIDGE | FLAG.VILLAGE)) continue;
      last = i;
      const side = k > 0 ? 1 : -1; // outside of the bend
      for (const off of [-10, 0, 10]) {
        const s = i * t.ds + off;
        const p = this.P(s, side * (W + 1.3), 0);
        const h = this.head(s) + Math.PI;
        _q.setFromAxisAngle(Y, h);
        _m.compose(_v.copy(p).add(new THREE.Vector3(0, 1.6, 0)), _q, _s);
        batch.add(k > 0 ? chevL : chevR, plane, _m);
        _m.compose(p, _q, _s);
        batch.add(this.mats.post, pole, _m);
      }
    }
    // information boards
    const board = (s, side, text, colors) => {
      const tex = makeBoard(text, colors);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
      const g = new THREE.PlaneGeometry(3.2, 0.8);
      const p = this.P(s, side * (W + 1.6), 0);
      _q.setFromAxisAngle(Y, this.head(s) + Math.PI);
      batch.add(mat, g, _m.compose(_v.copy(p).add(new THREE.Vector3(0, 2.1, 0)), _q, _s));
      batch.add(this.mats.post, new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6).translate(-1.2, 1.1, 0), _m.compose(p, _q, _s));
      batch.add(this.mats.post, new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6).translate(1.2, 1.1, 0), _m.compose(p, _q, _s));
    };
    const tz = this.zone(FLAG.TUNNEL);
    const bz = this.zone(FLAG.BRIDGE);
    const vz = this.zone(FLAG.VILLAGE);
    const bridgeWord = this.terrain.gorge?.toSea ? 'COVE' : this.terrain.gorge?.dry ? 'CANYON' : this.terrain.gorge?.river ? 'RIVER' : this.terrain.gorge?.stream ? 'STREAM' : 'GORGE';
    if (tz) board(tz.s0 - 60, -1, this.theme.tunnel === 'concrete' ? 'UNDERPASS' : 'TUNNEL', ['#1d3557', '#f4a261', '#fff']);
    if (bz) board(bz.s0 - 60, 1, bridgeWord, ['#264653', '#2a9d8f', '#fff']);
    const gravel = t.def.surfaces.find((x) => x.surface === 'gravel');
    if (gravel) board(t.cpToS(gravel.from) - 50, 1, 'GRAVEL', ['#6b4f2a', '#ffd23f', '#fff']);
    t.ramps.forEach((r, i) => board(r.s - 60, i % 2 ? 1 : -1, 'JUMP!', ['#ffc300', '#161616', '#161616']));
    if (vz && this.theme.buildings !== 'city') board(vz.s0 - 40, -1, 'VILLAGE', ['#2d6a4f', '#95d5b2', '#fff']);
    board(t.length - 520, 1, '500 M', ['#111', '#ff5a1f', '#fff']);
    batch.build(this.group);
  }

  // ------------------------------------------------------------------
  _gantry(s, banner, backBanner, color = '#ff5a1f', height = 7.2) {
    const W = this.W;
    const g = new THREE.Group();
    const h = this.head(s);
    const base = this.P(s, 0, 0);
    g.position.copy(base);
    g.rotation.y = h;
    const pillarMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 });
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, height, 0.9), pillarMat);
      p.position.set(side * (W + 1.4), height / 2, 0);
      p.castShadow = true;
      g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * W + 3.6, 2.6, 0.5), this.mats.dark);
    beam.position.set(0, height - 0.6, 0);
    beam.castShadow = true;
    g.add(beam);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(2 * W + 3.2, 2.3), new THREE.MeshStandardMaterial({ map: banner, roughness: 0.6, emissive: '#ffffff', emissiveMap: banner, emissiveIntensity: 0.15 }));
    front.position.set(0, height - 0.6, -0.27);
    front.rotation.y = Math.PI;
    g.add(front);
    if (backBanner) {
      const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * W + 3.2, 2.3), new THREE.MeshStandardMaterial({ map: backBanner, roughness: 0.6 }));
      back.position.set(0, height - 0.6, 0.27);
      g.add(back);
    }
    this.group.add(g);
    this.exclusions.push({ x: base.x, z: base.z, r: W + 6 });
    return g;
  }

  _gantries() {
    const t = this.track;
    const start = makeBanner(this.theme.banner.title, { sub: this.theme.banner.sub, bg: '#ff5a1f' });
    const back = makeBanner('GOOD LUCK', { bg: '#1d3557' });
    const g = this._gantry(0, start, back, '#ff5a1f', 7.4);
    // timing clock on top of the gantry
    const clock = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 0.5), this.mats.dark);
    clock.position.set(0, 9.1, 0);
    g.add(clock);
    const cv = canvas(256, 96);
    this.clockCanvas = cv;
    this.clockTex = toTexture(cv, { wrap: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.05), new THREE.MeshBasicMaterial({ map: this.clockTex }));
    face.position.set(0, 9.1, -0.26);
    face.rotation.y = Math.PI;
    g.add(face);
    this.setClock('0:00.0');
    // start lights facing the grid: 3 red + 1 green
    this.startLights = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: '#2a0d0d' }));
      m.position.set(-2.4 + i * 1.6, 5.1, -0.31);
      m.rotation.y = Math.PI;
      g.add(m);
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 20), this.mats.dark);
      rim.position.copy(m.position);
      rim.position.z -= 0.005;
      rim.rotation.y = Math.PI;
      g.add(rim);
      this.startLights.push(m);
    }
    // King of the Mountain at the summit
    if (this.summitS !== null) {
      const kom = makeBanner('KING OF THE MOUNTAIN', { bg: '#e63946', fg: '#fff', sub: `SUMMIT ${this.summitY} M` });
      this._gantry(this.summitS, kom, null, '#ffffff', 6.8);
    }
    // flamme rouge
    const fr = makeBanner('FLAMME ROUGE · 300 M', { bg: '#c1121f' });
    this._gantry(t.length - 300, fr, null, '#c1121f', 6.4);
  }

  /** n: 0 = off, 1..3 = red lights lit, 4 = GO (green) */
  setStartLights(n) {
    if (!this.startLights) return;
    this.startLights.forEach((m, i) => {
      if (n >= 4) m.material.color.set('#39ff6a');
      else m.material.color.set(i < n ? '#ff2a2a' : i === 3 ? '#0f2a12' : '#2a0d0d');
    });
  }

  setClock(text) {
    if (!this.clockCanvas) return;
    const ctx = this.clockCanvas.getContext('2d');
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#ffb000';
    ctx.font = 'bold 58px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 52);
    this.clockTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------
  _checkpoints() {
    const t = this.track;
    const W = this.W;
    const banner = makeBanner('CHECKPOINT', { bg: '#0c7bdc', w: 768, h: 128 });
    const bannerMat = new THREE.MeshStandardMaterial({ map: banner, roughness: 0.6, side: THREE.DoubleSide });
    t.checkpoints.forEach((s, i) => {
      const inTunnel = t.FLAGS[t.idx(s)] & FLAG.TUNNEL;
      if (inTunnel) return;
      const arch = new THREE.Mesh(new THREE.TorusGeometry(W + 0.9, 0.6, 10, 36, Math.PI), i % 2 ? this.mats.orange : this.mats.cyan);
      const p = this.P(s, 0, 0);
      arch.position.copy(p);
      arch.rotation.y = this.head(s);
      arch.castShadow = true;
      this.group.add(arch);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(6, 1), bannerMat);
      b.position.copy(p).add(new THREE.Vector3(0, W + 1.2, 0));
      b.rotation.y = this.head(s) + Math.PI;
      this.group.add(b);
    });
  }

  // ------------------------------------------------------------------
  _chalet(batch, x, y, z, rot, seed, big = false) {
    const rng = makeRng(seed);
    const st = this._houseStyle || { roofPitch: 1, flat: false, tall: 1, balcony: true, chimney: true };
    const w = (big ? 12 : 8) + rng() * 3;
    const d = (big ? 10 : 7) + rng() * 2;
    const h = ((big ? 7 : 5) + rng() * 1.5) * st.tall;
    const wallMat = this._wallMats[seed % this._wallMats.length];
    _q.setFromAxisAngle(Y, rot);
    const body = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
    // scale UVs so windows repeat sensibly
    const uv = body.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.round(w / 6), uv.getY(i));
    _m.compose(_v.set(x, y - 0.5, z), _q, _s);
    batch.add(wallMat, body, _m);
    const rh = (2.6 + rng() * 1.2) * st.roofPitch;
    if (st.flat) {
      // flat roof with a parapet (desert / some Mediterranean houses)
      batch.add(wallMat, new THREE.BoxGeometry(w + 0.3, 0.6, d + 0.3).translate(0, h - 0.2, 0), _m);
      this.exclusions.push({ x, z, r: Math.max(w, d) * 0.8 + 3 });
      return;
    }
    // gabled roof (prism) with overhang
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2 - 1.1, 0);
    shape.lineTo(0, rh);
    shape.lineTo(d / 2 + 1.1, 0);
    shape.lineTo(-d / 2 - 1.1, 0);
    const roof = new THREE.ExtrudeGeometry(shape, { depth: w + 1.6, bevelEnabled: false });
    roof.translate(0, 0, -(w + 1.6) / 2).rotateY(Math.PI / 2).translate(0, h - 0.5, 0);
    batch.add(this._roofMat || this.mats.roof, roof, _m);
    if (!st.chimney) {
      this.exclusions.push({ x, z, r: Math.max(w, d) * 0.8 + 3 });
      return;
    }
    // chimney
    const ch = new THREE.BoxGeometry(0.8, 2.2, 0.8).translate(w * 0.25, h + rh * 0.6, d * 0.12);
    batch.add(this.mats.stone, ch, _m);
    if (st.balcony) {
      const bal = new THREE.BoxGeometry(w * 0.8, 0.9, 1.2).translate(0, h * 0.55, d / 2 + 0.6);
      batch.add(this.mats.wood, bal, _m);
    }
    this.exclusions.push({ x, z, r: Math.max(w, d) * 0.8 + 3 });
  }

  _village() {
    const t = this.track;
    const T = this.terrain;
    const W = this.W;
    const style = this.theme.buildings;
    const wallStyle = { stone: 'stone', med: 'plaster', cabin: 'log', desert: 'adobe' }[style];
    this._wallMats = [1, 2, 3, 4, 5, 6].map(
      (sd) => new THREE.MeshStandardMaterial({ map: wallStyle ? makeWall(wallStyle, sd) : makeChaletWall(sd), roughness: 0.85 }),
    );
    this._roofMat = style === 'med' ? new THREE.MeshStandardMaterial({ map: makeRoofTiles('terracotta'), roughness: 0.85 }) : style === 'stone' || style === 'cabin' ? new THREE.MeshStandardMaterial({ map: makeRoofTiles('slate'), roughness: 0.8 }) : null;
    this._houseStyle = {
      chalet: { roofPitch: 1, tall: 1, balcony: true, chimney: true },
      stone: { roofPitch: 0.95, tall: 1.1, balcony: false, chimney: true },
      med: { roofPitch: 0.45, tall: 1.7, balcony: false, chimney: false },
      cabin: { roofPitch: 1.2, tall: 0.85, balcony: true, chimney: true },
      desert: { flat: true, tall: 0.8 },
    }[style] || { roofPitch: 1, tall: 1, balcony: true, chimney: true };
    const batch = new Batch();
    const rng = makeRng(333);
    const vz = this.zone(FLAG.VILLAGE);
    if (!vz) return;
    const place = (s, side, off, seed, big) => {
      const p = this.P(s, side * (W + off), 0);
      if (T.roadDistAt(p.x, p.z) < W + off - 3) return; // too close to another part of the road
      const y = T.heightAt(p.x, p.z);
      const rot = this.head(s) + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rng() - 0.5) * 0.15;
      this._chalet(batch, p.x, y, p.z, rot, seed, big);
    };
    let seed = 1;
    for (let s = vz.s0 + 10; s < t.length + vz.s1 - 10; s += 21 + rng() * 8) {
      const ss = s % t.length;
      if (Math.abs(((ss + t.length / 2) % t.length) - t.length / 2) < 18) continue; // keep the line clear
      for (const side of [-1, 1]) if (rng() < 0.85) place(ss, side, 14 + rng() * 6, seed++, rng() < 0.3);
    }
    // church with a bell tower near the finish (European villages only)
    if (['chalet', 'stone', 'med'].includes(style)) {
      const s = 55;
      const p = this.P(s, -(W + 32), 0);
      const y = T.heightAt(p.x, p.z);
      const rot = this.head(s);
      _q.setFromAxisAngle(Y, rot);
      _m.compose(_v.set(p.x, y - 0.5, p.z), _q, _s);
      batch.add(this.mats.white, new THREE.BoxGeometry(9, 8, 18).translate(0, 4, 0), _m);
      const roof = new THREE.CylinderGeometry(0.01, 7.2, 4, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 2.2).translate(0, 10, 0);
      batch.add(this.mats.roof, roof, _m);
      batch.add(this.mats.white, new THREE.BoxGeometry(4.2, 20, 4.2).translate(0, 10, 11), _m);
      batch.add(this.mats.roof, new THREE.ConeGeometry(3.3, 7, 4).rotateY(Math.PI / 4).translate(0, 23.5, 11), _m);
      batch.add(this.mats.dark, new THREE.CylinderGeometry(1.1, 1.1, 0.2, 20).rotateX(Math.PI / 2).translate(0, 16, 13.15), _m);
      this.exclusions.push({ x: p.x, z: p.z, r: 16 });
    }
    // farms / huts scattered along the route
    for (let k = 0; k < 6 && style !== 'desert'; k++) {
      const s = ((k + 0.37) / 6) * t.length;
      if (t.FLAGS[t.idx(s)] & (FLAG.TUNNEL | FLAG.BRIDGE | FLAG.VILLAGE)) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const p = this.P(s, side * (W + 24 + rng() * 10), 0);
      if (T.roadDistAt(p.x, p.z) < W + 14) continue;
      if (T.slopeAt(p.x, p.z) > 0.35) continue;
      this._chalet(batch, p.x, T.heightAt(p.x, p.z), p.z, this.head(s) + rng(), seed++ + 50, false);
    }
    // crowd barriers + sponsor boards along the village straight
    const boards = [
      makeBoard('VELO RUSH', ['#ff5a1f', '#ffd23f', '#fff']),
      makeBoard('SUMMIT COLA', ['#c1121f', '#fff', '#fff']),
      makeBoard('ALPINA', ['#1d3557', '#a8dadc', '#fff']),
      makeBoard('CRANKWORKS', ['#111', '#06d6a0', '#fff']),
      makeBoard('TURBO SOX', ['#8338ec', '#ff006e', '#fff']),
    ].map((tx) => new THREE.MeshStandardMaterial({ map: tx, roughness: 0.6 }));
    const bgeo = new THREE.PlaneGeometry(3.8, 0.95);
    let bi = 0;
    for (let s = -150; s < 170; s += 4) {
      if (Math.abs(s) < 3) continue;
      const ss = t.wrap(s);
      for (const side of [-1, 1]) {
        const p = this.P(ss, side * (W + 0.55), 0);
        _q.setFromAxisAngle(Y, this.head(ss) + (side > 0 ? Math.PI / 2 : -Math.PI / 2));
        _m.compose(_v.copy(p).add(new THREE.Vector3(0, 0.55, 0)), _q, _s);
        batch.add(boards[bi++ % boards.length], bgeo, _m);
      }
    }
    // bunting across the street
    const bunt = [];
    const buntCols = ['#e63946', '#ffd23f', '#3a86ff', '#06d6a0', '#ffffff', '#ff006e'];
    const buntMats = buntCols.map((c) => new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.8 }));
    for (const s of ['chalet', 'stone', 'med'].includes(style) ? [-110, -60, 30, 90, 140] : []) {
      const ss = t.wrap(s);
      const a = this.P(ss, -(W + 2), 6.2);
      const b = this.P(ss, W + 2, 6.2);
      for (const e of [a, b]) {
        _q.identity();
        _m.compose(_v.copy(e).setY(e.y - 3.1), _q, _s);
        batch.add(this.mats.wood, new THREE.CylinderGeometry(0.1, 0.12, 6.4, 6), _m);
      }
      const n = 22;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const p = new THREE.Vector3().lerpVectors(a, b, u);
        p.y -= Math.sin(u * Math.PI) * 1.1;
        const tri = new THREE.BufferGeometry();
        tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.3, 0, 0, 0.3, 0, 0, 0, -0.55, 0], 3));
        tri.computeVertexNormals();
        _q.setFromAxisAngle(Y, this.head(ss) + Math.PI / 2);
        _m.compose(p, _q, _s);
        batch.add(buntMats[i % buntMats.length], tri, _m);
      }
      bunt.push(ss);
    }
    batch.build(this.group);
  }

  // ------------------------------------------------------------------
  /** Extrude a 2D profile (d,h) along the track between s0..s1. */
  _extrude(s0, s1, step, profile, closed = false) {
    const rows = [];
    for (let s = s0; s <= s1 + 1e-3; s += step) rows.push(s);
    const nP = profile.length;
    const pos = [];
    const uv = [];
    const idx = [];
    const lens = [0];
    for (let i = 1; i < nP; i++) lens.push(lens[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
    for (const s of rows) {
      for (let i = 0; i < nP; i++) {
        const [d, h] = profile[i];
        const p = this.P(s, d, h);
        pos.push(p.x, p.y, p.z);
        uv.push(lens[i] / 4, s / 4);
      }
    }
    const segs = closed ? nP : nP - 1;
    for (let r = 0; r < rows.length - 1; r++) {
      for (let i = 0; i < segs; i++) {
        const a = r * nP + i;
        const b = r * nP + ((i + 1) % nP);
        const c = a + nP;
        const d = b + nP;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  _tunnel() {
    const t = this.track;
    const z = t.zones.find((zz) => zz.flag === FLAG.TUNNEL);
    const W = this.W;
    const aw = W + 0.5; // arch half width
    const wallH = 4.2;
    const archH = aw * 0.72;
    // inner arch profile from right floor -> over the top -> left floor
    // (d positive = right; walking this order puts the normals inward with our winding)
    const inner = [];
    inner.push([aw, -0.2], [aw, wallH]);
    for (let i = 1; i < 14; i++) {
      const a = (i / 14) * Math.PI;
      inner.push([Math.cos(a) * aw, wallH + Math.sin(a) * archH]);
    }
    inner.push([-aw, wallH], [-aw, -0.2]);
    const outer = [
      [-aw, -0.2], [-27, -0.6], [-28, 38], [-15, 62], [15, 62], [28, 38], [27, -0.6], [aw, -0.2],
    ];
    const s0 = z.s0 - 2;
    const s1 = z.s1 + 2;
    const innerGeo = this._extrude(s0, s1, 2, inner);
    const outerGeo = this._extrude(s0, s1, 2, outer);
    // check winding: inner normals must point toward the tunnel centre line
    const n = innerGeo.attributes.normal;
    const p = innerGeo.attributes.position;
    const mid = Math.floor(inner.length / 2);
    const cen = this.P(s0, 0, wallH);
    const toC = new THREE.Vector3(cen.x - p.getX(mid), cen.y - p.getY(mid), cen.z - p.getZ(mid));
    if (toC.dot(new THREE.Vector3(n.getX(mid), n.getY(mid), n.getZ(mid))) < 0) {
      for (const g of [innerGeo, outerGeo]) {
        const ix = g.index.array;
        for (let i = 0; i < ix.length; i += 3) {
          const tmp = ix[i + 1];
          ix[i + 1] = ix[i + 2];
          ix[i + 2] = tmp;
        }
        g.index.needsUpdate = true;
        g.computeVertexNormals();
      }
    }
    const conc = new THREE.MeshStandardMaterial({ map: makeConcrete(), color: '#9a958c', roughness: 0.9 });
    const innerMesh = new THREE.Mesh(innerGeo, conc);
    innerMesh.receiveShadow = true;
    innerMesh.castShadow = true;
    const outerMesh = new THREE.Mesh(outerGeo, this.theme.tunnel === 'concrete' ? this.mats.concrete : this.mats.rock);
    outerMesh.castShadow = true;
    outerMesh.receiveShadow = true;
    this.group.add(innerMesh, outerMesh);

    // portal faces (profile polygon with the arch as a hole)
    for (const [s, flip] of [[s0, true], [s1, false]]) {
      const shape = new THREE.Shape(outer.slice(1, -1).map(([d, h]) => new THREE.Vector2(d, h)));
      const hole = new THREE.Path(inner.map(([d, h]) => new THREE.Vector2(d * 0.999, Math.max(h, -0.15))).reverse());
      shape.holes.push(hole);
      const sg = new THREE.ShapeGeometry(shape, 6);
      // map (x=d, y=h) into world at s
      const pa = sg.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const w = this.P(s, pa.getX(i), pa.getY(i));
        pa.setXYZ(i, w.x, w.y, w.z);
      }
      const uvs = sg.attributes.uv;
      for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) / 5, uvs.getY(i) / 5);
      sg.computeVertexNormals();
      const m = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: this.mats.stone.map, color: '#b3a894', roughness: 0.95, side: THREE.DoubleSide }));
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      void flip;
      // stone arch frame
      const frame = new THREE.Mesh(new THREE.TorusGeometry(aw + 0.4, 0.7, 6, 24, Math.PI), this.mats.stone);
      frame.scale.set(1, archH / aw, 1);
      frame.position.copy(this.P(s, 0, wallH));
      frame.rotation.y = this.head(s);
      this.group.add(frame);
      for (const side of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(1.4, wallH, 1.4), this.mats.stone);
        col.position.copy(this.P(s, side * (aw + 0.4), wallH / 2));
        col.rotation.y = this.head(s);
        this.group.add(col);
      }
    }
    // ceiling lamps
    const lamps = [];
    for (let s = s0 + 4; s < s1 - 2; s += 7) for (const d of [-3.2, 3.2]) lamps.push([s, d]);
    const lg = new THREE.BoxGeometry(0.5, 0.15, 2.2);
    const lm = new THREE.InstancedMesh(lg, this.mats.lamp, lamps.length);
    lamps.forEach(([s, d], k) => {
      const hgt = wallH + Math.sqrt(Math.max(0, 1 - (d / aw) ** 2)) * archH - 0.25;
      this.P(s, d, hgt, _v);
      _q.setFromAxisAngle(Y, this.head(s));
      lm.setMatrixAt(k, _m.compose(_v, _q, _s));
    });
    this.group.add(lm);
    this.tunnelRange = [s0, s1];
  }

  // ------------------------------------------------------------------
  _bridge() {
    const t = this.track;
    const T = this.terrain;
    const z = t.zones.find((zz) => zz.flag === FLAG.BRIDGE);
    const W = this.W;
    const s0 = z.s0 - 6;
    const s1 = z.s1 + 6;
    // deck body under the road
    const deck = [[W + 0.6, 0], [W + 0.6, -1.8], [-(W + 0.6), -1.8], [-(W + 0.6), 0]];
    const deckGeo = this._extrude(s0, s1, 2, deck);
    const style = this.theme.bridge;
    const deckMat = style === 'wood' ? this.mats.wood : this.mats.concrete;
    const railMat = { stone: this.mats.stone, wood: this.mats.wood, steel: this.mats.metal, concrete: this.mats.concrete }[style] || this.mats.stone;
    const pierMat = style === 'wood' ? this.mats.wood : style === 'stone' ? this.mats.stone : this.mats.concrete;
    const dm = new THREE.Mesh(deckGeo, deckMat);
    dm.castShadow = dm.receiveShadow = true;
    this.group.add(dm);
    // parapets
    for (const side of [-1, 1]) {
      const d0 = side * (W + 0.1);
      const d1 = side * (W + 0.6);
      const prof = side > 0 ? [[d0, 0], [d0, 1.05], [d1, 1.05], [d1, 0]] : [[d1, 0], [d1, 1.05], [d0, 1.05], [d0, 0]];
      const g = this._extrude(s0, s1, 2, prof);
      const m = new THREE.Mesh(g, railMat);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    if (style === 'steel') this._steelArch(s0, s1);
    // piers down to the gorge floor
    const batch = new Batch();
    for (let s = s0 + 8; s < s1 - 4; s += 16) {
      const top = this.P(s, 0, -1.8);
      let ground = Infinity;
      for (const d of [-W, 0, W]) {
        const q = this.P(s, d, 0);
        ground = Math.min(ground, T.heightAt(q.x, q.z));
      }
      const h = top.y - ground + 3;
      if (h < 3) continue;
      _q.setFromAxisAngle(Y, this.head(s));
      _m.compose(_v.set(top.x, top.y - h / 2, top.z), _q, _s);
      if (style === 'wood') {
        // timber trestle legs
        for (const dx of [-W * 0.7, W * 0.7]) batch.add(pierMat, new THREE.BoxGeometry(0.5, h, 0.5).translate(dx, 0, 0), _m);
        batch.add(pierMat, new THREE.BoxGeometry(2 * W, 0.4, 0.4).translate(0, h * 0.2, 0), _m);
      } else if (style !== 'steel' || h < 30) batch.add(pierMat, new THREE.BoxGeometry(style === 'concrete' ? 3 : 2 * W - 2, h, 3.2), _m);
    }
    batch.build(this.group);
    // bridge lamps
    for (let s = s0 + 4; s < s1; s += 20) {
      for (const side of [-1, 1]) {
        const p = this.P(s, side * (W + 0.35), 1.05);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4, 6), this.mats.post);
        pole.position.copy(p).add(new THREE.Vector3(0, 2, 0));
        this.group.add(pole);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), this.mats.lamp);
        lamp.position.copy(p).add(new THREE.Vector3(0, 4.1, 0));
        this.group.add(lamp);
      }
    }
  }

  /** Steel deck-arch spanning the canyon, with vertical hangers up to the deck. */
  _steelArch(s0, s1) {
    const T = this.terrain;
    const W = this.W;
    const batch = new Batch();
    const span = s1 - s0;
    const mid = (s0 + s1) / 2;
    const deckY = this.P(mid, 0, 0).y - 1.8;
    // springing points: where the canyon walls meet the arch line
    let low = Infinity;
    for (let s = s0; s <= s1; s += 4) low = Math.min(low, T.heightAt(this.P(s, 0).x, this.P(s, 0).z));
    const rise = Math.max(12, (deckY - low) * 0.8);
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const s = s0 + u * span;
        const y = deckY - rise + Math.sin(u * Math.PI) * (rise - 2);
        const p = this.P(s, side * (W - 1), 0);
        pts.push(new THREE.Vector3(p.x, y, p.z));
      }
      batch.add(this.mats.metal, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.7, 8));
      for (let i = 2; i < 40; i += 3) {
        const p = pts[i];
        const h = deckY - p.y;
        if (h < 0.5) continue;
        batch.add(this.mats.metal, new THREE.CylinderGeometry(0.18, 0.18, h, 6).translate(p.x, p.y + h / 2, p.z));
      }
    }
    batch.build(this.group);
  }

  // ------------------------------------------------------------------
  _waterMaterial(color = '#2a7a8c') {
    if (!this._waterNormal) this._waterNormal = makeWaterNormal();
    const n1 = this._waterNormal.clone();
    n1.needsUpdate = true;
    n1.wrapS = n1.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.06,
      metalness: 0.15,
      normalMap: n1,
      normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true,
      opacity: 0.88,
      envMapIntensity: 1.2,
    });
    return mat;
  }

  _waterfallAndRiver() {
    const T = this.terrain;
    const B = T.bridge;
    const river = (along) => {
      const acrossOff = Math.sin(along / 70) * 9 * THREE.MathUtils.smoothstep(Math.abs(along), 20, 120);
      return new THREE.Vector3(B.x + B.rx * along + B.tx * acrossOff, 0, B.z + B.rz * along + B.tz * acrossOff);
    };
    const ribbon = (a0, a1, y, width) => {
      const pos = [];
      const uv = [];
      const idx = [];
      let row = 0;
      for (let a = a0; a <= a1; a += 5, row++) {
        const c = river(a);
        const cn = river(a + 1);
        const dx = cn.x - c.x;
        const dz = cn.z - c.z;
        const l = Math.hypot(dx, dz);
        const rx = -dz / l;
        const rz = dx / l;
        pos.push(c.x - rx * width, y, c.z - rz * width, c.x + rx * width, y, c.z + rz * width);
        uv.push(0, a / 20, 2, a / 20);
        if (row > 0) {
          const o = (row - 1) * 2;
          idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) {
        const ix = g.index.array;
        for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
        g.computeVertexNormals();
      }
      return g;
    };
    const hasFall = T.waterfallAlong > -1e8;
    const wf = hasFall ? T.waterfallAlong : -330;
    const G = T.gorge;
    const waterMat = this._waterMaterial(G.river ? '#1d3a44' : G.stream ? '#3a5a4a' : '#2c7f8f');
    this.riverMat = waterMat;
    const riverW = G.stream ? 5 : 16;
    const depthAbove = G.stream ? 0.6 : 1.4;
    if (hasFall) {
      const up = new THREE.Mesh(ribbon(-330, wf, T.riverHigh + 1.4, riverW), waterMat);
      up.receiveShadow = true;
      this.group.add(up);
    }
    const down = new THREE.Mesh(ribbon(wf, 420, T.riverLow + depthAbove, riverW), waterMat);
    down.receiveShadow = true;
    this.group.add(down);
    if (!hasFall) return;

    // waterfall sheet: curved plane from the upper pool down to the lower river
    const c = river(wf);
    const cn = river(wf + 1);
    const fx = cn.x - c.x;
    const fz = cn.z - c.z;
    const fl = Math.hypot(fx, fz);
    const dirX = fx / fl;
    const dirZ = fz / fl;
    const rx = -dirZ;
    const rz = dirX;
    const width = 11;
    const top = T.riverHigh + 1.5;
    const bottom = T.riverLow + 1.2;
    const pos = [];
    const uv = [];
    const idx = [];
    const rowsN = 12;
    for (let r = 0; r <= rowsN; r++) {
      const t = r / rowsN;
      const y = top + (bottom - top) * t;
      const out = -6 + Math.sqrt(t) * 10; // arcs outward as it falls
      for (const sgn of [-1, 1]) pos.push(c.x + dirX * out + rx * width * sgn, y, c.z + dirZ * out + rz * width * sgn);
      uv.push(0, t, 1, t);
      if (r > 0) {
        const o = (r - 1) * 2;
        idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const wcv = canvas(128, 256);
    const ctx = wcv.getContext('2d');
    const rng = makeRng(5);
    ctx.fillStyle = 'rgba(190,225,240,0.55)';
    ctx.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.25 + rng() * 0.6})`;
      ctx.fillRect(rng() * 128, rng() * 256, 1 + rng() * 3, 20 + rng() * 90);
    }
    const wtex = toTexture(wcv);
    wtex.repeat.set(3, 1.5);
    const wmat = new THREE.MeshBasicMaterial({ map: wtex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: true });
    const fall = new THREE.Mesh(g, wmat);
    this.group.add(fall);
    this.waterfallTex = wtex;
    this.waterfallPos = new THREE.Vector3(c.x + dirX * 4, bottom + 1, c.z + dirZ * 4);
    this.waterfallTop = new THREE.Vector3(c.x - dirX * 6, top, c.z - dirZ * 6);
    // rocks framing the fall
    const batch = new Batch();
    const rrng = makeRng(8);
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      const a = (rrng() - 0.5) * 30;
      const x = c.x + dirX * a + rx * side * (width + 2 + rrng() * 6);
      const z = c.z + dirZ * a + rz * side * (width + 2 + rrng() * 6);
      const y = T.heightAt(x, z);
      const s = 2 + rrng() * 4;
      _q.setFromEuler(new THREE.Euler(rrng(), rrng() * 6, rrng()));
      _m.compose(_v.set(x, y - s * 0.3, z), _q, new THREE.Vector3(s, s * 0.8, s));
      batch.add(this.mats.rock, new THREE.DodecahedronGeometry(1, 0), _m);
    }
    batch.build(this.group);
  }

  _lake() {
    const L = this.terrain.lake;
    const g = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    const mat = this._waterMaterial('#2f7d9a');
    this.lakeMat = mat;
    mat.normalMap.repeat.set(10, 10);
    const lake = new THREE.Mesh(g, mat);
    lake.scale.set(L.rx * 1.45, 1, L.rz * 1.45);
    lake.position.set(L.x, L.level, L.z);
    lake.receiveShadow = true;
    this.group.add(lake);
    // wooden jetty
    const batch = new Batch();
    const jx = L.x - L.rx * 0.95;
    _m.compose(_v.set(jx + 6, L.level + 0.5, L.z), _q.identity(), _s);
    batch.add(this.mats.wood, new THREE.BoxGeometry(14, 0.3, 2.4), _m);
    for (let i = 0; i < 4; i++) {
      _m.compose(_v.set(jx + i * 4, L.level - 0.5, L.z + 1), _q, _s);
      batch.add(this.mats.wood, new THREE.CylinderGeometry(0.15, 0.15, 2.2, 6), _m);
      _m.compose(_v.set(jx + i * 4, L.level - 0.5, L.z - 1), _q, _s);
      batch.add(this.mats.wood, new THREE.CylinderGeometry(0.15, 0.15, 2.2, 6), _m);
    }
    batch.build(this.group);
    // little sailing boats
    for (let i = 0; i < 3; i++) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 1.2), this.mats.white);
      const sail = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4, 3), [this.mats.orange, this.mats.cyan, this.mats.red][i]);
      sail.position.y = 2.3;
      sail.scale.z = 0.1;
      boat.add(hull, sail);
      boat.position.set(L.x + (i - 1) * 25, L.level + 0.2, L.z + (i % 2 ? 10 : -12));
      boat.userData.phase = i * 2;
      this.animated.push((time) => {
        boat.position.y = L.level + 0.2 + Math.sin(time * 1.2 + boat.userData.phase) * 0.12;
        boat.rotation.z = Math.sin(time * 0.9 + boat.userData.phase) * 0.06;
      });
      this.group.add(boat);
    }
  }

  // ------------------------------------------------------------------
  _spectators() {
    const t = this.track;
    const T = this.terrain;
    const W = this.W;
    const rng = makeRng(99);
    const spots = [];
    const addCluster = (sa, sb, side, dMin, dMax, density) => {
      for (let s = sa; s < sb; s += density) {
        const d = side * (W + dMin + rng() * (dMax - dMin));
        const p = this.P(t.wrap(s + rng()), d, 0);
        const g = T.heightAt(p.x, p.z);
        const y = Math.max(g, p.y - 0.1);
        if (y - p.y > 3.5) continue;
        spots.push({ x: p.x, y, z: p.z, face: this.head(t.wrap(s)) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), s: t.wrap(s) });
      }
    };
    addCluster(-140, 150, -1, 1.4, 4.5, 1.1);
    addCluster(-140, 150, 1, 1.4, 4.5, 1.1);
    // hairpins + summit + checkpoints + bridge ends
    for (let i = 0; i < t.count; i += 60) {
      const k = t.CURV[i];
      if (Math.abs(k) > 0.035 && !(t.FLAGS[i] & (FLAG.TUNNEL | FLAG.BRIDGE | FLAG.VILLAGE))) addCluster(i - 25, i + 25, k > 0 ? 1 : -1, 2.8, 6, 1.4);
    }
    if (this.summitS !== null) {
      const summit = this.summitS;
      addCluster(summit - 50, summit + 50, -1, 1.5, 5, 1.2);
      addCluster(summit - 50, summit + 50, 1, 1.5, 5, 1.2);
    }
    for (const cp of t.checkpoints) {
      if (t.FLAGS[t.idx(cp)] & (FLAG.TUNNEL | FLAG.BRIDGE)) continue;
      addCluster(cp - 12, cp + 12, 1, 1.6, 4, 1.4);
      addCluster(cp - 12, cp + 12, -1, 1.6, 4, 1.4);
    }
    const bz = this.zone(FLAG.BRIDGE);
    if (bz) addCluster(bz.s0 - 30, bz.s0 - 8, -1, 1.5, 4, 1.4);
    const nOfficials0 = spots.length;
    for (const cp of [...t.checkpoints, 0]) {
      if (t.FLAGS[t.idx(cp)] & (FLAG.TUNNEL | FLAG.BRIDGE)) continue;
      addCluster(cp - 3, cp + 3, 1, 0.9, 1.2, 3);
      addCluster(cp - 3, cp + 3, -1, 0.9, 1.2, 3);
    }
    for (let i = nOfficials0; i < spots.length; i++) spots[i].official = true;
    if (bz) addCluster(bz.s1 + 8, bz.s1 + 30, 1, 1.5, 4, 1.4);

    // geometry: shirt (torso + raised arms) coloured per instance; legs+head via vertex colours
    const torso = new THREE.CylinderGeometry(0.2, 0.17, 0.62, 7).translate(0, 1.2, 0);
    const armL = new THREE.CylinderGeometry(0.055, 0.05, 0.6, 5).rotateZ(0.5).translate(-0.3, 1.62, 0);
    const armR = new THREE.CylinderGeometry(0.055, 0.05, 0.6, 5).rotateZ(-0.5).translate(0.3, 1.62, 0);
    const shirtGeo = mergeGeometries([torso, armL, armR]);
    const paint = (g, c) => {
      const col = new THREE.Color(c);
      const n = g.attributes.position.count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const legs = paint(new THREE.CylinderGeometry(0.16, 0.12, 0.9, 6).translate(0, 0.45, 0), '#2b3445');
    const head = paint(new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.66, 0), '#e0b394');
    const hat = paint(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 8).translate(0, 1.78, 0.02), '#f4f4f4');
    const restGeo = mergeGeometries([legs, head, hat]);
    const shirtMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const restMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const shirts = new THREE.InstancedMesh(shirtGeo, shirtMat, spots.length);
    const rest = new THREE.InstancedMesh(restGeo, restMat, spots.length);
    const palette = ['#e63946', '#ffd23f', '#3a86ff', '#06d6a0', '#ffffff', '#ff006e', '#f4a261', '#8338ec', '#111111', '#2a9d8f'];
    const col = new THREE.Color();
    spots.forEach((sp, i) => {
      sp.phase = rng() * 10;
      sp.scale = 0.9 + rng() * 0.2;
      sp.face += (rng() - 0.5) * 0.8;
      _q.setFromAxisAngle(Y, sp.face);
      _m.compose(_v.set(sp.x, sp.y, sp.z), _q, _s.set(sp.scale, sp.scale, sp.scale));
      shirts.setMatrixAt(i, _m);
      rest.setMatrixAt(i, _m);
      shirts.setColorAt(i, col.set(sp.official ? '#ff7a00' : palette[Math.floor(rng() * palette.length)]));
      const skin = 0.55 + rng() * 0.5;
      rest.setColorAt(i, col.setRGB(skin, skin, skin));
    });
    _s.set(1, 1, 1);
    shirts.castShadow = rest.castShadow = true;
    shirts.computeBoundingSphere();
    rest.computeBoundingSphere();
    this.group.add(shirts, rest);
    this.spectators = { spots, shirts, rest };
  }

  _flags() {
    const t = this.track;
    const W = this.W;
    const spots = [];
    for (const s of [-60, -30, 20, 50, 110]) for (const side of [-1, 1]) spots.push([t.wrap(s), side * (W + 3.5)]);
    if (this.summitS !== null) for (const o of [-24, -8, 8, 24]) for (const side of [-1, 1]) spots.push([this.summitS + o, side * (W + 3)]);
    for (const cp of t.checkpoints) if (!(t.FLAGS[t.idx(cp)] & (FLAG.TUNNEL | FLAG.BRIDGE))) spots.push([cp + 6, (W + 2.5) * (cp % 2 ? 1 : -1)]);
    const flagGeo = new THREE.PlaneGeometry(1.5, 0.95, 10, 2).translate(0.75, 4.3, 0);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
    const time = (this.flagTime = { value: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float along = max(0.0, transformed.x);
        vec2 ph = vec2(0.0);
        #ifdef USE_INSTANCING
          ph = instanceMatrix[3].xz * 0.3;
        #endif
        transformed.z += sin(along * 3.2 - uTime * 7.0 + ph.x + ph.y) * 0.18 * along;
        transformed.y -= along * along * 0.03;`,
      );
    };
    const flags = new THREE.InstancedMesh(flagGeo, mat, spots.length);
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.05, 4.8, 6).translate(0, 2.4, 0), this.mats.post, spots.length);
    const cols = ['#e63946', '#ffd23f', '#3a86ff', '#06d6a0', '#ffffff', '#ff5a1f', '#8338ec'];
    const c = new THREE.Color();
    spots.forEach(([s, d], i) => {
      const p = this.P(s, d, 0);
      p.y = Math.max(p.y, this.terrain.heightAt(p.x, p.z));
      _q.setFromAxisAngle(Y, this.head(s) + Math.PI / 2);
      _m.compose(p, _q, _s);
      flags.setMatrixAt(i, _m);
      poles.setMatrixAt(i, _m);
      flags.setColorAt(i, c.set(cols[i % cols.length]));
    });
    flags.castShadow = poles.castShadow = true;
    this.group.add(flags, poles);
  }

  _photographers() {
    const t = this.track;
    const W = this.W;
    this.photographers = [];
    const body = new THREE.CylinderGeometry(0.2, 0.17, 1.5, 7).translate(0, 0.75, 0);
    const head = new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.68, 0);
    const cam = new THREE.BoxGeometry(0.2, 0.14, 0.24).translate(0, 1.62, 0.2);
    const lens = new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8).rotateX(Math.PI / 2).translate(0, 1.62, 0.4);
    const batch = new Batch();
    const vestMat = new THREE.MeshStandardMaterial({ color: '#3a4a5a', roughness: 0.8 });
    const skinMat = new THREE.MeshStandardMaterial({ color: '#d7a684', roughness: 0.7 });
    const spots = [];
    for (let i = 0; i < t.count; i += 90) if (Math.abs(t.CURV[i]) > 0.03 && !(t.FLAGS[i] & (FLAG.TUNNEL | FLAG.BRIDGE))) spots.push(i * t.ds);
    spots.push(t.length - 25, t.length - 15, 12);
    if (this.summitS !== null) spots.push(this.summitS + 30);
    for (const s of spots) {
      const side = t.CURV[t.idx(s)] > 0 ? -1 : 1; // inside of the bend, looking at the riders
      const p = this.P(s, side * (W + 1.6), 0);
      p.y = Math.max(p.y, this.terrain.heightAt(p.x, p.z));
      _q.setFromAxisAngle(Y, this.head(s) + Math.PI + side * 0.6);
      _m.compose(p, _q, _s);
      batch.add(vestMat, body, _m);
      batch.add(skinMat, head, _m);
      batch.add(this.mats.dark, cam, _m);
      batch.add(this.mats.dark, lens, _m);
      const flashPos = new THREE.Vector3(0, 1.62, 0.52).applyMatrix4(_m);
      this.photographers.push({ pos: flashPos, next: Math.random() * 3 });
    }
    batch.build(this.group);
  }

  _teamCars() {
    const t = this.track;
    const T = this.terrain;
    const batch = new Batch();
    const cols = ['#e63946', '#1d3557', '#ffd23f', '#06d6a0'];
    const glass = new THREE.MeshStandardMaterial({ color: '#1c2733', roughness: 0.1, metalness: 0.6 });
    const tyre = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
    [[-95, -1], [-80, 1], [135, -1], [150, 1]].forEach(([s, side], i) => {
      const ss = t.wrap(s);
      const p = this.P(ss, side * (this.W + 9), 0);
      p.y = T.heightAt(p.x, p.z);
      _q.setFromAxisAngle(Y, this.head(ss) + 0.15 * side);
      _m.compose(p, _q, _s);
      const paint = new THREE.MeshPhysicalMaterial({ color: cols[i], roughness: 0.3, metalness: 0.4, clearcoat: 1 });
      batch.add(paint, new THREE.BoxGeometry(1.8, 0.7, 4.3).translate(0, 0.62, 0), _m);
      batch.add(glass, new THREE.BoxGeometry(1.62, 0.55, 2.3).translate(0, 1.2, -0.25), _m);
      for (const [x, z] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) batch.add(tyre, new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateZ(Math.PI / 2).translate(x, 0.33, z), _m);
      // roof rack with spare bikes
      batch.add(this.mats.dark, new THREE.BoxGeometry(1.5, 0.05, 2.0).translate(0, 1.5, -0.25), _m);
      for (const x of [-0.5, 0, 0.5]) {
        batch.add(this.mats.metal, new THREE.TorusGeometry(0.3, 0.02, 4, 16).rotateY(Math.PI / 2).translate(x, 1.85, 0.45), _m);
        batch.add(this.mats.metal, new THREE.TorusGeometry(0.3, 0.02, 4, 16).rotateY(Math.PI / 2).translate(x, 1.85, -0.95), _m);
        batch.add(paint, new THREE.BoxGeometry(0.04, 0.35, 1.1).translate(x, 1.95, -0.25), _m);
      }
      this.exclusions.push({ x: p.x, z: p.z, r: 4 });
    });
    batch.build(this.group);
  }

  _waterfallFoam() {
    const cv = canvas(128, 128);
    const ctx = cv.getContext('2d');
    const rng = makeRng(33);
    for (let i = 0; i < 220; i++) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const x = rng() * 128;
      const y = rng() * 128;
      const r = 3 + rng() * 9;
      ctx.fillStyle = `rgba(255,255,255,${0.12 + rng() * 0.25})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      void g;
    }
    const tex = toTexture(cv);
    tex.repeat.set(3, 3);
    this.foamTex = tex;
    const foam = new THREE.Mesh(new THREE.CircleGeometry(13, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 }));
    foam.position.copy(this.waterfallPos).setY(this.terrain.riverLow + 1.5);
    foam.renderOrder = 3;
    this.group.add(foam);
  }

  /** Animate cheering crowd near the camera; excitement near riders. */
  update(time, camPos, riderPositions) {
    for (const f of this.animated) f(time);
    if (this.flagTime) this.flagTime.value = time;
    if (this.foamTex) this.foamTex.offset.set(Math.sin(time * 0.3) * 0.2, time * 0.12);
    // photographers fire their flash as riders pass
    if (this.photographers && this.onFlash) {
      for (const ph of this.photographers) {
        if (time < ph.next) continue;
        let near = false;
        for (const r of riderPositions) if (r.distanceToSquared(ph.pos) < 35 * 35) near = true;
        ph.next = time + (near ? 0.35 + Math.random() * 1.2 : 1.5);
        if (near && camPos.distanceToSquared(ph.pos) < 250 * 250) this.onFlash(ph.pos);
      }
    }
    if (this.waterfallTex) this.waterfallTex.offset.y = -time * 1.4;
    if (this.riverMat) this.riverMat.normalMap.offset.set(time * 0.02, -time * 0.25);
    if (this.lakeMat) this.lakeMat.normalMap.offset.set(time * 0.01, time * 0.013);
    const sp = this.spectators;
    if (!sp) return;
    let dirty = false;
    const sc = new THREE.Vector3();
    for (let i = 0; i < sp.spots.length; i++) {
      const s = sp.spots[i];
      const dx = s.x - camPos.x;
      const dz = s.z - camPos.z;
      if (dx * dx + dz * dz > 110 * 110) continue;
      let exc = s.official ? 0 : 0.15;
      for (const r of riderPositions) {
        const d2 = (s.x - r.x) ** 2 + (s.z - r.z) ** 2;
        if (d2 < 900 && !s.official) exc = Math.max(exc, 1 - d2 / 900);
      }
      const jump = Math.max(0, Math.sin(time * 9 + s.phase)) * 0.28 * exc;
      _q.setFromAxisAngle(Y, s.face + Math.sin(time * 2 + s.phase) * 0.2 * exc);
      sc.setScalar(s.scale);
      _m.compose(_v.set(s.x, s.y + jump, s.z), _q, sc);
      sp.shirts.setMatrixAt(i, _m);
      sp.rest.setMatrixAt(i, _m);
      dirty = true;
    }
    if (dirty) {
      sp.shirts.instanceMatrix.needsUpdate = true;
      sp.rest.instanceMatrix.needsUpdate = true;
    }
  }
}
