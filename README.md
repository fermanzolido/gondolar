# Cuánto Sale

Armá tu carrito, mirá en qué supermercado sale más barato cada producto y decidí dónde comprar
teniendo en cuenta el costo de ir (nafta + tiempo). Imprimí la lista de compras dividida por tienda.

## Cómo usarla

Requiere [Node.js](https://nodejs.org) 18 o superior. No hay dependencias que instalar.

- Doble clic en `iniciar.bat`, o
- `npm start` y abrir <http://localhost:3210>

1. **Buscar**: escribí un producto; ves el precio en cada tienda (con barras comparativas) y la diferencia
   contra la más barata. La lista de compras queda a la derecha (en el celular, en una barra inferior).
   Sobre los resultados hay filtros por **marca** y por **precio**, más orden (menor/mayor precio o mayor diferencia
   entre tiendas) y "Solo comparables" para ocultar marcas propias y productos de una sola tienda.
   Las marcas propias (Carrefour Classic, DIA, Coto, Check…) se marcan y no se buscan en otras cadenas.
2. **Mi compra**: agregá productos y cantidades. La app calcula el mejor plan.
3. **Viaje y tiendas**: elegí en qué tiendas comprás, cargá km y minutos a cada una, precio de la nafta,
   consumo del auto y cuánto vale tu hora. Si ya vas a ir a una tienda sí o sí, marcá "Voy sí o sí".
4. En **Mi compra** ves:
   - el **mejor plan** (productos + traslados) y cuánto ahorrás frente a comprar todo en una sola tienda,
   - la mejor opción según a **cuántas tiendas** quieras ir (1, 2, 3…),
   - **qué comprar en cada lugar**, y si **vale la pena** cada parada extra,
   - **Imprimir lista** (con casilleros para tildar) o **Copiar** (para mandar por WhatsApp).

## Publicarla gratis en internet (GitHub Pages + Cloudflare Workers)

La web (`public/`) se aloja en **GitHub Pages** y la API (`lib/api.js` + `worker/index.mjs`) corre en un
**Cloudflare Worker**. Los dos tienen plan gratuito y no piden tarjeta.

1. **API en Cloudflare.** Creá una cuenta gratis en cloudflare.com y, en esta carpeta:
   ```bash
   npx wrangler login
   npx wrangler deploy
   ```
   Al terminar te muestra una URL como `https://cuanto-sale-api.TU-SUBDOMINIO.workers.dev`.
2. **Web en GitHub Pages.** Subí el proyecto a un repositorio de GitHub. En *Settings → Pages* elegí
   *Source: GitHub Actions*. En *Settings → Secrets and variables → Actions → Variables* creá la variable
   `API_BASE` con la URL del paso 1. Cada `git push` a `main` publica la web (workflow `pages.yml`).
3. **Cerrar la API a tu web (recomendado).** En `wrangler.toml` poné `ALLOWED_ORIGIN = "https://TU-USUARIO.github.io"`
   y volvé a ejecutar `npx wrangler deploy`.
4. Opcional: para que la API también se publique sola con cada push, cargá los secrets `CLOUDFLARE_API_TOKEN` y
   `CLOUDFLARE_ACCOUNT_ID` (workflow `worker.yml`).

Límites del plan gratis de Cloudflare: 100.000 pedidos por día y 50 consultas externas por pedido; por eso la web
pide los precios en tandas de hasta 24 combinaciones producto x tienda. Los repositorios con Pages gratis son públicos.

`npm test` prueba el optimizador y el Worker (CORS, límites y rutas) sin usar internet.

## Ubicación y sucursales cercanas

En **Viaje y tiendas** cargás tu dirección o usás el GPS del navegador. La app:

1. busca la sucursal más cercana de cada cadena (datos de OpenStreetMap, hasta 30 km),
2. calcula la distancia y el tiempo en auto por calle (OSRM) y lo duplica por la vuelta,
3. suma el tiempo dentro del súper y completa sola los km, minutos y costo de viaje de cada tienda,
4. muestra todo en un mapa y agrega un botón **Cómo llegar** (Google Maps) en cada ticket de compra.

Si corregís km o minutos a mano, se respeta tu valor hasta que toques "usar el cálculo automático".

Privacidad: tu dirección se guarda solo en el navegador (localStorage). Para buscar sucursales y rutas se envía tu
ubicación redondeada (~100 m) a OpenStreetMap/OSRM; la dirección escrita se envía a Nominatim para geocodificarla.
El servidor local no guarda nada.

Limitaciones: OpenStreetMap puede no tener alguna sucursal (en ese caso cargás los km a mano) y a veces la más
cercana es un local chico (ej. Carrefour Express).

## Tiendas

Carrefour, Jumbo, Disco, Vea, Día, Changomás y Coto (activas por defecto). Cordiez y Josimar (regionales) se
activan en "Tiendas y viaje". Para sumar otra cadena VTEX, agregar una línea en `lib/stores.js`.

La Anónima no está: bloquea las consultas automáticas.

## Cómo funciona

- El mismo producto se identifica por **código de barras (EAN)**, así que se compara exactamente lo mismo
  en todas las tiendas. Los productos de marca propia (ej. "Carrefour Classic") suelen tener EAN interno y
  aparecen solo en su cadena.
- Un servidor local (`server.js`) consulta las webs públicas de cada cadena y guarda resultados en memoria
  (10 min búsquedas, 30 min precios). Los navegadores no pueden consultarlas directamente (CORS).
- `public/optimizer.js` prueba todas las combinaciones de tiendas y compra cada producto en la más barata
  de la combinación; elige la de menor costo total. Tests: `npm test`.
- El botón "Armar carrito en …" abre el sitio de la tienda con los productos ya cargados en su carrito
  (cadenas VTEX). El pago siempre lo hacés vos en la web de la tienda.

## Limitaciones

- Los precios son los que muestra la web por defecto; pueden variar según sucursal, zona o medio de pago.
- Las promos (2x1, 2da al 70%, etc.) no se descuentan del precio; se muestran como aviso en violeta/amarillo.
- Si una web cambia su estructura, el conector de esa tienda (`lib/fetchers.js`) puede necesitar un ajuste.
