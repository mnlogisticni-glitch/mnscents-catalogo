// Entradas de perfumes: cálculo del costo real y de la ganancia (sin pantalla, para poder probarlo).
// Los gastos (envío, aduana, otros) se escriben como TOTAL de estas unidades y se reparten por unidad,
// igual que en la hoja Compras (que los guarda por unidad).

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
export const usd05 = (cs, tc) => (tc > 0 ? Math.round(cs / tc * 20) / 20 : 0);
export { num as numero };

/**
 * d = { cantidad, moneda: 'CS'|'USD', tc, costo (por unidad), envio, aduana, otros (totales),
 *       precio, mayor (C$), stock, costoActual (C$ por unidad del Inventario), minGananciaMayor }
 */
export function calcularEntrada(d) {
  const cant = Math.max(0, Math.round(num(d.cantidad)));
  const tc = num(d.tc);
  const aCS = v => (d.moneda === 'USD' ? num(v) * tc : num(v));
  const precio = num(d.precio), mayor = num(d.mayor);
  const unidad = {
    costo: r2(aCS(d.costo)),
    envio: cant ? r2(aCS(d.envio) / cant) : 0,
    aduana: cant ? r2(aCS(d.aduana) / cant) : 0,
    otros: cant ? r2(aCS(d.otros) / cant) : 0,
  };
  const costoReal = r2(unidad.costo + unidad.envio + unidad.aduana + unidad.otros);
  const margen = (p, g) => (p > 0 ? g / p : 0);
  const gDet = r2(precio - costoReal), gMay = r2(mayor - costoReal);
  const stock = Math.max(0, num(d.stock)), costoActual = num(d.costoActual);
  const promedio = stock > 0 && costoActual > 0 && cant > 0 && costoReal > 0 ? r2((stock * costoActual + cant * costoReal) / (stock + cant)) : null;

  const avisos = [];
  if (precio > 0 && mayor > 0 && mayor > precio) avisos.push({ tipo: 'error', texto: 'El precio por mayor es más alto que el de detalle.' });
  if (costoReal > 0 && precio > 0 && gDet < 0) avisos.push({ tipo: 'error', texto: 'Al detalle pierdes dinero: el precio es menor que el costo.' });
  if (costoReal > 0 && mayor > 0 && gMay < 0) avisos.push({ tipo: 'error', texto: 'Al mayor pierdes dinero: el precio es menor que el costo.' });
  else if (costoReal > 0 && mayor > 0 && num(d.minGananciaMayor) > 0 && gMay < num(d.minGananciaMayor))
    avisos.push({ tipo: 'aviso', texto: `Al mayor ganas menos de tu mínimo (C$${num(d.minGananciaMayor).toLocaleString('es-NI')} por perfume).` });
  if (d.moneda === 'USD' && !(tc > 0)) avisos.push({ tipo: 'error', texto: 'Falta el tipo de cambio en Configuración.' });

  const faltan = [];
  if (!(cant >= 1 && cant <= 999)) faltan.push('la cantidad');
  if (!(unidad.costo > 0)) faltan.push('lo que te costó cada unidad');
  if (!(precio > 0)) faltan.push('el precio al detalle');
  if (!(mayor > 0)) faltan.push('el precio por mayor');

  return {
    cantidad: cant, unidad, costoReal,
    detalle: { precio, ganancia: gDet, margen: margen(precio, gDet), usd: usd05(precio, tc) },
    mayor: { precio: mayor, ganancia: gMay, margen: margen(mayor, gMay), usd: usd05(mayor, tc) },
    lote: { invertido: r2(costoReal * cant), detalle: r2(gDet * cant), mayor: r2(gMay * cant) },
    promedio, avisos, faltan,
    listo: !faltan.length && !avisos.some(a => a.tipo === 'error'),
  };
}

// Número de pedido sugerido: el mismo del último pedido si fue hoy (misma caja), si no el siguiente.
export function pedidoSugerido(ultimo, hoyDia) {
  if (!ultimo || !(ultimo.numero > 0)) return 1;
  return ultimo.dia === hoyDia ? ultimo.numero : ultimo.numero + 1;
}

// Código de barras / SKU: números, letras, espacios, puntos o guiones
export const skuValido = s => /^[0-9A-Za-z][0-9A-Za-z .-]{0,29}$/.test(String(s || '').trim());
export const normSku = s => String(s ?? '').trim().replace(/\.0+$/, '');

// Lo que se manda a la hoja
export function armarEntrada({ id, nuevo, producto, form, calculo }) {
  const t = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const base = {
    id, nuevo: !!nuevo, cantidad: calculo.cantidad,
    costo: calculo.unidad.costo, envio: calculo.unidad.envio, aduana: calculo.unidad.aduana, otros: calculo.unidad.otros,
    precio: calculo.detalle.precio, mayor: calculo.mayor.precio,
    proveedor: t(form.proveedor), pedido: Math.round(num(form.pedido)) || '', llego: !!form.llego,
  };
  if (!nuevo) return { ...base, ref: producto.ref, nombreWeb: t(form.nombreWeb) };
  return {
    ...base, sku: normSku(form.sku), marca: t(form.marca), nombre: t(form.nombre), presentacion: t(form.presentacion),
    genero: form.genero === 'Damas' ? 'Mujer' : form.genero === 'Caballeros' ? 'Hombre' : '', familia: t(form.familia),
    nombreWeb: t(form.nombre), marcaWeb: t(form.marca), presentacionWeb: t(form.presentacionWeb), notas: t(form.notas), descripcion: t(form.descripcion),
  };
}
