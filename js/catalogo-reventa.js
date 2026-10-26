// Catálogo de reventa: imagen para historias / estados de WhatsApp con los perfumes, precios y teléfono
// del revendedor. Se dibuja en su propio teléfono (canvas): no se sube nada a ningún servidor.
import { cargarImagen, lineas, espaciado, redondeado } from './tarjeta-perfil.js';
import { fmtCS } from './precios.js';

const W = 1080, H = 1920;
export const TEMAS = {
  noche: { fondo: ['#100819', '#1d1031', '#2d1a4c'], tinta: '#f6f0ff', tinta2: '#d5c8ec', tinta3: '#a998c7',
    tarjeta: 'rgba(255,255,255,0.06)', borde: 'rgba(196,161,255,0.28)', acento: '#c4a1ff', precio: '#f2d38a',
    luz: 'rgba(246,240,255,0.22)', estrellas: true },
  claro: { fondo: ['#fbf7ff', '#f2eafc', '#e7dbf8'], tinta: '#1d1230', tinta2: '#4a3a66', tinta3: '#6f5f8c',
    tarjeta: 'rgba(255,255,255,0.78)', borde: 'rgba(106,63,192,0.22)', acento: '#6a3fc0', precio: '#6a3fc0',
    luz: 'rgba(196,161,255,0.30)', estrellas: false },
};

// Texto limpio y corto (lo escribe el cliente)
export const limpiar = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const limpiarTelefono = s => String(s ?? '').replace(/[^\d+\-\s()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 22);

// Columnas y filas según cuántos perfumes eligió (1 a 6)
export function rejilla(n) {
  const k = Math.max(1, Math.min(6, n | 0));
  const cols = k === 1 ? 1 : 2;
  return { cols, filas: Math.ceil(k / cols) };
}

function ajustar(ctx, texto, ancho, tamMax, tamMin, peso, familia) {
  let t = tamMax;
  ctx.font = `${peso} ${t}px ${familia}`;
  while (t > tamMin && ctx.measureText(texto).width > ancho) { t -= 2; ctx.font = `${peso} ${t}px ${familia}`; }
  return t;
}

/**
 * @param {{titulo:string, negocio:string, telefono:string, logo:HTMLImageElement|null,
 *          items:Array<{producto:object, precio:number}>, tema:'noche'|'claro', fotos?:string}} o
 * @returns {Promise<Blob>} PNG 1080×1920
 */
export async function imagenCatalogo({ titulo, negocio, telefono, logo = null, items, tema = 'noche', fotos = 'img/productos/' }) {
  const T = TEMAS[tema] || TEMAS.noche;
  try {
    await Promise.all([document.fonts.load('700 80px Unbounded'), document.fonts.load('400 40px Onest'), document.fonts.load('700 40px Onest')]);
  } catch {}
  const lista = items.slice(0, 6);
  const imgs = await Promise.all(lista.map(it => (it.producto.foto ? cargarImagen(fotos + it.producto.foto).catch(() => null) : null)));

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // fondo
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, T.fondo[0]); g.addColorStop(0.55, T.fondo[1]); g.addColorStop(1, T.fondo[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (T.estrellas) {
    let s = 11;
    const azar = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = 0.18 + azar() * 0.4; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(azar() * W, azar() * 420, 0.8 + azar() * 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const halo = ctx.createRadialGradient(W - 140, 120, 10, W - 140, 120, 420);
  halo.addColorStop(0, T.luz); halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, W, 600);

  // cabecera: logo (opcional) + nombre del negocio
  const nombre = limpiar(negocio, 40) || 'Mi tienda';
  let y = 150;
  ctx.textBaseline = 'middle';
  if (logo) {
    const r = 74, cx = 80 + r;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.clip();
    const k = Math.max((r * 2) / logo.naturalWidth, (r * 2) / logo.naturalHeight);
    const w = logo.naturalWidth * k, h = logo.naturalHeight * k;
    ctx.drawImage(logo, cx - w / 2, y - h / 2, w, h);
    ctx.restore();
    ctx.strokeStyle = T.borde; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = T.tinta; espaciado(ctx, 0);
    ajustar(ctx, nombre, W - (cx + r + 40) - 70, 56, 34, 700, 'Onest');
    ctx.fillText(nombre, cx + r + 36, y);
  } else {
    ctx.textAlign = 'center'; ctx.fillStyle = T.tinta; espaciado(ctx, 2);
    ajustar(ctx, nombre.toUpperCase(), W - 160, 60, 34, 700, 'Unbounded');
    ctx.fillText(nombre.toUpperCase(), W / 2, y);
    ctx.textAlign = 'left';
  }

  // título
  espaciado(ctx, -1);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = T.tinta;
  const tit = limpiar(titulo, 48) || 'Perfumes disponibles';
  const { cols, filas } = rejilla(lista.length);
  const compacto = filas >= 3;                     // 5 o 6 perfumes: tarjetas horizontales
  let tam = compacto ? 62 : 76;
  ctx.font = `700 ${tam}px Unbounded`;
  let lt = lineas(ctx, tit, W - 160);
  if (lt.length > 2) { tam -= 14; ctx.font = `700 ${tam}px Unbounded`; lt = lineas(ctx, tit, W - 160).slice(0, 2); }
  y = (compacto ? 270 : 300) + tam;
  for (const l of lt) { ctx.fillText(l, 80, y); y += tam * 1.12; }
  espaciado(ctx, 0);

  // rejilla de perfumes
  const top = Math.max(y + 16, 400), bottom = H - 270;
  const gap = compacto ? 22 : 28, x0 = 60, ancho = W - 120;
  const cw = (ancho - gap * (cols - 1)) / cols;
  const ch = Math.min((bottom - top - gap * (filas - 1)) / filas, cols === 1 ? 1100 : 760);
  const y0 = top + Math.max(0, (bottom - top - (filas * ch + gap * (filas - 1))) / 2);   // la rejilla va centrada en alto
  const tn = compacto ? 34 : Math.round(Math.min(46, Math.max(30, cw / 12)));   // tamaño del nombre

  // nombre (hasta 3 líneas), marca y precio en una columna; devuelve dónde terminó
  const texto = (p, precio, tx, ty, tw, maxLineas) => {
    ctx.fillStyle = T.tinta; ctx.font = `700 ${tn}px Onest`;
    for (const l of lineas(ctx, p.nombre, tw).slice(0, maxLineas)) { ty += tn * 1.08; ctx.fillText(l, tx, ty); }
    if (p.marca) { ctx.fillStyle = T.tinta3; ctx.font = `400 ${Math.round(tn * 0.72)}px Onest`; ty += tn * 0.95; ctx.fillText(p.marca, tx, ty); }
    ctx.fillStyle = T.precio;
    const tp = ajustar(ctx, fmtCS(precio), tw, Math.round(tn * 1.3), 26, 700, 'Onest');
    ty += tp * 1.25; ctx.fillText(fmtCS(precio), tx, ty);
    return ty;
  };
  const altoTexto = (p, tw, maxLineas) => {
    ctx.font = `700 ${tn}px Onest`;
    const n = lineas(ctx, p.nombre, tw).slice(0, maxLineas).length;
    return n * tn * 1.08 + (p.marca ? tn * 0.95 : 0) + tn * 1.3 * 1.25;
  };
  const foto = (im, cx, base, maxW, maxH) => {
    const r = Math.min(maxW, maxH) * 0.62;
    const luz = ctx.createRadialGradient(cx, base - maxH / 2, 10, cx, base - maxH / 2, r);
    luz.addColorStop(0, T.luz); luz.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = luz; ctx.beginPath(); ctx.arc(cx, base - maxH / 2, r, 0, Math.PI * 2); ctx.fill();
    if (!im) return;
    const k = Math.min(maxW / im.naturalWidth, maxH / im.naturalHeight);
    const w = im.naturalWidth * k, h = im.naturalHeight * k;
    ctx.drawImage(im, cx - w / 2, base - h - (maxH - h) / 2, w, h);
  };

  lista.forEach((it, i) => {
    const c = i % cols, f = Math.floor(i / cols);
    // si la última fila tiene uno solo, va centrado
    const enFila = Math.min(cols, lista.length - f * cols);
    const offset = enFila < cols ? (cw + gap) / 2 : 0;
    const x = x0 + c * (cw + gap) + offset, yy = y0 + f * (ch + gap);
    ctx.fillStyle = T.tarjeta; redondeado(ctx, x, yy, cw, ch, 30); ctx.fill();
    ctx.strokeStyle = T.borde; ctx.lineWidth = 2; redondeado(ctx, x, yy, cw, ch, 30); ctx.stroke();
    const p = it.producto;
    if (compacto) {
      // foto a la izquierda, texto a la derecha (centrado en alto)
      const fw = Math.min(ch - 36, cw * 0.36);
      foto(imgs[i], x + 18 + fw / 2, yy + ch - 18, fw, ch - 36);
      const tx = x + fw + 34, tw = cw - fw - 54;
      const alto = altoTexto(p, tw, 3);
      texto(p, it.precio, tx, yy + (ch - alto) / 2 - tn * 0.15, tw, 3);
    } else {
      const tw = cw - 60;
      const alto = altoTexto(p, tw, 2);
      const areaFoto = ch - alto - 70;
      foto(imgs[i], x + cw / 2, yy + 24 + areaFoto, cw - 60, areaFoto);
      texto(p, it.precio, x + 30, yy + ch - alto - 30, tw, 2);
    }
  });

  // pie: teléfono
  const tel = limpiarTelefono(telefono);
  ctx.textAlign = 'center';
  ctx.fillStyle = T.tinta2; ctx.font = '400 40px Onest';
  ctx.fillText('Pedidos por WhatsApp', W / 2, H - 175);
  ctx.fillStyle = T.acento;
  ajustar(ctx, tel || '—', W - 160, 86, 48, 700, 'Onest');
  ctx.fillText(tel || '—', W / 2, H - 80);
  ctx.textAlign = 'left';

  return new Promise((ok, mal) => cv.toBlob(b => (b ? ok(b) : mal(new Error('sin imagen'))), 'image/png'));
}
