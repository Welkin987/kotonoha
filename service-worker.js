const CACHE = 'kotonoha-v1.0.0';
const CORE_ASSETS = [
  './', './index.html', './styles.css', './app.js', './vocab-data.js',
  './vocabulary.json', './manifest.webmanifest', './icons/icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('kotonoha-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Cache complete audio files, then serve byte ranges for playback and seeking.
async function audioResponse(request, cache) {
  const key = new Request(request.url, {credentials: 'same-origin'});
  let response = await cache.match(key);
  if (!response) {
    response = await fetch(key);
    if (response.status === 200) {
      try { await cache.put(key, response.clone()); } catch (_) { /* Storage may be full. */ }
    }
  }
  const range = request.headers.get('range');
  if (!range || response.status !== 200) return response;
  const bytes = await response.arrayBuffer();
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = match?.[1] ? Number(match[1]) : 0;
  let end = match?.[2] ? Number(match[2]) : bytes.byteLength - 1;
  if (match && !match[1] && match[2]) {
    start = Math.max(0, bytes.byteLength - Number(match[2]));
    end = bytes.byteLength - 1;
  }
  end = Math.min(end, bytes.byteLength - 1);
  if (!match || (!match[1] && !match[2]) || start > end || start >= bytes.byteLength) {
    return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${bytes.byteLength}`}});
  }
  const headers = new Headers(response.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(bytes.slice(start, end + 1), {status: 206, headers});
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      if (new URL(event.request.url).pathname.endsWith('.mp3')) return await audioResponse(event.request, cache);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      return await fetch(event.request);
    } catch (_) {
      return event.request.mode === 'navigate' ? (await cache.match('./index.html')) || Response.error() : Response.error();
    }
  })());
});
