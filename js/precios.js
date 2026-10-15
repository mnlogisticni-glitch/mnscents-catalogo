// MN Scents — lógica de precios, carrito y mensaje de WhatsApp.
// Sin dependencias del navegador: se prueba con Node (scripts/test-logica.mjs).

export const UMBRAL_MAYOREO = 6;
export const WHATSAPP = '50584735485'; // +505 8473-5485

export const MAX_POR_PRODUCTO = 99;
export const esComprable = p => !!p && p.estado === 'disponible' && p.existencias !== 0;
// Unidades que se pueden pedir de un producto: sus existencias si están registradas, si no 99.
export const maxPedido = p => (Number.isInteger(p?.existencias) ? Math.min(p.existencias, MAX_POR_PRODUCTO) : MAX_POR_PRODUCTO);

// Dólares en centavos enteros para no acumular errores de coma flotante.
const aCentavos = usd => Math.round(usd * 100);

export function fmtCS(n) {
  return 'C$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export function fmtUSD(n) {
  const [e, d] = (Math.round(n * 100) / 100).toFixed(2).split('.');
  return '$' + e.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + d;
}

/**
 * Calcula el pedido.
 * @param {Array<{id:string, qty:number}>} items  líneas del carrito
 * @param {Map<string, object>} catalogo           productos por id
 */
export function calcular(items, catalogo) {
  const lineas = [], noDisponibles = [];
  for (const it of items) {
    const p = catalogo.get(it.id);
    const qty = Math.max(0, Math.floor(Number(it.qty) || 0));
    if (!qty) continue;
    if (!esComprable(p)) { noDisponibles.push({ id: it.id, producto: p || null, qty }); continue; }
    const max = maxPedido(p);
    // Nunca se cobra ni se cuenta más de lo que hay en existencias
    lineas.push({ producto: p, qty: Math.min(qty, max), pedida: qty, ajustada: qty > max, max });
  }
  const unidades = lineas.reduce((s, l) => s + l.qty, 0);
  const nivel = unidades >= UMBRAL_MAYOREO ? 'mayor' : 'detalle';
  let totalCS = 0, totalCent = 0;
  for (const l of lineas) {
    const pr = l.producto.precios[nivel];
    l.unitCS = pr.cs;
    l.unitUSD = pr.usd;
    l.subCS = pr.cs * l.qty;
    l.subUSD = (aCentavos(pr.usd) * l.qty) / 100;
    // Lo que se ahorra frente al detalle (para mostrarlo con transparencia)
    l.ahorroCS = (l.producto.precios.detalle.cs - pr.cs) * l.qty;
    totalCS += l.subCS;
    totalCent += aCentavos(pr.usd) * l.qty;
  }
  const totalDetalleCS = lineas.reduce((s, l) => s + l.producto.precios.detalle.cs * l.qty, 0);
  return {
    lineas, noDisponibles, unidades, nivel,
    faltan: Math.max(0, UMBRAL_MAYOREO - unidades),
    progreso: Math.min(1, unidades / UMBRAL_MAYOREO),
    totalCS, totalUSD: totalCent / 100,
    ahorroCS: totalDetalleCS - totalCS,
  };
}

export function mensajeWhatsApp(pedido) {
  const L = [];
  L.push('*PEDIDO MN SCENTS*', '');
  pedido.lineas.forEach((l, i) => {
    const p = l.producto;
    const titulo = p.marca ? `${p.nombre} (${p.marca})` : p.nombre;
    L.push(`${i + 1}. ${titulo}${p.presentacion ? ' · ' + p.presentacion : ''}`);
    L.push(`   Cantidad: ${l.qty}`);
    L.push(`   Precio unitario: ${fmtCS(l.unitCS)} / ${fmtUSD(l.unitUSD)}`);
    L.push(`   Subtotal: ${fmtCS(l.subCS)} / ${fmtUSD(l.subUSD)}`);
    L.push('');
  });
  L.push(`Total de unidades: ${pedido.unidades}`);
  L.push(pedido.nivel === 'mayor'
    ? `Precios aplicados: MAYORISTA (${UMBRAL_MAYOREO} o más unidades)`
    : `Precios aplicados: AL DETALLE (mayorista desde ${UMBRAL_MAYOREO} unidades)`);
  L.push(`*TOTAL: ${fmtCS(pedido.totalCS)} / ${fmtUSD(pedido.totalUSD)}*`);
  L.push('');
  L.push('Nombre: ');
  L.push('Dirección de entrega: ');
  return L.join('\n');
}

export function enlaceWhatsApp(texto) {
  return `https://wa.me/${WHATSAPP}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
}
