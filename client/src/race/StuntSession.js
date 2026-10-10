// Stunt mode session. Solo: the local run is the whole game. Friend challenge (net): every
// rider simulates their own run of the same level locally (same physics/rules as solo, base
// bike stats), streams state + trick angles to the room, and the server keeps the clock,
// checkpoints, finish and validates the reported score before ranking.
import { NET } from '@shared/constants.js';
import { FL } from '@shared/protocol.js';
import { wrapAngle } from '@shared/math.js';
import { consumeEvents } from '@shared/physics.js';
import { STUNT_LEVEL_BY_ID, STUNT_LEVELS, levelIndex } from '@shared/stunts/levels.js';
import { buildCourse } from '@shared/stunts/course.js';
import { StuntRun } from '@shared/stunts/run.js';
import { objectiveProgress, starsFor } from '@shared/stunts/objectives.js';
import { STUNT_BIKE_BY_ID } from '@shared/stunts/bikes.js';
import { NITRO } from '@shared/stunts/config.js';
import { RiderView } from '../entities/RiderView.js';
import { skyName } from '../world/StuntWorld.js';
import { SessionBase } from './SessionBase.js';
import { addXp } from '../core/Storage.js';
import { stuntData, recordSoloRun, addRunStats, checkAchievements, isUnlocked, recordChallengeCoins, missionList } from '../core/stuntProfile.js';
import { analytics } from '../core/analytics.js';

const LANES = [0, -2.4, 2.4, -4.2, 4.2, -1.2, 1.2, 3.3];

export class StuntSession extends SessionBase {
  /**
   * @param opts {levelId}  solo
   * @param net NetClient + start message for a friend challenge
   */
  constructor(app, opts, net = null, start = null) {
    super(app);
    this.isStunt = true;
    this.isNet = !!net;
    this.net = net;
    this.opts = opts;
    this.level = STUNT_LEVEL_BY_ID[opts.levelId] || STUNT_LEVELS[0];
    this.course = buildCourse(this.level);
    this.menuAfter = net ? 'mp' : 'stunt';
    const sd = stuntData(app.profile);
    const scene = app.renderer.scene;
    // the sky course itself is part of the stunt world (built by App.loadStuntWorld)
    this.world = app.world;
    this.remotes = new Map();
    this.sendAcc = 0;
    this.doneSent = false;
    this.serverRows = null;
    this.events = [];
    this.pose = { pitch: 0, spin: 0, drop: 0 };
    this.dropV = 0;
    this.fall = 0;
    let slot = 0;
    let bikeId = sd.bikeId;
    if (net) {
      this.goAt = start.goAt;
      const mine = start.grid.find((g) => g.id === net.id);
      this.spectator = !!start.spectator || !mine;
      if (mine) {
        slot = mine.slot;
        bikeId = mine.bikeId;
      }
      for (const g of start.grid) {
        if (g.id === net.id && !this.spectator) continue;
        const look = { ...(g.look || {}), bikeId: g.bikeId };
        const u = this.course.startU;
        const c = this.course.track.sample(this.course.track.wrap(u));
        this.remotes.set(g.id, {
          id: g.id,
          name: g.name,
          look,
          buf: [],
          view: new RiderView(scene, this.course.track, { name: g.name, look, night: app.world.theme.night }),
          st: { u, s: this.course.track.wrap(u), d: LANES[g.slot % LANES.length], yaw: c.head, v: 0, y: c.y, vy: 0, lean: 0, steer: 0, crank: 0, wheel: 0, sprinting: false, brake: 0, airborne: false, landing: 0, bump: 0, throttle: 0, draft: 0, boostTimer: 0, stamina: 100, trick: { pitch: 0, spin: 0 }, ev: {} },
          score: 0,
          finished: false,
          dnf: false,
          offline: false,
        });
      }
    }
    this.bikeId = STUNT_BIKE_BY_ID[bikeId] ? bikeId : 'allround';
    // challenges: base bike stats for everyone (no upgrades); solo: your upgrades
    this.run = new StuntRun(this.course, {
      bikeId: this.bikeId,
      upgrades: net ? null : sd.upgrades,
      assist: app.settings.assist ? 0.85 : 0,
      countdown: net ? Math.max(0.1, -this.raceTime()) : 3.2,
      d: LANES[slot % LANES.length],
    });
    this.run.bike.trick = this.pose;
    if (this.world.isStunt) this.world.run = this.spectator ? null : this.run;
    const look = { ...this.profileLook(), bikeId: this.bikeId };
    this.view = new RiderView(scene, this.course.track, { name: app.profile.name, look, isLocal: true, night: app.world.theme.night });
    if (this.spectator) this.view.setVisible(false);
    document.body.classList.add('stunt-mode');
    app.ui.stunt?.onSessionStart(this);
    analytics.track(net ? 'stunt_challenge' : 'stunt_start', { m: this.level.map, md: 'stunt', x: this.level.id, v: this.level.n });
    if (this.spectator) {
      app.ui.showHud();
      app.ui.message('SPECTATING', 'You will join the next challenge', 'small');
      this.phase = this.raceTime() >= 0 ? 'racing' : 'countdown';
      app.chase.setMode('chase');
    } else {
      this.startCountdown();
      app.ui.message('READY', this.level.name);
    }
  }

  get canPause() {
    return !this.isNet;
  }

  raceTime() {
    return this.isNet ? (this.net.serverNow() - this.goAt) / 1000 : this.run.state.time;
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    const app = this.app;
    if (this.paused) return;
    const inp = app.input.read();
    const run = this.run;
    if (this.isNet) {
      const rt = this.raceTime();
      if (run.state.phase === 'countdown') run.state.time = Math.min(rt, -1e-4);
      this.tickCountdown(rt);
      if (rt >= 0 && !this.spectator) run.update(inp, dt);
      else if (!this.spectator) run.step(inp, 0); // frozen bike: wheels only
      this._remotes(dt);
    } else {
      // solo holds the countdown while the controls card is up
      if (!(run.state.phase === 'countdown' && app.ui.controlsCardOpen)) run.update(inp, dt);
      this.tickCountdown(run.state.time);
    }
    if (!this.spectator) {
      for (const e of run.drainEvents()) this.onRunEvent(e);
      this.handleBikeEvents(run.bike, consumeEvents(run.bike));
      this._pose(dt);
      this.view.update(run.bike, dt, app.time, app.renderer.camera.position);
      if (this.isNet) this._send(dt);
    }
  }

  _pose(dt) {
    const S = this.run.state;
    const b = S.bike;
    this.pose.pitch = S.T.pitch;
    this.pose.spin = S.T.spin;
    b.celebrate = S.T.styleOn || (this.phase === 'finished' && S.result?.complete);
    // crash: the bike falls over on its side until the respawn
    const fallT = S.phase === 'crashed' ? 1 : 0;
    this.fall += (fallT - this.fall) * Math.min(1, dt * 9);
    if (S.phase === 'crashed') b.lean = this.fall * 1.3 * (this._fallSide || 1);
    // missed a gap: the rider drops through the hole towards the clouds (visual only)
    if (S.phase === 'crashed' && this._intoGap) {
      this.dropV += 14 * dt;
      this.pose.drop = Math.min(60, this.pose.drop + this.dropV * dt);
    } else if (S.phase !== 'crashed') {
      this.pose.drop = 0;
      this.dropV = 0;
    }
  }

  onRunEvent(e) {
    const app = this.app;
    const ui = app.ui;
    const pos = app.focusPos();
    switch (e.type) {
      case 'go':
        this.onGo();
        break;
      case 'land':
        ui.stunt?.trickPopup(e);
        if (e.names.length || e.points >= 1000) app.audio.play('checkpoint');
        if (e.perfect) app.effects.burst(pos, '#7dffb0', 18, 3, 0.08, 0.5, true, app.focusVel());
        if (e.target) app.effects.burst(pos, '#ff2d55', 30, 4, 0.1, 0.7, true, app.focusVel());
        break;
      case 'ring':
        app.audio.play('pad');
        app.effects.burst(pos, '#ffd000', 24, 4, 0.1, 0.6, true, app.focusVel());
        ui.stunt?.flashLine('RING!');
        break;
      case 'crash':
        this._fallSide = Math.random() < 0.5 ? -1 : 1;
        this._intoGap = /gap/i.test(e.reason);
        app.audio.play('wall');
        app.effects.burst(pos, '#ffd27a', 26, 5, 0.1, 0.6, true, app.focusVel());
        ui.message('CRASH', e.reason, 'small');
        ui.stunt?.comboBroken();
        break;
      case 'respawn':
        this.fall = 0;
        app.chase.snapBehind(app._buildTarget());
        if (e.manual) ui.message('RESPAWN', e.gate >= 0 ? 'Back to the last checkpoint' : 'Back to the start', 'small');
        break;
      case 'checkpoint':
        this.onCheckpoint({ gate: e.gate, time: e.time }, e.total);
        break;
      case 'nitro':
        app.audio.play('boost');
        ui.flash('NITRO!');
        break;
      case 'finish':
      case 'fail':
        this.onRunEnd(e);
        break;
      default:
    }
  }

  // ---------------------------------------------------------------- end of run
  onRunEnd(e) {
    const app = this.app;
    const run = this.run;
    const st = run.state.st;
    const level = this.level;
    const prof = app.profile;
    const complete = e.type === 'finish' && e.complete;
    if (this.isNet) {
      this._sendDone();
      addRunStats(prof, st, { completed: complete, challenge: true });
      this.endInfo = { complete, fail: e.type === 'fail' ? e.reason : null };
      this.enterFinished(complete ? 'FINISH!' : e.type === 'fail' ? 'TIME UP' : 'FINISH');
      return;
    }
    const res = run.state.result;
    const stars = starsFor(level, complete, res.score);
    const reward = recordSoloRun(prof, level, res, stars);
    addRunStats(prof, st, { completed: complete });
    const ach = checkAchievements(prof);
    // a little XP for the shared rider level (stunt coins are the main reward)
    const xpLines = [['Stunt run', 40]];
    let xp = 40;
    const bonus = Math.min(160, Math.floor(res.score / 250));
    if (bonus > 0) {
      xp += bonus;
      xpLines.push(['Stunt points', bonus]);
    }
    if (complete && reward.prevStars === 0) {
      xp += 60;
      xpLines.push(['Level cleared', 60]);
    }
    prof.races++;
    const xpRes = addXp(prof, xp);
    const sd = stuntData(prof);
    const idx = levelIndex(level.id);
    const next = STUNT_LEVELS[idx + 1];
    this.endInfo = {
      complete,
      fail: e.type === 'fail' ? e.reason : null,
      stars,
      reward,
      achievements: ach,
      missionsReady: missionList(sd).filter((m) => m.done).length,
      next: next && isUnlocked(sd, next.id) ? next : null,
      xp: xpRes,
      xpLines,
    };
    analytics.track('stunt_finish', { m: level.map, md: 'stunt', x: level.id, v: complete ? stars : 0, v2: res.score });
    this.enterFinished(complete ? 'LEVEL COMPLETE!' : e.type === 'fail' ? 'OUT OF TIME' : 'FINISH');
  }

  enterFinished(text) {
    this.phase = 'finished';
    this.finishTimer = 0;
    this.app.chase.setMode('finish');
    this.app.audio.play('finish');
    this.app.audio.setMusic('menu');
    this.app.ui.message(text, this.endInfo?.complete === false && !this.isNet ? 'Objectives not met' : '', 'go');
    if (this.endInfo?.complete) this.app.effects.confetti(this.app.focusPos());
    this.app.slowMo(1.2);
  }

  postUpdate(dt) {
    if (this.phase === 'finished') {
      this.finishTimer += dt;
      if (this.finishTimer > 2.6) {
        this.phase = 'results';
        this.app.ui.showResults(this.results());
      }
    }
  }

  results() {
    const level = this.level;
    const st = this.run.state.st;
    const res = this.run.state.result || { complete: false, score: st.score, time: this.run.state.time };
    const objectives = objectiveProgress(level, st, this.run.state.phase === 'finished');
    if (this.isNet) {
      const id = this.net.id;
      const rows = (this.serverRows || this._liveRows()).map((r, i) => ({ ...r, place: i + 1, isLocal: r.id === id }));
      const mine = rows.find((r) => r.isLocal);
      return {
        title: this.spectator ? 'Challenge results' : mine ? `You placed ${this.ordinal(mine.place)}` : 'Challenge results',
        sub: `Stunt challenge · L${level.n} ${level.name} · Room ${this.net.room?.code || ''}${this.serverRows ? ' · official' : ' · waiting for riders…'}`,
        columns: ['#', 'Rider', 'Score', 'Time'],
        rows,
        finish: this.challengeFinish || null,
        stunt: this.spectator ? null : { challenge: true, score: res.score, objectives, complete: !!this.endInfo?.complete, time: res.time },
        canSkip: false,
        rematchLabel: 'Back to lobby',
        menuLabel: 'Leave room',
      };
    }
    const info = this.endInfo || {};
    const goal = info.next ? { title: info.complete ? `Next: L${info.next.n} ${info.next.name}` : 'Keep practising', sub: info.next.desc, action: { label: 'Next level', stunt: info.next.id, kind: 'stunt_next' } } : null;
    return {
      title: info.complete ? `Level complete · ${'★'.repeat(info.stars)}${'☆'.repeat(3 - info.stars)}` : info.fail ? info.fail : 'Objectives not met',
      sub: `Stunt L${level.n} · ${level.name} · ${skyName(level)} sky course`,
      rows: [],
      stunt: {
        score: res.score,
        time: res.time,
        complete: info.complete,
        stars: info.stars || 0,
        objectives,
        reward: info.reward,
        achievements: info.achievements || [],
        missionsReady: info.missionsReady || 0,
        level,
      },
      finish: info.xp ? { xp: info.xp, lines: info.xpLines, newRecord: !!info.reward?.newBest, goal } : null,
      canSkip: false,
      rematchLabel: 'Retry',
      menuLabel: 'Stunt levels',
    };
  }

  restart() {
    this.app.startStunt(this.level.id, { source: 'retry' });
  }

  rematch() {
    if (!this.isNet) return this.restart();
    this._wantLobby = true;
    this.net.backToLobby(false);
    if (this.net.room?.phase === 'lobby') this.onRoom(this.net.room);
    else if (!this.serverRows) this.app.ui.toast('Waiting for the other riders…');
  }

  leaveResults() {
    if (!this.isNet) return this.app.quitToMenu('stunt');
    this.net.leaveRoom(true);
    this.app.quitToMenu('mp');
  }

  skipToEnd() {}

  // ---------------------------------------------------------------- HUD
  hud() {
    const run = this.run;
    const S = run.state;
    const b = this.focusBike;
    const course = this.course;
    const L = course.finishU - course.startU;
    // speed hint for the next jump that has a ring / target / gap
    let hint = null;
    if (!this.spectator) {
      const f = course.features.find((x) => x.jump && (x.lipS ?? x.s1) > b.u - 1 && (x.lipS ?? x.s1) - b.u < 160);
      if (f) {
        const ring = course.rings.find((r) => r.feature === f.i && !S.ringsTaken[r.i]);
        const tgt = course.targets.find((t) => t.feature === f.i && !S.targetsTaken[t.i]);
        if (ring) hint = { kind: 'RING', kmh: Math.round(ring.v * 3.6) };
        else if (tgt) hint = { kind: 'TARGET', kmh: Math.round(tgt.v * 3.6) };
        else if (f.minV) hint = { kind: 'GAP', kmh: Math.round(f.minV * 3.6), min: true };
      }
    }
    return {
      place: 1,
      total: 1 + this.remotes.size,
      time: Math.max(0, S.result ? S.result.time : this.raceTime()),
      lap: 1,
      laps: 1,
      cp: S.gate,
      cpTotal: course.gates.length,
      bike: b,
      distLeft: Math.max(0, course.finishU - b.u),
      grade: course.track.sample(b.s).slope,
      standings: [],
      riders: this._riders(),
      ghostDelta: null,
      stunt: {
        score: S.st.score,
        combo: S.st.combo,
        comboT: S.comboT,
        nitro: S.nitro / NITRO.max,
        nitroReady: S.nitro >= NITRO.cost,
        objectives: objectiveProgress(this.level, S.st, false),
        timeLimit: run.timeLimit,
        time: Math.max(0, this.raceTime()),
        progress: Math.max(0, Math.min(1, (b.u - course.startU) / L)),
        hint,
        crashed: S.phase === 'crashed',
        air: S.T.air ? S.T.airT : 0,
        others: [...this.remotes.values()].map((r) => ({ name: r.name, score: r.score, finished: r.finished, color: r.look.jersey })),
      },
    };
  }

  _riders() {
    const out = [];
    for (const r of this.remotes.values()) out.push({ s: r.st.s, d: r.st.d, color: r.look.jersey, isLocal: false });
    if (!this.spectator) out.push({ s: this.run.bike.s, d: this.run.bike.d, color: this.app.profile.jersey, isLocal: true });
    return out;
  }

  get focusBike() {
    if (!this.spectator) return this.run.bike;
    const r = [...this.remotes.values()][0];
    return r ? r.st : this.run.bike;
  }

  get focusView() {
    if (!this.spectator) return this.view;
    const r = [...this.remotes.values()][0];
    return r ? r.view : this.view;
  }

  riderPositions() {
    const out = [...this.remotes.values()].map((r) => r.view.position);
    out.push(this.view.position);
    return out;
  }

  otherBikes() {
    return [...this.remotes.values()].map((r) => ({ bike: r.st, view: r.view }));
  }

  // ---------------------------------------------------------------- network (challenge)
  _send(dt) {
    const rt = this.raceTime();
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / NET.clientSendRate && rt >= 0 && !this.doneSent) {
      this.sendAcc = 0;
      this.net.sendStuntState(this.run);
    }
  }

  _sendDone() {
    if (this.doneSent) return;
    this.doneSent = true;
    const S = this.run.state;
    const st = S.st;
    this.net.sendStuntDone({
      score: st.score,
      complete: !!S.result?.complete,
      fail: S.phase === 'failed',
      time: S.result?.time ?? S.time,
      st: { flips: st.flips, spins: st.spins, maxFlipsJump: st.maxFlipsJump, maxSpinsJump: st.maxSpinsJump, jumps: st.jumps, crashes: st.crashes, airTotal: Math.round(st.airTotal * 100) / 100 },
    });
  }

  onSnap(m) {
    for (const p of m.p) {
      const [id, u, d, yaw, v, y, lean, steer, fl, , , , , , , tp, ts, , score] = p;
      if (id === this.net.id && !this.spectator) continue;
      const r = this.remotes.get(id);
      if (!r) continue;
      r.buf.push({ ts: m.ts, u, d, yaw, v, y, lean, steer, fl, tp: tp || 0, ts2: ts || 0 });
      if (r.buf.length > 30) r.buf.shift();
      r.finished = !!(fl & FL.FINISHED);
      r.dnf = !!(fl & FL.DNF);
      r.offline = !!(fl & FL.OFFLINE);
      r.score = score || 0;
    }
  }

  _remotes(dt) {
    const ts = this.net.serverNow() - NET.interpDelay * 1000;
    const cam = this.app.renderer.camera.position;
    for (const r of this.remotes.values()) {
      const buf = r.buf;
      const st = r.st;
      if (buf.length) {
        let a = buf[0];
        let b = buf[0];
        for (let i = buf.length - 1; i >= 0; i--) {
          if (buf[i].ts <= ts) {
            a = buf[i];
            b = buf[i + 1] || buf[i];
            break;
          }
        }
        const k = b.ts > a.ts ? Math.max(0, Math.min(1, (ts - a.ts) / (b.ts - a.ts))) : 0;
        const L = (x, y) => x + (y - x) * k;
        st.u = L(a.u, b.u);
        st.s = this.course.track.wrap(st.u);
        st.d = L(a.d, b.d);
        st.yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * k;
        st.v = L(a.v, b.v);
        const yT = L(a.y, b.y);
        st.vy = (yT - st.y) / Math.max(dt, 1e-3);
        st.y = yT;
        st.lean = L(a.lean, b.lean);
        st.steer = L(a.steer, b.steer);
        st.trick.pitch = L(a.tp, b.tp);
        st.trick.spin = L(a.ts2, b.ts2);
        st.airborne = !!(a.fl & FL.AIR);
        st.throttle = a.fl & FL.THROTTLE ? 1 : 0;
        st.boostTimer = a.fl & FL.BOOST ? 0.3 : 0;
        if (st.throttle) st.crank += Math.min(11.5, 3.5 + st.v * 0.45) * dt;
        st.wheel += (st.v / 0.34) * dt;
      }
      r.view.setVisible(!r.dnf);
      r.view.update(st, dt, this.app.time, cam);
    }
  }

  _liveRows() {
    const rows = [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, color: r.look.jersey, score: r.score, time: null, status: r.finished ? 'finished' : r.dnf ? 'DNF' : 'riding…' }));
    if (!this.spectator) rows.push({ id: this.net.id, name: this.app.profile.name, color: this.app.profile.jersey, score: this.run.state.st.score, time: this.run.state.result?.time ?? null, status: this.run.done ? '' : 'riding…' });
    return rows.sort((a, b) => b.score - a.score);
  }

  onEvent(m) {
    if (m.e === 'finish' && m.id !== this.net.id) {
      const r = this.remotes.get(m.id);
      if (r) this.app.ui.toast(`${r.name} finished: ${(m.score || 0).toLocaleString('en-US')} pts`, 2200);
    }
  }

  onCorrect(m) {
    if (this.spectator) return;
    const b = this.run.bike;
    b.u = m.u;
    b.s = this.course.track.wrap(m.u);
    b.d = m.d;
    b.v = Math.min(b.v, m.v);
  }

  onResume(m) {
    this.goAt = m.goAt;
  }

  onResults(m) {
    this.serverRows = m.rows.map((r) => ({ id: r.id, name: r.name, color: r.color, score: r.score ?? 0, time: r.time, status: r.status, complete: r.complete }));
    const me = m.rows.find((r) => r.id === this.net.id);
    if (me && !this.spectator && !this.challengeFinish) {
      const humans = m.rows.filter((r) => !r.bot).length;
      const won = me.place === 1 && humans > 1;
      const coins = recordChallengeCoins(this.app.profile, won);
      const ach = checkAchievements(this.app.profile);
      const xpLines = [['Stunt challenge', 50]];
      let xp = 50;
      if (won) {
        xp += 80;
        xpLines.push(['Challenge win', 80]);
      }
      this.app.profile.races++;
      this.challengeFinish = { xp: addXp(this.app.profile, xp), lines: xpLines, newRecord: false, coins, achievements: ach };
    }
    if (this.phase === 'results') this.app.ui.refreshResults(this.results());
    else if (this.spectator || !this.run.done) {
      this.phase = 'results';
      this.app.chase.setMode('finish');
      this.app.ui.showResults(this.results());
    }
  }

  onRoom(room) {
    if (room.phase === 'lobby' && this.phase === 'results' && this._wantLobby) {
      this.app.endSession();
      // back to the racing world behind the lobby (the sky course is rebuilt on the next start)
      this.app.leaveStuntWorld().then(() => {
        this.app.ui.showMenu('lobby');
        this.app.ui.renderLobby(this.net.room || room, this.net.id);
      });
    }
  }

  onConnectionLost() {
    this.app.ui.message('RECONNECTING…', '', 'small');
  }

  dispose() {
    this.view.dispose();
    for (const r of this.remotes.values()) r.view.dispose();
    if (this.world.isStunt) this.world.run = null;
    document.body.classList.remove('stunt-mode');
    this.app.ui.stunt?.onSessionEnd();
  }
}
