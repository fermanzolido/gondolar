# Cuánto Sale

Comparador de precios de supermercados argentinos. Armás tu lista, y la app te dice **en qué súper conviene comprar cada
cosa**, teniendo en cuenta lo que cuesta ir hasta cada uno (nafta y tiempo). Al final imprimís la lista dividida por tienda.

**[Probarlo online →](https://fermanzolido.github.io/cuanto-sale/)** · Gratis, sin cuentas, sin publicidad.

> Proyecto personal e independiente. No tiene relación con ninguna cadena de supermercados.
> Los precios son orientativos. Ver el [aviso legal y de privacidad](public/legal.html).

## Qué hace

- **Compara 7 cadenas:** Carrefour, Jumbo, Disco, Vea, Día, Changomás y Coto (más Cordiez y Josimar, regionales, opcionales).
- **Encuentra el mismo producto en todas** usando el código de barras (EAN), así se compara exactamente lo mismo.
- **Filtros** por marca y precio, más orden por precio o por mayor diferencia entre tiendas. "Solo comparables" oculta las
  marcas propias, que solo se venden en su cadena (Carrefour Classic, Día, Coto…).
- **Plan de compra:** prueba todas las combinaciones de tiendas y elige la de menor costo total (productos + viajes).
  Muestra la mejor opción para ir a 1, 2 o 3 tiendas y si **vale la pena** cada parada extra.
- **Tu ubicación:** con tu dirección o el GPS busca la sucursal más cercana de cada cadena, calcula km y minutos en auto y
  completa el costo del viaje solo. Muestra un mapa y un botón "Cómo llegar".
- **Lista para el súper:** tickets por tienda con casilleros para ir tildando, impresión y copiado para WhatsApp.
- **Privacidad primero:** tu lista y tu ubicación viven solo en tu navegador; tipografías, mapa y fotos de terceros
  se cargan únicamente si lo permitís.

## Cómo usarlo

**Online:** entrá a https://fermanzolido.github.io/cuanto-sale/. La primera vez, cargá tu dirección en *Viaje y tiendas*.

**En tu computadora** (necesita [Node.js](https://nodejs.org) 18 o superior, sin dependencias que instalar):

```bash
git clone https://github.com/fermanzolido/cuanto-sale.git
cd cuanto-sale
npm start          # o doble clic en iniciar.bat (Windows)
```

Se abre en http://localhost:3210. Para correr las pruebas: `npm test`.

## Cómo funciona

```
Navegador (GitHub Pages) ──► API (Cloudflare Worker) ──► sitios públicos de las cadenas
        public/                 worker/ + lib/           OpenStreetMap (direcciones, sucursales, rutas)
```

- `public/` — la web (HTML, CSS y JavaScript sin frameworks). Guarda todo en `localStorage`.
- `lib/api.js` — rutas de la API, compartidas entre el servidor local (`server.js`) y el Worker (`worker/index.mjs`).
- `lib/fetchers.js` — conectores por tipo de tienda: VTEX (Carrefour, Jumbo, Disco, Vea, Día, Changomás) y Coto.
- `lib/geo.js` — geocodificación (Nominatim), sucursales (Overpass) y rutas en auto (OSRM).
- `public/optimizer.js` — el optimizador: función pura, con tests en `test/`.
- `public/consent.js` — consentimiento de privacidad: nada de terceros se carga sin permiso.

Para sumar otra cadena que use VTEX alcanza con agregar una línea en `lib/stores.js`.

## Publicarlo gratis (GitHub Pages + Cloudflare Workers)

La web se aloja en **GitHub Pages** y la API corre en un **Cloudflare Worker**. Los dos tienen plan gratuito y no piden tarjeta.

1. **API en Cloudflare.** Con una cuenta gratis, en esta carpeta:
   ```bash
   npx wrangler login
   npx wrangler deploy
   ```
   Te da una URL como `https://cuanto-sale-api.TU-SUBDOMINIO.workers.dev`.
2. **Web en GitHub Pages.** Subí el proyecto a un repositorio. En *Settings → Pages* elegí *Source: GitHub Actions*.
   En *Settings → Secrets and variables → Actions → Variables* creá `API_BASE` con la URL del paso 1.
   Cada `git push` a `main` publica la web (`.github/workflows/pages.yml`).
3. **Cerrar la API a tu web.** En `wrangler.toml` poné `ALLOWED_ORIGIN = "https://TU-USUARIO.github.io"` y volvé a
   ejecutar `npx wrangler deploy`.
4. *Opcional:* cargá los secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` para que la API se publique sola con
   cada push (`.github/workflows/worker.yml`).

Límites del plan gratis de Cloudflare: 100.000 pedidos por día y 50 consultas externas por pedido; por eso la web pide
los precios en tandas de hasta 24 combinaciones producto x tienda.

## Limitaciones

- Los precios son los que muestra cada web por defecto: pueden diferir según sucursal, zona o medio de pago.
- Las promociones (2x1, segunda unidad, tarjeta) no se restan del total: se muestran como aviso.
- OpenStreetMap puede no tener alguna sucursal; en ese caso se cargan los km a mano.
- No están La Anónima ni otras cadenas que bloquean las consultas automáticas.
- Si una cadena cambia su web, su conector (`lib/fetchers.js`) puede necesitar un ajuste.
- Los servicios públicos de mapas (Overpass, OSRM, Nominatim) tienen límites de uso y a veces se saturan.

## Uso responsable de los datos

Las consultas a las cadenas se hacen a pedido de quien usa la herramienta, con volumen bajo y guardando resultados unos
minutos. La herramienta se identifica con su nombre (`CuantoSale`) y la dirección de este repositorio; no finge ser un
navegador. Si sos titular de una marca, imagen o sitio y querés que algo cambie o se quite, abrí un
[issue](https://github.com/fermanzolido/cuanto-sale/issues).

Si forkeás el proyecto, respetá los términos de uso de los sitios que consultes y de los servicios de OpenStreetMap
([política de uso](https://operations.osmfoundation.org/policies/)).

## Privacidad

Sin cuentas, sin publicidad, sin métricas ni cookies de seguimiento. Tu lista, tus ajustes y tu ubicación se guardan
solo en tu navegador. Las tipografías (Google Fonts), el mapa (Leaflet + OpenStreetMap) y las fotos de productos
(servidores de cada cadena) están apagados hasta que los aceptás, y podés cambiarlo cuando quieras. Detalle completo, con
qué recibe cada servicio y tus derechos, en el [aviso legal y de privacidad](public/legal.html).

## Créditos

- Datos de sucursales, direcciones y rutas: © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright) (licencia ODbL).
- Mapa: [Leaflet](https://leafletjs.com) (BSD-2).
- Tipografías: Bricolage Grotesque, Instrument Sans e IBM Plex Mono (SIL Open Font License).

## Licencia

[MIT](LICENSE) © 2026 fermanzolido. El software se ofrece "tal cual", sin garantías.
