// Shared race-session behaviour: countdown, feedback messages, finish flow, fx/audio hooks.
import { formatTime } from '../ui/format.js';

export class SessionBase {
  constructor(app) {
    this.app = app;
    this.phase = 'countdown';
    this.lastCount = null;
    this.paused = false;
    this.finishTimer = 0;
    this.lapTimes = [];
    this.splits = [];
  }

  profileLook() {
    const p = this.app.profile;
    return { frame: p.frame, jersey: p.jersey, accent: p.accent, outfit: p.outfit, skin: p.skin, bikeId: p.bikeId };
  }

  ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  startCountdown() {
    this.phase = 'countdown';
    this.app.chase.setMode('orbit');
    this.app.audio.setMusic('race');
    this.app.ui.showHud();
    this.app.ui.message('READY', this.app.track.name);
    this.app.world.props.setStartLights(0);
  }

  tickCountdown(raceTime) {
    if (this.phase !== 'countdown') return;
    const n = Math.ceil(-raceTime);
    if (n <= 3 && n >= 1 && n !== this.lastCount) {
      this.lastCount = n;
      this.app.ui.message(String(n), '', 'count');
      this.app.audio.play('count');
      this.app.audio.say(['One', 'Two', 'Three'][n - 1]);
      this.app.world.props.setStartLights(4 - n);
      this.app.audio.cheer(0.18 + (3 - n) * 0.08);
    }
  }

  onGo() {
    this.phase = 'racing';
    this.app.ui.message('GO!', '', 'go');
    this.app.audio.play('go');
    this.app.audio.say('Go!');
    this.app.audio.cheer(0.55);
    this.app.world.props.setStartLights(4);
    this.app.chase.setMode('chase');
    this.app.chase.kick = 0.35;
  }

  onCheckpoint(e, total, extra = '') {
    this.app.audio.play('checkpoint');
    this.app.ui.message(`CHECKPOINT ${e.gate + 1}/${total}`, formatTime(e.time) + extra, 'small');
    this.app.effects.burst(this.app.focusPos(), '#18c8ff', 26, 4, 0.1, 0.8, true, this.app.focusVel());
  }

  onLap(e, laps) {
    this.app.audio.play('lap');
    const final = e.lap === laps - 1;
    this.app.ui.message(final ? 'FINAL LAP' : `LAP ${e.lap + 1}/${laps}`, 'Lap time ' + formatTime(e.lapTime), 'small');
    if (final) this.app.audio.setMusic('final');
  }

  enterFinished() {
    this.phase = 'finished';
    this.finishTimer = 0;
    this.app.chase.setMode('finish');
    this.app.audio.play('finish');
    this.app.audio.setMusic('menu');
    this.app.ui.message('FINISH!', '', 'go');
    this.app.effects.confetti(this.app.focusPos());
    this.app.slowMo(1.5);
  }

  /** called by App every frame after update */
  postUpdate(dt) {
    if (this.phase === 'finished') {
      this.finishTimer += dt;
      if (this.finishTimer > 3.2) {
        this.phase = 'results';
        this.app.ui.showResults(this.results());
      }
    }
  }

  handleBikeEvents(bike, ev) {
    const a = this.app.audio;
    const fx = this.app.effects;
    const pos = this.app.focusPos();
    if (ev.boost) {
      a.play('boost');
      this.app.ui.flash('BOOST!');
    }
    if (ev.pad) {
      a.play('pad');
      fx.burst(pos, '#29e0ff', 30, 4, 0.1, 0.6, true, this.app.focusVel());
    }
    if (ev.jump) a.play('jump');
    if (ev.sling) {
      a.play('sling');
      this.app.ui.flash('SLINGSHOT!');
    }
    if (ev.land) {
      a.play('land');
      fx.landing(pos);
    }
    if (ev.wall) {
      a.play('wall');
      fx.burst(pos, '#ffd27a', 14, 4, 0.08, 0.35, true, this.app.focusVel());
    }
    if (ev.collide && !this._bumpCd) {
      a.play('bump');
      this._bumpCd = 0.4;
    }
    if (this._bumpCd) this._bumpCd = Math.max(0, this._bumpCd - 1 / 60);
    if (bike.sprinting && !this._wasSprinting) a.play('sprint');
    this._wasSprinting = bike.sprinting;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }
}
