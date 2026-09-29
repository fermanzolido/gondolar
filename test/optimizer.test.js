const assert = require('node:assert/strict');
const { plan } = require('../public/optimizer.js');
const o = (price) => ({ price });
const S = (id, trip, mandatory = false) => ({ id, trip, mandatory });

// A es más barato en leche, B en pan, C en todo carísimo. Sin costo de viaje conviene A+B.
let prices = { leche: { A: o(100), B: o(150), C: o(200) }, pan: { A: o(300), B: o(200), C: o(400) } };
let items = [{ ean: 'leche', qty: 2 }, { ean: 'pan', qty: 1 }];
let r = plan({ items, prices, stores: [S('A', 0), S('B', 0), S('C', 0)] });
assert.deepEqual(r.best.stores, ['A', 'B']);
assert.equal(r.best.itemsCost, 400);
assert.equal(r.best.assignment.leche.store, 'A');
assert.equal(r.best.assignment.pan.store, 'B');

// Con viaje caro (500 c/u) conviene una sola tienda: A (500 + 500 = 1000) vs B (300+200+500=1000+...)
r = plan({ items, prices, stores: [S('A', 500), S('B', 500), S('C', 500)] });
assert.equal(r.best.k, 1);
assert.deepEqual(r.best.stores, ['A']);
assert.equal(r.best.total, 500 + 200 + 300);
assert.equal(r.options.length, 2); // 1 y 2 tiendas (3 tiendas nunca se usa la C)

// Tienda obligatoria: viajar a A es gratis, sumar B solo si el ahorro supera su viaje
r = plan({ items, prices, stores: [S('A', 500, true), S('B', 100)] });
assert.deepEqual(r.best.stores, ['A']); // ahorro en pan = 100 = viaje 100: en empate gana la opción con menos paradas
r = plan({ items, prices, stores: [S('A', 500, true), S('B', 90)] });
assert.deepEqual(r.best.stores, ['A', 'B']);
assert.equal(r.worth[0].worth, true);
r = plan({ items, prices, stores: [S('A', 500, true), S('B', 150)] });
assert.deepEqual(r.best.stores, ['A']);

// Producto que solo tiene una tienda: esa tienda es obligatoria para el plan
prices = { leche: { A: o(100), B: null }, raro: { A: null, B: o(999) } };
items = [{ ean: 'leche', qty: 1 }, { ean: 'raro', qty: 1 }];
r = plan({ items, prices, stores: [S('A', 10), S('B', 10)] });
assert.deepEqual(r.best.stores, ['A', 'B']);
assert.equal(r.worth.every((w) => w.required), true);

// Producto que no está en ninguna tienda queda en "uncovered"
prices = { leche: { A: o(100) }, fantasma: {} };
items = [{ ean: 'leche', qty: 1 }, { ean: 'fantasma', qty: 1 }];
r = plan({ items, prices, stores: [S('A', 0)] });
assert.equal(r.uncovered.length, 1);
assert.equal(r.best.total, 100);
assert.equal(r.singles[0].complete, true);

// Tienda elegida por la persona: se compra ahí aunque sea más caro, y esa tienda entra al recorrido
prices = { leche: { A: o(100), B: o(50) }, pan: { A: o(10), B: o(20) } };
items = [{ ean: 'leche', qty: 1, only: 'A' }, { ean: 'pan', qty: 1 }];
r = plan({ items, prices, stores: [S('A', 0), S('B', 0)] });
assert.equal(r.best.assignment.leche.store, 'A'); // no en B, aunque B sea más barato
assert.equal(r.best.assignment.leche.price, 100);
assert.equal(r.best.assignment.pan.store, 'A');
items = [{ ean: 'leche', qty: 1, only: 'B' }, { ean: 'pan', qty: 1 }];
r = plan({ items, prices, stores: [S('A', 500), S('B', 500)] });
assert.deepEqual(r.best.stores, ['B']); // B es obligatoria; sumar A por $10 de ahorro no conviene
assert.equal(r.best.assignment.pan.store, 'B');
r = plan({ items, prices, stores: [S('A', 0), S('B', 0)] });
assert.deepEqual(r.best.stores, ['A', 'B']); // sin costo de viaje, el pan sí va donde es más barato
assert.equal(r.best.assignment.leche.store, 'B');
assert.equal(r.worth.find((w) => w.store === 'B').required, true);
// tienda elegida que no está entre las activas: el producto queda sin cubrir
r = plan({ items: [{ ean: 'leche', qty: 1, only: 'Z' }, { ean: 'pan', qty: 1 }], prices, stores: [S('A', 0), S('B', 0)] });
assert.equal(r.uncovered.length, 1);

// Carrito vacío
r = plan({ items: [], prices: {}, stores: [S('A', 0)] });
assert.equal(r.best, null);

console.log('optimizer: todos los tests OK');
