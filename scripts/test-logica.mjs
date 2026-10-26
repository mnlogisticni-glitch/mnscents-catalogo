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
const rf = await convertir(cab + 'X1,Damas,P,M,,,,1390,38,905,24.55,Disponible,../../etc/passwd,Sí,1\nX2,Damas,Q,M,,,,1390,38,905,24.55,Disponible,"x.webp"" onerror=""alert(1)",Sí,2\nX3,Damas,R,M,,,,1390,38,905,24.55,Disponible,buena-foto.webp,Sí,3\n', { comprobarFotos: false });
prueba('Foto: solo acepta un nombre de archivo de imagen (sin carpetas ni código)', () => {
  assert.equal(rf.productos.find(p => p.id === 'X1').foto, null);
  assert.equal(rf.productos.find(p => p.id === 'X2').foto, null);
  assert.equal(rf.productos.find(p => p.id === 'X3').foto, 'buena-foto.webp');
  assert.equal(rf.avisos.filter(a => a.includes('no es un nombre de archivo válido')).length, 2);
});
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
// ---------- Existencias conectadas al Inventario ----------
const cabInv = 'id,catalogo,nombre,marca,presentacion,notas,descripcion,precio_detalle_cs,precio_detalle_usd,precio_mayor_cs,precio_mayor_usd,estado,foto,mostrar,orden,existencias,etiqueta,sku_inventario\n';
const rRef = await convertir(cabInv + 'H01,Caballeros,A,M,,,,1460,40,1080,29.5,Disponible,,Sí,1,#REF!,,6294015149371\n', { comprobarFotos: false });
const rInv = await convertir(cabInv + 'H01,Caballeros,A,M,,,,1460,40,1080,29.5,Disponible,,Sí,1,6,,6294015149371\nH02,Caballeros,B,M,,,,1460,40,1080,29.5,Disponible,,Sí,2,,,\n', { comprobarFotos: false });
const rCero = await convertir(cabInv + ['H01','H02','H03'].map((id, i) => `${id},Caballeros,P${i},M,,,,1460,40,1080,29.5,Disponible,,Sí,${i + 1},0,,62940151493${i}`).join('\n') + '\n', { comprobarFotos: false });
prueba('Inventario: si TODO viene en 0 no publica (conexión rota, no ventas)', () => {
  assert.ok(rCero.errores.some(e => /problema de conexión/.test(e)), JSON.stringify(rCero.errores));
});
prueba('Inventario: el SKU no se publica en la web', () => {
  assert.ok(rInv.productos.every(p => !('_sku' in p)));
});
prueba('Inventario: un #REF! en existencias detiene la publicación con un mensaje claro', () => {
  assert.ok(rRef.errores.some(e => /Permitir acceso/.test(e)), JSON.stringify(rRef.errores));
});
prueba('Inventario: existencias que vienen de la fórmula se respetan y avisa si falta el SKU', () => {
  assert.equal(rInv.errores.length, 0, JSON.stringify(rInv.errores));
  assert.equal(rInv.productos.find(p => p.id === 'H01').existencias, 6);
  assert.ok(rInv.avisos.some(a => /\(B\)|H02|Fila 3/.test(a) && /SKU/.test(a)), JSON.stringify(rInv.avisos));
});

// ---------- Comparar ----------
const { comparar, candidatos, leerComparar } = await import('../js/comparar.js');
prueba('Comparar: notas en común y precio más económico salen de la hoja', () => {
  const a = cat.get('H10'), b = cat.get('H09');   // Hawas Ice y 9AM Dive
  const c = comparar(a, b);
  for (const n of c.comunes) assert.ok(a.notas.includes(n) && b.notas.some(x => x.toLowerCase() === n.toLowerCase()));
  assert.equal(c.difDetalleCS, Math.abs(a.precios.detalle.cs - b.precios.detalle.cs));
  const barato = a.precios.detalle.cs < b.precios.detalle.cs ? 'H10' : b.precios.detalle.cs < a.precios.detalle.cs ? 'H09' : null;
  assert.equal(c.masBaratoDetalle, barato);
  assert.equal(c.comunes.length + c.soloA.length, a.notas.length);
});
prueba('Comparar: mismo precio no marca a ninguno como más económico', () => {
  const a = { id: 'A', notas: [], precios: { detalle: { cs: 100 }, mayor: { cs: 80 } } };
  const b = { id: 'B', notas: [], precios: { detalle: { cs: 100 }, mayor: { cs: 70 } } };
  const c = comparar(a, b);
  assert.equal(c.masBaratoDetalle, null); assert.equal(c.masBaratoMayor, 'B');
});
prueba('Comparar: candidatos excluyen el elegido y empiezan por su catálogo', () => {
  const a = cat.get('H10'); const l = candidatos(datos.productos, a);
  assert.ok(!l.some(p => p.id === 'H10'));
  assert.equal(l.length, datos.productos.length - 1);
  assert.equal(l[0].catalogo, 'caballeros');
});
prueba('Comparar: el enlace se lee sin confiar en él', () => {
  assert.deepEqual(leerComparar('H10,H09'), ['H10', 'H09']);
  assert.deepEqual(leerComparar('H10,H10'), ['H10']);
  assert.deepEqual(leerComparar('<img>,H09,D01'), ['H09']);
  assert.deepEqual(leerComparar('../x,'), []);
});

// ---------- Verificación del pedido ----------
const { leerPedidoEnlace, enlaceVerificacion } = await import('../js/precios.js');
prueba('Verificación: el mensaje incluye el enlace con códigos y cantidades', () => {
  const ped = calcular([{ id: 'H01', qty: 2 }, { id: 'D05', qty: 1 }], cat);
  assert.ok(mensajeWhatsApp(ped).includes('Verificar pedido: https://mnscents.pages.dev/#pedido=H01-2,D05-1'));
  assert.equal(enlaceVerificacion(ped), 'https://mnscents.pages.dev/#pedido=H01-2,D05-1');
});
prueba('Verificación: el enlace se lee sin confiar en él', () => {
  assert.deepEqual(leerPedidoEnlace('H01-2,D05-1'), [{ id: 'H01', qty: 2 }, { id: 'D05', qty: 1 }]);
  assert.deepEqual(leerPedidoEnlace('<img src=x>-1,H01-0,H01--5,H01-1e9,H01-100,../x-1'), []);
  assert.deepEqual(leerPedidoEnlace('H01-3,H01-9'), [{ id: 'H01', qty: 3 }]);
  assert.equal(leerPedidoEnlace(Array.from({ length: 200 }, (_, i) => `A${i}-1`).join(',')).length, 60);
});

// ---------- Encuentra tu perfume ----------
const { recomendar, opcionesAroma, PREGUNTAS, GRUPOS, perfil } = await import('../js/recomendar.js');
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
prueba('Tu estilo: título según respuestas, en femenino para ella', () => {
  const r1 = { para: 'caballeros', momento: 'noche', aroma: 'calido', fuerza: 'notar' };
  assert.equal(perfil(r1, recomendar(datos.productos, r1)).titulo, 'Misterioso y cálido');
  const r2 = { para: 'damas', momento: 'noche', aroma: 'calido', fuerza: 'notar' };
  assert.equal(perfil(r2, recomendar(datos.productos, r2)).titulo, 'Misteriosa y cálida');
  const r3 = { para: 'damas', momento: 'dia', aroma: 'fresco', fuerza: 'suave' };
  assert.equal(perfil(r3, recomendar(datos.productos, r3)).titulo, 'Relajada y fresca');
  for (const r of todas) assert.ok(!/estel/i.test(perfil(r, recomendar(datos.productos, r)).titulo));
});
prueba('Tu estilo: la mezcla sale solo de las notas de los perfumes recomendados', () => {
  for (const r of todas) {
    const res = recomendar(datos.productos, r);
    const pf = perfil(r, res);
    const notas = [...res.principales, res.pronto].filter(Boolean).flatMap(x => x.producto.notas.map(sinTilde));
    for (const m of pf.mezcla) {
      assert.ok(m.valor > 0 && m.valor <= 1);
      assert.ok(notas.some(n => GRUPOS[m.id].includes(n)), `${m.id} sin notas reales`);
    }
    if (pf.mezcla.length) assert.equal(pf.mezcla[0].valor, 1);
  }
});
prueba('Cuestionario: él + de día + fresco → Hawas Ice y 9AM Dive', () => {
  const ids = recomendar(datos.productos, { para: 'caballeros', momento: 'dia', aroma: 'fresco', fuerza: 'suave' }).principales.map(x => x.producto.id);
  assert.ok(ids.includes('H10') && ids.includes('H09'), ids.join(','));
});

// ---------- Racha mayorista ----------
console.log('\nRacha mayorista (se guarda en el teléfono, siempre por confirmar)');
const { estadoRacha, registrarEnvio, validarRacha, RACHA } = await import('../js/racha.js');
const { leerRachaEnlace } = await import('../js/precios.js');
const DIA = 86400000, T0 = Date.UTC(2026, 9, 1, 18);
const items6 = [{ id: 'H01', qty: 3 }, { id: 'H03', qty: 3 }];
prueba('Una compra de 6 activa la racha; de 5 no', () => {
  assert.equal(registrarEnvio(null, 5, [{ id: 'H01', qty: 5 }], T0), null);
  const r = registrarEnvio(null, 6, items6, T0);
  assert.equal(r.inicio, T0); assert.equal(r.primeraUsada, false); assert.deepEqual(r.pedido, items6);
});
const rA = registrarEnvio(null, 6, items6, T0);
prueba('Primeros 6 días: desde 1 perfume a precio mayorista', () => {
  const e = estadoRacha(rA, T0 + 2 * DIA);
  assert.equal(e.activa, true); assert.equal(e.etapa, 'primera'); assert.equal(e.minimo, 1); assert.equal(e.dias, 4);
});
prueba('Después de 6 días: desde 3 perfumes, hasta 30 días desde la última compra', () => {
  const e = estadoRacha(rA, T0 + 7 * DIA);
  assert.equal(e.etapa, 'mantener'); assert.equal(e.minimo, 3); assert.equal(e.dias, 23);
  assert.equal(estadoRacha(rA, T0 + 31 * DIA).activa, false);
  assert.equal(estadoRacha(rA, T0 + 31 * DIA).vencida, true);
});
prueba('La compra de 1 en los 6 días usa la primera y reinicia los 30 días', () => {
  const r2 = registrarEnvio(rA, 1, [{ id: 'H01', qty: 1 }], T0 + 3 * DIA);
  assert.equal(r2.primeraUsada, true); assert.equal(r2.ultima, T0 + 3 * DIA);
  const e = estadoRacha(r2, T0 + 4 * DIA);
  assert.equal(e.etapa, 'mantener'); assert.equal(e.minimo, 3);
  assert.equal(estadoRacha(r2, T0 + 33 * DIA).activa, true);
  assert.equal(estadoRacha(r2, T0 + 34 * DIA).activa, false);
});
prueba('Comprar 2 en etapa de mantener no cuenta; 3 sí', () => {
  const t = T0 + 10 * DIA;
  assert.equal(registrarEnvio(rA, 2, [{ id: 'H01', qty: 2 }], t), rA);
  assert.equal(registrarEnvio(rA, 3, [{ id: 'H01', qty: 3 }], t).ultima, t);
});
prueba('Racha vencida: una compra de 3 no la revive; una de 6 sí', () => {
  const t = T0 + 40 * DIA;
  assert.equal(registrarEnvio(rA, 3, [{ id: 'H01', qty: 3 }], t), rA);
  assert.equal(registrarEnvio(rA, 6, items6, t).inicio, t);
});
prueba('Datos guardados manipulados se descartan', () => {
  assert.equal(validarRacha({ inicio: 'x', ultima: 5 }), null);
  assert.equal(validarRacha({ inicio: 10, ultima: 5 }), null);
  const v = validarRacha({ inicio: 5, ultima: 6, primeraUsada: 'sí', pedido: [{ id: '<img>', qty: 1 }, { id: 'H01', qty: 2 }, { id: 'H02', qty: 500 }] });
  assert.deepEqual(v, { inicio: 5, ultima: 6, primeraUsada: false, pedido: [{ id: 'H01', qty: 2 }] });
});
prueba('Reglas iguales a la sección de mayoristas (6 días · 1, 30 días · 3)', () => {
  assert.deepEqual(RACHA, { diasPrimera: 6, minPrimera: 1, diasMantener: 30, minMantener: 3 });
});
prueba('Carrito con racha: 1 o 3 unidades a precio mayorista, marcado "por racha"', () => {
  const p1 = calcular([{ id: 'H01', qty: 1 }], cat, { minimoMayor: 1 });
  assert.equal(p1.nivel, 'mayor'); assert.equal(p1.porRacha, true); assert.equal(p1.totalCS, cat.get('H01').precios.mayor.cs);
  const p2 = calcular([{ id: 'H01', qty: 2 }], cat, { minimoMayor: 3 });
  assert.equal(p2.nivel, 'detalle'); assert.equal(p2.porRacha, false);
  const p6 = calcular([{ id: 'H01', qty: 6 }], cat, { minimoMayor: 3 });
  assert.equal(p6.porRacha, false); assert.equal(p6.nivel, 'mayor');
  assert.equal(calcular([{ id: 'H01', qty: 1 }], cat, { minimoMayor: 0 }).nivel, 'detalle');
});
prueba('Mensaje de WhatsApp dice "por confirmar" y el enlace lleva la fecha', () => {
  const p1 = calcular([{ id: 'H01', qty: 1 }], cat, { minimoMayor: 1 });
  const m = mensajeWhatsApp(p1, { racha: { ultima: '26/10/2026', enlace: '20261026' } });
  assert.ok(m.includes('MAYORISTA POR RACHA, por confirmar (mi última compra mayorista: 26/10/2026)'));
  assert.ok(m.includes('#pedido=H01-1&racha=20261026'));
  const sin = mensajeWhatsApp(calcular([{ id: 'H01', qty: 1 }], cat));
  assert.ok(!sin.includes('racha'));
});
prueba('Enlace de verificación con racha: se leen pedido y fecha; fechas falsas se ignoran', () => {
  assert.deepEqual(leerPedidoEnlace('H01-1,H03-2&racha=20261026'), [{ id: 'H01', qty: 1 }, { id: 'H03', qty: 2 }]);
  assert.equal(leerRachaEnlace('H01-1&racha=20261026').texto, '26/10/2026');
  assert.equal(leerRachaEnlace('H01-1&racha=20261399'), null);
  assert.equal(leerRachaEnlace('H01-1&racha=<script>'), null);
  assert.equal(enlaceVerificacion(calcular([{ id: 'H01', qty: 1 }], cat), 'x/', 'malo'), 'x/#pedido=H01-1');
});

// ---------- Calculadora de ganancia ----------
console.log('\nCalculadora de ganancia para revendedores');
const { calcularGanancia, precioConMargen, leerMonto } = await import('../js/ganancia.js');
prueba('Ganancia = ventas − costo mayorista − gastos (incluye el envío)', () => {
  const g = calcularGanancia([{ qty: 2, costo: 995, venta: 1500 }, { qty: 4, costo: 1150, venta: 1600 }], [{ monto: 300 }, { monto: '100' }]);
  assert.equal(g.inversionProductos, 2 * 995 + 4 * 1150);
  assert.equal(g.totalGastos, 400);
  assert.equal(g.venta, 3000 + 6400);
  assert.equal(g.ganancia, 9400 - 6590 - 400);
  assert.equal(g.porFrasco, (9400 - 6590 - 400) / 6);
  assert.ok(Math.abs(g.margen - 2410 / 9400) < 1e-9);
});
prueba('Sin precio de venta en alguna línea no se inventa la ganancia total', () => {
  const g = calcularGanancia([{ qty: 1, costo: 995, venta: 1500 }, { qty: 1, costo: 900, venta: '' }]);
  assert.equal(g.completas, false); assert.equal(g.ganancia, null);
  assert.equal(g.lineas[0].gananciaUnit, 505); assert.equal(g.lineas[1].gananciaUnit, null);
});
prueba('Vender por debajo del costo muestra pérdida', () => {
  assert.equal(calcularGanancia([{ qty: 1, costo: 1000, venta: 900 }], [{ monto: 50 }]).ganancia, -150);
});
prueba('% de ganancia sobre el costo, redondeado hacia arriba a C$5; montos raros se ignoran', () => {
  assert.equal(precioConMargen(995, 30), 1295);
  assert.equal(precioConMargen(1000, 0), 1000);
  assert.equal(precioConMargen(1000, -5), 0);
  assert.equal(leerMonto('C$1,450'), 1450); assert.equal(leerMonto('-20'), 20);
  assert.equal(leerMonto('abc'), 0); assert.equal(leerMonto('99999999999'), 0);
});

// ---------- Mapa de aromas ----------
console.log('\nMapa de aromas');
const { ubicar, cercanos, notasComunes, centros, puntoDeQuiz } = await import('../js/mapa.js');
const pts = ubicar(datos.productos);
prueba('Solo aparecen perfumes con notas, todos dentro del mapa y sin encimarse', () => {
  assert.equal(pts.length, datos.productos.filter(p => p.notas.length).length);
  for (const p of pts) assert.ok(p.x >= 0.08 && p.x <= 0.92 && p.y >= 0.08 && p.y <= 0.92, p.producto.id);
  for (const a of pts) for (const b of pts) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 0.08, `${a.producto.id}-${b.producto.id}`);
});
prueba('Siempre el mismo mapa (no cambia de lugar entre visitas)', () => {
  const otra = ubicar(datos.productos);
  assert.deepEqual(otra.map(p => [p.producto.id, p.x, p.y]), pts.map(p => [p.producto.id, p.x, p.y]));
});
prueba('Frescos a la izquierda y cálidos a la derecha (según sus notas)', () => {
  const prom = f => { const l = pts.filter(p => p.familia === f); return l.reduce((s, p) => s + p.x, 0) / l.length; };
  assert.ok(prom('fresco') < 0.5 && prom('calido') > 0.5);
});
prueba('Cercanos, notas en común, centros y punto del quiz', () => {
  const c = cercanos(pts, 0.1, 0.9, 3);
  assert.equal(c.length, 3); assert.ok(c[0].d <= c[1].d && c[1].d <= c[2].d);
  assert.deepEqual(notasComunes({ notas: ['Cítrico', 'Dulce'] }, { notas: ['citrico', 'Ámbar'] }), ['Cítrico']);
  assert.ok(centros(pts).every(x => x.n > 0));
  assert.equal(puntoDeQuiz({}), null);
  const q = puntoDeQuiz({ aroma: 'calido', momento: 'noche', fuerza: 'notar' });
  assert.ok(q.x > 0.5 && q.y < 0.5);
});

// ---------- Lo más pedido ----------
console.log('\nLo más pedido del mes');
const cabP = cab.trim() + ',pedidos_30d\n';
const rp = await convertir(cabP
  + 'A1,Caballeros,A,M,,,,1390,38,905,24.55,Disponible,,Sí,1,5\n'
  + 'A2,Caballeros,B,M,,,,1390,38,905,24.55,Disponible,,Sí,2,9\n'
  + 'A3,Caballeros,C,M,,,,1390,38,905,24.55,Disponible,,Sí,3,1\n'
  + 'A4,Caballeros,D,M,,,,1390,38,905,24.55,Disponible,,Sí,4,5\n'
  + 'A5,Caballeros,E,M,,,,1390,38,905,24.55,Disponible,,Sí,5,4\n'
  + 'B1,Damas,F,M,,,,1390,38,905,24.55,Disponible,,Sí,1,#REF!\n', { comprobarFotos: false });
prueba('Top 3 por catálogo; mínimo 2 pedidos; empate por orden; no se publica la cantidad', () => {
  const t = Object.fromEntries(rp.productos.map(p => [p.id, p.top]));
  assert.deepEqual(t, { A1: 2, A2: 1, A3: undefined, A4: 3, A5: undefined, B1: undefined });
  assert.ok(rp.productos.every(p => !('_pedidos' in p) && !('pedidos_30d' in p)));
  assert.equal(rp.errores.length, 0);
  assert.ok(rp.avisos.some(a => a.includes('pedidos_30d')));
});
const rsin = await convertir(cab + 'A1,Caballeros,A,M,,,,1390,38,905,24.55,Disponible,,Sí,1\n', { comprobarFotos: false });
prueba('Sin la columna, nadie tiene puesto', () => { assert.ok(rsin.productos.every(p => p.top === undefined)); });

// ---------- Catálogo de reventa ----------
console.log('\nCatálogo de reventa');
const { rejilla, limpiar, limpiarTelefono } = await import('../js/catalogo-reventa.js');
prueba('Rejilla para 1 a 6 perfumes', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(n => rejilla(n)), [{ cols: 1, filas: 1 }, { cols: 2, filas: 1 }, { cols: 2, filas: 2 }, { cols: 2, filas: 2 }, { cols: 2, filas: 3 }, { cols: 2, filas: 3 }]);
});
prueba('Textos del revendedor se limpian (sin controles, con límite)', () => {
  assert.equal(limpiar('  Perfumes\n\tAna  ', 40), 'Perfumes Ana');
  assert.equal(limpiar('x'.repeat(80), 40).length, 40);
  assert.equal(limpiarTelefono('+505 8888-1234 <b>'), '+505 8888-1234');
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas.`);
process.exit(fallos ? 1 : 0);
