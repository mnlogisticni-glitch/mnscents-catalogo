# Pruebas de seguridad en un servidor local que imita Cloudflare Pages (scripts/servidor-pages.py).
# Uso: python3 scripts/test-seguridad.py
import json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
res = []
def ok(n, c, extra=''):
    res.append(bool(c)); print(('  ✓ ' if c else '  ✗ ') + n + ('' if c else f'  [{extra}]'))

# datos maliciosos: lo que alguien con acceso a la hoja podría escribir
datos = json.load(open(os.path.join(RAIZ, 'data/productos.json'), encoding='utf-8'))
h01 = next(p for p in datos['productos'] if p['id'] == 'H01')
h01.update({
    'nombre': '<img src=x onerror="window.__xss=1">Mandarin',
    'marca': '"><svg onload="window.__xss=2">',
    'notas': ['<b onmouseover="window.__xss=3">Fresco</b>', 'Cítrico', 'Fresco'],
    'descripcion': '<script>window.__xss=4</script>',
    'presentacion': '<iframe src="javascript:window.__xss=6"></iframe>',
    'foto': 'x" onerror="window.__xss=5',
})
malos = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
json.dump(datos, malos, ensure_ascii=False); malos.close()

srv = os.path.join(RAIZ, 'scripts/servidor-pages.py')
p1 = subprocess.Popen([sys.executable, srv, '8770', RAIZ], env={**os.environ, 'MN_INYECTAR_BEACON': '1'})
p2 = subprocess.Popen([sys.executable, srv, '8771', RAIZ], env={**os.environ, 'MN_DATOS': malos.name})
time.sleep(1)
B, M = 'http://127.0.0.1:8770', 'http://127.0.0.1:8771'

class SinSeguir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
abrir = urllib.request.build_opener(SinSeguir)
def pedir(url, metodo='GET'):
    try:
        r = abrir.open(urllib.request.Request(url, method=metodo)); return r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers)

try:
    print('Cabeceras y rutas (servidor que imita Cloudflare Pages)')
    st, hs = pedir(B + '/')
    for k in ['Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy']:
        ok(f'Cabecera {k}', k in hs)
    ok("CSP prohíbe incrustar la página (frame-ancestors 'none')", "frame-ancestors 'none'" in hs.get('Content-Security-Policy', ''))
    for ruta in ['/scripts/sync.mjs', '/scripts/fixtures/productos-pdf.json', '/.github/workflows/sincronizar.yml', '/LEEME.md']:
        st, hs = pedir(B + ruta)
        ok(f'{ruta} no se sirve (301 a la portada)', st == 301 and hs.get('Location') == '/', st)
    for ruta in ['/admin', '/administrador', '/login', '/api/productos', '/.git/config', '/.env']:
        st, _ = pedir(B + ruta)
        ok(f'{ruta} → 404 (no existe)', st == 404, st)
    st, _ = pedir(B + '/data/productos.json', 'POST')
    ok('POST a los datos → rechazado (405)', st == 405, st)

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, accept_downloads=True)
        ctx.add_init_script("window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI))")
        pg = ctx.new_page()
        errores = []
        pg.on('pageerror', lambda e: errores.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'Content Security Policy' in m.text and errores.append(m.text))

        print('\nLa web funciona con la política de seguridad activa')
        pg.goto(B + '/'); pg.wait_for_selector('.tarjeta')
        pg.click('.tarjeta [data-accion=agregar]'); pg.wait_for_timeout(150)
        pg.click('.tarjeta .t-abrir'); pg.wait_for_timeout(450); pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
        pg.click('.bp-boton'); pg.wait_for_timeout(700)
        ok('Pedido y caja de 6 se dibujan', pg.locator('.caja-slot.lleno').count() >= 1)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
        pg.click('.descubre'); pg.wait_for_timeout(450)
        for t in ['Para él', 'De noche', 'Cálido e intenso', 'Que se note']:
            pg.click(f'.q-op:has-text("{t}")'); pg.wait_for_timeout(420)
        pg.wait_for_timeout(600)
        with pg.expect_download() as dl:
            pg.click('[data-accion=quiz-guardar]')
        ok('La imagen para compartir se genera (canvas, fuentes, SVG)', dl.value.suggested_filename.endswith('.png'))
        ok('Script de Cloudflare Web Analytics permitido por la política', not any('cloudflareinsights' in v for v in pg.evaluate('window.__csp')), pg.evaluate('window.__csp'))
        ok('Sin violaciones de la política de seguridad', pg.evaluate('window.__csp.length') == 0 and not errores, pg.evaluate('window.__csp') + errores)

        print('\nEnlaces manipulados')
        for h in ['#%E0%A4%A', '#p-%', '#<img src=x onerror=window.__xss=9>', '#p-"><svg onload=window.__xss=10>', '#javascript:alert(1)']:
            pg2 = ctx.new_page(); pg2.goto(B + '/' + h); pg2.wait_for_timeout(700)
            ok(f'"{h}" carga el catálogo sin ejecutar nada', pg2.locator('.tarjeta').count() > 0 and pg2.evaluate('window.__xss') is None)
            pg2.close()

        print('\nManipulación del pedido')
        import json as _j, urllib.parse as _u
        datos = _j.load(open('data/productos.json', encoding='utf-8'))['productos']
        disp = [x for x in datos if x['estado'] == 'disponible' and x.get('existencias') != 0]
        a, z = disp[0], disp[1]
        pv = ctx.new_page(); pv.goto(B + '/'); pv.wait_for_selector('.tarjeta')
        pv.evaluate(f"localStorage.setItem('mnscents-pedido-v1', JSON.stringify([{{id:'{a['id']}',qty:2}},{{id:'{z['id']}',qty:1}}]))")
        pv.reload(); pv.wait_for_selector('.tarjeta')
        msg = _u.unquote(pv.get_attribute('.btn-enviar', 'href').split('text=', 1)[1])
        ok('El mensaje de WhatsApp lleva el enlace para verificar', f"#pedido={a['id']}-2,{z['id']}-1" in msg, msg[-160:])
        enlace = msg.split('Verificar pedido: ', 1)[1].split()[0].replace('https://mnscents.pages.dev', B)
        pv.goto(enlace); pv.wait_for_selector('#hoja-verificar[open]')
        esperado = 2 * a['precios']['detalle']['cs'] + z['precios']['detalle']['cs']
        txt = pv.inner_text('.v-totales .t-cs')
        ok(f'El enlace recalcula el total con el catálogo (C${esperado:,})', txt.replace('C$', '').replace(',', '') == str(esperado), txt)
        lim = next(x for x in disp if isinstance(x.get('existencias'), int))
        pv.goto(B + '/'); pv.goto(B + f"/#pedido={lim['id']}-99"); pv.wait_for_timeout(700)
        ok(f"Pedir 99 de {lim['nombre']} (hay {lim['existencias']}) se ajusta y se avisa", 'solo hay' in pv.inner_text('.verificar'), pv.inner_text('.verificar')[:200])
        cs = next(x for x in datos if x['estado'] != 'disponible')
        pv.goto(B + '/'); pv.goto(B + f"/#pedido=ZZZ99-5,{cs['id']}-3"); pv.wait_for_timeout(700)
        ok('Productos inexistentes o no disponibles no se cobran (total C$0)', pv.inner_text('.v-totales .t-cs') == 'C$0', pv.inner_text('.verificar')[:200])
        for h in ['#pedido=<img src=x onerror=window.__xss=11>-1', '#pedido=H01-1%22%3E%3Csvg%20onload%3Dwindow.__xss%3D12%3E', '#pedido=H01--5,H01-0,H01-1e9']:
            pv.goto(B + '/'); pv.goto(B + '/' + h); pv.wait_for_timeout(600)
            ok(f'Enlace de pedido manipulado "{h[8:40]}" no ejecuta nada', pv.evaluate('window.__xss') is None and pv.locator('.tarjeta').count() > 0)
        pv.goto(B + '/')
        pv.evaluate(f"localStorage.setItem('mnscents-pedido-v1', JSON.stringify([{{id:'{lim['id']}',qty:500}},{{id:'<img src=x onerror=window.__xss=13>',qty:1}},{{id:'{a['id']}',qty:-3}},{{id:'{z['id']}',qty:'9;alert(1)'}}]))")
        pv.reload(); pv.wait_for_selector('.tarjeta'); pv.click('.bp-boton'); pv.wait_for_timeout(600)
        ok('Un pedido alterado en el navegador se corrige a las existencias reales', pv.locator('.lineas .linea').count() >= 1 and pv.evaluate('window.__xss') is None and str(lim['existencias']) in pv.inner_text('.lineas'), pv.inner_text('.lineas')[:200])
        pv.close()

        print('\nDatos maliciosos en la hoja (nombre, marca, notas, descripción, foto)')
        pg3 = ctx.new_page(); pg3.on('pageerror', lambda e: errores.append(str(e)))
        pg3.goto(M + '/'); pg3.wait_for_selector('.tarjeta')
        pg3.fill('#q', 'mandarin'); pg3.wait_for_timeout(300); pg3.fill('#q', ''); pg3.wait_for_timeout(200)
        pg3.click('.tarjeta[data-id="H01"] .t-abrir'); pg3.wait_for_timeout(450)
        ok('El nombre malicioso se muestra como texto', '<img src=x' in pg3.inner_text('#ficha-nombre'))
        pg3.click('[data-accion=ficha-agregar]'); pg3.wait_for_timeout(400)
        pg3.click('.bp-boton'); pg3.wait_for_timeout(700); pg3.keyboard.press('Escape'); pg3.wait_for_timeout(400)
        pg3.click('.descubre'); pg3.wait_for_timeout(450)
        for t in ['Para él', 'De día', 'Fresco y limpio', 'Suave y elegante']:
            pg3.click(f'.q-op:has-text("{t}")'); pg3.wait_for_timeout(420)
        pg3.wait_for_timeout(500)
        pg3.mouse.move(100, 400); pg3.wait_for_timeout(200)
        ok('Ningún código de la hoja se ejecutó (catálogo, ficha, pedido, cuestionario)', pg3.evaluate('window.__xss') is None, pg3.evaluate('window.__xss'))
        ok('No se crearon elementos inyectados', pg3.evaluate("document.querySelectorAll('iframe, img[src=\"x\"], svg[onload], b[onmouseover]').length") == 0)
        b.close()
finally:
    p1.terminate(); p2.terminate(); os.unlink(malos.name)

print(f'\n{sum(res)} correctas, {len(res) - sum(res)} fallidas.')
sys.exit(0 if all(res) else 1)
