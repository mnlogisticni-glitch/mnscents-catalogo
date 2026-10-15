# Catálogo web MN Scents

Web estática para Cloudflare Pages (plan gratuito). Sin compilación: el directorio de salida es la raíz (`/`).

- `index.html`, `css/`, `js/`, `fonts/`, `img/`: la web.
- `data/productos.json`: el catálogo que lee la web. Lo genera `scripts/sync.mjs` desde la hoja de Google; no lo edites a mano.
- `img/productos/`: fotos de los perfumes. El nombre de cada archivo va en la columna `foto` de la hoja.
- `.github/workflows/sincronizar.yml`: tarea que lee la hoja cada hora (variable del repositorio `SHEET_CSV_URL`).
- `scripts/test-logica.mjs`: pruebas de precios, mayoreo y mensaje de WhatsApp (`node scripts/test-logica.mjs`).

Reglas de precios: con 6 unidades o más de perfumes disponibles, todo el pedido usa el precio por mayor; con menos, el precio al detalle. Agotado y Coming soon no se pueden pedir ni cuentan para el mayoreo.

WhatsApp de pedidos: +505 8473-5485 (en `js/precios.js`).
