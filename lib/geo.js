// Ubicación: geocodificación (Nominatim de OpenStreetMap) y ruta en auto (OSRM).
// Las sucursales ya no se buscan acá: salen de los datos oficiales de SEPA (ver scripts/build_sepa.py).
// Se usan servicios abiertos con poco volumen y caché.
const UA = 'Gondolar/1.0 (+https://github.com/fermanzolido/gondolar; app para comparar precios de supermercados)';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org';

// Nominatim informa la provincia con el código ISO 3166-2 ("AR-B"); si faltara, se usa el nombre.
const PROV_BY_NAME = {
  'ciudad autonoma de buenos aires': 'AR-C', 'buenos aires': 'AR-B', 'catamarca': 'AR-K', 'chaco': 'AR-H', 'chubut': 'AR-U',
  'cordoba': 'AR-X', 'corrientes': 'AR-W', 'entre rios': 'AR-E', 'formosa': 'AR-P', 'jujuy': 'AR-Y', 'la pampa': 'AR-L',
  'la rioja': 'AR-F', 'mendoza': 'AR-M', 'misiones': 'AR-N', 'neuquen': 'AR-Q', 'rio negro': 'AR-R', 'salta': 'AR-A',
  'san juan': 'AR-J', 'san luis': 'AR-D', 'santa cruz': 'AR-Z', 'santa fe': 'AR-S', 'santiago del estero': 'AR-G',
  'tierra del fuego': 'AR-V', 'tucuman': 'AR-T',
};
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function provinceOf(address) {
  if (!address) return null;
  const iso = address['ISO3166-2-lvl4'] || address['ISO3166-2-lvl6'];
  if (/^AR-[A-Z]$/.test(iso || '')) return iso;
  return PROV_BY_NAME[plain(address.state)] || null;
}

async function getJson(url, { method = 'GET', body, headers = {}, timeout = 25000 } = {}) {
  const res = await fetch(url, { method, body, headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function geocode(q) {
  const url = `${NOMINATIM}/search?format=jsonv2&countrycodes=ar&limit=5&addressdetails=1&accept-language=es&q=${encodeURIComponent(q)}`;
  const data = await getJson(url);
  const seen = new Set();
  return data
    .map((r) => ({ label: r.display_name, lat: +r.lat, lon: +r.lon, prov: provinceOf(r.address) }))
    .filter((r) => !seen.has(r.label) && seen.add(r.label));
}

async function reverse(lat, lon) {
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=17&addressdetails=1&accept-language=es&lat=${lat}&lon=${lon}`;
  const r = await getJson(url);
  return r && r.display_name ? { label: r.display_name, prov: provinceOf(r.address) } : null;
}

const rad = (d) => (d * Math.PI) / 180;
function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Distancia y tiempo en auto desde casa a cada sucursal candidata, en una sola consulta.
// La ubicación de casa se redondea (~100 m) antes de salir hacia el servicio de rutas.
// Si OSRM no responde, se estima con la distancia en línea recta.
async function route(from, candidates) {
  if (!candidates.length) return [];
  const home = { lat: Math.round(from.lat * 1000) / 1000, lon: Math.round(from.lon * 1000) / 1000 };
  try {
    const coords = [home, ...candidates].map((p) => `${p.lon},${p.lat}`).join(';');
    const r = await getJson(`${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`, { timeout: 20000 });
    if (r.code !== 'Ok' || !r.durations || !r.distances) throw new Error('OSRM ' + r.code);
    return candidates.map((_, i) => ({ driveMin: +(r.durations[0][i + 1] / 60).toFixed(1), driveKm: +(r.distances[0][i + 1] / 1000).toFixed(2), estimated: false }));
  } catch {
    return candidates.map((c) => {
      const km = haversineKm(home, c) * 1.35;
      return { driveKm: +km.toFixed(2), driveMin: +((km / 28) * 60).toFixed(1), estimated: true };
    });
  }
}

module.exports = { geocode, reverse, route, provinceOf };
