// Tiny procedural synth-rock sequencer (menu + race variants).

const BPM = 126;
const STEP = 60 / BPM / 4; // 16th notes
// A minor: Am - F - C - G, then Am - F - G - E
const PROG = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
  [52, 56, 59],
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.mode = 'off';
    this.step = 0;
    this.nextTime = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1800;
    this.filter.Q.value = 4;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.filter.connect(this.bus).connect(out);
    this.drumBus = ctx.createGain();
    this.drumBus.connect(this.bus);
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.timer = setInterval(() => this._schedule(), 30);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const t = this.ctx.currentTime;
    this.mode = mode;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(mode === 'off' ? 0 : mode === 'menu' ? 0.75 : 0.9, t, 0.6);
    if (this.nextTime < t) {
      this.nextTime = t + 0.05;
      this.step = 0;
    }
  }

  _schedule() {
    if (this.mode === 'off' && this.bus.gain.value < 0.001) return;
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % (16 * PROG.length);
    }
  }

  _playStep(step, t) {
    const bar = Math.floor(step / 16) % PROG.length;
    const s = step % 16;
    const chord = PROG[bar];
    const race = this.mode === 'race' || this.mode === 'final';
    // filter sweep over 8 bars
    const phase = (step % 128) / 128;
    this.filter.frequency.setTargetAtTime(race ? 1400 + Math.sin(phase * Math.PI * 2) * 900 + 900 : 900 + phase * 600, t, 0.2);
    if (race) {
      if (s % 4 === 0) this._kick(t);
      if (s === 4 || s === 12) this._snare(t);
      if (s % 2 === 1) this._hat(t, s % 4 === 3 ? 0.05 : 0.03);
      if (this.mode === 'final' && s % 2 === 0) this._hat(t, 0.025);
      // driving 8th bass
      if (s % 2 === 0) this._bass(mtof(chord[0] - 24 + (s === 14 ? 12 : 0)), t, STEP * 1.8);
    } else if (s === 0) {
      this._bass(mtof(chord[0] - 24), t, STEP * 14);
    }
    // arpeggio
    const arpOrder = [0, 1, 2, 1, 2, 0, 1, 2];
    const note = chord[arpOrder[s % 8]] + (s >= 8 ? 12 : 0);
    if (race || s % 2 === 0) this._pluck(mtof(note), t, race ? 0.05 : 0.04);
    // pad on each bar
    if (s === 0) for (const n of chord) this._pad(mtof(n), t, STEP * 16, race ? 0.018 : 0.028);
  }

  _env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  _kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    this._env(g, t, 0.002, 0.5, 0.22);
    o.connect(g).connect(this.drumBus);
    o.start(t);
    o.stop(t + 0.25);
  }

  _snare(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    const g = this.ctx.createGain();
    this._env(g, t, 0.002, 0.22, 0.16);
    src.connect(f).connect(g).connect(this.drumBus);
    src.start(t);
    src.stop(t + 0.2);
    const o = this.ctx.createOscillator();
    const g2 = this.ctx.createGain();
    o.frequency.value = 190;
    this._env(g2, t, 0.002, 0.12, 0.08);
    o.connect(g2).connect(this.drumBus);
    o.start(t);
    o.stop(t + 0.1);
  }

  _hat(t, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    this._env(g, t, 0.001, gain, 0.05);
    src.connect(f).connect(g).connect(this.drumBus);
    src.start(t, Math.random() * 0.3);
    src.stop(t + 0.06);
  }

  _bass(freq, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, 0.005, 0.16, dur);
    o.connect(f).connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _pluck(freq, t, gain) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    this._env(g, t, 0.003, gain, STEP * 1.6);
    o.connect(g).connect(this.filter);
    o.start(t);
    o.stop(t + STEP * 1.7);
  }

  _pad(freq, t, dur, gain) {
    for (const det of [-7, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.4);
      g.gain.setValueAtTime(gain, t + dur - 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.filter);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}
