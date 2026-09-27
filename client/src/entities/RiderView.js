// Binds a physics/network state to a CyclistModel in the world.
import * as THREE from 'three';
import { CyclistModel } from './CyclistModel.js';
import { makeNameTag, canvas, toTexture } from '../world/textures.js';

let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = canvas(64, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 64, 4, 32, 64, 60);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.save();
  ctx.scale(1, 1);
  ctx.fillRect(0, 0, 64, 128);
  ctx.restore();
  blobTex = toTexture(c, { wrap: false, srgb: false });
  return blobTex;
}
import { wrapAngle } from '@shared/math.js';

const _w = {};
const _c = {};

export class RiderView {
  constructor(scene, track, { name = 'Rider', look = {}, isLocal = false, ghost = false, night = false } = {}) {
    this.scene = scene;
    this.track = track;
    this.isLocal = isLocal;
    this.ghost = ghost;
    this.model = new CyclistModel(look);
    if (ghost) this.model.setGhost(true);
    scene.add(this.model.root);
    this.position = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.pitch = 0;
    this.tagTex = makeNameTag(name, look.jersey || '#ff5a1f');
    const mat = new THREE.SpriteMaterial({ map: this.tagTex, depthTest: true, depthWrite: false, transparent: true, fog: false });
    this.tag = new THREE.Sprite(mat);
    this.tag.scale.set(2.2, 0.55, 1);
    this.tag.position.y = 2.25;
    this.tag.visible = !isLocal && !ghost;
    this.tag.renderOrder = 10;
    this.model.root.add(this.tag);
    this.visible = true;
    if (night) {
      const front = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: '#fffbe8' }));
      front.position.set(0, 0.86, 0.5);
      const rear = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2020' }));
      rear.position.set(0, 0.84, -0.33);
      this.model.body.add(front, rear);
      if (isLocal) {
        // real headlight for the player: lights the road ahead
        const lamp = new THREE.SpotLight('#fff4de', 60, 55, 0.5, 0.55, 1.6);
        lamp.position.set(0, 0.9, 0.5);
        lamp.target.position.set(0, -2, 12);
        this.model.root.add(lamp, lamp.target);
      }
    }
    // soft contact shadow keeps the bike grounded (also on LOW with shadow maps off)
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 2.0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: ghost ? 0 : 0.55, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    this.blob.renderOrder = 1;
    scene.add(this.blob);
  }

  setName(name, color) {
    this.tagTex.dispose();
    this.tagTex = makeNameTag(name, color);
    this.tag.material.map = this.tagTex;
    this.tag.material.needsUpdate = true;
  }

  update(st, dt, time, camPos) {
    const w = this.track.toWorld(st.s, st.d, _w);
    this.position.set(w.x, st.y, w.z);
    const root = this.model.root;
    root.position.copy(this.position);
    const c = this.track.sample(st.s, _c);
    const rel = wrapAngle(st.yaw - c.head);
    let pitchT = -Math.atan(c.slope * Math.cos(rel));
    if (st.airborne && st.v > 1) pitchT = -Math.atan2(st.vy || 0, st.v) * 0.6;
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 10);
    root.rotation.set(this.pitch, st.yaw, 0, 'YXZ');
    const groundY = c.y + this.track.rampHeight(st.s, st.d);
    const h = Math.max(0, st.y - groundY);
    this.blob.position.set(w.x, groundY + 0.06, w.z);
    this.blob.rotation.set(0, st.yaw, 0);
    this.blob.scale.setScalar(1 + h * 0.25);
    this.blob.material.opacity = (this.ghost ? 0 : 0.55) * Math.max(0, 1 - h * 0.35);
    this.forward.set(Math.sin(st.yaw), 0, Math.cos(st.yaw));
    this.model.pose(
      {
        crank: st.crank,
        wheel: st.wheel,
        steer: st.steer,
        lean: st.lean,
        v: st.v,
        // riders stand on the pedals to launch from low speed
        sprinting: st.sprinting || (st.throttle > 0.5 && st.v > 0.3 && st.v < 7.5 && !st.airborne),
        braking: st.brake > 0.1,
        brakeT: st.brakeT ?? st.brake ?? 0,
        celebrate: !!st.celebrate,
        airborne: st.airborne,
        landing: st.landing || 0,
        bump: st.bump || 0,
        throttle: st.throttle,
      },
      dt,
      time,
    );
    if (camPos) this.model.setDetail(this.isLocal || camPos.distanceToSquared(this.position) < 45 * 45);
    if (camPos && !this.isLocal) {
      const d = camPos.distanceTo(this.position);
      this.tag.visible = d < 140 && this.visible;
      const k = Math.max(1, d / 30);
      this.tag.scale.set(2.2 * k, 0.55 * k, 1);
    }
  }

  setVisible(v) {
    this.visible = v;
    this.model.root.visible = v;
    this.blob.visible = v;
  }

  dispose() {
    this.scene.remove(this.model.root);
    this.scene.remove(this.blob);
    this.blob.geometry.dispose();
    this.blob.material.dispose();
    this.model.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    this.model.dispose();
    this.tagTex.dispose();
  }
}
