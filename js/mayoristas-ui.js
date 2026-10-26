// Herramientas para mayoristas: tarjeta de racha, calculadora de ganancia y catálogo de reventa.
// Todo se guarda solo en el navegador del cliente (sin cuentas, sin servidores).
import { fmtCS, esComprable, UMBRAL_MAYOREO } from './precios.js';
import { estadoRacha, fechaCorta, RACHA } from './racha.js';
import { calcularGanancia, precioConMargen, leerMonto } from './ganancia.js';
import { imagenCatalogo, limpiar, limpiarTelefono } from './catalogo-reventa.js';

const CLAVE = 'mnscents-reventa-v1';
const MAX_CATALOGO = 6;

export function iniciarMayoristas(ctx) {
  const { estado, $, $$, esc, ico, FOTOS, abrir, anunciar, fijarQty, calcPedido } = ctx;

  // ---------- datos del revendedor (solo en este teléfono) ----------
  function cargar() {
    let v = {};
    try { v = JSON.parse(localStorage.getItem(CLAVE) || '{}') || {}; } catch {}
    const precios = {};
    if (v.precios && typeof v.precios === 'object') for (const [k, n] of Object.entries(v.precios)) {
      if (/^[A-Za-z0-9]{1,12}$/.test(k) && leerMonto(n)) precios[k] = leerMonto(n);
    }
    const gastos = Array.isArray(v.gastos) ? v.gastos.slice(0, 12).map(g => ({ c: limpiar(g?.c, 30), m: leerMonto(g?.m) || '' })) : [];
    return {
      precios,
      gastos: gastos.length ? gastos : [{ c: 'Envío', m: '' }],
      pct: Number.isFinite(v.pct) && v.pct >= 0 && v.pct <= 500 ? v.pct : 30,
      negocio: limpiar(v.negocio, 40), tel: limpiarTelefono(v.tel), titulo: limpiar(v.titulo, 48),
      tema: v.tema === 'claro' ? 'claro' : 'noche',
      sel: Array.isArray(v.sel) ? v.sel.filter(x => /^[A-Za-z0-9]{1,12}$/.test(x)).slice(0, MAX_CATALOGO) : [],
    };
  }
  const datos = cargar();
  const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch {} };

  // ======================================================================
  // Tarjeta "Tu racha mayorista" (encima del catálogo)
  // ======================================================================
  function pintarRacha() {
    const caja = $('.racha-tarjeta');
    if (!caja) return;
    const r = estado.racha;
    const e = estadoRacha(r);
    const recienVencida = e.vencida && Date.now() - e.vencio < 21 * 86400000;
    if (!r || (!e.activa && !recienVencida)) { caja.hidden = true; caja.innerHTML = ''; return; }
    caja.hidden = false;
    caja.classList.toggle('vencida', !e.activa);
    const hayPedido = r.pedido?.some(x => esComprable(estado.porId.get(x.id)));
    if (e.activa) {
      const etapa = e.etapa === 'primera'
        ? `Llévate desde <b>${RACHA.minPrimera} perfume</b> a precio mayorista.`
        : `Compra desde <b>${RACHA.minMantener} perfumes</b> antes de que venza y la mantienes.`;
      const cuando = e.dias === 0 ? 'Vence hoy' : `${e.dias === 1 ? 'Queda 1 día' : `Quedan ${e.dias} días`} · vence el ${fechaCorta(e.vence)}`;
      caja.innerHTML = `
        <div class="rt-cabeza"><span class="rt-ico">${ico('racha')}</span>
          <div><b class="rt-titulo">Tu racha mayorista está activa</b><span class="rt-etapa">${etapa}</span></div></div>
        <div class="rt-barra" role="progressbar" aria-label="Días que le quedan a tu racha" aria-valuemin="0" aria-valuemax="${e.total}" aria-valuenow="${e.dias}">
          <i style="--v:${Math.max(0.04, e.dias / e.total).toFixed(3)}"></i></div>
        <p class="rt-dias">${esc(cuando)}</p>
        <div class="rt-acciones">
          ${hayPedido ? `<button class="btn sec" type="button" data-accion="repetir-racha">${ico('repetir')}Repetir mi último pedido</button>` : ''}
          <a class="btn-texto" href="#mayoristas">Ver reglas</a>
        </div>
        <p class="rt-nota">Guardada solo en este teléfono. El precio mayorista te lo confirmamos por WhatsApp. <button class="btn-texto" type="button" data-accion="borrar-racha">Borrar</button></p>`;
    } else {
      caja.innerHTML = `
        <div class="rt-cabeza"><span class="rt-ico">${ico('alerta')}</span>
          <div><b class="rt-titulo">Tu racha venció el ${esc(fechaCorta(e.vencio))}</b>
          <span class="rt-etapa">Con una compra de ${UMBRAL_MAYOREO} perfumes o más la vuelves a activar.</span></div></div>
        <p class="rt-nota"><a class="btn-texto" href="#mayoristas">Ver reglas</a> · <button class="btn-texto" type="button" data-accion="borrar-racha">Ocultar</button></p>`;
    }
  }

  function repetirPedido() {
    const r = estado.racha; if (!r?.pedido?.length) return;
    let agregados = 0, sinStock = 0;
    for (const it of r.pedido) {
      const p = estado.porId.get(it.id);
      if (!esComprable(p)) { sinStock++; continue; }
      const actual = estado.carrito.find(x => x.id === it.id)?.qty || 0;
      if (fijarQty(it.id, Math.max(actual, it.qty)) > 0) agregados++;
    }
    abrir($('#hoja-pedido'));
    anunciar(agregados
      ? `Agregamos ${agregados} ${agregados === 1 ? 'perfume' : 'perfumes'} de tu último pedido.${sinStock ? ` ${sinStock} ya no ${sinStock === 1 ? 'está disponible' : 'están disponibles'}.` : ''}`
      : 'Los perfumes de tu último pedido no están disponibles ahora.');
  }

  // ======================================================================
  // Calculadora de ganancia
  // ======================================================================
  const dG = $('#hoja-ganancia');
  const lineasCarrito = () => calcPedido().lineas;

  function resultadoGanancia() {
    const ls = lineasCarrito().map(l => ({ id: l.producto.id, qty: l.qty, costo: l.producto.precios.mayor.cs, venta: datos.precios[l.producto.id] || 0 }));
    return calcularGanancia(ls, datos.gastos.map(g => ({ monto: g.m })));
  }

  function pintarGanancia() {
    const cuerpo = $('.ganancia', dG);
    const ped = calcPedido();
    const ls = ped.lineas;
    const enCarrito = new Set(estado.carrito.map(x => x.id));
    const opciones = estado.productos.filter(p => esComprable(p) && !enCarrito.has(p.id))
      .sort((a, b) => a.catalogo.localeCompare(b.catalogo) || a.nombre.localeCompare(b.nombre, 'es'));
    const conMayor = ped.nivel === 'mayor';
    cuerpo.innerHTML = `
      <p class="gan-intro">Tu costo es nuestro <b>precio mayorista</b>. Escribe a cuánto venderás cada perfume y tus gastos: la cuenta se hace sola.</p>
      ${ls.length && !conMayor ? `<p class="gan-aviso">${ico('stack')}<span>Estos costos son con precio mayorista: necesitas ${UMBRAL_MAYOREO} unidades en tu pedido${estadoRacha(estado.racha).activa ? ' o cumplir tu racha' : ''}. Llevas ${ped.unidades}.</span></p>` : ''}
      ${ls.length ? `<ul class="gan-lineas">${ls.map(l => {
        const p = l.producto, v = datos.precios[p.id] || '';
        return `<li class="gan-linea" data-id="${esc(p.id)}">
          <span class="gan-foto">${p.foto ? `<img src="${FOTOS}${esc(p.foto)}" alt="" width="56" height="56" loading="lazy">` : ''}</span>
          <div class="gan-info">
            <b>${esc(p.nombre)}</b>
            <span class="gan-costo">Te cuesta ${fmtCS(p.precios.mayor.cs)} c/u</span>
          </div>
          <div class="paso gan-paso" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
            <button type="button" data-accion="menos" data-id="${esc(p.id)}" aria-label="Quitar una unidad de ${esc(p.nombre)}">${ico('minus')}</button>
            <output>${l.qty}</output>
            <button type="button" data-accion="mas" data-id="${esc(p.id)}" aria-label="Agregar una unidad de ${esc(p.nombre)}" ${l.qty >= l.max ? 'disabled' : ''}>${ico('plus')}</button>
          </div>
          <label class="gan-venta"><span>Vendes a</span><span class="gan-campo"><i>C$</i><input type="text" inputmode="decimal" autocomplete="off" maxlength="9" data-gan-precio="${esc(p.id)}" value="${esc(v)}" aria-label="Precio al que vendes ${esc(p.nombre)}"></span></label>
          <span class="gan-res" data-gan-res="${esc(p.id)}"></span>
        </li>`;
      }).join('')}</ul>` : '<p class="gan-vacio">Agrega los perfumes que quieres revender para calcular tu ganancia.</p>'}
      ${opciones.length ? `<label class="gan-agregar"><span class="sr">Agregar un perfume</span>
        <select data-gan-agregar><option value="">＋ Agregar un perfume</option>
          ${['caballeros', 'damas'].map(c => {
            const ops = opciones.filter(p => p.catalogo === c);
            return ops.length ? `<optgroup label="${c === 'damas' ? 'Damas' : 'Caballeros'}">${ops.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)} · te cuesta ${fmtCS(p.precios.mayor.cs)}</option>`).join('')}</optgroup>` : '';
          }).join('')}
        </select></label>` : ''}
      ${ls.length ? `<div class="gan-atajos">
        <p class="gan-sub">Atajos para llenar tus precios</p>
        <div class="gan-atajo-fila">
          <label class="gan-pct"><span>Ganar</span><input type="number" inputmode="numeric" min="0" max="500" step="5" value="${datos.pct}" data-gan-pct aria-label="Porcentaje de ganancia sobre el costo"><span>%</span></label>
          <button class="btn-chip" type="button" data-accion="gan-pct">Aplicar a todos</button>
        </div>
        <button class="btn-chip" type="button" data-accion="gan-detalle">Usar nuestro precio al detalle como referencia</button>
        <p class="gan-ayuda">El % se calcula sobre lo que te cuesta y se redondea a C$5. Tú decides tus precios.</p>
      </div>` : ''}
      <fieldset class="gan-gastos">
        <legend>Tus gastos <small>(envío, empaque, publicidad…)</small></legend>
        ${datos.gastos.map((g, i) => `<div class="gasto">
          <input type="text" maxlength="30" value="${esc(g.c)}" placeholder="Concepto" data-gasto-c="${i}" aria-label="Concepto del gasto ${i + 1}">
          <span class="gan-campo"><i>C$</i><input type="text" inputmode="decimal" maxlength="9" value="${esc(g.m)}" placeholder="0" data-gasto-m="${i}" aria-label="Monto del gasto ${i + 1}"></span>
          <button class="btn-ico gasto-quitar" type="button" data-accion="gan-quitar-gasto" data-i="${i}" aria-label="Quitar este gasto">${ico('close')}</button>
        </div>`).join('')}
        ${datos.gastos.length < 12 ? `<button class="btn-chip" type="button" data-accion="gan-mas-gasto">${ico('plus')}Agregar gasto</button>` : ''}
      </fieldset>`;
    actualizarResultados();
  }

  function actualizarResultados() {
    const g = resultadoGanancia();
    for (const l of g.lineas) {
      const el = $(`[data-gan-res="${CSS.escape(l.id)}"]`, dG);
      if (!el) continue;
      el.className = 'gan-res' + (l.gananciaUnit === null ? '' : l.gananciaUnit >= 0 ? ' pos' : ' neg');
      el.textContent = l.gananciaUnit === null ? 'Escribe tu precio'
        : l.gananciaUnit >= 0 ? `Ganas ${fmtCS(l.gananciaUnit)} c/u` : `Pierdes ${fmtCS(-l.gananciaUnit)} c/u`;
    }
    const pie = $('.gan-pie', dG);
    if (!g.lineas.length) { pie.innerHTML = `<button class="btn sec" type="button" data-accion="cerrar-ganancia">Cerrar</button>`; return; }
    const faltan = g.lineas.filter(l => !l.conPrecio).length;
    pie.innerHTML = `
      <dl class="gan-resumen" aria-live="polite">
        <div><dt>Inviertes</dt><dd>${fmtCS(g.inversion)}<small>${fmtCS(g.inversionProductos)} perfumes${g.totalGastos ? ` + ${fmtCS(g.totalGastos)} gastos` : ''}</small></dd></div>
        <div><dt>Vendes</dt><dd>${g.venta ? fmtCS(g.venta) : '—'}<small>${g.unidades} ${g.unidades === 1 ? 'frasco' : 'frascos'}</small></dd></div>
        <div class="gan-total ${g.ganancia === null ? '' : g.ganancia >= 0 ? 'pos' : 'neg'}"><dt>${g.ganancia !== null && g.ganancia < 0 ? 'Pierdes' : 'Ganas'}</dt>
          <dd>${g.ganancia === null ? '—' : fmtCS(Math.abs(g.ganancia))}<small>${g.ganancia === null ? `Falta${faltan === 1 ? '' : 'n'} ${faltan} ${faltan === 1 ? 'precio' : 'precios'}`
            : `${Math.round(g.margen * 100)}% de lo que vendes · ${fmtCS(g.porFrasco)} por frasco`}</small></dd></div>
      </dl>
      <button class="btn pri" type="button" data-accion="abrir-reventa" ${g.lineas.some(l => l.conPrecio) ? '' : 'aria-disabled="true"'}>${ico('imagen')}Crear mi catálogo con estos precios</button>`;
  }

  function abrirGanancia() {
    pintarGanancia();
    abrir(dG);
    $('.hoja-cuerpo', dG).scrollTop = 0;
  }

  dG.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.ganPrecio) {
      const n = leerMonto(t.value);
      if (n) datos.precios[t.dataset.ganPrecio] = n; else delete datos.precios[t.dataset.ganPrecio];
    } else if (t.dataset.gastoC !== undefined) datos.gastos[+t.dataset.gastoC].c = limpiar(t.value, 30);
    else if (t.dataset.gastoM !== undefined) datos.gastos[+t.dataset.gastoM].m = leerMonto(t.value) || '';
    else if (t.dataset.ganPct !== undefined) { const n = Number(t.value); if (Number.isFinite(n) && n >= 0 && n <= 500) datos.pct = n; }
    else return;
    guardar(); actualizarResultados();
  });
  dG.addEventListener('change', e => {
    if (e.target.dataset.ganAgregar === undefined || !e.target.value) return;
    const id = e.target.value;
    fijarQty(id, 1);   // también lo agrega al pedido: el pedido y la calculadora son lo mismo
    anunciar(`${estado.porId.get(id)?.nombre || 'Perfume'} agregado a tu pedido.`);
    requestAnimationFrame(() => $(`[data-gan-precio="${CSS.escape(id)}"]`, dG)?.focus());
  });
  dG.addEventListener('click', e => {
    const b = e.target.closest('[data-accion]'); if (!b) return;
    switch (b.dataset.accion) {
      case 'gan-pct':
        for (const l of lineasCarrito()) datos.precios[l.producto.id] = precioConMargen(l.producto.precios.mayor.cs, datos.pct);
        guardar(); pintarGanancia(); anunciar(`Precios llenados con ${datos.pct}% de ganancia.`); break;
      case 'gan-detalle':
        for (const l of lineasCarrito()) datos.precios[l.producto.id] = l.producto.precios.detalle.cs;
        guardar(); pintarGanancia(); anunciar('Precios llenados con nuestro precio al detalle. Puedes cambiarlos.'); break;
      case 'gan-mas-gasto':
        datos.gastos.push({ c: '', m: '' }); guardar(); pintarGanancia();
        requestAnimationFrame(() => $(`[data-gasto-c="${datos.gastos.length - 1}"]`, dG)?.focus()); break;
      case 'gan-quitar-gasto':
        datos.gastos.splice(+b.dataset.i, 1); if (!datos.gastos.length) datos.gastos.push({ c: '', m: '' });
        guardar(); pintarGanancia(); break;
      case 'cerrar-ganancia': ctx.cerrar(dG); break;
    }
  });

  // ======================================================================
  // Catálogo de reventa
  // ======================================================================
  const dR = $('#hoja-reventa');
  let logo = null, logoUrl = null, tImagen = null, blobActual = null, vistaUrl = null, version = 0;

  function seleccionValida() {
    return datos.sel.filter(id => esComprable(estado.porId.get(id)));
  }
  function pintarReventa() {
    const cuerpo = $('.reventa', dR);
    const disp = estado.productos.filter(esComprable)
      .sort((a, b) => a.catalogo.localeCompare(b.catalogo) || a.orden - b.orden);
    const sel = seleccionValida();
    cuerpo.innerHTML = `
      <p class="gan-intro">Elige hasta ${MAX_CATALOGO} perfumes disponibles, escribe tus precios y tu número. La imagen se crea en tu teléfono, lista para tus historias y estados.</p>
      <div class="rev-campos">
        <label class="campo"><span>Nombre de tu negocio</span><input type="text" maxlength="40" value="${esc(datos.negocio)}" data-rev="negocio" autocomplete="organization" placeholder="Ej.: Perfumes Ana"></label>
        <label class="campo"><span>Tu WhatsApp</span><input type="tel" maxlength="22" value="${esc(datos.tel)}" data-rev="tel" autocomplete="tel" placeholder="Ej.: 8888-8888"></label>
        <label class="campo ancho"><span>Título <small>(opcional)</small></span><input type="text" maxlength="48" value="${esc(datos.titulo)}" data-rev="titulo" placeholder="Perfumes disponibles"></label>
      </div>
      <div class="rev-fila">
        <div class="rev-logo">
          ${logo ? `<img src="${logoUrl}" alt="Tu logo" width="48" height="48"><button class="btn-texto" type="button" data-accion="rev-quitar-logo">Quitar logo</button>`
            : `<label class="btn-chip"><input class="sr" type="file" accept="image/png,image/jpeg,image/webp" data-rev-logo>${ico('imagen')}Subir tu logo <small>(opcional)</small></label>`}
        </div>
        <div class="rev-tema" role="radiogroup" aria-label="Estilo de la imagen">
          ${['noche', 'claro'].map(t => `<button type="button" role="radio" aria-checked="${datos.tema === t}" data-accion="rev-tema" data-tema="${t}" class="tema-${t}">${t === 'noche' ? 'Noche' : 'Claro'}</button>`).join('')}
        </div>
      </div>
      <p class="gan-sub">Tus perfumes <span class="rev-cuenta">${sel.length} de ${MAX_CATALOGO}</span></p>
      <ul class="rev-perfumes">${disp.map(p => {
        const on = sel.includes(p.id);
        return `<li class="rev-p${on ? ' on' : ''}" data-id="${esc(p.id)}">
          <button type="button" class="rev-elegir" data-accion="rev-elegir" data-id="${esc(p.id)}" aria-pressed="${on}" aria-label="${esc(p.nombre)}${on ? ', elegido' : ''}">
            <span class="rev-foto">${p.foto ? `<img src="${FOTOS}${esc(p.foto)}" alt="" width="80" height="80" loading="lazy">` : ''}</span>
            <span class="rev-nombre">${esc(p.nombre)}</span>
            <span class="rev-check" aria-hidden="true">${on ? sel.indexOf(p.id) + 1 : ''}</span>
          </button>
          ${on ? `<span class="gan-campo rev-precio"><i>C$</i><input type="text" inputmode="decimal" maxlength="9" value="${esc(datos.precios[p.id] || '')}" data-rev-precio="${esc(p.id)}" aria-label="Tu precio de ${esc(p.nombre)}" placeholder="Precio"></span>` : ''}
        </li>`;
      }).join('')}</ul>
      <p class="gan-sub">Vista previa</p>
      <div class="rev-vista" aria-live="polite"><p class="rev-falta"></p><img alt="Vista previa de tu catálogo" hidden></div>`;
    programarImagen(0);
  }

  function faltante() {
    const sel = seleccionValida();
    if (!sel.length) return 'Elige al menos un perfume.';
    if (sel.some(id => !datos.precios[id])) return 'Escribe el precio de cada perfume elegido.';
    if (!datos.negocio) return 'Escribe el nombre de tu negocio.';
    if (limpiarTelefono(datos.tel).replace(/\D/g, '').length < 8) return 'Escribe tu número de WhatsApp.';
    return '';
  }
  function pintarPieReventa() {
    const falta = faltante();
    const pie = $('.rev-pie', dR);
    const dis = falta || !blobActual ? 'aria-disabled="true"' : '';
    pie.innerHTML = `<button class="btn sec btn-guardar" type="button" data-accion="rev-guardar" aria-label="Guardar imagen" ${dis}>${ico('download')}</button>
      <button class="btn pri" type="button" data-accion="rev-compartir" ${dis}>${ico('share')}Compartir mi catálogo</button>`;
  }
  function programarImagen(ms = 350) {
    clearTimeout(tImagen);
    blobActual = null;
    pintarPieReventa();
    const falta = faltante();
    const vista = $('.rev-vista', dR);
    if (!vista) return;
    $('.rev-falta', vista).textContent = falta;
    $('.rev-falta', vista).hidden = !falta;
    if (falta) { $('img', vista).hidden = true; return; }
    tImagen = setTimeout(async () => {
      const v = ++version;
      vista.classList.add('cargando');
      try {
        const items = seleccionValida().map(id => ({ producto: estado.porId.get(id), precio: datos.precios[id] }));
        const blob = await imagenCatalogo({ titulo: datos.titulo, negocio: datos.negocio, telefono: datos.tel, logo, items, tema: datos.tema, fotos: FOTOS });
        if (v !== version) return;
        blobActual = blob;
        if (vistaUrl) URL.revokeObjectURL(vistaUrl);
        vistaUrl = URL.createObjectURL(blob);
        const img = $('img', vista); img.src = vistaUrl; img.hidden = false;
      } catch { $('.rev-falta', vista).textContent = 'No pudimos crear la imagen. Intenta de nuevo.'; $('.rev-falta', vista).hidden = false; }
      finally { vista.classList.remove('cargando'); pintarPieReventa(); }
    }, ms);
  }

  async function compartirCatalogo(soloGuardar) {
    if (!blobActual) return;
    const nombre = `catalogo-${(datos.negocio || 'mi-tienda').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mi-tienda'}.png`;
    if (!soloGuardar) {
      const archivo = new File([blobActual], nombre, { type: 'image/png' });
      try {
        if (navigator.canShare?.({ files: [archivo] })) { await navigator.share({ files: [archivo] }); return; }
      } catch (e) { if (e?.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blobActual); a.download = nombre;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    anunciar('Imagen guardada. Súbela a tus historias o estados.');
  }

  function abrirReventa() {
    // si todavía no eligió perfumes, empezamos con los de su pedido
    if (!seleccionValida().length) {
      datos.sel = calcPedido().lineas.map(l => l.producto.id).slice(0, MAX_CATALOGO);
      guardar();
    }
    pintarReventa();
    if (dG.open) ctx.cerrar(dG);
    abrir(dR);
    $('.hoja-cuerpo', dR).scrollTop = 0;
  }

  dR.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.rev === 'negocio') datos.negocio = limpiar(t.value, 40);
    else if (t.dataset.rev === 'tel') datos.tel = limpiarTelefono(t.value);
    else if (t.dataset.rev === 'titulo') datos.titulo = limpiar(t.value, 48);
    else if (t.dataset.revPrecio) {
      const n = leerMonto(t.value);
      if (n) datos.precios[t.dataset.revPrecio] = n; else delete datos.precios[t.dataset.revPrecio];
    } else return;
    guardar(); programarImagen();
  });
  dR.addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.revLogo === undefined || !t.files?.[0]) return;
    const f = t.files[0];
    if (!/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) { anunciar('Usa una imagen PNG, JPG o WEBP de menos de 5 MB.'); return; }
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => { if (logoUrl) URL.revokeObjectURL(logoUrl); logo = im; logoUrl = url; pintarReventa(); anunciar('Logo agregado.'); };
    im.onerror = () => { URL.revokeObjectURL(url); anunciar('No pudimos leer esa imagen.'); };
    im.src = url;
  });
  dR.addEventListener('click', e => {
    const b = e.target.closest('[data-accion]'); if (!b) return;
    switch (b.dataset.accion) {
      case 'rev-elegir': {
        const id = b.dataset.id;
        let sel = seleccionValida();
        if (sel.includes(id)) sel = sel.filter(x => x !== id);
        else if (sel.length >= MAX_CATALOGO) { anunciar(`Puedes elegir hasta ${MAX_CATALOGO} perfumes.`); return; }
        else sel.push(id);
        datos.sel = sel; guardar();
        const y = $('.hoja-cuerpo', dR).scrollTop;
        pintarReventa();
        $('.hoja-cuerpo', dR).scrollTop = y;
        if (sel.includes(id)) requestAnimationFrame(() => $(`[data-rev-precio="${CSS.escape(id)}"]`, dR)?.focus({ preventScroll: true }));
        else requestAnimationFrame(() => $(`.rev-elegir[data-id="${CSS.escape(id)}"]`, dR)?.focus({ preventScroll: true }));
        break;
      }
      case 'rev-tema': datos.tema = b.dataset.tema === 'claro' ? 'claro' : 'noche'; guardar();
        for (const x of $$('[data-accion="rev-tema"]', dR)) x.setAttribute('aria-checked', x === b);
        programarImagen(0); break;
      case 'rev-quitar-logo': if (logoUrl) URL.revokeObjectURL(logoUrl); logo = null; logoUrl = null; pintarReventa(); break;
      case 'rev-guardar': compartirCatalogo(true); break;
      case 'rev-compartir': compartirCatalogo(false); break;
    }
  });

  // Cuando cambia el pedido o el catálogo, lo que esté abierto se actualiza
  function refrescar() {
    pintarRacha();
    if (dG.open) {
      const y = $('.hoja-cuerpo', dG).scrollTop;
      const activo = document.activeElement?.dataset?.ganPrecio;
      pintarGanancia();
      $('.hoja-cuerpo', dG).scrollTop = y;
      if (activo) $(`[data-gan-precio="${CSS.escape(activo)}"]`, dG)?.focus({ preventScroll: true });
    }
  }

  return { pintarRacha, repetirPedido, abrirGanancia, abrirReventa, refrescar };
}
