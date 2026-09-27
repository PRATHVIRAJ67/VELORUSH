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
