// Rutas de la API, compartidas entre el servidor local (server.js) y el Cloudflare Worker (worker/index.mjs).
// Los precios y las sucursales NO pasan por acá: son archivos estáticos generados desde los datos abiertos de SEPA
// (scripts/build_sepa.py). Esta API solo resuelve direcciones, rutas y la cotización del dólar.
// No usa nada propio de Node: solo fetch, URL y los módulos de lib/.
const geo = require('./geo');
const rates = require('./rates');

// ---- caché en memoria (por proceso / instancia del Worker) ----
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 3000) cache.delete(cache.keys().next().value);
  return v;
}
const RATES_TTL = 10 * 60 * 1000;
const MAX_CANDIDATES = 30;

const json = (status, body) => ({ status, body });
const validPoint = (p) => p && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lon)) <= 180 && p.lat != null && p.lon != null;

// Devuelve { status, body } o null si la ruta no existe.
async function handleApi({ method, pathname, query, readJson }) {
  if (pathname === '/api/dolar') return json(200, await cached('dolar', RATES_TTL, () => rates.fetchRates()));

  // ubicación: no se guarda nada, solo se reenvía a los servicios de mapas
  if (pathname === '/api/geocode') {
    const q = (query.get('q') || '').trim().slice(0, 160);
    if (q.length < 4) return json(400, { error: 'Escribí calle y altura' });
    return json(200, await cached(`g|${q.toLowerCase()}`, 24 * 3600e3, () => geo.geocode(q)));
  }
  if (pathname === '/api/reverse') {
    const lat = parseFloat(query.get('lat')), lon = parseFloat(query.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(400, { error: 'Coordenadas inválidas' });
    return json(200, await geo.reverse(lat, lon).catch(() => null));
  }
  // distancia y tiempo en auto desde casa hasta las sucursales candidatas (que salen de los datos de SEPA)
  if (pathname === '/api/route' && method === 'POST') {
    const b = await readJson();
    const from = { lat: Number(b.lat), lon: Number(b.lon) };
    const list = Array.isArray(b.candidates) ? b.candidates : [];
    if (!validPoint(b) || !Number.isFinite(from.lat) || !Number.isFinite(from.lon)) return json(400, { error: 'Coordenadas inválidas' });
    if (list.length > MAX_CANDIDATES) return json(400, { error: `Máximo ${MAX_CANDIDATES} sucursales por pedido` });
    if (!list.every((p) => validPoint(p) && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))) return json(400, { error: 'Sucursal con coordenadas inválidas' });
    const cands = list.map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) }));
    const key = `r|${from.lat.toFixed(3)}|${from.lon.toFixed(3)}|${cands.map((c) => c.lat.toFixed(4) + ',' + c.lon.toFixed(4)).join(';')}`;
    return json(200, { routes: await cached(key, 6 * 3600e3, () => geo.route(from, cands)) });
  }
  return null;
}

module.exports = { handleApi, MAX_CANDIDATES };
