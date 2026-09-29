(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const moneyInt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const moneyDec = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const moneyUsd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtArs = (n) => (Number.isInteger(Math.round(n * 100) / 100) ? moneyInt : moneyDec).format(n).replace(/\s/g, '');
  // Todos los importes de la pantalla salen de acá: en pesos, o convertidos con la cotización de dólar elegida.
  const fmt = (n) => { const r = activeRate(); return r ? moneyUsd.format(n / r.sell).replace(/\s/g, '') : fmtArs(n); };
  const pct = (n) => (n * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//.test(u) ? u : '#');

  // ---------- íconos (trazo, sin emojis) ----------
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    print: '<path d="M7 9V3h10v6M7 17H4v-6h16v6h-3M7 14h10v7H7z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    gps: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  };
  const ic = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

  // ---------- persistencia ----------
  const DEFAULT_SETTINGS = { nafta: 1700, consumo: 10, horaValor: 3000, compraMin: 20, prov: 'AR-C', stores: {} };
  const BRANCH_KEY = 'branches2'; // sucursales oficiales de SEPA (las de antes venían de OpenStreetMap y ya no se usan)
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado */ } };

  const state = {
    stores: [],
    cart: load('cart', []).map(({ ean, name, brand, qty }) => ({ ean, name, brand, qty })), // sin fotos (también limpia listas viejas)
    settings: { ...DEFAULT_SETTINGS, ...load('settings', {}) },
    checked: load('checked', {}),             // "tienda|ean" -> true (ya lo puse en el carrito)
    prices: {},                               // ean -> tienda -> oferta { store, ean, price, url } | null (esa cadena no lo informa)
    data: null,                               // meta.json de los datos de SEPA (fecha, cadenas, provincias)
    table: null,                              // precios de la provincia elegida: ean -> [precio por cadena]
    dataError: '',
    view: 'search', selectedK: null,
    filters: { brands: new Set(), min: '', max: '', sort: 'rel', comparable: false, allBrands: false },
    meta: {},                                 // ean -> { brand, name } (para detectar marca propia)
    loadingPrices: false, searching: false,
    lastGroups: [], searchRan: false, confirmClear: false,
    home: load('home', null),                 // { lat, lon, label, prov } — solo vive en este navegador
    branches: load(BRANCH_KEY, { key: '', byStore: {} }), // tienda -> sucursal más cercana | null (no hay) | undefined (sin buscar)
    locating: false, branchError: '', editHome: false, geoResults: [], geoMsg: '', geoBusy: false, geoQuery: '',
    currency: (() => { const c = load('currency', {}); return { cur: c.cur === 'USD' ? 'USD' : 'ARS', rate: typeof c.rate === 'string' ? c.rate : 'blue' }; })(),
    rates: null, ratesLoading: false, ratesError: '',   // { list: [{ id, label, group, buy, sell, at }], fetchedAt }
  };
  const persist = () => { save('cart', state.cart); save('settings', state.settings); };

  const storeById = (id) => state.stores.find((s) => s.id === id);
  const cfg = (id) => {
    const st = state.settings.stores[id] || (state.settings.stores[id] = {});
    const s = storeById(id) || {};
    if (st.km === undefined) st.km = 4;
    if (st.min === undefined) st.min = 25;
    if (st.mandatory === undefined) st.mandatory = false;
    if (st.manual === undefined) st.manual = false;   // true = el usuario cargó km/min a mano
    return st;
  };
  // Una tienda está activa si la persona la prendió. Si nunca tocó el interruptor:
  //  - las cadenas de todo el país se prenden solas cuando tienen sucursales en la provincia elegida;
  //  - las regionales (Toledo, Unicoop...) solo cuando hay una sucursal cerca de tu ubicación cargada;
  //  - las opcionales (farmacias) quedan apagadas.
  const explicit = (id) => state.settings.stores[id] && state.settings.stores[id].enabled;
  const wanted = (id) => {
    if (explicit(id) !== undefined) return explicit(id);
    const s = storeById(id), p = provinces()[state.settings.prov];
    return !!s && !s.optativa && !!p && (p.sucursales[id] || 0) > 0;
  };
  const isOn = (id) => {
    const s = storeById(id);
    if (explicit(id) !== undefined || !s || !s.regional) return wanted(id);
    return wanted(id) && !!state.home && !!branchOf(id);
  };
  // Con la ubicación cargada, una cadena sin ninguna sucursal cerca no entra en la comparación (salvo que cargues los km a mano).
  const usable = (id) => !(state.home && branchOf(id) === null && !cfg(id).manual);
  const enabledStores = () => state.stores.filter((s) => isOn(s.id) && usable(s.id));
  const sigla = (s) => s.sigla || s.name.slice(0, 2);
  const tripParts = (km, min) => {
    const g = state.settings;
    return { fuel: Math.round((km * g.consumo / 100) * g.nafta), time: Math.round((min / 60) * g.horaValor) };
  };
  const tripCost = (id) => { const c = cfg(id); const p = tripParts(c.km, c.min); return p.fuel + p.time; };

  // ---------- ubicación y sucursales ----------
  const homeKey = () => (state.home ? `${state.home.lat.toFixed(3)},${state.home.lon.toFixed(3)}` : '');
  const shortLabel = (l) => String(l || '').split(',').slice(0, 3).join(',').trim();
  const kmText = (n) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });
  const MAX_BRANCH_KM = 100; // más lejos que esto no se propone ninguna sucursal
  const branchOf = (id) => (state.home && state.branches.key === homeKey() ? state.branches.byStore[id] : undefined);
  const mapsLink = (b) => `https://www.google.com/maps/dir/?api=1&origin=${state.home.lat},${state.home.lon}&destination=${b.lat},${b.lon}&travelmode=driving`;

  // km y minutos del viaje (ida y vuelta) a partir de la sucursal encontrada
  function applyBranch(id) {
    const b = branchOf(id), c = cfg(id);
    if (!b || c.manual) return;
    c.km = Math.round(b.driveKm * 2 * 10) / 10;
    c.min = Math.round(b.driveMin * 2 + state.settings.compraMin);
  }
  const afterTripChange = () => {
    state.selectedK = null; persist(); renderStoreChips(); renderResults(); renderSide(); renderDock();
    if (state.view === 'trip') renderTrip();
    if (state.view === 'plan') renderPlanView();
  };
  async function fetchBranches(force = false) {
    if (!state.home) return;
    if (state.branches.key !== homeKey()) state.branches = { key: homeKey(), byStore: {} };
    const need = state.stores.filter((s) => wanted(s.id)).map((s) => s.id).filter((id) => force || state.branches.byStore[id] === undefined);
    if (!need.length) { need.forEach(applyBranch); return; }
    state.locating = true; state.branchError = ''; if (state.view === 'trip') renderTrip();
    try {
      // 1) las sucursales más cercanas de cada cadena salen de los datos oficiales, sin pedirle nada a ningún servidor
      const near = await Data.nearestBranches({ lat: state.home.lat, lon: state.home.lon }, need, 3);
      const cands = need.flatMap((id) => near[id].filter((b) => b.straightKm <= MAX_BRANCH_KM).map((b) => ({ id, ...b })));
      // 2) solo la distancia por calle se calcula con el servicio de rutas (con la ubicación de casa redondeada)
      let routes;
      try { routes = (await api('/api/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lat: state.home.lat, lon: state.home.lon, candidates: cands.map((c) => ({ lat: c.lat, lon: c.lon })) }) })).routes; }
      catch { routes = cands.map((c) => ({ driveKm: +(c.straightKm * 1.35).toFixed(2), driveMin: +((c.straightKm * 1.35 / 28) * 60).toFixed(1), estimated: true })); }
      need.forEach((id) => {
        const mine = cands.map((c, i) => ({ ...c, ...routes[i] })).filter((c) => c.id === id).sort((a, b) => a.driveMin - b.driveMin);
        const b = mine[0];
        state.branches.byStore[id] = b ? { name: b.name, address: [b.address, b.localidad].filter(Boolean).join(', '), lat: b.lat, lon: b.lon, straightKm: +b.straightKm.toFixed(2), driveKm: b.driveKm, driveMin: b.driveMin, estimated: b.estimated } : null;
      });
      state.stores.forEach((s) => applyBranch(s.id));
      save(BRANCH_KEY, state.branches);
    } catch (e) { state.branchError = 'No pude buscar las sucursales (' + e.message + '). Podés cargar los km a mano.'; }
    state.locating = false;
    afterTripChange();
  }
  function setHome(h) {
    state.home = h; save('home', h);
    if (h.prov) setProvince(h.prov); // los precios cambian según la provincia
    state.branches = { key: homeKey(), byStore: {} }; save(BRANCH_KEY, state.branches);
    state.stores.forEach((s) => { cfg(s.id).manual = false; });
    state.editHome = false; state.geoResults = []; state.geoMsg = '';
    persist(); afterTripChange();
    fetchBranches();
  }
  async function searchAddress(q) {
    if (q.trim().length < 4) { state.geoMsg = 'Escribí calle y altura, por ejemplo "Av. Rivadavia 1234, Ramos Mejía".'; renderTrip(); return; }
    state.geoQuery = q; state.geoBusy = true; state.geoMsg = ''; state.geoResults = []; renderTrip();
    try { state.geoResults = await api('/api/geocode?q=' + encodeURIComponent(q.trim())); state.geoMsg = state.geoResults.length ? '' : 'No encontré esa dirección. Probá agregando la localidad.'; }
    catch (e) { state.geoMsg = 'No pude buscar la dirección: ' + e.message; }
    state.geoBusy = false; renderTrip();
  }
  function useGps() {
    if (!navigator.geolocation) { state.geoMsg = 'Este navegador no permite usar el GPS. Escribí tu dirección.'; renderTrip(); return; }
    state.geoBusy = true; state.geoMsg = 'Esperando el permiso de ubicación…'; renderTrip();
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const h = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Tu ubicación (GPS)' };
      state.geoBusy = false; setHome(h);
      try {
        const r = await api(`/api/reverse?lat=${h.lat}&lon=${h.lon}`);
        if (r && r.label && state.home === h) {
          h.label = r.label; if (r.prov) h.prov = r.prov; save('home', h);
          if (r.prov) setProvince(r.prov);
          if (state.view === 'trip') renderTrip();
        }
      } catch { /* queda "GPS" */ }
    }, (err) => {
      state.geoBusy = false;
      state.geoMsg = err.code === 1 ? 'No diste permiso de ubicación. Habilitalo en el navegador o escribí tu dirección.' : 'No pude obtener tu ubicación. Escribí tu dirección.';
      renderTrip();
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  }
  const cartQty = (ean) => (state.cart.find((i) => i.ean === ean) || {}).qty || 0;
  const itemByEan = (ean) => state.cart.find((i) => i.ean === ean);
  const offerOf = (ean, id) => state.prices[ean]?.[id];
  const mk = (id, small) => { const s = storeById(id); return s ? `<span class="mk${small ? ' sm' : ''}" style="--c:${s.color}" title="${esc(s.name)}">${esc(sigla(s))}</span>` : ''; };
  const who = (id) => `${mk(id, true)}${esc(storeById(id).name)}`;

  // ---------- marca propia ----------
  // Productos como "Carrefour Classic" o "Coto" solo se venden en su cadena: no se buscan en las demás.
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  function privateOwners(brand) {
    const b = norm(brand);
    if (/\bcarrefour\b/.test(b)) return ['carrefour'];
    if (/\bcoto\b/.test(b)) return ['coto'];
    if (/^(dia|mi dia|dia market|dia premium)$/.test(b)) return ['dia'];
    if (/\b(jumbo|disco|vea|cencosud)\b/.test(b)) return ['jumbo', 'disco', 'vea']; // Cencosud comparte marcas propias
    if (/great value|\bchango ?mas\b|equate|^check$/.test(b)) return ['changomas'];
    return null;
  }
  const ownersFor = (ean) => privateOwners(state.meta[ean] && state.meta[ean].brand);

  // ---------- red ----------
  const API_BASE = ((window.CONFIG && window.CONFIG.API_BASE) || '').replace(/\/+$/, '');
  async function api(url, opts) {
    const res = await fetch(API_BASE + url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
    return data;
  }

  // ---------- precios: datos abiertos de SEPA ----------
  const provinces = () => (state.data ? state.data.provincias : {});
  const provName = (p) => (provinces()[p] ? provinces()[p].nombre : p);
  const dataDate = () => (state.data ? new Date(state.data.fecha + 'T12:00:00') : null);
  const fmtDate = (d) => d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', year: 'numeric' });

  // Precio de un producto en cada cadena, según la provincia elegida (mediana de las sucursales de esa provincia).
  function derive(ean) {
    const row = state.table && state.table[ean];
    const cur = state.prices[ean] = {};
    state.stores.forEach((s, i) => { const p = row && row[i]; cur[s.id] = p ? { store: s.id, ean, price: p, url: s.web } : null; });
  }
  const deriveAll = () => { state.prices = {}; [...state.cart.map((i) => i.ean), ...state.lastGroups.map((g) => g.ean)].forEach(derive); };

  async function loadTable() {
    try {
      state.table = await Data.prices(state.settings.prov);
      state.dataError = '';
    } catch (e) {
      state.table = null; state.dataError = 'No pude cargar los precios de ' + provName(state.settings.prov) + ' (' + e.message + ').';
    }
    const b = $('#banner'); b.hidden = !state.dataError; b.textContent = state.dataError;
    deriveAll();
  }
  // cambia la provincia de los precios (a mano o desde la ubicación) y vuelve a dibujar lo que muestra importes
  async function setProvince(prov) {
    if (!provinces()[prov] || state.settings.prov === prov) return;
    state.settings.prov = prov; persist();
    await loadTable();
    state.selectedK = null;
    renderStoreChips(); fetchBranches();
    refreshMoney();
  }
  // deja cargados los precios de los productos que se muestran o están en la lista
  function ensurePrices(eans) { eans.forEach((e) => { if (!state.prices[e]) derive(e); }); }
  async function ensureCartPrices() {
    if (!state.cart.length) return;
    if (!state.table) { state.loadingPrices = true; renderPlanView(); await loadTable(); state.loadingPrices = false; }
    ensurePrices(state.cart.map((i) => i.ean));
    renderSide(); renderDock();
    if (state.view === 'plan') renderPlanView();
  }
  // ---------- moneda ----------
  function activeRate() {
    if (state.currency.cur !== 'USD' || !state.rates) return null;
    const list = state.rates.list;
    return list.find((r) => r.id === state.currency.rate) || list.find((r) => r.id === 'oficial') || list[0] || null;
  }
  const rateTime = (at) => { const d = new Date(at); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }); };
  // texto corto para avisar que los importes están convertidos (lista copiada y notas al pie)
  const rateNote = () => { const r = activeRate(); return r ? `Importes en dólares, convertidos con el dólar ${r.group === 'banco' ? 'oficial de ' + r.label : r.label.toLowerCase()} a ${fmtArs(r.sell)} (precio de venta).` : ''; };
  function renderCur() {
    const usd = state.currency.cur === 'USD';
    $('#cur').innerHTML = `<div class="seg" role="group" aria-label="Moneda">
      <button type="button" data-cur="ARS" aria-pressed="${!usd}" title="Ver precios en pesos argentinos">ARS</button>
      <button type="button" data-cur="USD" aria-pressed="${usd}" title="Ver precios en dólares">USD</button></div>`;
    const bar = $('#curBar'); bar.hidden = !usd;
    if (!usd) { bar.innerHTML = ''; return; }
    const r = activeRate();
    let body;
    if (state.ratesLoading && !state.rates) body = '<span class="mute">Trayendo cotizaciones del dólar…</span>';
    else if (!state.rates) body = `<span class="warn">${esc(state.ratesError || 'Sin cotizaciones.')} Se muestran pesos.</span><button type="button" class="link" data-act="rates-retry">Reintentar</button>`;
    else {
      const opt = (x) => `<option value="${esc(x.id)}"${r && x.id === r.id ? ' selected' : ''}>${esc(x.label)} · ${fmtArs(x.sell)}</option>`;
      const gen = state.rates.list.filter((x) => x.group === 'general'), banks = state.rates.list.filter((x) => x.group === 'banco');
      body = `<label class="fld-inline"><span class="eyebrow">Dólar</span><select id="rateSel" class="select" aria-label="Cotización del dólar">
          <optgroup label="Cotizaciones">${gen.map(opt).join('')}</optgroup>${banks.length ? `<optgroup label="Bancos (oficial)">${banks.map(opt).join('')}</optgroup>` : ''}</select></label>
        <span class="xs mute">Convertido al precio de venta${r ? ` · actualizado ${rateTime(r.at)}` : ''}. Valor de referencia.</span>
        ${state.ratesError ? `<span class="xs warn">${esc(state.ratesError)}</span>` : ''}`;
    }
    bar.innerHTML = `<div class="curbar-in">${body}</div>`;
  }
  async function loadRates(force) {
    if (state.ratesLoading || (!force && state.rates && Date.now() - state.rates.fetchedAt < 10 * 60e3)) return;
    state.ratesLoading = true; state.ratesError = ''; renderCur();
    try { state.rates = { ...(await api('/api/dolar')), fetchedAt: Date.now() }; }
    catch { state.ratesError = state.rates ? 'No pude actualizar la cotización.' : 'No pude traer la cotización del dólar.'; }
    finally { state.ratesLoading = false; }
    renderCur(); refreshMoney();
  }
  function setCurrency(cur, rate) {
    state.currency = { cur, rate: rate || state.currency.rate };
    save('currency', state.currency);
    renderCur(); refreshMoney();
    if (cur === 'USD') loadRates();
  }
  // vuelve a dibujar todo lo que muestra importes
  function refreshMoney() {
    updateBarNote();
    if (!state.stores.length) return;
    renderFilters(); renderResults(); renderSide(); renderDock();
    if (state.view === 'plan') renderPlanView();
    if (state.view === 'trip') renderTrip();
  }

  function updateBarNote() {
    const d = dataDate();
    $('#barNote').textContent = d ? 'Precios oficiales del ' + fmtDate(d) : '';
  }

  // ---------- plan ----------
  function currentPlan() {
    const stores = enabledStores().map((s) => ({ id: s.id, trip: tripCost(s.id), mandatory: cfg(s.id).mandatory }));
    return Optimizer.plan({ items: state.cart.map((i) => ({ ean: i.ean, qty: i.qty })), prices: state.prices, stores });
  }
  function planByStore(option) {
    const by = {};
    option.stores.forEach((id) => { by[id] = []; });
    Object.entries(option.assignment).forEach(([ean, a]) => by[a.store].push({ ean, ...a }));
    Object.values(by).forEach((l) => l.sort((a, b) => itemByEan(a.ean).name.localeCompare(itemByEan(b.ean).name)));
    return by;
  }
  const chosenOption = (plan) => plan.options.find((o) => o.k === state.selectedK) || plan.best;

  // ---------- navegación ----------
  function go(view) {
    state.view = view; state.confirmClear = false;
    document.body.className = 'v-' + view;
    ['search', 'plan', 'trip'].forEach((v) => { $('#v-' + v).hidden = v !== view; });
    document.querySelectorAll('.nav button').forEach((b) => { if (b.dataset.go === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    window.scrollTo(0, 0);
    if (view === 'plan') { renderPlanView(); ensureCartPrices(); }
    if (view === 'trip') renderTrip();
    renderSide(); renderDock();
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); }
  });

  // ---------- Buscar ----------
  const SUGGESTIONS = ['leche entera', 'yerba mate', 'aceite de girasol', 'fideos spaghetti', 'coca cola 2,25'];
  function buildSearch() {
    $('#v-search').innerHTML = `
      <h1 class="h1">Mirá todas las<br>góndolas en una.</h1>
      <p class="lede">Armá tu lista y te decimos en qué súper llevar cada cosa, con el costo de ir hasta cada uno incluido.</p>
      <form id="searchForm" class="search-form" role="search">
        <div class="field">${ic('search')}<input id="q" type="search" placeholder="Leche, yerba, aceite, coca cola 2,25…" autocomplete="off" required minlength="2" aria-label="Buscar producto"></div>
        <button class="btn primary" type="submit"><span>Buscar</span><svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS.search}</svg></button>
      </form>
      <div class="chips-row" id="provRow"></div>
      <div class="chips-row" id="storeChips"></div>
      <div class="chips-row" id="suggest">
        <span class="eyebrow">Probá con</span>${SUGGESTIONS.map((s) => `<button type="button" class="chip txt" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
      <div class="status" id="searchStatus" aria-live="polite"></div>
      <div id="filters"></div>
      <div class="results" id="results"></div>`;
    renderProvRow(); renderStoreChips();
    $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); runSearch($('#q').value.trim()); });
  }
  // Los precios cambian según la zona: se elige la provincia (se completa sola al cargar tu ubicación).
  function renderProvRow() {
    const box = $('#provRow'); if (!box) return;
    const opts = Object.entries(provinces()).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es'));
    box.innerHTML = `<span class="eyebrow">Precios de</span><select id="provSel" class="select" aria-label="Provincia de los precios">${opts.map(([code, p]) => `<option value="${code}"${code === state.settings.prov ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>
      <span class="xs mute">Datos oficiales de SEPA. ${state.home && state.home.prov === state.settings.prov ? 'Tomada de tu ubicación.' : 'Cambiá la provincia si comprás en otra.'}</span>`;
  }
  function renderStoreChips() {
    $('#storeChips').innerHTML = `<span class="eyebrow">Comparar en</span>` + state.stores.map((s) =>
      `<button type="button" class="chip" data-store-toggle="${s.id}" aria-pressed="${isOn(s.id)}"${isOn(s.id) && !usable(s.id) ? ' data-far="1"' : ''} title="${isOn(s.id) ? 'Dejar de comparar' : 'Comparar'} ${esc(s.name)}${s.optativa ? ' (farmacia, opcional)' : ''}${s.regional && !state.home && explicit(s.id) === undefined ? ' (regional: cargá tu ubicación para ver si tenés una cerca)' : ''}${isOn(s.id) && !usable(s.id) ? '. No tiene sucursales cerca de tu ubicación' : ''}"><span class="mk sm" style="--c:${s.color}">${esc(sigla(s))}</span>${esc(s.name)}</button>`).join('');
  }

  function cmpRows(ean) {
    const by = state.prices[ean] || {};
    const owners = ownersFor(ean);
    const stores = enabledStores().filter((s) => !owners || owners.includes(s.id));
    const have = stores.filter((s) => by[s.id]).map((s) => ({ s, o: by[s.id] })).sort((a, b) => a.o.price - b.o.price);
    const min = have.length ? have[0].o.price : 0, max = have.length ? have[have.length - 1].o.price : 0;
    const none = owners ? [] : stores.filter((s) => !by[s.id]);
    let html = have.map(({ s, o }, i) => {
      const diff = o.price - min;
      const sub = i === 0 ? (have.length > 1 ? 'más barato' : '') : diff < 0.5 ? 'igual' : `+${fmt(diff)}`;
      return `<li class="row${i === 0 ? ' best' : ''}">
        <a class="who" href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener" title="Ir a la web de ${esc(s.name)}">${mk(s.id, true)}<span class="n">${esc(s.name)}</span></a>
        <span class="bar-track"><span class="bar-fill" style="width:${Math.max(6, (o.price / max) * 100).toFixed(1)}%"></span></span>
        <span class="amt"><b>${fmt(o.price)}</b><small>${sub}</small></span>
      </li>`;
    }).join('');
    if (none.length) html += `<li class="row none"><span>No lo informa: ${none.map((s) => esc(s.name)).join(', ')}</span></li>`;
    if (owners) html += `<li class="row none"><span>Marca propia: solo se vende en ${owners.map((id) => esc((storeById(id) || { name: id }).name)).join(', ')}, no hay otra tienda para comparar.</span></li>`;
    return html;
  }
  const stepper = (ean, q, cls = '') => `<div class="stepper ${cls}"><button data-act="dec" data-ean="${esc(ean)}" aria-label="Quitar uno">${ic('minus')}</button><output aria-label="Cantidad">${q}</output><button data-act="inc" data-ean="${esc(ean)}" aria-label="Agregar uno">${ic('plus')}</button></div>`;

  // ---------- filtros de resultados ----------
  const niceBrand = (b) => { const t = String(b || '').trim(); return t && t === t.toUpperCase() ? t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : t; };
  function groupStats(ean) {
    const prices = enabledStores().map((s) => state.prices[ean]?.[s.id]).filter(Boolean).map((o) => o.price);
    return prices.length ? { min: Math.min(...prices), max: Math.max(...prices), count: prices.length } : null;
  }
  function visibleGroups() {
    const f = state.filters, min = parseFloat(f.min), max = parseFloat(f.max);
    const hasMin = Number.isFinite(min), hasMax = Number.isFinite(max);
    const list = state.lastGroups.filter((g) => {
      if (f.brands.size && !f.brands.has(norm(g.brand))) return false;
      const st = groupStats(g.ean);
      if (f.comparable && (ownersFor(g.ean) || (st && st.count < 2))) return false;
      if (!st) return !(hasMin || hasMax);
      return !(hasMin && st.min < min) && !(hasMax && st.min > max);
    });
    const key = { asc: (g) => (groupStats(g.ean) || { min: Infinity }).min, desc: (g) => -(groupStats(g.ean) || { min: -Infinity }).min, save: (g) => { const s = groupStats(g.ean); return s ? -(s.max - s.min) : Infinity; } }[f.sort];
    return key ? list.map((g, i) => ({ g, i, k: key(g) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.g) : list;
  }
  function renderFilters() {
    const box = $('#filters'); if (!box) return;
    if (state.searching || !state.lastGroups.length) { box.innerHTML = ''; return; }
    const f = state.filters;
    const brands = new Map();
    state.lastGroups.forEach((g) => { const k = norm(g.brand); if (!k) return; const b = brands.get(k) || { label: niceBrand(g.brand), n: 0 }; b.n++; brands.set(k, b); });
    const sorted = [...brands.entries()].sort((a, b) => b[1].n - a[1].n || a[1].label.localeCompare(b[1].label));
    f.brands.forEach((k) => { if (!brands.has(k)) f.brands.delete(k); });
    const shown = f.allBrands ? sorted : sorted.filter(([k], i) => i < 12 || f.brands.has(k));
    const prices = state.lastGroups.map((g) => (groupStats(g.ean) || {}).min).filter((n) => n != null);
    const range = prices.length ? `${fmtArs(Math.min(...prices))} a ${fmtArs(Math.max(...prices))} (en pesos)` : '';
    const active = f.brands.size || f.min !== '' || f.max !== '' || f.comparable || f.sort !== 'rel';
    box.innerHTML = `<div class="filters">
      <div class="f-row">
        <div class="fld-inline"><span class="eyebrow">Precio</span>
          <span class="inp sm"><em>$</em><input id="fMin" type="number" min="0" step="100" placeholder="desde" value="${esc(f.min)}" aria-label="Precio mínimo"></span><span class="mute">a</span>
          <span class="inp sm"><em>$</em><input id="fMax" type="number" min="0" step="100" placeholder="hasta" value="${esc(f.max)}" aria-label="Precio máximo"></span></div>
        <label class="fld-inline"><span class="eyebrow">Ordenar</span><select id="fSort" class="select" aria-label="Ordenar resultados">
          <option value="rel"${f.sort === 'rel' ? ' selected' : ''}>Más tiendas primero</option>
          <option value="asc"${f.sort === 'asc' ? ' selected' : ''}>Precio: menor a mayor</option>
          <option value="desc"${f.sort === 'desc' ? ' selected' : ''}>Precio: mayor a menor</option>
          <option value="save"${f.sort === 'save' ? ' selected' : ''}>Mayor diferencia entre tiendas</option></select></label>
        <label class="fld-inline" title="Oculta marcas propias y productos que solo tiene una tienda"><input id="fComp" class="sw" type="checkbox"${f.comparable ? ' checked' : ''}><span class="sm">Solo comparables</span></label>
        <span class="f-count sm mute" id="fCount" aria-live="polite"></span>
        ${active ? '<button class="link" data-act="filters-clear">Limpiar filtros</button>' : ''}
      </div>
      ${sorted.length > 1 ? `<div class="f-brands"><span class="eyebrow">Marca</span>${shown.map(([k, b]) => `<button type="button" class="chip brand" data-brand="${esc(k)}" aria-pressed="${f.brands.has(k)}">${esc(b.label)}<span class="n">${b.n}</span></button>`).join('')}
        ${sorted.length > shown.length ? `<button type="button" class="link" data-act="brands-more">Ver todas (${sorted.length})</button>` : (f.allBrands && sorted.length > 12 ? '<button type="button" class="link" data-act="brands-more">Ver menos</button>' : '')}</div>` : ''}
      ${range ? `<div class="xs mute">Los resultados van de ${range}.</div>` : ''}
    </div>`;
  }

  function renderResults() {
    const box = $('#results');
    if (!box) return;
    if (state.searching) {
      box.innerHTML = Array.from({ length: 6 }, () => `<article class="p" aria-hidden="true"><div class="p-top"><div style="flex:1;display:grid;gap:8px"><div class="skel-line" style="width:40%"></div><div class="skel-line" style="width:90%"></div></div></div>${'<div class="skel-line" style="height:16px"></div>'.repeat(5)}</article>`).join('');
      return;
    }
    if (state.searchRan && !state.lastGroups.length) { box.innerHTML = '<div class="empty" style="grid-column:1/-1"><b>No encontré nada con esa búsqueda</b>Probá con menos palabras o con la marca sola.</div>'; return; }
    const groups = visibleGroups();
    const fc = $('#fCount'); if (fc) fc.textContent = groups.length === state.lastGroups.length ? `${groups.length} productos` : `${groups.length} de ${state.lastGroups.length} productos`;
    if (state.lastGroups.length && !groups.length) { box.innerHTML = '<div class="empty" style="grid-column:1/-1"><b>Ningún producto cumple los filtros</b>Probá con otro rango de precio o quitá alguna marca.<div style="margin-top:14px"><button class="btn sm" data-act="filters-clear">Limpiar filtros</button></div></div>'; return; }
    box.innerHTML = groups.map((g) => {
      const q = cartQty(g.ean);
      return `<article class="p" data-ean="${esc(g.ean)}">
        <div class="p-top"><div><div class="p-brand">${esc(g.brand)}</div><div class="p-name">${esc(g.name)}</div>${ownersFor(g.ean) ? '<span class="pill soft" style="margin-top:7px">Marca propia</span>' : ''}</div></div>
        <ul class="cmp">${cmpRows(g.ean)}</ul>
        <div class="p-foot">${q ? `<span class="in">${ic('check')}En tu lista</span>${stepper(g.ean, q)}` : `<button class="btn primary block" data-act="add" data-ean="${esc(g.ean)}">${ic('plus')}Agregar a la lista</button>`}</div>
      </article>`;
    }).join('');
  }

  // La búsqueda se hace acá, sobre los datos oficiales ya descargados: no se consulta a ningún supermercado.
  async function runSearch(q) {
    if (q.length < 2) return;
    const status = $('#searchStatus');
    if (!enabledStores().length) { status.textContent = 'Activá al menos una tienda para comparar.'; return; }
    $('#q').value = q;
    state.searching = true; status.textContent = `Buscando "${q}"…`; renderFilters(); renderResults();
    try {
      if (!state.table) await loadTable();
      const groups = await Data.search(q, state.settings.prov, 30);
      groups.forEach((g) => { state.meta[g.ean] = { brand: g.brand, name: g.name }; derive(g.ean); });
      state.lastGroups = groups; state.searchRan = true; state.searching = false;
      state.filters.brands.clear(); state.filters.allBrands = false; // las marcas cambian con cada búsqueda
      status.textContent = groups.length ? `Precios de ${provName(state.settings.prov)}. Primero los productos que están en más cadenas.` : '';
      renderFilters(); renderResults(); renderSide(); renderDock();
    } catch (err) { state.searching = false; status.textContent = 'No pude buscar: ' + err.message; renderFilters(); renderResults(); }
  }

  // ---------- lista (ticket lateral + dock móvil) ----------
  function bestInfo() {
    if (!state.cart.length) return null;
    const plan = currentPlan();
    return plan.best ? { plan, best: plan.best } : null;
  }
  function renderSide() {
    const n = state.cart.reduce((t, i) => t + i.qty, 0);
    const info = bestInfo();
    const rows = state.cart.map((i) => {
      const offers = enabledStores().map((s) => ({ s, o: offerOf(i.ean, s.id) })).filter((x) => x.o).sort((a, b) => a.o.price - b.o.price);
      const c = offers[0];
      return `<li class="t-item"><div class="t-name" title="${esc(i.name)}">${esc(i.name)}</div>
        ${stepper(i.ean, i.qty)}
        <div class="t-best">${c ? `Mejor: <b>${fmt(c.o.price)}</b> en ${esc(c.s.name)}` : state.loadingPrices ? 'Consultando…' : 'Sin precio'}</div></li>`;
    }).join('');
    $('#side').innerHTML = `<div class="ticket">
      <div class="t-head"><span class="eyebrow">Tu lista</span><span class="mono xs mute">${n} ${n === 1 ? 'unidad' : 'unidades'}</span></div>
      ${state.cart.length ? `<ul class="t-list">${rows}</ul>
        <div class="t-foot">
          <div class="t-total"><span class="sm mute">Mejor total con viajes</span><span class="v">${info ? fmt(info.best.total) : '···'}</span></div>
          ${info ? `<div class="xs mute" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">${info.best.stores.map((id) => mk(id, true)).join('')}<span>${info.best.k === 1 ? 'en una sola tienda' : `en ${info.best.k} tiendas`}</span></div>` : ''}
          <button class="btn primary block" data-go="plan">Ver dónde comprar${ic('arrow')}</button>
        </div>`
        : `<div class="t-empty">Todavía no agregaste nada. Buscá un producto y tocá <b>Agregar a la lista</b>.</div>`}
    </div>`;
  }
  function renderDock() {
    const dock = $('#dock');
    const n = state.cart.reduce((t, i) => t + i.qty, 0);
    dock.hidden = !state.cart.length;
    const info = bestInfo();
    dock.innerHTML = `<div class="d-l"><small>${n} ${n === 1 ? 'unidad' : 'unidades'} · mejor total</small><b>${info ? fmt(info.best.total) : '···'}</b></div><button class="btn" data-go="plan">Ver plan${ic('arrow')}</button>`;
  }
  function updateCount() { const el = $('#cartCount'); const n = state.cart.reduce((t, i) => t + i.qty, 0); el.textContent = n || ''; el.dataset.n = n; }

  function cartChanged() {
    persist(); updateCount(); state.selectedK = null;
    renderResults(); renderSide(); renderDock();
    if (state.view === 'plan') renderPlanView();
  }
  function addToCart(ean) {
    const g = state.lastGroups.find((x) => x.ean === ean);
    const item = itemByEan(ean);
    if (item) item.qty++; else if (g) state.cart.push({ ean, name: g.name, brand: g.brand, qty: 1 });
    ensurePrices([ean]);
    cartChanged();
  }

  // Atribución que exige la licencia CC BY 4.0 de los datos, y aclaración de qué se hizo con ellos.
  const sepaNote = () => `Fuente: <a href="https://datos.produccion.gob.ar/dataset/sepa-precios" target="_blank" rel="noopener">Precios Claros – Base SEPA</a>, Secretaría de Comercio de la Nación (licencia CC BY 4.0), datos del ${dataDate() ? fmtDate(dataDate()) : 'último día publicado'}. Gondolar los agrupó por provincia usando la mediana de las sucursales de cada cadena. Son precios de góndola informados por los comercios: pueden diferir en tu sucursal y no incluyen promociones.`;

  // ---------- Plan ----------
  function renderPlanView() {
    const box = $('#v-plan');
    if (!state.cart.length) {
      box.innerHTML = `<div class="narrow"><div class="empty"><b>Tu lista está vacía</b>Agregá productos desde el buscador y acá vas a ver dónde conviene comprar cada uno.<div style="margin-top:16px"><button class="btn primary" data-go="search">${ic('search')}Buscar productos</button></div></div></div>`;
      return;
    }
    const n = state.cart.reduce((t, i) => t + i.qty, 0);
    const head = `<div class="sect-h" style="margin-top:0"><div><h1 class="h1" style="font-size:clamp(28px,4vw,38px)">Tu compra</h1><p>${state.cart.length} productos, ${n} ${n === 1 ? 'unidad' : 'unidades'} · precios de ${esc(provName(state.settings.prov))}, ${dataDate() ? 'SEPA del ' + fmtDate(dataDate()) : 'SEPA'}${state.home ? ` · viajes desde ${esc(shortLabel(state.home.label))}` : ''}</p></div>
      <div class="actions"><button class="btn sm" data-go="search">${ic('plus')}Agregar productos</button></div></div>`;
    if (state.loadingPrices) { box.innerHTML = `<div class="narrow">${head}<div class="loading-plan"><div class="skel-line"></div><div class="skel-line"></div><div class="skel-line"></div></div></div>`; return; }

    const plan = currentPlan();
    if (!plan.best) { box.innerHTML = `<div class="narrow">${head}<div class="empty"><b>No hay precios para estos productos</b>Puede que no figuren en ${esc(provName(state.settings.prov))} o que no haya tiendas activas. Probá cambiando la provincia en el buscador o activando tiendas en "Viaje y tiendas".</div><section class="sect">${editList()}</section></div>`; return; }

    const best = plan.best, chosen = chosenOption(plan);
    const bestSingle = plan.singles.filter((s) => s.complete).sort((a, b) => a.total - b.total)[0];
    const storeList = (ids) => ids.map((id, i) => `<span class="st">${who(id)}</span>${i < ids.length - 2 ? ', ' : i === ids.length - 2 ? ' y ' : ''}`).join('');
    let say, tag = '';
    if (bestSingle && best.k === 1) say = `Comprá todo en ${storeList(best.stores)}. Dividir la compra no compensa el viaje extra.`;
    else if (bestSingle) {
      const save = bestSingle.total - best.total;
      say = `Andá a ${storeList(best.stores)}. Es más barato que comprar todo en <span class="st">${who(bestSingle.store)}</span>, con los viajes ya sumados.`;
      tag = `<span class="save-tag">Ahorrás ${fmt(save)} · ${pct(save / bestSingle.total)}</span>`;
    } else say = `Ninguna tienda tiene todo. Combiná ${storeList(best.stores)}.`;

    const verdict = `<section class="verdict" aria-label="Mejor plan"><div><div class="eyebrow">Mejor plan</div><div class="total mono">${fmt(best.total)}</div><div class="brk">productos ${fmt(best.itemsCost)} + viajes ${fmt(best.tripCost)}</div></div><div><p class="say">${say}</p>${tag}</div></section>`;
    const noHome = state.home ? '' : `<div class="callout"><div><b>Los viajes usan valores de ejemplo (4 km y 25 min por tienda).</b><br><span class="sm">Cargá tu ubicación y calculo la distancia real hasta la sucursal más cercana de cada cadena.</span></div><button class="btn primary sm" data-go="trip">${ic('pin')}Cargar mi ubicación</button></div>`;
    const missing = noHome + (plan.uncovered.length ? `<div class="banner">Sin precio en las tiendas activas: ${plan.uncovered.map((i) => esc(itemByEan(i.ean).name)).join(', ')}.</div>` : '');

    const opts = plan.options.length > 1 ? `<section class="sect"><div class="sect-h"><div><h2 class="h2">Según a cuántas tiendas vayas</h2><p>Tocá una opción para ver qué comprar en cada lugar.</p></div></div>
      <div class="opts">${plan.options.map((o) => `<button class="opt" data-act="pick" data-k="${o.k}" aria-pressed="${o.k === chosen.k}">
        <div class="k"><span class="eyebrow">${o.k} ${o.k === 1 ? 'parada' : 'paradas'}</span>${o === best ? '<span class="pill good">Mejor</span>' : `<span class="pill bad">+${fmt(o.total - best.total)}</span>`}</div>
        <div class="amt">${fmt(o.total)}</div>
        <div class="marks">${o.stores.map((id) => `<span class="pill line" style="gap:6px;padding-left:4px">${mk(id, true)}${esc(storeById(id).name)}</span>`).join('')}</div>
        <dl class="parts" style="margin:0"><dt>Productos</dt><dd>${fmt(o.itemsCost)}</dd><dt>Viajes</dt><dd>${fmt(o.tripCost)}</dd></dl></button>`).join('')}</div></section>` : '';

    const by = planByStore(chosen);
    const receipts = `<section class="sect"><div class="sect-h"><div><h2 class="h2">Qué comprar en cada lugar</h2><p>Tildá lo que vas poniendo en el carrito.</p></div>
      <div class="actions"><button class="btn primary sm" data-act="print">${ic('print')}Imprimir lista</button><button class="btn sm" data-act="copy">${ic('copy')}Copiar</button></div></div>
      <div class="receipts">${chosen.stores.map((id) => {
        const store = storeById(id), lines = by[id];
        const sub = lines.reduce((t, l) => t + l.price * l.qty, 0);
        return `<article class="receipt"><div class="r-head">${mk(id)}<h3>${esc(store.name)}</h3><div class="sub"><b>${fmt(sub)}</b><span class="xs mute">${lines.length} ${lines.length === 1 ? 'producto' : 'productos'}</span></div></div>
          <ul class="r-list">${lines.map((l) => {
            const o = offerOf(l.ean, id), key = `${id}|${l.ean}`;
            const other = enabledStores().filter((s) => s.id !== id && offerOf(l.ean, s.id)).map((s) => ({ s, p: offerOf(l.ean, s.id).price })).sort((a, b) => a.p - b.p)[0];
            return `<li class="r-line"><input class="cb" type="checkbox" data-ck="${esc(key)}" aria-label="Ya lo agregué: ${esc(itemByEan(l.ean).name)}" ${state.checked[key] ? 'checked' : ''}>
              <div class="nm">${esc(itemByEan(l.ean).name)}</div>
              <div class="pr">${fmt(l.price * l.qty)}${l.qty > 1 ? `<small>${l.qty} × ${fmt(l.price)}</small>` : ''}</div>
              <div class="alt">${other ? `Otra opción: ${esc(other.s.name)} <span class="num">${fmt(other.p)}</span> (${other.p >= l.price ? '+' : '−'}${fmt(Math.abs(other.p - l.price))})` : 'Solo la tiene esta tienda'}</div></li>`;
          }).join('')}</ul>
          ${branchOf(id) ? `<div class="r-branch">${ic('pin')}<span><b>${esc(branchOf(id).address || branchOf(id).name)}</b><br>a ${kmText(branchOf(id).driveKm)} km, ${Math.round(branchOf(id).driveMin)} min en auto</span><a class="btn sm ghost" href="${esc(mapsLink(branchOf(id)))}" target="_blank" rel="noopener">Cómo llegar${ic('ext')}</a></div>` : ''}
          <div class="r-foot"><span class="trip">${cfg(id).mandatory ? 'Ya vas a ir, sin costo de viaje' : `Viaje: <span class="num">${fmt(tripCost(id))}</span>`}</span>
          <a class="btn sm ghost" href="${esc(safeUrl(store.web))}" target="_blank" rel="noopener" title="Abre la web de ${esc(store.name)}">Web de ${esc(store.name)}${ic('ext')}</a></div></article>`;
      }).join('')}</div></section>`;

    const singles = plan.singles.slice().sort((a, b) => a.missing - b.missing || a.total - b.total);
    const rank = `<section class="sect"><div class="sect-h"><div><h2 class="h2">Si comprás todo en una sola tienda</h2><p>Incluye el viaje. Las que no tienen todo van al final.</p></div></div>
      <div class="rank">${singles.map((s, i) => {
        const d = s.total - best.total;
        return `<div class="rank-row${i === 0 && !s.missing && d < 0.5 ? ' top' : ''}"><div class="who">${mk(s.store)}${esc(storeById(s.store).name)}${s.missing ? `<span class="pill warn">le faltan ${s.missing}</span>` : ''}</div>
          <div class="tot">${fmt(s.total)}</div><div class="dl">${s.missing ? '' : d < 0.5 ? 'igual al plan' : '+' + fmt(d)}</div></div>`;
      }).join('')}</div></section>`;

    const worth = chosen === best && plan.worth.length ? `<section class="sect"><div class="sect-h"><div><h2 class="h2">¿Vale la pena cada parada?</h2><p>Lo que ahorrás en productos frente a lo que cuesta ir.</p></div></div>
      <div class="worth">${plan.worth.map((w) => {
        if (w.required) return `<div class="w"><div class="w-h">${mk(w.store)}${esc(storeById(w.store).name)}<span class="pill soft">Imprescindible</span></div><p>Tiene productos que no conseguís en las otras tiendas.</p></div>`;
        const mx = Math.max(w.saving, w.trip, 1);
        return `<div class="w"><div class="w-h">${mk(w.store)}${esc(storeById(w.store).name)}<span class="pill ${w.worth ? 'good' : 'bad'}">${w.worth ? 'Vale la pena' : 'No vale la pena'}</span></div>
          <div class="meter"><span>Ahorra</span><span class="bt"><i class="a" style="width:${(w.saving / mx * 100).toFixed(1)}%"></i></span><span class="num">${fmt(w.saving)}</span><span>Viaje</span><span class="bt"><i class="c" style="width:${(w.trip / mx * 100).toFixed(1)}%"></i></span><span class="num">${fmt(w.trip)}</span></div>
          <p>${w.worth ? `Te queda a favor ${fmt(w.saving - w.trip)}.` : `Perdés ${fmt(w.trip - w.saving)} si vas solo por esto.`}</p></div>`;
      }).join('')}</div></section>` : '';

    box.innerHTML = `<div class="narrow">${head}${verdict}${missing}${opts}${receipts}${rank}${worth}
      <section class="sect"><div class="sect-h"><div><h2 class="h2">Tu lista</h2></div></div>${editList()}</section>
      <p class="foot-note">${sepaNote()}${rateNote() ? ' ' + esc(rateNote()) : ''}</p></div>`;
  }
  function editList() {
    return `<div class="edit-list">${state.cart.map((i) => `<div class="edit-row"><div class="nm">${esc(i.name)}</div>${stepper(i.ean, i.qty)}<button class="icon-btn" data-act="del" data-ean="${esc(i.ean)}" aria-label="Quitar de la lista">${ic('trash')}</button></div>`).join('')}</div>
      <div style="margin-top:12px">${state.confirmClear ? `<span class="sm">¿Vaciar toda la lista?</span> <button class="link" data-act="clear-yes">Sí, vaciar</button> · <button class="link" data-act="clear-no">Cancelar</button>` : `<button class="link" data-act="clear">Vaciar lista</button>`}</div>`;
  }

  // ---------- imprimir / copiar ----------
  function planLines() {
    const plan = currentPlan(); const chosen = plan.best && chosenOption(plan);
    if (!chosen) return null;
    const by = planByStore(chosen);
    return { plan, chosen, stores: chosen.stores.map((id) => ({ store: storeById(id), lines: by[id] })) };
  }
  function summaryLines({ plan, chosen }) {
    const bestSingle = plan.singles.filter((s) => s.complete).sort((a, b) => a.total - b.total)[0];
    const out = rateNote() ? [rateNote()] : [];
    out.push(`Total estimado: ${fmt(chosen.total)} (productos ${fmt(chosen.itemsCost)} + viajes ${fmt(chosen.tripCost)})`);
    if (bestSingle && chosen.k > 1) {
      const save = bestSingle.total - chosen.total;
      out.push(save > 0 ? `Ahorro frente a comprar todo en ${storeById(bestSingle.store).name}: ${fmt(save)} (${pct(save / bestSingle.total)}), con los viajes incluidos.` : `Comprar todo en ${storeById(bestSingle.store).name} costaría ${fmt(bestSingle.total)}.`);
    } else if (bestSingle) out.push('Conviene comprar todo en un solo lugar: dividir no compensa el viaje.');
    if (chosen === plan.best) plan.worth.forEach((w) => { if (!w.required) out.push(`${storeById(w.store).name}: ahorra ${fmt(w.saving)} en productos y el viaje cuesta ${fmt(w.trip)}. ${w.worth ? 'Vale la pena.' : 'No vale la pena.'}`); });
    return out;
  }
  function doPrint() {
    const p = planLines(); if (!p) return;
    const date = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('#printArea').innerHTML = `<h1 class="pt">Lista de compras</h1><div>${esc(date)}</div>
      <div class="p-sum">${summaryLines(p).map((l) => `<p>${esc(l)}</p>`).join('')}</div>` +
      p.stores.map(({ store, lines }) => `<div class="p-store"><h2><span>${esc(store.name)}${branchOf(store.id) ? ` <small style="font-weight:400;font-size:11px">· ${esc(branchOf(store.id).address || branchOf(store.id).name)}</small>` : ''}</span><span class="num">${fmt(lines.reduce((t, l) => t + l.price * l.qty, 0))}</span></h2>
        <table><thead><tr><th style="width:24px"></th><th>Producto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Subtotal</th></tr></thead><tbody>
        ${lines.map((l) => `<tr><td><span class="p-box"></span></td><td>${esc(itemByEan(l.ean).name)}</td><td class="num">${l.qty}</td><td class="num">${fmt(l.price)}</td><td class="num">${fmt(l.price * l.qty)}</td></tr>`).join('')}
        </tbody></table></div>`).join('') + `<p style="font-size:10.5px">${sepaNote().replace(/<[^>]+>/g, '')}</p>`;
    window.print();
  }
  async function doCopy(btn) {
    const p = planLines(); if (!p) return;
    const text = ['LISTA DE COMPRAS', ...summaryLines(p), ''].concat(p.stores.flatMap(({ store, lines }) =>
      [`== ${store.name} (${fmt(lines.reduce((t, l) => t + l.price * l.qty, 0))}) ==`, ...lines.map((l) => `[ ] ${l.qty}x ${itemByEan(l.ean).name} - ${fmt(l.price)}`), ''])).join('\n');
    const orig = btn.innerHTML;
    try { await navigator.clipboard.writeText(text); btn.innerHTML = `${ic('check')}Copiado`; } catch { btn.textContent = 'No se pudo copiar'; }
    setTimeout(() => { btn.innerHTML = orig; }, 1800);
  }

  // ---------- Viaje y tiendas ----------
  function exampleText() {
    const p = tripParts(4, 25);
    return `Un viaje de 4 km y 25 minutos te sale <b class="mono">${fmt(p.fuel + p.time)}</b> (nafta ${fmt(p.fuel)} + tu tiempo ${fmt(p.time)}).`;
  }
  function locationCard() {
    const showForm = !state.home || state.editHome;
    const form = `<form id="geoForm" class="geo-form">
        <label class="inp grow">${ic('pin')}<input id="geoQ" type="text" placeholder="Calle, altura y localidad" autocomplete="street-address" aria-label="Tu dirección" value="${esc(state.geoQuery)}"></label>
        <button class="btn primary" type="submit"${state.geoBusy ? ' disabled' : ''}>Buscar dirección</button>
        <button class="btn" type="button" data-act="gps"${state.geoBusy ? ' disabled' : ''}>${ic('gps')}Usar mi ubicación</button>
      </form>
      ${state.geoBusy && !state.geoMsg ? '<p class="sm mute" style="margin:10px 0 0">Buscando…</p>' : ''}
      ${state.geoMsg ? `<p class="sm" style="margin:10px 0 0;color:var(--warn)">${esc(state.geoMsg)}</p>` : ''}
      ${state.geoResults.length ? `<ul class="geo-results">${state.geoResults.map((r, i) => `<li><button type="button" data-act="geo-pick" data-i="${i}">${ic('pin')}<span>${esc(r.label)}</span></button></li>`).join('')}</ul>` : ''}
      ${state.editHome ? '<div style="margin-top:10px"><button class="link" data-act="home-cancel">Cancelar</button></div>' : ''}`;
    const set = `<div class="loc-set"><div><div class="eyebrow">Salís desde</div><div class="loc-label" title="${esc(state.home && state.home.label)}">${esc(state.home && shortLabel(state.home.label))}</div></div>
      <div class="actions"><button class="btn sm" data-act="home-change">Cambiar</button><button class="btn sm" data-act="branches-refresh"${state.locating ? ' disabled' : ''}>${ic('refresh')}Buscar de nuevo</button></div></div>`;
    return `<section class="sect"><div class="card"><h2 class="h2" style="margin-bottom:6px">Tu ubicación</h2>
      <p class="sm mute" style="margin:0 0 14px">${state.home ? 'Con tu ubicación buscamos la sucursal oficial más cercana de cada cadena, calculamos el viaje en auto y usamos los precios de tu provincia.' : 'Cargá tu dirección o usá el GPS y buscamos la sucursal oficial más cercana de cada cadena. Con eso calculamos el viaje real y usamos los precios de tu provincia.'}</p>
      ${showForm ? form : set}
      <p class="xs mute" style="margin:14px 0 0">Tu dirección se guarda solo en este navegador. Para calcular las rutas se consulta a OpenStreetMap con tu ubicación aproximada (a unos 100 m).</p></div></section>`;
  }
  function branchNote(id) {
    const b = branchOf(id), c = cfg(id);
    if (!state.home) return 'Cargá tu ubicación para calcular';
    if (b === undefined) return state.locating ? 'Buscando sucursal…' : (state.branchError ? 'Sin datos' : 'Pendiente');
    if (b === null) return `No hay sucursal oficial a menos de ${MAX_BRANCH_KM} km. Cargá los km a mano.`;
    const where = esc(b.address || b.name);
    const dist = `a ${kmText(b.driveKm)} km, ${Math.round(b.driveMin)} min${b.estimated ? ' (estimado)' : ''}`;
    return `${where} · ${dist} · <a href="${esc(mapsLink(b))}" target="_blank" rel="noopener">Cómo llegar</a>${c.manual ? ' · <button class="link" data-act="auto" data-store="' + id + '">usar el cálculo automático</button>' : ''}`;
  }
  let map = null;
  function initMap() {
    const el = $('#map'); if (!el) return;
    if (map) { map.remove(); map = null; }
    if (!window.L) {
      const allowed = !!(window.Consent && window.Consent.allows('maps'));
      el.innerHTML = allowed
        ? '<div class="map-off">No pude cargar el mapa (¿sin internet?). Igual podés ver las distancias en la lista.</div>'
        : '<div class="map-off"><div>El mapa se descarga de OpenStreetMap y Cloudflare, que verían tu dirección IP.<br>Las distancias de abajo se calculan igual.<div style="margin-top:12px"><button class="btn sm" data-consent="prefs">Permitir el mapa</button></div></div></div>';
      return;
    }
    const h = state.home;
    map = L.map(el, { scrollWheelZoom: false }).setView([h.lat, h.lon], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const pts = [[h.lat, h.lon]];
    L.marker([h.lat, h.lon], { icon: L.divIcon({ className: 'pin-wrap', html: `<div class="pin home">${ic('pin')}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), title: 'Tu ubicación', zIndexOffset: 1000 }).bindPopup('Tu ubicación').addTo(map);
    enabledStores().forEach((s) => {
      const b = branchOf(s.id); if (!b) return;
      pts.push([b.lat, b.lon]);
      L.marker([b.lat, b.lon], { icon: L.divIcon({ className: 'pin-wrap', html: `<div class="pin" style="--c:${s.color}"><span>${esc(sigla(s))}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) })
        .bindPopup(`<b>${esc(s.name)}</b><br>${esc(b.address || b.name)}<br>${kmText(b.driveKm)} km · ${Math.round(b.driveMin)} min`).addTo(map);
    });
    if (pts.length > 1) map.fitBounds(pts, { padding: [36, 36], maxZoom: 15 });
    setTimeout(() => map && map.invalidateSize(), 60);
  }
  function renderTrip() {
    const g = state.settings;
    $('#v-trip').innerHTML = `<div class="narrow">
      <h1 class="h1" style="font-size:clamp(28px,4vw,38px)">Viaje y tiendas</h1>
      <p class="lede">Con esto calculamos cuánto te cuesta ir a cada tienda. Si el viaje es caro, la app te va a recomendar juntar todo en menos lugares.${activeRate() ? ' Estos valores los cargás en pesos.' : ''}</p>
      ${locationCard()}
      ${state.home && !state.editHome ? `<section class="sect"><div class="map-wrap"><div id="map" role="img" aria-label="Mapa con tu ubicación y las sucursales más cercanas"></div></div>${state.branchError ? `<p class="sm" style="color:var(--warn);margin:10px 0 0">${esc(state.branchError)}</p>` : ''}</section>` : ''}
      <section class="sect"><div class="card"><h2 class="h2" style="margin-bottom:14px">Tu auto y tu tiempo</h2>
        <div class="cfg-grid">
          <label class="fld"><span>Precio de la nafta</span><span class="inp"><em>$</em><input type="number" min="0" step="10" data-set="nafta" value="${g.nafta}"><em>por litro</em></span></label>
          <label class="fld"><span>Consumo del auto</span><span class="inp"><input type="number" min="0" step="0.5" data-set="consumo" value="${g.consumo}"><em>L cada 100 km</em></span></label>
          <label class="fld"><span>Cuánto vale tu hora</span><span class="inp"><em>$</em><input type="number" min="0" step="100" data-set="horaValor" value="${g.horaValor}"><em>por hora</em></span></label>
          <label class="fld"><span>Tiempo dentro del súper</span><span class="inp"><input type="number" min="0" step="5" data-set="compraMin" value="${g.compraMin}"><em>min por tienda</em></span></label>
        </div><div class="example" id="tripExample">${exampleText()}</div></div></section>
      <section class="sect"><div class="sect-h"><div><h2 class="h2">Tiendas</h2><p>Activá donde comprás. Km y minutos se calculan solos desde tu ubicación (ida y vuelta, con el tiempo dentro del súper); si querés, corregilos a mano.</p></div></div>
        <div class="rank tbl-wrap"><div class="srow srow-h"><span>Usar</span><span>Tienda</span><span>Km ida y vuelta</span><span>Minutos</span><span>Voy sí o sí</span><span style="text-align:right">Viaje</span></div>
        ${state.stores.map((s) => { const c = cfg(s.id); return `<div class="srow${isOn(s.id) ? '' : ' off'}" data-row="${s.id}">
          <label><input class="sw" type="checkbox" data-store="${s.id}" data-field="enabled" ${isOn(s.id) ? 'checked' : ''} aria-label="Usar ${esc(s.name)}"></label>
          <div class="who">${mk(s.id)}<div>${esc(s.name)}${s.note ? ` <span class="xs mute">${esc(s.note)}</span>` : ''}<small data-branch="${s.id}">${branchNote(s.id)}</small></div></div>
          <label class="inp f-km"><input type="number" min="0" step="0.5" data-store="${s.id}" data-field="km" value="${c.km}" aria-label="Kilómetros ${esc(s.name)}"><em>km</em></label>
          <label class="inp f-min"><input type="number" min="0" step="5" data-store="${s.id}" data-field="min" value="${c.min}" aria-label="Minutos ${esc(s.name)}"><em>min</em></label>
          <label class="f-man" style="display:flex;align-items:center;gap:8px"><input class="sw" type="checkbox" data-store="${s.id}" data-field="mandatory" ${c.mandatory ? 'checked' : ''} aria-label="Voy sí o sí a ${esc(s.name)}"><span class="xs mute">sí o sí</span></label>
          <div class="cost" id="trip-${s.id}">${c.mandatory ? 'sin costo' : fmt(tripCost(s.id))}</div></div>`; }).join('')}</div>
        <p class="xs mute" style="margin-top:12px">"Voy sí o sí" es para la tienda donde ya ibas a ir: su viaje no se suma al costo. Las sucursales (direcciones y ubicación) son los datos oficiales de SEPA; las distancias por calle se calculan con OpenStreetMap. Carrefour Express queda afuera porque sus precios son distintos a los del resto de la cadena.</p></section></div>`;
    if (state.home && !state.editHome) initMap();
  }
  $('#view').addEventListener('input', (e) => {
    const t = e.target;
    if (!t.closest('#v-trip')) return;
    if (t.dataset.set) {
      state.settings[t.dataset.set] = Math.max(0, parseFloat(t.value) || 0);
      if (t.dataset.set === 'compraMin') { // recalcula los minutos automáticos
        state.stores.forEach((s) => { applyBranch(s.id); const inp = $(`input[data-store="${s.id}"][data-field="min"]`); if (inp && !cfg(s.id).manual) inp.value = cfg(s.id).min; });
      }
    } else if (t.dataset.store) {
      const c = cfg(t.dataset.store);
      c[t.dataset.field] = t.type === 'checkbox' ? t.checked : Math.max(0, parseFloat(t.value) || 0);
      if ((t.dataset.field === 'km' || t.dataset.field === 'min') && branchOf(t.dataset.store)) {
        c.manual = true;
        const note = $(`[data-branch="${t.dataset.store}"]`); if (note) note.innerHTML = branchNote(t.dataset.store);
      }
      if (t.dataset.field === 'enabled') { t.closest('.srow').classList.toggle('off', !t.checked); renderStoreChips(); if (t.checked) fetchBranches(); renderResults(); }
    } else return;
    persist(); state.selectedK = null;
    $('#tripExample').innerHTML = exampleText();
    state.stores.forEach((s) => { const el = $('#trip-' + s.id); if (el) el.textContent = cfg(s.id).mandatory ? 'sin costo' : fmt(tripCost(s.id)); });
    renderSide(); renderDock();
  });

  // ---------- eventos ----------
  document.addEventListener('click', (e) => {
    const sug = e.target.closest('[data-suggest]');
    if (sug) { runSearch(sug.dataset.suggest); return; }
    const br = e.target.closest('[data-brand]');
    if (br) { const s = state.filters.brands, k = br.dataset.brand; if (s.has(k)) s.delete(k); else s.add(k); renderFilters(); renderResults(); return; }
    const cb = e.target.closest('[data-cur]');
    if (cb) { setCurrency(cb.dataset.cur); return; }
    const tog = e.target.closest('[data-store-toggle]');
    if (tog) {
      const c = cfg(tog.dataset.storeToggle); c.enabled = !isOn(tog.dataset.storeToggle); persist();
      renderStoreChips(); renderResults(); renderSide(); renderDock();
      if (c.enabled) fetchBranches();
      return;
    }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const ean = el.dataset.ean;
    switch (el.dataset.act) {
      case 'filters-clear': Object.assign(state.filters, { min: '', max: '', sort: 'rel', comparable: false }); state.filters.brands.clear(); renderFilters(); renderResults(); return;
      case 'brands-more': state.filters.allBrands = !state.filters.allBrands; renderFilters(); return;
      case 'rates-retry': loadRates(true); return;
      case 'gps': useGps(); return;
      case 'geo-pick': { const r = state.geoResults[Number(el.dataset.i)]; if (r) setHome({ lat: r.lat, lon: r.lon, label: r.label, prov: r.prov || null }); return; }
      case 'home-change': state.editHome = true; state.geoResults = []; state.geoMsg = ''; renderTrip(); return;
      case 'home-cancel': state.editHome = false; state.geoResults = []; state.geoMsg = ''; renderTrip(); return;
      case 'branches-refresh': state.stores.forEach((s) => { cfg(s.id).manual = false; }); state.branches = { key: homeKey(), byStore: {} }; fetchBranches(true); return;
      case 'auto': { const c = cfg(el.dataset.store); c.manual = false; applyBranch(el.dataset.store); afterTripChange(); return; }
      case 'add': addToCart(ean); return;
      case 'inc': { const i = itemByEan(ean); if (i) i.qty++; break; }
      case 'dec': { const i = itemByEan(ean); if (i) { if (i.qty > 1) i.qty--; else state.cart = state.cart.filter((x) => x.ean !== ean); } break; }
      case 'del': state.cart = state.cart.filter((i) => i.ean !== ean); break;
      case 'clear': state.confirmClear = true; renderPlanView(); return;
      case 'clear-no': state.confirmClear = false; renderPlanView(); return;
      case 'clear-yes': state.cart = []; state.confirmClear = false; break;
      case 'pick': state.selectedK = Number(el.dataset.k); renderPlanView(); return;
      case 'print': doPrint(); return;
      case 'copy': doCopy(el); return;
      default: return;
    }
    cartChanged();
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'geoForm') { e.preventDefault(); searchAddress($('#geoQ').value); }
  });
  let fTimer = null;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'fMin' && e.target.id !== 'fMax') return;
    state.filters[e.target.id === 'fMin' ? 'min' : 'max'] = e.target.value;
    clearTimeout(fTimer); fTimer = setTimeout(renderResults, 200);
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'rateSel') { setCurrency('USD', e.target.value); return; }
    if (e.target.id === 'provSel') { setProvince(e.target.value).then(renderProvRow); return; }
    if (e.target.id === 'fSort') { state.filters.sort = e.target.value; renderFilters(); renderResults(); return; }
    if (e.target.id === 'fComp') { state.filters.comparable = e.target.checked; renderFilters(); renderResults(); return; }
    const k = e.target.dataset && e.target.dataset.ck;
    if (!k) return;
    if (e.target.checked) state.checked[k] = true; else delete state.checked[k];
    save('checked', state.checked);
  });

  // al cambiar los permisos de privacidad (mapa) se vuelve a dibujar lo que está en pantalla
  window.addEventListener('consent-change', () => {
    renderResults();
    if (state.view === 'plan') renderPlanView();
    if (state.view === 'trip') renderTrip();
  });

  // ---------- inicio ----------
  (async function init() {
    ['search', 'plan', 'trip'].forEach((v) => { const s = document.createElement('section'); s.id = 'v-' + v; s.hidden = true; $('#view').appendChild(s); });
    try { state.data = await Data.meta(); }
    catch (e) {
      const b = $('#banner'); b.hidden = false;
      b.textContent = 'No pude cargar los precios oficiales (' + e.message + '). Si estás en tu computadora, ejecutá "npm run datos" una vez y volvé a abrir la app.';
      return;
    }
    state.stores = state.data.cadenas.map((c) => ({ ...c }));
    if (!provinces()[state.settings.prov]) state.settings.prov = 'AR-C';
    try { localStorage.removeItem('branches'); } catch { /* sin acceso */ } // caché vieja de sucursales de OpenStreetMap
    state.cart.forEach((i) => { state.meta[i.ean] = { brand: i.brand, name: i.name }; });
    buildSearch(); updateCount(); updateBarNote(); renderCur();
    if (state.currency.cur === 'USD') loadRates();
    await loadTable();
    Data.names().catch(() => {}); // se va preparando la búsqueda mientras la persona mira la pantalla
    go(state.cart.length ? 'plan' : 'search');
    renderResults();
    fetchBranches(); // completa las sucursales de tiendas que todavía no se buscaron
    // ubicaciones guardadas antes de que existieran los precios por provincia: se completa la provincia
    if (state.home && !state.home.prov) {
      api(`/api/reverse?lat=${state.home.lat}&lon=${state.home.lon}`).then((r) => { if (r && r.prov) { state.home.prov = r.prov; save('home', state.home); return setProvince(r.prov); } }).catch(() => {});
    }
  })();
})();
