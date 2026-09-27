// Builds and updates the whole Mountain Grand Prix environment.
import * as THREE from 'three';
import { Terrain } from './Terrain.js';
import { buildRoad } from './Road.js';
import { Props } from './Props.js';
import { Vegetation } from './Vegetation.js';
import { buildSkyDome, buildClouds, buildLights, buildEnvironment, buildNightSky, SKY } from './Sky.js';
import { themeFor } from './themes.js';
import { FLAG } from '@shared/track.js';
import { Weather } from './Weather.js';

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class World {
  constructor(scene, renderer, track) {
    this.scene = scene;
    this.renderer = renderer;
    this.track = track;
    this.time = 0;
    this.theme = themeFor(track);
  }

  async build(progress = () => {}) {
    const { scene, track } = this;
    const th = this.theme;
    SKY.sunDir.set(...th.sunDir).normalize();
    SKY.sunColor.set(th.sunColor || '#fff1d6');
    scene.background = SKY.fog.clone();
    scene.fog = new THREE.Fog(SKY.fog, 260, 2600);

    progress(0.05, `Building ${track.name}…`);
    await frame();
    this.terrain = new Terrain(track);
    scene.add(this.terrain.build());

    progress(0.4, 'Paving the road…');
    await frame();
    const road = buildRoad(track);
    this.padTex = road.padTex;
    const roadMesh = road.group.getObjectByName('road');
    this.roadMaterials = Array.isArray(roadMesh.material) ? roadMesh.material : [roadMesh.material];
    scene.add(road.group);

    progress(0.55, 'Building the village…');
    await frame();
    this.props = new Props(track, this.terrain);
    scene.add(this.props.build());

    progress(0.7, 'Planting pine forests…');
    await frame();
    // no trees growing through the bridge deck
    const bz = track.zones.find((z) => z.flag === FLAG.BRIDGE);
    for (let s = bz.s0 - 10; s < bz.s1 + 10; s += 5) {
      const p = track.toWorld(s, 0);
      this.props.exclusions.push({ x: p.x, z: p.z, r: this.terrain.W + 7 });
    }
    this.vegetation = new Vegetation(this.terrain, track, this.props.exclusions);
    scene.add(this.vegetation.build());

    progress(0.85, 'Painting the sky…');
    await frame();
    this.sky = buildSkyDome();
    scene.add(this.sky);
    this.clouds = buildClouds(new THREE.Vector3(0, 0, -100));
    scene.add(this.clouds);
    this.lights = buildLights(scene);
    if (th.night) {
      this.lights.hemi.color.set('#3a4a6a');
      this.lights.hemi.groundColor.set('#1a1a1c');
      this.nightSky = buildNightSky();
      scene.add(this.nightSky);
      this.clouds.visible = false;
    }
    scene.environment = buildEnvironment(this.renderer);
    scene.environmentIntensity = 0.6;
    this._birds();
    this._helicopter();
    this.weather = new Weather(this, this.renderer);
    this.weather.apply('clear');
    progress(1, 'Ready');
    await frame();
  }

  _birds() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -0.9, 0.15, 0, 0, 0, -0.2, 0, 0, 0.3, 0.9, 0.15, 0, 0, 0, -0.2], 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: '#2a2a2a', side: THREE.DoubleSide });
    this.birds = [];
    const centers = [
      [-150, 110, -150],
      [120, 130, -330],
      [-160, 70, 120],
      [230, 90, -60],
    ];
    for (const [x, y, z] of centers) {
      for (let i = 0; i < 7; i++) {
        const b = new THREE.Mesh(g, mat);
        b.scale.setScalar(1.3);
        b.userData = { cx: x, cy: y + Math.random() * 12, cz: z, r: 40 + Math.random() * 30, ph: Math.random() * 6, sp: 0.18 + Math.random() * 0.08 };
        this.scene.add(b);
        this.birds.push(b);
      }
    }
  }

  _helicopter() {
    const h = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.4, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: '#1b2a3a', roughness: 0.3, metalness: 0.5 });
    const bodyG = new THREE.CapsuleGeometry(0.9, 2.2, 6, 12).rotateX(Math.PI / 2);
    h.add(new THREE.Mesh(bodyG, paint));
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0.1, 1.2), dark);
    h.add(glass);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 4, 8).rotateX(Math.PI / 2).translate(0, 0.3, -3.3), paint);
    h.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.7).translate(0, 0.8, -5.1), new THREE.MeshStandardMaterial({ color: '#ff5a1f' }));
    h.add(fin);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 2.6).translate(0, -1.1, 0), dark);
    h.add(skid);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.04, 0.3), dark);
    rotor.position.y = 1.15;
    const rotor2 = rotor.clone();
    rotor2.rotation.y = Math.PI / 2;
    const rotors = new THREE.Group();
    rotors.add(rotor, rotor2);
    h.add(rotors);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.12).translate(0.15, 0.8, -5.1), dark);
    h.add(tail);
    h.traverse((o) => o.isMesh && (o.castShadow = true));
    h.position.set(0, 120, 0);
    this.heli = { group: h, rotors, tail, angle: 0 };
    this.scene.add(h);
  }

  /** Free GPU resources before switching maps. */
  dispose() {
    const seen = new Set();
    this.scene.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        // every texture slot, including custom shader uniforms (sky, water, terrain blends)
        const texs = Object.values(m).concat(Object.values(m.uniforms || {}).map((u) => u?.value));
        for (const t of texs) if (t?.isTexture && !seen.has(t)) {
          seen.add(t);
          t.dispose();
        }
        m.dispose();
      }
      if (o.isLight && o.shadow?.map) {
        o.shadow.map.dispose();
        o.shadow.map = null;
      }
    });
    this.scene.environment?.dispose();
  }

  setQuality(q) {
    this.vegetation?.setQuality(q);
  }

  /** Is world point inside the tunnel corridor? */
  inTunnel(s) {
    return !!(this.track.FLAGS[this.track.idx(s)] & FLAG.TUNNEL);
  }

  update(dt, camera, focus, riderPositions) {
    this.time += dt;
    const t = this.time;
    this.sky.position.copy(camera.position);
    if (this.nightSky) this.nightSky.position.copy(camera.position);
    this.clouds.userData.update(dt);
    this.weather.update(dt, camera);
    this.vegetation.update(camera.position, t);
    this.props.update(t, camera.position, riderPositions);
    if (this.padTex) this.padTex.offset.y = -t * 1.6;
    // shadow camera follows the focus point
    const sun = this.lights.sun;
    const f = focus || camera.position;
    sun.target.position.copy(f);
    sun.position.copy(f).addScaledVector(SKY.sunDir, 300);
    // TV helicopter orbits above the race
    const H = this.heli;
    if (H) {
      H.angle += dt * 0.12;
      const c = focus || camera.position;
      const tx = c.x + Math.cos(H.angle) * 70;
      const tz = c.z + Math.sin(H.angle) * 70;
      const ty = Math.max(c.y, this.terrain.heightAt(tx, tz)) + 55;
      H.group.position.lerp(new THREE.Vector3(tx, ty, tz), Math.min(1, dt * 0.6));
      H.group.lookAt(c.x, H.group.position.y - 12, c.z);
      H.rotors.rotation.y += dt * 38;
      H.tail.rotation.x += dt * 50;
    }
    for (const b of this.birds) {
      const u = b.userData;
      const a = t * u.sp + u.ph;
      b.position.set(u.cx + Math.cos(a) * u.r, u.cy + Math.sin(t * 0.7 + u.ph) * 4, u.cz + Math.sin(a) * u.r);
      b.rotation.y = -a;
      b.scale.y = 1.3 * (0.4 + Math.abs(Math.sin(t * 7 + u.ph)) * 1.2);
    }
  }
}
