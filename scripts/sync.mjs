#!/usr/bin/env node
// MN Scents — sincroniza la hoja "Catálogo MN Scents" con data/productos.json
//
// Uso:
//   SHEET_CSV_URL="https://docs.google.com/.../pub?output=csv" node scripts/sync.mjs
//   node scripts/sync.mjs data/catalogo.csv        (desde un archivo local)
//
// Si encuentra un error en los datos, NO escribe nada y termina con código 1:
// la web sigue mostrando la última versión correcta.
// Sin dependencias: solo Node 18+.

import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'data', 'productos.json');
const CARPETA_FOTOS = path.join(RAIZ, 'img', 'productos');

// ---------- Lectura ----------
async function obtenerCSV() {
  const arg = process.argv[2];
  if (arg) return readFile(path.resolve(arg), 'utf8');
  const url = process.env.SHEET_CSV_URL;
  if (!url) throw new Error('Falta SHEET_CSV_URL (enlace CSV publicado de la hoja) o un archivo local.');
  const r = await fetch(url, { redirect: 'follow', headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(`Google Sheets respondió ${r.status}. ¿Sigue publicada la hoja?`);
  const texto = await r.text();
  if (/<html/i.test(texto.slice(0, 200))) throw new Error('El enlace devolvió una página web, no un CSV. Revisa que sea el enlace "Publicar en la web" en formato CSV.');
  return texto;
}

// CSV estándar (comillas, comas y saltos de línea dentro de comillas)
export function parsearCSV(texto) {
  texto = texto.replace(/^﻿/, '');
  const filas = []; let fila = []; let campo = ''; let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(v => v.trim() !== ''));
}

// ---------- Normalización ----------
const sinAcentos = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = s => sinAcentos(String(s).trim().toLowerCase()).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// Acepta "1460", "1,460", "1.460", "40.60", "40,60", "C$ 1,460", "$52,40"
// (Google Sheets exporta los números según el idioma de la hoja).
export function numero(v) {
  let s = String(v).replace(/C\$|US\$|\$|USD|\s| /gi, '');
  if (s === '') return null;
  const tienePunto = s.includes('.'), tieneComa = s.includes(',');
  if (tienePunto && tieneComa) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(',', '.');
  } else if (tienePunto || tieneComa) {
    const sep = tienePunto ? '.' : ',';
    const miles = new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`);
    s = miles.test(s) ? s.split(sep).join('') : s.replace(',', '.');
  }
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
const numeroCordobas = numero, numeroDolares = numero;
function estado(v) {
  const k = clave(v);
  if (['disponible', 'en_stock', 'stock'].includes(k)) return 'disponible';
  if (['agotado', 'sold_out', 'soldout'].includes(k)) return 'agotado';
  if (['coming_soon', 'comingsoon', 'proximamente', 'pronto'].includes(k)) return 'coming_soon';
  return null;
}
function siNo(v) {
  const k = clave(v);
  if (k === '' || ['si', 's', 'yes', 'true', '1', 'x'].includes(k)) return true;
  if (['no', 'n', 'false', '0'].includes(k)) return false;
  return null;
}
const slug = s => sinAcentos(String(s).toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const COLUMNAS = ['id', 'catalogo', 'nombre', 'marca', 'presentacion', 'notas', 'descripcion',
  'precio_detalle_cs', 'precio_detalle_usd', 'precio_mayor_cs', 'precio_mayor_usd', 'estado', 'foto', 'mostrar', 'orden'];

export async function convertir(texto, { comprobarFotos = true } = {}) {
  const filas = parsearCSV(texto);
  if (filas.length < 2) throw new Error('La hoja está vacía o no tiene filas de productos.');
  const cab = filas[0].map(clave);
  const faltan = COLUMNAS.filter(c => !cab.includes(c));
  if (faltan.length) throw new Error(`Faltan columnas en la hoja: ${faltan.join(', ')}. No cambies los títulos de la fila 1.`);
  const col = Object.fromEntries(cab.map((c, i) => [c, i]));

  const errores = [], avisos = [], productos = [], ids = new Set();
  for (let r = 1; r < filas.length; r++) {
    const f = filas[r]; const g = c => (f[col[c]] ?? '').trim();
    const n = r + 1; // número de fila como en Google Sheets
    if (!g('nombre') && !g('id')) continue;
    const nombre = g('nombre');
    const pref = `Fila ${n} (${nombre || 'sin nombre'})`;

    const id = g('id') || slug(nombre);
    if (ids.has(id)) errores.push(`${pref}: el código "${id}" está repetido.`);
    ids.add(id);
    if (!nombre) errores.push(`${pref}: falta el nombre.`);

    const cat = clave(g('catalogo'));
    const catalogo = cat.startsWith('cab') || cat.startsWith('hom') ? 'caballeros'
      : cat.startsWith('dam') || cat.startsWith('muj') ? 'damas' : null;
    if (!catalogo) errores.push(`${pref}: catálogo "${g('catalogo')}" no válido. Usa Caballeros o Damas.`);

    const est = estado(g('estado'));
    if (!est) errores.push(`${pref}: estado "${g('estado')}" no válido. Usa Disponible, Agotado o Coming soon.`);

    const mostrar = siNo(g('mostrar'));
    if (mostrar === null) errores.push(`${pref}: en "mostrar" escribe Sí o No.`);

    const precios = {
      detalle: { cs: numeroCordobas(g('precio_detalle_cs')), usd: numeroDolares(g('precio_detalle_usd')) },
      mayor: { cs: numeroCordobas(g('precio_mayor_cs')), usd: numeroDolares(g('precio_mayor_usd')) },
    };
    for (const [tipo, p] of Object.entries(precios)) for (const [mon, v] of Object.entries(p)) {
      const etiqueta = `precio ${tipo} ${mon === 'cs' ? 'C$' : 'US$'}`;
      if (v === null) errores.push(`${pref}: falta el ${etiqueta}.`);
      else if (!Number.isFinite(v) || v <= 0) errores.push(`${pref}: el ${etiqueta} no es un número válido.`);
    }
    if (precios.mayor.cs > precios.detalle.cs || precios.mayor.usd > precios.detalle.usd)
      errores.push(`${pref}: el precio por mayor es más alto que el precio al detalle.`);
    // Aviso si C$ y US$ no guardan la misma proporción (posible error de escritura)
    for (const tipo of ['detalle', 'mayor']) {
      const { cs, usd } = precios[tipo];
      if (cs && usd) { const tc = cs / usd; if (tc < 34 || tc > 39.5) avisos.push(`${pref}: el precio ${tipo} en C$ y en US$ no parecen coincidir (C$${cs} / $${usd}). Revísalo.`); }
    }

    // Existencias (columna opcional): vacío = sin límite; 0 = se muestra como Agotado
    let existencias = null;
    if ('existencias' in col && g('existencias') !== '') {
      const n = numero(g('existencias'));
      if (!Number.isInteger(n) || n < 0) errores.push(`${pref}: en "existencias" escribe un número entero (0, 1, 2…) o déjalo vacío.`);
      else existencias = n;
    }
    const estadoFinal = existencias === 0 && est === 'disponible' ? 'agotado' : est;

    let foto = g('foto') || null;
    if (foto && comprobarFotos) {
      try { await access(path.join(CARPETA_FOTOS, foto)); }
      catch { avisos.push(`${pref}: no encontré la foto "${foto}" en img/productos. Se mostrará sin foto.`); foto = null; }
    }

    const orden = Number(g('orden')) || 999;
    if (mostrar !== false) productos.push({
      id, catalogo, nombre, marca: g('marca'), presentacion: g('presentacion'),
      notas: g('notas').split(/\s*[·•|\-]\s*/).filter(Boolean),
      descripcion: g('descripcion'), precios, estado: estadoFinal, existencias, foto, orden,
    });
  }
  productos.sort((a, b) => a.catalogo.localeCompare(b.catalogo) || a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  return { errores, avisos, productos };
}

// ---------- Programa ----------
async function main() {
  const { errores, avisos, productos } = await convertir(await obtenerCSV());
  avisos.forEach(a => console.warn('⚠️  ' + a));
  if (errores.length) {
    console.error('\n❌ No se publicó nada. Corrige estos errores en la hoja:\n');
    errores.forEach(e => console.error('   • ' + e));
    process.exit(1);
  }
  if (!productos.length) { console.error('❌ La hoja no tiene productos visibles. No se publicó nada.'); process.exit(1); }

  let anterior = null;
  try { anterior = JSON.parse(await readFile(SALIDA, 'utf8')); } catch {}
  if (anterior && JSON.stringify(anterior.productos) === JSON.stringify(productos)) {
    console.log(`✓ Sin cambios (${productos.length} productos).`); return;
  }
  const datos = { actualizado: new Date().toISOString(), productos };
  await writeFile(SALIDA, JSON.stringify(datos, null, 1) + '\n');
  console.log(`✓ Catálogo actualizado: ${productos.length} productos.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
}
