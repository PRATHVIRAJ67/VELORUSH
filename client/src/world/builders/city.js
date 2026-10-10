// Night city: sidewalks + curbs, procedurally varied buildings with lit windows,
// street lamps with light pools, crosswalks, traffic lights, street trees and a skyline.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLAG } from '@shared/track.js';
import { makeRng } from '@shared/math.js';
import { makeConcrete } from '../textures.js';
import { makeFacade, makeShopfront, makeZebra, makeLightPool } from '../archTextures.js';
import { Batch } from '../Props.js';

const Y = new THREE.Vector3(0, 1, 0);
const SIDEWALK = 4.5;
/** Raised sidewalk band beside the road (offsets from the road edge W, top height above the road). */
export const CITY_SIDEWALK = { inner: 0.25, outer: SIDEWALK, top: 0.19 };

/** Quad strip following the road surface (decals). */
function roadDecal(P, s0, s1, d0, d1, yOff, segs, mat) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const s = s0 + ((s1 - s0) * i) / segs;
    const a = P.P(s, d0, yOff);
    const b = P.P(s, d1, yOff);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(0, i / segs, 1, i / segs);
    if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** Building shell: four facade walls with UVs scaled to real window modules + a roof. */
function buildingGeo(w, h, d) {
  const walls = [];
  const face = (width, rotY, off) => {
    const g = new THREE.PlaneGeometry(width, h).translate(0, h / 2, 0);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * width) / 18, (uv.getY(i) * h) / 42);
    g.rotateY(rotY);
    g.translate(Math.sin(rotY) * off, 0, Math.cos(rotY) * off);
    return g;
  };
  walls.push(face(w, 0, d / 2), face(w, Math.PI, d / 2), face(d, Math.PI / 2, w / 2), face(d, -Math.PI / 2, w / 2));
  return mergeGeometries(walls);
}

export function buildCity(P) {
  const t = P.track;
  const T = P.terrain;
  const W = P.W;
  const rng = makeRng(t.def.seed + 77);
  const night = P.night;
  const inZone = (s, f) => !!(t.FLAGS[t.idx(s)] & f);

  // ---------------- sidewalks with curbs ----------------
  const pave = new THREE.MeshStandardMaterial({ map: makeConcrete(), color: '#8e8e8a', roughness: 0.85 });
  pave.map.repeat.set(1, 1);
  const curbMat = new THREE.MeshStandardMaterial({ color: '#b9b7b0', roughness: 0.7 });
  const walk = new Batch();
  // register the sidewalk so props and spectators stand on its top (Props.groundY)
  const sidewalk = { d0: W + CITY_SIDEWALK.inner, d1: W + CITY_SIDEWALK.outer, top: CITY_SIDEWALK.top, spans: [] };
  P.walkways.push(sidewalk);
  let start = -1;
  for (let i = 0; i <= t.count; i++) {
    const ok = i < t.count && !(t.FLAGS[i] & (FLAG.BRIDGE | FLAG.TUNNEL));
    if (ok && start < 0) start = i;
    if ((!ok || i === t.count) && start >= 0) {
      const s0 = start * t.ds;
      // the strip that reaches the end of the lap closes the loop (no gap at the finish line)
      const s1 = i === t.count ? t.length + t.ds : (i - 1) * t.ds;
      if (s1 - s0 > 6) {
        sidewalk.spans.push([s0, s1]);
        for (const side of [-1, 1]) {
          const a = side * W;
          const b = side * (W + 0.25);
          const c = side * (W + SIDEWALK);
          const curb = side > 0 ? [[a, -0.1], [a, 0.16], [b, 0.18]] : [[b, 0.18], [a, 0.16], [a, -0.1]];
          const top = side > 0 ? [[b, 0.18], [c, 0.2], [c, -1]] : [[c, -1], [c, 0.2], [b, 0.18]];
          walk.add(curbMat, P._extrude(s0, s1, 2, curb));
          walk.add(pave, P._extrude(s0, s1, 2, top));
        }
      }
      start = -1;
    }
  }
  walk.build(P.group, { cast: false });

  // ---------------- buildings ----------------
  const styles = ['glass', 'apartment', 'brick', 'apartment', 'glass'];
  const facadeMats = styles.map((st, i) => {
    const f = makeFacade(st, i + 1);
    return new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissiveMap, emissive: '#ffffff', emissiveIntensity: night ? 0.75 : 0, roughness: st === 'glass' ? 0.25 : 0.8, metalness: st === 'glass' ? 0.5 : 0 });
  });
  const shop = makeShopfront(3);
  const shopMat = new THREE.MeshStandardMaterial({ map: shop.map, emissiveMap: shop.emissiveMap, emissive: '#ffffff', emissiveIntensity: night ? 0.8 : 0, roughness: 0.5 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.9 });
  const beaconMat = new THREE.MeshBasicMaterial({ color: '#ff2a2a' });
  const batch = new Batch();
  const placed = [];
  const beacons = [];
  // downtown: tallest towers around the plaza hairpin
  const plaza = P.P(t.cpToS(10.5), 0);
  for (const side of [-1, 1]) {
    for (let s = 6; s < t.length - 6; ) {
      const bw = 16 + rng() * 16;
      const bd = 14 + rng() * 14;
      const sc = s + bw / 2;
      s += bw + 2 + rng() * 6;
      if (inZone(sc, FLAG.BRIDGE) || inZone(sc, FLAG.TUNNEL)) continue;
      if (Math.abs(((sc + t.length / 2) % t.length) - t.length / 2) < 14) continue; // keep the finish open
      const off = W + SIDEWALK + 1.5 + bd / 2;
      const c = P.P(sc, side * off);
      if (T.roadDistAt(c.x, c.z) < off - 3) continue; // would cover another street
      const rr = Math.max(bw, bd) * 0.55;
      if (placed.some((q) => (q.x - c.x) ** 2 + (q.z - c.z) ** 2 < (q.r + rr) ** 2)) continue;
      placed.push({ x: c.x, z: c.z, r: rr });
      const dt = Math.hypot(c.x - plaza.x, c.z - plaza.z);
      const downtown = Math.max(0, 1 - dt / 420);
      const h = 12 + rng() * 22 + downtown * downtown * (60 + rng() * 70);
      const ground = T.heightAt(c.x, c.z);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(c.x, ground - 0.5, c.z), new THREE.Quaternion().setFromAxisAngle(Y, P.head(sc)), new THREE.Vector3(1, 1, 1));
      const mat = facadeMats[Math.floor(rng() * facadeMats.length)];
      batch.add(mat, buildingGeo(bw, h, bd), m);
      batch.add(roofMat, new THREE.BoxGeometry(bw, 0.8, bd).translate(0, h + 0.4, 0), m);
      // ground-floor shops facing the street
      const sf = new THREE.PlaneGeometry(bw * 0.96, 4).translate(0, 2.4, 0);
      const suv = sf.attributes.uv;
      for (let i = 0; i < suv.count; i++) suv.setX(i, (suv.getX(i) * bw) / 20);
      sf.rotateY(side > 0 ? Math.PI : 0).translate(0, 0, (side > 0 ? -1 : 1) * (bd / 2 + 0.06));
      batch.add(shopMat, sf, m);
      // rooftop plant + aviation beacon on towers
      batch.add(roofMat, new THREE.BoxGeometry(bw * 0.3, 2.2, bd * 0.3).translate(bw * 0.15, h + 1.9, 0), m);
      if (h > 60) beacons.push(new THREE.Vector3(0, h + 3.4, 0).applyMatrix4(m));
      P.exclusions.push({ x: c.x, z: c.z, r: rr + 2 });
    }
  }
  batch.build(P.group);
  if (beacons.length) {
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), beaconMat, beacons.length);
    beacons.forEach((b, i) => bm.setMatrixAt(i, new THREE.Matrix4().makeTranslation(b.x, b.y, b.z)));
    P.group.add(bm);
    P.animated.push((time) => beaconMat.color.set(Math.sin(time * 3) > 0.6 ? '#ff2a2a' : '#3a0808'));
  }

  // ---------------- distant skyline ----------------
  const E = T.extent;
  const sky = [];
  for (let i = 0; i < 360; i++) {
    const a = rng() * Math.PI * 2;
    const r = E.r + 250 + rng() * 1100;
    const x = E.cx + Math.cos(a) * r;
    const z = E.cz + Math.sin(a) * r;
    if (T.roadDistAt(x, z) < 90) continue;
    sky.push([x, z, 20 + rng() * rng() * 160, 18 + rng() * 26]);
  }
  const skyMat = facadeMats[0].clone();
  skyMat.map = facadeMats[0].map.clone();
  skyMat.map.repeat.set(1.5, 3);
  skyMat.map.needsUpdate = true;
  skyMat.emissiveMap = skyMat.map;
  skyMat.emissiveIntensity = night ? 0.55 : 0;
  const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const sk = new THREE.InstancedMesh(unit, skyMat, sky.length);
  sky.forEach(([x, z, h, w], i) => sk.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, T.heightAt(x, z) - 1, z), new THREE.Quaternion().setFromAxisAngle(Y, rng() * 3), new THREE.Vector3(w, h, w * (0.7 + rng() * 0.6)))));
  P.group.add(sk);

  // ---------------- street lamps + light pools ----------------
  const lamps = [];
  for (let s = 8, k = 0; s < t.length - 4; s += 26, k++) {
    if (inZone(s, FLAG.TUNNEL)) continue;
    const side = k % 2 ? 1 : -1;
    lamps.push([s, side]);
  }
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.1, 0.16, 8.5, 8).translate(0, 4.25, 0),
    new THREE.BoxGeometry(0.12, 0.12, 2.4).translate(0, 8.4, 1.1),
  ]);
  const headGeo = new THREE.BoxGeometry(0.5, 0.18, 1).translate(0, 8.3, 2.1);
  const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.5, metalness: 0.6 });
  const headMat = new THREE.MeshBasicMaterial({ color: night ? '#ffd9a0' : '#9aa0a8' });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, lamps.length);
  const poolMat = new THREE.MeshBasicMaterial({ map: makeLightPool(), opacity: 0.42, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2), poolMat, lamps.length);
  lamps.forEach(([s, side], i) => {
    // on the bridge the deck ends at W + 0.6: mount the lamp on the deck edge instead of in mid-air
    const ld = side * (inZone(s, FLAG.BRIDGE) ? W + 0.35 : W + 1.2);
    const base = P.P(s, ld);
    base.y = P.groundY(s, ld, 0.1);
    const q = new THREE.Quaternion().setFromAxisAngle(Y, P.head(s) + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
    const m = new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1));
    poles.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    // light pool lies on the road: tilted to its slope and turned to its heading (flat squares hovered on hills)
    const pool = P.P(s, side * (W - 2.2), 0.09);
    const c = t.sample(s);
    const fwd = new THREE.Vector3(c.hx, c.slope, c.hz).normalize();
    const lat = new THREE.Vector3(fwd.z, 0, -fwd.x).normalize();
    const up = new THREE.Vector3().crossVectors(fwd, lat);
    pools.setMatrixAt(i, new THREE.Matrix4().makeBasis(lat, up, fwd).setPosition(pool));
  });
  poles.castShadow = true;
  pools.renderOrder = 2;
  pools.visible = night;
  P.group.add(poles, heads, pools);

  // ---------------- crosswalks + traffic lights ----------------
  const zebra = new THREE.MeshStandardMaterial({ map: makeZebra(), transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false });
  zebra.map.repeat.set(Math.round((W * 2) / 1.6), 1);
  const tl = new Batch();
  const red = new THREE.MeshBasicMaterial({ color: '#ff3b30' });
  const green = new THREE.MeshBasicMaterial({ color: '#2cff6a' });
  const amber = new THREE.MeshBasicMaterial({ color: '#3a2a08' });
  const cps = [...t.checkpoints.map((c) => c - 30), t.length * 0.5];
  cps.forEach((s, k) => {
    s = t.wrap(s);
    if (inZone(s, FLAG.BRIDGE | FLAG.TUNNEL) || Math.abs(t.CURV[t.idx(s)]) > 0.01) return;
    const decal = roadDecal(P, s - 2, s + 2, -W + 0.3, W - 0.3, 0.07, 2, zebra);
    // stripes run across the road: rotate UV by swapping via texture repeat on u
    decal.renderOrder = 1;
    P.group.add(decal);
    for (const side of [-1, 1]) {
      const b = P.P(s - 3, side * (W + 0.9));
      b.y = P.groundY(s - 3, side * (W + 0.9), 0.1);
      const m = new THREE.Matrix4().compose(b, new THREE.Quaternion().setFromAxisAngle(Y, P.head(s) + Math.PI), new THREE.Vector3(1, 1, 1));
      tl.add(poleMat, new THREE.CylinderGeometry(0.08, 0.1, 3.2, 6).translate(0, 1.6, 0), m);
      tl.add(P.mats.dark, new THREE.BoxGeometry(0.4, 1.1, 0.3).translate(0, 3.6, 0), m);
      tl.add(k % 2 ? green : red, new THREE.SphereGeometry(0.11, 8, 6).translate(0, k % 2 ? 3.3 : 3.95, 0.16), m);
      tl.add(amber, new THREE.SphereGeometry(0.11, 8, 6).translate(0, 3.62, 0.16), m);
    }
  });
  tl.build(P.group, { cast: false });

  // ---------------- street trees in planters ----------------
  const trees = [];
  for (let s = 20; s < t.length; s += 34) {
    if (inZone(s, FLAG.BRIDGE | FLAG.TUNNEL)) continue;
    for (const side of [-1, 1]) {
      const p = P.P(s + side * 7, side * (W + SIDEWALK - 1.1));
      p.y = P.groundY(s + side * 7, side * (W + SIDEWALK - 1.1), 0.16);
      trees.push(p);
    }
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 3, 6).translate(0, 1.5, 0), new THREE.MeshStandardMaterial({ color: '#4a3a2c' }), trees.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.7, 1).scale(1, 1.2, 1).translate(0, 4.3, 0), new THREE.MeshStandardMaterial({ color: '#2f4a2a', roughness: 0.9 }), trees.length);
  trees.forEach((p, i) => {
    const m = new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 0.85 + rng() * 0.35, 1));
    trunk.setMatrixAt(i, m);
    crown.setMatrixAt(i, m);
  });
  trunk.castShadow = crown.castShadow = true;
  P.group.add(trunk, crown);
}
