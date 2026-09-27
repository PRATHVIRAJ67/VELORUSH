// CPU particle pools (dust, spray, sparks, confetti, mist) + 3D speed lines.
import * as THREE from 'three';

class ParticlePool {
  constructor(max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: window.innerHeight / 2 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(aSize * uScale / max(0.1, -mv.z), 48.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.15, d) * vColor.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor.rgb, a);
          #include <colorspace_fragment>
        }`,
    });
    this.material = mat;
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav = 0, drag = 1, grow = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([r, g, b, a], i * 4);
    this.alpha0[i] = a;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.grow[i] = grow;
  }

  update(dt) {
    const { pos, vel, col, life, maxLife } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) {
        if (col[i * 4 + 3] !== 0) col[i * 4 + 3] = 0;
        continue;
      }
      life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      vel[i * 3] *= k;
      vel[i * 3 + 1] = vel[i * 3 + 1] * k - this.grav[i] * dt;
      vel[i * 3 + 2] *= k;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = life[i] / maxLife[i];
      col[i * 4 + 3] = this.alpha0[i] * Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8 + 0.2);
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.soft = new ParticlePool(2400, false);
    this.glow = new ParticlePool(900, true);
    scene.add(this.soft.points, this.glow.points);
    this._speedLines();
    this.acc = 0;
    this._onResize = () => {
      this.soft.material.uniforms.uScale.value = window.innerHeight / 2;
      this.glow.material.uniforms.uScale.value = window.innerHeight / 2;
    };
    window.addEventListener('resize', this._onResize);
  }

  /** Detach from the window so a replaced map's scene can be garbage collected. */
  dispose() {
    window.removeEventListener('resize', this._onResize);
  }

  _speedLines() {
    const N = 90;
    const pos = new Float32Array(N * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.lines = new THREE.LineSegments(g, m);
    this.lines.frustumCulled = false;
    this.linesData = Array.from({ length: N }, () => ({ a: Math.random() * Math.PI * 2, r: 2.5 + Math.random() * 4, z: Math.random() * 40, len: 1 + Math.random() * 3 }));
    this.scene.add(this.lines);
  }

  /** dust / spray behind a rider depending on surface */
  trail(pos, fwd, v, surf, offroad, dt) {
    if (v < 3) return;
    const rate = (offroad ? 40 : surf === 2 ? 28 : surf === 1 ? 4 : 0) * Math.min(1, v / 12);
    this.acc += rate * dt;
    while (this.acc > 1) {
      this.acc -= 1;
      const c = offroad ? [0.45, 0.5, 0.3] : surf === 2 ? [0.72, 0.64, 0.5] : [0.6, 0.6, 0.6];
      this.soft.emit(
        pos.x - fwd.x * 0.6 + (Math.random() - 0.5) * 0.4, pos.y + 0.1, pos.z - fwd.z * 0.6 + (Math.random() - 0.5) * 0.4,
        -fwd.x * v * 0.1 + (Math.random() - 0.5), 0.6 + Math.random() * 1.2, -fwd.z * v * 0.1 + (Math.random() - 0.5),
        c[0], c[1], c[2], 0.35, 0.35 + Math.random() * 0.3, 0.9 + Math.random() * 0.6, 0.6, 1.5, 1.2,
      );
    }
  }

  /** Burst of sparks; 'vel' lets it travel with a moving rider so the camera never plows through it. */
  burst(pos, color, n = 20, speed = 4, size = 0.25, life = 0.7, additive = true, vel = null) {
    const pool = additive ? this.glow : this.soft;
    const c = new THREE.Color(color);
    const vx = vel ? vel.x : 0;
    const vz = vel ? vel.z : 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 0.9;
      const s = speed * (0.4 + Math.random() * 0.8);
      pool.emit(pos.x, pos.y + 0.8, pos.z, vx + Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, vz + Math.sin(a) * Math.cos(e) * s, c.r, c.g, c.b, 0.9, size, life * (0.6 + Math.random() * 0.6), 3, 0.6);
    }
  }

  landing(pos) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      this.soft.emit(pos.x, pos.y + 0.05, pos.z, Math.cos(a) * 2.5, 0.3 + Math.random(), Math.sin(a) * 2.5, 0.62, 0.6, 0.55, 0.45, 0.4, 0.8, 0.5, 2.5, 1.5);
    }
  }

  boostStream(pos, fwd, v = 0) {
    // sparks trail just behind the wheels, moving almost with the rider
    for (let i = 0; i < 2; i++) {
      this.glow.emit(
        pos.x - fwd.x * 0.7 + (Math.random() - 0.5) * 0.4, pos.y + 0.15 + Math.random() * 0.5, pos.z - fwd.z * 0.7 + (Math.random() - 0.5) * 0.4,
        fwd.x * (v - 3), Math.random() * 0.6, fwd.z * (v - 3), 0.3, 0.85, 1, 0.7, 0.07, 0.3, 0, 0.5,
      );
    }
  }

  /** Rooster-tail spray off wet tyres (world space, moving with the rider). */
  spray(pos, fwd, v, dt) {
    if (v < 4) return;
    this.sprayAcc = (this.sprayAcc || 0) + dt * Math.min(70, v * 2.2);
    while (this.sprayAcc > 1) {
      this.sprayAcc -= 1;
      this.soft.emit(
        pos.x - fwd.x * 0.55 + (Math.random() - 0.5) * 0.2, pos.y + 0.25, pos.z - fwd.z * 0.55 + (Math.random() - 0.5) * 0.2,
        fwd.x * v * 0.85 + (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 1.2, fwd.z * v * 0.85 + (Math.random() - 0.5) * 1.2,
        0.8, 0.84, 0.88, 0.14, 0.035, 0.35, 6, 1.2, 0.25,
      );
    }
  }

  confetti(pos) {
    const cols = ['#ff5a1f', '#ffd23f', '#18c8ff', '#06d6a0', '#ff006e', '#ffffff'];
    for (let i = 0; i < 160; i++) {
      const c = new THREE.Color(cols[i % cols.length]);
      this.soft.emit(
        pos.x + (Math.random() - 0.5) * 14, pos.y + 7 + Math.random() * 2, pos.z + (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3,
        c.r, c.g, c.b, 1, 0.16, 3 + Math.random() * 2, 1.2, 1.5,
      );
    }
  }

  mist(pos, radius, dt, camPos) {
    if (camPos.distanceToSquared(pos) > 350 * 350) return;
    for (let i = 0; i < 40 * dt; i++) {
      this.soft.emit(
        pos.x + (Math.random() - 0.5) * radius, pos.y + Math.random() * 2, pos.z + (Math.random() - 0.5) * radius,
        (Math.random() - 0.5) * 1.5, 1 + Math.random() * 2, (Math.random() - 0.5) * 1.5,
        0.92, 0.96, 1, 0.3, 2.2, 2.5, -0.1, 0.8, 1.8,
      );
    }
  }

  /** Pollen/dust motes hanging in the air ahead of the camera: they stream past at the true speed. */
  airMotes(dt, camera, speed) {
    this.moteAcc = (this.moteAcc || 0) + dt * (14 + speed * 2.2);
    if (this.moteAcc < 1) return;
    camera.getWorldDirection(this._dir || (this._dir = new THREE.Vector3()));
    const f = this._dir;
    while (this.moteAcc >= 1) {
      this.moteAcc -= 1;
      const ahead = 6 + Math.random() * (20 + speed * 1.2);
      const side = (Math.random() - 0.5) * 16;
      const x = camera.position.x + f.x * ahead - f.z * side;
      const z = camera.position.z + f.z * ahead + f.x * side;
      const y = camera.position.y - 1.6 + Math.random() * 4;
      const warm = 0.85 + Math.random() * 0.15;
      this.soft.emit(x, y, z, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.3, 1, warm, warm * 0.85, 0.45, 0.05 + Math.random() * 0.04, 2.5, 0, 0.2);
    }
  }

  update(dt, camera, speed, draft) {
    this.airMotes(dt, camera, speed);
    this.soft.update(dt);
    this.glow.update(dt);
    // speed lines live in camera space
    const k = Math.max(0, Math.min(1, (speed - 24) / 12));
    const target = Math.max(k * 0.16, draft * 0.14);
    const m = this.lines.material;
    m.opacity += (target - m.opacity) * Math.min(1, dt * 4);
    m.color.set(draft > 0.3 ? '#9ff0ff' : '#ffffff');
    this.lines.visible = m.opacity > 0.01;
    if (!this.lines.visible) return;
    this.lines.position.copy(camera.position);
    this.lines.quaternion.copy(camera.quaternion);
    const p = this.lines.geometry.attributes.position.array;
    const sp = 30 + speed * 2;
    this.linesData.forEach((l, i) => {
      l.z -= sp * dt;
      if (l.z < 1) {
        l.z = 30 + Math.random() * 20;
        l.a = Math.random() * Math.PI * 2;
        l.r = 2.2 + Math.random() * 4;
      }
      const x = Math.cos(l.a) * l.r;
      const y = Math.sin(l.a) * l.r * 0.7;
      p.set([x, y, -l.z, x, y, -l.z - l.len * (0.6 + speed * 0.025)], i * 6);
    });
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
