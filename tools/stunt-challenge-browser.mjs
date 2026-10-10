// Two real browser clients (desktop host + phone friend, separate storage) play stunt
// challenges through the real server: challenge on Level 1, then on a level locked for the
// friend, scores/ranking on both screens, rematch to the lobby, leave. Verifies the friend gets no
// permanent unlock. Needs the dev servers: URL=http://localhost:5182/ (client pointed at the server).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] || 'challenge-shots';
mkdirSync(out, { recursive: true });
const url = process.env.URL || 'http://localhost:5182/';
const SHARED = '/@fs/' + encodeURI(fileURLToPath(new URL('../shared/', import.meta.url)).split('\\').join('/'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const errors = [];
const ok = (c, m) => results.push(`${c ? 'PASS' : 'FAIL'} ${m}`);

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ca = await browser.createBrowserContext();
const cb = await browser.createBrowserContext();
const A = await ca.newPage();
const B = await cb.newPage();
await A.setViewport({ width: 1280, height: 720 });
await B.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
await B.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2, isLandscape: true });
for (const [n, p] of [['A', A], ['B', B]]) {
  p.on('pageerror', (e) => errors.push(n + ' pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/WebSocket|net::|favicon/.test(m.text()) && errors.push(n + ' ' + m.text()));
}
// host has progressed to level 5 (levels 1-4 done); friend is brand new
await A.evaluateOnNewDocument(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  const done = { done: true, stars: 1, best: 3000, bestTime: 20, paid: { complete: true } };
  localStorage.setItem('velorush.profile.v1', JSON.stringify({ name: 'HostPC', stunt: { v: 1, coins: 500, levels: { L01: done, L02: done, L03: done, L04: done } } }));
});
await B.evaluateOnNewDocument(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('velorush.profile.v1', JSON.stringify({ name: 'FriendPhone' }));
});
for (const p of [A, B]) await p.goto(url, { waitUntil: 'domcontentloaded' });
for (const p of [A, B]) {
  await p.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show'), { timeout: 180000 });
  await p.evaluate((root) => {
    window.__sharedRoot = root;
    window.__app.settings.quality = 'low';
    window.__app.applySettings();
  }, SHARED);
}
const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });
const inLobby = (p) => p.waitForFunction(() => document.getElementById('menu-lobby').classList.contains('show'), { timeout: 30000 });
// in-page pilot drives whatever stunt session is running
const autopilot = (p) =>
  p.evaluate(async () => {
    const { StuntPilot, chooseTrick } = await import(window.__sharedRoot + 'stunts/pilot.js');
    const s = window.__app.session;
    const pilot = new StuntPilot(s.run, s.course.features.map((f) => ({ v: f.designV })));
    pilot.chooser = (pl) => {
      const r = chooseTrick(pl);
      s.run.bike.trick = s.pose;
      return r;
    };
    window.__app.input.read = () => ({ ...pilot.input() });
  });
const manual = (p) => p.evaluate(() => (window.__app.input.read = window.__app.input.constructor.prototype.read.bind(window.__app.input)));

// ---- host: Stunt Park -> L01 -> Challenge Friends ----
await A.click('#btn-stunt');
await A.waitForSelector('#st-grid .lv-card[data-level="L01"]', { visible: true });
await A.click('#st-grid .lv-card[data-level="L01"]');
await A.click('#st-challenge');
await inLobby(A);
await sleep(600);
const code = await A.evaluate(() => document.getElementById('lobby-code').textContent);
const lobA = await A.evaluate(() => ({ kind: document.getElementById('lobby-kind').textContent, lvl: document.getElementById('lobby-level').value, stuntBox: getComputedStyle(document.getElementById('lobby-stunt')).display }));
ok(/STUNT/.test(lobA.kind) && lobA.lvl === 'L01' && lobA.stuntBox !== 'none', `host lobby: stunt challenge L01, code ${code}`);
await shot(A, '01-host-lobby');

// ---- friend joins by code from the Multiplayer screen (phone) ----
await B.tap('[data-go="mp"]');
await sleep(800);
await B.evaluate((c) => {
  const i = document.getElementById('mp-code');
  i.value = c;
  i.dispatchEvent(new Event('input'));
}, code);
await B.evaluate(() => document.getElementById('btn-join').scrollIntoView({ block: 'center' }));
await B.tap('#btn-join');
await inLobby(B);
await sleep(800);
const lobB = await B.evaluate(() => ({ lvl: document.getElementById('lobby-level').value, players: document.querySelectorAll('#lobby-players li').length, dis: document.getElementById('lobby-level').disabled }));
ok(lobB.lvl === 'L01' && lobB.players === 2 && lobB.dis, `friend joined by code, sees L01, cannot change the level (${lobB.players} riders)`);
await shot(B, '02-friend-lobby');

async function rideChallenge(level, tag) {
  await A.click('#btn-ready');
  await B.evaluate(() => document.getElementById('btn-ready').click());
  await sleep(500);
  await A.click('#btn-host-start');
  for (const p of [A, B]) await p.waitForFunction((l) => window.__app.session?.isStunt && window.__app.session.isNet && window.__app.session.level.id === l, { timeout: 90000 }, level);
  const same = await Promise.all([A, B].map((p) => p.evaluate(() => ({ lvl: window.__app.session.level.id, map: window.__app.track.id, remotes: window.__app.session.remotes.size }))));
  ok(same[0].lvl === level && same[1].lvl === level && same[0].map === same[1].map && same[0].remotes === 1 && same[1].remotes === 1, `${tag}: same level ${level} on ${same[0].map} loaded for both, each sees the other rider`);
  for (const p of [A, B]) await p.waitForFunction(() => window.__app.session?.phase === 'racing' || window.__app.session?.run.state.time > -0.5, { timeout: 30000 });
  await Promise.all([autopilot(A), autopilot(B)]);
  await sleep(6000);
  await shot(A, `03-${tag}-host-riding`);
  await shot(B, `04-${tag}-friend-riding`);
  for (const p of [A, B]) await p.waitForFunction(() => document.getElementById('results').classList.contains('show') && /official/.test(document.getElementById('res-sub').textContent), { timeout: 150000 }).catch(() => {});
  await sleep(800);
  const res = await Promise.all([A, B].map((p) => p.evaluate(() => ({ head: document.getElementById('res-head').textContent, rows: [...document.querySelectorAll('#res-body tr')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()), sub: document.getElementById('res-sub').textContent }))));
  ok(res[0].rows.length === 2 && /Score/.test(res[0].head) && JSON.stringify(res[0].rows) === JSON.stringify(res[1].rows), `${tag}: official ranking by score identical on both screens: ${res[0].rows.join(' | ')}`);
  await shot(A, `05-${tag}-host-results`);
  await shot(B, `06-${tag}-friend-results`);
  for (const p of [A, B]) await manual(p);
}

await rideChallenge('L01', 'L01');
const bLevels1 = await B.evaluate(() => JSON.stringify(window.__app.profile.stunt?.levels || {}));
const bCoins1 = await B.evaluate(() => window.__app.profile.stunt?.coins || 0);
ok(bLevels1 === '{}' && bCoins1 > 0, `friend: challenge coins credited (${bCoins1}) but no level progress written`);

// ---- rematch -> lobby, host picks L05 (locked for the friend) ----
await A.click('#btn-rematch');
await B.evaluate(() => document.getElementById('btn-rematch').click());
await inLobby(A);
await inLobby(B);
await A.select('#lobby-level', 'L05');
await sleep(800);
const lock = await B.evaluate(() => ({ lvl: document.getElementById('lobby-level').value, info: document.getElementById('lobby-stunt-info').textContent }));
ok(lock.lvl === 'L05' && /Locked for you/.test(lock.info), `friend sees L05 with temporary-access note (${lock.info.match(/Locked[^—]*/)?.[0] || ''})`);
await shot(B, '07-friend-locked-level-lobby');
await rideChallenge('L05', 'L05');
const after = await B.evaluate(() => {
  const sd = window.__app.profile.stunt;
  return { levels: Object.keys(sd.levels), saved: Object.keys(JSON.parse(localStorage.getItem('velorush.profile.v1')).stunt.levels) };
});
ok(after.levels.length === 0 && after.saved.length === 0, 'friend: riding the locked L05 challenge did not unlock or complete anything permanently');
// friend's Stunt Park still has L02+ locked
await A.click('#btn-rematch');
await B.evaluate(() => document.getElementById('btn-rematch').click());
await inLobby(A);
await inLobby(B);
await B.evaluate(() => document.getElementById('btn-leave').click());
await sleep(1000);
const left = await A.evaluate(() => document.querySelectorAll('#lobby-players li').length);
ok(left === 1, 'friend left the room; host lobby shows 1 rider');
await B.evaluate(() => window.__app.ui.showMenu('stunt'));
await sleep(500);
ok(await B.evaluate(() => document.querySelector('#st-grid .lv-card[data-level="L05"]').classList.contains('locked') && document.querySelector('#st-grid .lv-card[data-level="L02"]').classList.contains('locked')), 'friend Stunt Park: L02 and L05 still locked');
await shot(B, '08-friend-stunt-park');
ok(errors.length === 0, `no page errors (${errors.length})`);
for (const e of errors.slice(0, 8)) results.push('  ERR ' + e);
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
