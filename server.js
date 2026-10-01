// Servidor local: sirve la web (incluidos los datos de SEPA de public/data) y resuelve direcciones y rutas.
// La lógica de la API vive en lib/api.js, compartida con el Cloudflare Worker.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handleApi } = require('./lib/api');

const PORT = process.env.PORT || 3210;
const PUBLIC = path.join(__dirname, 'public');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let d = '';
  req.on('data', (c) => { d += c; if (d.length > 200_000) { reject(new Error('body too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname.startsWith('/api/')) {
      const r = await handleApi({ method: req.method, pathname: u.pathname, query: u.searchParams, readJson: () => readBody(req) });
      return r ? send(res, r.status, r.body) : send(res, 404, { error: 'Ruta no encontrada' });
    }
    // estáticos
    const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, data) => err ? send(res, 404, 'No encontrado', 'text/plain') : send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream'));
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Comparador de precios en http://localhost:${PORT}`));
