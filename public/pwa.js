// App instalable (PWA): registra el service worker y ofrece instalar Gondolar en el celular o la computadora.
//  * Chrome, Edge y Samsung Internet (Android y escritorio): usan el aviso nativo del navegador, que acá se dispara con un botón propio.
//  * Safari en iPhone/iPad no tiene botón de instalar: se muestran los pasos ("Compartir" → "Agregar a inicio").
// El cartel aparece una sola vez al entrar, después de que se resolvió el aviso de privacidad, y si se lo cierra no vuelve por 14 días.
(() => {
  'use strict';
  const KEY = 'pwa-install', SNOOZE_MS = 14 * 24 * 3600 * 1000, DELAY_MS = 2500;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...v })); } catch { /* modo privado */ } };

  // ---------- service worker ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).catch(() => { /* sin soporte: la web funciona igual */ }); });
  }

  // ---------- ¿ya está instalada? ----------
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: minimal-ui)').matches || window.navigator.standalone === true;
  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const touch = () => window.matchMedia('(pointer: coarse)').matches;
  let deferred = null, bar = null, shownKind = '';

  const kind = () => (deferred ? 'native' : isIOS ? 'ios' : '');
  const canOffer = () => !standalone() && !!kind();
  const snoozed = () => Date.now() - (read().dismissedAt || 0) < SNOOZE_MS;
  const consentDone = () => !window.Consent || window.Consent.decided();

  function syncFooterLink() {
    document.querySelectorAll('[data-install-link]').forEach((el) => { el.hidden = !canOffer(); });
  }

  function hide(remember) {
    if (bar) { bar.remove(); bar = null; }
    shownKind = '';
    if (remember) write({ dismissedAt: Date.now() });
  }

  function show(force) {
    if (bar || !canOffer()) return;
    if (!force && (snoozed() || !consentDone())) return;
    const k = kind();
    shownKind = k;
    const device = touch() ? 'tu celular' : 'tu computadora';
    bar = document.createElement('section');
    bar.className = 'install no-print';
    bar.setAttribute('aria-label', 'Instalar la app');
    bar.innerHTML = `<img class="i-logo" src="favicon.svg" alt="" width="40" height="40">
      <div class="i-txt"><b>Instalá Gondolar en ${device}</b><span>Se abre como una app, desde tu pantalla de inicio y sin buscarla en el navegador.</span></div>
      <div class="i-act"><button type="button" class="btn primary sm" data-install>${k === 'ios' ? 'Cómo instalar' : 'Instalar'}</button></div>
      <button type="button" class="icon-btn i-x" data-install-close aria-label="Ahora no" title="Ahora no"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
    const app = document.querySelector('.app');
    if (!app) { bar = null; return; }
    app.insertBefore(bar, app.firstChild);
  }

  async function install() {
    if (deferred) {
      const ev = deferred;
      deferred = null; // el navegador solo permite usar el aviso una vez
      try {
        ev.prompt();
        const { outcome } = await ev.userChoice;
        if (outcome !== 'accepted') write({ dismissedAt: Date.now() });
      } catch { /* el navegador lo rechazó */ }
      hide(false); syncFooterLink();
      return;
    }
    if (isIOS) {
      show(true);
      if (bar && !bar.querySelector('ol')) {
        const ol = document.createElement('ol');
        ol.innerHTML = '<li>Tocá el botón <b>Compartir</b> de Safari (el cuadrado con la flecha hacia arriba).</li><li>Deslizá y elegí <b>Agregar a inicio</b>.</li><li>Tocá <b>Agregar</b>. Gondolar queda como una app más.</li>';
        bar.appendChild(ol);
        bar.querySelector('.i-act').hidden = true;
      }
    }
  }

  function schedule() {
    syncFooterLink();
    if (!canOffer() || bar) return;
    setTimeout(() => show(false), DELAY_MS);
  }

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; schedule(); });
  window.addEventListener('appinstalled', () => { deferred = null; hide(false); syncFooterLink(); });
  window.addEventListener('consent-change', () => { if (canOffer() && !bar) setTimeout(() => show(false), 600); });
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', () => { if (standalone()) { hide(false); syncFooterLink(); } });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-install-close]')) { hide(true); return; }
    if (e.target.closest('[data-install], [data-install-link]')) { e.preventDefault(); install(); }
  });

  // Safari en iPhone/iPad no avisa nada: se ofrece igual, una vez cargada la página
  window.addEventListener('load', () => { syncFooterLink(); if (isIOS) schedule(); });
  window.Pwa = { canOffer, install, kind: () => shownKind || kind() };
})();
