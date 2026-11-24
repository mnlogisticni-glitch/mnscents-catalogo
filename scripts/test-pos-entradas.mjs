// Pruebas del cálculo de entradas (pos/js/entradas.js). Uso: node scripts/test-pos-entradas.mjs
import assert from 'node:assert/strict';
import { calcularEntrada, pedidoSugerido, skuValido, armarEntrada, usd05 } from '../pos/js/entradas.js';

let ok = 0, fallos = 0;
const prueba = (n, fn) => { try { fn(); ok++; console.log('  ✓ ' + n); } catch (e) { fallos++; console.log('  ✗ ' + n + '\n    ' + e.message.split('\n').slice(0, 6).join('\n    ')); } };
const base = { cantidad: 6, moneda: 'CS', tc: 36.8, costo: 1012, envio: 300, aduana: 0, otros: 392.1, precio: 1890, mayor: 1300, stock: 0, costoActual: 0, minGananciaMayor: 185 };

prueba('Reparte los gastos por unidad y calcula el costo real', () => {
  const c = calcularEntrada(base);
  assert.deepEqual(c.unidad, { costo: 1012, envio: 50, aduana: 0, otros: 65.35 });
  assert.equal(c.costoReal, 1127.35);
});
prueba('Ganancia y margen al detalle y al mayor, y del lote completo', () => {
  const c = calcularEntrada(base);
  assert.equal(c.detalle.ganancia, 762.65); assert.equal(Math.round(c.detalle.margen * 1000) / 10, 40.4);
  assert.equal(c.mayor.ganancia, 172.65);
  assert.deepEqual(c.lote, { invertido: 6764.1, detalle: 4575.9, mayor: 1035.9 });
  assert.deepEqual([c.detalle.usd, c.mayor.usd], [51.35, 35.35]);
});
prueba('Avisa si al mayor ganas menos de tu mínimo, pero deja guardar', () => {
  const c = calcularEntrada(base);
  assert.equal(c.avisos.length, 1); assert.equal(c.avisos[0].tipo, 'aviso'); assert.match(c.avisos[0].texto, /mínimo \(C\$185/);
  assert.equal(c.listo, true);
  assert.equal(calcularEntrada({ ...base, mayor: 1400 }).avisos.length, 0);
});
prueba('No deja guardar con pérdida, mayor más alto que detalle o datos faltantes', () => {
  assert.equal(calcularEntrada({ ...base, mayor: 1000 }).listo, false);
  assert.match(calcularEntrada({ ...base, mayor: 1000 }).avisos[0].texto, /pierdes/);
  assert.equal(calcularEntrada({ ...base, mayor: 1900 }).listo, false);
  const c = calcularEntrada({ ...base, costo: '', precio: '' });
  assert.deepEqual(c.faltan, ['lo que te costó cada unidad', 'el precio al detalle']); assert.equal(c.listo, false);
});
prueba('Costos en dólares se pasan a córdobas con el tipo de cambio', () => {
  const c = calcularEntrada({ ...base, moneda: 'USD', costo: 27.5, envio: 12, otros: 0 });
  assert.deepEqual(c.unidad, { costo: 1012, envio: 73.6, aduana: 0, otros: 0 });
});
prueba('Si ya hay stock, muestra cómo queda el costo promedio', () => {
  assert.equal(calcularEntrada({ ...base, stock: 4, costoActual: 1000 }).promedio, 1076.41);
  assert.equal(calcularEntrada(base).promedio, null);
});
prueba('Número de pedido: el mismo si el último fue hoy, si no el siguiente', () => {
  assert.equal(pedidoSugerido({ numero: 9, dia: 100 }, 100), 9);
  assert.equal(pedidoSugerido({ numero: 9, dia: 99 }, 100), 10);
  assert.equal(pedidoSugerido(null, 100), 1);
});
prueba('Código de barras válido', () => {
  assert.ok(skuValido('6290171075288')); assert.ok(skuValido('629519980 5022')); assert.ok(!skuValido('')); assert.ok(!skuValido('<x>'));
});
prueba('Arma lo que se manda a la hoja (nuevo y existente)', () => {
  const c = calcularEntrada(base);
  const n = armarEntrada({ id: 'e1', nuevo: true, form: { sku: '6290171075288.0', marca: ' Afnan ', nombre: '9PM  Rebel', presentacion: '100ML', genero: 'Caballeros', notas: 'Dulce', proveedor: 'DUBAI', pedido: '9', llego: false }, calculo: c });
  assert.deepEqual([n.sku, n.marca, n.nombre, n.genero, n.costo, n.envio, n.otros, n.precio, n.mayor, n.pedido, n.nombreWeb], ['6290171075288', 'Afnan', '9PM Rebel', 'Hombre', 1012, 50, 65.35, 1890, 1300, 9, '9PM Rebel']);
  const e = armarEntrada({ id: 'e2', nuevo: false, producto: { ref: 'AFNAN 9PM - 100ML (222)' }, form: { llego: true }, calculo: c });
  assert.equal(e.ref, 'AFNAN 9PM - 100ML (222)'); assert.equal(e.llego, true); assert.equal(e.sku, undefined);
  assert.equal(usd05(1390, 36.8), 37.75);
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas.`);
process.exit(fallos ? 1 : 0);
