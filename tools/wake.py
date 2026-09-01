#!/usr/bin/env python3
"""Stage 7 - the wake: an object's own light, for when the pointer is on it.

**What this replaced, and why.** The first version of this stage baked a *rim* - a hairline
of light traced on the object's silhouette, the way Dishonored and Dark Souls mark an
interactable. It failed for a reason worth writing down, because it is a property of this
site and not of that idea.

The room is a displaced mesh under a camera that never quite stops moving: cursor parallax
nudges the art at rest, and a push slides it across the frame. A rim is a *screen-space
overlay* positioned once in CSS. A hairline is the least forgiving shape there is for that
mismatch - two or three pixels of drift and the outline is visibly no longer on the object
it is tracing, which reads as a decal stuck to the glass rather than as anything in the
room. Worse, it announced itself as UI: a contour is a thing the interface draws *about* an
object, never a thing the object does.

So the affordance is now the object's own light coming up. The monitor wakes. That is
diegetic - it is the room reacting, not a layer annotating it - and being a soft filled
glow rather than a line, a few pixels of parallax drift are invisible in it. It also has
the headroom the earlier accent glow lacked: that one washed out because it was `screen`
blending over sunlit painterly art, and there is very little light to add to a lit wall.
The monitor's screen is near-black by construction (PROMPTS.md keeps content off it), so
light added there reads instantly.

The interior constraint inverts with it. The rim had to be held *out* of the object, or it
would sit on the empty screen; the wake's whole point is to light that screen, so the fill
is the effect and the outward spill onto desk and wall is the supporting half.

Baked rather than filtered in CSS for the same two reasons as before: a blur chain per
frame is a full-frame filter pass on something that has to stay cheap, and the site's
argument is that it ships plain images. Output is RGBA with white RGB and the shape in
alpha, because CSS `mask-image` reads alpha.

Each wake is cropped to its own lit extent and paired with a `wakeRect` in hotspots.ts
saying where that crop sits in the frame, normalised. The whole-frame version was simpler -
`mask-size: cover` and no arithmetic at all - but it made the element the size of the
viewport, and a `screen`-blended element repaints its whole box on every frame of a fade.
See the note on the crop in `build_wake`.

  tools/.venv/bin/python tools/wake.py --masks art/build/masks --out-dir public/art \\
      --wake monitor=monitor-left --wake window=window-glass
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def build_wake(mask: Image.Image, width: int, feather: int) -> tuple[Image.Image, list[float]]:
    """A soft-edged fill of the object plus an outward spill, cropped to its own extent.

    Returns the image and its box in the full frame, normalised 0..1.
    """
    h = round(width * mask.height / mask.width)
    small = mask.resize((width, h), Image.BILINEAR).point(lambda v: 255 if v > 127 else 0)

    # The fill stays nearly crisp. Blur it much and the lit shape stops being *the monitor*
    # and becomes a smudge over the desk - the object's own edge is what sells the light as
    # belonging to it. It is also deliberately weak: the fill is a wash that lets the
    # painted screen's own sheen through, not a coat of paint over it. Weighted up to 0.85
    # it takes the panel to flat accent and the art underneath stops existing.
    fill = np.asarray(small.filter(ImageFilter.GaussianBlur(feather)), np.float32)
    # The spill is wide and weak: light landing on the desk and the wall behind. It is what
    # makes the glow read as cast rather than as painted on.
    spill = np.asarray(small.filter(ImageFilter.GaussianBlur(feather * 6.0)), np.float32)

    alpha = np.clip(fill * 0.45 + spill * 0.55, 0, 255).astype(np.uint8)

    # Crop to where the light actually is, and let the site place the crop.
    #
    # This is not a file-size optimisation - the whole-frame version was 13KB. It is a
    # *compositing* one, and it is the fix for a real stutter. The wake is `screen`-blended
    # over a live WebGL canvas, and a blend mode is one of the things that takes an element
    # off the compositor's fast path: every frame of the hover fade is then a repaint of
    # that element's whole box plus a backdrop read. At full frame that box is the entire
    # viewport, and the fade arrived in two or three visible steps - it looked like the glow
    # started easing and then snapped to full. Cropped, the same fade repaints a few percent
    # of the frame and runs clean.
    #
    # The threshold is 2 rather than 0 because a Gaussian never quite reaches zero, and a
    # box drawn at alpha 1/255 is the whole frame again with nothing visible in the margin.
    lit = np.argwhere(alpha > 2)
    y0, x0 = lit.min(0)
    y1, x1 = lit.max(0) + 1
    alpha = alpha[y0:y1, x0:x1]
    rect = [x0 / width, y0 / h, x1 / width, y1 / h]

    rgba = np.dstack([np.full_like(alpha, 255)] * 3 + [alpha])
    return Image.fromarray(rgba, "RGBA"), rect


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--masks", required=True, type=Path, help="art/build/masks")
    ap.add_argument("--out-dir", required=True, type=Path, help="public/art")
    ap.add_argument("--wake", action="append", required=True, metavar="ID=a,b",
                    help="hotspot id and the mask names to union for it")
    ap.add_argument("--width", type=int, default=1376,
                    help="the wake is soft light, so it costs nothing to ship it at a "
                         "quarter of the master and let the browser scale it up")
    ap.add_argument("--feather", type=int, default=4, help="fill softness, in output px")
    ap.add_argument("--quality", type=int, default=82)
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for spec in args.wake:
        hid, _, names = spec.partition("=")
        parts = [Image.open(args.masks / f"{n}.png").convert("L") for n in names.split(",")]
        union = parts[0]
        for p in parts[1:]:
            union = Image.fromarray(np.maximum(np.asarray(union), np.asarray(p)))

        # The tap target's box comes from the full-resolution union, not the downscaled
        # wake: it outlives every re-export and should not inherit this stage's resampling.
        x0, y0, x1, y1 = union.getbbox()
        w, h = union.size
        rect = [x0 / w, y0 / h, x1 / w, y1 / h]

        out = args.out_dir / f"wake-{hid}.webp"
        image, wake_rect = build_wake(union, args.width, args.feather)
        image.save(out, quality=args.quality)
        fmt = lambda r: "[" + ", ".join(f"{v:.4f}" for v in r) + "]"
        print(f"{out}  {out.stat().st_size / 1024:.0f}KB  {image.width}x{image.height}")
        print(f"  rect:     {fmt(rect)}  centre: "
              f"[{(rect[0]+rect[2])/2:.3f}, {(rect[1]+rect[3])/2:.3f}]")
        print(f"  wakeRect: {fmt(wake_rect)}")


if __name__ == "__main__":
    main()
