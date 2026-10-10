// Geometry of one stunt sky course, generated from the level's course data: a wooden plank deck
// following the level's own route (with open holes where the gaps are), guard rails, timber
// trestles reaching down into the clouds, wooden kickers / tables / decks / step-ups exactly
// matching the physics height function, barrels, nitro pads, rings, landing targets, checkpoint
// gates and the finish platform. Built when the level loads, disposed with it.
import * as THREE from 'three';
import { makeBoostPad, makeBanner, makeChecker, canvas, toTexture } from './textures.js';
import { makeRng } from '@shared/math.js';

const _w = {};
const _c = {};

/** Plank boards across the travel direction (u across the deck, v along it). */
export function plankTexture(seed = 1, base = [146, 104, 62]) {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  const rng = makeRng(seed);
  const boards = 8;
  const h = 256 / boards;
  for (let i = 0; i < boards; i++) {
    const k = 0.82 + rng() * 0.3;
    g.fillStyle = `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
    g.fillRect(0, i * h, 256, h);
    // grain
    for (let j = 0; j < 14; j++) {
      g.strokeStyle = `rgba(60,35,15,${0.06 + rng() * 0.1})`;
      g.lineWidth = 1;
      g.beginPath();
      const y = i * h + rng() * h;
      g.moveTo(0, y);
      g.bezierCurveTo(80, y + (rng() - 0.5) * 6, 170, y + (rng() - 0.5) * 6, 256, y + (rng() - 0.5) * 4);
      g.stroke();
    }
    // seam + nails
    g.fillStyle = 'rgba(30,18,8,0.75)';
    g.fillRect(0, i * h, 256, 2);
    g.fillStyle = 'rgba(40,40,40,0.8)';
    for (const x of [10, 128, 246]) g.fillRect(x, i * h + h / 2 - 1, 3, 3);
  }
  return toTexture(c);
}

function bullseye() {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  const cols = ['#ff2d55', '#ffffff', '#ff2d55', '#ffffff', '#ff2d55'];
  for (let i = 0; i < cols.length; i++) {
    g.fillStyle = cols[i];
    g.beginPath();
    g.ellipse(128, 128, 124 - i * 24, 124 - i * 24, 0, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c, { wrap: false });
}

export class StuntCourseView {
  constructor(scene, course, { night = false } = {}) {
    this.scene = scene;
    this.course = course;
    this.track = course.track;
    this.night = night;
    this.group = new THREE.Group();
    this.group.name = 'stunt-course';
    this.disposables = [];
    this.ringMeshes = [];
    this.t = 0;
    this._build();
    scene.add(this.group);
  }

  _keep(x) {
    this.disposables.push(x);
    if (x.map) this.disposables.push(x.map);
    return x;
  }

  /** World point on the course surface (road + stunt height + yOff). */
  P(s, d, yOff = 0) {
    const w = this.track.toWorld(s, d, _w);
    return [w.x, w.y + this.course.heightAt(s, d) + yOff, w.z];
  }

  _build() {
    const course = this.course;
    const n = course.level.n;
    const plank = plankTexture(n, [150, 108, 64]);
    plank.repeat.set(1, 1);
    const plankDark = plankTexture(n + 99, [110, 74, 42]);
    this.mats = {
      deck: this._keep(new THREE.MeshStandardMaterial({ map: plank, roughness: 0.85 })),
      ramp: this._keep(new THREE.MeshStandardMaterial({ map: plankDark, roughness: 0.8, color: '#e8c79a' })),
      timber: this._keep(new THREE.MeshStandardMaterial({ color: '#6b4728', roughness: 0.9 })),
      timberLight: this._keep(new THREE.MeshStandardMaterial({ color: '#8a5f36', roughness: 0.85 })),
      steel: this._keep(new THREE.MeshStandardMaterial({ color: '#3a3f48', roughness: 0.45, metalness: 0.7 })),
      side: this._keep(new THREE.MeshStandardMaterial({ color: '#5a3b20', roughness: 0.9, side: THREE.DoubleSide })),
      stripe: this._keep(new THREE.MeshStandardMaterial({ color: '#ffb000', roughness: 0.5, emissive: '#ff8a00', emissiveIntensity: this.night ? 0.8 : 0.15 })),
    };
    this._deck();
    this._trestles();
    for (const f of course.features) {
      if (!f.jump && f.t !== 'rollers') continue;
      const segs = course.segs.filter((g) => g.s0 >= f.s0 - 0.01 && g.s1 <= f.s1 + 0.01);
      if (segs.length) this._solid(f.s0, f.s1, segs[0].d0, segs[0].d1);
    }
    this._barrels();
    this._pads();
    this._targets();
    this._rings();
    this._gates();
    if (this.night) this._lamps();
  }

  /** Ridden road ranges with the full-width gaps cut out. */
  _deckRanges() {
    const c = this.course;
    const lim = this.track.limit;
    const holes = c.pits.filter((p) => p.d0 <= -lim + 0.1 && p.d1 >= lim - 0.1).map((p) => [p.s0, p.s1]).sort((a, b) => a[0] - b[0]);
    const out = [];
    let s = c.startU - 45;
    for (const [a, b] of holes) {
      out.push([s, a]);
      s = b;
    }
    out.push([s, c.finishU + 70]);
    return out.filter(([a, b]) => b - a > 0.5);
  }

  _deck() {
    const W = this.track.halfWidth + this.track.shoulder;
    const th = 0.45;
    for (const [a, b] of this._deckRanges()) {
      const n = Math.max(1, Math.ceil((b - a) / 1.5));
      const top = [];
      const uv = [];
      const sides = [];
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const s = a + ((b - a) * i) / n;
        const L = this.track.toWorld(s, -W, {});
        const R = this.track.toWorld(s, W, {});
        const row = { L: [L.x, L.y, L.z], R: [R.x, R.y, R.z], Lb: [L.x, L.y - th, L.z], Rb: [R.x, R.y - th, R.z], v: s / 3 };
        if (prev) {
          top.push(...prev.L, ...prev.R, ...row.L, ...prev.R, ...row.R, ...row.L);
          uv.push(0, prev.v, 1, prev.v, 0, row.v, 1, prev.v, 1, row.v, 0, row.v);
          sides.push(...prev.L, ...row.L, ...prev.Lb, ...prev.Lb, ...row.L, ...row.Lb);
          sides.push(...prev.R, ...prev.Rb, ...row.R, ...prev.Rb, ...row.Rb, ...row.R);
          sides.push(...prev.Lb, ...row.Lb, ...prev.Rb, ...prev.Rb, ...row.Lb, ...row.Rb);
        }
        prev = row;
      }
      // end caps (the open edges of a gap)
      const cap = (s) => {
        const L = this.track.toWorld(s, -W, {});
        const R = this.track.toWorld(s, W, {});
        sides.push(L.x, L.y, L.z, R.x, R.y, R.z, R.x, R.y - th, R.z, L.x, L.y, L.z, R.x, R.y - th, R.z, L.x, L.y - th, L.z);
      };
      cap(a);
      cap(b);
      this._mesh(top, uv, this.mats.deck, true);
      this._mesh(sides, null, this.mats.side, false);
      this._rails(a, b, W);
    }
  }

  _rails(a, b, W) {
    const posts = [];
    for (let s = a + 1; s < b - 0.5; s += 2.5) for (const d of [-W + 0.1, W - 0.1]) posts.push([s, d]);
    const geo = this._keep(new THREE.BoxGeometry(0.14, 1.05, 0.14).translate(0, 0.52, 0));
    this._instances(geo, this.mats.timber, posts.map(([s, d]) => ({ s, d, y: 0 })));
    // top beam + mid rail as strips
    for (const d of [-W + 0.1, W - 0.1]) {
      for (const [y0, h] of [[0.95, 0.14], [0.48, 0.09]]) {
        const pos = [];
        const n = Math.max(1, Math.ceil((b - a) / 2));
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const s = a + ((b - a) * i) / n;
          const w = this.track.toWorld(s, d, {});
          const row = [w.x, w.y + y0, w.z, w.x, w.y + y0 + h, w.z];
          if (prev) pos.push(prev[0], prev[1], prev[2], row[0], row[1], row[2], prev[3], prev[4], prev[5], prev[3], prev[4], prev[5], row[0], row[1], row[2], row[3], row[4], row[5]);
          prev = row;
        }
        const m = this._mesh(pos, null, y0 > 0.9 ? this.mats.timberLight : this.mats.timber, false);
        m.material.side = THREE.DoubleSide;
      }
    }
  }

  /** Timber trestles under the deck reaching down into the cloud sea. */
  _trestles() {
    const c = this.course;
    const W = this.track.halfWidth + this.track.shoulder;
    let minY = Infinity;
    for (let s = c.startU; s < c.finishU; s += 10) minY = Math.min(minY, this.track.sample(s, _c).y);
    const floor = minY - 95;
    const legs = [];
    const braces = [];
    for (const [a, b] of this._deckRanges()) {
      for (let s = a + 4; s < b - 2; s += 22) {
        const c0 = this.track.sample(s, _c);
        const depth = c0.y - floor;
        for (const d of [-W + 0.5, W - 0.5]) legs.push({ s, d, y: -0.45, len: depth });
        // cross braces every 9 m down the tower
        for (let y = 2; y < Math.min(depth, 60); y += 9) braces.push({ s, d: 0, y: -y, len: W * 2.2 });
      }
    }
    const legGeo = this._keep(new THREE.BoxGeometry(0.42, 1, 0.42).translate(0, -0.5, 0));
    this._instances(legGeo, this.mats.timber, legs, (o, m) => m.scale.set(1, o.len, 1));
    const braceGeo = this._keep(new THREE.BoxGeometry(1, 0.22, 0.22));
    this._instances(braceGeo, this.mats.timberLight, braces, (o, m) => m.scale.set(o.len, 1, 1));
  }

  /** Instanced boxes along the road: items {s, d, y, len}; yaw follows the road. */
  _instances(geo, mat, items, scaleFn, rotateAcross = false) {
    if (!items.length) return null;
    const inst = new THREE.InstancedMesh(geo, mat, items.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    items.forEach((o, i) => {
      const w = this.track.toWorld(o.s, o.d, _w);
      pos.set(w.x, w.y + o.y, w.z);
      q.setFromAxisAngle(up, w.head + (rotateAcross ? Math.PI / 2 : 0));
      sc.set(1, 1, 1);
      if (scaleFn) scaleFn(o, { scale: sc });
      inst.setMatrixAt(i, m.compose(pos, q, sc));
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    this.group.add(inst);
    return inst;
  }

  _mesh(pos, uv, mat, receive) {
    const g = this._keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = !!receive;
    this.group.add(m);
    return m;
  }

  /** Wooden ramp / deck solid between s0..s1 (top = the physics height function). */
  _solid(s0, s1, d0, d1) {
    const course = this.course;
    const mid = (d0 + d1) / 2;
    const n = Math.max(2, Math.ceil((s1 - s0) / 0.5));
    const top = [];
    const tuv = [];
    const sp = [];
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const h = course.heightAt(s, mid);
      const L = this.P(s, d0, 0.02);
      const R = this.P(s, d1, 0.02);
      const L0 = this.track.toWorld(s, d0, {});
      const R0 = this.track.toWorld(s, d1, {});
      const row = { L, R, L0: [L0.x, L0.y, L0.z], R0: [R0.x, R0.y, R0.z], h, v: s / 3 };
      if (prev && (prev.h > 0.02 || h > 0.02)) {
        top.push(...prev.L, ...prev.R, ...L, ...prev.R, ...R, ...L);
        tuv.push(0, prev.v, 1, prev.v, 0, row.v, 1, prev.v, 1, row.v, 0, row.v);
        sp.push(...prev.L0, ...row.L0, ...prev.L, ...prev.L, ...row.L0, ...L);
        sp.push(...prev.R0, ...prev.R, ...row.R0, ...prev.R, ...R, ...row.R0);
      }
      prev = row;
    }
    const face = (s) => {
      const h = course.heightAt(s, mid);
      if (h < 0.05) return;
      const a = this.track.toWorld(s, d0, {});
      const b = this.track.toWorld(s, d1, {});
      sp.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y + h, b.z, a.x, a.y, a.z, b.x, b.y + h, b.z, a.x, a.y + h, a.z);
    };
    for (let s = s0; s <= s1; s += 0.25) {
      const a = course.heightAt(s, mid);
      const b = course.heightAt(s + 0.25, mid);
      if (Math.abs(a - b) > 0.3) face(a > b ? s + 0.01 : s + 0.24);
    }
    face(s0 + 0.01);
    face(s1 - 0.01);
    if (top.length) this._mesh(top, tuv, this.mats.ramp, true);
    if (sp.length) this._mesh(sp, null, this.mats.side, false);
    // yellow lip stripes where the ramp ends in the air
    for (let s = s0 + 0.5; s < s1; s += 0.25) {
      const a = course.heightAt(s, mid);
      const b = course.heightAt(s + 0.25, mid);
      if (a - b > 0.3) {
        const A = this.P(s, d0, 0.03);
        const B = this.P(s, d1, 0.03);
        const A2 = this.P(s - 0.35, d0, 0.03);
        const B2 = this.P(s - 0.35, d1, 0.03);
        this._mesh([...A2, ...B2, ...A, ...B2, ...B, ...A], null, this.mats.stripe, false);
      }
    }
  }

  _barrels() {
    const c = this.course;
    if (!c.obstacles.length) return;
    const lim = this.track.limit + 0.3;
    const items = [];
    for (const o of c.obstacles) for (let d = Math.max(o.d0, -lim) + 0.45; d <= Math.min(o.d1, lim) - 0.35; d += 0.85) items.push({ s: (o.s0 + o.s1) / 2, d, y: 0 });
    const tex = canvas(64, 128);
    const g = tex.getContext('2d');
    g.fillStyle = '#8a5a30';
    g.fillRect(0, 0, 64, 128);
    for (let x = 0; x < 64; x += 8) {
      g.fillStyle = 'rgba(40,20,5,0.35)';
      g.fillRect(x, 0, 1, 128);
    }
    g.fillStyle = '#2b2b2f';
    for (const y of [10, 40, 84, 114]) g.fillRect(0, y, 64, 6);
    const mat = this._keep(new THREE.MeshStandardMaterial({ map: toTexture(tex, { wrap: false }), roughness: 0.7, metalness: 0.1 }));
    const geo = this._keep(new THREE.CylinderGeometry(0.38, 0.42, 1.05, 14).translate(0, 0.525, 0));
    this._instances(geo, mat, items);
  }

  _pads() {
    if (!this.course.pads.length) return;
    const padTex = makeBoostPad();
    padTex.repeat.set(1, 2);
    this.padTex = padTex;
    const mat = this._keep(new THREE.MeshStandardMaterial({ map: padTex, emissiveMap: padTex, emissive: new THREE.Color('#ff9f1c'), emissiveIntensity: 1.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    for (const p of this.course.pads) this._decal(p.s, p.s + p.len, p.d - p.w / 2, p.d + p.w / 2, mat, 0.05);
  }

  _targets() {
    const c = this.course;
    if (!c.targets.length) return;
    const tex = bullseye();
    this.targetMats = [];
    for (const t of c.targets) {
      const m = this._keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 }));
      this.targetMats.push(m);
      this._decal(t.s0, t.s1, t.d - t.w / 2, t.d + t.w / 2, m, 0.06, true);
    }
  }

  _rings() {
    const geo = this._keep(new THREE.TorusGeometry(1, 0.11, 10, 40));
    for (const r of this.course.rings) {
      const mat = this._keep(new THREE.MeshStandardMaterial({ color: '#ff9f1c', emissive: '#ff6a00', emissiveIntensity: 1.4, roughness: 0.4 }));
      const mesh = new THREE.Mesh(geo, mat);
      const c = this.track.sample(r.s, _c);
      const w = this.track.toWorld(r.s, r.d, _w);
      mesh.position.set(w.x, c.y + r.y, w.z);
      mesh.rotation.set(0, c.head, 0);
      mesh.scale.setScalar(r.r);
      this.group.add(mesh);
      this.ringMeshes.push(mesh);
    }
  }

  _gates() {
    const c = this.course;
    const cp = this._keep(new THREE.MeshStandardMaterial({ map: makeBanner('CHECKPOINT', { bg: '#0c7bdc', w: 768, h: 128 }), roughness: 0.6, side: THREE.DoubleSide }));
    const fin = this._keep(new THREE.MeshStandardMaterial({ map: makeBanner('FINISH', { bg: '#ff2d55', w: 768, h: 128 }), roughness: 0.6, side: THREE.DoubleSide }));
    const start = this._keep(new THREE.MeshStandardMaterial({ map: makeBanner(c.level.name.toUpperCase(), { bg: '#ff9f1c', w: 1024, h: 128 }), roughness: 0.6, side: THREE.DoubleSide }));
    for (const g of c.gates) this._gate(g.u, cp);
    this._gate(c.finishU, fin, true);
    this._gate(c.startU + 6, start);
    const chk = makeChecker(16, 2);
    const chkMat = this._keep(new THREE.MeshStandardMaterial({ map: chk, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 }));
    this._decal(c.finishU - 0.8, c.finishU + 0.8, -this.track.halfWidth, this.track.halfWidth, chkMat, 0.03, true);
  }

  _gate(u, mat, finish = false) {
    const s = this.track.wrap(u);
    const W = this.track.halfWidth + this.track.shoulder - 0.1;
    const post = this._keep(new THREE.BoxGeometry(0.4, 5.4, 0.4).translate(0, 2.7, 0));
    for (const d of [-W, W]) {
      const w = this.track.toWorld(s, d, _w);
      const m = new THREE.Mesh(post, this.mats.timber);
      m.position.set(w.x, w.y, w.z);
      m.rotation.y = w.head;
      m.castShadow = true;
      this.group.add(m);
    }
    const c = this.track.sample(s, _c);
    const w = this.track.toWorld(s, 0, _w);
    const beam = new THREE.Mesh(this._keep(new THREE.BoxGeometry(W * 2 + 0.6, 0.35, 0.35)), this.mats.timberLight);
    beam.position.set(w.x, w.y + 5.4, w.z);
    beam.rotation.y = c.head;
    this.group.add(beam);
    const banner = new THREE.Mesh(this._keep(new THREE.PlaneGeometry(W * 2, 1.1)), mat);
    banner.position.set(w.x, w.y + 4.75, w.z);
    banner.rotation.y = c.head + Math.PI;
    this.group.add(banner);
    if (finish) {
      // finish platform: flags along the run-out
      const flagGeo = this._keep(new THREE.PlaneGeometry(0.9, 0.6).translate(0.45, 0, 0));
      const flagMats = ['#ff2d55', '#ffd166', '#18c8ff', '#7ff0ac'].map((col) => this._keep(new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, roughness: 0.7 })));
      for (let k = 0; k < 10; k++) {
        for (const d of [-W, W]) {
          const p = this.track.toWorld(s + 4 + k * 5, d, {});
          const pole = new THREE.Mesh(this._keep(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6).translate(0, 1.3, 0)), this.mats.steel);
          pole.position.set(p.x, p.y, p.z);
          const flag = new THREE.Mesh(flagGeo, flagMats[(k + (d > 0 ? 1 : 0)) % 4]);
          flag.position.set(p.x, p.y + 2.25, p.z);
          flag.rotation.y = p.head + Math.PI / 2;
          this.group.add(pole, flag);
        }
      }
    }
  }

  /** Night sky: lanterns on the rails. */
  _lamps() {
    const c = this.course;
    const W = this.track.halfWidth + this.track.shoulder - 0.1;
    const items = [];
    for (const [a, b] of this._deckRanges()) for (let s = a + 2; s < b; s += 15) for (const d of [-W, W]) items.push({ s, d, y: 1.25 });
    const geo = this._keep(new THREE.SphereGeometry(0.16, 8, 6));
    const mat = this._keep(new THREE.MeshBasicMaterial({ color: '#ffd38a' }));
    this._instances(geo, mat, items);
  }

  /** Flat strip on the course surface. */
  _decal(s0, s1, d0, d1, mat, yOff, stretchUv = false) {
    const n = Math.max(1, Math.ceil(s1 - s0));
    const pos = [];
    const uv = [];
    for (let i = 0; i < n; i++) {
      const a = s0 + ((s1 - s0) * i) / n;
      const b = s0 + ((s1 - s0) * (i + 1)) / n;
      const A0 = this.P(a, d0, yOff);
      const A1 = this.P(a, d1, yOff);
      const B0 = this.P(b, d0, yOff);
      const B1 = this.P(b, d1, yOff);
      pos.push(...A0, ...A1, ...B0, ...A1, ...B1, ...B0);
      const v0 = stretchUv ? i / n : (a - s0) / 4;
      const v1 = stretchUv ? (i + 1) / n : (b - s0) / 4;
      uv.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
    }
    const m = this._mesh(pos, uv, mat, true);
    m.renderOrder = 1;
    m.castShadow = false;
    return m;
  }

  /** Per frame: ring states (taken = green), target hits, pad scroll. */
  update(dt, run) {
    this.t += dt;
    if (this.padTex) this.padTex.offset.y = -this.t * 1.6;
    const st = run?.state;
    for (let i = 0; i < this.ringMeshes.length; i++) {
      const m = this.ringMeshes[i];
      const v = st ? st.ringsTaken[i] : 0;
      const col = v === 2 ? 0x35e07a : v === 1 ? 0xfff066 : 0xff9f1c;
      if (m.material.color.getHex() !== col) {
        m.material.color.setHex(col);
        m.material.emissive.setHex(v === 2 ? 0x10a040 : v === 1 ? 0xffd000 : 0xff6a00);
      }
      m.rotation.z = v === 2 ? 0 : this.t * 0.8;
    }
    if (this.targetMats) for (let i = 0; i < this.targetMats.length; i++) this.targetMats[i].opacity = st?.targetsTaken[i] ? 0.35 : 0.75 + Math.sin(this.t * 4) * 0.2;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose?.();
    this.disposables = [];
  }
}
