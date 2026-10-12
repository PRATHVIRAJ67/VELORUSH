// Checkpoint scenery audit: every checkpoint arch (legs + tube), the traffic lights 33 m before it
// (City Night) and the flag 6 m after it must stand clear of roadside buildings, lamps and trees.
// Raycasts the real built map in the browser. Needs the client dev server.
//   URL=http://localhost:5173/ node tools/checkpoint-audit.mjs [mapId] [--try=s1,s2,...]
// --try checks candidate checkpoint positions (m along the road) instead of the map's own.
import puppeteer from 'puppeteer-core';

const map = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'city';
const tryArg = process.argv.find((a) => a.startsWith('--try='));
const candidates = tryArg ? tryArg.slice(6).split(',').map(Number) : null;
const url = process.env.URL || 'http://localhost:5173/';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 1200000, args: ['--use-angle=d3d11'] });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show'), { timeout: 180000 });
await page.evaluate((m) => window.__app.loadTrack(m), map);
await page.waitForFunction((m) => window.__app.track?.id === m && window.__app.world?.props, { timeout: 120000 }, map);
const rows = await page.evaluate(async (candidates) => {
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /deps\/three\.js/.test(n));
  const THREE = await import(url);
  const app = window.__app;
  const t = app.track;
  const props = app.world.props;
  const W = props.W;
  // solid scenery: everything static except the arches/banners themselves, decals and riders
  const solids = [];
  props.group.traverse((o) => {
    if (!o.isMesh || o.geometry.type === 'TorusGeometry' || o.geometry.type === 'PlaneGeometry') return;
    const m = [o.material].flat()[0];
    if (m.transparent || m.blending === THREE.AdditiveBlending) return;
    solids.push(o);
  });
  const facades = solids.filter((o) => { const m = [o.material].flat()[0]; return m.emissiveMap && m.map?.image?.width === 256; });
  const saved = new Map();
  for (const o of solids) for (const m of [o.material].flat()) if (!saved.has(m)) { saved.set(m, m.side); m.side = THREE.DoubleSide; }
  const rc = new THREE.Raycaster();
  const ray = (s, d0, side, y, far, list) => {
    const a = t.toWorld(s, d0);
    const b = t.toWorld(s, d0 + side);
    rc.set(new THREE.Vector3(a.x, a.y + y, a.z), new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize());
    rc.far = far;
    return rc.intersectObjects(list, false)[0] || null;
  };
  const R = W + 0.9; // arch torus radius; tube radius 0.6
  const cps = candidates || t.checkpoints;
  const out = [];
  for (const cp of cps) {
    const row = { cp: +cp.toFixed(2) };
    // arch: from the road centre outward, at heights up the legs; anything closer than the arch's outer edge
    let arch = Infinity;
    let archWhat = '';
    for (const side of [-1, 1]) for (const ds of [-0.8, 0, 0.8]) for (const y of [0.3, 1.5, 3, 4.5, 6, 7.5]) {
      if (y >= R) continue;
      const h = ray(cp + ds, 0, side, y, 16, solids);
      if (!h) continue;
      const reach = Math.sqrt(R * R - y * y) + 0.6;
      const gap = h.distance - reach;
      if (gap < arch) {
        arch = gap;
        const m = [h.object.material].flat()[0];
        archWhat = `${side > 0 ? 'R' : 'L'} ${h.object.isInstancedMesh ? 'inst ' : ''}${h.object.geometry.type} #${m.color?.getHexString()}`;
      }
    }
    row.arch = arch === Infinity ? 'clear' : +arch.toFixed(2);
    row.archHit = archWhat;
    // flag 6 m after the arch (Props: side by cp % 2), pole at W + 2.5: no wall between road and pole
    const fs = cp + 6;
    const fside = cp % 2 ? 1 : -1;
    const fw = ray(fs, 0, fside, 2.5, W + 2.6, facades);
    row.flagInWall = fw ? +(W + 2.5 - fw.distance).toFixed(2) : 0;
    // City Night: zebra + traffic lights 30 m before (poles at -33 m, W + 0.9 both sides, skipped on bends)
    if (t.def.id === 'city') {
      const ls = cp - 30;
      if (Math.abs(t.CURV[t.idx(t.wrap(ls))]) > 0.01) row.lights = 'none (bend)';
      else {
        let worst = 0;
        for (const side of [-1, 1]) {
          const h = ray(ls - 3, 0, side, 1.5, W + 1.0, facades);
          if (h) worst = Math.max(worst, W + 0.9 - h.distance);
        }
        row.lightsInWall = +worst.toFixed(2);
      }
    }
    out.push(row);
  }
  for (const [m, s] of saved) m.side = s;
  return out;
}, candidates);
let bad = 0;
for (const r of rows) {
  const ok = (r.arch === 'clear' || r.arch >= 0.1) && r.flagInWall <= 0 && !(r.lightsInWall > 0);
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'BAD '} ${JSON.stringify(r)}`);
}
console.log(`${rows.length - bad}/${rows.length} checkpoints clear on ${map}`);
await browser.close();
process.exit(bad ? 1 : 0);
