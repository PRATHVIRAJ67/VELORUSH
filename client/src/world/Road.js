// Road ribbon + everything painted on / sitting on the road surface.
import * as THREE from 'three';
import { FLAG } from '@shared/track.js';
import { gridSlot } from '@shared/race.js';
import { makeAsphalt, makeCobble, makeGravel, makeVerge, makeConcrete, makeChecker, makeBoostPad, makeHazard } from './textures.js';

const TILE = 22; // metres per texture tile along the road (~isotropic with an 11 m wide road)

export function buildRoad(track) {
  const group = new THREE.Group();
  const hw = track.halfWidth;
  const W = track.halfWidth + track.shoulder;
  const step = 1;
  const rows = Math.floor(track.count / step);
  const tmp = {};

  // --- main carriageway ---
  const pos = [];
  const uv = [];
  const P = (s, d, yOff = 0) => {
    const w = track.toWorld(s, d, tmp);
    return [w.x, w.y + yOff, w.z];
  };
  for (let r = 0; r <= rows; r++) {
    const s = (r % rows) * step * track.ds;
    const sv = (r * step * track.ds) / TILE;
    pos.push(...P(s, -hw, 0.03), ...P(s, 0, 0.05), ...P(s, hw, 0.03));
    uv.push(0, sv, 0.5, sv, 1, sv);
  }
  const bySurf = [[], [], []];
  for (let r = 0; r < rows; r++) {
    const surf = track.SURF[(r * step) % track.count];
    const a = r * 3;
    const b = a + 3;
    const list = bySurf[Math.min(surf, 2)];
    list.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const index = [];
  const mats = [];
  const surfTex = [makeAsphalt(), makeCobble(), makeGravel()];
  const rough = [0.88, 0.8, 0.97];
  bySurf.forEach((list, i) => {
    if (!list.length) return;
    geo.addGroup(index.length, list.length, mats.length);
    index.push(...list);
    mats.push(
      new THREE.MeshStandardMaterial({
        map: surfTex[i].map,
        normalMap: surfTex[i].normalMap,
        normalScale: new THREE.Vector2(0.6, 0.6),
        roughnessMap: surfTex[i].roughnessMap || null,
        roughness: surfTex[i].roughnessMap ? 1 : rough[i],
        envMapIntensity: 0.5,
        metalness: 0,
      }),
    );
  });
  geo.setIndex(index);
  geo.computeVertexNormals();
  const road = new THREE.Mesh(geo, mats);
  road.receiveShadow = true;
  road.name = 'road';
  group.add(road);

  // --- shoulders (verge / concrete on bridges + tunnel) ---
  {
    const spos = [];
    const suv = [];
    for (let r = 0; r <= rows; r++) {
      const s = (r % rows) * step * track.ds;
      const sv = (r * step * track.ds) / TILE;
      spos.push(...P(s, -W, -0.06), ...P(s, -hw, 0.03), ...P(s, hw, 0.03), ...P(s, W, -0.06));
      suv.push(1, sv, 0, sv, 0, sv, 1, sv);
    }
    const verge = [];
    const hard = [];
    for (let r = 0; r < rows; r++) {
      const f = track.FLAGS[(r * step) % track.count];
      const list = f & (FLAG.BRIDGE | FLAG.TUNNEL) ? hard : verge;
      const a = r * 4;
      const b = a + 4;
      list.push(a, a + 1, b, a + 1, b + 1, b, a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
    g.addGroup(0, verge.length, 0);
    g.addGroup(verge.length, hard.length, 1);
    g.setIndex([...verge, ...hard]);
    g.computeVertexNormals();
    const vergeTex = makeVerge().map;
    const conc = makeConcrete();
    conc.repeat.set(1, 1);
    const m = new THREE.Mesh(g, [
      new THREE.MeshStandardMaterial({ map: vergeTex, roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9, color: '#b8b4ac' }),
    ]);
    m.receiveShadow = true;
    group.add(m);
  }

  // --- decals following the road (start line, grid boxes) ---
  const decal = (s0, s1, d0, d1, mat, yOff = 0.06, segs = 4) => {
    const p = [];
    const u = [];
    for (let i = 0; i <= segs; i++) {
      const s = s0 + ((s1 - s0) * i) / segs;
      p.push(...P(s, d0, yOff), ...P(s, d1, yOff));
      u.push(0, i / segs, 1, i / segs);
    }
    const idx = [];
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    return mesh;
  };
  const checkerTex = makeChecker(2, 16);
  checkerTex.rotation = 0;
  const checkerMat = new THREE.MeshStandardMaterial({
    map: checkerTex,
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  group.add(decal(-0.8, 0.8, -hw, hw, checkerMat, 0.07, 2));
  const paint = new THREE.MeshStandardMaterial({ color: '#f4f4ee', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  for (let slot = 0; slot < 8; slot++) {
    const g = gridSlot(slot);
    group.add(decal(g.u + 0.9, g.u + 1.1, g.d - 0.8, g.d + 0.8, paint, 0.07, 1));
    group.add(decal(g.u - 1.2, g.u + 1.1, g.d - 0.8, g.d - 0.7, paint, 0.07, 1));
    group.add(decal(g.u - 1.2, g.u + 1.1, g.d + 0.7, g.d + 0.8, paint, 0.07, 1));
  }

  // --- reflective road studs every 8 m on both edge lines ---
  {
    const studs = [];
    for (let s = 0; s < track.length; s += 8) {
      if (Math.abs(s) < 2) continue;
      for (const side of [-1, 1]) studs.push([s, side * (hw - 0.28)]);
    }
    const geo = new THREE.BoxGeometry(0.16, 0.035, 0.1).translate(0, 0.05, 0);
    const mat = new THREE.MeshStandardMaterial({ color: '#f2f0e6', emissive: '#ffcf6a', emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.2 });
    const inst = new THREE.InstancedMesh(geo, mat, studs.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    studs.forEach(([s, d], i) => {
      const w = track.toWorld(s, d, tmp);
      pos.set(w.x, w.y, w.z);
      q.setFromAxisAngle(up, w.head);
      inst.setMatrixAt(i, m.compose(pos, q, one));
    });
    inst.computeBoundingSphere();
    inst.receiveShadow = true;
    group.add(inst);
  }

  // --- boost pads ---
  const padTex = makeBoostPad();
  padTex.repeat.set(1, 2);
  const padMat = new THREE.MeshStandardMaterial({
    map: padTex,
    emissiveMap: padTex,
    emissive: new THREE.Color('#29e0ff'),
    emissiveIntensity: 1.6,
    transparent: true,
    roughness: 0.3,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  for (const b of track.boosts) group.add(decal(b.s, b.s + b.len, b.d - b.w / 2, b.d + b.w / 2, padMat, 0.08, 6));

  // --- ramps ---
  const hazard = makeHazard();
  hazard.repeat.set(2, 1);
  const rampTop = new THREE.MeshStandardMaterial({ color: '#8c6a45', roughness: 0.85 });
  const rampSide = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.7 });
  for (const r of track.ramps) group.add(buildRamp(track, r, rampTop, rampSide));

  return { group, padTex };
}

function buildRamp(track, r, topMat, sideMat) {
  // Triangular wedge following the road; top slope matches track.rampHeight
  const segs = 6;
  const tmp = {};
  const pos = [];
  const pt = (s, d, h) => {
    const w = track.toWorld(s, d, tmp);
    return [w.x, w.y + 0.03 + h, w.z];
  };
  const L = r.w / 2;
  // top surface
  const top = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const s = r.s + t * r.len;
    top.push(pt(s, r.d - L, t * r.h), pt(s, r.d + L, t * r.h));
  }
  const geoTop = new THREE.BufferGeometry();
  const tp = [];
  const tuv = [];
  for (let i = 0; i < segs; i++) {
    const a0 = top[i * 2];
    const a1 = top[i * 2 + 1];
    const b0 = top[i * 2 + 2];
    const b1 = top[i * 2 + 3];
    tp.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0);
    const v0 = i / segs;
    const v1 = (i + 1) / segs;
    tuv.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
  }
  geoTop.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  geoTop.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  geoTop.computeVertexNormals();
  // sides + back face
  const sp = [];
  const suv = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const s0 = r.s + t0 * r.len;
      const s1 = r.s + t1 * r.len;
      const d = r.d + side * L;
      const a = pt(s0, d, 0);
      const b = pt(s1, d, 0);
      const c = pt(s1, d, t1 * r.h);
      const e = pt(s0, d, t0 * r.h);
      if (side < 0) sp.push(...a, ...b, ...c, ...a, ...c, ...e);
      else sp.push(...a, ...c, ...b, ...a, ...e, ...c);
      suv.push(t0, 0, t1, 0, t1, t1, t0, 0, t1, t1, t0, t0);
    }
  }
  {
    const s1 = r.s + r.len;
    const a = pt(s1, r.d - L, 0);
    const b = pt(s1, r.d + L, 0);
    const c = pt(s1, r.d + L, r.h);
    const e = pt(s1, r.d - L, r.h);
    sp.push(...a, ...c, ...b, ...a, ...e, ...c);
    suv.push(0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1);
  }
  const geoSide = new THREE.BufferGeometry();
  geoSide.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  geoSide.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
  geoSide.computeVertexNormals();
  const g = new THREE.Group();
  const m1 = new THREE.Mesh(geoTop, topMat);
  const m2 = new THREE.Mesh(geoSide, sideMat);
  m2.material.side = THREE.DoubleSide;
  m1.castShadow = m2.castShadow = true;
  m1.receiveShadow = true;
  g.add(m1, m2);
  return g;
}
