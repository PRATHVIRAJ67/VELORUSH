// Install as an app: Chrome/Edge (Android + desktop) fire beforeinstallprompt, which we turn into our
// own pop-up and an "Install app" menu button. iPhone/iPad Safari has no prompt, so the same pop-up
// explains Share -> Add to Home Screen. Nothing is shown once the game runs as an installed app.

const DISMISS_KEY = 'velorush.installDismissedAt';
const SNOOZE_MS = 3 * 24 * 3600 * 1000; // "Not now" hides the pop-up for 3 days (the menu button stays)
const $ = (id) => document.getElementById(id);

export const isStandalone = () =>
  matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// the browser can offer installation while the game is still loading: keep that event for later
let early = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // we show our own pop-up instead of the browser's mini bar
  early = e;
});

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class Installer {
  constructor(ui) {
    this.ui = ui;
    this.deferred = null;
    this.mode = null; // 'prompt' | 'ios' | null
    if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    if (isStandalone()) {
      document.body.classList.add('app-mode');
      return;
    }
    $('btn-install').addEventListener('click', () => this.open(true));
    $('ic-install').addEventListener('click', () => this.install());
    $('ic-later').addEventListener('click', () => this.dismiss());
    if (isIOS()) this._offer('ios');
    const take = (e) => {
      e.preventDefault();
      this.deferred = e;
      this._offer('prompt');
    };
    if (early) take(early);
    window.addEventListener('beforeinstallprompt', take);
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this._offer(null);
      this.ui.toast('Installed! Open Velo Rush from your apps for fullscreen play.', 5000);
    });
  }

  _offer(mode) {
    this.mode = mode;
    $('btn-install').style.display = mode ? '' : 'none';
    const ios = mode === 'ios';
    $('install-card').classList.toggle('ios', ios);
    $('ic-install').style.display = ios ? 'none' : '';
    $('ic-later').textContent = ios ? 'Got it' : 'Not now';
    if (!mode) $('install-card').classList.remove('show');
    else this.open(false);
  }

  /** Show the pop-up; automatic (force=false) only on the main menu and not while snoozed. */
  open(force) {
    if (!this.mode) return;
    if (!force) {
      let at = 0;
      try {
        at = Number(localStorage.getItem(DISMISS_KEY)) || 0;
      } catch {
        /* storage blocked */
      }
      if (Date.now() - at < SNOOZE_MS || this.ui.currentMenu !== 'main') return;
    }
    $('install-card').classList.add('show');
  }

  dismiss() {
    $('install-card').classList.remove('show');
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage blocked */
    }
  }

  async install() {
    if (!this.deferred) return;
    const e = this.deferred;
    this.deferred = null;
    $('install-card').classList.remove('show');
    e.prompt();
    const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (outcome !== 'accepted') {
      this.dismiss();
      // Chrome only re-offers after a later beforeinstallprompt; until then the button explains how
      $('btn-install').style.display = 'none';
    }
  }
}
