// Ubicación: geocodificación (Nominatim), sucursales cercanas (Overpass) y ruta en auto (OSRM).
// Todos son servicios abiertos de OpenStreetMap; se usan con poco volumen y cache.
const UA = 'Gondolar/1.0 (app local para comparar precios de supermercados)';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
// Servidores públicos de Overpass (a veces se saturan): se prueban en orden con esperas cortas.
const OVERPASS = [
  { url: 'https://overpass-api.de/api/interpreter', timeout: 18000 },
  { url: 'https://overpass.kumi.systems/api/interpreter', timeout: 25000 },
  { url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', timeout: 30000 },
];
const OSRM = 'https://router.project-osrm.org';

// Cómo reconocer cada cadena en los datos de OSM (nombre o marca)
const CHAINS = {
  carrefour: { re: /carrefour/i, q: 'Carrefour' },
  jumbo: { re: /\bjumbo\b/i, q: 'Jumbo' },
  disco: { re: /\bdisco\b/i, q: 'Disco' },
  vea: { re: /\bvea\b/i, q: 'Vea' },
  dia: { re: /^\s*(supermercados?\s+)?d[ií]a\b/i, q: 'D[ií]a' },
  changomas: { re: /chango\s*m[aá]s|walmart/i, q: 'Chango|Walmart' },
  coto: { re: /\bcoto\b/i, q: 'Coto' },
  cordiez: { re: /cordiez/i, q: 'Cordiez' },
  josimar: { re: /josimar/i, q: 'Josimar' },
};

async function getJson(url, { method = 'GET', body, headers = {}, timeout = 25000 } = {}) {
  const res = await fetch(url, { method, body, headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function geocode(q) {
  const url = `${NOMINATIM}/search?format=jsonv2&countrycodes=ar&limit=5&addressdetails=0&accept-language=es&q=${encodeURIComponent(q)}`;
  const data = await getJson(url);
  const seen = new Set();
  return data.map((r) => ({ label: r.display_name, lat: +r.lat, lon: +r.lon })).filter((r) => !seen.has(r.label) && seen.add(r.label));
}

async function reverse(lat, lon) {
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=17&accept-language=es&lat=${lat}&lon=${lon}`;
  const r = await getJson(url);
  return r && r.display_name ? { label: r.display_name } : null;
}

const rad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

async function overpass(lat, lon, radiusM, chainIds) {
  const re = chainIds.map((id) => CHAINS[id].q).join('|');
  const q = `[out:json][timeout:40];nwr["shop"]["name"~"${re}",i](around:${radiusM},${lat},${lon});out center tags 600;`;
  let last;
  for (const { url, timeout } of OVERPASS) {
    try { return (await getJson(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeout })).elements || []; }
    catch (e) { last = e; }
  }
  throw new Error('El servicio de mapas está saturado, probá de nuevo en un minuto (' + (last && last.message) + ')');
}

function describe(tags) {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  return [street, tags['addr:suburb'] || tags['addr:city']].filter(Boolean).join(', ');
}

// Sucursales candidatas por cadena, ordenadas por distancia en línea recta
function classify(elements, home, chainIds) {
  const by = Object.fromEntries(chainIds.map((id) => [id, []]));
  const seen = new Set();
  for (const el of elements) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const text = `${t.name || ''} | ${t.brand || ''}`;
    const id = chainIds.find((c) => CHAINS[c].re.test(t.name || '') || CHAINS[c].re.test(t.brand || ''));
    if (!id) continue;
    const key = `${id}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    by[id].push({ name: t.name || t.brand || text, address: describe(t), lat, lon, straightKm: haversineKm(home, { lat, lon }) });
  }
  Object.values(by).forEach((l) => l.sort((a, b) => a.straightKm - b.straightKm));
  return by;
}

// Ruta en auto desde casa a cada candidato (una sola consulta). Si OSRM falla, estima.
async function route(home, candidates) {
  if (!candidates.length) return [];
  try {
    const coords = [home, ...candidates].map((p) => `${p.lon},${p.lat}`).join(';');
    const r = await getJson(`${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`, { timeout: 20000 });
    if (r.code !== 'Ok' || !r.durations || !r.distances) throw new Error('OSRM ' + r.code);
    return candidates.map((_, i) => ({ driveMin: r.durations[0][i + 1] / 60, driveKm: r.distances[0][i + 1] / 1000, estimated: false }));
  } catch {
    return candidates.map((c) => ({ driveKm: c.straightKm * 1.35, driveMin: (c.straightKm * 1.35 / 28) * 60, estimated: true }));
  }
}

async function nearby(lat, lon, storeIds) {
  // coordenadas redondeadas (~100 m) para no enviar la ubicación exacta de casa a los servicios de mapas
  const home = { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
  const ids = storeIds.filter((id) => CHAINS[id]);
  const found = Object.fromEntries(ids.map((id) => [id, []]));
  let pending = ids;
  for (const radius of [4000, 30000]) {
    if (!pending.length) break;
    const els = await overpass(home.lat, home.lon, radius, pending);
    const by = classify(els, home, pending);
    pending.forEach((id) => { found[id] = by[id]; });
    pending = pending.filter((id) => !found[id].length);
  }
  const out = {};
  const top = Object.fromEntries(ids.map((id) => [id, found[id].slice(0, 3)]));
  const flat = ids.flatMap((id) => top[id].map((c) => ({ id, ...c })));
  const routed = await route(home, flat);
  ids.forEach((id) => {
    const cands = flat.map((c, i) => ({ ...c, ...routed[i] })).filter((c) => c.id === id);
    if (!cands.length) { out[id] = null; return; }
    const best = cands.sort((a, b) => a.driveMin - b.driveMin)[0];
    out[id] = { name: best.name, address: best.address, lat: best.lat, lon: best.lon, straightKm: +best.straightKm.toFixed(2), driveKm: +best.driveKm.toFixed(2), driveMin: +best.driveMin.toFixed(1), estimated: best.estimated };
  });
  return out;
}

module.exports = { geocode, reverse, nearby, CHAINS };
