# Pruebas en navegador del punto de venta (pos/), contra la hoja simulada que ejecuta el script real.
# Uso: python3 scripts/servidor-pages.py 8770 &   node scripts/pos-servidor-prueba.mjs 8791 &
#      python3 scripts/test-pos.py <carpeta-capturas>
import sys, json, base64, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright

S = sys.argv[1]; URL = 'http://localhost:8770/pos/'; MOCK = 'http://127.0.0.1:8791'
CLAVE = 'clave-de-prueba-del-punto-de-venta-0123456789'
FIX = json.load(open('scripts/fixtures/productos-web.json', encoding='utf-8'))
for p in FIX['productos']: p['sku'] = 'SKU-' + p['id']
VIN = base64.urlsafe_b64encode(json.dumps({'u': 'https://script.google.com/macros/s/PRUEBA/exec', 't': CLAVE}).encode()).decode().rstrip('=')
res = []; errs = []
def ok(n, c, extra=''):
    res.append(bool(c)); print(('  ✓ ' if c else '  ✗ ') + n + (' ' + str(extra) if not c and extra else ''))
def mock(ruta): return json.loads(urllib.request.urlopen(MOCK + ruta, timeout=10).read() or 'null')
def hoja(n): return mock('/hoja?n=' + urllib.parse.quote(n))

def google(route):
    req = urllib.request.Request(MOCK + '/', data=(route.request.post_data or '').encode(), method='POST')
    try: body = urllib.request.urlopen(req, timeout=20).read()
    except Exception: return route.abort()
    route.fulfill(status=200, body=body, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'})

def contexto(b, ancho=390, movil=True):
    ctx = b.new_context(viewport={'width': ancho, 'height': 844 if movil else 900}, device_scale_factor=2 if movil else 1, is_mobile=movil, has_touch=movil, service_workers='block')
    ctx.route('https://script.google.com/**', google)
    ctx.route('https://wa.me/**', lambda r: r.abort())
    ctx.route('**/data/productos.json', lambda r: r.fulfill(status=200, body=json.dumps(FIX), content_type='application/json'))
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'wa.me' not in m.text and 'ERR_FAILED' not in m.text and errs.append(m.text))
    return ctx, pg

def filas_ventas():
    return [f for f in hoja('Ventas')[3:] if f[5]]

with sync_playwright() as p:
    b = p.chromium.launch()
    mock('/reset')

    print('\nVincular')
    ctx, pg = contexto(b)
    pg.goto(URL); pg.wait_for_selector('#v-vincular:not([hidden])')
    ok('Sin vincular muestra los pasos y no hay datos', pg.is_visible('#t-vincular') and pg.locator('.prod').count() == 0)
    pg.fill('#vin-enlace', 'https://mnscents.pages.dev/pos/#vincular=basura'); pg.click('.vin-pegar button'); pg.wait_for_timeout(200)
    ok('Un enlace malo se rechaza', pg.is_visible('.vin-pegar .error'))
    pg.goto('about:blank'); pg.goto(URL + '#vincular=' + VIN); pg.wait_for_selector('.prod')
    ok('El enlace de la hoja vincula y carga el catálogo', pg.locator('.prod').count() == len(FIX['productos']))
    ok('La clave no queda en la barra de direcciones', 'vincular' not in pg.url)
    ok('Las fotos salen por el código (SKU)', pg.locator('.prod img').count() >= 15)
    pg.screenshot(path=f'{S}/pos-1-vender.png')

    print('\nVender en efectivo')
    def agregar(sku, veces=1):
        for _ in range(veces): pg.click(f'.prod[data-ref$="(SKU-{sku})"]'); pg.wait_for_timeout(60)
    agregar('H01', 2)
    ok('Tocar un perfume lo suma a la venta', pg.inner_text(f'.prod[data-ref$="(SKU-H01)"] .p-cant') == '2' and 'C$2,920' in pg.inner_text('.bc-total'))
    ok('La barra dice cuánto falta para mayorista', 'Faltan 4' in pg.inner_text('.bc-mayor'))
    pg.click('.bc-boton'); pg.wait_for_selector('#h-carrito[open]')
    pg.click('#h-carrito [data-accion="cobrar"]'); pg.wait_for_selector('#h-cobro[open]')
    ok('Sin método elegido no deja confirmar', pg.get_attribute('[data-accion="confirmar-venta"]', 'aria-disabled') == 'true')
    pg.click('[data-accion="metodo"][data-m="Efectivo"]'); pg.fill('[data-campo="recibido"]', '2000'); pg.wait_for_timeout(100)
    ok('Si lo recibido no alcanza, lo dice y no deja confirmar', 'Faltan' in pg.inner_text('.vuelto') and pg.get_attribute('[data-accion="confirmar-venta"]', 'aria-disabled') == 'true')
    pg.fill('[data-campo="recibido"]', '3000'); pg.wait_for_timeout(100)
    ok('Calcula el vuelto', 'C$80' in pg.inner_text('.vuelto'))
    pg.click('[data-accion="confirmar-venta"]'); pg.wait_for_selector('.ls-estado.ok', timeout=10000)
    ok('Confirma con el número de venta que dio la hoja', 'Venta #2 guardada' in pg.inner_text('.listo'))
    f = filas_ventas()
    ok('En la hoja: fecha, número, perfume, cantidad, precio y método', len(f) == 2 and f[1][1] == 2 and f[1][5].endswith('(SKU-H01)') and f[1][6] == 2 and f[1][7] == 1460 and f[1][10] == 'Efectivo' and f[1][11] == 'Pagado', f[-1] if f else None)
    wa = urllib.parse.unquote(pg.get_attribute('.listo a.btn', 'href'))
    ok('Recibo por WhatsApp con el detalle', 'Recibo de venta #2' in wa and '2 × Mandarin Sky' in wa and 'Vuelto: C$80' in wa)
    pg.click('[data-accion="nueva-venta"]'); pg.wait_for_timeout(300)
    ok('La venta queda vacía para la siguiente', pg.is_hidden('.barra-cobro') and pg.locator('.p-cant').count() == 0)

    print('\nMayoreo, precio a mano y cliente nuevo')
    agregar('H01', 4); agregar('H05', 2)
    ok('Con 6 se aplica el precio mayorista solo', 'Precio mayorista' in pg.inner_text('.bc-mayor'))
    pg.click('.bc-boton'); pg.wait_for_selector('#h-carrito[open]')
    total_mayor = 4 * 985 + 2 * 1150
    ok(f'Total mayorista C${total_mayor:,}', f'C${total_mayor:,}' in pg.inner_text('#h-carrito .t-final'), pg.inner_text('#h-carrito .t-final'))
    pg.click('#h-carrito [data-accion="editar-linea"][data-ref$="(SKU-H05)"]'); pg.wait_for_selector('#h-linea[open]')
    pg.fill('[name="precio"]', '1100'); pg.fill('[name="descuento"]', '50'); pg.click('#h-linea [type="submit"]'); pg.wait_for_timeout(300)
    total2 = 4 * 985 + 2 * 1100 - 50
    ok('Precio y descuento a mano cambian el total', f'C${total2:,}' in pg.inner_text('#h-carrito .t-final'))
    pg.click('#h-carrito [data-accion="abrir-cliente"]'); pg.wait_for_selector('#h-cliente[open]')
    pg.fill('[data-buscar="cliente"]', 'maría'); pg.wait_for_timeout(150)
    ok('Busca clientes de la hoja', pg.locator('.cl-op').count() == 2 and 'MARÍA LÓPEZ' in pg.inner_text('.cl-lista'))
    pg.click('.cl-nuevo summary'); pg.fill('[name="nombre"]', 'Variedades Rosa'); pg.fill('[name="telefono"]', '8765-4321'); pg.select_option('[name="ciudad"]', 'León')
    pg.click('#h-cliente [type="submit"]'); pg.wait_for_timeout(300)
    ok('El cliente nuevo queda en la venta', 'Variedades Rosa' in pg.inner_text('#h-carrito .cliente-btn'))
    pg.screenshot(path=f'{S}/pos-2-carrito.png')
    pg.click('#h-carrito [data-accion="cobrar"]'); pg.wait_for_selector('#h-cobro[open]')
    pg.click('[data-accion="metodo"][data-b="Banpro"]'); pg.wait_for_timeout(100)
    ok('Transferencia: recuerda revisar el banco', 'Banpro' in pg.inner_text('.nota-banco'))
    pg.click('[data-accion="confirmar-venta"]'); pg.wait_for_selector('.ls-estado.ok', timeout=10000)
    f = filas_ventas()[-2:]
    ok('En la hoja: misma venta #3, banco Banpro, cliente y ciudad', all(x[1] == 3 and x[10] == 'Transferencia bancaria' and x[21] == 'Banpro' and x[2] == 'Variedades Rosa' and x[4] == 'León' for x in f), f)
    ok('Precio a mano y descuento llegan a la hoja', f[1][7] == 1100 and f[1][8] == 50 and f[0][7] == 985, f)
    cl = [x for x in hoja('Clientes')[3:] if x[0]]
    ok('El cliente nuevo se agregó a la hoja Clientes', ['Variedades Rosa', '8765-4321', 'León'] == cl[-1][:3], cl[-1][:3])
    wa = urllib.parse.unquote(pg.get_attribute('.listo a.btn', 'href'))
    ok('El recibo va directo al WhatsApp del cliente', wa.startswith('https://wa.me/50587654321?text='))
    pg.click('[data-accion="nueva-venta"]'); pg.wait_for_timeout(300)

    print('\nSin señal')
    mock('/caido?v=1')
    agregar('H03', 1)
    pg.click('.bc-boton'); pg.click('#h-carrito [data-accion="cobrar"]'); pg.wait_for_selector('#h-cobro[open]')
    pg.click('[data-accion="metodo"][data-m="Efectivo"]'); pg.click('[data-accion="confirmar-venta"]')
    pg.wait_for_selector('.ls-estado.pendiente', timeout=15000)
    ok('Sin señal la venta queda guardada en el teléfono', 'quedó en el teléfono' in pg.inner_text('.listo'))
    pg.click('[data-accion="nueva-venta"]'); pg.wait_for_timeout(300)
    ok('Arriba se ve que hay 1 por enviar', pg.is_visible('.red') and '1 por enviar' in pg.inner_text('.red'))
    stock_h03 = pg.inner_text('.prod[data-ref$="(SKU-H03)"] .p-stock')
    ok('El stock que se ve ya descuenta la venta pendiente', stock_h03 == 'Quedan 10', stock_h03)
    pg.reload(); pg.wait_for_selector('.prod')
    ok('Al cerrar y abrir la app, la venta sigue pendiente', '1 por enviar' in pg.inner_text('.red'))
    mock('/caido?v=0')
    pg.click('[data-accion="refrescar"]'); pg.wait_for_selector('.red', state='hidden', timeout=15000)
    f = filas_ventas()
    ok('Al volver la señal se envía sola y queda como venta #4', f[-1][1] == 4 and f[-1][5].endswith('(SKU-H03)'), f[-1])
    pg.click('[data-accion="refrescar"]'); pg.wait_for_timeout(1500)
    ok('Reintentar no la duplica', len([x for x in filas_ventas() if x[1] == 4]) == 1)

    print('\nCaja')
    pg.click('.nav-pos a[data-vista="caja"]'); pg.wait_for_selector('.caja .abrir-caja')
    ok('La pestaña Caja avisa que falta abrir la caja', pg.is_visible('.nav-pos .nav-punto'))
    pg.fill('.abrir-caja input', '1000'); pg.click('.abrir-caja button'); pg.wait_for_selector('.caja .abrir-caja', state='detached', timeout=10000)
    pg.click('[data-accion="caja-form"][data-tipo="salida"]'); pg.wait_for_selector('#h-caja[open]')
    pg.fill('#h-caja [name="monto"]', '150'); pg.fill('#h-caja [name="concepto"]', 'Bolsas'); pg.click('#h-caja .interruptor')
    pg.click('#h-caja [type="submit"]'); pg.wait_for_timeout(200)
    ok('Un gasto pide la categoría', pg.is_visible('#h-caja .error'))
    pg.click('#h-caja [data-accion="categoria"][data-c="Empaques"]'); pg.click('#h-caja [type="submit"]'); pg.wait_for_timeout(2500)
    efectivo_ventas = 2920 + 1490
    esperado = 1000 + efectivo_ventas - 150
    ok(f'Efectivo esperado: apertura + ventas en efectivo − salidas = C${esperado:,}', f'C${esperado:,}' in pg.inner_text('.ec-monto'), pg.inner_text('.ec-monto'))
    ok('Las transferencias se ven por banco', f'C${total2:,}' in pg.inner_text('.bancos .banco-banpro'))
    g = [x for x in hoja('Gastos')[3:] if x[0]]
    ok('La salida marcada como gasto llegó a la hoja Gastos', g and g[-1][1:4] == ['Empaques', 'Bolsas', 150], g)
    pg.screenshot(path=f'{S}/pos-3-caja.png', full_page=True)
    pg.click('[data-accion="anular"][data-n="4"]'); pg.click('#h-confirmar [data-r="si"]'); pg.wait_for_selector('.mv-anulada', timeout=10000)
    ok('Anular la venta #4 la borra de Ventas', not [x for x in filas_ventas() if x[1] == 4])
    ok('Y el efectivo esperado baja', f'C${esperado - 1490:,}' in pg.inner_text('.ec-monto'))
    pg.click('[data-accion="caja-form"][data-tipo="cierre"]'); pg.wait_for_selector('#h-caja[open]')
    pg.fill('#h-caja [name="monto"]', str(esperado - 1490 - 20)); pg.wait_for_timeout(100)
    ok('Al cerrar, muestra la diferencia mientras cuentas', 'Faltan C$20' in pg.inner_text('.cf-dif'))
    pg.click('#h-caja [type="submit"]'); pg.wait_for_selector('.efectivo-caja.cerrada', timeout=10000)
    ok('Caja cerrada con el faltante anotado', 'Faltaron C$20' in pg.inner_text('.ec-dif'))
    caja = [x for x in hoja('Caja')[3:] if x[1]]
    ok('La hoja Caja tiene apertura, ventas, salida, anulación y cierre', [x[1] for x in caja] == ['Venta', 'Venta', 'Venta', 'Apertura', 'Salida', 'Anulación', 'Cierre'], [x[1] for x in caja])

    print('\nStock y ajustes')
    pg.click('.nav-pos a[data-vista="stock"]'); pg.wait_for_selector('.st-fila')
    ok('Resumen de stock con agotados y bajo stock', 'agotados' in pg.inner_text('.stock-resumen'))
    pg.click('.sr-item.agotado'); pg.wait_for_timeout(200)
    ok('Tocar "agotados" filtra la lista', all('agotado' in x for x in pg.locator('.st-num small').all_inner_texts()))
    pg.click('[data-accion="filtro-stock"][data-v="todos"]'); pg.fill('#q-stock', 'hawas ice'); pg.wait_for_timeout(200)
    pg.click('.st-fila'); pg.wait_for_selector('#h-producto[open]')
    ok('La ficha muestra precios, costo y margen', all(x in pg.inner_text('.pr-datos') for x in ['Costo real', 'Margen']))
    ok('Sin motivo no deja guardar el ajuste', pg.get_attribute('[data-accion="guardar-ajuste"]', 'aria-disabled') == 'true')
    pg.click('[data-accion="aj-motivo"][data-m="Dañado"]'); pg.fill('[data-campo="aj-nota"]', 'tapa rota'); pg.click('[data-accion="guardar-ajuste"]'); pg.wait_for_timeout(2500)
    aj = [x for x in hoja('Ajustes')[3:] if x[1]]
    ok('El ajuste llegó a la hoja Ajustes', aj and aj[-1][1].endswith('(SKU-H10)') and aj[-1][2] == -1 and aj[-1][3] == 'Dañado' and aj[-1][4] == 'tapa rota', aj)
    ok('Sin desbordes horizontales', pg.evaluate('document.documentElement.scrollWidth') <= 390)
    pg.set_viewport_size({'width': 320, 'height': 640}); pg.wait_for_timeout(200)
    ok('Sin desbordes en 320px', pg.evaluate('document.documentElement.scrollWidth') <= 320, pg.evaluate('''() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > 321 && !e.closest('.chips')).slice(0, 4).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right))'''))
    ctx.close()

    print('\nComputadora')
    ctx, pg = contexto(b, 1440, False)
    pg.goto(URL + '#vincular=' + VIN); pg.wait_for_selector('.prod')
    ok('En PC la venta se ve a la derecha, siempre visible', pg.is_visible('.panel-carrito') and pg.is_hidden('.barra-cobro'))
    pg.keyboard.press('/'); pg.keyboard.type('mandarin sky elixir'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    ok('Teclado: "/" busca y Enter agrega el único resultado', '1' == pg.inner_text('.prod .p-cant'))
    pg.screenshot(path=f'{S}/pos-4-pc.png')
    pg.click('.nav-pos a[data-vista="caja"]'); pg.wait_for_timeout(400); pg.screenshot(path=f'{S}/pos-5-pc-caja.png', full_page=True)
    ctx.close()

    print('\nSeguridad')
    ctx, pg = contexto(b)
    malo = base64.urlsafe_b64encode(json.dumps({'u': 'https://script.google.com/macros/s/PRUEBA/exec', 't': 'clave-equivocada-que-no-sirve-para-nada'}).encode()).decode().rstrip('=')
    pg.goto(URL + '#vincular=' + malo); pg.wait_for_selector('#v-vincular:not([hidden])', timeout=15000)
    ok('Con una clave equivocada la hoja no responde y pide vincular de nuevo', 'ya no está vinculado' in pg.inner_text('#v-vincular') and pg.locator('.prod').count() == 0)
    ctx.close()
    b.close()

ok('Sin errores en la consola (incluida la política de seguridad)', not errs, errs[:3])
print(f'\n{sum(res)} correctas, {len(res) - sum(res)} fallidas.')
sys.exit(0 if all(res) else 1)
