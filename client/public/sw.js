// Velo Rush service worker: makes the game installable as an app.
// Network only on purpose: nothing is cached, so every deploy reaches players immediately.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  // offline: a clear message instead of the browser's error page
  e.respondWith(
    fetch(e.request).catch(
      () =>
        new Response(
          '<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b1220;color:#f3f6fb;font:600 18px system-ui;text-align:center">Velo Rush needs an internet connection.<br>Reconnect and reopen the app.</body>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
    ),
  );
});
