// Rutas de la API, compartidas entre el servidor local (server.js) y el Cloudflare Worker (worker/index.mjs).
// No usa nada propio de Node: solo fetch, URL y los módulos de lib/.
const STORES = require('./stores');
const fetchers = require('./fetchers');
const geo = require('./geo');

const storeById = Object.fromEntries(STORES.map((s) => [s.id, s]));

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
const SEARCH_TTL = 10 * 60 * 1000;
const PRICE_TTL = 30 * 60 * 1000;

// Cloudflare (plan gratis) permite 50 consultas externas por pedido, y cada una puede reintentarse una vez.
// Por eso un pedido de precios se limita a MAX_PAIRS combinaciones producto x tienda.
const MAX_PAIRS = 24;

const pickStores = (ids) => (Array.isArray(ids) ? ids : []).map((id) => storeById[id]).filter(Boolean);

async function handleSearch(q, storeIds) {
  const stores = pickStores(storeIds);
  const errors = {};
  const results = await Promise.all(stores.map(async (s) => {
    try { return await cached(`s|${s.id}|${q.toLowerCase()}`, SEARCH_TTL, () => fetchers.search(s, q, 12)); }
    catch (e) { errors[s.id] = e.message; return []; }
  }));
  // Agrupa por EAN: mismo código de barras = mismo producto en todas las tiendas.
  const groups = new Map();
  results.forEach((offers) => offers.forEach((o, rank) => {
    let g = groups.get(o.ean);
    if (!g) { g = { ean: o.ean, name: o.name, brand: o.brand, offers: {}, score: 0 }; groups.set(o.ean, g); }
    g.offers[o.store] = o;
    g.score += 100 - rank; // aparece más arriba en más tiendas => más relevante
    if (o.name.length > g.name.length && o.name.length < 90) g.name = o.name;
  }));
  const list = [...groups.values()].sort((a, b) => Object.keys(b.offers).length - Object.keys(a.offers).length || b.score - a.score);
  return { groups: list.slice(0, 30), errors };
}

async function handlePrices(eans, storeIds) {
  const stores = pickStores(storeIds);
  const list = [...new Set((Array.isArray(eans) ? eans : []).filter((e) => /^\d{8,14}$/.test(e)))];
  const prices = {};
  const errors = {};
  list.forEach((e) => { prices[e] = {}; });
  await Promise.all(list.flatMap((ean) => stores.map(async (s) => {
    try { prices[ean][s.id] = await cached(`p|${s.id}|${ean}`, PRICE_TTL, () => fetchers.byEan(s, ean)); }
    catch (e) { errors[s.id] = e.message; } // sin entrada => no se pudo consultar (distinto de "no lo tiene")
  })));
  return { prices, errors };
}

const json = (status, body) => ({ status, body });

// Devuelve { status, body } o null si la ruta no existe.
async function handleApi({ method, pathname, query, readJson }) {
  if (pathname === '/api/stores') return json(200, STORES);

  if (pathname === '/api/search') {
    const q = (query.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return json(400, { error: 'Escribí al menos 2 letras' });
    const ids = (query.get('stores') || STORES.filter((s) => s.defaultEnabled).map((s) => s.id).join(',')).split(',');
    return json(200, await handleSearch(q, ids));
  }

  if (pathname === '/api/prices' && method === 'POST') {
    const body = await readJson();
    const eans = Array.isArray(body.eans) ? body.eans : [];
    const stores = pickStores(body.stores);
    if (eans.length * stores.length > MAX_PAIRS) return json(400, { error: `Demasiados productos por pedido (máximo ${MAX_PAIRS} combinaciones producto x tienda)` });
    return json(200, await handlePrices(eans, body.stores));
  }

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
  if (pathname === '/api/nearby' && method === 'POST') {
    const b = await readJson();
    const lat = Number(b.lat), lon = Number(b.lon);
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return json(400, { error: 'Coordenadas inválidas' });
    const ids = pickStores(b.stores).map((s) => s.id);
    const key = `n|${lat.toFixed(3)}|${lon.toFixed(3)}|${[...ids].sort().join(',')}`;
    return json(200, { branches: await cached(key, 6 * 3600e3, () => geo.nearby(lat, lon, ids)) });
  }
  return null;
}

module.exports = { handleApi, MAX_PAIRS };
