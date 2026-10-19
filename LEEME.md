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
