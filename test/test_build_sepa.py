"""Pruebas de scripts/build_sepa.py con un ZIP de juguete (sin descargar nada). Se ejecuta con `npm run test:datos`."""
import io, json, os, subprocess, sys, tempfile, unittest, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, 'scripts', 'build_sepa.py')
BOM = bytes([0xEF, 0xBB, 0xBF])

COMERCIO_H = 'id_comercio|id_bandera|comercio_cuit|comercio_razon_social|comercio_bandera_nombre|comercio_bandera_url|comercio_ultima_actualizacion|comercio_version_sepa'
SUC_H = ('id_comercio|id_bandera|id_sucursal|sucursales_nombre|sucursales_tipo|sucursales_calle|sucursales_numero|sucursales_latitud|'
         'sucursales_longitud|sucursales_observaciones|sucursales_barrio|sucursales_codigo_postal|sucursales_localidad|sucursales_provincia')
PROD_H = ('id_comercio|id_bandera|id_sucursal|id_producto|productos_ean|productos_descripcion|productos_cantidad_presentacion|'
          'productos_unidad_medida_presentacion|productos_marca|productos_precio_lista|productos_precio_referencia|'
          'productos_cantidad_referencia|productos_unidad_medida_referencia|productos_precio_unitario_promo1|productos_leyenda_promo1')


def suc(cid, band, sid, nombre, tipo, calle, num, lat, lon, loc, prov):
    return f'{cid}|{band}|{sid}|{nombre}|{tipo}|{calle}|{num}|{lat}|{lon}||||{loc}|{prov}'


def prod(cid, band, sid, ean, desc, price, marca='MARCA', promo=('', '')):
    return f'{cid}|{band}|{sid}|{ean}|1|{desc}|500|grm|{marca}|{price}|0|1|kgm|{promo[0]}|{promo[1]}'


def inner_zip(comercio, sucursales, productos, cp1252=False, bom=False):
    def enc(text):
        b = text.encode('cp1252' if cp1252 else 'utf-8')
        return BOM + b if bom else b
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('comercio.csv', enc('\n'.join([COMERCIO_H] + comercio)))
        z.writestr('sucursales.csv', enc('\n'.join([SUC_H] + sucursales)))
        z.writestr('productos.csv', enc('\n'.join([PROD_H] + productos)))
    return buf.getvalue()


def make_fixture(path):
    carrefour = inner_zip(
        ['10|1|30687310434|INC S.A.|Hipermercado Carrefour|www.carrefour.com.ar|2026-09-29|1.0',
         '10|3|30687310434|INC S.A.|Express|www.carrefour.com.ar|2026-09-29|1.0'],
        [suc(10, 1, 1, 'HIPER CENTRO', 'Hipermercado', 'Av. Rivadavia', 2243, '-34.6100', '-58.4000', 'Almagro', 'AR-C'),
         suc(10, 1, 2, 'WEB', 'Web', 'Deposito', 1, '-34.7000', '-58.5000', 'Ituzaingo', 'AR-B'),
         suc(10, 3, 1, 'EXPRESS', 'Autoservicio', 'Corrientes', 100, '-34.6040', '-58.3800', 'Centro', 'AR-C')],
        [prod(10, 1, 1, '0007790895000997', 'GASEOSA COLA COCA COLA 2250 CM3', 5900, 'COCA COLA'),
         prod(10, 1, 1, '0007793704000911', 'YERBA MATE C/PALO PLAYADITO', 2790, 'PLAYADITO',
              ('2232', '20% de descuento con Banco Nación - Vigencia: Desde el 01/09/2026 Hasta el 30/09/2026')),
         prod(10, 1, 1, '0007790040143517', 'GALLETITAS', 1000, 'X', ('700', 'Promo A valida desde el 01/08/2026 hasta 15/09/2026')),   # vencida
         prod(10, 3, 1, '0007790895000997', 'GASEOSA COLA COCA COLA 2250 CM3', 9999, 'COCA COLA'),   # Express: se ignora
         prod(10, 1, 1, '12345', 'CODIGO INVALIDO', 100)],
        bom=True)
    dia = inner_zip(
        ['15|1|30685849751|DIA Argentina S.A.|Supermercados DIA|https://www.supermercadosdia.com.ar|2026-09-29|1.0'],
        [suc(15, 1, 1, 'DIA Nuñez', 'Autoservicio', 'Av. Cabildo', 2000, '-34.5600', '-58.4500', 'Núñez', 'AR-C'),
         suc(15, 1, 2, 'DIA Ramos', 'Autoservicio', 'Rivadavia', 13000, '-34.6400', '-58.5600', 'Ramos Mejía', 'AR-B'),
         'Última actualización: 2026-09-29'],   # línea suelta al final (pasa en SEPA de verdad)
        [prod(15, 1, 1, '7790895000997', 'COCA COLA GASEOSA 2.25 LT SABOR ORIGINAL', 5800, 'COCA-COLA'),
         prod(15, 1, 2, '7790895000997', 'COCA COLA GASEOSA 2.25 LT SABOR ORIGINAL', 6000, 'COCA-COLA'),
         prod(15, 1, 1, '7790895000997', 'COCA COLA GASEOSA 2.25 LT SABOR ORIGINAL', 5900, 'COCA-COLA',
              ('4425', '25% de descuento con cualquier medio de pago - Vigencia: Desde el 25/09/2026 Hasta el 05/10/2026 - Stock: Hasta agotar stock.')),
         prod(15, 1, 1, '7793704000911', 'YERBA', 3000, 'PLAYADITO', ('2000', '3X2 YERBA PLAYADITO'))],
        cp1252=True)
    with zipfile.ZipFile(path, 'w') as outer:
        outer.writestr('2026-09-29/', '')
        outer.writestr('2026-09-29/sepa_1_comercio-sepa-10_2026-09-29_09-05-11.zip', carrefour)
        outer.writestr('2026-09-29/sepa_1_comercio-sepa-15_2026-09-29_09-05-11.zip', dia)
        outer.writestr('2026-09-29/sepa_2_comercio-sepa-36_2026-09-29_01-05-08.zip', b'')   # ZIP vacio: se omite


class BuildSepa(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.zip = os.path.join(cls.tmp.name, 'sepa.zip')
        cls.out = os.path.join(cls.tmp.name, 'data')
        make_fixture(cls.zip)
        cls.run_ok = subprocess.run([sys.executable, SCRIPT, '--zip', cls.zip, '--out', cls.out], capture_output=True, text=True,
                                    env={**os.environ, 'SEPA_RELAX': '1', 'PYTHONIOENCODING': 'utf-8'})

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def load(self, *parts):
        with open(os.path.join(self.out, *parts), encoding='utf-8') as f:
            return json.load(f)

    def test_termina_bien(self):
        self.assertEqual(self.run_ok.returncode, 0, self.run_ok.stderr)

    def test_meta(self):
        m = self.load('meta.json')
        self.assertEqual(m['fecha'], '2026-09-29')
        self.assertEqual([c['id'] for c in m['cadenas']][:2], ['carrefour', 'jumbo'])
        self.assertIn('AR-C', m['provincias'])
        self.assertIn('Creative Commons', m['licencia'])

    def test_codigos_de_barras_sin_ceros_de_relleno(self):
        n = self.load('names.json')
        self.assertIn('7790895000997', n['e'])
        self.assertNotIn('0007790895000997', n['e'])
        self.assertNotIn('12345', n['e'])   # codigo invalido

    def test_precio_mediana_por_provincia_y_cadena(self):
        caba = self.load('prices', 'AR-C.json')['7790895000997']
        order = [c['id'] for c in self.load('meta.json')['cadenas']]
        self.assertEqual(caba[order.index('carrefour')], 5900)   # el Express (9999) no cuenta
        self.assertEqual(caba[order.index('dia')], 5850)         # mediana de 5800 y 5900 en CABA
        self.assertIsNone(caba[order.index('coto')])
        self.assertEqual(self.load('prices', 'AR-B.json')['7790895000997'][order.index('dia')], 6000)

    def test_sucursales_sin_express_ni_web(self):
        b = self.load('branches.json')
        nombres = [x[2] for x in b]
        self.assertIn('Hiper Centro', nombres)
        self.assertNotIn('Express', nombres)
        self.assertFalse([x for x in b if str(x[8]).lower() == 'web'])
        self.assertEqual(len(b), 3)   # hiper + 2 Dia
        self.assertTrue(all(x[6] is not None for x in b))

    def test_nombres_limpios_y_mas_completos(self):
        n = self.load('names.json')
        i = n['e'].index('7790895000997')
        self.assertEqual(n['n'][i], 'Coca Cola Gaseosa 2.25 l Sabor Original')   # el mas largo, con mayusculas prolijas y unidades en minuscula
        self.assertEqual(n['m'][i], 'Coca Cola')

    def test_caracteres_del_formato_antiguo(self):
        b = self.load('branches.json')
        self.assertIn('DIA Nuñez', [x[2] for x in b])   # cp1252 -> ñ correcta (nombre mixto: se respeta)

    def test_promociones(self):
        order = [c['id'] for c in self.load('meta.json')['cadenas']]
        d = self.load('promos', 'AR-C.json')
        dia = order.index('dia')
        coca = d['p']['7790895000997']
        self.assertEqual(len(coca), 1)
        ci, precio, pct, hasta, kind, ti, frac = coca[0]
        self.assertEqual((ci, precio, pct, hasta, kind, frac), (dia, 4425, 25, '2026-10-05', 0, 50))   # directa, en 1 de 2 filas
        self.assertIn('cualquier medio de pago', d['t'][ti])
        self.assertNotIn(' - Vigencia', d['t'][ti])
        yerba = {e[0]: e for e in d['p']['7793704000911']}
        self.assertEqual(yerba[dia][4], 2)                                    # 3X2: promoción por cantidad, no se aplica sola
        self.assertEqual(yerba[order.index('carrefour')][4], 1)               # Banco Nación: pide un medio de pago
        self.assertNotIn('7790040143517', d['p'])                             # vencida: no se guarda
        self.assertEqual(self.load('meta.json')['promos'], 3)

    def test_falla_si_los_datos_no_pasan_las_validaciones(self):
        r = subprocess.run([sys.executable, SCRIPT, '--zip', self.zip, '--out', os.path.join(self.tmp.name, 'otro')],
                           capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k != 'SEPA_RELAX'})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('validaciones', r.stderr + r.stdout)


class ParsePromo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import datetime, importlib.util
        spec = importlib.util.spec_from_file_location('build_sepa', SCRIPT)
        cls.b = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.b)
        cls.hoy = datetime.date(2026, 9, 29)

    def p(self, lista, promo, texto):
        return self.b.parse_promo(str(lista), str(promo), texto, self.hoy)

    def test_directa_con_vigencia(self):
        r = self.p(1000, 750, '25% de descuento con cualquier medio de pago - Vigencia: Desde el 16/09/2026 Hasta el 05/10/2026 - Stock: Hasta agotar stock.')
        self.assertEqual((r['price'], r['pct'], r['hasta'], r['kind']), (750, 25, '2026-10-05', 0))

    def test_sin_fechas_es_directa(self):
        r = self.p(1000, 800, '20% de descuento. Precio Promocional Exclusivo DIA en Sucursales Indicadas Hasta Agotar Stock o Finalice Vigencia')
        self.assertEqual((r['kind'], r['hasta']), (0, ''))

    def test_formato_del_a_al(self):
        self.assertEqual(self.p(1000, 800, 'DEL 20/09/2026 AL 30/09/2026')['hasta'], '2026-09-30')

    def test_vencida_o_futura(self):
        self.assertIsNone(self.p(1000, 800, 'Promo A valida desde el 01/08/2026 hasta 28/09/2026'))
        self.assertIsNone(self.p(1000, 800, 'Promo A valida desde el 01/10/2026 hasta 15/10/2026'))
        self.assertIsNotNone(self.p(1000, 800, 'Promo A valida desde el 01/09/2026 hasta 29/09/2026'))   # vence hoy: vale

    def test_por_cantidad(self):
        for t in ('Llevando 3 unidades - Vigencia: Desde el 01/09/2026 Hasta el 30/09/2026', '28% de descuento. 2X$2550 ALFJ FANTOCH',
                  '33% de descuento. 3X2 CARAMELO', '30% de descuento. 2DO AL 70% JUGO'):
            self.assertEqual(self.p(1000, 700, t)['kind'], 2, t)

    def test_por_medio_de_pago(self):
        self.assertEqual(self.p(1000, 800, '20% con Banco Nación')['kind'], 1)
        self.assertEqual(self.p(1000, 800, '20% pagando con Mercado Pago')['kind'], 1)

    def test_sin_promocion_o_que_no_baja_el_precio(self):
        self.assertIsNone(self.p(1000, '', 'algo'))
        self.assertIsNone(self.p(1000, 1000, 'sin descuento real'))
        self.assertIsNone(self.p(1000, 1200, 'mas caro'))
        self.assertIsNone(self.b.parse_promo('1000', 'abc', 'x', self.hoy))


class CheckChains(unittest.TestCase):
    """Las cadenas regionales se omiten (con aviso) si no vienen bien en SEPA; las principales frenan la publicación."""

    @classmethod
    def setUpClass(cls):
        import importlib.util
        spec = importlib.util.spec_from_file_location('build_sepa', SCRIPT)
        cls.b = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.b)

    def counters(self, suc, eans):
        import collections
        return collections.Counter(suc), {k: set(range(v)) for k, v in eans.items()}

    def test_todas_bien(self):
        chains = [dict(id='a'), dict(id='r', requerida=False, min_suc=2, min_eans=5)]
        n_suc, seen = self.counters({'a': 50, 'r': 3}, {'a': 5000, 'r': 10})
        ok, problemas, avisos = self.b.check_chains(chains, n_suc, seen)
        self.assertEqual((ok, problemas, avisos), (['a', 'r'], [], []))

    def test_regional_que_falla_se_omite_con_aviso(self):
        chains = [dict(id='a'), dict(id='r', requerida=False, min_suc=2, min_eans=5)]
        n_suc, seen = self.counters({'a': 50, 'r': 1}, {'a': 5000, 'r': 2})
        ok, problemas, avisos = self.b.check_chains(chains, n_suc, seen)
        self.assertEqual(ok, ['a'])
        self.assertEqual(problemas, [])
        self.assertEqual(len(avisos), 1)
        self.assertIn('se omite', avisos[0])

    def test_cadena_principal_que_falla_frena_todo(self):
        chains = [dict(id='a'), dict(id='r', requerida=False, min_suc=2, min_eans=5)]
        n_suc, seen = self.counters({'a': 2, 'r': 3}, {'a': 100, 'r': 10})
        ok, problemas, avisos = self.b.check_chains(chains, n_suc, seen)
        self.assertEqual(ok, ['r'])
        self.assertEqual(len(problemas), 1)
        self.assertIn('a:', problemas[0])

    def test_regional_con_datos_viejos_se_omite(self):
        chains = [dict(id='a'), dict(id='r', requerida=False, min_suc=1, min_eans=1)]
        n_suc, seen = self.counters({'a': 50, 'r': 3}, {'a': 5000, 'r': 10})
        ok, problemas, avisos = self.b.check_chains(chains, n_suc, seen, {'a': '2026-09-29', 'r': '2025-06-11'}, '2026-09-29')
        self.assertEqual(ok, ['a'])
        self.assertEqual(problemas, [])
        self.assertIn('desactualizados', avisos[0])

    def test_regional_con_datos_al_dia_se_mantiene(self):
        chains = [dict(id='a'), dict(id='r', requerida=False, min_suc=1, min_eans=1)]
        n_suc, seen = self.counters({'a': 50, 'r': 3}, {'a': 5000, 'r': 10})
        ok, _, avisos = self.b.check_chains(chains, n_suc, seen, {'a': '2026-09-29', 'r': '2026-09-28'}, '2026-09-29')
        self.assertEqual(ok, ['a', 'r'])
        self.assertEqual(avisos, [])

    def test_cadena_principal_con_fecha_vieja_no_se_descarta(self):
        # Changomas informa fechas de 2017 pero sus precios son actuales: solo se avisa
        chains = [dict(id='a')]
        n_suc, seen = self.counters({'a': 50}, {'a': 5000})
        ok, problemas, avisos = self.b.check_chains(chains, n_suc, seen, {'a': '2017-10-19'}, '2026-09-29')
        self.assertEqual((ok, problemas), (['a'], []))
        self.assertIn('se mantiene', avisos[0])

    def test_las_cadenas_definidas_tienen_lo_necesario_para_la_app(self):
        ids = [c['id'] for c in self.b.CHAINS]
        self.assertEqual(len(ids), len(set(ids)))
        siglas = [c['sigla'] for c in self.b.CHAINS]
        self.assertEqual(len(siglas), len(set(siglas)), 'las siglas de los monogramas no pueden repetirse')
        for c in self.b.CHAINS:
            for k in ('id', 'sigla', 'name', 'color', 'web', 'cuit'):
                self.assertTrue(c.get(k), (c['id'], k))
        self.assertIn('farmacity', ids)
        self.assertTrue(next(c for c in self.b.CHAINS if c['id'] == 'farmacity').get('optativa'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
