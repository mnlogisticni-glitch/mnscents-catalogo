// Pruebas de pos/js/negocio.js: tarjeta de fidelidad, racha mayorista, reposición y reportes.
// Uso: node scripts/test-pos-negocio.mjs
import assert from 'node:assert/strict';
import { agruparVentas, ventasPendientes, tarjetaCliente, rachaCliente, reposicion, porReponer, listaCompra, periodo, reporte, metaDelMes, diaDeFecha, fechaDeDia, fechaCorta, hoyNica, cambio } from '../pos/js/negocio.js';

let ok = 0, fallos = 0;
const prueba = (n, fn) => { try { fn(); ok++; console.log('  ✓ ' + n); } catch (e) { fallos++; console.log('  ✗ ' + n + '\n    ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n    ')); } };

const P = [
  { ref: 'ARMAF MANDARIN SKY - 100ML (111)', sku: '111', marca: 'ARMAF', nombre: 'MANDARIN SKY', pres: '100ML', precio: 1460, mayor: 985, costo: 800, stock: 10 },
  { ref: 'AFNAN 9PM - 100ML (222)', sku: '222', marca: 'AFNAN', nombre: '9PM', pres: '100ML', precio: 1490, mayor: 975, costo: 700, stock: 2 },
  { ref: 'STALLION 53 IMPERIAL - 100ML (444)', sku: '444', marca: 'STALLION 53', nombre: 'IMPERIAL', pres: '100ML', precio: 1400, mayor: 1000, costo: 900, stock: 0 },
];
const D = (m, d) => diaDeFecha(2026, m, d);
const HOY = D(11, 1);   // domingo 1/11/2026
// [día, número, cliente, código, cantidad, precio, descuento, total, método, banco, ganancia, tipo]
const fila = (dia, n, cli, cod, cant, precio, tipo = '', metodo = 'Efectivo', banco = '', desc = 0) => [dia, n, cli, cod, cant, precio, desc, cant * precio - desc, metodo, banco, cant * precio - desc - cant * 700, tipo];

console.log('\nFechas');
prueba('Día de Sheets ida y vuelta, día de la semana (lunes = 0)', () => {
  assert.equal(diaDeFecha(2026, 10, 29), 46324);
  assert.deepEqual(fechaDeDia(46324), { y: 2026, m: 10, d: 29, semana: 3 });
  assert.equal(fechaCorta(HOY), '01/11/2026'); assert.equal(fechaDeDia(HOY).semana, 6);
  assert.equal(hoyNica(new Date(Date.UTC(2026, 10, 2, 5, 30))), D(11, 1), 'a las 11:30 p. m. en Nicaragua todavía es el 1');
});

console.log('\nAgrupar ventas');
prueba('Agrupa por número; clasifica las viejas por precio y por cantidad', () => {
  const v = agruparVentas([
    fila(D(10, 1), 1, 'Ana', '111', 1, 1460),                    // detalle
    fila(D(10, 2), 2, 'Luis', '111', 4, 985), fila(D(10, 2), 2, 'Luis', '222', 2, 975),   // mayorista por precio
    fila(D(10, 3), 3, 'Juan', '111', 6, 1400),                   // mayorista por cantidad (precio a mano)
    fila(D(10, 4), 4, 'Ana', '222', 1, 0),                       // regalo viejo a C$0
    fila(D(10, 5), 5, 'Ana', '444', 1, 0, 'Canje'), fila(D(10, 5), 5, 'Ana', '111', 1, 1460, 'Detalle'),
  ], P);
  assert.equal(v.length, 5);
  assert.deepEqual(v.map(x => x.tipo), ['Detalle', 'Mayorista', 'Mayorista', 'Regalo', 'Detalle']);
  assert.deepEqual([v[1].unidades, v[1].total, v[4].unidades, v[4].canjes, v[4].total], [6, 4 * 985 + 2 * 975, 1, 1, 1460]);
  assert.equal(v[0].lineas[0].p.sku, '111'); assert.equal(v[0].clave, 'ana');
});
prueba('Las ventas que siguen en el teléfono cuentan desde ya', () => {
  const p = ventasPendientes([{ accion: 'venta', venta: { cliente: { nombre: 'Ana' }, pago: { metodo: 'Efectivo' }, lineas: [{ ref: P[2].ref, cantidad: 1, precio: 0, canje: true }, { ref: P[0].ref, cantidad: 2, precio: 1460, tipo: 'Detalle' }] } }, { accion: 'caja' }], P, HOY);
  assert.equal(p.length, 1); assert.deepEqual([p[0].dia, p[0].tipo, p[0].unidades, p[0].canjes, p[0].total, p[0].pendiente], [HOY, 'Detalle', 2, 1, 2920, true]);
});

console.log('\nTarjeta de fidelidad');
prueba('2 de regalo con la primera compra, 1 por compra al detalle; mayoristas no suman', () => {
  const v = agruparVentas([fila(D(10, 1), 1, 'Ana', '111', 1, 1460), fila(D(10, 2), 2, 'ana ', '222', 2, 1490), fila(D(10, 3), 3, 'Ana', '111', 6, 985)], P);
  const t = tarjetaCliente('ANA', v);
  assert.deepEqual([t.sellos, t.compras, t.faltan, t.premios], [4, 2, 6, 0]);
  assert.equal(tarjetaCliente('Nadie', v).sellos, 0, 'sin compras no hay sellos de regalo');
  assert.equal(tarjetaCliente('', v), null);
});
prueba('Con 10 sellos hay premio; canjearlo descuenta 10; los ajustes a mano suman o restan', () => {
  const filas = []; for (let i = 1; i <= 8; i++) filas.push(fila(D(9, i), i, 'Ana', '111', 1, 1460));
  let t = tarjetaCliente('Ana', agruparVentas(filas, P));
  assert.deepEqual([t.sellos, t.premios, t.faltan], [10, 1, 0]);
  filas.push(fila(D(9, 20), 9, 'Ana', '444', 1, 0, 'Canje'));
  t = tarjetaCliente('Ana', agruparVentas(filas, P));
  assert.deepEqual([t.sellos, t.canjes, t.faltan], [0, 1, 10]);
  t = tarjetaCliente('Ana', agruparVentas(filas, P), [[D(9, 21), 'ANA', 3, 'tarjeta de papel'], [D(9, 22), 'Otra', 5, '']]);
  assert.equal(t.sellos, 3);
});

console.log('\nRacha mayorista');
prueba('Sin compra de 6 no hay racha', () => {
  assert.equal(rachaCliente('Ana', agruparVentas([fila(D(10, 1), 1, 'Ana', '111', 5, 1460)], P), HOY).activa, false);
});
prueba('Compra de 6: 6 días para llevar desde 1; después desde 3 cada 30 días', () => {
  const base = [fila(D(10, 28), 1, 'Luis', '111', 6, 985)];
  let r = rachaCliente('Luis', agruparVentas(base, P), HOY);
  assert.deepEqual([r.activa, r.etapa, r.minimo, r.vence, r.dias], [true, 'primera', 1, D(11, 3), 2]);
  // usó su compra de 1 → pasa a mantener (30 días desde esa compra)
  r = rachaCliente('Luis', agruparVentas([...base, fila(D(10, 30), 2, 'Luis', '222', 1, 975)], P), HOY);
  assert.deepEqual([r.etapa, r.minimo, r.vence], ['mantener', 3, D(10, 30) + 30]);
  // no usó la de 1: al pasar los 6 días sigue en mantener hasta 30 días después de la de 6
  r = rachaCliente('Luis', agruparVentas(base, P), D(11, 10));
  assert.deepEqual([r.activa, r.etapa, r.vence], [true, 'mantener', D(10, 28) + 30]);
});
prueba('Una compra de 2 fuera de los 6 días no mantiene; una de 3 sí; 30 días sin comprar la pierde', () => {
  const base = [fila(D(9, 1), 1, 'Luis', '111', 6, 985)];
  let r = rachaCliente('Luis', agruparVentas([...base, fila(D(9, 20), 2, 'Luis', '111', 2, 985)], P), D(10, 5));
  assert.equal(r.activa, false); assert.equal(r.vencida, true);
  r = rachaCliente('Luis', agruparVentas([...base, fila(D(9, 20), 2, 'Luis', '111', 3, 985)], P), D(10, 5));
  assert.deepEqual([r.activa, r.vence], [true, D(9, 20) + 30]);
  r = rachaCliente('Luis', agruparVentas([...base, fila(D(9, 20), 2, 'Luis', '111', 3, 985)], P), D(9, 20) + 31);
  assert.equal(r.activa, false);
});

console.log('\nReposición');
prueba('Días que dura el stock y cuánto pedir para 30 días', () => {
  const v = agruparVentas([fila(HOY - 3, 1, '', '222', 6, 1490), fila(HOY - 40, 2, '', '111', 9, 1460), fila(HOY - 1, 3, '', '444', 3, 1400)], P);
  const r = reposicion(P, v, HOY);
  const [a, b, c] = r;
  assert.deepEqual([a.nivel, a.vendidos, a.sugerido], ['quieto', 0, 0], 'lo vendido hace 40 días no cuenta');
  assert.deepEqual([b.ritmo, b.dias, b.sugerido, b.nivel, b.costo], [0.2, 10, 4, 'pronto', 2800]);
  assert.deepEqual([c.nivel, c.sugerido], ['agotado', 3]);
  assert.deepEqual(porReponer(r).map(x => x.p.sku), ['444', '222']);
  const txt = listaCompra(porReponer(r), { fecha: '01/11/2026' });
  assert.match(txt, /3 × STALLION 53 IMPERIAL 100ML \(cód\. 444\)/); assert.match(txt, /Total: 7 perfumes/); assert.doesNotMatch(txt, /C\$|costo/i);
});
prueba('Usa el stock que se muestra (con lo pendiente)', () => {
  const v = agruparVentas([fila(HOY - 3, 1, '', '111', 15, 1460)], P);
  assert.equal(reposicion(P, v, HOY, { stockDe: p => p.stock - 5 })[0].sugerido, 10);
});

console.log('\nReportes');
prueba('Períodos y su comparación justa', () => {
  const m = periodo('mes', HOY);
  assert.deepEqual([m.desde, m.hasta, m.antes.desde, m.antes.hasta], [D(11, 1), HOY, D(10, 1), D(10, 1)]);
  const s = periodo('semana', D(11, 4));    // miércoles
  assert.deepEqual([s.desde, s.antes.desde, s.antes.hasta], [D(11, 2), D(10, 26), D(10, 28)]);
  const mp = periodo('mes-pasado', D(3, 15));
  assert.deepEqual([mp.desde, mp.hasta, mp.antes.desde, mp.antes.hasta], [D(2, 1), D(2, 28), D(1, 1), D(1, 31)]);
  assert.equal(periodo('mes', D(3, 31)).antes.hasta, D(2, 28), 'marzo 31 se compara con febrero 28');
  assert.equal(periodo('30', HOY).desde, HOY - 29);
});
prueba('Totales, cambio contra el período anterior, más vendidos, métodos y tipos', () => {
  const v = agruparVentas([
    fila(D(10, 10), 1, 'Ana', '111', 1, 1460),
    fila(D(10, 20), 2, 'Luis', '111', 4, 985, 'Mayorista', 'Transferencia bancaria', 'BAC'), fila(D(10, 20), 2, 'Luis', '222', 2, 975, 'Mayorista', 'Transferencia bancaria', 'BAC'),
    fila(D(10, 21), 3, 'Ana', '444', 1, 0, 'Canje'),
    fila(D(9, 15), 4, 'Ana', '222', 1, 1490),
  ], P);
  const r = reporte(v, periodo('mes-pasado', HOY));
  assert.equal(r.actual.ventas, 1460 + 4 * 985 + 2 * 975); assert.equal(r.actual.numero, 2, 'el canje no es una venta');
  assert.equal(r.actual.unidades, 7); assert.equal(r.actual.canjes, 1); assert.equal(r.actual.ticket, r.actual.ventas / 2);
  assert.ok(Math.abs(r.cambios.ventas - (r.actual.ventas - 1490) / 1490) < 1e-9);
  assert.equal(r.serie.length, 31); assert.equal(r.serie[19].ventas, 4 * 985 + 2 * 975);
  assert.equal(r.masVendidos[0].p.sku, '111'); assert.equal(r.masVendidos[0].unidades, 5);
  assert.deepEqual(r.metodos, [['BAC', 4 * 985 + 2 * 975], ['Efectivo', 1460]]);
  assert.deepEqual([r.tipos.Detalle.numero, r.tipos.Mayorista.numero, r.tipos.Mayorista.unidades], [1, 1, 6]);
  assert.equal(r.clientesTotal, 2); assert.equal(r.clientesNuevos, 1, 'Ana ya compró en septiembre');
  assert.equal(r.semana.reduce((s, d) => s + d.dias, 0), 31);
  assert.equal(cambio(5, 0), null);
});
prueba('El año se grafica por mes', () => {
  const r = reporte(agruparVentas([fila(D(2, 3), 1, '', '111', 1, 1460)], P), periodo('anio', HOY));
  assert.equal(r.serie.length, 11); assert.equal(r.serie[1].ventas, 1460); assert.equal(r.serie[1].etiqueta, 'feb');
});
prueba('Meta del mes: avance, proyección y cuánto vender por día', () => {
  const v = agruparVentas([fila(D(11, 1), 1, '', '111', 10, 1500)], P);
  const m = metaDelMes(v, D(11, 10), { metaVentas: 50000, metaGanancia: 15000 });
  assert.deepEqual([m.ventas, m.avanceVentas, m.proyVentas, m.quedan, m.porDiaParaMeta], [15000, 0.3, 45000, 20, 1750]);
  assert.equal(metaDelMes(v, D(11, 10)).avanceVentas, null);
});

console.log(`\n${ok} pruebas correctas, ${fallos} fallidas.`);
process.exit(fallos ? 1 : 0);
