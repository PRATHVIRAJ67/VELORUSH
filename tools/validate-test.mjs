// Replays simulated honest riders through the server's state validation at accelerated
// time and reports any false positives. Usage: node tools/validate-test.mjs
import { Room } from '../server/Room.js';
import { getTrack } from '../shared/tracks.js';
import { Race } from '../shared/race.js';
import { packBike } from '../shared/protocol.js';

const track = getTrack();
let now = 1_000_000;
Date.now = () => now;
let total = 0;
let bad = 0;
const reasons = [];
for (const skill of ['easy', 'medium', 'hard', 'elite']) {
  for (let seed = 1; seed <= 4; seed++) {
    const room = new Room('TEST' + seed, track, () => {});
    const client = { id: 'h', name: 'Honest', look: {}, bikeId: ['allround', 'aero', 'climber', 'sprint'][seed % 4], send() {}, sendRaw() {} };
    room.add(client);
    room.setReady('h', true);
    room.settings.bots = 3;
    room.start('h');
    room.onViolation = (r, info) => {
      bad++;
      if (reasons.length < 12) reasons.push({ skill, seed, ...Object.fromEntries(Object.entries(info).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v])) });
    };
    // the "client": an honest local race where our rider is AI-driven (same physics + inputs)
    const local = new Race(track, { laps: 1, countdown: 0.01 });
    const me = local.addRacer({ id: 'h', name: 'me', isBot: true, skill, seed: seed * 17, bikeId: client.bikeId });
    me.stats.power = me.stats.power; // honest stats
    for (let i = 0; i < 3; i++) local.addRacer({ id: 'b' + i, name: 'b', isBot: true, skill: 'hard', seed: seed * 31 + i });
    const start = room.goAt + 10;
    let t = 0;
    let lastArrival = 0;
    const queue = [];
    while (!me.finished && t < 400) {
      local.step(1 / 120);
      t += 1 / 120;
      // client sends every ~50 ms; the network adds 0-70 ms of jitter (kept in order)
      if (Math.round(t * 120) % 6 === 0) {
        // occasional 150-400 ms stalls (busy CPU) deliver messages in bursts
        const stall = Math.random() < 0.01 ? 150 + Math.random() * 450 : 0;
        const arrival = Math.max(lastArrival + 0.5, start + t * 1000 + Math.random() * 70 + stall);
        lastArrival = arrival;
        queue.push([arrival, packBike(me.bike), start + t * 1000]);
      }
      while (queue.length && queue[0][0] <= start + t * 1000) {
        const [at, q, ct] = queue.shift();
        now = at;
        room.onState('h', q, ct);
        total++;
      }
    }
  }
}
console.log(`${total} states checked, ${bad} false positives`);
for (const r of reasons) console.log(JSON.stringify(r));
process.exit(bad ? 1 : 0);
