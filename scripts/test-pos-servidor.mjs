// Prueba el script del punto de venta (scripts/pos/PuntoDeVenta.gs) con una hoja simulada en memoria.
// Uso: node scripts/test-pos-servidor.mjs
import assert from 'node:assert/strict';

let ok = 0, fallos = 0;
const prueba = (n, fn) => { try { fn(); ok++; console.log('  ✓ ' + n); } catch (e) { fallos++; console.log('  ✗ ' + n + '\n    ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n    ')); } };

import { libroBase, ctx, gas, props } from './pos-hoja-simulada.mjs';
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

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas.`);
process.exit(fallos ? 1 : 0);
