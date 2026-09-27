// Dev tool: two browser windows play a multiplayer race together.
// Requires: client dev server (5173) + game server (8080). Usage: node tools/mp-shot.mjs <outDir>
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'mpshots';
mkdirSync(out, { recursive: true });
const url = process.env.URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
process.on('exit', () => {
  console.log('--- console errors/warnings ---');
  console.log(errors.slice(0, 30).join('\n') || '(none)');
});

async function open(name) {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=960,540'],
    defaultViewport: { width: 960, height: 540 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name} pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show'), { timeout: 120000 });
  await page.evaluate((n) => {
    window.__app.profile.name = n;
    window.__app.settings.quality = 'low';
    window.__app.applySettings();
  }, name);
  return { browser, page, name };
}

const A = await open('Hostess');
const B = await open('Guest');
await A.page.click('[data-go="mp"]');
await B.page.click('[data-go="mp"]');
await sleep(1200);
console.log('A status:', await A.page.$eval('#net-status span', (e) => e.textContent));
await A.page.click('#btn-create');
await A.page.waitForFunction(() => document.getElementById('menu-lobby').classList.contains('show'), { timeout: 5000 });
const code = await A.page.$eval('#lobby-code', (e) => e.textContent);
console.log('room code', code);
await B.page.type('#mp-code', code);
await B.page.click('#btn-join');
await B.page.waitForFunction(() => document.getElementById('menu-lobby').classList.contains('show'), { timeout: 5000 });
await sleep(500);
await A.page.select('#lobby-track', 'coast');
await sleep(300);
await A.page.select('#lobby-weather', 'cloudy');
await sleep(300);
await A.page.click('#btn-ready');
await B.page.click('#btn-ready');
await sleep(600);
await A.page.screenshot({ path: `${out}/lobbyA.png` });
await A.page.click('#btn-host-start');
await sleep(9000);
await B.page.screenshot({ path: `${out}/countdownB.png` });
await sleep(2600);
await A.page.keyboard.down('KeyW');
await B.page.keyboard.down('KeyW');
await sleep(6000);
await A.page.screenshot({ path: `${out}/raceA.png` });
await B.page.screenshot({ path: `${out}/raceB.png` });
const info = async (p) =>
  p.evaluate(() => {
    const s = window.__app.session;
    return { me: s.me && { u: s.me.bike.u.toFixed(1), place: s.me.place }, remotes: [...s.remotes.values()].map((r) => ({ n: r.name, u: r.st.u.toFixed(1), buf: r.buf.length })), rtt: window.__app.net.rtt.toFixed(1), weather: window.__app.world.weather.kind, map: window.__app.track.id, kmh: s.me && Math.round(s.me.bike.v * 3.6) };
  });
console.log('A', JSON.stringify(await info(A.page)));
console.log('B', JSON.stringify(await info(B.page)));
await A.browser.close();
await B.browser.close();
