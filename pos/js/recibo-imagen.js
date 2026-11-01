// MN Scents — recibo de venta como imagen (PNG) con el logo y los colores de la marca.
// Se dibuja en un canvas: no necesita internet ni servicios externos.
import { fmtCS, fmtUSD, titulo } from './logica.js';

const C = {
  noche: '#160c25', noche2: '#2f1f52', tinta: '#1d1230', tinta2: '#5b4a78', tinta3: '#8a7aa6',
  papel: '#ffffff', papel2: '#f7f2fd', linea: '#e6dcf3', lila: '#6a3fc0', lilaClaro: '#c4a1ff',
  oro: '#c99a3c', oroClaro: '#f2d38a', verde: '#1f7a4d',
};
const NEGOCIO = {
  direccion: 'Gasolinera Esquipulas, 4 cuadras al este · Estelí, Nicaragua',
  contacto: 'WhatsApp 8473-5485 · mnscents.pages.dev',
  horario: 'Lun a Vie 9 AM – 7 PM · Sáb 9 AM – 3 PM',
};
const W = 1080, M = 72;                       // ancho y margen
const F = (peso, px, fam = 'Onest') => `${peso} ${px}px "${fam}", system-ui, sans-serif`;

let recursos = null;
async function cargar() {
  if (recursos) return recursos;
  const logo = new Image();
  logo.src = new URL('../../img/marca/logo.webp', import.meta.url).href;
  await Promise.all([
    logo.decode().catch(() => null),
    document.fonts?.load(F(700, 40, 'Unbounded')), document.fonts?.load(F(400, 30)), document.fonts?.load(F(500, 30)), document.fonts?.load(F(700, 30)),
  ].map(p => Promise.resolve(p).catch(() => null)));
  recursos = { logo: logo.complete && logo.naturalWidth ? logo : null };
  return recursos;
}

function partir(ctx, texto, ancho) {
  const palabras = String(texto).split(/\s+/); const out = []; let l = '';
  for (const w of palabras) { const t = l ? `${l} ${w}` : w; if (ctx.measureText(t).width > ancho && l) { out.push(l); l = w; } else l = t; }
  if (l) out.push(l);
  return out;
}
function redondo(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
const num = n => String(n ?? '').padStart(6, '0');

/**
 * d = { numero, fecha, hora, cliente:{nombre, telefono}, calc, metodo:'Efectivo'|'Transferencia', banco, recibido, vuelto, tipoCambio,
 *       tarjeta:{enTarjeta, sellos, premios, faltan}|null, racha:{activa, etapa, minimo, venceTexto}|null, ganados }
 * Devuelve un canvas.
 */
export async function dibujarRecibo(d) {
  const { logo } = await cargar();
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = 4000;
  const ctx = cv.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.papel; ctx.fillRect(0, 0, W, cv.height);

  // ---------- cabecera de la marca
  const altoCab = 300;
  const g = ctx.createLinearGradient(0, 0, W, altoCab);
  g.addColorStop(0, C.noche); g.addColorStop(1, C.noche2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, altoCab);
  // brillo suave detrás del logo
  const rg = ctx.createRadialGradient(M + 80, 140, 10, M + 80, 140, 200);
  rg.addColorStop(0, 'rgba(196,161,255,0.28)'); rg.addColorStop(1, 'rgba(196,161,255,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, 460, altoCab);
  if (logo) { const h = 150, w = (logo.naturalWidth / logo.naturalHeight) * h; ctx.drawImage(logo, M, 70, w, h); }
  const xt = M + 190;
  ctx.fillStyle = C.oroClaro; ctx.font = F(700, 54, 'Unbounded'); ctx.fillText('MN SCENTS', xt, 140);
  ctx.fillStyle = '#e9dcff'; ctx.font = F(400, 27); ctx.fillText('Perfumería árabe, de diseñador y nicho', xt, 185);
  ctx.fillStyle = C.lilaClaro; ctx.font = F(500, 24); ctx.fillText('Estelí · Nicaragua', xt, 225);
  ctx.fillStyle = C.oro; ctx.fillRect(0, altoCab, W, 6);

  // ---------- título y número
  let y = altoCab + 96;
  ctx.fillStyle = C.tinta; ctx.font = F(700, 34, 'Unbounded'); ctx.fillText('COMPROBANTE DE VENTA', M, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.lila; ctx.font = F(700, 34, 'Unbounded');
  ctx.fillText(d.numero ? `N.º ${num(d.numero)}` : 'N.º pendiente', W - M, y);
  ctx.textAlign = 'left';
  y += 48;
  ctx.fillStyle = C.tinta2; ctx.font = F(400, 27);
  ctx.fillText(`Fecha: ${d.fecha}${d.hora ? ` · ${d.hora}` : ''}`, M, y);

  // ---------- cliente
  if (d.cliente?.nombre) {
    y += 40;
    redondo(ctx, M, y, W - 2 * M, 96, 18); ctx.fillStyle = C.papel2; ctx.fill();
    ctx.fillStyle = C.tinta3; ctx.font = F(700, 20); ctx.fillText('CLIENTE', M + 28, y + 38);
    ctx.fillStyle = C.tinta; ctx.font = F(700, 30); ctx.fillText(d.cliente.nombre, M + 28, y + 76);
    if (d.cliente.telefono) { ctx.textAlign = 'right'; ctx.fillStyle = C.tinta2; ctx.font = F(400, 26); ctx.fillText(d.cliente.telefono, W - M - 28, y + 76); ctx.textAlign = 'left'; }
    y += 96;
  }

  // ---------- tabla de perfumes
  y += 58;
  const col = { cant: 640, precio: 820, imp: W - M };
  ctx.fillStyle = C.tinta3; ctx.font = F(700, 20);
  ctx.fillText('PRODUCTO', M, y);
  ctx.textAlign = 'center'; ctx.fillText('CANT.', col.cant, y);
  ctx.textAlign = 'right'; ctx.fillText('PRECIO', col.precio + 40, y); ctx.fillText('IMPORTE', col.imp, y); ctx.textAlign = 'left';
  y += 20; ctx.fillStyle = C.tinta; ctx.fillRect(M, y, W - 2 * M, 2);
  for (const l of d.calc.lineas) {
    y += 50;
    ctx.font = F(700, 29); ctx.fillStyle = C.tinta;
    const nombre = partir(ctx, titulo(l.producto.nombre), col.cant - M - 70);
    nombre.forEach((t, i) => { ctx.fillText(t, M, y + i * 36); });
    ctx.textAlign = 'center'; ctx.font = F(500, 29); ctx.fillText(String(l.cantidad), col.cant, y);
    ctx.textAlign = 'right';
    if (l.canje) { ctx.fillStyle = C.oro; ctx.font = F(700, 29); ctx.fillText('GRATIS', col.imp, y); }
    else { ctx.fillText(fmtCS(l.precio), col.precio + 40, y); ctx.font = F(700, 29); ctx.fillText(fmtCS(l.total), col.imp, y); }
    ctx.textAlign = 'left';
    y += (nombre.length - 1) * 36 + 34;
    ctx.font = F(400, 23); ctx.fillStyle = C.tinta2;
    const sub = [titulo(l.producto.marca), l.producto.pres].filter(Boolean).join(' · ');
    const etiqueta = l.canje ? 'Premio de la tarjeta de fidelidad' : l.mayorista ? 'Precio mayorista' : l.manual ? 'Precio especial' : '';
    ctx.fillText(sub, M, y);
    if (etiqueta) { ctx.fillStyle = l.canje ? C.oro : C.lila; ctx.font = F(700, 21); ctx.fillText(etiqueta.toUpperCase(), M + ctx.measureText(sub).width + 18 + (sub ? 0 : -18), y); }
    if (l.descuento > 0) { ctx.textAlign = 'right'; ctx.fillStyle = C.verde; ctx.font = F(500, 23); ctx.fillText(`Descuento −${fmtCS(l.descuento)}`, col.imp, y); ctx.textAlign = 'left'; }
    y += 26; ctx.fillStyle = C.linea; ctx.fillRect(M, y, W - 2 * M, 2);
  }

  // ---------- totales
  y += 52;
  // etiqueta alineada a la derecha, pegada a su monto (no se montan aunque la etiqueta sea larga)
  const filaTot = (txt, val, color = C.tinta2) => {
    ctx.textAlign = 'right'; ctx.fillStyle = color;
    ctx.font = F(500, 27); ctx.fillText(val, W - M, y);
    const ancho = Math.max(ctx.measureText(val).width, 150);
    ctx.font = F(400, 27); ctx.fillText(txt, W - M - ancho - 28, y);
    ctx.textAlign = 'left'; y += 44;
  };
  const c = d.calc;
  if (c.descuentos > 0) { filaTot('Subtotal', fmtCS(c.subtotal)); filaTot('Descuentos', `−${fmtCS(c.descuentos)}`, C.verde); }
  if (c.porMayor && c.ahorro > 0) filaTot('Ahorro por precio mayorista', fmtCS(c.ahorro), C.lila);
  y += 6;
  redondo(ctx, 540, y - 6, W - M - 540, 118, 22);
  const gt = ctx.createLinearGradient(540, 0, W - M, 0); gt.addColorStop(0, C.noche); gt.addColorStop(1, C.noche2);
  ctx.fillStyle = gt; ctx.fill();
  ctx.fillStyle = C.oroClaro; ctx.font = F(700, 22); ctx.fillText('TOTAL', 572, y + 44);
  if (d.tipoCambio && c.total > 0) { ctx.fillStyle = '#cdbfe4'; ctx.font = F(400, 22); ctx.fillText(`≈ ${fmtUSD(c.total / d.tipoCambio)}`, 572, y + 84); }
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffffff'; ctx.font = F(700, 46, 'Unbounded'); ctx.fillText(c.total > 0 ? fmtCS(c.total) : 'C$0', W - M - 30, y + 74); ctx.textAlign = 'left';
  // pago (a la izquierda del total)
  ctx.fillStyle = C.tinta3; ctx.font = F(700, 20); ctx.fillText('FORMA DE PAGO', M, y + 30);
  ctx.fillStyle = C.tinta; ctx.font = F(700, 28);
  const pago = c.total <= 0 ? 'Premio sin costo' : d.metodo === 'Efectivo' ? 'Efectivo' : `Transferencia ${d.banco || ''}`.trim();
  ctx.fillText(pago, M, y + 68);
  if (d.metodo === 'Efectivo' && Number(d.recibido) > 0 && d.vuelto != null) {
    ctx.fillStyle = C.tinta2; ctx.font = F(400, 24); ctx.fillText(`Recibido ${fmtCS(d.recibido)} · Vuelto ${fmtCS(d.vuelto)}`, M, y + 104);
  }
  y += 150;

  // ---------- tarjeta de fidelidad
  if (d.tarjeta && d.cliente?.nombre) {
    y += 20;
    const alto = 210;
    redondo(ctx, M, y, W - 2 * M, alto, 24);
    const gf = ctx.createLinearGradient(M, y, W - M, y + alto); gf.addColorStop(0, '#f4ecff'); gf.addColorStop(1, '#fbf3df');
    ctx.fillStyle = gf; ctx.fill(); ctx.strokeStyle = '#e3d2fb'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = C.lila; ctx.font = F(700, 22, 'Unbounded'); ctx.fillText('TARJETA DE FIDELIDAD', M + 32, y + 52);
    const t = d.tarjeta;
    ctx.textAlign = 'right'; ctx.fillStyle = C.tinta2; ctx.font = F(500, 24);
    ctx.fillText(d.ganados ? `+${d.ganados} ${d.ganados === 1 ? 'sello' : 'sellos'} con esta compra` : d.sinSello ? 'Precio especial: esta compra no suma sello' : '', W - M - 32, y + 52); ctx.textAlign = 'left';
    const r = 26, paso = (W - 2 * M - 64) / 10;
    for (let i = 0; i < 10; i++) {
      const cx = M + 32 + paso * i + paso / 2, cy = y + 112;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (i < t.enTarjeta) { ctx.fillStyle = C.oro; ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = F(700, 24); ctx.textAlign = 'center'; ctx.fillText('★', cx, cy + 9); ctx.textAlign = 'left'; }
      else { ctx.strokeStyle = '#cdb8ef'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]); if (i === 9) { ctx.fillStyle = '#b79be6'; ctx.font = F(700, 20); ctx.textAlign = 'center'; ctx.fillText('🎁', cx, cy + 8); ctx.textAlign = 'left'; } }
    }
    ctx.fillStyle = C.tinta; ctx.font = F(500, 25);
    const msg = t.premios > 0 ? '¡Tarjeta completa! En tu próxima visita llevas un Stallion 53 gratis.'
      : `Llevas ${t.enTarjeta} de 10 sellos · te ${t.faltan === 1 ? 'falta 1' : `faltan ${t.faltan}`} para tu perfume Stallion 53 gratis.`;
    partir(ctx, msg, W - 2 * M - 64).forEach((s, i) => ctx.fillText(s, M + 32, y + 180 + i * 30));
    y += alto + 10;
  }

  // ---------- racha mayorista
  if (d.racha?.activa) {
    y += 20;
    redondo(ctx, M, y, W - 2 * M, 104, 24); ctx.fillStyle = '#fbf3df'; ctx.fill(); ctx.strokeStyle = '#eddcb0'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#8a6416'; ctx.font = F(700, 22, 'Unbounded'); ctx.fillText('PRECIO MAYORISTA ACTIVO', M + 32, y + 44);
    ctx.fillStyle = C.tinta; ctx.font = F(500, 25);
    ctx.fillText(`Hasta el ${d.racha.venceTexto}: ${d.racha.etapa === 'primera' ? 'desde 1 perfume' : `comprando desde ${d.racha.minimo} perfumes`} a precio mayorista.`, M + 32, y + 82);
    y += 114;
  }

  // ---------- regalías al detalle
  if (d.regalias) {
    y += 40;
    ctx.fillStyle = C.tinta3; ctx.font = F(700, 20); ctx.fillText('TUS REGALÍAS POR COMPRARNOS', M, y);
    y += 40; ctx.fillStyle = C.tinta2; ctx.font = F(400, 25);
    ctx.fillText('Delivery gratis en Estelí · Bolsa personalizada · Stickers de nuestro logo', M, y);
  }

  // ---------- pie
  y += 70;
  ctx.fillStyle = C.oro; ctx.fillRect(W / 2 - 60, y, 120, 4);
  y += 70;
  ctx.textAlign = 'center';
  ctx.fillStyle = C.lila; ctx.font = F(700, 38, 'Unbounded'); ctx.fillText('¡Gracias por tu compra!', W / 2, y);
  y += 54; ctx.fillStyle = C.tinta2; ctx.font = F(400, 25);
  for (const t of [NEGOCIO.direccion, NEGOCIO.contacto, NEGOCIO.horario]) { ctx.fillText(t, W / 2, y); y += 38; }
  y += 14; ctx.fillStyle = C.tinta3; ctx.font = F(400, 20);
  ctx.fillText('Comprobante interno de venta · no es factura fiscal', W / 2, y);
  ctx.textAlign = 'left';
  y += 50;
  ctx.fillStyle = C.noche; ctx.fillRect(0, y, W, 14);
  y += 14;

  // recortar al alto usado
  const out = document.createElement('canvas');
  out.width = W; out.height = Math.ceil(y);
  out.getContext('2d').drawImage(cv, 0, 0);
  return out;
}

export const aBlob = cv => new Promise(ok => cv.toBlob(ok, 'image/png'));

// Comparte la imagen (WhatsApp en el teléfono) o la descarga (PC). Devuelve 'compartido' | 'descargado' | 'cancelado'.
export async function compartirRecibo(blob, nombre, texto) {
  const archivo = new File([blob], nombre, { type: 'image/png' });
  if (navigator.canShare?.({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo], title: 'Recibo MN Scents', text: texto }); return 'compartido'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelado'; }
  }
  descargar(blob, nombre);
  return 'descargado';
}
export function descargar(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

