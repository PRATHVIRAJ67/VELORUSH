// Small dedicated renderer that shows the player's bike on a turntable.
import * as THREE from 'three';
import { CyclistModel } from '../entities/CyclistModel.js';
import { isMobile } from '../core/device.js';

export class GaragePreview {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(3.3, 1.45, 3.3);
    this.camera.lookAt(0, 0.75, 0);
    this.scene.add(new THREE.HemisphereLight('#dfefff', '#403a30', 1.6));
    const key = new THREE.DirectionalLight('#fff4e0', 3);
    key.position.set(3, 5, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#7fc8ff', 2);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: '#1b2230', roughness: 0.4, metalness: 0.3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.turn = new THREE.Group();
    this.scene.add(this.turn);
    this.t = 0;
    this.running = false;
  }

  start(look) {
    if (this.model) {
      this.turn.remove(this.model.root);
      this.model.root.traverse((o) => o.isMesh && o.geometry.dispose());
      this.model.dispose();
    }
    this.model = new CyclistModel(look);
    this.turn.add(this.model.root);
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      const loop = () => {
        if (!this.running) return;
        requestAnimationFrame(loop);
        const now = performance.now();
        const dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.t += dt;
        this._resize();
        this.turn.rotation.y += dt * (this.turnSpeed ?? 0.5);
        this.model.pose({ crank: this.t * 5, wheel: this.t * 8, steer: Math.sin(this.t) * 0.3, lean: 0, v: 6, sprinting: false, braking: false, airborne: false, landing: 0, bump: 0, throttle: 1 }, dt, this.t);
        this.renderer.render(this.scene, this.camera);
      };
      loop();
    }
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    const c = this.renderer.domElement;
    if (c.width !== Math.floor(w * this.renderer.getPixelRatio()) || c.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      // phones: the preview panel is tall and narrow, so pull back to keep the whole bike in frame
      if (isMobile()) {
        const k = Math.max(1, 1.35 / this.camera.aspect);
        this.camera.position.set(3.3 * k, 1.45 * k, 3.3 * k);
        this.camera.lookAt(0, 0.75, 0);
      }
      this.camera.updateProjectionMatrix();
    }
  }

  stop() {
    this.running = false;
  }
}
