// End-to-end multiplayer test with two scripted WebSocket clients.
// Spawns the server on a test port, runs a 1-lap race and checks lobby, validation,
// reconnection and server-side results. Usage: node tools/net-test.mjs
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { getTrack } from '../shared/tracks.js';
import { createBike, stepBike, makeStats, emptyInput } from '../shared/physics.js';
import { AIBrain } from '../shared/ai.js';
import { gridSlot } from '../shared/race.js';
import { C, S, PROTOCOL_VERSION, packBike } from '../shared/protocol.js';

const PORT = 8099;
const URL = `ws://localhost:${PORT}`;
const track = getTrack();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
let failures = 0;
const check = (cond, msg) => {
  if (cond) log('PASS', msg);
  else {
    failures++;
    log('FAIL', msg);
  }
};

const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), VR_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (d) => (process.env.VERBOSE || /violation/.test(d)) && process.stdout.write('  srv ' + d));
server.stderr.on('data', (d) => process.stdout.write('  srv ERR ' + d));
await sleep(700);

class Bot {
  constructor(name, skill) {
    this.name = name;
    this.brain = new AIBrain(skill, name.length * 31);
    this.stats = makeStats('allround');
    this.msgs = [];
    this.handlers = {};
    this.corrections = 0;
    this.cheat = null;
  }
  connect(session) {
    return new Promise((res) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', () => {
        this.send(C.HELLO, { v: PROTOCOL_VERSION, name: this.name, look: { jersey: '#ff0000' }, bikeId: 'allround', session });
      });
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        this.msgs.push(m);
        if (m.t === S.WELCOME) {
          this.id = m.id;
          this.session = m.session;
          this.resumed = m.resumed;
          res();
        }
        if (m.t === S.ROOM) this.room = m.room;
        if (m.t === S.START) this.onStart(m);
        if (m.t === S.CORRECT) {
          this.corrections++;
          if (this.bike) {
            this.bike.u = m.u;
            this.bike.s = track.wrap(m.u);
            this.bike.d = m.d;
            this.bike.v = m.v;
          }
        }
        if (m.t === S.RESULTS) this.results = m;
        if (m.t === S.SNAP) this.lastSnap = m;
        if (m.t === S.ERROR) log(this.name, 'server error:', m.msg);
      });
    });
  }
  send(t, p = {}) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p }));
  }
  onStart(m) {
    this.goAt = m.goAt;
    const me = m.grid.find((g) => g.id === this.id);
    if (m.resume) {
      this.bike.u = m.resume.u;
      this.bike.s = track.wrap(m.resume.u);
      this.bike.d = m.resume.d;
      this.bike.v = m.resume.v;
      this.resumeReceived = true;
      return;
    }
    const g = gridSlot(me.slot);
    this.bike = createBike(track, g.u, g.d);
    this.bike.frozen = true;
    clearInterval(this.timer);
    let acc = 0;
    let sendAcc = 0;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      const raceTime = (now - this.goAt) / 1000;
      if (raceTime >= 0) this.bike.frozen = false;
      acc += dt;
      while (acc > 1 / 120) {
        acc -= 1 / 120;
        const inp = this.bike.frozen ? emptyInput() : this.brain.update(this.bike, [], track, 1 / 120, { stats: this.stats, progress: this.bike.u / track.length, lap: 0, laps: 1 });
        stepBike(this.bike, inp, 1 / 120, track, this.stats);
      }
      sendAcc += dt;
      if (sendAcc >= 0.05 && raceTime >= 0 && !this.offline) {
        sendAcc = 0;
        let q = packBike(this.bike);
        if (this.cheat) q = this.cheat(q);
        this.send(C.STATE, { q, ct: Date.now() });
      }
    }, 16);
  }
}

const A = new Bot('Alice', 'elite');
const B = new Bot('Bob', 'hard');
await A.connect();
await B.connect();
check(A.id && B.id && A.id !== B.id, 'both clients welcomed with unique ids');
A.send(C.CREATE, { laps: 1, bots: 1, skill: 'medium' });
await sleep(300);
const code = A.room?.code;
check(/^[A-Z0-9]{5}$/.test(code || ''), `room created with code ${code}`);
B.send(C.JOIN, { code });
await sleep(300);
check(A.room.players.filter((p) => !p.bot).length === 2, 'host sees both riders in the lobby');
check(A.room.hostId === A.id, 'creator is host');
B.send(C.START);
await sleep(200);
check(!A.goAt, 'non-host cannot start');
A.send(C.START);
await sleep(200);
check(!A.goAt, 'cannot start before everyone is ready');
A.send(C.READY, { ready: true });
B.send(C.READY, { ready: true });
await sleep(200);
A.send(C.START);
await sleep(400);
check(A.goAt && B.goAt && A.goAt === B.goAt, 'race start broadcast with a shared GO time');
check(A.msgs.find((m) => m.t === S.START)?.grid.length === 3, 'grid has 2 humans + 1 bot');

// wait into the race
await sleep(4200 + 12000);
const snap = A.lastSnap;
check(snap && snap.p.length === 3, 'snapshots stream all riders');
const bu = snap.p.find((p) => p[0] === B.id)?.[1];
check(bu > 100, `Bob is making progress on the server (u=${bu?.toFixed(0)})`);

// --- cheating: teleport ahead ---
B.cheat = (q) => {
  q[0] += 250;
  return q;
};
await sleep(600);
B.cheat = null;
await sleep(400);
check(B.corrections > 0, `server rejected a teleport (${B.corrections} corrections)`);
const buAfter = A.lastSnap.p.find((p) => p[0] === B.id)[1];
check(buAfter < bu + 200, `server kept Bob at a plausible position (u=${buAfter.toFixed(0)})`);

// --- cheating: impossible speed on the flat ---
const before = B.corrections;
B.cheat = (q) => {
  q[3] = 28.5;
  q[0] += 0.9;
  return q;
};
await sleep(1500);
B.cheat = null;
check(B.corrections > before, 'server rejected an impossible speed claim');
await sleep(500);

// --- disconnect + reconnect ---
const session = B.session;
B.offline = true;
B.ws.terminate();
await sleep(2500);
check(A.room.players.find((p) => p.id === B.id)?.connected === false, 'lobby shows Bob as disconnected');
B.offline = false;
await B.connect(session);
await sleep(600);
check(B.resumed === true, 'Bob resumed his session');
check(B.resumeReceived === true, 'server re-sent race state with resume position');
check(A.room.players.find((p) => p.id === B.id)?.connected === true, 'Bob is back online');

// --- finish ---
log('waiting for the race to finish…');
const deadline = Date.now() + 260000;
while (!A.results && Date.now() < deadline) await sleep(500);
check(!!A.results && !!B.results, 'both clients received server results');
if (A.results) {
  for (const r of A.results.rows) log(`  ${r.place}. ${r.name.padEnd(16)} ${r.time != null ? r.time.toFixed(2) + 's' : r.status}`);
  check(A.results.rows.every((r) => r.time != null || r.status), 'every rider has a time or a status');
  const ev = A.msgs.filter((m) => m.t === S.EVENT);
  check(ev.some((e) => e.e === 'checkpoint') && ev.some((e) => e.e === 'finish'), 'checkpoint + finish events broadcast');
}
check(A.corrections === 0, 'honest rider was never corrected (no false positives)');
// back to lobby
A.send(C.LOBBY, { ready: true });
await sleep(300);
check(A.room.phase === 'lobby', 'room returns to the lobby for a rematch');

clearInterval(A.timer);
clearInterval(B.timer);
A.ws.close();
B.ws.close();
server.kill('SIGINT');
log(failures ? `${failures} FAILURE(S)` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
