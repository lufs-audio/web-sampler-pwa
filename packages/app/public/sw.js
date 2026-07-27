// Minimal offline shell. Cache-first for the app shell so the sampler opens
// with no network once installed. Audio the user records lives in OPFS, not here.
const CACHE = 'lufs-web-sampler-v3';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './sampler-processor.js', './icon.svg',
  // Self-hosted type — precached so an offline launch renders in the real
  // typeface instead of silently degrading to system fonts.
  './fonts.css',
  './fonts/host-grotesk-var-latin.woff2',
  './fonts/public-sans-var-latin.woff2',
  './fonts/space-mono-400-latin.woff2',
  './fonts/space-mono-700-latin.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // NAVIGATIONS must never be answered with a redirected response. Navigation
  // requests use redirect mode "manual", so a Response whose .redirected is true
  // is rejected by the browser as a network error (ERR_FAILED).
  //
  // Cloudflare Pages 308-redirects /index.html -> /. Passing that navigation to
  // fetch() follows the 308 and yields a redirected response, so /index.html died
  // with ERR_FAILED as soon as the SW was active — an old bookmark or a shared
  // link would hard-fail. Serving the precached shell sidesteps it: a cache hit
  // is never flagged redirected. This is also the SPA fallback path, so a
  // client-routed deep link resolves to the shell offline as well as online.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html')
        .then((cached) => cached || caches.match('./'))
        .then((cached) => cached || fetch('./').catch(() => caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
