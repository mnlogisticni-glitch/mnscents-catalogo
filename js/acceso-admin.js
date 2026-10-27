// Página privada de MN Scents (acceso.html): crea enlaces de acceso al catálogo de reventa.
// La llave privada llega una sola vez en el enlace privado (…/acceso#llave=…), se guarda solo
// en este teléfono y nunca viaja a ningún servidor (lo que va después de # no se envía).
import { crearToken, llaveCorrecta, llavePrivadaDe, comprobarAcceso, enlaceAcceso, limpiarNombre, VIGENCIAS, VIGENCIA_INICIAL } from './acceso.js';
import { fechaCorta } from './racha.js';

const CLAVE_LLAVE = 'mnscents-llave-v1';
const CLAVE_HIST = 'mnscents-accesos-creados-v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const leer = k => { try { return localStorage.getItem(k); } catch { return null; } };
const escribir = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch { return false; } };
const NOMBRES_VIGENCIA = { 30: '30 días', 90: '3 meses', 180: '6 meses', 365: '1 año' };

let llave = null;

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
    boton.innerHTML = ok ? '<svg class="ico"><use href="#i-check"/></svg>' + (boton.dataset.copiar !== undefined ? 'Copiado' : '') : antes;
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

document.addEventListener('click', e => {
  const b = e.target.closest('[data-copiar], [data-copiar-hist], [data-olvidar]');
  if (!b) return;
  if (b.dataset.copiar !== undefined) copiar($('.adm-enlace').value, b);
  else if (b.dataset.copiarHist !== undefined) { const x = historial()[+b.dataset.copiarHist]; if (x) copiar(enlaceAcceso(x.t), b); }
  else if (b.dataset.olvidar !== undefined) {
    escribir(CLAVE_LLAVE, null); llave = null;
    for (const s of ['.adm-crear', '.adm-historial', '.adm-nota']) mostrar(s, false);
    mostrar('.adm-sin-llave', true);
  }
});

// ---------- arranque: ¿hay llave? ----------
async function iniciar() {
  let d = '';
  const m = /llave=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(location.hash);
  if (m) {
    d = m[1];
    history.replaceState(null, '', location.pathname);       // la llave sale de la barra de direcciones
  } else d = leer(CLAVE_LLAVE) || '';
  const valida = d ? await llaveCorrecta(d) : false;
  mostrar('.adm-cargando', false);
  if (!valida) {
    mostrar('.adm-sin-llave', true);
    if (d) error('.adm-sin-llave', m ? 'Ese enlace privado no corresponde a la llave de la web. Revisa que esté completo.' : 'La llave guardada ya no sirve. Abre de nuevo tu enlace privado de vendedor.');
    if (!m && d) escribir(CLAVE_LLAVE, null);
    return;
  }
  if (m) escribir(CLAVE_LLAVE, d);
  llave = llavePrivadaDe(d);
  pintarVigencias();
  for (const s of ['.adm-crear', '.adm-nota']) mostrar(s, true);
  pintarHistorial();
}
iniciar();
