# Gondolar

Comparador de precios de supermercados argentinos con **datos abiertos oficiales**. Armás tu lista, y la app te dice
**en qué súper conviene comprar cada cosa**, teniendo en cuenta lo que cuesta ir hasta cada uno (nafta y tiempo). Al final
imprimís la lista dividida por tienda.

**[Probarlo online →](https://fermanzolido.github.io/gondolar/)** · Gratis, sin cuentas, sin publicidad.

> Proyecto personal e independiente. No tiene relación con ninguna cadena de supermercados.
> Los precios son orientativos. Ver el [aviso legal y de privacidad](public/legal.html).

## Qué hace

- **Compara 8 cadenas:** Carrefour, Jumbo, Disco, Vea, Día, Changomás, Coto y La Anónima.
- **Usa la base oficial SEPA** ([Precios Claros](https://datos.produccion.gob.ar/dataset/sepa-precios), Secretaría de Comercio
  de la Nación): precios que los comercios informan al Estado, actualizados todos los días. **No consulta los sitios de los
  supermercados.**
- **Encuentra el mismo producto en todas** con el código de barras (EAN), así se compara exactamente lo mismo.
- **Precios de tu provincia:** el precio de un mismo producto cambia según la zona (hasta 44% entre sucursales de una
  cadena). Se elige la provincia, o se completa sola al cargar tu ubicación.
- **Filtros** por marca y precio, más orden por precio o por mayor diferencia entre tiendas. "Solo comparables" oculta las
  marcas propias, que solo se venden en su cadena (Carrefour Classic, Día, Coto…).
- **Plan de compra:** prueba todas las combinaciones de tiendas y elige la de menor costo total (productos + viajes).
  Muestra la mejor opción para ir a 1, 2 o 3 tiendas y si **vale la pena** cada parada extra.
- **Tu ubicación:** con tu dirección o el GPS elige la sucursal **oficial** más cercana de cada cadena (con su dirección),
  calcula km y minutos en auto y completa el costo del viaje solo. Muestra un mapa y un botón "Cómo llegar".
- **Pesos o dólares:** el selector `ARS | USD` convierte todos los importes con la cotización que elijas: oficial, blue, MEP,
  contado con liqui, cripto, tarjeta o la oficial de cada banco (dolarapi.com y criptoya.com, a través de `/api/dolar`).
- **Lista para el súper:** tickets por tienda con casilleros para ir tildando, impresión y copiado para WhatsApp.
- **Privacidad primero:** tu lista y tu ubicación viven solo en tu navegador; las tipografías y el mapa de terceros
  se cargan únicamente si lo permitís. No muestra fotos de productos ni logos de las cadenas.

## Cómo usarlo

**Online:** entrá a https://fermanzolido.github.io/gondolar/. La primera vez, cargá tu dirección en *Viaje y tiendas*.

**En tu computadora** (necesita [Node.js](https://nodejs.org) 18+ y [Python](https://www.python.org) 3.9+, sin dependencias que instalar):

```bash
git clone https://github.com/fermanzolido/gondolar.git
cd gondolar
npm run datos      # descarga y procesa los datos oficiales de hoy (~300 MB de bajada, 1 minuto)
npm start          # o doble clic en iniciar.bat (Windows)
```

Se abre en http://localhost:3210. Cuando quieras precios más nuevos, volvé a correr `npm run datos`.
Para las pruebas: `npm test` (web, Worker y optimizador) y `npm run test:datos` (proceso de datos).

## Cómo funciona

```
SEPA (datos.produccion.gob.ar) ──► GitHub Actions, una vez por día ──► archivos estáticos en GitHub Pages ──► navegador
                                     scripts/build_sepa.py                public/data/*.json                     (búsqueda y plan)
                                                                                                                  │ solo direcciones,
                                                            Cloudflare Worker (worker/ + lib/) ◄──────────────────┘ rutas y dólar
                                                            OpenStreetMap (Nominatim, OSRM)
```

- `scripts/build_sepa.py` — baja el ZIP diario de SEPA (~300 MB), unifica códigos de barras, limpia nombres y agrupa los
  precios por provincia (mediana de las sucursales de cada cadena). Genera `meta.json`, `names.json`, `branches.json` y un
  `prices/AR-X.json` por provincia (unos 9 MB comprimidos en total; cada persona baja ~2 MB). Si el formato oficial cambia y los
  datos no pasan las validaciones, **falla** en vez de publicar datos rotos.
- `public/data.js` — carga esos archivos y hace la búsqueda en el navegador.
- `public/app.js` — la interfaz (HTML, CSS y JavaScript sin frameworks). Guarda todo en `localStorage`.
- `public/optimizer.js` — el optimizador del plan: función pura, con tests en `test/`.
- `lib/api.js`, `lib/geo.js` — la API mínima (direcciones, rutas y dólar), compartida entre el servidor local (`server.js`) y
  el Worker (`worker/index.mjs`). Los precios y las sucursales **no** pasan por ella.
- `public/consent.js` — consentimiento de privacidad: nada de terceros se carga sin permiso.

Decisiones sobre los datos: Carrefour Express queda afuera (sus precios y su ubicación no representan al resto de la
cadena), y de La Anónima solo entran los supermercados (no Topsy ni Bomba). Para sumar otra cadena de SEPA alcanza con
agregarla a `CHAINS` en `scripts/build_sepa.py`.

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
   El flujo `.github/workflows/pages.yml` publica la web con cada `git push` a `main` **y todos los días a las 14:30
   (hora argentina)**, cuando SEPA ya publicó los datos del día: descarga los datos, los procesa y despliega.
3. **Cerrar la API a tu web.** En `wrangler.toml` poné `ALLOWED_ORIGIN = "https://TU-USUARIO.github.io"` y volvé a
   ejecutar `npx wrangler deploy`.
4. *Opcional:* cargá los secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` para que la API se publique sola con
   cada push (`.github/workflows/worker.yml`).

Si la descarga de SEPA falla un día, la publicación se cancela y la web sigue con los datos del día anterior.

## Limitaciones

- Son precios de góndola informados por los comercios, agrupados por provincia: pueden diferir en tu sucursal, tu zona o
  tu medio de pago. La app muestra de qué día son.
- No incluyen promociones ni descuentos con tarjeta.
- SEPA publica un día por vez y no todos los productos de cada cadena figuran: el catálogo es más chico que el de sus webs
  (por ejemplo, Jumbo informa unos 10.700 productos).
- Cada cadena informa a su modo: algunos nombres vienen abreviados. La app elige el más completo.
- Las distancias por calle se calculan con OSRM (OpenStreetMap), que tiene límites de uso; si falla, se estiman.

## Uso responsable de los datos

Los precios y las sucursales son datos abiertos que el Estado publica con licencia **Creative Commons Atribución 4.0**.
Gondolar los modifica (agrupa por provincia, unifica códigos de barras y limpia nombres) y cita la fuente en la web y en
el aviso legal. Si sos titular de una marca o de un dato y querés que algo cambie o se quite, abrí un
[issue](https://github.com/fermanzolido/gondolar/issues).

Si forkeás el proyecto, mantené la atribución y respetá la [política de uso de OpenStreetMap](https://operations.osmfoundation.org/policies/).

## Privacidad

Sin cuentas, sin publicidad, sin métricas ni cookies de seguimiento. Tu lista, tus ajustes y tu ubicación se guardan
solo en tu navegador. Las tipografías (Google Fonts) y el mapa (Leaflet + OpenStreetMap) están apagados hasta que los
aceptás, y podés cambiarlo cuando quieras. Detalle completo, con qué recibe cada servicio y tus derechos, en el
[aviso legal y de privacidad](public/legal.html).

## Créditos

- Precios y sucursales: [Precios Claros – Base SEPA](https://datos.produccion.gob.ar/dataset/sepa-precios), Secretaría de
  Comercio de la Nación, licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.es). Datos modificados.
- Direcciones y rutas: © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright) (licencia ODbL).
- Mapa: [Leaflet](https://leafletjs.com) (BSD-2).
- Tipografías: Bricolage Grotesque, Instrument Sans e IBM Plex Mono (SIL Open Font License).

## Licencia

[MIT](LICENSE) © 2026 fermanzolido. El software se ofrece "tal cual", sin garantías.
