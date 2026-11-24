/**
 * Permisos: esta hoja, la hoja de la web (solo la que conectes desde el menú) y GitHub (subir fotos y
 * publicar la web al momento, solo si conectas una clave de GitHub desde el menú). No ve el resto de tu Drive.
 */
/**
 * MN Scents — Punto de venta (conexión con la hoja MNScents_claude)
 *
 * La app del punto de venta (mnscents.pages.dev/pos) habla con esta hoja a través de este
 * script. Todo queda en TU hoja: las ventas van a "Ventas", los ajustes a "Ajustes", los gastos
 * a "Gastos" y los movimientos de caja a la hoja nueva "Caja". No hay servidores ni costos.
 *
 * Seguridad: cada pedido de la app trae una clave secreta que se guarda en las propiedades de
 * este script (no en la hoja). Solo los dispositivos que vinculaste desde el menú
 * "🛒 Punto de venta → Vincular un teléfono o computadora" la tienen. Si cambias la clave,
 * todos los dispositivos quedan desvinculados.
 */

var POS = {
  VENTAS: 'Ventas', INV: 'Inventario', CLI: 'Clientes', CAJA: 'Caja', AJ: 'Ajustes', GASTOS: 'Gastos', CONF: 'Configuración', FID: 'Fidelidad',
  ZONA: 'America/Managua',
  PRIMERA: 4,                    // primera fila de datos en todas las hojas
  FIN_VENTAS: 1003, FIN_INV: 303, FIN_CLI: 303, FIN_AJ: 503, FIN_GASTOS: 503,
  BANCOS: ['BAC', 'Banpro', 'Lafise'],
  METODOS: ['Efectivo', 'Transferencia bancaria'],
  MOTIVOS: ['Mal conteo', 'Pérdida o robo', 'Dañado', 'Regalo o muestra', 'Uso personal'],
  TIPOS: ['Detalle', 'Detalle sin sello', 'Mayorista', 'Canje'],   // columna "Tipo de venta" (W) de Ventas; "sin sello" = precio especial, no suma a la tarjeta
  PREMIO: /stallion\s*53/i,                     // el perfume gratis de la tarjeta se elige de esta línea
  VERSION: 5,
};

// Columnas (número, base 1)
var V = { FECHA: 1, NUM: 2, CLIENTE: 3, TEL: 4, CIUDAD: 5, PRODUCTO: 6, CANT: 7, PRECIO: 8, DESC: 9, TOTAL: 10, METODO: 11, ESTADO: 12, ENVIO: 13, GANANCIA: 14, BANCO: 22, TIPO: 23 };
var I = { SKU: 1, MARCA: 2, NOMBRE: 3, PRES: 4, FAMILIA: 5, GENERO: 6, COSTO: 11, PRECIO: 12, STOCK: 18, ESTADO: 20, REF: 23, MAYOR: 34, PEDIDOS30: 35 };
var POS_TZ = 'America/Los_Angeles';   // zona de la hoja; se lee en cada pedido
var FID_COLS = ['Fecha y hora', 'Cliente', 'Movimiento', 'Sellos', 'Nota', 'ID (no tocar)'];
var CAJA_COLS = ['Fecha y hora', 'Tipo', 'Concepto', 'Método', 'Banco', 'Monto', 'Número de venta', 'Efectivo contado', 'Diferencia', 'ID (no tocar)'];

// ======================================================================
// Menú dentro de la hoja
// ======================================================================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🛒 Punto de venta')
    .addItem('Vincular un teléfono o computadora', 'posVincular')
    .addSeparator()
    .addItem('Recalcular costos', 'posMenuCostos')
    .addSeparator()
    .addItem('Conectar con la hoja de la web', 'posWebConectar')
    .addItem('Enviar perfumes nuevos y precios a la web ahora', 'posWebMenuSincronizar')
    .addItem('Conectar GitHub (fotos y publicar al instante)', 'posGithubConectar')
    .addSeparator()
    .addItem('Cambiar la dirección de la app web', 'posCambiarDireccion')
    .addItem('Cambiar la clave (desvincula todos)', 'posCambiarClave')
    .addToUi();
}

function posClave_(crear) {
  var props = PropertiesService.getScriptProperties();
  var t = props.getProperty('POS_TOKEN');
  if (!t && crear) {
    t = Utilities.base64EncodeWebSafe(Utilities.getUuid() + Utilities.getUuid() + Date.now()).replace(/=+$/, '').slice(0, 48);
    props.setProperty('POS_TOKEN', t);
  }
  return t;
}

// La dirección de la app web se guarda una vez (Google a veces informa otra con ScriptApp.getService().getUrl()).
var POS_URL_OK = /^https:\/\/script\.google\.com\/(a\/[^\/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/;

function posDireccion_(ui, pedir) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('POS_URL');
  if (url && !pedir) return url;
  var r = ui.prompt('Dirección de la app web',
    'Pega la URL de la app web. La encuentras en Extensiones → Apps Script → Implementar → Gestionar implementaciones → App web → URL (termina en /exec).',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  url = String(r.getResponseText() || '').trim().replace(/[?#].*$/, '');
  if (!POS_URL_OK.test(url)) {
    ui.alert('Esa dirección no sirve', 'Debe empezar con https://script.google.com/macros/s/ y terminar en /exec.', ui.ButtonSet.OK);
    return null;
  }
  props.setProperty('POS_URL', url);
  return url;
}

function posCambiarDireccion() {
  var ui = SpreadsheetApp.getUi();
  if (posDireccion_(ui, true)) ui.alert('Dirección guardada. Vuelve a vincular tus dispositivos desde 🛒 Punto de venta → Vincular.');
}

function posVincular() {
  var ui = SpreadsheetApp.getUi();
  var url = posDireccion_(ui, false);
  if (!url) return;
  var datos = Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, t: posClave_(true) })).replace(/=+$/, '');
  var enlace = 'https://mnscents.pages.dev/pos/#vincular=' + datos;
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;text-align:center;color:#1d1230">' +
    '<p style="margin:0 0 8px">Escanea este código con la cámara de tu <b>Android</b>, o abre el enlace en tu <b>computadora</b>.</p>' +
    '<div id="qr" style="display:inline-block;padding:8px;background:#fff"></div>' +
    '<p><a href="' + enlace + '" target="_blank" style="color:#6a3fc0;font-weight:bold">Abrir el punto de venta en esta computadora</a></p>' +
    '<p style="font-size:12px;color:#6f5f8c">Este código es como una contraseña: no lo compartas.</p>' +
    '<p style="font-size:10px;color:#6f5f8c;word-break:break-all">Dirección de la hoja: ' + url + '</p>' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>' +
    '<script>var q=qrcode(0,"M");q.addData(' + JSON.stringify(enlace) + ');q.make();document.getElementById("qr").innerHTML=q.createSvgTag(5,0);</script>' +
    '</div>').setWidth(380).setHeight(520);
  ui.showModalDialog(html, 'Vincular el punto de venta');
}

function posCambiarClave() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.alert('Cambiar la clave', 'Todos los teléfonos y computadoras vinculados dejarán de funcionar hasta que los vincules otra vez. ¿Continuar?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().deleteProperty('POS_TOKEN');
  posClave_(true);
  ui.alert('Listo. Vuelve a vincular tus dispositivos desde el menú 🛒 Punto de venta.');
}

// ======================================================================
// Entrada de la app
// ======================================================================
function doGet() {
  return posJson_({ ok: true, app: 'MN Scents POS', version: POS.VERSION });
}

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return posJson_({ ok: false, error: 'Pedido mal formado.' }); }
  var clave = posClave_(false);
  if (!clave || typeof req.t !== 'string' || req.t !== clave) return posJson_({ ok: false, error: 'no-autorizado' });
  try {
    return posJson_(posAtender_(SpreadsheetApp.getActiveSpreadsheet(), req, new Date()));
  } catch (err) {
    return posJson_({ ok: false, error: String(err && err.message || err) });
  }
}

function posJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Toda la lógica recibe la hoja y la hora: así se puede probar sin Google.
function posAtender_(ss, req, ahora) {
  POS_TZ = ss.getSpreadsheetTimeZone() || POS_TZ;
  var a = req.accion;
  if (a === 'estado') return posEstado_(ss, ahora);
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    // si la app reintenta algo que ya se guardó (se cortó la señal antes de la respuesta), no se repite
    var cache = CacheService.getScriptCache();
    var idOp = posTexto_(req.id, 60);
    var previo = idOp ? cache.get('pos:' + idOp) : null;
    if (previo) { var r0 = JSON.parse(previo); r0.repetida = true; return { ok: true, version: POS.VERSION, resultado: r0 }; }
    var r;
    if (a === 'venta') r = posVenta_(ss, req.venta, ahora);
    else if (a === 'anular') r = posAnular_(ss, req.numero, ahora);
    else if (a === 'ajuste') r = posAjuste_(ss, req.ajuste, ahora);
    else if (a === 'caja') r = posCaja_(ss, req.caja, ahora);
    else if (a === 'sellos') r = posSellos_(ss, req.sellos, ahora);
    else if (a === 'entrada') r = posEntrada_(ss, req.entrada, ahora);
    else throw new Error('Acción desconocida.');
    if (idOp) cache.put('pos:' + idOp, JSON.stringify(r || {}), 21600);
    // el costo del día queda guardado en la venta o el ajuste (si falla, la venta igual quedó)
    if (a === 'venta' || a === 'anular' || a === 'ajuste' || a === 'entrada') { try { posRecalcularCostos_(ss); } catch (e) { Logger.log('Costos: ' + e); } }
    // Se responde enseguida: la hoja recalcula sus fórmulas después y la app pide el estado aparte.
    return { ok: true, version: POS.VERSION, resultado: r };
  } finally { lock.releaseLock(); }
}

// ======================================================================
// Fechas (siempre en hora de Nicaragua, sin importar la zona de la hoja)
// ======================================================================
function posHoyNica_(ahora) {
  var p = Utilities.formatDate(ahora, POS.ZONA, 'yyyy-MM-dd').split('-');
  return { y: +p[0], m: +p[1], d: +p[2], texto: p[2] + '/' + p[1] + '/' + p[0] };
}
// Número de serie de Sheets (días desde 30/12/1899) para una fecha (y la hora opcional) de Nicaragua
function posSerie_(f, h, mi) {
  return (Date.UTC(f.y, f.m - 1, f.d, h || 0, mi || 0) - Date.UTC(1899, 11, 30)) / 864e5;
}
function posSerieAhora_(ahora) {
  var t = Utilities.formatDate(ahora, POS.ZONA, 'yyyy-MM-dd HH:mm').split(/[- :]/);
  return posSerie_({ y: +t[0], m: +t[1], d: +t[2] }, +t[3], +t[4]);
}
// Convierte lo que devuelve getValues() (Date o número) al número de día
function posDia_(v) {
  if (v instanceof Date) {
    var t = Utilities.formatDate(v, POS_TZ, 'yyyy-MM-dd').split('-');
    return Math.floor(posSerie_({ y: +t[0], m: +t[1], d: +t[2] }));
  }
  if (typeof v === 'number') return Math.floor(v);
  return null;
}
function posHora_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, POS_TZ, 'HH:mm');
  if (typeof v === 'number') { var m = Math.round((v - Math.floor(v)) * 1440); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
  return '';
}

function posNum_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function posTexto_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 80); }
function posHoja_(ss, nombre) {
  var h = ss.getSheetByName(nombre);
  if (!h) throw new Error('No encuentro la hoja "' + nombre + '".');
  return h;
}
// Última fila con algo en la columna c (entre la primera fila y el final)
function posUltima_(hoja, c, fin) {
  var vals = hoja.getRange(POS.PRIMERA, c, fin - POS.PRIMERA + 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (vals[i][0] !== '' && vals[i][0] != null) return POS.PRIMERA + i;
  return POS.PRIMERA - 1;
}

// ======================================================================
// Estado: catálogo, clientes, caja y resumen del día
// ======================================================================
function posProductos_(ss) {
  var h = posHoja_(ss, POS.INV);
  var n = POS.FIN_INV - POS.PRIMERA + 1;
  var vals = h.getRange(POS.PRIMERA, 1, n, I.PEDIDOS30).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var f = vals[i];
    if (f[I.SKU - 1] === '' || f[I.REF - 1] === '') continue;
    out.push({
      sku: String(f[I.SKU - 1]), ref: String(f[I.REF - 1]),
      marca: String(f[I.MARCA - 1]), nombre: String(f[I.NOMBRE - 1]), pres: String(f[I.PRES - 1]),
      familia: String(f[I.FAMILIA - 1] || ''), genero: String(f[I.GENERO - 1] || ''),
      precio: posNum_(f[I.PRECIO - 1]), mayor: posNum_(f[I.MAYOR - 1]), costo: Math.round(posNum_(f[I.COSTO - 1]) * 100) / 100,
      stock: posNum_(f[I.STOCK - 1]), estado: String(f[I.ESTADO - 1] || ''), pedidos30: posNum_(f[I.PEDIDOS30 - 1]),
    });
  }
  return out;
}

// Solo referencia y nombre de cada perfume: rápido aunque la hoja esté recalculando
function posReferencias_(ss) {
  var h = posHoja_(ss, POS.INV);
  var n = POS.FIN_INV - POS.PRIMERA + 1;
  var nm = h.getRange(POS.PRIMERA, I.MARCA, n, 2).getValues();
  var refs = h.getRange(POS.PRIMERA, I.REF, n, 1).getValues();
  var out = {};
  for (var i = 0; i < n; i++) if (refs[i][0] !== '') out[String(refs[i][0])] = { ref: String(refs[i][0]), marca: String(nm[i][0]), nombre: String(nm[i][1]) };
  return out;
}

function posClientes_(ss) {
  var h = posHoja_(ss, POS.CLI);
  var vals = h.getRange(POS.PRIMERA, 1, POS.FIN_CLI - POS.PRIMERA + 1, 9).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var f = vals[i];
    if (f[0] === '') continue;
    out.push({ nombre: String(f[0]), telefono: String(f[1] || ''), ciudad: String(f[2] || ''), compras: posNum_(f[5]), gastado: posNum_(f[6]), favorito: String(f[7] || ''), nota: String(f[8] || '') });
  }
  return out;
}

function posConfig_(ss) {
  var h = posHoja_(ss, POS.CONF);
  var b = h.getRange(4, 2, 7, 1).getValues();
  var ciudades = h.getRange(4, 5, 17, 1).getValues().map(function (x) { return String(x[0]); }).filter(String);
  var gastos = h.getRange(4, 10, 8, 1).getValues().map(function (x) { return String(x[0]); }).filter(String);
  var familias = h.getRange(4, 8, 10, 1).getValues().map(function (x) { return String(x[0]); }).filter(String);
  var b11 = h.getRange(11, 1, 1, 2).getValues()[0];
  var minGanancia = /ganancia m[ií]nima/i.test(String(b11[0])) ? posNum_(b11[1]) : 0;
  return { metaVentas: posNum_(b[3][0]), metaGanancia: posNum_(b[4][0]), tipoCambio: posNum_(b[1][0]), stockMinimo: posNum_(b[5][0]) || 3, minimoMayor: posNum_(b[6][0]) || 6, ciudades: ciudades, gastos: gastos, bancos: POS.BANCOS, motivos: POS.MOTIVOS,
    familias: familias, gananciaMinMayor: minGanancia, proveedores: posProveedores_(ss), ultimoPedido: posUltimoPedido_(ss) };
}

function posHojaCaja_(ss) {
  var h = ss.getSheetByName(POS.CAJA);
  if (h) return h;
  h = ss.insertSheet(POS.CAJA);
  h.getRange(1, 1).setValue('🧾  CAJA — MNScents');
  h.getRange(2, 1).setValue('La llena sola la app del punto de venta: apertura, ventas, entradas, salidas y cierre de cada día. Monto positivo = entra a la caja; negativo = sale. No cambies la columna ID.');
  h.getRange(3, 1, 1, CAJA_COLS.length).setValues([CAJA_COLS]);
  h.getRange(1, 1, 1, CAJA_COLS.length).setBackground('#4a1942').setFontColor('#ffffff').setFontWeight('bold').setFontSize(16);
  h.getRange(2, 1, 1, CAJA_COLS.length).setFontColor('#6f5f8c').setFontStyle('italic');
  h.getRange(3, 1, 1, CAJA_COLS.length).setBackground('#6e2c5a').setFontColor('#ffffff').setFontWeight('bold').setWrap(true);
  h.setFrozenRows(3);
  h.getRange('A4:A').setNumberFormat('dd/mm/yyyy HH:mm');
  h.getRange('F4:F').setNumberFormat('"C$"#,##0.00;[RED]"-C$"#,##0.00');
  h.getRange('H4:I').setNumberFormat('"C$"#,##0.00;[RED]"-C$"#,##0.00');
  h.setColumnWidth(1, 130); h.setColumnWidth(3, 260); h.setColumnWidth(10, 90);
  return h;
}

// Movimientos de caja de un día (número de día de Sheets)
function posMovimientosDia_(ss, dia) {
  var h = posHojaCaja_(ss);
  var ult = h.getLastRow();
  if (ult < POS.PRIMERA) return [];
  var vals = h.getRange(POS.PRIMERA, 1, ult - POS.PRIMERA + 1, CAJA_COLS.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var f = vals[i];
    if (f[1] === '' || posDia_(f[0]) !== dia) continue;
    out.push({ fila: POS.PRIMERA + i, hora: posHora_(f[0]), tipo: String(f[1]), concepto: String(f[2]), metodo: String(f[3]), banco: String(f[4]), monto: posNum_(f[5]), venta: f[6] === '' ? null : posNum_(f[6]), contado: f[7] === '' ? null : posNum_(f[7]), diferencia: f[8] === '' ? null : posNum_(f[8]), id: String(f[9] || '') });
  }
  return out;
}

// Resumen de la caja: lo que debería haber en efectivo y lo que entró por cada banco
function posResumenCaja_(movs) {
  var r = { abierta: false, cerrada: false, apertura: 0, ventasEfectivo: 0, entradas: 0, salidas: 0, bancos: {}, esperado: 0, ventas: 0 };
  POS.BANCOS.forEach(function (b) { r.bancos[b] = 0; });
  movs.forEach(function (m) {
    if (m.tipo === 'Apertura') {
      // reabrir después de un cierre empieza un turno nuevo; abrir tarde (después de vender) no borra lo vendido
      if (r.cerrada) { r.ventasEfectivo = 0; r.entradas = 0; r.salidas = 0; }
      r.abierta = true; r.cerrada = false; r.apertura = m.monto;
    }
    else if (m.tipo === 'Cierre') { r.cerrada = true; r.abierta = false; }
    else if (m.tipo === 'Venta' || m.tipo === 'Anulación') {
      if (m.metodo === 'Efectivo') r.ventasEfectivo += m.monto;
      else if (m.banco && r.bancos.hasOwnProperty(m.banco)) r.bancos[m.banco] += m.monto;
      r.ventas += m.tipo === 'Venta' ? 1 : -1;
    }
    else if (m.tipo === 'Entrada') r.entradas += m.monto;
    else if (m.tipo === 'Salida') r.salidas += -m.monto;
  });
  r.esperado = Math.round((r.apertura + r.ventasEfectivo + r.entradas - r.salidas) * 100) / 100;
  return r;
}

// Todas las filas usadas de Ventas (una sola lectura). Lee hasta "Tipo de venta" si la columna ya existe.
function posLeerVentas_(ss) {
  var h = posHoja_(ss, POS.VENTAS);
  var ult = posUltima_(h, V.PRODUCTO, POS.FIN_VENTAS);
  if (ult < POS.PRIMERA) return [];
  var cols = Math.min(h.getMaxColumns(), V.TIPO);
  var vals = h.getRange(POS.PRIMERA, 1, ult - POS.PRIMERA + 1, cols).getValues();
  return vals.filter(function (f) { return f[V.PRODUCTO - 1] !== ''; });
}

// Ventas del día desde la hoja Ventas (incluye las que anotas a mano)
function posVentasDia_(filas, dia) {
  var res = { numeros: [], total: 0, ganancia: 0, unidades: 0, porMetodo: {}, lineas: [] };
  var nums = {};
  for (var i = 0; i < filas.length; i++) {
    var f = filas[i];
    if (posDia_(f[V.FECHA - 1]) !== dia) continue;
    var tot = posNum_(f[V.TOTAL - 1]);
    var num = posNum_(f[V.NUM - 1]);
    nums[num] = true;
    res.total += tot; res.ganancia += posNum_(f[V.GANANCIA - 1]); res.unidades += posNum_(f[V.CANT - 1]);
    var met = String(f[V.METODO - 1] || 'Sin método') + (f[V.BANCO - 1] ? ' · ' + f[V.BANCO - 1] : '');
    res.porMetodo[met] = (res.porMetodo[met] || 0) + tot;
    res.lineas.push({ numero: num, cliente: String(f[V.CLIENTE - 1] || ''), producto: String(f[V.PRODUCTO - 1]), cantidad: posNum_(f[V.CANT - 1]), total: tot });
  }
  res.numeros = Object.keys(nums).map(Number);
  res.total = Math.round(res.total * 100) / 100;
  res.ganancia = Math.round(res.ganancia * 100) / 100;
  return res;
}

// Historial compacto para reportes, tarjeta de fidelidad, racha y reposición (los cálculos los hace la app).
// [día, número, cliente, código del perfume (o su nombre si ya no está), cantidad, precio, descuento, total, método, banco, ganancia, tipo]
function posHistorial_(filas, productos) {
  var sku = {};
  productos.forEach(function (p) { sku[p.ref] = p.sku; });
  var out = [];
  for (var i = 0; i < filas.length; i++) {
    var f = filas[i];
    var dia = posDia_(f[V.FECHA - 1]);
    if (dia === null) continue;
    var ref = String(f[V.PRODUCTO - 1]);
    var r2 = function (v) { return Math.round(posNum_(v) * 100) / 100; };
    out.push([dia, posNum_(f[V.NUM - 1]), posTexto_(f[V.CLIENTE - 1], 60), sku[ref] || ref, posNum_(f[V.CANT - 1]), r2(f[V.PRECIO - 1]), r2(f[V.DESC - 1]),
      r2(f[V.TOTAL - 1]), String(f[V.METODO - 1] || ''), String(f[V.BANCO - 1] || ''), r2(f[V.GANANCIA - 1]), String(f[V.TIPO - 1] || '')]);
  }
  return out;
}

function posSiguienteVenta_(ss) {
  var h = posHoja_(ss, POS.VENTAS);
  var vals = h.getRange(POS.PRIMERA, V.NUM, POS.FIN_VENTAS - POS.PRIMERA + 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < vals.length; i++) { var n = posNum_(vals[i][0]); if (n > max) max = n; }
  return max + 1;
}

function posEstado_(ss, ahora) {
  var hoy = posHoyNica_(ahora);
  var dia = Math.floor(posSerie_(hoy));
  var movs = posMovimientosDia_(ss, dia);
  var productos = posProductos_(ss);
  var filas = posLeerVentas_(ss);
  return {
    ok: true, version: POS.VERSION, fecha: hoy.texto, dia: dia,
    config: posConfig_(ss), productos: productos, clientes: posClientes_(ss),
    siguienteVenta: posSiguienteVenta_(ss),
    caja: { resumen: posResumenCaja_(movs), movimientos: movs },
    hoy: posVentasDia_(filas, dia),
    historial: posHistorial_(filas, productos),
    fidelidad: posFidelidad_(ss),
    web: posWebResumen_(),
  };
}

// ======================================================================
// Registrar una venta
// ======================================================================
function posBuscarId_(ss, id) {
  if (!id) return null;
  var h = posHojaCaja_(ss);
  var ult = h.getLastRow();
  if (ult < POS.PRIMERA) return null;
  var vals = h.getRange(POS.PRIMERA, 1, ult - POS.PRIMERA + 1, CAJA_COLS.length).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][9]) === id) return { fila: POS.PRIMERA + i, venta: posNum_(vals[i][6]) };
  return null;
}

function posAgregarCliente_(ss, c) {
  var nombre = posTexto_(c.nombre, 60);
  if (!nombre) return '';
  var h = posHoja_(ss, POS.CLI);
  var vals = h.getRange(POS.PRIMERA, 1, POS.FIN_CLI - POS.PRIMERA + 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).toLowerCase() === nombre.toLowerCase()) return String(vals[i][0]);
  var fila = posUltima_(h, 1, POS.FIN_CLI) + 1;
  if (fila > POS.FIN_CLI) throw new Error('La hoja Clientes está llena (fila ' + POS.FIN_CLI + ').');
  h.getRange(fila, 1, 1, 3).setValues([[nombre, posTexto_(c.telefono, 20), posTexto_(c.ciudad, 30)]]);
  return nombre;
}

function posAgregarCaja_(ss, fila) {
  var h = posHojaCaja_(ss);
  var r = Math.max(h.getLastRow() + 1, POS.PRIMERA);
  h.getRange(r, 1, 1, CAJA_COLS.length).setValues([fila]);
  return r;
}

/**
 * venta = { id, cliente: {nombre, telefono, ciudad, nuevo} | null,
 *           lineas: [{ref, cantidad, precio, descuento}],
 *           pago: {metodo: 'Efectivo'|'Transferencia bancaria', banco, recibido} }
 */
function posVenta_(ss, venta, ahora) {
  if (!venta || !Array.isArray(venta.lineas) || !venta.lineas.length) throw new Error('La venta no tiene perfumes.');
  var previa = posBuscarId_(ss, posTexto_(venta.id, 60));
  if (previa) return { numero: previa.venta, repetida: true };   // ya se guardó (reintento sin señal)

  var porRef = posReferencias_(ss);
  var conCliente = !!(venta.cliente && posTexto_(venta.cliente.nombre, 60));
  var lineas = venta.lineas.map(function (l) {
    var p = porRef[l.ref];
    if (!p) throw new Error('El perfume "' + posTexto_(l.ref) + '" ya no está en el Inventario.');
    var cant = Math.round(posNum_(l.cantidad));
    var canje = l.canje === true;
    var precio = canje ? 0 : Math.round(posNum_(l.precio) * 100) / 100;
    var desc = canje ? 0 : Math.round(posNum_(l.descuento) * 100) / 100;
    if (cant < 1 || cant > 999) throw new Error('Cantidad no válida en ' + p.nombre + '.');
    if (canje) {
      if (cant !== 1) throw new Error('El premio de la tarjeta es 1 perfume.');
      if (!conCliente) throw new Error('El premio de la tarjeta necesita el nombre del cliente.');
      if (!POS.PREMIO.test(p.marca + ' ' + p.nombre)) throw new Error('El premio de la tarjeta es de la línea Stallion 53.');
    } else if (precio <= 0) throw new Error('Falta el precio de ' + p.nombre + '.');
    if (desc < 0 || desc > cant * precio) throw new Error('Descuento no válido en ' + p.nombre + '.');
    var tipo = canje ? 'Canje' : (POS.TIPOS.indexOf(l.tipo) >= 0 && l.tipo !== 'Canje' ? l.tipo : 'Detalle');
    return { ref: p.ref, cant: cant, precio: precio, desc: desc, tipo: tipo };
  });
  var soloCanje = lineas.every(function (l) { return l.tipo === 'Canje'; });
  var pago = venta.pago || {};
  var metodo = POS.METODOS.indexOf(pago.metodo) >= 0 ? pago.metodo : soloCanje ? 'Efectivo' : null;
  if (!metodo) throw new Error('Elige cómo pagó.');
  var banco = metodo === 'Transferencia bancaria' ? pago.banco : '';
  if (metodo === 'Transferencia bancaria' && POS.BANCOS.indexOf(banco) < 0) throw new Error('Elige el banco de la transferencia.');

  var cliente = '', ciudad = 'Estelí';
  if (venta.cliente && venta.cliente.nombre) {
    cliente = venta.cliente.nuevo ? posAgregarCliente_(ss, venta.cliente) : posTexto_(venta.cliente.nombre, 60);
    if (venta.cliente.ciudad) ciudad = posTexto_(venta.cliente.ciudad, 30);
  }

  var h = posHoja_(ss, POS.VENTAS);
  var inicio = posUltima_(h, V.PRODUCTO, POS.FIN_VENTAS) + 1;
  var n = lineas.length;
  if (inicio + n - 1 > POS.FIN_VENTAS) throw new Error('La hoja Ventas llegó a su última fila preparada (' + POS.FIN_VENTAS + '). Hay que ampliarla.');
  var numero = posSiguienteVenta_(ss);
  var hoy = Math.floor(posSerie_(posHoyNica_(ahora)));

  // Solo se escriben las celdas que llenarías a mano; las fórmulas (teléfono, total, ganancia...) se quedan.
  h.getRange(inicio, V.FECHA, n, 3).setValues(lineas.map(function () { return [hoy, numero, cliente]; }));
  h.getRange(inicio, V.FECHA, n, 1).setNumberFormat(h.getRange(POS.PRIMERA, V.FECHA).getNumberFormat());
  h.getRange(inicio, V.CIUDAD, n, 5).setValues(lineas.map(function (l) { return [ciudad, l.ref, l.cant, l.precio, l.desc || '']; }));
  h.getRange(inicio, V.METODO, n, 2).setValues(lineas.map(function () { return [metodo, 'Pagado']; }));
  h.getRange(inicio, V.BANCO, n, 1).setValues(lineas.map(function () { return [banco]; }));
  if (!String(h.getRange(3, V.BANCO).getValue())) h.getRange(3, V.BANCO).setValue('Banco');
  posColumnaTipo_(h);
  h.getRange(inicio, V.TIPO, n, 1).setValues(lineas.map(function (l) { return [l.tipo]; }));

  var total = lineas.reduce(function (s, l) { return s + l.cant * l.precio - l.desc; }, 0);
  total = Math.round(total * 100) / 100;
  var unidades = lineas.reduce(function (s, l) { return s + l.cant; }, 0);
  posAgregarCaja_(ss, [posSerieAhora_(ahora), 'Venta', 'Venta #' + numero + (cliente ? ' · ' + cliente : '') + ' · ' + unidades + (unidades === 1 ? ' perfume' : ' perfumes') + (lineas.some(function (l) { return l.tipo === 'Canje'; }) ? ' · premio de la tarjeta' : ''),
    metodo, banco, total, numero, '', '', posTexto_(venta.id, 60)]);
  return { numero: numero, total: total, unidades: unidades, cliente: cliente };
}

// ======================================================================
// Anular una venta de hoy (se equivocó): borra sus filas y deja constancia en la caja
// ======================================================================
function posAnular_(ss, numero, ahora) {
  numero = Math.round(posNum_(numero));
  if (numero < 1) throw new Error('Número de venta no válido.');
  var h = posHoja_(ss, POS.VENTAS);
  var ult = posUltima_(h, V.PRODUCTO, POS.FIN_VENTAS);
  var hoy = Math.floor(posSerie_(posHoyNica_(ahora)));
  var vals = h.getRange(POS.PRIMERA, 1, Math.max(ult - POS.PRIMERA + 1, 1), V.BANCO).getValues();
  var filas = [], total = 0, metodo = '', banco = '';
  for (var i = 0; i < vals.length; i++) {
    if (posNum_(vals[i][V.NUM - 1]) !== numero || vals[i][V.PRODUCTO - 1] === '') continue;
    if (posDia_(vals[i][V.FECHA - 1]) !== hoy) throw new Error('Solo se pueden anular ventas de hoy. Corrige las anteriores en la hoja.');
    filas.push(POS.PRIMERA + i);
    total += posNum_(vals[i][V.TOTAL - 1]);
    metodo = String(vals[i][V.METODO - 1]); banco = String(vals[i][V.BANCO - 1] || '');
  }
  if (!filas.length) throw new Error('No encontré la venta #' + numero + '.');
  // la fila vacía siguiente conserva la fórmula automática de precio: se copia a las filas que se vacían
  var formula = h.getRange(Math.min(ult + 1, POS.FIN_VENTAS), V.PRECIO).getFormulaR1C1();
  filas.forEach(function (f) {
    h.getRange(f, V.FECHA, 1, 3).clearContent();
    h.getRange(f, V.CIUDAD, 1, 5).clearContent();
    h.getRange(f, V.METODO, 1, 3).clearContent();
    h.getRange(f, V.BANCO).clearContent();
    if (h.getMaxColumns() >= V.TIPO) h.getRange(f, V.TIPO).clearContent();
    if (h.getMaxColumns() >= COSTO.VEN_COSTO) h.getRange(f, COSTO.VEN_COSTO).clearContent();
    if (formula) h.getRange(f, V.PRECIO).setFormulaR1C1(formula); else h.getRange(f, V.PRECIO).clearContent();
  });
  total = Math.round(total * 100) / 100;
  posAgregarCaja_(ss, [posSerieAhora_(ahora), 'Anulación', 'Venta #' + numero + ' anulada', metodo, banco, -total, numero, '', '', '']);
  return { numero: numero, total: total, filas: filas.length };
}

// ======================================================================
// Ajuste de inventario (falta o sobra)
// ======================================================================
function posAjuste_(ss, aj, ahora) {
  if (!aj) throw new Error('Ajuste vacío.');
  var cant = Math.round(posNum_(aj.cantidad));
  if (!cant || Math.abs(cant) > 999) throw new Error('Cantidad no válida.');
  if (POS.MOTIVOS.indexOf(aj.motivo) < 0) throw new Error('Elige un motivo.');
  var existe = !!posReferencias_(ss)[aj.ref];
  if (!existe) throw new Error('Ese perfume ya no está en el Inventario.');
  var h = posHoja_(ss, POS.AJ);
  var fila = posUltima_(h, 2, POS.FIN_AJ) + 1;
  if (fila > POS.FIN_AJ) throw new Error('La hoja Ajustes está llena.');
  h.getRange(fila, 1, 1, 5).setValues([[Math.floor(posSerie_(posHoyNica_(ahora))), aj.ref, cant, aj.motivo, posTexto_(aj.nota, 120)]]);
  h.getRange(fila, 1).setNumberFormat(h.getRange(POS.PRIMERA, 1).getNumberFormat());
  return { fila: fila, cantidad: cant };
}

// ======================================================================
// Caja: apertura, entradas, salidas (y gasto) y cierre
// ======================================================================
function posCaja_(ss, op, ahora) {
  if (!op) throw new Error('Operación vacía.');
  var monto = Math.round(posNum_(op.monto) * 100) / 100;
  var hoy = Math.floor(posSerie_(posHoyNica_(ahora)));
  var res = posResumenCaja_(posMovimientosDia_(ss, hoy));
  var t = posSerieAhora_(ahora);
  var id = posTexto_(op.id, 60);
  if (id && posBuscarId_(ss, id)) return { repetida: true };
  if (op.tipo === 'apertura') {
    if (res.abierta) throw new Error('La caja de hoy ya está abierta.');
    if (monto < 0) throw new Error('Monto no válido.');
    posAgregarCaja_(ss, [t, 'Apertura', posTexto_(op.concepto, 80) || 'Efectivo inicial', 'Efectivo', '', monto, '', '', '', id]);
    return { tipo: 'apertura', monto: monto };
  }
  if (op.tipo === 'entrada' || op.tipo === 'salida') {
    if (monto <= 0) throw new Error('Escribe un monto mayor que cero.');
    var concepto = posTexto_(op.concepto, 80);
    if (!concepto) throw new Error('Escribe de qué es el movimiento.');
    var signo = op.tipo === 'entrada' ? 1 : -1;
    posAgregarCaja_(ss, [t, op.tipo === 'entrada' ? 'Entrada' : 'Salida', concepto + (op.gasto ? ' (gasto: ' + op.gasto + ')' : ''), 'Efectivo', '', signo * monto, '', '', '', id]);
    if (op.tipo === 'salida' && op.gasto) {
      var g = posHoja_(ss, POS.GASTOS);
      var fila = posUltima_(g, 1, POS.FIN_GASTOS) + 1;
      if (fila > POS.FIN_GASTOS) throw new Error('La hoja Gastos está llena.');
      g.getRange(fila, 1, 1, 4).setValues([[hoy, posTexto_(op.gasto, 30), concepto, monto]]);
      g.getRange(fila, 1).setNumberFormat(g.getRange(POS.PRIMERA, 1).getNumberFormat());
    }
    return { tipo: op.tipo, monto: monto };
  }
  if (op.tipo === 'cierre') {
    if (!res.abierta) throw new Error('La caja de hoy no está abierta.');
    var contado = monto;
    var dif = Math.round((contado - res.esperado) * 100) / 100;
    posAgregarCaja_(ss, [t, 'Cierre', posTexto_(op.concepto, 80) || 'Cierre del día', 'Efectivo', '', 0, '', contado, dif, id]);
    return { tipo: 'cierre', esperado: res.esperado, contado: contado, diferencia: dif };
  }
  throw new Error('Operación de caja desconocida.');
}

// ======================================================================
// Columna "Tipo de venta" (W) y tarjeta de fidelidad
// ======================================================================
// La hoja Ventas termina en la columna V: se agrega W al final (no mueve ninguna fórmula).
function posColumnaTipo_(h) {
  if (h.getMaxColumns() < V.TIPO) h.insertColumnsAfter(h.getMaxColumns(), V.TIPO - h.getMaxColumns());
  var cab = h.getRange(3, V.TIPO);
  if (!String(cab.getValue())) {
    h.getRange(3, V.BANCO).copyTo(cab, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    cab.setValue('Tipo de venta');
    cab.setNote('La llena la app del punto de venta: Detalle, Detalle sin sello (precio especial: no suma a la tarjeta), Mayorista o Canje (perfume gratis de la tarjeta). Cuenta para los sellos y la racha mayorista.');
  }
}

function posHojaFid_(ss) {
  var h = ss.getSheetByName(POS.FID);
  if (h) return h;
  h = ss.insertSheet(POS.FID);
  h.getRange(1, 1).setValue('⭐  FIDELIDAD — MNScents');
  h.getRange(2, 1).setValue('Los sellos se cuentan solos desde Ventas (1 por compra al detalle, 2 de regalo con la primera; las de precio especial no suman). Aquí quedan los sellos que agregas o quitas a mano, con su motivo.');
  h.getRange(3, 1, 1, FID_COLS.length).setValues([FID_COLS]);
  h.getRange(1, 1, 1, FID_COLS.length).setBackground('#4a1942').setFontColor('#ffffff').setFontWeight('bold').setFontSize(16);
  h.getRange(2, 1, 1, FID_COLS.length).setFontColor('#6f5f8c').setFontStyle('italic');
  h.getRange(3, 1, 1, FID_COLS.length).setBackground('#6e2c5a').setFontColor('#ffffff').setFontWeight('bold');
  h.setFrozenRows(3);
  h.getRange('A4:A').setNumberFormat('dd/mm/yyyy HH:mm');
  h.setColumnWidth(1, 130); h.setColumnWidth(2, 200); h.setColumnWidth(5, 260); h.setColumnWidth(6, 90);
  return h;
}

// [día, cliente, sellos, nota] de cada ajuste a mano
function posFidelidad_(ss) {
  var h = ss.getSheetByName(POS.FID);
  if (!h) return [];
  var ult = h.getLastRow();
  if (ult < POS.PRIMERA) return [];
  var vals = h.getRange(POS.PRIMERA, 1, ult - POS.PRIMERA + 1, FID_COLS.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var f = vals[i];
    if (f[1] === '' || !posNum_(f[3])) continue;
    out.push([posDia_(f[0]), posTexto_(f[1], 60), Math.round(posNum_(f[3])), posTexto_(f[4], 120)]);
  }
  return out;
}

// Ajuste a mano de sellos: { cliente, sellos (+/-), nota }
function posSellos_(ss, op, ahora) {
  if (!op) throw new Error('Ajuste vacío.');
  var cliente = posTexto_(op.cliente, 60);
  if (!cliente) throw new Error('Falta el cliente.');
  var n = Math.round(posNum_(op.sellos));
  if (!n || Math.abs(n) > 50) throw new Error('Cantidad de sellos no válida.');
  var h = posHojaFid_(ss);
  var id = posTexto_(op.id, 60);
  if (id) {
    var ult = h.getLastRow();
    if (ult >= POS.PRIMERA) {
      var ids = h.getRange(POS.PRIMERA, FID_COLS.length, ult - POS.PRIMERA + 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return { repetida: true };
    }
  }
  var r = Math.max(h.getLastRow() + 1, POS.PRIMERA);
  h.getRange(r, 1, 1, FID_COLS.length).setValues([[posSerieAhora_(ahora), cliente, 'Ajuste', n, posTexto_(op.nota, 120), id]]);
  return { cliente: cliente, sellos: n };
}

// ======================================================================
// Costo promedio de lo que hay en stock (método "promedio móvil")
// ----------------------------------------------------------------------
// El costo de un perfume solo cambia cuando ENTRA mercadería y se mezcla con lo que TODAVÍA queda:
//   costo nuevo = (unidades que quedan × su costo + unidades que llegan × costo de la compra) ÷ total.
// Vender o quitar unidades no cambia el costo. Cada venta y cada ajuste guarda el costo de su día,
// así la ganancia de una venta vieja ya no cambia cuando llegan compras a otro precio.
// En un mismo día: si lo que había alcanzaba para las salidas, cuentan primero las salidas; si no, primero las entradas.
// ======================================================================
var COSTO = {
  INV_PRECIO: 36, INV_IMP: 37,      // Inventario AJ y AK: costo promedio (compra e importación) que escribe el script
  VEN_COSTO: 24,                    // Ventas X: costo por unidad el día de la venta
  AJ_COSTO: 14,                     // Ajustes N: costo por unidad el día del ajuste
  CAB_INV: ['Costo promedio: compra (lo llena el script)', 'Costo promedio: importación (lo llena el script)'],
  CAB_VEN: 'Costo al vender (lo llena el script)', CAB_AJ: 'Costo unitario (lo llena el script)',
};

/**
 * Cálculo puro (se prueba con node).
 * productos: [{ref, inicial, precio, imp}]   (stock inicial y su costo, de Inventario O, AC, AD)
 * compras:   [{dia, ref, cantidad, precio, imp}]   (solo las "Recibido"; imp = envío + aduana + otros por unidad)
 * ventas:    [{dia, ref, cantidad, fila}]
 * ajustes:   [{dia, ref, cantidad (+ sobra / − falta), fila}]
 * Devuelve { productos: {ref: {precio, imp, conocido, stock}}, ventas: {fila: costo}, ajustes: {fila: costo} }
 */
function posCostosCalcular_(productos, compras, ventas, ajustes) {
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var est = {}, eventos = {};
  productos.forEach(function (p) {
    var conocido = posNum_(p.precio) > 0 || posNum_(p.imp) > 0;
    est[p.ref] = { stock: Math.max(0, posNum_(p.inicial)), precio: posNum_(p.precio), imp: posNum_(p.imp), conocido: conocido };
    eventos[p.ref] = [];
  });
  var sinDia = 9e9, orden = 0;
  compras.forEach(function (c) { if (eventos[c.ref] && c.cantidad > 0) eventos[c.ref].push({ dia: c.dia == null ? sinDia : c.dia, e: true, c: c.cantidad, precio: c.precio, imp: c.imp, n: orden++ }); });
  ventas.forEach(function (v) { if (eventos[v.ref] && v.cantidad > 0) eventos[v.ref].push({ dia: v.dia == null ? sinDia : v.dia, e: false, c: v.cantidad, venta: v.fila, n: orden++ }); });
  ajustes.forEach(function (a) {
    if (!eventos[a.ref] || !a.cantidad) return;
    if (a.cantidad < 0) eventos[a.ref].push({ dia: a.dia == null ? sinDia : a.dia, e: false, c: -a.cantidad, ajuste: a.fila, n: orden++ });
    else eventos[a.ref].push({ dia: a.dia == null ? sinDia : a.dia, e: true, sobra: true, c: a.cantidad, ajuste: a.fila, n: orden++ });
  });
  var outV = {}, outA = {};
  Object.keys(eventos).forEach(function (ref) {
    var s = est[ref];
    var evs = eventos[ref].sort(function (a, b) { return a.dia - b.dia || a.n - b.n; });
    var i = 0;
    while (i < evs.length) {
      var j = i; while (j < evs.length && evs[j].dia === evs[i].dia) j++;
      var dia = evs.slice(i, j);
      var salidas = dia.filter(function (x) { return !x.e; }), entradas = dia.filter(function (x) { return x.e; });
      var totalSal = salidas.reduce(function (t, x) { return t + x.c; }, 0);
      var orden2 = s.stock >= totalSal ? salidas.concat(entradas) : entradas.concat(salidas);
      orden2.forEach(function (x) {
        if (x.e && !x.sobra) {                       // compra recibida
          var antes = Math.max(0, s.stock);
          if (!s.conocido || antes === 0) { s.precio = posNum_(x.precio); s.imp = posNum_(x.imp); }
          else { s.precio = (antes * s.precio + x.c * posNum_(x.precio)) / (antes + x.c); s.imp = (antes * s.imp + x.c * posNum_(x.imp)) / (antes + x.c); }
          s.conocido = true; s.stock = antes + x.c;
        } else if (x.e) {                            // sobrante: entra al costo de ese momento
          if (s.conocido) outA[x.ajuste] = r2(s.precio + s.imp);
          s.stock += x.c;
        } else {                                     // venta o faltante
          var costo = s.conocido ? r2(s.precio + s.imp) : null;
          if (x.venta != null && costo != null) outV[x.venta] = costo;
          if (x.ajuste != null && costo != null) outA[x.ajuste] = costo;
          s.stock -= x.c;
        }
      });
      i = j;
    }
  });
  var outP = {};
  var r4 = function (n) { return Math.round(n * 10000) / 10000; };   // 4 decimales: la suma (Costo real) sale exacta al centavo
  Object.keys(est).forEach(function (ref) { var s = est[ref]; outP[ref] = { precio: r4(s.precio), imp: r4(s.imp), conocido: s.conocido, stock: s.stock }; });
  return { productos: outP, ventas: outV, ajustes: outA };
}

// Lee la hoja, calcula y escribe solo lo que cambió. Devuelve cuántas celdas actualizó.
function posRecalcularCostos_(ss) {
  if (PropertiesService.getScriptProperties().getProperty('POS_COSTOS') !== '1') return 0;
  var inv = ss.getSheetByName(POS.INV), ven = ss.getSheetByName(POS.VENTAS), aj = ss.getSheetByName(POS.AJ), com = ss.getSheetByName('Compras');
  if (!inv || !ven || inv.getMaxColumns() < COSTO.INV_IMP || ven.getMaxColumns() < COSTO.VEN_COSTO) return 0;   // todavía no instalado
  var nInv = POS.FIN_INV - POS.PRIMERA + 1;
  var vi = inv.getRange(POS.PRIMERA, 1, nInv, 30).getValues();
  var productos = [], filaDe = {};
  vi.forEach(function (f, k) {
    var ref = String(f[I.REF - 1] || ''); if (f[0] === '' || f[0] == null || !ref) return;   // un SKU 0 también cuenta
    filaDe[ref] = k;
    productos.push({ ref: ref, inicial: posNum_(f[14]), precio: posNum_(f[28]), imp: posNum_(f[29]) });   // O, AC, AD
  });
  var compras = [];
  if (com && com.getLastRow() >= POS.PRIMERA) {
    com.getRange(POS.PRIMERA, 1, com.getLastRow() - POS.PRIMERA + 1, 14).getValues().forEach(function (f) {
      if (String(f[11]) !== 'Recibido' || !f[3]) return;
      var dia = posDia_(f[13] instanceof Date || typeof f[13] === 'number' ? f[13] : f[0]);   // fecha de recepción, o la del pedido
      compras.push({ dia: dia, ref: String(f[3]), cantidad: posNum_(f[4]), precio: posNum_(f[5]), imp: posNum_(f[7]) + posNum_(f[8]) + posNum_(f[9]) });
    });
  }
  var ultV = posUltima_(ven, V.PRODUCTO, POS.FIN_VENTAS);
  var ventas = [];
  var vv = ultV >= POS.PRIMERA ? ven.getRange(POS.PRIMERA, 1, ultV - POS.PRIMERA + 1, V.CANT).getValues() : [];
  vv.forEach(function (f, k) { if (f[V.PRODUCTO - 1]) ventas.push({ dia: posDia_(f[0]), ref: String(f[V.PRODUCTO - 1]), cantidad: posNum_(f[V.CANT - 1]), fila: k }); });
  var ajustes = [], ultA = aj ? posUltima_(aj, 2, POS.FIN_AJ) : 0;
  var va = aj && ultA >= POS.PRIMERA ? aj.getRange(POS.PRIMERA, 1, ultA - POS.PRIMERA + 1, 3).getValues() : [];
  va.forEach(function (f, k) { if (f[1]) ajustes.push({ dia: posDia_(f[0]), ref: String(f[1]), cantidad: posNum_(f[2]), fila: k }); });

  var r = posCostosCalcular_(productos, compras, ventas, ajustes);
  var cambios = 0;
  // Inventario AJ:AK
  var actualP = inv.getRange(POS.PRIMERA, COSTO.INV_PRECIO, nInv, 2).getValues();
  var nuevoP = actualP.map(function (fila, k) {
    var ref = String(vi[k][I.REF - 1] || ''); var p = r.productos[ref];
    return p && p.conocido ? [p.precio, p.imp] : ['', ''];
  });
  cambios += posEscribirCambios_(inv, POS.PRIMERA, COSTO.INV_PRECIO, actualP, nuevoP);
  // Ventas X
  if (vv.length) {
    var actualV = ven.getRange(POS.PRIMERA, COSTO.VEN_COSTO, vv.length, 1).getValues();
    var nuevoV = vv.map(function (f, k) { return [r.ventas.hasOwnProperty(k) ? r.ventas[k] : '']; });
    cambios += posEscribirCambios_(ven, POS.PRIMERA, COSTO.VEN_COSTO, actualV, nuevoV);
  }
  // Ajustes N
  if (va.length && aj.getMaxColumns() >= COSTO.AJ_COSTO) {
    var actualA = aj.getRange(POS.PRIMERA, COSTO.AJ_COSTO, va.length, 1).getValues();
    var nuevoA = va.map(function (f, k) { return [r.ajustes.hasOwnProperty(k) ? r.ajustes[k] : '']; });
    cambios += posEscribirCambios_(aj, POS.PRIMERA, COSTO.AJ_COSTO, actualA, nuevoA);
  }
  return cambios;
}

// Escribe por tramos solo las filas que cambiaron (así la hoja recalcula lo mínimo)
function posEscribirCambios_(hoja, fila0, col, actual, nuevo) {
  var igual = function (a, b) { return a.length === b.length && a.every(function (x, i) { return (x === '' && b[i] === '') || (typeof x === 'number' && typeof b[i] === 'number' && Math.abs(x - b[i]) < 0.005) || x === b[i]; }); };
  var cambios = 0, k = 0;
  while (k < nuevo.length) {
    if (igual(actual[k], nuevo[k])) { k++; continue; }
    var fin = k; while (fin + 1 < nuevo.length && !igual(actual[fin + 1], nuevo[fin + 1])) fin++;
    hoja.getRange(fila0 + k, col, fin - k + 1, nuevo[k].length).setValues(nuevo.slice(k, fin + 1));
    cambios += fin - k + 1; k = fin + 1;
  }
  return cambios;
}

// Instala el método una sola vez: columnas nuevas al final y fórmulas que usan el costo del script.
// No borra nada: las fórmulas viejas quedan como respaldo por si un perfume todavía no tiene costo calculado.
function posInstalarCostos_(ss) {
  var inv = posHoja_(ss, POS.INV), ven = posHoja_(ss, POS.VENTAS), aj = posHoja_(ss, POS.AJ);
  var asegurar = function (h, n) { if (h.getMaxColumns() < n) h.insertColumnsAfter(h.getMaxColumns(), n - h.getMaxColumns()); };
  var cabecera = function (h, col, txt, deCol) {
    var c = h.getRange(3, col);
    if (String(c.getValue()) === txt) return;
    h.getRange(3, deCol).copyTo(c, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    c.setValue(txt);
  };
  // Inventario: AJ, AK + I y J leen de ahí
  asegurar(inv, COSTO.INV_IMP);
  cabecera(inv, COSTO.INV_PRECIO, COSTO.CAB_INV[0], 32); cabecera(inv, COSTO.INV_IMP, COSTO.CAB_INV[1], 32);
  var nInv = POS.FIN_INV - POS.PRIMERA + 1;
  ['I', 'J'].forEach(function (letra, k) {
    var col = k === 0 ? 9 : 10, aux = k === 0 ? '$AJ' : '$AK';
    var rango = inv.getRange(POS.PRIMERA, col, nInv, 1);
    var fs = rango.getFormulas();
    var cambio = false;
    var nuevas = fs.map(function (f, i) {
      var r = POS.PRIMERA + i, x = f[0];
      if (!x || x.indexOf('ISNUMBER(' + aux + r + ')') >= 0) return [x];
      cambio = true;
      return ['=IF(ISNUMBER(' + aux + r + '),' + aux + r + ',' + x.slice(1) + ')'];
    });
    if (cambio) rango.setFormulas(nuevas);
  });
  // Ventas: W (tipo) y X (costo al vender); la ganancia usa X
  posColumnaTipo_(ven);
  asegurar(ven, COSTO.VEN_COSTO);
  cabecera(ven, COSTO.VEN_COSTO, COSTO.CAB_VEN, V.BANCO);
  var nV = POS.FIN_VENTAS - POS.PRIMERA + 1;
  var fg = [];
  for (var i = 0; i < nV; i++) {
    var r = POS.PRIMERA + i;
    fg.push(['=IF($F' + r + '="","",J' + r + '-(G' + r + '*IF(ISNUMBER($X' + r + '),$X' + r + ',IFERROR(INDEX(Inventario!$K$4:$K$303,MATCH($F' + r + ',Inventario!$W$4:$W$303,0)),0))))']);
  }
  ven.getRange(POS.PRIMERA, V.GANANCIA, nV, 1).setFormulas(fg);
  // Ajustes: N (costo unitario) y el valor al costo lo usa
  asegurar(aj, COSTO.AJ_COSTO);
  cabecera(aj, COSTO.AJ_COSTO, COSTO.CAB_AJ, 6);
  aj.getRange('F4').setFormula('=ARRAYFORMULA(IF((B4:B503="")+(C4:C503=""),"",C4:C503*IF(ISNUMBER(N4:N503),N4:N503,IFERROR(VLOOKUP(B4:B503,{Inventario!W4:W303,Inventario!K4:K303},2,FALSE),0))))');
  // Instrucciones de la hoja Revisión
  var rev = ss.getSheetByName('Revisión');
  if (rev) {
    var t18 = String(rev.getRange('A18').getValue()), t19 = String(rev.getRange('A19').getValue()), t21 = String(rev.getRange('A21').getValue());
    if (/promedio ponderado/.test(t18)) rev.getRange('A18').setValue(t18.replace('recalcula el costo promedio ponderado', 'recalcula el costo promedio de lo que hay en stock'));
    if (/costo real promedio/.test(t19)) rev.getRange('A19').setValue(t19.replace('La ganancia usa el costo real promedio.', 'Cada venta guarda el costo del día en que se vendió (columna X): su ganancia ya no cambia.'));
    if (/se recalcula con el costo promedio actual/.test(t21)) rev.getRange('A21').setValue('Nota: el costo promedio lo calcula el script del punto de venta (Inventario AJ:AK, Ventas X, Ajustes N). Si algo no cuadra: menú 🛒 Punto de venta → Recalcular costos.');
  }
  PropertiesService.getScriptProperties().setProperty('POS_COSTOS', '1');
}

// Menú: instala (si hace falta) y recalcula todo
function posMenuCostos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    POS_TZ = ss.getSpreadsheetTimeZone() || POS_TZ;
    var nuevo = PropertiesService.getScriptProperties().getProperty('POS_COSTOS') !== '1';
    if (nuevo) posInstalarCostos_(ss);
    var n = posRecalcularCostos_(ss);
    ui.alert('Costos al día', (nuevo ? 'Se instaló el costo promedio de lo que hay en stock. ' : '') + (n ? 'Se actualizaron ' + n + ' filas.' : 'Todo estaba al día.'), ui.ButtonSet.OK);
  } finally { lock.releaseLock(); }
}

// Al editar a mano Compras, Ventas, Ajustes o el stock/costo inicial del Inventario, el costo se recalcula solo
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var h = e.range.getSheet().getName(), c1 = e.range.getColumn(), c2 = e.range.getLastColumn();
    var toca = function (a, b) { return c1 <= b && c2 >= a; };
    var importa = h === 'Compras' || (h === POS.VENTAS && toca(1, V.CANT)) || (h === POS.AJ && toca(1, 3)) || (h === POS.INV && (toca(1, 1) || toca(15, 15) || toca(29, 30)));
    if (!importa || e.range.getRow() < POS.PRIMERA) return;
    var ss = e.source || SpreadsheetApp.getActiveSpreadsheet();
    POS_TZ = ss.getSpreadsheetTimeZone() || POS_TZ;
    posRecalcularCostos_(ss);
  } catch (err) { /* nunca estorbar la edición */ }
}

// ======================================================================
// Entradas de perfumes y catálogo de la web
// ======================================================================
// El Inventario manda: nombre, precios y stock salen de ahí. La hoja de la web ("Catálogo MN Scents
// (fuente de la web)") recibe sola cada perfume nuevo y los cambios de precio. Lo que se escribe a mano
// en la hoja de la web (notas, descripción, foto, orden, etiqueta, mostrar) nunca se pisa.
var WEB = {
  REPO: 'mnlogisticni-glitch/mnscents-catalogo',
  FLUJO: 'sincronizar.yml',
  PUBLICAR: 38,                                     // Inventario AL: "Publicar en la web" (Sí/No; vacío = Sí)
  CAB_PUBLICAR: 'Publicar en la web (Sí / No)',
  INICIAL_PROV: 31,                                 // Inventario AE (proveedor inicial)
  STOCK_INICIAL: 15,                                // Inventario O
  FORMULAS: ['existencias', 'pedidos_30d'],         // columnas con ARRAYFORMULA en la hoja de la web: nunca se escriben
  NECESARIAS: ['id', 'catalogo', 'nombre', 'marca', 'presentacion', 'precio_detalle_cs', 'precio_detalle_usd', 'precio_mayor_cs', 'precio_mayor_usd', 'estado', 'foto', 'mostrar', 'orden', 'sku_inventario'],
  C: { FECHA: 1, PEDIDO: 2, PROV: 3, PROD: 4, CANT: 5, PRECIO: 6, ENVIO: 8, ADUANA: 9, OTROS: 10, ESTADO: 12, RECIBIDO: 14 },
  FIN_COMPRAS: 1003,
};

function posSku_(v) {
  if (typeof v === 'number') return isFinite(v) ? String(Math.round(v)) : '';
  return String(v == null ? '' : v).trim().replace(/\.0+$/, '');
}
function posClaveTexto_(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }
function posSlug_(s) { return posClaveTexto_(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function posUsd_(cs, tc) { return tc > 0 ? Math.round(cs / tc * 20) / 20 : 0; }     // a 5 centavos, como en la web
// "ARMAF CLUB DE NUIT" → "Armaf Club de Nuit"; "9PM" y "100ML" quedan igual
function posBonito_(s) {
  var chicas = { de: 1, del: 1, la: 1, las: 1, los: 1, el: 1, y: 1, for: 1, of: 1, the: 1, pour: 1, et: 1, en: 1 };
  return posTexto_(s, 80).toLowerCase().split(' ').map(function (w, i) {
    if (!w) return w;
    if (/\d/.test(w) || /^(edp|edt|edc|ml|oz)$/.test(w)) return w.toUpperCase();
    if (i > 0 && chicas[w]) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}
function posPresentacion_(s) {
  var t = posTexto_(s, 60), m = /^(\d+(?:[.,]\d+)?)\s*ml$/i.exec(t);
  return m ? m[1] + ' ml' : t;
}
function posCatalogo_(genero) {
  var g = posClaveTexto_(genero);
  return /^(hombre|caballero)/.test(g) ? 'Caballeros' : /^(mujer|dama)/.test(g) ? 'Damas' : '';
}
function posProveedores_(ss) {
  var h = ss.getSheetByName('Proveedores');
  if (!h) return [];
  return h.getRange(4, 1, 50, 1).getValues().map(function (x) { return posTexto_(x[0], 60); }).filter(String);
}
function posUltimoPedido_(ss) {
  var h = ss.getSheetByName('Compras');
  if (!h) return null;
  var v = h.getRange(POS.PRIMERA, 1, WEB.FIN_COMPRAS - POS.PRIMERA + 1, 2).getValues();
  var num = 0, dia = null;
  for (var i = 0; i < v.length; i++) { var n = posNum_(v[i][1]); if (n >= num && n > 0) { num = n; dia = posDia_(v[i][0]); } }
  return num ? { numero: num, dia: dia } : null;
}
function posWebResumen_() {
  var p = PropertiesService.getScriptProperties();
  var u = null; try { u = JSON.parse(p.getProperty('WEB_ULTIMO') || 'null'); } catch (e) { u = null; }
  return { conectada: !!p.getProperty('WEB_ID'), github: !!p.getProperty('GITHUB_TOKEN'), pendientes: (u && u.pendientes) || [], cuando: (u && u.cuando) || '' };
}

// ---------------- la hoja de la web ----------------
function posWebHoja_() {
  var id = PropertiesService.getScriptProperties().getProperty('WEB_ID');
  if (!id) throw new Error('La hoja de la web no está conectada (menú 🛒 Punto de venta → Conectar con la hoja de la web).');
  return SpreadsheetApp.openById(id).getSheets()[0];
}
function posWebLeer_(web) {
  var ult = Math.max(web.getLastRow(), 1), nc = web.getMaxColumns();
  var vals = web.getRange(1, 1, ult, nc).getValues();
  var cab = vals[0].map(function (x) { return String(x).trim(); });
  var col = {};
  cab.forEach(function (c, i) { if (c && !(c in col)) col[c] = i; });
  var faltan = WEB.NECESARIAS.filter(function (c) { return !(c in col); });
  if (faltan.length) throw new Error('A la hoja de la web le faltan las columnas: ' + faltan.join(', ') + '. No cambies los títulos de la fila 1.');
  var filas = vals.slice(1), porSku = {}, ultima = 1;
  filas.forEach(function (f, i) {
    var r = i + 2;
    if (String(f[col.id]).trim() !== '' || String(f[col.nombre]).trim() !== '') ultima = r;
    var s = posSku_(f[col.sku_inventario]);
    if (s && !(s in porSku)) porSku[s] = r;
  });
  return { cab: cab, col: col, filas: filas, porSku: porSku, ultima: ultima };
}
// Escribe una fila de la web por tramos, saltando las columnas con fórmula
function posWebEscribirFila_(web, w, r, datos) {
  var n = w.cab.length, fila = [];
  for (var j = 0; j < n; j++) fila.push(w.cab[j] in datos ? datos[w.cab[j]] : null);
  var j0 = 0;
  while (j0 < n) {
    if (fila[j0] === null || WEB.FORMULAS.indexOf(w.cab[j0]) >= 0) { j0++; continue; }
    var j1 = j0;
    while (j1 + 1 < n && fila[j1 + 1] !== null && WEB.FORMULAS.indexOf(w.cab[j1 + 1]) < 0) j1++;
    web.getRange(r, j0 + 1, 1, j1 - j0 + 1).setValues([fila.slice(j0, j1 + 1)]);
    j0 = j1 + 1;
  }
}

/**
 * Pasa el Inventario a la hoja de la web.
 * - Perfume del Inventario que no está en la web (por SKU) → fila nueva en "Coming soon" (o "Disponible" si ya hay stock).
 * - Precio de venta (L) o mayorista (AH) distinto → actualiza C$ y US$ en la web.
 * - "Coming soon" con unidades en el Inventario → "Disponible".
 * opciones.extras[sku] = { nombre, marca, presentacion, notas, descripcion, foto } para perfumes nuevos de la app.
 * opciones.fotos[sku] = nombre de foto nueva para un perfume que ya está en la web.
 */
function posWebSincronizar_(ss, web, opciones) {
  opciones = opciones || {};
  var extras = opciones.extras || {}, fotos = opciones.fotos || {};
  var tc = posNum_(posHoja_(ss, POS.CONF).getRange(5, 2).getValue());
  if (!(tc > 0)) throw new Error('Falta el tipo de cambio en Configuración (B5).');
  var inv = posHoja_(ss, POS.INV);
  var nc = Math.min(inv.getMaxColumns(), WEB.PUBLICAR);
  var vals = inv.getRange(POS.PRIMERA, 1, POS.FIN_INV - POS.PRIMERA + 1, nc).getValues();
  var w = posWebLeer_(web), col = w.col;
  var res = { agregados: [], precios: [], disponibles: [], fotos: [], pendientes: [], cambios: 0 };

  var cuenta = {};
  vals.forEach(function (f) { var s = posSku_(f[I.SKU - 1]); if (s && String(f[I.NOMBRE - 1]).trim()) cuenta[s] = (cuenta[s] || 0) + 1; });
  // próximos id (H01…, D01…) y orden por catálogo
  var maxId = { Caballeros: 0, Damas: 0 }, maxOrden = { Caballeros: 0, Damas: 0 };
  w.filas.forEach(function (f) {
    var cat = posCatalogo_(f[col.catalogo]) || (/^dam/i.test(String(f[col.catalogo])) ? 'Damas' : '');
    var m = /^([HD])(\d+)$/i.exec(String(f[col.id]).trim());
    if (m) { var k = m[1].toUpperCase() === 'H' ? 'Caballeros' : 'Damas'; maxId[k] = Math.max(maxId[k], +m[2]); }
    if (cat) maxOrden[cat] = Math.max(maxOrden[cat], posNum_(f[col.orden]));
  });
  var ids = {}; w.filas.forEach(function (f) { ids[String(f[col.id]).trim()] = 1; });
  var dos = function (n) { return n < 10 ? '0' + n : String(n); };
  var vistos = {};
  var siguiente = w.ultima + 1;

  vals.forEach(function (f, i) {
    var sku = posSku_(f[I.SKU - 1]), nombreInv = posTexto_(f[I.NOMBRE - 1], 80);
    if (!sku || !nombreInv) return;
    if (vistos[sku]) return; vistos[sku] = 1;
    var publicar = nc >= WEB.PUBLICAR ? posClaveTexto_(f[WEB.PUBLICAR - 1]) : '';
    if (publicar === 'no') return;
    var titulo = posBonito_(f[I.MARCA - 1]) + ' ' + posBonito_(nombreInv);
    if (cuenta[sku] > 1) { res.pendientes.push({ nombre: titulo, sku: sku, motivo: 'El SKU ' + sku + ' está repetido en el Inventario: cada perfume necesita su propio código.' }); return; }
    var precio = posNum_(f[I.PRECIO - 1]), mayor = posNum_(f[I.MAYOR - 1]), stock = posNum_(f[I.STOCK - 1]);
    var r = w.porSku[sku];
    if (r) {
      var fw = w.filas[r - 2], cambio = {};
      if (precio > 0 && Math.abs(posNum_(fw[col.precio_detalle_cs]) - precio) >= 0.5) { cambio.precio_detalle_cs = precio; cambio.precio_detalle_usd = posUsd_(precio, tc); }
      if (mayor > 0 && Math.abs(posNum_(fw[col.precio_mayor_cs]) - mayor) >= 0.5) { cambio.precio_mayor_cs = mayor; cambio.precio_mayor_usd = posUsd_(mayor, tc); }
      if (Object.keys(cambio).length) res.precios.push({ nombre: String(fw[col.nombre]), antes: [posNum_(fw[col.precio_detalle_cs]), posNum_(fw[col.precio_mayor_cs])], ahora: [precio || posNum_(fw[col.precio_detalle_cs]), mayor || posNum_(fw[col.precio_mayor_cs])] });
      if (/^coming/i.test(String(fw[col.estado]).trim()) && stock > 0) { cambio.estado = 'Disponible'; res.disponibles.push(String(fw[col.nombre])); }
      if (fotos[sku]) { cambio.foto = fotos[sku]; res.fotos.push(String(fw[col.nombre])); }
      if (Object.keys(cambio).length) { posWebEscribirFila_(web, w, r, cambio); res.cambios++; }
      return;
    }
    // perfume nuevo para la web
    var x = extras[sku] || {};
    var catalogo = posCatalogo_(f[I.GENERO - 1]);
    var falta = !(precio > 0) ? 'falta el precio de venta (Inventario, columna L)'
      : !(mayor > 0) ? 'falta el precio mayorista (Inventario, columna AH)'
      : mayor > precio ? 'el precio mayorista es más alto que el de detalle'
      : !catalogo ? 'en Género (columna F) elige Hombre o Mujer: la web solo tiene Caballeros y Damas' : '';
    if (falta) { res.pendientes.push({ nombre: titulo, sku: sku, motivo: falta }); return; }
    var letra = catalogo === 'Caballeros' ? 'H' : 'D';
    var id; do { maxId[catalogo]++; id = letra + dos(maxId[catalogo]); } while (ids[id]);
    ids[id] = 1;
    maxOrden[catalogo]++;
    var datos = {
      id: id, catalogo: catalogo,
      nombre: posTexto_(x.nombre, 80) || posBonito_(nombreInv),
      marca: posTexto_(x.marca, 60) || posBonito_(f[I.MARCA - 1]),
      presentacion: posTexto_(x.presentacion, 60) || posPresentacion_(f[I.PRES - 1]),
      notas: posTexto_(x.notas, 200), descripcion: posTexto_(x.descripcion, 600),
      precio_detalle_cs: precio, precio_detalle_usd: posUsd_(precio, tc), precio_mayor_cs: mayor, precio_mayor_usd: posUsd_(mayor, tc),
      estado: stock > 0 ? 'Disponible' : 'Coming soon', foto: posTexto_(x.foto, 120), mostrar: 'Sí', orden: maxOrden[catalogo],
      sku_inventario: /^\d{1,15}$/.test(sku) ? Number(sku) : sku,
    };
    if ('etiqueta' in col) datos.etiqueta = '';
    posWebEscribirFila_(web, w, siguiente, datos);
    w.porSku[sku] = siguiente;
    res.agregados.push({ id: id, nombre: datos.nombre, sku: sku, estado: datos.estado, fila: siguiente });
    siguiente++; res.cambios++;
  });
  return res;
}

// ---------------- GitHub: fotos y publicar al momento ----------------
function posGithub_(metodo, ruta, cuerpo) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return null;
  var o = { method: metodo, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (cuerpo) { o.contentType = 'application/json'; o.payload = JSON.stringify(cuerpo); }
  var r = UrlFetchApp.fetch('https://api.github.com' + ruta, o);
  var d = null; try { d = JSON.parse(r.getContentText() || 'null'); } catch (e) { d = null; }
  return { codigo: r.getResponseCode(), datos: d };
}
// Nombre libre para la foto (si ya existe uno igual, le agrega un sufijo)
function posGithubNombreFoto_(base) {
  var r = posGithub_('get', '/repos/' + WEB.REPO + '/contents/img/productos/' + base + '.webp');
  if (r && r.codigo === 200) base = base + '-' + Date.now().toString(36).slice(-4);
  return base;
}
// Sube la foto a img/entrantes/ (la sincronización de la web le quita el fondo y la pasa a img/productos)
function posGithubFoto_(base, b64) {
  var r = posGithub_('put', '/repos/' + WEB.REPO + '/contents/img/entrantes/' + base + '.jpg', { message: 'Foto nueva desde el punto de venta: ' + base, content: b64 });
  if (!r) throw new Error('GitHub no está conectado.');
  if (r.codigo !== 201 && r.codigo !== 200) throw new Error('GitHub respondió ' + r.codigo + (r.datos && r.datos.message ? ' (' + r.datos.message + ')' : '') + '.');
  return base + '.webp';
}
// Pide a GitHub que actualice la web ya (si no, se actualiza sola cada hora)
function posGithubPublicar_(esperar) {
  var r = posGithub_('post', '/repos/' + WEB.REPO + '/actions/workflows/' + WEB.FLUJO + '/dispatches', { ref: 'main', inputs: { esperar: (esperar || []).join(',').slice(0, 900) || 'cambio' } });
  return !!(r && r.codigo === 204);
}
function posGuardarResumen_(res, ahora) {
  try {
    PropertiesService.getScriptProperties().setProperty('WEB_ULTIMO', JSON.stringify({ pendientes: res.pendientes.slice(0, 20), cuando: Utilities.formatDate(ahora || new Date(), POS.ZONA, 'dd/MM HH:mm') }));
  } catch (e) { /* no importa */ }
}

// ---------------- entrada desde la app ----------------
/**
 * entrada = { id, nuevo, ref (si no es nuevo), sku, marca, nombre, presentacion, genero ('Hombre'|'Mujer'), familia,
 *             nombreWeb, marcaWeb, notas, descripcion,
 *             cantidad, costo, envio, aduana, otros (C$ por unidad), precio, mayor (C$), proveedor, pedido, llego,
 *             foto: { base64 } | null }
 */
function posEntrada_(ss, ent, ahora) {
  if (!ent) throw new Error('Faltan los datos de la entrada.');
  var r2 = function (n) { return Math.round(posNum_(n) * 100) / 100; };
  var cant = Math.round(posNum_(ent.cantidad));
  var costo = r2(ent.costo), envio = r2(ent.envio), aduana = r2(ent.aduana), otros = r2(ent.otros);
  var precio = r2(ent.precio), mayor = r2(ent.mayor);
  if (cant < 1 || cant > 999) throw new Error('La cantidad debe ser de 1 a 999.');
  if (!(costo > 0)) throw new Error('Falta el precio que te costó cada unidad.');
  if (envio < 0 || aduana < 0 || otros < 0) throw new Error('Los gastos no pueden ser negativos.');
  if (!(precio > 0)) throw new Error('Falta el precio de venta al detalle.');
  if (!(mayor > 0)) throw new Error('Falta el precio por mayor.');
  if (mayor > precio) throw new Error('El precio por mayor no puede ser más alto que el de detalle.');
  var inv = posHoja_(ss, POS.INV), com = posHoja_(ss, 'Compras');
  if (inv.getMaxColumns() < WEB.PUBLICAR) inv.insertColumnsAfter(inv.getMaxColumns(), WEB.PUBLICAR - inv.getMaxColumns());
  var n = POS.FIN_INV - POS.PRIMERA + 1;
  var vals = inv.getRange(POS.PRIMERA, 1, n, I.MAYOR).getValues();
  var fila, ref, sku, avisos = [];

  if (ent.nuevo) {
    sku = posTexto_(ent.sku, 30);
    if (!sku) throw new Error('Falta el código (SKU o código de barras).');
    if (!/^[0-9A-Za-z][0-9A-Za-z .-]*$/.test(sku)) throw new Error('El código solo puede tener números, letras, espacios, puntos o guiones.');
    var marca = posTexto_(ent.marca, 40).toUpperCase(), nombre = posTexto_(ent.nombre, 60).toUpperCase(), pres = posTexto_(ent.presentacion, 30).toUpperCase();
    var genero = posCatalogo_(ent.genero) === 'Caballeros' ? 'Hombre' : posCatalogo_(ent.genero) === 'Damas' ? 'Mujer' : '';
    if (!marca || !nombre) throw new Error('Faltan la marca y el nombre del perfume.');
    if (!genero) throw new Error('Elige si es de Caballeros o de Damas.');
    for (var i = 0; i < n; i++) {
      if (posSku_(vals[i][I.SKU - 1]) === posSku_(sku)) throw new Error('Ese código ya es de ' + posBonito_(vals[i][I.MARCA - 1]) + ' ' + posBonito_(vals[i][I.NOMBRE - 1]) + '. Para sumarle unidades usa "Perfume que ya tengo".');
    }
    fila = posUltima_(inv, I.SKU, POS.FIN_INV) + 1;
    if (fila > POS.FIN_INV) throw new Error('El Inventario llegó a su última fila preparada (' + POS.FIN_INV + ').');
    var skuCelda = /^\d{1,15}$/.test(sku) ? Number(sku) : sku;
    inv.getRange(fila, 1, 1, 6).setValues([[skuCelda, marca, nombre, pres, posTexto_(ent.familia, 30), genero]]);
    inv.getRange(fila, I.PRECIO).setValue(precio);
    inv.getRange(fila, WEB.STOCK_INICIAL).setValue(0);
    inv.getRange(fila, I.MAYOR).setValue(mayor);
    inv.getRange(fila, WEB.PUBLICAR).setValue('Sí');
    ref = marca + ' ' + nombre + ' - ' + pres + ' (' + sku + ')';
  } else {
    var refs = inv.getRange(POS.PRIMERA, I.REF, n, 1).getValues();
    for (var k = 0; k < n; k++) {
      var refK = String(refs[k][0]);
      if (refK && refK === String(ent.ref)) { fila = POS.PRIMERA + k; ref = refK; break; }
    }
    if (!fila) throw new Error('Ese perfume ya no está en el Inventario.');
    sku = posSku_(vals[fila - POS.PRIMERA][I.SKU - 1]);
    if (Math.abs(posNum_(vals[fila - POS.PRIMERA][I.PRECIO - 1]) - precio) >= 0.005) inv.getRange(fila, I.PRECIO).setValue(precio);
    if (Math.abs(posNum_(vals[fila - POS.PRIMERA][I.MAYOR - 1]) - mayor) >= 0.005) inv.getRange(fila, I.MAYOR).setValue(mayor);
  }

  // Compras
  var fc = posUltima_(com, WEB.C.PROD, WEB.FIN_COMPRAS) + 1;
  if (fc > WEB.FIN_COMPRAS) throw new Error('La hoja Compras llegó a su última fila preparada (' + WEB.FIN_COMPRAS + ').');
  var hoy = Math.floor(posSerie_(posHoyNica_(ahora)));
  var pedido = Math.round(posNum_(ent.pedido));
  com.getRange(fc, 1, 1, 6).setValues([[hoy, pedido > 0 ? pedido : '', posTexto_(ent.proveedor, 60), ref, cant, costo]]);
  com.getRange(fc, WEB.C.ENVIO, 1, 3).setValues([[envio || '', aduana || '', otros || '']]);
  com.getRange(fc, WEB.C.ESTADO).setValue(ent.llego ? 'Recibido' : 'En tránsito');
  if (ent.llego) com.getRange(fc, WEB.C.RECIBIDO).setValue(hoy);
  com.getRange(fc, 1).setNumberFormat(com.getRange(POS.PRIMERA, 1).getNumberFormat());
  if (ent.llego) com.getRange(fc, WEB.C.RECIBIDO).setNumberFormat(com.getRange(POS.PRIMERA, 1).getNumberFormat());

  // Web: foto (GitHub) y fila (hoja de la web). Si algo falla, la entrada igual quedó guardada.
  var resultado = { fila: fila, ref: ref, sku: sku, compra: fc, avisos: avisos, web: null, publicado: false };
  var props = PropertiesService.getScriptProperties();
  var foto = '';
  if (ent.foto && ent.foto.base64) {
    if (!props.getProperty('GITHUB_TOKEN')) avisos.push('La foto no se subió: falta conectar GitHub (menú 🛒 Punto de venta en la hoja).');
    else {
      try {
        var b64 = String(ent.foto.base64).replace(/^data:[^,]*,/, '');
        if (b64.length > 8e6) throw new Error('la foto es muy pesada');
        var base = posGithubNombreFoto_(posSlug_(ent.nombreWeb || ent.nombre || (ent.nuevo ? '' : ref.replace(/\s*\(.*$/, ''))) || 'perfume');
        foto = posGithubFoto_(base, b64);
      } catch (e) { avisos.push('La foto no se subió (' + (e.message || e) + '). La entrada sí quedó guardada.'); }
    }
  }
  if (props.getProperty('WEB_ID')) {
    try {
      var web = posWebHoja_();
      var op = { extras: {}, fotos: {} };
      if (ent.nuevo) op.extras[posSku_(sku)] = { nombre: ent.nombreWeb, marca: ent.marcaWeb, presentacion: ent.presentacionWeb, notas: ent.notas, descripcion: ent.descripcion, foto: foto };
      else if (foto) op.fotos[posSku_(sku)] = foto;
      var res = posWebSincronizar_(ss, web, op);
      posGuardarResumen_(res, ahora);
      var nuevo = res.agregados.filter(function (a) { return a.sku === posSku_(sku); })[0];
      resultado.web = { agregado: nuevo || null, precios: res.precios.length, pendiente: res.pendientes.filter(function (p) { return p.sku === posSku_(sku); })[0] || null };
      if (res.cambios || foto) resultado.publicado = posGithubPublicar_(res.agregados.map(function (a) { return a.id; }));
    } catch (e) { avisos.push('No pude actualizar la hoja de la web (' + (e.message || e) + '). Se intentará sola en unos minutos.'); }
  } else avisos.push('La hoja de la web no está conectada: el perfume no se agregó a la web.');
  return resultado;
}

// ---------------- menús y disparador ----------------
function posWebConectar() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  var r = ui.prompt('Conectar con la hoja de la web', 'Pega el enlace de la hoja "Catálogo MN Scents (fuente de la web)" (el que ves en la barra del navegador cuando la abres).', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(r.getResponseText()) || /^([A-Za-z0-9_-]{20,})$/.exec(String(r.getResponseText()).trim());
  if (!m) { ui.alert('Ese enlace no sirve', 'Debe ser el enlace de una hoja de Google (https://docs.google.com/spreadsheets/d/…).', ui.ButtonSet.OK); return; }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (m[1] === ss.getId()) { ui.alert('Ese es el enlace de esta misma hoja. Pega el de la hoja de la web.'); return; }
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var web = SpreadsheetApp.openById(m[1]).getSheets()[0];
    posWebLeer_(web);                                  // revisa que tenga las columnas de la web
    props.setProperty('WEB_ID', m[1]);
    var inst = posWebInstalar_(ss, web);
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'posWebCadaRato') ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger('posWebCadaRato').timeBased().everyMinutes(10).create();
    var res = posWebSincronizar_(ss, web, {});
    posGuardarResumen_(res);
    if (res.cambios) posGithubPublicar_(res.agregados.map(function (a) { return a.id; }));
    ui.alert('Hoja de la web conectada', posWebTextoResumen_(res) + (inst ? '\n\n' + inst : '') + '\n\nDesde ahora se revisa sola cada 10 minutos.', ui.ButtonSet.OK);
  } finally { lock.releaseLock(); }
}
function posWebMenuSincronizar() {
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var res = posWebSincronizar_(ss, posWebHoja_(), {});
    posGuardarResumen_(res);
    var pub = res.cambios ? posGithubPublicar_(res.agregados.map(function (a) { return a.id; })) : false;
    ui.alert('Web', posWebTextoResumen_(res) + (res.cambios ? (pub ? '\n\nLa web se actualiza en unos minutos.' : '\n\nLa web se actualiza en menos de una hora.') : ''), ui.ButtonSet.OK);
  } finally { lock.releaseLock(); }
}
// Disparador cada 10 minutos
function posWebCadaRato() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    POS_TZ = ss.getSpreadsheetTimeZone() || POS_TZ;
    var res = posWebSincronizar_(ss, posWebHoja_(), {});
    posGuardarResumen_(res);
    if (res.cambios) posGithubPublicar_(res.agregados.map(function (a) { return a.id; }));
  } finally { lock.releaseLock(); }
}
function posWebTextoResumen_(res) {
  var t = [];
  if (res.agregados.length) t.push('Perfumes nuevos en la web: ' + res.agregados.map(function (a) { return a.nombre + ' (' + a.estado + ')'; }).join(', ') + '.');
  if (res.precios.length) t.push('Precios actualizados: ' + res.precios.map(function (p) { return p.nombre; }).join(', ') + '.');
  if (res.disponibles.length) t.push('Pasaron a Disponible: ' + res.disponibles.join(', ') + '.');
  if (res.pendientes.length) t.push('No se pudieron subir:\n' + res.pendientes.map(function (p) { return '• ' + p.nombre + ': ' + p.motivo; }).join('\n'));
  return t.length ? t.join('\n\n') : 'La web ya estaba al día.';
}
function posGithubConectar() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  var r = ui.prompt('Conectar GitHub', 'Pega la clave de GitHub (empieza con github_pat_). Se guarda solo dentro de este script, no en la hoja ni en la web.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = String(r.getResponseText() || '').trim();
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(t)) { ui.alert('Esa clave no parece de GitHub', 'Debe empezar con github_pat_.', ui.ButtonSet.OK); return; }
  var antes = props.getProperty('GITHUB_TOKEN');
  props.setProperty('GITHUB_TOKEN', t);
  var prueba = posGithub_('get', '/repos/' + WEB.REPO + '/actions/workflows/' + WEB.FLUJO);
  if (!prueba || prueba.codigo !== 200) {
    if (antes) props.setProperty('GITHUB_TOKEN', antes); else props.deleteProperty('GITHUB_TOKEN');
    ui.alert('No funcionó', 'GitHub respondió ' + (prueba ? prueba.codigo : '—') + '. Revisa que la clave tenga acceso al repositorio mnscents-catalogo con permisos de Contents y Actions (lectura y escritura).', ui.ButtonSet.OK);
    return;
  }
  ui.alert('GitHub conectado', 'Listo: las fotos de la app se suben a la web y los cambios se publican en minutos.', ui.ButtonSet.OK);
}

// Instala una vez: columna AL "Publicar en la web", precio mayorista fijo en el Inventario y la ganancia mínima por mayor.
function posWebInstalar_(ss, web) {
  var inv = posHoja_(ss, POS.INV), hecho = [];
  if (inv.getMaxColumns() < WEB.PUBLICAR) inv.insertColumnsAfter(inv.getMaxColumns(), WEB.PUBLICAR - inv.getMaxColumns());
  var cab = inv.getRange(3, WEB.PUBLICAR);
  if (String(cab.getValue()) !== WEB.CAB_PUBLICAR) { inv.getRange(3, 32).copyTo(cab, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); cab.setValue(WEB.CAB_PUBLICAR); }
  var n = POS.FIN_INV - POS.PRIMERA + 1;
  var w = posWebLeer_(web);
  // AL: los que ya están en la web = Sí; los demás = No (así no aparecen perfumes viejos sin querer)
  var a = inv.getRange(POS.PRIMERA, 1, n, 1).getValues(), al = inv.getRange(POS.PRIMERA, WEB.PUBLICAR, n, 1).getValues();
  var marcados = 0;
  var nuevoAl = al.map(function (x, i) {
    var s = posSku_(a[i][0]);
    if (!s || String(x[0]).trim() !== '') return [x[0]];
    marcados++;
    return [w.porSku[s] ? 'Sí' : 'No'];
  });
  if (marcados) inv.getRange(POS.PRIMERA, WEB.PUBLICAR, n, 1).setValues(nuevoAl);
  try {
    var regla = SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No'], true).setAllowInvalid(false).build();
    inv.getRange(POS.PRIMERA, WEB.PUBLICAR, n, 1).setDataValidation(regla);
  } catch (e) { /* sin validación no pasa nada */ }
  // AH: deja de venir de la web (IMPORTRANGE) y pasa a ser un valor del Inventario
  var ah = inv.getRange(POS.PRIMERA, I.MAYOR, n, 1);
  var f0 = String(inv.getRange(POS.PRIMERA, I.MAYOR).getFormula() || '');
  if (/IMPORTRANGE/i.test(f0)) {
    var valores = ah.getValues().map(function (x, i) { return [posSku_(a[i][0]) && posNum_(x[0]) > 0 ? posNum_(x[0]) : '']; });
    ah.clearContent();
    ah.setValues(valores);
    inv.getRange(3, I.MAYOR).setNote('Precio mayorista: escríbelo aquí (o desde la app). La hoja de la web lo copia sola.');
    hecho.push('El precio mayorista (columna AH) ahora se escribe en el Inventario y la web lo copia.');
  }
  var t2 = String(inv.getRange('A2').getValue());
  if (t2 && t2.indexOf('Publicar en la web') < 0) inv.getRange('A2').setValue(t2 + '  WEB: un perfume con precio de venta (L), precio mayorista (AH) y Género Hombre o Mujer se agrega solo a la web en "Coming soon" y pasa a Disponible cuando hay stock. Columna AL "Publicar en la web": No = no lo agrega.');
  // Configuración: ganancia mínima por perfume al mayor (para el aviso de la app)
  var conf = posHoja_(ss, POS.CONF);
  if (String(conf.getRange(11, 1).getValue()).trim() === '' && String(conf.getRange(11, 2).getValue()).trim() === '') {
    conf.getRange(11, 1, 1, 2).setValues([['Ganancia mínima por perfume al mayor (C$)', 185]]);
    hecho.push('En Configuración (fila 11) quedó la ganancia mínima por perfume al mayor: C$185. La app te avisa si un precio queda por debajo.');
  }
  PropertiesService.getScriptProperties().setProperty('POS_WEB', '1');
  return hecho.join('\n');
}
