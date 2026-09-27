// Device detection. Mobile-only behaviour and optimisations are gated behind isMobile()
// so the desktop (PC) path stays exactly as it is.

let cached = null;

export function isMobile() {
  if (cached !== null) return cached;
  const mm = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // a finger-driven device without a hovering pointer, or a phone/tablet user agent
  cached = (mm('(pointer: coarse)') && !mm('(hover: hover)')) || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  return cached;
}

/**
 * Android drops fullscreen whenever the user leaves the browser, and it can only be
 * re-entered from a tap. While `wanted()` is true, the next tap restores it.
 */
export function keepMobileFullscreen(wanted) {
  if (!isMobile()) return;
  // touchend/click carry the user activation that requestFullscreen needs (pointerdown does not for touch)
  const again = () => {
    if (wanted() && !document.fullscreenElement) enterMobileFullscreen();
  };
  window.addEventListener('touchend', again, { capture: true, passive: true });
  window.addEventListener('click', again, { capture: true, passive: true });
}

/**
 * iOS Safari ignores user-scalable=no: holding PEDAL while steering with a second thumb reads as a
 * pinch, and quick repeated taps as double-tap zoom. Block both (one-finger menu scrolling still works).
 */
export function lockMobileZoom() {
  if (!isMobile()) return;
  const block = (e) => e.preventDefault();
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, block, { passive: false });
  document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });
  let lastEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = e.timeStamp;
      // in a race only: a second tap within 350 ms would be a double-tap zoom
      // (not on click-driven buttons like pause/menus: cancelling touchend would swallow their click)
      const clicky = e.target.closest?.('button, a, select, input, label') && !e.target.closest('.t-btn');
      if (document.body.classList.contains('racing') && !clicky && now - lastEnd < 350) e.preventDefault();
      lastEnd = now;
    },
    { passive: false },
  );
}

/** Fullscreen + landscape lock where the browser allows it (Android Chrome; iOS ignores it). */
export function enterMobileFullscreen() {
  if (!isMobile()) return;
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {});
    }
  } catch {
    /* not supported */
  }
}
