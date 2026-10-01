// Consentimiento de privacidad. Nada de terceros se carga hasta que la persona lo permite.
//
// Siempre activo (necesario): guardar en este navegador la lista, los ajustes, la ubicación y esta elección.
// Opcional (apagado por defecto), porque el navegador le pide archivos a otro servidor, que ve la dirección IP:
//   fonts  -> tipografías de Google Fonts
//   maps   -> mapa: Leaflet (cdnjs / Cloudflare) y teselas de OpenStreetMap
//   images -> fotos de productos: se piden a images.openfoodfacts.org (Open Food Facts, licencia CC BY-SA)
// (Nunca se piden fotos a los servidores de las cadenas: son de ellas y no se usan.)
(() => {
  'use strict';
  const KEY = 'consent', VERSION = 1, MAX_AGE = 365 * 24 * 3600 * 1000;
  const QUIET = document.currentScript && document.currentScript.hasAttribute('data-quiet'); // no abrir solo (página legal)
  const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Sans:wght@400..700&display=swap';
  const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  const WIPE_KEYS = ['cart', 'settings', 'checked', 'home', 'branches', 'branches2', 'currency', 'pwa-install', KEY];

  const read = () => {
    try { const c = JSON.parse(localStorage.getItem(KEY)); if (c && c.v === VERSION && Date.now() - c.at < MAX_AGE) return c; } catch { /* sin acceso */ }
    return null;
  };
  let current = read();
  const allows = (k) => !!(current && current[k]);
  const emit = () => window.dispatchEvent(new CustomEvent('consent-change'));

  function addLink(id, href) {
    if (document.getElementById(id)) return;
    const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
  }
  function apply() {
    if (allows('fonts')) addLink('consent-fonts', FONTS);
    if (allows('maps') && !document.getElementById('consent-leaflet-js')) {
      addLink('consent-leaflet-css', LEAFLET_CSS);
      const s = document.createElement('script'); s.id = 'consent-leaflet-js'; s.src = LEAFLET_JS; s.onload = emit; document.head.appendChild(s);
    }
  }

  function save(choice) {
    const before = current || {};
    current = { v: VERSION, at: Date.now(), fonts: !!choice.fonts, maps: !!choice.maps, images: !!choice.images };
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* sin acceso */ }
    close();
    // si se retiró un permiso, se recarga para que el navegador deje de usar ese recurso
    if (['fonts', 'maps'].some((k) => before[k] && !current[k])) { location.reload(); return; }
    apply(); emit();
  }

  // cambia una sola opción (p. ej. "Activar fotos" desde la búsqueda). Si todavía no hubo elección, se abre el aviso.
  function update(patch) {
    if (!current) { open('prefs'); return; }
    save({ fonts: current.fonts, maps: current.maps, images: current.images, ...patch });
  }

  function wipe() {
    try { WIPE_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* sin acceso */ }
    location.reload();
  }

  // ---------- interfaz ----------
  let box = null, lastFocus = null;
  function close() { if (box) { box.remove(); box = null; } if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  const sw = (k, title, desc, on) => `<label class="c-opt"><span class="c-t"><b>${title}</b><small>${desc}</small></span><input class="sw" type="checkbox" data-k="${k}"${on ? ' checked' : ''} aria-label="${title}"></label>`;

  function open(mode) {
    lastFocus = document.activeElement;
    if (box) box.remove();
    box = document.createElement('div');
    box.className = 'consent'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-labelledby', 'c-title');
    if (mode === 'wipe') {
      box.innerHTML = `<h2 id="c-title">Borrar mis datos</h2>
        <p>Se borran de este navegador tu lista, los ajustes, tu ubicación y tus preferencias de privacidad. No se puede deshacer.</p>
        <div class="c-actions"><button class="btn primary" data-c="wipe">Sí, borrar todo</button><button class="btn" data-c="cancel">Cancelar</button></div>`;
    } else {
      const cur = current || {};
      const custom = mode === 'prefs';
      box.innerHTML = `<h2 id="c-title">Tu privacidad</h2>
        <p>Gondolar guarda tu lista, tus ajustes y tu ubicación <b>solo en este navegador</b>. Las tipografías, el mapa y las fotos de productos se piden a otros servidores, que ven tu dirección IP. Vos elegís cuáles permitir; la app funciona igual sin ninguno. <a href="legal.html#privacidad">Más información</a></p>
        <div class="c-opts" ${custom ? '' : 'hidden'}>
          <div class="c-opt fixed"><span class="c-t"><b>Necesarias</b><small>Guardar tu lista, ajustes, ubicación y esta elección en tu navegador. Siempre activas.</small></span><span class="pill soft">Activas</span></div>
          ${sw('fonts', 'Tipografías', 'Se piden a Google Fonts (Google).', cur.fonts)}
          ${sw('maps', 'Mapa', 'Leaflet desde cdnjs (Cloudflare) y mapas de OpenStreetMap.', cur.maps)}
          ${sw('images', 'Fotos de productos', 'Se piden a Open Food Facts, una base abierta (licencia CC BY-SA).', cur.images)}
        </div>
        <div class="c-actions">
          <button class="btn primary" data-c="all">Aceptar todo</button>
          <button class="btn primary" data-c="none">Solo lo necesario</button>
          ${custom ? '<button class="btn" data-c="save">Guardar mi elección</button>' : '<button class="btn" data-c="custom">Elegir</button>'}
        </div>`;
    }
    document.body.appendChild(box);
    const first = box.querySelector('button.btn'); if (first) first.focus({ preventScroll: true });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-consent]');
    if (t) { e.preventDefault(); open(t.dataset.consent === 'wipe' ? 'wipe' : 'prefs'); return; }
    const b = e.target.closest('.consent [data-c]'); if (!b) return;
    const c = b.dataset.c;
    if (c === 'all') save({ fonts: true, maps: true, images: true });
    else if (c === 'none') save({});
    else if (c === 'custom') { box.querySelector('.c-opts').hidden = false; b.outerHTML = '<button class="btn" data-c="save">Guardar mi elección</button>'; }
    else if (c === 'save') { const v = {}; box.querySelectorAll('input[data-k]').forEach((i) => { v[i.dataset.k] = i.checked; }); save(v); }
    else if (c === 'wipe') wipe();
    else if (c === 'cancel') close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box && current) close(); });

  window.Consent = { allows, open, update, wipe, decided: () => !!current };
  apply();
  if (!current && !QUIET) open('first');
})();
