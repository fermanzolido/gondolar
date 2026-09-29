// Optimizador del plan de compra. Módulo puro (sin DOM) para poder testearlo en Node.
//
// input:
//   items:  [{ ean, qty, only? }]     only = id de la tienda que la persona eligió para ese producto
//   prices: { [ean]: { [storeId]: offer|null|undefined } }   (offer.price = precio unitario)
//   stores: [{ id, trip, mandatory }]   trip = costo de ir a esa tienda ($: nafta + tiempo)
//                                        mandatory = voy sí o sí (su traslado no cuenta)
// Prueba todas las combinaciones de tiendas (2^n, n <= 9) y en cada una compra cada producto
// en la tienda más barata de la combinación. Elige la que minimiza productos + traslados.
(function (root) {
  function plan({ items, prices, stores }) {
    const n = stores.length;
    // `only`: tienda elegida para ese producto. Si está, solo cuenta el precio de esa tienda (y hay que ir a ella).
    const priceOf = (ean, i, only) => {
      if (only && stores[i].id !== only) return null;
      const o = prices[ean] && prices[ean][stores[i].id];
      return o && o.price > 0 ? o.price : null;
    };
    const covered = items.filter((it) => stores.some((_, i) => priceOf(it.ean, i, it.only) != null));
    const uncovered = items.filter((it) => !covered.includes(it));
    const mandatoryMask = stores.reduce((m, s, i) => (s.mandatory ? m | (1 << i) : m), 0);

    // Costo de comprar todo lo posible dentro de un conjunto de tiendas (mask).
    function evaluate(mask) {
      let itemsCost = 0, missing = 0;
      const assignment = {}; // ean -> { storeIdx, price, qty }
      const used = new Array(n).fill(0);
      for (const it of covered) {
        let best = null;
        for (let i = 0; i < n; i++) {
          if (!(mask & (1 << i))) continue;
          const p = priceOf(it.ean, i, it.only);
          if (p != null && (best == null || p < best.price)) best = { storeIdx: i, price: p };
        }
        if (!best) { missing++; continue; }
        assignment[it.ean] = { ...best, qty: it.qty };
        itemsCost += best.price * it.qty;
        used[best.storeIdx]++;
      }
      return { itemsCost, missing, assignment, used };
    }
    const tripOf = (mask) => stores.reduce((t, s, i) => (mask & (1 << i) && !s.mandatory ? t + s.trip : t), 0);
    const popcount = (m) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };
    const toOption = (mask, ev) => ({
      mask, k: popcount(mask),
      stores: stores.filter((_, i) => mask & (1 << i)).map((s) => s.id),
      assignment: Object.fromEntries(Object.entries(ev.assignment).map(([ean, a]) => [ean, { store: stores[a.storeIdx].id, price: a.price, qty: a.qty }])),
      itemsCost: ev.itemsCost, tripCost: tripOf(mask), total: ev.itemsCost + tripOf(mask),
    });

    // Mejor opción por cantidad de tiendas a visitar
    const byK = {};
    if (covered.length) {
      for (let mask = 1; mask < 1 << n; mask++) {
        if ((mask & mandatoryMask) !== mandatoryMask) continue;
        const ev = evaluate(mask);
        if (ev.missing) continue; // no cubre todos los productos
        // descarta combinaciones con una tienda (no obligatoria) que no se usa: siempre pierde contra la más chica
        if (stores.some((s, i) => mask & (1 << i) && !s.mandatory && ev.used[i] === 0)) continue;
        const opt = toOption(mask, ev);
        if (!byK[opt.k] || opt.total < byK[opt.k].total) byK[opt.k] = opt;
      }
    }
    const options = Object.values(byK).sort((a, b) => a.k - b.k);
    const best = options.reduce((b, o) => (!b || o.total < b.total ? o : b), null);

    // Comprar todo en una sola tienda (aunque le falten productos)
    const singles = stores.map((s, i) => {
      const ev = evaluate(1 << i);
      return { store: s.id, itemsCost: ev.itemsCost, missing: ev.missing, tripCost: s.mandatory ? 0 : s.trip, total: ev.itemsCost + (s.mandatory ? 0 : s.trip), complete: ev.missing === 0 && covered.length > 0 };
    });

    // "¿Vale la pena?": cuánto ahorra cada tienda del plan frente a sacarla, vs. lo que cuesta ir
    const worth = [];
    if (best) {
      stores.forEach((s, i) => {
        if (!(best.mask & (1 << i)) || s.mandatory) return;
        const without = best.mask & ~(1 << i);
        if (!without) return;
        const ev = evaluate(without);
        if (ev.missing) { worth.push({ store: s.id, required: true, saving: null, trip: s.trip }); return; }
        const saving = ev.itemsCost - best.itemsCost;
        worth.push({ store: s.id, required: false, saving, trip: s.trip, worth: saving > s.trip });
      });
    }
    return { covered, uncovered, options, best, singles, worth };
  }

  const api = { plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Optimizer = api;
})(typeof window !== 'undefined' ? window : globalThis);
