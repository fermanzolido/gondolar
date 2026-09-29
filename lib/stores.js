// Supermercados soportados. `kind` decide qué conector se usa (ver lib/fetchers.js).
// Para agregar otra cadena VTEX alcanza con sumar una línea acá.
module.exports = [
  { id: 'carrefour', name: 'Carrefour', color: '#2563eb', kind: 'vtex', base: 'https://www.carrefour.com.ar', defaultEnabled: true },
  { id: 'jumbo', name: 'Jumbo', color: '#16a34a', kind: 'vtex', base: 'https://www.jumbo.com.ar', defaultEnabled: true },
  { id: 'disco', name: 'Disco', color: '#9333ea', kind: 'vtex', base: 'https://www.disco.com.ar', defaultEnabled: true },
  { id: 'vea', name: 'Vea', color: '#0891b2', kind: 'vtex', base: 'https://www.vea.com.ar', defaultEnabled: true },
  { id: 'dia', name: 'Día', color: '#dc2626', kind: 'vtex', base: 'https://diaonline.supermercadosdia.com.ar', defaultEnabled: true },
  { id: 'changomas', name: 'Changomás', color: '#ca8a04', kind: 'vtex', base: 'https://www.masonline.com.ar', defaultEnabled: true },
  { id: 'coto', name: 'Coto', color: '#db2777', kind: 'coto', base: 'https://www.cotodigital.com.ar', defaultEnabled: true },
  { id: 'cordiez', name: 'Cordiez', color: '#64748b', kind: 'vtex', base: 'https://www.cordiez.com.ar', defaultEnabled: false, note: 'Regional (Buenos Aires)' },
  { id: 'josimar', name: 'Josimar', color: '#0f766e', kind: 'vtex', base: 'https://www.josimar.com.ar', defaultEnabled: false, note: 'Regional (zona sur GBA)' },
];
