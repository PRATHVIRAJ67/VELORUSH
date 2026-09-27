// Smooth third-person racing camera + cinematic modes (menu flyover, start orbit, finish orbit).
import * as THREE from 'three';
import { damp, lerpAngle, clamp, makeNoise2D, smoothstep } from '@shared/math.js';

const DIST = [
  { d: 3.7, h: 1.55 },
  { d: 5.0, h: 1.95 },
  { d: 7.0, h: 2.6 },
];

export class ChaseCamera {
  constructor(camera, world, track) {
    this.camera = camera;
    this.world = world;
    this.track = track;
    this.mode = 'flyover';
    this.yaw = 0;
    this.pos = new THREE.Vector3(0, 30, 0);
    this.look = new THREE.Vector3();
    this.lookS = new THREE.Vector3();
    this.fov = 62;
    this.distIndex = 1;
    this.shake = true;
    this.noise = makeNoise2D(3);
    this.t = 0;
    this.modeT = 0;
    this.flyS = 60;
    this._w = {};
    this._fwd = new THREE.Vector3();
    this.lastV = 0;
    this.kick = 0; // one-shot camera impulse (race start)
    this.accS = 0;
  }

  setMode(mode) {
    if (mode !== this.mode) this.modeT = 0;
    this.mode = mode;
  }

  cycleDistance() {
    this.distIndex = (this.distIndex + 1) % DIST.length;
    return this.distIndex;
  }

  snapBehind(target) {
    this.yaw = target.yaw;
    const cfg = DIST[this.distIndex];
    this._fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.pos.copy(target.position).addScaledVector(this._fwd, -cfg.d).add(new THREE.Vector3(0, cfg.h, 0));
    this.lookS.copy(target.position).add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(this._fwd, 3);
  }

  _blocked(ax, ay, az, bx, by, bz) {
    const T = this.world.terrain;
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const y = ay + (by - ay) * t;
      if (T.heightAt(x, z) + 0.35 > y) return true;
    }
    return false;
  }

  /** Keep the camera out of the terrain; pull in toward the rider if the view is blocked. */
  _clampToWorld(p, target) {
    const T = this.world.terrain;
    if (target) {
      const tp = target.position;
      const ex = tp.x;
      const ey = tp.y + 1.3;
      const ez = tp.z;
      if (this._blocked(ex, ey, ez, p.x, p.y, p.z)) {
        let found = false;
        for (const f of [0.8, 0.62, 0.46, 0.32]) {
          const x = ex + (p.x - ex) * f;
          const z = ez + (p.z - ez) * f;
          const y = ey + (p.y - ey) * f + (1 - f) * 0.8;
          if (!this._blocked(ex, ey, ez, x, y, z)) {
            p.set(x, y, z);
            found = true;
            break;
          }
        }
        if (!found) {
          // last resort: rise a little above the rider
          p.set(ex + (p.x - ex) * 0.35, ey + 1.6, ez + (p.z - ez) * 0.35);
        }
      }
      if (target.inTunnel) p.y = Math.min(p.y, tp.y + 5.5);
    }
    const g = T.heightAt(p.x, p.z) + 0.6;
    if (p.y < g) p.y = g;
  }

  update(dt, target) {
    this.t += dt;
    this.modeT += dt;
    const cam = this.camera;
    let fovT = 62;
    if (this.mode === 'flyover') {
      this.flyS += dt * 16;
      const s = this.flyS;
      const side = Math.sin(this.t * 0.07) * 14;
      const w = this.track.toWorld(s, side, this._w);
      const desired = new THREE.Vector3(w.x, w.y + 7 + Math.sin(this.t * 0.2) * 3, w.z);
      const la = this.track.toWorld(s + 38, 0, this._w);
      const look = new THREE.Vector3(la.x, la.y + 1.5, la.z);
      this._clampToWorld(desired);
      if (this.modeT < 0.05) {
        this.pos.copy(desired);
        this.lookS.copy(look);
      }
      this.pos.lerp(desired, damp(2, dt));
      this.lookS.lerp(look, damp(2, dt));
      fovT = 55;
    } else if (this.mode === 'orbit' && target) {
      // countdown intro: sweep from the front around to the chase position
      const T = clamp(this.modeT / 3.6, 0, 1);
      const e = 1 - Math.pow(1 - T, 3);
      const ang = target.yaw + Math.PI * 0.85 * (1 - e) + 0.001;
      const cfg = DIST[this.distIndex];
      const r = 6.5 + (cfg.d - 6.5) * e;
      const h = 1.4 + (cfg.h - 1.4) * e;
      const desired = new THREE.Vector3(
        target.position.x - Math.sin(ang) * r,
        target.position.y + h,
        target.position.z - Math.cos(ang) * r,
      );
      this._clampToWorld(desired, target);
      this.pos.copy(desired);
      this.lookS.copy(target.position).add(new THREE.Vector3(0, 1.05, 0));
      this.yaw = target.yaw;
    } else if (this.mode === 'finish' && target) {
      const ang = target.yaw + Math.PI + this.modeT * 0.35;
      const desired = new THREE.Vector3(
        target.position.x - Math.sin(ang) * 6.5,
        target.position.y + 2.2,
        target.position.z - Math.cos(ang) * 6.5,
      );
      this._clampToWorld(desired, target);
      this.pos.lerp(desired, damp(3, dt));
      this.lookS.lerp(target.position.clone().add(new THREE.Vector3(0, 1.1, 0)), damp(6, dt));
      fovT = 55;
    } else if (target) {
      // ---- chase ----
      const v = target.v;
      const effort = target.effort || 0;
      // longitudinal acceleration makes the camera lag behind / catch up (sense of weight)
      const acc = (v - this.lastV) / Math.max(dt, 1e-3);
      this.lastV = v;
      this.accS += (Math.max(-9, Math.min(6, acc)) - this.accS) * damp(4, dt);
      this.yaw = lerpAngle(this.yaw, target.yaw, damp(3.2 + v * 0.08, dt));
      const cfg = DIST[this.distIndex];
      const f = this._fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const fast = smoothstep(18, 34, v); // descent / cinematic band
      let dist = cfg.d + smoothstep(8, 25, v) * 0.7 - fast * 0.45 - effort * 0.35 + this.accS * 0.07;
      dist = Math.max(cfg.d * 0.7, dist);
      const desired = new THREE.Vector3().copy(target.position).addScaledVector(f, -dist);
      desired.y += cfg.h - smoothstep(10, 25, v) * 0.18 - fast * 0.25 - effort * 0.12 + (target.airborne ? 0.4 : 0);
      this._clampToWorld(desired, target);
      this.pos.lerp(desired, damp(14, dt));
      const look = new THREE.Vector3().copy(target.position).addScaledVector(f, 3.2 + fast * 2.5);
      look.y += 1.1 - (target.brake || 0) * 0.25 - fast * 0.15;
      this.lookS.lerp(look, damp(18, dt));
      // speed-banded FOV: normal < 40 km/h, widening through 60/80/100, cinematic above 100
      fovT =
        60 +
        smoothstep(7, 16.7, v) * 6 + // 25 -> 60 km/h
        smoothstep(16.7, 22.2, v) * 5 + // 60 -> 80
        smoothstep(22.2, 27.8, v) * 6 + // 80 -> 100
        smoothstep(27.8, 37, v) * 8 + // 100 -> 133 cinematic
        effort * 4 +
        (target.boost ? 4 : 0);
      fovT = Math.min(fovT, 95);
    }
    this.fov += (fovT - this.fov) * damp(3, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    cam.position.copy(this.pos);
    // high-speed + bump shake
    if (target && this.mode === 'chase' && this.shake) {
      // low-frequency sway + high-frequency road vibration, both rising with speed
      const v = target.v;
      this.kick = Math.max(0, this.kick - dt * 0.8);
      const amp = smoothstep(14, 36, v) * 0.028 + (target.bump || 0) * 0.045 + (target.effort || 0) * 0.008 + this.kick * 0.12;
      const vib = smoothstep(8, 36, v) * 0.006 * (1 + (target.rough || 0) * 4);
      const n = this.noise;
      cam.position.x += n(this.t * 9, 1) * amp;
      cam.position.y += n(this.t * 11, 7) * amp + n(this.t * 70, 3) * vib;
      cam.position.z += n(this.t * 8, 13) * amp;
    }
    cam.lookAt(this.lookS);
    // subtle roll into corners
    if (target && this.mode === 'chase') cam.rotateZ(-(target.lean || 0) * (0.1 + smoothstep(15, 34, target.v) * 0.06));
  }
}
