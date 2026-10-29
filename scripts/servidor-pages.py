# Servidor local que imita Cloudflare Pages para las pruebas: aplica _headers, _redirects y 404.html.
# Uso: python3 scripts/servidor-pages.py [puerto] [carpeta]
#   MN_DATOS=/ruta/otro.json  sirve ese archivo en lugar de data/productos.json (pruebas con datos maliciosos)
#   MN_INYECTAR_BEACON=1      agrega el script de Cloudflare Web Analytics como lo hace Pages en producción
import os, sys, fnmatch, http.server, functools

PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
RAIZ = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else '.')
BEACON = ('<script defer src="https://static.cloudflareinsights.com/beacon.min.js" '
          'data-cf-beacon=\'{"token": "prueba"}\'></script>')

def leer_headers():
    reglas, actual = [], None
    for linea in open(os.path.join(RAIZ, '_headers'), encoding='utf-8'):
        if not linea.strip() or linea.lstrip().startswith('#'):
            continue
        if not linea.startswith((' ', '\t')):
            actual = (linea.strip(), []); reglas.append(actual)
        elif actual:
            t = linea.strip()
            if t.startswith('!'):                      # "! Cabecera" quita una cabecera puesta por una regla general
                actual[1].append((t[1:].strip(), None)); continue
            k, v = t.split(':', 1); actual[1].append((k.strip(), v.strip()))
    return reglas

def leer_redirects():
    out = []
    ruta = os.path.join(RAIZ, '_redirects')
    if os.path.exists(ruta):
        for linea in open(ruta, encoding='utf-8'):
            p = linea.split('#')[0].split()
            if len(p) >= 2:
                out.append((p[0], p[1], int(p[2]) if len(p) > 2 else 302))
    return out

class Manejador(http.server.SimpleHTTPRequestHandler):
    def _cabeceras_pages(self):
        ruta = self.path.split('?')[0]
        finales = []
        for patron, hs in leer_headers():
            if fnmatch.fnmatch(ruta, patron):
                for k, v in hs:
                    if v is None: finales = [x for x in finales if x[0].lower() != k.lower()]
                    else: finales.append((k, v))
        for k, v in finales:
            self.send_header(k, v)

    def end_headers(self):
        self._cabeceras_pages()
        super().end_headers()

    def _servir(self, cuerpo, tipo, estado=200):
        self.send_response(estado)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(cuerpo)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(cuerpo)

    def do_GET(self):
        ruta = self.path.split('?')[0]
        for origen, destino, codigo in leer_redirects():
            if fnmatch.fnmatch(ruta, origen):
                self.send_response(codigo); self.send_header('Location', destino); self.end_headers(); return
        if ruta == '/data/productos.json' and os.environ.get('MN_DATOS'):
            return self._servir(open(os.environ['MN_DATOS'], 'rb').read(), 'application/json')
        if ruta in ('/', '/index.html') and os.environ.get('MN_INYECTAR_BEACON'):
            html = open(os.path.join(RAIZ, 'index.html'), encoding='utf-8').read().replace('</body>', BEACON + '</body>')
            return self._servir(html.encode(), 'text/html; charset=utf-8')
        local = self.translate_path(ruta)
        # Cloudflare Pages no publica la carpeta .git del repositorio
        if ruta.startswith('/.git/') or ruta == '/.git' or (ruta != '/' and not os.path.exists(local)):
            return self._servir(open(os.path.join(RAIZ, '404.html'), 'rb').read(), 'text/html; charset=utf-8', 404)
        return super().do_GET()

    def _sin_metodo(self):
        self.send_response(405); self.send_header('Allow', 'GET, HEAD'); self.end_headers()
    do_POST = do_PUT = do_DELETE = do_PATCH = _sin_metodo

    def log_message(self, *a):
        pass

if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', PUERTO), functools.partial(Manejador, directory=RAIZ)).serve_forever()
