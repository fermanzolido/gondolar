#!/usr/bin/env python3
"""
Actualiza los datos de precios de la web publicada. Hay que correrlo desde una computadora con IP argentina.

Por qué: el portal oficial de datos abiertos (datos.produccion.gob.ar) rechaza con error 403 los pedidos que llegan desde
los servidores de GitHub (salen desde Estados Unidos), así que la descarga no puede hacerse en GitHub Actions.

Qué hace:
  1. Descarga la base SEPA del día y la procesa (scripts/build_sepa.py). Si a ese día le falta alguna cadena (no todas informan todos
     los días), la completa con los días anteriores.
  2. Agrega el índice de fotos de productos de Open Food Facts (scripts/build_imagenes.py). Se renueva una vez por mes: el resto de los
     días se reutiliza el que ya está publicado en la web. Si falla, los precios se publican igual.
  3. Empaqueta el resultado y lo sube como archivo adjunto de un "release" del repositorio (no ensucia el historial).
  4. Le pide a GitHub Actions que vuelva a publicar la web con esos datos.

Requisitos: Python 3, GitHub CLI (`gh`) con la sesión iniciada, y permiso de escritura en el repositorio.

Uso:
  python scripts/publish_datos.py                # descarga los datos de hoy
  python scripts/publish_datos.py --zip x.zip    # usa un ZIP ya descargado
  python scripts/publish_datos.py --sin-publicar # solo prepara el paquete, no toca GitHub
  python scripts/publish_datos.py --sin-fotos    # no toca el índice de fotos
"""
import argparse, os, shutil, subprocess, sys, tarfile, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = 'datos'
BASELINE_FOTOS = 'https://gondolar.com.ar/data/imagenes.json'   # índice de fotos ya publicado, para reutilizarlo
ASSET = 'datos.tar.gz'
NOTES = ('Datos de precios y sucursales ya procesados para la web de Gondolar.\n\n'
         'Fuente: Precios Claros - Base SEPA, Secretaria de Comercio de la Nacion (https://datos.produccion.gob.ar/dataset/sepa-precios), '
         'licencia Creative Commons Atribucion 4.0. Datos modificados: agrupados por provincia (mediana de las sucursales de cada '
         'cadena), con codigos de barras unificados y nombres limpiados.')


def run(cmd, **kw):
    print('>', ' '.join(cmd), flush=True)
    return subprocess.run(cmd, check=True, **kw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', help='ZIP de SEPA ya descargado (si no, se descarga el de hoy)')
    ap.add_argument('--sin-publicar', action='store_true', help='solo genera el paquete; no sube nada a GitHub')
    ap.add_argument('--repo', help='repositorio owner/nombre (por defecto, el del directorio actual)')
    ap.add_argument('--sin-fotos', action='store_true', help='no genera ni renueva el índice de fotos de productos')
    ap.add_argument('--fotos-csv', help='volcado de Open Food Facts ya descargado (si no, se baja cuando toca renovar)')
    ap.add_argument('--baseline-fotos', default=BASELINE_FOTOS, help='dirección del índice de fotos ya publicado')
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix='gondolar_datos_')
    try:
        out = os.path.join(tmp, 'data')
        build = [sys.executable, os.path.join(ROOT, 'scripts', 'build_sepa.py'), '--out', out]
        run(build + (['--zip', args.zip] if args.zip else ['--download']))

        if not args.sin_fotos:
            fotos = [sys.executable, os.path.join(ROOT, 'scripts', 'build_imagenes.py'), '--names', os.path.join(out, 'names.json'), '--out', out,
                     '--baseline', args.baseline_fotos, '--max-age-days', '30'] + (['--csv', args.fotos_csv] if args.fotos_csv else [])
            try:
                run(fotos)
            except subprocess.CalledProcessError:
                print('AVISO: no pude armar el índice de fotos; los precios se publican igual, sin fotos.', flush=True)

        pack = os.path.join(tmp, ASSET)
        with tarfile.open(pack, 'w:gz', compresslevel=9) as t:
            t.add(out, arcname='data')
        print(f'Paquete listo: {os.path.getsize(pack) / 1048576:.1f} MB', flush=True)

        if args.sin_publicar:
            dest = os.path.join(ROOT, ASSET)
            shutil.copy(pack, dest)
            print('Guardado en', dest)
            return

        repo = ['--repo', args.repo] if args.repo else []
        if subprocess.run(['gh', 'release', 'view', TAG] + repo, capture_output=True).returncode != 0:
            run(['gh', 'release', 'create', TAG, '--title', 'Datos de precios (SEPA, procesados)', '--notes', NOTES] + repo)
        run(['gh', 'release', 'upload', TAG, pack, '--clobber'] + repo)
        run(['gh', 'workflow', 'run', 'pages.yml'] + repo)
        print('Listo: GitHub Actions está republicando la web con los datos nuevos.')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
