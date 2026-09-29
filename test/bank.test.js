const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Bank = require('../public/bank.js');

const P = (o) => ({ id: 'x', medio: 'Banco A', cadena: 'coto', dias: [2], pct: 20, tope: null, minimo: 0, desde: '2026-09-01', hasta: '2026-09-30', ...o });
const MARTES = 2, LUNES = 1;
const opts = (o) => ({ store: 'coto', subtotal: 10000, day: MARTES, iso: '2026-09-15', medios: new Set(['Banco A']), ...o });

// porcentaje simple, con tope y con compra mínima
assert.equal(Bank.ahorro(P({}), 10000), 2000);
assert.equal(Bank.ahorro(P({ tope: 1500 }), 10000), 1500);
assert.equal(Bank.ahorro(P({ minimo: 50000 }), 10000), 0);
assert.equal(Bank.ahorro(P({ minimo: 10000 }), 10000), 2000);   // justo en el mínimo: rige

// solo vale el día que corresponde, la cadena, el medio y mientras está vigente
assert.equal(Bank.mejor([P({})], opts({})).saving, 2000);
assert.equal(Bank.mejor([P({})], opts({ day: LUNES })), null);
assert.equal(Bank.mejor([P({})], opts({ store: 'jumbo' })), null);
assert.equal(Bank.mejor([P({})], opts({ medios: new Set(['Otro']) })), null);
assert.equal(Bank.mejor([P({})], opts({ iso: '2026-10-01' })), null);   // vencida
assert.equal(Bank.mejor([P({})], opts({ iso: '2026-09-30' })).saving, 2000);   // último día: vale
assert.equal(Bank.mejor([P({ desde: '2026-10-01', hasta: '2026-10-31' })], opts({})), null);   // todavía no empezó

// sin filtro de medio o de día (para sugerir "con qué pagar" y "qué día ir")
assert.equal(Bank.mejor([P({})], opts({ medios: null, day: null })).saving, 2000);

// elige la de mayor ahorro entre varias
const dos = [P({ id: 'a', medio: 'Banco A', pct: 10 }), P({ id: 'b', medio: 'Banco B', pct: 25 })];
assert.equal(Bank.mejor(dos, opts({ medios: new Set(['Banco A', 'Banco B']) })).promo.id, 'b');

// si no llega al mínimo lo informa
const ev = Bank.evaluar([P({ minimo: 50000 })], opts({}));
assert.equal(ev.length, 1);
assert.deepEqual([ev[0].saving, ev[0].motivo], [0, 'minimo']);

// medios disponibles (solo de las vigentes)
assert.deepEqual(Bank.medios([P({ medio: 'Zeta' }), P({ medio: 'Alfa' }), P({ medio: 'Vieja', hasta: '2026-08-31' })], '2026-09-15'), ['Alfa', 'Zeta']);

// textos de días
assert.equal(Bank.listaDias([2, 4]), 'los martes y jueves');
assert.equal(Bank.listaDias([1, 2, 3, 4, 5]), 'de lunes a viernes');
assert.equal(Bank.listaDias([5, 6, 0]), 'los viernes, sábados y domingos');
assert.equal(Bank.listaDias([3]), 'los miércoles');

// el archivo cargado a mano tiene el formato esperado (si alguien lo edita mal, falla acá)
const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'promos-bancos.json'), 'utf8'));
assert.match(file.actualizado, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(file.aviso && file.promos.length > 0);
const cadenas = new Set(['carrefour', 'jumbo', 'disco', 'vea', 'dia', 'changomas', 'coto', 'laanonima', 'toledo', 'marianomax', 'unicoop', 'california', 'comodin', 'farmacity']);
const ids = new Set();
for (const p of file.promos) {
  assert.ok(!ids.has(p.id), 'id repetido: ' + p.id); ids.add(p.id);
  assert.ok(p.medio && cadenas.has(p.cadena), 'cadena o medio inválido: ' + p.id);
  assert.ok(Array.isArray(p.dias) && p.dias.length && p.dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6), 'días inválidos: ' + p.id);
  assert.ok(p.pct > 0 && p.pct <= 100, 'porcentaje inválido: ' + p.id);
  assert.ok(p.tope === null || p.tope > 0, 'tope inválido: ' + p.id);
  assert.ok(p.tope === null || ['semana', 'mes'].includes(p.topePeriodo), 'período del tope: ' + p.id);
  assert.ok(Number.isFinite(p.minimo) && p.minimo >= 0, 'mínimo inválido: ' + p.id);
  assert.match(p.desde, /^\d{4}-\d{2}-\d{2}$/); assert.match(p.hasta, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(p.desde <= p.hasta, 'vigencia al revés: ' + p.id);
  assert.ok(p.fuentes.length && p.fuentes.every((u) => /^https:\/\//.test(u)), 'sin fuente: ' + p.id);
}

console.log('bank: todos los tests OK');
