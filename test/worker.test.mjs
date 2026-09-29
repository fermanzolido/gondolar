// Pruebas del Worker y de la API sin usar la red: CORS, validaciones y rutas. Se ejecuta con `npm test`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { default: worker } = await import('../worker/index.mjs');
const { provinceOf } = require('../lib/geo');
const call = (path, init = {}, env = {}) => worker.fetch(new Request('https://api.test' + path, init), env);

// preflight de CORS
let r = await call('/api/route', { method: 'OPTIONS', headers: { origin: 'https://yo.github.io' } });
assert.equal(r.status, 204);
assert.equal(r.headers.get('access-control-allow-origin'), '*');
assert.match(r.headers.get('access-control-allow-methods'), /POST/);

// con ALLOWED_ORIGIN solo entra esa web
const env = { ALLOWED_ORIGIN: 'https://yo.github.io' };
r = await call('/api/geocode?q=a', { headers: { origin: 'https://otro.com' } }, env);
assert.equal(r.status, 403);
r = await call('/api/geocode?q=a', { headers: { origin: 'https://yo.github.io' } }, env);
assert.equal(r.status, 400); // pasó el filtro de origen y falló la validación (texto muy corto)
assert.equal(r.headers.get('access-control-allow-origin'), 'https://yo.github.io');

// validaciones de /api/route (todas antes de tocar la red)
const post = (body) => call('/api/route', { method: 'POST', body: JSON.stringify(body) });
r = await post({ lat: 999, lon: 0, candidates: [] });
assert.equal(r.status, 400);
r = await post({ lat: -34.6, lon: -58.4, candidates: [{ lat: 'x', lon: 1 }] });
assert.equal(r.status, 400);
r = await post({ lat: -34.6, lon: -58.4, candidates: Array.from({ length: 61 }, () => ({ lat: -34.6, lon: -58.4 })) });
assert.equal(r.status, 400);
assert.match((await r.json()).error, /Máximo/);
r = await post({ lat: -34.6, lon: -58.4, candidates: [] });
assert.equal(r.status, 200);
assert.deepEqual((await r.json()).routes, []);

// lo que ya no existe: los precios no se consultan en vivo
for (const p of ['/api/search?q=leche', '/api/prices', '/api/stores', '/api/nearby']) {
  r = await call(p);
  assert.equal(r.status, 404, p);
}
r = await call('/api/reverse?lat=x&lon=y');
assert.equal(r.status, 400);
r = await call('/');
assert.equal(r.status, 200);

// provincia a partir de la respuesta de Nominatim
assert.equal(provinceOf({ 'ISO3166-2-lvl4': 'AR-B' }), 'AR-B');
assert.equal(provinceOf({ state: 'Ciudad Autónoma de Buenos Aires' }), 'AR-C');
assert.equal(provinceOf({ state: 'Córdoba' }), 'AR-X');
assert.equal(provinceOf({ state: 'Tucumán' }), 'AR-T');
assert.equal(provinceOf({ state: 'Atlantis' }), null);
assert.equal(provinceOf(undefined), null);

console.log('worker: todos los tests OK');
