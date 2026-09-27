import * as THREE from 'three';
import { App } from './core/App.js';
import { isMobile } from './core/device.js';

if (isMobile()) document.body.classList.add('mobile');

const app = new App();
window.__app = app; // handy for debugging in the console
if (import.meta.env.DEV) window.__THREE = THREE; // dev tools (raycasting in tests)
app.init().catch((err) => {
  console.error(err);
  const t = document.getElementById('loading-text');
  if (t) t.textContent = 'Failed to start: ' + err.message;
});
