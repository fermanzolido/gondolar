# Gondolar

Comparador de precios de supermercados argentinos con **datos abiertos oficiales**. Armás tu lista, y la app te dice
**en qué súper conviene comprar cada cosa**, teniendo en cuenta lo que cuesta ir hasta cada uno (nafta y tiempo). Al final
imprimís la lista dividida por tienda.

**[Probarlo online →](https://fermanzolido.github.io/gondolar/)** · Gratis, sin cuentas, sin publicidad.

> Proyecto personal e independiente. No tiene relación con ninguna cadena de supermercados.
> Los precios son orientativos. Ver el [aviso legal y de privacidad](public/legal.html).

## Qué hace

- **Compara hasta 13 cadenas:** Carrefour, Jumbo, Disco, Vea, Día, Changomás, Coto y La Anónima (todo el país), más las regionales
  Toledo (Mar del Plata), Mariano Max (Córdoba), California (Misiones) y Comodín (Jujuy), y Farmacity como cadena opcional
  (es una farmacia, viene apagada). Las regionales se prenden solas si tienen una sucursal cerca de tu ubicación.
- **Usa la base oficial SEPA** ([Precios Claros](https://datos.produccion.gob.ar/dataset/sepa-precios), Secretaría de Comercio
  de la Nación): precios que los comercios informan al Estado, actualizados todos los días. **No consulta los sitios de los
  supermercados.**
- **Encuentra el mismo producto en todas** con el código de barras (EAN), así se compara exactamente lo mismo.
- **Precios de tu provincia:** el precio de un mismo producto cambia según la zona (hasta 44% entre sucursales de una
  cadena). Se elige la provincia, o se completa sola al cargar tu ubicación.
- **Elegís dónde comprar cada cosa:** por defecto el botón verde agrega el producto donde sale más barato, pero con el **+** de
  cualquier tienda lo agregás para comprarlo ahí (o lo cambiás después con "Comprar en" en tu lista). El plan respeta tu
  elección, suma esa tienda al recorrido y te muestra cuánto más barato estaría en otro lado.
- **Filtros** por marca y precio, más orden por precio o por mayor diferencia entre tiendas. "Solo comparables" oculta las
  marcas propias, que solo se venden en su cadena (Carrefour Classic, Día, Coto…).
- **Promociones:** los precios incluyen las promociones vigentes que los comercios informan a SEPA (con una etiqueta de
  descuento; hay un interruptor para apagarlas). Las que piden un medio de pago o comprar varias unidades se marcan pero no
  se restan. Aparte, la sección *Promos de bancos y billeteras* del plan estima cuánto ahorrás en cada tienda según con qué
  pagues y qué día vayas (tope y compra mínima incluidos).
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
SEPA (datos.produccion.gob.ar) ──► tu compu con IP argentina, 1 vez por día ──► release "datos" de GitHub ──► GitHub Pages ──► navegador
                                        scripts/publish_datos.py                  datos.tar.gz             public/data/*.json   (búsqueda y plan)
                                                                                                                                  │ solo direcciones,
                                                                    Cloudflare Worker (worker/ + lib/) ◄──────────────────────────┘ rutas y dólar
                                                                    OpenStreetMap (Nominatim, OSRM)
```

- `scripts/publish_datos.py` — corre `build_sepa.py`, sube el resultado como adjunto del release `datos` y le pide a GitHub
  Actions que republique la web. Se corre **desde una computadora con IP argentina** (ver más abajo por qué).
- `scripts/build_sepa.py` — baja el ZIP diario de SEPA (~300 MB), unifica códigos de barras, limpia nombres y agrupa los
  precios por provincia (mediana de las sucursales de cada cadena). Genera `meta.json`, `names.json`, `branches.json` y un
  `prices/AR-X.json` por provincia (unos 9 MB comprimidos en total; cada persona baja ~2 MB). Si el formato oficial cambia y los
  datos no pasan las validaciones, **falla** en vez de publicar datos rotos.
- `public/data.js` — carga esos archivos y hace la búsqueda en el navegador.
- `public/app.js` — la interfaz (HTML, CSS y JavaScript sin frameworks). Guarda todo en `localStorage`.
- `public/optimizer.js` — el optimizador del plan: función pura, con tests en `test/`.
- `public/bank.js` y `public/promos-bancos.json` — cálculo de las promos de bancos y billeteras y su archivo de datos. Para
  renovarlo cada mes: editá el JSON (`desde`, `hasta`, porcentaje, tope, días y fuentes de cada promo) y corré `npm test`, que
  valida el formato.
- `lib/api.js`, `lib/geo.js` — la API mínima (direcciones, rutas y dólar), compartida entre el servidor local (`server.js`) y
  el Worker (`worker/index.mjs`). Los precios y las sucursales **no** pasan por ella.
- `public/consent.js` — consentimiento de privacidad: nada de terceros se carga sin permiso.

Decisiones sobre los datos: una cadena regional se omite sola si su comercio informa una última actualización de hace más de
45 días (hoy le pasa a **Unicoop**, que informa junio de 2025: sus precios salen 20-30% más bajos que los de todas las demás en
cada categoría, y volvería sola cuando actualice); Carrefour Express queda afuera (sus precios y su ubicación no representan al resto de la
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
   El flujo `.github/workflows/pages.yml` publica la web con cada `git push` a `main` y cada vez que se actualizan los datos:
   trae el paquete de precios del release `datos`, corre las pruebas y despliega.
3. **Cerrar la API a tu web.** En `wrangler.toml` poné `ALLOWED_ORIGIN = "https://TU-USUARIO.github.io"` y volvé a
   ejecutar `npx wrangler deploy`.
4. *Opcional:* cargá los secrets `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` para que la API se publique sola con
   cada push (`.github/workflows/worker.yml`).

5. **Datos de precios (una vez por día).** El portal oficial de datos abiertos **rechaza con error 403 las conexiones que llegan
   desde los servidores de GitHub** (salen desde Estados Unidos), así que los datos se procesan desde una computadora con IP
   argentina. Con la sesión de `gh` iniciada:
   ```bash
   npm run publicar-datos     # descarga SEPA, lo procesa, lo sube al release "datos" y republica la web
   ```
   SEPA publica los datos del día alrededor de las 13:20 (hora argentina). Para automatizarlo en Windows, creá una tarea
   programada que ejecute `scriptsactualizar-datos.bat` (deja un registro en `%LOCALAPPDATA%Gondolarpublicar-datos.log`).
   Desde PowerShell, oculta y a las 14:30 (se pone al día si la computadora estaba apagada):
   ```powershell
   $bat = (Resolve-Path scriptsactualizar-datos.bat).Path
   $accion = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$bat`"" -WorkingDirectory (Get-Location).Path
   $ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
   Register-ScheduledTask -TaskName 'Gondolar - actualizar datos' -Action $accion -Trigger (New-ScheduledTaskTrigger -Daily -At '14:30') -Settings $ajustes
   ```
   Si un día no se actualiza (computadora apagada, error de descarga), la web sigue funcionando con los datos anteriores y
   muestra de qué día son.

## Limitaciones

- Son precios de góndola informados por los comercios, agrupados por provincia: pueden diferir en tu sucursal, tu zona o
  tu medio de pago. La app muestra de qué día son.
- Solo cuatro cadenas informan promociones a SEPA (Carrefour, Día, La Anónima y, muy pocas, Coto); las de Jumbo, Disco, Vea y
  Changomás no vienen en los datos oficiales, así que sus precios son de lista.
- Las promociones de bancos y billeteras **no son datos oficiales**: se cargan a mano una vez por mes en
  `public/promos-bancos.json` a partir de notas de prensa y hay que revisarlas y renovarlas. Cuando vencen dejan de mostrarse.
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
