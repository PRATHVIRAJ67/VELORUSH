// Map audit (dev tool): loads each map in a browser and probes the real 3D scene along the whole
// route. Riders can reach any lateral offset |d| <= track.limit (the barrier), so every scene object
// inside that corridor between 0.25 m and RIDER_H above the road surface is something a rider would
// visibly ride through. Rays are cast straight down over a grid of (s, d) points.
// Usage: node tools/map-audit.mjs [mapId ...]   (needs the client dev server; URL env to override)
import puppeteer from 'puppeteer-core';

const URL = process.env.URL || 'http://localhost:5173/';
const maps = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 1800000, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 450 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show') && window.__THREE, { timeout: 180000 });
const ids = maps.length ? maps : await page.evaluate(() => ['mountain', 'alpine', 'coast', 'forest', 'canyon', 'city']);
let total = 0;
for (const id of ids) {
  await page.evaluate((id) => window.__app.loadTrack(id), id);
  await page.waitForFunction((id) => window.__app.track.id === id && !window.__app.loading, { timeout: 120000 }, id);
  const r = await page.evaluate(() => {
    const THREE = window.__THREE;
    const app = window.__app;
    app.stopDemo(); // demo riders are not scenery
    const t = app.track;
    const scene = app.renderer.scene;
    scene.updateMatrixWorld(true);
    const RIDER_H = 3.0; // rider + bike (~2 m) with headroom
    // terrain: its height function matches the drawn mesh, so check it analytically (no raycast)
    const T = app.world.terrain;
    const terrainMeshes = new Set(T.group ? T.group.children : []);
    const all = [];
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.visible || o.isSprite || terrainMeshes.has(o)) return;
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (!o.isInstancedMesh && g.boundingSphere.radius > 3000) return; // sky dome
      if (o.isInstancedMesh) o.computeBoundingBox?.();
      const box = o.isInstancedMesh && o.boundingBox ? o.boundingBox.clone().applyMatrix4(o.matrixWorld) : new THREE.Box3().setFromObject(o);
      all.push({ o, box });
    });
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const label = (o) => {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const geo = o.geometry.type.replace('Geometry', '');
      const col = m?.color ? '#' + m.color.getHexString() : '';
      if (o.userData.kind) return `vegetation: ${o.userData.kind}`;
      return `${o.isInstancedMesh ? 'Instanced' : ''}${geo}${col ? ' ' + col : ''}${m?.map ? ' tex' : ''}`;
    };
    const found = new Map();
    const note = (key, s, d, hh) => {
      const e = found.get(key) || { n: 0, sMin: s, sMax: s, dMin: Math.abs(d), hMin: hh, hMax: hh, pts: [] };
      e.n++;
      e.sMin = Math.min(e.sMin, s);
      e.sMax = Math.max(e.sMax, s);
      e.dMin = Math.min(e.dMin, Math.abs(d));
      e.hMin = Math.min(e.hMin, hh);
      e.hMax = Math.max(e.hMax, hh);
      if (e.pts.length < 6 && !e.pts.some((p) => Math.abs(p.s - s) < 8)) e.pts.push({ s, d, h: +hh.toFixed(2) });
      found.set(key, e);
    };
    const CH = 25;
    const corridor = new THREE.Box3();
    const o3 = new THREE.Vector3();
    for (let s0 = 0; s0 < t.length; s0 += CH) {
      // scenery whose bounds touch this road section's corridor
      corridor.makeEmpty();
      for (let s = s0; s <= Math.min(t.length, s0 + CH); s += 5) {
        for (const d of [-t.limit, t.limit]) {
          const w = t.toWorld(s, d, {});
          corridor.expandByPoint(o3.set(w.x, w.y - 0.5, w.z));
          corridor.expandByPoint(o3.set(w.x, w.y + RIDER_H + 2, w.z));
        }
      }
      corridor.expandByScalar(1);
      const targets = all.filter((a) => a.box.intersectsBox(corridor)).map((a) => a.o);
      for (let s = s0; s < Math.min(t.length, s0 + CH); s += 1) {
        const c = t.sample(s);
        for (let d = -t.limit; d <= t.limit + 1e-6; d += 0.5) {
          const w = t.toWorld(s, d, {});
          const roadY = c.y + t.rampHeight(s, d);
          const g = T.heightAt(w.x, w.z) - roadY;
          if (g > 0.25 && Math.abs(d) > t.halfWidth) note('terrain above shoulder', s, d, g);
          if (!targets.length) continue;
          ray.set(o3.set(w.x, roadY + 14, w.z), down);
          ray.far = 14 - 0.25;
          for (const h of ray.intersectObjects(targets, false)) {
            const hh = h.point.y - roadY;
            if (hh <= 0.25 || hh >= RIDER_H) continue;
            note(label(h.object), s, d, hh);
            break;
          }
        }
      }
    }
    return { length: Math.round(t.length), limit: t.limit, halfWidth: t.halfWidth, list: [...found.entries()].map(([k, v]) => ({ k, ...v })) };
  });
  total += r.list.length;
  console.log(`\n== ${id}: ${r.length} m, road half-width ${r.halfWidth} m, reachable |d| <= ${r.limit.toFixed(2)} m`);
  if (!r.list.length) console.log('   OK: nothing inside the riding corridor');
  for (const e of r.list.sort((a, b) => b.n - a.n)) {
    console.log(`   ${String(e.n).padStart(5)} pts  ${e.k.padEnd(34)} s ${e.sMin}-${e.sMax}  |d|>=${e.dMin.toFixed(1)}  h ${e.hMin.toFixed(2)}-${e.hMax.toFixed(2)} m  e.g. ${e.pts.map((p) => `(s${p.s} d${p.d.toFixed(1)} h${p.h})`).join(' ')}`);
  }
}
console.log(`\n${total ? `${total} object type(s) inside riding corridors` : 'ALL CLEAR'}${errors.length ? ' · page errors: ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(0);
