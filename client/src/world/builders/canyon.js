// Desert canyon: natural stone arches, hoodoo pillars and a few frontier structures.
import * as THREE from 'three';
import { FLAG } from '@shared/track.js';
import { makeRng } from '@shared/math.js';
import { makeStrata } from '../archTextures.js';
import { Batch } from '../Props.js';

function jitter(geo, amt, rng) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + (rng() - 0.5) * amt, p.getY(i) + (rng() - 0.5) * amt * 0.5, p.getZ(i) + (rng() - 0.5) * amt);
  geo.computeVertexNormals();
  return geo;
}

export function buildArches(P) {
  const t = P.track;
  const T = P.terrain;
  const W = P.W;
  const rng = makeRng(t.def.seed + 51);
  const strata = new THREE.MeshStandardMaterial({ map: makeStrata(P.theme.strata.bands), roughness: 0.95 });
  strata.map.repeat.set(3, 1.2);
  const batch = new Batch();
  // arches: eroded sandstone spans standing on benches beside the route
  let placed = 0;
  for (let k = 0; k < 40 && placed < 4; k++) {
    const s = rng() * t.length;
    if (t.FLAGS[t.idx(s)] & (FLAG.BRIDGE | FLAG.VILLAGE)) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const p = P.P(s, side * (W + 45 + rng() * 90));
    if (T.roadDistAt(p.x, p.z) < W + 35 || T.slopeAt(p.x, p.z) > 0.35) continue;
    p.y = T.heightAt(p.x, p.z);
    const R = 12 + rng() * 12;
    const geo = jitter(new THREE.TorusGeometry(R, R * (0.22 + rng() * 0.1), 10, 28, Math.PI).scale(1, 1.1, 0.55), R * 0.12, rng);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y - R * 0.12, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI), new THREE.Vector3(1, 1, 1));
    batch.add(strata, geo, m);
    // legs flare into the ground
    for (const sx of [-1, 1]) {
      const leg = jitter(new THREE.CylinderGeometry(R * 0.28, R * 0.42, R * 0.5, 9).translate(sx * R, R * 0.1, 0), R * 0.1, rng);
      batch.add(strata, leg, m);
    }
    P.exclusions.push({ x: p.x, z: p.z, r: R + 6 });
    placed++;
  }
  // hoodoos: tall eroded pillars with harder caprock
  const capMat = new THREE.MeshStandardMaterial({ color: '#7e4a30', roughness: 1 });
  for (let k = 0; k < 70; k++) {
    const s = rng() * t.length;
    if (t.FLAGS[t.idx(s)] & (FLAG.BRIDGE | FLAG.VILLAGE)) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const p = P.P(s, side * (W + 14 + rng() * 60));
    if (T.roadDistAt(p.x, p.z) < W + 10) continue;
    p.y = T.heightAt(p.x, p.z);
    const h = 5 + rng() * 14;
    const r = 0.9 + rng() * 1.6;
    const m = new THREE.Matrix4().makeTranslation(p.x, p.y - 0.5, p.z);
    batch.add(strata, jitter(new THREE.CylinderGeometry(r * 0.7, r * 1.25, h, 8, 4).translate(0, h / 2, 0), r * 0.35, rng), m);
    batch.add(capMat, jitter(new THREE.SphereGeometry(r * 1.05, 8, 5).scale(1, 0.45, 1).translate(0, h + 0.2, 0), r * 0.2, rng), m);
    P.exclusions.push({ x: p.x, z: p.z, r: r + 2 });
  }
  batch.build(P.group);
}

export function buildDesertProps(P) {
  const t = P.track;
  const W = P.W;
  const batch = new Batch();
  const steel = P.mats.metal;
  // water tower near the start
  const p = P.P(60, -(W + 30));
  p.y = P.terrain.heightAt(p.x, p.z);
  const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) batch.add(steel, new THREE.CylinderGeometry(0.2, 0.2, 12, 6).translate(x, 6, z), m);
  batch.add(new THREE.MeshStandardMaterial({ color: '#b9b2a6', roughness: 0.6, metalness: 0.4 }), new THREE.CylinderGeometry(3.4, 3.4, 5, 18).translate(0, 14.5, 0), m);
  batch.add(P.mats.dark, new THREE.ConeGeometry(3.6, 1.6, 18).translate(0, 17.8, 0), m);
  P.exclusions.push({ x: p.x, z: p.z, r: 8 });
  batch.build(P.group);
  void t;
}
