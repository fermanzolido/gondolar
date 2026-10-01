// Prueba de diseño adaptable: abre la web en Chrome a muchos tamaños de pantalla (celulares chicos y plegables, tablets, notebooks,
// monitores; vertical y apaisado) y revisa las tres pantallas más el aviso de privacidad de la primera visita.
//   * Falla si hay scroll horizontal, elementos que se salen de la pantalla, el aviso de privacidad no entra o hay errores de JavaScript.
//   * Avisa (sin fallar) de botones menores a 32 px en pantallas táctiles y de texto recortado.
//
// Necesita Chrome o Edge y los datos (npm run datos).    Uso:   npm run e2e:responsive            (8 tamaños)
//                                                               npm run e2e:responsive -- --todo    (todos los tamaños)
//                                                               npm run e2e:responsive -- --capturas carpeta
import { closeAll, launchChrome, Page, sleep, startServer } from './cdp.mjs';

const TODOS = [
  [280, 653, 'Galaxy Fold plegado'], [320, 568, 'iPhone SE (1.ª)'], [360, 740, 'Android chico'], [375, 667, 'iPhone 8'], [375, 812, 'iPhone X'],
  [390, 844, 'iPhone 14'], [412, 915, 'Pixel 7'], [430, 932, 'iPhone 14 Pro Max'], [568, 320, 'celular apaisado', true], [740, 360, 'Android apaisado', true],
  [768, 1024, 'iPad vertical'], [820, 1180, 'iPad Air'], [1024, 768, 'iPad apaisado'], [1280, 800, 'notebook'], [1440, 900, 'escritorio'], [1920, 1080, 'Full HD'],
];
const RAPIDOS = ['280x653', '360x740', '390x844', '568x320', '768x1024', '1024x768', '1280x800', '1920x1080'];
const args = process.argv.slice(2);
const todo = args.includes('--todo');
const capturas = args.includes('--capturas') ? args[args.indexOf('--capturas') + 1] : null;
const dispositivos = TODOS.filter((d) => todo || RAPIDOS.includes(`${d[0]}x${d[1]}`));

// Se ejecuta dentro de la página: mide desbordes, blancos de toque chicos y texto recortado
function auditPage() {
  const vw = document.documentElement.clientWidth;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const desc = (el) => {
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const txt = (el.getAttribute('aria-label') || el.innerText || el.value || '').toString().trim().replace(/\s+/g, ' ').slice(0, 24);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (txt ? ` "${txt}"` : '');
  };
  const recortado = (el) => {                       // ¿un contenedor con scroll o recorte lo oculta (y está dentro de la pantalla)?
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') { const r = p.getBoundingClientRect(); if (r.right <= vw + 1 && r.left >= -1) return true; }
    }
    return false;
  };
  const out = { vw, scrollW: document.documentElement.scrollWidth, overflow: [], small: [], clip: [] };
  const vistos = new Set();
  const anota = (lista, k) => { if (!vistos.has(k)) { vistos.add(k); lista.push(k); } };
  document.querySelectorAll('body *').forEach((el) => {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if ((r.right > vw + 1 || r.left < -1) && !recortado(el)) anota(out.overflow, `${desc(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    const tag = el.tagName.toLowerCase();
    const interactivo = tag === 'button' || tag === 'select' || (tag === 'a' && !el.closest('p, li, small, .xs, .sm, .foot-note, .site-foot, .legal')) || (tag === 'input' && el.type !== 'hidden');
    if (interactivo && coarse) {
      const caja = tag === 'input' && el.closest('label') ? el.closest('label').getBoundingClientRect() : r;   // un input dentro de un label se toca por el label
      if (Math.min(caja.width, caja.height) < 32) anota(out.small, `${desc(el)} ${Math.round(caja.width)}x${Math.round(caja.height)}`);
    }
    if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && !cs.webkitLineClamp
        && !/bar-track|bar-fill|rank|map-wrap/.test(el.className) && !el.closest('.leaflet-container')) anota(out.clip, `${desc(el)} ${el.scrollWidth}>${el.clientWidth}`);
  });
  return out;
}

const SEMILLA = (home) => `localStorage.clear(); localStorage.setItem('consent', JSON.stringify({v:1, at: Date.now(), fonts:false, maps:false, images:false}));
  localStorage.setItem('home', JSON.stringify(${JSON.stringify(home)}));`;
const HOME = { lat: -34.6037, lon: -58.3816, label: 'Obelisco, Ciudad de Buenos Aires', prov: 'AR-C' };

const fallas = [], avisos = [];
let url;
try {
  url = await startServer();
  await launchChrome();
  for (const [w, h, nombre, apaisado] of dispositivos) {
    const mobile = w <= 1024;
    const tag = `${w}x${h} ${nombre}`;
    const p = await Page.create();
    await p.device(w, h, { mobile, dpr: mobile ? 2 : 1, landscape: !!apaisado });
    await p.goto(url, 400);
    await p.run(SEMILLA(HOME));
    await p.goto(url, 1500);

    const revisar = async (vista, preparar) => {
      await preparar();
      await sleep(700);
      const a = await p.eval(`(${auditPage.toString()})()`);
      if (a.scrollW > a.vw + 1) fallas.push(`${tag} / ${vista}: scroll horizontal (${a.scrollW} > ${a.vw})`);
      if (a.overflow.length) fallas.push(`${tag} / ${vista}: se sale de la pantalla: ${a.overflow.slice(0, 5).join('; ')}`);
      if (a.small.length) avisos.push(`${tag} / ${vista}: botones chicos: ${a.small.slice(0, 5).join('; ')}${a.small.length > 5 ? ` (+${a.small.length - 5})` : ''}`);
      if (a.clip.length) avisos.push(`${tag} / ${vista}: texto recortado: ${a.clip.slice(0, 4).join('; ')}`);
      if (capturas) { await p.run('window.scrollTo(0, 0)'); await p.shot(`${capturas}/${w}x${h}/${vista}.png`); }
    };
    await revisar('buscar', () => p.run(`document.querySelector('[data-go=search]').click(); await new Promise(r => setTimeout(r, 300));
      const i = document.querySelector('#q'); i.value = 'coca cola'; i.closest('form').requestSubmit(); await new Promise(r => setTimeout(r, 2500));
      document.querySelectorAll('.p [data-act=add]').forEach((b, k) => { if (k < 4) b.click(); });`));
    await revisar('mi compra', () => p.run(`document.querySelector('[data-go=plan]').click(); await new Promise(r => setTimeout(r, 1500));`));
    await revisar('viaje', () => p.run(`document.querySelector('[data-go=trip]').click(); await new Promise(r => setTimeout(r, 2500));`));
    if (p.logs.some((l) => /exception|error/i.test(l))) fallas.push(`${tag}: errores en la consola: ${p.logs.filter((l) => /exception|error/i.test(l)).slice(0, 3).join(' | ')}`);
    await p.close();

    // primera visita: el aviso de privacidad tiene que entrar completo en la pantalla
    const q = await Page.create();
    await q.device(w, h, { mobile, dpr: mobile ? 2 : 1, landscape: !!apaisado });
    await q.goto(url, 400);
    await q.run('localStorage.clear()');
    await q.goto(url, 2200);
    const c = await q.eval(`(() => { const e = document.querySelector('.consent'); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; })()`);
    if (!c) fallas.push(`${tag} / primera visita: no apareció el aviso de privacidad`);
    else if (c.top < 0 || c.bottom > c.vh + 1) fallas.push(`${tag} / primera visita: el aviso de privacidad no entra en la pantalla (${JSON.stringify(c)})`);
    const a = await q.eval(`(${auditPage.toString()})()`);
    if (a.scrollW > a.vw + 1) fallas.push(`${tag} / primera visita: scroll horizontal (${a.scrollW} > ${a.vw})`);
    if (capturas) await q.shot(`${capturas}/${w}x${h}/primera-visita.png`);
    await q.close();
    console.log(`  ${tag}: listo`);
  }
} finally { closeAll(); }

if (avisos.length) console.log('\nAvisos (no fallan):\n  ' + avisos.join('\n  '));
if (fallas.length) { console.log('\nFALLAS:\n  ' + fallas.join('\n  ')); process.exit(1); }
console.log(`\nresponsive: ${dispositivos.length} tamaños sin desbordes ni scroll horizontal`);
