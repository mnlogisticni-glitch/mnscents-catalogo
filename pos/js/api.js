// Punto de venta MN Scents — conexión con la hoja (Apps Script) y cola sin señal.
// Todo se guarda solo en este dispositivo: la conexión, la última copia de los datos y lo pendiente.

const K = { CONEXION: 'mnpos-conexion-v1', ESTADO: 'mnpos-estado-v1', COLA: 'mnpos-cola-v1', ERRORES: 'mnpos-errores-v1' };
const leer = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; } };
const escribir = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const conexion = () => { const c = leer(K.CONEXION, null); return c && c.url && c.clave ? c : null; };
export const guardarConexion = c => escribir(K.CONEXION, { url: c.url, clave: c.clave, desde: Date.now() });
export const olvidarConexion = () => { escribir(K.CONEXION, null); escribir(K.ESTADO, null); };

export const estadoGuardado = () => leer(K.ESTADO, null);
export const guardarEstado = e => escribir(K.ESTADO, e);
export const cola = () => leer(K.COLA, []);
const guardarCola = c => escribir(K.COLA, c);
export const errores = () => leer(K.ERRORES, []);
export const borrarErrores = () => escribir(K.ERRORES, []);

export class ErrorRed extends Error {}
export class ErrorHoja extends Error {}

export async function llamar(cuerpo, { espera = 30000 } = {}) {
  const c = conexion();
  if (!c) throw new ErrorHoja('no-vinculado');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), espera);
  let r;
  try {
    // texto plano: así Google responde sin pedir permisos extra al navegador
    r = await fetch(c.url, { method: 'POST', body: JSON.stringify({ ...cuerpo, t: c.clave }), redirect: 'follow', signal: ctrl.signal, cache: 'no-store' });
  } catch { throw new ErrorRed('Sin conexión'); }
  finally { clearTimeout(t); }
  let d;
  try { d = await r.json(); } catch { throw new ErrorRed('Respuesta incompleta'); }
  if (!d || d.ok !== true) throw new ErrorHoja(d?.error || 'Error de la hoja');
  return d;
}

// Agrega una operación a la cola (venta, caja, ajuste, anular). Siempre lleva su id para no repetirse.
export function encolar(op) {
  const c = cola();
  c.push({ ...op, creado: Date.now() });
  guardarCola(c);
}
export function quitarDeCola(id) { guardarCola(cola().filter(o => o.id !== id)); }

let procesando = null;
/**
 * Envía lo pendiente, una por una (la hoja responde sin recalcular todo). Devuelve { estado, enviadas, sinRed, fallidas }.
 * Si una operación la rechaza la hoja (dato malo), se aparta en "errores" para revisarla y se sigue.
 */
export function procesarCola(alResultado) {
  if (procesando) return procesando;
  procesando = (async () => {
    let estado = null, enviadas = 0, sinRed = false, fallidas = 0;
    for (const op of cola()) {
      const { creado, ...cuerpo } = op;
      try {
        const resp = await llamar(cuerpo);
        if (resp.productos) estado = resp;          // versiones viejas del script devolvían todo el estado
        enviadas++;
        quitarDeCola(op.id);
        alResultado?.(op, resp.resultado);
      } catch (e) {
        if (e instanceof ErrorRed) { sinRed = true; break; }
        if (e.message === 'no-autorizado') throw e;
        fallidas++;
        quitarDeCola(op.id);
        const er = errores(); er.push({ op, error: e.message, cuando: Date.now() }); escribir(K.ERRORES, er.slice(-20));
      }
    }
    if (estado) guardarEstado(estado);
    return { estado, enviadas, sinRed, fallidas };
  })().finally(() => { procesando = null; });
  return procesando;
}
