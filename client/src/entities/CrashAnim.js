// Stunt mode only: a short scripted crash for one rider view (no ragdoll). From the impact (speed,
// leftover flip/spin angle, what was hit) the bike slaps down onto its wheels, slides on with its
// momentum and tips over onto the bars and a pedal, while the rider comes off, tumbles and settles
// on the deck. Everything stays on the plank surface: slides stop at gaps, ramp faces and barrels.
// Visual only: the run state (scoring, respawn, multiplayer) never reads it, so every client can
// play it locally for any rider.
import * as THREE from 'three';
import { wrapAngle } from '@shared/math.js';

const TAU = Math.PI * 2;
const residual = (a) => a - Math.round(a / TAU) * TAU;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const G = 15; // slightly above real gravity: the fall reads quickly at game camera distance
const COM = 0.8; // trick rotation centre above the contact point (RiderView)
const HIP = new THREE.Vector3(0, 0.975, -0.24); // rider hip in the bike frame (CyclistModel)
/** Steer input the bars flop to as the bike goes down (small: a turned wheel would prop it up). */
export const CRASH_STEER = 0.35;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _c = {};
const _w = {};

export class CrashAnim {
  /**
   * @param course stunt course (track, pitAt, obstacleAt)
   * @param st rider state at impact {s, d, y, yaw, lean}
   * @param o {v (speed before the crash), pitch, spin (trick angles), reason, pit}
   */
  constructor(course, st, o) {
    this.course = course;
    this.track = course.track;
    this.t = 0;
    this.fx = []; // dust puffs for the session to emit: {x, y, z, n, k}
    const rp = clamp(residual(o.pitch || 0), -1.2, 1.2); // > 0 nose up (backflip side)
    const rs = clamp(residual(o.spin || 0), -1.4, 1.4);
    const v = clamp(o.v || 0, 0, 32);
    this.rp = rp;
    this.rs = rs;
    this.v = v;
    this.sev = clamp((v - 4) / 18, 0, 1);
    const reason = o.reason || '';
    let kind;
    if (o.pit) kind = 'fall';
    else if (/barrel|face|cased/i.test(reason)) kind = 'bars';
    else if (Math.abs(rs) > 0.45 && Math.abs(rs) >= Math.abs(rp)) kind = 'side';
    else if (rp > 0.3) kind = 'back';
    else kind = 'bars';
    this.kind = kind;
    // the way the bike tips: the way it was turning or leaning, else a fixed choice per spot
    this.side = Math.abs(rs) > 0.12 ? Math.sign(rs) : Math.abs(st.lean || 0) > 0.05 ? Math.sign(st.lean) : Math.floor(st.s * 3) & 1 ? 1 : -1;
    const sev = this.sev;

    // ---- bike ----
    this.bs = st.s;
    this.bd = st.d;
    this.yaw = st.yaw; // momentum direction
    // looped out ('back'): the bike shoots out from under the rider
    this.bv = v * { bars: 0.28, back: 0.75, side: 0.8, fall: 0.55 }[kind];
    this.bTau = kind === 'fall' ? 1.2 : 0.32;
    this.rollT0 = { bars: 0.2, back: 0.13, side: 0.02, fall: 0 }[kind];
    this.rollD = 0.5 - 0.16 * sev;
    this.wheelV = v / 0.34;
    this.wheel = 0;
    this.drop = 0;
    this.dropV = 0;
    this.rollHit = false;

    // ---- rider: starts where the hip was on the bike, then flies on with its own momentum ----
    const w = this.track.toWorld(st.s, st.d, _w);
    _q.setFromEuler(_e.set(0, st.yaw + rs, 0, 'YXZ')).multiply(_q2.setFromEuler(_e.set(-rp, 0, 0)));
    _v.copy(HIP).sub(new THREE.Vector3(0, COM, 0)).applyQuaternion(_q);
    this.rx = w.x + _v.x;
    this.rz = w.z + _v.z;
    this.ry = st.y + COM + _v.y;
    this.rs_ = st.s;
    this.rd_ = st.d;
    // capped so even a flat-out crash stays in the camera's view
    const fwd = Math.min(9, v * { bars: 0.75, back: 0.4, side: 0.55, fall: 0.5 }[kind]);
    // thrown off to the side away from where the bike lies, so the two never end up tangled
    const lat = -(kind === 'side' ? 1.4 + 1.4 * sev : 0.9 + 0.4 * sev) * this.side;
    // lateral axis of the bike (local +x)
    const fx = Math.sin(st.yaw);
    const fz = Math.cos(st.yaw);
    this.rvx = fx * fwd + fz * lat;
    this.rvz = fz * fwd - fx * lat;
    // into barrels the rider vaults over the row
    this.rvy = /barrel/i.test(reason) ? 5 + 0.6 * sev : { bars: 1.6 + 2.2 * sev, back: 0.9, side: 1.3, fall: 0.6 }[kind];
    this.grounded = false;
    this.ground = 0; // 0..1 smoothed, drives the limb pose (brace in the air -> sprawl on the deck)
    // body pitch: from the bike's pitch at impact to lying face down (forward) or on the back
    this.th0 = -rp;
    this.thF = kind === 'back' ? -Math.PI / 2 : Math.PI / 2 + (kind === 'bars' && sev > 0.7 ? TAU : 0);
    this.thT = kind === 'bars' ? 0.5 + 0.25 * sev : 0.45;
    // body heading: thrown off sideways the rider ends up lying across the line of travel
    this.ya0 = st.yaw + rs;
    this.yaF = st.yaw + (kind === 'side' ? this.side * Math.PI * 0.5 : rs * 0.4);
    this.riderMatrix = new THREE.Matrix4();
    this.fx.push({ x: w.x, y: st.y, z: w.z, n: kind === 'fall' ? 0 : 4 + Math.round(4 * sev), k: 1 });
  }

  groundAt(s, d) {
    return this.track.sample(s, _c).y + this.track.rampHeight(s, d);
  }

  /**
   * Move (s, d) by a world xz step; refuses to go into a hole, up a face or into barrels unless
   * `low` (world y of the lowest part, for a rider in the air) passes over them.
   */
  _move(s, d, dx, dz, h0, low = -Infinity) {
    const c = this.track.sample(s, _c);
    const ds = dx * c.hx + dz * c.hz;
    const dd = -dx * c.hz + dz * c.hx;
    const s2 = s + ds;
    const d2 = clamp(d + dd, -this.track.limit + 0.25, this.track.limit - 0.25);
    const course = this.course;
    if (course.pitAt(s2, d2)) return null;
    const g2 = this.groundAt(s2, d2);
    if (g2 - h0 > 0.3 && low < g2) return null;
    if (course.obstacles.length && course.obstacleAt(s2, d2, Math.max(0.2, low - g2))) return null;
    return [s2, d2];
  }

  /** Deck height under a world point near the rider (-Infinity over open sky). */
  deckY(x, z) {
    if (this.kind === 'fall') return -Infinity;
    const c = this.track.sample(this.rs_, _c);
    const w = this.track.toWorld(this.rs_, this.rd_, _w);
    const ds = (x - w.x) * c.hx + (z - w.z) * c.hz;
    const dd = -(x - w.x) * c.hz + (z - w.z) * c.hx;
    if (this.course.pitAt(this.rs_ + ds, this.rd_ + dd)) return -Infinity;
    return this.groundAt(this.rs_ + ds, this.rd_ + dd);
  }

  /** Ground pitch (rad, three.js x rotation) along a heading at (s, d). */
  _slope(s, d, yaw) {
    const c = this.track.sample(s, _c);
    const rel = wrapAngle(yaw - c.head);
    const k = Math.cos(rel);
    const a = this.groundAt(s - 0.4 * k, d);
    const b = this.groundAt(s + 0.4 * k, d);
    return clamp(-Math.atan((b - a) / 0.8), -0.5, 0.5);
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const t = this.t;
    const fall = this.kind === 'fall';
    // ---- bike slides on, then stops ----
    const step = this.bv * dt;
    this.bv *= Math.exp(-dt / this.bTau);
    if (step > 1e-4) {
      const c = this.track.sample(this.bs, _c);
      const dx = Math.sin(this.yaw) * step;
      const dz = Math.cos(this.yaw) * step;
      if (fall) {
        // over the void nothing can stop it: keep drifting while it drops
        this.bs += dx * c.hx + dz * c.hz;
        this.bd += -dx * c.hz + dz * c.hx;
      } else {
        const m = this._move(this.bs, this.bd, dx, dz, this.groundAt(this.bs, this.bd));
        if (m) [this.bs, this.bd] = m;
        else this.bv = 0;
      }
    }
    this.wheelV *= Math.exp(-dt / 0.9);
    this.wheel += this.wheelV * dt;
    if (fall) {
      this.dropV += 14 * dt;
      this.drop = Math.min(60, this.drop + this.dropV * dt);
    }

    // ---- rider ----
    const th = this.th(t);
    const rest = 0.15 + 0.8 * Math.abs(Math.cos(th)); // hip height above the deck for this body angle
    if (fall) {
      this.rvy -= G * dt;
      this.ry += this.rvy * dt;
      this.rx += this.rvx * dt * 0.6;
      this.rz += this.rvz * dt * 0.6;
      return;
    }
    if (!this.grounded) this.rvy -= G * dt;
    this.ry += this.rvy * dt;
    const hs = Math.hypot(this.rvx, this.rvz);
    if (hs > 1e-3) {
      const h0 = this.groundAt(this.rs_, this.rd_);
      const low = this.grounded ? -Infinity : this.ry - 0.55;
      let m = this._move(this.rs_, this.rd_, this.rvx * dt, this.rvz * dt, h0, low);
      if (!m && this.grounded) {
        // blocked ahead: keep only the sideways part, away from the bike
        const lx = Math.cos(this.yaw);
        const lz = -Math.sin(this.yaw);
        const l = this.rvx * lx + this.rvz * lz;
        this.rvx = lx * l;
        this.rvz = lz * l;
        m = this._move(this.rs_, this.rd_, this.rvx * dt, this.rvz * dt, h0, low);
      }
      if (m) {
        const w = this.track.toWorld(m[0], m[1], _w);
        this.rs_ = m[0];
        this.rd_ = m[1];
        this.rx = w.x;
        this.rz = w.z;
      } else if (this.grounded) {
        this.rvx *= 0.2;
        this.rvz *= 0.2;
      }
      // in the air a blocked rider keeps the momentum and goes over once high enough
    }
    const g = this.groundAt(this.rs_, this.rd_);
    if (this.ry <= g + rest) {
      this.ry = g + rest;
      if (!this.grounded) {
        this.grounded = true;
        this.rvy = 0;
        this.rvx *= 0.6;
        this.rvz *= 0.6;
        this.fx.push({ x: this.rx, y: g, z: this.rz, n: 3 + Math.round(3 * this.sev), k: 0.8 });
      }
    }
    if (this.grounded) {
      // sliding on the planks: friction, then still
      const f = Math.exp(-dt / 0.22);
      this.rvx *= f;
      this.rvz *= f;
      this.ry = g + rest;
    }
    this.ground += ((this.grounded ? 1 : 0) - this.ground) * Math.min(1, dt * 7);
  }

  /** Rider body pitch at time t. */
  th(t) {
    if (this.kind === 'fall') return this.th0 + (this.rp >= 0 ? -1 : 1) * 2.2 * t;
    return this.th0 + (this.thF - this.th0) * smooth(t / this.thT);
  }

  /**
   * Bike pose for the view: position (track coords + world y), yaw, nose-up angle, roll, wheel.
   * @param roll max roll for this bike (resting on bars + pedal), out
   */
  bike(maxRoll, out) {
    const t = this.t;
    const sev = this.sev;
    const fall = this.kind === 'fall';
    // the wheel that hit first slaps the other one down
    let up = this.rp * Math.exp(-t / 0.07);
    // front wheel stopped dead: the back of the bike kicks up before it comes down again
    if (this.kind === 'bars') up -= (0.18 + 0.32 * sev) * Math.sin(Math.PI * clamp(t / 0.34, 0, 1));
    if (fall) up = this.rp + (this.rp >= 0 ? 1 : -1) * 1.6 * t;
    const u = (t - this.rollT0) / this.rollD;
    let roll = 0;
    if (fall) roll = this.side * Math.min(1.4, 1.1 * t);
    else if (u > 0) {
      // tipping over accelerates like a falling stick, then a small bounce on the bars
      const b = u < 1 ? u * u : 1 - 0.07 * Math.sin(Math.PI * clamp(((u - 1) * this.rollD) / 0.2, 0, 1));
      roll = this.side * maxRoll * b;
      if (u >= 1 && !this.rollHit) {
        this.rollHit = true;
        this.fx.push({ bike: true, n: 2 + Math.round(2 * sev), k: 0.6 });
      }
    }
    out.s = this.bs;
    out.d = this.bd;
    out.y = this.groundAt(this.bs, this.bd) + (fall ? -this.drop : 0);
    // keep the lower wheel (contact point + rim radius) on the deck while the bike is pitched
    if (!fall) out.y += 0.34 * (1 - Math.cos(up)) + 0.52 * Math.abs(Math.sin(up));
    out.yaw = this.yaw + this.rs * Math.exp(-t / 0.6) + this.side * (this.kind === 'side' ? 0.55 : 0.3) * this.sev * smooth(t / 0.5);
    out.pitch = (fall ? 0 : this._slope(this.bs, this.bd, out.yaw)) - up;
    out.roll = roll;
    out.wheel = this.wheel;
    out.steer = this.side * CRASH_STEER * smooth((t - this.rollT0) / 0.35);
    return out;
  }

  /** World matrix of the rider's hip frame (upright = rider standing; +z = facing). */
  rider() {
    const t = this.t;
    const th = this.th(t);
    const ya = this.ya0 + wrapAngle(this.yaF - this.ya0) * smooth(t / 0.55);
    const sl = this.kind === 'fall' ? 0 : this._slope(this.rs_, this.rd_, ya) * this.ground;
    _q.setFromEuler(_e.set(sl + th, ya, 0, 'YXZ'));
    this.riderMatrix.compose(_v.set(this.rx, this.ry, this.rz), _q, _one);
    return this.riderMatrix;
  }

  /** Where the rider lies (for a contact shadow). */
  riderGround(out = {}) {
    out.x = this.rx;
    out.y = this.groundAt(this.rs_, this.rd_);
    out.z = this.rz;
    out.yaw = this.yaF;
    out.lying = this.ground;
    return out;
  }
}
