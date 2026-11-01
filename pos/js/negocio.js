// Punto de venta MN Scents — cálculos del negocio sobre el historial de Ventas (sin pantalla).
// Tarjeta de fidelidad, racha mayorista, reposición y reportes. Se prueba con node scripts/test-pos-negocio.mjs
import { norm, redondear } from './logica.js';

// ---------------------------------------------------------------- fechas (número de día de Sheets)
// Día 0 = 30/12/1899, igual que la hoja. Todo en hora de Nicaragua.
const BASE = Date.UTC(1899, 11, 30);
export const diaDeFecha = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - BASE) / 864e5);
export function fechaDeDia(dia) {
  const t = new Date(BASE + dia * 864e5);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), semana: (t.getUTCDay() + 6) % 7 };   // semana: 0 = lunes
}
export function hoyNica(ahora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ahora).map(x => [x.type, x.value]));
  return diaDeFecha(+p.year, +p.month, +p.day);
}
const dos = n => String(n).padStart(2, '0');
export const fechaCorta = dia => { const f = fechaDeDia(dia); return `${dos(f.d)}/${dos(f.m)}/${f.y}`; };
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const diasDelMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ---------------------------------------------------------------- ventas desde el historial
/**
 * historial: filas [día, número, cliente, código, cantidad, precio, descuento, total, método, banco, ganancia, tipo]
 * Agrupa por número de venta. Las ventas viejas (sin "Tipo de venta") se clasifican por su precio:
 * a C$0 = regalo; al precio mayorista o con el mínimo de unidades = mayorista; si no, detalle.
 */
export function agruparVentas(historial, productos, { minimoMayor = 6 } = {}) {
  const porSku = new Map(productos.map(p => [String(p.sku), p]));
  const porRef = new Map(productos.map(p => [p.ref, p]));
  const ventas = new Map();
  for (const f of historial || []) {
    const [dia, numero, cliente, cod, cantidad, precio, descuento, total, metodo, banco, ganancia, tipo] = f;
    if (!Number.isFinite(dia)) continue;
    const clave = numero > 0 ? `n${numero}` : `d${dia}|${norm(cliente)}`;
    let v = ventas.get(clave);
    if (!v) ventas.set(clave, v = { numero: numero > 0 ? numero : null, dia, cliente: String(cliente || ''), clave: norm(cliente), metodo: String(metodo || ''), banco: String(banco || ''), lineas: [] });
    const p = porSku.get(String(cod)) || porRef.get(String(cod)) || null;
    v.lineas.push({ p, cod: String(cod), cantidad: Number(cantidad) || 0, precio: Number(precio) || 0, descuento: Number(descuento) || 0, total: Number(total) || 0, ganancia: Number(ganancia) || 0, tipo: String(tipo || '') });
  }
  return [...ventas.values()].map(v => completarVenta(v, minimoMayor)).sort((a, b) => a.dia - b.dia || (a.numero ?? 1e9) - (b.numero ?? 1e9));
}

function completarVenta(v, minimoMayor) {
  const pagadas = v.lineas.filter(l => l.tipo !== 'Canje' && !(l.tipo === '' && l.precio === 0)).reduce((s, l) => s + l.cantidad, 0);
  for (const l of v.lineas) {
    if (l.tipo) continue;
    if (l.precio === 0) l.tipo = 'Regalo';
    else if ((l.p && l.p.mayor > 0 && l.precio <= l.p.mayor + 0.5 && l.precio < l.p.precio - 0.5) || pagadas >= minimoMayor) l.tipo = 'Mayorista';
    else l.tipo = l.descuento > 0 ? SIN_SELLO : 'Detalle';     // las viejas con descuento tampoco suman sello
  }
  const cobradas = v.lineas.filter(l => l.tipo === 'Detalle' || l.tipo === SIN_SELLO || l.tipo === 'Mayorista');
  v.unidades = cobradas.reduce((s, l) => s + l.cantidad, 0);
  v.canjes = v.lineas.filter(l => l.tipo === 'Canje').reduce((s, l) => s + l.cantidad, 0);
  v.total = redondear(v.lineas.reduce((s, l) => s + l.total, 0));
  v.ganancia = redondear(v.lineas.reduce((s, l) => s + l.ganancia, 0));
  v.tipo = cobradas.some(l => l.tipo === 'Mayorista') ? 'Mayorista' : cobradas.length ? 'Detalle' : v.canjes ? 'Canje' : 'Regalo';
  v.sello = v.tipo === 'Detalle' && cobradas.some(l => l.tipo === 'Detalle');   // "Detalle sin sello" = precio especial
  return v;
}

// Ventas que todavía están en el teléfono (sin señal): cuentan desde ya para sellos, racha y stock
export function ventasPendientes(cola, productos, hoy, { minimoMayor = 6 } = {}) {
  const porRef = new Map(productos.map(p => [p.ref, p]));
  return cola.filter(o => o.accion === 'venta').map(o => completarVenta({
    numero: null, dia: hoy, pendiente: true, cliente: o.venta.cliente?.nombre || '', clave: norm(o.venta.cliente?.nombre),
    metodo: o.venta.pago?.metodo || '', banco: o.venta.pago?.banco || '',
    lineas: o.venta.lineas.map(l => {
      const p = porRef.get(l.ref) || null;
      const total = l.canje ? 0 : redondear(l.cantidad * l.precio - (l.descuento || 0));
      return { p, cod: p?.sku || l.ref, cantidad: l.cantidad, precio: l.canje ? 0 : l.precio, descuento: l.descuento || 0, total, ganancia: redondear(total - (p?.costo || 0) * l.cantidad), tipo: l.canje ? 'Canje' : (l.tipo || 'Detalle') };
    }),
  }, minimoMayor));
}

// ---------------------------------------------------------------- tarjeta de fidelidad (solo compras al detalle)
// Una venta al detalle con precio o descuento especial se guarda como "Detalle sin sello": no suma a la tarjeta.
export const SIN_SELLO = 'Detalle sin sello';
// 1 sello por compra al detalle; 2 de regalo con la primera; 10 sellos = 1 perfume Stallion 53 gratis.
export const TARJETA = { meta: 10, bienvenida: 2 };
export const esPremio = p => /stallion\s*53/i.test(`${p?.marca || ''} ${p?.nombre || ''}`);

// Movimientos a mano de un cliente (de la hoja Fidelidad y los que siguen en el teléfono)
export const ajustesDe = (nombre, ajustes = []) => ajustes.filter(a => norm(a[1]) === norm(nombre)).map(a => ({ dia: a[0], sellos: Number(a[2]) || 0, nota: String(a[3] || '') }));

export function tarjetaCliente(nombre, ventas, ajustes = []) {
  const clave = norm(nombre);
  if (!clave) return null;
  let compras = 0, canjes = 0, extra = 0;
  for (const v of ventas) {
    if (v.clave !== clave) continue;
    if (v.tipo === 'Detalle' && v.sello) compras++;
    canjes += v.canjes || 0;
  }
  for (const a of ajustes) if (norm(a[1]) === clave) extra += Number(a[2]) || 0;
  const ganados = (compras > 0 ? TARJETA.bienvenida : 0) + compras + extra;
  const sellos = Math.max(0, ganados - canjes * TARJETA.meta);
  return { sellos, enTarjeta: Math.min(sellos, TARJETA.meta), premios: Math.floor(sellos / TARJETA.meta), faltan: sellos >= TARJETA.meta ? 0 : TARJETA.meta - sellos, compras, canjes, ajustes: extra };
}

// ---------------------------------------------------------------- racha mayorista (mismas reglas que la web)
//   1. Una compra de 6 perfumes o más desbloquea el precio mayorista.
//   2. Durante 6 días, la siguiente compra puede ser desde 1 perfume a precio mayorista.
//   3. Después, una compra desde 3 perfumes cada 30 días mantiene el beneficio.
//   4. Si pasan 30 días sin una compra así, se pierde y se vuelve a necesitar una de 6.
export const RACHA = { diasPrimera: 6, minPrimera: 1, diasMantener: 30, minMantener: 3 };

export function estadoRacha(r, dia) {
  if (!r) return { activa: false, vencida: false };
  const vencePrimera = r.inicio + RACHA.diasPrimera;
  const venceMantener = r.ultima + RACHA.diasMantener;
  if (!r.primeraUsada && dia <= vencePrimera) return { activa: true, etapa: 'primera', minimo: RACHA.minPrimera, vence: vencePrimera, dias: vencePrimera - dia };
  if (dia <= venceMantener) return { activa: true, etapa: 'mantener', minimo: RACHA.minMantener, vence: venceMantener, dias: venceMantener - dia };
  return { activa: false, vencida: true, vencio: venceMantener };
}

export function rachaCliente(nombre, ventas, hoy, { minimoMayor = 6 } = {}) {
  const clave = norm(nombre);
  if (!clave) return { activa: false, vencida: false };
  let r = null;
  for (const v of ventas) {
    if (v.clave !== clave || !v.unidades) continue;
    if (v.unidades >= minimoMayor) { r = { inicio: v.dia, ultima: v.dia, primeraUsada: false }; continue; }
    const e = estadoRacha(r, v.dia);
    if (e.activa && v.unidades >= e.minimo) r = { ...r, ultima: v.dia, primeraUsada: r.primeraUsada || e.etapa === 'primera' };
  }
  return { ...estadoRacha(r, hoy), desde: r?.inicio ?? null };
}

// ---------------------------------------------------------------- reposición
/**
 * Cuánto dura cada perfume al ritmo de los últimos `ventana` días y cuánto pedir para cubrir `cobertura` días.
 * stockDe: existencias que se muestran (lo de la hoja menos lo pendiente).
 */
export function reposicion(productos, ventas, hoy, { ventana = 30, cobertura = 30, urgente = 7, pronto = 14, stockDe = p => p.stock } = {}) {
  const vendidos = new Map();
  for (const v of ventas) {
    if (v.dia <= hoy - ventana || v.dia > hoy) continue;
    for (const l of v.lineas) if (l.p) vendidos.set(l.p.ref, (vendidos.get(l.p.ref) || 0) + l.cantidad);
  }
  return productos.map(p => {
    const u = vendidos.get(p.ref) || 0;
    const st = Math.max(0, Number(stockDe(p)) || 0);
    const ritmo = u / ventana;
    const dias = ritmo > 0 ? Math.floor(st / ritmo) : null;
    const sugerido = ritmo > 0 ? Math.max(0, Math.ceil(ritmo * cobertura - st)) : 0;
    const nivel = !ritmo ? (st ? 'quieto' : 'agotado-sin-ventas') : !st ? 'agotado' : dias <= urgente ? 'urgente' : dias <= pronto ? 'pronto' : 'ok';
    return { p, vendidos: u, ritmo, stock: st, dias, sugerido, nivel, costo: redondear(sugerido * (p.costo || 0)) };
  });
}
export const ORDEN_NIVEL = { agotado: 0, urgente: 1, pronto: 2, ok: 3, quieto: 4, 'agotado-sin-ventas': 5 };
export const porReponer = filas => filas.filter(r => r.sugerido > 0 && ['agotado', 'urgente', 'pronto'].includes(r.nivel))
  .sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel] || (a.dias ?? 0) - (b.dias ?? 0) || b.vendidos - a.vendidos);

// Texto para mandarle al proveedor (sin tus costos ni precios)
export function listaCompra(filas, { fecha, titulo = s => s } = {}) {
  const L = ['*Pedido — MN Scents*', fecha || '', ''];
  for (const r of filas) L.push(`• ${r.sugerido} × ${titulo(r.p.marca)} ${titulo(r.p.nombre)} ${r.p.pres || ''}`.replace(/\s+$/, '') + (r.p.sku ? ` (cód. ${r.p.sku})` : ''));
  const n = filas.reduce((s, r) => s + r.sugerido, 0);
  L.push('', `Total: ${n} ${n === 1 ? 'perfume' : 'perfumes'}`);
  return L.join('\n');
}

// ---------------------------------------------------------------- reportes
export const PERIODOS = [['hoy', 'Hoy'], ['semana', 'Semana'], ['mes', 'Este mes'], ['mes-pasado', 'Mes pasado'], ['30', '30 días'], ['anio', 'Este año']];

// Rango del período y el anterior equivalente para comparar (mismo largo, mismo punto del mes/semana)
export function periodo(tipo, hoy) {
  const f = fechaDeDia(hoy);
  const ini = diaDeFecha(f.y, f.m, 1);
  switch (tipo) {
    case 'hoy': return { desde: hoy, hasta: hoy, antes: { desde: hoy - 7, hasta: hoy - 7 }, nombre: 'Hoy', comparado: `el ${DIAS_SEMANA[f.semana].toLowerCase()} pasado` };
    case 'semana': { const lun = hoy - f.semana; return { desde: lun, hasta: hoy, antes: { desde: lun - 7, hasta: hoy - 7 }, nombre: 'Esta semana', comparado: 'los mismos días de la semana pasada' }; }
    case 'mes': {
      const pm = f.m === 1 ? { y: f.y - 1, m: 12 } : { y: f.y, m: f.m - 1 };
      const d = Math.min(f.d, diasDelMes(pm.y, pm.m));
      return { desde: ini, hasta: hoy, antes: { desde: diaDeFecha(pm.y, pm.m, 1), hasta: diaDeFecha(pm.y, pm.m, d) }, nombre: `${MESES[f.m - 1][0].toUpperCase()}${MESES[f.m - 1].slice(1)} ${f.y}`, comparado: `${MESES[pm.m - 1]} hasta el día ${d}` };
    }
    case 'mes-pasado': {
      const pm = f.m === 1 ? { y: f.y - 1, m: 12 } : { y: f.y, m: f.m - 1 };
      const ppm = pm.m === 1 ? { y: pm.y - 1, m: 12 } : { y: pm.y, m: pm.m - 1 };
      return { desde: diaDeFecha(pm.y, pm.m, 1), hasta: diaDeFecha(pm.y, pm.m, diasDelMes(pm.y, pm.m)), antes: { desde: diaDeFecha(ppm.y, ppm.m, 1), hasta: diaDeFecha(ppm.y, ppm.m, diasDelMes(ppm.y, ppm.m)) }, nombre: `${MESES[pm.m - 1][0].toUpperCase()}${MESES[pm.m - 1].slice(1)} ${pm.y}`, comparado: MESES[ppm.m - 1] };
    }
    case 'anio': {
      const d0 = diaDeFecha(f.y, 1, 1), largo = hoy - d0;
      const a0 = diaDeFecha(f.y - 1, 1, 1);
      return { desde: d0, hasta: hoy, antes: { desde: a0, hasta: a0 + largo }, nombre: String(f.y), comparado: `${f.y - 1} a la misma fecha`, porMes: true };
    }
    default: return { desde: hoy - 29, hasta: hoy, antes: { desde: hoy - 59, hasta: hoy - 30 }, nombre: 'Últimos 30 días', comparado: 'los 30 días anteriores' };
  }
}

function sumar(ventas, desde, hasta) {
  const r = { ventas: 0, ganancia: 0, numero: 0, unidades: 0, canjes: 0 };
  for (const v of ventas) {
    if (v.dia < desde || v.dia > hasta) continue;
    r.ventas += v.total; r.ganancia += v.ganancia; r.unidades += v.unidades; r.canjes += v.canjes || 0;
    if (v.unidades) r.numero++;
  }
  r.ventas = redondear(r.ventas); r.ganancia = redondear(r.ganancia);
  r.ticket = r.numero ? redondear(r.ventas / r.numero) : 0;
  r.margen = r.ventas > 0 ? r.ganancia / r.ventas : 0;
  return r;
}
// Cambio en %, o null si antes no hubo nada con qué comparar
export const cambio = (ahora, antes) => (antes > 0 ? (ahora - antes) / antes : null);

export function reporte(ventas, per) {
  const actual = sumar(ventas, per.desde, per.hasta);
  const anterior = sumar(ventas, per.antes.desde, per.antes.hasta);
  const dentro = ventas.filter(v => v.dia >= per.desde && v.dia <= per.hasta);
  // serie para el gráfico: por día, o por mes en el año
  const serie = [];
  if (per.porMes) {
    const f = fechaDeDia(per.hasta);
    for (let m = 1; m <= f.m; m++) {
      const a = diaDeFecha(f.y, m, 1), b = diaDeFecha(f.y, m, diasDelMes(f.y, m));
      const s = sumar(dentro, a, b);
      serie.push({ etiqueta: MESES[m - 1].slice(0, 3), corta: MESES[m - 1][0].toUpperCase(), ventas: s.ventas, ganancia: s.ganancia, desde: a });
    }
  } else {
    for (let d = per.desde; d <= per.hasta; d++) {
      const s = sumar(dentro, d, d); const f = fechaDeDia(d);
      serie.push({ etiqueta: `${f.d}/${f.m}`, corta: String(f.d), ventas: s.ventas, ganancia: s.ganancia, dia: d, semana: f.semana });
    }
  }
  // perfumes
  const prods = new Map();
  for (const v of dentro) for (const l of v.lineas) {
    if (l.tipo === 'Canje' || l.tipo === 'Regalo') continue;
    const k = l.p?.ref || l.cod;
    const x = prods.get(k) || { p: l.p, cod: l.cod, unidades: 0, ventas: 0, ganancia: 0 };
    x.unidades += l.cantidad; x.ventas += l.total; x.ganancia += l.ganancia;
    prods.set(k, x);
  }
  const lista = [...prods.values()].map(x => ({ ...x, ventas: redondear(x.ventas), ganancia: redondear(x.ganancia) }));
  // cómo pagaron
  const metodos = {};
  for (const v of dentro) {
    if (!v.total) continue;
    const k = /transfer/i.test(v.metodo) ? (v.banco || 'Transferencia') : v.metodo || 'Sin método';
    metodos[k] = redondear((metodos[k] || 0) + v.total);
  }
  // detalle vs mayorista
  const tipos = { Detalle: { ventas: 0, numero: 0, unidades: 0 }, Mayorista: { ventas: 0, numero: 0, unidades: 0 } };
  for (const v of dentro) if (tipos[v.tipo]) { tipos[v.tipo].ventas = redondear(tipos[v.tipo].ventas + v.total); tipos[v.tipo].numero++; tipos[v.tipo].unidades += v.unidades; }
  // días de la semana (promedio por día que hubo en el período)
  const semana = DIAS_SEMANA.map((nombre, i) => ({ nombre, ventas: 0, dias: 0 }));
  for (let d = per.desde; d <= per.hasta; d++) semana[fechaDeDia(d).semana].dias++;
  for (const v of dentro) semana[fechaDeDia(v.dia).semana].ventas += v.total;
  for (const s of semana) s.promedio = s.dias ? redondear(s.ventas / s.dias) : 0;
  // clientes
  const cli = new Map();
  for (const v of dentro) {
    if (!v.clave || !v.unidades) continue;
    const x = cli.get(v.clave) || { nombre: v.cliente, compras: 0, ventas: 0, unidades: 0 };
    x.compras++; x.ventas = redondear(x.ventas + v.total); x.unidades += v.unidades;
    cli.set(v.clave, x);
  }
  const primeraCompra = new Map();
  for (const v of ventas) if (v.clave && v.unidades && !primeraCompra.has(v.clave)) primeraCompra.set(v.clave, v.dia);
  const nuevos = [...cli.keys()].filter(k => primeraCompra.get(k) >= per.desde).length;
  return {
    actual, anterior,
    cambios: { ventas: cambio(actual.ventas, anterior.ventas), ganancia: cambio(actual.ganancia, anterior.ganancia), numero: cambio(actual.numero, anterior.numero), ticket: cambio(actual.ticket, anterior.ticket), unidades: cambio(actual.unidades, anterior.unidades) },
    serie,
    masVendidos: [...lista].sort((a, b) => b.unidades - a.unidades || b.ventas - a.ventas).slice(0, 8),
    masGanancia: [...lista].sort((a, b) => b.ganancia - a.ganancia).slice(0, 8),
    metodos: Object.entries(metodos).sort((a, b) => b[1] - a[1]),
    tipos, semana,
    clientes: [...cli.values()].sort((a, b) => b.ventas - a.ventas).slice(0, 8),
    clientesTotal: cli.size, clientesNuevos: nuevos,
  };
}

// Meta del mes (de tu hoja Configuración) y a dónde llegas si sigues al mismo ritmo
export function metaDelMes(ventas, hoy, { metaVentas = 0, metaGanancia = 0 } = {}) {
  const f = fechaDeDia(hoy);
  const total = diasDelMes(f.y, f.m);
  const s = sumar(ventas, diaDeFecha(f.y, f.m, 1), hoy);
  const proy = x => redondear((x / f.d) * total);
  return {
    dia: f.d, diasMes: total, quedan: total - f.d,
    ventas: s.ventas, ganancia: s.ganancia, metaVentas, metaGanancia,
    avanceVentas: metaVentas > 0 ? s.ventas / metaVentas : null, avanceGanancia: metaGanancia > 0 ? s.ganancia / metaGanancia : null,
    proyVentas: proy(s.ventas), proyGanancia: proy(s.ganancia),
    porDiaParaMeta: metaVentas > s.ventas && total > f.d ? redondear((metaVentas - s.ventas) / (total - f.d)) : 0,
  };
}
