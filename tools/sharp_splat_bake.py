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

**What is emitted** (all at grid x (grid * layers), layer 0 on top). Only `color` is an
image: the other three are lookup tables indexed by splat, and a browser colour-manages
anything it decodes as a picture - see write_table().

  -splat-geom.bin    RG = signed offset from the cell centre in master px, square-companded
                     B  = disparity high 8 bits, A = low 7 bits biased into [128, 255].
  -splat-color.webp  RGB = colour from the degree-0 SH, A = opacity. Lossless WebP - it is
                     still a table, but it is also a picture; see the write stage.
  -splat-shape.bin   RGB = per-axis scale, log-quantised, A = 255.
  -splat-quat.bin    RGBA = rotation quaternion, unsigned 8-bit, signed so A >= 128.

  The `.bin` files are `SPLT` + uint32 width + uint32 height + four planes, deflated.
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
import struct
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


# The three rasters that are lookup tables rather than pictures. They ship as raw bytes,
# not as images, because a browser is entitled to colour-manage anything it decodes as one -
# see write_table().
TABLES = ("geom", "shape", "quat")


def write_table(path: Path, data: np.ndarray, shape: tuple[int, int]) -> int:
    """Write one attribute table as deflated raw planes. Returns the byte count.

    **Why these three are not images any more.** They were lossless WebP, which is exact on
    disk and was still not enough: Safari applies a colour transform when it decodes them,
    ignoring `colorSpaceConversion: 'none'` on `createImageBitmap`, and the files carry no
    ICC chunk to strip - an untagged image is assumed sRGB and converted to the *display's*
    profile, so there is nothing to pre-compensate for either. It reported `geom alpha bias
    intact` (a colour transform does not touch alpha) together with `geom raster REWRITTEN
    in transit`, which is that signature and no other. Setting
    `UNPACK_COLORSPACE_CONVERSION_WEBGL` covers the upload and changed nothing, because the
    damage is done at decode.

    R and G here are sub-pixel offsets, B is the disparity's high byte, and in the other two
    it is scale and rotation. A colour transform on those is a **transform on the geometry**:
    the room comes back soft, with black speckle where the field stops tiling.

    **So the rule is: pictures go through the image decoder, tables do not.** `color` stays
    WebP - it really is a picture, and colour-managing it is the browser doing its job.

    Planar, then deflate. The channels are unrelated quantities, so interleaving them puts
    four uncorrelated byte streams under one entropy model: planar costs 2.89 MB against
    3.98 interleaved for `geom`, and 8.69 against 10.34 over the three. Against lossless
    WebP's 7.57 that is **+1.12 MB, which is what exactness costs** - WebP's spatial
    predictors are genuinely good at this and no filter tried here (up, left, either one
    planar) beat plain planar. `DecompressionStream('deflate')` inflates it in the browser;
    a browser without it gets the poster, which is the same ladder WebGL2 is on.
    """
    rows, cols = shape
    if data.shape[1] == 3:  # `shape` has no fourth channel; the GPU texture wants one.
        data = np.concatenate([data, np.full((len(data), 1), 255, np.uint8)], axis=1)
    planes = np.ascontiguousarray(data.reshape(rows, cols, 4).transpose(2, 0, 1)).tobytes()
    blob = b"SPLT" + struct.pack("<II", cols, rows) + planes
    path.write_bytes(zlib.compress(blob, 9))
    if zlib.decompress(path.read_bytes()) != blob:
        raise SystemExit(f"{path.name}: deflate did not round-trip")
    return path.stat().st_size


def check_variant_ply(name: str, path: Path, v: dict, base: dict,
                      grid: int, layers: int) -> None:
    """Assert a variant reconstruction indexes the same rays as the day one, and say how far
    its geometry drifted.

    **What must match, and why it is an assertion rather than a warning.** Only `f_dc` is
    taken from a variant ply; it is applied to the day build's splats by index. That is
    sound exactly when cell `i` of one file is cell `i` of the other, which holds because
    SHARP's grid is 768x768 hardcoded and predicted from a single camera - so identical
    intrinsics, image size and count mean identical rays. Any of those differing means the
    two files are not the same lattice and the colours would be scattered across the room.

    **What is allowed to differ, and what it costs.** The two runs fit independently, so a
    splat's depth, size and rotation drift a little. `f_dc` is a blend coefficient, not a
    surface colour - it is optimised so overlapping Gaussians sum to the master - so a
    coefficient fitted for a slightly different Gaussian is slightly wrong on this one.
    Measured day against night on this scene the median splat is within 0.9% in depth and
    2% in size, with a real tail (p99 depth 56%, p10 scale 0.66). The tail is worth printing
    because it is the one way this path can go wrong, and it is checked by rendering the
    result at the home camera against the variant master - if the drift mattered, that error
    rises above the day build's own.
    """
    for key, label in (("fx", "focal length"), ("cx", "principal x"), ("cy", "principal y"),
                       ("width", "master width"), ("height", "master height")):
        if v[key] != base[key]:
            raise SystemExit(
                f"--variant {name}={path.name}: {label} is {v[key]}, the day build's is "
                f"{base[key]}. A variant ply must be SHARP run on a master with the same "
                f"framing, or cell i is not the same ray in both and its colours belong to "
                f"other splats.")
    if len(v["xyz"]) != grid * grid * layers:
        raise SystemExit(
            f"--variant {name}={path.name}: {len(v['xyz']):,} splats, expected "
            f"{grid * grid * layers:,} ({layers} x {grid}x{grid}).")
    z, zv = base["xyz"][:, 2], v["xyz"][:, 2]
    drift = np.abs(zv - z) / np.maximum(z, 1e-6)
    ratio = v["scale"].max(1) / np.maximum(base["scale"].max(1), 1e-9)
    print(f"  {'variant geometry drift':<35} depth p50 {np.median(drift):.3f} "
          f"p99 {np.percentile(drift, 99):.3f}   scale p50 {np.median(ratio):.3f} "
          f"p10 {np.percentile(ratio, 10):.3f}")


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
    ap.add_argument("--variant", action="append", default=[], metavar="NAME=PLY",
                    help="an extra colour raster, from a second SHARP reconstruction of the "
                         "same room under different light, e.g. "
                         "night=art/room-night-summer.ply. Repeatable.")
    args = ap.parse_args()

    variants = []
    for spec in args.variant:
        name, _, path = spec.partition("=")
        if not name or not path:
            raise SystemExit(f"--variant wants NAME=PLY, got {spec!r}")
        if not path.endswith(".ply"):
            raise SystemExit(
                f"--variant {spec!r}: a variant is a second SHARP reconstruction, not an "
                f"image. Inferring a variant's colours from a photograph of it was tried "
                f"and removed - see the comment at the variant loop in main().")
        variants.append((name, Path(path)))

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
    alpha8 = np.rint(np.clip(alpha, 0, 1) * 255).astype(np.uint8)[:, None]

    def pack(c: np.ndarray) -> np.ndarray:
        return np.concatenate([np.rint(c * 255).astype(np.uint8), alpha8], axis=1)

    colour = pack(col)

    # ---- variant colours ---------------------------------------------------------------
    #
    # **One geometry, N colours, and each colour comes from its own reconstruction.**
    # A variant ply is SHARP run again on the variant master. Only its `f_dc` is taken;
    # position, size, rotation and opacity stay the day build's, so every authored number in
    # the app - the aim points in hotspots.ts, the disparities in ambient.ts, the excursion
    # in scene.ts - is still measured against the cloud that ships, and a crossfade dissolves
    # between two colours rather than swimming between two clouds. The payload is one extra
    # colour raster, the same as the inferred path cost.
    #
    # SHARP's grid is 768x768 predicted from one camera, so cell `i` is the same ray in both
    # reconstructions; `check_variant_ply` asserts the framing that guarantees it.
    #
    # **Settled: a variant's colours are never inferred from an image of it.** A previous
    # build took a pixel-registered night *edit* of the master and moved every splat's colour
    # by the lighting ratio it read there. The appeal is obvious - one reconstruction, one
    # 8MB ply, a variant costs a jpg - and it cannot be made to work, because the question it
    # has to answer is undetermined. A photograph does not record what is behind a leaf, so a
    # hidden splat has no pixel of its own and is lit through whatever covers it. In this
    # room that is a white glazing bar, which looks the same at midnight as at noon, in front
    # of a yard that does not: at 12cm of lateral travel a sunlit fence slid out from behind
    # every bar, `f_dc` from the *day* fit dimmed by a ratio measured on the mullion.
    #
    # Roughly 250 lines went on bounding that - blurring the ratio, anchoring on `f_dc`
    # rather than a point sample, and a radius-free nearest-same-depth search to lend hidden
    # splats a visible neighbour's lighting. Each fixed something real and none fixed this.
    # A night reconstruction has no daylight in it at any depth, hidden or visible, so the
    # failure is gone by construction rather than bounded. Measured against the night master
    # at the home camera: inferred 8.93/255, reconstructed 6.01, where the day build scores
    # 7.94 against its own master. If a variant ever has no reconstruction, it does not get
    # a raster - it gets a reconstruction.
    variant_colours = []
    for n, p in variants:
        v = load_ply(p)
        check_variant_ply(n, p, v, g, grid, layers)
        c = np.clip(v["rgb"], 0, 1)
        if not args.no_despeckle:
            c = despeckle(c, grid, layers)
        print(f"  {p.name:<35} from its own reconstruction, mean level "
              f"{c.mean() / col.mean():.3f}x the day fit")
        variant_colours.append((n, c))
    variant_rasters = [(f"color-{n}", pack(c)) for n, c in variant_colours]

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
    # **Colour is not a picture either, and treating it as one was a real defect.** It used
    # to take lossy WebP - "the one raster that really is a picture" - for 1.23MB against
    # 2.46MB lossless. But lossy WebP subsamples chroma 4:2:0, and a 2x2 block here is not
    # four neighbouring pixels of an image, it is *four splats*, which share a grid cell
    # neighbourhood and nothing else. Two of them can be a hundred metres apart in depth -
    # a glazing bar and the yard behind it - and 4:2:0 makes them share one hue. On screen
    # they are not in the same place, so each carries a colour blended with a surface it is
    # nowhere near.
    #
    # Measured on the night raster: mean per-splat error 2.7/255, p99 27, **max 215**, and
    # chroma is flat within every 2x2 block (spread 0.9 against luma's 5.2) - the encoder's
    # fingerprint, not the data's. Lossless is exactly 0.
    #
    # It stayed invisible for as long as the room shipped day-only, because the day palette
    # has almost no chroma contrast where the geometry has depth contrast: a white glazing
    # bar against a pale sky differs in luma, which 4:2:0 keeps at full resolution. Night is
    # the opposite - warm lamplit bars against a deep blue pane is close to the maximum
    # chroma step the format can be given - so the same encoder setting that cost nothing
    # for a year started painting the window with hue borrowed across depth.
    #
    # The other three rasters are lossless because they are quantised geometry. This one is
    # a lookup table indexed by splat. Neither is a picture; only one of them was treated
    # like it. +1.2MB per raster.
    args.out_prefix.parent.mkdir(parents=True, exist_ok=True)
    shp = (grid * layers, grid)  # rows, cols - layers stacked vertically
    lossless = dict(lossless=True, quality=100, method=6, exact=True)
    total = 0
    written: list[Path] = []
    for name, data, mode, kw in [("geom", geom, "RGBA", lossless),
                                 ("color", colour, "RGBA", lossless),
                                 ("shape", shape, "RGB", lossless),
                                 ("quat", rot, "RGBA", lossless)] + [
                                 (n, d, "RGBA", lossless) for n, d in variant_rasters]:
        if name in TABLES:
            path = args.out_prefix.with_name(f"{args.out_prefix.name}-splat-{name}.bin")
            size, err = write_table(path, data, shp), 0
        else:
            path = args.out_prefix.with_name(f"{args.out_prefix.name}-splat-{name}.webp")
            src = data.reshape(*shp, len(mode))
            Image.fromarray(src, mode).save(path, format="WEBP", **kw)
            back = np.array(Image.open(path).convert(mode))
            err = int(np.abs(back.astype(int) - src.astype(int)).max())
            if kw is lossless and err != 0:
                raise SystemExit(f"{path.name}: lossless round trip changed bytes by {err} "
                                 f"- the WebP encoder is not preserving the raster")
            size = path.stat().st_size
        total += size
        written.append(path)
        print(f"  wrote {path.name:<35} {size/1e6:6.2f} MB  round-trip max err {err}")
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
        # Extra colour rasters sharing this geometry, as `-splat-color-<name>.webp`. The
        # renderer treats an absent or unknown name as "day" and draws the base raster, so
        # dropping a variant from a bake degrades to the day room rather than to nothing.
        "variants": [n for n, _ in variants],
        # **What the renderer clears to, per variant, and it is not decoration.** Any pixel
        # no splat covers takes this colour, and the camera opens such pixels every time it
        # leaves centre: disocclusion at a silhouette is a hole, and a hole is the clear
        # colour. It was one hard-coded warm off-white (0.949, 0.914, 0.863) chosen to match
        # `--room-bg` for the letterbox mat, on the assumption that the mat was the only
        # place it showed. It is not. In a night room every one of those holes was a
        # daylight-cream patch, which no amount of work on the colour rasters could fix,
        # because the pixels were never drawn from one.
        #
        # A low percentile of the variant's own visible layer, not the median. Holes do not
        # open in an average place: they open behind the nearest, largest objects in the
        # frame - the fig, the lampshade, the window frame - and what is behind those is the
        # dark end of the room. The median of a night frame is 86/61/68, which is lighter
        # than the yard it would be standing in for, and reads as a light patch. Erring dark
        # is also the safer direction, because a hole that is slightly too dark reads as
        # shadow and one that is slightly too light reads as a hole.
        "backgrounds": {n: [round(float(x), 4) for x in
                            np.percentile(c[:nh].reshape(-1, 3), 20, axis=0)]
                        for n, c in variant_colours},
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
