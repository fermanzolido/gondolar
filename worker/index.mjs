// Cloudflare Worker: la misma API que server.js, pero en la nube (plan gratis de Cloudflare).
// El código de la API está en lib/api.js; acá solo se agrega CORS para que la web (GitHub Pages) pueda llamarlo.
import api from '../lib/api.js';

const { handleApi } = api;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = (env && env.ALLOWED_ORIGIN) || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : allowed,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!url.pathname.startsWith('/api/')) return new Response('Gondolar API', { headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' } });
    if (allowed !== '*' && origin && origin !== allowed) return reply(403, { error: 'Origen no permitido' });

    try {
      const r = await handleApi({
        method: request.method,
        pathname: url.pathname,
        query: url.searchParams,
        readJson: async () => { try { return await request.json(); } catch { return {}; } },
      });
      return r ? reply(r.status, r.body) : reply(404, { error: 'Ruta no encontrada' });
    } catch (e) {
      return reply(500, { error: e.message });
    }
  },
};
