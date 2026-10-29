/**
 * Prueba completa del punto de venta sobre una COPIA de la hoja (nunca sobre la original).
 * Uso: en la copia, pega este archivo junto a PuntoDeVenta.gs y ejecuta posPruebaEnCopia().
 * Hace ventas, caja, ajuste y anulación de verdad, y revisa que las fórmulas de la hoja respondan.
 */
function posPruebaEnCopia() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // solo en una copia cuyo nombre diga PRUEBA (así nunca toca la hoja real)
  if (!/PRUEBA/.test(ss.getName())) throw new Error('Esta hoja no se llama "… PRUEBA …": la prueba solo se corre en una copia de prueba.');
  var log = [], fallas = 0;
  var ok = function (n, c, extra) { log.push((c ? '✓ ' : '✗ ') + n + (c ? '' : '  → ' + JSON.stringify(extra))); if (!c) fallas++; };
  var ahora = new Date();
  // como la app: escribe y luego pide el estado aparte
  var posAtenderYEstado_ = function (ss_, req, t) { var r = posAtender_(ss_, req, t); if (req.accion === 'estado') return r; var e = posAtender_(ss_, { accion: 'estado' }, t); e.resultado = r.resultado; return e; };
  POS_TZ = ss.getSpreadsheetTimeZone();

  var e = posAtender_(ss, { accion: 'estado' }, ahora);
  ok('Lee el estado', e.ok && e.productos.length > 0, e.productos.length);
  ok('Productos con referencia y precio', e.productos.every(function (p) { return p.ref && p.precio > 0; }), e.productos.filter(function (p) { return !(p.precio > 0); }).map(function (p) { return p.ref; }));
  ok('Precio mayorista numérico (IMPORTRANGE)', e.productos.filter(function (p) { return p.mayor > 0; }).length > 0, e.productos.slice(0, 3).map(function (p) { return p.mayor; }));
  ok('Configuración: mínimo mayorista ' + e.config.minimoMayor + ', tipo de cambio ' + e.config.tipoCambio, e.config.minimoMayor > 0 && e.config.tipoCambio > 0, e.config);
  log.push('   Productos: ' + e.productos.length + ' · Clientes: ' + e.clientes.length + ' · Siguiente venta: #' + e.siguienteVenta + ' · Fecha: ' + e.fecha);

  var conStock = e.productos.filter(function (p) { return p.stock >= 2; });
  var p1 = conStock[0], p2 = conStock[1] || conStock[0];
  var stockAntes = p1.stock;

  // Venta 1: 1 unidad en efectivo
  var r1 = posAtenderYEstado_(ss, { accion: 'venta', id: 'prueba-1', venta: { id: 'prueba-1', cliente: null, lineas: [{ ref: p1.ref, cantidad: 1, precio: p1.precio }], pago: { metodo: 'Efectivo' } } }, ahora);
  var n1 = r1.resultado.numero;
  ok('Venta #' + n1 + ' registrada', n1 === e.siguienteVenta, r1.resultado);
  var hv = ss.getSheetByName('Ventas');
  var fila1 = posUltima_(hv, 6, 1003);
  var v = hv.getRange(fila1, 1, 1, 22).getValues()[0];
  ok('Fila con número, perfume, cantidad y precio', v[1] === n1 && v[5] === p1.ref && v[6] === 1 && v[7] === p1.precio, v);
  ok('El total lo calcula la fórmula de la hoja', Number(v[9]) === p1.precio, v[9]);
  ok('La ganancia la calcula la hoja', typeof v[13] === 'number', v[13]);
  ok('Sin alertas de la hoja', !v[19], v[19]);
  ok('La fecha es la de hoy', posDia_(v[0]) === Math.floor(posSerie_(posHoyNica_(ahora))), [v[0], e.fecha]);
  var p1b = posProductos_(ss).filter(function (p) { return p.ref === p1.ref; })[0];
  ok('El stock del Inventario bajó solo (' + stockAntes + ' → ' + p1b.stock + ')', p1b.stock === stockAntes - 1, p1b.stock);

  // Venta 2: cliente nuevo, transferencia, varias líneas
  var r2 = posAtenderYEstado_(ss, { accion: 'venta', id: 'prueba-2', venta: { id: 'prueba-2', cliente: { nombre: 'PRUEBA POS CLIENTE', telefono: '8888-0000', ciudad: 'Estelí', nuevo: true },
    lineas: [{ ref: p1.ref, cantidad: 1, precio: p1.mayor || p1.precio }, { ref: p2.ref, cantidad: 1, precio: p2.precio, descuento: 10 }], pago: { metodo: 'Transferencia bancaria', banco: 'BAC' } } }, ahora);
  var n2 = r2.resultado.numero;
  var ult = posUltima_(hv, 6, 1003);
  var f2 = hv.getRange(ult - 1, 1, 2, 22).getValues();
  ok('Venta #' + n2 + ': dos líneas con el mismo número', f2[0][1] === n2 && f2[1][1] === n2, [f2[0][1], f2[1][1]]);
  ok('Cliente, banco y descuento en la hoja', f2[0][2] === 'PRUEBA POS CLIENTE' && f2[0][21] === 'BAC' && f2[1][8] === 10, [f2[0][2], f2[0][21], f2[1][8]]);
  ok('El teléfono lo trae la fórmula desde Clientes', String(f2[0][3]) === '8888-0000', f2[0][3]);
  ok('Encabezado "Banco" en Ventas', hv.getRange(3, 22).getValue() === 'Banco');

  // Reintento: no duplica
  var r2b = posAtenderYEstado_(ss, { accion: 'venta', id: 'prueba-2', venta: { id: 'prueba-2', lineas: [{ ref: p1.ref, cantidad: 1, precio: 1 }], pago: { metodo: 'Efectivo' } } }, ahora);
  ok('Un reintento no duplica la venta', r2b.resultado.repetida === true && posUltima_(hv, 6, 1003) === ult, r2b.resultado);

  // Caja
  posAtenderYEstado_(ss, { accion: 'caja', id: 'c1', caja: { tipo: 'apertura', monto: 1000 } }, ahora);
  var rs = posAtenderYEstado_(ss, { accion: 'caja', id: 'c2', caja: { tipo: 'salida', monto: 100, concepto: 'PRUEBA bolsas', gasto: e.config.gastos[0] || 'Otros' } }, ahora);
  ok('Efectivo esperado = 1000 + venta en efectivo − 100', rs.caja.resumen.esperado === 1000 + p1.precio - 100, rs.caja.resumen);
  ok('Transferencia BAC sumada', rs.caja.resumen.bancos.BAC > 0, rs.caja.resumen.bancos);
  var hg = ss.getSheetByName('Gastos');
  var fg = hg.getRange(posUltima_(hg, 1, 503), 1, 1, 4).getValues()[0];
  ok('La salida como gasto llegó a Gastos', fg[2] === 'PRUEBA bolsas' && fg[3] === 100, fg);

  // Ajuste
  var stockAj = posProductos_(ss).filter(function (p) { return p.ref === p2.ref; })[0].stock;
  posAtenderYEstado_(ss, { accion: 'ajuste', id: 'a1', ajuste: { ref: p2.ref, cantidad: -1, motivo: 'Dañado', nota: 'PRUEBA' } }, ahora);
  var stockAj2 = posProductos_(ss).filter(function (p) { return p.ref === p2.ref; })[0].stock;
  ok('El ajuste baja el stock (' + stockAj + ' → ' + stockAj2 + ')', stockAj2 === stockAj - 1, stockAj2);

  // Anular la venta 1
  var antesAnular = posProductos_(ss).filter(function (p) { return p.ref === p1.ref; })[0].stock;
  posAtenderYEstado_(ss, { accion: 'anular', id: 'an1', numero: n1 }, ahora);
  var g = hv.getRange(fila1, 1, 1, 22).getValues()[0];
  ok('Anular vacía las celdas de la venta', g[0] === '' && g[5] === '' && g[6] === '', g);
  ok('Y repone la fórmula automática de precio', !!hv.getRange(fila1, 8).getFormula(), hv.getRange(fila1, 8).getFormula());
  var despues = posProductos_(ss).filter(function (p) { return p.ref === p1.ref; })[0].stock;
  ok('El stock vuelve (' + antesAnular + ' → ' + despues + ')', despues === antesAnular + 1, despues);

  var cierre = posAtenderYEstado_(ss, { accion: 'caja', id: 'c3', caja: { tipo: 'cierre', monto: 900 } }, ahora);
  ok('Cierre: esperado 900 tras anular la venta en efectivo', cierre.resultado.esperado === 900 && cierre.resultado.diferencia === 0, cierre.resultado);

  var texto = (fallas ? '❌ ' + fallas + ' FALLAS' : '✅ TODO BIEN') + '\n' + log.join('\n');
  Logger.log(texto);
  return texto;
}
