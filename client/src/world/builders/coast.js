// Mediterranean coast: open sea, lighthouse on the cape, boats offshore.
import * as THREE from 'three';
import { makeRng } from '@shared/math.js';
import { canvas, toTexture } from '../textures.js';

export function buildSea(P) {
  const S = P.terrain.sea;
  const mat = P._waterMaterial('#12506e');
  mat.opacity = 0.96;
  mat.roughness = 0.12;
  mat.normalMap.repeat.set(220, 220);
  mat.normalScale.set(0.5, 0.5);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000).rotateX(-Math.PI / 2), mat);
  const E = P.terrain.extent;
  sea.position.set(E.cx, S.level, E.cz);
  sea.receiveShadow = true;
  sea.renderOrder = -0.5;
  P.group.add(sea);
  P.animated.push((time) => mat.normalMap.offset.set(time * 0.006, time * 0.004));
}

export function buildLighthouse(P) {
  const t = P.track;
  const L = t.def.env.lighthouse;
  const s = t.cpToS(L.at);
  const base = P.P(s, L.side * (P.W + L.offset));
  base.y = P.terrain.heightAt(base.x, base.z);
  const g = new THREE.Group();
  g.position.copy(base);
  // banded tower texture
  const cv = canvas(64, 256);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f2f0ea';
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#b3261e';
  for (let y = 0; y < 256; y += 64) ctx.fillRect(0, y, 64, 28);
  const towerMat = new THREE.MeshStandardMaterial({ map: toTexture(cv), roughness: 0.7 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.6, 20, 20), towerMat);
  tower.position.y = 10;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.3, 20), P.mats.dark);
  gallery.position.y = 20.2;
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.2, 12), new THREE.MeshStandardMaterial({ color: '#fff4c8', emissive: '#ffe9a0', emissiveIntensity: 2.2, transparent: true, opacity: 0.9 }));
  lantern.position.y = 21.5;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.8, 16), P.mats.red);
  cap.position.y = 23.5;
  const keeper = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 5), new THREE.MeshStandardMaterial({ color: '#f1ece2', roughness: 0.8 }));
  keeper.position.set(4.5, 2, 0);
  g.add(tower, gallery, lantern, cap, keeper);
  // rotating light beam
  const beamMat = new THREE.MeshBasicMaterial({ color: '#fff6d0', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(4, 90, 16, 1, true).rotateZ(Math.PI / 2).translate(45, 0, 0), beamMat);
  beam.position.y = 21.5;
  g.add(beam);
  g.traverse((o) => o.isMesh && o !== beam && (o.castShadow = true));
  P.group.add(g);
  P.exclusions.push({ x: base.x, z: base.z, r: 10 });
  P.animated.push((time) => (beam.rotation.y = time * 0.9));
}

export function buildBoats(P) {
  const S = P.terrain.sea;
  const E = P.terrain.extent;
  const rng = makeRng(P.track.def.seed + 9);
  const hullMat = new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.5 });
  const sailMat = new THREE.MeshStandardMaterial({ color: '#fbfaf5', roughness: 0.8, side: THREE.DoubleSide });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.8 });
  for (let i = 0; i < 14; i++) {
    // points far offshore, along the sea normal
    const along = (rng() - 0.5) * 2400;
    const out = 90 + rng() * 1500;
    const x = E.cx + -S.nz * along + S.nx * (S.d + out);
    const z = E.cz * 0 + S.nx * along + S.nz * (S.d + out);
    if (P.terrain.seaDist(x, z) < 40) continue;
    const boat = new THREE.Group();
    const L = 6 + rng() * 10;
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(L * 0.14, L * 0.7, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.55, 1), hullMat);
    hull.position.y = 0.3;
    boat.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.6, 0.12, L * 0.18), deckMat);
    deck.position.y = 0.75;
    boat.add(deck);
    if (rng() < 0.6) {
      const sail = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0, L * 1.1, 0), new THREE.Vector3(-L * 0.45, 0.9, 0)]), sailMat);
      sail.geometry.computeVertexNormals();
      boat.add(sail);
    } else {
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.28, 1.2, L * 0.16), hullMat);
      cabin.position.set(-L * 0.05, 1.3, 0);
      boat.add(cabin);
    }
    boat.position.set(x, S.level, z);
    boat.rotation.y = rng() * Math.PI * 2;
    const ph = rng() * 6;
    P.animated.push((time) => {
      boat.position.y = S.level + Math.sin(time * 0.9 + ph) * 0.18;
      boat.rotation.z = Math.sin(time * 0.7 + ph) * 0.05;
    });
    P.group.add(boat);
  }
}
