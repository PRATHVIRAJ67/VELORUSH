// Fully procedural WebAudio sound: no audio files required.
import { Music } from './Music.js';
import { clamp } from '@shared/math.js';

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.nextTick = 0;
    this.nextChirp = 0;
    this.nextCrunch = 0;
    this.lastCrankHalf = 0;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.musicBus.connect(this.master);
    // tunnel echo on the sfx bus
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.11;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = 0;
    this.sfx.connect(this.echo);
    this.echo.connect(fb).connect(this.echo);
    this.echo.connect(this.echoWet).connect(this.master);

    this.noise = this._noiseBuffer(3);
    // ---- continuous layers ----
    this.wind = this._loopNoise(this.amb, 'bandpass', 500, 0.7);
    this.tire = this._loopNoise(this.sfx, 'bandpass', 420, 1.2);
    this.gravel = this._loopNoise(this.sfx, 'highpass', 2200, 0.7);
    this.chain = this._loopNoise(this.sfx, 'bandpass', 1800, 9);
    this.waterfall = this._loopNoise(this.amb, 'lowpass', 900, 0.5);
    this.crowd = this._loopNoise(this.amb, 'bandpass', 1100, 0.8);
    this.breeze = this._loopNoise(this.amb, 'lowpass', 400, 0.3);
    this.windLow = this._loopNoise(this.amb, 'lowpass', 220, 0.6);
    this.windHi = this._loopNoise(this.amb, 'bandpass', 3800, 3);
    this.rumble = this._loopNoise(this.sfx, 'lowpass', 90, 1.2);
    this.rainLayer = this._loopNoise(this.amb, 'highpass', 1800, 0.4);
    this.sea = this._loopNoise(this.amb, 'lowpass', 520, 0.4);
    this.hum = this._loopNoise(this.amb, 'lowpass', 140, 0.9);
    // brake squeal
    const sq = ctx.createOscillator();
    sq.type = 'sine';
    sq.frequency.value = 2350;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain).connect(sq.frequency);
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    sq.connect(this.squealGain).connect(this.sfx);
    sq.start();
    lfo.start();

    this.music = new Music(ctx, this.musicBus);
    this.ready = true;
    this.applyVolumes();
  }

  _noiseBuffer(sec) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + 0.03 * w; // slightly pinked
      d[i] = w * 0.55 + b0 * 2.2;
    }
    return buf;
  }

  _loopNoise(dest, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(dest);
    src.start(0, Math.random() * 2);
    return { src, f, g };
  }

  applyVolumes() {
    if (!this.ready) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : s.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(s.sfx * 0.9, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music * 0.55, t, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyVolumes();
    return this.muted;
  }

  _set(layer, gain, tc = 0.08) {
    layer.g.gain.setTargetAtTime(gain, this.ctx.currentTime, tc);
  }

  /**
   * Per-frame update of continuous sounds.
   * st: {v, throttle, brake, surf, offroad, sprinting, crank, airborne, inTunnel, wfDist, crowd, draft, active}
   */
  update(st, dt) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const v = st.active ? st.v : 0;
    const sp = clamp(v / 22, 0, 1.7);
    const kmh = v * 3.6;
    // wind: three layers whose balance changes with speed (30 light, 70 strong, 110+ extreme);
    // a slipstream shelters the rider and muffles the rush
    const shelter = 1 - st.draft * 0.45;
    const sm = (a, b, x) => clamp((x - a) / (b - a), 0, 1);
    this._set(this.wind, (0.015 + sm(15, 80, kmh) * 0.32 + sm(80, 130, kmh) * 0.2) * shelter);
    this.wind.f.frequency.setTargetAtTime((300 + sm(10, 120, kmh) * 1300) * (1 - st.draft * 0.35), t, 0.1);
    this._set(this.windLow, (sm(25, 110, kmh) * 0.45 + sm(90, 130, kmh) * 0.25) * shelter);
    this._set(this.windHi, sm(65, 125, kmh) ** 1.5 * 0.12 * shelter * (0.8 + Math.sin(t * 7.3) * 0.2));
    // road vibration rumble grows with speed and surface roughness
    const rough = st.offroad ? 1 : st.surf === 1 ? 1.2 : st.surf === 2 ? 0.8 : 0.25;
    this._set(this.rumble, !st.airborne ? sm(5, 110, kmh) * 0.25 * (0.5 + rough) : 0);
    // derailleur: shifting as speed crosses gear bands while pedalling
    const gear = Math.min(11, Math.floor(v / 3));
    if (st.throttle > 0.05 && gear !== this.gear && this.gear !== undefined && t > this.nextShift) {
      this.click(2600, 0.05, 0.03, 'bandpass');
      this.click(900, 0.06, 0.05, 'bandpass');
      this.nextShift = t + 0.35;
    }
    if (t > (this.nextShift || 0) - 0.3) this.gear = gear;
    // hard breathing on a sprint effort
    if ((st.effort || 0) > 0.5 && t > (this.nextBreath || 0)) {
      this.breath(0.05 * st.effort);
      this.nextBreath = t + 0.55 + Math.random() * 0.1;
    }
    // tyre roll
    const onGround = !st.airborne;
    const surfMul = st.offroad ? 1.4 : st.surf === 1 ? 1.5 : st.surf === 2 ? 1.2 : 0.7;
    this._set(this.tire, onGround ? sp * 0.22 * surfMul : 0);
    this.tire.f.frequency.setTargetAtTime(st.surf === 1 ? 180 + sp * 200 : 300 + sp * 500, t, 0.1);
    // gravel crunch with random gating
    const crunchy = onGround && (st.surf === 2 || st.offroad) && v > 1;
    if (crunchy && t > this.nextCrunch) {
      this.gravel.g.gain.cancelScheduledValues(t);
      this.gravel.g.gain.setValueAtTime(0.05 + Math.random() * 0.12 * sp, t);
      this.gravel.g.gain.setTargetAtTime(0.02, t + 0.02, 0.03);
      this.nextCrunch = t + 0.03 + Math.random() * 0.07;
    } else if (!crunchy) this._set(this.gravel, 0);
    // cobbles: rhythmic rattle
    if (onGround && st.surf === 1 && v > 2 && t > this.nextTick) {
      this.click(90 + Math.random() * 40, 0.06 * sp, 0.05, 'lowpass');
      this.nextTick = t + 0.9 / Math.max(3, v * 1.6);
    }
    // chain whir while pedalling
    const pedal = st.throttle > 0.05 && v > 0.5;
    this._set(this.chain, pedal ? 0.035 + sp * 0.05 + (st.sprinting ? 0.04 : 0) : 0);
    this.chain.f.frequency.setTargetAtTime(1400 + v * 60, t, 0.1);
    // freewheel ticks when coasting
    if (!pedal && v > 1.5 && st.surf !== 1 && t > this.nextTick) {
      this.click(4200, 0.035, 0.012, 'highpass');
      this.nextTick = t + 1 / clamp(v * 1.8, 4, 40);
    }
    // pedal stroke thump (twice per revolution)
    const half = Math.floor(st.crank / Math.PI);
    if (pedal && half !== this.lastCrankHalf) this.thump(st.sprinting ? 0.09 : 0.05);
    this.lastCrankHalf = half;
    // brake squeal
    this.squealGain.gain.setTargetAtTime(st.brake > 0.1 && v > 4 && onGround ? 0.03 * Math.min(1.6, v / 12) * st.brake : 0, t, 0.04);
    // environment
    this._set(this.waterfall, clamp(1 - st.wfDist / 260, 0, 1) ** 2 * 0.55, 0.3);
    this._set(this.crowd, clamp(st.crowd, 0, 1) * 0.3 * (0.8 + Math.sin(t * 2.3) * 0.2), 0.2);
    this._set(this.breeze, st.inTunnel ? 0.01 : 0.05, 0.5);
    this.echoWet.gain.setTargetAtTime(st.inTunnel ? 0.5 : 0, t, 0.2);
    // rain hiss + distant thunder
    this._set(this.rainLayer, (st.rain || 0) * (st.inTunnel ? 0.04 : 0.22), 0.5);
    if ((st.rain || 0) > 0.5 && t > (this.nextThunder || 0)) {
      if (this.nextThunder) this.thunder();
      this.nextThunder = t + 12 + Math.random() * 20;
    }
    // map ambience: surf on the coast, traffic hum in the city, desert wind
    const amb = this.ambience || 'alpine';
    this._set(this.sea, amb === 'sea' ? 0.14 + Math.max(0, Math.sin(t * 0.45)) * 0.16 : 0, 0.6);
    this._set(this.hum, amb === 'city' ? 0.2 : 0, 0.5);
    if (amb === 'desert') this._set(this.breeze, st.inTunnel ? 0.01 : 0.12 + Math.sin(t * 0.3) * 0.04, 0.5);
    if (amb === 'sea' && t > (this.nextGull || 0)) {
      if (this.nextGull) for (let i = 0; i < 3; i++) this.tone(1900 - i * 200, 0.18, { gain: 0.02, delay: i * 0.22, slide: 0.6, bus: this.amb });
      this.nextGull = t + 6 + Math.random() * 10;
    }
    // birds (they shelter from the rain; none in the desert or the city at night)
    if ((amb === 'alpine' || amb === 'forest') && !st.inTunnel && !(st.rain > 0.5) && t > this.nextChirp) {
      this.chirp();
      this.nextChirp = t + 0.8 + Math.random() * 3.5;
    }
  }

  // ---------------- one-shots ----------------
  click(freq, gain, dur, type = 'bandpass') {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 2, dur + 0.02);
  }

  thunder() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 160;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    src.connect(f).connect(g).connect(this.amb);
    src.start(t, 0, 2.9);
  }

  breath(gain) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 2, 0.4);
  }

  thump(gain) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.12);
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, delay = 0, slide = 0, bus = null } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  whoosh(dur = 0.6, from = 300, to = 3000, gain = 0.3) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random(), dur + 0.1);
  }

  chirp() {
    if (!this.ready) return;
    const base = 2600 + Math.random() * 1800;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone(base, 0.09, { gain: 0.012, delay: i * 0.12, slide: 1.35, bus: this.amb });
  }

  play(name) {
    if (!this.ready) return;
    switch (name) {
      case 'ui':
        this.tone(900, 0.06, { type: 'triangle', gain: 0.08 });
        break;
      case 'count':
        this.tone(520, 0.25, { type: 'square', gain: 0.1 });
        break;
      case 'go':
        this.tone(1040, 0.6, { type: 'square', gain: 0.12 });
        this.tone(1560, 0.6, { type: 'triangle', gain: 0.08 });
        break;
      case 'boost':
        this.whoosh(0.7, 250, 4000, 0.35);
        this.tone(300, 0.5, { type: 'sawtooth', gain: 0.05, slide: 3 });
        break;
      case 'sprint':
        this.whoosh(0.35, 600, 2000, 0.12);
        this.breath(0.07);
        break;
      case 'pad':
        [0, 0.06, 0.12].forEach((d, i) => this.tone(880 * (1 + i * 0.26), 0.2, { type: 'triangle', gain: 0.07, delay: d }));
        this.whoosh(0.5, 400, 3000, 0.2);
        break;
      case 'checkpoint':
        this.tone(988, 0.15, { type: 'triangle', gain: 0.12 });
        this.tone(1319, 0.3, { type: 'triangle', gain: 0.12, delay: 0.12 });
        break;
      case 'lap':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', gain: 0.1, delay: i * 0.09 }));
        break;
      case 'finish':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, i === 5 ? 0.9 : 0.2, { type: 'square', gain: 0.07, delay: i * 0.13 }));
        this.cheer();
        break;
      case 'wall':
        this.click(180, 0.35, 0.18, 'lowpass');
        this.tone(640, 0.25, { type: 'triangle', gain: 0.05, slide: 0.8 });
        break;
      case 'land':
        this.click(120, 0.3, 0.15, 'lowpass');
        break;
      case 'bump':
        this.click(300, 0.12, 0.08, 'lowpass');
        break;
      case 'sling':
        this.whoosh(0.8, 200, 2500, 0.22);
        break;
      case 'jump':
        this.whoosh(0.4, 500, 1500, 0.1);
        break;
      case 'wrong':
        this.tone(160, 0.3, { type: 'sawtooth', gain: 0.07 });
        break;
      case 'reset':
        this.tone(440, 0.15, { type: 'triangle', gain: 0.08, slide: 1.5 });
        break;
      default:
    }
  }

  cheer(level = 0.5) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.crowd.g.gain.cancelScheduledValues(t);
    this.crowd.g.gain.setTargetAtTime(level, t, 0.08);
    this.crowd.g.gain.setTargetAtTime(0.1, t + 1.5, 0.8);
  }

  say(text) {
    try {
      if (!window.speechSynthesis || this.muted) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.1;
      u.pitch = 0.9;
      u.volume = clamp(this.settings.master * this.settings.sfx * 1.2, 0, 1);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* speech optional */
    }
  }

  setAmbience(kind) {
    this.ambience = kind;
  }

  setMusic(mode) {
    if (!this.ready) return;
    this.music.setMode(mode);
  }

  silenceRide() {
    if (!this.ready) return;
    for (const l of [this.tire, this.gravel, this.chain, this.wind, this.windLow, this.windHi, this.rumble, this.rainLayer]) this._set(l, 0);
    this.squealGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
}
