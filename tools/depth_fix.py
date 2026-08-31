"""Stage 3 of docs/PIPELINE.md: apply the authored depth corrections.

Segmentation gives shape; this gives distance. Monocular depth gets some objects
semantically wrong - our office chair comes back at the same distance as the desk it
sits in front of - and no amount of segmentation can detect that, because the outline
is correct and only the number is wrong.

Depth quality dominates everything downstream: a layer cut and an inpaint are both only
as good as the depth they derive from. So the few places the model is badly wrong are
corrected here, once, before any of that runs.

Every correction here is **relief-preserving**. The first version of this file wrote
a constant into the whole mask, and that is wrong for the same reason a single-mesh
render is wrong: a displaced mesh is only worth having because one object carries many
depths. Flattening the corner plant to one number turned every leaf into a card - the
plant read as a sticker, and it and the shelf above it came back at the *identical*
value (51), which is visible as two cut-outs at the same distance. Corrections move an
object; they do not erase what is inside it.

Reads the masks written by segment.py and the ops in art/objects.json.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def laplace_fill(d: np.ndarray, sel: np.ndarray, iters: int = 96, levels: int = 6):
    """Fill `sel` with the smoothest surface that meets the region's border.

    Telea was here first and is wrong for this job. It marches inward from the boundary
    along the distance transform, so a wide region comes back streaked and lumpy: over the
    window it deviated from a best-fit plane by a mean of 22/255 and a max of 110, which
    is not a window plane, it is terrain. Depth is what the mesh is *built from*, so that
    lumpiness becomes real geometry - the window mullions ripple as the camera moves.

    Solving Laplace's equation instead gives the harmonic interpolant: the smoothest field
    agreeing with the border. A planar border yields a near-planar interior, which is
    exactly what a wall behind glass should be. Repeated 3x3 averaging with the known
    pixels pinned each pass is Jacobi iteration; running it coarse-to-fine is what makes
    the low frequencies converge in reasonable time rather than diffusing pixel by pixel.
    """
    pyr_d, pyr_s = [d.astype(np.float32)], [sel]
    for _ in range(levels):
        if min(pyr_d[-1].shape) < 8:
            break
        pyr_d.append(cv2.pyrDown(pyr_d[-1]))
        pyr_s.append(cv2.pyrDown(pyr_s[-1].astype(np.float32)) > 0.5)

    x = pyr_d[-1].copy()
    for lvl in range(len(pyr_d) - 1, -1, -1):
        tgt, s = pyr_d[lvl], pyr_s[lvl]
        if x.shape != tgt.shape:
            x = cv2.resize(x, (tgt.shape[1], tgt.shape[0]), interpolation=cv2.INTER_LINEAR)
        x = np.where(s, x, tgt)
        for _ in range(iters):
            x = np.where(s, cv2.blur(x, (3, 3)), tgt)
    return np.where(sel, x, d)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--depth", required=True, type=Path, help="8-bit working depth")
    ap.add_argument("--objects", required=True, type=Path, help="objects.json")
    ap.add_argument("--masks", required=True, type=Path, help="dir written by segment.py")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--color", type=Path, help="colour master, for the preview")
    ap.add_argument("--preview", type=Path)
    ap.add_argument("--smooth", type=int, default=5,
                    help="feather corrected borders, px; keeps a correction from "
                         "introducing a step edge of its own")
    args = ap.parse_args()

    depth = cv2.imread(str(args.depth), cv2.IMREAD_GRAYSCALE)
    if depth is None:
        raise SystemExit(f"could not read {args.depth}")
    d = depth.astype(np.float32) / 255.0
    spec = json.loads(args.objects.read_text())

    # Every mask, kept separately: an op needs "every OTHER object", and folding them
    # into one union first silently includes the object being corrected - which made the
    # window's fill region empty and its median NaN.
    all_masks = {}
    for obj in spec["objects"]:
        mp = args.masks / f"{obj['name']}.png"
        if mp.exists():
            all_masks[obj["name"]] = cv2.imread(str(mp), cv2.IMREAD_GRAYSCALE) > 127

    def others_of(name: str) -> np.ndarray:
        out = np.zeros(d.shape, bool)
        for k, m in all_masks.items():
            if k != name:
                out |= m
        return out

    touched = np.zeros(d.shape, np.uint8)
    for obj in spec["objects"]:
        # Most objects only need a mask so they can be cut into a layer. An "op" is a
        # depth correction, authored only where monocular depth is semantically wrong.
        op = obj.get("op")
        if op is None:
            continue
        name = obj["name"]
        mask_path = args.masks / f"{name}.png"
        mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        if mask is None:
            raise SystemExit(f"missing mask {mask_path} - run tools/segment.py first")
        if mask.shape != d.shape:
            raise SystemExit(f"{name}: mask {mask.shape} != depth {d.shape}")

        sel = mask > 127
        others = others_of(name)
        if not sel.any():
            raise SystemExit(f"{name}: mask is empty")
        before = float(np.median(d[sel]))

        if op == "stand":
            # Anchor to the floor the object stands on, instead of guessing a constant.
            # A hand-authored depth is only as good as the eye that picked it, and the eye
            # is bad at this: the corner plant was authored to 0.56 on the reasoning that it
            # stands beside the cabinet, but the floor directly under its pot reads 0.20 -
            # it is in the far corner, not beside the near end. 90/255 too near, which is
            # why it parallaxed like a foreground object while reading as distant.
            #
            # The floor is the one surface here whose depth gradient a monocular model
            # gets reliably right: large, continuous, textured, perspective cues all over
            # it. Where an object meets it is therefore a physical anchor, and reading it
            # costs nothing. Strictly better than a constant picked by eye, and better
            # than the model's opinion of the object itself - which is what was wrong.
            ys, xs = np.where(sel)
            base = ys.max()
            strip = np.zeros_like(sel)
            strip[base + 2:base + 14, xs.min():xs.max() + 1] = True
            strip &= ~others
            if strip.sum() < 40:
                raise SystemExit(f"{name}: op 'stand' needs visible floor below the "
                                 f"object; only {int(strip.sum())}px found")
            # Shift, do not replace: the plant keeps every frond's own depth, only the
            # whole plant moves to where it actually stands.
            d[sel] += float(np.median(d[strip])) - before
        elif op == "flatten":
            # Compress relief toward the median rather than deleting it. The shelf's mask
            # is bimodal - 4485px of board at 48-63 and 4098px of trailing pothos at
            # 128-143 - so the model puts the vine ~85/255 in front of the board it hangs
            # from. At 0.25 that 85 becomes 21: the vine stops swimming, and the leaves
            # keep the relief that makes them read as leaves.
            d[sel] = before + (d[sel] - before) * float(obj.get("relief", 0.25))
        elif op == "fill":
            # Interpolate inward from the region border. For the window this recovers the
            # receding wall plane instead of inventing a constant for it.
            #
            # Solve over the whole region but write back only outside other objects. The
            # window polygon is a rectangle over the glass, and the foreground plant, the
            # rubber plant and the printer stand in front of it - 29% of the plant fell inside
            # it, and writing the wall plane over them cut the plant in half (213 -> 184
            # across a hard vertical step). They are excluded from the *write* so they keep
            # their own depth, and from the *boundary* so the printer's 0.33 does not drag
            # the wall plane forward.
            free = sel & ~others
            d = np.where(free, laplace_fill(d, sel), d)
            sel = free
        else:
            raise SystemExit(f"{name}: unknown op {op!r}")

        touched |= (sel * 255).astype(np.uint8)
        print(f"  {name:<14} {op:<8} {100.0 * sel.mean():5.1f}% of frame   "
              f"{before:.3f} -> {float(np.median(d[sel])):.3f}")

    if args.smooth >= 3:
        k = args.smooth | 1
        blurred = cv2.GaussianBlur(d, (k, k), 0)
        ring = cv2.morphologyEx(touched, cv2.MORPH_GRADIENT,
                                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        wgt = cv2.GaussianBlur(ring.astype(np.float32) / 255.0, (k, k), 0).clip(0, 1)
        d = d * (1 - wgt) + blurred * wgt

    out8 = (np.clip(d, 0, 1) * 255 + 0.5).astype(np.uint8)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.out), out8)
    print(f"\nwrote {args.out}   ({100.0 * (touched > 0).mean():.1f}% of frame corrected)")

    if args.preview and args.color:
        color = cv2.imread(str(args.color), cv2.IMREAD_COLOR)
        vis = cv2.applyColorMap(out8, cv2.COLORMAP_TURBO)
        cv2.imwrite(str(args.preview), np.hstack([color, vis]))
        print(f"preview: {args.preview}")


if __name__ == "__main__":
    main()
