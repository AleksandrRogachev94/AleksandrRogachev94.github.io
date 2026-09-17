#!/usr/bin/env python3
"""Rasterise the favicon's raster fallbacks from public/favicon.svg's geometry.

No rasteriser is installed on this machine and none is worth adding: the mark is four
rectangles on a rounded rectangle, so evaluating the geometry directly is exact, whereas
tracing the SVG and resampling is not. Offline art tooling, like everything else in tools/ —
never a site dependency (CLAUDE.md, Conventions). Stdlib only.

The geometry below is the SVG's, in the same 16-unit space. It is duplicated rather than
parsed, which is a real cost: EDIT BOTH. That is the cheaper of the two bad options, because
the alternative is an SVG parser in the build path for a file that changes approximately never.

    python3 tools/favicon.py

Writes public/favicon-32.png, public/apple-touch-icon.png and public/favicon.ico.
"""

import struct
import zlib
from pathlib import Path

# ---- geometry, in the SVG's 16-unit space -----------------------------------------------
UNITS = 16.0
INK = (0x2c, 0x24, 0x1d)                        # --room-ink       frame
DAY = (0xb9, 0xd6, 0xe6)                        # --room-daylight  glass
LINE = (0xd2, 0xc0, 0xa6)                       # --room-line      sill

# Painter's order, bottom to top: (x, y, w, h, corner radius, colour). The body is index 0
# and also defines the mark's alpha; everything after it paints over. This mirrors the SVG
# element for element — see the EDIT BOTH note in the docstring.
BODY_RADIUS = 3.5
LAYERS = [
    (3.0, 2.6, 10.0, 9.2, 0.0, DAY),            # glass
    (7.5, 2.6, 1.0, 9.2, 0.0, INK),             # vertical glazing bar
    (3.0, 6.7, 10.0, 1.0, 0.0, INK),            # horizontal glazing bar
    (2.0, 12.3, 12.0, 1.3, 0.35, LINE),         # sill
]

SS = 4                                          # supersampling, 4x4 = 16 samples per pixel


def _in_rect(x, y, rx, ry, w, h, r):
    """Coverage test for a rounded rectangle. r == 0 degenerates to a plain rect."""
    hw, hh = w / 2.0, h / 2.0
    dx, dy = abs(x - (rx + hw)), abs(y - (ry + hh))
    if dx > hw or dy > hh:
        return False
    qx, qy = dx - (hw - r), dy - (hh - r)
    if qx <= 0.0 or qy <= 0.0:                  # the cross through the middle
        return True
    return qx * qx + qy * qy <= r * r           # the corner quadrants


def _sample(x, y, rounded):
    """Colour at a point, or None outside the body."""
    r = BODY_RADIUS if rounded else 0.0
    if not _in_rect(x, y, 0.0, 0.0, UNITS, UNITS, r):
        return None
    colour = INK
    for lx, ly, lw, lh, lr, c in LAYERS:
        if _in_rect(x, y, lx, ly, lw, lh, lr):
            colour = c
    return colour


def render(size, rounded=True):
    """Return `size` x `size` straight-alpha RGBA bytes."""
    rows = []
    step = UNITS / size
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    c = _sample((px + (sx + 0.5) / SS) * step,
                                (py + (sy + 0.5) / SS) * step, rounded)
                    if c is None:
                        continue
                    r += c[0]; g += c[1]; b += c[2]; a += 1.0
            if a == 0.0:
                row += b"\0\0\0\0"             # fully transparent: colour must be 0 too
            else:
                n = SS * SS
                # r/g/b average over COVERED samples only, so edge pixels keep the mark's
                # colour instead of being dragged toward black by the empty ones.
                row += bytes((round(r / a), round(g / a), round(b / a), round(255 * a / n)))
        rows.append(bytes(row))
    return rows


def png(rows, size):
    """Minimal RGBA PNG. Filter type 0 on every scanline; zlib does the rest."""
    raw = b"".join(b"\0" + r for r in rows)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def ico(entries):
    """ICO wrapping PNGs. Every browser that still asks for .ico reads PNG-in-ICO."""
    head = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    directory, blobs = b"", b""
    for size, blob in entries:
        directory += struct.pack("<BBBBHHII", size & 0xFF, size & 0xFF, 0, 0, 1, 32,
                                 len(blob), offset)
        offset += len(blob)
        blobs += blob
    return head + directory + blobs


def main():
    out = Path(__file__).resolve().parent.parent / "public"
    made = []

    for size in (32,):
        p = out / f"favicon-{size}.png"
        p.write_bytes(png(render(size), size))
        made.append(p)

    # apple-touch-icon is NOT rounded and NOT transparent: iOS applies its own mask and
    # composites anything transparent onto black. Full bleed, square, let the OS round it.
    p = out / "apple-touch-icon.png"
    p.write_bytes(png(render(180, rounded=False), 180))
    made.append(p)

    p = out / "favicon.ico"
    p.write_bytes(ico([(s, png(render(s), s)) for s in (16, 32, 48)]))
    made.append(p)

    for p in made:
        print(f"  {p.relative_to(out.parent)}  {p.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
