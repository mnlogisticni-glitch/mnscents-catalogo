#!/usr/bin/env python3
"""MN Scents — fotos que llegan desde el punto de venta (img/entrantes/) → img/productos/<nombre>.webp

Le quita el fondo (rembg, modelo isnet-general-use), recorta el frasco, lo centra en un cuadro de 520 px
(el frasco ocupa el 88 % del alto) y lo guarda en WebP transparente. Si quitar el fondo falla, publica la foto
igual (cuadrada, fondo blanco) para que el perfume no quede sin imagen. Borra la foto original al terminar.
Uso: python3 scripts/fotos-entrantes.py
"""
import sys, pathlib
from PIL import Image, ImageOps

RAIZ = pathlib.Path(__file__).resolve().parent.parent
ENTRA, SALE = RAIZ / 'img' / 'entrantes', RAIZ / 'img' / 'productos'
LADO, ALTO = 520, 0.88

def sin_fondo(im, sesion):
    from rembg import remove
    out = remove(im, session=sesion).convert('RGBA')
    a = out.getchannel('A').point(lambda v: 0 if v < 24 else v)    # limpia restos casi transparentes
    out.putalpha(a)
    caja = a.getbbox()
    if not caja: raise ValueError('no encontré el frasco')
    return out.crop(caja)

def encuadrar(obj, fondo=(0, 0, 0, 0)):
    k = min(LADO * ALTO / obj.height, LADO * 0.92 / obj.width)
    obj = obj.resize((max(1, round(obj.width * k)), max(1, round(obj.height * k))), Image.LANCZOS)
    lienzo = Image.new('RGBA', (LADO, LADO), fondo)
    lienzo.paste(obj, ((LADO - obj.width) // 2, (LADO - obj.height) // 2), obj)
    return lienzo

def main():
    fotos = sorted(p for p in ENTRA.glob('*') if p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp'))
    if not fotos: print('Sin fotos nuevas.'); return 0
    sesion = None
    try:
        from rembg import new_session
        sesion = new_session('isnet-general-use')
    except Exception as e:
        print(f'⚠️  No se pudo cargar el quitafondos ({e}); se publican las fotos con su fondo.')
    for p in fotos:
        nombre = p.stem.lower()
        if not nombre.replace('-', '').isalnum():
            print(f'⚠️  Nombre raro, se ignora: {p.name}'); p.unlink(); continue
        im = ImageOps.exif_transpose(Image.open(p)).convert('RGB')
        try:
            if sesion is None: raise RuntimeError('sin quitafondos')
            final = encuadrar(sin_fondo(im, sesion))
            como = 'sin fondo'
        except Exception as e:
            lado = max(im.size)
            cuadro = Image.new('RGB', (lado, lado), (255, 255, 255)); cuadro.paste(im, ((lado - im.width) // 2, (lado - im.height) // 2))
            final = cuadro.resize((LADO, LADO), Image.LANCZOS).convert('RGBA')
            como = f'con su fondo ({e})'
        destino = SALE / f'{nombre}.webp'
        final.save(destino, 'WEBP', quality=88, method=6)
        p.unlink()
        print(f'✓ {destino.name} ({como})')
    return 0

if __name__ == '__main__':
    sys.exit(main())
