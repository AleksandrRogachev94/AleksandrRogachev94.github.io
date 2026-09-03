#!/usr/bin/env python3
"""Stage 6 - write what the browser loads.

Colour lossy, depth lossless. WebP's lossy mode rings at high-contrast edges, and in a
depth map those edges are the silhouettes the whole pipeline exists to keep sharp - a
ringing artifact there becomes a wobbling silhouette in motion.

Colour resamples with Lanczos and depth with bilinear, for the same reason: Lanczos
overshoots either side of a step, which in depth invents a near halo and a far trench
around every object.
"""
import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", required=True, type=Path, help="art/build/room-day-summer")
    ap.add_argument("--out-dir", required=True, type=Path, help="public/art")
    ap.add_argument("--master", type=Path,
                    help="colour master. Exported as the flat poster the site shows when "
                         "WebGL is unavailable or prefers-reduced-motion is set.")
    ap.add_argument("--picking-depth", type=Path,
                    help="depth8-fixed.png. Exported whole, for turning a click into a "
                         "3D point on the CPU - the per-layer depth maps are cut, so no "
                         "one of them can answer that for the whole frame.")
    ap.add_argument("--width", type=int, default=0, help="0 keeps the source width")
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--depth-scale", type=float, default=1.0,
                    help="depth resolution relative to colour. Half res was the default "
                         "on the argument that alpha, not depth, carries the silhouettes "
                         "once the layers are cut - true, but it only covers the view at "
                         "rest. Depth is what the mesh is BUILT from, so under a push "
                         "that magnifies 3x it is geometry, and halving it halves the "
                         "geometric detail exactly where the camera is closest. Costs "
                         "~280 KB; revisit once the 4K master lands.")
    args = ap.parse_args()

    plates = sorted(args.prefix.parent.glob(f"{args.prefix.name}-layer*[0-9].png"))
    if not plates:
        raise SystemExit(f"no {args.prefix.name}-layerN.png - run tools/inpaint.py first")
    args.out_dir.mkdir(parents=True, exist_ok=True)

    total = 0

    def write(im, name, lossless, scale=1.0):
        nonlocal total
        target = args.width or im.width
        target = max(1, round(target * scale))
        if target != im.width:
            h = max(1, round(im.height * target / im.width))
            im = im.resize((target, h), Image.BILINEAR if lossless else Image.LANCZOS)
        # Layer 0 is opaque by construction; carrying a constant alpha plane wastes
        # bytes on every page load.
        if not lossless and im.mode == "RGBA" and im.getchannel("A").getextrema() == (255, 255):
            im = im.convert("RGB")
        out = args.out_dir / f"{name}.webp"
        if lossless:
            im.save(out, "WEBP", lossless=True)
        else:
            im.save(out, "WEBP", quality=args.quality, method=6)
        kb = out.stat().st_size / 1024
        total += kb
        print(f"  {out.name:38} {im.size[0]}x{im.size[1]}  {im.mode:4}  {kb:7.1f} KB")

    if args.master:
        write(Image.open(args.master).convert("RGB"), args.master.stem, False)
    if args.picking_depth:
        write(Image.open(args.picking_depth), f"{args.prefix.name}-depth", True,
              args.depth_scale)

    for cp in plates:
        dp = cp.with_name(f"{cp.stem}-depth.png")
        if not dp.exists():
            raise SystemExit(f"missing {dp}")
        for src, lossless in ((cp, False), (dp, True)):
            im = Image.open(src)
            # WebP has no 16-bit mode and PIL does not refuse the job: handed an I;16
            # image it writes a file that reopens as RGB and decodes to noise. Silent, and
            # invisible until the mesh is built from it. Fail here instead.
            if lossless and im.mode not in ("L", "P", "RGB", "RGBA"):
                raise SystemExit(f"{src}: depth is {im.mode}; WebP cannot carry more than "
                                 f"8 bits per channel and PIL corrupts it silently. "
                                 f"Write the plate at 8-bit.")
            write(im, src.stem, lossless, args.depth_scale if lossless else 1.0)
    print(f"\n{total:.1f} KB total")


if __name__ == "__main__":
    main()
