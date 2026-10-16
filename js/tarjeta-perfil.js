// Imagen para compartir el resultado de "Encuentra tu perfume" (historias de Instagram / estados de WhatsApp).
// Se dibuja en el teléfono del cliente con un canvas: no usa servidores ni servicios externos.

const W = 1080, H = 1920;
const C = {
  tinta: '#f4eefe', tinta2: '#cdbfe4', tinta3: '#a594c2',
  lila: '#c4a1ff', lilaFuerte: '#a97cff', luna: '#f6f0ff', fondoBarra: '#2b1d48',
};

function cargarImagen(src) {
  return new Promise((ok, mal) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => ok(im);
    im.onerror = mal;
    im.src = src;
  });
}

// Las crestas son un SVG sin tamaño fijo: se le da uno para poder dibujarlo
async function cargarCrestas() {
  const r = await fetch('img/marca/crestas.svg');
  let svg = await r.text();
  svg = svg.replace('<svg ', `<svg width="${W}" height="230" `);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try { return await cargarImagen(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

// Parte el texto en líneas que quepan en el ancho
function lineas(ctx, texto, ancho) {
  const palabras = String(texto).split(/\s+/);
  const out = [];
  let linea = '';
  for (const p of palabras) {
    const prueba = linea ? `${linea} ${p}` : p;
    if (ctx.measureText(prueba).width > ancho && linea) { out.push(linea); linea = p; }
    else linea = prueba;
  }
  if (linea) out.push(linea);
  return out;
}

function espaciado(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

function redondeado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Dibuja la imagen y devuelve un PNG (Blob)
export async function imagenPerfil({ titulo, frase, mezcla = [], producto = null, fotos = 'img/productos/' }) {
  try {
    await Promise.all([
      document.fonts.load('700 100px Unbounded'), document.fonts.load('500 30px Unbounded'),
      document.fonts.load('400 40px Onest'), document.fonts.load('700 40px Onest'),
    ]);
  } catch {}
  const [logo, crestas, foto] = await Promise.all([
    cargarImagen('img/marca/logo.webp').catch(() => null),
    cargarCrestas().catch(() => null),
    producto?.foto ? cargarImagen(fotos + producto.foto).catch(() => null) : Promise.resolve(null),
  ]);

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // cielo
  const cielo = ctx.createLinearGradient(0, 0, 0, H);
  cielo.addColorStop(0, '#0f0819'); cielo.addColorStop(0.55, '#1b0f2e'); cielo.addColorStop(1, '#2a1849');
  ctx.fillStyle = cielo; ctx.fillRect(0, 0, W, H);

  // estrellas (siempre las mismas)
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = azar() * W, y = azar() * H * 0.62, r = 0.8 + azar() * 2;
    ctx.globalAlpha = 0.25 + azar() * 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // luna con halo
  const lx = 900, ly = 250, lr = 120;
  const halo = ctx.createRadialGradient(lx, ly, lr * 0.6, lx, ly, lr * 2.6);
  halo.addColorStop(0, 'rgba(196,161,255,0.28)'); halo.addColorStop(1, 'rgba(196,161,255,0)');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(lx, ly, lr * 2.6, 0, Math.PI * 2); ctx.fill();
  const luna = ctx.createRadialGradient(lx - 40, ly - 45, 10, lx, ly, lr);
  luna.addColorStop(0, '#fffaff'); luna.addColorStop(0.5, '#ece0ff'); luna.addColorStop(1, '#cdb6f2');
  ctx.fillStyle = luna; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2); ctx.fill();

  // marca
  let y = 120;
  if (logo) ctx.drawImage(logo, 80, y - 50, 92, 92 * (logo.naturalHeight / logo.naturalWidth || 1));
  ctx.fillStyle = C.tinta; ctx.font = '700 38px Unbounded'; espaciado(ctx, 3);
  ctx.textBaseline = 'middle';
  ctx.fillText('MN SCENTS', 196, y);

  // "Mi estilo de perfume"
  y = 470;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.lila; ctx.font = '500 34px Unbounded'; espaciado(ctx, 6);
  ctx.fillText('MI ESTILO DE PERFUME', 80, y);

  // título (más pequeño si ocupa más de dos líneas)
  espaciado(ctx, -1);
  ctx.fillStyle = C.tinta;
  let tam = 112;
  ctx.font = `700 ${tam}px Unbounded`;
  let lt = lineas(ctx, titulo, W - 160);
  if (lt.length > 2) { tam = 88; ctx.font = `700 ${tam}px Unbounded`; lt = lineas(ctx, titulo, W - 160); }
  y += tam + 24;
  for (const l of lt) { ctx.fillText(l, 80, y); y += tam * 1.14; }

  // frase
  espaciado(ctx, 0);
  ctx.fillStyle = C.tinta2; ctx.font = '400 44px Onest';
  y += 4;
  for (const l of lineas(ctx, frase, W - 200)) { ctx.fillText(l, 80, y); y += 60; }

  // mezcla
  if (mezcla.length) {
    y += 40;
    const anchoBarra = 560, xBarra = 300;
    for (const m of mezcla) {
      ctx.fillStyle = C.tinta2; ctx.font = '500 36px Onest';
      ctx.fillText(m.txt, 80, y + 12);
      ctx.fillStyle = C.fondoBarra; redondeado(ctx, xBarra, y - 12, anchoBarra, 24, 12); ctx.fill();
      if (m.valor > 0) {
        const g = ctx.createLinearGradient(xBarra, 0, xBarra + anchoBarra, 0);
        g.addColorStop(0, C.lilaFuerte); g.addColorStop(1, C.luna);
        ctx.fillStyle = g; redondeado(ctx, xBarra, y - 12, Math.max(24, anchoBarra * m.valor), 24, 12); ctx.fill();
      }
      y += 62;
    }
  }

  // perfume ideal sobre un charco de luz de luna; el texto debe terminar antes de las montañas
  if (producto) {
    ctx.font = '700 54px Onest';
    const lineasNombre = lineas(ctx, producto.nombre, W - 200).slice(0, 2);
    const altoTexto = 56 + 66 * lineasNombre.length + (producto.marca ? 50 : 0);
    const limite = H - 250;                       // donde empiezan las montañas
    const arriba = y + 30;
    const altoFoto = Math.max(240, Math.min(480, limite - altoTexto - 40 - arriba));
    const base = arriba + altoFoto;               // donde se posa el frasco
    const charco = ctx.createRadialGradient(W / 2, base - altoFoto * 0.35, 20, W / 2, base - altoFoto * 0.35, altoFoto * 0.95);
    charco.addColorStop(0, 'rgba(246,240,255,0.30)'); charco.addColorStop(0.55, 'rgba(196,161,255,0.10)'); charco.addColorStop(1, 'rgba(196,161,255,0)');
    ctx.fillStyle = charco; ctx.beginPath(); ctx.arc(W / 2, base - altoFoto * 0.35, altoFoto * 0.95, 0, Math.PI * 2); ctx.fill();
    if (foto) {
      const k = Math.min(altoFoto * 1.05 / foto.naturalWidth, altoFoto / foto.naturalHeight);
      const w = foto.naturalWidth * k, h = foto.naturalHeight * k;
      ctx.save();
      ctx.translate(W / 2, base); ctx.scale(1, 0.14);
      const sombra = ctx.createRadialGradient(0, 0, 4, 0, 0, w * 0.6);
      sombra.addColorStop(0, 'rgba(8,3,18,0.6)'); sombra.addColorStop(1, 'rgba(8,3,18,0)');
      ctx.fillStyle = sombra; ctx.beginPath(); ctx.arc(0, 0, w * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.drawImage(foto, W / 2 - w / 2, base - h, w, h);
    }
    let ty = base + 70;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.lila; ctx.font = '500 28px Unbounded'; espaciado(ctx, 5);
    ctx.fillText('MI PERFUME IDEAL', W / 2, ty);
    espaciado(ctx, 0);
    ctx.fillStyle = C.tinta; ctx.font = '700 54px Onest';
    ty += 68;
    for (const l of lineasNombre) { ctx.fillText(l, W / 2, ty); ty += 66; }
    if (producto.marca) { ctx.fillStyle = C.tinta3; ctx.font = '400 38px Onest'; ctx.fillText(producto.marca, W / 2, ty - 10); }
    ctx.textAlign = 'left';
  }

  // montañas y enlace
  if (crestas) ctx.drawImage(crestas, 0, H - 230, W, 230);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.tinta2; ctx.font = '400 36px Onest';
  ctx.fillText('Descubre el tuyo en', W / 2, H - 112);
  ctx.fillStyle = C.lila; ctx.font = '700 46px Onest';
  ctx.fillText('mnscents.pages.dev', W / 2, H - 56);
  ctx.textAlign = 'left';

  return new Promise((ok, mal) => cv.toBlob(b => (b ? ok(b) : mal(new Error('sin imagen'))), 'image/png'));
}
