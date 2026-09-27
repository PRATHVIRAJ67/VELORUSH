export function formatTime(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${neg ? '-' : ''}${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function formatGap(t) {
  if (t == null) return '';
  return `${t >= 0 ? '+' : '-'}${Math.abs(t).toFixed(1)}s`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
