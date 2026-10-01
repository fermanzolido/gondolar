// Cliente mínimo del protocolo de Chrome (CDP) para probar la web en un Chrome/Edge sin ventana, sin instalar nada (Node 22+).
// Lo usan responsive.mjs y pwa.mjs. Necesita Chrome o Edge instalado (o la variable CHROME_PATH).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

let chrome = null, server = null, debugPort = 9333;

export async function launchChrome(port = 9333) {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('No encontré Chrome ni Edge. Instalalo o indicá la ruta en la variable CHROME_PATH.');
  debugPort = port;
  chrome = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'gondolar-e2e-'))}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return; } catch { /* todavía no arrancó */ }
    await sleep(250);
  }
  throw new Error('Chrome no arrancó');
}

// Servidor local de la app (server.js) en un puerto propio, para no pisar el que ya tengas abierto.
export async function startServer(port = Number(process.env.E2E_PORT) || 3399) {
  server = spawn(process.execPath, [join(ROOT, 'server.js')], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch { /* todavía no arrancó */ }
    await sleep(250);
  }
  const url = `http://localhost:${port}/`;
  const meta = await fetch(url + 'data/meta.json');
  if (!meta.ok) throw new Error('Faltan los datos: corré "npm run datos" una vez y volvé a intentar.');
  return url;
}

export function closeAll() {
  for (const p of [chrome, server]) { try { if (p) process.kill(p.pid); } catch { /* ya cerrado */ } }
  chrome = server = null;
}

export class Page {
  static async create() {
    const t = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
    const page = new Page(t.webSocketDebuggerUrl, t.id);
    await page.ready;
    for (const m of ['Page.enable', 'Runtime.enable', 'Network.enable']) await page.send(m);
    return page;
  }

  constructor(url, id) {
    this.id = id; this.n = 0; this.pending = new Map(); this.handlers = []; this.logs = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) {
        const { res, rej } = this.pending.get(d.id); this.pending.delete(d.id);
        if (d.error) rej(new Error(d.error.message)); else res(d.result);
      } else if (d.method) {
        if (d.method === 'Runtime.consoleAPICalled') this.logs.push(`[${d.params.type}] ` + d.params.args.map((a) => a.value ?? a.description).join(' '));
        if (d.method === 'Runtime.exceptionThrown') this.logs.push('[exception] ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
        this.handlers.forEach((h) => h(d));
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }

  // Simula un dispositivo: tamaño, densidad, táctil (pointer: coarse) y user agent de celular
  async device(width, height, { mobile = true, dpr = 2, landscape = false, dark = false } = {}) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile, screenOrientation: { type: landscape ? 'landscapePrimary' : 'portraitPrimary', angle: landscape ? 90 : 0 } });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: mobile ? 'coarse' : 'fine' }, { name: 'hover', value: mobile ? 'none' : 'hover' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    if (mobile) await this.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
  }

  async goto(url, wait = 1200) {
    const loaded = new Promise((res) => { const h = (d) => { if (d.method === 'Page.loadEventFired') { this.handlers = this.handlers.filter((x) => x !== h); res(); } }; this.handlers.push(h); });
    await this.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(15000)]);
    await sleep(wait);
  }

  // Evalúa una expresión (devuelve su valor)
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  // Ejecuta un bloque de código con await y devuelve lo que retorne
  async run(code) {
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  async shot(file, { full = false } = {}) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, fromSurface: true });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }

  async close() { try { await fetch(`http://127.0.0.1:${debugPort}/json/close/${this.id}`); } catch { /* ya cerrada */ } }
}
