// Hoja de cálculo simulada en memoria y servicios de Google falsos, para probar scripts/pos/PuntoDeVenta.gs sin Google.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// ---------------- hoja simulada ----------------
export class Hoja {
  constructor(nombre, filas = 1003, cols = 26) {
    this.nombre = nombre; this.v = Array.from({ length: filas }, () => Array(cols).fill('')); this.f = {}; this.fmt = {};
    this.alEscribir = null;
  }
  celda(r, c) { while (this.v.length < r) this.v.push(Array(this.v[0].length).fill('')); while (this.v[r - 1].length < c) this.v[r - 1].push(''); return this.v[r - 1][c - 1]; }
  poner(r, c, x) { this.celda(r, c); this.v[r - 1][c - 1] = x; }
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') { const m = /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(r); const col = s => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0); r = +(m[2] || 4); c = col(m[1]); nr = 1; nc = m[3] ? col(m[3]) - c + 1 : 1; }
    const h = this;
    const rango = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => h.celda(r + i, c + j))),
      setValues: vals => { assert.equal(vals.length, nr, 'filas'); vals.forEach((f, i) => { assert.equal(f.length, nc, 'columnas'); f.forEach((x, j) => h.poner(r + i, c + j, x)); }); h.alEscribir?.(r, nr); return rango; },
      getValue: () => h.celda(r, c), setValue: x => { h.poner(r, c, x); return rango; },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { h.poner(r + i, c + j, ''); delete h.f[`${r + i},${c + j}`]; } return rango; },
      getNumberFormat: () => h.fmt[`${r},${c}`] || 'General', setNumberFormat: x => { for (let i = 0; i < nr; i++) h.fmt[`${r + i},${c}`] = x; return rango; },
      getFormulaR1C1: () => h.f[`${r},${c}`] || '', getFormula: () => h.f[`${r},${c}`] || '', setFormulaR1C1: x => { h.f[`${r},${c}`] = x; h.poner(r, c, ''); return rango; },
      setBackground: () => rango, setFontColor: () => rango, setFontWeight: () => rango, setFontSize: () => rango, setFontStyle: () => rango, setWrap: () => rango,
    };
    return rango;
  }
  getLastRow() { for (let i = this.v.length - 1; i >= 0; i--) if (this.v[i].some(x => x !== '')) return i + 1; return 0; }
  setFrozenRows() {} setColumnWidth() {}
}
export class Libro {
  constructor() { this.hojas = {}; }
  getSheetByName(n) { return this.hojas[n] || null; }
  insertSheet(n) { return (this.hojas[n] = new Hoja(n, 3, 10)); }
  getSpreadsheetTimeZone() { return 'America/Los_Angeles'; }
  getId() { return 'copia-de-prueba'; }
  getName() { return 'MNScents PRUEBA POS'; }
}

export function libroBase() {
  const L = new Libro();
  const inv = L.hojas['Inventario'] = new Hoja('Inventario', 303, 35);
  // SKU, marca, nombre, pres, familia, género ... K costo, L precio, R stock, T estado, W ref, AH mayor, AI pedidos
  const prods = [
    ['111', 'ARMAF', 'MANDARIN SKY', '100ML', 'Cítrica', 'Hombre', 800, 1460, 10, 'Disponible', 985],
    ['222', 'AFNAN', '9PM', '100ML', 'Dulce', 'Hombre', 700, 1490, 2, 'Bajo stock', 975],
    ['333', 'LATTAFA', 'YARA', '100ML', 'Dulce', 'Mujer', 500, 1390, 0, 'Agotado', 905],
  ];
  prods.forEach((p, i) => {
    const r = 4 + i;
    [p[0], p[1], p[2], p[3], p[4], p[5]].forEach((x, j) => inv.poner(r, j + 1, x));
    inv.poner(r, 11, p[6]); inv.poner(r, 12, p[7]); inv.poner(r, 18, p[8]); inv.poner(r, 20, p[9]);
    inv.poner(r, 23, `${p[1]} ${p[2]} - ${p[3]} (${p[0]})`); inv.poner(r, 34, p[10]); inv.poner(r, 35, 1);
  });
  const ven = L.hojas['Ventas'] = new Hoja('Ventas', 1003, 22);
  ven.poner(3, 21, 'Registrada (no tocar)');
  ven.fmt['4,1'] = 'd/m/yyyy';
  for (let r = 4; r <= 1003; r++) ven.f[`${r},8`] = '=IF(RC6="","",precio)';
  // una venta vieja (de otro día) en la fila 4
  [[45000, 7, 'ANA', '', 'Estelí', 'ARMAF MANDARIN SKY - 100ML (111)', 1, 1460, '', 1460, 'Efectivo', 'Pagado']].forEach((f, i) => f.forEach((x, j) => ven.poner(4 + i, j + 1, x)));
  ven.alEscribir = (r, n) => { for (let i = r; i < r + n; i++) { const g = ven.celda(i, 7), h = ven.celda(i, 8), d = ven.celda(i, 9) || 0; if (g !== '' && h !== '') { ven.poner(i, 10, g * h - d); ven.poner(i, 14, g * h - d - g * 500); } } };
  const cli = L.hojas['Clientes'] = new Hoja('Clientes', 303, 13);
  cli.poner(4, 1, 'ANA'); cli.poner(4, 2, '8888-1111'); cli.poner(4, 3, 'Estelí');
  const conf = L.hojas['Configuración'] = new Hoja('Configuración', 20, 10);
  [[0], [36.8], ['C$'], [50000], [15000], [3], [6]].forEach((x, i) => conf.poner(4 + i, 2, x[0]));
  ['Estelí', 'Managua', 'León'].forEach((x, i) => conf.poner(4 + i, 5, x));
  ['Publicidad', 'Envíos', 'Empaques'].forEach((x, i) => conf.poner(4 + i, 10, x));
  const aj = L.hojas['Ajustes'] = new Hoja('Ajustes', 503, 13); aj.fmt['4,1'] = 'd/m/yyyy';
  const g = L.hojas['Gastos'] = new Hoja('Gastos', 503, 11); g.fmt['4,1'] = 'd/m/yyyy';
  return L;
}

// ---------------- servicios de Google simulados ----------------
export const props = {};
export const cacheMem = {};
export const gas = {
  SpreadsheetApp: { flush() {}, getActiveSpreadsheet: () => gas._libro, getUi() { throw new Error('sin UI'); } },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: k => cacheMem[k] ?? null, put: (k, v) => { cacheMem[k] = v; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ texto: t, setMimeType() { return this; } }) },
  Utilities: {
    formatDate(d, zona, patron) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
      return patron.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour === '24' ? '00' : p.hour).replace('mm', p.minute);
    },
    getUuid: () => crypto.randomUUID(), base64EncodeWebSafe: s => Buffer.from(s).toString('base64url'),
  },
  Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
  Logger: { log() {} },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/x/exec' }) },
};
export const ctx = vm.createContext({ ...gas, Math, Date, JSON, String, Number, Array, Object, isFinite, console });
vm.runInContext(await readFile(new URL('./pos/PuntoDeVenta.gs', import.meta.url), 'utf8'), ctx);

