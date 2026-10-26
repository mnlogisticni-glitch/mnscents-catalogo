// Calculadora de ganancia para revendedores.
// El costo sale de nuestro precio mayorista publicado; el precio de venta y los gastos los escribe el revendedor.
// No sugerimos precios de reventa: solo hacemos las cuentas con lo que él decide.

const num = v => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * @param {Array<{qty:number, costo:number, venta:number|string}>} lineas
 * @param {Array<{monto:number|string}>} gastos
 */
export function calcularGanancia(lineas, gastos = []) {
  const ls = lineas.map(l => {
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    const costo = num(l.costo), venta = num(l.venta);
    return { ...l, qty, costo, venta, conPrecio: venta > 0,
      gananciaUnit: venta > 0 ? venta - costo : null,
      gananciaLinea: venta > 0 ? (venta - costo) * qty : null };
  }).filter(l => l.qty > 0);
  const unidades = ls.reduce((s, l) => s + l.qty, 0);
  const inversionProductos = ls.reduce((s, l) => s + l.costo * l.qty, 0);
  const totalGastos = gastos.reduce((s, g) => s + num(g.monto), 0);
  const venta = ls.reduce((s, l) => s + l.venta * l.qty, 0);
  const completas = ls.length > 0 && ls.every(l => l.conPrecio);
  const ganancia = venta - inversionProductos - totalGastos;
  return {
    lineas: ls, unidades, inversionProductos, totalGastos,
    inversion: inversionProductos + totalGastos,
    venta, completas,
    ganancia: completas ? ganancia : null,
    margen: completas && venta > 0 ? ganancia / venta : null,          // de cada córdoba vendido, cuánto queda
    porFrasco: completas && unidades > 0 ? ganancia / unidades : null,  // ya descontados los gastos
    gastoPorFrasco: unidades > 0 ? totalGastos / unidades : 0,
  };
}

// Precio con un % de ganancia sobre el costo, redondeado hacia arriba a múltiplos de C$5
export function precioConMargen(costo, porcentaje) {
  const c = num(costo), p = Number(porcentaje);
  if (!c || !Number.isFinite(p) || p < 0) return 0;
  return Math.ceil((c * (1 + p / 100)) / 5) * 5;
}

// Montos que escribe el cliente: solo números positivos razonables
export function leerMonto(v) {
  const n = num(v);
  return n > 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : 0;
}
