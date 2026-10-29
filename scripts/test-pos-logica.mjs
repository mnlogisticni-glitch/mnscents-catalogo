// Pruebas de los cálculos del punto de venta (pos/js/logica.js). Uso: node scripts/test-pos-logica.mjs
import assert from 'node:assert/strict';
import { calcularVenta, vuelto, billetesSugeridos, stockVisible, armarVenta, telWa, recibo, leerVinculo, coincide, nivelStock, titulo, fmtCS } from '../pos/js/logica.js';

let ok = 0, fallos = 0;
const prueba = (n, fn) => { try { fn(); ok++; console.log('  ✓ ' + n); } catch (e) { fallos++; console.log('  ✗ ' + n + '\n    ' + e.message); } };
const P = [
  { ref: 'A', sku: '1', marca: 'ARMAF', nombre: 'MANDARIN SKY', pres: '100ML', familia: 'Cítrica', genero: 'Hombre', precio: 1460, mayor: 985, stock: 10 },
  { ref: 'B', sku: '2', marca: 'AFNAN', nombre: '9PM', pres: '100ML', familia: 'Dulce', genero: 'Hombre', precio: 1490, mayor: 975, stock: 2 },
  { ref: 'C', sku: '3', marca: 'LATTAFA', nombre: 'YARA', pres: '100ML', familia: 'Dulce', genero: 'Mujer', precio: 1390, mayor: 0, stock: 0 },
];
const M = new Map(P.map(p => [p.ref, p]));

console.log('\nPrecios y mayoreo');
prueba('Menos de 6: precio al detalle', () => {
  const c = calcularVenta([{ ref: 'A', cantidad: 2 }, { ref: 'B', cantidad: 3 }], M);
  assert.equal(c.total, 2 * 1460 + 3 * 1490); assert.equal(c.porMayor, false); assert.equal(c.faltanMayor, 1);
});
prueba('Desde 6 unidades: cada perfume a su precio mayorista', () => {
  const c = calcularVenta([{ ref: 'A', cantidad: 4 }, { ref: 'B', cantidad: 2 }], M);
  assert.equal(c.porMayor, true); assert.equal(c.total, 4 * 985 + 2 * 975); assert.equal(c.ahorro, 4 * 475 + 2 * 515);
});
prueba('Perfume sin precio mayorista se queda al detalle aunque sea mayoreo', () => {
  const c = calcularVenta([{ ref: 'A', cantidad: 5 }, { ref: 'C', cantidad: 1 }], M);
  assert.equal(c.lineas[1].precio, 1390); assert.equal(c.lineas[1].mayorista, false);
});
prueba('Racha: se puede aplicar mayorista a mano con menos de 6', () => {
  const c = calcularVenta([{ ref: 'A', cantidad: 1 }], M, { forzarMayor: true });
  assert.equal(c.total, 985);
});
prueba('El mínimo sale de la configuración de la hoja', () => {
  assert.equal(calcularVenta([{ ref: 'A', cantidad: 4 }], M, { minimoMayor: 4 }).porMayor, true);
});
prueba('Precio escrito a mano y descuento se respetan', () => {
  const c = calcularVenta([{ ref: 'A', cantidad: 2, precio: 1400, descuento: 100 }], M);
  assert.equal(c.lineas[0].precio, 1400); assert.equal(c.total, 2700); assert.equal(c.descuentos, 100);
});
prueba('El descuento nunca deja la línea negativa', () => {
  assert.equal(calcularVenta([{ ref: 'A', cantidad: 1, descuento: 99999 }], M).total, 0);
});
prueba('Perfumes que ya no existen no cuentan', () => {
  assert.equal(calcularVenta([{ ref: 'X', cantidad: 3 }, { ref: 'A', cantidad: 1 }], M).unidades, 1);
});

console.log('\nCobro');
prueba('Vuelto exacto, con cambio y cuando falta', () => {
  assert.equal(vuelto(1460, ''), 0); assert.equal(vuelto(1460, 2000), 540); assert.equal(vuelto(1460, 1000), null); assert.equal(vuelto(1460, 1460), 0);
});
prueba('Billetes sugeridos: siguientes redondeos útiles', () => {
  assert.deepEqual(billetesSugeridos(7620), [7700, 8000]); assert.deepEqual(billetesSugeridos(1460), [1500, 2000]); assert.deepEqual(billetesSugeridos(1000), [1100, 1500, 2000]);
});
prueba('La venta para la hoja lleva método y banco correctos', () => {
  const c = calcularVenta([{ ref: 'A', cantidad: 1 }], M);
  const v1 = armarVenta(c, { id: 'x', metodo: 'Efectivo', recibido: 2000 });
  assert.deepEqual(v1.pago, { metodo: 'Efectivo', banco: '', recibido: 2000 });
  const v2 = armarVenta(c, { id: 'y', metodo: 'Transferencia', banco: 'Lafise', cliente: { nombre: 'Ana', nuevo: true } });
  assert.deepEqual(v2.pago, { metodo: 'Transferencia bancaria', banco: 'Lafise', recibido: 0 });
  assert.equal(v2.cliente.nuevo, true); assert.deepEqual(v2.lineas, [{ ref: 'A', cantidad: 1, precio: 1460, descuento: 0 }]);
});
prueba('Recibo para WhatsApp', () => {
  const c = calcularVenta([{ ref: 'A', cantidad: 2 }], M);
  const t = recibo({ numero: 71, fecha: '29/10/2026', calc: c, metodo: 'Efectivo', recibido: 3000, cliente: { nombre: 'Ana' } });
  assert.ok(t.includes('venta #71') && t.includes('2 × Mandarin Sky — C$2,920') && t.includes('Vuelto: C$80') && t.includes('Cliente: Ana'));
});
prueba('Teléfono de Nicaragua para WhatsApp', () => {
  assert.equal(telWa('8888-1234'), '50588881234'); assert.equal(telWa('+505 8888 1234'), '50588881234'); assert.equal(telWa('123'), '');
});

console.log('\nStock y búsqueda');
prueba('Lo vendido sin señal ya se descuenta del stock que se ve', () => {
  const pend = [{ accion: 'venta', venta: { lineas: [{ ref: 'A', cantidad: 3 }] } }, { accion: 'ajuste', ajuste: { ref: 'A', cantidad: -1 } }];
  assert.equal(stockVisible(P[0], pend), 6);
});
prueba('Semáforo de existencias', () => {
  assert.deepEqual([nivelStock(0), nivelStock(2), nivelStock(3), nivelStock(4)], ['agotado', 'bajo', 'bajo', 'ok']);
});
prueba('Búsqueda por partes del nombre, marca, código o sin tildes', () => {
  assert.ok(coincide(P[0], 'mandarin')); assert.ok(coincide(P[0], 'armaf sky')); assert.ok(coincide(P[1], '2')); assert.ok(coincide(P[0], 'citrica'));
  assert.ok(!coincide(P[0], 'yara'));
});
prueba('Nombres en formato bonito y montos', () => {
  assert.equal(titulo('MANDARIN SKY'), 'Mandarin Sky'); assert.equal(titulo('9PM ELIXIR'), '9PM Elixir'); assert.equal(fmtCS(1234.5), 'C$1,234.5'); assert.equal(fmtCS(-20), '-C$20');
});

console.log('\nVincular');
prueba('El enlace de la hoja se lee; uno alterado o de otro sitio no', () => {
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const bueno = b({ u: 'https://script.google.com/macros/s/AKfy_123-abc/exec', t: 'x'.repeat(40) });
  assert.deepEqual(leerVinculo('#vincular=' + bueno), { url: 'https://script.google.com/macros/s/AKfy_123-abc/exec', clave: 'x'.repeat(40) });
  assert.equal(leerVinculo('#vincular=' + b({ u: 'https://malo.com/exec', t: 'x'.repeat(40) })), null);
  assert.equal(leerVinculo('#vincular=' + b({ u: 'https://script.google.com/macros/s/a/exec', t: 'corta' })), null);
  assert.equal(leerVinculo('#vincular=%%%'), null); assert.equal(leerVinculo(''), null);
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas.`);
process.exit(fallos ? 1 : 0);
