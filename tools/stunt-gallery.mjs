// Screenshots of several stunt levels (each its own sky course), ridden by the shared pilot.
// Usage: URL=http://localhost:5182/ node tools/stunt-gallery.mjs <outDir> [L01 L12 ...]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] || 'gallery';
const ids = process.argv.slice(3).length ? process.argv.slice(3) : ['L01', 'L09', 'L17', 'L24', 'L33', 'L41', 'L45', 'L50'];
mkdirSync(out, { recursive: true });
const url = process.env.URL || 'http://localhost:5182/';
const SHARED = '/@fs/' + encodeURI(fileURLToPath(new URL('../shared/', import.meta.url)).split('\\').join('/'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show'), { timeout: 180000 });
await page.evaluate((r) => (window.__sharedRoot = r), SHARED);
for (const id of ids) {
  await page.evaluate((id) => window.__app.startStunt(id), id);
  await page.waitForFunction((id) => window.__app.session?.level?.id === id, { timeout: 90000 }, id);
  await page.evaluate(async () => {
    window.__app.ui.hideControlsCard();
    const s = window.__app.session;
    const { StuntPilot, solveLevel } = await import(window.__sharedRoot + 'stunts/pilot.js');
    const plan = solveLevel(s.course, { tricks: false }).plan;
    const p = new StuntPilot(s.run, plan);
    window.__app.input.read = () => ({ ...p.input() });
  });
  await sleep(1500);
  await page.screenshot({ path: `${out}/${id}-start.png` });
  // a mid-course view: wait until the rider is near the first big feature
  await page.waitForFunction(() => {
    const s = window.__app.session;
    const f = s.course.features.find((x) => x.jump) || s.course.features[0];
    return s.run.bike.u > f.s0 - 25 || s.run.done;
  }, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => (window.__app.chase.distIndex = 2));
  await sleep(1300);
  await page.screenshot({ path: `${out}/${id}-feature.png` });
  const info = await page.evaluate(() => ({ track: window.__app.track.id, sky: window.__app.world.theme.name, world: window.__app.world.isStunt, meshes: window.__app.renderer.scene.getObjectByName('stunt-course')?.children.length }));
  console.log(id, JSON.stringify(info));
  await page.evaluate(() => {
    window.__app.chase.distIndex = 1;
    window.__app.input.read = window.__app.input.constructor.prototype.read.bind(window.__app.input);
  });
}
await page.evaluate(() => window.__app.quitToMenu('main'));
await page.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show') && !window.__app.world.isStunt, { timeout: 60000 });
await sleep(1500);
await page.screenshot({ path: `${out}/zz-back-to-racing.png` });
console.log('after leaving:', JSON.stringify(await page.evaluate(() => ({ track: window.__app.track.id, stuntWorld: !!window.__app.world.isStunt, stuntMeshes: !!window.__app.renderer.scene.getObjectByName('stunt-course'), demo: !!window.__app.demo }))));
console.log('errors', errors.length, errors.slice(0, 5));
await browser.close();
