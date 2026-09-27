// Gradient sky dome with sun + billboard clouds + sun/hemisphere lights.
import * as THREE from 'three';
import { makeRng } from '@shared/math.js';
import { makeCloud } from './textures.js';

export const SKY = {
  top: new THREE.Color('#2f6fd6'),
  horizon: new THREE.Color('#bcd6ee'),
  fog: new THREE.Color('#c3d6e6'),
  sunDir: new THREE.Vector3(-0.45, 0.62, -0.64).normalize(),
  sunColor: new THREE.Color('#fff1d6'),
};

export function buildSkyDome() {
  const geo = new THREE.SphereGeometry(4600, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: SKY.top },
      uHorizon: { value: SKY.horizon },
      uFog: { value: SKY.fog },
      uSun: { value: SKY.sunDir },
      uSunColor: { value: SKY.sunColor },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // at far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uFog; uniform vec3 uSun; uniform vec3 uSunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
        col = mix(uFog, col, smoothstep(-0.02, 0.12, h));
        float sd = max(dot(d, uSun), 0.0);
        col += uSunColor * (pow(sd, 900.0) * 18.0 + pow(sd, 64.0) * 0.55 + pow(sd, 6.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/** Star field + moon for night maps. */
export function buildNightSky(center) {
  const g = new THREE.Group();
  const N = 2200;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const rng = makeRng(404);
  for (let i = 0; i < N; i++) {
    const a = rng() * Math.PI * 2;
    const el = Math.asin(0.08 + rng() * 0.92);
    const r = 4200;
    pos.set([Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r], i * 3);
    const b = 0.5 + rng() * 0.5;
    col.set([b, b, b * (0.9 + rng() * 0.2)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
  stars.frustumCulled = false;
  g.add(stars);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(70, 20, 14), new THREE.MeshBasicMaterial({ color: '#f1efe4', fog: false }));
  moon.position.copy(SKY.sunDir).multiplyScalar(3900);
  g.add(moon);
  g.userData.follow = center;
  return g;
}

export function buildClouds(center) {
  const group = new THREE.Group();
  const rng = makeRng(77);
  const textures = [1, 2, 3, 4].map((s) => makeCloud(s * 13));
  const mats = textures.map(
    (t) => new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: true, opacity: 0.95 }),
  );
  for (let i = 0; i < 46; i++) {
    const s = new THREE.Sprite(mats[i % mats.length]);
    const a = rng() * Math.PI * 2;
    const r = 300 + rng() * 2300;
    s.position.set(center.x + Math.cos(a) * r, 380 + rng() * 380, center.z + Math.sin(a) * r);
    const sc = 380 + rng() * 520;
    s.scale.set(sc, sc * 0.45, 1);
    s.userData.speed = 2 + rng() * 3;
    group.add(s);
  }
  group.userData.update = (dt) => {
    for (const s of group.children) {
      s.position.x += s.userData.speed * dt;
      if (s.position.x > center.x + 2800) s.position.x -= 5600;
    }
  };
  return group;
}

export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight('#cfe3ff', '#5b6b3c', 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(SKY.sunColor, 3.1);
  sun.position.copy(SKY.sunDir).multiplyScalar(300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -70;
  cam.right = 70;
  cam.top = 70;
  cam.bottom = -70;
  cam.near = 20;
  cam.far = 700;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  return { hemi, sun };
}

/** Environment map (PBR reflections) generated from the sky dome. */
export function buildEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const dome = buildSkyDome();
  dome.scale.setScalar(0.01);
  envScene.add(dome);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#4d6134' }),
  );
  ground.position.y = -2;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  // texture.dispose() alone leaves a render target's GL texture alive; free the whole target
  rt.texture.addEventListener('dispose', () => rt.dispose());
  envScene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return rt.texture;
}
