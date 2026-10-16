// Pruebas de la Fase 8 (datos, estados, carrito, mayoreo, totales y WhatsApp).
// Uso: node scripts/test-logica.mjs
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { calcular, mensajeWhatsApp, enlaceWhatsApp, fmtCS, fmtUSD, esComprable } from '../js/precios.js';
import { convertir } from './sync.mjs';

let ok = 0, fallos = 0;
const prueba = (nombre, fn) => { try { fn(); ok++; console.log('  ✓ ' + nombre); } catch (e) { fallos++; console.log('  ✗ ' + nombre + '\n    ' + e.message); } };

// Precios y estados tal como aparecen en los PDF (con las correcciones confirmadas por el dueño)
// [id, catálogo, detalle C$, detalle US$, mayor C$, mayor US$, estado]
const PDF = [
  ['H01','caballeros',1460,40.00,1080,29.30,'disponible'],  ['H02','caballeros',1490,40.60,1095,29.85,'coming_soon'],
  ['H03','caballeros',1490,40.60,1065,28.95,'disponible'],  ['H04','caballeros',2380,65.00,1845,50.50,'disponible'],
  ['H05','caballeros',1490,40.60,1150,31.25,'disponible'],  ['H06','caballeros',1390,38.00,905,24.55,'disponible'],
  ['H07','caballeros',1200,32.55,755,20.50,'coming_soon'],  ['H08','caballeros',1390,38.00,970,26.30,'disponible'],
  ['H09','caballeros',1490,40.60,1095,29.85,'disponible'],  ['H10','caballeros',1930,52.40,1495,40.60,'disponible'],
  ['H11','caballeros',2010,55.00,1485,40.50,'agotado'],     ['H12','caballeros',1690,45.90,1310,35.65,'disponible'],
  ['H13','caballeros',1760,48.00,1345,36.55,'disponible'],  ['H14','caballeros',1490,40.60,1080,29.30,'coming_soon'],
  ['H15','caballeros',1490,40.60,1145,31.15,'disponible'],  ['H16','caballeros',1950,53.00,1475,39.95,'coming_soon'],
  ['D01','damas',1490,40.60,1095,29.85,'disponible'],       ['D02','damas',1390,38.00,905,24.55,'disponible'],
  ['D03','damas',1390,38.00,925,25.10,'coming_soon'],       ['D04','damas',1390,38.00,935,25.40,'coming_soon'],
  ['D05','damas',1390,38.00,965,26.20,'disponible'],        ['D06','damas',1390,38.00,1080,29.30,'disponible'],
];

const datos = JSON.parse(await readFile(new URL('./fixtures/productos-pdf.json', import.meta.url), 'utf8'));
const cat = new Map(datos.productos.map(p => [p.id, p]));

console.log('\n1–3. Datos frente a los PDF');
prueba('22 perfumes registrados (16 caballeros, 6 damas)', () => {
  assert.equal(datos.productos.length, 22);
  assert.equal(datos.productos.filter(p => p.catalogo === 'caballeros').length, 16);
  assert.equal(datos.productos.filter(p => p.catalogo === 'damas').length, 6);
});
prueba('Cada precio y estado coincide con el PDF', () => {
  for (const [id, c, dcs, dusd, mcs, musd, est] of PDF) {
    const p = cat.get(id); assert.ok(p, `falta ${id}`);
    assert.equal(p.catalogo, c, id); assert.equal(p.estado, est, `${id} estado`);
    assert.deepEqual(p.precios, { detalle: { cs: dcs, usd: dusd }, mayor: { cs: mcs, usd: musd } }, `${id} precios`);
  }
});
prueba('Cada producto tiene su foto', () => { for (const p of datos.productos) assert.ok(p.foto, p.nombre); });

console.log('\n4–7. Carrito, barra de mayoreo y totales');
const t = items => calcular(items, cat);
prueba('Carrito vacío', () => { const r = t([]); assert.equal(r.unidades, 0); assert.equal(r.totalCS, 0); assert.equal(r.nivel, 'detalle'); assert.equal(r.faltan, 6); });
prueba('1 de 6 → detalle', () => { const r = t([{ id: 'H03', qty: 1 }]); assert.equal(r.nivel, 'detalle'); assert.equal(r.totalCS, 1490); assert.equal(r.totalUSD, 40.6); assert.equal(r.faltan, 5); });
prueba('3 de 6 → detalle', () => { const r = t([{ id: 'H03', qty: 3 }]); assert.equal(r.nivel, 'detalle'); assert.equal(r.totalCS, 4470); });
prueba('5 de 6 → detalle, faltan 1', () => { const r = t([{ id: 'H03', qty: 2 }, { id: 'D05', qty: 3 }]); assert.equal(r.nivel, 'detalle'); assert.equal(r.faltan, 1); assert.equal(r.totalCS, 2 * 1490 + 3 * 1390); });
prueba('6 de 6 (3+3 de perfumes distintos) → mayorista', () => {
  const r = t([{ id: 'H03', qty: 3 }, { id: 'D05', qty: 3 }]);
  assert.equal(r.nivel, 'mayor'); assert.equal(r.unidades, 6); assert.equal(r.progreso, 1);
  assert.equal(r.totalCS, 3 * 1065 + 3 * 965); assert.equal(r.totalUSD, 165.45);
});
prueba('10 unidades → sigue mayorista', () => { const r = t([{ id: 'H10', qty: 4 }, { id: 'H04', qty: 6 }]); assert.equal(r.nivel, 'mayor'); assert.equal(r.totalCS, 4 * 1495 + 6 * 1845); assert.equal(r.totalUSD, 465.4); });
prueba('Baja de 6 a 5 → vuelve a detalle', () => {
  const items = [{ id: 'H03', qty: 3 }, { id: 'D05', qty: 3 }];
  assert.equal(t(items).nivel, 'mayor'); items[1].qty = 2; const r = t(items);
  assert.equal(r.nivel, 'detalle'); assert.equal(r.totalCS, 3 * 1490 + 2 * 1390);
});
prueba('Agotado y coming soon no cuentan ni se cobran', () => {
  const r = t([{ id: 'H11', qty: 3 }, { id: 'H02', qty: 2 }, { id: 'H03', qty: 5 }]);
  assert.equal(r.unidades, 5); assert.equal(r.nivel, 'detalle'); assert.equal(r.totalCS, 5 * 1490);
  assert.equal(r.noDisponibles.length, 2);
});
prueba('Subtotales por línea correctos y sin errores de redondeo', () => {
  const r = t([{ id: 'H06', qty: 7 }]);  // 7 × $24.55 = $171.85
  assert.equal(r.lineas[0].subUSD, 171.85); assert.equal(r.totalUSD, 171.85); assert.equal(r.lineas[0].subCS, 6335);
  const r2 = t([{ id: 'H09', qty: 3 }]); // 3 × $40.60 = $121.80
  assert.equal(r2.totalUSD, 121.8);
});
prueba('Formato de moneda', () => { assert.equal(fmtCS(12345), 'C$12,345'); assert.equal(fmtUSD(1234.5), '$1,234.50'); assert.equal(fmtUSD(40.6), '$40.60'); });

console.log('\n8. Mensaje de WhatsApp');
prueba('Mensaje completo y enlace codificado', () => {
  const r = t([{ id: 'H08', qty: 4 }, { id: 'D06', qty: 2 }]);
  const m = mensajeWhatsApp(r);
  for (const s of ['PEDIDO MN SCENTS', "Bade'e Al Oud For Glory (Lattafa)", 'Cantidad: 4', 'Precio unitario: C$970 / $26.30',
    'Subtotal: C$3,880 / $105.20', 'Set Yara 4 piezas', 'Total de unidades: 6', 'MAYORISTA', 'TOTAL: C$6,040 / $163.80', 'Nombre:', 'Dirección de entrega:'])
    assert.ok(m.includes(s), 'falta: ' + s);
  const url = enlaceWhatsApp(m);
  assert.ok(url.startsWith('https://wa.me/50584735485?text='));
  assert.equal(decodeURIComponent(url.split('text=')[1]), m);
  assert.ok(url.includes('Direcci%C3%B3n'), 'tildes codificadas');
});
prueba('Mensaje al detalle lo indica', () => { const m = mensajeWhatsApp(t([{ id: 'D05', qty: 1 }])); assert.ok(m.includes('AL DETALLE')); assert.ok(m.includes('TOTAL: C$1,390 / $38.00')); });

console.log('\nSincronización: validación de la hoja');
const cab = 'id,catalogo,nombre,marca,presentacion,notas,descripcion,precio_detalle_cs,precio_detalle_usd,precio_mayor_cs,precio_mayor_usd,estado,foto,mostrar,orden\n';
const r1 = await convertir(cab + 'X1,Damas,Prueba,M,,,,1390,38,,25,Disponible,,Sí,1\n', { comprobarFotos: false });
prueba('Rechaza precio mayorista vacío (no lo inventa)', () => assert.ok(r1.errores.some(e => e.includes('precio mayor C$'))));
const r2 = await convertir(cab + 'X1,Damas,Prueba,M,,,,"1,390","38,00",905,"24,55",Coming soon,,Sí,1\n', { comprobarFotos: false });
prueba('Acepta números con coma y estado "Coming soon"', () => { assert.equal(r2.errores.length, 0); assert.equal(r2.productos[0].precios.detalle.cs, 1390); assert.equal(r2.productos[0].precios.mayor.usd, 24.55); assert.equal(r2.productos[0].estado, 'coming_soon'); });
const r3 = await convertir(cab + 'X1,Damas,Prueba,M,,,,1390,38,905,24.55,Vendido,,Sí,1\nX1,Hombres,Otro,M,,,,1390,38,905,24.55,Disponible,,No,2\n', { comprobarFotos: false });
prueba('Detecta estado inválido e id repetido; "No" oculta', () => { assert.ok(r3.errores.some(e => e.includes('estado'))); assert.ok(r3.errores.some(e => e.includes('repetido'))); });
const r4 = await convertir(cab.replace('foto,', 'imagen,') + 'X1,Damas,P,M,,,,1,1,1,1,Disponible,,Sí,1\n', { comprobarFotos: false }).catch(e => e);
prueba('Detecta columnas renombradas', () => assert.ok(String(r4.message).includes('Faltan columnas')));

console.log('\nExistencias');
prueba('Hawas Elixir: piden 10, se cobra 1 (hay 1)', () => {
  const r = t([{ id: 'H12', qty: 10 }]);
  assert.equal(r.lineas[0].qty, 1); assert.equal(r.lineas[0].ajustada, true); assert.equal(r.unidades, 1); assert.equal(r.totalCS, 1690);
});
prueba('El tope cuenta para el mayoreo con las unidades reales', () => {
  const r = t([{ id: 'H12', qty: 3 }, { id: 'H03', qty: 4 }]); // 1 + 4 = 5 → detalle
  assert.equal(r.unidades, 5); assert.equal(r.nivel, 'detalle');
});
prueba('Sin existencias registradas no hay tope (hasta 99)', () => { const r = t([{ id: 'H03', qty: 40 }]); assert.equal(r.lineas[0].qty, 40); assert.equal(r.lineas[0].ajustada, false); });
const cabE = cab.trim() + ',existencias\n';
const r5 = await convertir(cabE + 'X1,Damas,P,M,,,,1390,38,905,24.55,Disponible,,Sí,1,0\nX2,Damas,Q,M,,,,1390,38,905,24.55,Disponible,,Sí,2,2\n', { comprobarFotos: false });
prueba('Existencias 0 se publica como Agotado; 2 queda Disponible', () => { assert.equal(r5.errores.length, 0); assert.equal(r5.productos[0].estado, 'agotado'); assert.equal(r5.productos[1].existencias, 2); assert.equal(r5.productos[1].estado, 'disponible'); });
const r6 = await convertir(cabE + 'X1,Damas,P,M,,,,1390,38,905,24.55,Disponible,,Sí,1,dos\n', { comprobarFotos: false });
prueba('Existencias inválidas se rechazan', () => assert.ok(r6.errores.some(e => e.includes('existencias'))));
const r7 = await convertir(cab + 'X1,Damas,P,M,,,,1390,38,905,24.55,Disponible,,Sí,1\n', { comprobarFotos: false });
prueba('La columna existencias es opcional', () => { assert.equal(r7.errores.length, 0); assert.equal(r7.productos[0].existencias, null); });

console.log('\nEtiquetas');
const cabT = cab.trim() + ',existencias,etiqueta\n';
const r8 = await convertir(cabT + 'X1,Damas,P,M,,,,1390,38,905,24.55,Disponible,,Sí,1,,Más vendido\nX2,Damas,Q,M,,,,1390,38,905,24.55,Disponible,,Sí,2,,nuevo\nX3,Damas,R,M,,,,1390,38,905,24.55,Disponible,,Sí,3,,oferta\n', { comprobarFotos: false });
prueba('Más vendido / Nuevo se reconocen; otra palabra solo avisa', () => {
  assert.equal(r8.errores.length, 0);
  assert.deepEqual(r8.productos.map(p => p.etiqueta), ['top', 'nuevo', null]);
  assert.ok(r8.avisos.some(a => a.includes('oferta')));
});
// ---------- Encuentra tu perfume ----------
const { recomendar, opcionesAroma, PREGUNTAS, GRUPOS } = await import('../js/recomendar.js');
const sinTilde = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const todas = [];
for (const para of ['caballeros', 'damas']) for (const momento of ['dia', 'noche', 'todo'])
  for (const aroma of ['fresco', 'dulce', 'calido', 'floral']) for (const fuerza of ['suave', 'notar'])
    todas.push({ para, momento, aroma, fuerza });

prueba('Cuestionario: 4 preguntas con sus opciones', () => {
  assert.deepEqual(PREGUNTAS.map(q => q.id), ['para', 'momento', 'aroma', 'fuerza']);
});
prueba('Cuestionario: solo recomienda perfumes disponibles del catálogo elegido', () => {
  for (const r of todas) for (const x of recomendar(datos.productos, r).principales) {
    assert.equal(x.producto.catalogo, r.para);
    assert.ok(esComprable(x.producto), `${x.producto.nombre} no está disponible`);
  }
});
prueba('Cuestionario: nunca recomienda agotados ni perfumes sin notas', () => {
  for (const r of todas) {
    const res = recomendar(datos.productos, r);
    for (const x of [...res.principales, res.pronto].filter(Boolean)) {
      assert.notEqual(x.producto.estado, 'agotado');
      assert.ok(x.producto.notas.length > 0);
    }
  }
});
prueba('Cuestionario: cada recomendación exacta tiene una nota del aroma elegido', () => {
  for (const r of todas) {
    const res = recomendar(datos.productos, r);
    if (!res.exacto) continue;
    for (const x of res.principales)
      assert.ok(x.producto.notas.some(n => GRUPOS[r.aroma].includes(sinTilde(n))), `${x.producto.nombre} no es ${r.aroma}`);
  }
});
prueba('Cuestionario: "Pronto" solo muestra Coming soon y como máximo 3 principales', () => {
  for (const r of todas) {
    const res = recomendar(datos.productos, r);
    assert.ok(res.principales.length <= 3);
    if (res.pronto) assert.equal(res.pronto.producto.estado, 'coming_soon');
  }
});
prueba('Cuestionario: solo ofrece aromas que existen en ese catálogo', () => {
  for (const cat of ['caballeros', 'damas']) for (const o of opcionesAroma(datos.productos, cat))
    assert.ok(datos.productos.some(p => p.catalogo === cat && p.estado !== 'agotado' && p.notas.some(n => GRUPOS[o.id].includes(sinTilde(n)))));
});
prueba('Cuestionario: él + de día + fresco → Hawas Ice y 9AM Dive', () => {
  const ids = recomendar(datos.productos, { para: 'caballeros', momento: 'dia', aroma: 'fresco', fuerza: 'suave' }).principales.map(x => x.producto.id);
  assert.ok(ids.includes('H10') && ids.includes('H09'), ids.join(','));
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas.`);
process.exit(fallos ? 1 : 0);
