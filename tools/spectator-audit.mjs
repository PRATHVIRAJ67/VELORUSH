// Dev audit: every spectator's foot height vs the drawn surface under it (floating / sunk / inside a checkpoint arch).
// Usage: node tools/spectator-audit.mjs <mapId>   (client dev server; URL env to override)
import puppeteer from 'puppeteer-core';
const id = process.argv[2] || 'canyon';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 600000, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 800, height: 450 });
await p.goto(process.env.URL || 'http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show') && window.__THREE, { timeout: 180000 });
await p.evaluate((id) => window.__app.loadTrack(id), id);
await p.waitForFunction((id) => window.__app.track.id === id && !window.__app.loading, { timeout: 120000 }, id);
const r = await p.evaluate(() => {
  const THREE = window.__THREE, app = window.__app, P = app.world.props, T = app.world.terrain, t = app.track;
  app.stopDemo();
  const scene = app.renderer.scene; scene.updateMatrixWorld(true);
  const sp = P.spectators.spots;
  // ground candidates: every static mesh except the crowd itself and tiny props
  const targets = [];
  scene.traverse((o) => { if ((o.isMesh) && o.visible && o !== P.spectators.shirts && o !== P.spectators.rest) { const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); if (g.boundingSphere.radius < 3000) targets.push(o); } });
  const ray = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
  const rows = [];
  for (const s of sp) {
    ray.set(new THREE.Vector3(s.x, s.y + 6, s.z), down); ray.far = 20;
    const hit = ray.intersectObjects(targets, false)[0];
    const terr = T.heightAt(s.x, s.z);
    const road = t.sample(s.s).y;
    let dd = null, size = null;
    if (hit) { const bx = new THREE.Box3().setFromObject(hit.object); const sz = bx.getSize(new THREE.Vector3()); size = sz.x < 60 && sz.z < 60 ? `${sz.x.toFixed(1)}x${sz.y.toFixed(1)}x${sz.z.toFixed(1)}` : 'large'; }
    { const c = t.sample(s.s); dd = +((-(s.x - c.x) * c.hz + (s.z - c.z) * c.hx)).toFixed(1); }
    rows.push({ d: dd, size, s: Math.round(s.s), gap: hit ? +(s.y - hit.point.y).toFixed(2) : null, terrGap: +(s.y - terr).toFixed(2), roadMinus: +(s.y - road).toFixed(2), what: hit ? hit.object.geometry.type + (hit.object.material?.color ? ' #' + hit.object.material.color.getHexString() : '') : 'none' });
  }
  const floating = rows.filter((x) => x.gap !== null && x.gap > 0.15);
  const buried = rows.filter((x) => x.gap !== null && x.gap < -0.15);
  const by = (arr) => { const m = {}; for (const x of arr) m[x.what] = (m[x.what] || 0) + 1; return m; };
  const hist = { 'ok(<=0.15)': rows.filter((x) => x.gap !== null && Math.abs(x.gap) <= 0.15).length, '0.15-0.5': rows.filter((x) => x.gap > 0.15 && x.gap <= 0.5).length, '0.5-1': rows.filter((x) => x.gap > 0.5 && x.gap <= 1).length, '>1': rows.filter((x) => x.gap > 1).length, 'buried(<-0.15)': rows.filter((x) => x.gap !== null && x.gap < -0.15 && !/Torus/.test(x.what)).length, maxFloat: Math.max(...rows.map((x) => x.gap ?? 0)), maxBury: Math.min(...rows.filter((x) => !/Torus/.test(x.what)).map((x) => x.gap ?? 0)), 'insideArch': rows.filter((x) => /Torus/.test(x.what)).length, 'noGround': rows.filter((x) => x.gap === null).length };
  return { hist, n: rows.length, floating: floating.length, buried: buried.length, floatWhat: by(floating), buryWhat: by(buried), floatEx: floating.sort((a, b) => b.gap - a.gap).slice(0, 8), buryEx: buried.sort((a, b) => a.gap - b.gap).slice(0, 8), floatTerrGap: floating.slice(0, 8).map((x) => x.terrGap + '/' + x.roadMinus) };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
