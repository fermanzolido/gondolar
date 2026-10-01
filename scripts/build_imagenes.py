#!/usr/bin/env python3
"""
Arma el índice de fotos de productos a partir de Open Food Facts (https://world.openfoodfacts.org).

Por qué así: las fotos de los supermercados son de ellos (derechos de autor y términos de sus sitios), así que Gondolar no las usa.
Open Food Facts es una base colaborativa y abierta de productos con código de barras; sus fotos se publican con licencia
Creative Commons Atribución-CompartirIgual 3.0 (CC BY-SA 3.0). Esta herramienta NO baja las fotos: solo anota, para cada código de barras
de los productos de la app, en qué dirección de images.openfoodfacts.org está la foto, y la web la muestra desde ahí (si la persona lo permite).

Fuente:   volcado oficial en CSV https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz (~1,3 GB; la recomendación de
          Open Food Facts para uso masivo es usar el volcado y no consultar su API producto por producto)
Entrada:  --names  <carpeta>/names.json (los códigos de barras de la app, que genera build_sepa.py)
Salida:   <out>/imagenes.json   {"v":1, "generado":..., "i": {"<ean>": "front_es.93" | "779/089/500/0997/front_es.93", ...}}
          y le agrega a <out>/meta.json el campo "imagenes" (cantidad), para que la web sepa que hay fotos.
          La dirección de la foto es https://images.openfoodfacts.org/images/products/<carpeta>/<archivo>.200.jpg, donde <carpeta> sale del
          código de barras (779/089/500/0997) y, cuando no se puede deducir, viene completa en el índice.

El índice se renueva una vez por mes (--baseline + --max-age-days): el resto de los días se reutiliza el último publicado.

Uso:
  python scripts/build_imagenes.py --names public/data/names.json --out public/data
  python scripts/build_imagenes.py --names public/data/names.json --out public/data --baseline https://gondolar.com.ar/data/imagenes.json
  python scripts/build_imagenes.py --names ... --out ... --csv en.openfoodfacts.org.products.csv.gz     # archivo ya descargado

Solo usa la librería estándar. Si el formato cambia y no se encuentra casi nada, termina con error sin tocar el índice anterior.
"""
import argparse, datetime, gzip, io, json, os, re, shutil, sys, time, urllib.request

CSV_URL = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz'
UA = 'Gondolar/1.0 (https://gondolar.com.ar; https://github.com/fermanzolido/gondolar; uso de fotos con licencia CC BY-SA)'
IMG_BASE = 'https://images.openfoodfacts.org/images/products/'
MIN_FOTOS = 300            # menos que esto significa que algo cambió en el formato: no se publica
FOTO_RE = re.compile(r'^' + re.escape(IMG_BASE) + r'(?P<ruta>[0-9A-Za-z/_.-]+)\.200\.jpg$')


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def carpeta(ean):
    """Carpeta de Open Food Facts de un código de 13 dígitos: 7790895000997 -> 779/089/500/0997. Otros largos: no se deduce."""
    if len(ean) == 13 and ean.isdigit():
        return f'{ean[0:3]}/{ean[3:6]}/{ean[6:9]}/{ean[9:]}'
    return None


def entrada(ean, url):
    """Valor del índice para la foto `url` del producto `ean` (corto si la carpeta se deduce del código), o None si no sirve."""
    m = FOTO_RE.match(url.strip())
    if not m:
        return None
    ruta = m.group('ruta')
    if ruta.startswith('invalid/') or '..' in ruta:
        return None   # códigos mal cargados en Open Food Facts
    c = carpeta(ean)
    if c and ruta.startswith(c + '/') and '/' not in ruta[len(c) + 1:]:
        return ruta[len(c) + 1:]
    return ruta


def abrir_csv(origen):
    """Devuelve (flujo de texto, cierre). Acepta un archivo (.csv o .csv.gz) o descarga el volcado oficial en continuo."""
    if origen:
        raw = open(origen, 'rb')
        if origen.endswith('.gz'):
            raw = gzip.GzipFile(fileobj=raw)
        return io.TextIOWrapper(raw, encoding='utf-8', errors='replace', newline='\n'), raw.close
    log('Descargando el volcado de Open Food Facts (~1,3 GB, se lee sin guardarlo)…')
    resp = urllib.request.urlopen(urllib.request.Request(CSV_URL, headers={'User-Agent': UA}), timeout=120)
    raw = gzip.GzipFile(fileobj=resp)
    return io.TextIOWrapper(raw, encoding='utf-8', errors='replace', newline='\n'), resp.close


def construir(eans, origen):
    texto, cerrar = abrir_csv(origen)
    try:
        head = texto.readline().rstrip('\n').split('\t')
        try:
            i_code, i_img = head.index('code'), head.index('image_small_url')
        except ValueError:
            sys.exit('El volcado de Open Food Facts cambió de formato (no encuentro las columnas code e image_small_url)')
        i_t = head.index('last_image_t') if 'last_image_t' in head else None
        ncols, out, mejor_t, leidas, t0 = len(head), {}, {}, 0, time.time()
        for linea in texto:
            leidas += 1
            tab = linea.find('\t')
            if tab < 0:
                continue
            ean = linea[:tab].lstrip('0')
            if ean not in eans:
                continue                      # camino rápido: casi todas las líneas se descartan sin interpretarlas
            campos = linea.rstrip('\n').split('\t')
            if len(campos) != ncols:
                continue
            val = entrada(ean, campos[i_img])
            if not val:
                continue
            t = int(campos[i_t]) if i_t is not None and campos[i_t].isdigit() else 0
            if ean not in out or t > mejor_t[ean]:   # si un producto aparece con y sin ceros, queda la foto más reciente
                out[ean], mejor_t[ean] = val, t
            if leidas % 500000 == 0:
                log(f'  {leidas:,} productos leídos, {len(out):,} con foto ({time.time() - t0:.0f}s)')
        log(f'Leídos {leidas:,} productos de Open Food Facts: {len(out):,} de los de la app tienen foto ({time.time() - t0:.0f}s)')
        return out
    finally:
        cerrar()


def leer_baseline(origen):
    """Índice ya publicado (archivo o dirección web). None si no hay o no se puede leer."""
    if not origen:
        return None
    try:
        if re.match(r'^https?://', origen):
            with urllib.request.urlopen(urllib.request.Request(origen, headers={'User-Agent': UA}), timeout=60) as r:
                return json.load(r)
        with open(origen, encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        log('No pude leer el índice anterior:', e)
        return None


def edad_dias(idx):
    try:
        return (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(idx['generado'].replace('Z', '+00:00'))).days
    except Exception:
        return None


def guardar(out_dir, idx):
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'imagenes.json'), 'w', encoding='utf-8') as f:
        json.dump(idx, f, ensure_ascii=False, separators=(',', ':'))
    meta = os.path.join(out_dir, 'meta.json')
    if os.path.exists(meta):
        with open(meta, encoding='utf-8') as f:
            m = json.load(f)
        m['imagenes'] = len(idx['i'])
        with open(meta, 'w', encoding='utf-8') as f:
            json.dump(m, f, ensure_ascii=False, separators=(',', ':'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--names', required=True, help='names.json de la app (códigos de barras de los productos)')
    ap.add_argument('--out', required=True, help='carpeta de salida (la misma de build_sepa.py)')
    ap.add_argument('--csv', help='volcado de Open Food Facts ya descargado (.csv o .csv.gz)')
    ap.add_argument('--baseline', help='índice ya publicado (archivo o dirección web) para reutilizar si es reciente')
    ap.add_argument('--min-fotos', type=int, default=MIN_FOTOS, help='mínimo de fotos esperado; con menos se considera que cambió el formato')
    ap.add_argument('--max-age-days', type=int, default=0, help='si el índice anterior tiene menos días que esto, se reutiliza sin descargar nada')
    args = ap.parse_args()

    base = leer_baseline(args.baseline)
    if base and base.get('i') and args.max_age_days and (edad_dias(base) or 10 ** 6) < args.max_age_days:
        log(f"Se reutiliza el índice de fotos de hace {edad_dias(base)} días ({len(base['i']):,} fotos).")
        guardar(args.out, base)
        return

    with open(args.names, encoding='utf-8') as f:
        eans = set(json.load(f)['e'])
    try:
        fotos = construir(eans, args.csv)
        if len(fotos) < args.min_fotos:
            raise RuntimeError(f'solo {len(fotos)} fotos: el formato del volcado parece haber cambiado')
    except SystemExit:
        raise
    except Exception as e:
        if base and base.get('i'):
            log(f'No pude renovar el índice de fotos ({e}); se mantiene el anterior.')
            guardar(args.out, base)
            return
        sys.exit(f'No pude armar el índice de fotos: {e}')
    guardar(args.out, {
        'v': 1, 'generado': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'fuente': 'Open Food Facts (openfoodfacts.org), colaboradores de Open Food Facts',
        'licencia': 'Creative Commons Atribución-CompartirIgual 3.0 (CC BY-SA 3.0)',
        'i': dict(sorted(fotos.items())),
    })
    log(f'Listo: {len(fotos):,} fotos indexadas en {os.path.join(args.out, "imagenes.json")}')


if __name__ == '__main__':
    main()
