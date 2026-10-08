// Public lobby + Quick Join test: runs the real GameServer in-process with fake sockets.
// Usage: node tools/public-lobby-test.mjs
import { GameServer } from '../server/GameServer.js';
import { C, S, PROTOCOL_VERSION } from '../shared/protocol.js';
import { NET } from '../shared/constants.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'} ${m}`);
  if (!c) failures++;
};

const server = new GameServer({ log: () => {} });

class Player {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.open = true;
    this.client = server.connect({
      send: (s) => this.msgs.push(JSON.parse(s)),
      isOpen: () => this.open,
      close: () => (this.open = false),
      terminate: () => (this.open = false),
    });
    this.send(C.HELLO, { v: PROTOCOL_VERSION, name, look: {}, bikeId: 'allround' });
  }
  send(t, p = {}) {
    server.message(this.client, JSON.stringify({ t, ...p }));
  }
  last(type) {
    return [...this.msgs].reverse().find((m) => m.t === type);
  }
  get room() {
    return this.client.room;
  }
  match() {
    return this.last(S.MATCH);
  }
  drop() {
    this.open = false;
    server.disconnect(this.client);
  }
}
const quick = (p, track) => {
  p.client.lastMatchAt = 0; // test clients act faster than the 1 s cooldown
  p.send(C.QUICK, track ? { track } : {});
  return p.match();
};
const listed = (w) => w.last(S.PUBLIC)?.rooms || [];
const pushList = () => {
  server.publicSentAt = 0; // skip the 0.5 s push throttle in this synchronous test
  server._pushPublic(Date.now());
};

// ---- empty pool: Quick Join opens a public lobby, player is host ----
const A = new Player('Alice');
const W = new Player('Watcher');
W.send(C.WATCH, { on: true });
ok(listed(W).length === 0, 'empty public pool to start with');
const mA = quick(A, 'alpine');
ok(mA && mA.created && A.room?.isPublic, 'Quick Join with no lobbies creates a public lobby');
ok(A.room.hostId === A.client.id, 'creator is the host');
ok(A.room.settings.track === 'alpine', "new lobby uses the player's preferred map");
pushList();
ok(listed(W).length === 1 && listed(W)[0].players === 1 && listed(W)[0].track === 'alpine', 'lobby appears in the public list (1 rider, Alpine)');
const item = listed(W)[0];
ok(Object.keys(item).sort().join() === 'code,host,laps,max,players,state,track,weather', `list exposes only browser fields (${Object.keys(item).join(', ')})`);

// ---- B, C, D Quick Join: same lobby ----
const B = new Player('Bob'), Cc = new Player('Cara'), D = new Player('Dan');
for (const p of [B, Cc, D]) quick(p);
ok([B, Cc, D].every((p) => p.room === A.room), 'B, C and D all Quick Join the same public lobby');
ok(D.match().players === 4 && D.match().max === NET.maxPlayers, `D told "joined ${D.match().players}/${D.match().max}"`);
ok(A.room.hostId === A.client.id, 'host unchanged after joins');

// ---- prefer the fuller lobby ----
const E = new Player('Eve');
E.send(C.CREATE, { public: true, track: 'coast', laps: 1 });
const F = new Player('Finn');
quick(F, 'coast');
ok(F.room === A.room, 'Quick Join prefers the 4-rider lobby over a 1-rider lobby, even with a map preference for the other');
pushList();
ok(listed(W).map((r) => r.players).join() === '5,1', `list sorted fullest first (${listed(W).map((r) => r.players).join(', ')})`);

// ---- private rooms never listed ----
const P = new Player('Priv');
P.send(C.CREATE, { track: 'city' });
pushList();
ok(!listed(W).some((r) => r.code === P.room.code) && !P.room.isPublic, 'private room is not in the public list');
const P2 = new Player('Friend');
P2.send(C.JOIN, { code: P.room.code });
ok(P2.room === P.room, 'private room still joinable by code');

// ---- fill to the limit; two players race for the last seat ----
const fillers = [];
while (A.room.members.size < NET.maxPlayers - 1) {
  const p = new Player('F' + fillers.length);
  quick(p);
  fillers.push(p);
}
ok(A.room.members.size === NET.maxPlayers - 1, `lobby almost full (${A.room.members.size}/${NET.maxPlayers})`);
const X = new Player('Xena'), Y = new Player('Yuri');
X.client.lastMatchAt = Y.client.lastMatchAt = 0;
X.send(C.QUICK);
Y.send(C.QUICK); // arrives right after X: server handles them one at a time
ok(A.room.members.size === NET.maxPlayers, `exactly ${NET.maxPlayers}/${NET.maxPlayers} after the race for the last seat`);
ok((X.room === A.room) !== (Y.room === A.room), 'only one of the two got the last seat');
const loser = X.room === A.room ? Y : X;
ok(loser.room === E.room, 'the other went to the next public lobby instead');
pushList();
ok(!listed(W).some((r) => r.code === A.room.code), 'full lobby disappears from the public list');

// ---- stale click on a full lobby: graceful fallback ----
const Z = new Player('Zed');
Z.client.lastMatchAt = 0;
Z.send(C.JOIN_PUBLIC, { code: A.room.code });
ok(Z.match()?.fallback === true && Z.room && Z.room !== A.room, 'clicking a lobby that filled up falls back to Quick Join');
ok(A.room.members.size === NET.maxPlayers, 'capacity never exceeded');

// ---- duplicates ----
const before = E.room.members.size;
Z.client.lastMatchAt = 0;
Z.send(C.QUICK);
ok(Z.room === E.room && E.room.members.size === before, 'Quick Join while already in a public lobby keeps you there (no duplicate seat)');
Z.send(C.QUICK); // within the 1 s cooldown
ok(E.room.members.size === before, 'rapid duplicate requests ignored');
ok([...server.rooms.values()].every((r) => [...r.members.keys()].every((id, i, a) => a.indexOf(id) === i)), 'no duplicate memberships anywhere');

// ---- auto-start: idle host can't block a public lobby ----
const room2 = E.room; // Eve hosts
const riders2 = [...room2.members.values()].map((m) => m.client);
const ids2 = riders2.map((c) => c.id);
for (const c of riders2) if (c.id !== room2.hostId) server.message(c, JSON.stringify({ t: C.READY, ready: true }));
room2.tick();
ok(room2.autoStartAt && room2.autoStartAt - Date.now() > 15000, 'others ready, host idle: start scheduled in ~20 s');
room2.pairReadyAt -= 21000; // fast-forward the 20 s window
room2.tick();
ok(room2.phase === 'countdown', 'public race started without the idle host');
const hostSeat = room2.members.get(room2.hostId);
ok(hostSeat.spectator && room2.race.racers.every((r) => r.id !== room2.hostId || r.isBot), 'idle host watches this race and joins the next');
pushList();
ok(!listed(W).some((r) => r.code === room2.code), 'racing lobby removed from the public pool');
const G = new Player('Gus');
quick(G);
ok(G.room && G.room !== room2 && G.room.phase === 'lobby', 'Quick Join never drops a player into a race in progress');

// ---- all ready -> 3 s start (A's lobby) ----
for (const m of A.room.members.values()) server.message(m.client, JSON.stringify({ t: C.READY, ready: true }));
A.room.tick();
ok(A.room.autoStartAt && A.room.autoStartAt - Date.now() <= 3000, 'everyone ready: start in 3 s');
server.message([...A.room.members.values()][1].client, JSON.stringify({ t: C.READY, ready: false }));
A.room.tick();
ok(A.room.autoStartAt - Date.now() > 3000, 'someone un-readies: back to the 20 s window');
server.message([...A.room.members.values()][1].client, JSON.stringify({ t: C.READY, ready: true }));

// ---- results -> back in the pool (existing rematch flow) ----
for (const r of room2.race.racers) room2.race.markDnf(r);
room2.phase = 'racing';
room2.checkRaceEnd();
ok(room2.phase === 'results', 'race finished -> results');
room2.backToLobby(ids2[0], false);
ok(room2.phase === 'lobby' && room2.listable, 'after results the lobby returns to the public pool');

// ---- host disconnect: existing migration ----
const H = new Player('Hank');
H.send(C.CREATE, { public: true, track: 'forest' });
const I = new Player('Ivy');
I.send(C.JOIN_PUBLIC, { code: H.room.code });
const hr = H.room;
H.drop();
ok(!hr.listable, 'host disconnected: lobby hidden while the host may reconnect');
hr.members.get(H.client.id).leftAt -= 9000; // past the lobby grace period
hr.tick();
ok(hr.hostId === I.client.id && hr.listable, 'host timed out: host passes to the next rider, lobby listed again');

// ---- cleanup ----
I.send(C.LEAVE);
ok(!hr.listable && hr.members.size === 0, 'empty lobby unlisted immediately');
hr.emptySince -= 61000;
server.tick();
ok(!server.rooms.has(hr.code), 'empty lobby closed after the existing 60 s timeout');

// ---- watchers ----
W.send(C.WATCH, { on: false });
const n = W.msgs.length;
quick(new Player('Late'), 'city');
pushList();
ok(W.msgs.length === n, 'no list pushes after leaving the multiplayer screen');

server.stop();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
