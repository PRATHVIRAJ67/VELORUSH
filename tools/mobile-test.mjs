// Mobile walkthrough: emulated phone (landscape, touch, DPR 3). Taps through every screen,
// checks touch scrolling, plays a race with the on-screen controls and reaches results.
// Usage: node tools/mobile-test.mjs <outDir>   (client dev server on :5173)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'mobile';
mkdirSync(out, { recursive: true });
const url = process.env.URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const results = [];
const ok = (cond, msg) => results.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`);

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 3, isLandscape: true });
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const tap = async (sel) => {
  await page.waitForSelector(sel, { visible: true, timeout: 8000 });
  await page.tap(sel);
  await sleep(350);
};
/** Drag the menu with a finger and report whether it scrolled. */
const swipeScroll = async (menuSel) =>
  page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    return { scrollable: el.scrollHeight > el.clientHeight + 4, top: el.scrollTop, h: el.scrollHeight, ch: el.clientHeight };
  }, menuSel);
const touchSwipe = async (x, y0, y1) => {
  await page.touchscreen.touchStart(x, y0);
  for (let i = 1; i <= 8; i++) await page.touchscreen.touchMove(x, y0 + ((y1 - y0) * i) / 8);
  await page.touchscreen.touchEnd();
  await sleep(400);
};

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show'), { timeout: 180000 });
await sleep(1200);
const dev = await page.evaluate(() => ({ quality: window.__app.settings.quality, touchOn: document.body.classList.contains('touch-on'), mobile: document.body.classList.contains('mobile'), dpr: window.__app.renderer.renderer.getPixelRatio() }));
results.push(`INFO device ${JSON.stringify(dev)}`);
await shot('01-main');

// ---- play menu: every map reachable + Race button reachable by touch scrolling ----
await tap('[data-go="play"]');
await shot('02-play');
let sc = await swipeScroll('#menu-play');
results.push(`INFO play menu ${JSON.stringify(sc)}`);
await touchSwipe(600, 330, 60);
const sc2 = await swipeScroll('#menu-play');
ok(!sc.scrollable || sc2.top > sc.top, 'play menu scrolls with a finger');
await shot('03-play-scrolled');
for (const id of ['mountain', 'alpine', 'coast', 'forest', 'canyon', 'city']) {
  await page.evaluate((id) => document.querySelector(`.map-card[data-track="${id}"]`).scrollIntoView({ block: 'center' }), id);
  await sleep(150);
  await tap(`.map-card[data-track="${id}"]`);
}
ok(await page.evaluate(() => window.__app.ui.selTrack === 'city'), 'all six map cards selectable by tap');
await tap('.mode-card[data-mode="timetrial"]');
await tap('.mode-card[data-mode="quick"]');
await page.evaluate(() => document.getElementById('btn-start-race').scrollIntoView({ block: 'center' }));
await page.evaluate(() => document.querySelector('.map-card[data-track="coast"]').click());
ok(await page.evaluate(() => {
  const r = document.getElementById('btn-start-race').getBoundingClientRect();
  return r.bottom <= innerHeight && r.top >= 0;
}), 'Race! button reachable on screen');
await page.evaluate(() => document.querySelector('[data-go="main"]').scrollIntoView({ block: 'center' }));
await tap('#menu-play [data-go="main"]');

// ---- garage ----
await tap('[data-go="garage"]');
await sleep(1500);
await shot('04-garage');
await page.evaluate(() => document.querySelector('.bike-item[data-bike="aero"]').scrollIntoView({ block: 'center' }));
await tap('.bike-item[data-bike="aero"]');
await page.evaluate(() => document.querySelector('#sw-frame .sw:nth-child(4)').scrollIntoView({ block: 'center' }));
await tap('#sw-frame .sw:nth-child(4)');
await page.evaluate(() => document.querySelector('.chip[data-outfit="polka"]').scrollIntoView({ block: 'center' }));
await tap('.chip[data-outfit="polka"]');
ok(await page.evaluate(() => window.__app.profile.bikeId === 'aero' && window.__app.profile.outfit === 'polka'), 'garage bike/colour/outfit by tap');
const sw = await page.evaluate(() => document.querySelector('#sw-frame .sw').getBoundingClientRect().width);
ok(sw >= 36, `colour swatches are finger-sized (${Math.round(sw)} px)`);
await shot('05-garage-edited');
await page.evaluate(() => document.querySelector('#menu-garage [data-go="main"]').scrollIntoView({ block: 'center' }));
await tap('#menu-garage [data-go="main"]');

// ---- settings ----
await tap('[data-go="settings"]');
await shot('06-settings');
await page.evaluate(() => document.getElementById('btn-settings-back').scrollIntoView({ block: 'center' }));
await tap('#btn-settings-back');

// ---- multiplayer screen ----
await tap('[data-go="mp"]');
await sleep(800);
await shot('07-mp');
await page.evaluate(() => document.querySelector('#menu-mp [data-go="main"]').scrollIntoView({ block: 'center' }));
await tap('#menu-mp [data-go="main"]');

// ---- race with touch controls ----
await tap('[data-go="play"]');
await page.evaluate(() => document.querySelector('.map-card[data-track="alpine"]').scrollIntoView({ block: 'center' }));
await tap('.map-card[data-track="alpine"]');
await page.evaluate(() => document.getElementById('btn-start-race').scrollIntoView({ block: 'center' }));
await tap('#btn-start-race');
await page.waitForFunction(() => window.__app.session && window.__app.session.phase === 'racing', { timeout: 60000 });
ok(await page.evaluate(() => document.getElementById('touch').classList.contains('show')), 'touch controls visible in race');
const btnPos = async (t) => page.evaluate((t) => {
  const r = document.querySelector(`[data-t="${t}"]`).getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, t);
// hold PEDAL (finger 1) and steer with a second finger
const pedal = await btnPos('pedal');
await page.touchscreen.touchStart(pedal.x, pedal.y);
await sleep(4000);
const v1 = await page.evaluate(() => window.__app.session.player.bike.v * 3.6);
ok(v1 > 25, `PEDAL accelerates (${Math.round(v1)} km/h)`);
await shot('08-race');
await page.touchscreen.touchEnd();
for (const t of ['sprint', 'boost', 'brake', 'left', 'right']) {
  const p = await btnPos(t);
  await page.touchscreen.touchStart(p.x, p.y);
  await sleep(t === 'brake' ? 700 : 400);
  await page.touchscreen.touchEnd();
}
ok(await page.evaluate(() => window.__app.session.player.bike.boostCooldown > 0 || window.__app.session.player.bike.stamina < 100), 'SPRINT/BOOST buttons act on the bike');
const hasReset = await page.$('[data-t="reset"]');
const hasCam = await page.$('[data-t="camera"]');
ok(!!hasReset && !!hasCam, 'touch buttons exist for Reset (R) and Camera (C)');
if (hasCam) {
  const before = await page.evaluate(() => window.__app.chase.distIndex);
  const p = await btnPos('camera');
  await page.touchscreen.tap(p.x, p.y);
  await sleep(300);
  ok((await page.evaluate(() => window.__app.chase.distIndex)) !== before, 'camera button cycles distance');
}
if (hasReset) {
  await page.evaluate(() => (window.__app.session.player.bike.v = 10));
  const p = await btnPos('reset');
  await page.touchscreen.tap(p.x, p.y);
  await sleep(300);
  ok(await page.evaluate(() => window.__app.session.player.bike.resetCooldown > 0), 'reset button resets the bike');
}
// pause via on-screen button
await tap('#btn-pause');
ok(await page.evaluate(() => document.getElementById('pause').classList.contains('show')), 'pause button opens pause menu');
await shot('09-pause');
await tap('#btn-resume');
// finish: walk the rider to the line (checkpoints passed legitimately)
await page.evaluate(() => {
  const s = window.__app.session;
  const t = window.__app.track;
  const b = s.player.bike;
  for (let u = b.u; u < t.length - 40; u += 5) {
    b.u = u;
    s.race.checkProgress(s.player);
  }
  b.s = t.wrap(b.u);
  b.d = 0;
  b.yaw = t.sample(b.s).head;
  b.y = t.sample(b.s).y;
  b.v = 15;
});
await page.touchscreen.touchStart(pedal.x, pedal.y);
await page.waitForFunction(() => document.getElementById('results').classList.contains('show'), { timeout: 30000 }).catch(() => {});
await page.touchscreen.touchEnd();
ok(await page.evaluate(() => document.getElementById('results').classList.contains('show')), 'finish → results screen');
await sleep(1500);
await shot('10-results');
const rb = await page.evaluate(() => {
  const r = document.getElementById('btn-rematch').getBoundingClientRect();
  return r.bottom <= innerHeight + 1 && r.top >= 0;
});
ok(rb, 'Rematch button visible on screen');
await page.evaluate(() => document.getElementById('btn-rematch').scrollIntoView({ block: 'center' }));
await tap('#btn-rematch');
await page.waitForFunction(() => window.__app.session && window.__app.session.phase === 'countdown', { timeout: 30000 }).catch(() => {});
ok(await page.evaluate(() => window.__app.session?.phase === 'countdown' || window.__app.session?.phase === 'racing'), 'Rematch restarts the race');
await sleep(5000);
const fps = await page.evaluate(() => document.getElementById('fps').textContent);
results.push(`INFO fps ${fps}`);
await shot('11-rematch');

console.log(results.join('\n'));
console.log('--- console errors/warnings ---\n' + (errors.slice(0, 20).join('\n') || '(none)'));
await browser.close();
