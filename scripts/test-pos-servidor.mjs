// Prueba el script del punto de venta (scripts/pos/PuntoDeVenta.gs) con una hoja simulada en memoria.
// Uso: node scripts/test-pos-servidor.mjs
import assert from 'node:assert/strict';

let ok = 0, fallos = 0;
const prueba = (n, fn) => { try { fn(); ok++; console.log('  ✓ ' + n); } catch (e) { fallos++; console.log('  ✗ ' + n + '\n    ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n    ')); } };

import { libroBase, ctx, gas, props, Hoja } from './pos-hoja-simulada.mjs';
const crudo = (L, req, ahora) => ctx.posAtender_(L, req, ahora);
// como la app: escribe y después pide el estado
const atender = (L, req, ahora) => {
  const r = crudo(L, req, ahora);
  if (req.accion === 'estado') return r;
  const e = crudo(L, { accion: 'estado' }, ahora);
  e.resultado = r.resultado;
  return e;
};
// 29/10/2026 11:30 en Nicaragua (17:30 UTC)
const AHORA = new Date(Date.UTC(2026, 9, 29, 17, 30));
const DIA = Math.floor((Date.UTC(2026, 9, 29) - Date.UTC(1899, 11, 30)) / 864e5);

console.log('\nEstado inicial');
prueba('Lee productos con referencia, precios, mayorista y stock', () => {
  const e = atender(libroBase(), { accion: 'estado' }, AHORA);
  assert.equal(e.ok, true); assert.equal(e.productos.length, 3);
  const p = e.productos[0];
  assert.deepEqual([p.sku, p.ref, p.precio, p.mayor, p.stock, p.genero], ['111', 'ARMAF MANDARIN SKY - 100ML (111)', 1460, 985, 10, 'Hombre']);
  assert.equal(e.config.minimoMayor, 6); assert.equal(e.config.tipoCambio, 36.8); assert.deepEqual(e.config.gastos, ['Publicidad', 'Envíos', 'Empaques']);
  assert.equal(e.siguienteVenta, 8); assert.equal(e.clientes[0].nombre, 'ANA');
  assert.equal(e.fecha, '29/10/2026');
});
prueba('Crea la hoja Caja la primera vez, con sus títulos', () => {
  const L = libroBase(); atender(L, { accion: 'estado' }, AHORA);
  assert.ok(L.hojas['Caja']); assert.equal(L.hojas['Caja'].celda(3, 2), 'Tipo'); assert.equal(L.hojas['Caja'].celda(3, 10), 'ID (no tocar)');
});

console.log('\nVentas');
const ventaBase = (extra = {}) => ({ id: 'v-1', cliente: null, lineas: [{ ref: 'ARMAF MANDARIN SKY - 100ML (111)', cantidad: 2, precio: 1460 }], pago: { metodo: 'Efectivo', recibido: 3000 }, ...extra });
prueba('Una venta escribe solo las celdas de entrada, en la siguiente fila libre', () => {
  const L = libroBase();
  const e = atender(L, { accion: 'venta', venta: ventaBase() }, AHORA);
  const v = L.hojas['Ventas'];
  assert.equal(e.resultado.numero, 8);
  assert.deepEqual([v.celda(5, 1), v.celda(5, 2), v.celda(5, 3), v.celda(5, 5), v.celda(5, 6), v.celda(5, 7), v.celda(5, 8), v.celda(5, 11), v.celda(5, 12), v.celda(5, 22)],
    [DIA, 8, '', 'Estelí', 'ARMAF MANDARIN SKY - 100ML (111)', 2, 1460, 'Efectivo', 'Pagado', '']);
  assert.equal(v.celda(5, 4), '', 'el teléfono lo pone la fórmula'); assert.equal(v.fmt['5,1'], 'd/m/yyyy');
  assert.equal(v.celda(3, 22), 'Banco');
});
prueba('Varias líneas comparten el mismo número de venta', () => {
  const L = libroBase();
  atender(L, { accion: 'venta', venta: ventaBase({ lineas: [{ ref: 'ARMAF MANDARIN SKY - 100ML (111)', cantidad: 4, precio: 985 }, { ref: 'AFNAN 9PM - 100ML (222)', cantidad: 2, precio: 975 }] }) }, AHORA);
  const v = L.hojas['Ventas'];
  assert.deepEqual([v.celda(5, 2), v.celda(6, 2), v.celda(6, 6), v.celda(6, 8)], [8, 8, 'AFNAN 9PM - 100ML (222)', 975]);
});
prueba('Transferencia guarda el banco; sin banco no deja', () => {
  const L = libroBase();
  atender(L, { accion: 'venta', venta: ventaBase({ pago: { metodo: 'Transferencia bancaria', banco: 'Banpro' } }) }, AHORA);
  assert.deepEqual([L.hojas['Ventas'].celda(5, 11), L.hojas['Ventas'].celda(5, 22)], ['Transferencia bancaria', 'Banpro']);
  assert.throws(() => atender(libroBase(), { accion: 'venta', venta: ventaBase({ id: 'x', pago: { metodo: 'Transferencia bancaria' } }) }, AHORA), /banco/);
});
prueba('Cliente nuevo se agrega a Clientes y queda en la venta', () => {
  const L = libroBase();
  atender(L, { accion: 'venta', venta: ventaBase({ cliente: { nombre: 'Luis Pérez', telefono: '8777-2222', ciudad: 'León', nuevo: true } }) }, AHORA);
  assert.deepEqual([L.hojas['Clientes'].celda(5, 1), L.hojas['Clientes'].celda(5, 2), L.hojas['Clientes'].celda(5, 3)], ['Luis Pérez', '8777-2222', 'León']);
  assert.deepEqual([L.hojas['Ventas'].celda(5, 3), L.hojas['Ventas'].celda(5, 5)], ['Luis Pérez', 'León']);
});
prueba('Un cliente "nuevo" que ya existe no se duplica', () => {
  const L = libroBase();
  atender(L, { accion: 'venta', venta: ventaBase({ cliente: { nombre: 'ana', nuevo: true } }) }, AHORA);
  assert.equal(L.hojas['Clientes'].celda(5, 1), ''); assert.equal(L.hojas['Ventas'].celda(5, 3), 'ANA');
});
prueba('La misma venta enviada dos veces (sin señal) se guarda una sola vez', () => {
  const L = libroBase();
  atender(L, { accion: 'venta', venta: ventaBase() }, AHORA);
  const e = atender(L, { accion: 'venta', venta: ventaBase() }, AHORA);
  assert.equal(e.resultado.repetida, true); assert.equal(L.hojas['Ventas'].celda(6, 6), '');
});
prueba('Datos malos no se guardan', () => {
  for (const mala of [ventaBase({ lineas: [] }), ventaBase({ lineas: [{ ref: 'NO EXISTE', cantidad: 1, precio: 100 }] }), ventaBase({ lineas: [{ ref: 'ARMAF MANDARIN SKY - 100ML (111)', cantidad: 0, precio: 100 }] }),
    ventaBase({ lineas: [{ ref: 'ARMAF MANDARIN SKY - 100ML (111)', cantidad: 1, precio: 0 }] }), ventaBase({ pago: { metodo: 'Bitcoin' } })]) {
    const L = libroBase();
    assert.throws(() => atender(L, { accion: 'venta', venta: mala }, AHORA));
    assert.equal(L.hojas['Ventas'].celda(5, 6), '');
  }
});
prueba('La venta queda en la caja y en el resumen del día', () => {
  const L = libroBase();
  const e = atender(L, { accion: 'venta', venta: ventaBase() }, AHORA);
  assert.equal(e.caja.movimientos.length, 1); assert.equal(e.caja.movimientos[0].tipo, 'Venta'); assert.equal(e.caja.movimientos[0].monto, 2920);
  assert.equal(e.caja.resumen.ventasEfectivo, 2920); assert.equal(e.hoy.total, 2920); assert.equal(e.hoy.unidades, 2);
  assert.equal(e.caja.movimientos[0].hora, '11:30');
});

prueba('Escribir responde enseguida, sin releer toda la hoja', () => {
  const r = crudo(libroBase(), { accion: 'venta', venta: ventaBase() }, AHORA);
  assert.equal(r.ok, true); assert.equal(r.resultado.numero, 8); assert.equal(r.productos, undefined);
});

console.log('\nAnular');
prueba('Anular una venta de hoy vacía sus filas, repone la fórmula de precio y descuenta en caja', () => {
  const L = libroBase();
  atender(L, { accion: 'venta', venta: ventaBase() }, AHORA);
  const e = atender(L, { accion: 'anular', numero: 8 }, AHORA);
  const v = L.hojas['Ventas'];
  assert.deepEqual([v.celda(5, 1), v.celda(5, 6), v.celda(5, 7), v.celda(5, 11)], ['', '', '', '']);
  assert.ok(v.f['5,8'], 'fórmula de precio');
  assert.equal(e.caja.resumen.ventasEfectivo, 0); assert.equal(e.hoy.total, 0);
});
prueba('No deja anular ventas de otro día', () => {
  assert.throws(() => atender(libroBase(), { accion: 'anular', numero: 7 }, AHORA), /de hoy/);
});

console.log('\nCaja');
prueba('Apertura, entrada, salida con gasto, venta y cierre cuadran', () => {
  const L = libroBase();
  atender(L, { accion: 'caja', caja: { tipo: 'apertura', monto: 1000 } }, AHORA);
  assert.throws(() => atender(L, { accion: 'caja', caja: { tipo: 'apertura', monto: 1000 } }, AHORA), /ya está abierta/);
  atender(L, { accion: 'caja', caja: { tipo: 'entrada', monto: 200, concepto: 'Cambio' } }, AHORA);
  atender(L, { accion: 'caja', caja: { tipo: 'salida', monto: 150, concepto: 'Bolsas', gasto: 'Empaques' } }, AHORA);
  atender(L, { accion: 'venta', venta: ventaBase() }, AHORA);
  atender(L, { accion: 'venta', venta: ventaBase({ id: 'v-2', pago: { metodo: 'Transferencia bancaria', banco: 'BAC' } }) }, AHORA);
  const e = atender(L, { accion: 'caja', caja: { tipo: 'cierre', monto: 3950 } }, AHORA);
  const r = e.caja.resumen;
  assert.equal(r.esperado, 1000 + 200 - 150 + 2920); assert.equal(r.bancos.BAC, 2920); assert.equal(r.cerrada, true);
  assert.equal(e.resultado.diferencia, 3950 - 3970);
  const g = L.hojas['Gastos']; assert.deepEqual([g.celda(4, 1), g.celda(4, 2), g.celda(4, 3), g.celda(4, 4)], [DIA, 'Empaques', 'Bolsas', 150]);
});
prueba('Vender antes de abrir la caja cuenta en el efectivo; reabrir tras el cierre empieza de cero', () => {
  const L = libroBase();
  atender(L, { accion: 'venta', venta: ventaBase() }, AHORA);
  let e = atender(L, { accion: 'caja', caja: { tipo: 'apertura', monto: 500 } }, AHORA);
  assert.equal(e.caja.resumen.esperado, 500 + 2920);
  atender(L, { accion: 'caja', caja: { tipo: 'cierre', monto: 3420 } }, AHORA);
  e = atender(L, { accion: 'caja', caja: { tipo: 'apertura', monto: 200 } }, AHORA);
  assert.equal(e.caja.resumen.esperado, 200);
});
prueba('No cierra una caja que no se abrió; montos malos no pasan', () => {
  assert.throws(() => atender(libroBase(), { accion: 'caja', caja: { tipo: 'cierre', monto: 0 } }, AHORA), /no está abierta/);
  assert.throws(() => atender(libroBase(), { accion: 'caja', caja: { tipo: 'salida', monto: -5, concepto: 'x' } }, AHORA));
  assert.throws(() => atender(libroBase(), { accion: 'caja', caja: { tipo: 'entrada', monto: 5 } }, AHORA), /de qué/);
});

console.log('\nAjustes');
prueba('Un ajuste va a la hoja Ajustes con fecha, perfume, cantidad y motivo', () => {
  const L = libroBase();
  atender(L, { accion: 'ajuste', ajuste: { ref: 'AFNAN 9PM - 100ML (222)', cantidad: -1, motivo: 'Dañado', nota: 'tapa rota' } }, AHORA);
  const a = L.hojas['Ajustes'];
  assert.deepEqual([a.celda(4, 1), a.celda(4, 2), a.celda(4, 3), a.celda(4, 4), a.celda(4, 5)], [DIA, 'AFNAN 9PM - 100ML (222)', -1, 'Dañado', 'tapa rota']);
  assert.throws(() => atender(L, { accion: 'ajuste', ajuste: { ref: 'AFNAN 9PM - 100ML (222)', cantidad: 1, motivo: 'Otro' } }, AHORA), /motivo/);
});

prueba('Un ajuste reenviado con el mismo id no se anota dos veces', () => {
  const L = libroBase();
  const req = { accion: 'ajuste', id: 'aj-1', ajuste: { ref: 'AFNAN 9PM - 100ML (222)', cantidad: -1, motivo: 'Dañado' } };
  atender(L, req, AHORA);
  const e = atender(L, req, AHORA);
  assert.equal(e.resultado.repetida, true); assert.equal(L.hojas['Ajustes'].celda(5, 2), '');
});

console.log('\nSeguridad');
prueba('Sin la clave correcta no responde datos', () => {
  gas._libro = libroBase();
  props.POS_TOKEN = 'clave-secreta-de-prueba';
  const r1 = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ accion: 'estado', t: 'otra' }) } }).texto);
  const r2 = JSON.parse(ctx.doPost({ postData: { contents: 'no es json' } }).texto);
  const r3 = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ accion: 'estado', t: 'clave-secreta-de-prueba' }) } }).texto);
  assert.equal(r1.ok, false); assert.equal(r1.productos, undefined); assert.equal(r2.ok, false); assert.equal(r3.ok, true);
  delete props.POS_TOKEN;
  assert.equal(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ accion: 'estado', t: '' }) } }).texto).ok, false);
});
prueba('Las fechas que Sheets devuelve como fecha también se reconocen', () => {
  ctx.POS_TZ = 'America/Los_Angeles';
  const d = new Date(Date.UTC(2026, 9, 29, 7, 0));   // 29/10 00:00 en Los Ángeles
  assert.equal(ctx.posDia_(d), DIA);
});

console.log('\nTipo de venta, premio de la tarjeta, sellos e historial');
const conStallion = () => {
  const L = libroBase(); const inv = L.hojas['Inventario'];
  ['444', 'STALLION 53', 'IMPERIAL', '100ML', 'Amaderada', 'Hombre'].forEach((x, j) => inv.poner(7, j + 1, x));
  inv.poner(7, 11, 900); inv.poner(7, 12, 1400); inv.poner(7, 18, 5); inv.poner(7, 23, 'STALLION 53 IMPERIAL - 100ML (444)'); inv.poner(7, 34, 1000);
  return L;
};
const STALLION = 'STALLION 53 IMPERIAL - 100ML (444)';
prueba('Agrega la columna "Tipo de venta" al final de Ventas y la llena por línea', () => {
  const L = libroBase(); const v = L.hojas['Ventas'];
  assert.equal(v.getMaxColumns(), 22);
  atender(L, { accion: 'venta', venta: ventaBase({ lineas: [{ ref: 'ARMAF MANDARIN SKY - 100ML (111)', cantidad: 6, precio: 985, tipo: 'Mayorista' }] }) }, AHORA);
  assert.equal(v.getMaxColumns(), 23); assert.equal(v.celda(3, 23), 'Tipo de venta'); assert.equal(v.celda(5, 23), 'Mayorista');
  atender(L, { accion: 'venta', venta: ventaBase({ id: 'otra', lineas: [{ ref: 'AFNAN 9PM - 100ML (222)', cantidad: 1, precio: 1490, tipo: 'Inventado' }] }) }, AHORA);
  assert.equal(v.celda(6, 23), 'Detalle', 'un tipo desconocido queda como Detalle'); assert.equal(v.getMaxColumns(), 23);
});
prueba('"Detalle sin sello" (precio especial) se guarda tal cual', () => {
  const L = libroBase();
  atender(L, { accion: 'venta', venta: ventaBase({ lineas: [{ ref: 'ARMAF MANDARIN SKY - 100ML (111)', cantidad: 1, precio: 1300, tipo: 'Detalle sin sello' }] }) }, AHORA);
  assert.equal(L.hojas['Ventas'].celda(5, 23), 'Detalle sin sello');
});
prueba('El premio de la tarjeta: Stallion 53 a C$0 con cliente; sin cliente u otra marca no', () => {
  const L = conStallion();
  const e = atender(L, { accion: 'venta', venta: ventaBase({ cliente: { nombre: 'ANA' }, lineas: [{ ref: STALLION, cantidad: 1, precio: 1400, canje: true }], pago: {} }) }, AHORA);
  const v = L.hojas['Ventas'];
  assert.deepEqual([v.celda(5, 3), v.celda(5, 6), v.celda(5, 8), v.celda(5, 11), v.celda(5, 23)], ['ANA', STALLION, 0, 'Efectivo', 'Canje']);
  assert.equal(e.resultado.total, 0); assert.match(e.caja.movimientos[0].concepto, /premio de la tarjeta/);
  for (const malo of [
    ventaBase({ id: 'a', lineas: [{ ref: STALLION, cantidad: 1, canje: true }] }),                                         // sin cliente
    ventaBase({ id: 'b', cliente: { nombre: 'ANA' }, lineas: [{ ref: 'AFNAN 9PM - 100ML (222)', cantidad: 1, canje: true }] }),   // no es Stallion 53
    ventaBase({ id: 'c', cliente: { nombre: 'ANA' }, lineas: [{ ref: STALLION, cantidad: 2, canje: true }] }),               // dos gratis
  ]) assert.throws(() => atender(conStallion(), { accion: 'venta', venta: malo }, AHORA));
  // premio + compra normal en la misma venta: se cobra solo lo comprado
  const L2 = conStallion();
  atender(L2, { accion: 'venta', venta: ventaBase({ cliente: { nombre: 'ANA' }, lineas: [{ ref: STALLION, cantidad: 1, canje: true }, { ref: 'AFNAN 9PM - 100ML (222)', cantidad: 1, precio: 1490, tipo: 'Detalle' }] }) }, AHORA);
  assert.deepEqual([L2.hojas['Ventas'].celda(5, 23), L2.hojas['Ventas'].celda(6, 23), L2.hojas['Ventas'].celda(6, 11)], ['Canje', 'Detalle', 'Efectivo']);
});
prueba('Ajuste de sellos: crea la hoja Fidelidad, no se repite y vuelve en el estado', () => {
  const L = libroBase();
  atender(L, { accion: 'sellos', id: 's1', sellos: { id: 's1', cliente: 'ANA', sellos: 5, nota: 'Tarjeta de papel' } }, AHORA);
  const r = atender(L, { accion: 'sellos', id: 's1', sellos: { id: 's1', cliente: 'ANA', sellos: 5 } }, AHORA);
  assert.equal(r.resultado.repetida, true);
  const f = L.hojas['Fidelidad'];
  assert.deepEqual([f.celda(3, 1), f.celda(4, 2), f.celda(4, 3), f.celda(4, 4), f.celda(4, 5)], ['Fecha y hora', 'ANA', 'Ajuste', 5, 'Tarjeta de papel']);
  assert.equal(f.celda(5, 2), '');
  assert.deepEqual(JSON.parse(JSON.stringify(r.fidelidad)), [[DIA, 'ANA', 5, 'Tarjeta de papel']]);
  for (const malo of [{ cliente: '', sellos: 1 }, { cliente: 'ANA', sellos: 0 }, { cliente: 'ANA', sellos: 99 }]) assert.throws(() => atender(libroBase(), { accion: 'sellos', sellos: malo }, AHORA));
});
prueba('El estado trae historial compacto (con código del perfume), metas y día', () => {
  const L = libroBase();
  const e = atender(L, { accion: 'venta', venta: ventaBase({ cliente: { nombre: 'ANA' }, lineas: [{ ref: 'AFNAN 9PM - 100ML (222)', cantidad: 1, precio: 1490, descuento: 90, tipo: 'Detalle' }] }) }, AHORA);
  assert.equal(e.dia, DIA);
  const h = JSON.parse(JSON.stringify(e.historial));
  assert.deepEqual(h[0].slice(0, 9), [45000, 7, 'ANA', '111', 1, 1460, 0, 1460, 'Efectivo']);
  const ult = h[h.length - 1];
  assert.deepEqual([ult[0], ult[1], ult[2], ult[3], ult[4], ult[5], ult[6], ult[7], ult[11]], [DIA, 8, 'ANA', '222', 1, 1490, 90, 1400, 'Detalle']);
  assert.equal(typeof e.config.metaVentas, 'number'); assert.equal(typeof e.config.metaGanancia, 'number');
  assert.equal(e.fidelidad.length, 0);
});
prueba('Anular una venta también borra su tipo', () => {
  const L = libroBase();
  atender(L, { accion: 'venta', venta: ventaBase({ lineas: [{ ref: 'ARMAF MANDARIN SKY - 100ML (111)', cantidad: 1, precio: 1460, tipo: 'Detalle' }] }) }, AHORA);
  atender(L, { accion: 'anular', numero: 8 }, AHORA);
  assert.equal(L.hojas['Ventas'].celda(5, 23), '');
});

console.log('\nCosto promedio de lo que hay en stock');
const J = x => JSON.parse(JSON.stringify(x));
prueba('El caso del 9PM Elixir: 5 iniciales, vende 4, quita 1 y llegan 5 → C$1,144.50; las ventas viejas guardan C$1,093', () => {
  const r = J(ctx.posCostosCalcular_([{ ref: 'E', inicial: 5, precio: 964, imp: 129 }],
    [{ dia: 300, ref: 'E', cantidad: 5, precio: 954.5, imp: 190 }],
    [{ dia: 100, ref: 'E', cantidad: 2, fila: 0 }, { dia: 150, ref: 'E', cantidad: 1, fila: 1 }, { dia: 151, ref: 'E', cantidad: 1, fila: 2 }, { dia: 301, ref: 'E', cantidad: 1, fila: 3 }],
    [{ dia: 300, ref: 'E', cantidad: -1, fila: 0 }]));
  assert.deepEqual(r.productos.E, { precio: 954.5, imp: 190, conocido: true, stock: 4 });
  assert.deepEqual(r.ventas, { 0: 1093, 1: 1093, 2: 1093, 3: 1144.5 });
  assert.deepEqual(r.ajustes, { 0: 1093 }, 'el faltante del mismo día sale antes de la compra (había con qué)');
});
prueba('Si todavía queda stock cuando llega la compra, se mezcla: (1 × 1,093 + 5 × 1,144.50) ÷ 6', () => {
  const r = J(ctx.posCostosCalcular_([{ ref: 'E', inicial: 1, precio: 964, imp: 129 }], [{ dia: 10, ref: 'E', cantidad: 5, precio: 954.5, imp: 190 }], [{ dia: 11, ref: 'E', cantidad: 1, fila: 0 }], []));
  assert.equal(Math.round((r.productos.E.precio + r.productos.E.imp) * 100) / 100, 1135.92); assert.equal(r.ventas[0], 1135.92);
  assert.deepEqual([r.productos.E.precio, r.productos.E.imp], [956.0833, 179.8333]);
});
prueba('Mismo día sin stock: primero entra la compra y la venta usa ese costo', () => {
  const r = J(ctx.posCostosCalcular_([{ ref: 'E', inicial: 0, precio: 900, imp: 100 }], [{ dia: 10, ref: 'E', cantidad: 3, precio: 1100, imp: 100 }], [{ dia: 10, ref: 'E', cantidad: 1, fila: 0 }], []));
  assert.equal(r.ventas[0], 1200);
});
prueba('Sobrante entra al costo del momento; sin ningún costo conocido la venta no guarda costo', () => {
  const r = J(ctx.posCostosCalcular_([{ ref: 'A', inicial: 2, precio: 500, imp: 0 }, { ref: 'B', inicial: 0, precio: 0, imp: 0 }], [],
    [{ dia: 5, ref: 'B', cantidad: 1, fila: 0 }], [{ dia: 4, ref: 'A', cantidad: 1, fila: 0 }]));
  assert.equal(r.ajustes[0], 500); assert.equal(r.productos.A.stock, 3); assert.equal(r.productos.B.conocido, false); assert.equal(r.ventas[0], undefined);
});
const conCompras = () => {
  const L = libroBase(); const c = L.hojas['Compras'] = new Hoja('Compras', 1003, 16);
  // compra recibida del 9PM: 4 a C$900 + C$100 de envío, el 20/10
  [diaDe(2026, 10, 20), 1, 'DUBAI', 'AFNAN 9PM - 100ML (222)', 4, 900, '', 100, '', '', '', 'Recibido'].forEach((x, j) => c.poner(4, j + 1, x));
  const inv = L.hojas['Inventario']; inv.poner(5, 15, 2); inv.poner(5, 29, 700); inv.poner(5, 30, 0);   // 9PM: 2 iniciales a C$700
  inv.poner(5, 9, ''); inv.f['5,9'] = '=IF($A5="","",AC5)'; inv.f['5,10'] = '=IF($A5="","",AD5)';
  return L;
};
const diaDe = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5);
prueba('Instalar: columnas al final, I/J leen el costo del script, ganancia y ajustes usan el costo guardado; se puede repetir', () => {
  const L = conCompras();
  ctx.posInstalarCostos_(L); ctx.posInstalarCostos_(L);
  const inv = L.hojas['Inventario'], ven = L.hojas['Ventas'], aj = L.hojas['Ajustes'];
  assert.equal(inv.getMaxColumns(), 37); assert.match(inv.celda(3, 36), /Costo promedio: compra/);
  assert.equal(inv.f['5,9'], '=IF(ISNUMBER($AJ5),$AJ5,IF($A5="","",AC5))', 'la fórmula vieja queda de respaldo y no se envuelve dos veces');
  assert.equal(ven.getMaxColumns(), 24); assert.match(ven.celda(3, 24), /Costo al vender/); assert.equal(ven.celda(3, 23), 'Tipo de venta');
  assert.equal(ven.f['10,14'], '=IF($F10="","",J10-(G10*IF(ISNUMBER($X10),$X10,IFERROR(INDEX(Inventario!$K$4:$K$303,MATCH($F10,Inventario!$W$4:$W$303,0)),0))))');
  assert.match(aj.f['4,6'], /ISNUMBER\(N4:N503\)/);
  assert.equal(props.POS_COSTOS, '1');
});
prueba('Recalcular: escribe el costo promedio en Inventario y el costo del día en cada venta; vender desde la app lo guarda', () => {
  const L = conCompras(); ctx.posInstalarCostos_(L);
  const ven = L.hojas['Ventas'], inv = L.hojas['Inventario'];
  // venta vieja del 9PM antes de la compra (20/10) y la de la app (29/10) después
  [diaDe(2026, 10, 1), 6, 'ANA', '', 'Estelí', 'AFNAN 9PM - 100ML (222)', 1, 1490, '', 1490, 'Efectivo', 'Pagado'].forEach((x, j) => ven.poner(5, j + 1, x));
  const n = ctx.posRecalcularCostos_(L);
  assert.ok(n >= 2);
  assert.deepEqual([inv.celda(5, 36), inv.celda(5, 37)], [860, 80], 'quedaba 1 a C$700 + llegan 4 a C$900 + C$100 → (700 + 3,600) ÷ 5 y (0 + 400) ÷ 5');
  assert.equal(ven.celda(5, 24), 700);
  assert.equal(ctx.posRecalcularCostos_(L), 0, 'la segunda vez no reescribe nada');
  inv.poner(4, 1, 0); inv.poner(4, 15, 3); inv.poner(4, 29, 800);   // un perfume con SKU 0 también se calcula
  ctx.posRecalcularCostos_(L);
  assert.equal(inv.celda(4, 36), 800);
  atender(L, { accion: 'venta', venta: ventaBase({ lineas: [{ ref: 'AFNAN 9PM - 100ML (222)', cantidad: 1, precio: 1490, tipo: 'Detalle' }] }) }, AHORA);
  assert.equal(ven.celda(6, 24), inv.celda(5, 36) + inv.celda(5, 37));
});

prueba('Editar a mano Compras o Ventas recalcula solo (onEdit); editar otras columnas no', () => {
  const L = conCompras(); ctx.posInstalarCostos_(L); ctx.posRecalcularCostos_(L);
  const inv = L.hojas['Inventario'], com = L.hojas['Compras'];
  const evento = (hoja, fila, col) => ({ source: L, range: { getSheet: () => ({ getName: () => hoja }), getColumn: () => col, getLastColumn: () => col, getRow: () => fila } });
  com.poner(4, 6, 1000);                                   // cambia el precio de la compra
  ctx.onEdit(evento('Ventas', 4, 20));                     // columna Alerta: no recalcula
  assert.equal(inv.celda(5, 36), 833.3333, 'sin cambios todavía: (2 × 700 + 4 × 900) ÷ 6');
  ctx.onEdit(evento('Compras', 4, 6));
  assert.equal(inv.celda(5, 36), 900, 'ahora sí: (2 × 700 + 4 × 1,000) ÷ 6');
  delete props.POS_COSTOS; com.poner(4, 6, 500); ctx.onEdit(evento('Compras', 4, 6));
  assert.equal(inv.celda(5, 36), 900, 'sin instalar no hace nada'); props.POS_COSTOS = '1';
});

console.log('\nDirección de la app web');
prueba('Pide la dirección una vez, la valida, la guarda y la usa en el enlace', () => {
  const respuestas = [];
  const ui = { Button: { OK: 'ok' }, ButtonSet: { OK: 1, OK_CANCEL: 2 }, alertas: [], dialogo: null,
    prompt: () => { const t = respuestas.shift(); return { getSelectedButton: () => t == null ? 'cancel' : 'ok', getResponseText: () => t }; },
    alert(...a) { this.alertas.push(a.join(' | ')); }, showModalDialog(h) { this.dialogo = h; } };
  delete props.POS_URL;
  assert.equal(ctx.posDireccion_(ui, false), null);                                   // canceló
  respuestas.push('https://example.com/no');
  assert.equal(ctx.posDireccion_(ui, false), null); assert.match(ui.alertas.pop(), /no sirve/);
  respuestas.push('  https://script.google.com/macros/s/AKfy_buena-123/exec?x=1 ');
  assert.equal(ctx.posDireccion_(ui, false), 'https://script.google.com/macros/s/AKfy_buena-123/exec');
  assert.equal(ctx.posDireccion_(ui, false), 'https://script.google.com/macros/s/AKfy_buena-123/exec');   // ya no pregunta
  const viejo = gas.SpreadsheetApp.getUi; ctx.SpreadsheetApp.getUi = () => ui;
  ctx.HtmlService = { createHtmlOutput: h => ({ html: h, setWidth() { return this; }, setHeight() { return this; } }) };
  try { ctx.posVincular(); } finally { ctx.SpreadsheetApp.getUi = viejo; }
  const enlace = /#vincular=([A-Za-z0-9_-]+)/.exec(ui.dialogo.html)[1];
  const d = JSON.parse(Buffer.from(enlace, 'base64url').toString());
  assert.equal(d.u, 'https://script.google.com/macros/s/AKfy_buena-123/exec'); assert.ok(d.t.length >= 20);
  assert.match(ui.dialogo.html, /Dirección de la hoja: https:\/\/script\.google\.com\/macros\/s\/AKfy_buena-123\/exec/);
});


console.log('\nEntradas y hoja de la web');
const CAB_WEB = ['id', 'catalogo', 'nombre', 'marca', 'presentacion', 'notas', 'descripcion', 'precio_detalle_cs', 'precio_detalle_usd', 'precio_mayor_cs', 'precio_mayor_usd', 'estado', 'foto', 'mostrar', 'orden', 'existencias', 'etiqueta', 'sku_inventario', 'pedidos_30d'];
const llamadas = [];
const conWeb = ({ github = true, conectada = true } = {}) => {
  const L = conCompras();
  const prov = L.hojas['Proveedores'] = new Hoja('Proveedores', 60, 5); prov.poner(4, 1, 'DUBAI'); prov.poner(5, 1, 'JOMAS SHOP');
  const web = new Hoja('Catálogo web', 100, 19);
  CAB_WEB.forEach((c, j) => web.poner(1, j + 1, c));
  [['H01', 'Caballeros', 'Mandarin Sky', 'Armaf', '', 'Cítrico', '', 1460, 40, 985, 27, 'Disponible', 'mandarin-sky.webp', 'Sí', 1, 10, '', '111', 3],
   ['H02', 'Caballeros', '9PM', 'Afnan', '', 'Dulce', '', 1490, 40.6, 975, 26.45, 'Coming soon', '9pm.webp', 'Sí', 2, 2, '', '222', 1]]
    .forEach((f, i) => f.forEach((x, j) => web.poner(2 + i, j + 1, x)));
  web.f['2,16'] = '=ARRAYFORMULA(existencias)'; web.f['2,19'] = '=ARRAYFORMULA(pedidos)';
  // el 333 (Yara, Mujer, sin stock) no está en la web
  L.web = web;
  ctx.SpreadsheetApp.openById = id => { assert.equal(id, 'WEBID'); return { getSheets: () => [web] }; };
  ctx.UrlFetchApp = { fetch: (url, o) => { llamadas.push({ url, metodo: o.method, cuerpo: o.payload ? JSON.parse(o.payload) : null });
    const codigo = o.method === 'get' ? 404 : o.method === 'put' ? 201 : 204;
    return { getResponseCode: () => codigo, getContentText: () => '{}' }; } };
  llamadas.length = 0;
  if (conectada) props.WEB_ID = 'WEBID'; else delete props.WEB_ID;
  if (github) props.GITHUB_TOKEN = 'github_pat_prueba'; else delete props.GITHUB_TOKEN;
  delete props.WEB_ULTIMO;
  return L;
};
const filaWeb = (web, r) => Object.fromEntries(CAB_WEB.map((c, j) => [c, web.celda(r, j + 1)]));

prueba('Perfume del Inventario que falta en la web se agrega solo (id, orden, US$, Coming soon) sin tocar las columnas con fórmula', () => {
  const L = conWeb(); const web = L.web;
  const res = J(ctx.posWebSincronizar_(L, web, {}));
  assert.equal(res.agregados.length, 1);
  const f = filaWeb(web, 4);
  assert.deepEqual([f.id, f.catalogo, f.nombre, f.marca, f.presentacion, f.precio_detalle_cs, f.precio_detalle_usd, f.precio_mayor_cs, f.precio_mayor_usd, f.estado, f.mostrar, f.orden, f.sku_inventario],
    ['D01', 'Damas', 'Yara', 'Lattafa', '100 ml', 1390, 37.75, 905, 24.6, 'Coming soon', 'Sí', 1, 333]);
  assert.equal(web.celda(4, 16), '', 'existencias la pone la fórmula'); assert.equal(web.celda(4, 19), '', 'pedidos la pone la fórmula');
  assert.equal(web.f['2,16'], '=ARRAYFORMULA(existencias)');
  const otra = J(ctx.posWebSincronizar_(L, web, {}));
  assert.equal(otra.agregados.length, 0, 'no se duplica');
});
prueba('Cambio de precio en el Inventario pasa a la web (C$ y US$); Coming soon con stock pasa a Disponible', () => {
  const L = conWeb(); const web = L.web, inv = L.hojas['Inventario'];
  inv.poner(4, 12, 1500); inv.poner(4, 34, 1000);
  const res = J(ctx.posWebSincronizar_(L, web, {}));
  const f = filaWeb(web, 2);
  assert.deepEqual([f.precio_detalle_cs, f.precio_detalle_usd, f.precio_mayor_cs, f.precio_mayor_usd], [1500, 40.75, 1000, 27.15]);
  assert.equal(filaWeb(web, 3).estado, 'Disponible', '9PM tiene 2 en stock');
  assert.deepEqual(res.disponibles, ['9PM']); assert.equal(res.precios.length, 1);
  assert.equal(filaWeb(web, 2).notas, 'Cítrico', 'lo escrito a mano no se toca');
});
prueba('No sube perfumes incompletos, repetidos o marcados "No"; avisa el motivo', () => {
  const L = conWeb(); const web = L.web, inv = L.hojas['Inventario'];
  [['444', 'ARMAF', 'SIN MAYOR', '100ML', '', 'Hombre', 1490, ''], ['555', 'ARMAF', 'UNISEX', '100ML', '', 'Unisex', 1490, 900],
   ['666', 'ARMAF', 'REPETIDO A', '100ML', '', 'Hombre', 1490, 900], ['666', 'ARMAF', 'REPETIDO B', '100ML', '', 'Hombre', 1490, 900],
   ['777', 'ARMAF', 'VIEJO', '100ML', '', 'Hombre', 1490, 900]].forEach((p, i) => {
    const r = 7 + i; p.slice(0, 6).forEach((x, j) => inv.poner(r, j + 1, x)); inv.poner(r, 12, p[6]); inv.poner(r, 34, p[7]);
  });
  inv.insertColumnsAfter(35, 3); inv.poner(11, 38, 'No');
  const res = J(ctx.posWebSincronizar_(L, web, {}));
  assert.deepEqual(res.agregados.map(a => a.sku), ['333']);
  const m = Object.fromEntries(res.pendientes.map(p => [p.sku, p.motivo]));
  assert.match(m['444'], /precio mayorista/); assert.match(m['555'], /Hombre o Mujer/); assert.match(m['666'], /repetido/);
  assert.equal(m['777'], undefined, '"No" ni se menciona');
});
prueba('Instalar: AH deja de leer la web (queda el valor), AL marca Sí a los que ya están y No a los demás, ganancia mínima en Configuración', () => {
  const L = conWeb(); const inv = L.hojas['Inventario'];
  inv.f['4,34'] = '=ARRAYFORMULA(IMPORTRANGE("x","J2:J"))';
  inv.poner(4, 34, '#REF!'); inv.poner(5, 34, 'Cargando…');      // la fórmula todavía no carga: igual se toma de la web
  ctx.posWebInstalar_(L, L.web);
  assert.deepEqual([inv.celda(4, 34), inv.celda(5, 34), inv.celda(6, 34)], [985, 975, 905]); assert.equal(inv.f['4,34'], undefined);
  assert.deepEqual([inv.celda(4, 38), inv.celda(5, 38), inv.celda(6, 38), inv.celda(7, 38)], ['Sí', 'Sí', 'No', '']);
  assert.equal(inv.celda(3, 38), 'Publicar en la web (Sí / No)');
  assert.deepEqual([L.hojas['Configuración'].celda(11, 1), L.hojas['Configuración'].celda(11, 2)], ['Ganancia mínima por perfume al mayor (C$)', 185]);
  const e = atender(L, { accion: 'estado' }, AHORA);
  assert.equal(e.config.gananciaMinMayor, 185); assert.deepEqual(e.config.proveedores, ['DUBAI', 'JOMAS SHOP']);
  assert.deepEqual(J(e.config.ultimoPedido), { numero: 1, dia: diaDe(2026, 10, 20) });
  ctx.posWebInstalar_(L, L.web);
  assert.equal(inv.celda(6, 38), 'No', 'repetir no cambia nada');
});
const entradaNueva = (extra = {}) => ({ id: 'e-1', nuevo: true, sku: '6290171075288', marca: 'Afnan', nombre: '9pm Rebel', presentacion: '100ml', genero: 'Hombre', familia: 'Dulce/Gourmand',
  nombreWeb: '9PM Rebel', marcaWeb: 'Afnan', notas: 'Dulce · Frutal', descripcion: 'Nuevo de Afnan.',
  cantidad: 6, costo: 1012, envio: 50, aduana: 0, otros: 65.35, precio: 1890, mayor: 1300, proveedor: 'DUBAI', pedido: 9, llego: false, foto: { base64: 'AAAA' }, ...extra });
prueba('Perfume nuevo desde la app: Inventario, Compras, web con notas y foto, y publica en GitHub', () => {
  const L = conWeb(); const inv = L.hojas['Inventario'], com = L.hojas['Compras'], web = L.web;
  const r = crudo(L, { accion: 'entrada', id: 'e-1', entrada: entradaNueva() }, AHORA).resultado;
  assert.deepEqual([inv.celda(7, 1), inv.celda(7, 2), inv.celda(7, 3), inv.celda(7, 4), inv.celda(7, 5), inv.celda(7, 6), inv.celda(7, 12), inv.celda(7, 15), inv.celda(7, 34), inv.celda(7, 38)],
    [6290171075288, 'AFNAN', '9PM REBEL', '100ML', 'Dulce/Gourmand', 'Hombre', 1890, 0, 1300, 'Sí']);
  assert.equal(r.ref, 'AFNAN 9PM REBEL - 100ML (6290171075288)');
  assert.deepEqual([com.celda(5, 1), com.celda(5, 2), com.celda(5, 3), com.celda(5, 4), com.celda(5, 5), com.celda(5, 6), com.celda(5, 8), com.celda(5, 9), com.celda(5, 10), com.celda(5, 12), com.celda(5, 14)],
    [DIA, 9, 'DUBAI', r.ref, 6, 1012, 50, '', 65.35, 'En tránsito', '']);
  const f = filaWeb(web, 5);   // la fila 4 es Yara (estaba pendiente en el Inventario)
  assert.deepEqual([f.id, f.nombre, f.marca, f.notas, f.descripcion, f.foto, f.estado, f.orden, f.precio_detalle_usd], ['H03', '9PM Rebel', 'Afnan', 'Dulce · Frutal', 'Nuevo de Afnan.', '9pm-rebel.webp', 'Coming soon', 3, 51.35]);
  const put = llamadas.find(l => l.metodo === 'put'), post = llamadas.find(l => l.metodo === 'post');
  assert.match(put.url, /contents\/img\/entrantes\/9pm-rebel\.jpg$/); assert.equal(put.cuerpo.content, 'AAAA');
  assert.match(post.url, /actions\/workflows\/sincronizar\.yml\/dispatches$/); assert.deepEqual(J(post.cuerpo), { ref: 'main', inputs: { esperar: 'D01,H03' } });
  assert.equal(r.publicado, true); assert.equal(r.web.agregado.id, 'H03'); assert.deepEqual(J(r.avisos), []);
  // reintento sin señal: no se repite
  crudo(L, { accion: 'entrada', id: 'e-1', entrada: entradaNueva() }, AHORA);
  assert.equal(com.celda(6, 4), ''); assert.equal(inv.celda(8, 1), '');
});
prueba('Entrada de un perfume que ya tengo: cambia precios si los cambiaste y registra la compra recibida', () => {
  const L = conWeb(); const inv = L.hojas['Inventario'], com = L.hojas['Compras'];
  const r = crudo(L, { accion: 'entrada', id: 'e-2', entrada: { id: 'e-2', nuevo: false, ref: 'AFNAN 9PM - 100ML (222)', cantidad: 3, costo: 950, envio: 0, aduana: 0, otros: 0, precio: 1550, mayor: 975, proveedor: 'DUBAI', pedido: 10, llego: true, foto: null } }, AHORA).resultado;
  assert.deepEqual([inv.celda(5, 12), inv.celda(5, 34)], [1550, 975]);
  assert.deepEqual([com.celda(5, 4), com.celda(5, 5), com.celda(5, 12), com.celda(5, 14)], ['AFNAN 9PM - 100ML (222)', 3, 'Recibido', DIA]);
  assert.equal(filaWeb(L.web, 3).precio_detalle_cs, 1550);
  assert.equal(r.sku, '222');
});
prueba('Entrada: valida código repetido, mayorista más alto, género y costo', () => {
  const L = conWeb();
  assert.throws(() => crudo(L, { accion: 'entrada', id: 'x1', entrada: entradaNueva({ sku: '111' }) }, AHORA), /ya es de Armaf Mandarin Sky/);
  assert.throws(() => crudo(L, { accion: 'entrada', id: 'x2', entrada: entradaNueva({ mayor: 2000 }) }, AHORA), /mayor no puede ser más alto/);
  assert.throws(() => crudo(L, { accion: 'entrada', id: 'x3', entrada: entradaNueva({ genero: '' }) }, AHORA), /Caballeros o de Damas/);
  assert.throws(() => crudo(L, { accion: 'entrada', id: 'x4', entrada: entradaNueva({ costo: 0 }) }, AHORA), /te costó/);
});
prueba('Sin GitHub ni hoja de la web conectadas, la entrada igual se guarda y avisa', () => {
  const L = conWeb({ github: false, conectada: false });
  const r = crudo(L, { accion: 'entrada', id: 'e-3', entrada: entradaNueva({ id: 'e-3' }) }, AHORA).resultado;
  assert.equal(L.hojas['Inventario'].celda(7, 3), '9PM REBEL'); assert.equal(L.hojas['Compras'].celda(5, 6), 1012);
  assert.equal(r.avisos.length, 2); assert.match(r.avisos[0], /GitHub/); assert.match(r.avisos[1], /no está conectada/);
  assert.equal(llamadas.length, 0);
  const e = atender(L, { accion: 'estado' }, AHORA); assert.deepEqual(J(e.web), { conectada: false, github: false, pendientes: [], cuando: '' });
});
prueba('Si la foto ya existe en la web, usa otro nombre', () => {
  const L = conWeb();
  ctx.UrlFetchApp.fetch = (url, o) => { llamadas.push({ url, metodo: o.method, cuerpo: o.payload ? JSON.parse(o.payload) : null }); return { getResponseCode: () => o.method === 'get' ? 200 : o.method === 'put' ? 201 : 204, getContentText: () => '{}' }; };
  crudo(L, { accion: 'entrada', id: 'e-4', entrada: entradaNueva({ id: 'e-4' }) }, AHORA);
  assert.match(filaWeb(L.web, 5).foto, /^9pm-rebel-[a-z0-9]{1,4}\.webp$/);
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas.`);
process.exit(fallos ? 1 : 0);
