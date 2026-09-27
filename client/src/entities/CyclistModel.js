// Procedural road bike + cyclist with IK-driven legs/arms.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeSpokes, makeJersey, makeCarbon, makeHelmet, makeRotor } from '../world/textures.js';
import { OUTFITS } from '@shared/constants.js';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  shared = {
    black: new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.75 }),
    tire: new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.95 }),
    tape: new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.95 }),
    cable: new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: '#8d9299', roughness: 0.35, metalness: 1 }),
    metal: new THREE.MeshStandardMaterial({ color: '#b9bec6', roughness: 0.3, metalness: 0.9 }),
    shorts: new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.6 }),
    sock: new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.8 }),
    lens: new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.1, metalness: 0.8 }),
    carbon: (() => {
      const c = makeCarbon();
      return new THREE.MeshPhysicalMaterial({ map: c.map, normalMap: c.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15 });
    })(),
    rotor: new THREE.MeshStandardMaterial({ map: makeRotor(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.3, metalness: 1 }),
    spokes: makeSpokes(false),
    spokesBlur: makeSpokes(true),
  };
  return shared;
}

function tubeGeo(a, b, r0, r1 = r0, seg = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Limb pivoting at its top joint, extending along -Y. */
function limbGeo(len, r0, r1) {
  const g = new THREE.CylinderGeometry(r0, r1, len, 9, 1);
  g.translate(0, -len / 2, 0);
  const cap = new THREE.SphereGeometry(r0, 9, 6);
  const cap2 = new THREE.SphereGeometry(r1, 9, 6).translate(0, -len, 0);
  return mergeGeometries([g.toNonIndexed(), cap.toNonIndexed(), cap2.toNonIndexed()]);
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Key frame points (bike local; +z forward, right = -x)
const P = {
  rear: V(0, 0.34, -0.5),
  front: V(0, 0.34, 0.52),
  bb: V(0, 0.27, -0.08),
  seat: V(0, 0.8, -0.24),
  htTop: V(0, 0.86, 0.37),
  htBot: V(0, 0.7, 0.41),
};


/** Two-bone IK: returns joint position. */
const _ik1 = new THREE.Vector3();
const _ik2 = new THREE.Vector3();
const _aimV = new THREE.Vector3();
function solveIK(root, target, l1, l2, pole, out) {
  const dir = _ik1.subVectors(target, root);
  let dist = dir.length();
  dist = Math.min(dist, (l1 + l2) * 0.999);
  dist = Math.max(dist, Math.abs(l1 - l2) + 1e-3);
  dir.normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = _ik2.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  return out.copy(root).addScaledVector(dir, cosA * l1).addScaledVector(perp, sinA * l1);
}

function aim(mesh, from, to) {
  mesh.position.copy(from);
  _aimV.subVectors(to, from).normalize();
  mesh.quaternion.setFromUnitVectors(DOWN, _aimV);
}

export class CyclistModel {
  /**
   * @param look {frame, jersey, accent, outfit, bikeId, skin}
   */
  constructor(look = {}) {
    const S = sharedAssets();
    this.look = look;
    const bikeId = look.bikeId || 'allround';
    this.root = new THREE.Group(); // positioned at ground contact, yaw + pitch
    this.lean = new THREE.Group(); // roll about the contact line
    this.root.add(this.lean);
    this.body = new THREE.Group(); // suspension bob
    this.lean.add(this.body);

    const frameMat = new THREE.MeshPhysicalMaterial({ color: look.frame || '#e63946', roughness: 0.38, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
    const accentMat = new THREE.MeshStandardMaterial({ color: look.accent || '#ffffff', roughness: 0.35, metalness: 0.2 });
    this.mats = [frameMat, accentMat];

    // ---------- frame ----------
    const thick = bikeId === 'aero' ? 1.5 : bikeId === 'climber' ? 0.8 : bikeId === 'sprint' ? 1.25 : 1;
    const r = 0.022 * thick;
    const parts = [
      tubeGeo(P.seat, P.htTop, r * 0.9, r * 0.9), // top tube
      tubeGeo(P.bb, P.htBot, r * 1.25, r * 1.1), // down tube
      tubeGeo(P.bb, P.seat, r * 1.05), // seat tube
      tubeGeo(P.htBot, P.htTop, r * 1.3), // head tube
    ];
    for (const sx of [-0.055, 0.055]) {
      parts.push(tubeGeo(P.bb, V(sx, P.rear.y, P.rear.z), r * 0.65, r * 0.5)); // chainstay
      parts.push(tubeGeo(V(0, P.seat.y - 0.03, P.seat.z - 0.01), V(sx, P.rear.y, P.rear.z), r * 0.55, r * 0.45)); // seatstay
    }
    const frame = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), frameMat);
    this.body.add(frame);
    // decal band on the down tube
    const band = new THREE.Mesh(tubeGeo(V(0, 0.4, 0.05), V(0, 0.55, 0.23), r * 1.32), accentMat);
    this.body.add(band);
    // seatpost + saddle
    const post = new THREE.Mesh(tubeGeo(P.seat, V(0, 0.93, -0.27), 0.014), S.carbon);
    const saddleGeo = new THREE.CapsuleGeometry(0.03, 0.2, 4, 10).rotateX(Math.PI / 2).scale(1.2, 0.55, 1);
    const saddle = new THREE.Mesh(saddleGeo, S.tape);
    saddle.position.set(0, 0.95, -0.25);
    const saddleNose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 6).scale(1, 0.28, 0.75), S.tape);
    saddleNose.position.set(0, 0.952, -0.33);
    this.body.add(post, saddle, saddleNose);

    // ---------- steering (fork, bars, front wheel) ----------
    this.steerPivot = new THREE.Group();
    this.steerPivot.position.copy(P.htBot);
    const axis = new THREE.Vector3().subVectors(P.htTop, P.htBot).normalize();
    this.steerAxis = axis;
    this.body.add(this.steerPivot);
    const toPivot = (v) => v.clone().sub(P.htBot);
    const fork = [];
    for (const sx of [-0.05, 0.05]) fork.push(tubeGeo(toPivot(V(sx * 0.6, 0.7, 0.41)), toPivot(V(sx, P.front.y, P.front.z)), r * 0.75, r * 0.5));
    fork.push(tubeGeo(toPivot(P.htTop), toPivot(V(0, 0.9, 0.47)), 0.016)); // stem
    this.steerPivot.add(new THREE.Mesh(mergeGeometries(fork.map((g) => g.toNonIndexed())), frameMat));
    // drop handlebar
    const barL = [V(0.2, 0.74, 0.43), V(0.21, 0.76, 0.53), V(0.2, 0.85, 0.555), V(0.2, 0.9, 0.5), V(0.2, 0.9, 0.47), V(0.08, 0.9, 0.47), V(0, 0.9, 0.47)];
    const barR = barL.map((p) => V(-p.x, p.y, p.z));
    const barGeo = mergeGeometries([
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(barL), 20, 0.013, 6).toNonIndexed(),
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(barR), 20, 0.013, 6).toNonIndexed(),
    ]);
    barGeo.translate(-P.htBot.x, -P.htBot.y, -P.htBot.z);
    this.steerPivot.add(new THREE.Mesh(barGeo, S.black));
    // brake hoods
    for (const sx of [-0.2, 0.2]) {
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.07), S.black);
      hood.position.copy(toPivot(V(sx, 0.905, 0.525)));
      hood.rotation.x = -0.5;
      this.steerPivot.add(hood);
    }
    this.hands = [toPivot(V(0.2, 0.91, 0.515)), toPivot(V(-0.2, 0.91, 0.515))];
    this.drops = [toPivot(V(0.205, 0.765, 0.52)), toPivot(V(-0.205, 0.765, 0.52))];
    const hoseF = new THREE.CatmullRomCurve3([V(0.19, 0.89, 0.5), V(0.14, 0.86, 0.46), V(0.05, 0.8, 0.42), V(0.06, 0.55, 0.45), V(0.065, P.front.y + 0.08, P.front.z - 0.045)].map(toPivot));
    this.hoseF = new THREE.Mesh(new THREE.TubeGeometry(hoseF, 24, 0.0045, 5), S.cable);
    this.steerPivot.add(this.hoseF);
    const hoseR = new THREE.CatmullRomCurve3([V(-0.08, 0.87, 0.44), V(-0.02, 0.8, 0.38), V(0.03, 0.82, 0.2), V(0.03, 0.79, -0.18), V(0.06, 0.6, -0.36), V(0.065, P.rear.y + 0.08, P.rear.z + 0.045)]);
    this.hoseR = new THREE.Mesh(new THREE.TubeGeometry(hoseR, 30, 0.0045, 5), S.cable);
    this.body.add(this.hoseR);
    // wheels
    const deep = bikeId === 'aero' ? 0.06 : bikeId === 'sprint' ? 0.04 : 0.022;
    this.frontWheel = this._wheel(deep, accentMat);
    this.frontWheel.position.copy(toPivot(P.front));
    this.steerPivot.add(this.frontWheel);
    const caliperGeo = new THREE.BoxGeometry(0.03, 0.045, 0.06);
    const calF = new THREE.Mesh(caliperGeo, S.black);
    calF.position.copy(toPivot(V(0.065, P.front.y + 0.055, P.front.z - 0.045)));
    this.steerPivot.add(calF);
    const calR = new THREE.Mesh(caliperGeo, S.black);
    calR.position.set(0.065, P.rear.y + 0.055, P.rear.z + 0.045);
    this.body.add(calR);
    this.rearWheel = this._wheel(deep, accentMat);
    this.rearWheel.position.copy(P.rear);
    this.body.add(this.rearWheel);

    // ---------- drivetrain ----------
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 28), S.metal);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-0.07, P.bb.y, P.bb.z);
    this.body.add(ring);
    const sprockets = [];
    for (let i = 0; i < 8; i++) sprockets.push(new THREE.CylinderGeometry(0.03 + i * 0.0037, 0.03 + i * 0.0037, 0.0025, 18).rotateZ(Math.PI / 2).translate(-0.052 - i * 0.004, 0, 0).toNonIndexed());
    const cog = new THREE.Mesh(mergeGeometries(sprockets), S.steel);
    this.rearWheel.userData.spin.add(cog);
    const derailParts = [
      new THREE.BoxGeometry(0.012, 0.09, 0.028).translate(0, -0.06, 0.01).toNonIndexed(),
      new THREE.CylinderGeometry(0.016, 0.016, 0.01, 12).rotateZ(Math.PI / 2).translate(0, -0.025, 0.01).toNonIndexed(),
      new THREE.CylinderGeometry(0.016, 0.016, 0.01, 12).rotateZ(Math.PI / 2).translate(0, -0.1, 0.01).toNonIndexed(),
      new THREE.BoxGeometry(0.02, 0.03, 0.04).translate(0.005, 0.0, -0.02).toNonIndexed(),
    ];
    const derail = new THREE.Mesh(mergeGeometries(derailParts), S.black);
    derail.position.set(-0.075, P.rear.y - 0.02, P.rear.z + 0.02);
    this.body.add(derail);
    const dtDir = new THREE.Vector3().subVectors(P.htBot, P.bb).normalize();
    const dtNorm = new THREE.Vector3(0, dtDir.z, -dtDir.y); // perpendicular, above the tube
    const bottleBase = P.bb.clone().addScaledVector(dtDir, 0.2).addScaledVector(dtNorm, 0.05);
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.19, 12).translate(0, 0.095, 0), accentMat);
    bottle.position.copy(bottleBase);
    bottle.quaternion.setFromUnitVectors(UP, dtDir);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.035, 10).translate(0, 0.205, 0), S.black);
    bottle.add(cap);
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.004, 4, 12, Math.PI * 1.2).rotateX(Math.PI / 2).translate(0, 0.07, 0), S.black);
    bottle.add(cage);
    this.body.add(bottle);
    this.bottle = bottle;
    const chain = mergeGeometries([
      tubeGeo(V(-0.07, P.bb.y + 0.1, P.bb.z), V(-0.07, P.rear.y + 0.045, P.rear.z), 0.005).toNonIndexed(),
      tubeGeo(V(-0.07, P.bb.y - 0.1, P.bb.z), V(-0.072, P.rear.y - 0.12, P.rear.z + 0.03), 0.005).toNonIndexed(),
    ]);
    const chainMesh = new THREE.Mesh(chain, S.metal);
    chainMesh.castShadow = false;
    this.chainMesh = chainMesh;
    this.body.add(chainMesh);
    this.crankGroup = new THREE.Group();
    this.crankGroup.position.copy(P.bb);
    this.body.add(this.crankGroup);
    const armGeo = new THREE.BoxGeometry(0.018, 0.17, 0.03).translate(0, 0.085, 0);
    const spider = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 5).rotateZ(Math.PI / 2), S.carbon);
    spider.position.x = -0.075;
    this.crankGroup.add(spider);
    this.cranks = [];
    this.pedals = [];
    for (const sx of [1, -1]) {
      const arm = new THREE.Mesh(armGeo, S.black);
      arm.position.x = sx * 0.085;
      this.crankGroup.add(arm);
      this.cranks.push(arm);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.07), S.black);
      this.body.add(pedal);
      this.pedals.push(pedal);
    }

    // ---------- rider ----------
    const skin = new THREE.MeshStandardMaterial({ color: look.skin || '#e0ac8a', roughness: 0.65 });
    const outfit = OUTFITS.find((o) => o.id === look.outfit) || OUTFITS[0];
    const jerseyTex = makeJersey(outfit.jersey, look.jersey || '#3a86ff', look.accent || '#ffffff');
    const jersey = new THREE.MeshStandardMaterial({ map: jerseyTex, roughness: 0.55 });
    const helmet = new THREE.MeshPhysicalMaterial({ map: makeHelmet(look.accent || '#ffffff'), roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    const shoe = new THREE.MeshStandardMaterial({ color: look.accent || '#ffffff', roughness: 0.4 });
    const sleeve = new THREE.MeshStandardMaterial({ color: look.jersey || '#3a86ff', roughness: 0.55 });
    this.mats.push(skin, jersey, helmet, shoe, sleeve);
    this.rider = new THREE.Group();
    this.body.add(this.rider);

    const torsoGeo = new THREE.CapsuleGeometry(0.135, 0.36, 6, 14);
    torsoGeo.scale(1.3, 1, 0.9);
    this.torso = new THREE.Mesh(torsoGeo, jersey);
    this.rider.add(this.torso);
    this.hips = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8).scale(1.15, 0.8, 1.1), S.shorts);
    this.rider.add(this.hips);
    // head + helmet
    this.head = new THREE.Group();
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 10).scale(0.9, 1, 1.05), skin);
    this.head.add(headMesh);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.118, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), helmet);
    helm.scale.set(1, 0.95, 1.3);
    helm.position.set(0, 0.012, -0.012);
    this.head.add(helm);
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, 0.03), S.lens);
    glasses.position.set(0, 0.0, 0.085);
    this.head.add(glasses);
    this.rider.add(this.head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 8), skin);
    this.neck = neck;
    this.rider.add(neck);

    // limbs: thigh (shorts), shin (skin), foot (shoe); upper arm (sleeve), forearm (skin)
    this.legs = [];
    for (const sx of [1, -1]) {
      const thigh = new THREE.Mesh(limbGeo(0.43, 0.075, 0.058), S.shorts);
      const shin = new THREE.Mesh(limbGeo(0.43, 0.052, 0.036), skin);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.038, 0.1, 8).translate(0, -0.37, 0), S.sock);
      shin.add(sock);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.24).translate(0, -0.02, 0.06), shoe);
      this.rider.add(thigh, shin, foot);
      this.legs.push({ sx, thigh, shin, foot });
    }
    this.arms = [];
    for (const sx of [1, -1]) {
      const upper = new THREE.Mesh(limbGeo(0.29, 0.05, 0.042), sleeve);
      const fore = new THREE.Mesh(limbGeo(0.28, 0.038, 0.03), skin);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), S.black);
      this.rider.add(upper, fore, glove);
      this.arms.push({ sx, upper, fore, glove });
    }

    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });
    // small parts: no shadows, hidden when far away (LOD)
    this.details = [saddleNose, post, band, ring, cog, glasses, chainMesh, derail, calR, calF, bottle, this.hoseR, this.hoseF, spider, ...this.cranks, ...this.pedals];
    for (const l of this.legs) this.details.push(l.foot);
    for (const a of this.arms) this.details.push(a.glove);
    this.steerPivot.children.forEach((c) => c.geometry?.type === 'BoxGeometry' && this.details.push(c));
    for (const w of [this.frontWheel, this.rearWheel]) {
      w.userData.spin.children.forEach((c) => {
        if (c.geometry?.type !== 'TorusGeometry') c.castShadow = false;
        if (c.geometry?.type === 'CylinderGeometry') this.details.push(c);
      });
    }
    for (const d of this.details) d.castShadow = false;
    this.detailOn = true;
    this._rock = 0;
    this._hipOff = new THREE.Vector3();
    this._tuck = 0;
    this._drops = 0;
    this._brakeS = 0;
    this._celebrate = 0;
    this._crankVis = 0;
    this._lastCrank = 0;
    this._pose = { tmp: new THREE.Vector3(), target: new THREE.Vector3(), hip: new THREE.Vector3(), shoulder: new THREE.Vector3(), dir: new THREE.Vector3(), joint: new THREE.Vector3(), mid: new THREE.Vector3(), end: new THREE.Vector3(), pole: new THREE.Vector3() };
  }

  _wheel(deep, accentMat) {
    const S = sharedAssets();
    const g = new THREE.Group();
    const spin = new THREE.Group();
    g.add(spin);
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.017, 8, 40), S.tire);
    tire.rotation.y = Math.PI / 2;
    spin.add(tire);
    const rimInner = 0.31 - deep;
    const rim = new THREE.Mesh(new THREE.RingGeometry(rimInner, 0.312, 40, 1), deep > 0.03 ? S.carbon : S.steel);
    rim.rotation.y = Math.PI / 2;
    rim.material.side = THREE.DoubleSide;
    spin.add(rim);
    if (deep > 0.03) {
      const stripe = new THREE.Mesh(new THREE.RingGeometry(rimInner + deep * 0.35, rimInner + deep * 0.55, 40, 1), accentMat);
      stripe.rotation.y = Math.PI / 2;
      stripe.position.x = 0.001;
      spin.add(stripe);
      const stripe2 = stripe.clone();
      stripe2.position.x = -0.001;
      spin.add(stripe2);
    }
    const spokeMat = new THREE.MeshBasicMaterial({ map: S.spokes, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const spokes = new THREE.Mesh(new THREE.CircleGeometry(rimInner + 0.004, 32), spokeMat);
    spokes.rotation.y = Math.PI / 2;
    spokes.renderOrder = 2;
    spin.add(spokes);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10).rotateZ(Math.PI / 2), S.metal);
    spin.add(hub);
    const rotor = new THREE.Mesh(new THREE.CircleGeometry(0.08, 28), S.rotor);
    rotor.rotation.y = Math.PI / 2;
    rotor.position.x = 0.058;
    spin.add(rotor);
    g.userData = { spin, spokeMat };
    return g;
  }

  /** Distance LOD: hide fine details for far riders. */
  setDetail(on) {
    if (on === this.detailOn) return;
    this.detailOn = on;
    for (const d of this.details) d.visible = on;
  }

  /** Free this rider's own materials + jersey/helmet textures (shared bike assets stay cached). */
  dispose() {
    const shared = new Set(Object.values(sharedAssets()));
    const own = this.mats.map((m) => m.map).filter(Boolean);
    this.root.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!shared.has(m)) m.dispose();
    });
    for (const m of this.mats) m.dispose(); // setGhost may have swapped them out of the tree
    for (const t of own) t.dispose();
  }

  setGhost(on) {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      o.material = mats.map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = on ? 0.35 : 1;
        c.depthWrite = !on;
        return c;
      })[0];
      o.castShadow = !on;
    });
  }

  /**
   * Apply animation pose.
   * p: {crank, wheel, steer, lean, pitch, v, sprinting, braking, airborne, landing, bump, throttle}
   */
  pose(p, dt, time) {
    // wheels
    const spinA = p.wheel;
    this.frontWheel.userData.spin.rotation.x = spinA;
    this.rearWheel.userData.spin.rotation.x = spinA;
    const blur = p.v > 9;
    for (const w of [this.frontWheel, this.rearWheel]) {
      const m = w.userData.spokeMat;
      const want = blur ? sharedAssets().spokesBlur : sharedAssets().spokes;
      if (m.map !== want) {
        m.map = want;
        m.needsUpdate = true;
      }
    }
    // steering (visual angle shrinks with speed)
    const steerAngle = -p.steer * (0.42 / (1 + p.v * 0.18));
    this.steerPivot.quaternion.setFromAxisAngle(this.steerAxis, steerAngle);

    const ss = (e0, e1, x) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const k = (rate) => Math.min(1, dt * rate);
    // ---- smoothed pose drivers ----
    const pedalling = p.throttle > 0.05 && !p.airborne;
    const tuckT = p.sprinting || p.braking || p.celebrate ? 0 : Math.max(ss(19, 27, p.v) * (pedalling ? 0.55 : 1), !pedalling && p.v > 13 ? ss(13, 19, p.v) : 0);
    this._tuck += (tuckT - this._tuck) * k(3);
    this._drops += (Math.max(this._tuck, p.sprinting ? 1 : 0) - this._drops) * k(5);
    this._brakeS += ((p.brakeT ?? (p.braking ? 1 : 0)) - this._brakeS) * k(8);
    this._celebrate += ((p.celebrate ? 1 : 0) - this._celebrate) * k(4);
    const tuck = this._tuck;
    const drops = this._drops;
    const brk = this._brakeS;
    const cel = this._celebrate;

    // bike rocks under a rider standing on the pedals
    const standing = (p.sprinting || p.airborne) && cel < 0.5;
    const rockT = standing && !p.airborne ? Math.sin(this._crankVis) * 0.13 : 0;
    this._rock += (rockT - this._rock) * k(12);
    this.lean.rotation.z = p.lean + this._rock;

    // suspension / bumps; hard braking pitches the bike onto the front wheel
    this.body.position.y = Math.sin(time * 38) * p.bump * 0.025 - p.landing * 0.05;
    this.body.rotation.x = Math.sin(time * 29) * p.bump * 0.02 + brk * Math.min(1, p.v / 15) * 0.035;

    // crank: follows the pedalling; when coasting the pedals settle level (freewheel)
    const dc = p.crank - this._lastCrank;
    this._lastCrank = p.crank;
    if (pedalling && Math.abs(dc) < 2) this._crankVis += dc;
    else {
      const level = Math.round((this._crankVis - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      this._crankVis += (level - this._crankVis) * k(4);
    }
    const crank = this._crankVis;
    this.crankGroup.rotation.x = crank;
    for (let i = 0; i < 2; i++) {
      const phi = Math.PI / 2 - crank - (i === 0 ? 0 : Math.PI);
      this.pedals[i].position.set((i === 0 ? 1 : -1) * 0.13, P.bb.y + Math.sin(phi) * 0.17, P.bb.z + Math.cos(phi) * 0.17);
      this.cranks[i].rotation.x = i === 0 ? 0 : Math.PI;
    }

    // ---------- rider pose ----------
    const R = this._pose;
    R.target.set(0, standing ? 0.13 : 0, standing ? 0.11 : 0);
    R.target.z -= tuck * 0.04 + brk * 0.06;
    R.target.y -= tuck * 0.02;
    this._hipOff.lerp(R.target, k(8));
    const hip = R.hip.set(0, 0.975, -0.24).add(this._hipOff);
    hip.y -= p.landing * 0.07;
    const sway = -this._rock * 0.9;
    const shoulder = R.shoulder.set(
      sway * 0.3,
      hip.y + 0.35 - tuck * 0.15 - drops * 0.06 + brk * 0.02 + (standing ? 0.02 : 0) + cel * 0.22,
      hip.z + 0.4 + tuck * 0.05 + brk * 0.03 - cel * 0.2,
    );
    this.torso.position.addVectors(hip, shoulder).multiplyScalar(0.5);
    this.torso.quaternion.setFromUnitVectors(UP, R.dir.subVectors(shoulder, hip).normalize());
    this.torso.rotateY(Math.sin(crank) * 0.06 * (standing ? 2 : 1) * (1 - cel));
    // jersey flutters in the wind
    const wind = ss(8, 32, p.v);
    this.torso.scale.set(1 + Math.sin(time * 41) * 0.012 * wind, 1, 1 + Math.sin(time * 33 + 1) * 0.015 * wind);
    this.hips.position.copy(hip);
    this.head.position.set(shoulder.x, shoulder.y + 0.15 - tuck * 0.03 + Math.sin(crank * 2) * 0.006, shoulder.z + 0.1 + tuck * 0.03);
    this.head.rotation.x = -0.25 - tuck * 0.3 + cel * 0.35;
    this.head.rotation.z = p.lean * -0.35;
    this.neck.position.set(shoulder.x, shoulder.y + 0.07, shoulder.z + 0.05);
    this.neck.rotation.x = 0.6 + tuck * 0.3;

    // legs: hip joint -> ankle just above the pedal
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i];
      R.joint.copy(hip);
      R.joint.x += L.sx * 0.095;
      const pedal = this.pedals[i].position;
      R.end.set(L.sx * 0.12, pedal.y + 0.065, pedal.z - 0.05);
      solveIK(R.joint, R.end, 0.43, 0.43, R.pole.set(L.sx * 0.12, 0.35, 1).normalize(), R.mid);
      aim(L.thigh, R.joint, R.mid);
      aim(L.shin, R.mid, R.end);
      L.foot.position.copy(R.end);
      L.foot.rotation.set(Math.sin(Math.PI / 2 - crank - (i ? Math.PI : 0)) * 0.25 + 0.1, 0, 0);
    }
    // arms: hands on the hoods, the drops (sprint / tuck) or raised in celebration
    this.steerPivot.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i];
      R.joint.copy(shoulder);
      R.joint.x += A.sx * 0.19;
      R.end.copy(this.hands[i]).lerp(this.drops[i], drops).applyMatrix4(this.steerPivot.matrix);
      if (cel > 0.01) R.end.lerp(R.tmp.set(shoulder.x + A.sx * 0.3, shoulder.y + 0.5, shoulder.z + 0.08), cel);
      solveIK(R.joint, R.end, 0.29, 0.28, R.pole.set(A.sx * 0.8, -0.3 + cel * 0.2, -0.5).normalize(), R.mid);
      aim(A.upper, R.joint, R.mid);
      aim(A.fore, R.mid, R.end);
      A.upper.scale.set(1 + Math.sin(time * 47 + i) * 0.03 * wind, 1, 1);
      A.glove.position.copy(R.end);
    }
  }
}
