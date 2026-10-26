# Pruebas en navegador: mapa de aromas, racha mayorista, calculadora de ganancia,
# catálogo de reventa y "Lo más pedido". Usa el catálogo fijo de scripts/fixtures.
# Uso: python3 scripts/servidor-pages.py 8770 &  y luego  python3 scripts/test-herramientas.py <carpeta>
import sys, json, urllib.parse, copy
from playwright.sync_api import sync_playwright
S = sys.argv[1]; URL = 'http://localhost:8770/'
FIX = 'scripts/fixtures/productos-web.json'
BASE = json.load(open(FIX, encoding='utf-8'))
D = {p['id']: p for p in BASE['productos']}
DISP = [p['id'] for p in BASE['productos'] if p['estado'] == 'disponible' and p.get('existencias') != 0]
res = []; errs = []
def ok(n, c, extra=''):
    res.append(bool(c)); print(('  ✓ ' if c else '  ✗ ') + n + (' ' + str(extra) if not c and extra else ''))

def contexto(b, datos=BASE, **kw):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True, **kw)
    cuerpo = json.dumps(datos)
    ctx.route('**/data/productos.json', lambda r: r.fulfill(status=200, body=cuerpo, content_type='application/json'))
    ctx.route('https://wa.me/**', lambda r: r.abort())
    return ctx

def nueva(ctx):
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'wa.me' not in m.text and 'ERR_FAILED' not in m.text and errs.append(m.text))
    pg.on('pageerror', lambda e: errs.append(str(e)))
    return pg

with sync_playwright() as p:
    b = p.chromium.launch()

    print('\nMapa de aromas')
    ctx = contexto(b); pg = nueva(ctx)
    pg.goto(URL); pg.wait_for_selector('.tarjeta')
    pg.click('[data-accion="abrir-mapa"]'); pg.wait_for_selector('#hoja-mapa[open]'); pg.wait_for_timeout(700)
    con_notas = sum(1 for x in D.values() if x['notas'])
    ok(f'Una estrella por perfume con notas ({con_notas})', pg.locator('.m-est').count() == con_notas)
    ok('El enlace queda en #mapa', pg.evaluate('location.hash') == '#mapa')
    ok('Al abrir ya hay 3 perfumes cerca de la luna', pg.locator('.m-est.cerca').count() == 3 and pg.locator('.mapa-panel .mapa-item').count() == 3)
    box = pg.locator('.mapa-svg').bounding_box()
    antes = pg.eval_on_selector_all('.m-est.cerca', 'e=>e.map(x=>x.dataset.id).join()')
    pg.mouse.move(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.5); pg.mouse.down()
    for i in range(10): pg.mouse.move(box['x'] + box['width'] * (0.5 - 0.035 * i), box['y'] + box['height'] * (0.5 + 0.035 * i)); pg.wait_for_timeout(25)
    pg.mouse.up(); pg.wait_for_timeout(400)
    despues = pg.eval_on_selector_all('.m-est.cerca', 'e=>e.map(x=>x.dataset.id).join()')
    ok('Arrastrar la luna cambia los perfumes cercanos', antes != despues, (antes, despues))
    frescos = [x['id'] for x in D.values() if any(n.lower() in ('fresco', 'acuático', 'acuatico') for n in x['notas'])]
    ok('Abajo a la izquierda están los frescos', all(i in frescos for i in despues.split(',')[:2]), despues)
    pg.screenshot(path=f'{S}/mapa-arrastre.png')
    est = pg.locator('.m-est[data-id="H05"]'); bb = est.bounding_box()
    pg.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); pg.wait_for_timeout(900)
    ok('Tocar una estrella la elige y dibuja su constelación', pg.locator('.m-est.sel[data-id="H05"]').count() == 1 and pg.locator('.m-linea').count() >= 1)
    afines = pg.eval_on_selector_all('.m-est.afin', 'e=>e.map(x=>x.dataset.id)')
    def comunes(a, b2):
        nb = {n.lower() for n in D[b2]['notas']}
        return [n for n in D[a]['notas'] if n.lower() in nb]
    ok('La constelación une solo perfumes que comparten notas', afines and all(comunes('H05', i) for i in afines), afines)
    ok('El panel muestra el elegido y "Su constelación"', 'Club de Nuit Intense' in pg.inner_text('.mapa-panel') and 'constelación' in pg.inner_text('.mapa-panel').lower())
    pg.click('.mapa-panel .mapa-item [data-accion="agregar"]'); pg.wait_for_timeout(300)
    ok('Agregar desde el mapa suma al pedido', '1 unidad' in pg.inner_text('.bp-linea1'), pg.inner_text('.bp-linea1'))
    pg.click('[data-accion="mapa-cat"][data-cat="damas"]'); pg.wait_for_timeout(300)
    nd = sum(1 for x in D.values() if x['notas'] and x['catalogo'] == 'damas')
    ok(f'Filtro Ella deja {nd} estrellas visibles', pg.locator('.m-est:not(.fuera)').count() == nd)
    pg.click('[data-accion="mapa-solo"]'); pg.wait_for_timeout(300)
    vis = pg.eval_on_selector_all('.m-est:not(.fuera)', 'e=>e.map(x=>x.dataset.id)')
    ok('"Solo disponibles" oculta agotados y coming soon', all(i in DISP for i in vis), vis)
    pg.focus('.m-luna'); pg.keyboard.press('ArrowRight'); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(700)
    ok('La luna se mueve con el teclado', pg.get_attribute('.m-luna', 'aria-valuetext').startswith('Más cerca'))
    ok('Sin desbordes horizontales', pg.evaluate('document.documentElement.scrollWidth') <= 390)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    pg.click('.tarjeta[data-id="H01"] .t-abrir'); pg.wait_for_timeout(400)
    pg.click('[data-accion="mapa-ver"]'); pg.wait_for_timeout(900)
    ok('"En el mapa" desde la ficha abre el mapa con ese perfume', pg.locator('#hoja-mapa[open] .m-est.sel[data-id="H01"]').count() == 1)
    ctx.close()

    print('\nRacha mayorista')
    ctx = contexto(b); pg = nueva(ctx)
    pg.goto(URL); pg.wait_for_selector('.tarjeta')
    carrito = [{'id': DISP[0], 'qty': 2}, {'id': DISP[1], 'qty': 2}, {'id': DISP[2], 'qty': 2}]
    pg.evaluate('c => localStorage.setItem("mnscents-pedido-v1", JSON.stringify(c))', carrito)
    pg.reload(); pg.wait_for_selector('.tarjeta')
    ok('Sin racha guardada no aparece la tarjeta', pg.locator('.racha-tarjeta:not([hidden])').count() == 0)
    pg.click('.bp-boton'); pg.wait_for_timeout(400)
    ok('Pedido de 6: aparece el atajo a la calculadora', pg.is_visible('.reventa-atajo'))
    with ctx.expect_page() as w: pg.click('.btn-enviar')
    w.value.close(); pg.wait_for_timeout(600)
    r = json.loads(pg.evaluate('localStorage.getItem("mnscents-racha-v1")') or 'null')
    ok('Enviar un pedido de 6 guarda la racha en el teléfono', r and r['primeraUsada'] is False and len(r['pedido']) == 3)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    txt = pg.inner_text('.racha-tarjeta')
    ok('La tarjeta de racha dice cuántos días quedan', 'activa' in txt and 'Quedan 6 días' in txt, txt[:90])
    pg.evaluate('id => localStorage.setItem("mnscents-pedido-v1", JSON.stringify([{id, qty: 1}]))', DISP[0])
    pg.reload(); pg.wait_for_selector('.tarjeta'); pg.click('.bp-boton'); pg.wait_for_timeout(400)
    ok('Con racha, 1 perfume va a precio mayorista (por confirmar)', 'racha' in pg.inner_text('.t-nivel') and pg.inner_text('.t-cs') == f"C${D[DISP[0]]['precios']['mayor']['cs']:,}")
    msg = urllib.parse.unquote(pg.get_attribute('.btn-enviar', 'href').split('text=')[1])
    ok('El mensaje de WhatsApp lo dice y lleva la fecha en el enlace', 'MAYORISTA POR RACHA, por confirmar' in msg and '&racha=' in msg)
    enlace = [l for l in msg.split('\n') if l.startswith('Verificar pedido: ')][0].split(': ', 1)[1]
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.goto(enlace.replace('https://mnscents.pages.dev/', URL)); pg.wait_for_selector('#hoja-verificar[open]')
    v = pg.inner_text('#hoja-verificar')
    ok('La verificación avisa que la racha hay que confirmarla y da el total sin racha', 'racha mayorista activa' in v and f"C${D[DISP[0]]['precios']['detalle']['cs']:,}" in v)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.evaluate('localStorage.setItem("mnscents-pedido-v1", "[]")'); pg.reload(); pg.wait_for_selector('.tarjeta')
    pg.click('[data-accion="repetir-racha"]'); pg.wait_for_timeout(500)
    ok('"Repetir mi último pedido" vuelve a llenar el pedido', pg.locator('#hoja-pedido .linea').count() == 3)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.evaluate('''() => { const r = JSON.parse(localStorage.getItem("mnscents-racha-v1")); r.inicio -= 40*864e5; r.ultima -= 40*864e5; localStorage.setItem("mnscents-racha-v1", JSON.stringify(r)); }''')
    pg.evaluate('id => localStorage.setItem("mnscents-pedido-v1", JSON.stringify([{id, qty: 1}]))', DISP[0])
    pg.reload(); pg.wait_for_selector('.tarjeta')
    ok('Racha vencida: lo dice y ya no da precio mayorista', 'venció' in pg.inner_text('.racha-tarjeta') and 'Al detalle' in pg.inner_text('.t-nivel'))
    pg.evaluate('localStorage.setItem("mnscents-racha-v1", "{\\"inicio\\":\\"x\\"}")'); pg.reload(); pg.wait_for_selector('.tarjeta')
    ok('Datos de racha manipulados se ignoran', pg.locator('.racha-tarjeta:not([hidden])').count() == 0)
    ctx.close()

    print('\nCalculadora de ganancia y catálogo de reventa')
    ctx = contexto(b); pg = nueva(ctx)
    pg.goto(URL); pg.wait_for_selector('.tarjeta')
    a, z = DISP[0], DISP[1]
    pg.evaluate('c => localStorage.setItem("mnscents-pedido-v1", JSON.stringify(c))', [{'id': a, 'qty': 4}, {'id': z, 'qty': 2}])
    pg.goto(URL + '#ganancia'); pg.reload(); pg.wait_for_selector('#hoja-ganancia[open]')
    pg.fill(f'[data-gan-precio="{a}"]', '1500'); pg.fill(f'[data-gan-precio="{z}"]', '1600')
    pg.fill('[data-gasto-m="0"]', '300'); pg.wait_for_timeout(200)
    costo = 4 * D[a]['precios']['mayor']['cs'] + 2 * D[z]['precios']['mayor']['cs']
    gan = 4 * 1500 + 2 * 1600 - costo - 300
    pie = pg.inner_text('.gan-pie')
    ok(f'Ganancia con envío: C${gan:,}', f'C${abs(gan):,}' in pie and f'C${costo + 300:,}' in pie, pie[:120])
    ok('Cada línea dice cuánto gana por frasco', f"Ganas C${1500 - D[a]['precios']['mayor']['cs']:,} c/u" in pg.inner_text('.gan-lineas'))
    pg.click('[data-accion="gan-mas-gasto"]'); pg.fill('[data-gasto-c="1"]', 'Empaque'); pg.fill('[data-gasto-m="1"]', '100'); pg.wait_for_timeout(200)
    ok('Se pueden agregar más gastos', f'C${abs(gan - 100):,}' in pg.inner_text('.gan-pie'))
    pg.click('[data-accion="gan-pct"]'); pg.wait_for_timeout(200)
    ok('"Aplicar a todos" llena precios con el % elegido', pg.input_value(f'[data-gan-precio="{a}"]') != '1500')
    pg.reload(); pg.wait_for_selector('#hoja-ganancia[open]')
    ok('Los precios y gastos se recuerdan en el teléfono', pg.input_value('[data-gasto-c="1"]') == 'Empaque')
    pg.click('.gan-pie [data-accion="abrir-reventa"]'); pg.wait_for_selector('#hoja-reventa[open]')
    ok('El catálogo empieza con los perfumes del pedido', pg.locator('.rev-p.on').count() == 2)
    ok('Sin nombre ni teléfono no deja compartir', pg.get_attribute('[data-accion="rev-compartir"]', 'aria-disabled') == 'true')
    pg.fill('[data-rev="negocio"]', 'Perfumes Ana'); pg.fill('[data-rev="tel"]', '8888-1234')
    pg.wait_for_selector('.rev-vista img:not([hidden])', timeout=8000); pg.wait_for_timeout(300)
    ok('Se genera la vista previa', pg.get_attribute('.rev-vista img', 'src').startswith('blob:'))
    with pg.expect_download() as dl: pg.click('[data-accion="rev-guardar"]')
    d = dl.value; d.save_as(f'{S}/catalogo.png')
    ok('Se descarga la imagen PNG', d.suggested_filename == 'catalogo-perfumes-ana.png')
    from PIL import Image
    im = Image.open(f'{S}/catalogo.png'); ok('La imagen mide 1080×1920', im.size == (1080, 1920))
    for i in range(5): pg.click(f'.rev-elegir[data-id="{DISP[2 + i]}"]'); pg.wait_for_timeout(80)
    ok('Máximo 6 perfumes', pg.locator('.rev-p.on').count() == 6)
    ctx.close()

    print('\nLo más pedido del mes')
    datos = copy.deepcopy(BASE)
    for prod in datos['productos']:
        if prod['id'] == DISP[1]: prod['top'] = 1
        if prod['id'] == DISP[0]: prod['top'] = 2
    ctx = contexto(b, datos); pg = nueva(ctx)
    pg.goto(URL + '#caballeros'); pg.wait_for_selector('.tarjeta')
    ok('La tira muestra el ranking en orden', pg.eval_on_selector_all('.lo-item', 'e=>e.map(x=>x.dataset.id)') == [DISP[1], DISP[0]])
    ok('Las tarjetas dicen "N.º 1 del mes" y no "Más vendido"', pg.locator('.tarjeta .etq.top', has_text='N.º 1 del mes').count() == 1 and pg.locator('.tarjeta .etq.top', has_text='Más vendido').count() == 0)
    pg.fill('#q', 'mandarin'); pg.wait_for_timeout(300)
    ok('Al buscar, la tira se oculta', pg.locator('.lo-mas:not([hidden])').count() == 0)
    ctx.close()
    ctx = contexto(b); pg = nueva(ctx); pg.goto(URL); pg.wait_for_selector('.tarjeta')
    ok('Sin ranking no hay tira y vuelve "Más vendido" manual', pg.locator('.lo-mas:not([hidden])').count() == 0 and pg.locator('.etq.top', has_text='Más vendido').count() >= 0)
    ctx.close()
    b.close()

ok('Sin errores en la consola', not errs, errs[:3])
print(f'\n{sum(res)} correctas, {len(res) - sum(res)} fallidas.')
sys.exit(0 if all(res) else 1)
