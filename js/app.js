// MN Scents — catálogo, filtros, ficha, pedido y WhatsApp.
import { calcular, mensajeWhatsApp, enlaceWhatsApp, fmtCS, fmtUSD, esComprable, maxPedido, UMBRAL_MAYOREO } from './precios.js';
import { PREGUNTAS, recomendar, opcionesAroma } from './recomendar.js';

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
  quiz: { paso: 0, r: {} },  // "Encuentra tu perfume"
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
  for (const art of $$('.tarjeta, .rec')) {
    const p = estado.porId.get(art.dataset.id);
    if (p) art.querySelector('.t-accion').innerHTML = controlAgregar(p);
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
      <button class="btn-compartir" type="button" data-accion="compartir" data-id="${esc(p.id)}">${ico('share')}Compartir este perfume</button>
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
  estado.quiz = { paso: 0, r: {} };
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
      <div class="q-opciones" role="group" aria-label="${esc(q.titulo)}">
        ${opcionesDe(paso).map(o => `<button class="q-op" type="button" data-accion="quiz-op" data-valor="${esc(o.id)}" aria-pressed="${r[q.id] === o.id}">
          <b>${esc(o.t)}</b><span>${esc(o.s)}</span></button>`).join('')}
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
    cuerpo.innerHTML = `<div class="q-cabeza">${lunaQuiz(1)}<p class="q-paso">${esc(resumen)}</p></div>
      <h3 class="q-titulo" tabindex="-1">${res.principales.length ? (res.principales.length === 1 ? 'Tu perfume ideal' : 'Tus perfumes ideales') : 'Te ayudamos por WhatsApp'}</h3>
      ${res.principales.length
        ? `${res.exacto ? '' : '<p class="q-nota">No hay uno exacto disponible ahora; estos son los que más se acercan.</p>'}<ol class="recs">${recs}</ol>`
        : '<p class="q-nota">Ahora mismo no tenemos disponible un perfume con ese estilo. Escríbenos y te recomendamos uno.</p>'}
      ${pronto}
      <a class="q-wa" href="${enlaceWhatsApp(textoWA)}" target="_blank" rel="noopener">${ico('chat')}¿Prefieres que te aconsejemos? Escríbenos</a>`;
    const cat = r.para === 'damas' ? 'Damas' : 'Caballeros';
    pie.innerHTML = `<button class="btn sec" type="button" data-accion="quiz-reiniciar">Volver a empezar</button>
      <button class="btn pri" type="button" data-accion="quiz-catalogo" data-cat="${esc(r.para)}">Ver ${cat}</button>`;
    pie.hidden = false;
  }
  $('.hoja-cuerpo', d).scrollTop = 0;
  if (foco) requestAnimationFrame(() => $('.q-titulo', d)?.focus({ preventScroll: true }));
}
let tQuiz;
function elegirQuiz(b) {
  const q = PREGUNTAS[estado.quiz.paso]; if (!q) return;
  clearTimeout(tQuiz);
  estado.quiz.r[q.id] = b.dataset.valor;
  if (q.id === 'para') delete estado.quiz.r.aroma;   // las opciones de aroma dependen del catálogo
  for (const o of $$('.q-op')) o.setAttribute('aria-pressed', o === b);
  // un instante para ver la opción marcada, luego la siguiente pregunta
  tQuiz = setTimeout(() => { estado.quiz.paso++; pintarQuiz({ foco: true }); }, 220);
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
    case 'quiz-atras': clearTimeout(tQuiz); estado.quiz.paso = Math.max(0, estado.quiz.paso - 1); pintarQuiz({ foco: true }); break;
    case 'quiz-reiniciar': estado.quiz = { paso: 0, r: {} }; pintarQuiz({ foco: true }); break;
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
  const h = decodeURIComponent(location.hash.slice(1));
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
