// Roadside construction: retaining walls, utility lines, dry-stone walls, fallen timber.
import * as THREE from 'three';
import { FLAG } from '@shared/track.js';
import { makeRng } from '@shared/math.js';
import { Batch } from '../Props.js';

const Y = new THREE.Vector3(0, 1, 0);

/** Contiguous [s0, s1] runs of samples matching a predicate. */
function runs(track, pred, minLen = 10) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= track.count; i++) {
    const ok = i < track.count && pred(i);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - start >= minLen) out.push([start * track.ds, (i - 1) * track.ds]);
      start = -1;
    }
  }
  return out;
}

/** Mortared stone retaining wall holding back the uphill side of cliff roads. */
export function retainingWalls(P) {
  const t = P.track;
  const W = P.W;
  const batch = new Batch();
  for (const [s0, s1] of runs(t, (i) => t.FLAGS[i] & FLAG.CLIFF && !(t.FLAGS[i] & (FLAG.TUNNEL | FLAG.BRIDGE)), 20)) {
    // the uphill side is the one where the terrain rises
    const mid = (s0 + s1) / 2;
    const l = P.P(mid, -(W + 8));
    const r = P.P(mid, W + 8);
    const side = P.terrain.heightAt(l.x, l.z) > P.terrain.heightAt(r.x, r.z) ? -1 : 1;
    const d0 = side * (W + 0.3);
    const d1 = side * (W + 1.1);
    const prof = side > 0 ? [[d0, -0.5], [d0, 2.8], [d1, 3.2], [d1, -0.5]] : [[d1, -0.5], [d1, 3.2], [d0, 2.8], [d0, -0.5]];
    batch.add(P.mats.stone, P._extrude(s0, s1, 2, prof));
  }
  batch.build(P.group);
}

/** Wooden utility poles with sagging wires along the open road. */
export function utilityPoles(P) {
  const t = P.track;
  const W = P.W;
  const T = P.terrain;
  const poles = [];
  for (let s = 20; s < t.length - 20; s += 42) {
    if (t.FLAGS[t.idx(s)] & (FLAG.TUNNEL | FLAG.BRIDGE | FLAG.VILLAGE)) {
      poles.push(null);
      continue;
    }
    const p = P.P(s, W + 5.5);
    p.y = T.heightAt(p.x, p.z);
    poles.push({ p, h: P.head(s) });
  }
  const pole = new THREE.CylinderGeometry(0.13, 0.18, 9, 6).translate(0, 4.5, 0);
  const arm = new THREE.BoxGeometry(1.8, 0.12, 0.12).translate(0, 8.4, 0);
  const valid = poles.filter(Boolean);
  const mat = new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.9 });
  const ip = new THREE.InstancedMesh(pole, mat, valid.length);
  const ia = new THREE.InstancedMesh(arm, mat, valid.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  valid.forEach((v, i) => {
    q.setFromAxisAngle(Y, v.h + Math.PI / 2);
    m.compose(v.p, q, one);
    ip.setMatrixAt(i, m);
    ia.setMatrixAt(i, m);
  });
  ip.castShadow = true;
  P.group.add(ip, ia);
  // wires: three conductors sagging between consecutive poles
  const pts = [];
  for (let i = 0; i < poles.length - 1; i++) {
    const a = poles[i];
    const b = poles[i + 1];
    if (!a || !b) continue;
    for (const off of [-0.8, 0, 0.8]) {
      const ax = a.p.x + Math.cos(a.h) * off;
      const az = a.p.z - Math.sin(a.h) * off;
      const bx = b.p.x + Math.cos(b.h) * off;
      const bz = b.p.z - Math.sin(b.h) * off;
      let prev = null;
      for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        const cur = [ax + (bx - ax) * u, a.p.y + 8.5 + (b.p.y - a.p.y) * u - Math.sin(u * Math.PI) * 1.1, az + (bz - az) * u];
        if (prev) pts.push(...prev, ...cur);
        prev = cur;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  P.group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#1c1c1c' })));
}

/** Dry-stone field walls running beside the forest road. */
export function stoneWalls(P) {
  const t = P.track;
  const W = P.W;
  const rng = makeRng(t.def.seed + 21);
  const batch = new Batch();
  const mat = new THREE.MeshStandardMaterial({ map: P.mats.stone.map, color: '#8d8f86', roughness: 1 });
  for (let s = 30; s < t.length - 60; s += 90 + rng() * 120) {
    if (t.FLAGS[t.idx(s)] & (FLAG.TUNNEL | FLAG.BRIDGE)) continue;
    const len = 25 + rng() * 45;
    const side = rng() < 0.5 ? -1 : 1;
    const d0 = side * (W + 2.2);
    const d1 = side * (W + 2.9);
    const prof = side > 0 ? [[d0, -0.8], [d0, 0.85], [d1, 0.8], [d1, -0.8]] : [[d1, -0.8], [d1, 0.8], [d0, 0.85], [d0, -0.8]];
    batch.add(mat, P._extrude(s, Math.min(t.length - 1, s + len), 2, prof));
  }
  batch.build(P.group);
}

/** Moss-covered fallen trunks on the forest floor. */
export function fallenLogs(P) {
  const t = P.track;
  const T = P.terrain;
  const W = P.W;
  const rng = makeRng(t.def.seed + 33);
  const items = [];
  for (let i = 0; i < 160; i++) {
    const s = rng() * t.length;
    if (t.FLAGS[t.idx(s)] & (FLAG.TUNNEL | FLAG.BRIDGE | FLAG.VILLAGE)) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const p = P.P(s, side * (W + 4 + rng() * 22));
    p.y = T.heightAt(p.x, p.z) + 0.2;
    items.push([p, rng() * Math.PI, 0.7 + rng() * 0.8]);
  }
  const geo = new THREE.CylinderGeometry(0.28, 0.34, 5, 7).rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: '#4b4a33', roughness: 1 });
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  items.forEach(([p, r, sc], k) => {
    q.setFromAxisAngle(Y, r);
    im.setMatrixAt(k, m.compose(p, q, new THREE.Vector3(sc, 1, 1)));
  });
  im.castShadow = true;
  P.group.add(im);
}
