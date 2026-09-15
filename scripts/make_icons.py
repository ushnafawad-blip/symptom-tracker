import struct, zlib, os

def make_png(path, size, bg=(174, 67, 30), fg=(255, 255, 255)):
    w = h = size
    pixels = bytearray()
    cx, cy = w / 2, h / 2
    r_outer = w * 0.46
    for y in range(h):
        row = bytearray()
        for x in range(w):
            dx, dy = x - cx, y - cy
            dist = (dx * dx + dy * dy) ** 0.5
            if dist > r_outer:
                row += bytes((0, 0, 0, 0))
                continue
            # capsule/pill shape: rotated rounded rect made of two circles + rect
            # simplified: draw a cross (plus sign) for a medical feel
            bar = w * 0.14
            in_v = abs(dx) < bar and abs(dy) < w * 0.30
            in_h = abs(dy) < bar and abs(dx) < w * 0.30
            if in_v or in_h:
                row += bytes(fg) + bytes((255,))
            else:
                row += bytes(bg) + bytes((255,))
        pixels += b'\x00' + bytes(row)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data)))

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(pixels), 9)
    png = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)

base = os.path.join(os.path.dirname(__file__), '..', 'icons')
for size in (192, 512, 180):
    name = f"icon-{size}.png" if size != 180 else "apple-touch-icon.png"
    make_png(os.path.join(base, name), size)
    print("wrote", name)
