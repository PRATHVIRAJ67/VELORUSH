// Top-level game orchestrator: owns renderer, world, audio, input, UI and the active session.
import * as THREE from 'three';
import { getTrack } from '@shared/tracks.js';
import { Race } from '@shared/race.js';
import { AI_NAMES, BIKES, COLORS, OUTFITS } from '@shared/constants.js';
import { consumeEvents } from '@shared/physics.js';
import { Renderer } from '../render/Renderer.js';
import { World } from '../world/World.js';
import { Input } from '../input/Input.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { UI } from '../ui/UI.js';
import { Effects } from '../fx/Effects.js';
import { ChaseCamera } from '../camera/ChaseCamera.js';
import { RiderView } from '../entities/RiderView.js';
import { LocalSession } from '../race/LocalSession.js';
import { NetClient } from '../net/NetClient.js';
import { loadSettings, loadProfile, saveSettings } from './Storage.js';
import { enterMobileFullscreen, keepMobileFullscreen } from './device.js';

export class App {
  constructor() {
    this.track = null;
    this.settings = loadSettings();
    this.profile = loadProfile();
    this.time = 0;
    this.session = null;
    this.demo = null;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.crowdLevel = 0;
    this.timeScale = 1;
    this.slowMoT = 0;
    this.crowdT = 0;
    this._focus = new THREE.Vector3();
    this._target = { position: new THREE.Vector3(), yaw: 0, v: 0, lean: 0, bump: 0, airborne: false, boost: false, inTunnel: false };
  }

  async init() {
    const root = document.getElementById('app');
    this.renderer = new Renderer(root);
    this.input = new Input();
    this.audio = new AudioEngine(this.settings);
    this.ui = new UI(this);
    this.net = new NetClient(this);
    await this.loadTrack(this.settings.track || 'mountain', true);

    this.input.on('pause', () => this.togglePause());
    this.input.on('camera', () => {
      if (!this.session) return;
      this.settings.cam = this.chase.cycleDistance();
      this.ui.toast(['Close camera', 'Normal camera', 'Far camera'][this.settings.cam], 900);
    });
    this.input.on('mute', () => this.ui.toast(this.audio.toggleMute() ? 'Sound muted' : 'Sound on', 900));
    // first interaction unlocks audio
    const unlock = () => {
      this.audio.init();
      this.audio.setMusic(this.session ? 'race' : 'menu');
      for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.removeEventListener(ev, unlock);
    };
    // iOS Safari only unlocks WebAudio on touchend/click
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.addEventListener(ev, unlock);
    // back from another app mid-race: the next tap puts the phone back in fullscreen
    keepMobileFullscreen(() => !!this.session);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.session?.canPause && this.session.phase === 'racing' && !this.session.paused) this.togglePause(true);
    });

    this.ui.showMenu('main');
    this.last = performance.now();
    this.renderer.renderer.setAnimationLoop(() => this.frame());
    this.net.autoReconnect();
  }

  /**
   * Switch the whole world to another map (terrain, props, sky, weather, audio).
   * Every client builds identical geometry from the id — nothing is streamed.
   */
  loadTrack(id, first = false) {
    if (this.track && this.track.id === id && this.world) return Promise.resolve();
    if (this._loadingTrack) return this._loadingTrack.then(() => this.loadTrack(id));
    this._loadingTrack = (async () => {
      const track = getTrack(id);
      this.ui.showLoading(`Loading ${track.name}…`);
      await new Promise((r) => setTimeout(r, 30));
      this.loading = true;
      this.stopDemo();
      if (this.world) this.world.dispose();
      this.renderer.newScene();
      this.track = track;
      this.world = new World(this.renderer.scene, this.renderer.renderer, track);
      await this.world.build((p, t) => this.ui.setLoading(p, t));
      this.effects?.dispose();
      this.effects = new Effects(this.renderer.scene);
      this.world.props.onFlash = (p) => this.effects.glow.emit(p.x, p.y, p.z, 0, 0, 0, 1, 1, 1, 1, 0.9, 0.09, 0, 0);
      const keep = this.chase ? { d: this.chase.distIndex, s: this.chase.shake } : null;
      this.chase = new ChaseCamera(this.renderer.camera, this.world, track);
      if (keep) {
        this.chase.distIndex = keep.d;
        this.chase.shake = keep.s;
      }
      this.ui.setTrack(track);
      this.audio.setAmbience(this.world.theme.ambience);
      this.applySettings();
      if (!this.session) this.startDemo();
      this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera);
      this.settings.track = id;
      if (!first) saveSettings(this.settings);
      this.loading = false;
      this.last = performance.now();
      this.ui.hideLoading();
    })();
    return this._loadingTrack.finally(() => (this._loadingTrack = null));
  }

  applySettings() {
    const s = this.settings;
    this.renderer.setQuality(s.quality, this.world);
    this.world.setQuality(s.quality);
    this.renderer.speedFx = s.speedFx;
    this.chase.distIndex = s.cam;
    this.chase.shake = s.shake;
    this.audio.applyVolumes();
    this.ui.updateTouchVisibility();
    this.ui.setFps(0);
  }

  // ------------------------------------------------------------------
  /** Attract mode: AI riders cruising the course behind the menus. */
  startDemo() {
    this.stopDemo();
    const race = new Race(this.track, { laps: 99, countdown: 0.01 });
    const views = [];
    for (let i = 0; i < 6; i++) {
      const r = race.addRacer({
        id: 'demo' + i,
        name: AI_NAMES[i],
        isBot: true,
        skill: 'hard',
        slot: i,
        bikeId: BIKES[i % BIKES.length].id,
        look: { frame: COLORS[(i * 3) % COLORS.length], jersey: COLORS[(i * 5 + 1) % COLORS.length], accent: COLORS[(i * 7 + 2) % COLORS.length], outfit: OUTFITS[i % OUTFITS.length].id },
      });
      r.bike.u = r.bike.s = 40 + i * 9;
      r.bike.d = ((i % 3) - 1) * 2;
      const c = this.track.sample(r.bike.s);
      r.bike.yaw = c.head;
      r.bike.y = c.y;
      r.bike.frozen = false;
      views.push(new RiderView(this.renderer.scene, this.track, { name: r.name, look: { ...r.look, bikeId: r.bikeId }, night: this.world.theme.night }));
    }
    race.phase = 'racing';
    race.time = 0;
    this.demo = { race, views, focus: 0, t: 0 };
    this.chase.setMode('flyover');
  }

  stopDemo() {
    if (!this.demo) return;
    for (const v of this.demo.views) v.dispose();
    this.demo = null;
  }

  // ------------------------------------------------------------------
  async startLocal(opts) {
    this.audio.init();
    enterMobileFullscreen();
    if (opts.track) await this.loadTrack(opts.track);
    this.ui.fade(true);
    setTimeout(() => {
      try {
        this.endSession();
        this.stopDemo();
        this.session = new LocalSession(this, opts);
        this.chase.snapBehind(this._buildTarget());
        this.chase.setMode('orbit');
      } catch (err) {
        console.error(err);
        this.session = null;
        this.startDemo();
        this.ui.showMenu('main');
        this.ui.toast('Could not start the race: ' + err.message, 5000);
      }
      this.ui.fade(false);
    }, 380);
  }

  startSession(session) {
    enterMobileFullscreen();
    this.endSession();
    this.stopDemo();
    this.session = session;
    this.chase.setMode('orbit');
  }

  endSession() {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    // leaving a race from the pause menu must not leave controls disabled for the next one
    this._pauseOverlay = false;
    this.input.enabled = true;
    this.ui.hideControlsCard();
    this.audio.silenceRide();
  }

  quitToMenu(menu = 'main') {
    if (this.session?.isNet) this.net.leaveRoom(true);
    this.ui.fade(true);
    setTimeout(() => {
      this.endSession();
      this.world.weather.apply(this.world.track.def.env?.weather || 'clear');
      this.startDemo();
      this.audio.setMusic('menu');
      this.ui.showMenu(menu);
      this.ui.fade(false);
    }, 300);
  }

  togglePause(force) {
    const s = this.session;
    if (!s || s.phase === 'results') return;
    // Esc inside in-race settings goes back to the pause menu instead of resuming behind it
    if (this.ui.closeRaceSettings()) return;
    const on = force ?? !(s.paused || this._pauseOverlay);
    if (s.canPause) {
      if (on) s.pause();
      else s.resume();
    }
    this._pauseOverlay = on;
    this.input.enabled = !on;
    this.ui.showPause(on);
  }

  // ------------------------------------------------------------------
  focusPos() {
    return this.session?.focusView?.position || this.renderer.camera.position;
  }

  /** Brief slow-motion moment (finish line). */
  slowMo(seconds) {
    this.slowMoT = seconds;
  }

  focusVel() {
    const b = this.session?.focusBike;
    const v = this.session?.focusView;
    if (!b || !v) return null;
    return { x: v.forward.x * b.v, z: v.forward.z * b.v };
  }

  _buildTarget() {
    const T = this._target;
    const s = this.session;
    const bike = s?.focusBike;
    const view = s?.focusView;
    if (!bike || !view) return null;
    T.position.copy(view.position);
    T.yaw = bike.yaw;
    T.v = bike.v;
    T.lean = bike.lean;
    T.bump = bike.bump;
    T.airborne = bike.airborne;
    T.boost = bike.boostTimer > 0;
    T.inTunnel = this.world.inTunnel(bike.s);
    T.effort = bike.effort || 0;
    T.brake = bike.brakeT ?? bike.brake ?? 0;
    T.rough = bike.offroad ? 0.6 : bike.surf === 1 ? 0.8 : bike.surf === 2 ? 0.5 : 0;
    return T;
  }

  frame() {
    if (this.loading) return;
    const now = performance.now();
    const realDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // slow motion: hold ~30% speed, then ease back to real time
    if (this.slowMoT > 0) this.slowMoT -= realDt;
    const tsTarget = this.slowMoT > 0 ? 0.3 : 1;
    this.timeScale += (tsTarget - this.timeScale) * Math.min(1, realDt * (tsTarget < this.timeScale ? 12 : 1.6));
    const dt = realDt * this.timeScale;
    this.time += dt;
    const s = this.session;
    let riderPositions = [];
    let focusBike = null;

    if (s) {
      s.update(dt);
      s.postUpdate?.(realDt);
      riderPositions = s.riderPositions();
      focusBike = s.focusBike;
    } else if (this.demo) {
      const d = this.demo;
      d.race.update(dt);
      d.race.drainEvents();
      for (let i = 0; i < d.views.length; i++) {
        consumeEvents(d.race.racers[i].bike);
        d.views[i].update(d.race.racers[i].bike, dt, this.time, this.renderer.camera.position);
      }
      riderPositions = d.views.map((v) => v.position);
      // flyover camera trails the pack
      const lead = d.race.racers[0].bike;
      if (Math.abs(this.chase.flyS - lead.u) > 200) this.chase.flyS = lead.u - 20;
      this.chase.flyS += (lead.u - 10 - this.chase.flyS) * Math.min(1, dt * 0.5);
    }

    const target = this._buildTarget();
    this.chase.update(realDt, target);
    const cam = this.renderer.camera;
    this.world.update(dt, cam, target ? target.position : null, riderPositions);

    // effects
    let draft = 0;
    if (focusBike && target) {
      const fwd = s.focusView.forward;
      this.effects.trail(target.position, fwd, focusBike.v, focusBike.surf, focusBike.offroad, dt);
      if (focusBike.boostTimer > 0) this.effects.boostStream(target.position, fwd, focusBike.v);
      const wet = this.world.weather.p.wet;
      if (wet > 0.5) this.effects.spray(target.position, fwd, focusBike.v, dt);
      draft = focusBike.draft;
      for (const o of s.otherBikes()) {
        if (o.view.position.distanceToSquared(cam.position) < 60 * 60) this.effects.trail(o.view.position, o.view.forward, o.bike.v, o.bike.surf, o.bike.offroad, dt * 0.5);
      }
    }
    if (this.world.props.waterfallPos) this.effects.mist(this.world.props.waterfallPos, 16, dt, cam.position);
    this.effects.update(dt, cam, focusBike ? focusBike.v : 0, draft);

    // audio
    this.crowdT -= dt;
    if (this.crowdT <= 0) {
      this.crowdT = 0.25;
      let n = 0;
      const sp = this.world.props.spectators.spots;
      const p = cam.position;
      for (let i = 0; i < sp.length; i += 2) if ((sp[i].x - p.x) ** 2 + (sp[i].z - p.z) ** 2 < 45 * 45) n++;
      this.crowdLevel = Math.min(1, n / 25);
    }
    const inTunnel = target?.inTunnel ?? false;
    this.audio.update(
      {
        active: !!focusBike && !(s?.paused),
        v: focusBike?.v || 0,
        throttle: focusBike?.throttle || 0,
        brake: focusBike?.brake || 0,
        surf: focusBike?.surf || 0,
        offroad: focusBike?.offroad || false,
        sprinting: focusBike?.sprinting || false,
        crank: focusBike?.crank || 0,
        effort: focusBike?.effort || 0,
        airborne: focusBike?.airborne || false,
        draft,
        inTunnel,
        wfDist: this.world.props.waterfallPos ? cam.position.distanceTo(this.world.props.waterfallPos) : 1e9,
        crowd: this.crowdLevel,
        rain: this.world.weather.p.rain,
      },
      dt,
    );

    // exposure adapts in the tunnel
    const r = this.renderer.renderer;
    const baseExp = this.world.weather.exposure || 1;
    r.toneMappingExposure += ((inTunnel ? 1.35 : 1.0) * baseExp - r.toneMappingExposure) * Math.min(1, dt * 2);

    this.renderer.speed = focusBike ? focusBike.v : 0;
    this.renderer.render(realDt);

    if (s && (s.phase === 'racing' || s.phase === 'countdown' || s.phase === 'finished')) this.ui.updateHud(s.hud(), dt);
    if (s?.hud && this.world.props.setClock && s.phase !== 'countdown') {
      this._clockT = (this._clockT || 0) + dt;
      if (this._clockT > 0.1) {
        this._clockT = 0;
        const h = s.hud();
        const m = Math.floor(h.time / 60);
        this.world.props.setClock(`${m}:${(h.time % 60).toFixed(1).padStart(4, '0')}`);
      }
    }
    // fps
    this.fpsAcc += realDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.ui.setFps(Math.round(this.fpsFrames / this.fpsAcc));
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }
}
