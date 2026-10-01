// Prueba de la app instalable en Chrome: manifiesto válido, criterios de instalación, service worker, cartel de instalación
// (Chrome/Android y Safari de iPhone) y funcionamiento sin conexión con los datos guardados.
// Necesita Chrome o Edge y los datos (npm run datos).    Uso: npm run e2e:pwa
import assert from 'node:assert/strict';
import { closeAll, launchChrome, Page, sleep, startServer } from './cdp.mjs';

const SEMILLA = `localStorage.clear(); localStorage.setItem('consent', JSON.stringify({v:1, at: Date.now(), fonts:false, maps:false, images:false}));`;
const pasos = [];
const ok = (msg) => { pasos.push(msg); console.log('  ok  ' + msg); };

try {
  const url = await startServer();
  await launchChrome();

  // 1) manifiesto, instalabilidad y service worker
  const p = await Page.create();
  await p.device(412, 915, { mobile: true, dpr: 2 });
  await p.goto(url, 400);
  await p.run(SEMILLA);
  await p.goto(url, 2500);
  const man = await p.send('Page.getAppManifest');
  assert.deepEqual(man.errors, [], 'el manifiesto tiene errores: ' + JSON.stringify(man.errors));
  const m = JSON.parse(man.data);
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'falta un ícono maskable');
  assert.ok(m.icons.some((i) => i.sizes === '512x512'), 'falta el ícono de 512 px');
  assert.ok(m.shortcuts.length >= 3);
  ok(`manifiesto válido (${m.icons.length} íconos, ${m.shortcuts.length} atajos, ${m.screenshots.length} capturas)`);
  const inst = await p.send('Page.getInstallabilityErrors');
  assert.deepEqual(inst.installabilityErrors, [], 'Chrome no la considera instalable: ' + JSON.stringify(inst.installabilityErrors));
  ok('Chrome la considera instalable (sin errores de instalabilidad)');
  const sw = await p.run(`const reg = await navigator.serviceWorker.getRegistration(); await navigator.serviceWorker.ready; return { active: !!(reg && reg.active), controlled: !!navigator.serviceWorker.controller };`);
  assert.ok(sw.active && sw.controlled, 'el service worker no quedó activo: ' + JSON.stringify(sw));
  ok('service worker activo y controlando la página');

  // 2) cartel de instalación (Chrome, Android y escritorio): se simula el evento nativo
  await p.run(`window.__prompted = false; const ev = new Event('beforeinstallprompt'); ev.prompt = () => { window.__prompted = true; return Promise.resolve(); }; ev.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(ev);`);
  await sleep(3200);
  assert.equal(await p.run(`return !!document.querySelector('.install [data-install]');`), true, 'no apareció el cartel de instalación');
  assert.equal(await p.run(`return !document.querySelector('[data-install-link]').hidden;`), true, 'el enlace "Instalar la app" del pie debería verse');
  await p.run(`document.querySelector('.install [data-install]').click(); await new Promise(r => setTimeout(r, 500));`);
  assert.equal(await p.run('return window.__prompted;'), true, 'el botón no disparó el aviso nativo');
  assert.equal(await p.run(`return !document.querySelector('.install');`), true);
  assert.equal(await p.run(`return !!JSON.parse(localStorage.getItem('pwa-install') || '{}').dismissedAt;`), true, 'no recordó el rechazo');
  ok('cartel de instalación: aparece, dispara el aviso nativo y recuerda el rechazo');

  // 3) sin conexión
  await p.goto(url, 1500);
  await p.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await p.goto(url, 2500);
  assert.equal(await p.run(`return !!document.querySelector('#searchForm');`), true, 'sin conexión no abre la app');
  await p.run(`const i = document.querySelector('#q'); i.value = 'coca cola'; i.closest('form').requestSubmit(); await new Promise(r => setTimeout(r, 2500));`);
  const tarjetas = await p.run(`return document.querySelectorAll('.p').length;`);
  assert.ok(tarjetas > 0, 'sin conexión la búsqueda no encontró nada (¿no guardó los datos?)');
  ok(`sin conexión abre la app y busca con los datos guardados (${tarjetas} productos)`);
  await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const errores = p.logs.filter((l) => /exception|error/i.test(l));
  assert.deepEqual(errores, [], 'errores en la consola: ' + errores.join(' | '));
  ok('sin errores en la consola');
  await p.close();

  // 4) iPhone (Safari): no hay evento nativo, se muestran los pasos para agregar a inicio
  const q = await Page.create();
  await q.device(390, 844, { mobile: true, dpr: 2 });
  await q.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  await q.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.addEventListener('beforeinstallprompt', (e) => { e.stopImmediatePropagation(); }, true);" });
  await q.goto(url, 400);
  await q.run(SEMILLA);
  await q.goto(url, 4200);
  assert.equal(await q.run(`return !!document.querySelector('.install');`), true, 'en iPhone no apareció el cartel');
  await q.run(`document.querySelector('.install [data-install]').click(); await new Promise(r => setTimeout(r, 400));`);
  const pasosIos = await q.run(`const o = document.querySelector('.install ol'); return o ? o.innerText : null;`);
  assert.match(pasosIos || '', /Agregar a inicio/);
  ok('iPhone: el cartel muestra los pasos de "Agregar a inicio"');
  await q.close();
} catch (e) {
  console.error('\nFALLA: ' + (e && e.message ? e.message : e));
  closeAll();
  process.exit(1);
}
closeAll();
console.log(`\npwa: ${pasos.length} comprobaciones OK`);
