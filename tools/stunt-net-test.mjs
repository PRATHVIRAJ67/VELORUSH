// Stunt friend-challenge test against the real server (spawned on a test port):
// private room with mode 'stunt' + level, friends join by code, the room never shows in the
// public list, everyone rides the same level (real physics + pilot, real time), states with
// trick angles are validated (respawns accepted, no corrections for honest riders), results are
// ranked by score, an inflated score is capped by the server, a rider that never crosses the line
// is not counted as finished, rematch returns to the lobby and the host can switch level.
// Usage: node tools/stunt-net-test.mjs
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { C, S, PROTOCOL_VERSION, packBike } from '../shared/protocol.js';
import { STUNT_LEVEL_BY_ID } from '../shared/stunts/levels.js';
import { buildCourse } from '../shared/stunts/course.js';
import { StuntRun } from '../shared/stunts/run.js';
import { StuntPilot, chooseTrick, solveLevel } from '../shared/stunts/pilot.js';

const PORT = 8097;
const URL = process.env.SERVER_URL || `ws://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let failures = 0;
const check = (c, msg) => {
  if (!c) failures++;
  log(c ? 'PASS' : 'FAIL', msg);
};
const server = process.env.SERVER_URL ? null : spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), VR_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const srvLog = [];
server?.stdout.on('data', (d) => {
  srvLog.push(String(d));
  if (process.env.VERBOSE) process.stdout.write('  srv ' + d);
});
server?.stderr.on('data', (d) => process.stdout.write('  srv ERR ' + d));
await sleep(800);

const planCache = {};
// solver plans computed up front (so starting the run never blocks the network loop)
for (const id of ['L03', 'L08']) planCache[id] = solveLevel(buildCourse(STUNT_LEVEL_BY_ID[id])).plan;
class Rider {
  constructor(name, { cheat = null, stopAt = null } = {}) {
    this.name = name;
    this.cheat = cheat; // 'inflate' -> reports 20x its score
    this.stopAt = stopAt; // stop riding (never cross the line) at this fraction of the course
    this.msgs = [];
    this.corrections = 0;
  }
  connect() {
    return new Promise((res) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', () => this.send(C.HELLO, { v: PROTOCOL_VERSION, name: this.name, look: { jersey: '#ff0000' }, bikeId: 'allround', stuntBikeId: 'bmx_rookie' }));
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        this.msgs.push(m);
        if (m.t === S.WELCOME) {
          this.id = m.id;
          res();
        }
        if (m.t === S.ROOM) this.room = m.room;
        if (m.t === S.START) this.onStart(m);
        if (m.t === S.CORRECT) this.corrections++;
        if (m.t === S.RESULTS) this.results = m;
        if (m.t === S.PUBLIC) this.publicList = m.rooms;
      });
    });
  }
  send(t, p = {}) {
    this.ws.send(JSON.stringify({ t, ...p }));
  }
  onStart(m) {
    this.start = m;
    this.results = null;
    const level = STUNT_LEVEL_BY_ID[m.level];
    const course = buildCourse(level);
    const me = m.grid.find((g) => g.id === this.id);
    this.bikeId = me.bikeId;
    const run = new StuntRun(course, { bikeId: me.bikeId, countdown: Math.max(0.05, (m.goAt - Date.now()) / 1000) });
    // approach speeds from the solver (same plan the validator proved), tricks chosen live
    const plan = (planCache[level.id] ||= solveLevel(course).plan);
    const pilot = new StuntPilot(run, plan);
    // real tricks (picked by forward simulation) so trick angles are streamed and checked
    pilot.chooser = chooseTrick;
    run.quiet = false;
    this.run = run;
    this.pilot = pilot;
    this.doneSent = false;
    this.respawned = 0;
    let last = Date.now();
    let sendAcc = 0;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      const now = Date.now();
      let dt = (now - last) / 1000;
      last = now;
      const rt = (now - m.goAt) / 1000;
      if (rt < 0) {
        run.state.time = Math.min(rt, -1e-4);
        return;
      }
      const frac = (run.bike.u - course.startU) / course.length;
      if (this.stopAt !== null && frac > this.stopAt) {
        // stalls before the line, then gives up and reports
        if (!this.doneSent) {
          this.doneSent = true;
          this.send(C.STUNT_DONE, { score: run.state.st.score, complete: true, fail: false, time: rt, u: run.bike.u, st: {} });
        }
        return;
      }
      // fixed physics steps, like the game's frame loop
      this.acc = (this.acc || 0) + dt;
      let n = 0;
      while (this.acc >= 1 / 120 && n++ < 60) {
        run.step(pilot.input(), 1 / 120);
        this.acc -= 1 / 120;
      }
      for (const e of run.drainEvents()) if (e.type === 'respawn') this.respawned++;
      // the friend uses the manual respawn once (back to a passed checkpoint) to test respawn validation
      if (this.name === 'Friend' && !this.didReset && run.state.gate > 0 && !run.bike.airborne && run.state.phase === 'riding') {
        this.didReset = true;
        run.step({ throttle: 0, brake: 0, steer: 0, sprint: false, boost: false, reset: true }, 1 / 120);
      }
      sendAcc += (now - (this._lastSend || now)) / 1000;
      if (!this._lastSend || now - this._lastSend >= 50) {
        this._lastSend = now;
        if (!run.done) {
          const q = packBike(run.bike);
          q.push(Math.round(run.state.T.pitch * 1000) / 1000, Math.round(run.state.T.spin * 1000) / 1000, run.state.phase === 'crashed' ? 1 : 0);
          this.send(C.STATE, { q, ct: now });
        }
      }
      if (run.done && !this.doneSent) {
        this.doneSent = true;
        const st = run.state.st;
        const score = this.cheat === 'inflate' ? st.score * 20 : st.score;
        this.trueScore = st.score;
        this.send(C.STUNT_DONE, { score, complete: !!run.state.result?.complete, fail: run.state.phase === 'failed', time: run.state.result?.time, u: run.bike.u, st: { maxFlipsJump: st.maxFlipsJump, maxSpinsJump: st.maxSpinsJump } });
      }
    }, 1000 / 60);
  }
  stop() {
    clearInterval(this.timer);
  }
}

const host = new Rider('Host');
const friend = new Rider('Friend');
const cheat = new Rider('Cheater', { cheat: 'inflate' });
const quitter = new Rider('Stopper', { stopAt: 0.5 });
const watcher = new Rider('Watcher');
for (const r of [host, friend, cheat, quitter, watcher]) await r.connect();
watcher.send(C.WATCH, { on: true });
host.send(C.CREATE, { mode: 'stunt', level: 'L03', public: true });
await sleep(400);
const code = host.room?.code;
check(host.room?.settings.mode === 'stunt' && host.room.settings.level === 'L03' && host.room.settings.track === 'coast', `stunt room created (${code}, ${host.room?.settings.level} on ${host.room?.settings.track})`);
check(host.room?.public === false, 'stunt challenge rooms are private even if "public" is requested');
for (const r of [friend, cheat, quitter]) r.send(C.JOIN, { code });
await sleep(700);
check(host.room.players.length === 4 && host.room.players.every((p) => !p.bot), `friends joined by code (${host.room.players.map((p) => p.name).join(', ')})`);
check(!(watcher.publicList || []).some((r) => r.code === code), 'stunt room not in the public lobby list');
check(host.room.players.find((p) => p.name === 'Friend').bikeId === 'bmx_rookie', 'stunt garage bike carried into the challenge');
// non-host cannot change the level; host can (validated)
friend.send(C.SETTINGS, { level: 'L50' });
await sleep(200);
check(host.room.settings.level === 'L03', 'only the host can change the level');
host.send(C.SETTINGS, { level: 'NOPE' });
await sleep(200);
check(host.room.settings.level === 'L03', 'unknown level ids are rejected');
for (const r of [host, friend, cheat, quitter]) r.send(C.READY, { ready: true });
await sleep(300);
host.send(C.START);
await sleep(500);
check([host, friend, cheat, quitter].every((r) => r.start?.mode === 'stunt' && r.start.level === 'L03'), 'everyone got the same stunt level at start');
// wait for results
const deadline = Date.now() + 90000;
setTimeout(() => log("DBG", [host, friend].map((r) => r.run && `${r.name} u=${r.run.bike.u.toFixed(0)} ph=${r.run.state.phase} t=${r.run.state.time.toFixed(1)} v=${r.run.bike.v.toFixed(1)} fin=${r.run.course.finishU.toFixed(0)}`).join(" | ")), 12000);
while (!host.results && Date.now() < deadline) await sleep(300);
for (const r of [host, friend, cheat, quitter]) r.stop();
const rows = host.results?.rows || [];
log('results', JSON.stringify(rows.map((r) => [r.place, r.name, r.score, r.complete, r.status])));
check(rows.length === 4 && host.results.mode === 'stunt', 'server published stunt results for all riders');
const rowOf = (n) => rows.find((r) => r.name === n);
check(rowOf('Host')?.score === host.trueScore && rowOf('Friend')?.score === friend.trueScore, `honest scores accepted as reported (${host.trueScore}, ${friend.trueScore})`);
check(rowOf('Cheater')?.score < cheat.trueScore * 3, `inflated score capped by the server (${cheat.trueScore * 20} reported, real ${cheat.trueScore} -> ${rowOf('Cheater')?.score})`);
check(srvLog.some((l) => /stunt score adjusted/.test(l)), 'server logged the score adjustment');
check(rowOf('Stopper') && !rowOf('Stopper').complete && rowOf('Stopper').status === 'DNF', 'rider who never crossed the line is DNF even though it claimed completion');
const sorted = rows.filter((r) => r.complete).every((r, i, a) => i === 0 || a[i - 1].score >= r.score);
check(sorted && rows[0].complete, 'ranking: completed riders first, by score');
check(host.corrections === 0 && friend.corrections === 0, `no anti-cheat corrections for honest stunt riders (host ${host.corrections}, friend ${friend.corrections})`);
check(!srvLog.some((l) => /violation.*(Host|Friend)/.test(l)), 'no validation violations logged for honest riders');

// rematch -> lobby, host switches level, ride again with a respawn
for (const r of [host, friend]) r.send(C.LOBBY, { ready: false });
await sleep(400);
check(host.room.phase === 'lobby', 'back to the lobby after results (rematch)');
for (const r of [cheat, quitter]) r.send(C.LEAVE);
host.send(C.SETTINGS, { level: 'L08' });
await sleep(300);
check(host.room.settings.level === 'L08' && host.room.settings.track === 'forest' && host.room.players.length === 2, 'host switched level (map follows); two riders left the room');
for (const r of [host, friend]) r.send(C.READY, { ready: true });
await sleep(200);
host.send(C.START);
const d2 = Date.now() + 120000;
await sleep(500);
while (!host.results && Date.now() < d2) await sleep(300);
for (const r of [host, friend]) r.stop();
log('results 2', JSON.stringify((host.results?.rows || []).map((r) => [r.place, r.name, r.score, r.complete, r.status])));
check(host.results?.level === 'L08' && host.results.rows.length === 2, 'second challenge on the new level finished');
check(host.corrections === 0 && friend.corrections === 0 && friend.respawned >= 1, `still no corrections (barrel slalom + ${friend.respawned} respawn(s) accepted)`);
for (const r of [host, friend, cheat, quitter, watcher]) r.ws.close();
server?.kill();
log(failures ? `${failures} FAILURES` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
