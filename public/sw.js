// Service worker de Gondolar: permite instalarla como app y abrirla sin conexión con lo último que viste.
// Solo maneja archivos propios del sitio. No toca nada de otros servidores (API, mapas, tipografías, fotos de productos).
//
//  * Páginas y archivos de la app: primero la red (para que siempre veas la versión nueva) y, si no hay internet o tarda, la última copia.
//  * Datos de precios (/data/): los archivos llevan la fecha en la dirección (?v=AAAA-MM-DD), así que no cambian: se guardan y se reutilizan.
//    meta.json (que dice qué día son los datos) también va primero por la red. De cada archivo se guarda una sola versión.
const VERSION = 'v1';
const SHELL = 'gondolar-app-' + VERSION;
const DATA = 'gondolar-datos-' + VERSION;
const SHELL_FILES = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'optimizer.js', 'bank.js', 'consent.js', 'pwa.js', 'config.js',
  'favicon.svg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'legal.html', 'promos-bancos.json'];
const MAX_DATA_ENTRIES = 40;
const OFFLINE_HTML = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión · Gondolar</title>'
  + '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.25rem;line-height:1.5"><h1>Sin conexión</h1>'
  + '<p>No pude abrir Gondolar y todavía no tengo una copia guardada. Conectate a internet y volvé a intentar.</p></body></html>';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // uno por uno: si algún archivo falla, el resto igual se guarda
    await Promise.all(SHELL_FILES.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('gondolar-') && k !== SHELL && k !== DATA) await caches.delete(k);
    await self.clients.claim();
  })());
});

// guarda la respuesta y descarta versiones anteriores del mismo archivo (mismo camino, otro ?v=)
async function store(cache, request, response, single) {
  await cache.put(request, response);
  if (!single) return;
  const path = new URL(request.url).pathname;
  const keys = await cache.keys();
  await Promise.all(keys.filter((k) => k.url !== request.url && new URL(k.url).pathname === path).map((k) => cache.delete(k)));
  const rest = await cache.keys();
  await Promise.all(rest.slice(0, Math.max(0, rest.length - MAX_DATA_ENTRIES)).map((k) => cache.delete(k)));
}

async function networkFirst(request, cacheName, timeoutMs, single) {
  const cache = await caches.open(cacheName);
  const nav = request.mode === 'navigate';
  const net = fetch(request).then((res) => { if (res && res.ok) store(cache, request.clone(), res.clone(), single).catch(() => {}); return res; });
  net.catch(() => {}); // evita un aviso si la respuesta llega después de que ya usamos la copia
  const cached = () => cache.match(request, { ignoreSearch: nav }).then((hit) => hit || (nav ? cache.match('index.html') : undefined));
  try {
    return await Promise.race([net, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))]);
  } catch (err) {
    const hit = await cached();
    if (hit) return hit;
    if (nav) return new Response(OFFLINE_HTML, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return net; // sin copia: se espera a la red (o falla)
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) store(cache, request.clone(), res.clone(), true).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // otros sitios: los maneja el navegador
  const path = url.pathname;
  if (path.includes('/data/')) {
    event.respondWith(/\/meta\.json$/.test(path) ? networkFirst(request, DATA, 4000, true) : cacheFirst(request, DATA));
    return;
  }
  if (request.mode === 'navigate' || /\.(?:html|js|css|json|svg|png|webmanifest)$/.test(path) || path.endsWith('/')) {
    event.respondWith(networkFirst(request, SHELL, 3500, false));
  }
});
