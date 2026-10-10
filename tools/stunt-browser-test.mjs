// Browser test for stunt mode (desktop + phone viewports). Needs the client dev server.
//   URL=http://localhost:5182/ node tools/stunt-browser-test.mjs <outDir> [--mobile]
// Plays Level 1 start -> finish (the shared headless pilot drives the real in-game session),
// checks rewards/unlocks/persistence across a reload, launches one level of every tier,
// exercises the garage (locked bike can't be equipped, buy + equip, upgrade), missions,
// and that a normal race still starts and rides.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// the in-page pilot is the same shared module the game uses, served by Vite from the shared folder
const SHARED = '/@fs/' + encodeURI(fileURLToPath(new URL('../shared/', import.meta.url)).split('\\').join('/'));

const out = process.argv[2] || 'stunt-shots';
const mobile = process.argv.includes('--mobile');
mkdirSync(out, { recursive: true });
const url = process.env.URL || 'http://localhost:5182/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const results = [];
const ok = (cond, msg) => results.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`);

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
if (mobile) {
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2, isLandscape: true });
} else await page.setViewport({ width: 1366, height: 768 });
page.on('console', (m) => ['error'].includes(m.type()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
const shot = (n) => page.screenshot({ path: `${out}/${mobile ? 'm-' : ''}${n}.png` });
const click = async (sel) => {
  await page.waitForSelector(sel, { visible: true, timeout: 10000 });
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  if (mobile) await page.tap(sel);
  else await page.click(sel);
  await sleep(300);
};
const waitMenu = (name, t = 60000) => page.waitForFunction((n) => document.getElementById('menu-' + n)?.classList.contains('show'), { timeout: t }, name);

await page.goto(url, { waitUntil: 'domcontentloaded' });
await waitMenu('main', 180000);
await page.evaluate(() => {
  window.__app.settings.quality = 'low';
  window.__app.applySettings();
});
await sleep(800);
ok(await page.evaluate(() => !!document.getElementById('btn-stunt')), 'main menu has a Stunt Park entry');
await shot('01-main');

// ---------------- stunt hub ----------------
await click('#btn-stunt');
await waitMenu('stunt');
await sleep(400);
const hub = await page.evaluate(() => ({
  cards: document.querySelectorAll('#st-grid .lv-card').length,
  locked: document.querySelectorAll('#st-grid .lv-card.locked').length,
  tiers: document.querySelectorAll('#st-tiers .chip').length,
  playDisabled: document.getElementById('st-play')?.disabled,
}));
ok(hub.cards === 15 && hub.tiers === 4 && hub.locked === 14 && hub.playDisabled === false, `level grid: ${hub.cards} beginner cards, ${hub.tiers} tiers, ${hub.locked} locked, L1 playable`);
await shot('02-stunt-hub');
// a locked level: Play Solo disabled, unlock requirement shown
await click('#st-grid .lv-card[data-level="L05"]');
const lockedUi = await page.evaluate(() => ({ dis: document.getElementById('st-play').disabled, txt: document.querySelector('.ld-lock')?.textContent || '' }));
ok(lockedUi.dis && /Complete level 4/.test(lockedUi.txt), `locked level shows its unlock requirement (${lockedUi.txt.trim()})`);
// tiers switch
await click('#st-tiers .chip[data-tier="4"]');
ok(await page.evaluate(() => document.querySelectorAll('#st-grid .lv-card').length === 10), 'expert tier shows 10 levels');
await shot('03-expert-tier');
await click('#st-tiers .chip[data-tier="1"]');
await click('#st-grid .lv-card[data-level="L01"]');
const coins0 = await page.evaluate(() => window.__app.profile.stunt.coins);

// ---------------- Level 1: start -> finish ----------------
await click('#st-play');
await page.waitForFunction(() => window.__app.session?.isStunt && window.__app.session.phase === 'countdown', { timeout: 60000 });
await sleep(600);
await shot('04-L01-countdown');
// close the controls card, then let the shared pilot drive the real session
await page.evaluate(() => window.__app.ui.hideControlsCard());
await page.evaluate((root) => (window.__sharedRoot = root), SHARED);
const drive = await page.evaluate(async () => {
  const s = window.__app.session;
  // same module instance as the game (vite serves @shared from the shared folder)
  const { StuntPilot, chooseTrick } = await import(window.__sharedRoot + 'stunts/pilot.js');
  const p = new StuntPilot(s.run, s.course.features.map((f) => ({ v: f.designV })));
  // the solver's look-ahead restores cloned run state: keep the session's pose object attached
  p.chooser = (pl) => {
    const r = chooseTrick(pl);
    s.run.bike.trick = s.pose;
    return r;
  };
  window.__pilot = p;
  window.__app.input.read = () => {
    const i = p.input();
    return { ...i };
  };
  return true;
}).catch((e) => 'ERR ' + e.message);
results.push('INFO pilot hook: ' + drive);
await page.waitForFunction(() => window.__app.session?.phase === 'racing', { timeout: 20000 });
await sleep(4000);
await shot('05-L01-riding');
const midHud = await page.evaluate(() => ({ score: document.getElementById('sh-score').textContent, obj: document.querySelectorAll('#sh-obj li').length, hudVisible: getComputedStyle(document.getElementById('stunt-hud')).display !== 'none' }));
ok(midHud.hudVisible && midHud.obj >= 1, `stunt HUD visible with objectives (score ${midHud.score})`);
const midAir = await page.waitForFunction(() => window.__app.session?.run.state.T.air && window.__app.session.run.bike.airborne && (Math.abs(window.__app.session.run.state.T.pitch) > 1.6 || Math.abs(window.__app.session.run.state.T.spin) > 1.6), { timeout: 60000, polling: 16 }).then(() => true).catch(() => false);
if (midAir) await shot('05b-L01-trick-in-air');
ok(midAir, 'a flip/spin is visible mid-air in the real session');
await page.waitForFunction(() => document.getElementById('results').classList.contains('show'), { timeout: 120000 }).catch(() => {});
await sleep(1200);
await shot('06-L01-results');
const res = await page.evaluate(() => ({
  title: document.getElementById('res-title').textContent,
  stunt: document.getElementById('res-stunt').textContent,
  done: window.__app.profile.stunt.levels.L01?.done,
  stars: window.__app.profile.stunt.levels.L01?.stars,
  coins: window.__app.profile.stunt.coins,
  stats: window.__app.profile.stunt.stats,
}));
ok(res.done && /Level complete/.test(res.title), `Level 1 completed in the browser (${res.title}, ${res.stars}★)`);
ok(res.coins > coins0, `coins rewarded (${coins0} -> ${res.coins})`);
ok(res.stats.jumps >= 1 && res.stats.runs === 1, `lifetime stunt stats recorded (jumps ${res.stats.jumps})`);
const nextBtn = await page.evaluate(() => ({ goal: getComputedStyle(document.getElementById('btn-goal')).display !== 'none', label: document.getElementById('btn-goal').textContent }));
ok(nextBtn.goal && /Next level/.test(nextBtn.label), `results offer "Next level" (${nextBtn.label})`);

// replay: no duplicate first-completion reward
const coinsAfter1 = res.coins;
await page.evaluate(() => {
  window.__app.input.read = window.__app.input.constructor.prototype.read.bind(window.__app.input);
});
await click('#btn-rematch'); // Retry
await page.waitForFunction(() => window.__app.session?.isStunt && window.__app.session.phase === 'countdown', { timeout: 60000 });
await page.evaluate(async () => {
  window.__app.ui.hideControlsCard();
  const s = window.__app.session;
  const { StuntPilot } = await import(window.__sharedRoot + 'stunts/pilot.js');
  const p = new StuntPilot(s.run, s.course.features.map((f) => ({ v: f.designV })));
  window.__app.input.read = () => ({ ...p.input() });
});
await page.waitForFunction(() => document.getElementById('results').classList.contains('show'), { timeout: 120000 }).catch(() => {});
await sleep(800);
const replay = await page.evaluate(() => ({ coins: window.__app.profile.stunt.coins, lines: document.querySelector('.rs-coins')?.textContent || '' }));
ok(replay.coins - coinsAfter1 <= 40 && !/First completion/.test(replay.lines), `replay pays only the capped run bonus, no second first-completion reward (+${replay.coins - coinsAfter1})`);
await page.evaluate(() => {
  window.__app.input.read = window.__app.input.constructor.prototype.read.bind(window.__app.input);
});

// ---------------- persistence across reload ----------------
await page.reload({ waitUntil: 'domcontentloaded' });
await waitMenu('main', 180000);
await sleep(500);
const persisted = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('velorush.profile.v1'));
  return { done: p.stunt?.levels?.L01?.done, coins: p.stunt?.coins, v: p.stunt?.v, races: p.races };
});
ok(persisted.done && persisted.coins === replay.coins && persisted.v === 1, `stunt progress persists across reload (coins ${persisted.coins}, save v${persisted.v})`);
await click('#btn-stunt');
await waitMenu('stunt');
ok(await page.evaluate(() => !document.querySelector('#st-grid .lv-card[data-level="L02"]').classList.contains('locked')), 'Level 2 unlocked after completing Level 1 (after reload)');

// ---------------- garage ----------------
await click('[data-sttab="garage"]');
await sleep(1200);
await shot('07-stunt-garage');
const g0 = await page.evaluate(() => ({ bikes: document.querySelectorAll('#st-bikes .bike-item').length, cats: document.querySelectorAll('#st-cats .chip').length, riding: window.__app.profile.stunt.bikeId }));
ok(g0.cats === 6 && g0.bikes > 0, `garage: ${g0.cats} categories`);
// count all bikes across categories
const allBikes = await page.evaluate(async () => {
  let n = 0;
  const cats = [...document.querySelectorAll('#st-cats .chip')].map((c) => c.dataset.cat);
  for (const cat of cats) {
    document.querySelector(`#st-cats .chip[data-cat="${cat}"]`).click();
    await new Promise((r) => setTimeout(r, 60));
    n += document.querySelectorAll('#st-bikes .bike-item').length;
  }
  return n;
});
ok(allBikes === 34, `34 bikes listed across categories (${allBikes})`);
// select a locked BMX: shown but cannot be equipped
await click('#st-cats .chip[data-cat="bmx"]');
await click('#st-bikes .bike-item[data-sbike="bmx_legend"]');
const lockedBike = await page.evaluate(() => ({ riding: window.__app.profile.stunt.bikeId, buyDisabled: document.querySelector('[data-buy="bmx_legend"]')?.disabled, req: document.querySelector('#st-bike-act .ld-lock')?.textContent || '' }));
ok(lockedBike.riding === g0.riding && lockedBike.buyDisabled && /level 40/.test(lockedBike.req), `selecting a locked bike does not equip it (${lockedBike.req.trim()})`);
await shot('08-locked-bike');
// earn enough coins (simulated reward) then buy + equip an unlockable bike
await page.evaluate(() => {
  window.__app.profile.stunt.coins += 500;
});
await click('#st-bikes .bike-item[data-sbike="bmx_rookie"]');
await click('[data-buy="bmx_rookie"]');
const bought = await page.evaluate(() => ({ owned: window.__app.profile.stunt.owned.includes('bmx_rookie'), riding: window.__app.profile.stunt.bikeId, coins: window.__app.profile.stunt.coins }));
ok(bought.owned && bought.riding === 'bmx_rookie', `buy + equip bmx_rookie (coins left ${bought.coins})`);
await sleep(800);
await shot('09-bmx-equipped');
// upgrade
await page.evaluate(() => (window.__app.profile.stunt.coins += 200));
await page.evaluate(() => window.__app.ui.stunt.render());
await click('[data-upg="rot"]');
ok(await page.evaluate(() => window.__app.profile.stunt.upgrades.rot === 1), 'rotation upgrade bought (level 1)');

// ---------------- missions ----------------
await click('[data-sttab="missions"]');
await sleep(300);
await shot('10-missions');
const ms = await page.evaluate(() => ({ missions: document.querySelectorAll('#st-mission-list .mission').length, ach: document.querySelectorAll('#st-ach-list .ach.got').length }));
ok(ms.missions === 3 && ms.ach >= 1, `3 active missions, ${ms.ach} achievements unlocked by real events`);

// ---------------- one level per tier launches (with the equipped BMX) ----------------
for (const id of ['L16', 'L31', 'L41']) {
  await page.evaluate((id) => window.__app.startStunt(id, { source: 'test' }), id);
  await page.waitForFunction((id) => window.__app.session?.isStunt && window.__app.session.level.id === id, { timeout: 90000 }, id);
  await page.evaluate(() => window.__app.ui.hideControlsCard());
  await page.waitForFunction(() => window.__app.session?.phase === 'racing', { timeout: 20000 });
  // hold pedal for a moment
  await page.evaluate(() => {
    window.__app.input.keys.add('up');
  });
  await sleep(2500);
  const st = await page.evaluate(() => ({ v: window.__app.session.run.bike.v, map: window.__app.track.id, feats: window.__app.world.courseView.group.children.length, sky: window.__app.world.theme.name, bike: window.__app.session.bikeId }));
  await page.evaluate(() => window.__app.input.keys.delete('up'));
  ok(st.v > 3 && st.feats > 3, `${id} launches on its own sky course ${st.map} (${st.sky}) and rides (${(st.v * 3.6).toFixed(0)} km/h, ${st.feats} course meshes, bike ${st.bike})`);
  await shot(`11-${id}`);
}
// quit to the stunt menu via pause
await page.evaluate(() => window.__app.togglePause(true));
await sleep(300);
await click('#btn-quit');
await waitMenu('stunt', 20000);
ok(await page.evaluate(() => !document.body.classList.contains('stunt-mode') && !window.__app.scene?.getObjectByName?.('stunt-course')), 'quitting returns to Stunt Park and removes the course');
ok(await page.evaluate(() => !window.__app.renderer.scene.getObjectByName('stunt-course') && !window.__app.world.isStunt && !window.__app.track.id.startsWith('sky-') && !!window.__app.world.terrain?.build), 'leaving stunt mode disposes the sky course and restores the racing map world');

// ---------------- normal racing still works (original bike) ----------------
await page.evaluate(() => window.__app.startLocal({ mode: 'quick', laps: 1, ai: 3, skill: 'easy', track: 'mountain' }));
await page.waitForFunction(() => window.__app.session && !window.__app.session.isStunt && window.__app.session.phase === 'countdown', { timeout: 90000 });
await page.evaluate(() => window.__app.ui.hideControlsCard());
await page.waitForFunction(() => window.__app.session?.phase === 'racing', { timeout: 20000 });
await page.evaluate(() => window.__app.input.keys.add('up'));
await sleep(3500);
const race = await page.evaluate(() => ({ v: window.__app.session.player.bike.v, bike: window.__app.session.player.bikeId, n: window.__app.session.race.racers.length, stuntClass: document.body.classList.contains('stunt-mode'), hudStunt: getComputedStyle(document.getElementById('stunt-hud')).display }));
await page.evaluate(() => window.__app.input.keys.delete('up'));
ok(race.v > 5 && ['allround', 'aero', 'climber', 'sprint'].includes(race.bike) && !race.stuntClass && race.hudStunt === 'none', `normal quick race rides on an original bike (${race.bike}, ${(race.v * 3.6).toFixed(0)} km/h, ${race.n} riders, stunt HUD hidden)`);
await shot('12-normal-race');
await page.evaluate(() => window.__app.quitToMenu());
await waitMenu('main', 20000);

const bad = errors.filter((e) => !/favicon|manifest|WebSocket|ERR_CONNECTION|net::/.test(e));
ok(bad.length === 0, `no page errors (${bad.length})`);
for (const e of bad.slice(0, 10)) results.push('  ERR ' + e);
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
