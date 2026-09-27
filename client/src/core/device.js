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
