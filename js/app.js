// MN Scents — catálogo, filtros, ficha, pedido y WhatsApp.
import { calcular, mensajeWhatsApp, enlaceWhatsApp, fmtCS, fmtUSD, esComprable, maxPedido, UMBRAL_MAYOREO, leerPedidoEnlace } from './precios.js';
import { PREGUNTAS, recomendar, opcionesAroma, perfil } from './recomendar.js';
import { imagenPerfil } from './tarjeta-perfil.js';
import { comparar, candidatos, leerComparar } from './comparar.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const CLAVE_CARRITO = 'mnscents-pedido-v1';
const FOTOS = 'img/productos/';

const estado = {
  productos: [],
  porId: new Map(),
  cat: 'caballeros',
  q: '',
  filtros: { estado: 'todos', marcas: new Set(), precio: 'todos', orden: 'recomendado' },
  carrito: cargarCarrito(),
  nivelPrevio: null,
  ajustados: new Set(),
  aroma: null,            // nota olfativa elegida en los chips
  quiz: { paso: 0, r: {}, dir: 'adelante' },  // "Encuentra tu perfume"
  comparar: { a: null, b: null, q: '' },  // comparar dos perfumes
  cajaVista: 0,           // frascos que el cliente ya vio en su caja (para animar solo los nuevos)
};

// ---------- utilidades ----------
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = id => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;
function anunciar(t) { const a = $('.anuncio'); a.textContent = ''; requestAnimationFrame(() => { a.textContent = t; }); }

function cargarCarrito() {
  try { const v = JSON.parse(localStorage.getItem(CLAVE_CARRITO) || '[]'); return Array.isArray(v) ? v.filter(x => x && x.id && x.qty > 0) : []; }
  catch { return []; }
}
function guardarCarrito() { try { localStorage.setItem(CLAVE_CARRITO, JSON.stringify(estado.carrito)); } catch {} }
const qtyEnCarrito = id => estado.carrito.find(x => x.id === id)?.qty || 0;
// Devuelve la cantidad que realmente quedó (nunca más que las existencias)
function fijarQty(id, qty) {
  const p = estado.porId.get(id);
  const max = maxPedido(p);
  estado.ajustados.delete(id);
  qty = Math.max(0, qty | 0);
  if (qty > max) {
    qty = max;
    anunciar(max === 1 ? `Solo hay 1 unidad disponible de ${p.nombre}.` : `Solo hay ${max} unidades disponibles de ${p.nombre}.`);
  }
  const i = estado.carrito.findIndex(x => x.id === id);
  if (qty === 0) { if (i >= 0) estado.carrito.splice(i, 1); }
  else if (i >= 0) estado.carrito[i].qty = qty;
  else estado.carrito.push({ id, qty });
  guardarCarrito();
  actualizarTodo();
  return qty;
}
const textoTope = n => (n === 1 ? 'Solo hay 1 disponible' : `Solo hay ${n} disponibles`);

// Distancia de edición con tolerancia 1 para palabras de 4+ letras (búsqueda tolerante)
function casi(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}
function coincide(p, q) {
  if (!q) return true;
  const texto = norm(`${p.nombre} ${p.marca} ${p.notas.join(' ')} ${p.descripcion || ''} ${p.presentacion || ''}`);
  const palabras = texto.split(' ');
  return norm(q).split(' ').filter(Boolean).every(t =>
    texto.includes(t) || (t.length >= 4 && palabras.some(w => casi(t, w.slice(0, t.length + 1)) || casi(t, w))));
}

const RANGOS = [
  { id: 'todos', txt: 'Todos', ok: () => true },
  { id: 'r1', txt: 'Hasta C$1,400', ok: p => p.precios.detalle.cs <= 1400 },
  { id: 'r2', txt: 'C$1,401 a C$1,800', ok: p => p.precios.detalle.cs > 1400 && p.precios.detalle.cs <= 1800 },
  { id: 'r3', txt: 'Más de C$1,800', ok: p => p.precios.detalle.cs > 1800 },
];
const ESTADOS = [
  { id: 'todos', txt: 'Todos' }, { id: 'disponible', txt: 'Disponibles' },
  { id: 'coming_soon', txt: 'Coming soon' }, { id: 'agotado', txt: 'Agotados' },
];
const ORDENES = [
  { id: 'recomendado', txt: 'Recomendado' }, { id: 'precio-asc', txt: 'Precio: menor a mayor' },
  { id: 'precio-desc', txt: 'Precio: mayor a menor' }, { id: 'nombre', txt: 'Nombre A–Z' },
];
const pesoEstado = { disponible: 0, coming_soon: 1, agotado: 2 };
const pesoEtiqueta = p => (p.etiqueta === 'top' ? 0 : p.etiqueta === 'nuevo' ? 1 : 2);
const etiquetaMarca = p => (p.etiqueta === 'top' ? '<span class="etq top">Más vendido</span>'
  : p.etiqueta === 'nuevo' ? '<span class="etq nuevo">Nuevo</span>' : '');

function filtrar(cat, conBusqueda = true) {
  const f = estado.filtros;
  const rango = RANGOS.find(r => r.id === f.precio) || RANGOS[0];
  let lista = estado.productos.filter(p => p.catalogo === cat
    && (f.estado === 'todos' || p.estado === f.estado)
    && (!f.marcas.size || f.marcas.has(p.marca))
    && rango.ok(p)
    && (!estado.aroma || p.notas.some(n => norm(n) === estado.aroma))
    && (!conBusqueda || coincide(p, estado.q)));
  const o = f.orden;
  lista = lista.slice().sort((a, b) =>
    o === 'precio-asc' ? a.precios.detalle.cs - b.precios.detalle.cs
    : o === 'precio-desc' ? b.precios.detalle.cs - a.precios.detalle.cs
    : o === 'nombre' ? a.nombre.localeCompare(b.nombre, 'es')
    : (pesoEstado[a.estado] - pesoEstado[b.estado]) || (pesoEtiqueta(a) - pesoEtiqueta(b)) || a.orden - b.orden);
  return lista;
}

// ---------- tarjetas ----------
function etiquetaEstado(p) {
  if (p.estado === 'coming_soon') return '<span class="estado coming">Coming soon</span>';
  if (p.estado === 'agotado') return '<span class="estado agotado">Agotado</span>';
  if (esComprable(p) && Number.isInteger(p.existencias) && p.existencias <= 3)
    return `<span class="estado pocas">${p.existencias === 1 ? 'Última unidad' : `Quedan ${p.existencias}`}</span>`;
  return '';
}
function foto(p, clase = '') {
  return p.foto
    ? `<img src="${FOTOS}${esc(p.foto)}" alt="Frasco de ${esc(p.nombre)}" loading="lazy" decoding="async" width="400" height="400" class="${clase}">`
    : `<span class="sin-foto">${esc(p.nombre)}</span>`;
}
function controlAgregar(p) {
  if (!esComprable(p)) return `<button class="btn-agregar" type="button" disabled>${p.estado === 'agotado' ? 'Agotado' : 'Próximamente'}</button>`;
  const q = qtyEnCarrito(p.id);
  if (!q) return `<button class="btn-agregar" type="button" data-accion="agregar" data-id="${esc(p.id)}">${ico('plus')}Agregar</button>`;
  const max = maxPedido(p), lleno = q >= max;
  return `<div class="paso" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
    <button type="button" data-accion="menos" data-id="${esc(p.id)}" aria-label="Quitar una unidad">${ico('minus')}</button>
    <output aria-live="polite">${q}</output>
    <button type="button" data-accion="mas" data-id="${esc(p.id)}" aria-label="Agregar una unidad" ${lleno ? 'disabled' : ''}>${ico('plus')}</button></div>
    ${lleno && max < 99 ? `<p class="tope">${textoTope(max)}</p>` : ''}`;
}
function tarjeta(p, nivel) {
  const pr = p.precios;
  return `<article class="tarjeta${esComprable(p) ? '' : ' no-disp'}" data-id="${esc(p.id)}">
    <button class="t-abrir" type="button" data-accion="ficha" data-id="${esc(p.id)}" aria-label="Ver detalles de ${esc(p.nombre)}">
      <div class="t-foto">${etiquetaEstado(p)}${etiquetaMarca(p)}${foto(p)}</div>
      <div class="t-info">
        <span class="t-marca">${esc(p.marca)}</span>
        <h3 class="t-nombre">${esc(p.nombre)}</h3>
        ${p.notas.length ? `<span class="t-notas">${esc(p.notas.join(' · '))}</span>` : (p.presentacion ? `<span class="t-notas">${esc(p.presentacion)}</span>` : '')}
        <span class="t-precio"><span class="precio-cs">${fmtCS(pr.detalle.cs)}</span><span class="precio-usd">${fmtUSD(pr.detalle.usd)}</span></span>
        <span class="t-mayor">Por mayor <b>${fmtCS(pr.mayor.cs)}</b> · ${fmtUSD(pr.mayor.usd)}</span>
      </div>
    </button>
    <div class="t-accion">${controlAgregar(p)}</div>
  </article>`;
}

function pintarCatalogo() {
  const rej = $('#rejilla');
  const lista = filtrar(estado.cat);
  rej.setAttribute('aria-busy', 'false');
  rej.setAttribute('aria-labelledby', `tab-${estado.cat}`);
  if (!lista.length) {
    const hayFiltros = estado.q || filtrosActivos().length;
    rej.innerHTML = `<div class="vacio-res"><h3>No encontramos perfumes${estado.q ? ` para “${esc(estado.q)}”` : ''}</h3>
      <p>${hayFiltros ? 'Prueba con otra palabra o quita algún filtro.' : 'Este catálogo no tiene productos por ahora.'}</p>
      ${hayFiltros ? '<button class="btn sec" type="button" data-accion="limpiar-todo">Quitar búsqueda y filtros</button>' : ''}</div>`;
  } else {
    rej.innerHTML = lista.map(p => tarjeta(p)).join('');
  }
  const disp = lista.filter(esComprable).length;
  $('.resumen').textContent = lista.length
    ? `${lista.length} ${lista.length === 1 ? 'perfume' : 'perfumes'} · ${disp} ${disp === 1 ? 'disponible' : 'disponibles'}`
    : '';
  // ¿hay coincidencias en el otro catálogo?
  const otra = estado.cat === 'caballeros' ? 'damas' : 'caballeros';
  const enOtra = estado.q ? filtrar(otra).length : 0;
  const caja = $('.otra-cat');
  caja.hidden = !enOtra;
  if (enOtra) caja.innerHTML = `<button type="button" data-accion="ir-cat" data-cat="${otra}">También hay <b>${enOtra} ${enOtra === 1 ? 'resultado' : 'resultados'}</b> en ${otra === 'damas' ? 'Damas' : 'Caballeros'}</button>`;
}

function actualizarControlesTarjetas() {
  for (const art of $$('.tarjeta, .rec, .cmp-col')) {
    const p = estado.porId.get(art.dataset.id);
    const accion = art.querySelector('.t-accion');   // la cabecera de la comparación no tiene botón
    if (p && accion) accion.innerHTML = controlAgregar(p);
  }
}

// ---------- pestañas ----------
function ponerCat(cat, { foco = false, conHash = true } = {}) {
  if (cat !== 'caballeros' && cat !== 'damas') cat = 'caballeros';
  estado.cat = cat;
  $('.segmento').dataset.activo = cat;
  for (const t of $$('[role="tab"]')) {
    const sel = t.dataset.cat === cat;
    t.setAttribute('aria-selected', sel); t.tabIndex = sel ? 0 : -1;
    if (sel && foco) t.focus();
  }
  if (conHash && location.hash.slice(1) !== cat) history.replaceState(null, '', `#${cat}`);
  pintarMarcas();
  pintarAromas();
  pintarCatalogo();
}

// ---------- chips de aroma (salen de las notas de la hoja) ----------
const capital = t => t.charAt(0).toUpperCase() + t.slice(1);
function pintarAromas() {
  const cuenta = new Map();
  for (const p of estado.productos) if (p.catalogo === estado.cat)
    for (const n of p.notas) { const k = norm(n); const v = cuenta.get(k) || { txt: n, c: 0 }; v.c++; cuenta.set(k, v); }
  const top = [...cuenta.entries()].filter(([, v]) => v.c >= 2).sort((a, b) => b[1].c - a[1].c).slice(0, 8);
  if (estado.aroma && !cuenta.has(estado.aroma)) estado.aroma = null;
  const caja = $('.aromas');
  caja.hidden = top.length < 2;
  caja.innerHTML = `<span class="aromas-titulo">Aroma</span>`
    + [['', { txt: 'Todos' }], ...top].map(([k, v]) =>
      `<button type="button" class="aroma" data-accion="aroma" data-aroma="${esc(k)}" aria-pressed="${(estado.aroma || '') === k}">${esc(capital(v.txt))}</button>`).join('');
}

// ---------- filtros ----------
function filtrosActivos() {
  const f = estado.filtros, a = [];
  if (f.estado !== 'todos') a.push({ tipo: 'estado', txt: ESTADOS.find(e => e.id === f.estado).txt });
  for (const m of f.marcas) a.push({ tipo: 'marca', valor: m, txt: m });
  if (f.precio !== 'todos') a.push({ tipo: 'precio', txt: RANGOS.find(r => r.id === f.precio).txt });
  if (f.orden !== 'recomendado') a.push({ tipo: 'orden', txt: ORDENES.find(o => o.id === f.orden).txt });
  return a;
}
function pintarChips() {
  const a = filtrosActivos();
  $('.chips-activos').innerHTML = a.map(c =>
    `<button class="chip" type="button" data-accion="quitar-filtro" data-tipo="${c.tipo}" data-valor="${esc(c.valor || '')}" aria-label="Quitar filtro ${esc(c.txt)}">${esc(c.txt)}${ico('close')}</button>`).join('');
  const ins = $('.btn-filtros .insignia');
  ins.hidden = !a.length; ins.textContent = a.length;
}
function opciones(nombre, tipo, lista, marcadas) {
  return lista.map(o => `<label class="opcion"><input type="${tipo}" name="${nombre}" value="${esc(o.id)}" ${marcadas(o.id) ? 'checked' : ''}><span>${esc(o.txt)}</span></label>`).join('');
}
function pintarMarcas() {
  const marcas = [...new Set(estado.productos.filter(p => p.catalogo === estado.cat).map(p => p.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  // quitar marcas que no existen en este catálogo
  for (const m of [...estado.filtros.marcas]) if (!marcas.includes(m)) estado.filtros.marcas.delete(m);
  $('[data-filtro="marca"]').innerHTML = opciones('marca', 'checkbox', marcas.map(m => ({ id: m, txt: m })), id => estado.filtros.marcas.has(id));
  pintarChips();
}
function pintarFiltrosFijos() {
  const f = estado.filtros;
  $('[data-filtro="estado"]').innerHTML = opciones('estado', 'radio', ESTADOS, id => f.estado === id);
  $('[data-filtro="precio"]').innerHTML = opciones('precio', 'radio', RANGOS, id => f.precio === id);
  $('[data-filtro="orden"]').innerHTML = opciones('orden', 'radio', ORDENES, id => f.orden === id);
}
function leerFiltros() {
  const h = $('#hoja-filtros');
  estado.filtros.estado = $('input[name="estado"]:checked', h)?.value || 'todos';
  estado.filtros.precio = $('input[name="precio"]:checked', h)?.value || 'todos';
  estado.filtros.orden = $('input[name="orden"]:checked', h)?.value || 'recomendado';
  estado.filtros.marcas = new Set($$('input[name="marca"]:checked', h).map(i => i.value));
}

// ---------- hojas ----------
function abrir(d) {
  if (d.open) return;
  d.classList.remove('cerrando');
  d.showModal();
  document.documentElement.style.overflow = 'hidden';
}
function cerrar(d) {
  if (!d.open || d.classList.contains('cerrando')) return;
  const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fin = () => { d.classList.remove('cerrando'); d.close(); if (!$$('dialog[open]').length) document.documentElement.style.overflow = ''; };
  if (reducir) return fin();
  d.classList.add('cerrando');
  d.addEventListener('animationend', fin, { once: true });
  setTimeout(() => d.open && fin(), 320);
}
for (const d of $$('dialog.hoja')) {
  d.addEventListener('cancel', e => { e.preventDefault(); cerrar(d); });
  d.addEventListener('click', e => { if (e.target === d) cerrar(d); });           // toque fuera
  d.addEventListener('close', () => { if (!$$('dialog[open]').length) document.documentElement.style.overflow = ''; });
}

// ---------- ficha ----------
let fichaQty = 1, fichaMax = 99;
function abrirFicha(id) {
  const p = estado.porId.get(id); if (!p) return;
  fichaQty = 1;
  const ped = calcular(estado.carrito, estado.porId);
  const enCarrito = qtyEnCarrito(id);
  const maxP = maxPedido(p);
  fichaMax = Math.max(0, maxP - enCarrito);
  const d = $('#hoja-ficha');
  d.querySelector('.hoja-cuerpo').innerHTML = `
    <div class="ficha-foto">${etiquetaEstado(p)}${etiquetaMarca(p)}${foto(p).replace('loading="lazy"', 'loading="eager"')}
      <button class="btn-ico cerrar" type="button" aria-label="Cerrar">${ico('close')}</button></div>
    <div class="ficha-info">
      <span class="ficha-marca">${esc(p.marca)}</span>
      <h2 id="ficha-nombre">${esc(p.nombre)}</h2>
      <div class="ficha-botones">
        <button class="btn-compartir" type="button" data-accion="compartir" data-id="${esc(p.id)}">${ico('share')}Compartir</button>
        <button class="btn-compartir" type="button" data-accion="cmp-abrir" data-id="${esc(p.id)}">${ico('comparar')}Comparar</button>
      </div>
      ${p.presentacion ? `<p class="ficha-pres">${esc(p.presentacion)}</p>` : ''}
      ${p.descripcion ? `<p class="ficha-desc">${esc(p.descripcion)}</p>` : ''}
      ${p.notas.length ? `<ul class="notas" aria-label="Notas">${p.notas.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </div>
    <dl class="tabla-precios">
      <div class="${ped.nivel === 'detalle' ? 'activa' : ''}"><dt>Precio al detalle<small>De 1 a 5 unidades en total</small></dt><dd><b>${fmtCS(p.precios.detalle.cs)}</b><span>${fmtUSD(p.precios.detalle.usd)}</span></dd></div>
      <div class="fila-mayor ${ped.nivel === 'mayor' ? 'activa' : ''}"><dt>Precio por mayor<small>Con ${UMBRAL_MAYOREO} unidades o más en tu pedido</small></dt><dd><b>${fmtCS(p.precios.mayor.cs)}</b><span>${fmtUSD(p.precios.mayor.usd)}</span></dd></div>
    </dl>
    ${esComprable(p) && fichaMax === 0
      ? `<p class="ficha-aviso">Ya tienes en tu pedido ${enCarrito === 1 ? 'la única unidad disponible' : `las ${enCarrito} unidades disponibles`}.</p>
         <div class="ficha-acciones una"><button class="btn sec" type="button" data-accion="ver-pedido">Ver mi pedido</button></div>`
    : esComprable(p)
      ? `${enCarrito ? `<p class="ficha-aviso">Ya tienes ${enCarrito} en tu pedido.</p>` : ''}
        ${maxP < 99 ? `<p class="ficha-aviso">${textoTope(maxP)}.</p>` : ''}
        <div class="ficha-acciones">
          <div class="paso" role="group" aria-label="Cantidad a agregar">
            <button type="button" data-accion="ficha-menos" aria-label="Menos">${ico('minus')}</button>
            <output class="ficha-qty" aria-live="polite">1</output>
            <button type="button" data-accion="ficha-mas" aria-label="Más" ${fichaMax <= 1 ? 'disabled' : ''}>${ico('plus')}</button>
          </div>
          <button class="btn pri" type="button" data-accion="ficha-agregar" data-id="${esc(p.id)}">Agregar al pedido</button>
        </div>`
      : `<div class="ficha-acciones una"><button class="btn sec" type="button" disabled aria-disabled="true">${p.estado === 'agotado' ? 'Agotado por ahora' : 'Coming soon: aún no disponible'}</button></div>
         <p class="ficha-aviso" style="padding-bottom:18px">${p.estado === 'agotado' ? 'Este perfume no se puede pedir en este momento.' : 'Pronto estará disponible. Pregúntanos por WhatsApp.'}</p>`}
  `;
  abrir(d);
  d.querySelector('.hoja-cuerpo').scrollTop = 0;
  history.replaceState(null, '', `#p-${p.id}`);
}

// Compartir: menú nativo del teléfono si existe; si no, WhatsApp
async function compartir(id) {
  const p = estado.porId.get(id); if (!p) return;
  const url = `${location.origin}${location.pathname}#p-${encodeURIComponent(p.id)}`;
  const texto = `${p.nombre}${p.marca ? ' de ' + p.marca : ''} en MN Scents: ${fmtCS(p.precios.detalle.cs)} (${fmtUSD(p.precios.detalle.usd)})`;
  if (navigator.share) {
    try { await navigator.share({ title: `${p.nombre} · MN Scents`, text: texto, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(texto + '\n' + url)}`, '_blank', 'noopener');
}
$('#hoja-ficha').addEventListener('close', () => {
  if (location.hash.startsWith('#p-')) history.replaceState(null, '', `#${estado.cat}`);
});

// ---------- pedido ----------
// Dibuja la fase de la luna: p=0 nueva, p=1 llena (creciente desde la derecha)
function faseLuna(p, r = 15, c = 20) {
  if (p <= 0) return '';
  if (p >= 1) return `M${c},${c - r} A${r},${r} 0 1 1 ${c},${c + r} A${r},${r} 0 1 1 ${c},${c - r} Z`;
  const rx = Math.abs(1 - 2 * p) * r;
  const barrido = p < 0.5 ? 0 : 1;
  return `M${c},${c - r} A${r},${r} 0 0 1 ${c},${c + r} A${rx},${r} 0 0 ${barrido} ${c},${c - r} Z`;
}

function pintarPedido() {
  const ped = calcular(estado.carrito, estado.porId);
  // Si las existencias bajaron desde la última visita, el pedido guardado se ajusta (y se avisa en la línea)
  if (ped.lineas.some(l => l.ajustada)) {
    for (const l of ped.lineas) if (l.ajustada) { const it = estado.carrito.find(x => x.id === l.producto.id); if (it) it.qty = l.max; estado.ajustados.add(l.producto.id); }
    guardarCarrito();
  }
  const mayor = ped.nivel === 'mayor';
  const fase = faseLuna(ped.progreso);
  for (const path of $$('.barra-pedido .lp-luz, #hoja-pedido .lp-luz')) path.setAttribute('d', fase);

  // barra fija
  const barra = $('.barra-pedido');
  barra.classList.toggle('mayor', mayor);
  barra.classList.toggle('vacio', ped.unidades === 0);
  $('.bp-linea1').textContent = ped.unidades === 0 ? 'Tu pedido está vacío' : `${ped.unidades} ${ped.unidades === 1 ? 'unidad' : 'unidades'} · ${mayor ? 'precio mayorista' : 'precio al detalle'}`;
  $('.bp-linea2').textContent = ped.unidades === 0 ? `Mayoreo desde ${UMBRAL_MAYOREO} unidades`
    : mayor ? `Ahorras ${fmtCS(ped.ahorroCS)} con mayoreo`
    : `Faltan ${ped.faltan} para precio mayorista`;
  $('.bp-total').textContent = ped.unidades ? fmtCS(ped.totalCS) : '';
  $('.bp-boton').setAttribute('aria-label', ped.unidades
    ? `Ver pedido: ${ped.unidades} unidades, total ${fmtCS(ped.totalCS)}, ${mayor ? 'precio mayorista' : `faltan ${ped.faltan} para mayoreo`}`
    : 'Ver pedido: vacío');

  // hoja del pedido
  const h = $('#hoja-pedido');
  $('.progreso-mayoreo', h).classList.toggle('mayor', mayor);
  $('.pm-titulo', h).textContent = mayor ? 'Precio mayorista activado'
    : ped.unidades === 0 ? `Mayoreo desde ${UMBRAL_MAYOREO} unidades` : `${ped.unidades} de ${UMBRAL_MAYOREO} unidades para mayoreo`;
  $('.pm-nota', h).textContent = mayor
    ? `Tienes ${ped.unidades} unidades: todos los perfumes de tu pedido van a precio por mayor. Si bajas de ${UMBRAL_MAYOREO}, vuelven al precio al detalle.`
    : ped.unidades === 0 ? 'Cuentan todas las unidades de perfumes disponibles, puedes combinarlos.'
    : `Agrega ${ped.faltan} ${ped.faltan === 1 ? 'unidad más' : 'unidades más'} (cualquier perfume disponible) y todo tu pedido pasa a precio por mayor.`;
  $('.aviso-racha', h).hidden = mayor || ped.unidades === 0;
  pintarCaja(ped, h);
  pintarSugeridos(ped, h);

  const ul = $('.lineas', h);
  ul.classList.toggle('mayor-activo', mayor);
  ul.innerHTML = ped.lineas.map(l => {
    const p = l.producto;
    return `<li class="linea">
      <div class="l-foto">${p.foto ? `<img src="${FOTOS}${esc(p.foto)}" alt="" loading="lazy" width="64" height="64">` : ''}</div>
      <div class="l-info">
        <div class="l-nombre">${esc(p.nombre)}</div>
        <div class="l-marca">${esc(p.marca)}${p.presentacion ? ' · ' + esc(p.presentacion) : ''}</div>
        <div class="l-unit">${mayor ? `<s>${fmtCS(p.precios.detalle.cs)}</s>` : ''}<b>${fmtCS(l.unitCS)}</b> c/u · ${fmtUSD(l.unitUSD)} <span class="sr">${mayor ? 'precio por mayor' : 'precio al detalle'}</span></div>
      </div>
      <div class="l-sub">${fmtCS(l.subCS)}<span>${fmtUSD(l.subUSD)}</span></div>
      <div class="l-controles">
        <div class="paso" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
          <button type="button" data-accion="menos" data-id="${esc(p.id)}" aria-label="Quitar una unidad de ${esc(p.nombre)}">${ico('minus')}</button>
          <output>${l.qty}</output>
          <button type="button" data-accion="mas" data-id="${esc(p.id)}" aria-label="Agregar una unidad de ${esc(p.nombre)}" ${l.qty >= l.max ? 'disabled' : ''}>${ico('plus')}</button>
        </div>
        <button class="l-quitar" type="button" data-accion="quitar" data-id="${esc(p.id)}">${ico('trash')}Eliminar</button>
      </div>
      ${estado.ajustados.has(p.id) ? `<p class="l-tope">Ajustamos la cantidad a ${l.max}: es lo que hay disponible.</p>`
        : l.qty >= l.max && l.max < 99 ? `<p class="l-tope">${textoTope(l.max)}</p>` : ''}</li>`;
  }).join('');

  const nd = $('.no-disp', h);
  nd.hidden = !ped.noDisponibles.length;
  if (ped.noDisponibles.length) {
    nd.innerHTML = `Estos productos ya no están disponibles y no se incluyen en el pedido:<ul>${ped.noDisponibles.map(x => `<li>${esc(x.producto?.nombre || x.id)}</li>`).join('')}</ul><button class="btn-texto" type="button" data-accion="limpiar-no-disp">Quitarlos</button>`;
  }
  const vacio = ped.lineas.length === 0;
  $('.pedido-vacio', h).hidden = !vacio;
  $('.progreso-mayoreo', h).hidden = vacio;
  $('.pedido-pie', h).hidden = vacio;
  $('.vaciar-fila', h).hidden = vacio;

  $('.t-unidades', h).textContent = ped.unidades;
  const tn = $('.t-nivel', h);
  tn.textContent = mayor ? 'Por mayor' : 'Al detalle';
  tn.classList.toggle('mayor', mayor);
  $('.t-ahorro-fila', h).hidden = !mayor;
  $('.t-ahorro', h).textContent = fmtCS(ped.ahorroCS);
  $('.t-cs', h).textContent = fmtCS(ped.totalCS);
  $('.t-usd', h).textContent = fmtUSD(ped.totalUSD);
  const env = $('.btn-enviar', h);
  if (vacio) { env.setAttribute('aria-disabled', 'true'); env.href = '#'; }
  else { env.removeAttribute('aria-disabled'); env.href = enlaceWhatsApp(mensajeWhatsApp(ped)); }

  // momento de luna llena
  if (estado.nivelPrevio && estado.nivelPrevio !== ped.nivel) {
    if (mayor) {
      document.body.classList.add('luna-llena');
      setTimeout(() => document.body.classList.remove('luna-llena'), 750);
      anunciar(`Precio mayorista activado: ${ped.unidades} unidades. Total ${fmtCS(ped.totalCS)}.`);
    } else {
      anunciar(`Menos de ${UMBRAL_MAYOREO} unidades: tu pedido vuelve a precio al detalle. Total ${fmtCS(ped.totalCS)}.`);
    }
  }
  estado.nivelPrevio = ped.nivel;
  return ped;
}

// ---------- caja de 6: cada unidad es un frasco en su espacio ----------
function pintarCaja(ped, h) {
  const caja = $('.caja', h);
  const frascos = ped.lineas.flatMap(l => Array.from({ length: l.qty }, () => l.producto));
  const llenos = Math.min(frascos.length, UMBRAL_MAYOREO);
  // solo se animan los frascos que el cliente todavía no ha visto caer en su caja
  const desde = Math.min(estado.cajaVista, llenos);
  if (h.open) estado.cajaVista = llenos;
  $$('.caja-slot', caja).forEach((slot, i) => {
    const p = frascos[i];
    slot.classList.toggle('lleno', !!p);
    slot.classList.toggle('nuevo', !!p && i >= desde);
    slot.style.setProperty('--i', Math.max(0, i - desde));
    slot.innerHTML = p
      ? (p.foto ? `<img src="${FOTOS}${esc(p.foto)}" alt="" width="64" height="64">` : `<span>${esc(p.nombre.slice(0, 1))}</span>`)
      : `<span class="caja-num">${i + 1}</span>`;
  });
  const extra = frascos.length - UMBRAL_MAYOREO;
  const ex = $('.caja-extra', caja);
  ex.hidden = extra <= 0;
  ex.textContent = extra > 0 ? `+${extra} ${extra === 1 ? 'frasco más' : 'frascos más'}` : '';
  caja.classList.toggle('caja-llena', llenos >= UMBRAL_MAYOREO);
  caja.setAttribute('aria-valuenow', llenos);
  caja.setAttribute('aria-valuetext', `${llenos} de ${UMBRAL_MAYOREO} frascos${frascos.length ? ': ' + [...new Set(frascos.map(p => p.nombre))].join(', ') : ''}`);
}

// Perfumes disponibles para completar la caja (los más vendidos y del mismo catálogo primero)
function pintarSugeridos(ped, h) {
  const caja = $('.completa', h);
  const faltan = ped.unidades > 0 && ped.nivel !== 'mayor';
  const enPedido = new Set(estado.carrito.map(x => x.id));
  const cats = ped.lineas.map(l => l.producto.catalogo);
  const catPrincipal = cats.filter(c => c === 'damas').length > cats.length / 2 ? 'damas' : 'caballeros';
  const lista = !faltan ? [] : estado.productos
    .filter(p => esComprable(p) && !enPedido.has(p.id))
    .sort((a, b) => ((b.catalogo === catPrincipal) - (a.catalogo === catPrincipal))
      || (pesoEtiqueta(a) - pesoEtiqueta(b)) || (a.orden - b.orden))
    .slice(0, 6);
  caja.hidden = !lista.length;
  $('.sugeridos', h).innerHTML = lista.map(p => `<li class="sug">
      <button class="sug-abrir" type="button" data-accion="ficha" data-id="${esc(p.id)}" aria-label="Ver ${esc(p.nombre)}">
        <span class="sug-foto">${p.foto ? `<img src="${FOTOS}${esc(p.foto)}" alt="" loading="lazy" width="96" height="96">` : ''}</span>
        <span class="sug-nombre">${esc(p.nombre)}</span>
        <span class="sug-precio">${fmtCS(p.precios.detalle.cs)}</span>
      </button>
      <button class="sug-agregar" type="button" data-accion="agregar" data-id="${esc(p.id)}" aria-label="Agregar ${esc(p.nombre)} a tu caja">${ico('plus')}Agregar</button>
    </li>`).join('');
}

// ---------- Comparar dos perfumes ----------
function abrirComparar(a, b = null) {
  if (!estado.porId.has(a)) return;
  estado.comparar = { a, b: b && b !== a && estado.porId.has(b) ? b : null, q: '' };
  for (const d of ['#hoja-ficha', '#hoja-quiz']) if ($(d).open) cerrar($(d));
  pintarComparar();
  abrir($('#hoja-comparar'));
}
function filaCandidato(p) {
  return `<li><button class="cmp-opcion" type="button" data-accion="cmp-elegir" data-id="${esc(p.id)}">
      <span class="cmp-mini">${p.foto ? `<img src="${FOTOS}${esc(p.foto)}" alt="" loading="lazy" width="56" height="56">` : ''}</span>
      <span class="cmp-op-texto"><b>${esc(p.nombre)}</b><span>${esc(p.marca)}${p.notas.length ? ' · ' + esc(p.notas.slice(0, 3).join(' · ')) : ''}</span></span>
      <span class="cmp-op-precio">${fmtCS(p.precios.detalle.cs)}</span>
    </button></li>`;
}
function pintarCandidatos() {
  const { a, q } = estado.comparar;
  const pa = estado.porId.get(a);
  const lista = candidatos(estado.productos, pa).filter(p => coincide(p, q));
  $('.cmp-lista').innerHTML = lista.length ? lista.map(filaCandidato).join('')
    : `<li class="cmp-vacio">No encontramos perfumes para “${esc(q)}”.</li>`;
}
function disponibilidad(p) {
  if (p.estado === 'coming_soon') return '<span class="cmp-estado coming">Coming soon</span>';
  if (p.estado === 'agotado' || p.existencias === 0) return '<span class="cmp-estado agotado">Agotado</span>';
  if (Number.isInteger(p.existencias) && p.existencias <= 3) return `<span class="cmp-estado pocas">${p.existencias === 1 ? 'Última unidad' : `Quedan ${p.existencias}`}</span>`;
  return '<span class="cmp-estado si">Disponible</span>';
}
function pintarComparar({ foco = false } = {}) {
  const { a, b } = estado.comparar;
  const pa = estado.porId.get(a), pb = b ? estado.porId.get(b) : null;
  const caja = $('#hoja-comparar .comparar');
  if (!pb) {
    caja.innerHTML = `<div class="cmp-elegido">
        <span class="cmp-mini">${pa.foto ? `<img src="${FOTOS}${esc(pa.foto)}" alt="" width="56" height="56">` : ''}</span>
        <span class="cmp-op-texto"><span>Comparar</span><b>${esc(pa.nombre)}</b></span>
      </div>
      <h3 class="cmp-pregunta" tabindex="-1">¿Con cuál lo comparas?</h3>
      <label class="campo-buscar cmp-buscar"><svg class="ico" aria-hidden="true"><use href="#i-search"/></svg>
        <span class="sr">Buscar perfume para comparar</span>
        <input id="cmp-q" type="search" placeholder="Buscar perfume o marca" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search" value="${esc(estado.comparar.q)}">
      </label>
      <ul class="cmp-lista" aria-label="Perfumes para comparar"></ul>`;
    pintarCandidatos();
    $('#cmp-q').addEventListener('input', e => { estado.comparar.q = e.target.value.trim(); pintarCandidatos(); });
    if (location.hash.startsWith('#comparar=')) history.replaceState(null, '', `#comparar=${encodeURIComponent(a)}`);
  } else {
    const c = comparar(pa, pb);
    const comunes = new Set(c.comunes.map(n => n.toLowerCase()));
    const col = (p, segundo) => `<div class="cmp-col" data-id="${esc(p.id)}">
        <button class="cmp-foto" type="button" data-accion="ficha" data-id="${esc(p.id)}" aria-label="Ver detalles de ${esc(p.nombre)}">
          ${p.foto ? `<img src="${FOTOS}${esc(p.foto)}" alt="" width="200" height="200">` : `<span class="sin-foto">${esc(p.nombre)}</span>`}</button>
        <span class="cmp-marca">${esc(p.marca)}</span>
        <span class="cmp-nombre">${esc(p.nombre)}</span>
        ${segundo ? `<button class="btn-texto cmp-cambiar" type="button" data-accion="cmp-cambiar">Cambiar</button>` : ''}
      </div>`;
    const celda = (p, contenido) => `<div class="cmp-celda">${contenido(p)}</div>`;
    const fila = (titulo, contenido, clase = '') => `<div class="cmp-fila ${clase}"><span class="cmp-etq">${titulo}</span>${celda(pa, contenido)}${celda(pb, contenido)}</div>`;
    const precio = nivel => p => {
      const mejor = (nivel === 'detalle' ? c.masBaratoDetalle : c.masBaratoMayor) === p.id;
      return `<b>${fmtCS(p.precios[nivel].cs)}</b><small>${fmtUSD(p.precios[nivel].usd)}</small>${mejor ? '<span class="cmp-mejor">Más económico</span>' : ''}`;
    };
    const notas = p => p.notas.length
      ? `<ul class="cmp-notas">${p.notas.map(n => `<li class="${comunes.has(n.toLowerCase()) ? 'comun' : ''}">${esc(n)}</li>`).join('')}</ul>`
      : '<span class="cmp-nada">Sin notas registradas</span>';
    const resumen = [
      c.comunes.length ? `Tienen en común: <b>${esc(c.comunes.join(' · ').toLowerCase())}</b>.` : 'No comparten notas: son estilos distintos.',
      c.difDetalleCS ? `Al detalle, ${esc(estado.porId.get(c.masBaratoDetalle).nombre)} cuesta ${fmtCS(c.difDetalleCS)} menos.` : 'Tienen el mismo precio al detalle.',
    ].join(' ');
    caja.innerHTML = `<div class="cmp-tabla">
        <div class="cmp-cabeza">${col(pa, false)}${col(pb, true)}</div>
        <p class="cmp-resumen" tabindex="-1">${resumen}</p>
        ${fila('Precio al detalle', precio('detalle'))}
        ${fila('Precio por mayor <small>desde 6 unidades</small>', precio('mayor'), 'mayor')}
        ${pa.presentacion || pb.presentacion ? fila('Presentación', p => p.presentacion ? esc(p.presentacion) : '<span class="cmp-nada">—</span>') : ''}
        ${fila('Notas', notas)}
        ${fila('Disponibilidad', disponibilidad)}
        <div class="cmp-fila cmp-acciones">${[pa, pb].map(p => `<div class="cmp-col" data-id="${esc(p.id)}"><div class="t-accion">${controlAgregar(p)}</div></div>`).join('')}</div>
      </div>
      <div class="cmp-pie">
        <button class="btn sec" type="button" data-accion="cmp-invertir">Intercambiar</button>
        <button class="btn pri" type="button" data-accion="cmp-compartir">${ico('share')}Compartir</button>
      </div>`;
    history.replaceState(null, '', `#comparar=${encodeURIComponent(pa.id)},${encodeURIComponent(pb.id)}`);
  }
  $('#hoja-comparar .hoja-cuerpo').scrollTop = 0;
  if (foco) requestAnimationFrame(() => $('#hoja-comparar .cmp-pregunta, #hoja-comparar .cmp-resumen')?.focus({ preventScroll: true }));
}
async function compartirComparacion() {
  const { a, b } = estado.comparar;
  const pa = estado.porId.get(a), pb = estado.porId.get(b);
  if (!pa || !pb) return;
  const url = `${location.origin}${location.pathname}#comparar=${encodeURIComponent(a)},${encodeURIComponent(b)}`;
  const texto = `${pa.nombre} vs ${pb.nombre} en MN Scents`;
  if (navigator.share) {
    try { await navigator.share({ title: texto, text: texto, url }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(texto + '\n' + url)}`, '_blank', 'noopener');
}
$('#hoja-comparar').addEventListener('close', () => {
  if (location.hash.startsWith('#comparar=')) history.replaceState(null, '', `#${estado.cat}`);
});

// ---------- Verificar un pedido recibido (enlace "#pedido=H01-2,D05-1") ----------
// El texto de WhatsApp se puede editar; aquí los precios salen siempre del catálogo publicado.
function abrirVerificacion(enlace) {
  const items = leerPedidoEnlace(enlace);
  const ped = calcular(items, estado.porId);
  const desconocidos = items.filter(x => !estado.porId.has(x.id));
  const caja = $('#hoja-verificar .verificar');
  const hoy = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });
  caja.innerHTML = !items.length
    ? '<p class="v-aviso">Este enlace no contiene un pedido válido.</p>'
    : `<p class="v-intro">Precios calculados con el catálogo publicado hoy, ${esc(hoy)}. Compara este total con el del mensaje: si no coinciden, vale este.</p>
      <ul class="v-lineas">${ped.lineas.map(l => `<li>
          <span class="v-nombre">${esc(l.producto.nombre)} <small>${esc(l.producto.id)}</small></span>
          <span class="v-cant">${l.qty} × ${fmtCS(l.unitCS)}</span>
          <span class="v-sub">${fmtCS(l.subCS)}</span>
          ${l.ajustada ? `<span class="v-alerta">Pidió ${l.pedida}; solo hay ${l.max} disponible${l.max === 1 ? '' : 's'}.</span>` : ''}
        </li>`).join('')}</ul>
      ${ped.noDisponibles.length || desconocidos.length ? `<div class="v-alerta-caja">No se cobran porque no están disponibles o no existen:
        <ul>${ped.noDisponibles.map(x => `<li>${esc(x.producto?.nombre || x.id)}</li>`).join('')}</ul></div>` : ''}
      <dl class="totales v-totales">
        <div><dt>Unidades</dt><dd>${ped.unidades}</dd></div>
        <div><dt>Precios aplicados</dt><dd class="${ped.nivel === 'mayor' ? 't-nivel mayor' : ''}">${ped.nivel === 'mayor' ? 'Por mayor' : 'Al detalle'}</dd></div>
        <div class="t-total"><dt>Total</dt><dd><span class="t-cs">${fmtCS(ped.totalCS)}</span><span class="t-usd">${fmtUSD(ped.totalUSD)}</span></dd></div>
      </dl>`;
  abrir($('#hoja-verificar'));
}
$('#hoja-verificar').addEventListener('close', () => {
  if (location.hash.startsWith('#pedido=')) history.replaceState(null, '', `#${estado.cat}`);
});

// ---------- Encuentra tu perfume ----------
const textoOpcion = (pid, oid) => PREGUNTAS.find(q => q.id === pid)?.opciones.find(o => o.id === oid)?.t || '';
function opcionesDe(i) {
  const q = PREGUNTAS[i];
  return q.id === 'aroma' ? opcionesAroma(estado.productos, estado.quiz.r.para || 'caballeros') : q.opciones;
}
function lunaQuiz(p) {
  return `<span class="luna-progreso q-luna${p >= 1 ? ' llena' : ''}" aria-hidden="true"><svg viewBox="0 0 40 40"><circle class="lp-fondo" cx="20" cy="20" r="15"/><path class="lp-luz" d="${faseLuna(p)}"/><circle class="lp-aro" cx="20" cy="20" r="18.5"/></svg></span>`;
}
function abrirQuiz() {
  estado.quiz = { paso: 0, r: {}, dir: 'adelante' };
  pintarQuiz();
  abrir($('#hoja-quiz'));
  history.replaceState(null, '', '#encuentra');
}
function pintarQuiz({ foco = false } = {}) {
  const { paso, r } = estado.quiz;
  const d = $('#hoja-quiz');
  const cuerpo = $('.quiz', d), pie = $('.quiz-pie', d);
  const total = PREGUNTAS.length;
  if (paso < total) {
    const q = PREGUNTAS[paso];
    cuerpo.innerHTML = `<div class="q-cabeza">${lunaQuiz((paso + 1) / (total + 1))}<p class="q-paso">Pregunta ${paso + 1} de ${total}</p></div>
      <h3 class="q-titulo" tabindex="-1">${esc(q.titulo)}</h3>
      <div class="q-opciones ${estado.quiz.dir}" role="group" aria-label="${esc(q.titulo)}" data-n="${opcionesDe(paso).length}">
        ${opcionesDe(paso).map(o => `<button class="q-op" type="button" data-accion="quiz-op" data-valor="${esc(o.id)}" aria-pressed="${r[q.id] === o.id}">
          <span class="q-ico">${ico(o.ico)}</span><b>${esc(o.t)}</b><span class="q-sub">${esc(o.s)}</span></button>`).join('')}
      </div>`;
    pie.innerHTML = paso > 0 ? `<button class="btn sec" type="button" data-accion="quiz-atras">${ico('arrow')}Anterior</button>` : '';
    pie.hidden = paso === 0;
  } else {
    const res = recomendar(estado.productos, r);
    const resumen = PREGUNTAS.map(q => textoOpcion(q.id, r[q.id])).filter(Boolean).join(' · ');
    const textoWA = `Hola MN Scents, quiero que me recomienden un perfume: ${PREGUNTAS.map(q => textoOpcion(q.id, r[q.id]).toLowerCase()).join(', ')}.`;
    const recs = res.principales.map((x, i) => {
      const p = x.producto;
      return `<li class="rec${i === 0 ? ' mejor' : ''}" data-id="${esc(p.id)}">
        <button class="rec-abrir" type="button" data-accion="ficha" data-id="${esc(p.id)}" aria-label="Ver detalles de ${esc(p.nombre)}">
          <span class="rec-foto">${p.foto ? `<img src="${FOTOS}${esc(p.foto)}" alt="" width="96" height="96">` : ''}</span>
          <span class="rec-info">
            ${i === 0 ? '<span class="rec-mejor">Tu mejor opción</span>' : ''}
            <span class="rec-marca">${esc(p.marca)}</span>
            <span class="rec-nombre">${esc(p.nombre)}</span>
            ${x.razones.length ? `<span class="rec-por">Coincide en ${esc(x.razones.join(' · ').toLowerCase())}</span>` : ''}
            <span class="rec-precio">${fmtCS(p.precios.detalle.cs)} <small>${fmtUSD(p.precios.detalle.usd)}</small></span>
          </span>
        </button>
        <div class="t-accion">${controlAgregar(p)}</div>
      </li>`;
    }).join('');
    const pronto = res.pronto ? `<button class="rec-pronto" type="button" data-accion="ficha" data-id="${esc(res.pronto.producto.id)}">
        <span class="estado coming">Coming soon</span><span>También va contigo <b>${esc(res.pronto.producto.nombre)}</b>, llega pronto.</span>${ico('arrow')}</button>` : '';
    const pf = perfil(r, res);
    const hay = res.principales.length > 0;
    cuerpo.innerHTML = `<div class="q-cabeza">${lunaQuiz(1)}<p class="q-paso">${esc(resumen)}</p></div>
      <section class="perfil" aria-labelledby="perfil-titulo">
        <p class="perfil-etq">Tu estilo</p>
        <h3 class="q-titulo perfil-titulo" id="perfil-titulo" tabindex="-1">${esc(pf.titulo)}</h3>
        <p class="perfil-frase">${esc(pf.frase)}</p>
        ${pf.mezcla.length ? `<div class="mezcla" role="list" aria-label="Tu mezcla, según las notas de tus perfumes">${pf.mezcla.map((m, i) =>
          `<div class="mz" role="listitem" aria-label="${esc(m.txt)}: ${Math.round(m.valor * 100)} por ciento"><span>${esc(m.txt)}</span><span class="mz-barra"><i style="--v:${m.valor.toFixed(3)};--i:${i}"></i></span></div>`).join('')}</div>` : ''}
        ${hay ? `<div class="perfil-acciones">
          <button class="btn pri" type="button" data-accion="quiz-compartir">${ico('share')}Compartir mi resultado</button>
          <button class="btn sec btn-guardar" type="button" data-accion="quiz-guardar" aria-label="Guardar imagen de mi resultado">${ico('download')}</button>
        </div>` : ''}
      </section>
      <h4 class="recs-titulo">${hay ? (res.principales.length === 1 ? 'Tu perfume ideal' : 'Tus perfumes ideales') : 'Te ayudamos por WhatsApp'}</h4>
      ${hay
        ? `${res.exacto ? '' : '<p class="q-nota">No hay uno exacto disponible ahora; estos son los que más se acercan.</p>'}<ol class="recs">${recs}</ol>
          ${res.principales.length >= 2 ? `<button class="btn sec q-comparar" type="button" data-accion="cmp-abrir" data-id="${esc(res.principales[0].producto.id)}" data-b="${esc(res.principales[1].producto.id)}">${ico('comparar')}Comparar los dos primeros</button>` : ''}`
        : '<p class="q-nota">Ahora mismo no tenemos disponible un perfume con ese estilo. Escríbenos y te recomendamos uno.</p>'}
      ${pronto}
      <a class="q-wa" href="${enlaceWhatsApp(textoWA)}" target="_blank" rel="noopener">${ico('chat')}¿Prefieres que te aconsejemos? Escríbenos</a>`;
    const cat = r.para === 'damas' ? 'Damas' : 'Caballeros';
    pie.innerHTML = `<button class="btn sec" type="button" data-accion="quiz-reiniciar">Volver a empezar</button>
      <button class="btn pri" type="button" data-accion="quiz-catalogo" data-cat="${esc(r.para)}">Ver ${cat}</button>`;
    pie.hidden = false;
    // la imagen se prepara desde ya, para que "Compartir" responda al instante
    resultado = { titulo: pf.titulo, frase: pf.frase, mezcla: pf.mezcla, producto: res.principales[0]?.producto || null };
    imagenLista = hay ? imagenPerfil(resultado).catch(() => null) : null;
  }
  $('.hoja-cuerpo', d).scrollTop = 0;
  if (foco) requestAnimationFrame(() => $('.q-titulo', d)?.focus({ preventScroll: true }));
}
let resultado = null, imagenLista = null;
async function compartirResultado(soloGuardar = false) {
  if (!resultado?.producto) return;
  const blob = await imagenLista;
  const url = `${location.origin}${location.pathname}#encuentra`;
  const texto = `Mi estilo de perfume es ${resultado.titulo.toLowerCase()} y mi perfume ideal es ${resultado.producto.nombre}. Descubre el tuyo en MN Scents:`;
  if (!soloGuardar) {
    const archivo = blob ? new File([blob], 'mi-estilo-mn-scents.png', { type: 'image/png' }) : null;
    try {
      if (archivo && navigator.canShare?.({ files: [archivo] })) { await navigator.share({ files: [archivo], text: `${texto} ${url}` }); return; }
      if (navigator.share) { await navigator.share({ title: 'Mi estilo de perfume · MN Scents', text: texto, url }); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
  }
  if (blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'mi-estilo-mn-scents.png';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    anunciar('Imagen guardada. Súbela a tus historias o estados.');
  }
  if (!soloGuardar) window.open(`https://wa.me/?text=${encodeURIComponent(`${texto} ${url}`)}`, '_blank', 'noopener');
}

let tQuiz;
function elegirQuiz(b) {
  const q = PREGUNTAS[estado.quiz.paso]; if (!q) return;
  clearTimeout(tQuiz);
  estado.quiz.r[q.id] = b.dataset.valor;
  if (q.id === 'para') delete estado.quiz.r.aroma;   // las opciones de aroma dependen del catálogo
  for (const o of $$('.q-op')) o.setAttribute('aria-pressed', o === b);
  // un instante para ver la opción marcada, luego la siguiente pregunta
  tQuiz = setTimeout(() => { estado.quiz.paso++; estado.quiz.dir = 'adelante'; pintarQuiz({ foco: true }); }, 260);
}
$('#hoja-quiz').addEventListener('close', () => {
  clearTimeout(tQuiz);
  if (location.hash === '#encuentra') history.replaceState(null, '', `#${estado.cat}`);
});

function actualizarTodo() {
  pintarPedido();
  actualizarControlesTarjetas();
}

// ---------- eventos ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-accion], .cerrar');
  if (!b) return;
  if (b.classList.contains('cerrar')) { cerrar(b.closest('dialog')); return; }
  const id = b.dataset.id;
  switch (b.dataset.accion) {
    case 'agregar': {
      fijarQty(id, qtyEnCarrito(id) + 1);
      saltoBarra();
      const p = estado.porId.get(id);
      const ped = calcular(estado.carrito, estado.porId);
      anunciar(`${p.nombre} agregado. ${ped.unidades} ${ped.unidades === 1 ? 'unidad' : 'unidades'} en tu pedido.`);
      const art = b.closest('.tarjeta, .rec');
      requestAnimationFrame(() => art?.querySelector('.paso [data-accion="mas"]')?.focus());
      break;
    }
    case 'mas': fijarQty(id, qtyEnCarrito(id) + 1); break;
    case 'menos': {
      const q = qtyEnCarrito(id) - 1;
      fijarQty(id, q);
      if (q === 0) { const art = $(`.tarjeta[data-id="${CSS.escape(id)}"]`); art?.querySelector('.btn-agregar')?.focus(); }
      break;
    }
    case 'quitar': fijarQty(id, 0); anunciar('Producto eliminado del pedido.'); break;
    case 'ficha': abrirFicha(id); break;
    case 'ficha-mas':
      fichaQty = Math.min(fichaMax, fichaQty + 1); $('.ficha-qty').textContent = fichaQty;
      b.disabled = fichaQty >= fichaMax;
      break;
    case 'ficha-menos':
      fichaQty = Math.max(1, fichaQty - 1); $('.ficha-qty').textContent = fichaQty;
      $('[data-accion="ficha-mas"]').disabled = fichaQty >= fichaMax;
      break;
    case 'ver-pedido': cerrar($('#hoja-ficha')); abrir($('#hoja-pedido')); pintarPedido(); break;
    case 'abrir-quiz': abrirQuiz(); break;
    case 'quiz-op': elegirQuiz(b); break;
    case 'quiz-atras': clearTimeout(tQuiz); estado.quiz.paso = Math.max(0, estado.quiz.paso - 1); estado.quiz.dir = 'atras'; pintarQuiz({ foco: true }); break;
    case 'quiz-reiniciar': estado.quiz = { paso: 0, r: {}, dir: 'atras' }; pintarQuiz({ foco: true }); break;
    case 'quiz-compartir': compartirResultado(); break;
    case 'quiz-guardar': compartirResultado(true); break;
    case 'quiz-catalogo':
      cerrar($('#hoja-quiz'));
      ponerCat(b.dataset.cat);
      window.scrollTo({ top: $('#catalogo').offsetTop - 70, behavior: 'smooth' });
      break;
    case 'ficha-agregar': {
      fijarQty(id, qtyEnCarrito(id) + fichaQty);
      cerrar($('#hoja-ficha'));
      saltoBarra();
      anunciar(`${fichaQty} ${fichaQty === 1 ? 'unidad agregada' : 'unidades agregadas'} al pedido.`);
      break;
    }
    case 'ir-cat': ponerCat(b.dataset.cat); window.scrollTo({ top: $('#catalogo').offsetTop - 70, behavior: 'smooth' }); break;
    case 'quitar-filtro': {
      const t = b.dataset.tipo, f = estado.filtros;
      if (t === 'estado') f.estado = 'todos';
      if (t === 'marca') f.marcas.delete(b.dataset.valor);
      if (t === 'precio') f.precio = 'todos';
      if (t === 'orden') f.orden = 'recomendado';
      pintarFiltrosFijos(); pintarMarcas(); pintarCatalogo();
      break;
    }
    case 'limpiar-filtros':
      estado.filtros = { estado: 'todos', marcas: new Set(), precio: 'todos', orden: 'recomendado' };
      pintarFiltrosFijos(); pintarMarcas();
      break;
    case 'aplicar-filtros': leerFiltros(); pintarChips(); pintarCatalogo(); cerrar($('#hoja-filtros')); break;
    case 'aroma':
      estado.aroma = b.dataset.aroma || null;
      for (const c of $$('.aroma')) c.setAttribute('aria-pressed', c === b);
      pintarCatalogo();
      break;
    case 'compartir': compartir(id); break;
    case 'cmp-abrir': abrirComparar(id, b.dataset.b || null); break;
    case 'cmp-elegir': estado.comparar.b = id; pintarComparar({ foco: true }); break;
    case 'cmp-cambiar': estado.comparar.b = null; estado.comparar.q = ''; pintarComparar({ foco: true }); break;
    case 'cmp-invertir': { const c = estado.comparar; [c.a, c.b] = [c.b, c.a]; pintarComparar(); break; }
    case 'cmp-compartir': compartirComparacion(); break;
    case 'limpiar-todo':
      estado.q = ''; $('#q').value = ''; $('.limpiar-q').hidden = true;
      estado.aroma = null; pintarAromas();
      estado.filtros = { estado: 'todos', marcas: new Set(), precio: 'todos', orden: 'recomendado' };
      pintarFiltrosFijos(); pintarMarcas(); pintarCatalogo();
      break;
    case 'vaciar':
      // Confirmación en la propia página (sin ventanas del navegador)
      if (b.dataset.confirmar !== '1') {
        b.dataset.confirmar = '1'; b.textContent = 'Toca otra vez para vaciar el pedido';
        setTimeout(() => { b.dataset.confirmar = ''; b.textContent = 'Vaciar pedido'; }, 4000);
      } else {
        b.dataset.confirmar = ''; b.textContent = 'Vaciar pedido';
        estado.carrito = []; guardarCarrito(); actualizarTodo(); anunciar('Pedido vacío.');
      }
      break;
    case 'limpiar-no-disp': {
      const ids = new Set(calcular(estado.carrito, estado.porId).noDisponibles.map(x => x.id));
      estado.carrito = estado.carrito.filter(x => !ids.has(x.id)); guardarCarrito(); actualizarTodo();
      break;
    }
    case 'cerrar-pedido': cerrar($('#hoja-pedido')); break;
    case 'reintentar': iniciar(); break;
  }
});

function saltoBarra() {
  const b = $('.bp-boton');
  b.classList.remove('salto'); void b.offsetWidth; b.classList.add('salto');
}

$('.bp-boton').addEventListener('click', () => { abrir($('#hoja-pedido')); pintarPedido(); });
$('.btn-filtros').addEventListener('click', () => { pintarFiltrosFijos(); pintarMarcas(); abrir($('#hoja-filtros')); });
$('.btn-enviar').addEventListener('click', e => { if (e.currentTarget.getAttribute('aria-disabled') === 'true') e.preventDefault(); });

// pestañas con teclado
const tablist = $('.segmento');
tablist.addEventListener('click', e => { const t = e.target.closest('[role="tab"]'); if (t) ponerCat(t.dataset.cat); });
tablist.addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  ponerCat(estado.cat === 'caballeros' ? 'damas' : 'caballeros', { foco: true });
});

// búsqueda
let tBusq;
$('#q').addEventListener('input', e => {
  $('.limpiar-q').hidden = !e.target.value;
  clearTimeout(tBusq);
  tBusq = setTimeout(() => { estado.q = e.target.value.trim(); pintarCatalogo(); }, 120);
});
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('.limpiar-q').addEventListener('click', () => {
  const q = $('#q'); q.value = ''; estado.q = ''; $('.limpiar-q').hidden = true; pintarCatalogo(); q.focus();
});

function irAHash() {
  let h = '';
  try { h = decodeURIComponent(location.hash.slice(1)); } catch { h = ''; }   // un enlace mal escrito no rompe la página
  if (h.startsWith('comparar=')) {
    const [a, b2] = leerComparar(h.slice(9));
    if (a && estado.porId.has(a)) {
      if (!$('.tarjeta')) ponerCat(estado.porId.get(a).catalogo, { conHash: false });
      abrirComparar(a, estado.porId.has(b2) ? b2 : null);
      return true;
    }
  }
  if (h.startsWith('pedido=')) {
    if (!$('.tarjeta')) ponerCat(estado.cat, { conHash: false });
    abrirVerificacion(h.slice(7));
    return true;
  }
  if (h === 'encuentra') {
    if (!$('.tarjeta')) ponerCat(estado.cat, { conHash: false });
    if (!$('#hoja-quiz').open) abrirQuiz();
    return true;
  }
  if (h.startsWith('p-')) {
    const p = estado.porId.get(h.slice(2));
    if (p) { if (p.catalogo !== estado.cat || !$('.tarjeta')) ponerCat(p.catalogo, { conHash: false }); abrirFicha(p.id); return true; }
  } else if (h && h !== estado.cat) { ponerCat(h); return true; }
  return false;
}
window.addEventListener('hashchange', irAHash);
// borde de la barra superior al desplazar
const centinela = $('.cielo');
new IntersectionObserver(([en]) => $('.barra-sup').classList.toggle('con-borde', !en.isIntersecting), { rootMargin: '-64px 0px 0px 0px' }).observe(centinela);
// otra pestaña cambió el pedido
window.addEventListener('storage', e => { if (e.key === CLAVE_CARRITO) { estado.carrito = cargarCarrito(); actualizarTodo(); } });

// ---------- carga ----------
async function iniciar() {
  const rej = $('#rejilla');
  rej.setAttribute('aria-busy', 'true');
  rej.innerHTML = Array.from({ length: 6 }, () => '<div class="esqueleto" aria-hidden="true"></div>').join('');
  try {
    const r = await fetch('data/productos.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const datos = await r.json();
    estado.productos = datos.productos || [];
    estado.porId = new Map(estado.productos.map(p => [p.id, p]));
    for (const c of ['caballeros', 'damas'])
      $(`[data-cuenta="${c}"]`).textContent = estado.productos.filter(p => p.catalogo === c).length;
    if (datos.actualizado) {
      const f = new Date(datos.actualizado);
      $('.actualizado').textContent = `Catálogo actualizado el ${f.toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
    }
    pintarFiltrosFijos();
    pintarPedido();   // primero: ajusta un pedido guardado a las existencias actuales
    if (!irAHash()) ponerCat(estado.cat || 'caballeros');
  } catch {
    rej.setAttribute('aria-busy', 'false');
    rej.innerHTML = `<div class="error-carga"><h3>No pudimos cargar el catálogo</h3><p>Revisa tu conexión a internet e intenta de nuevo.</p>
      <div class="acciones"><button class="btn pri" type="button" data-accion="reintentar">Intentar de nuevo</button>
      <a class="btn sec" href="https://wa.me/50584735485" target="_blank" rel="noopener">${ico('chat')}Escribir por WhatsApp</a></div></div>`;
  }
}
iniciar();

// ---------- tienda: abierto o cerrado ahora (hora de Nicaragua) ----------
const HORARIO = { 1: [9, 19], 2: [9, 19], 3: [9, 19], 4: [9, 19], 5: [9, 19], 6: [9, 15] }; // 0 = domingo, cerrado
function pintarAbierto() {
  const el = $('.abierto'); if (!el) return;
  let dia, hora;
  try {
    const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Managua', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
    const v = t => partes.find(x => x.type === t)?.value;
    dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v('weekday'));
    hora = (Number(v('hour')) % 24) + Number(v('minute')) / 60;
  } catch { el.textContent = ''; return; }
  const h = HORARIO[dia];
  const abierto = h && hora >= h[0] && hora < h[1];
  el.className = 'abierto ' + (abierto ? 'si' : 'no');
  el.textContent = abierto ? `Abierto ahora · cierra a las ${h[1] - 12}:00 p. m.` : 'Cerrado ahora';
}
pintarAbierto();
setInterval(pintarAbierto, 60000);

// ---------- app instalable ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
let avisoInstalar = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); avisoInstalar = e; $('.btn-instalar').hidden = false;
});
$('.btn-instalar').addEventListener('click', async () => {
  if (!avisoInstalar) return;
  avisoInstalar.prompt();
  try { await avisoInstalar.userChoice; } catch {}
  avisoInstalar = null; $('.btn-instalar').hidden = true;
});
window.addEventListener('appinstalled', () => { $('.btn-instalar').hidden = true; });
