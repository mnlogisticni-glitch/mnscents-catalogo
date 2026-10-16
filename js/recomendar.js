// "Encuentra tu perfume": preguntas y recomendación a partir de las notas reales de la hoja.
// Nada se inventa: un perfume solo se recomienda si sus notas coinciden con lo que eligió el cliente.
import { esComprable } from './precios.js';

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Qué notas de la hoja cuentan para cada respuesta (sin tildes, en minúscula)
export const GRUPOS = {
  fresco: ['fresco', 'citrico', 'acuatico', 'verde'],
  dulce: ['dulce', 'frutal', 'afrutado', 'cremoso', 'adictivo'],
  calido: ['calido', 'amaderado', 'especiado', 'ambar', 'canela', 'cafe', 'misterioso'],
  floral: ['floral', 'femenino'],
  dia: ['fresco', 'citrico', 'acuatico', 'verde', 'floral', 'frutal'],
  noche: ['nocturno', 'dulce', 'calido', 'intenso', 'seductor', 'especiado', 'amaderado', 'ambar', 'sensual', 'misterioso', 'magnetico', 'atrevido'],
  suave: ['elegante', 'refinado', 'fresco', 'floral', 'cremoso', 'aromatico'],
  notar: ['intenso', 'seductor', 'atrevido', 'magnetico', 'nocturno', 'adictivo', 'sensual', 'misterioso', 'atractivo'],
};

export const PREGUNTAS = [
  { id: 'para', titulo: '¿Para quién es?', opciones: [
    { id: 'caballeros', t: 'Para él', s: 'Catálogo de caballeros' },
    { id: 'damas', t: 'Para ella', s: 'Catálogo de damas' },
  ] },
  { id: 'momento', titulo: '¿Cuándo lo vas a usar?', opciones: [
    { id: 'dia', t: 'De día', s: 'Trabajo, clases, días de calor' },
    { id: 'noche', t: 'De noche', s: 'Salidas, citas, eventos' },
    { id: 'todo', t: 'Para todo', s: 'Uno que sirva siempre' },
  ] },
  { id: 'aroma', titulo: '¿Qué tipo de aroma te gusta?', opciones: [
    { id: 'fresco', t: 'Fresco y limpio', s: 'Cítrico, acuático, verde' },
    { id: 'dulce', t: 'Dulce', s: 'Frutal, cremoso, goloso' },
    { id: 'calido', t: 'Cálido e intenso', s: 'Amaderado, especiado, ámbar' },
    { id: 'floral', t: 'Floral', s: 'Flores, femenino' },
  ] },
  { id: 'fuerza', titulo: '¿Cómo quieres que se sienta?', opciones: [
    { id: 'suave', t: 'Suave y elegante', s: 'Que huela rico de cerca' },
    { id: 'notar', t: 'Que se note', s: 'Que deje estela y lo comenten' },
  ] },
];

const PESOS = { aroma: 3, momento: 1.5, fuerza: 1 };
const disponible = esComprable;
const cuenta = (notasN, grupo) => notasN.filter(n => (GRUPOS[grupo] || []).includes(n)).length;

// Opciones de aroma que de verdad tienen perfumes en ese catálogo (no ofrecemos lo que no hay)
export function opcionesAroma(productos, cat) {
  const lista = productos.filter(p => p.catalogo === cat && p.estado !== 'agotado');
  return PREGUNTAS[2].opciones.filter(o => lista.some(p => cuenta(p.notas.map(norm), o.id) > 0));
}

function puntuar(p, r) {
  const notasN = p.notas.map(norm);
  const enAroma = cuenta(notasN, r.aroma);
  let puntos = PESOS.aroma * Math.min(enAroma, 2);
  if (r.momento && r.momento !== 'todo') puntos += PESOS.momento * Math.min(cuenta(notasN, r.momento), 2);
  if (r.fuerza) puntos += PESOS.fuerza * Math.min(cuenta(notasN, r.fuerza), 2);
  // notas que explican la recomendación (tal como están escritas en la hoja)
  const grupos = [r.aroma, r.momento !== 'todo' ? r.momento : null, r.fuerza].filter(Boolean);
  const razones = [];
  for (const g of grupos) for (const n of p.notas) {
    if ((GRUPOS[g] || []).includes(norm(n)) && !razones.includes(n)) razones.push(n);
  }
  return { producto: p, puntos, enAroma, razones: razones.slice(0, 3) };
}

// Devuelve { principales: [hasta 3 disponibles], pronto: perfume "Coming soon" que encaja o null }
export function recomendar(productos, r) {
  const candidatos = productos
    .filter(p => p.catalogo === r.para && p.estado !== 'agotado' && p.notas.length)
    .map(p => puntuar(p, r))
    .filter(x => x.puntos > 0);
  // primero los que coinciden con el aroma elegido; si ninguno, lo que más se acerque
  const conAroma = candidatos.filter(x => x.enAroma > 0);
  const base = conAroma.length ? conAroma : candidatos;
  const orden = (a, b) => (b.puntos - a.puntos)
    || ((b.producto.etiqueta === 'top') - (a.producto.etiqueta === 'top'))
    || (a.producto.orden - b.producto.orden);
  // solo coincidencias claras: al menos la mitad de puntos que la mejor
  const tope = Math.max(...base.map(x => x.puntos), 0);
  const claros = base.filter(x => x.puntos >= tope / 2);
  const disp = claros.filter(x => disponible(x.producto)).sort(orden);
  const principales = disp.slice(0, 3);
  const minimo = principales.length ? principales[principales.length - 1].puntos : 0;
  const pronto = claros.filter(x => x.producto.estado === 'coming_soon' && (principales.length < 3 || x.puntos >= minimo))
    .sort(orden)[0] || null;
  return { principales, pronto, exacto: conAroma.length > 0 };
}
