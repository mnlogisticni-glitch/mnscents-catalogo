// Comparar dos perfumes: todo sale de los datos de la hoja (precios, notas, presentación, estado).

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function comparar(a, b) {
  const na = new Map(a.notas.map(n => [norm(n), n]));
  const nb = new Map(b.notas.map(n => [norm(n), n]));
  const comunes = [...na.keys()].filter(k => nb.has(k)).map(k => na.get(k));
  const soloA = [...na.keys()].filter(k => !nb.has(k)).map(k => na.get(k));
  const soloB = [...nb.keys()].filter(k => !na.has(k)).map(k => nb.get(k));
  const barato = nivel => {
    const x = a.precios[nivel].cs, y = b.precios[nivel].cs;
    return x < y ? a.id : y < x ? b.id : null;
  };
  return {
    comunes, soloA, soloB,
    difDetalleCS: Math.abs(a.precios.detalle.cs - b.precios.detalle.cs),
    difMayorCS: Math.abs(a.precios.mayor.cs - b.precios.mayor.cs),
    masBaratoDetalle: barato('detalle'),
    masBaratoMayor: barato('mayor'),
  };
}

// Con qué comparar: primero del mismo catálogo y con más notas en común
export function candidatos(productos, a) {
  const notasA = new Set(a.notas.map(norm));
  const comun = p => p.notas.filter(n => notasA.has(norm(n))).length;
  const pesoEstado = { disponible: 0, coming_soon: 1, agotado: 2 };
  return productos
    .filter(p => p.id !== a.id)
    .sort((x, y) => ((y.catalogo === a.catalogo) - (x.catalogo === a.catalogo))
      || (comun(y) - comun(x))
      || ((pesoEstado[x.estado] ?? 3) - (pesoEstado[y.estado] ?? 3))
      || (x.orden - y.orden));
}

// "#comparar=H10,H09" sin confiar en él: solo códigos válidos, distintos, máximo dos
export function leerComparar(texto) {
  const ids = [];
  for (const parte of String(texto || '').split(',').slice(0, 2)) {
    const id = parte.trim();
    if (/^[A-Za-z0-9]{1,12}$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
