# Catálogo web MN Scents

Web estática para Cloudflare Pages (plan gratuito). Sin compilación: el directorio de salida es la raíz (`/`).

- `index.html`, `css/`, `js/`, `fonts/`, `img/`: la web.
- `data/productos.json`: el catálogo que lee la web. Lo genera `scripts/sync.mjs` desde la hoja de Google; no lo edites a mano.
- `img/productos/`: fotos de los perfumes. El nombre de cada archivo va en la columna `foto` de la hoja.
- `.github/workflows/sincronizar.yml`: tarea que lee la hoja cada hora (variable del repositorio `SHEET_CSV_URL`).
- `scripts/test-logica.mjs`: pruebas de precios, mayoreo y mensaje de WhatsApp (`node scripts/test-logica.mjs`).

Reglas de precios: con 6 unidades o más de perfumes disponibles, todo el pedido usa el precio por mayor; con menos, el precio al detalle. Agotado y Coming soon no se pueden pedir ni cuentan para el mayoreo.

WhatsApp de pedidos: +505 8473-5485 (en `js/precios.js`).

## Encuentra tu perfume y caja de 6
- `js/recomendar.js`: las 4 preguntas y la recomendación. Solo usa la columna `notas` de la hoja: un perfume sin notas no aparece en el cuestionario. Enlace directo: `https://mnscents.pages.dev/#encuentra`.
- La caja de 6 del pedido y las sugerencias para completarla están en `js/app.js` (`pintarCaja`, `pintarSugeridos`).
- Pruebas: `node scripts/test-logica.mjs` (usa una copia fija de los datos del PDF en `scripts/fixtures/`), `python3 scripts/test-navegador.py <carpeta>` y `python3 scripts/test-quiz-caja.py <carpeta>` con un servidor local.

## Seguridad
- No hay panel de administración ni servidor propio: la "administración" son tus cuentas de Google (hoja), GitHub (código) y Cloudflare (publicación). Protégelas con verificación en dos pasos.
- Ningún secreto vive en este repositorio ni en la web. El repositorio es público: no subas nunca contraseñas, claves ni datos privados.
- El mensaje de WhatsApp lleva "Verificar pedido: …/#pedido=…". Ábrelo antes de confirmar un pedido: los precios se recalculan desde el catálogo, aunque el cliente haya editado el texto.
- `.github/workflows/verificar-web.yml` revisa cada lunes la web publicada (cabeceras, archivos internos, claves expuestas). También se puede correr a mano en Actions.
- Pruebas locales: `python3 scripts/test-seguridad.py <carpeta>` (usa `scripts/servidor-pages.py`, que imita Cloudflare Pages).

## Existencias conectadas al sistema (MNScents_claude)
- La columna `existencias` (P) de la hoja de la web ya no se escribe a mano: la fórmula de P2 trae el "Stock actual" (columna R) de la hoja Inventario del sistema MNScents_claude, buscando el SKU de la columna `sku_inventario` (R).
- Perfume nuevo en la web: llena su fila y copia en `sku_inventario` el SKU que tiene en Inventario (columna A). Sin SKU, la web no limita sus unidades (la sincronización avisa).
- Si la conexión falla (#REF!) o todo llega en 0, la sincronización no publica nada y la web conserva las existencias anteriores.

## Herramientas para clientes y mayoristas
Todo funciona en el navegador del cliente: sin cuentas, sin servidores ni servicios de pago.

- **Mapa de aromas** (`js/mapa.js`, `js/mapa-ui.js`, enlace `#mapa`): cada perfume con notas es una estrella. Horizontal: fresco ← → cálido; vertical: suave/de día ↔ intenso/de noche. La posición sale solo de las notas de la hoja (la página dice que es aproximada). La luna se arrastra (o se mueve con las flechas) y muestra los 3 perfumes más cercanos; tocar una estrella dibuja su constelación (perfumes con notas en común). Un perfume sin notas no aparece: agrégale notas en la hoja.
- **Mi racha mayorista** (`js/racha.js`): al enviar por WhatsApp un pedido de 6+ se guarda la fecha en el teléfono del cliente. Durante 6 días, desde 1 perfume va a precio mayorista; después, desde 3 perfumes cada 30 días (contados desde la última compra). Siempre dice "por confirmar": el mensaje y el enlace de verificación (`#pedido=…&racha=AAAAMMDD`) muestran la fecha, y la verificación enseña también el total sin racha. **Confírmala con la hoja de Ventas antes de aceptar el precio.** Las reglas están en `RACHA` dentro de `js/racha.js`.
- **Calcula tu ganancia** (`js/ganancia.js`, `#ganancia`): usa el pedido; costo = precio mayorista publicado; el revendedor escribe sus precios y gastos (envío, empaque…). No sugerimos precios.
- **Catálogo de reventa** (`js/catalogo-reventa.js`, `#reventa`): imagen 1080×1920 con hasta 6 perfumes disponibles, los precios y el teléfono del revendedor y su logo opcional. Sin marca de MN Scents. Tiene 3 pestañas (Perfumes · Tu negocio · Tu imagen).
- **Acceso al catálogo de reventa** (`js/acceso.js`, `acceso.html`): el catálogo de reventa solo se abre con un **enlace de acceso** (`https://mnscents.pages.dev/#acceso=…`). MN Scents los crea en `https://mnscents.pages.dev/acceso` (página oculta, sin enlaces desde la web): nombre del cliente, vigencia (30 días, 3 meses, 6 meses o 1 año) y "Enviar por WhatsApp". Cada enlace va firmado (ECDSA P-256) con la **llave privada**, que solo tiene el dueño: se crea en su teléfono con "Generar mi llave" y nunca sale de ahí. La página le muestra un **código público** (`MNS-x.y`) que se copia en `js/acceso-clave.js`; al publicarse, la llave queda activada sola. La página ofrece una **copia de seguridad** (`…/acceso#llave=…`) para recuperarla en otro teléfono. La web comprueba la firma con la llave pública (`js/acceso-clave.js`); nadie puede inventar un enlace ni cambiarle el nombre o la fecha. Un enlace no se puede anular antes de que venza; si hiciera falta, se cambia el par de llaves (todos los enlaces anteriores dejan de servir). Límite honesto: como la imagen se crea en el teléfono, alguien con conocimientos técnicos podría saltarse el candado modificando la página en su propio navegador; para el cliente normal, sin enlace no hay catálogo.
- **Lo más pedido del mes**: la hoja de la web tiene la columna `pedidos_30d` (viene de la columna "Pedidos 30 días" del Inventario del sistema, por SKU). La sincronización publica **solo el puesto** (top 3 por catálogo, mínimo 2 pedidos); el número no se publica. Si hay ranking, reemplaza la etiqueta manual "Más vendido".

Pruebas: `node scripts/test-logica.mjs`, y con `python3 scripts/servidor-pages.py 8770 &` → `python3 scripts/test-herramientas.py <carpeta>`. Las pruebas de navegador usan el catálogo fijo `scripts/fixtures/productos-web.json` y una llave de prueba (`scripts/fixtures/llave-prueba.json`, no sirve en la web publicada).
