// Cotizaciones del dólar para el selector de moneda. Se piden desde el servidor (no desde el navegador)
// para que ni la IP ni los datos de quien usa la web lleguen a esos servicios.
//  - dolarapi.com: oficial, blue, MEP (bolsa), contado con liqui, cripto y tarjeta.
//  - criptoya.com: cotización oficial de cada banco. Algunos bancos dejan de actualizarse: se descartan.

const UA = 'Gondolar/1.0 (+https://github.com/fermanzolido/gondolar; herramienta personal sin fines de lucro)';
const TIMEOUT_MS = 8000;
const MAX_BANK_AGE_MS = 3 * 24 * 3600e3; // una cotización de banco más vieja que esto no se ofrece

const GENERAL = [
  { casa: 'oficial', label: 'Oficial' },
  { casa: 'blue', label: 'Blue' },
  { casa: 'bolsa', label: 'MEP (bolsa)' },
  { casa: 'contadoconliqui', label: 'Contado con liqui' },
  { casa: 'cripto', label: 'Cripto' },
  { casa: 'tarjeta', label: 'Tarjeta (con impuestos)' },
];
const BANKS = [
  { key: 'bna', label: 'Banco Nación' }, { key: 'galicia', label: 'Galicia' }, { key: 'santander', label: 'Santander' },
  { key: 'bbva', label: 'BBVA' }, { key: 'macro', label: 'Macro' }, { key: 'ciudad', label: 'Banco Ciudad' },
  { key: 'bapro', label: 'Banco Provincia' }, { key: 'hipotecario', label: 'Hipotecario' }, { key: 'supervielle', label: 'Supervielle' },
  { key: 'patagonia', label: 'Patagonia' }, { key: 'icbc', label: 'ICBC' }, { key: 'brubank', label: 'Brubank' },
];

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

const num = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

// dolarapi: [{ casa, compra, venta, fechaActualizacion }]
function fromDolarApi(data, now = Date.now()) {
  const byCasa = Object.fromEntries((Array.isArray(data) ? data : []).map((d) => [d.casa, d]));
  return GENERAL.map(({ casa, label }) => {
    const d = byCasa[casa];
    const sell = d && num(d.venta);
    if (!sell) return null;
    const at = Date.parse(d.fechaActualizacion);
    return { id: casa, label, group: 'general', buy: num(d.compra), sell, at: Number.isFinite(at) ? at : now };
  }).filter(Boolean);
}

// criptoya: { bna: { ask, bid, time (segundos) }, ... }. ask = a cuánto vende el banco.
function fromCriptoYa(data, now = Date.now()) {
  if (!data || typeof data !== 'object') return [];
  return BANKS.map(({ key, label }) => {
    const b = data[key];
    const sell = b && num(b.totalAsk || b.ask);
    if (!sell) return null;
    const at = Number(b.time) * 1000;
    if (!Number.isFinite(at) || now - at > MAX_BANK_AGE_MS) return null;
    return { id: `banco-${key}`, label, group: 'banco', buy: num(b.totalBid || b.bid), sell, at };
  }).filter(Boolean);
}

async function fetchRates() {
  const [general, banks] = await Promise.allSettled([
    getJson('https://dolarapi.com/v1/dolares').then((d) => fromDolarApi(d)),
    getJson('https://criptoya.com/api/bancostodos').then((d) => fromCriptoYa(d)),
  ]);
  const list = [...(general.status === 'fulfilled' ? general.value : []), ...(banks.status === 'fulfilled' ? banks.value : [])];
  if (!list.length) throw new Error('No se pudieron obtener las cotizaciones del dólar');
  return { list, at: Math.max(...list.map((r) => r.at)) };
}

module.exports = { fetchRates, fromDolarApi, fromCriptoYa };
