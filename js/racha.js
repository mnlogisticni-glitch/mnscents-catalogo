// Racha mayorista: se guarda solo en el teléfono del cliente y siempre es "por confirmar".
// MN Scents la confirma con su hoja de Ventas antes de aceptar el precio mayorista.
// Reglas (sección "Solo para mayoristas"):
//   1. Una compra de 6 perfumes o más desbloquea el precio mayorista.
//   2. Durante 6 días, la siguiente compra puede ser desde 1 perfume a precio mayorista.
//   3. Después, una compra desde 3 perfumes cada 30 días mantiene el beneficio.
//   4. Si pasan 30 días sin una compra, se pierde y se vuelve a necesitar una de 6.
import { UMBRAL_MAYOREO } from './precios.js';

export const RACHA = { diasPrimera: 6, minPrimera: 1, diasMantener: 30, minMantener: 3 };
const DIA = 86400000;

// Lo que viene del almacenamiento del navegador no es confiable: se valida todo
export function validarRacha(v) {
  if (!v || typeof v !== 'object') return null;
  const n = x => (Number.isFinite(x) && x > 0 ? x : null);
  const inicio = n(v.inicio), ultima = n(v.ultima);
  if (!inicio || !ultima || ultima < inicio) return null;
  const pedido = Array.isArray(v.pedido) ? v.pedido
    .filter(x => x && /^[A-Za-z0-9]{1,12}$/.test(String(x.id)) && Number.isInteger(x.qty) && x.qty > 0 && x.qty < 100)
    .slice(0, 60).map(x => ({ id: String(x.id), qty: x.qty })) : [];
  return { inicio, ultima, primeraUsada: v.primeraUsada === true, pedido };
}

/**
 * Estado de la racha en un momento dado.
 * activa: { activa, etapa: 'primera'|'mantener', minimo, vence, dias, total }
 * vencida: { activa: false, vencida: true, vencio }
 */
export function estadoRacha(r, ahora = Date.now()) {
  if (!r) return { activa: false, vencida: false };
  const venceMantener = r.ultima + RACHA.diasMantener * DIA;
  const vencePrimera = r.inicio + RACHA.diasPrimera * DIA;
  if (!r.primeraUsada && ahora <= vencePrimera) {
    return { activa: true, etapa: 'primera', minimo: RACHA.minPrimera, vence: vencePrimera,
      dias: Math.max(0, Math.ceil((vencePrimera - ahora) / DIA)), total: RACHA.diasPrimera };
  }
  if (ahora <= venceMantener) {
    return { activa: true, etapa: 'mantener', minimo: RACHA.minMantener, vence: venceMantener,
      dias: Math.max(0, Math.ceil((venceMantener - ahora) / DIA)), total: RACHA.diasMantener };
  }
  return { activa: false, vencida: true, vencio: venceMantener };
}

/**
 * Se llama cuando el cliente envía un pedido por WhatsApp.
 * Devuelve la racha nueva (o la misma si el pedido no cuenta para la racha).
 */
export function registrarEnvio(r, unidades, items, ahora = Date.now()) {
  const pedido = items.map(({ id, qty }) => ({ id, qty }));
  if (unidades >= UMBRAL_MAYOREO) return { inicio: ahora, ultima: ahora, primeraUsada: false, pedido };
  const e = estadoRacha(r, ahora);
  if (e.activa && unidades >= e.minimo) {
    return { ...r, ultima: ahora, primeraUsada: r.primeraUsada || e.etapa === 'primera', pedido };
  }
  return r;
}

// Fecha corta para mensajes: 26/10/2026
export function fechaCorta(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
// Para el enlace de verificación: 20261026
export function fechaEnlace(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
