// WebGL renderer, camera and post-processing chain with quality presets.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { setMaxAnisotropy } from '../world/textures.js';
import { isMobile } from '../core/device.js';

// Radial speed blur + vignette + slight chromatic fringe, driven by speed.
const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0 },
    uVignette: { value: 0.35 },
    uTint: { value: new THREE.Vector3(0, 0, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette; uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec2 c = vec2(0.5, 0.55);
      vec2 dir = vUv - c;
      float dist = length(dir);
      float k = uAmount * smoothstep(0.12, 0.7, dist);
      vec4 col = vec4(0.0);
      const int N = 8;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1);
        col += texture2D(tDiffuse, vUv - dir * t * k * 0.09);
      }
      col /= float(N);
      // chromatic fringe at the edges
      float ca = k * 0.006;
      col.r = mix(col.r, texture2D(tDiffuse, vUv - dir * (k * 0.09 + ca)).r, 0.5);
      col.b = mix(col.b, texture2D(tDiffuse, vUv - dir * max(0.0, k * 0.09 - ca)).b, 0.5);
      float vig = smoothstep(0.85, 0.25, dist * (1.0 + uVignette * 0.6));
      col.rgb *= mix(1.0, vig, uVignette);
      col.rgb += uTint * smoothstep(0.25, 0.8, dist);
      gl_FragColor = col;
    }`,
};

export class Renderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(r.domElement);
    r.domElement.id = 'game-canvas';
    setMaxAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);
    this.quality = 'high';
    this.speedFx = true;
    this.speed = 0;
    this.tint = new THREE.Vector3();
    window.addEventListener('resize', () => this.resize());
  }

  /** New empty scene (map switch); the post-processing chain is rebuilt for it. */
  newScene() {
    this.scene = new THREE.Scene();
    this._buildComposer();
  }

  setQuality(q, world) {
    this.quality = q;
    const r = this.renderer;
    const dpr = window.devicePixelRatio || 1;
    let ratio = q === 'low' ? Math.min(dpr, 1) * 0.8 : q === 'medium' ? Math.min(dpr, 1.25) : q === 'high' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    // phones: 3x screens would cost 9x the pixels; cap for a sharp image at a sane fill rate
    if (isMobile()) ratio = q === 'low' ? Math.min(dpr, 1) : q === 'medium' ? Math.min(dpr, 1.5) : q === 'high' ? Math.min(dpr, 1.75) : Math.min(dpr, 2);
    r.setPixelRatio(ratio);
    r.shadowMap.enabled = q !== 'low';
    r.shadowMap.type = q === 'high' || q === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const sun = world?.lights?.sun;
    if (sun) {
      const size = q === 'ultra' ? 4096 : q === 'high' ? 2048 : 1024;
      const ext = q === 'ultra' ? 95 : 70;
      const sc = sun.shadow.camera;
      sc.left = sc.bottom = -ext;
      sc.right = sc.top = ext;
      sc.updateProjectionMatrix();
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      sun.castShadow = q !== 'low';
    }
    // force material recompiles for shadow toggles
    this.scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
    this._buildComposer();
    this.resize();
  }

  _buildComposer() {
    // composer.dispose() only frees its own buffers; the passes own GTAO/bloom targets too
    for (const p of this.composer?.passes || []) p.dispose?.();
    this.composer?.dispose();
    this.composer = null;
    this.gtao = null;
    this.bloom = null;
    if (this.quality === 'low') return;
    const c = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality === 'high' || this.quality === 'ultra') {
      try {
        const gtao = new GTAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
        gtao.blendIntensity = this.quality === 'ultra' ? 0.9 : 0.75;
        // GTAO's override pass ignores alpha: soft sprites (clouds, name tags) would render as hard
        // slabs into the AO buffers. Hide them for that pass like it already does for points/lines.
        const hideBase = gtao._overrideVisibility.bind(gtao);
        gtao._overrideVisibility = () => {
          hideBase();
          this.scene.traverseVisible((o) => {
            if (o.isSprite) gtao._visibilityCache.push(o);
          });
          for (const o of gtao._visibilityCache) o.visible = false;
        };
        gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1 });
        c.addPass(gtao);
        this.gtao = gtao;
      } catch (e) {
        console.warn('GTAO unavailable', e);
      }
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.5, 0.92);
      c.addPass(this.bloom);
    }
    this.speedPass = new ShaderPass(SpeedShader);
    this.speedPass.uniforms.uTint.value = this.tint;
    c.addPass(this.speedPass);
    c.addPass(new OutputPass());
    this.composer = c;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
  }

  render(dt) {
    if (this.composer) {
      const target = this.speedFx ? Math.max(0, Math.min(0.75, (this.speed - 19) / 20)) : 0;
      const u = this.speedPass.uniforms;
      u.uAmount.value += (target - u.uAmount.value) * Math.min(1, dt * 4);
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
