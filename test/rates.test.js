// Pruebas de las cotizaciones del dólar sin usar la red. Se ejecuta con `npm test`.
const assert = require('node:assert/strict');
const { fromDolarApi, fromCriptoYa } = require('../lib/rates');

const now = Date.parse('2026-09-29T21:00:00Z');

// dolarapi: se quedan las cotizaciones conocidas y con precio de venta válido
const g = fromDolarApi([
  { casa: 'oficial', compra: 1495, venta: 1545, fechaActualizacion: '2026-09-29T18:00:00.000Z' },
  { casa: 'blue', compra: 1540, venta: 1560, fechaActualizacion: '2026-09-29T20:57:00.000Z' },
  { casa: 'mayorista', compra: 1513, venta: 1522, fechaActualizacion: '2026-09-29T16:20:00.000Z' }, // no se ofrece
  { casa: 'cripto', compra: 1, venta: null, fechaActualizacion: '2026-09-29T20:00:00.000Z' },        // sin venta
], now);
assert.deepEqual(g.map((r) => r.id), ['oficial', 'blue']);
assert.equal(g[1].sell, 1560);
assert.equal(g[1].group, 'general');
assert.deepEqual(fromDolarApi(null, now), []);

// criptoya: los bancos con cotización vieja se descartan; los datos van en segundos
const sec = (iso) => Date.parse(iso) / 1000;
const b = fromCriptoYa({
  bna: { ask: 1545, totalAsk: 1545, bid: 1495, totalBid: 1495, time: sec('2026-09-29T20:50:00Z') },
  galicia: { ask: 1470, totalAsk: 1470, bid: 1420, totalBid: 1420, time: sec('2025-12-19T00:00:00Z') }, // vieja
  macro: { ask: 0, totalAsk: 0, bid: 0, totalBid: 0, time: sec('2026-09-29T20:50:00Z') },              // sin precio
  desconocido: { ask: 1, totalAsk: 1, bid: 1, totalBid: 1, time: sec('2026-09-29T20:50:00Z') },
}, now);
assert.deepEqual(b.map((r) => r.id), ['banco-bna']);
assert.equal(b[0].sell, 1545);
assert.equal(b[0].label, 'Banco Nación');
assert.deepEqual(fromCriptoYa(undefined, now), []);

console.log('rates: todos los tests OK');
