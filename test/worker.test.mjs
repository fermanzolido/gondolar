// Pruebas del Worker sin usar la red: CORS, límites y rutas. Se ejecuta con `npm test`.
import assert from 'node:assert/strict';

const { default: worker } = await import('../worker/index.mjs');
const call = (path, init = {}, env = {}) => worker.fetch(new Request('https://api.test' + path, init), env);

// preflight de CORS
let r = await call('/api/prices', { method: 'OPTIONS', headers: { origin: 'https://yo.github.io' } });
assert.equal(r.status, 204);
assert.equal(r.headers.get('access-control-allow-origin'), '*');
assert.match(r.headers.get('access-control-allow-methods'), /POST/);

// lista de tiendas
r = await call('/api/stores');
assert.equal(r.status, 200);
assert.ok((await r.json()).some((s) => s.id === 'carrefour'));

// con ALLOWED_ORIGIN solo entra esa web
const env = { ALLOWED_ORIGIN: 'https://yo.github.io' };
r = await call('/api/stores', { headers: { origin: 'https://otro.com' } }, env);
assert.equal(r.status, 403);
r = await call('/api/stores', { headers: { origin: 'https://yo.github.io' } }, env);
assert.equal(r.status, 200);
assert.equal(r.headers.get('access-control-allow-origin'), 'https://yo.github.io');

// el límite de combinaciones producto x tienda protege el máximo de consultas externas de Cloudflare
const eans = Array.from({ length: 10 }, (_, i) => String(7790000000000 + i));
r = await call('/api/prices', { method: 'POST', body: JSON.stringify({ eans, stores: ['carrefour', 'jumbo', 'disco', 'vea'] }) });
assert.equal(r.status, 400);
assert.match((await r.json()).error, /Demasiados/);

// validaciones y rutas inexistentes
r = await call('/api/search?q=a');
assert.equal(r.status, 400);
r = await call('/api/nearby', { method: 'POST', body: JSON.stringify({ lat: 999, lon: 0 }) });
assert.equal(r.status, 400);
r = await call('/api/no-existe');
assert.equal(r.status, 404);
r = await call('/');
assert.equal(r.status, 200);

console.log('worker: todos los tests OK');
