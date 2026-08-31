"""Stage 1 of docs/PIPELINE.md: raw 16-bit depth -> clean 8-bit working depth.

Two jobs, in order:

  1. Rescale by the image's own min/max. Depth Anything's "16-bit raw output" is
     relative and un-normalised - our master occupies ~12..376 of 65535 - so the raw
     values are almost flat until rescaled. See art/README.md.

  2. Sharpen the depth edges against the colour image. The model returns soft,
     slightly misregistered silhouettes, and a soft depth edge is a *separate*
     artifact from disocclusion: it turns a clean cut into a smeared ramp. A guided
     filter (He et al. 2010) with the colour image as the guide snaps depth edges
     onto the painted ones. This is our stand-in for the bilateral median filter
     Shih et al. use for the same purpose.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


def guided_filter(guide: np.ndarray, src: np.ndarray, radius: int, eps: float) -> np.ndarray:
    """Edge-preserving filter of `src` guided by `guide`. Both float32 in 0..1.

    Unlike a plain blur, the output follows edges that exist in `guide` - which is
    exactly what we want: the colour image knows where the chair ends and the floor
    begins far more precisely than the depth model does.
    """
    d = 2 * radius + 1
    box = lambda m: cv2.boxFilter(m, cv2.CV_32F, (d, d))

    mean_g, mean_s = box(guide), box(src)
    var_g = box(guide * guide) - mean_g * mean_g
    cov_gs = box(guide * src) - mean_g * mean_s

    a = cov_gs / (var_g + eps)
    b = mean_s - a * mean_g
    return box(a) * guide + box(b)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--color", required=True, type=Path, help="colour master")
    ap.add_argument("--depth", required=True, type=Path, help="16-bit raw depth master")
    ap.add_argument("--out", required=True, type=Path, help="8-bit working depth")
    ap.add_argument("--radius", type=int, default=8, help="guided filter radius (px)")
    ap.add_argument("--eps", type=float, default=1e-4, help="guided filter regularisation")
    ap.add_argument("--median", type=int, default=3, help="speckle median, 0 to skip")
    args = ap.parse_args()

    color = cv2.imread(str(args.color), cv2.IMREAD_COLOR)
    depth = cv2.imread(str(args.depth), cv2.IMREAD_UNCHANGED)
    if color is None or depth is None:
        raise SystemExit("could not read colour or depth")
    if depth.ndim == 3:
        depth = depth[..., 0]
    if color.shape[:2] != depth.shape[:2]:
        raise SystemExit(f"size mismatch: colour {color.shape[:2]} vs depth {depth.shape[:2]}")

    lo, hi = int(depth.min()), int(depth.max())
    print(f"raw depth: {depth.dtype}, range {lo}..{hi} of {np.iinfo(depth.dtype).max}")
    if hi == lo:
        raise SystemExit("depth is constant")

    # 1. rescale to 0..1 by the image's own range
    d = (depth.astype(np.float32) - lo) / (hi - lo)

    # 2a. speckle removal, before edge work so it does not sharpen noise
    if args.median >= 3:
        d = cv2.medianBlur((d * 255).astype(np.uint8), args.median).astype(np.float32) / 255.0

    # 2b. snap depth edges onto colour edges
    guide = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    refined = guided_filter(guide, d, args.radius, args.eps)
    refined = np.clip(refined, 0.0, 1.0)

    out8 = (refined * 255.0 + 0.5).astype(np.uint8)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.out), out8)

    # how much did the edges actually move? gradient energy is a cheap proxy.
    def grad_energy(x: np.ndarray) -> float:
        gx = cv2.Sobel(x, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(x, cv2.CV_32F, 0, 1, ksize=3)
        return float(np.mean(np.sqrt(gx * gx + gy * gy)))

    print(f"wrote {args.out}  ({out8.shape[1]}x{out8.shape[0]}, 8-bit)")
    print(f"edge energy: {grad_energy(d):.5f} -> {grad_energy(refined):.5f}")
    print(f"mean shift:  {float(np.mean(np.abs(refined - d))) * 255:.2f}/255")


if __name__ == "__main__":
    main()
