# Prueba en navegador: "Comparar dos perfumes"
# Usa un catálogo fijo (scripts/fixtures/productos-web.json) para que las pruebas no dependan de las existencias del día.
# Uso: python3 scripts/test-comparar.py <carpeta-capturas> [url]
import sys, json
from playwright.sync_api import sync_playwright
S = sys.argv[1]; URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:8766/'
D = {p['id']: p for p in json.load(open('scripts/fixtures/productos-web.json', encoding='utf-8'))['productos']}
res = []; errs = []
def ok(n, c, extra=''):
    res.append(c); print(('  ✓ ' if c else '  ✗ ') + n + ('' if c else f'  [{extra}]'))
def cs(v): return f"C${v:,}"
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True); ctx.route('**/data/productos.json', lambda r: r.fulfill(path='scripts/fixtures/productos-web.json', content_type='application/json'))
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text)); pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + (e.stack or '')[:400]))
    pg.goto(URL); pg.wait_for_selector('.tarjeta'); pg.evaluate('localStorage.clear()'); pg.reload(); pg.wait_for_selector('.tarjeta')
    # desde la ficha
    pg.click('.tarjeta[data-id="H10"] .t-abrir'); pg.wait_for_timeout(450)
    ok('La ficha tiene botón Comparar', pg.locator('#hoja-ficha [data-accion=cmp-abrir]').count() == 1)
    pg.click('#hoja-ficha [data-accion=cmp-abrir]'); pg.wait_for_timeout(500)
    ok('Abre la hoja de comparar y cierra la ficha', pg.locator('#hoja-comparar[open]').count() == 1 and pg.locator('#hoja-ficha[open]').count() == 0)
    ok('Pide elegir el segundo, sin incluir el primero', pg.locator('.cmp-opcion[data-id="H10"]').count() == 0 and pg.locator('.cmp-opcion').count() == len(D) - 1)
    pg.screenshot(path=f'{S}/shots/cmp1-elegir.png')
    pg.fill('#cmp-q', 'dive'); pg.wait_for_timeout(200)
    ok('Buscar filtra la lista', pg.locator('.cmp-opcion').count() == 1, pg.locator('.cmp-opcion').count())
    pg.click('.cmp-opcion[data-id="H09"]'); pg.wait_for_timeout(450)
    a, z = D['H10'], D['H09']
    filas = pg.inner_text('.cmp-tabla')
    ok('Muestra los precios reales al detalle y por mayor', all(cs(x['precios'][n]['cs']) in filas for x in (a, z) for n in ('detalle', 'mayor')), filas[:300])
    comunes = [n for n in a['notas'] if n.lower() in [m.lower() for m in z['notas']]]
    ok(f'Marca las notas en común ({", ".join(comunes)})', pg.locator('.cmp-notas li.comun').count() == 2 * len(comunes))
    barato = None if a['precios']['detalle']['cs'] == z['precios']['detalle']['cs'] else (a if a['precios']['detalle']['cs'] < z['precios']['detalle']['cs'] else z)
    if barato:
        ok(f'Señala a {barato["nombre"]} como más económico al detalle', pg.locator(f'.cmp-col[data-id="{barato["id"]}"]').count() >= 1 and pg.locator('.cmp-mejor').count() >= 1 and barato['nombre'] in pg.inner_text('.cmp-resumen'))
    ok('El enlace se puede compartir (#comparar=H10,H09)', pg.evaluate('location.hash') == '#comparar=H10,H09')
    pg.wait_for_timeout(400); pg.screenshot(path=f'{S}/shots/cmp2-tabla.png', full_page=False)
    pg.locator('.cmp-acciones .cmp-col').first.locator('[data-accion=agregar]').click(); pg.wait_for_timeout(200)
    ok('Agregar desde la comparación suma al pedido', '1 unidad' in pg.inner_text('.bp-linea1'), pg.inner_text('.bp-linea1'))
    pg.click('[data-accion=cmp-invertir]'); pg.wait_for_timeout(300)
    ok('Intercambiar pone el segundo a la izquierda', pg.evaluate('location.hash') == '#comparar=H09,H10')
    pg.click('[data-accion=cmp-cambiar]'); pg.wait_for_timeout(300)
    ok('Cambiar vuelve a la lista', pg.locator('.cmp-opcion').count() > 0)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(450)
    ok('Al cerrar, el enlace vuelve al catálogo', not pg.evaluate('location.hash').startswith('#comparar'))
    # enlace directo y manipulado
    pg.goto(URL + '#comparar=D01,D05'); pg.wait_for_timeout(900)
    ok('Enlace directo abre la comparación', pg.locator('#hoja-comparar[open] .cmp-col').count() >= 2 and 'Yara Tous' in pg.inner_text('.cmp-tabla'))
    for h in ['#comparar=<img src=x onerror=window.__x=1>,H01', '#comparar=ZZZ,H01', '#comparar=H01,H01', '#comparar=%E0%A4%A']:
        pg.goto(URL); pg.goto(URL + h); pg.wait_for_timeout(700)
        ok(f'Enlace manipulado "{h[10:34]}" no rompe ni ejecuta nada', pg.evaluate('window.__x') is None and pg.locator('.tarjeta').count() > 0)
    # desde el cuestionario
    pg.goto(URL + '#encuentra'); pg.wait_for_selector('#hoja-quiz[open]')
    for t in ['Para él', 'De día', 'Fresco y limpio', 'Suave y elegante']:
        pg.click(f'.q-op:has-text("{t}")'); pg.wait_for_timeout(420)
    ok('El resultado ofrece comparar los dos primeros', pg.locator('.q-comparar').count() == 1)
    pg.click('.q-comparar'); pg.wait_for_timeout(500)
    ok('Compara los dos primeros recomendados', pg.locator('#hoja-comparar[open] .cmp-cabeza .cmp-col').count() == 2 and pg.locator('#hoja-quiz[open]').count() == 0)
    pg.set_viewport_size({'width': 1280, 'height': 860}); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{S}/shots/cmp3-escritorio.png')
    ok('Sin errores en la consola', not errs, errs)
    b.close()
print(f'\n{sum(res)} correctas, {len(res) - sum(res)} fallidas.')
sys.exit(0 if all(res) else 1)
