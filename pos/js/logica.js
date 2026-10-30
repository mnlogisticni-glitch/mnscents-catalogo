// Punto de venta MN Scents — cálculos sin pantalla (se prueban con node scripts/test-pos-logica.mjs)

export const BANCOS = ['BAC', 'Banpro', 'Lafise'];
export const redondear = n => Math.round((Number(n) || 0) * 100) / 100;

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmtCS = n => `${n < 0 ? '-' : ''}C$${fmt.format(Math.abs(redondear(n)))}`;
export const fmtUSD = n => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Nombre bonito: "MANDARIN SKY" → "Mandarin Sky"; "9PM" se queda
export function titulo(s) {
  return String(s ?? '').toLowerCase().replace(/(^|[\s\-'(])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(\d+)(ml|am|pm)\b/gi, (m, n, u) => n + u.toUpperCase());
}

// Semáforo de existencias
export function nivelStock(stock, minimo = 3) {
  if (!(stock > 0)) return 'agotado';
  if (stock <= minimo) return 'bajo';
  return 'ok';
}

// Búsqueda tolerante: todas las palabras deben aparecer en marca, nombre, presentación, familia o SKU
export function coincide(p, q) {
  const t = norm(q);
  if (!t) return true;
  const texto = norm(`${p.marca} ${p.nombre} ${p.pres} ${p.familia} ${p.sku} ${p.genero}`);
  return t.split(' ').every(w => texto.includes(w));
}

/**
 * Calcula la venta.
 * carrito: [{ref, cantidad, precio?(manual), descuento?}]
 * productos: Map ref → producto {precio, mayor, ...}
 * opciones: { minimoMayor, forzarMayor }
 * Si la venta llega al mínimo (o se fuerza, p. ej. por racha), cada perfume va a su precio mayorista.
 * Un precio escrito a mano en la línea siempre se respeta.
 */
export function calcularVenta(carrito, productos, { minimoMayor = 6, forzarMayor = false } = {}) {
  const lineas = [];
  let unidades = 0;
  for (const it of carrito) {
    const p = productos.get(it.ref);
    if (!p) continue;
    const cantidad = Math.max(1, Math.round(Number(it.cantidad) || 1));
    unidades += cantidad;
    lineas.push({ it, p, cantidad });
  }
  const porMayor = forzarMayor || (minimoMayor > 0 && unidades >= minimoMayor);
  let subtotal = 0, descuentos = 0, detalleTotal = 0;
  const out = lineas.map(({ it, p, cantidad }) => {
    const auto = porMayor && p.mayor > 0 ? p.mayor : p.precio;
    const manual = Number(it.precio) > 0 ? redondear(it.precio) : null;
    const precio = manual ?? auto;
    const descuento = Math.min(redondear(it.descuento), cantidad * precio);
    const total = redondear(cantidad * precio - descuento);
    subtotal += cantidad * precio; descuentos += descuento; detalleTotal += cantidad * p.precio;
    return { ref: p.ref, producto: p, cantidad, precio, manual: manual !== null, descuento, total, mayorista: !manual && porMayor && p.mayor > 0 };
  });
  const total = redondear(subtotal - descuentos);
  return {
    lineas: out, unidades, porMayor, faltanMayor: porMayor ? 0 : Math.max(0, minimoMayor - unidades),
    subtotal: redondear(subtotal), descuentos: redondear(descuentos), total,
    ahorro: redondear(detalleTotal - subtotal + descuentos),
  };
}

// Vuelto en efectivo; null si lo recibido no alcanza
export function vuelto(total, recibido) {
  const r = Number(recibido);
  if (!(r > 0)) return 0;
  return r + 0.004 >= total ? redondear(r - total) : null;
}

// Billetes sugeridos para cobrar rápido: el total exacto y los siguientes redondeos útiles
export function billetesSugeridos(total) {
  const out = new Set();
  for (const paso of [100, 500, 1000]) {
    out.add((Math.floor(total / paso + 1e-9) + 1) * paso);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

// Existencias que se muestran: lo que dice la hoja menos lo vendido que todavía no se envió
export function stockVisible(producto, pendientes) {
  let s = Number(producto.stock) || 0;
  for (const op of pendientes) if (op.accion === 'venta') for (const l of op.venta.lineas) if (l.ref === producto.ref) s -= l.cantidad;
  for (const op of pendientes) if (op.accion === 'ajuste' && op.ajuste.ref === producto.ref) s += op.ajuste.cantidad;
  return s;
}

// Lo que se manda a la hoja
export function armarVenta(calc, { id, cliente, metodo, banco, recibido }) {
  return {
    id,
    cliente: cliente ? { nombre: cliente.nombre, telefono: cliente.telefono || '', ciudad: cliente.ciudad || '', nuevo: !!cliente.nuevo } : null,
    lineas: calc.lineas.map(l => ({ ref: l.ref, cantidad: l.cantidad, precio: l.precio, descuento: l.descuento || 0 })),
    pago: { metodo: metodo === 'Efectivo' ? 'Efectivo' : 'Transferencia bancaria', banco: metodo === 'Efectivo' ? '' : banco, recibido: Number(recibido) || 0 },
  };
}

// Número de WhatsApp de Nicaragua para wa.me
export function telWa(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length === 8) return '505' + d;
  if (d.length >= 10 && d.length <= 15) return d;
  return '';
}

export function recibo({ numero, fecha, calc, metodo, banco, recibido, cliente }) {
  const L = [`*MN Scents* · Recibo${numero ? ` de venta #${numero}` : ''}`, fecha, ''];
  if (cliente?.nombre) L.push(`Cliente: ${cliente.nombre}`, '');
  for (const l of calc.lineas) L.push(`${l.cantidad} × ${titulo(l.producto.nombre)} — ${fmtCS(l.total)}`);
  L.push('', `*Total: ${fmtCS(calc.total)}*`);
  L.push(`Pago: ${metodo === 'Efectivo' ? 'Efectivo' : `Transferencia ${banco}`}`);
  const v = metodo === 'Efectivo' ? vuelto(calc.total, recibido) : 0;
  if (metodo === 'Efectivo' && Number(recibido) > 0 && v !== null) L.push(`Recibido: ${fmtCS(recibido)} · Vuelto: ${fmtCS(v)}`);
  L.push('', '¡Gracias por tu compra!', 'MN Scents · Estelí · WhatsApp 8473-5485', 'mnscents.pages.dev');
  return L.join('\n');
}

// Datos de vinculación que trae el enlace …/pos/#vincular=…
export function leerVinculo(hash) {
  const m = /vincular=([A-Za-z0-9_-]+)/.exec(String(hash || ''));
  if (!m) return null;
  try {
    const t = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const txt = decodeURIComponent(escape(atob(t + '='.repeat((4 - (t.length % 4)) % 4))));
    const d = JSON.parse(txt);
    if (!/^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(d.u) || typeof d.t !== 'string' || d.t.length < 20) return null;
    return { url: d.u, clave: d.t };
  } catch { return null; }
}

export const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
