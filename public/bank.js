// Promociones de bancos y billeteras. Módulo puro (sin DOM) para poder testearlo en Node.
//
// Las promociones bancarias NO vienen de SEPA: están cargadas a mano en promos-bancos.json a partir de fuentes públicas.
// Cada una: { id, medio, cadena, dias: [0-6, domingo=0], pct, tope, topePeriodo, minimo, desde, hasta, via, nota, fuentes: [] }
//   tope = reintegro máximo (en pesos) por el período `topePeriodo` ('semana' | 'mes'); sin tope = null
//   minimo = compra mínima (en pesos) para que rija el descuento
// Es una estimación para una sola compra: no descuenta lo que ya hayas usado del tope en la semana o el mes.
(function (root) {
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  const vigente = (p, iso) => (!p.desde || p.desde <= iso) && (!p.hasta || iso <= p.hasta);
  const vigentes = (promos, iso) => promos.filter((p) => vigente(p, iso));
  const medios = (promos, iso) => [...new Set(vigentes(promos, iso).map((p) => p.medio))].sort((a, b) => a.localeCompare(b, 'es'));

  // Ahorro de una promoción sobre `subtotal` (importe de la compra en esa cadena)
  function ahorro(p, subtotal) {
    if (subtotal < (p.minimo || 0)) return 0;
    const bruto = (subtotal * p.pct) / 100;
    return Math.round(p.tope != null ? Math.min(bruto, p.tope) : bruto);
  }

  // Promociones de una cadena que puede usar quien paga con alguno de `mediosSet` (null = cualquiera) el día `day` (null = cualquier día).
  // Devuelve [{ promo, saving, motivo }] de mayor a menor ahorro; motivo 'minimo' = todavía no llega a la compra mínima.
  function evaluar(promos, { store, subtotal, day = null, iso, medios: mediosSet = null }) {
    return vigentes(promos, iso)
      .filter((p) => p.cadena === store && (!mediosSet || mediosSet.has(p.medio)) && (day == null || p.dias.includes(day)))
      .map((p) => {
        const saving = ahorro(p, subtotal);
        return { promo: p, saving, motivo: saving > 0 || !(p.minimo && subtotal < p.minimo) ? 'ok' : 'minimo' };
      })
      .sort((a, b) => b.saving - a.saving || a.promo.medio.localeCompare(b.promo.medio, 'es'));
  }

  // La mejor que sí rige (o null)
  function mejor(promos, opts) {
    const r = evaluar(promos, opts)[0];
    return r && r.saving > 0 ? r : null;
  }

  // "los martes y jueves", "de lunes a viernes"
  const plural = (d) => (d === 0 || d === 6 ? DIAS[d] + 's' : DIAS[d]);
  function listaDias(dias) {
    if (dias.length === 5 && dias.every((d, i) => d === i + 1)) return 'de lunes a viernes';
    const n = dias.map(plural);
    return 'los ' + (n.length === 1 ? n[0] : n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1]);
  }

  const api = { DIAS, vigente, vigentes, medios, ahorro, evaluar, mejor, listaDias };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Bank = api;
})(typeof window !== 'undefined' ? window : globalThis);
