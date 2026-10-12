// Browser test for stunt crashes: forces each kind of crash in a real level (under-rotated flip,
// sideways landing, barrels, gap, falling off a narrow plank), samples the bike and rider meshes
// against the deck while the crash plays (no sinking in, no floating, rider clear of the bike),
// screenshots it, and checks the rider is back on the bike in the normal riding pose after the
// respawn. Needs the client dev server.
//   URL=http://localhost:5173/ node tools/stunt-crash-test.mjs <outDir> [--mobile]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHARED = '/@fs/' + encodeURI(fileURLToPath(new URL('../shared/', import.meta.url)).split('\\').join('/'));
const out = process.argv[2] || 'crash-shots';
const mobile = process.argv.includes('--mobile');
mkdirSync(out, { recursive: true });
const url = process.env.URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (c, m) => {
  results.push(`${c ? 'PASS' : 'FAIL'} ${m}`);
  console.log(`${c ? 'PASS' : 'FAIL'} ${m}`);
};
const errors = [];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
if (mobile) {
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2, isLandscape: true });
} else await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('menu-main')?.classList.contains('show'), { timeout: 180000 });
await page.evaluate((r) => (window.__sharedRoot = r), SHARED);

// in-page helpers: sabotaged pilot + mesh-vs-deck measurement
await page.evaluate(() => {
  window.__measure = () => {
    const s = window.__app.session;
    const C = s.pose.crash;
    const model = s.view.model;
    const V = model.root.position.constructor;
    const v = new V();
    const track = s.course.track;
    // deck plane near a point: height + slope along the road (ramps are constant across the road)
    const plane = (sv, dv) => {
      const g = (x) => track.sample(x).y + track.rampHeight(x, dv);
      const c = track.sample(sv);
      const w = track.toWorld(sv, dv);
      return { x: w.x, z: w.z, hx: c.hx, hz: c.hz, g0: g(sv), k: (g(sv + 0.3) - g(sv - 0.3)) / 0.6 };
    };
    const lowest = (root, skip, P) => {
      let min = Infinity;
      let max = -Infinity;
      let nan = false;
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh || (skip && (o === skip || isUnder(o, skip)))) return;
        const pos = o.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / 400));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (!Number.isFinite(v.y)) nan = true;
          const ds = (v.x - P.x) * P.hx + (v.z - P.z) * P.hz;
          const h = v.y - (P.g0 + P.k * ds);
          if (h < min) min = h;
          if (h > max) max = h;
        }
      });
      return { min, max, nan };
    };
    const isUnder = (o, p) => {
      for (let q = o.parent; q; q = q.parent) if (q === p) return true;
      return false;
    };
    if (!C) return null;
    const bike = lowest(model.root, model.rider, plane(C.bs, C.bd));
    const rider = lowest(model.rider, null, plane(C.rs_, C.rd_));
    const dx = C.rx - model.root.position.x;
    const dz = C.rz - model.root.position.z;
    return { t: C.t, kind: C.kind, bikeMin: bike.min, riderMin: rider.min, riderMax: rider.max, nan: bike.nan || rider.nan, sep: Math.hypot(dx, dz), roll: model.lean.rotation.z };
  };
  window.__ride = async (id, mode) => {
    const app = window.__app;
    app.startStunt(id);
  };
  window.__drive = async (mode) => {
    const app = window.__app;
    const s = app.session;
    app.ui.hideControlsCard();
    const { StuntPilot, solveLevel } = await import(window.__sharedRoot + 'stunts/pilot.js');
    const plan = solveLevel(s.course, { tricks: false }).plan;
    if (mode.plan) for (const [i, v] of Object.entries(mode.plan)) plan[i] = { ...plan[i], v };
    const p = new StuntPilot(s.run, plan);
    if (mode.lane !== undefined) {
      const orig = p.laneAt.bind(p);
      p.laneAt = (u) => {
        const l = orig(u);
        return l === null ? null : mode.lane;
      };
    }
    const run = s.run;
    window.__crashLog = [];
    app.input.read = () => {
      const inp = { ...p.input() };
      const T = run.state.T;
      if (T.air && mode.air && (mode.jump ?? 0) === (window.__jumps || 0)) {
        if (T.airT > 0.04 && T.airT < 0.04 + mode.air.dur) Object.assign(inp, mode.air.inp);
        else Object.assign(inp, { throttle: 0, brake: 0, steer: 0, sprint: false });
      }
      if (mode.beamOff) {
        const bm = s.course.beams.find((b) => b.amp);
        if (bm && run.bike.u > bm.s0 + 12 && run.bike.u < bm.s1) inp.steer = 1;
      }
      return inp;
    };
  };
});

async function crashCase(name, id, mode) {
  await page.evaluate((id) => window.__app.startStunt(id), id);
  await page.waitForFunction((id) => window.__app.session?.level?.id === id && window.__app.world?.isStunt, { timeout: 90000 }, id);
  await sleep(600);
  await page.evaluate((m) => window.__drive(m), mode);
  await page.evaluate(() => (window.__app.chase.distIndex = 1));
  // wait for the crash
  const got = await page.waitForFunction(() => window.__app.session.run.state.phase === 'crashed', { timeout: 90000, polling: 16 }).then(() => true).catch(() => false);
  if (!got) {
    ok(false, `${name}: no crash happened`);
    return;
  }
  const reason = await page.evaluate(() => window.__app.session.run.state.crashReason);
  const samples = [];
  const shots = [0.12, 0.45, 1.0];
  let si = 0;
  for (let i = 0; i < 40; i++) {
    const m = await page.evaluate(() => window.__measure());
    if (!m) break;
    samples.push(m);
    if (si < shots.length && m.t >= shots[si]) {
      await page.screenshot({ path: `${out}/${mobile ? 'm-' : ''}${name}-${si}.png` });
      si++;
    }
    await sleep(60);
  }
  const kind = samples[0]?.kind;
  const nan = samples.some((m) => m.nan);
  const late = samples.filter((m) => m.t > 0.85);
  const minBike = Math.min(...samples.map((m) => m.bikeMin));
  const minRider = Math.min(...samples.map((m) => m.riderMin));
  console.log(`  ${name}: "${reason}" kind=${kind} samples=${samples.length} minBike=${minBike.toFixed(3)} minRider=${minRider.toFixed(3)} end: ${late.length ? JSON.stringify({ bike: +late.at(-1).bikeMin.toFixed(3), rider: +late.at(-1).riderMin.toFixed(3), riderTop: +late.at(-1).riderMax.toFixed(2), sep: +late.at(-1).sep.toFixed(2), roll: +late.at(-1).roll.toFixed(2) }) : '-'}`);
  ok(!nan && samples.length > 5, `${name}: crash animation runs (${samples.length} samples, ${reason})`);
  if (process.argv.includes('--verbose')) for (const m of samples) console.log('   ', m.t.toFixed(2), 'bike', m.bikeMin.toFixed(3), 'rider', m.riderMin.toFixed(3), m.riderMax.toFixed(2), 'sep', m.sep.toFixed(2), 'roll', m.roll.toFixed(2));
  if (kind !== 'fall') {
    ok(minBike > -0.06, `${name}: bike never sinks into the deck (lowest ${minBike.toFixed(3)} m)`);
    ok(minRider > -0.06, `${name}: rider never sinks into the deck (lowest ${minRider.toFixed(3)} m)`);
    const end = late.at(-1);
    ok(end && end.bikeMin < 0.08, `${name}: bike rests on the deck at the end (gap ${end?.bikeMin.toFixed(3)} m)`);
    ok(end && end.riderMin < 0.12 && end.riderMax < 0.75, `${name}: rider lies on the deck at the end (lowest ${end?.riderMin.toFixed(3)}, top ${end?.riderMax.toFixed(2)} m)`);
    ok(end && end.sep > 0.6, `${name}: rider clear of the bike, not tangled (${end?.sep.toFixed(2)} m apart)`);
  }
  // respawn: back on the bike, riding pose
  await page.waitForFunction(() => window.__app.session.run.state.phase !== 'crashed', { timeout: 5000 });
  await sleep(400);
  const back = await page.evaluate(() => {
    const s = window.__app.session;
    const m = s.view.model;
    return { auto: m.rider.matrixAutoUpdate, pos: m.rider.position.length(), crash: !!s.pose.crash, roll: Math.abs(m.lean.rotation.z), blob2: !!s.view.blob2?.visible, onBike: m.rider.matrix.elements[13] };
  });
  ok(back.auto && back.pos < 1e-6 && !back.crash && !back.blob2 && back.roll < 0.3, `${name}: back on the bike after the respawn (${JSON.stringify(back)})`);
  await page.screenshot({ path: `${out}/${mobile ? 'm-' : ''}${name}-respawn.png` });
}

await crashCase('under-rotated', 'L04', { air: { dur: 0.12, inp: { brake: 1 } } });
await crashCase('sideways', 'L05', { air: { dur: 0.16, inp: { steer: 1 } } });
await crashCase('front-flip-short', 'L11', { air: { dur: 0.16, inp: { throttle: 1 } } });
await crashCase('barrels', 'L08', { lane: -4.5 });
await crashCase('gap', 'L03', { plan: { 1: 5, 2: 5 } });
await crashCase('beam', 'L20', { beamOff: true });
await crashCase('high-speed', 'L41', { air: { dur: 0.12, inp: { brake: 1 } } });

await page.evaluate(() => window.__app.quitToMenu('main'));
console.log('errors', errors.length, errors.slice(0, 5));
ok(errors.length === 0, 'no page errors');
await browser.close();
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
