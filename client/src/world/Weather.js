// Weather presets: sky, fog, light, clouds, wet road, rain streaks and wind.
import * as THREE from 'three';
import { SKY } from './Sky.js';
import { WEATHER } from '@shared/constants.js';

export class Weather {
  constructor(world, renderer) {
    this.world = world;
    this.presets = world.theme.weather;
    this.renderer = renderer;
    this.kind = 'clear';
    this.p = this.presets.clear;
    this._rain();
  }

  _rain() {
    const N = 1600;
    const pos = new Float32Array(N * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.drops = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 60, y: Math.random() * 24, z: (Math.random() - 0.5) * 60, s: 0.8 + Math.random() * 0.4 }));
    const m = new THREE.LineBasicMaterial({ color: '#c8d4e0', transparent: true, opacity: 0.45, depthWrite: false, fog: true });
    this.rainLines = new THREE.LineSegments(g, m);
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.world.scene.add(this.rainLines);
  }

  /** kind: clear | cloudy | fog | rain */
  apply(kind) {
    this.kind = this.presets[kind] ? kind : 'clear';
    const p = (this.p = this.presets[this.kind]);
    const w = this.world;
    const scene = w.scene;
    scene.fog.near = p.fog[0];
    scene.fog.far = p.fog[1];
    scene.fog.color.set(p.fogColor);
    scene.background.set(p.fogColor);
    SKY.top.set(p.top);
    SKY.horizon.set(p.horizon);
    SKY.fog.set(p.fogColor);
    w.lights.sun.intensity = p.sun;
    w.lights.hemi.intensity = p.hemi;
    for (const c of w.clouds.children) {
      c.material.color.set(p.cloud);
      c.material.opacity = p.cloudOpacity;
    }
    // wet asphalt: darker, smoother, more reflective
    for (const m of w.roadMaterials) {
      m.color.setScalar(1 - p.wet * 0.42);
      m.roughness = 1 - p.wet * 0.62;
      m.envMapIntensity = 0.5 + p.wet * 1.3;
      if (m.normalScale) m.normalScale.setScalar(0.6 - p.wet * 0.3);
    }
    w.vegetation.setWind(p.wind);
    this.rainLines.visible = p.rain > 0;
    this.exposure = p.exposure;
  }

  get grip() {
    return WEATHER[this.kind].grip;
  }

  update(dt, camera) {
    if (!this.rainLines.visible) return;
    const a = this.rainLines.geometry.attributes.position.array;
    const cp = camera.position;
    const fall = 26;
    const slant = 3.5;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.y -= fall * d.s * dt;
      d.x += slant * dt;
      if (d.y < -4) {
        d.y = 20 + Math.random() * 4;
        d.x = (Math.random() - 0.5) * 60;
        d.z = (Math.random() - 0.5) * 60;
      }
      // wrap around the camera so rain always surrounds the player
      const x = cp.x + ((((d.x) % 60) + 90) % 60) - 30;
      const z = cp.z + d.z;
      const y = cp.y + d.y - 6;
      a.set([x, y, z, x - slant * 0.03, y + 0.7 * d.s, z], i * 6);
    }
    this.rainLines.geometry.attributes.position.needsUpdate = true;
  }
}
