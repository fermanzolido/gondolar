#!/usr/bin/env python3
"""
Convierte la base SEPA (Precios Claros, Secretaría de Comercio de la Nación) en archivos livianos para la web.

Fuente:   https://datos.produccion.gob.ar/dataset/sepa-precios   (licencia Creative Commons Atribución 4.0)
Entrada:  el ZIP diario (un ZIP por comercio adentro, con comercio.csv, sucursales.csv y productos.csv). El portal publica uno por día de la
          semana; algunos comercios no informan todos los días, así que si a un día le falta una cadena se la completa con los días anteriores
Salida:   <out>/meta.json, names.json, branches.json, prices/AR-X.json y promos/AR-X.json (uno por provincia)

Qué hace con los datos:
  * se queda con las cadenas que usa la app (ver CHAINS);
  * unifica los códigos de barras (quita ceros de relleno) para poder comparar el mismo producto entre cadenas;
  * agrupa los precios por provincia y cadena usando la mediana de sus sucursales (los precios cambian según la zona);
  * conserva las promociones vigentes que los comercios informan (precio promocional y leyenda), sin las vencidas.

Uso:
  python scripts/build_sepa.py --download --out public/data
  python scripts/build_sepa.py --zip sepa_martes.zip [--zip sepa_lunes.zip ...] --out public/data

Solo usa la librería estándar. Si el formato oficial cambia y los resultados no pasan las validaciones, termina con
error para que no se publiquen datos rotos.
"""
import argparse, collections, csv, datetime, io, json, os, re, shutil, statistics, sys, tempfile, time, unicodedata, urllib.request, zipfile

API = 'https://datos.produccion.gob.ar/api/3/action/package_show?id=sepa-precios'
UA = 'Gondolar/1.0 (+https://github.com/fermanzolido/gondolar; datos abiertos SEPA, uso sin fines de lucro)'

# Cadenas de la app. `cuit` identifica al comercio en SEPA; `banderas` filtra formatos (nombre de bandera en minúsculas).
# Carrefour Express queda afuera: sus precios y su distancia no representan a las demás bocas de la cadena.
CHAINS = [
    dict(id='carrefour', sigla='Ca', name='Carrefour', color='#2563eb', web='https://www.carrefour.com.ar', cuit='30687310434', excluir=('express',)),
    dict(id='jumbo', sigla='Ju', name='Jumbo', color='#16a34a', web='https://www.jumbo.com.ar', cuit='30590360763', incluir=('jumbo',)),
    dict(id='disco', sigla='Di', name='Disco', color='#9333ea', web='https://www.disco.com.ar', cuit='30590360763', incluir=('disco',)),
    dict(id='vea', sigla='Ve', name='Vea', color='#0891b2', web='https://www.vea.com.ar', cuit='30590360763', incluir=('vea',)),
    dict(id='dia', sigla='Dí', name='Día', color='#dc2626', web='https://www.supermercadosdia.com.ar', cuit='30685849751'),
    dict(id='changomas', sigla='Ch', name='Changomás', color='#ca8a04', web='https://www.masonline.com.ar', cuit='30678138300'),
    dict(id='coto', sigla='Co', name='Coto', color='#db2777', web='https://www.cotodigital.com.ar', cuit='30548083156'),
    dict(id='laanonima', sigla='La', name='La Anónima', color='#ea580c', web='https://www.laanonima.com.ar', cuit='30506730038', incluir=('la anonima',)),
    # Cadenas regionales: si un día no vienen bien en SEPA se omiten (con un aviso) en vez de frenar la publicación.
    dict(id='toledo', regional=True, sigla='To', name='Toledo', color='#0f766e', web='https://www.supertoledo.com', cuit='30551497492',
         requerida=False, min_suc=10, min_eans=2000),
    dict(id='marianomax', regional=True, sigla='MM', name='Mariano Max', color='#a21caf', web='https://www.mmax.com.ar', cuit='30616491780',
         requerida=False, min_suc=5, min_eans=2000),
    dict(id='unicoop', regional=True, sigla='Un', name='Unicoop', color='#475569', web='https://www.lacooperativa.com.ar', cuit='33529300099',
         requerida=False, min_suc=1, min_eans=2000),
    dict(id='california', regional=True, sigla='Cs', name='California', color='#be123c', web='https://www.californiasa.com.ar', cuit='30539523410',
         requerida=False, min_suc=3, min_eans=1000),
    dict(id='comodin', regional=True, sigla='Cm', name='Comodín', color='#92400e', web='https://www.supermercadoscomodin.com', cuit='30578411174',
         requerida=False, min_suc=1, min_eans=300),
    dict(id='coopobrera', regional=True, sigla='Ob', name='Cooperativa Obrera', color='#4d7c0f', web='https://www.cooperativaobrera.coop', cuit='30525705931',
         requerida=False, min_suc=20, min_eans=3000),
    dict(id='lar', regional=True, sigla='LAR', name='La Agrícola Regional', color='#0e7490', web='https://www.lar.coop', cuit='33504047089',
         requerida=False, min_suc=2, min_eans=1000),
    # Farmacia (no es un supermercado): viene apagada por defecto en la app.
    dict(id='farmacity', sigla='Fa', name='Farmacity', color='#0284c7', web='https://www.farmacity.com', cuit='30692138747',
         requerida=False, optativa=True, min_suc=50, min_eans=1000),
]
PROVINCIAS = {
    'AR-A': 'Salta', 'AR-B': 'Buenos Aires', 'AR-C': 'Ciudad de Buenos Aires', 'AR-D': 'San Luis', 'AR-E': 'Entre Ríos',
    'AR-F': 'La Rioja', 'AR-G': 'Santiago del Estero', 'AR-H': 'Chaco', 'AR-J': 'San Juan', 'AR-K': 'Catamarca',
    'AR-L': 'La Pampa', 'AR-M': 'Mendoza', 'AR-N': 'Misiones', 'AR-P': 'Formosa', 'AR-Q': 'Neuquén', 'AR-R': 'Río Negro',
    'AR-S': 'Santa Fe', 'AR-T': 'Tucumán', 'AR-U': 'Chubut', 'AR-V': 'Tierra del Fuego', 'AR-W': 'Corrientes',
    'AR-X': 'Córdoba', 'AR-Y': 'Jujuy', 'AR-Z': 'Santa Cruz',
}
# Validaciones mínimas: protegen de publicar datos vacíos o mal leídos si SEPA cambia el formato.
MIN_SUCURSALES_POR_CADENA = 10
MIN_EANS_POR_CADENA = 3000
MIN_EANS_TOTAL = 40000
# Una cadena regional cuyo comercio informa una última actualización de hace más de esto se omite: sus precios están viejos
# (Unicoop informaba junio de 2025 y sus precios eran 20-30% más bajos que los de todas las demás). Solo se aplica a las
# regionales: Changomás informa fechas de 2017, pero sus precios son actuales.
MAX_DIAS_SIN_ACTUALIZAR = 45
# Cuántos días anteriores se pueden leer para completar las cadenas que no informaron en el día más reciente.
MAX_DIAS_ATRAS = 4
if os.environ.get("SEPA_RELAX"):  # solo para las pruebas con datos de juguete
    MIN_SUCURSALES_POR_CADENA = MIN_EANS_POR_CADENA = MIN_EANS_TOTAL = 0



def check_chains(chains, n_suc, seen, ultima=None, fecha=None):
    """Devuelve (ids que pasan, problemas de cadenas requeridas, avisos de cadenas opcionales que se omiten).

    `ultima` (id de cadena -> 'AAAA-MM-DD') y `fecha` (día de los datos) permiten descartar regionales con datos viejos."""
    ok, problemas, avisos = [], [], []
    for c in chains:
        cid = c['id']
        fallas = []
        if ultima and fecha and ultima.get(cid):
            try:
                dias = (datetime.date.fromisoformat(fecha) - datetime.date.fromisoformat(ultima[cid])).days
            except ValueError:
                dias = 0
            if dias > MAX_DIAS_SIN_ACTUALIZAR:
                if c.get('requerida', True):
                    avisos.append(f"{cid}: informa una última actualización de hace {dias} días ({ultima[cid]}), pero se mantiene por ser una cadena principal")
                else:
                    fallas.append(f'datos desactualizados (última actualización informada: {ultima[cid]})')
        if n_suc[cid] < c.get('min_suc', MIN_SUCURSALES_POR_CADENA):
            fallas.append(f'solo {n_suc[cid]} sucursales')
        if len(seen[cid]) < c.get('min_eans', MIN_EANS_POR_CADENA):
            fallas.append(f'solo {len(seen[cid])} productos')
        if not fallas:
            ok.append(cid)
        elif c.get('requerida', True):
            problemas.append(f'{cid}: ' + ' y '.join(fallas))
        else:
            avisos.append(f'{cid}: ' + ' y '.join(fallas) + ' -> se omite en esta publicación')
    return ok, problemas, avisos


csv.field_size_limit(10 ** 8)
BOM = bytes([0xEF, 0xBB, 0xBF])


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def dec(b):
    b = b[3:] if b[:3] == BOM else b
    try:
        return b.decode('utf-8')
    except UnicodeDecodeError:
        return b.decode('cp1252', errors='replace')


def rows(z, name):
    """Filas de un CSV de SEPA (separador '|'). Ignora líneas sueltas al final que no tienen todas las columnas."""
    rd = csv.reader(io.StringIO(dec(z.read(name))), delimiter='|')
    header = next(rd)
    for r in rd:
        if r and len(r) == len(header):
            yield dict(zip(header, r))


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    return urllib.request.urlopen(req, timeout=120)


def list_zips():
    """ZIP diarios del portal (hay uno por día de la semana), del más reciente al más viejo."""
    log('Consultando el catálogo oficial…')
    pkg = json.load(get(API))['result']
    lic = pkg.get('license_title') or pkg.get('license_id')
    zips = [r for r in pkg['resources'] if (r.get('format') or '').upper() == 'ZIP']
    zips.sort(key=lambda r: r.get('last_modified') or r.get('created') or '', reverse=True)
    log('Licencia de los datos:', lic)
    return ordenar_por_dia(zips)


DIAS_SEMANA = {'lunes': 0, 'martes': 1, 'miercoles': 2, 'jueves': 3, 'viernes': 4, 'sabado': 5, 'domingo': 6}


def dia_semana(recurso):
    nombre = unicodedata.normalize('NFD', recurso.get('name') or '')
    nombre = ''.join(c for c in nombre if unicodedata.category(c) != 'Mn').strip().lower()
    return DIAS_SEMANA.get(nombre)


def ordenar_por_dia(zips):
    """El primero (el más recientemente publicado) queda primero; los demás, del día anterior hacia atrás. El portal guarda un ZIP por
    día de la semana, pero a veces vuelve a subir uno viejo, así que la fecha de modificación no sirve para saber cuál es más reciente."""
    if not zips or dia_semana(zips[0]) is None or any(dia_semana(r) is None for r in zips):
        return zips
    w = dia_semana(zips[0])
    return [zips[0]] + sorted(zips[1:], key=lambda r: (w - dia_semana(r)) % 7)


def download(res, dest):
    log(f"Descargando «{res['name']}» (actualizado {res.get('last_modified')})")
    for attempt in range(3):
        try:
            with get(res['url']) as resp, open(dest, 'wb') as f:
                shutil.copyfileobj(resp, f, 1 << 20)
            return
        except Exception as e:  # reintenta ante cortes de red
            log('  falló la descarga:', e)
            time.sleep(5 * (attempt + 1))
    sys.exit('No se pudo descargar el archivo de SEPA')


def zip_fecha(outer):
    """Día de los datos de un ZIP diario (viene en el nombre de su carpeta)."""
    m = re.search(r'(\d{4}-\d{2}-\d{2})/', ' '.join(outer.namelist()))
    return m.group(1) if m else time.strftime('%Y-%m-%d')


# ---- limpieza de nombres ----
UNITS = {'gr': 'gr', 'grs': 'gr', 'grm': 'gr', 'g': 'g', 'grms': 'gr', 'kgs': 'kg', 'mls': 'ml', 'lts': 'l', 'ltrs': 'l', 'cm': 'cm', 'kg': 'kg', 'kgm': 'kg', 'ml': 'ml', 'mlt': 'ml', 'cc': 'cc', 'cm3': 'cm3',
         'lt': 'l', 'lts': 'l', 'ltr': 'l', 'l': 'l', 'un': 'un', 'u': 'u', 'x': 'x', 'mg': 'mg', 'mts': 'm', 'm': 'm'}
KEEP_UPPER = {'UHT', 'PET', 'LED', 'USB', 'SPF', 'UV', 'TV', 'HD', 'GB', 'MB', 'SD', 'DVD', 'CD', 'PVC', 'EVA', 'XL', 'XXL', 'ML', 'II', 'III'}
UNIT_NAMES = {'grm': 'gr', 'kgm': 'kg', 'ltr': 'l', 'mlt': 'ml', 'cm3': 'ml', 'cmq': 'cm2', 'mtr': 'm', 'unidad': 'un', 'un': 'un', 'unid': 'un', 'uni': 'un', 'ea': 'un', 'unidades': 'un'}


def pretty(s):
    s = re.sub(r'\s+', ' ', s or '').strip()
    letters = [c for c in s if c.isalpha()]
    if not letters or sum(c.isupper() for c in letters) / len(letters) < 0.6:
        return s  # ya viene en minúsculas/mixto: se respeta

    def fix(m):
        w = m.group()
        lw = w.lower()
        if lw in UNITS:
            return UNITS[lw]
        if w in KEEP_UPPER:
            return w
        return lw.capitalize() if not w.isdigit() else w
    return re.sub(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+", fix, s)


# ---- promociones ----
# SEPA informa hasta dos promociones por producto (precio + leyenda). Solo se aplican solas las que valen para cualquiera que
# compre una unidad; las que piden un medio de pago o comprar varias unidades se muestran como aviso.
PROMO_DIRECTA, PROMO_MEDIO, PROMO_CANTIDAD = 0, 1, 2
RE_FECHA = re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})')
RE_CANTIDAD = re.compile(r'llevando|\d\s*x\s*[$\d]|\d\s*(?:do|da|ra|er|ta|to)\s*al\s*\d|unidades|segunda unidad|2da|2do|combo|pack')
RE_MEDIO = re.compile(r'banco|tarjeta|visa|master|amex|cabal|naranja|\bmodo\b|mercado ?pago|cuenta dni|debito|credito|jubilad|billetera|cuotas|\bclub\b|\bapp\b|socios?')


def _sin_acentos(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').lower()


def parse_promo(lista, precio, leyenda, hoy):
    """Interpreta una promoción de SEPA. Devuelve None (sin promoción, vencida o que no baja el precio) o
    dict(price, pct, hasta 'AAAA-MM-DD' o '', kind, texto). `hoy` es la fecha de los datos (datetime.date)."""
    try:
        promo, base = float(precio), float(lista)
    except (TypeError, ValueError):
        return None
    if not (0 < promo < base * 0.98):   # descuentos de menos de 2% no se muestran (suelen ser redondeos)
        return None
    texto = re.sub(r'\s+', ' ', leyenda or '').strip()
    fechas = []
    for d, m, y in RE_FECHA.findall(texto):
        try:
            fechas.append(datetime.date(int(y) + (2000 if int(y) < 100 else 0), int(m), int(d)))
        except ValueError:
            pass
    desde = hasta = None
    if len(fechas) >= 2:
        desde, hasta = min(fechas), max(fechas)
    elif len(fechas) == 1:
        if re.search(r'hasta[^\d]{0,15}\d', _sin_acentos(texto)):
            hasta = fechas[0]
        else:
            desde = fechas[0]
    if hasta and hoy > hasta:
        return None   # vencida
    if desde and desde > hoy:
        return None   # todavía no empezó
    t = _sin_acentos(texto)
    if RE_CANTIDAD.search(t):
        kind = PROMO_CANTIDAD
    elif RE_MEDIO.search(t.replace('cualquier medio de pago', '')):
        kind = PROMO_MEDIO
    else:
        kind = PROMO_DIRECTA
    return dict(price=round(promo), pct=round((1 - promo / base) * 100), hasta=hasta.isoformat() if hasta else '', kind=kind,
                texto=texto.split(' - Vigencia')[0].split(' - Stock')[0][:120])


def quantity(cant, unidad):
    try:
        n = float(cant.replace(',', '.'))
    except ValueError:
        return ''
    if n <= 0:
        return ''
    u = UNIT_NAMES.get((unidad or '').strip().lower(), (unidad or '').strip().lower())
    if u == 'un' and n == 1:
        return ''  # "1 unidad" no aporta nada
    return f"{int(n) if n == int(n) else n} {u}".strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', action='append', help='ZIP de SEPA ya descargado. Se puede repetir: el primero es el principal y los demás (de días '
                    'anteriores) solo completan las cadenas que el principal no trae')
    ap.add_argument('--download', action='store_true', help='baja el ZIP más reciente del portal oficial (y días anteriores si falta alguna cadena)')
    ap.add_argument('--out', required=True, help='carpeta de salida (p. ej. public/data)')
    args = ap.parse_args()
    if not args.zip and not args.download:
        ap.error('indicá --zip o --download')

    t0 = time.time()
    tmp = None
    if args.download:
        tmp = tempfile.mkdtemp(prefix='sepa_')
        recursos = list_zips()
        if not recursos:
            sys.exit('El catálogo oficial no tiene archivos ZIP')
        n_fuentes = min(len(recursos), 1 + MAX_DIAS_ATRAS)

        def abrir(i):
            dest = os.path.join(tmp, f'sepa_{i}.zip')
            download(recursos[i], dest)
            return zipfile.ZipFile(dest)
    else:
        n_fuentes = len(args.zip)

        def abrir(i):
            return zipfile.ZipFile(args.zip[i])

    order = [c['id'] for c in CHAINS]
    by_cuit = collections.defaultdict(list)
    for c in CHAINS:
        by_cuit[c['cuit']].append(c)

    prices = collections.defaultdict(list)                      # (prov, cadena, ean) -> precios
    promos = collections.defaultdict(list)                      # (prov, cadena, ean) -> promociones vigentes (una por sucursal y promo)
    names = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))  # ean -> cadena -> Counter((desc, marca, cantidad))
    branches = []
    n_suc = collections.Counter(); n_suc_prov = collections.defaultdict(collections.Counter)
    filas = collections.Counter()
    ultima = {}   # cadena -> última actualización que informa su comercio (AAAA-MM-DD)
    fecha = hoy = None

    def process(outer, wanted):
        """Lee los comercios de un ZIP diario (solo los CUIT de `wanted`) y devuelve los CUIT que encontró."""
        encontrados = set()
        for info in outer.infolist():
            if not info.filename.endswith('.zip') or info.file_size == 0:
                continue  # SEPA a veces incluye ZIP vacíos
            try:
                z = zipfile.ZipFile(io.BytesIO(outer.read(info.filename)))
                comercio = list(rows(z, 'comercio.csv'))
            except Exception as e:
                log('  se omite', info.filename, '->', e)
                continue
            if not comercio:
                continue
            cuit = comercio[0].get('comercio_cuit', '').strip()
            chains = by_cuit.get(cuit)
            if not chains or cuit not in wanted:
                continue  # comercio que la app no usa (o que ya se leyó de otro día)
            bandera_nombre = {r['id_bandera']: r['comercio_bandera_nombre'].strip().lower() for r in comercio}

            def chain_for(band):
                nombre = bandera_nombre.get(band, '')
                for c in chains:
                    if 'incluir' in c and not any(k in nombre for k in c['incluir']):
                        continue
                    if any(k in nombre for k in c.get('excluir', ())):
                        continue
                    return c['id']
                return None

            for r in comercio:
                ch_r = chain_for(r['id_bandera'])
                dia = r.get('comercio_ultima_actualizacion', '')[:10]
                if ch_r and dia and dia > ultima.get(ch_r, ''):
                    ultima[ch_r] = dia

            branch_prov = {}
            for d in rows(z, 'sucursales.csv'):
                ch = chain_for(d['id_bandera'])
                if not ch:
                    continue
                prov = d['sucursales_provincia'].strip()
                prov = prov if prov in PROVINCIAS else ''
                branch_prov[(d['id_bandera'], d['id_sucursal'])] = prov
                n_suc[ch] += 1
                n_suc_prov[prov][ch] += 1
                try:
                    lat, lon = round(float(d['sucursales_latitud']), 5), round(float(d['sucursales_longitud']), 5)
                except ValueError:
                    lat = lon = None
                if lat is not None and not (-56 < lat < -21 and -74 < lon < -52):
                    lat = lon = None  # coordenadas fuera de Argentina: se descartan
                if d['sucursales_tipo'].strip().lower() == 'web':
                    continue  # depósito de ventas online: no es un local al que se pueda ir (sus precios sí cuentan)
                calle = f"{d['sucursales_calle'].strip()} {d['sucursales_numero'].strip()}".strip()
                branches.append([order.index(ch), d['id_sucursal'], pretty(d['sucursales_nombre']), pretty(calle),
                                 pretty(d['sucursales_localidad']), prov, lat, lon, d['sucursales_tipo'].strip()])

            for d in rows(z, 'productos.csv'):
                ch = chain_for(d['id_bandera'])
                if not ch or d['productos_ean'] != '1':
                    continue
                ean = d['id_producto'].strip().lstrip('0')  # SEPA rellena con ceros; se unifica el código
                if not (ean.isdigit() and 8 <= len(ean) <= 14):
                    continue
                try:
                    p = float(d['productos_precio_lista'])
                except ValueError:
                    continue
                if not (0 < p < 1e8):
                    continue
                prov = branch_prov.get((d['id_bandera'], d['id_sucursal']), '')
                if not prov:
                    continue
                filas[ch] += 1
                prices[(prov, ch, ean)].append(p)
                for k in ('1', '2'):
                    pr = parse_promo(d['productos_precio_lista'], d.get('productos_precio_unitario_promo' + k), d.get('productos_leyenda_promo' + k), hoy)
                    if pr:
                        promos[(prov, ch, ean)].append(pr)
                names[ean][ch][(d['productos_descripcion'].strip(), d['productos_marca'].strip(),
                                quantity(d['productos_cantidad_presentacion'], d['productos_unidad_medida_presentacion']))] += 1
            encontrados.add(cuit)
            log(f'  {cuit} listo ({time.time() - t0:.0f}s)')

        return encontrados

    # Cada comercio informa cuando puede: algunos no están en el ZIP de ciertos días (Cooperativa Obrera los martes, Farmacity los jueves,
    # La Agrícola Regional de domingo a martes). Se lee el ZIP más reciente y, solo si falta alguna cadena, los de los días anteriores.
    faltan = set(by_cuit)
    fecha_cuit = {}   # CUIT -> día de los datos de donde salió
    for i in range(n_fuentes):
        if not faltan:
            break
        outer = abrir(i)
        dia = zip_fecha(outer)
        if i == 0:
            fecha, hoy = dia, datetime.date.fromisoformat(dia)
            log('Datos de SEPA del', fecha)
        else:
            log(f'Completando con el ZIP del {dia}: {len(faltan)} comercio(s) no informaron en el día más reciente')
        for cuit in process(outer, set(faltan)):
            faltan.discard(cuit)
            fecha_cuit[cuit] = dia
        outer.close()
    chain_fecha = {c['id']: fecha_cuit.get(c['cuit']) for c in CHAINS}

    # ---- validaciones ----
    seen = {ch: set() for ch in order}
    for (prov, ch, ean) in prices:
        seen[ch].add(ean)
    keep, problemas, avisos = check_chains(CHAINS, n_suc, seen, ultima, fecha)
    for a in avisos:
        log('AVISO:', a)
    total_eans = len({e for ch in keep for e in seen[ch]})
    if total_eans < MIN_EANS_TOTAL:
        problemas.append(f'solo {total_eans} productos en total')
    if problemas:
        sys.exit('Los datos no pasan las validaciones (¿cambió el formato de SEPA?): ' + '; '.join(problemas))

    # ---- salida ----
    out = args.out
    os.makedirs(os.path.join(out, 'prices'), exist_ok=True)
    for f in os.listdir(os.path.join(out, 'prices')):
        os.remove(os.path.join(out, 'prices', f))

    def dump(path, obj):
        with open(os.path.join(out, path), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))

    idx = {ch: i for i, ch in enumerate(keep)}   # posición de cada cadena en los archivos de salida
    branches = [[idx[order[b[0]]]] + b[1:] for b in branches if order[b[0]] in idx]
    tables = collections.defaultdict(dict)
    for (prov, ch, ean), ps in prices.items():
        if ch not in idx:
            continue
        row = tables[prov].setdefault(ean, [None] * len(keep))
        row[idx[ch]] = round(statistics.median(ps))
    for prov, t in tables.items():
        dump(f'prices/{prov}.json', t)

    # Promociones: por provincia, cadena y producto se guardan hasta dos (la directa más barata y otra que pide algo: medio de pago
    # o cantidad). frac = en qué porcentaje de las sucursales de la cadena en esa provincia figura. Los textos se guardan una sola vez.
    os.makedirs(os.path.join(out, 'promos'), exist_ok=True)
    for f in os.listdir(os.path.join(out, 'promos')):
        os.remove(os.path.join(out, 'promos', f))
    por_prov = collections.defaultdict(dict)
    textos = {}
    n_promos = 0
    for (prov, ch, ean), lst in promos.items():
        if ch not in idx or prov not in tables:
            continue
        total = len(prices[(prov, ch, ean)])
        grupos = collections.defaultdict(list)
        for pr in lst:
            grupos[(pr['kind'], pr['texto'], pr['hasta'])].append(pr)
        elegidos = []
        directas = [g for g in grupos.items() if g[0][0] == PROMO_DIRECTA]
        otras = [g for g in grupos.items() if g[0][0] != PROMO_DIRECTA]
        if directas:
            elegidos.append(min(directas, key=lambda g: (statistics.median(x['price'] for x in g[1]), -len(g[1]))))
        if otras:
            elegidos.append(max(otras, key=lambda g: len(g[1])))
        for (kind, texto, hasta), g in elegidos:
            ti = textos.setdefault(texto, len(textos))
            frac = min(100, max(1, round(100 * len(g) / max(total, 1))))
            por_prov[prov].setdefault(ean, []).append([idx[ch], round(statistics.median(x['price'] for x in g)),
                                                       round(statistics.median(x['pct'] for x in g)), hasta, kind, ti, frac])
            n_promos += 1
    lista_textos = [t for t, _ in sorted(textos.items(), key=lambda kv: kv[1])]
    for prov in tables:
        dump(f'promos/{prov}.json', {'t': lista_textos, 'p': por_prov.get(prov, {})})

    # Cada cadena vota una vez con su variante más usada (así una cadena con muchas sucursales no impone sus nombres
    # abreviados). Entre las cadenas se prefiere el nombre más completo y la marca más repetida.
    nombres = {}
    for ean, por_cadena in names.items():
        variantes = [cnt.most_common(1)[0][0] for cnt in por_cadena.values()]
        desc = max((v[0] for v in variantes if len(v[0]) <= 100), key=len, default=variantes[0][0])
        marcas = collections.Counter(v[1] for v in variantes if v[1] and v[1].upper() not in ('S/D', 'SIN MARCA', 'S/M'))
        marca = max(marcas.items(), key=lambda kv: (kv[1], len(kv[0])))[0] if marcas else ''
        cants = collections.Counter(v[2] for v in variantes if v[2])
        cant = cants.most_common(1)[0][0] if cants else ''
        nombres[ean] = (pretty(desc), pretty(marca), cant)
    con_precio = {e for t in tables.values() for e in t}
    eans = sorted(e for e in nombres if e in con_precio)
    dump('names.json', {'e': eans, 'n': [nombres[e][0] for e in eans], 'm': [nombres[e][1] for e in eans], 'q': [nombres[e][2] for e in eans]})
    dump('branches.json', branches)
    dump('meta.json', {
        'v': 1, 'fecha': fecha, 'generado': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'fuente': 'Precios Claros – Base SEPA. Secretaría de Comercio de la Nación (datos.produccion.gob.ar)',
        'licencia': 'Creative Commons Atribución 4.0', 'productos': len(eans), 'promos': n_promos,
        'cadenas': [dict({k: c[k] for k in ('id', 'sigla', 'name', 'color', 'web')}, **{k: True for k in ('optativa', 'regional') if c.get(k)},
                         **({'fecha': chain_fecha[c['id']]} if chain_fecha.get(c['id']) and chain_fecha[c['id']] != fecha else {}))
                    for c in CHAINS if c['id'] in idx],
        'provincias': {p: {'nombre': PROVINCIAS[p], 'productos': len(tables[p]),
                           'sucursales': {ch: n for ch, n in n_suc_prov[p].items() if ch in idx}} for p in sorted(tables)},
    })
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
    log(f'Listo en {time.time() - t0:.0f}s: {len(eans)} productos, {len(branches)} sucursales, '
        f'{len(tables)} provincias, {total / 1048576:.1f} MB sin comprimir -> {out}')
    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
