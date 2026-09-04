#!/usr/bin/env python3
"""Read the disparity of the room at a point, out of the rasters the browser loads.

`disparity` in src/data/hotspots.ts is how far away a hotspot's aim point is, and under
the layered build it was read off a whole-frame depth plate by eye. The splat build ships
no depth plate at all - `pickingDepth` is absent from SCENE - so that number had nowhere
left to come from. It has a better source instead: the geometry itself.

The value wanted is exactly the bake's own normalised disparity. `imagePointToWorld` in
src/scripts/roomGeometry.ts computes

    1/z  =  1/farZ + (1/nearZ - 1/farZ) * disparity

and the bake stores `q = (1/z - dispLo) / (dispHi - dispLo) * 32767` with
`nearZ = 1/dispHi` and `farZ = 1/dispLo`. So `q / 32767` IS the number hotspots.ts wants,
with no conversion and no scale to guess at.

**Layer A only.** The raster is `grid x grid*2`, layer A on top, and layer A is the
visible surface - layer B is the thin ribbon of hidden geometry behind silhouettes (25.1dB
against the master; see docs/SCENE-SPLAT.md). A camera aims at what you can see, so
sampling both layers would drag the answer behind the object at exactly the silhouettes
where it matters most.

    tools/.venv/bin/python tools/splat_probe.py \
        --prefix art/build/room-day-summer --at 0.81,0.52 --at 0.25,0.42
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from sharp_splat_bake import uncompand


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prefix", required=True, type=Path,
                    help="art/build/room-day-summer - the bake's --out-prefix")
    ap.add_argument("--at", action="append", required=True, metavar="X,Y",
                    help="normalised point on the master, repeatable")
    ap.add_argument("--travel", type=float, action="append", metavar="T",
                    help="also report what a push of this `travel` costs at each point: "
                         "how much of the frame the object fills, and how large one splat "
                         "gets on screen. Repeatable, for a table.")
    ap.add_argument("--object-width", type=float, default=0.0,
                    help="the object's width as a fraction of the frame, for the fill "
                         "column. Take it from the mask's bounding box.")
    ap.add_argument("--viewport", type=float, default=1600.0,
                    help="viewport width in CSS px, for the splat-size column")
    ap.add_argument("--radius", type=float, default=0.01,
                    help="sampling radius, normalised on the master's WIDTH. The default "
                         "is ~55 master px, a few grid cells - wide enough to survive a "
                         "cell being empty, narrow enough to stay on one surface.")
    args = ap.parse_args()

    man = json.loads((args.prefix.parent / f"{args.prefix.name}-splat.json").read_text())
    geom = np.asarray(Image.open(args.prefix.parent / f"{args.prefix.name}-splat-geom.webp")
                      .convert("RGBA"))
    grid, W, H = man["grid"], man["width"], man["height"]

    # Layer A is the top grid rows. Everything below is layer B - hidden geometry.
    a = geom[:grid].reshape(-1, 4).astype(np.int32)

    cell = np.arange(a.shape[0])
    cx_px = (cell % grid + 0.5) / grid * W
    cy_px = (cell // grid + 0.5) / grid * H
    px = cx_px + uncompand(a[:, 0].astype(np.uint8))
    py = cy_px + uncompand(a[:, 1].astype(np.uint8))

    # Undo the bias the bake put in alpha so an image decoder could not eat the low byte.
    q = (a[:, 2] << 7) | (a[:, 3] - 128)
    disp = q / 32767.0

    print(f"  {man['count']:,} splats, layer A = {a.shape[0]:,}   "
          f"nearZ {man['nearZ']:.3f}m  farZ {man['farZ']:.2f}m\n")
    r = args.radius * W
    for spec in args.at:
        nx, ny = (float(v) for v in spec.split(","))
        d2 = (px - nx * W) ** 2 + (py - ny * H) ** 2
        sel = d2 <= r * r
        n = int(sel.sum())
        if not n:
            print(f"  {spec:<14} no splats within {r:.0f}px - widen --radius")
            continue
        d = disp[sel]
        med = float(np.median(d))
        z = 1.0 / (man["dispLo"] + med * (man["dispHi"] - man["dispLo"]))
        print(f"  {spec:<14} n={n:<5}  disparity p25 {np.percentile(d, 25):.3f}  "
              f"median {med:.3f}  p75 {np.percentile(d, 75):.3f}   -> {z:6.2f}m")
        # A wide spread means the window straddles a silhouette, so the median is a blend
        # of two surfaces and the aim point should move rather than the number be trusted.
        if np.percentile(d, 75) - np.percentile(d, 25) > 0.05:
            print(f"  {'':<14} ^ spread > 0.05: this window straddles a depth step. "
                  f"Move the aim point onto one surface.")

        if not args.travel:
            continue
        # Local pitch from DENSITY, not from nearest-neighbour distance. The obvious
        # measure - median distance to the nearest other splat - reads 3.7 master px here
        # against a true 5.3, because SHARP moves splats off their cells and any
        # clustering shortens the nearest-neighbour distance without covering more
        # ground. It flatters the reconstruction by ~40% and would buy a `travel` the
        # room cannot actually carry. Splats per unit area cannot be fooled that way.
        #
        # Horizontal pitch is quoted alongside because it is the worse axis and therefore
        # the one that pixelates: SHARP's square 768 grid on a 16:9 master is 7.17 master
        # px across against 4.00 down (docs/SCENE-SPLAT.md, "Resolution").
        pitch = float(np.sqrt(np.pi * r * r / n))
        px_per_css = W / args.viewport
        at_rest = (W / man["grid"]) / px_per_css
        print(f"  {'':<14} local pitch {pitch:.1f} master px (density); "
              f"horizontal cell pitch {W / man['grid']:.2f} px "
              f"= {at_rest:.2f} CSS px at rest on a {args.viewport:.0f}px viewport")
        print(f"  {'':<14} {'travel':>7} {'magnif':>7} {'splat px':>9} {'fill':>7}")
        for t in args.travel:
            mag = 1.0 / (1.0 - t)
            fill = f"{args.object_width * mag:6.2f}x" if args.object_width else "     -"
            print(f"  {'':<14} {t:7.2f} {mag:6.2f}x {at_rest * mag:9.1f} {fill:>7}")


if __name__ == "__main__":
    main()
