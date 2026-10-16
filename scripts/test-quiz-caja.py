# Prueba en navegador: "Encuentra tu perfume" y "Arma tu caja de 6"
# Uso: python3 scripts/test-quiz-caja.py <carpeta-capturas> [url]
import sys
from playwright.sync_api import sync_playwright
S = sys.argv[1]; URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:8766/'
res = []; errs = []
def ok(n, c, extra=''):
    res.append(c); print(('  ✓ ' if c else '  ✗ ') + n + ('' if c else f'  [{extra}]'))
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text)); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector('.tarjeta')
    pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_selector('.tarjeta')
    ok('Entrada "Encuentra tu perfume" visible', pg.locator('.descubre').is_visible())
    ok('La luna de la entrada tiene su creciente', len(pg.get_attribute('.descubre .lp-luz', 'd') or '') > 10)
    pg.screenshot(path=f'{S}/shots/q0-entrada.png')
    pg.click('.descubre'); pg.wait_for_timeout(450)
    ok('Abre el cuestionario', pg.locator('#hoja-quiz[open]').count() == 1)
    ok('Pregunta 1 de 4', 'Pregunta 1 de 4' in pg.inner_text('.q-paso'))
    ok('Enlace directo #encuentra', pg.evaluate('location.hash') == '#encuentra')
    pg.screenshot(path=f'{S}/shots/q1-pregunta1.png')
    def elegir(t):
        pg.click(f'.q-op:has-text("{t}")'); pg.wait_for_timeout(450)
    elegir('Para él'); ok('Avanza a pregunta 2', 'Pregunta 2 de 4' in pg.inner_text('.q-paso'))
    elegir('De día')
    ok('Aromas de caballeros sin "Floral"', pg.locator('.q-op:has-text("Floral")').count() == 0)
    pg.screenshot(path=f'{S}/shots/q3-aroma.png')
    elegir('Fresco y limpio')
    pg.click('[data-accion=quiz-atras]'); pg.wait_for_timeout(300)
    ok('Anterior vuelve a la pregunta 3 con la opción marcada', 'Pregunta 3 de 4' in pg.inner_text('.q-paso') and pg.locator('.q-op[aria-pressed=true]').count() == 1)
    elegir('Fresco y limpio'); elegir('Suave y elegante')
    nombres = pg.locator('.rec-nombre').all_inner_texts()
    ok('Resultado: Hawas Ice y 9AM Dive', 'Hawas Ice' in nombres and '9AM Dive' in nombres, nombres)
    ok('Mejor opción marcada', pg.locator('.rec.mejor .rec-mejor').count() == 1)
    ok('Explica por qué coincide', pg.locator('.rec-por').count() == len(nombres))
    ok('Botón WhatsApp de asesoría con respuestas', 'para%20%C3%A9l' in (pg.get_attribute('.q-wa', 'href') or ''))
    pg.screenshot(path=f'{S}/shots/q4-resultado.png', full_page=False)
    # agregar desde el resultado
    pg.click('.rec.mejor [data-accion=agregar]'); pg.wait_for_timeout(200)
    ok('Agregar no borra la luna del cuestionario', len(pg.get_attribute('.q-luna .lp-luz', 'd') or '') > 10)
    ok('Agregar desde resultado muestra contador', pg.locator('.rec.mejor .paso output').inner_text() == '1')
    ok('La tarjeta del catálogo también se actualiza', pg.locator('.tarjeta .paso').count() == 1)
    # ficha desde el resultado y volver
    pg.click('.rec:nth-child(2) .rec-abrir'); pg.wait_for_timeout(450)
    ok('Abre la ficha encima del cuestionario', pg.locator('#hoja-ficha[open]').count() == 1)
    pg.click('#hoja-ficha .cerrar'); pg.wait_for_timeout(450)
    ok('Al cerrar la ficha sigue el cuestionario', pg.locator('#hoja-quiz[open]').count() == 1)
    pg.click('[data-accion=quiz-reiniciar]'); pg.wait_for_timeout(350)
    elegir('Para ella'); elegir('De noche'); elegir('Dulce'); elegir('Que se note')
    ok('Ella + noche + dulce → Yara Tous', 'Yara Tous' in pg.locator('.rec-nombre').all_inner_texts())
    pg.screenshot(path=f'{S}/shots/q5-resultado-ella.png')
    pg.click('[data-accion=quiz-catalogo]'); pg.wait_for_timeout(500)
    ok('"Ver Damas" cierra y abre el catálogo de damas', pg.locator('#hoja-quiz[open]').count() == 0 and pg.get_attribute('#tab-damas', 'aria-selected') == 'true')

    # ---- caja de 6
    pg.click('#tab-caballeros'); pg.wait_for_timeout(200)
    pg.click('.bp-boton'); pg.wait_for_timeout(700)
    ok('Caja: 1 de 6 lleno', pg.locator('.caja-slot.lleno').count() == 1)
    ok('Sugerencias para completar', pg.locator('.sug').count() >= 3)
    pg.screenshot(path=f'{S}/shots/c1-caja-1.png')
    primeras = pg.locator('.sug-nombre').all_inner_texts()[:3]
    for i in range(3):
        pg.click('.sug:first-child .sug-agregar'); pg.wait_for_timeout(250)
    ok('Agregar desde sugerencias llena la caja (4 de 6)', pg.locator('.caja-slot.lleno').count() == 4)
    ok('Lo agregado sale de las sugerencias', not any(n in pg.locator('.sug-nombre').all_inner_texts() for n in primeras))
    pg.wait_for_timeout(700); pg.screenshot(path=f'{S}/shots/c2-caja-4.png')
    pg.click('.lineas .linea:first-child [data-accion=mas]'); pg.wait_for_timeout(150)
    pg.click('.lineas .linea:first-child [data-accion=mas]'); pg.wait_for_timeout(800)
    ok('Con 6: caja completa', pg.locator('.caja.caja-llena').count() == 1)
    ok('Con 6: precio mayorista', 'mayorista' in pg.inner_text('.pm-titulo').lower())
    ok('Con 6: sin sugerencias', pg.locator('.completa').is_hidden())
    pg.screenshot(path=f'{S}/shots/c3-caja-completa.png')
    pg.click('.lineas .linea:first-child [data-accion=mas]'); pg.wait_for_timeout(300)
    ok('Con 7: "+1 frasco más"', '+1' in pg.inner_text('.caja-extra'))
    ok('Caja accesible (valor 6 de 6)', pg.get_attribute('.caja', 'aria-valuenow') == '6')
    # escritorio
    pg.set_viewport_size({'width': 1280, 'height': 860}); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{S}/shots/c4-escritorio.png')
    ok('Sin errores en la consola', not errs, errs)
    b.close()
print(f'\n{sum(res)} correctas, {len(res) - sum(res)} fallidas.')
