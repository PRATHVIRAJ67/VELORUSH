// Stunt-only world: a level's wooden sky course high above a sea of clouds. Replaces the racing
// World (terrain, vegetation, props) only while a stunt level is loaded; racing maps are rebuilt
// untouched when the player leaves stunt mode. Provides the small part of the World interface the
// app uses (scene, lights, theme, weather/props/terrain stubs, update, dispose).
import * as THREE from 'three';
import { buildSkyDome, buildNightSky, buildLights, buildEnvironment, SKY } from './Sky.js';
import { makeCloud, canvas, toTexture } from './textures.js';
import { makeRng } from '@shared/math.js';
import { StuntCourseView, plankTexture } from './StuntCourseView.js';

// one sky palette per level family (the level's `map` key picks it)
const PALETTES = {
  mountain: { name: 'Blue Sky', top: '#2f6fd6', horizon: '#bfd8ef', fog: '#cfe0f0', sun: '#fff1d6', sunDir: [-0.45, 0.62, -0.64], cloud: '#ffffff', sea: '#f4f8fc', hemi: 1.15, sunI: 3.1 },
  alpine: { name: 'Morning Haze', top: '#3f7fd8', horizon: '#f3dcc8', fog: '#ecdccf', sun: '#ffe2bc', sunDir: [0.7, 0.32, -0.5], cloud: '#fff4ea', sea: '#fbeee2', hemi: 1.1, sunI: 2.8 },
  coast: { name: 'Sunset', top: '#3b3d8c', horizon: '#ff9d6a', fog: '#f0a47c', sun: '#ffb47c', sunDir: [0.85, 0.16, 0.4], cloud: '#ffd2b8', sea: '#f6b892', hemi: 0.9, sunI: 2.6 },
  forest: { name: 'Dawn', top: '#58779f', horizon: '#ffd2a6', fog: '#dcc9b9', sun: '#ffd0a0', sunDir: [-0.8, 0.22, 0.4], cloud: '#ffe9d6', sea: '#efdccc', hemi: 1.0, sunI: 2.5 },
  canyon: { name: 'Golden Hour', top: '#4876c6', horizon: '#ffd287', fog: '#f1d4a2', sun: '#ffd28a', sunDir: [-0.3, 0.28, 0.9], cloud: '#fff0d0', sea: '#f9e4bd', hemi: 1.05, sunI: 3.0 },
  city: { name: 'Starlight', top: '#050a1c', horizon: '#1d2b4f', fog: '#15203b', sun: '#bcd0ff', sunDir: [0.35, 0.55, -0.6], cloud: '#5a6a96', sea: '#2a3658', hemi: 0.45, sunI: 0.7, night: true },
};
export const skyName = (level) => PALETTES[level.map]?.name || 'Blue Sky';

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const _w = {};

export class StuntWorld {
  constructor(scene, renderer, course) {
    this.isStunt = true;
    this.scene = scene;
    this.renderer = renderer;
    this.course = course;
    this.track = course.track;
    this.level = course.level;
    const pal = (this.pal = PALETTES[course.level.map] || PALETTES.mountain);
    this.theme = { night: !!pal.night, ambience: 'desert', name: pal.name };
    this.time = 0;
    // the app reads these; a sky course has no terrain, crowd, waterfall or racing weather
    this.terrain = { heightAt: () => -1e9, W: 0 };
    this.props = { onFlash: null, spectators: { spots: [] }, waterfallPos: null, setStartLights() {} };
    this.weather = { p: { wet: 0, rain: 0 }, exposure: pal.night ? 1.15 : 1, grip: 1, apply() {}, update() {} };
    this.roadMaterials = [];
  }

  async build(progress = () => {}) {
    const { scene, pal } = this;
    SKY.top.set(pal.top);
    SKY.horizon.set(pal.horizon);
    SKY.fog.set(pal.fog);
    SKY.sunColor.set(pal.sun);
    SKY.sunDir.set(...pal.sunDir).normalize();
    scene.background = new THREE.Color(pal.fog);
    scene.fog = new THREE.Fog(pal.fog, 320, 2400);
    progress(0.1, `Building ${this.level.name}…`);
    await frame();
    this.sky = buildSkyDome();
    scene.add(this.sky);
    if (pal.night) {
      this.nightSky = buildNightSky();
      scene.add(this.nightSky);
    }
    this.lights = buildLights(scene);
    this.lights.hemi.intensity = pal.hemi;
    this.lights.hemi.color.set(pal.night ? '#5a6a9a' : '#dfeaff');
    this.lights.hemi.groundColor.set(pal.night ? '#151a28' : '#c9b9a0');
    this.lights.sun.intensity = pal.sunI;
    progress(0.35, 'Sawing the planks…');
    await frame();
    this._clouds();
    progress(0.6, 'Raising the towers…');
    await frame();
    this.courseView = new StuntCourseView(scene, this.course, { night: !!pal.night });
    progress(0.85, 'Painting the sky…');
    await frame();
    scene.environment = buildEnvironment(this.renderer);
    scene.environmentIntensity = 0.55;
    progress(1, 'Ready');
    await frame();
  }

  /** A sea of clouds far below the course plus drifting cloud banks around it. */
  _clouds() {
    const t = this.track;
    const c = this.course;
    let minY = Infinity;
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (let s = c.startU; s < c.finishU; s += 10) {
      const w = t.toWorld(s, 0, _w);
      minY = Math.min(minY, w.y);
      cx += w.x;
      cz += w.z;
      n++;
    }
    cx /= n;
    cz /= n;
    this.center = new THREE.Vector3(cx, minY, cz);
    this.floorY = minY - 85;
    // cloud sea: a big soft textured disc
    const cv = canvas(512, 512);
    const g = cv.getContext('2d');
    g.fillStyle = this.pal.sea;
    g.fillRect(0, 0, 512, 512);
    const rng = makeRng(this.level.n * 31 + 7);
    for (let i = 0; i < 260; i++) {
      const x = rng() * 512;
      const y = rng() * 512;
      const r = 14 + rng() * 46;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.fillStyle = 'rgba(120,130,160,0.05)';
      g.fillRect(x - r * 0.4, y + r * 0.2, r * 0.8, r * 0.3);
    }
    const tex = toTexture(cv, { repeat: [10, 10] });
    const sea = new THREE.Mesh(new THREE.CircleGeometry(4200, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, color: this.pal.cloud, roughness: 1, emissive: this.pal.cloud, emissiveIntensity: this.pal.night ? 0.05 : 0.25 }));
    sea.position.set(cx, this.floorY, cz);
    this.scene.add(sea);
    this.sea = sea;
    // billboard cloud banks, some below the deck, a few drifting at deck height in the distance
    const textures = [1, 2, 3].map((k) => makeCloud(this.level.n * 3 + k));
    const mats = textures.map((m) => new THREE.SpriteMaterial({ map: m, color: this.pal.cloud, transparent: true, depthWrite: false, fog: true, opacity: 0.92 }));
    const group = new THREE.Group();
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(mats[i % mats.length]);
      const a = rng() * Math.PI * 2;
      const below = i < 26;
      const r = below ? 60 + rng() * 900 : 420 + rng() * 1500;
      s.position.set(cx + Math.cos(a) * r, below ? this.floorY + 10 + rng() * 40 : minY - 30 + rng() * 140, cz + Math.sin(a) * r);
      const sc = below ? 160 + rng() * 260 : 220 + rng() * 380;
      s.scale.set(sc, sc * 0.42, 1);
      s.userData.speed = 1.5 + rng() * 3;
      group.add(s);
    }
    this.clouds = group;
    this.scene.add(group);
  }

  setQuality() {}

  inTunnel() {
    return false;
  }

  update(dt, camera, focus) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    if (this.nightSky) this.nightSky.position.copy(camera.position);
    const cx = this.center.x;
    for (const s of this.clouds.children) {
      s.position.x += s.userData.speed * dt;
      if (s.position.x > cx + 1600) s.position.x -= 3200;
    }
    const sun = this.lights.sun;
    const f = focus || camera.position;
    sun.target.position.copy(f);
    sun.position.copy(f).addScaledVector(SKY.sunDir, 300);
    this.courseView.update(dt, this.run || null);
  }

  /** Free every GPU resource of the sky course. */
  dispose() {
    this.courseView?.dispose();
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
        for (const v of Object.values(m)) if (v?.isTexture && !seen.has(v)) {
          seen.add(v);
          v.dispose();
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
}

export { plankTexture };
