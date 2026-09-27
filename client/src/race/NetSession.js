// Online race: local rider is simulated here (instant response) and streamed to the server;
// remote riders are interpolated from server snapshots; results/places/laps come from the server.
import { createBike, stepBike, makeStats, interactBikes, consumeEvents, emptyInput } from '@shared/physics.js';
import { AIBrain } from '@shared/ai.js';
import { gridSlot } from '@shared/race.js';
import { NET, PHYSICS, XP } from '@shared/constants.js';
import { FL } from '@shared/protocol.js';
import { wrapAngle } from '@shared/math.js';
import { RiderView } from '../entities/RiderView.js';
import { SessionBase } from './SessionBase.js';
import { addXp, saveProfile } from '../core/Storage.js';

export class NetSession extends SessionBase {
  constructor(app, net, start) {
    super(app);
    this.isNet = true;
    this.net = net;
    this.goAt = start.goAt;
    this.laps = start.laps;
    this.weather = start.weather || 'clear';
    app.world.weather.apply(this.weather);
    this.spectator = !!start.spectator || !start.grid.some((g) => g.id === net.id);
    this.track = app.track;
    this.remotes = new Map();
    this.acc = 0;
    this.sendAcc = 0;
    this.me = null;
    this.serverRows = null;
    this.lastSnapRt = 0;
    const scene = app.renderer.scene;
    for (const g of start.grid) {
      const look = { ...(g.look || {}), bikeId: g.bikeId };
      if (g.id === net.id && !this.spectator) {
        const slot = gridSlot(g.slot);
        const bike = createBike(this.track, slot.u, slot.d);
        bike.frozen = true;
        this.me = {
          id: g.id,
          name: g.name,
          look,
          bike,
          stats: Object.assign(makeStats(g.bikeId, 1, app.settings.assist ? 0.85 : 0), { grip: app.world.weather.grip }),
          view: new RiderView(scene, this.track, { name: g.name, look, isLocal: true, night: app.world.theme.night }),
          lap: 0,
          gate: 0,
          place: g.slot + 1,
          finished: false,
          finishTime: null,
          autopilot: null,
        };
      } else {
        const slot = gridSlot(g.slot);
        const c = this.track.sample(this.track.wrap(slot.u));
        this.remotes.set(g.id, {
          id: g.id,
          name: g.name,
          look,
          bot: g.bot,
          buf: [],
          view: new RiderView(scene, this.track, { name: g.name, look, night: app.world.theme.night }),
          st: {
            u: slot.u, s: this.track.wrap(slot.u), d: slot.d, yaw: c.head, v: 0, y: c.y, vy: 0, lean: 0, steer: 0,
            crank: 0, wheel: 0, sprinting: false, brake: 0, airborne: false, landing: 0, bump: 0, throttle: 0, draft: 0,
            boostTimer: 0, boostCooldown: 0, stamina: 100, exhausted: false, wrongWay: 0, offroad: false, surf: 0, frozen: false, ev: {},
          },
          lap: 0,
          gate: 0,
          place: g.slot + 1,
          finished: false,
          dnf: false,
          offline: false,
          finishTime: null,
        });
      }
    }
    if (start.resume) this.onResume(start);
    if (this.spectator) {
      app.ui.showHud();
      app.ui.message('SPECTATING', 'You will join the next race', 'small');
      this.phase = this.raceTime() >= 0 ? 'racing' : 'countdown';
      app.chase.setMode('chase');
      app.audio.setMusic('race');
    } else this.startCountdown();
  }

  get canPause() {
    return false;
  }

  raceTime() {
    return (this.net.serverNow() - this.goAt) / 1000;
  }

  // ---------------------------------------------------------------- network in
  onSnap(m) {
    this.lastSnapRt = m.rt;
    for (const p of m.p) {
      const [id, u, d, yaw, v, y, lean, steer, fl, stamina, draft, lap, gate, place, finishTime] = p;
      if (this.me && id === this.me.id) {
        this.me.lap = lap;
        this.me.gate = gate;
        this.me.place = place;
        continue;
      }
      const r = this.remotes.get(id);
      if (!r) continue;
      r.buf.push({ ts: m.ts, u, d, yaw, v, y, lean, steer, fl });
      if (r.buf.length > 30) r.buf.shift();
      r.lap = lap;
      r.gate = gate;
      r.place = place;
      const fin = !!(fl & FL.FINISHED);
      if (fin && !r.finished) r.finishedAt = performance.now();
      r.finished = fin;
      r.st.celebrate = fin && performance.now() - (r.finishedAt || 0) < 4500;
      r.dnf = !!(fl & FL.DNF);
      r.offline = !!(fl & FL.OFFLINE);
      r.finishTime = finishTime >= 0 ? finishTime : null;
      r.st.stamina = stamina;
      r.st.draft = draft;
    }
  }

  onEvent(m) {
    const mine = this.me && m.id === this.me.id;
    if (!mine) {
      if (m.e === 'finish' && m.place === 1) {
        const r = this.remotes.get(m.id);
        this.app.ui.toast(`${r?.name || 'Someone'} wins the race!`);
      }
      return;
    }
    if (m.e === 'checkpoint') this.onCheckpoint({ gate: m.gate, time: m.time }, this.track.checkpoints.length);
    else if (m.e === 'lap') this.onLap({ lap: m.lap, lapTime: m.lapTime }, this.laps);
    else if (m.e === 'finish') this.onLocalFinish(m);
  }

  onCorrect(m) {
    if (!this.me) return;
    const b = this.me.bike;
    b.u = m.u;
    b.s = this.track.wrap(m.u);
    b.d = m.d;
    b.v = Math.min(b.v, m.v);
  }

  onResume(m) {
    this.goAt = m.goAt;
    if (m.resume && this.me) {
      const b = this.me.bike;
      b.u = m.resume.u;
      b.s = this.track.wrap(b.u);
      b.d = m.resume.d;
      b.yaw = m.resume.yaw;
      b.v = m.resume.v;
      b.y = this.track.sample(b.s).y;
      b.frozen = this.raceTime() < 0;
      this.me.lap = m.resume.lap;
      this.me.gate = m.resume.gate;
      if (m.resume.finished && !this.me.finished) {
        this.me.finished = true;
        this.me.autopilot = new AIBrain('easy', 7);
      }
      if (this.phase === 'countdown' && this.raceTime() >= 0) this.onGo();
    }
  }

  onRoom(room) {
    // back in the lobby after results (someone pressed rematch / return)
    if (room.phase === 'lobby' && this.phase === 'results' && this._wantLobby) {
      this.app.endSession();
      this.app.startDemo();
      this.app.ui.showMenu('lobby');
      this.app.ui.renderLobby(room, this.net.id);
    }
  }

  onConnectionLost() {
    this.app.ui.message('RECONNECTING…', '', 'small');
  }

  onLocalFinish(m) {
    const me = this.me;
    me.finished = true;
    me.finishTime = m.time;
    me.place = m.place;
    me.autopilot = new AIBrain('easy', 7);
    me.bike.celebrate = true;
    setTimeout(() => (me.bike.celebrate = false), 4500);
    const n = this.remotes.size + 1;
    const place = m.place;
    let xp = XP.finishBase;
    const lines = [[`Finished ${this.ordinal(place)}`, XP.finishBase]];
    const beaten = n - place;
    if (beaten > 0) {
      xp += beaten * XP.perPositionAhead;
      lines.push([`Beat ${beaten} rival${beaten > 1 ? 's' : ''}`, beaten * XP.perPositionAhead]);
    }
    if (place === 1 && n > 1) {
      xp += XP.win;
      lines.push(['Online victory', XP.win]);
    }
    xp += 30;
    lines.push(['Online race bonus', 30]);
    const prof = this.app.profile;
    prof.races++;
    if (place === 1 && n > 1) prof.wins++;
    saveProfile(prof);
    this.finishInfo = { xp: addXp(prof, xp), lines, newRecord: false };
    this.enterFinished();
  }

  onResults(m) {
    this.serverRows = m.rows;
    if (this.phase === 'results') this.app.ui.refreshResults(this.results());
    else if (this.spectator || !this.me?.finished) {
      // race ended (timeout / DNF / spectator): go straight to results
      this.phase = 'results';
      this.app.chase.setMode('finish');
      this.app.ui.showResults(this.results());
    }
  }

  results() {
    const id = this.net.id;
    let rows;
    if (this.serverRows) {
      rows = this.serverRows.map((r) => ({ ...r, isLocal: r.id === id }));
    } else {
      // live standings until the server publishes final results
      const all = [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, color: r.look.jersey, finished: r.finished, time: r.finishTime, place: r.place, dnf: r.dnf }));
      if (this.me) all.push({ id, name: this.me.name, color: this.me.look.jersey, finished: true, time: this.me.finishTime, place: this.me.place });
      all.sort((a, b) => a.place - b.place);
      const win = all[0]?.time;
      rows = all.map((r, i) => ({
        place: i + 1,
        name: r.name,
        color: r.color,
        isLocal: r.id === id,
        time: r.finished ? r.time : null,
        gap: r.finished && i > 0 && win != null && r.time != null ? r.time - win : null,
        best: null,
        status: r.dnf ? 'DNF' : 'racing…',
      }));
    }
    const mine = rows.find((r) => r.isLocal);
    return {
      title: this.spectator ? 'Race results' : mine ? `You finished ${this.ordinal(mine.place)}` : 'Race results',
      sub: `Online · Room ${this.net.room?.code || ''} · ${this.laps} lap${this.laps > 1 ? 's' : ''}${this.serverRows ? ' · official' : ' · waiting for riders…'}`,
      rows,
      finish: this.finishInfo,
      canSkip: false,
      rematchLabel: 'Back to lobby',
      menuLabel: 'Leave room',
    };
  }

  rematch() {
    this._wantLobby = true;
    this.net.backToLobby(false);
    if (this.net.room?.phase === 'lobby') this.onRoom(this.net.room);
    else if (!this.serverRows) this.app.ui.toast('Waiting for the race to finish…');
  }

  leaveResults() {
    this.net.leaveRoom(true);
    this.app.quitToMenu('mp');
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const rt = this.raceTime();
    if (this.phase === 'countdown') {
      this.tickCountdown(rt);
      if (rt >= 0) {
        if (this.me) this.me.bike.frozen = false;
        this.onGo();
      }
    }
    // ---- remote interpolation ----
    const renderTs = this.net.serverNow() - NET.interpDelay * 1000;
    for (const r of this.remotes.values()) this._interpolate(r, renderTs, dt);

    // ---- local prediction ----
    const inputRaw = this.app.input.read();
    const me = this.me;
    if (me) {
      const b = me.bike;
      const H = PHYSICS.dt;
      this.acc += dt;
      let steps = 0;
      const others = [...this.remotes.values()].filter((r) => !r.dnf && !r.offline).map((r) => r.st);
      while (this.acc >= H && steps < 24) {
        this.acc -= H;
        steps++;
        let inp = me.finished ? emptyInput() : inputRaw;
        if (me.autopilot) {
          inp = me.autopilot.update(b, others, this.track, H, { stats: me.stats, progress: 1, lap: 0, laps: 1 });
          inp.sprint = false;
          inp.boost = false;
          inp.throttle *= 0.45;
        }
        stepBike(b, inp, H, this.track, me.stats);
        inputRaw.boost = false;
        inputRaw.reset = false;
        interactBikes([{ bike: b, movable: true }, ...others.map((st) => ({ bike: st, movable: false }))], this.track, H);
      }
      if (steps >= 24) this.acc = 0;
      this.handleBikeEvents(b, consumeEvents(b));
      // stream to the server
      this.sendAcc += dt;
      if (this.sendAcc >= 1 / NET.clientSendRate && rt >= 0) {
        this.sendAcc = 0;
        this.net.sendState(b);
      }
      me.view.update(b, dt, this.app.time, this.app.renderer.camera.position);
    }
    for (const r of this.remotes.values()) {
      r.view.setVisible(!r.dnf);
      r.view.update(r.st, dt, this.app.time, this.app.renderer.camera.position);
    }
  }

  _interpolate(r, ts, dt) {
    const buf = r.buf;
    const st = r.st;
    if (!buf.length) return;
    let a = buf[0];
    let b = buf[0];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].ts <= ts) {
        a = buf[i];
        b = buf[i + 1] || buf[i];
        break;
      }
    }
    let k = b.ts > a.ts ? (ts - a.ts) / (b.ts - a.ts) : 0;
    let extra = 0;
    if (b === a && ts > a.ts) extra = Math.min(0.25, (ts - a.ts) / 1000); // brief extrapolation
    k = Math.max(0, Math.min(1, k));
    const L = (x, y) => x + (y - x) * k;
    st.u = L(a.u, b.u) + a.v * extra;
    st.s = this.track.wrap(st.u);
    st.d = L(a.d, b.d);
    st.yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * k;
    st.v = L(a.v, b.v);
    const yT = L(a.y, b.y);
    st.vy = (yT - st.y) / Math.max(dt, 1e-3);
    st.y = yT;
    st.lean = L(a.lean, b.lean);
    st.steer = L(a.steer, b.steer);
    const fl = a.fl;
    st.sprinting = !!(fl & FL.SPRINT);
    st.brake = fl & FL.BRAKE ? 1 : 0;
    st.airborne = !!(fl & FL.AIR);
    st.boostTimer = fl & FL.BOOST ? 0.3 : 0;
    st.throttle = fl & FL.THROTTLE ? 1 : 0;
    // animation drivers integrate locally
    if (st.throttle) st.crank += Math.min(st.sprinting ? 13 : 11.5, 3.5 + st.v * 0.45) * dt;
    st.brakeT = st.brake;
    st.wheel += (st.v / 0.34) * dt;
  }

  // ---------------------------------------------------------------- HUD / camera
  _leaderRemote() {
    let best = null;
    for (const r of this.remotes.values()) if (!best || r.place < best.place) best = r;
    return best;
  }

  get focusBike() {
    return this.me ? this.me.bike : this._leaderRemote()?.st;
  }

  get focusView() {
    return this.me ? this.me.view : this._leaderRemote()?.view;
  }

  hud() {
    const rt = this.raceTime();
    const me = this.me;
    const focus = this.focusBike;
    const riders = [];
    const list = [];
    for (const r of this.remotes.values()) {
      riders.push({ s: r.st.s, d: r.st.d, color: r.look.jersey, isLocal: !me && r === this._leaderRemote() });
      list.push({ name: r.name, color: r.look.jersey, isLocal: false, place: r.place, u: r.st.u, v: r.st.v, finished: r.finished, finishTime: r.finishTime });
    }
    if (me) {
      riders.push({ s: me.bike.s, d: me.bike.d, color: me.look.jersey, isLocal: true });
      list.push({ name: me.name, color: me.look.jersey, isLocal: true, place: me.place, u: me.bike.u, v: me.bike.v, finished: me.finished, finishTime: me.finishTime });
    }
    list.sort((a, b) => a.place - b.place);
    const lead = list[0];
    const L = this.track.length;
    return {
      place: me ? me.place : 0,
      total: list.length,
      time: Math.max(0, me?.finished && me.finishTime != null ? me.finishTime : rt),
      lap: Math.min((me ? me.lap : this._leaderRemote()?.lap || 0) + 1, this.laps),
      laps: this.laps,
      cp: me ? me.gate : 0,
      cpTotal: this.track.checkpoints.length,
      bike: focus,
      distLeft: Math.max(0, this.laps * L - (focus?.u || 0)),
      grade: this.track.sample(focus?.s || 0).slope,
      standings: list.map((r) => ({
        name: r.name,
        color: r.color,
        isLocal: r.isLocal,
        finished: r.finished,
        gap: r === lead ? null : r.finished && lead.finished && r.finishTime != null ? r.finishTime - lead.finishTime : (lead.u - r.u) / Math.max(8, r.v),
      })),
      riders,
      ghostDelta: null,
    };
  }

  riderPositions() {
    const out = [...this.remotes.values()].map((r) => r.view.position);
    if (this.me) out.push(this.me.view.position);
    return out;
  }

  otherBikes() {
    return [...this.remotes.values()].map((r) => ({ bike: r.st, view: r.view }));
  }

  restart() {}

  dispose() {
    this.me?.view.dispose();
    for (const r of this.remotes.values()) r.view.dispose();
  }
}
