// Enlaces de acceso al catálogo de reventa (solo para clientes que ya compraron al por mayor).
// MN Scents firma cada enlace con su llave privada (página acceso.html, en su teléfono) y la web
// lo comprueba con la llave pública. Sin servidores, sin cuentas y sin costo: nadie puede
// inventarse un enlace válido ni cambiarle el nombre o la fecha sin la llave privada.
import { LLAVE_PUBLICA } from './acceso-clave.js';

export const CLAVE_ACCESO = 'mnscents-acceso-v1';
export const VIGENCIAS = [30, 90, 180, 365];
export const VIGENCIA_INICIAL = 90;
const DIA = 864e5;
const NICA = 6 * 36e5;              // Nicaragua es UTC-6: el día cambia a medianoche de allá
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const FIRMA = { name: 'ECDSA', hash: 'SHA-256' };
const te = new TextEncoder(), td = new TextDecoder();

export const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function deB64u(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
export const limpiarNombre = s => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

// Día de Nicaragua (número de días desde 1970) y el último milisegundo de ese día
export const diaNica = ms => Math.floor((ms - NICA) / DIA);
export const finDelDia = dia => (dia + 1) * DIA + NICA - 1;

const RE_TOKEN = /^([A-Za-z0-9_-]{8,400})\.([A-Za-z0-9_-]{80,90})$/;

// Saca el código de un enlace completo, de "#acceso=..." o del código solo
export function extraerToken(texto) {
  const s = String(texto ?? '').trim();
  if (s.length > 1500) return '';
  const m = /acceso=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.exec(s);
  const t = m ? m[1] : s;
  return RE_TOKEN.test(t) ? t : '';
}

/**
 * Comprueba un enlace de acceso.
 * @returns {Promise<{ok:true, nombre:string, vence:number, emitido:number}
 *   | {ok:false, motivo:'invalido'} | {ok:false, motivo:'vencido', nombre:string, vence:number}>}
 */
export async function comprobarAcceso(token, { ahora = Date.now(), llave = LLAVE_PUBLICA } = {}) {
  const malo = { ok: false, motivo: 'invalido' };
  const m = typeof token === 'string' ? RE_TOKEN.exec(token) : null;
  if (!m) return malo;
  let d, firma;
  try { d = JSON.parse(td.decode(deB64u(m[1]))); firma = deB64u(m[2]); } catch { return malo; }
  if (firma.length !== 64) return malo;
  let valida = false;
  try {
    const k = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: llave.x, y: llave.y, ext: true }, ALG, false, ['verify']);
    valida = await crypto.subtle.verify(FIRMA, k, firma, te.encode(m[1]));
  } catch { return malo; }
  if (!valida) return malo;
  if (!d || d.v !== 1 || typeof d.n !== 'string' || !Number.isInteger(d.i) || !Number.isInteger(d.e) || d.e < d.i || d.e - d.i > 400) return malo;
  const nombre = limpiarNombre(d.n);
  if (!nombre) return malo;
  const vence = finDelDia(d.e);
  if (ahora > vence) return { ok: false, motivo: 'vencido', nombre, vence };
  return { ok: true, nombre, vence, emitido: d.i * DIA + NICA };
}

// Lo usa solo la página privada de MN Scents (acceso.html)
export async function crearToken(llavePrivada, { nombre, dias }, ahora = Date.now()) {
  const n = limpiarNombre(nombre);
  if (!n) throw new Error('Falta el nombre del cliente.');
  if (!Number.isInteger(dias) || dias < 1 || dias > 400) throw new Error('Vigencia no válida.');
  const i = diaNica(ahora);
  const datos = b64u(te.encode(JSON.stringify({ v: 1, n, i, e: i + dias })));
  const k = await crypto.subtle.importKey('jwk', { ...llavePrivada, ext: true }, ALG, false, ['sign']);
  const firma = new Uint8Array(await crypto.subtle.sign(FIRMA, k, te.encode(datos)));
  return `${datos}.${b64u(firma)}`;
}

// Arma la llave privada completa a partir de la parte secreta "d" y la pública
export const llavePrivadaDe = (d, publica = LLAVE_PUBLICA) => ({ kty: 'EC', crv: 'P-256', x: publica.x, y: publica.y, d });

// ¿La parte secreta corresponde a la llave pública de la web? (firma y comprueba)
export async function llaveCorrecta(d, publica = LLAVE_PUBLICA) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(d ?? ''))) return false;
  try {
    const t = await crearToken(llavePrivadaDe(d, publica), { nombre: 'prueba', dias: 1 });
    return (await comprobarAcceso(t, { llave: publica })).ok;
  } catch { return false; }
}

export const enlaceAcceso = (token, base = 'https://mnscents.pages.dev/') => `${base}#acceso=${token}`;
