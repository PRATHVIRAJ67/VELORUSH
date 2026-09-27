// Keyboard + gamepad + touch input -> unified rider controls.

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'boost',
  KeyR: 'reset',
  KeyC: 'camera',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'mute',
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = new Set();
    this.edges = new Set(); // pressed-this-frame actions
    this.listeners = {};
    this.enabled = true;
    this.lastDevice = 'keyboard';
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(a)) {
        this.edges.add(a);
        this.emit(a);
      }
      this.keys.add(a);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.keys.delete(a);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touch.clear();
    });
    this.padPrev = {};
  }

  on(action, fn) {
    (this.listeners[action] ||= []).push(fn);
  }

  emit(action) {
    for (const fn of this.listeners[action] || []) fn();
  }

  bindTouch(root) {
    const buttons = root.querySelectorAll('[data-t]');
    for (const b of buttons) {
      const a = b.dataset.t;
      const down = (e) => {
        e.preventDefault();
        if (!this.touch.has(a)) {
          this.edges.add(a);
          // one-shot actions behave like their keyboard keys (C, R)
          if (a === 'camera') this.emit('camera');
        }
        this.touch.add(a);
        b.classList.add('on');
        this.lastDevice = 'touch';
      };
      const up = (e) => {
        e.preventDefault();
        this.touch.delete(a);
        b.classList.remove('on');
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    }
  }

  _gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const btn = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
      const pressed = (i) => !!p.buttons[i]?.pressed;
      const edge = (name, i) => {
        const now = pressed(i);
        if (now && !this.padPrev[name]) {
          this.edges.add(name);
          this.emit(name);
        }
        this.padPrev[name] = now;
      };
      edge('boost', 2);
      edge('reset', 3);
      edge('camera', 5);
      edge('pause', 9);
      const steer = Math.abs(p.axes[0]) > 0.12 ? p.axes[0] : 0;
      const throttle = Math.max(btn(7), p.axes[1] < -0.5 ? 1 : 0);
      const brake = btn(6);
      if (steer || throttle || brake || pressed(0)) this.lastDevice = 'gamepad';
      return { steer, throttle, brake, sprint: pressed(0) };
    }
    return null;
  }

  /** Returns controls for this frame and clears edge-triggered actions. */
  read() {
    const k = this.keys;
    const t = this.touch;
    const has = (a) => k.has(a) || t.has(a);
    let steer = (has('right') ? 1 : 0) - (has('left') ? 1 : 0);
    let throttle = has('up') || has('pedal') ? 1 : 0;
    let brake = has('down') || has('brake') ? 1 : 0;
    let sprint = has('sprint');
    if (t.has('sprint')) throttle = 1;
    const pad = this._gamepad();
    if (pad) {
      if (pad.steer) steer = pad.steer;
      throttle = Math.max(throttle, pad.throttle);
      brake = Math.max(brake, pad.brake);
      sprint = sprint || pad.sprint;
      if (pad.sprint) throttle = Math.max(throttle, 1);
    }
    const out = {
      throttle: this.enabled ? throttle : 0,
      brake: this.enabled ? brake : 0,
      steer: this.enabled ? steer : 0,
      sprint: this.enabled && sprint,
      boost: this.enabled && this.edges.has('boost'),
      reset: this.enabled && this.edges.has('reset'),
    };
    this.edges.clear();
    return out;
  }
}
