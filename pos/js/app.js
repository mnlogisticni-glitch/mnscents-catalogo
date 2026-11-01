// MN Scents — Punto de venta (Android y PC). Trabaja directo con la hoja MNScents_claude.
import { BANCOS, fmtCS, fmtUSD, redondear, titulo, nivelStock, coincide, calcularVenta, vuelto, billetesSugeridos, stockVisible, armarVenta, telWa, recibo, leerVinculo, nuevoId, norm } from './logica.js';
import { agruparVentas, ventasPendientes, tarjetaCliente, ajustesDe, rachaCliente, esPremio, TARJETA, reposicion, porReponer, listaCompra, PERIODOS, periodo, reporte, metaDelMes, hoyNica, fechaCorta, fechaDeDia, MESES } from './negocio.js';
import { dibujarRecibo, aBlob, compartirRecibo, descargar } from './recibo-imagen.js';
import { conexion, guardarConexion, olvidarConexion, estadoGuardado, guardarEstado, cola, encolar, procesarCola, llamar, errores, borrarErrores, ErrorRed } from './api.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = id => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const leerLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const guardarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const vibrar = ms => { try { navigator.vibrate?.(ms); } catch {} };

const S = {
  estado: null, porRef: new Map(), fotos: new Map(),
  vista: 'vender', red: 'en-linea',
  carrito: leerLS('mnpos-carrito-v1', []), cliente: leerLS('mnpos-cliente-v1', null), forzarMayor: false,
  generoVender: 'todos', qVender: '', qStock: '', filtroStock: 'todos', ordenStock: 'menos',
  cobro: { metodo: null, banco: null, recibido: '' },
  permitidos: new Set(), ultima: null, ajuste: { cantidad: -1, motivo: null, nota: '' },
  periodo: leerLS('mnpos-periodo-v1', 'mes'), pedido: new Map(), recibo: null,
  sello: null,                       // null = automático (sin sello si hay precio especial); true/false = lo decidiste en esta venta
  ajSellos: { delta: 1, motivo: null, nota: '' },
};
const guardarCarrito = () => { guardarLS('mnpos-carrito-v1', S.carrito); guardarLS('mnpos-cliente-v1', S.cliente); };

// ---------------------------------------------------------------- hojas (diálogos)
function abrir(d) {
  d._cancelarCierre?.();
  if (d.open) return;
  d.dataset.desde = Date.now(); d.showModal(); document.documentElement.classList.add('con-hoja');
}
function cerrar(d) {
  if (!d.open || d.classList.contains('cerrando')) return;
  const fin = () => {
    d._cancelarCierre?.();
    d.close();
    if (!$$('dialog[open]').length) document.documentElement.classList.remove('con-hoja');
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return fin();
  // solo cuenta el fin de la animación de la hoja misma (no de lo que tiene adentro)
  const alTerminar = e => { if (e.target === d) fin(); };
  const t = setTimeout(() => d.open && fin(), 320);
  d._cancelarCierre = () => { d.removeEventListener('animationend', alTerminar); clearTimeout(t); d.classList.remove('cerrando'); d._cancelarCierre = null; };
  d.classList.add('cerrando');
  d.addEventListener('animationend', alTerminar);
}
for (const d of $$('dialog.hoja')) {
  d.addEventListener('cancel', e => { e.preventDefault(); cerrar(d); });
  // un toque fuera la cierra, pero no justo al abrirse (evita cerrarla sin querer con un doble toque)
  d.addEventListener('click', e => { if (e.target.closest('.cerrar') || (e.target === d && Date.now() - Number(d.dataset.desde || 0) > 450)) cerrar(d); });
}

let tAviso;
function aviso(texto, tipo = '') {
  const a = $('.aviso');
  a.textContent = texto; a.className = `aviso ${tipo}`; a.hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, 3200);
}

// confirmación sin ventanas del navegador
function confirmar({ titulo: t, texto, si = 'Sí', no = 'Cancelar', peligro = false }) {
  const d = $('#h-confirmar');
  $('.confirmar', d).innerHTML = `<h2 id="t-confirmar">${esc(t)}</h2>${texto ? `<p>${texto}</p>` : ''}
    <div class="acciones"><button class="btn sec" type="button" data-r="no">${esc(no)}</button><button class="btn ${peligro ? 'peligro' : 'pri'}" type="button" data-r="si">${esc(si)}</button></div>`;
  abrir(d);
  return new Promise(ok => {
    const fin = v => { d.removeEventListener('click', clic); d.removeEventListener('close', cerro); cerrar(d); ok(v); };
    const clic = e => { const b = e.target.closest('[data-r]'); if (b) fin(b.dataset.r === 'si'); };
    const cerro = () => fin(false);
    d.addEventListener('click', clic); d.addEventListener('close', cerro);
  });
}

// ---------------------------------------------------------------- datos
function aplicarEstado(e) {
  if (!e) return;
  S.estado = e;
  S.porRef = new Map(e.productos.map(p => [p.ref, p]));
  // perfumes que ya no existen salen de la venta
  const antes = S.carrito.length;
  S.carrito = S.carrito.filter(it => S.porRef.has(it.ref));
  if (antes !== S.carrito.length) guardarCarrito();
  pintarTodo();
}
const pendientes = () => cola();
const minimo = () => S.estado?.config?.stockMinimo || 3;
const stockDe = p => stockVisible(p, pendientes());

// ---------------------------------------------------------------- negocio: historial de la hoja + lo que sigue en el teléfono
const hoy = () => hoyNica();
const minMayor = () => S.estado?.config?.minimoMayor || 6;
let cacheVentas = { estado: null, cola: '', ventas: [] };
function ventasTodas() {
  if (!S.estado) return [];
  const c = pendientes(); const firma = JSON.stringify(c);
  if (cacheVentas.estado === S.estado && cacheVentas.cola === firma) return cacheVentas.ventas;
  const ventas = [...agruparVentas(S.estado.historial || [], S.estado.productos, { minimoMayor: minMayor() }), ...ventasPendientes(c, S.estado.productos, hoy(), { minimoMayor: minMayor() })];
  cacheVentas = { estado: S.estado, cola: firma, ventas };
  return ventas;
}
const ajustesSellos = () => [...(S.estado?.fidelidad || []), ...pendientes().filter(o => o.accion === 'sellos').map(o => [hoy(), o.sellos.cliente, o.sellos.sellos, o.sellos.nota])];
function infoCliente(nombre) {
  if (!nombre || !S.estado) return null;
  const v = ventasTodas();
  return { tarjeta: tarjetaCliente(nombre, v, ajustesSellos()), racha: rachaCliente(nombre, v, hoy(), { minimoMayor: minMayor() }) };
}
const filasReposicion = () => reposicion(S.estado.productos, ventasTodas(), hoy(), { stockDe });
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const enDias = d => (d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`);

async function cargarFotos() {
  try {
    const r = await fetch('../data/productos.json', { cache: 'no-cache' });
    const d = await r.json();
    S.fotos = new Map(d.productos.filter(p => p.sku && p.foto).map(p => [String(p.sku), `../img/productos/${p.foto}`]));
  } catch { /* sin fotos: se muestran iniciales */ }
}
function foto(p, tam = 160) {
  const src = S.fotos.get(String(p.sku));
  if (src) return `<img src="${esc(src)}" alt="" width="${tam}" height="${tam}" loading="lazy" decoding="async">`;
  const ini = titulo(p.nombre).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('');
  return `<span class="sin-foto" aria-hidden="true">${esc(ini)}</span>`;
}

function pintarRed() {
  const n = pendientes().length;
  const b = $('.red');
  const estado = S.red === 'enviando' ? 'enviando' : S.red === 'sin-senal' ? 'sin-senal' : n ? 'pendiente' : 'en-linea';
  b.hidden = estado === 'en-linea';
  b.dataset.estado = estado;
  $('.red-texto', b).textContent = estado === 'enviando' ? 'Enviando…' : estado === 'sin-senal' ? (n ? `Sin señal · ${n} por enviar` : 'Sin señal') : `${n} por enviar`;
}

let tRefresco;
async function sincronizar({ silencioso = false } = {}) {
  if (!conexion()) return;
  $('[data-accion="refrescar"]').classList.add('girando');
  S.red = 'enviando'; pintarRed();
  try {
    const r = await procesarCola((op, res) => {
      if (op.accion === 'venta' && S.ultima?.id === op.id) { S.ultima.numero = res?.numero; S.ultima.estado = 'guardada'; pintarListo(); }
    });
    if (r.sinRed) throw new ErrorRed(r.motivo || 'sin señal');
    if (r.fallidas) aviso(`${r.fallidas === 1 ? 'Una operación no se pudo guardar' : `${r.fallidas} operaciones no se pudieron guardar`}. Revísalas en Caja.`, 'error');
    const e = await llamar({ accion: 'estado' }, { espera: 90000 });   // la hoja puede estar recalculando
    guardarEstado(e); S.red = 'en-linea'; aplicarEstado(e);
    if (!silencioso && r.enviadas) aviso(r.enviadas === 1 ? 'Se envió lo pendiente a tu hoja.' : `Se enviaron ${r.enviadas} operaciones a tu hoja.`, 'ok');
  } catch (e) {
    if (e.message === 'no-autorizado') { olvidarConexion(); mostrarVincular('Este dispositivo ya no está vinculado (cambiaste la clave). Vincúlalo otra vez.'); return; }
    S.red = e instanceof ErrorRed ? 'sin-senal' : 'en-linea';
    S.motivo = e.message;
    if (!(e instanceof ErrorRed)) aviso(e.message, 'error');
    if (S.ultima?.estado === 'guardando') { S.ultima.estado = 'pendiente'; pintarListo(); }
  } finally {
    $('[data-accion="refrescar"]').classList.remove('girando');
    pintarRed(); pintarTodo();
    clearTimeout(tRefresco);
    if (pendientes().length) tRefresco = setTimeout(() => sincronizar({ silencioso: true }), 45000);
  }
}
addEventListener('online', () => sincronizar());

// ---------------------------------------------------------------- pantallas
const VISTAS = ['vender', 'stock', 'caja', 'reportes'];
function ponerVista(v) {
  if (!VISTAS.includes(v)) v = 'vender';
  S.vista = v;
  for (const id of VISTAS) $(`#v-${id}`).hidden = id !== v;
  for (const a of $$('.nav-pos a')) a.dataset.vista === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  document.body.dataset.vista = v;
  document.title = { vender: 'Vender', stock: 'Stock', caja: 'Caja', reportes: 'Reportes' }[v] + ' · MN Scents';
  pintarBarraCobro();
  if (v === 'reportes' && S.estado) pintarReportes();
  scrollTo({ top: 0, behavior: 'instant' });
}
addEventListener('hashchange', () => { const h = location.hash.slice(1); if (leerVinculo(h)) return arrancar(); if (VISTAS.includes(h) && S.estado) ponerVista(h); });

function mostrarVincular(msg) {
  for (const s of $$('.pantalla')) s.hidden = s.id !== 'v-vincular';
  $('.nav-pos').hidden = true; $('.barra-cobro').hidden = true; $('[data-accion="refrescar"]').hidden = true;
  const e = $('#v-vincular .error'); e.textContent = msg || ''; e.hidden = !msg;
}

function pintarTodo() {
  if (!S.estado) return;
  $('#v-cargando').hidden = true; $('#v-vincular').hidden = true;
  $('.nav-pos').hidden = false; $('[data-accion="refrescar"]').hidden = false;
  if (!VISTAS.some(v => !$(`#v-${v}`).hidden)) ponerVista(S.vista);
  pintarChips(); pintarVender(); pintarCarrito(); pintarStock(); pintarCaja(); pintarNav(); pintarRed();
  if (S.vista === 'reportes') pintarReportes();
}

function pintarNav() {
  const alertas = S.estado.productos.filter(p => nivelStock(stockDe(p), minimo()) !== 'ok').length;
  const n = $('.nav-pos .nav-num'); n.hidden = !alertas; n.textContent = alertas;
  const r = S.estado.caja.resumen;
  $('.nav-pos .nav-punto').hidden = r.abierta || r.cerrada;
}

// ---------------------------------------------------------------- VENDER
function pintarChips() {
  const g = [['todos', 'Todos'], ['Hombre', 'Hombre'], ['Mujer', 'Mujer'], ['Unisex', 'Unisex']]
    .filter(([k]) => k === 'todos' || S.estado.productos.some(p => p.genero === k));
  $('[data-filtro="vender"]').innerHTML = g.map(([k, t]) => `<button type="button" class="chip" data-accion="genero" data-v="${k}" aria-pressed="${S.generoVender === k}">${t}</button>`).join('');
  const f = [['todos', 'Todos'], ['bajo', 'Bajo stock'], ['agotado', 'Agotados']];
  $('[data-filtro="stock"]').innerHTML = f.map(([k, t]) => `<button type="button" class="chip" data-accion="filtro-stock" data-v="${k}" aria-pressed="${S.filtroStock === k}">${t}</button>`).join('')
    + `<label class="orden"><span class="sr">Ordenar</span><select data-accion="orden-stock">${[['menos', 'Menos stock primero'], ['dura', 'Se acaban primero'], ['mas', 'Más stock primero'], ['vendidos', 'Más vendidos (30 días)'], ['nombre', 'Nombre A–Z']].map(([k, t]) => `<option value="${k}"${S.ordenStock === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
}

const enCarrito = ref => S.carrito.find(i => i.ref === ref && !i.canje)?.cantidad || 0;

function pintarVender() {
  const lista = S.estado.productos
    .filter(p => (S.generoVender === 'todos' || p.genero === S.generoVender) && coincide(p, S.qVender))
    .sort((a, b) => (stockDe(b) > 0) - (stockDe(a) > 0) || b.pedidos30 - a.pedidos30 || a.nombre.localeCompare(b.nombre));
  const rej = $('#rejilla-vender');
  if (!lista.length) { rej.innerHTML = `<li class="vacio">No encontramos perfumes con “${esc(S.qVender)}”.</li>`; return; }
  rej.innerHTML = lista.map(p => {
    const st = stockDe(p), nv = nivelStock(st, minimo()), c = enCarrito(p.ref);
    return `<li><button type="button" class="prod nivel-${nv}${c ? ' en-venta' : ''}" data-accion="agregar" data-ref="${esc(p.ref)}" aria-label="${esc(titulo(p.nombre))}, ${fmtCS(p.precio)}, ${st > 0 ? `quedan ${st}` : 'agotado'}${c ? `, ${c} en la venta` : ''}">
      <span class="p-foto">${foto(p)}</span>
      ${c ? `<span class="p-cant" aria-hidden="true">${c}</span>` : ''}
      <span class="p-texto"><span class="p-nombre">${esc(titulo(p.nombre))}</span><span class="p-marca">${esc(titulo(p.marca))} · ${esc(p.pres)}</span></span>
      <span class="p-pie"><b class="p-precio">${fmtCS(p.precio)}</b><span class="p-stock">${st > 0 ? `Quedan ${st}` : 'Agotado'}</span></span>
    </button></li>`;
  }).join('');
}

async function agregar(ref, cuanto = 1) {
  const p = S.porRef.get(ref); if (!p) return;
  const actual = enCarrito(ref);
  const st = stockDe(p);
  if (cuanto > 0 && actual + cuanto > st && !S.permitidos.has(ref)) {
    const ok = await confirmar({ titulo: st > 0 ? `Solo quedan ${st} según tu hoja` : 'Tu hoja dice que no queda', texto: `${esc(titulo(p.nombre))}: si lo tienes en la mano, puedes venderlo igual. Después revisa el conteo en Stock.`, si: 'Vender igual' });
    if (!ok) return;
    S.permitidos.add(ref);
  }
  const it = S.carrito.find(i => i.ref === ref && !i.canje);
  if (it) it.cantidad = Math.max(0, it.cantidad + cuanto);
  else if (cuanto > 0) S.carrito.push({ ref, cantidad: cuanto });
  S.carrito = S.carrito.filter(i => i.cantidad > 0);
  guardarCarrito(); vibrar(8);
  pintarVender(); pintarCarrito();
  const b = $('.bc-boton'); b.classList.remove('salto'); void b.offsetWidth; b.classList.add('salto');
}

// La racha mayorista del cliente se aplica sola cuando la venta llega a su mínimo
function calc() {
  const base = calcularVenta(S.carrito, S.porRef, { minimoMayor: minMayor(), forzarMayor: S.forzarMayor });
  if (base.porMayor || !S.cliente) return base;
  const r = infoCliente(S.cliente.nombre)?.racha;
  if (!r?.activa || base.unidades < r.minimo) return base;
  const c = calcularVenta(S.carrito, S.porRef, { minimoMayor: minMayor(), forzarMayor: true });
  c.porRacha = r;
  return c;
}
const numeroSiguiente = () => (S.estado?.siguienteVenta || 1) + pendientes().filter(o => o.accion === 'venta').length;

// ¿Esta venta suma sello? Solo al detalle y con cliente. Con precio a mano o descuento, por defecto no.
const selloAplica = c => !!S.cliente && !c.porMayor && c.unidades > 0;
const sumaSello = c => selloAplica(c) && (S.sello ?? !c.especial);
const MOTIVOS_SELLO = ['Promoción o regalo', 'Compensación', 'Corrección', 'Tarjeta de papel', 'Otro'];

// Sellos de la tarjeta, premio y racha del cliente elegido
function htmlBeneficios(c) {
  if (!S.cliente) return '';
  const i = infoCliente(S.cliente.nombre); if (!i) return '';
  const { tarjeta: t, racha: r } = i;
  const premiosLibres = t.premios - c.regalos;
  const puntos = Array.from({ length: TARJETA.meta }, (_, k) => `<i class="${k < t.enTarjeta ? 'lleno' : ''}"></i>`).join('');
  const tarjeta = t.compras || t.sellos || t.canjes || !r.activa ? `<div class="sellos">
      <span class="sl-puntos" aria-hidden="true">${puntos}</span>
      <span class="sl-txt">${t.premios ? `<b>¡Tarjeta completa!</b> ${t.premios > 1 ? `${t.premios} premios` : '1 premio'} disponible${t.premios > 1 ? 's' : ''}` : t.compras === 0 && t.sellos === 0 ? '<b>Tarjeta nueva</b> · con esta compra al detalle recibe 3 sellos (2 de regalo)' : `<b>${t.sellos} de ${TARJETA.meta} sellos</b> · ${t.faltan === 1 ? 'le falta 1' : `le faltan ${t.faltan}`} para su perfume gratis`}</span>
      <button type="button" class="btn-texto chico" data-accion="ajustar-sellos">Sumar o quitar</button>
    </div>` : '';
  const on = sumaSello(c);
  const interruptor = selloAplica(c) ? `<label class="interruptor sello-switch"><input type="checkbox" data-accion="sello"${on ? ' checked' : ''}><span></span><i class="sw-txt">${on ? 'Esta compra suma 1 sello' : `Esta compra <b>no</b> suma sello${c.especial && S.sello === null ? ' (tiene precio especial)' : ''}`}</i></label>` : '';
  const premio = premiosLibres > 0 ? `<button type="button" class="btn premio-btn" data-accion="abrir-premio">${ico('regalo')}Canjear su perfume gratis (Stallion 53)</button>` : '';
  const racha = r.activa ? `<p class="racha-chip">${ico('rayo')}<span><b>Racha mayorista</b> · ${r.etapa === 'primera' ? 'puede llevar desde 1 perfume' : `desde ${r.minimo} perfumes`} a precio mayorista · vence ${enDias(r.dias)} (${fechaCorta(r.vence)})</span></p>`
    : r.vencida ? `<p class="racha-chip apagada">${ico('rayo')}<span>Su racha mayorista venció el ${fechaCorta(r.vencio)}. Con ${minMayor()} perfumes la reactiva.</span></p>` : '';
  return tarjeta || premio || racha || interruptor ? `<div class="beneficios">${tarjeta}${interruptor}${premio}${racha}</div>` : '';
}

// Lo que ganó el cliente con la venta (se muestra al terminar y va en el recibo)
function beneficiosDeVenta(c, antes, despues, sinSello) {
  const out = [];
  if (!despues) return out;
  if (sinSello) out.push({ tipo: 'gris', ico: 'estrella', texto: '<b>Sin sello</b> en esta compra (precio especial).' });
  if (c.regalos) out.push({ tipo: 'oro', ico: 'regalo', texto: `<b>Premio entregado.</b> La tarjeta vuelve a empezar.` });
  const ganados = despues.tarjeta.sellos - antes.tarjeta.sellos + c.regalos * TARJETA.meta;
  if (ganados > 0) out.push({ tipo: 'oro', ico: 'estrella', texto: `<b>+${plural(ganados, 'sello', 'sellos')}</b>${ganados > 1 ? ' (2 de regalo por su primera compra)' : ''} · lleva ${despues.tarjeta.enTarjeta} de ${TARJETA.meta}` });
  if (despues.tarjeta.premios > 0 && (antes.tarjeta.premios - c.regalos) < despues.tarjeta.premios) out.push({ tipo: 'oro', ico: 'regalo', texto: '<b>¡Completó su tarjeta!</b> En su próxima visita lleva un Stallion 53 gratis.' });
  const ra = antes.racha, rd = despues.racha;
  if (rd.activa && rd.etapa === 'primera' && !(ra.activa && ra.etapa === 'primera' && ra.vence === rd.vence)) out.push({ tipo: 'lila', ico: 'rayo', texto: `<b>Racha mayorista activada.</b> Hasta el ${fechaCorta(rd.vence)} puede llevar desde 1 perfume a precio mayorista.` });
  else if (rd.activa && rd.etapa === 'mantener' && (!ra.activa || rd.vence > ra.vence)) out.push({ tipo: 'lila', ico: 'rayo', texto: `<b>Racha mayorista renovada</b> hasta el ${fechaCorta(rd.vence)} (desde ${rd.minimo} perfumes).` });
  return out;
}

function pintarCarrito() {
  if (!S.estado) return;
  const c = calc();
  const minMayor = S.estado.config.minimoMayor;
  const tc = S.estado.config.tipoCambio;
  const html = !c.lineas.length ? `<div class="carrito-vacio">${ico('bolsa')}<p><b>Venta #${numeroSiguiente()}</b></p><p>Toca un perfume para agregarlo.</p></div>` : `
    <div class="cv-cabeza"><h3>Venta #${numeroSiguiente()}</h3><button type="button" class="btn-texto" data-accion="vaciar">Vaciar</button></div>
    <button type="button" class="cliente-btn" data-accion="abrir-cliente">${ico('usuario')}<span>${S.cliente ? `<b>${esc(S.cliente.nombre)}</b><small>${esc([S.cliente.telefono, S.cliente.ciudad].filter(Boolean).join(' · ') || 'Cliente')}${S.cliente.nuevo ? ' · nuevo' : ''}</small>` : '<b>Sin cliente</b><small>Toca para elegir o agregar uno</small>'}</span>${ico('flecha')}</button>
    ${htmlBeneficios(c)}
    <div class="mayoreo ${c.porMayor ? 'si' : ''}">
      <div class="my-barra"><i style="width:${Math.min(100, (c.unidades / minMayor) * 100)}%"></i></div>
      <p>${c.porRacha ? `${ico('rayo')}<b>Precio mayorista por su racha</b>${c.ahorro > 0 ? ` · ahorra ${fmtCS(c.ahorro)}` : ''}` : c.porMayor ? `${ico('check')}<b>Precio mayorista</b>${S.forzarMayor && c.unidades < minMayor ? ' (aplicado a mano)' : ''}${c.ahorro > 0 ? ` · ahorra ${fmtCS(c.ahorro)}` : ''}` : `<b>${c.unidades} de ${minMayor}</b> · faltan ${c.faltanMayor} para precio mayorista`}</p>
      ${c.unidades < minMayor && !c.porRacha ? `<label class="interruptor"><input type="checkbox" data-accion="forzar-mayor"${S.forzarMayor ? ' checked' : ''}><span></span>Aplicar precio mayorista a mano</label>` : ''}
    </div>
    <ul class="lineas">${c.lineas.map(l => l.canje ? `<li class="linea canje">
      <span class="l-foto">${foto(l.producto, 80)}</span>
      <div class="l-info"><b>${esc(titulo(l.producto.nombre))}</b><span class="l-premio">${ico('regalo')}Premio de la tarjeta</span></div>
      <div class="paso"><button type="button" data-accion="quitar-premio" data-ref="${esc(l.ref)}" aria-label="Quitar el premio">${ico('basura')}</button></div>
      <b class="l-total oro">Gratis</b>
    </li>` : `<li class="linea">
      <span class="l-foto">${foto(l.producto, 80)}</span>
      <div class="l-info"><b>${esc(titulo(l.producto.nombre))}</b>
        <button type="button" class="l-precio${l.manual ? ' manual' : ''}${l.mayorista ? ' mayor' : ''}" data-accion="editar-linea" data-ref="${esc(l.ref)}">${fmtCS(l.precio)} c/u${l.descuento ? ` · −${fmtCS(l.descuento)}` : ''}${ico('lapiz')}</button></div>
      <div class="paso"><button type="button" data-accion="menos" data-ref="${esc(l.ref)}" aria-label="Quitar uno">${ico(l.cantidad === 1 ? 'basura' : 'menos')}</button><span>${l.cantidad}</span><button type="button" data-accion="mas" data-ref="${esc(l.ref)}" aria-label="Agregar uno">${ico('mas')}</button></div>
      <b class="l-total">${fmtCS(l.total)}</b>
    </li>`).join('')}</ul>
    <dl class="totales">
      ${c.descuentos ? `<div><dt>Subtotal</dt><dd>${fmtCS(c.subtotal)}</dd></div><div><dt>Descuentos</dt><dd>−${fmtCS(c.descuentos)}</dd></div>` : ''}
      <div class="t-final"><dt>Total · ${c.unidades} ${c.unidades === 1 ? 'perfume' : 'perfumes'}${c.regalos ? ` + ${c.regalos} gratis` : ''}</dt><dd>${fmtCS(c.total)}<small>${tc ? `≈ ${fmtUSD(c.total / tc)}` : ''}</small></dd></div>
    </dl>
    <button type="button" class="btn pri btn-cobrar" data-accion="cobrar">${c.total > 0 ? `${ico('billete')}Cobrar ${fmtCS(c.total)}` : `${ico('regalo')}Entregar premio`}</button>`;
  for (const el of $$('[data-carrito]')) el.innerHTML = html;
  pintarBarraCobro();
}

function pintarBarraCobro() {
  const c = S.estado ? calc() : { unidades: 0 };
  const b = $('.barra-cobro');
  b.hidden = !S.estado || S.vista !== 'vender' || !(c.unidades || c.regalos);
  if (b.hidden) return;
  $('.bc-cant', b).textContent = c.unidades + (c.regalos || 0);
  $('.bc-total', b).textContent = fmtCS(c.total);
  $('.bc-mayor', b).textContent = c.porRacha ? 'Precio mayorista (racha)' : c.porMayor ? 'Precio mayorista' : `Faltan ${c.faltanMayor} para mayorista`;
  b.classList.toggle('mayor', c.porMayor);
}

// editar precio / descuento de una línea
function abrirLinea(ref) {
  const it = S.carrito.find(i => i.ref === ref && !i.canje); const p = S.porRef.get(ref);
  if (!it || !p) return;
  const l = calc().lineas.find(x => x.ref === ref && !x.canje);
  $('.linea-editar').innerHTML = `<form data-form="linea" data-ref="${esc(ref)}" novalidate>
    <p class="le-nombre">${esc(titulo(p.nombre))} · ${l.cantidad} ${l.cantidad === 1 ? 'unidad' : 'unidades'}</p>
    <p class="le-ayuda">Detalle ${fmtCS(p.precio)} · Mayorista ${p.mayor ? fmtCS(p.mayor) : '—'}</p>
    <label class="campo"><span>Precio por unidad</span><span class="con-pre"><i>C$</i><input name="precio" type="text" inputmode="decimal" value="${it.precio || ''}" placeholder="${l.manual ? '' : l.precio}"></span></label>
    <label class="campo"><span>Descuento total de esta línea <small>(opcional)</small></span><span class="con-pre"><i>C$</i><input name="descuento" type="text" inputmode="decimal" value="${it.descuento || ''}" placeholder="0"></span></label>
    <div class="acciones"><button class="btn sec" type="button" data-accion="precio-auto" data-ref="${esc(ref)}">Precio automático</button><button class="btn pri" type="submit">Listo</button></div>
    <button class="btn-texto peligro" type="button" data-accion="quitar-linea" data-ref="${esc(ref)}">Quitar de la venta</button>
  </form>`;
  abrir($('#h-linea'));
}
const leerMonto = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return n > 0 ? redondear(n) : 0; };

// ---------------------------------------------------------------- CLIENTE
function pintarClientes(q = '') {
  const lista = (S.estado.clientes || []).filter(c => !q || norm(`${c.nombre} ${c.telefono}`).includes(norm(q)))
    .sort((a, b) => b.compras - a.compras || a.nombre.localeCompare(b.nombre)).slice(0, 40);
  $('.cl-lista').innerHTML = `<li><button type="button" class="cl-op" data-accion="elegir-cliente" data-i="-1">${ico('bolsa')}<span><b>Sin cliente</b><small>Venta de mostrador</small></span></button></li>`
    + lista.map(c => {
      const i = infoCliente(c.nombre);
      const marcas = [i?.racha?.activa ? `<span class="cl-marca racha">${ico('rayo')}Racha</span>` : '', i?.tarjeta?.premios ? `<span class="cl-marca premio">${ico('regalo')}Premio</span>` : i?.tarjeta?.sellos ? `<span class="cl-marca">${ico('estrella')}${i.tarjeta.enTarjeta}/${TARJETA.meta}</span>` : ''].join('');
      return `<li><button type="button" class="cl-op${S.cliente?.nombre === c.nombre ? ' sel' : ''}" data-accion="elegir-cliente" data-nombre="${esc(c.nombre)}">${ico('usuario')}<span><b>${esc(c.nombre)}</b><small>${esc([c.telefono, c.ciudad, c.compras ? `${c.compras} ${c.compras === 1 ? 'compra' : 'compras'}` : '', c.nota].filter(Boolean).join(' · '))}</small></span>${marcas ? `<span class="cl-marcas">${marcas}</span>` : ''}</button></li>`;
    }).join('')
    + (q && !lista.length ? `<li class="vacio">No hay clientes con “${esc(q)}”.</li>` : '');
}
function abrirCliente() {
  const ciudades = S.estado.config.ciudades || ['Estelí'];
  $('.cliente').innerHTML = `<label class="buscar">${ico('buscar')}<span class="sr">Buscar cliente</span><input type="search" data-buscar="cliente" placeholder="Buscar por nombre o teléfono" autocomplete="off"></label>
    <ul class="cl-lista"></ul>
    <details class="cl-nuevo"><summary>${ico('mas')}Cliente nuevo</summary>
      <form data-form="cliente" novalidate>
        <label class="campo"><span>Nombre</span><input name="nombre" type="text" maxlength="60" autocomplete="off" required></label>
        <label class="campo"><span>Teléfono <small>(opcional)</small></span><input name="telefono" type="tel" maxlength="20" autocomplete="off" placeholder="8888-8888"></label>
        <label class="campo"><span>Ciudad</span><select name="ciudad">${ciudades.map(c => `<option${c === 'Estelí' ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <p class="error" hidden role="alert"></p>
        <button class="btn pri" type="submit">Usar este cliente</button>
        <p class="ayuda">Se agrega a tu hoja Clientes al guardar la venta.</p>
      </form>
    </details>`;
  pintarClientes();
  abrir($('#h-cliente'));
}

// ---------------------------------------------------------------- COBRAR
function pintarCobro() {
  const c = calc();
  const { metodo, banco, recibido } = S.cobro;
  const v = metodo === 'Efectivo' ? vuelto(c.total, recibido) : 0;
  const tc = S.estado.config.tipoCambio;
  if (c.total <= 0) {
    $('.cobro').innerHTML = `<div class="cb-total premio"><small>Premio de la tarjeta de fidelidad</small><b>Gratis</b><span>${esc(S.cliente?.nombre || '')} canjea 10 sellos por ${plural(c.regalos, 'perfume', 'perfumes')}.</span></div>
      <p class="nota-banco">${ico('check')}Se anota en tu hoja a C$0 (sale del stock y la tarjeta vuelve a empezar).</p>`;
    $('.cobro-pie').innerHTML = `<button type="button" class="btn pri" data-accion="confirmar-venta">${ico('regalo')}Entregar premio</button>`;
    return;
  }
  $('.cobro').innerHTML = `
    <div class="cb-total"><small>Total a cobrar</small><b>${fmtCS(c.total)}</b><span>${tc ? `≈ ${fmtUSD(c.total / tc)} · ` : ''}${c.unidades} ${c.unidades === 1 ? 'perfume' : 'perfumes'}${c.porMayor ? ' · precio mayorista' : ''}</span></div>
    <p class="cb-sub">¿Cómo pagó?</p>
    <div class="metodos">
      <button type="button" class="metodo" data-accion="metodo" data-m="Efectivo" aria-pressed="${metodo === 'Efectivo'}">${ico('billete')}<span>Efectivo</span></button>
      ${BANCOS.map(b => `<button type="button" class="metodo banco-${b.toLowerCase()}" data-accion="metodo" data-m="Transferencia" data-b="${b}" aria-pressed="${metodo === 'Transferencia' && banco === b}">${ico('banco')}<span>${b}<small>Transferencia</small></span></button>`).join('')}
    </div>
    ${metodo === 'Efectivo' ? `<div class="efectivo">
      <label class="campo"><span>Recibido <small>(opcional)</small></span><span class="con-pre grande"><i>C$</i><input data-campo="recibido" type="text" inputmode="decimal" value="${esc(recibido)}" placeholder="${c.total}"></span></label>
      <div class="billetes">${[c.total, ...billetesSugeridos(c.total)].map((m, i) => `<button type="button" class="chip" data-accion="recibido" data-m="${m}">${i ? fmtCS(m) : 'Exacto'}</button>`).join('')}</div>
      <p class="vuelto ${v === null ? 'falta' : ''}" aria-live="polite">${v === null ? `Faltan ${fmtCS(c.total - Number(recibido))}` : `Vuelto: <b>${fmtCS(v)}</b>`}</p>
    </div>` : ''}
    ${metodo === 'Transferencia' ? `<p class="nota-banco">${ico('check')}Revisa en tu app de ${esc(banco)} que la transferencia ya entró.</p>` : ''}`;
  const listo = metodo && v !== null;
  $('.cobro-pie').innerHTML = `<button type="button" class="btn pri" data-accion="confirmar-venta" ${listo ? '' : 'aria-disabled="true"'}>${ico('check')}Confirmar venta</button>`;
}
function abrirCobro() {
  const c = calc();
  if (!c.lineas.length) return;
  S.cobro = { metodo: c.total > 0 ? null : 'Efectivo', banco: null, recibido: '' };
  pintarCobro();
  cerrar($('#h-carrito'));
  abrir($('#h-cobro'));
}

async function confirmarVenta() {
  const c = calc();
  const { metodo, banco, recibido } = S.cobro;
  if (!c.lineas.length || !metodo || vuelto(c.total, recibido) === null) return;
  const id = nuevoId();
  const sinSello = selloAplica(c) && !sumaSello(c);
  const venta = armarVenta(c, { id, cliente: S.cliente, metodo: metodo === 'Efectivo' ? 'Efectivo' : 'Transferencia', banco, recibido, sinSello });
  const antes = S.cliente ? infoCliente(S.cliente.nombre) : null;
  encolar({ id, accion: 'venta', venta });
  const despues = S.cliente ? infoCliente(S.cliente.nombre) : null;   // ya cuenta esta venta (está en la cola)
  const hora = new Intl.DateTimeFormat('es-NI', { timeZone: 'America/Managua', hour: 'numeric', minute: '2-digit' }).format(new Date());
  S.ultima = { id, numero: null, estado: 'guardando', calc: c, metodo, banco, recibido, cliente: S.cliente, fecha: fechaCorta(hoy()), hora,
    beneficios: beneficiosDeVenta(c, antes, despues, sinSello), sinSello, tarjeta: despues?.tarjeta || null, racha: despues?.racha || null,
    ganados: antes && despues ? Math.max(0, despues.tarjeta.sellos - antes.tarjeta.sellos + c.regalos * TARJETA.meta) : 0 };
  S.recibo = null;
  S.carrito = []; S.cliente = null; S.forzarMayor = false; S.sello = null; S.permitidos.clear(); guardarCarrito();
  cerrar($('#h-cobro'));
  pintarListo(); abrir($('#h-listo')); vibrar([10, 40, 20]);
  pintarTodo();
  sincronizar({ silencioso: true });
}

function pintarListo() {
  const u = S.ultima; if (!u) return;
  const v = u.metodo === 'Efectivo' ? vuelto(u.calc.total, u.recibido) : 0;
  const tel = telWa(u.cliente?.telefono);
  const texto = recibo({ numero: u.numero, fecha: u.fecha, calc: u.calc, metodo: u.metodo, banco: u.banco, recibido: u.recibido, cliente: u.cliente });
  const estado = { guardando: ['enviando', 'Guardando en tu hoja…'], guardada: ['ok', `Venta #${u.numero} guardada en tu hoja`], pendiente: ['pendiente', 'Sin señal: quedó en el teléfono y se enviará sola'] }[u.estado];
  $('.listo').innerHTML = `
    <div class="ls-check">${ico('check')}</div>
    <h2 id="t-listo">${fmtCS(u.calc.total)}</h2>
    <p class="ls-estado ${estado[0]}">${esc(estado[1])}</p>
    ${u.metodo === 'Efectivo' && v > 0 ? `<p class="ls-vuelto">Vuelto <b>${fmtCS(v)}</b></p>` : ''}
    <p class="ls-pago">${u.calc.total <= 0 ? 'Premio de la tarjeta' : u.metodo === 'Efectivo' ? 'Efectivo' : `Transferencia ${esc(u.banco)}`}${u.cliente ? ` · ${esc(u.cliente.nombre)}` : ''}</p>
    ${u.beneficios?.length ? `<ul class="ls-beneficios">${u.beneficios.map(b => `<li class="${b.tipo}">${ico(b.ico)}<span>${b.texto}</span></li>`).join('')}</ul>` : ''}
    <div class="acciones col">
      <button class="btn sec" type="button" data-accion="ver-recibo">${ico('imagen')}Recibo con tu logo${u.numero ? '' : u.estado === 'guardando' ? ' (esperando número…)' : ''}</button>
      <a class="btn sec" href="https://wa.me/${tel}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">${ico('chat')}Recibo en texto por WhatsApp</a>
      <button class="btn pri" type="button" data-accion="nueva-venta">Nueva venta</button>
    </div>`;
}

// ---------------------------------------------------------------- STOCK
function pintarStock() {
  const ps = S.estado.productos;
  const mn = minimo();
  let unidades = 0, valor = 0, bajo = 0, agot = 0;
  for (const p of ps) { const s = Math.max(0, stockDe(p)); unidades += s; valor += s * p.costo; const n = nivelStock(stockDe(p), mn); if (n === 'bajo') bajo++; if (n === 'agotado') agot++; }
  $('.stock-resumen').innerHTML = `
    <div class="sr-item"><b>${ps.length}</b><span>perfumes</span></div>
    <div class="sr-item"><b>${unidades}</b><span>unidades</span></div>
    <div class="sr-item"><b>${fmtCS(Math.round(valor))}</b><span>valor al costo</span></div>
    <button type="button" class="sr-item bajo" data-accion="filtro-stock" data-v="bajo"><b>${bajo}</b><span>bajo stock</span></button>
    <button type="button" class="sr-item agotado" data-accion="filtro-stock" data-v="agotado"><b>${agot}</b><span>agotados</span></button>`;
  const rep = filasReposicion(); const porRef = new Map(rep.map(r => [r.p.ref, r]));
  const lista0 = porReponer(rep);
  const agotVenta = lista0.filter(r => r.nivel === 'agotado').length, urg = lista0.filter(r => r.nivel === 'urgente').length;
  $('.reponer-aviso').innerHTML = lista0.length ? `<button type="button" class="tarjeta reponer-btn" data-accion="abrir-reponer">
      <span class="rp-ico">${ico('camion')}</span>
      <span class="rp-txt"><b>${plural(lista0.length, 'perfume por reponer', 'perfumes por reponer')}</b><small>${[agotVenta ? `${agotVenta} ${agotVenta === 1 ? 'agotado que se vende' : 'agotados que se venden'}` : '', urg ? `${urg} se ${urg === 1 ? 'acaba' : 'acaban'} esta semana` : '', ].filter(Boolean).join(' · ') || 'según tus ventas de 30 días'}</small></span>
      <span class="rp-ir">Ver pedido${ico('flecha')}</span></button>` : (S.estado.historial || []).length ? `<p class="reponer-ok">${ico('check')}Al ritmo de tus ventas, todo tiene stock para más de 2 semanas.</p>` : '';
  const ord = {
    dura: (a, b) => (porRef.get(a.ref)?.dias ?? 1e9) - (porRef.get(b.ref)?.dias ?? 1e9),
    menos: (a, b) => stockDe(a) - stockDe(b), mas: (a, b) => stockDe(b) - stockDe(a),
    vendidos: (a, b) => b.pedidos30 - a.pedidos30, nombre: (a, b) => a.nombre.localeCompare(b.nombre),
  }[S.ordenStock];
  const lista = ps.filter(p => coincide(p, S.qStock) && (S.filtroStock === 'todos' || nivelStock(stockDe(p), mn) === S.filtroStock))
    .sort((a, b) => ord(a, b) || a.nombre.localeCompare(b.nombre));
  $('#lista-stock').innerHTML = lista.length ? lista.map(p => {
    const st = stockDe(p), nv = nivelStock(st, mn);
    return `<li><button type="button" class="st-fila nivel-${nv}" data-accion="ver-producto" data-ref="${esc(p.ref)}">
      <span class="st-foto">${foto(p, 96)}</span>
      <span class="st-texto"><b>${esc(titulo(p.nombre))}</b><small>${esc(titulo(p.marca))} · ${esc(p.pres)}${p.genero ? ` · ${esc(p.genero)}` : ''}</small>
        <small class="st-precios">${fmtCS(p.precio)}${p.mayor ? ` · mayor ${fmtCS(p.mayor)}` : ''}${p.pedidos30 ? ` · ${p.pedidos30} ${p.pedidos30 === 1 ? 'venta' : 'ventas'} en 30 días` : ''}</small>
        ${(() => { const r = porRef.get(p.ref); if (!r) return ''; return r.nivel === 'agotado' ? `<small class="st-dura agotado">Agotado · vendiste ${r.vendidos} en 30 días</small>` : r.nivel === 'urgente' || r.nivel === 'pronto' ? `<small class="st-dura ${r.nivel}">Se acaba ${enDias(r.dias)} a este ritmo</small>` : ''; })()}</span>
      <span class="st-num"><b>${st}</b><small>${nv === 'agotado' ? 'agotado' : nv === 'bajo' ? 'bajo' : 'en stock'}</small></span>
    </button></li>`;
  }).join('') : `<li class="vacio">${S.qStock ? `No encontramos “${esc(S.qStock)}”.` : 'Nada por aquí.'}</li>`;
}

function abrirProducto(ref) {
  const p = S.porRef.get(ref); if (!p) return;
  S.ajuste = { ref, cantidad: stockDe(p) > 0 ? -1 : 1, motivo: null, nota: '' };
  pintarProducto();
  abrir($('#h-producto'));
}
function pintarProducto() {
  const p = S.porRef.get(S.ajuste.ref); if (!p) return;
  const st = stockDe(p), nv = nivelStock(st, minimo());
  const margen = p.precio > 0 && p.costo > 0 ? Math.round(((p.precio - p.costo) / p.precio) * 100) : null;
  const a = S.ajuste;
  $('#t-producto').textContent = titulo(p.nombre);
  $('.producto').innerHTML = `
    <div class="pr-cabeza"><span class="pr-foto">${foto(p, 240)}</span>
      <div><p class="pr-marca">${esc(titulo(p.marca))} · ${esc(p.pres)}</p><p class="pr-stock nivel-${nv}"><b>${st}</b> ${st === 1 ? 'unidad' : 'unidades'}</p><p class="pr-sku">Código ${esc(p.sku)}</p></div></div>
    <dl class="pr-datos">
      <div><dt>Precio al detalle</dt><dd>${fmtCS(p.precio)}</dd></div>
      <div><dt>Precio mayorista</dt><dd>${p.mayor ? fmtCS(p.mayor) : '—'}</dd></div>
      <div><dt>Costo real</dt><dd>${fmtCS(p.costo)}</dd></div>
      <div><dt>Margen al detalle</dt><dd>${margen === null ? '—' : `${margen}%`}</dd></div>
      <div><dt>Vendidos en 30 días</dt><dd>${p.pedidos30}</dd></div>
      ${(() => { const r = filasReposicion().find(x => x.p.ref === p.ref); return r && r.ritmo ? `<div><dt>A este ritmo dura</dt><dd>${r.stock ? `~${plural(r.dias, 'día', 'días')}` : 'Agotado'}</dd></div><div><dt>Pedir para 30 días</dt><dd>${r.sugerido || '—'}</dd></div>` : ''; })()}
      <div><dt>Familia · género</dt><dd>${esc([p.familia, p.genero].filter(Boolean).join(' · ') || '—')}</dd></div>
    </dl>
    <div class="ajuste">
      <h3>${ico('ajustar')}Ajustar inventario</h3>
      <p class="ayuda">Si al contar te falta o te sobra (no es una venta). Se anota en tu hoja Ajustes.</p>
      <div class="aj-paso"><button type="button" data-accion="aj-menos" aria-label="Menos">${ico('menos')}</button><output class="${a.cantidad > 0 ? 'sobra' : 'falta'}">${a.cantidad > 0 ? '+' : ''}${a.cantidad}</output><button type="button" data-accion="aj-mas" aria-label="Más">${ico('mas')}</button></div>
      <p class="aj-txt">${a.cantidad < 0 ? `Falta${a.cantidad === -1 ? '' : 'n'} ${-a.cantidad}` : `Sobra${a.cantidad === 1 ? '' : 'n'} ${a.cantidad}`} · quedaría en <b>${st + a.cantidad}</b></p>
      <div class="chips motivos">${S.estado.config.motivos.map(m => `<button type="button" class="chip" data-accion="aj-motivo" data-m="${esc(m)}" aria-pressed="${a.motivo === m}">${esc(m)}</button>`).join('')}</div>
      <label class="campo"><span>Nota <small>(opcional)</small></span><input data-campo="aj-nota" type="text" maxlength="120" value="${esc(a.nota)}"></label>
      <button type="button" class="btn pri" data-accion="guardar-ajuste" ${a.motivo ? '' : 'aria-disabled="true"'}>Guardar ajuste</button>
    </div>`;
}

// ---------------------------------------------------------------- CAJA
function pintarCaja() {
  const { resumen: r, movimientos: m } = S.estado.caja;
  const h = S.estado.hoy;
  const pend = pendientes().filter(o => o.accion !== 'venta' || true);
  const errs = errores();
  const anuladas = new Set(m.filter(x => x.tipo === 'Anulación').map(x => x.venta));
  const cierre = [...m].reverse().find(x => x.tipo === 'Cierre');
  const metodos = Object.entries(h.porMetodo || {}).sort((a, b) => b[1] - a[1]);
  $('.caja').innerHTML = `
    <div class="cj-cabeza"><h1>Caja de hoy</h1><p>${esc(S.estado.fecha)}</p></div>
    ${errs.length ? `<div class="tarjeta alerta">${ico('aviso')}<div><b>${errs.length === 1 ? 'Una operación no se guardó' : `${errs.length} operaciones no se guardaron`}</b>
      <ul>${errs.map(e => `<li>${esc(e.op.accion === 'venta' ? `Venta de ${fmtCS(e.op.venta.lineas.reduce((s, l) => s + l.cantidad * l.precio - (l.descuento || 0), 0))}` : e.op.accion)}: ${esc(e.error)}</li>`).join('')}</ul>
      <button type="button" class="btn-texto" data-accion="borrar-errores">Entendido</button></div></div>` : ''}
    ${pend.length ? `<div class="tarjeta pendiente">${ico('nube')}<p><b>${pend.length} por enviar a tu hoja.</b> Se envían solas cuando vuelve la señal.</p><button type="button" class="btn sec chico" data-accion="sincronizar">Enviar ahora</button></div>` : ''}
    ${!r.abierta && !r.cerrada ? `<form class="tarjeta abrir-caja" data-form="apertura" novalidate>
        <h2>${ico('caja')}Abre la caja</h2><p>Escribe con cuánto efectivo empiezas el día.</p>
        <div class="fila-campo"><span class="con-pre"><i>C$</i><input name="monto" type="text" inputmode="decimal" placeholder="0"></span><button class="btn pri" type="submit">Abrir caja</button></div>
      </form>` : ''}
    <div class="tarjeta efectivo-caja ${r.cerrada ? 'cerrada' : ''}">
      <p class="ec-titulo">${r.cerrada ? 'Caja cerrada' : 'Efectivo que debe haber en caja'}</p>
      <p class="ec-monto">${fmtCS(r.cerrada && cierre ? cierre.contado : r.esperado)}</p>
      ${r.cerrada && cierre ? `<p class="ec-dif ${cierre.diferencia === 0 ? 'cuadra' : cierre.diferencia < 0 ? 'falta' : 'sobra'}">${cierre.diferencia === 0 ? `${ico('check')}Cuadró exacto` : cierre.diferencia < 0 ? `Faltaron ${fmtCS(-cierre.diferencia)}` : `Sobraron ${fmtCS(cierre.diferencia)}`} · se esperaban ${fmtCS(r.esperado)}</p>` : ''}
      <dl class="ec-filas">
        <div><dt>Apertura</dt><dd>${fmtCS(r.apertura)}</dd></div>
        <div><dt>Ventas en efectivo</dt><dd>+ ${fmtCS(r.ventasEfectivo)}</dd></div>
        <div><dt>Entradas</dt><dd>+ ${fmtCS(r.entradas)}</dd></div>
        <div><dt>Salidas</dt><dd>− ${fmtCS(r.salidas)}</dd></div>
      </dl>
      <div class="acciones">
        <button type="button" class="btn sec" data-accion="caja-form" data-tipo="entrada">${ico('entra')}Entrada</button>
        <button type="button" class="btn sec" data-accion="caja-form" data-tipo="salida">${ico('sale')}Salida</button>
        ${r.abierta ? `<button type="button" class="btn pri" data-accion="caja-form" data-tipo="cierre">${ico('candado')}Cerrar caja</button>` : r.cerrada ? `<button type="button" class="btn pri" data-accion="caja-form" data-tipo="apertura">Reabrir caja</button>` : ''}
      </div>
    </div>
    <div class="tarjeta bancos"><p class="ec-titulo">Transferencias de hoy</p>
      <ul>${BANCOS.map(b => `<li class="banco-${b.toLowerCase()}"><span>${ico('banco')}${b}</span><b>${fmtCS(r.bancos?.[b] || 0)}</b></li>`).join('')}</ul></div>
    <div class="tarjeta hoy"><p class="ec-titulo">Ventas de hoy <small>(toda la hoja, también las que anotas a mano)</small></p>
      <div class="hoy-nums"><div><b>${h.numeros.length}</b><span>${h.numeros.length === 1 ? 'venta' : 'ventas'}</span></div><div><b>${h.unidades}</b><span>perfumes</span></div><div><b>${fmtCS(h.total)}</b><span>vendido</span></div><div><b>${fmtCS(h.ganancia)}</b><span>ganancia</span></div></div>
      ${metodos.length ? `<ul class="hoy-metodos">${metodos.map(([k, v]) => `<li><span>${esc(k)}</span><b>${fmtCS(v)}</b></li>`).join('')}</ul>` : ''}
    </div>
    <div class="tarjeta movimientos"><p class="ec-titulo">Movimientos</p>
      ${m.length ? `<ul>${[...m].reverse().map(x => `<li class="mv-${norm(x.tipo).replace(/\s/g, '-')}">
        <span class="mv-hora">${esc(x.hora)}</span>
        <span class="mv-texto"><b>${esc(x.tipo)}</b><small>${esc(x.concepto)}${x.banco ? ` · ${esc(x.banco)}` : x.tipo === 'Venta' ? ` · ${esc(x.metodo)}` : ''}</small></span>
        <span class="mv-monto ${x.monto < 0 ? 'neg' : ''}">${x.tipo === 'Cierre' ? fmtCS(x.contado) : `${x.monto > 0 ? '+' : ''}${fmtCS(x.monto)}`}</span>
        ${x.tipo === 'Venta' && x.venta && !anuladas.has(x.venta) ? `<button type="button" class="btn-texto chico" data-accion="anular" data-n="${x.venta}" aria-label="Anular venta ${x.venta}">${ico('deshacer')}Anular</button>` : x.tipo === 'Venta' && anuladas.has(x.venta) ? '<span class="mv-anulada">Anulada</span>' : ''}
      </li>`).join('')}</ul>` : '<p class="vacio">Todavía no hay movimientos hoy.</p>'}
    </div>
    <button type="button" class="btn-texto desvincular" data-accion="desvincular">Desvincular este dispositivo</button>`;
}

function abrirCajaForm(tipo) {
  const r = S.estado.caja.resumen;
  const t = { apertura: 'Abrir caja', entrada: 'Entrada de efectivo', salida: 'Salida de efectivo', cierre: 'Cerrar caja' }[tipo];
  $('#t-hcaja').textContent = t;
  $('.caja-form').innerHTML = `<form data-form="caja" data-tipo="${tipo}" novalidate>
    ${tipo === 'cierre' ? `<p class="cf-esperado">Debe haber <b>${fmtCS(r.esperado)}</b> en efectivo.</p>` : ''}
    <label class="campo"><span>${tipo === 'cierre' ? 'Efectivo que contaste' : tipo === 'apertura' ? 'Efectivo con que empiezas' : 'Monto'}</span><span class="con-pre grande"><i>C$</i><input name="monto" type="text" inputmode="decimal" placeholder="0" autocomplete="off"></span></label>
    ${tipo === 'cierre' ? '<p class="cf-dif" aria-live="polite"></p>' : ''}
    ${tipo === 'entrada' || tipo === 'salida' ? `<label class="campo"><span>${tipo === 'entrada' ? '¿De dónde viene?' : '¿Para qué?'}</span><input name="concepto" type="text" maxlength="80" placeholder="${tipo === 'entrada' ? 'Ej.: cambio, sencillo' : 'Ej.: bolsas, almuerzo, depósito al banco'}"></label>` : ''}
    ${tipo === 'salida' ? `<label class="interruptor"><input type="checkbox" name="esGasto"><span></span>Es un gasto del negocio (va también a tu hoja Gastos)</label>
      <div class="chips categorias" hidden>${(S.estado.config.gastos || []).map(g => `<button type="button" class="chip" data-accion="categoria" data-c="${esc(g)}" aria-pressed="false">${esc(g)}</button>`).join('')}</div>` : ''}
    <p class="error" hidden role="alert"></p>
    <button class="btn pri" type="submit">${t}</button>
  </form>`;
  abrir($('#h-caja'));
  setTimeout(() => $('.caja-form input[name="monto"]')?.focus(), 250);
}

async function operar(op, okTexto) {
  encolar(op);
  pintarTodo();
  await sincronizar({ silencioso: true });
  const sigue = pendientes().some(o => o.id === op.id);
  aviso(sigue ? 'Sin señal: quedó guardado en el teléfono y se enviará solo.' : okTexto, sigue ? '' : 'ok');
}


// ---------------------------------------------------------------- PREMIO Y SELLOS
function abrirPremio() {
  const ps = S.estado.productos.filter(esPremio).sort((a, b) => (stockDe(b) > 0) - (stockDe(a) > 0) || a.nombre.localeCompare(b.nombre));
  $('.premio-lista').innerHTML = `<p class="ayuda">${esc(S.cliente?.nombre || '')} completó su tarjeta: elige el Stallion 53 que se lleva. Va a C$0 y se descuentan 10 sellos.</p>
    ${ps.length ? `<ul class="pm-lista">${ps.map(p => { const st = stockDe(p); return `<li><button type="button" class="st-fila nivel-${nivelStock(st, minimo())}" data-accion="elegir-premio" data-ref="${esc(p.ref)}">
      <span class="st-foto">${foto(p, 96)}</span><span class="st-texto"><b>${esc(titulo(p.nombre))}</b><small>${esc(titulo(p.marca))} · ${esc(p.pres)}${p.genero ? ` · ${esc(p.genero)}` : ''}</small></span>
      <span class="st-num"><b>${st}</b><small>${st > 0 ? 'en stock' : 'agotado'}</small></span></button></li>`; }).join('')}</ul>`
    : '<p class="vacio">No encontré perfumes Stallion 53 en tu Inventario.</p>'}`;
  abrir($('#h-premio'));
}
async function elegirPremio(ref) {
  const p = S.porRef.get(ref); if (!p) return;
  if (stockDe(p) <= 0 && !(await confirmar({ titulo: 'Tu hoja dice que no queda', texto: `${esc(titulo(p.nombre))}: si lo tienes en la mano, puedes entregarlo igual.`, si: 'Entregar igual' }))) return;
  S.carrito.push({ ref, cantidad: 1, canje: true });
  guardarCarrito(); cerrar($('#h-premio')); pintarVender(); pintarCarrito(); vibrar(10);
}
function abrirSellos() {
  if (!infoCliente(S.cliente?.nombre)) return;
  S.ajSellos = { delta: 1, motivo: null, nota: '' };
  pintarSellos();
  abrir($('#h-sellos'));
}
function pintarSellos() {
  const i = infoCliente(S.cliente?.nombre); if (!i) return;
  const a = S.ajSellos, t = i.tarjeta;
  const queda = Math.max(0, t.sellos + a.delta);
  const movs = ajustesDe(S.cliente.nombre, ajustesSellos()).slice(-5).reverse();
  $('.sellos-form').innerHTML = `<form data-form="sellos" novalidate>
    <p class="le-nombre">${esc(S.cliente.nombre)}</p>
    <p class="le-ayuda">Tiene <b>${plural(t.sellos, 'sello', 'sellos')}</b>. Agrega o quita los que quieras; queda anotado con su motivo en tu hoja Fidelidad.</p>
    <div class="aj-paso"><button type="button" data-accion="sl-menos" aria-label="Quitar un sello" ${t.sellos + a.delta <= 0 ? 'aria-disabled="true"' : ''}>${ico('menos')}</button><output class="${a.delta > 0 ? 'sobra' : 'falta'}">${a.delta > 0 ? '+' : ''}${a.delta}</output><button type="button" data-accion="sl-mas" aria-label="Agregar un sello">${ico('mas')}</button></div>
    <p class="aj-txt">${a.delta > 0 ? `Agregar ${plural(a.delta, 'sello', 'sellos')}` : `Quitar ${plural(-a.delta, 'sello', 'sellos')}`} · quedaría en <b>${queda}</b>${queda >= TARJETA.meta ? ' (con premio)' : ''}</p>
    <div class="chips motivos" role="group" aria-label="Motivo">${MOTIVOS_SELLO.map(m => `<button type="button" class="chip" data-accion="sl-motivo" data-m="${esc(m)}" aria-pressed="${a.motivo === m}">${esc(m)}</button>`).join('')}</div>
    <label class="campo"><span>Nota <small>(opcional)</small></span><input name="nota" type="text" maxlength="100" value="${esc(a.nota)}" placeholder="Ej.: cumpleaños, se equivocó el conteo"></label>
    <p class="error" hidden role="alert"></p>
    <button class="btn pri" type="submit" ${a.motivo ? '' : 'aria-disabled="true"'}>${a.motivo ? 'Guardar' : 'Elige el motivo'}</button>
    ${movs.length ? `<div class="sl-movs"><p class="ec-titulo">Movimientos a mano</p><ul>${movs.map(m => `<li><span>${esc(fechaCorta(m.dia))}</span><b class="${m.sellos > 0 ? 'mas' : 'menos'}">${m.sellos > 0 ? '+' : ''}${m.sellos}</b><small>${esc(m.nota)}</small></li>`).join('')}</ul></div>` : ''}
  </form>`;
}

// ---------------------------------------------------------------- REPONER
function pintarReponer() {
  const lista = porReponer(filasReposicion());
  for (const r of lista) if (!S.pedido.has(r.p.ref)) S.pedido.set(r.p.ref, r.sugerido);
  const tc = S.estado.config.tipoCambio;
  let unidades = 0, costo = 0;
  for (const r of lista) { const q = S.pedido.get(r.p.ref) || 0; unidades += q; costo += q * (r.p.costo || 0); }
  $('.reponer').innerHTML = `<p class="ayuda">Lo que vendiste en los últimos 30 días, para tener stock para 30 días más. Ajusta las cantidades antes de mandarlo.</p>
    <ul class="rp-lista">${lista.map(r => { const q = S.pedido.get(r.p.ref) || 0; return `<li class="rp-fila ${r.nivel}">
      <span class="st-foto">${foto(r.p, 80)}</span>
      <span class="st-texto"><b>${esc(titulo(r.p.nombre))}</b><small>${esc(titulo(r.p.marca))} · ${esc(r.p.pres)}</small>
        <small class="st-dura ${r.nivel}">${r.nivel === 'agotado' ? 'Agotado' : `Quedan ${r.stock} · se acaba ${enDias(r.dias)}`} · vendiste ${r.vendidos} en 30 días</small></span>
      <span class="paso"><button type="button" data-accion="rp-menos" data-ref="${esc(r.p.ref)}" aria-label="Uno menos">${ico('menos')}</button><span>${q}</span><button type="button" data-accion="rp-mas" data-ref="${esc(r.p.ref)}" aria-label="Uno más">${ico('mas')}</button></span>
    </li>`; }).join('')}</ul>
    <dl class="totales"><div><dt>Perfumes a pedir</dt><dd>${unidades}</dd></div><div class="t-final"><dt>Costo estimado<small>con el costo de tu Inventario</small></dt><dd>${fmtCS(costo)}<small>${tc ? `≈ ${fmtUSD(costo / tc)}` : ''}</small></dd></div></dl>`;
  $('.reponer-pie').innerHTML = `<button type="button" class="btn sec" data-accion="rp-copiar">${ico('copiar')}Copiar</button><button type="button" class="btn pri" data-accion="rp-wa">${ico('chat')}WhatsApp</button>`;
}
function textoPedido() {
  const filas = porReponer(filasReposicion()).map(r => ({ ...r, sugerido: S.pedido.get(r.p.ref) ?? r.sugerido })).filter(r => r.sugerido > 0);
  return listaCompra(filas, { fecha: fechaCorta(hoy()), titulo });
}

// ---------------------------------------------------------------- RECIBO CON LOGO
async function verRecibo() {
  const u = S.ultima; if (!u) return;
  $('.recibo-vista').innerHTML = '<div class="cargando chico"><span class="luna-carga" aria-hidden="true"></span><p>Preparando el recibo…</p></div>';
  $('.recibo-pie').innerHTML = '';
  abrir($('#h-recibo'));
  try {
    const v = u.metodo === 'Efectivo' ? vuelto(u.calc.total, u.recibido) : null;
    const cv = await dibujarRecibo({ numero: u.numero, fecha: u.fecha, hora: u.hora, cliente: u.cliente, calc: u.calc, metodo: u.metodo, banco: u.banco, recibido: u.recibido, vuelto: v,
      tipoCambio: S.estado.config.tipoCambio, tarjeta: u.cliente && u.tarjeta && (u.tarjeta.compras || u.tarjeta.sellos || u.calc.regalos || u.sinSello) ? u.tarjeta : null, ganados: u.ganados, sinSello: u.sinSello,
      racha: u.racha?.activa ? { ...u.racha, venceTexto: fechaCorta(u.racha.vence) } : null,
      regalias: u.calc.total > 0 && !u.calc.porMayor });
    const blob = await aBlob(cv);
    if (S.recibo?.url) URL.revokeObjectURL(S.recibo.url);
    S.recibo = { blob, url: URL.createObjectURL(blob), nombre: `Recibo-MNScents-${u.numero || 'pendiente'}.png` };
    $('.recibo-vista').innerHTML = `<img class="recibo-img" src="${S.recibo.url}" alt="Recibo de la venta ${u.numero ? `#${u.numero}` : ''} con el logo de MN Scents">
      ${u.numero ? '' : '<p class="ayuda">La venta todavía no tiene número (se está guardando). Si esperas un momento y vuelves a abrir el recibo, sale con su número.</p>'}`;
    const puede = !!navigator.canShare?.({ files: [new File([blob], S.recibo.nombre, { type: 'image/png' })] });
    $('.recibo-pie').innerHTML = `<button type="button" class="btn sec" data-accion="descargar-recibo">${ico('descargar')}Descargar</button>${puede ? `<button type="button" class="btn pri" data-accion="compartir-recibo">${ico('compartir')}Compartir</button>` : ''}`;
  } catch (e) {
    $('.recibo-vista').innerHTML = `<p class="error">No se pudo preparar la imagen (${esc(e.message)}). Puedes mandar el recibo en texto por WhatsApp.</p>`;
  }
}

// ---------------------------------------------------------------- REPORTES
const pct = x => `${Math.round(x * 100)}%`;
function chipCambio(x, invertir = false) {
  if (x === null || x === undefined) return '<span class="cambio sin">sin datos antes</span>';
  const r = Math.round(x * 100);
  if (r === 0) return '<span class="cambio igual">= igual</span>';
  const sube = r > 0;
  return `<span class="cambio ${sube !== invertir ? 'bien' : 'mal'}">${sube ? '▲' : '▼'} ${Math.abs(r)}%</span>`;
}
function barrasH(filas, { valor, etiqueta, texto }) {
  const max = Math.max(...filas.map(valor), 0) || 1;
  return `<ul class="hbarras">${filas.map(f => `<li><span class="hb-nombre">${etiqueta(f)}</span><span class="hb-pista"><i style="width:${Math.max(2, (valor(f) / max) * 100)}%"></i></span><b class="hb-valor">${texto(f)}</b></li>`).join('')}</ul>`;
}
function grafica(serie, porMes) {
  const max = Math.max(...serie.map(x => x.ventas), 0);
  if (!max) return '<p class="vacio">Sin ventas en este período.</p>';
  const cada = serie.length > 16 ? Math.ceil(serie.length / 8) : 1;
  const hoyD = hoy();
  return `<div class="grafica" role="img" aria-label="Ventas por ${porMes ? 'mes' : 'día'}; la más alta ${fmtCS(max)}">
    <span class="gf-max">${fmtCS(max)}</span>
    <div class="gf-barras" style="--n:${serie.length}">${serie.map((x, i) => `<button type="button" class="gf-barra${x.dia === hoyD ? ' hoy' : ''}" data-tip="${esc(`${porMes ? MESES[i] : `${x.etiqueta}`} · ${fmtCS(x.ventas)} vendido · ${fmtCS(x.ganancia)} ganancia`)}" aria-label="${esc(`${porMes ? MESES[i] : x.etiqueta}: ${fmtCS(x.ventas)}`)}"><i style="height:${x.ventas ? Math.max(2, (x.ventas / max) * 100) : 0}%"></i></button>`).join('')}</div>
    <div class="gf-ejes" style="--n:${serie.length}">${serie.map((x, i) => `<span>${(i % cada === 0 && serie.length - 1 - i >= cada / 2) || i === serie.length - 1 ? esc(porMes ? x.etiqueta : x.corta) : ''}</span>`).join('')}</div>
    <p class="gf-tip" aria-live="polite">Toca una barra para ver el detalle.</p>
  </div>`;
}
function pintarReportes() {
  const el = $('.reportes'); if (!el || !S.estado) return;
  const ventas = ventasTodas();
  const h = hoy();
  const per = periodo(S.periodo, h);
  const r = reporte(ventas, per);
  const meta = metaDelMes(ventas, h, S.estado.config);
  const f = fechaDeDia(h);
  const a = r.actual;
  const sinHistorial = !(S.estado.historial || []).length;
  const kpi = (titulo2, valor, cambio, extra = '') => `<div class="kpi"><span>${titulo2}</span><b>${valor}</b>${cambio}${extra}</div>`;
  const totTipo = r.tipos.Detalle.ventas + r.tipos.Mayorista.ventas;
  el.innerHTML = `
    <div class="rp-cabeza"><h1>Reportes</h1><p>${esc(per.nombre)} · comparado con ${esc(per.comparado)}</p></div>
    <div class="chips periodos" role="group" aria-label="Período">${PERIODOS.map(([k, t]) => `<button type="button" class="chip" data-accion="periodo" data-v="${k}" aria-pressed="${S.periodo === k}">${t}</button>`).join('')}</div>
    ${sinHistorial ? '<div class="tarjeta pendiente">' + ico('aviso') + '<p>Tu hoja todavía no manda el historial de ventas. Actualiza el script del punto de venta para ver los reportes.</p></div>' : ''}
    ${meta.metaVentas > 0 ? `<section class="tarjeta meta">
      <p class="ec-titulo">Meta de ${MESES[f.m - 1]} <small>· día ${meta.dia} de ${meta.diasMes}</small></p>
      <div class="mt-fila"><span>Ventas</span><b>${fmtCS(meta.ventas)}</b><small>de ${fmtCS(meta.metaVentas)}</small></div>
      <div class="mt-barra"><i style="width:${Math.min(100, meta.avanceVentas * 100)}%"></i><em style="left:${Math.min(100, (meta.dia / meta.diasMes) * 100)}%" title="Hoy"></em></div>
      <p class="mt-nota">${meta.avanceVentas >= 1 ? `${ico('check')}<b>¡Meta cumplida!</b> Vas en ${pct(meta.avanceVentas)}.` : `Vas en <b>${pct(meta.avanceVentas)}</b>.${meta.dia >= 5 ? ` A este ritmo cierras el mes en <b>${fmtCS(meta.proyVentas)}</b>${meta.proyVentas >= meta.metaVentas ? ' y la cumples' : ''}.` : ''}${meta.porDiaParaMeta ? ` Para llegar necesitas <b>${fmtCS(meta.porDiaParaMeta)}</b> por día los ${meta.quedan} días que quedan.` : ''}`}</p>
      ${meta.metaGanancia > 0 ? `<div class="mt-fila"><span>Ganancia</span><b>${fmtCS(meta.ganancia)}</b><small>de ${fmtCS(meta.metaGanancia)}</small></div>
      <div class="mt-barra oro"><i style="width:${Math.min(100, meta.avanceGanancia * 100)}%"></i><em style="left:${Math.min(100, (meta.dia / meta.diasMes) * 100)}%"></em></div>
      <p class="mt-nota">${meta.avanceGanancia >= 1 ? `${ico('check')}<b>¡Meta de ganancia cumplida!</b>` : `Vas en <b>${pct(meta.avanceGanancia)}</b>${meta.dia >= 5 ? ` · a este ritmo cierras en ${fmtCS(meta.proyGanancia)}` : ''}.`}</p>` : ''}
    </section>` : ''}
    <div class="kpis">
      ${kpi('Vendido', fmtCS(a.ventas), chipCambio(r.cambios.ventas))}
      ${kpi('Ganancia', fmtCS(a.ganancia), chipCambio(r.cambios.ganancia))}
      ${kpi('Ventas', a.numero, chipCambio(r.cambios.numero))}
      ${kpi('Ticket promedio', fmtCS(Math.round(a.ticket)), chipCambio(r.cambios.ticket))}
      ${kpi('Perfumes', a.unidades, chipCambio(r.cambios.unidades), a.canjes ? `<small class="kpi-extra">+ ${a.canjes} de premio</small>` : '')}
      ${kpi('Margen', a.ventas ? pct(a.margen) : '—', `<span class="cambio sin">${r.anterior.ventas ? `antes ${pct(r.anterior.margen)}` : 'ganancia ÷ ventas'}</span>`)}
    </div>
    <section class="tarjeta"><p class="ec-titulo">Ventas por ${per.porMes ? 'mes' : 'día'}</p>${grafica(r.serie, per.porMes)}</section>
    <div class="rp-dos">
      <section class="tarjeta"><p class="ec-titulo">Más vendidos <small>(unidades)</small></p>${r.masVendidos.length ? barrasH(r.masVendidos, { valor: x => x.unidades, etiqueta: x => esc(titulo(x.p?.nombre || x.cod)), texto: x => x.unidades }) : '<p class="vacio">Sin ventas.</p>'}</section>
      <section class="tarjeta"><p class="ec-titulo">Los que más ganancia dejan</p>${r.masGanancia.length ? barrasH(r.masGanancia, { valor: x => Math.max(0, x.ganancia), etiqueta: x => esc(titulo(x.p?.nombre || x.cod)), texto: x => fmtCS(x.ganancia) }) : '<p class="vacio">Sin ventas.</p>'}</section>
    </div>
    <div class="rp-dos">
      <section class="tarjeta"><p class="ec-titulo">Cómo te pagan</p>${r.metodos.length ? barrasH(r.metodos, { valor: x => x[1], etiqueta: x => esc(x[0]), texto: x => fmtCS(x[1]) }) : '<p class="vacio">Sin ventas.</p>'}</section>
      <section class="tarjeta"><p class="ec-titulo">Detalle y mayorista</p>
        ${totTipo ? `<div class="split" role="img" aria-label="Detalle ${fmtCS(r.tipos.Detalle.ventas)}, mayorista ${fmtCS(r.tipos.Mayorista.ventas)}">${r.tipos.Detalle.ventas ? `<i class="det" style="flex:${r.tipos.Detalle.ventas}"></i>` : ''}${r.tipos.Mayorista.ventas ? `<i class="may" style="flex:${r.tipos.Mayorista.ventas}"></i>` : ''}</div>
        <ul class="leyenda"><li><i class="det"></i><span>Detalle</span><b>${fmtCS(r.tipos.Detalle.ventas)}</b><small>${pct(r.tipos.Detalle.ventas / totTipo)} · ${plural(r.tipos.Detalle.numero, 'venta', 'ventas')}</small></li>
          <li><i class="may"></i><span>Mayorista</span><b>${fmtCS(r.tipos.Mayorista.ventas)}</b><small>${pct(r.tipos.Mayorista.ventas / totTipo)} · ${plural(r.tipos.Mayorista.numero, 'venta', 'ventas')} · ${r.tipos.Mayorista.unidades} perfumes</small></li></ul>` : '<p class="vacio">Sin ventas.</p>'}
      </section>
    </div>
    <div class="rp-dos">
      <section class="tarjeta"><p class="ec-titulo">Tus días más fuertes <small>(promedio vendido por día)</small></p>${a.ventas ? barrasH(r.semana.filter(x => x.dias), { valor: x => x.promedio, etiqueta: x => x.nombre, texto: x => fmtCS(x.promedio) }) : '<p class="vacio">Sin ventas.</p>'}</section>
      <section class="tarjeta"><p class="ec-titulo">Clientes <small>· ${plural(r.clientesTotal, 'cliente con nombre', 'clientes con nombre')}${r.clientesNuevos ? ` · ${plural(r.clientesNuevos, 'nuevo', 'nuevos')}` : ''}</small></p>${r.clientes.length ? barrasH(r.clientes, { valor: x => x.ventas, etiqueta: x => esc(x.nombre), texto: x => fmtCS(x.ventas) }) : '<p class="vacio">Ninguna venta con cliente anotado.</p>'}</section>
    </div>
    <p class="rp-pie">Todo sale de tu hoja Ventas (también lo que anotas a mano). Las ventas sin "Tipo de venta" se clasifican por su precio.</p>`;
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-accion]');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  const ref = b.dataset.ref;
  switch (b.dataset.accion) {
    case 'agregar': agregar(ref, 1); break;
    case 'mas': agregar(ref, 1); break;
    case 'menos': agregar(ref, -1); break;
    case 'vaciar': if (await confirmar({ titulo: '¿Vaciar la venta?', si: 'Vaciar', peligro: true })) { S.carrito = []; S.cliente = null; S.forzarMayor = false; S.sello = null; guardarCarrito(); pintarVender(); pintarCarrito(); cerrar($('#h-carrito')); } break;
    case 'abrir-carrito': if (matchMedia('(min-width: 1000px)').matches) $('.panel-carrito').scrollIntoView({ behavior: 'smooth' }); else abrir($('#h-carrito')); break;
    case 'cobrar': abrirCobro(); break;
    case 'editar-linea': abrirLinea(ref); break;
    case 'precio-auto': { const it = S.carrito.find(i => i.ref === ref && !i.canje); if (it) { delete it.precio; delete it.descuento; } guardarCarrito(); pintarCarrito(); cerrar($('#h-linea')); break; }
    case 'quitar-linea': S.carrito = S.carrito.filter(i => i.ref !== ref || i.canje); guardarCarrito(); pintarVender(); pintarCarrito(); cerrar($('#h-linea')); break;
    case 'abrir-cliente': abrirCliente(); break;
    case 'abrir-premio': abrirPremio(); break;
    case 'elegir-premio': elegirPremio(ref); break;
    case 'quitar-premio': { const k = S.carrito.findIndex(i => i.ref === ref && i.canje); if (k >= 0) S.carrito.splice(k, 1); guardarCarrito(); pintarVender(); pintarCarrito(); break; }
    case 'ajustar-sellos': abrirSellos(); break;
    case 'sl-menos': S.ajSellos.delta = S.ajSellos.delta === 1 ? -1 : S.ajSellos.delta - 1; pintarSellos(); break;
    case 'sl-mas': S.ajSellos.delta = S.ajSellos.delta === -1 ? 1 : S.ajSellos.delta + 1; pintarSellos(); break;
    case 'sl-motivo': S.ajSellos.motivo = b.dataset.m; S.ajSellos.nota = $('.sellos-form input[name="nota"]')?.value || ''; pintarSellos(); break;
    case 'abrir-reponer': S.pedido.clear(); pintarReponer(); abrir($('#h-reponer')); break;
    case 'rp-menos': case 'rp-mas': { const q = Math.max(0, (S.pedido.get(ref) || 0) + (b.dataset.accion === 'rp-mas' ? 1 : -1)); S.pedido.set(ref, q); pintarReponer(); break; }
    case 'rp-copiar': try { await navigator.clipboard.writeText(textoPedido()); aviso('Lista copiada. Pégala en el chat con tu proveedor.', 'ok'); } catch { aviso('No se pudo copiar en este navegador.', 'error'); } break;
    case 'rp-wa': window.open(`https://wa.me/?text=${encodeURIComponent(textoPedido())}`, '_blank', 'noopener'); break;
    case 'ver-recibo': verRecibo(); break;
    case 'descargar-recibo': if (S.recibo) { descargar(S.recibo.blob, S.recibo.nombre); aviso('Recibo descargado. Adjúntalo en WhatsApp.', 'ok'); } break;
    case 'compartir-recibo': if (S.recibo) { const r = await compartirRecibo(S.recibo.blob, S.recibo.nombre, `Recibo de MN Scents${S.ultima?.numero ? ` · venta #${S.ultima.numero}` : ''}`); if (r === 'descargado') aviso('Recibo descargado. Adjúntalo en WhatsApp.', 'ok'); } break;
    case 'periodo': S.periodo = b.dataset.v; guardarLS('mnpos-periodo-v1', S.periodo); pintarReportes(); break;
    case 'elegir-cliente': {
      const antes = S.cliente?.nombre;
      S.cliente = b.dataset.i === '-1' ? null : (() => { const c = S.estado.clientes.find(x => x.nombre === b.dataset.nombre); return c ? { nombre: c.nombre, telefono: c.telefono, ciudad: c.ciudad } : null; })();
      if (S.cliente?.nombre !== antes) S.carrito = S.carrito.filter(i => !i.canje);   // el premio es de quien completó la tarjeta
      guardarCarrito(); pintarVender(); pintarCarrito(); cerrar($('#h-cliente')); break;
    }
    case 'metodo': S.cobro.metodo = b.dataset.m; S.cobro.banco = b.dataset.b || null; pintarCobro(); if (b.dataset.m === 'Efectivo') setTimeout(() => $('[data-campo="recibido"]')?.focus(), 50); break;
    case 'recibido': S.cobro.recibido = b.dataset.m; pintarCobro(); break;
    case 'confirmar-venta': confirmarVenta(); break;
    case 'nueva-venta': cerrar($('#h-listo')); ponerVista('vender'); history.replaceState(null, '', '#vender'); $('#q-vender').value = ''; S.qVender = ''; pintarVender(); break;
    case 'genero': S.generoVender = b.dataset.v; pintarChips(); pintarVender(); break;
    case 'filtro-stock': S.filtroStock = S.filtroStock === b.dataset.v && b.classList.contains('sr-item') ? 'todos' : b.dataset.v; pintarChips(); pintarStock(); break;
    case 'limpiar-busqueda': { const i = $(`#${b.dataset.para}`); i.value = ''; i.dispatchEvent(new Event('input')); i.focus(); break; }
    case 'ver-producto': abrirProducto(ref); break;
    case 'aj-menos': S.ajuste.cantidad = S.ajuste.cantidad === 1 ? -1 : S.ajuste.cantidad - 1; pintarProducto(); break;
    case 'aj-mas': S.ajuste.cantidad = S.ajuste.cantidad === -1 ? 1 : S.ajuste.cantidad + 1; pintarProducto(); break;
    case 'aj-motivo': S.ajuste.motivo = b.dataset.m; pintarProducto(); break;
    case 'guardar-ajuste': {
      const a = S.ajuste; const p = S.porRef.get(a.ref);
      cerrar($('#h-producto'));
      await operar({ id: nuevoId(), accion: 'ajuste', ajuste: { ref: a.ref, cantidad: a.cantidad, motivo: a.motivo, nota: a.nota } }, `Ajuste guardado: ${titulo(p.nombre)} ${a.cantidad > 0 ? '+' : ''}${a.cantidad}.`);
      break;
    }
    case 'caja-form': abrirCajaForm(b.dataset.tipo); break;
    case 'categoria': for (const x of $$('[data-accion="categoria"]', b.parentElement)) x.setAttribute('aria-pressed', String(x === b)); break;
    case 'anular': {
      const n = Number(b.dataset.n);
      if (!(await confirmar({ titulo: `¿Anular la venta #${n}?`, texto: 'Se borra de tu hoja Ventas (vuelve el stock) y queda anotada en la caja. Úsalo solo si fue un error.', si: 'Anular venta', peligro: true }))) return;
      await operar({ id: nuevoId(), accion: 'anular', numero: n }, `Venta #${n} anulada.`);
      break;
    }
    case 'sincronizar': sincronizar(); break;
    case 'refrescar': sincronizar(); break;
    case 'borrar-errores': borrarErrores(); pintarCaja(); break;
    case 'desvincular':
      if (await confirmar({ titulo: '¿Desvincular este dispositivo?', texto: pendientes().length ? `<b>Ojo:</b> hay ${pendientes().length} operaciones sin enviar y se perderán.` : 'Para volver a usarlo, vincúlalo otra vez desde tu hoja.', si: 'Desvincular', peligro: true })) {
        olvidarConexion(); try { localStorage.removeItem('mnpos-cola-v1'); } catch {} S.estado = null; mostrarVincular();
      }
      break;
  }
});

// detalle de la barra de la gráfica al tocarla o pasar el mouse
const tipBarra = e => { const b = e.target.closest?.('.gf-barra'); if (!b) return; const t = b.closest('.grafica').querySelector('.gf-tip'); t.textContent = b.dataset.tip; for (const x of $$('.gf-barra.activa')) x.classList.remove('activa'); b.classList.add('activa'); };
document.addEventListener('pointerover', tipBarra);
document.addEventListener('focusin', tipBarra);
document.addEventListener('click', tipBarra);

document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('[data-accion="forzar-mayor"]')) { S.forzarMayor = t.checked; pintarCarrito(); }
  if (t.matches('[data-accion="sello"]')) { S.sello = t.checked; pintarCarrito(); }
  if (t.matches('[data-accion="orden-stock"]')) { S.ordenStock = t.value; pintarStock(); }
  if (t.matches('input[name="esGasto"]')) { const c = $('.categorias', t.form); c.hidden = !t.checked; }
});

let tBusq;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q-vender' || t.id === 'q-stock') {
    $(`[data-para="${t.id}"]`).hidden = !t.value;
    clearTimeout(tBusq);
    tBusq = setTimeout(() => { if (t.id === 'q-vender') { S.qVender = t.value; pintarVender(); } else { S.qStock = t.value; pintarStock(); } }, 90);
  }
  if (t.dataset.buscar === 'cliente') pintarClientes(t.value);
  if (t.dataset.campo === 'recibido') {
    S.cobro.recibido = t.value.replace(/[^\d.]/g, '');
    const c = calc(); const v = vuelto(c.total, S.cobro.recibido);
    const el = $('.vuelto'); el.className = `vuelto ${v === null ? 'falta' : ''}`;
    el.innerHTML = v === null ? `Faltan ${fmtCS(c.total - Number(S.cobro.recibido))}` : `Vuelto: <b>${fmtCS(v)}</b>`;
    $('[data-accion="confirmar-venta"]').setAttribute('aria-disabled', String(v === null));
  }
  if (t.dataset.campo === 'aj-nota') S.ajuste.nota = t.value;
  if (t.name === 'nota' && t.closest('.sellos-form')) S.ajSellos.nota = t.value;
  if (t.form?.dataset.tipo === 'cierre' && t.name === 'monto') {
    const r = S.estado.caja.resumen; const n = leerMonto(t.value);
    const d = redondear(n - r.esperado);
    $('.cf-dif').innerHTML = t.value === '' ? '' : d === 0 ? `${ico('check')}Cuadra exacto` : d < 0 ? `Faltan ${fmtCS(-d)}` : `Sobran ${fmtCS(d)}`;
    $('.cf-dif').className = `cf-dif ${d === 0 ? 'cuadra' : d < 0 ? 'falta' : 'sobra'}`;
  }
});

document.addEventListener('submit', async e => {
  const f = e.target; e.preventDefault();
  const err = m => { const p = $('.error', f); if (p) { p.textContent = m; p.hidden = !m; } };
  switch (f.dataset.form) {
    case 'vincular': {
      const v = leerVinculo($('#vin-enlace').value);
      if (!v) return err('Ese enlace no sirve. Cópialo completo desde tu hoja.');
      guardarConexion(v); arrancar(); break;
    }
    case 'linea': {
      const it = S.carrito.find(i => i.ref === f.dataset.ref); if (!it) return;
      const pr = leerMonto(f.precio.value), ds = leerMonto(f.descuento.value);
      if (pr) it.precio = pr; else delete it.precio;
      if (ds) it.descuento = ds; else delete it.descuento;
      guardarCarrito(); pintarCarrito(); cerrar($('#h-linea')); break;
    }
    case 'cliente': {
      const nombre = f.nombre.value.trim().replace(/\s+/g, ' ');
      if (nombre.length < 2) return err('Escribe el nombre del cliente.');
      const existe = S.estado.clientes.find(c => norm(c.nombre) === norm(nombre));
      S.cliente = existe ? { nombre: existe.nombre, telefono: existe.telefono, ciudad: existe.ciudad } : { nombre, telefono: f.telefono.value.trim(), ciudad: f.ciudad.value, nuevo: true };
      S.carrito = S.carrito.filter(i => !i.canje);
      guardarCarrito(); pintarCarrito(); cerrar($('#h-cliente')); break;
    }
    case 'sellos': {
      const i = infoCliente(S.cliente?.nombre); if (!i) return;
      const a = S.ajSellos;
      if (!a.motivo) return err('Elige el motivo.');
      const delta = Math.max(a.delta, -i.tarjeta.sellos);
      if (!delta) return err('No hay sellos que quitar.');
      cerrar($('#h-sellos'));
      const id = nuevoId();
      const nota = `${a.motivo}${f.nota.value.trim() ? ` — ${f.nota.value.trim()}` : ''}`;
      await operar({ id, accion: 'sellos', sellos: { id, cliente: S.cliente.nombre, sellos: delta, nota } }, `${delta > 0 ? `+${delta}` : delta} ${Math.abs(delta) === 1 ? 'sello' : 'sellos'} a ${S.cliente.nombre} (${a.motivo}).`);
      pintarCarrito();
      break;
    }
    case 'apertura': {
      const m = leerMonto(f.monto.value);
      await operar({ id: nuevoId(), accion: 'caja', caja: { tipo: 'apertura', monto: m } }, `Caja abierta con ${fmtCS(m)}.`);
      break;
    }
    case 'caja': {
      const tipo = f.dataset.tipo; const m = leerMonto(f.monto.value);
      const op = { tipo, monto: m };
      if (tipo === 'entrada' || tipo === 'salida') {
        if (!m) return err('Escribe el monto.');
        op.concepto = f.concepto.value.trim();
        if (!op.concepto) return err(tipo === 'entrada' ? 'Escribe de dónde viene el dinero.' : 'Escribe para qué fue.');
        if (f.esGasto?.checked) { const c = $('[data-accion="categoria"][aria-pressed="true"]', f); if (!c) return err('Elige la categoría del gasto.'); op.gasto = c.dataset.c; }
      }
      if (tipo === 'cierre' && f.monto.value.trim() === '') return err('Escribe cuánto efectivo contaste.');
      cerrar($('#h-caja'));
      const txt = { apertura: `Caja abierta con ${fmtCS(m)}.`, entrada: `Entrada de ${fmtCS(m)} anotada.`, salida: `Salida de ${fmtCS(m)} anotada${op.gasto ? ' y agregada a Gastos' : ''}.`, cierre: 'Caja cerrada.' }[tipo];
      await operar({ id: nuevoId(), accion: 'caja', caja: op }, txt);
      break;
    }
  }
});

// teclado rápido en PC: "/" busca, Enter en la búsqueda agrega el único resultado
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.closest('input, textarea, select') && S.vista !== 'caja') { e.preventDefault(); $(S.vista === 'stock' ? '#q-stock' : '#q-vender').focus(); }
  if (e.key === 'Enter' && e.target.id === 'q-vender') {
    clearTimeout(tBusq); S.qVender = e.target.value; pintarVender();
    const uno = $$('#rejilla-vender [data-accion="agregar"]');
    if (uno.length === 1) { agregar(uno[0].dataset.ref, 1); e.target.select(); }
  }
});

// ---------------------------------------------------------------- arranque
function arrancar() {
  const v = leerVinculo(location.hash);
  if (v) { guardarConexion(v); history.replaceState(null, '', location.pathname + '#vender'); aviso('Dispositivo vinculado con tu hoja.', 'ok'); }
  if (!conexion()) { $('#v-cargando').hidden = true; mostrarVincular(); return; }
  const h = location.hash.slice(1);
  S.vista = VISTAS.includes(h) ? h : 'vender';
  const guardado = estadoGuardado();
  if (guardado) aplicarEstado(guardado);
  ponerVista(S.vista);
  if (!guardado) { for (const s of $$('.pantalla')) s.hidden = s.id !== 'v-cargando'; }
  cargarFotos().then(() => S.estado && pintarTodo());
  sincronizar({ silencioso: true }).then(() => {
    if (!S.estado) { $('.cargando p').textContent = `No pudimos conectar con tu hoja${S.motivo ? ` (${S.motivo})` : ''}. Revisa tu internet y toca actualizar.`; $('[data-accion="refrescar"]').hidden = false; }
  });
}
arrancar();

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}));
