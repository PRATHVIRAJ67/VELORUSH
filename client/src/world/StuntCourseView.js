// Renders one stunt course on top of the already-built map: ramps/decks (the exact height
// function the physics uses), pits, barrel rows, nitro pads, rings, landing targets and the
// checkpoint / finish gates. Built when a stunt level starts, fully disposed when it ends.
import * as THREE from 'three';
import { makeHazard, makeBoostPad, makeBanner, makeChecker, canvas, toTexture, makeConcrete } from './textures.js';

const _w = {};
const _c = {};

function bullseye() {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  const cols = ['#ff2d55', '#ffffff', '#ff2d55', '#ffffff', '#ff2d55'];
  for (let i = 0; i < cols.length; i++) {
    g.fillStyle = cols[i];
    g.beginPath();
    g.ellipse(128, 128, 124 - i * 24, 124 - i * 24, 0, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c, { wrap: false });
}

function pitTexture() {
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#120a0a';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#c1121f';
  for (let i = -128; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 - 128, 128);
    g.lineTo(i - 128, 128);
    g.closePath();
    g.globalAlpha = 0.35;
    g.fill();
  }
  g.globalAlpha = 1;
  return toTexture(c, { repeat: [1, 1] });
}

export class StuntCourseView {
  constructor(scene, course) {
    this.scene = scene;
    this.course = course;
    this.track = course.track;
    this.group = new THREE.Group();
    this.group.name = 'stunt-course';
    this.disposables = [];
    this.ringMeshes = [];
    this.gateMeshes = [];
    this.t = 0;
    this._build();
    scene.add(this.group);
  }

  _mat(m) {
    this.disposables.push(m);
    if (m.map) this.disposables.push(m.map);
    return m;
  }

  _geo(g) {
    this.disposables.push(g);
    return g;
  }

  /** World point on the course surface (road + stunt height + yOff). */
  P(s, d, yOff = 0) {
    const w = this.track.toWorld(s, d, _w);
    return [w.x, w.y + this.course.heightAt(s, d) + yOff, w.z];
  }

  _build() {
    const course = this.course;
    const hazard = makeHazard();
    hazard.repeat.set(2, 1);
    const concrete = makeConcrete();
    const topWood = this._mat(new THREE.MeshStandardMaterial({ color: '#9c7a52', roughness: 0.82 }));
    const topDeck = this._mat(new THREE.MeshStandardMaterial({ map: concrete, color: '#c9c3b8', roughness: 0.9 }));
    const side = this._mat(new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.7, side: THREE.DoubleSide }));
    // ---- ramps / decks: one surface per feature (sampled from the physics height) ----
    for (const f of course.features) {
      if (!f.jump && f.t !== 'rollers') continue;
      const segs = course.segs.filter((g) => g.s0 >= f.s0 - 0.01 && g.s1 <= f.s1 + 0.01);
      if (!segs.length) continue;
      const d0 = segs[0].d0;
      const d1 = segs[0].d1;
      this._solid(f.s0, f.s1, d0, d1, f.t === 'deck' || f.t === 'step' ? topDeck : topWood, side);
    }
    // ---- pits ----
    const pitTex = pitTexture();
    const pitMat = this._mat(new THREE.MeshStandardMaterial({ map: pitTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 }));
    for (const p of course.pits) this._decal(p.s0, p.s1, p.d0, p.d1, pitMat, 0.04);
    // ---- nitro pads ----
    if (course.pads.length) {
      const padTex = makeBoostPad();
      padTex.repeat.set(1, 2);
      this.padTex = padTex;
      const padMat = this._mat(new THREE.MeshStandardMaterial({ map: padTex, emissiveMap: padTex, emissive: new THREE.Color('#ff9f1c'), emissiveIntensity: 1.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      for (const p of course.pads) this._decal(p.s, p.s + p.len, p.d - p.w / 2, p.d + p.w / 2, padMat, 0.07);
    }
    // ---- landing targets ----
    if (course.targets.length) {
      const tex = bullseye();
      const tMat = this._mat(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 }));
      this.targetMats = [];
      for (const t of course.targets) {
        const m = tMat.clone();
        this._mat(m);
        this.targetMats.push(m);
        this._decal(t.s0, t.s1, t.d - t.w / 2, t.d + t.w / 2, m, 0.06, true);
      }
    }
    // ---- barrels (instanced) ----
    if (course.obstacles.length) {
      const pts = [];
      for (const o of course.obstacles) {
        const lo = Math.max(o.d0, -this.track.limit - 0.3);
        const hi = Math.min(o.d1, this.track.limit + 0.3);
        for (let d = lo + 0.45; d <= hi - 0.35; d += 0.85) pts.push([(o.s0 + o.s1) / 2, d]);
      }
      const geo = this._geo(new THREE.CylinderGeometry(0.4, 0.4, 1.05, 14).translate(0, 0.525, 0));
      const bTex = canvas(64, 128);
      const g = bTex.getContext('2d');
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? '#ffffff' : '#e63946';
        g.fillRect(0, i * 32, 64, 32);
      }
      const mat = this._mat(new THREE.MeshStandardMaterial({ map: toTexture(bTex, { wrap: false }), roughness: 0.5, metalness: 0.2 }));
      const inst = new THREE.InstancedMesh(geo, mat, pts.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const pos = new THREE.Vector3();
      const one = new THREE.Vector3(1, 1, 1);
      pts.forEach(([s, d], i) => {
        const w = this.track.toWorld(s, d, _w);
        pos.set(w.x, w.y, w.z);
        q.setFromAxisAngle(up, w.head);
        inst.setMatrixAt(i, m.compose(pos, q, one));
      });
      inst.castShadow = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    }
    // ---- rings ----
    const ringGeo = this._geo(new THREE.TorusGeometry(1, 0.11, 10, 40));
    for (const r of course.rings) {
      const mat = this._mat(new THREE.MeshStandardMaterial({ color: '#ff9f1c', emissive: '#ff6a00', emissiveIntensity: 1.4, roughness: 0.4 }));
      const mesh = new THREE.Mesh(ringGeo, mat);
      const c = this.track.sample(r.s, _c);
      const w = this.track.toWorld(r.s, r.d, _w);
      mesh.position.set(w.x, c.y + r.y, w.z);
      mesh.rotation.set(0, c.head, 0);
      mesh.scale.setScalar(r.r);
      this.group.add(mesh);
      this.ringMeshes.push(mesh);
    }
    // ---- gates: checkpoints + finish ----
    const cpTex = makeBanner('CHECKPOINT', { bg: '#0c7bdc', w: 768, h: 128 });
    const finTex = makeBanner('STUNT FINISH', { bg: '#ff2d55', w: 768, h: 128 });
    const startTex = makeBanner(course.level.name.toUpperCase(), { bg: '#ff9f1c', w: 1024, h: 128 });
    const cpMat = this._mat(new THREE.MeshStandardMaterial({ map: cpTex, roughness: 0.6, side: THREE.DoubleSide }));
    const finMat = this._mat(new THREE.MeshStandardMaterial({ map: finTex, roughness: 0.6, side: THREE.DoubleSide }));
    const startMat = this._mat(new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.6, side: THREE.DoubleSide }));
    const postMat = this._mat(new THREE.MeshStandardMaterial({ color: '#20242c', roughness: 0.5, metalness: 0.6 }));
    for (const g of course.gates) this.gateMeshes.push(this._gate(g.u, cpMat, postMat));
    this._gate(course.finishU, finMat, postMat);
    this._gate(course.startU + 6, startMat, postMat);
    // finish line paint
    const chk = makeChecker(16, 2);
    const chkMat = this._mat(new THREE.MeshStandardMaterial({ map: chk, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 }));
    this._decal(course.finishU - 0.8, course.finishU + 0.8, -this.track.halfWidth, this.track.halfWidth, chkMat, 0.03, true);
  }

  /** Extruded solid following the road between s0..s1 (top = physics height). */
  _solid(s0, s1, d0, d1, topMat, sideMat) {
    const course = this.course;
    const n = Math.max(2, Math.ceil((s1 - s0) / 0.5));
    const top = [];
    const tuv = [];
    const sp = [];
    const suv = [];
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const h = Math.max(course.heightAt(s, (d0 + d1) / 2), 0);
      const L = this.P(s, d0, 0.02);
      const R = this.P(s, d1, 0.02);
      const L0 = this.track.toWorld(s, d0, {});
      const R0 = this.track.toWorld(s, d1, {});
      const row = { L, R, L0: [L0.x, L0.y + 0.01, L0.z], R0: [R0.x, R0.y + 0.01, R0.z], h, s };
      if (prev) {
        const v0 = prev.s / 4;
        const v1 = s / 4;
        top.push(...prev.L, ...prev.R, ...L, ...prev.R, ...R, ...L);
        tuv.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
        if (prev.h > 0.02 || h > 0.02) {
          // left + right walls
          sp.push(...prev.L0, ...L0Arr(row), ...prev.L, ...prev.L, ...L0Arr(row), ...L);
          sp.push(...prev.R0, ...prev.R, ...R0Arr(row), ...prev.R, ...R, ...R0Arr(row));
          for (let k = 0; k < 2; k++) suv.push(v0, 0, v1, 0, v0, prev.h, v0, prev.h, v1, 0, v1, h);
        }
      }
      prev = row;
    }
    // end faces where the solid stands proud of the road (lips, landing faces)
    const face = (s) => {
      const h = course.heightAt(s, (d0 + d1) / 2);
      if (h < 0.05) return;
      const a = this.track.toWorld(s, d0, {});
      const b = this.track.toWorld(s, d1, {});
      sp.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y + h, b.z, a.x, a.y, a.z, b.x, b.y + h, b.z, a.x, a.y + h, a.z);
      suv.push(0, 0, 1, 0, 1, h, 0, 0, 1, h, 0, h);
    };
    // faces at every height discontinuity inside the feature (gap edges, deck end)
    for (let s = s0; s <= s1; s += 0.25) {
      const a = course.heightAt(s, (d0 + d1) / 2);
      const b = course.heightAt(s + 0.25, (d0 + d1) / 2);
      if (Math.abs(a - b) > 0.3) face(a > b ? s + 0.01 : s + 0.24);
    }
    face(s0 + 0.01);
    face(s1 - 0.01);
    const gTop = this._geo(new THREE.BufferGeometry());
    gTop.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
    gTop.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
    gTop.computeVertexNormals();
    const mTop = new THREE.Mesh(gTop, topMat);
    mTop.castShadow = mTop.receiveShadow = true;
    this.group.add(mTop);
    if (sp.length) {
      const gSide = this._geo(new THREE.BufferGeometry());
      gSide.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      gSide.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
      gSide.computeVertexNormals();
      const mSide = new THREE.Mesh(gSide, sideMat);
      mSide.castShadow = true;
      this.group.add(mSide);
    }
    function L0Arr(r) {
      return r.L0;
    }
    function R0Arr(r) {
      return r.R0;
    }
  }

  /** Flat strip on the course surface. */
  _decal(s0, s1, d0, d1, mat, yOff, stretchUv = false) {
    const n = Math.max(1, Math.ceil((s1 - s0) / 1));
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
    const g = this._geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.renderOrder = 1;
    this.group.add(m);
    return m;
  }

  _gate(u, bannerMat, postMat) {
    const s = this.track.wrap(u);
    const hw = this.track.halfWidth + 0.35;
    const g = new THREE.Group();
    const post = this._geo(new THREE.CylinderGeometry(0.12, 0.12, 5.2, 8).translate(0, 2.6, 0));
    for (const d of [-hw, hw]) {
      const w = this.track.toWorld(s, d, _w);
      const m = new THREE.Mesh(post, postMat);
      m.position.set(w.x, w.y, w.z);
      m.castShadow = true;
      g.add(m);
    }
    const c = this.track.sample(s, _c);
    const w = this.track.toWorld(s, 0, _w);
    const banner = new THREE.Mesh(this._geo(new THREE.PlaneGeometry(hw * 2, 1.1)), bannerMat);
    banner.position.set(w.x, w.y + 4.9, w.z);
    banner.rotation.y = c.head + Math.PI;
    g.add(banner);
    this.group.add(g);
    return g;
  }

  /** Per frame: ring states (taken = green), target hits, pad scroll. */
  update(dt, run) {
    this.t += dt;
    if (this.padTex) this.padTex.offset.y = -this.t * 1.6;
    if (!run) return;
    const st = run.state;
    for (let i = 0; i < this.ringMeshes.length; i++) {
      const m = this.ringMeshes[i];
      const taken = st.ringsTaken[i] === 2;
      const pending = st.ringsTaken[i] === 1;
      const col = taken ? 0x35e07a : pending ? 0xfff066 : 0xff9f1c;
      if (m.material.color.getHex() !== col) {
        m.material.color.setHex(col);
        m.material.emissive.setHex(taken ? 0x10a040 : pending ? 0xffd000 : 0xff6a00);
      }
      m.rotation.z = this.t * (taken ? 0 : 0.8);
    }
    if (this.targetMats) for (let i = 0; i < this.targetMats.length; i++) this.targetMats[i].opacity = st.targetsTaken[i] ? 0.35 : 0.75 + Math.sin(this.t * 4) * 0.2;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const d of this.disposables) d.dispose?.();
    this.disposables = [];
  }
}
