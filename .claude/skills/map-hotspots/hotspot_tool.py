#!/usr/bin/env python3
"""Helpers for locating hotspot rectangles in a room render by eye.

Subcommands:
  grid   IMG OUT [--cols 20] [--rows 12]   labelled grid overlay, for coarse reads
  crop   IMG OUT --rect x0,y0,x1,y1 [--pad 0.04]  normalised crop, upscaled, for refining
  draw   IMG OUT --rects hotspots.json     all rects outlined + labelled, for verifying

Rects are always normalised 0..1 as x0,y0,x1,y1 with the origin top-left, so they stay
valid when the master art is re-exported at a different resolution.
"""
import argparse, json, sys
from PIL import Image, ImageDraw, ImageFont


def _font(size):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _label(d, xy, text, font, fg="#ffffff", bg="#000000"):
    x, y = xy
    box = d.textbbox((x, y), text, font=font)
    d.rectangle([box[0] - 3, box[1] - 2, box[2] + 3, box[3] + 2], fill=bg)
    d.text((x, y), text, font=font, fill=fg)


def cmd_grid(a):
    im = Image.open(a.img).convert("RGB")
    W, H = im.size
    d = ImageDraw.Draw(im, "RGBA")
    f = _font(max(12, W // 90))
    for c in range(a.cols + 1):
        x = round(W * c / a.cols)
        d.line([(x, 0), (x, H)], fill=(255, 0, 255, 140), width=max(1, W // 1400))
    for r in range(a.rows + 1):
        y = round(H * r / a.rows)
        d.line([(0, y), (W, y)], fill=(255, 0, 255, 140), width=max(1, W // 1400))
    # label every cell with its column letter + row number, plus normalised origin
    for c in range(a.cols):
        for r in range(a.rows):
            x, y = round(W * c / a.cols), round(H * r / a.rows)
            _label(d, (x + 3, y + 2), f"{chr(65 + c)}{r + 1}", f)
    print(f"{a.img}: {W}x{H} -> {a.out} ({a.cols}x{a.rows} grid, "
          f"cell = {1 / a.cols:.4f} x {1 / a.rows:.4f} normalised)")
    im.save(a.out)


def cmd_crop(a):
    im = Image.open(a.img).convert("RGB")
    W, H = im.size
    x0, y0, x1, y1 = [float(v) for v in a.rect.split(",")]
    px, py = (x1 - x0) * a.pad, (y1 - y0) * a.pad
    box = (max(0.0, x0 - px), max(0.0, y0 - py), min(1.0, x1 + px), min(1.0, y1 + py))
    crop = im.crop((round(box[0] * W), round(box[1] * H),
                    round(box[2] * W), round(box[3] * H)))
    # draw the un-padded rect inside the padded crop so the fit is judgeable
    d = ImageDraw.Draw(crop)
    cw, ch = crop.size
    sx, sy = cw / (box[2] - box[0]), ch / (box[3] - box[1])
    d.rectangle([(x0 - box[0]) * sx, (y0 - box[1]) * sy,
                 (x1 - box[0]) * sx, (y1 - box[1]) * sy],
                outline="#00ff88", width=max(2, cw // 300))
    if max(crop.size) < 900:
        s = 900 / max(crop.size)
        crop = crop.resize((round(cw * s), round(ch * s)), Image.LANCZOS)
    crop.save(a.out)
    print(f"crop {box} -> {a.out} {crop.size}; green box is the proposed rect")


def cmd_draw(a):
    im = Image.open(a.img).convert("RGB")
    W, H = im.size
    d = ImageDraw.Draw(im)
    f = _font(max(16, W // 60))
    data = json.load(open(a.rects))
    items = data["hotspots"] if isinstance(data, dict) else data
    for h in items:
        x0, y0, x1, y1 = h["rect"]
        d.rectangle([x0 * W, y0 * H, x1 * W, y1 * H], outline="#00ff88",
                    width=max(2, W // 500))
        _label(d, (x0 * W + 6, y0 * H + 4), h["id"], f, bg="#007744")
    im.save(a.out)
    print(f"{len(items)} rects -> {a.out}")


p = argparse.ArgumentParser()
sub = p.add_subparsers(dest="cmd", required=True)
g = sub.add_parser("grid"); g.add_argument("img"); g.add_argument("out")
g.add_argument("--cols", type=int, default=20); g.add_argument("--rows", type=int, default=12)
g.set_defaults(fn=cmd_grid)
c = sub.add_parser("crop"); c.add_argument("img"); c.add_argument("out")
c.add_argument("--rect", required=True); c.add_argument("--pad", type=float, default=0.04)
c.set_defaults(fn=cmd_crop)
w = sub.add_parser("draw"); w.add_argument("img"); w.add_argument("out")
w.add_argument("--rects", required=True); w.set_defaults(fn=cmd_draw)
a = p.parse_args(); sys.exit(a.fn(a))
