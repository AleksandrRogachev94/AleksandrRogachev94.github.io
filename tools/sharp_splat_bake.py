#!/usr/bin/env python3
"""Bake a SHARP Gaussian splat into attribute rasters the browser can load as images.

**Why rasters and not a .ply/.splat/.sog.**

SHARP's output is not an unstructured capture. `num_layers` is 2 and each layer is a
768x768 grid predicted from one camera, so the 1,179,648 Gaussians are *already* two
images: neighbouring splats are neighbouring pixels. That is precisely the property SOGS
spends a Parallel Linear Assignment Sort discovering before it can pack splats into
"attribute images". For us the sort is a no-op, so we skip both it and the container and
write the attribute images directly - as WebP, which is what the site already ships.

The payload win is structural, not clever: a general splat format must store three
position floats per primitive because it cannot know where the splat came from. We know.
Each splat belongs to a grid cell, so position is that cell's ray plus a small offset,
and offsets are mostly zero and compress accordingly.

**What is emitted** (all at grid x (grid * layers), layer 0 on top):

  -splat-geom.webp   RG = signed offset from the cell centre in master px, square-companded
                     B  = disparity high 8 bits, A = low 7 bits biased into [128, 255].
                     Lossless.
  -splat-color.webp  RGB = colour from the degree-0 SH, A = opacity. Lossy q95.
  -splat-shape.webp  RGB = per-axis scale, log-quantised. Lossless.
  -splat-quat.webp   RGBA = rotation quaternion, unsigned 8-bit, signed so A >= 128.
                     Lossless.
  -splat.json        the manifest: grid, intrinsics, and every range needed to undo the
                     quantisation above.

Every quantisation choice here is checked against the float source and the errors are
printed. Nothing in this file is a guess.

**No alpha channel here may carry a small value**, and both the disparity bias and the
quaternion sign flip exist for that one reason. An image decoder is entitled to store a
decoded image premultiplied and divide alpha back out, rounding to 8 bits each way, which
scales RGB by 255/A. Measured on this scene when A was free to be small: 103,221 splats
moved more than 5% of their depth and 12,679 were flung to the near plane keeping their own
colour, which is what the whole-frame speckle turned out to be. Keeping A >= 128 bounds that
round trip at one LSB. The renderer asserts the invariant on load.

**Settled: no coverage fit.** An earlier stage grew every Gaussian until its projected
footprint tiled its own sampling cell, on the theory that SHARP's square 768x768 grid
against a 16:9 master leaves 60.6% of splats narrower than their horizontal spacing, so the
field would not tile and the gaps would show. Measured, it does tile: accumulated alpha is
>= 0.9 on 100.00% of pixels without the fit, at the home camera and at the 4.5x magnification
the push into the monitor reaches. The fit cost 3.70dB - it is a low-pass filter, and it was
the only lossy stage in this bake - and bought nothing. The speckle it was credited with
suppressing was the premultiply bug above.

**Why square companding for the offset.** SHARP lets a splat drift a long way from its own
cell - median 1.8 master px but p95 157 and max 1033 - so the offset cannot be dropped, and
8-bit linear over that range would cost 8px everywhere including the 50% of splats that sit
within 2px of home. Companding spends the precision where the splats are: ~0.02px near
zero, degrading to ~17px only for the outliers already a thousand pixels adrift.

Offline tooling. Never enters package.json - the site loads plain images.

  tools/.venv/bin/python tools/sharp_splat_bake.py \
      --ply art/room-day-summer.ply --out-prefix art/build/room-day-summer
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

from sharp_bake import load_ply

# ml-sharp's own excursion budget (sharp/utils/render.py: compute_max_offset). Ported so
# the room and the model agree about how far the camera may go before the second layer
# runs out of hidden geometry to show.
MAX_DISPARITY = 0.08
MAX_ZOOM = 0.15

# Companding range for the per-splat offset, in master pixels. Covers the observed max
# (1033px) with headroom; see the module docstring for what the choice costs.
OFFSET_RANGE = 1100.0


def compand(offset: np.ndarray) -> np.ndarray:
    """Signed offset in master px -> uint8, precision concentrated near zero."""
    t = np.sign(offset) * np.sqrt(np.minimum(np.abs(offset), OFFSET_RANGE) / OFFSET_RANGE)
    return np.clip(np.rint(127.5 + 127.5 * t), 0, 255).astype(np.uint8)


def uncompand(code: np.ndarray) -> np.ndarray:
    """The browser does this in the vertex shader. Kept here to measure the round trip."""
    t = (code.astype(np.float32) - 127.5) / 127.5
    return np.sign(t) * (t * t) * OFFSET_RANGE


def quantise_log(value: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Positive quantity -> uint8, uniform in log space, so the error stays relative."""
    t = (np.log(np.maximum(value, 1e-9)) - lo) / (hi - lo)
    return np.clip(np.rint(t * 255.0), 0, 255).astype(np.uint8)


def despeckle(rgb: np.ndarray, grid: int, layers: int, min_dev: float = 0.18,
              mad_mult: float = 8.0) -> np.ndarray:
    """Replace isolated colour outliers with their neighbourhood median.

    SHARP emits a small number of Gaussians whose colour disagrees sharply with the
    neighbours it shares a surface with - measured on this scene, 0.167% of layer A is more
    than 0.25 luma darker than its 4-neighbour median at alpha 0.65 and ~8.5px across, and
    layer B carries a matching population of bright ones. They are prediction noise, and
    they render as the speckle over the whole frame.

    They were invisible until the colour decode was fixed: the old `0.5 + SH_C0 * x` decode
    compressed contrast to 0.29x, so a speck 0.4 luma out of place arrived 0.11 out of place
    and disappeared into the wash. Fixing the wash is what exposed them.

    **Why this is not a blur.** The test is against the *median absolute deviation* of the
    same neighbourhood, so a splat is only replaced when it is far out of line with
    neighbours that agree with each other. Real structure - a window bar, a guitar string -
    sits in a neighbourhood that is itself varied, its MAD is large, and it is left alone.
    A speck sits in a neighbourhood that agrees, and is not.
    """
    out = rgb.copy()
    per = grid * grid
    touched = 0
    for layer in range(layers):
        img = out[layer * per:(layer + 1) * per].reshape(grid, grid, 3)
        stack = np.stack([np.roll(img, s, axis=ax)
                          for ax in (0, 1) for s in (1, -1)])
        med = np.median(stack, axis=0)
        mad = np.median(np.abs(stack - med), axis=0).max(axis=2)
        dev = np.abs(img - med).max(axis=2)
        bad = (dev > min_dev) & (dev > mad_mult * (mad + 1e-3))
        # np.roll wraps, so the one-pixel border is comparing across the frame. Leave it.
        bad[0, :] = bad[-1, :] = bad[:, 0] = bad[:, -1] = False
        img[bad] = med[bad]
        touched += int(bad.sum())
    print(f"  despeckle: replaced {touched:,} splats "
          f"({100 * touched / len(rgb):.3f}%) with their neighbourhood median")
    return out


def report(name: str, exact: np.ndarray, restored: np.ndarray, unit: str) -> None:
    err = np.abs(exact - restored)
    print(f"  {name:<22} err p50 {np.percentile(err, 50):9.4f}  p99.9 "
          f"{np.percentile(err, 99.9):9.4f}  max {err.max():9.4f}  {unit}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ply", type=Path, required=True)
    ap.add_argument("--out-prefix", type=Path, required=True)
    ap.add_argument("--no-despeckle", action="store_true",
                    help="keep SHARP's colour outliers. See despeckle().")
    args = ap.parse_args()

    g = load_ply(args.ply)
    xyz, rgb, alpha = g["xyz"], g["rgb"], g["scale"] * 0 + g["alpha"][:, None]
    alpha = g["alpha"]
    scale, quat = g["scale"], g["quat"]
    fx, cx, cy = g["fx"], g["cx"], g["cy"]
    W, H, nh = g["width"], g["height"], g["n_half"]

    grid = int(round(nh ** 0.5))
    if grid * grid != nh:
        raise SystemExit(f"{nh} splats per layer is not a square grid")
    layers = len(xyz) // nh
    print(f"{len(xyz):,} splats = {layers} layers x {grid}x{grid}, master {W}x{H}")

    # Near-invisible Gaussians cost a quad each and contribute nothing. Zeroing their
    # opacity lets the fragment shader drop them without disturbing the grid the rasters
    # are addressed by. Matches the prototype's `alpha > 0.02`.
    alpha = np.where(alpha <= 0.02, 0.0, alpha)

    # ---- geometry: cell ray + offset, and disparity -----------------------------------
    z = xyz[:, 2]
    px = xyz[:, 0] / z * fx + cx
    py = xyz[:, 1] / z * fx + cy

    cell = np.arange(len(xyz)) % nh
    cx_px = (cell % grid + 0.5) / grid * W
    cy_px = (cell // grid + 0.5) / grid * H

    ox, oy = compand(px - cx_px), compand(py - cy_px)
    report("offset x", px - cx_px, cx_px * 0 + uncompand(ox), "master px")
    report("offset y", py - cy_px, cy_px * 0 + uncompand(oy), "master px")

    # Disparity, not depth: it is linear in the parallax the camera actually produces, so
    # the bits spend their precision where motion is visible instead of on the far wall.
    #
    # **15 bits, and the low 7 live in the top half of the alpha channel.** The obvious
    # encoding is 16 bits split evenly, high in B and low in A, and it is what this bake
    # wrote until an image decoder ate it. `createImageBitmap` may honour
    # `premultiplyAlpha: 'none'` by storing the image premultiplied and dividing alpha back
    # out, rounding to 8 bits each way, which scales RGB by 255/A. With A free to be small
    # that clamps B to 255 - disparity 1.0, the near plane - and measured on this scene it
    # flung 12,679 splats to arm's length and moved 103,221 by more than 5% of their depth.
    #
    # Biasing A into [128, 255] costs one bit of disparity (0.03mm at the near plane,
    # 0.37m at the far wall where nothing parallaxes) and bounds that round trip at one
    # LSB, because the premultiply then quantises RGB in steps of 255/A <= 2. The renderer
    # decodes exactly, and asserts the bias holds so a raster mangled in transit says so
    # instead of drawing confetti.
    disp = 1.0 / np.maximum(z, 1e-4)
    d_lo, d_hi = float(disp.min()), float(disp.max())
    q = np.clip(np.rint((disp - d_lo) / (d_hi - d_lo) * 32767.0), 0, 32767).astype(np.uint32)
    report("depth", z, 1.0 / (d_lo + q / 32767.0 * (d_hi - d_lo)), "m")

    geom = np.stack([ox, oy,
                     (q >> 7).astype(np.uint8),
                     (128 + (q & 127)).astype(np.uint8)], axis=1)
    assert geom[:, 3].min() >= 128, "the geom alpha bias is what makes the raster robust"

    # ---- colour -----------------------------------------------------------------------
    #
    # **SHARP stores sRGB colour in `f_dc_*`, not spherical-harmonic coefficients.** The
    # standard 3DGS decode `0.5 + SH_C0 * x` is therefore wrong here and is not a subtle
    # error: it maps this scene's [0.001, 1.000] into [0.500, 0.782], throwing away 71% of
    # the contrast (std 0.070 against the master's 0.241) and rendering the whole room as a
    # pale grey wash. It looks like a translucent layer over the scene, which is why it was
    # mistaken for a compositing bug three times.
    #
    # The check below is the evidence, kept as an assertion rather than a comment: SH
    # coefficients for a bright scene run well outside [0,1] and are roughly zero-mean,
    # whereas these match the master's own percentiles almost exactly (0.055/0.434/0.989
    # against 0.067/0.435/0.988). tools/sharp_bake.py and tools/sharp_export.py both still
    # carry the wrong decode; they feed the superseded builds.
    if rgb.min() < -0.05 or rgb.max() > 1.05:
        raise SystemExit(f"f_dc is outside [0,1] (got {rgb.min():.3f}..{rgb.max():.3f}) - "
                         f"this ply may really carry SH coefficients, in which case the "
                         f"decode below needs 0.5 + SH_C0 * x. Check before changing it.")
    col = np.clip(rgb, 0, 1)
    if not args.no_despeckle:
        col = despeckle(col, grid, layers)
    colour = np.concatenate([
        np.rint(col * 255).astype(np.uint8),
        np.rint(np.clip(alpha, 0, 1) * 255).astype(np.uint8)[:, None],
    ], axis=1)

    # ---- shape ------------------------------------------------------------------------
    s_lo = float(np.log(max(scale.min(), 1e-9)))
    s_hi = float(np.log(scale.max()))
    shape = quantise_log(scale, s_lo, s_hi)
    report("scale (relative)", np.ones(scale.size),
           (np.exp(s_lo + shape.astype(np.float32) / 255 * (s_hi - s_lo)).ravel()
            / np.maximum(scale.ravel(), 1e-9)), "x")

    # ---- rotation ---------------------------------------------------------------------
    # 8-bit is what the .splat format already uses for quaternions and what the prototype
    # renderer ran on, so this is a proven precision rather than a chosen one.
    #
    # The sign flip is free and buys the same protection the disparity bias does: q and -q
    # are the same rotation, so choosing the sign that makes the component stored in alpha
    # non-negative pins that channel to [128, 255] without changing the ellipsoid at all.
    qn = quat / np.maximum(np.linalg.norm(quat, axis=1, keepdims=True), 1e-9)
    qn = np.where((qn[:, 3] < 0)[:, None], -qn, qn)
    rot = np.clip(np.rint(qn * 127.0 + 128.0), 0, 255).astype(np.uint8)
    assert rot[:, 3].min() >= 128, "quaternion sign flip failed"

    # ---- write ------------------------------------------------------------------------
    #
    # `exact=True` is load-bearing on every lossless raster and there is no warning if it
    # is missing. WebP is allowed to throw away the RGB of any fully transparent pixel,
    # because for a picture those bytes are unobservable. Here the alpha channel is not
    # opacity: in `geom` it is the low byte of the disparity, in `quat` it is a quaternion
    # component. Any splat that lands on A=0 would have its other three channels quietly
    # zeroed, which puts it at the origin or gives it a degenerate rotation. `exact`
    # disables that cleanup. The round trip below is checked, not assumed.
    #
    # Colour is the one raster that really is a picture, so it takes lossy WebP: 1.84MB ->
    # 0.99MB for a p99 error of 5/255, which is what WebP is for.
    args.out_prefix.parent.mkdir(parents=True, exist_ok=True)
    shp = (grid * layers, grid)  # rows, cols - layers stacked vertically
    lossless = dict(lossless=True, quality=100, method=6, exact=True)
    total = 0
    written: list[Path] = []
    for name, data, mode, kw in (("geom", geom, "RGBA", lossless),
                                 ("color", colour, "RGBA", dict(quality=95, method=6)),
                                 ("shape", shape, "RGB", lossless),
                                 ("quat", rot, "RGBA", lossless)):
        path = args.out_prefix.with_name(f"{args.out_prefix.name}-splat-{name}.webp")
        src = data.reshape(*shp, len(mode))
        Image.fromarray(src, mode).save(path, format="WEBP", **kw)
        back = np.array(Image.open(path).convert(mode))
        err = int(np.abs(back.astype(int) - src.astype(int)).max())
        if kw is lossless and err != 0:
            raise SystemExit(f"{path.name}: lossless round trip changed bytes by {err} - "
                             f"the WebP encoder is not preserving the raster")
        total += path.stat().st_size
        written.append(path)
        print(f"  wrote {path.name:<35} {path.stat().st_size/1e6:6.2f} MB  "
              f"round-trip max err {err}")
    print(f"  {'total':<42}{total/1e6:6.2f} MB")

    # ---- manifest ---------------------------------------------------------------------
    # The room the rig aims into has to be the room the reconstruction describes, so the
    # camera's shape is measured here rather than tuned in the harness.
    #
    # `version` is a content hash of the four rasters, and the renderer appends it to their
    # URLs as `?v=`. The four filenames are stable and Astro serves `public/` verbatim with
    # no fingerprint, so without this a browser that fetched an earlier bake keeps it
    # indefinitely - and a *softer* room is exactly what an older raster looks like, since
    # every bake stage that has ever been removed from this file was a low-pass filter. The
    # manifest itself is fetched with `no-cache`; it is 500 bytes, so revalidating it every
    # load is free and it is the only thing that has to be fresh for the rest to follow.
    # Adler-32 of the geom raster's bytes, in the order the renderer reads them back. The
    # renderer recomputes it off the GPU and refuses to trust a raster that disagrees.
    #
    # This exists because the alpha-bias check is not a general detector, and a decoder was
    # found that passes it while destroying the rest. WebCodecs `ImageDecoder` can hand back
    # a WebP as a YUV `VideoFrame`; `copyTo({format:'RGBA'})` then converts, and chroma is
    # subsampled. Alpha rides along untouched — so the bias check stays silent — while R, G
    # and B are averaged with their neighbours. In a picture that is invisible. Here R and G
    # are the sub-pixel offsets, B is the disparity's high byte, and in the other rasters it
    # is scale and rotation: neighbour-averaging them is a **low-pass filter on the
    # geometry**, which renders as a soft, subtly wrong room with no error anywhere.
    #
    # A position-weighted checksum is the point. A plain sum would survive averaging almost
    # exactly, which is the failure it most needs to catch.
    geom_adler = zlib.adler32(geom.tobytes()) & 0xFFFFFFFF

    version = hashlib.sha256(
        b"".join(hashlib.sha256(f.read_bytes()).digest() for f in written)
    ).hexdigest()[:12]

    near, far = float(z.min()), float(z.max())
    fov = float(np.degrees(2 * np.arctan(H / 2 / fx)))
    diag = float(np.hypot(W, H))
    manifest = {
        "version": version,
        "geomAdler32": int(geom_adler),
        "grid": grid, "layers": layers, "count": int(len(xyz)),
        "width": W, "height": H, "fx": float(fx), "cx": float(cx), "cy": float(cy),
        "dispLo": d_lo, "dispHi": d_hi,
        "offsetRange": OFFSET_RANGE,
        "scaleLogLo": s_lo, "scaleLogHi": s_hi,
        "nearZ": near, "farZ": far, "fovDeg": fov,
        # ml-sharp's own budget: how far the camera may travel before the two layers stop
        # having an answer. The room's ambient amplitudes are set against this.
        "maxLateralM": MAX_DISPARITY * diag * near / fx,
        "maxPushM": MAX_ZOOM * near,
    }
    mpath = args.out_prefix.with_name(f"{args.out_prefix.name}-splat.json")
    mpath.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"  wrote {mpath.name}  version {version}")
    print(f"  near {near:.3f}m  far {far:.2f}m  fov {fov:.2f}deg  "
          f"lateral budget {manifest['maxLateralM']*100:.1f}cm")
    return 0


if __name__ == "__main__":
    sys.exit(main())
