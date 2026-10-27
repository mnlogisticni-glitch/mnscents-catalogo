// Página privada de MN Scents (acceso.html): crea enlaces de acceso al catálogo de reventa.
// La llave privada se crea aquí mismo ("Generar mi llave") y se guarda solo en este teléfono;
// a la web solo se sube su parte pública. La copia de seguridad (…/acceso#llave=…) tampoco viaja
// a ningún servidor: lo que va después de # no se envía.
import { crearToken, llaveCorrecta, llavePrivadaDe, comprobarAcceso, enlaceAcceso, limpiarNombre, VIGENCIAS, VIGENCIA_INICIAL } from './acceso.js';
import { fechaCorta } from './racha.js';

const CLAVE_LLAVE = 'mnscents-llave-v1';
const CLAVE_NUEVA = 'mnscents-llave-nueva-v1';      // creada aquí, esperando a que la web tenga su parte pública
const CLAVE_HIST = 'mnscents-accesos-creados-v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const leer = k => { try { return localStorage.getItem(k); } catch { return null; } };
const escribir = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch { return false; } };
const NOMBRES_VIGENCIA = { 30: '30 días', 90: '3 meses', 180: '6 meses', 365: '1 año' };

let llave = null, dActual = '';
const SECCIONES = ['.adm-sin-llave', '.adm-pendiente', '.adm-crear', '.adm-historial', '.adm-respaldo', '.adm-nota', '.adm-activada'];
const ocultarTodo = () => SECCIONES.forEach(x => mostrar(x, false));

function mostrar(sel, si) { const e = $(sel); if (e) e.hidden = !si; }
function error(caja, texto) { const e = $(`${caja} .adm-error`); e.textContent = texto; e.hidden = !texto; }

// Número de Nicaragua para wa.me: 8 dígitos → 505 + número
function telWa(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length === 8) return '505' + d;
  if (d.length >= 10 && d.length <= 15) return d;
  return '';
}
function mensaje(nombre, vence, enlace) {
  return `¡Hola, ${nombre}! Gracias por tu compra mayorista en MN Scents.\n\n`
    + `Este es tu acceso al catálogo de reventa, válido hasta el ${fechaCorta(vence)}:\n${enlace}\n\n`
    + 'Ábrelo en tu teléfono, elige tus perfumes, pon tus precios y comparte la imagen en tus estados.';
}
const enlaceWa = (tel, texto) => `https://wa.me/${telWa(tel)}?text=${encodeURIComponent(texto)}`;

// ---------- historial (solo en este teléfono) ----------
function historial() {
  try {
    const h = JSON.parse(leer(CLAVE_HIST) || '[]');
    return Array.isArray(h) ? h.filter(x => x && typeof x.t === 'string' && typeof x.n === 'string' && Number.isFinite(x.vence)).slice(0, 100) : [];
  } catch { return []; }
}
function pintarHistorial() {
  const h = historial();
  mostrar('.adm-historial', h.length > 0);
  const ahora = Date.now();
  $('.adm-historial ul').innerHTML = h.map((x, i) => {
    const vivo = ahora <= x.vence;
    return `<li class="${vivo ? '' : 'vencido'}">
      <div><b>${esc(x.n)}</b><span>${vivo ? `Vence el ${fechaCorta(x.vence)}` : `Venció el ${fechaCorta(x.vence)}`}</span></div>
      <a class="btn-ico" href="${esc(enlaceWa(x.tel, mensaje(x.n, x.vence, enlaceAcceso(x.t))))}" target="_blank" rel="noopener" aria-label="Enviar de nuevo a ${esc(x.n)} por WhatsApp"><svg class="ico"><use href="#i-chat"/></svg></a>
      <button class="btn-ico" type="button" data-copiar-hist="${i}" aria-label="Copiar el enlace de ${esc(x.n)}"><svg class="ico"><use href="#i-copiar"/></svg></button>
    </li>`;
  }).join('');
}

async function copiar(texto, boton) {
  let ok = false;
  try { await navigator.clipboard.writeText(texto); ok = true; } catch {
    const i = $('.adm-enlace'); if (i) { i.select(); ok = document.execCommand?.('copy'); }
  }
  if (boton) {
    const antes = boton.innerHTML;
    boton.innerHTML = ok ? '<svg class="ico"><use href="#i-check"/></svg>' + (boton.textContent.trim() ? 'Copiado' : '') : antes;
    setTimeout(() => { boton.innerHTML = antes; }, 1600);
  }
}

// ---------- crear ----------
function pintarVigencias() {
  $('.adm-opciones').innerHTML = VIGENCIAS.map(d =>
    `<label class="adm-op"><input type="radio" name="dias" value="${d}"${d === VIGENCIA_INICIAL ? ' checked' : ''}><span>${NOMBRES_VIGENCIA[d] || `${d} días`}</span></label>`).join('');
}

$('#f-crear').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const nombre = limpiarNombre(f.nombre.value);
  const dias = Number(f.dias.value);
  if (!nombre) { error('.adm-crear', 'Escribe el nombre del cliente.'); f.nombre.focus(); return; }
  if (f.tel.value.trim() && !telWa(f.tel.value)) { error('.adm-crear', 'Revisa el número de WhatsApp (8 dígitos) o déjalo vacío.'); f.tel.focus(); return; }
  error('.adm-crear', '');
  const t = await crearToken(llave, { nombre, dias });
  const r = await comprobarAcceso(t);              // se comprueba igual que en la web
  if (!r.ok) { error('.adm-crear', 'No se pudo crear el enlace. Vuelve a abrir tu enlace privado de vendedor.'); return; }
  const enlace = enlaceAcceso(t);
  const tel = f.tel.value.trim();
  $('.adm-listo span').textContent = `Enlace para ${r.nombre}, válido hasta el ${fechaCorta(r.vence)}.`;
  $('.adm-enlace').value = enlace;
  $('.adm-wa').href = enlaceWa(tel, mensaje(r.nombre, r.vence, enlace));
  mostrar('.adm-resultado', true);
  const h = historial(); h.unshift({ n: r.nombre, tel, vence: r.vence, t, creado: Date.now() });
  escribir(CLAVE_HIST, JSON.stringify(h.slice(0, 100)));
  pintarHistorial();
  $('.adm-resultado').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
});
$('#f-crear').addEventListener('input', () => { mostrar('.adm-resultado', false); error('.adm-crear', ''); });

// Botones que piden un segundo toque para confirmar (sin ventanas emergentes)
function confirmar(b, texto) {
  if (b.dataset.armado) return true;
  b.dataset.armado = '1'; b.dataset.antes = b.textContent; b.textContent = texto;
  setTimeout(() => { if (b.isConnected) { delete b.dataset.armado; b.textContent = b.dataset.antes; } }, 4000);
  return false;
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copiar], [data-copiar-hist], [data-olvidar], [data-generar], [data-regenerar], [data-copiar-codigo], [data-ver-respaldo], [data-copiar-respaldo]');
  if (!b) return;
  if (b.dataset.copiar !== undefined) copiar($('.adm-enlace').value, b);
  else if (b.dataset.copiarHist !== undefined) { const x = historial()[+b.dataset.copiarHist]; if (x) copiar(enlaceAcceso(x.t), b); }
  else if (b.dataset.copiarCodigo !== undefined) copiar($('.adm-codigo').value, b);
  else if (b.dataset.copiarRespaldo !== undefined) copiar($('.adm-respaldo-enlace').value, b);
  else if (b.dataset.verRespaldo !== undefined) {
    $('.adm-respaldo-enlace').value = `${location.origin}/acceso#llave=${dActual}`;
    mostrar('.adm-respaldo-caja', true); b.hidden = true;
  } else if (b.dataset.generar !== undefined) await generar();
  else if (b.dataset.regenerar !== undefined) { if (confirmar(b, 'Toca otra vez: la llave anterior se borra')) await generar(); }
  else if (b.dataset.olvidar !== undefined) {
    if (!confirmar(b, 'Toca otra vez para quitarla (sin copia de seguridad, se pierde)')) return;
    escribir(CLAVE_LLAVE, null); llave = null; dActual = '';
    ocultarTodo(); mostrar('.adm-sin-llave', true); error('.adm-sin-llave', '');
  }
});

// ---------- llave nueva ----------
const codigoPublico = k => `MNS-${k.x}.${k.y}`;
function pendiente() {
  try {
    const p = JSON.parse(leer(CLAVE_NUEVA) || 'null');
    return p && /^[A-Za-z0-9_-]{43}$/.test(p.d) && /^[A-Za-z0-9_-]{43}$/.test(p.x) && /^[A-Za-z0-9_-]{43}$/.test(p.y) ? p : null;
  } catch { return null; }
}
function mostrarPendiente(p) {
  ocultarTodo();
  $('.adm-codigo').value = codigoPublico(p);
  mostrar('.adm-pendiente', true);
}
async function generar() {
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const k = await crypto.subtle.exportKey('jwk', par.privateKey);
  const p = { d: k.d, x: k.x, y: k.y, creada: Date.now() };
  if (!escribir(CLAVE_NUEVA, JSON.stringify(p))) { error('.adm-sin-llave', 'Este navegador no deja guardar datos (¿modo incógnito?). Usa el navegador normal.'); return; }
  mostrarPendiente(p);
}
function listo(d, recien = false) {
  llave = llavePrivadaDe(d); dActual = d;
  ocultarTodo();
  pintarVigencias();
  for (const x of ['.adm-crear', '.adm-respaldo', '.adm-nota']) mostrar(x, true);
  mostrar('.adm-activada', recien);
  mostrar('.adm-respaldo-caja', false); $('[data-ver-respaldo]').hidden = false;
  pintarHistorial();
}

// ---------- arranque: ¿hay llave? ----------
async function iniciar() {
  const m = /llave=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(location.hash);
  if (m) history.replaceState(null, '', location.pathname);       // la llave sale de la barra de direcciones
  mostrar('.adm-cargando', false);
  // 1) copia de seguridad abierta ahora
  if (m) {
    if (await llaveCorrecta(m[1])) { escribir(CLAVE_LLAVE, m[1]); escribir(CLAVE_NUEVA, null); return listo(m[1]); }
    ocultarTodo(); mostrar('.adm-sin-llave', true);
    return error('.adm-sin-llave', 'Ese enlace de llave no corresponde a la web. Revisa que esté completo.');
  }
  // 2) llave ya guardada en este teléfono
  const d = leer(CLAVE_LLAVE) || '';
  if (d && await llaveCorrecta(d)) return listo(d);
  // 3) llave creada aquí que espera ser publicada (si la web ya la tiene, queda activada)
  const p = pendiente();
  if (p) {
    if (await llaveCorrecta(p.d)) { escribir(CLAVE_LLAVE, p.d); escribir(CLAVE_NUEVA, null); return listo(p.d, true); }
    return mostrarPendiente(p);
  }
  ocultarTodo(); mostrar('.adm-sin-llave', true);
  if (d) error('.adm-sin-llave', 'La llave guardada en este teléfono ya no corresponde a la web. Abre tu copia de seguridad o crea una llave nueva.');
}
iniciar();
