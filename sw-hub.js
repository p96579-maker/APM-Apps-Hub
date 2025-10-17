/* APM Apps Hub SW: offline shell + manual update support */
const VERSION = 'v' + Date.now(); // bump on each deploy
const SHELL_CACHE = 'apm-shell-' + VERSION;
const RUNTIME_CACHE = 'apm-runtime';

// Shell files to precache. Keep this list short; index & manifest.
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_FILES.map(u => new Request(u, {cache: 'reload'})));
    self.skipWaiting(); // install -> waiting
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // remove old shell caches
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if(k.startsWith('apm-shell-') && k !== SHELL_CACHE) return caches.delete(k);
    }));
    clients.claim();
  })());
});

// Message API for manual update / warmup
self.addEventListener('message', (event) => {
  const msg = event.data && event.data.type;
  if(msg === 'SKIP_WAITING'){
    self.skipWaiting();
  }
  if(msg === 'WARMUP'){
    // try fetching core files to keep them fresh
    SHELL_FILES.forEach(u => fetch(u, {cache:'reload'}).catch(()=>{}));
    fetch('./apps.json?warm=' + Date.now(), {cache:'reload'}).catch(()=>{});
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);

  // Network-first for apps.json (so "更新" 會拿到最新；離線時回退快取)
  if(url.pathname.endsWith('/apps.json') || url.pathname === '/apps.json'){
    event.respondWith((async () => {
      try{
        const fresh = await fetch(new Request(req, {cache:'no-store'}));
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      }catch{
        const cache = await caches.open(RUNTIME_CACHE);
        const hit = await cache.match(req);
        return hit || new Response('[]', {headers:{'content-type':'application/json'}});
      }
    })());
    return;
  }

  // HTML: network-first (to pick up new index quickly), fallback to cache
  if(req.headers.get('accept')?.includes('text/html')){
    event.respondWith((async () => {
      try{
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      }catch{
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match('./index.html');
        return hit || caches.match(req);
      }
    })());
    return;
  }

  // Others: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const net = fetch(req).then(resp => {
      cache.put(req, resp.clone());
      return resp;
    }).catch(()=>{});
    return cached || net || fetch(req);
  })());
});