// Offline race: player vs AI (Quick Race / AI Race) or solo vs ghost (Time Trial).
import { Race } from '@shared/race.js';
import { AI_NAMES, BIKES, COLORS, OUTFITS, XP, RACE_MODES, pickWeather } from '@shared/constants.js';
import { consumeEvents } from '@shared/physics.js';
import { makeRng } from '@shared/math.js';
import { RiderView } from '../entities/RiderView.js';
import { loadGhost, saveGhost, addXp, saveProfile } from '../core/Storage.js';
import { SessionBase } from './SessionBase.js';

const SKILL_ORDER = ['easy', 'medium', 'hard', 'elite'];

export class LocalSession extends SessionBase {
  constructor(app, opts) {
    super(app);
    this.opts = opts;
    this.mode = opts.mode;
    const { track, profile, settings } = app;
    this.weather = pickWeather(opts.weather || track.def.env?.weather || 'clear');
    app.world.weather.apply(this.weather);
    this.race = new Race(track, { laps: opts.laps, countdown: 4.2, weather: this.weather });
    const look = this.profileLook();
    this.player = this.race.addRacer({
      id: 'local',
      name: profile.name,
      look,
      bikeId: profile.bikeId,
      assist: settings.assist ? 0.85 : 0,
      slot: opts.ai > 0 ? Math.min(opts.ai, 7) : 1,
    });
    const rng = makeRng((Date.now() & 0xffff) + 7);
    const names = [...AI_NAMES].sort(() => rng() - 0.5);
    const baseIdx = SKILL_ORDER.indexOf(opts.skill);
    for (let i = 0; i < opts.ai; i++) {
      // spread skills around the chosen difficulty
      const off = i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : i < 3 ? 0 : 1;
      const skill = SKILL_ORDER[Math.max(0, Math.min(3, baseIdx + off))];
      const slot = i < this.player.slot ? i : i + 1;
      this.race.addRacer({
        id: 'ai' + i,
        name: names[i % names.length],
        isBot: true,
        skill,
        slot,
        seed: Math.floor(rng() * 1e6),
        bikeId: BIKES[Math.floor(rng() * BIKES.length)].id,
        look: {
          frame: COLORS[Math.floor(rng() * COLORS.length)],
          jersey: COLORS[Math.floor(rng() * COLORS.length)],
          accent: COLORS[Math.floor(rng() * COLORS.length)],
          outfit: OUTFITS[Math.floor(rng() * OUTFITS.length)].id,
          skin: ['#f1c7a6', '#e0ac8a', '#c68863', '#8d5a3b'][Math.floor(rng() * 4)],
        },
      });
    }
    for (const r of this.race.racers) {
      r.look.bikeId = r.bikeId;
      r.view = new RiderView(app.renderer.scene, track, { name: r.name, look: r.look, isLocal: r === this.player, night: app.world.theme.night });
    }
    // ghost for time trial
    this.ghostKey = `${track.id}.${opts.laps}`;
    if (this.mode === 'timetrial') {
      this.ghostData = loadGhost(this.ghostKey);
      this.recording = [];
      this.recT = 0;
      if (this.ghostData?.frames?.length) {
        this.ghostView = new RiderView(app.renderer.scene, track, { name: 'Ghost', look, ghost: true });
      }
    }
    this.localRacer = this.player;
    this.startCountdown();
  }

  get canPause() {
    return true;
  }

  update(dt) {
    const app = this.app;
    if (this.paused) return;
    const inp = app.input.read();
    if (!this.player.finished) Object.assign(this.player.input, inp);
    // offline races hold the countdown while the controls card is up (online ones follow the server clock)
    if (!app.ui.controlsCardOpen) this.race.update(dt);
    this.tickCountdown(this.race.time);
    for (const e of this.race.drainEvents()) this.handleEvent(e);
    this.handleBikeEvents(this.player.bike, consumeEvents(this.player.bike));
    for (const r of this.race.racers) if (r !== this.player) consumeEvents(r.bike);

    // ghost playback + recording
    if (this.mode === 'timetrial') {
      if (this.race.phase === 'racing' && !this.player.finished) {
        this.recT += dt;
        if (this.recT >= 0.1) {
          this.recT = 0;
          const b = this.player.bike;
          this.recording.push([+b.u.toFixed(2), +b.d.toFixed(2), +b.y.toFixed(2), +b.yaw.toFixed(3), +b.lean.toFixed(3), +b.v.toFixed(2)]);
        }
      }
      if (this.ghostView) this.updateGhost(dt);
    }
    this.syncViews(dt);
  }

  updateGhost(dt) {
    const f = this.ghostData.frames;
    const t = Math.max(0, this.race.time) / 0.1;
    const i = Math.min(f.length - 2, Math.floor(t));
    const a = f[i];
    const b = f[i + 1] || a;
    const k = Math.min(1, t - i);
    const L = (x, y) => x + (y - x) * k;
    const u = L(a[0], b[0]);
    this._ghostCrank = (this._ghostCrank || 0) + a[5] * 0.62 * dt;
    this._ghostWheel = (this._ghostWheel || 0) + (a[5] / 0.34) * dt;
    const st = {
      s: this.app.track.wrap(u),
      d: L(a[1], b[1]),
      y: L(a[2], b[2]),
      yaw: a[3] + Math.atan2(Math.sin(b[3] - a[3]), Math.cos(b[3] - a[3])) * k,
      lean: L(a[4], b[4]),
      v: L(a[5], b[5]),
      crank: this._ghostCrank,
      wheel: this._ghostWheel,
      steer: 0,
      throttle: 1,
      brake: 0,
      sprinting: false,
      airborne: false,
    };
    this.ghostView.setVisible(this.race.time > 0);
    this.ghostView.update(st, dt, this.app.time, this.app.renderer.camera.position);
  }

  syncViews(dt) {
    const cam = this.app.renderer.camera.position;
    for (const r of this.race.racers) r.view.update(r.bike, dt, this.app.time, cam);
  }

  handleEvent(e) {
    const isMe = e.id === this.player.id;
    if (e.type === 'go') this.onGo();
    if (!isMe) {
      if (e.type === 'finish' && e.place === 1) this.app.ui.toast(`${this.race.byId.get(e.id).name} wins the race!`);
      if (this.phase === 'results') this.app.ui.refreshResults(this.results());
      return;
    }
    if (e.type === 'checkpoint') this.onCheckpoint(e, this.race.gates.length - 1);
    else if (e.type === 'lap') this.onLap(e, this.race.laps);
    else if (e.type === 'finish') this.onLocalFinish();
  }

  onLocalFinish() {
    const p = this.player;
    p.bike.celebrate = true;
    setTimeout(() => (p.bike.celebrate = false), 4500);
    const prof = this.app.profile;
    const n = this.race.racers.length;
    const place = p.place;
    // XP + records
    let xp = XP.finishBase;
    const lines = [[`Finished ${this.ordinal(place)}`, XP.finishBase]];
    if (n > 1) {
      const beaten = n - place;
      if (beaten > 0) {
        xp += beaten * XP.perPositionAhead;
        lines.push([`Beat ${beaten} rival${beaten > 1 ? 's' : ''}`, beaten * XP.perPositionAhead]);
      }
      if (place === 1) {
        xp += XP.win;
        lines.push(['Victory bonus', XP.win]);
      }
    }
    const bestKey = `${this.app.track.id}.${this.mode}.${this.race.laps}`;
    const prevBest = prof.best[bestKey];
    let newRecord = false;
    if (!prevBest || p.finishTime < prevBest) {
      prof.best[bestKey] = p.finishTime;
      newRecord = true;
      if (prevBest) {
        xp += XP.bestLap;
        lines.push(['New personal best', XP.bestLap]);
      }
    }
    prof.races++;
    if (place === 1 && n > 1) prof.wins++;
    saveProfile(prof);
    const xpRes = addXp(prof, xp);
    if (this.mode === 'timetrial' && (newRecord || !this.ghostData)) {
      saveGhost(this.ghostKey, { time: p.finishTime, frames: this.recording });
    }
    this.finishInfo = { xp: xpRes, lines, newRecord, prevBest };
    this.enterFinished();
  }

  results() {
    const s = this.race.standings();
    const winner = s[0]?.finishTime;
    return {
      title: this.mode === 'timetrial' ? 'Time trial complete' : `You finished ${this.ordinal(this.player.place)}`,
      sub: `${this.app.track.name} · ${this.race.laps} lap${this.race.laps > 1 ? 's' : ''} · ${RACE_MODES[this.mode].name}`,
      rows: s.map((r, i) => ({
        place: i + 1,
        name: r.name,
        color: r.look.jersey,
        isLocal: r === this.player,
        time: r.finished ? r.finishTime : null,
        gap: r.finished && winner != null && i > 0 ? r.finishTime - winner : null,
        best: r.bestLap,
        status: r.finished ? '' : r.dnf ? 'DNF' : 'racing…',
      })),
      finish: this.finishInfo,
      canSkip: !this.race.allDone,
      ghost: this.mode === 'timetrial' ? this.ghostData?.time ?? null : undefined,
      rematchLabel: 'Rematch',
    };
  }

  skipToEnd() {
    this.race.simulateToEnd();
    this.race.drainEvents();
    this.app.ui.refreshResults(this.results());
  }

  // ---- HUD ----
  hud() {
    const p = this.player;
    const b = p.bike;
    const L = this.app.track.length;
    const standings = this.race.standings();
    const leader = standings[0];
    return {
      place: p.place,
      total: this.race.racers.length,
      time: Math.max(0, p.finished ? p.finishTime : this.race.time),
      lap: Math.min(p.lap + 1, this.race.laps),
      laps: this.race.laps,
      cp: p.gate,
      cpTotal: this.race.gates.length - 1,
      bike: b,
      distLeft: Math.max(0, this.race.laps * L - b.u),
      grade: this.app.track.sample(b.s).slope,
      standings: standings.map((r) => ({
        name: r.name,
        color: r.look.jersey,
        isLocal: r === p,
        gap: r === leader ? null : r.finished && leader.finished ? r.finishTime - leader.finishTime : (leader.bike.u - r.bike.u) / Math.max(8, r.bike.v),
        finished: r.finished,
      })),
      riders: this.race.racers.map((r) => ({ s: r.bike.s, d: r.bike.d, color: r.look.jersey, isLocal: r === p })),
      ghostDelta: this.ghostDelta(),
    };
  }

  ghostDelta() {
    if (!this.ghostData || this.race.time <= 0) return null;
    const f = this.ghostData.frames;
    const u = this.player.bike.u;
    // time the ghost reached our current distance
    let lo = 0;
    let hi = f.length - 1;
    if (u > f[hi][0]) return null;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (f[m][0] < u) lo = m;
      else hi = m;
    }
    const tg = lo * 0.1 + ((u - f[lo][0]) / Math.max(0.01, f[hi][0] - f[lo][0])) * 0.1;
    return this.race.time - tg;
  }

  get focusBike() {
    return this.player.bike;
  }

  get focusView() {
    return this.player.view;
  }

  riderPositions() {
    return this.race.racers.map((r) => r.view.position);
  }

  otherBikes() {
    return this.race.racers.filter((r) => r !== this.player).map((r) => ({ bike: r.bike, view: r.view }));
  }

  restart() {
    this.app.startLocal(this.opts);
  }

  dispose() {
    for (const r of this.race.racers) r.view.dispose();
    this.ghostView?.dispose();
  }
}

