// Mapa de aromas: ubica cada perfume según las notas que declara la hoja.
// Eje horizontal: fresco ← → cálido. Eje vertical: suave y de día (abajo) ↔ intenso y de noche (arriba).
// Es una ubicación aproximada y se dice así en la página: no inventa nada, solo cuenta notas.
import { GRUPOS } from './recomendar.js';

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const FAMILIAS = [
  { id: 'fresco', txt: 'Frescos', color: '#7fd6ff' },
  { id: 'floral', txt: 'Florales', color: '#d7a6ff' },
  { id: 'dulce', txt: 'Dulces', color: '#ff9db1' },
  { id: 'calido', txt: 'Cálidos', color: '#f2b46a' },
];

const cuenta = (notasN, g) => notasN.filter(n => (GRUPOS[g] || []).includes(n)).length;

// Desplazamiento pequeño y siempre igual para cada código (para que no queden encimados al empezar)
function semilla(id) {
  let h = 2166136261;
  for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

const MARGEN = 0.08;
const limitar = v => Math.min(1 - MARGEN, Math.max(MARGEN, v));

/**
 * @returns {Array<{producto, x:number, y:number, familia:string, xBase:number, yBase:number}>}
 *          x e y entre 0 y 1 (0,0 = arriba a la izquierda). Solo perfumes con notas.
 */
export function ubicar(productos, { distancia = 0.105, vueltas = 160 } = {}) {
  const puntos = productos.filter(p => p.notas && p.notas.length).map(p => {
    const nn = p.notas.map(norm);
    const c = Object.fromEntries(['fresco', 'dulce', 'calido', 'floral', 'dia', 'noche', 'suave', 'notar'].map(g => [g, cuenta(nn, g)]));
    const tx = c.fresco + c.floral * 0.5 + c.dulce * 0.6 + c.calido;
    const xr = tx ? (c.calido + c.dulce * 0.35 - c.fresco - c.floral * 0.35) / tx : 0;
    const ty = c.noche + c.notar + c.dia + c.suave;
    const yr = ty ? (c.noche + c.notar - c.dia - c.suave) / ty : 0;
    const s = semilla(p.id);
    const familia = FAMILIAS.map(f => ({ id: f.id, n: c[f.id] }))
      .sort((a, b) => b.n - a.n || FAMILIAS.findIndex(f => f.id === a.id) - FAMILIAS.findIndex(f => f.id === b.id))[0];
    const xBase = limitar(0.5 + 0.34 * xr + (s - 0.5) * 0.06);
    const yBase = limitar(0.5 - 0.34 * yr + (semilla(p.id + '*') - 0.5) * 0.06);
    return { producto: p, x: xBase, y: yBase, xBase, yBase, familia: familia.n ? familia.id : (xr < 0 ? 'fresco' : 'calido') };
  });
  // Separar los que quedan muy juntos (empujándose como imanes) sin alejarlos demasiado de su lugar
  for (let v = 0; v < vueltas; v++) {
    let movido = false;
    for (let i = 0; i < puntos.length; i++) for (let j = i + 1; j < puntos.length; j++) {
      const a = puntos[i], b = puntos[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= distancia) continue;
      if (d < 1e-6) { dx = semilla(a.producto.id + b.producto.id) - 0.5; dy = 0.5 - semilla(b.producto.id); d = Math.hypot(dx, dy) || 1; }
      const empuje = (distancia - d) / 2;
      const ux = dx / d, uy = dy / d;
      a.x = limitar(a.x - ux * empuje); a.y = limitar(a.y - uy * empuje);
      b.x = limitar(b.x + ux * empuje); b.y = limitar(b.y + uy * empuje);
      movido = true;
    }
    // un poco de regreso a su lugar original, para que el mapa siga diciendo la verdad
    for (const p of puntos) { p.x = limitar(p.x + (p.xBase - p.x) * 0.02); p.y = limitar(p.y + (p.yBase - p.y) * 0.02); }
    if (!movido) break;
  }
  return puntos;
}

// Los n perfumes más cercanos a un punto del mapa
export function cercanos(puntos, x, y, n = 3) {
  return puntos.map(p => ({ ...p, d: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.d - b.d).slice(0, n);
}

// Notas que comparten dos perfumes (tal como están escritas en el primero)
export function notasComunes(a, b) {
  const nb = new Set(b.notas.map(norm));
  return a.notas.filter(n => nb.has(norm(n)));
}

// Centro de cada familia (para dibujar su nebulosa donde de verdad están sus perfumes)
export function centros(puntos) {
  return FAMILIAS.map(f => {
    const ps = puntos.filter(p => p.familia === f.id);
    if (!ps.length) return null;
    return { ...f, x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length, n: ps.length };
  }).filter(Boolean);
}

// Dónde empieza la luna según las respuestas de "Encuentra tu perfume"
export function puntoDeQuiz(r) {
  if (!r || !r.aroma) return null;
  const x = { fresco: 0.2, floral: 0.38, dulce: 0.62, calido: 0.8 }[r.aroma] ?? 0.5;
  let y = 0.5;
  if (r.momento === 'noche') y -= 0.18; else if (r.momento === 'dia') y += 0.18;
  if (r.fuerza === 'notar') y -= 0.12; else if (r.fuerza === 'suave') y += 0.12;
  return { x: limitar(x), y: limitar(y) };
}
