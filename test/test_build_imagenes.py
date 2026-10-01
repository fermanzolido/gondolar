"""Pruebas de scripts/build_imagenes.py con un volcado de juguete (sin descargar nada). Se ejecuta con `npm run test:datos`."""
import datetime, gzip, importlib.util, json, os, subprocess, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'scripts', 'build_imagenes.py')
IMG = 'https://images.openfoodfacts.org/images/products/'
HEAD = ['code', 'url', 'creator', 'product_name', 'countries_tags', 'last_image_t', 'image_url', 'image_small_url']


def fila(code, foto='', t='1', nombre='x'):
    return [code, 'u', 'c', nombre, 'en:argentina', t, '', foto]


FILAS = [
    fila('7790895000997', IMG + '779/089/500/0997/front_en.43.200.jpg'),                      # la carpeta se deduce del código
    fila('0012345678905', IMG + '001/234/567/8905/front_es.5.200.jpg'),                       # código con ceros de relleno: la carpeta no coincide
    fila('7793704000911', IMG + 'invalid/front_es.6.200.jpg'),                                # código mal cargado en Open Food Facts: se descarta
    fila('7790040143517', ''),                                                                # sin foto
    fila('3017620422003', IMG + '301/762/042/2003/front_en.1.200.jpg'),                       # producto que la app no tiene
    fila('7791720043851', IMG + '779/172/004/3851/front_es.1.200.jpg', t='100'),              # el mismo producto con y sin ceros: gana la foto más reciente
    fila('07791720043851', IMG + '779/172/004/3851/front_es.2.200.jpg', t='200'),
    fila('7790001000014', 'https://otro-sitio.com/foto.200.jpg'),                             # fuera de images.openfoodfacts.org: se descarta
    fila('7790001000021', IMG + '779/000/100/0021/front_es.1.400.jpg'),                       # solo se usa la miniatura de 200 px
]
EANS = ['7790895000997', '12345678905', '7793704000911', '7790040143517', '7791720043851', '7790001000014', '7790001000021']
ESPERADO = {'7790895000997': 'front_en.43', '12345678905': '001/234/567/8905/front_es.5', '7791720043851': 'front_es.2'}


def escribir_csv(path, filas=FILAS):
    texto = '\n'.join('\t'.join(r) for r in [HEAD] + filas) + '\n'
    if path.endswith('.gz'):
        with gzip.open(path, 'wt', encoding='utf-8', newline='\n') as f:
            f.write(texto)
    else:
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(texto)


class Funciones(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('build_imagenes', SCRIPT)
        cls.b = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.b)

    def test_carpeta_de_13_digitos(self):
        self.assertEqual(self.b.carpeta('7790895000997'), '779/089/500/0997')
        self.assertIsNone(self.b.carpeta('12345678'))          # EAN-8: no se deduce
        self.assertIsNone(self.b.carpeta('12345678905'))       # 11 dígitos (UPC sin ceros)

    def test_entrada_corta_si_la_carpeta_se_deduce(self):
        self.assertEqual(self.b.entrada('7790895000997', IMG + '779/089/500/0997/front_en.43.200.jpg'), 'front_en.43')

    def test_entrada_completa_si_no_se_deduce(self):
        self.assertEqual(self.b.entrada('12345678905', IMG + '001/234/567/8905/front_es.5.200.jpg'), '001/234/567/8905/front_es.5')
        self.assertEqual(self.b.entrada('7790895000997', IMG + '123/456/789/0123/front_es.1.200.jpg'), '123/456/789/0123/front_es.1')

    def test_descarta_lo_que_no_sirve(self):
        for url in ('', IMG + 'invalid/front_es.6.200.jpg', IMG + '779/089/500/0997/front_en.43.400.jpg', 'https://otro.com/x.200.jpg',
                    IMG + '../../etc/passwd.200.jpg', 'javascript:alert(1)'):
            self.assertIsNone(self.b.entrada('7790895000997', url), url)


class Generador(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        with open(os.path.join(self.dir, 'names.json'), 'w', encoding='utf-8') as f:
            json.dump({'e': EANS, 'n': [], 'm': [], 'q': []}, f)
        with open(os.path.join(self.dir, 'meta.json'), 'w', encoding='utf-8') as f:
            json.dump({'v': 1, 'fecha': '2026-09-30', 'productos': len(EANS)}, f)

    def tearDown(self):
        self.tmp.cleanup()

    def correr(self, *extra):
        return subprocess.run([sys.executable, SCRIPT, '--names', os.path.join(self.dir, 'names.json'), '--out', self.dir, *extra],
                              capture_output=True, text=True, encoding='utf-8', errors='replace', env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})

    def cargar(self, nombre):
        with open(os.path.join(self.dir, nombre), encoding='utf-8') as f:
            return json.load(f)

    def test_arma_el_indice_desde_un_csv_comprimido(self):
        csv_gz = os.path.join(self.dir, 'off.csv.gz')
        escribir_csv(csv_gz)
        r = self.correr('--csv', csv_gz, '--min-fotos', '1')
        self.assertEqual(r.returncode, 0, r.stderr)
        idx = self.cargar('imagenes.json')
        self.assertEqual(idx['i'], ESPERADO)
        self.assertIn('CC BY-SA', idx['licencia'])
        self.assertEqual(self.cargar('meta.json')['imagenes'], 3)          # la web se entera de que hay fotos
        self.assertEqual(self.cargar('meta.json')['fecha'], '2026-09-30')  # y el resto de meta.json queda igual

    def test_tambien_lee_csv_sin_comprimir(self):
        csv = os.path.join(self.dir, 'off.csv')
        escribir_csv(csv)
        self.assertEqual(self.correr('--csv', csv, '--min-fotos', '1').returncode, 0)
        self.assertEqual(self.cargar('imagenes.json')['i'], ESPERADO)

    def test_falla_si_cambia_el_formato(self):
        csv = os.path.join(self.dir, 'off.csv')
        with open(csv, 'w', encoding='utf-8') as f:
            f.write('codigo\tfoto\n1\t2\n')
        r = self.correr('--csv', csv)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('cambió de formato', r.stderr + r.stdout)
        self.assertFalse(os.path.exists(os.path.join(self.dir, 'imagenes.json')))

    def test_falla_si_casi_no_encuentra_fotos(self):
        csv = os.path.join(self.dir, 'off.csv')
        escribir_csv(csv)
        r = self.correr('--csv', csv)       # mínimo por defecto: 300
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(os.path.join(self.dir, 'imagenes.json')))

    def indice_anterior(self, dias):
        gen = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=dias)).strftime('%Y-%m-%dT%H:%M:%SZ')
        path = os.path.join(self.dir, 'anterior.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'v': 1, 'generado': gen, 'i': {'111': 'front_es.1', '222': 'front_es.2'}}, f)
        return path

    def test_reutiliza_el_indice_reciente_sin_descargar_nada(self):
        base = self.indice_anterior(3)
        r = self.correr('--baseline', base, '--max-age-days', '30', '--csv', os.path.join(self.dir, 'no-existe.csv'))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.cargar('imagenes.json')['i'], {'111': 'front_es.1', '222': 'front_es.2'})
        self.assertEqual(self.cargar('meta.json')['imagenes'], 2)

    def test_renueva_el_indice_viejo(self):
        base = self.indice_anterior(40)
        csv = os.path.join(self.dir, 'off.csv')
        escribir_csv(csv)
        r = self.correr('--baseline', base, '--max-age-days', '30', '--csv', csv, '--min-fotos', '1')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.cargar('imagenes.json')['i'], ESPERADO)

    def test_si_falla_la_renovacion_se_queda_con_el_anterior(self):
        base = self.indice_anterior(40)
        r = self.correr('--baseline', base, '--max-age-days', '30', '--csv', os.path.join(self.dir, 'no-existe.csv'))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('se mantiene el anterior', r.stderr)
        self.assertEqual(self.cargar('imagenes.json')['i'], {'111': 'front_es.1', '222': 'front_es.2'})


if __name__ == '__main__':
    unittest.main(verbosity=2)
