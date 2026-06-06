#!/usr/bin/env python3
"""Generate the PWA / home-screen icons with no third-party deps.

Draws concentric gold pentagons (a stylised dodecahedron face) on the app's
dark background, then writes PNGs by hand via zlib. Run from the repo root:

    python3 scripts/make_icons.py
"""
import math
import os
import struct
import zlib

BG = (11, 11, 20)        # #0b0b14
GOLD = (217, 177, 90)    # #d9b15a
DARK = (20, 18, 31)      # inner pentagon (#14121f)


def pentagon(cx, cy, r):
    return [
        (cx + r * math.sin(2 * math.pi * k / 5),
         cy - r * math.cos(2 * math.pi * k / 5))
        for k in range(5)
    ]


def in_poly(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def render(size):
    cx = cy = size / 2.0
    r = size * 0.40
    outer = pentagon(cx, cy, r)
    mid = pentagon(cx, cy, r * 0.62)
    inner = pentagon(cx, cy, r * 0.26)
    rows = []
    ss = 2  # supersample for smoother edges
    for py in range(size):
        row = bytearray()
        for px in range(size):
            rt = gt = bt = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = px + (sx + 0.5) / ss
                    y = py + (sy + 0.5) / ss
                    if in_poly(x, y, inner):
                        c = GOLD
                    elif in_poly(x, y, mid):
                        c = DARK
                    elif in_poly(x, y, outer):
                        c = GOLD
                    else:
                        c = BG
                    rt += c[0]; gt += c[1]; bt += c[2]
            n = ss * ss
            row += bytes((rt // n, gt // n, bt // n, 255))
        rows.append(bytes(row))
    return rows


def write_png(path, size):
    rows = render(size)
    raw = b"".join(b"\x00" + r for r in rows)
    comp = zlib.compress(raw, 9)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
           chunk(b"IDAT", comp) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path} ({size}x{size}, {len(png)} bytes)")


if __name__ == "__main__":
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    write_png(os.path.join(here, "icon-192.png"), 192)
    write_png(os.path.join(here, "icon-512.png"), 512)
    write_png(os.path.join(here, "apple-touch-icon.png"), 180)
