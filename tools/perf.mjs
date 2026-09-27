// Dev tool: measure draw calls / triangles / FPS at 1080p High in a few track sections.
// Requires the client dev server on :5173. Usage: node tools/perf.mjs
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1920, height: 1080 } });
const page = await browser.newPage();
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show'), { timeout: 120000 });
await page.evaluate(() => { const a = window.__app; a.settings.quality = 'high'; a.settings.showFps = true; a.applySettings(); a.startLocal({ mode: 'ai', laps: 1, ai: 7, skill: 'hard' }); });
await new Promise((r) => setTimeout(r, 6000));
await page.keyboard.down('KeyW');
const sample = async (label) => {
  await new Promise((r) => setTimeout(r, 2500));
  const r = await page.evaluate(() => {
    const R = window.__app.renderer.renderer;
    R.info.autoReset = false; R.info.reset();
    R.render(window.__app.renderer.scene, window.__app.renderer.camera);
    const o = { calls: R.info.render.calls, tris: R.info.render.triangles, geos: R.info.memory.geometries, tex: R.info.memory.textures, fps: document.getElementById('fps').textContent };
    R.info.autoReset = true; return o;
  });
  console.log(label, JSON.stringify(r));
};
await sample('village 1080p high');
await page.evaluate(() => { const s = window.__app.session, t = window.__app.track, b = s.player.bike; b.u = 1840; b.s = t.wrap(b.u); b.y = t.sample(b.s).y; b.yaw = t.sample(b.s).head; b.d = 0; });
await sample('forest 1080p high');
await page.evaluate(() => { const s = window.__app.session, t = window.__app.track, b = s.player.bike; b.u = 600; b.s = t.wrap(b.u); b.y = t.sample(b.s).y; b.yaw = t.sample(b.s).head; b.d = 0; });
await sample('hairpins 1080p high');
await browser.close();
