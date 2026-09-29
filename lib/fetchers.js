// Conectores: cada uno devuelve ofertas normalizadas:
// { store, ean, name, brand, price, listPrice, url, sku, seller, promo }
// No se lee ninguna imagen: la app no muestra ni guarda fotos de productos.
// Nos identificamos con nombre real y dónde consultar: no se finge ser un navegador.
const UA = 'Gondolar/1.0 (+https://github.com/fermanzolido/gondolar; herramienta personal sin fines de lucro)';
const MAX_CONCURRENT = 10;
const TIMEOUT_MS = 15000;

let active = 0;
const waiting = [];
async function limited(fn) {
  if (active >= MAX_CONCURRENT) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; const next = waiting.shift(); if (next) next(); }
}

async function getJson(url) {
  return limited(async () => {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'user-agent': UA, accept: 'application/json', 'accept-language': 'es-AR,es;q=0.9' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'follow',
        });
        if (res.status === 404) return [];
        if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  });
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const isEan = (s) => /^\d{8,14}$/.test(s);

// ---------- VTEX ----------
function vtexOffers(store, products, onlyEan) {
  const out = [];
  for (const p of products || []) {
    for (const it of p.items || []) {
      const ean = clean(it.ean);
      if (!isEan(ean) || (onlyEan && ean !== onlyEan)) continue;
      const seller = (it.sellers || []).find((s) => s.commertialOffer && s.commertialOffer.AvailableQuantity > 0 && s.commertialOffer.Price > 0);
      if (!seller) continue;
      const o = seller.commertialOffer;
      const teaser = (o.Teasers || []).map((t) => t.name).filter(Boolean)[0];
      out.push({
        store: store.id, ean,
        name: clean(p.items.length > 1 ? it.nameComplete || p.productName : p.productName),
        brand: clean(p.brand),
        price: o.Price,
        listPrice: o.ListPrice > o.Price ? o.ListPrice : null,
        url: p.link || `${store.base}/${p.linkText}/p`,
        sku: it.itemId, seller: seller.sellerId,
        promo: teaser ? clean(teaser) : null,
      });
    }
  }
  return out;
}
const vtex = {
  async search(store, q, limit) {
    const url = `${store.base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=0&_to=${limit - 1}`;
    return vtexOffers(store, await getJson(url));
  },
  async byEan(store, ean) {
    const url = `${store.base}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}`;
    return vtexOffers(store, await getJson(url), ean)[0] || null;
  },
};

// ---------- Coto (Endeca) ----------
function findResults(node) {
  if (!node || typeof node !== 'object') return null;
  if (!Array.isArray(node) && Array.isArray(node.records) && 'recsPerPage' in node) return node.records;
  for (const k in node) { const r = findResults(node[k]); if (r) return r; }
  return null;
}
const first = (a, k) => (a && a[k] && a[k][0]) || '';
function cotoOffers(store, json, onlyEan) {
  const out = [];
  for (const rec of findResults(json) || []) {
    const sku = rec.records && rec.records[0] && rec.records[0].attributes;
    if (!sku) continue;
    const ean = clean(first(sku, 'product.eanPrincipal'));
    if (!isEan(ean) || (onlyEan && ean !== onlyEan)) continue;
    const price = parseFloat(first(sku, 'sku.activePrice'));
    if (!(price > 0)) continue;
    let promo = null;
    try {
      const d = JSON.parse(first(sku, 'product.dtoDescuentos') || '[]')[0];
      if (d) promo = clean(`${d.textoDescuento || ''} ${d.textoLlevando ? '(' + d.textoLlevando + ')' : ''}`);
    } catch { /* sin promo */ }
    const state = (rec.detailsAction && rec.detailsAction.recordState) || '';
    out.push({
      store: store.id, ean,
      name: clean(first(sku, 'product.displayName') || first(sku, 'sku.displayName')),
      brand: clean(first(sku, 'product.brand')),
      price, listPrice: null,
      url: state ? `${store.base}/sitios/cdigi/productos${state.replace(/\?.*$/, '')}` : store.base,
      sku: null, seller: null, promo,
    });
  }
  return out;
}
const coto = {
  async search(store, q, limit) {
    const url = `${store.base}/sitios/cdigi/categoria?_dyncharset=utf-8&Ntt=${encodeURIComponent(q)}&Nrpp=${limit}&format=json`;
    return cotoOffers(store, await getJson(url));
  },
  async byEan(store, ean) {
    const url = `${store.base}/sitios/cdigi/categoria?_dyncharset=utf-8&Ntk=product.eanPrincipal&Ntt=${ean}&Ntx=mode%2Bmatchall&Nrpp=5&format=json`;
    return cotoOffers(store, await getJson(url), ean)[0] || null;
  },
};

const connectors = { vtex, coto };
module.exports = {
  search: (store, q, limit = 12) => connectors[store.kind].search(store, q, limit),
  byEan: (store, ean) => connectors[store.kind].byEan(store, ean),
  vtexOffers, cotoOffers,
};
