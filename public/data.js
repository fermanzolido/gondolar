// Datos abiertos de SEPA (Precios Claros, Secretaría de Comercio de la Nación), ya procesados por scripts/build_sepa.py.
// Son archivos estáticos: meta.json, names.json (búsqueda), branches.json, prices/AR-X.json y promos/AR-X.json (uno por provincia).
// La búsqueda se hace acá, en el navegador: no se consulta a ningún supermercado.
window.Data = (() => {
  'use strict';
  const BASE = 'data/';
  const cache = {};
  let version = '';

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = (s) => norm(s).split(/[^a-z0-9ñ]+/).filter(Boolean);

  async function getJson(path, bust) {
    const res = await fetch(BASE + path + (bust ? '?v=' + bust : ''));
    if (!res.ok) throw new Error(`No pude cargar ${path} (${res.status})`);
    return res.json();
  }
  const once = (key, fn) => cache[key] || (cache[key] = fn().catch((e) => { delete cache[key]; throw e; }));

  // meta.json cambia todos los días: se pide con una marca por hora para no quedarse con una copia vieja
  const meta = () => once('meta', async () => {
    const m = await getJson('meta.json', Math.floor(Date.now() / 3600e3));
    version = m.fecha;
    return m;
  });

  // nombres de todos los productos (para buscar). Se prepara un texto normalizado por producto.
  const names = () => once('names', async () => {
    await meta();
    const d = await getJson('names.json', version);
    const hay = d.e.map((_, i) => norm(d.n[i] + ' ' + d.m[i]));
    return { ...d, hay };
  });

  // precios de una provincia: { ean: [precio por cadena, en el orden de meta.cadenas] }
  const prices = (prov) => once('p:' + prov, async () => { await meta(); return getJson(`prices/${prov}.json`, version); });
  // promociones vigentes de una provincia: { t: [textos], p: { ean: [[cadena, precio, %, hasta, tipo, texto, sucursales%], ...] } }
  // tipo: 0 = precio promocional para cualquiera, 1 = pide un medio de pago, 2 = pide comprar varias unidades
  const promos = (prov) => once('promo:' + prov, async () => { await meta(); try { return await getJson(`promos/${prov}.json`, version); } catch { return { t: [], p: {} }; } });
  // Índice de fotos de productos (Open Food Facts): { i: { ean: "front_es.93" | "779/089/500/0997/front_es.93" } }.
  // Solo se pide si la persona permitió las fotos. null si la publicación no lo trae.
  const images = () => once('images', async () => { await meta(); try { return await getJson('imagenes.json', version); } catch { return null; } });
  const IMG_BASE = 'https://images.openfoodfacts.org/images/products/';
  const folder = (ean) => (/^\d{13}$/.test(ean) ? `${ean.slice(0, 3)}/${ean.slice(3, 6)}/${ean.slice(6, 9)}/${ean.slice(9)}` : null);
  // Dirección de la foto (miniatura de 200 px) de un producto, o '' si no tiene
  function imageUrl(index, ean) {
    const v = index && index.i && index.i[ean];
    if (!v) return '';
    const path = v.includes('/') ? v : (folder(ean) ? `${folder(ean)}/${v}` : '');
    return path && /^[\w./-]+$/.test(path) && !path.includes('..') ? `${IMG_BASE}${path}.200.jpg` : '';
  }
  const branches = () => once('branches', async () => { await meta(); return getJson('branches.json', version); });

  // Nombre para mostrar: agrega la cantidad ("500 gr") solo si el nombre no trae ningún número.
  const display = (name, q) => (q && !/\d/.test(name) ? `${name} ${q}` : name);

  /**
   * Busca productos que tengan precio en la provincia. Todas las palabras escritas tienen que aparecer.
   * Orden: primero los que están en más cadenas, luego los que empiezan con lo buscado y los nombres más cortos.
   */
  async function search(query, prov, limit = 30) {
    const [n, table] = await Promise.all([names(), prices(prov)]);
    const tokens = words(query);
    if (!tokens.length) return [];
    const out = [];
    for (let i = 0; i < n.e.length; i++) {
      const row = table[n.e[i]];
      if (!row) continue;
      const h = n.hay[i];
      let ok = true;
      for (const t of tokens) if (!h.includes(t)) { ok = false; break; }
      if (!ok) continue;
      const chains = row.reduce((c, p) => c + (p ? 1 : 0), 0);
      const starts = h.startsWith(tokens[0]) ? 1 : 0;
      out.push({ i, score: chains * 100 + starts * 25 - Math.min(n.n[i].length, 60) / 4 });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit).map(({ i }) => ({ ean: n.e[i], name: display(n.n[i], n.q[i]), brand: n.m[i] }));
  }

  // Sucursales oficiales más cercanas a un punto, por cadena. Devuelve { idCadena: [{...sucursal, straightKm}] }
  const rad = (d) => (d * Math.PI) / 180;
  function haversineKm(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  async function nearestBranches(point, chains, perChain = 3) {
    const [m, list] = await Promise.all([meta(), branches()]);
    const out = Object.fromEntries(chains.map((id) => [id, []]));
    for (const b of list) {
      const id = m.cadenas[b[0]].id;
      if (!out[id] || b[6] == null) continue;
      const straightKm = haversineKm(point, { lat: b[6], lon: b[7] });
      out[id].push({ name: b[2], address: b[3], localidad: b[4], prov: b[5], lat: b[6], lon: b[7], tipo: b[8], straightKm });
    }
    for (const id of chains) out[id] = out[id].sort((a, b) => a.straightKm - b.straightKm).slice(0, perChain);
    return out;
  }

  return { meta, names, prices, promos, images, imageUrl, branches, search, nearestBranches, haversineKm, display };
})();
