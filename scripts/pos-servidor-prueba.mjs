// Servidor de prueba del punto de venta: ejecuta el script real (PuntoDeVenta.gs) sobre una hoja simulada.
// Uso: node scripts/pos-servidor-prueba.mjs [puerto]   (lo usan las pruebas de navegador scripts/test-pos.py)
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { Hoja, Libro, ctx, props, gas } from './pos-hoja-simulada.mjs';

const PUERTO = Number(process.argv[2] || 8791);
export const CLAVE = 'clave-de-prueba-del-punto-de-venta-0123456789';
const FIX = JSON.parse(readFileSync(new URL('./fixtures/productos-web.json', import.meta.url), 'utf8'));

// Inventario con los perfumes del catálogo de prueba (SKU de mentira: "SKU-H01"...)
function libroDePrueba(conHistorial = false) {
  const L = new Libro();
  const inv = L.hojas['Inventario'] = new Hoja('Inventario', 303, 35);
  FIX.productos.forEach((p, i) => {
    const r = 4 + i;
    const stock = Number.isInteger(p.existencias) ? p.existencias : p.estado === 'disponible' ? 8 : 0;
    const fila = { 1: `SKU-${p.id}`, 2: p.marca.toUpperCase(), 3: p.nombre.toUpperCase(), 4: (p.presentacion || '100 ml').replace(/\s/g, '').toUpperCase(),
      5: (p.notas || [])[0] || '', 6: p.catalogo === 'damas' ? 'Mujer' : 'Hombre', 11: Math.round(p.precios.detalle.cs * 0.6), 12: p.precios.detalle.cs,
      18: stock, 20: stock <= 0 ? 'Agotado' : stock <= 3 ? 'Bajo stock' : 'Disponible', 34: p.precios.mayor.cs, 35: (FIX.productos.length - i) % 5 };
    fila[23] = `${fila[2]} ${fila[3]} - ${fila[4]} (${fila[1]})`;
    for (const [c, v] of Object.entries(fila)) inv.poner(r, +c, v);
  });
  const ven = L.hojas['Ventas'] = new Hoja('Ventas', 1003, 22);
  ven.fmt['4,1'] = 'd/m/yyyy';
  for (let r = 4; r <= 1003; r++) ven.f[`${r},8`] = '=precio';
  // venta de otro día
  [44000, 1, 'MARÍA LÓPEZ', '', 'Jinotega', inv.celda(4, 23), 2, 1460, '', 2920, 'Efectivo', 'Pagado'].forEach((x, j) => ven.poner(4, j + 1, x));
  ven.alEscribir = (r, n) => { for (let i = r; i < r + n; i++) { const g = ven.celda(i, 7), h = ven.celda(i, 8), d = ven.celda(i, 9) || 0; if (g !== '' && h !== '') { ven.poner(i, 10, g * h - d); ven.poner(i, 14, Math.round((g * h - d) * 0.35)); } } };
  if (conHistorial) historialDePrueba(ven, inv);
  const cli = L.hojas['Clientes'] = new Hoja('Clientes', 303, 13);
  [['MARÍA LÓPEZ', '8000-1111', 'Jinotega', '', '', 3, 9800, '', 'MAYORISTA'], ['Juan Pérez', '8000-2222', 'Estelí', '', '', 1, 1490], ...(conHistorial ? [['Carla Ruiz', '8000-3333', 'Estelí', '', '', 8, 11680]] : [])].forEach((f, i) => f.forEach((x, j) => cli.poner(4 + i, j + 1, x)));
  const conf = L.hojas['Configuración'] = new Hoja('Configuración', 20, 10);
  [0, 36.8, 'C$', 50000, 15000, 3, 6].forEach((x, i) => conf.poner(4 + i, 2, x));
  ['Estelí', 'Managua', 'León', 'Matagalpa', 'Jinotega'].forEach((x, i) => conf.poner(4 + i, 5, x));
  ['Publicidad', 'Envíos', 'Transporte', 'Empaques', 'Otros'].forEach((x, i) => conf.poner(4 + i, 10, x));
  L.hojas['Ajustes'] = new Hoja('Ajustes', 503, 13); L.hojas['Ajustes'].fmt['4,1'] = 'd/m/yyyy';
  L.hojas['Gastos'] = new Hoja('Gastos', 503, 11); L.hojas['Gastos'].fmt['4,1'] = 'd/m/yyyy';
  return L;
}

// Unos dos meses de ventas de mentira (relativas a hoy), para probar tarjeta, racha, reposición y reportes.
// Clientes ficticios: María (9 sellos), Carla (10: premio listo), Juan (compró 6 hace 3 días: racha activa).
function historialDePrueba(ven, inv) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const hoy = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day) - Date.UTC(1899, 11, 30)) / 864e5);
  const fila = id => 4 + FIX.productos.findIndex(x => x.id === id);
  const prod = id => ({ ref: inv.celda(fila(id), 23), precio: inv.celda(fila(id), 12), mayor: inv.celda(fila(id), 34), costo: inv.celda(fila(id), 11) });
  let r = 5, num = 2, semilla = 7;
  const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
  const venta = (k, cliente, lineas, mayor = false) => {
    const tr = azar() < 0.35, banco = tr ? ['BAC', 'Banpro', 'Lafise'][Math.floor(azar() * 3)] : '';
    for (const [id, cant] of lineas) {
      const x = prod(id); const precio = mayor ? x.mayor : x.precio; const total = cant * precio;
      [hoy - k, num, cliente, '', 'Estelí', x.ref, cant, precio, '', total, tr ? 'Transferencia bancaria' : 'Efectivo', 'Pagado'].forEach((v, j) => ven.poner(r, j + 1, v));
      ven.poner(r, 14, total - cant * x.costo); ven.poner(r, 22, banco);
      r++;
    }
    num++;
  };
  for (const k of [50, 41, 33, 24, 15, 9]) venta(k, 'MARÍA LÓPEZ', [['H03', 1]]);
  for (const k of [58, 52, 45, 38, 30, 22, 14, 6]) venta(k, 'Carla Ruiz', [['D01', 1]]);
  venta(3, 'Juan Pérez', [['H05', 3], ['H10', 3]], true);
  // ritmo de ventas de mostrador en los últimos 30 días (para reposición) y algo más viejo
  const ritmo = { H05: 14, H10: 10, H11: 8, H17: 3, H01: 5, H09: 4, H13: 3, D05: 2 };
  for (const [id, n] of Object.entries(ritmo)) for (let i = 0; i < n; i++) venta(1 + Math.floor(azar() * 28), '', [[id, 1]]);
  for (let i = 0; i < 12; i++) venta(31 + Math.floor(azar() * 28), '', [[['H01', 'H03', 'H09', 'H05'][i % 4], 1]]);
  for (let i = 0; i < 3; i++) venta(0, '', [[['H01', 'H09', 'H03'][i], 1]]);
}

let libro = libroDePrueba();
props.POS_TOKEN = CLAVE;
let lento = 0, caido = false;

const volcar = n => { const h = libro.getSheetByName(n); return h ? h.v.slice(0, Math.max(h.getLastRow(), 3)) : null; };

http.createServer((req, res) => {
  const cab = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'GET') {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/reset') { libro = libroDePrueba(u.searchParams.get('historial') === '1'); for (const k in props) if (k !== 'POS_TOKEN') delete props[k]; props.POS_TOKEN = CLAVE; lento = 0; caido = false; }
    if (u.pathname === '/caido') caido = u.searchParams.get('v') === '1';
    if (u.pathname === '/lento') lento = Number(u.searchParams.get('ms') || 0);
    if (u.pathname === '/hoja') { res.writeHead(200, cab); return res.end(JSON.stringify(volcar(u.searchParams.get('n')))); }
    res.writeHead(200, cab); return res.end(JSON.stringify({ ok: true }));
  }
  let cuerpo = '';
  req.on('data', d => { cuerpo += d; });
  req.on('end', () => setTimeout(() => {
    if (caido) { req.socket.destroy(); return; }
    gas._libro = libro;
    const r = ctx.doPost({ postData: { contents: cuerpo } });
    res.writeHead(200, cab); res.end(r.texto);
  }, lento));
}).listen(PUERTO, '127.0.0.1', () => console.log(`Hoja simulada en http://127.0.0.1:${PUERTO}`));
