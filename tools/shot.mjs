// Dev tool: drive the game in headless Chrome, capture console errors + screenshots.
// Usage: node tools/shot.mjs <outDir> [scenario]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'shots';
const scenario = process.argv[3] || 'menu';
const url = process.env.URL || 'http://localhost:5173/';
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') errors.push(`[${t}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
};

process.on('exit', () => {
  console.log('--- console errors/warnings ---');
  console.log(errors.slice(0, 30).join('\n') || '(none)');
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show'), { timeout: 120000 });
await sleep(1500);
const fps = async () => page.evaluate(() => document.getElementById('fps').textContent);

if (scenario === 'check') {
  const res = await page.evaluate(() => {
    const app = window.__app;
    const t = app.track;
    const T = app.world.terrain;
    const bad = [];
    let worst = 0;
    for (let i = 0; i < t.count; i += 2) {
      for (const d of [-t.halfWidth - t.shoulder, -t.halfWidth, 0, t.halfWidth, t.halfWidth + t.shoulder]) {
        const p = t.toWorld(i * t.ds, d);
        const over = T.heightAt(p.x, p.z) - p.y;
        if (over > worst) worst = over;
        if (over > 0.02) bad.push([i, d.toFixed(1), over.toFixed(2)]);
      }
    }
    return { worst: worst.toFixed(2), count: bad.length, sample: bad.filter((_, k) => k % Math.max(1, Math.floor(bad.length / 25)) === 0).slice(0, 25) };
  });
  console.log(JSON.stringify(res));
} else if (scenario === 'screens') {
  await page.click('[data-go="garage"]');
  await sleep(1500);
  await shot('garage');
  await page.click('.bike-item[data-bike="aero"]');
  await page.click('#sw-frame .sw:nth-child(5)');
  await page.click('.chip[data-outfit="polka"]');
  await sleep(800);
  await shot('garage2');
  await page.click('#menu-garage [data-go="main"]');
  await page.click('[data-go="settings"]');
  await sleep(400);
  await shot('settings');
  await page.click('#btn-settings-back');
  // time trial -> finish -> results
  await page.click('[data-go="play"]');
  await page.click('.mode-card[data-mode="ai"]');
  await page.select('#opt-laps', '1');
  await page.click('#btn-start-race');
  await sleep(5200);
  await page.keyboard.press('Escape');
  await sleep(400);
  await shot('pause');
  await page.keyboard.press('Escape');
  await page.keyboard.down('KeyW');
  await page.evaluate(() => {
    const s = window.__app.session;
    const t = window.__app.track;
    const b = s.player.bike;
    // pass all checkpoints legitimately by walking the rider along the course
    for (let u = b.u; u < t.length - 45; u += 5) {
      b.u = u;
      s.race.checkProgress(s.player);
    }
    b.s = t.wrap(b.u);
    b.d = 0;
    const c = t.sample(b.s);
    b.yaw = c.head;
    b.y = c.y;
    b.v = 16;
    window.__app.chase.snapBehind(window.__app._buildTarget());
  });
  await sleep(3500);
  await shot('finish');
  await sleep(3500);
  await shot('results');
  await page.click('#btn-res-skip');
  await sleep(1500);
  await shot('results2');
} else if (scenario === 'speed') {
  // real riding: an elite AI steers the player's bike (same inputs + physics as a human)
  await page.click('[data-go="play"]');
  await page.click('.mode-card[data-mode="quick"]');
  await page.click('#btn-start-race');
  await sleep(5200);
  await page.evaluate(() => {
    const s = window.__app.session;
    const t = window.__app.track;
    const b = s.player.bike;
    for (let u = b.u; u < 1270; u += 5) {
      b.u = u;
      s.race.checkProgress(s.player);
    }
    b.s = t.wrap(b.u);
    b.d = -1;
    b.yaw = t.sample(b.s).head;
    b.y = t.sample(b.s).y;
    b.v = 16;
    s.player.autopilot = new (s.race.racers[1].brain.constructor)('elite', 3);
    window.__app.chase.snapBehind(window.__app._buildTarget());
  });
  const log = [];
  for (let i = 0; i < 18; i++) {
    await sleep(1000);
    const r = await page.evaluate(() => {
      const b = window.__app.session.player.bike;
      return { u: Math.round(b.u), kmh: Math.round(b.v * 3.6), fov: Math.round(window.__app.renderer.camera.fov), brake: b.brake, fps: document.getElementById('fps').textContent };
    });
    log.push(r);
    if ([6, 9, 11, 13].includes(i)) await shot('speed' + i);
  }
  console.log(log.map((r) => `u=${r.u} ${r.kmh}km/h fov=${r.fov} brake=${r.brake.toFixed(1)} ${r.fps}`).join('\n'));
} else if (scenario === 'feel') {
  // Keyboard-driven feel test: velocity is read from the physics state (not the HUD)
  // and cross-checked against distance actually travelled.
  await page.click('[data-go="play"]');
  await page.click('.mode-card[data-mode="quick"]');
  await page.click('#btn-start-race');
  await sleep(5000);
  const st = () =>
    page.evaluate(() => {
      const b = window.__app.session.player.bike;
      return { u: b.u, kmh: b.v * 3.6, stam: b.stamina, fov: window.__app.renderer.camera.fov };
    });
  const phase = async (label, seconds, shotAt = -1) => {
    const rows = [];
    let prev = await st();
    for (let i = 1; i <= seconds; i++) {
      await sleep(1000);
      const cur = await st();
      rows.push(`${Math.round(cur.kmh)}(${Math.round((cur.u - prev.u) * 3.6)})`);
      prev = cur;
      if (i === shotAt) await shot('feel-' + label);
    }
    console.log(`${label.padEnd(8)} km/h per second [physics(measured by distance)]: ${rows.join(' ')}  stamina ${Math.round(prev.stam)} fov ${Math.round(prev.fov)}`);
  };
  await page.keyboard.down('KeyW');
  await phase('pedal', 9, 9);
  await page.keyboard.down('ShiftLeft');
  await phase('sprint', 10, 9);
  await page.keyboard.up('ShiftLeft');
  await phase('recover', 4);
  // descent: elite autopilot steers (same inputs/physics as a human)
  await page.evaluate(() => {
    const s = window.__app.session;
    const t = window.__app.track;
    const b = s.player.bike;
    for (let u = b.u; u < 1300; u += 5) {
      b.u = u;
      s.race.checkProgress(s.player);
    }
    b.s = t.wrap(b.u);
    b.d = -1;
    b.yaw = t.sample(b.s).head;
    b.y = t.sample(b.s).y;
    b.v = 18;
    s.player.autopilot = new (s.race.racers[1].brain.constructor)('elite', 3);
    window.__app.chase.snapBehind(window.__app._buildTarget());
  });
  await phase('descent', 14, 11);
  // hard braking from the current speed
  await page.evaluate(() => (window.__app.session.player.autopilot = null));
  const before = await st();
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS');
  await sleep(2500);
  const after = await st();
  await page.keyboard.up('KeyS');
  console.log(`brake    ${Math.round(before.kmh)} -> ${Math.round(after.kmh)} km/h in 2.5 s over ${Math.round(after.u - before.u)} m`);
} else if (scenario === 'map') {
  // Full map tour: terrain/road check, then an elite-driven lap with screenshots + speed/FPS
  const id = process.env.MAP || 'mountain';
  await page.evaluate((id) => {
    window.__app.settings.showFps = true;
    return window.__app.loadTrack(id);
  }, id);
  await sleep(2500);
  await shot(`${id}-menu`);
  const chk = await page.evaluate(() => {
    const app = window.__app;
    const t = app.track;
    const T = app.world.terrain;
    let worst = 0;
    let bad = 0;
    const where = [];
    for (let i = 0; i < t.count; i += 2) {
      for (const d of [-t.halfWidth - t.shoulder, -t.halfWidth, 0, t.halfWidth, t.halfWidth + t.shoulder]) {
        const p = t.toWorld(i * t.ds, d);
        const over = T.heightAt(p.x, p.z) - p.y;
        if (over > worst) worst = over;
        if (over > 0.02) {
          bad++;
          if (bad <= 6) where.push(`s=${i} d=${d.toFixed(1)} +${over.toFixed(2)} flags=${t.FLAGS[i]}`);
        }
      }
    }
    return { worst: worst.toFixed(2), bad, where };
  });
  console.log(`${id} terrain-over-road: worst ${chk.worst} m, ${chk.bad} samples ${chk.where.join(' | ')}`);
  await page.evaluate(() => window.__app.startLocal({ mode: 'quick', laps: 1, ai: 5, skill: 'hard', track: window.__app.track.id }));
  await sleep(5600);
  await shot(`${id}-grid`);
  await page.evaluate(() => {
    const s = window.__app.session;
    s.player.autopilot = new (s.race.racers[1].brain.constructor)('elite', 5);
  });
  const L = await page.evaluate(() => window.__app.track.length);
  const rows = [];
  for (const frac of [0.18, 0.36, 0.54, 0.72, 0.9]) {
    // jump ahead (progress walked legitimately), then ride 3 s for real
    await page.evaluate((u) => {
      const s = window.__app.session;
      const t = window.__app.track;
      const b = s.player.bike;
      for (let x = b.u; x < u; x += 5) {
        b.u = x;
        s.race.checkProgress(s.player);
      }
      b.u = Math.max(b.u, u);
      b.s = t.wrap(b.u);
      b.d = 0;
      const c = t.sample(b.s);
      b.yaw = c.head;
      b.y = c.y;
      b.v = Math.max(b.v, 16);
      window.__app.chase.snapBehind(window.__app._buildTarget());
    }, frac * L);
    await sleep(3200);
    const r = await page.evaluate(() => {
      const b = window.__app.session.player.bike;
      return { kmh: Math.round(b.v * 3.6), fps: document.getElementById('fps').textContent, grade: Math.round(window.__app.track.sample(b.s).slope * 100) };
    });
    rows.push(`${Math.round(frac * 100)}%: ${r.kmh} km/h (grade ${r.grade}%) ${r.fps}`);
    await shot(`${id}-${Math.round(frac * 100)}`);
  }
  console.log(rows.join('\n'));
} else if (scenario === 'weather') {
  for (const w of ['clear', 'cloudy', 'fog', 'rain']) {
    await page.evaluate((w) => window.__app.startLocal({ mode: 'quick', laps: 1, ai: 5, skill: 'medium', weather: w }), w);
    await sleep(5600);
    await page.keyboard.down('KeyW');
    await sleep(3500);
    await page.keyboard.up('KeyW');
    await shot('weather-' + w);
  }
} else if (scenario === 'bike') {
  await page.evaluate(() => {
    window.__app.profile.bikeId = 'aero';
  });
  await page.click('[data-go="garage"]');
  await sleep(2500);
  await page.evaluate(() => {
    const g = window.__app.ui.garage;
    g.camera.position.set(-2.4, 1.05, 1.2);
    g.camera.lookAt(0, 0.6, 0);
    g.turn.rotation.y = 0;
    g.turnSpeed = 0;
  });
  await sleep(300);
  await page.screenshot({ path: `${out}/bike.png`, clip: { x: 60, y: 90, width: 700, height: 520 } });
} else if (scenario === 'ghost') {
  await page.evaluate(() => localStorage.removeItem('velorush.ghost.mountain.1'));
  await page.click('[data-go="play"]');
  await page.click('.mode-card[data-mode="timetrial"]');
  await page.select('#opt-laps', '1');
  await page.click('#btn-start-race');
  await sleep(5000);
  await page.keyboard.down('KeyW');
  // ride 20 s for real, then fast-walk the rest of the lap so a ghost gets recorded
  await sleep(20000);
  await page.evaluate(() => {
    const s = window.__app.session;
    const b = s.player.bike;
    const t = window.__app.track;
    for (let u = b.u; u < t.length - 30; u += 5) {
      b.u = u;
      s.race.checkProgress(s.player);
    }
    b.s = t.wrap(b.u);
    b.y = t.sample(b.s).y;
    b.yaw = t.sample(b.s).head;
    b.d = 0;
  });
  await sleep(9000);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('velorush.ghost.mountain.1') || 'null')?.frames?.length || 0);
  console.log('ghost frames saved:', saved);
  await page.keyboard.up('KeyW');
  await page.click('#btn-rematch');
  await sleep(6500);
  await page.keyboard.down('KeyW');
  await sleep(3000);
  const g = await page.evaluate(() => ({ ghost: !!window.__app.session.ghostView, visible: window.__app.session.ghostView?.model.root.visible, delta: window.__app.session.ghostDelta() }));
  console.log('ghost on rematch:', JSON.stringify(g));
  await shot('ghost');
} else if (scenario === 'mobile') {
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await sleep(500);
  await page.waitForFunction(() => window.__app?.chase && document.getElementById('menu-main')?.classList.contains('show'), { timeout: 120000 });
  await page.evaluate(() => {
    window.__app.settings.touch = 'on';
    window.__app.settings.quality = 'low';
    window.__app.applySettings();
  });
  await sleep(800);
  await shot('mobile-menu');
  await page.click('[data-go="play"]');
  await page.click('#btn-start-race');
  await sleep(6000);
  await shot('mobile-race');
} else if (scenario === 'menu') {
  await shot('menu');
  await sleep(3000);
  await shot('menu2');
} else if (scenario.startsWith('race')) {
  await page.evaluate(() => {
    window.__app.settings.showFps = true;
    window.__app.applySettings();
  });
  await page.click('[data-go="play"]');
  await sleep(300);
  await shot('play');
  await page.click('#btn-start-race');
  await sleep(1200);
  await shot('countdown');
  await sleep(3600);
  await page.keyboard.down('KeyW');
  await sleep(2500);
  await shot('race1');
  const stops = process.env.AT ? process.env.AT.split(',').map(Number) : [];
  for (const u of stops) {
    await page.evaluate((u) => {
      const b = window.__app.session.player.bike;
      const t = window.__app.track;
      b.u = u;
      b.s = t.wrap(u);
      b.d = 0;
      const c = t.sample(b.s);
      b.yaw = c.head;
      b.y = c.y;
      b.v = 12;
      window.__app.chase.snapBehind(window.__app._buildTarget());
    }, u);
    await sleep(1800);
    await shot('at' + u);
  }
  await page.keyboard.down('ShiftLeft');
  await sleep(3000);
  await shot('race2');
  await page.keyboard.up('ShiftLeft');
  console.log('fps', await fps());
  const info = await page.evaluate(() => {
    const s = window.__app.session;
    const b = s.player.bike;
    return { u: b.u.toFixed(1), d: b.d.toFixed(2), v: (b.v * 3.6).toFixed(1), place: s.player.place, calls: window.__app.renderer.renderer.info.render.calls, tris: window.__app.renderer.renderer.info.render.triangles };
  });
  console.log(JSON.stringify(info));
}
await browser.close();
