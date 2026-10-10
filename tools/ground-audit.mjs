// Dev audit: every InstancedMesh instance in the props: base height vs the surface under it (terrain off-road, road on it)
// Usage: node tools/ground-audit.mjs <mapId ...>   (client dev server; URL env to override). Parts that sit high by design (lamp heads, flags, crowns, windows) are listed too.
import puppeteer from 'puppeteer-core';
const ids = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 900000, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 800, height: 450 });
await p.goto(process.env.URL || 'http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show') && window.__THREE, { timeout: 180000 });
for (const id of ids) {
  await p.evaluate((id) => window.__app.loadTrack(id), id);
  await p.waitForFunction((id) => window.__app.track.id === id && !window.__app.loading, { timeout: 120000 }, id);
  const r = await p.evaluate(() => {
    const THREE = window.__THREE, app = window.__app, P = app.world.props, T = app.world.terrain, t = app.track;
    const out = {}; const m = new THREE.Matrix4(), v = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    // floors: the road and every non-instanced static mesh (decks, sidewalks, walls' tops are excluded by the 0.6 m start)
    const floors = []; app.renderer.scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.visible) { const gg = o.geometry; if (!gg.boundingSphere) gg.computeBoundingSphere(); if (gg.boundingSphere.radius < 3000 && !(T.group && T.group.children.includes(o))) floors.push(o); } });
    P.group.traverse((o) => {
      if (!o.isInstancedMesh || o === P.spectators?.shirts || o === P.spectators?.rest) return;
      o.geometry.computeBoundingBox();
      const baseOff = o.geometry.boundingBox.min.y; // geometry bottom relative to the instance origin
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const key = `${o.geometry.type.replace('Geometry', '')} #${mat.color?.getHexString()} (${o.count})`;
      let fl = 0, bu = 0, maxF = 0, maxB = 0, ex = [];
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); v.setFromMatrixPosition(m);
        const sy = new THREE.Vector3().setFromMatrixScale(m).y;
        const base = v.y + baseOff * sy;
        const F = 0.15;
        const g = Math.min(T.heightAt(v.x - F, v.z - F), T.heightAt(v.x + F, v.z - F), T.heightAt(v.x - F, v.z + F), T.heightAt(v.x + F, v.z + F));
        // independent surface: terrain, or whatever scene geometry (road, deck, sidewalk) lies just below the base
        ray.set(new THREE.Vector3(v.x, base + 0.6, v.z), new THREE.Vector3(0, -1, 0)); ray.far = 8;
        const hit = ray.intersectObjects(floors, false)[0];
        const surf = Math.max(g, hit ? hit.point.y : -1e9);
        const gap = base - surf;
        if (gap > 0.15) { fl++; maxF = Math.max(maxF, gap); if (ex.length < 3) ex.push(`(${v.x.toFixed(0)},${v.z.toFixed(0)}) +${gap.toFixed(2)}`); }
        if (gap < -0.3) { bu++; maxB = Math.min(maxB, gap); }
      }
      if (fl || bu) out[key] = { floating: fl, maxFloat: +maxF.toFixed(2), sunk: bu, maxSunk: +maxB.toFixed(2), ex };
    });
    return out;
  });
  console.log(`== ${id}`); for (const [k, v] of Object.entries(r)) console.log(`   ${k.padEnd(34)} floating ${v.floating} (max ${v.maxFloat}m)  sunk ${v.sunk} (max ${v.maxSunk}m)  e.g. ${v.ex.join(' ')}`);
  if (!Object.keys(r).length) console.log('   all instanced props sit on their surface');
}
await b.close();
