// Mapa de aromas interactivo: un cielo nocturno donde cada perfume es una estrella.
// Se arrastra la luna para explorar; los perfumes más cercanos se iluminan y aparecen abajo.
// Tocar una estrella dibuja su constelación: los perfumes con los que comparte notas.
import { ubicar, cercanos, notasComunes, centros, puntoDeQuiz, FAMILIAS } from './mapa.js';
import { fmtCS, fmtUSD, esComprable } from './precios.js';
import { PREGUNTAS } from './recomendar.js';

const S = 1000;                      // tamaño del lienzo (unidades del SVG)
const NS = 'http://www.w3.org/2000/svg';

export function iniciarMapa(ctx) {
  const { estado, $, $$, esc, ico, FOTOS, abrir, controlAgregar } = ctx;
  const d = $('#hoja-mapa');
  const svg = $('.mapa-svg', d);
  const panel = $('.mapa-panel', d);
  const reducir = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  let puntos = [], porId = new Map();
  const vista = { cat: 'todos', solo: false, familia: null };
  let luna = { x: 0.5, y: 0.5 }, sel = null, cerca = [], deQuiz = false, construido = '';

  const fam = id => FAMILIAS.find(f => f.id === id) || FAMILIAS[0];
  const visible = p => (vista.cat === 'todos' || p.producto.catalogo === vista.cat)
    && (!vista.solo || esComprable(p.producto)) && (!vista.familia || p.familia === vista.familia);

  // ---------- dibujo inicial ----------
  function construir() {
    const firma = estado.productos.map(p => `${p.id}:${p.estado}:${p.notas.join(',')}`).join('|');
    if (firma === construido) return;
    construido = firma;
    puntos = ubicar(estado.productos);
    porId = new Map(puntos.map(p => [p.producto.id, p]));
    const cs = centros(puntos);
    let s = 3;
    const azar = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const estrellasFondo = Array.from({ length: 110 }, () =>
      `<circle class="m-tw" cx="${(azar() * S).toFixed(1)}" cy="${(azar() * S).toFixed(1)}" r="${(0.8 + azar() * 2.2).toFixed(2)}" style="--d:${(2 + azar() * 4).toFixed(2)}s;--t:${(-azar() * 6).toFixed(2)}s"/>`).join('');
    svg.innerHTML = `
      <defs>
        ${FAMILIAS.map(f => `<radialGradient id="mg-${f.id}"><stop offset="0" stop-color="${f.color}" stop-opacity="0.55"/><stop offset="0.45" stop-color="${f.color}" stop-opacity="0.16"/><stop offset="1" stop-color="${f.color}" stop-opacity="0"/></radialGradient>
          <radialGradient id="mh-${f.id}"><stop offset="0" stop-color="${f.color}" stop-opacity="0.9"/><stop offset="0.35" stop-color="${f.color}" stop-opacity="0.35"/><stop offset="1" stop-color="${f.color}" stop-opacity="0"/></radialGradient>`).join('')}
        <radialGradient id="mg-luna" cx="0.36" cy="0.34" r="0.75"><stop offset="0" stop-color="#fffaff"/><stop offset="0.5" stop-color="#ece0ff"/><stop offset="1" stop-color="#bfa4ee"/></radialGradient>
        <radialGradient id="mg-halo"><stop offset="0" stop-color="#e3d2ff" stop-opacity="0.55"/><stop offset="0.4" stop-color="#c4a1ff" stop-opacity="0.18"/><stop offset="1" stop-color="#c4a1ff" stop-opacity="0"/></radialGradient>
        <clipPath id="mc-foto" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath>
      </defs>
      <g class="m-fondo" aria-hidden="true">${estrellasFondo}</g>
      <g class="m-ejes" aria-hidden="true">
        <line x1="${S / 2}" y1="40" x2="${S / 2}" y2="${S - 40}"/><line x1="40" y1="${S / 2}" x2="${S - 40}" y2="${S / 2}"/>
        <text x="24" y="${S / 2 - 14}" class="m-eje">← Fresco</text>
        <text x="${S - 24}" y="${S / 2 - 14}" class="m-eje" text-anchor="end">Cálido →</text>
        <text x="${S / 2 + 14}" y="44" class="m-eje">Intenso · de noche</text>
        <text x="${S / 2 + 14}" y="${S - 26}" class="m-eje">Suave · de día</text>
      </g>
      <g class="m-nebulosas" aria-hidden="true">${cs.map((c, i) => `
        <g class="m-neb" data-familia="${c.id}" style="--i:${i}">
          <circle cx="${(c.x * S).toFixed(1)}" cy="${(c.y * S).toFixed(1)}" r="${(150 + c.n * 18).toFixed(0)}" fill="url(#mg-${c.id})"/>
        </g>`).join('')}</g>
      <g class="m-lineas" aria-hidden="true"></g>
      <g class="m-estrellas">${puntos.map((p, i) => {
        const pr = p.producto, f = fam(p.familia);
        const desc = `${pr.nombre}${pr.marca ? ', ' + pr.marca : ''}. ${f.txt.slice(0, -1).toLowerCase()}: ${pr.notas.join(', ')}.${esComprable(pr) ? '' : pr.estado === 'agotado' ? ' Agotado.' : ' Coming soon.'}`;
        return `<g class="m-est fam-${p.familia}${esComprable(pr) ? '' : ' no-disp'}" data-id="${esc(pr.id)}" transform="translate(${(p.x * S).toFixed(1)} ${(p.y * S).toFixed(1)})"
            tabindex="0" role="button" aria-label="${esc(desc)}" style="--i:${i};--c:${f.color}">
          <circle class="m-halo" r="34" fill="url(#mh-${p.familia})"/>
          <circle class="m-toque" r="34" fill="transparent"/>
          <circle class="m-nucleo" r="8.5"/>
          <g class="m-foto">
            <circle class="m-foto-fondo" r="46"/>
            ${pr.foto ? `<image href="${FOTOS}${esc(pr.foto)}" x="-40" y="-40" width="80" height="80" preserveAspectRatio="xMidYMid meet" clip-path="url(#mc-foto)"/>` : ''}
          </g>
          <text class="m-nombre" y="${p.y > 0.86 ? -60 : 70}" text-anchor="middle">${esc(pr.nombre)}</text>
        </g>`;
      }).join('')}</g>
      <g class="m-luna" tabindex="0" role="slider" aria-label="Tu luna: arrástrala o usa las flechas para explorar el mapa" aria-valuetext="">
        <circle class="m-luna-halo" r="120" fill="url(#mg-halo)"/>
        <circle class="m-luna-cuerpo" r="32" fill="url(#mg-luna)"/>
        <circle r="6" cx="-9" cy="-6" class="m-crater"/><circle r="4" cx="10" cy="9" class="m-crater"/><circle r="3" cx="12" cy="-12" class="m-crater"/>
        <text class="m-luna-txt" y="-50" text-anchor="middle"></text>
      </g>`;
    const sinNotas = estado.productos.filter(p => !p.notas.length).length;
    $('.mapa-nota', d).textContent = `La ubicación es aproximada: sale de las notas que declara cada perfume.${sinNotas ? ` ${sinNotas} ${sinNotas === 1 ? 'perfume no aparece porque aún no tiene' : 'perfumes no aparecen porque aún no tienen'} notas.` : ''}`;
    $('.mapa-leyenda', d).innerHTML = FAMILIAS.filter(f => puntos.some(p => p.familia === f.id)).map(f =>
      `<button type="button" class="m-fam" data-accion="mapa-familia" data-familia="${f.id}" aria-pressed="false" style="--c:${f.color}"><i></i>${esc(f.txt)}</button>`).join('');
  }

  // ---------- luna ----------
  const gLuna = () => $('.m-luna', svg);
  function ponerLuna(x, y, { suave = false } = {}) {
    luna = { x: Math.min(0.97, Math.max(0.03, x)), y: Math.min(0.97, Math.max(0.03, y)) };
    const g = gLuna(); if (!g) return;
    g.classList.toggle('suave', suave && !reducir());
    g.style.transform = `translate(${(luna.x * S).toFixed(1)}px, ${(luna.y * S).toFixed(1)}px)`;
    actualizarCercanos();
  }
  function actualizarCercanos() {
    // con una estrella elegida, lo que importa es su constelación (no lo que está cerca de la luna)
    if (sel) { cerca = []; for (const g of $$('.m-est', svg)) g.classList.remove('cerca', 'primero'); return; }
    const vis = puntos.filter(visible);
    const nuevos = cercanos(vis, luna.x, luna.y, 3).map(p => p.producto.id);
    const cambio = nuevos.join() !== cerca.join();
    const primeroCambio = nuevos[0] !== cerca[0];
    cerca = nuevos;
    for (const g of $$('.m-est', svg)) {
      const i = cerca.indexOf(g.dataset.id);
      g.classList.toggle('cerca', i >= 0);
      g.classList.toggle('primero', i === 0);
    }
    const p0 = porId.get(cerca[0]);
    gLuna()?.setAttribute('aria-valuetext', p0 ? `Más cerca: ${cerca.map(id => porId.get(id).producto.nombre).join(', ')}` : 'Sin perfumes cerca');
    if (cambio && !sel) pintarPanel();
    if (primeroCambio && arrastrando && navigator.vibrate && !reducir()) { try { navigator.vibrate(6); } catch {} }
  }

  // ---------- selección y constelación ----------
  function seleccionar(id, { mover = true } = {}) {
    const p = porId.get(id);
    sel = p ? id : null;
    for (const g of $$('.m-est', svg)) g.classList.toggle('sel', g.dataset.id === sel);
    gLuna()?.classList.toggle('dormida', !!sel);
    const capa = $('.m-lineas', svg);
    if (!p) { capa.innerHTML = ''; for (const g of $$('.m-est', svg)) g.classList.remove('afin'); actualizarCercanos(); pintarPanel(); return; }
    const afines = puntos.filter(q => q !== p && visible(q))
      .map(q => ({ q, n: notasComunes(p.producto, q.producto).length }))
      .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    const fuertes = afines.filter(x => x.n >= 2);
    const lista = (fuertes.length ? fuertes : afines).slice(0, 5);
    const ids = new Set(lista.map(x => x.q.producto.id));
    for (const g of $$('.m-est', svg)) g.classList.toggle('afin', ids.has(g.dataset.id));
    capa.innerHTML = lista.map((x, i) => {
      const x1 = p.x * S, y1 = p.y * S, x2 = x.q.x * S, y2 = x.q.y * S;
      const largo = Math.hypot(x2 - x1, y2 - y1);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" style="--l:${largo.toFixed(0)};--i:${i};--c:${fam(p.familia).color}" class="m-linea n${Math.min(x.n, 3)}"/>`;
    }).join('');
    if (mover) ponerLuna(p.x, p.y + 0.0001, { suave: true });
    pintarPanel();
  }

  // ---------- panel de abajo ----------
  function tarjetaMini(p, { grande = false, afinidad = '' } = {}) {
    const pr = p.producto;
    const est = !esComprable(pr) ? `<span class="estado ${pr.estado === 'agotado' ? 'agotado' : 'coming'}">${pr.estado === 'agotado' ? 'Agotado' : 'Coming soon'}</span>` : '';
    return `<li class="mapa-item${grande ? ' grande' : ''}" data-id="${esc(pr.id)}" style="--c:${fam(p.familia).color}">
      <button class="mi-abrir" type="button" data-accion="ficha" data-id="${esc(pr.id)}" aria-label="Ver detalles de ${esc(pr.nombre)}">
        <span class="mi-foto">${pr.foto ? `<img src="${FOTOS}${esc(pr.foto)}" alt="" width="72" height="72" loading="lazy">` : ''}</span>
        <span class="mi-info">
          <span class="mi-fam"><i></i>${esc(fam(p.familia).txt.slice(0, -1))}${est}</span>
          <b>${esc(pr.nombre)}</b>
          <span class="mi-notas">${esc(pr.notas.join(' · '))}</span>
          ${afinidad}
          <span class="mi-precio">${fmtCS(pr.precios.detalle.cs)} <small>${fmtUSD(pr.precios.detalle.usd)} · por mayor ${fmtCS(pr.precios.mayor.cs)}</small></span>
        </span>
      </button>
      <div class="t-accion">${controlAgregar(pr)}</div>
    </li>`;
  }
  function pintarPanel() {
    if (sel && porId.has(sel)) {
      const p = porId.get(sel);
      const afines = $$('.m-est.afin', svg).map(g => porId.get(g.dataset.id)).filter(Boolean);
      panel.innerHTML = `<div class="mp-cabeza"><p class="mp-titulo">Elegiste</p><button class="btn-texto" type="button" data-accion="mapa-soltar">Volver a tu luna</button></div>
        <ul class="mapa-lista">${tarjetaMini(p, { grande: true })}</ul>
        ${afines.length ? `<p class="mp-titulo">Su constelación <small>comparten notas</small></p>
        <ul class="mp-afines">${afines.map(q => `<li><button type="button" class="mp-afin" data-accion="mapa-elegir" data-id="${esc(q.producto.id)}" style="--c:${fam(q.familia).color}">
          <span class="mi-foto">${q.producto.foto ? `<img src="${FOTOS}${esc(q.producto.foto)}" alt="" width="44" height="44" loading="lazy">` : ''}</span>
          <span><b>${esc(q.producto.nombre)}</b><small>${esc(notasComunes(p.producto, q.producto).join(' · '))}</small></span></button></li>`).join('')}</ul>`
        : '<p class="mp-vacio">No comparte notas con los perfumes que estás viendo.</p>'}`;
      return;
    }
    const lista = cerca.map(id => porId.get(id)).filter(Boolean);
    panel.innerHTML = `<div class="mp-cabeza"><p class="mp-titulo">${deQuiz ? 'Cerca de tu estilo' : 'Cerca de tu luna'}</p></div>
      ${lista.length ? `<ul class="mapa-lista">${lista.map(p => tarjetaMini(p)).join('')}</ul>`
        : '<p class="mp-vacio">No hay perfumes con estos filtros. Prueba con “Todos”.</p>'}`;
  }

  // ---------- filtros ----------
  function pintarFiltros() {
    for (const b of $$('[data-accion="mapa-cat"]', d)) b.setAttribute('aria-pressed', b.dataset.cat === vista.cat);
    const s = $('[data-accion="mapa-solo"]', d); s.setAttribute('aria-pressed', vista.solo);
    for (const b of $$('[data-accion="mapa-familia"]', d)) b.setAttribute('aria-pressed', b.dataset.familia === vista.familia);
    for (const g of $$('.m-est', svg)) g.classList.toggle('fuera', !visible(porId.get(g.dataset.id)));
    for (const n of $$('.m-neb', svg)) n.classList.toggle('apagada', !!vista.familia && n.dataset.familia !== vista.familia);
    if (sel && !visible(porId.get(sel))) seleccionar(null);
    else if (sel) seleccionar(sel, { mover: false });
    actualizarCercanos();
    pintarPanel();
  }

  // ---------- arrastrar ----------
  let arrastrando = false, desde = null;
  function aLienzo(e) {
    const m = svg.getScreenCTM(); if (!m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: pt.x / S, y: pt.y / S };
  }
  svg.addEventListener('pointerdown', e => {
    const est = e.target.closest('.m-est');
    if (est && !est.classList.contains('fuera')) { desde = { id: est.dataset.id, x: e.clientX, y: e.clientY }; return; }
    const p = aLienzo(e); if (!p) return;
    arrastrando = true; desde = null;
    svg.setPointerCapture?.(e.pointerId);
    gLuna().classList.add('arrastrando');
    if (sel) seleccionar(null);
    deQuiz = false; $('.m-luna-txt', svg).textContent = '';
    ponerLuna(p.x, p.y, { suave: !e.target.closest('.m-luna') });
    e.preventDefault();
  });
  let rafId = 0, ultimo = null;
  svg.addEventListener('pointermove', e => {
    if (!arrastrando) return;
    ultimo = e;
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; const p = aLienzo(ultimo); if (p) ponerLuna(p.x, p.y); });
  });
  const soltar = e => {
    if (desde && e.type === 'pointerup' && Math.hypot(e.clientX - desde.x, e.clientY - desde.y) < 12) seleccionar(desde.id);
    desde = null;
    if (!arrastrando) return;
    arrastrando = false;
    gLuna()?.classList.remove('arrastrando');
    try { svg.releasePointerCapture?.(e.pointerId); } catch {}
  };
  svg.addEventListener('pointerup', soltar);
  svg.addEventListener('pointercancel', soltar);

  // teclado: flechas mueven la luna; Enter en una estrella la elige
  svg.addEventListener('keydown', e => {
    const est = e.target.closest('.m-est');
    if (est && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); seleccionar(est.dataset.id); return; }
    if (!e.target.closest('.m-luna')) return;
    const paso = e.shiftKey ? 0.08 : 0.03;
    const mov = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }[e.key];
    if (!mov) return;
    e.preventDefault();
    if (sel) seleccionar(null);
    ponerLuna(luna.x + mov[0], luna.y + mov[1], { suave: true });
  });

  d.addEventListener('click', e => {
    const b = e.target.closest('[data-accion]'); if (!b) return;
    switch (b.dataset.accion) {
      case 'mapa-cat': vista.cat = b.dataset.cat; pintarFiltros(); break;
      case 'mapa-solo': vista.solo = !vista.solo; pintarFiltros(); break;
      case 'mapa-familia': vista.familia = vista.familia === b.dataset.familia ? null : b.dataset.familia; pintarFiltros(); break;
      case 'mapa-elegir': seleccionar(b.dataset.id); break;
      case 'mapa-soltar': seleccionar(null); break;
    }
  });
  d.addEventListener('close', () => { if (location.hash === '#mapa') history.replaceState(null, '', ctx.hashBase ? ctx.hashBase() : `#${estado.cat}`); });

  // ---------- abrir ----------
  function abrirMapa({ id = null } = {}) {
    construir();
    sel = null; cerca = [];
    for (const g of $$('.m-est', svg)) g.classList.remove('sel', 'afin', 'cerca', 'primero');
    $('.m-lineas', svg).innerHTML = '';
    const r = estado.quiz?.r;
    const quizListo = estado.quiz && estado.quiz.paso >= PREGUNTAS.length && r?.aroma;
    deQuiz = false;
    if (id && porId.has(id)) {
      vista.cat = 'todos'; vista.familia = null;
    } else if (quizListo) {
      vista.cat = r.para === 'damas' ? 'damas' : 'caballeros'; vista.familia = null;
    }
    pintarFiltros();
    abrir(d);
    $('.hoja-cuerpo', d).scrollTop = 0;
    history.replaceState(null, '', '#mapa');
    d.classList.remove('entrando'); void d.offsetWidth; if (!reducir()) d.classList.add('entrando');
    if (id && porId.has(id)) { ponerLuna(porId.get(id).x, porId.get(id).y); seleccionar(id, { mover: false }); return; }
    const q = quizListo ? puntoDeQuiz(r) : null;
    if (q) { deQuiz = true; ponerLuna(q.x, q.y); $('.m-luna-txt', svg).textContent = 'Tu estilo'; }
    else { $('.m-luna-txt', svg).textContent = 'Arrástrame'; ponerLuna(0.5, 0.5); }
    pintarPanel();
  }

  // los botones de agregar del panel se actualizan con el pedido
  function refrescar() {
    if (!d.open) return;
    for (const li of $$('.mapa-item', panel)) {
      const p = estado.porId.get(li.dataset.id);
      const acc = li.querySelector('.t-accion');
      if (p && acc) acc.innerHTML = controlAgregar(p);
    }
  }

  return { abrirMapa, refrescar };
}
