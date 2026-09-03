#!/usr/bin/env python3
"""Stage 0/5 alternative - bake flat plates out of a SHARP Gaussian splat.

SHARP (apple/ml-sharp, arXiv 2512.10685) regresses a 3D Gaussian scene from one image.
We do **not** ship the Gaussians. Rendering them needs ~1.16M primitives at ~46fps on a
fast Mac, which is a real GPU workload on what CLAUDE.md calls the cheap ambient tier, and
their colour is capped at SHARP's internal 768x768 grid. Instead we harvest the two things
the splat is genuinely good at and write them out as ordinary images:

  1. **Depth.** Metric, sharp at silhouettes, and it resolves the yard through the glass
     rather than reading it as one flat pane. Emitted in exactly stage 0's format - 16-bit
     PNG, disparity (near HIGH), master dimensions - so `depth_prep.py` and everything
     after it is unchanged and either source still works. See tools/depth.py.
  2. **A back layer.** Render the scene with the frontmost surface removed and what is
     left is what stands behind every object: a geometrically correct disocclusion fill,
     produced with no SAM prompts, no `in_front_of` authoring, no peel order and no
     halo/feather tuning. This is what replaces LaMa.

Two layers, front and back, and the front tears wherever depth jumps (`setEdgeCut` in
roomRenderer.ts) so the back shows through. That is the whole cut - it is computed from
depth, per quad, everywhere, instead of authored per object in objects.json. The window
needs no special case for the same reason: the old `fill` op existed only because the
shell mesh never tore, so a 48-level cliff at every glazing bar became a stretched
triangle. A mesh that tears lets the depth map say what it means.

The 768x768 colour cap that rules the Gaussians out as a runtime representation does not
bite here. Visible pixels still come from the full-resolution master; the plate is only
ever read inside disocclusion tears, which are slivers a few pixels wide at the camera
excursions this room actually uses. Nobody can see softness in a three-pixel sliver.

Offline tooling. Never enters package.json - the site loads plain images.

  tools/.venv/bin/python tools/sharp_bake.py \
      --ply art/room-day-summer.ply --out-prefix art/build/room-day-summer-sharp
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

# Degree-0 spherical harmonic. SHARP exports sRGB-encoded SH, so the colours come back
# straight out of this with no gamma step - which is what matched the master to 27.6dB.
SH_C0 = 0.28209479177387814


def load_ply(path: Path) -> dict:
    """Read a SHARP .ply. Returns metric positions, colours, opacity, scale, quaternions.

    SHARP's `num_layers` is 2, and `save_ply` flattens (layer, pixel), so the file is two
    contiguous 768x768 rasters: the first is the visible surface, the second the hidden
    geometry behind it. We need that split to peel the front layer off.
    """
    raw = path.read_bytes()
    end = raw.index(b"end_header\n") + len(b"end_header\n")
    header = raw[:end].decode()
    n = int([l for l in header.splitlines() if l.startswith("element vertex")][0].split()[-1])

    v = np.frombuffer(raw, "<f4", n * 14, end).reshape(n, 14).astype(np.float32)
    off = end + n * 14 * 4
    intr = np.frombuffer(raw, "<f4", 9, off + 64).reshape(3, 3)
    imsz = np.frombuffer(raw, "<u4", 2, off + 64 + 36)

    quat = v[:, 10:14]
    quat = quat / np.linalg.norm(quat, axis=1, keepdims=True)
    return {
        "xyz": v[:, 0:3],
        "rgb": np.clip(0.5 + SH_C0 * v[:, 3:6], 0.0, 1.0),
        "alpha": 1.0 / (1.0 + np.exp(-v[:, 6])),
        "scale": np.exp(v[:, 7:10]),
        "quat": quat,
        "fx": float(intr[0, 0]),
        "cx": float(intr[0, 2]),
        "cy": float(intr[1, 2]),
        "width": int(imsz[0]),
        "height": int(imsz[1]),
        "n_half": n // 2,
    }


def covariance_2d(g: dict, scale: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Project every Gaussian to the image plane at `scale` x the master's resolution.

    Returns pixel centres, the 2x2 screen covariance as (a, b, c), and camera-space z.
    The camera sits at the origin looking down +z (OpenCV: x right, y down, z forward),
    which is where SHARP put it - the extrinsics in the file are identity, so the splat
    shares the master's frame and hotspot rectangles survive untouched.
    """
    w, x, y, z = g["quat"].T
    rot = np.empty((len(x), 3, 3), np.float32)
    rot[:, 0, 0] = 1 - 2 * (y * y + z * z); rot[:, 0, 1] = 2 * (x * y - w * z); rot[:, 0, 2] = 2 * (x * z + w * y)
    rot[:, 1, 0] = 2 * (x * y + w * z); rot[:, 1, 1] = 1 - 2 * (x * x + z * z); rot[:, 1, 2] = 2 * (y * z - w * x)
    rot[:, 2, 0] = 2 * (x * z - w * y); rot[:, 2, 1] = 2 * (y * z + w * x); rot[:, 2, 2] = 1 - 2 * (x * x + y * y)
    cov3 = (rot * (g["scale"] ** 2)[:, None, :]) @ rot.transpose(0, 2, 1)

    fx = g["fx"] * scale
    cx, cy = g["cx"] * scale, g["cy"] * scale
    p = g["xyz"]
    zc = np.maximum(p[:, 2], 1e-4)
    iz = 1.0 / zc

    jac = np.zeros((len(p), 2, 3), np.float32)
    jac[:, 0, 0] = fx * iz; jac[:, 0, 2] = -fx * p[:, 0] * iz * iz
    jac[:, 1, 1] = fx * iz; jac[:, 1, 2] = -fx * p[:, 1] * iz * iz
    cov2 = jac @ cov3 @ jac.transpose(0, 2, 1)

    # The same 0.3px^2 dilation the reference splat rasterizer uses: it keeps a Gaussian
    # that projects to less than a pixel from falling between samples.
    a = cov2[:, 0, 0] + 0.3
    b = cov2[:, 0, 1]
    c = cov2[:, 1, 1] + 0.3
    uv = np.stack([fx * p[:, 0] * iz + cx, fx * p[:, 1] * iz + cy], 1)
    return uv, np.stack([a, b, c], 1), zc


def _footprint_buckets(abc: np.ndarray, cap: int) -> np.ndarray:
    """Half-width of the square each Gaussian is splatted through, bucketed.

    Bucketing keeps the scatter loop to a handful of window sizes instead of one per
    Gaussian. 2 sigma covers ~95% of a 2D Gaussian and costs 0.44x the fragments of 3.
    """
    a, b, c = abc[:, 0], abc[:, 1], abc[:, 2]
    det = a * c - b * b
    mid = 0.5 * (a + c)
    lam = mid + np.sqrt(np.maximum(mid * mid - det, 0.0))
    radius = 2.0 * np.sqrt(np.maximum(lam, 1e-8))
    ks = np.array([2, 4, 8, 16, 32, 64, 128], np.int64)
    ks = ks[ks <= cap] if (ks <= cap).any() else ks[:1]
    return ks[np.clip(np.searchsorted(ks, np.ceil(radius)), 0, len(ks) - 1)]


def rasterize(g: dict, keep: np.ndarray, w: int, h: int, scale: float,
              behind: np.ndarray | None = None, want_colour: bool = True) -> dict:
    """Splat `keep` Gaussians into a w x h frame.

    Two products, because the pipeline wants two different things from the same pass:
      * `depth`  - z of the nearest surface, a plain z-buffer.
      * `colour` - alpha-weighted mean of the Gaussians at that nearest surface.

    `behind` is an optional per-pixel depth; a Gaussian only contributes where it lies
    behind that value. Passing the first pass's z-buffer is how the frontmost surface gets
    peeled off, which is the whole trick for the background plate.
    """
    uv, abc, zc = covariance_2d(g, scale)
    idx = np.where(keep & (zc > 0.05))[0]
    uv, abc, zc = uv[idx], abc[idx], zc[idx]
    alpha = g["alpha"][idx]
    rgb = g["rgb"][idx]

    a, b, c = abc[:, 0], abc[:, 1], abc[:, 2]
    det = a * c - b * b
    ok = (det > 1e-12) & (alpha > 0.02)
    uv, abc, zc, alpha, rgb = uv[ok], abc[ok], zc[ok], alpha[ok], rgb[ok]
    a, b, c, det = a[ok], b[ok], c[ok], det[ok]
    inv = np.stack([c / det, -b / det, a / det], 1)  # conic (ixx, ixy, iyy)

    kbuf = _footprint_buckets(abc, cap=128)
    u0 = np.floor(uv[:, 0]).astype(np.int64)
    v0 = np.floor(uv[:, 1]).astype(np.int64)

    t_uv = torch.from_numpy(uv)
    t_inv = torch.from_numpy(inv)
    t_alpha = torch.from_numpy(alpha)
    t_z = torch.from_numpy(zc)
    t_rgb = torch.from_numpy(rgb)
    t_behind = torch.from_numpy(behind.reshape(-1)) if behind is not None else None

    zbuf = torch.full((h * w,), float("inf"), dtype=torch.float32)
    acc = torch.zeros((h * w, 3), dtype=torch.float32) if want_colour else None
    wsum = torch.zeros((h * w,), dtype=torch.float32) if want_colour else None

    def sweep(fn) -> None:
        for k in np.unique(kbuf):
            sel = np.where(kbuf == k)[0]
            if not len(sel):
                continue
            t_sel = torch.from_numpy(sel)
            su, sv = u0[sel], v0[sel]
            for dy in range(-k, k + 1):
                py = sv + dy
                iny = (py >= 0) & (py < h)
                if not iny.any():
                    continue
                for dx in range(-k, k + 1):
                    px = su + dx
                    m = iny & (px >= 0) & (px < w)
                    if not m.any():
                        continue
                    j = t_sel[torch.from_numpy(m)]
                    pxm = torch.from_numpy(px[m]); pym = torch.from_numpy(py[m])
                    ddx = pxm.float() + 0.5 - t_uv[j, 0]
                    ddy = pym.float() + 0.5 - t_uv[j, 1]
                    e = t_inv[j, 0] * ddx * ddx + 2 * t_inv[j, 1] * ddx * ddy + t_inv[j, 2] * ddy * ddy
                    weight = t_alpha[j] * torch.exp(-0.5 * e)
                    flat = pym * w + pxm
                    if t_behind is not None:
                        # Strictly behind the peeled surface, with a small relative margin
                        # so a surface does not re-contribute to its own removal.
                        live = t_z[j] > t_behind[flat] * 1.02 + 0.03
                        weight = torch.where(live, weight, torch.zeros_like(weight))
                    fn(flat, j, weight)

    def pass_depth(flat, j, weight):
        good = weight > 0.15
        if good.any():
            zbuf.scatter_reduce_(0, flat[good], t_z[j][good], reduce="amin", include_self=True)

    sweep(pass_depth)

    out = {"depth": zbuf.numpy().reshape(h, w)}
    if not want_colour:
        return out

    zref = zbuf.clone()

    def pass_colour(flat, j, weight):
        # Only the nearest surface's Gaussians colour a pixel; anything materially behind
        # it is occluded and must not bleed forward.
        good = (weight > 0.02) & (t_z[j] < zref[flat] * 1.03 + 0.03)
        if good.any():
            f, wv = flat[good], weight[good]
            acc.index_add_(0, f, t_rgb[j][good] * wv[:, None])
            wsum.index_add_(0, f, wv)

    sweep(pass_colour)
    ws = wsum.numpy().reshape(h, w)
    col = acc.numpy().reshape(h, w, 3)
    out["colour"] = np.where(ws[..., None] > 1e-4, col / np.maximum(ws, 1e-4)[..., None], 0.0)
    out["coverage"] = ws
    return out


def fill_holes(depth: np.ndarray, iters: int = 12) -> np.ndarray:
    """Close pixels no Gaussian reached, by growing the nearest surface into them.

    These are small - SHARP's Gaussians do not quite tile their own 768x768 sampling grid,
    so an honest z-buffer leaves speckle. Writing those as the far plane would be the worst
    possible answer: depth is what the mesh is BUILT from, so a one-pixel far spike inside
    a near surface becomes a spike of real geometry. Growing the nearest neighbour inward
    is both cheaper and correct - a hole in a surface is part of that surface.
    """
    d = torch.from_numpy(depth)[None, None]
    hole = ~torch.isfinite(d)
    big = float(np.nanmax(depth[np.isfinite(depth)])) * 4.0
    d = torch.where(hole, torch.full_like(d, big), d)
    for _ in range(iters):
        if not hole.any():
            break
        # min-pool 3x3, as -maxpool(-x)
        near = -torch.nn.functional.max_pool2d(-d, 3, stride=1, padding=1)
        d = torch.where(hole, near, d)
        hole = hole & (d >= big)
    return d[0, 0].numpy()


def push_fill(rgb: np.ndarray, hole: np.ndarray, iters: int = 64) -> np.ndarray:
    """Grow the nearest known colour into `hole`. Only ever read inside a sliver."""
    import cv2
    out = rgb.astype(np.float32)
    todo = hole.copy()
    k = np.ones((3, 3), np.uint8)
    for _ in range(iters):
        if not todo.any():
            break
        known = (~todo).astype(np.float32)
        num = cv2.blur(out * known[..., None], (3, 3))
        den = cv2.blur(known, (3, 3))
        grown = num / np.maximum(den, 1e-6)[..., None]
        fillable = todo & (den > 1e-6)
        out = np.where(fillable[..., None], grown, out)
        todo &= ~fillable
    return np.clip(out, 0, 255).astype(np.uint8)


def disparity_scale(depth: np.ndarray, lo_pct: float, hi_pct: float) -> tuple[float, float]:
    """Pick the disparity window the 16-bit range maps onto.

    Taken from the *front* surface and then reused for every plate. Two layers normalised
    independently would each be internally sensible and would not register with each other
    in 3D, which is the one thing a layer stack cannot survive.
    """
    disp = 1.0 / np.maximum(depth, 1e-4)
    return float(np.percentile(disp, lo_pct)), float(np.percentile(disp, hi_pct))


def write_depth(depth: np.ndarray, path: Path, lo: float, hi: float, bits: int = 8) -> None:
    """Metric z -> disparity, near HIGH, filling the whole integer range.

    Disparity rather than distance is what the rest of the pipeline expects, and it is
    also what keeps the window honest: 1/z compresses the yard's 100m into the bottom
    slice of the range instead of crushing the room into a handful of levels.

    **8-bit for anything the browser loads.** WebP has no 16-bit mode, and PIL does not
    say so - handed an I;16 image it writes a file that opens as RGB and decodes to
    noise (measured: mean error 183/255 against the source). The plates are therefore
    written at the precision they will actually ship at, so what is reviewed offline is
    what the renderer gets. 16-bit is kept only for `-depth16.png`, which exists to feed
    the older depth_prep.py path and never reaches public/art.
    """
    disp = 1.0 / np.maximum(depth, 1e-4)
    norm = np.clip((disp - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
    if bits == 16:
        Image.fromarray((norm * 65535.0 + 0.5).astype(np.uint16)).save(path)
    else:
        Image.fromarray((norm * 255.0 + 0.5).astype(np.uint8)).save(path)
    print(f"wrote {path}  ({depth.shape[1]}x{depth.shape[0]}, {bits}-bit disparity, near=high)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ply", required=True, type=Path)
    ap.add_argument("--master", required=True, type=Path,
                    help="the colour master. Used for the back plate wherever nothing is "
                         "actually hidden, where 'what is behind' IS the visible surface.")
    ap.add_argument("--out-prefix", required=True, type=Path,
                    help="art/build/room-day-summer-sharp")
    ap.add_argument("--scale", type=float, default=1.0,
                    help="render size relative to the master, for the front depth.")
    ap.add_argument("--plate-scale", type=float, default=0.5,
                    help="the back layer is only ever seen inside disocclusion slivers, "
                         "so it does not need the master's resolution.")
    ap.add_argument("--far-clip", type=float, default=0.0,
                    help="metres; 0 (default) keeps SHARP's true depth through the glass. "
                         "Clipping was tried on the theory that a 100m yard crushes the "
                         "room's disparity range, and the measurement refutes it: "
                         "disparity is 1/z, so the yard is naturally compressive and the "
                         "room under 8m still keeps 220 of 255 levels. Real depth behind "
                         "the window is what stops the yard sliding with the wall plane "
                         "as the camera moves.")
    ap.add_argument("--lo-pct", type=float, default=0.1)
    ap.add_argument("--hi-pct", type=float, default=99.9)
    args = ap.parse_args()

    g = load_ply(args.ply)
    n = len(g["xyz"])
    print(f"{args.ply}: {n} Gaussians, master {g['width']}x{g['height']}, fx {g['fx']:.1f}")

    all_g = np.ones(n, bool)
    out = lambda suffix: args.out_prefix.with_name(args.out_prefix.name + suffix)

    # ---- layer 1 (front): the master, with SHARP's depth --------------------------
    # Named -layer1 so tools/export.py, which globs -layerN.png and pairs each with its
    # -depth.png, needs no knowledge of where the plates came from. Front is opaque: the
    # cut is the renderer's per-quad tear, not an alpha channel.
    w = int(round(g["width"] * args.scale))
    h = int(round(g["height"] * args.scale))
    t0 = time.time()
    print(f"rasterizing front depth at {w}x{h} ...")
    front = fill_holes(rasterize(g, all_g, w, h, args.scale, want_colour=False)["depth"])
    if args.far_clip > 0:
        print(f"  far-clip {args.far_clip}m: "
              f"{100 * (front > args.far_clip).mean():.1f}% of pixels flattened")
        front = np.minimum(front, args.far_clip)

    lo, hi = disparity_scale(front, args.lo_pct, args.hi_pct)
    near_z, far_z = 1.0 / max(hi, 1e-9), 1.0 / max(lo, 1e-9)
    write_depth(front, out("-layer1-depth.png"), lo, hi)
    write_depth(front, out("-depth16.png"), lo, hi, bits=16)
    print(f"  metric {near_z:.2f}m .. {far_z:.2f}m  ->  65535..0    {time.time()-t0:.1f}s")

    master_full = Image.open(args.master).convert("RGB")
    if master_full.size != (w, h):
        master_full = master_full.resize((w, h), Image.LANCZOS)
    master_full.save(out("-layer1.png"))
    print(f"wrote {out('-layer1.png')}  ({w}x{h}, the master unchanged)")

    # ---- layer 0 (back): SHARP's second layer, rendered on its own ----------------
    #
    # `save_ply` flattens (layer, pixel) and num_layers is 2, so the file is literally two
    # 768x768 rasters in one camera frame — a layered depth image, already. The second one
    # is a complete surface: rendered alone it leaves 0.00% of the frame uncovered.
    #
    # Every earlier version of this block peeled instead: rasterize everything with a
    # `behind = z_front * 1.02 + 0.03` test, which keeps only the 2.7% of grid cells where
    # B sits materially behind A and discards the other 97%. Having discarded it, the plate
    # then had to be invented back — the master wherever nothing was hidden, then a
    # morphological top-hat and a harmonic fill of the footprints, then an erosion
    # envelope. Each invention was wrong somewhere and each repair moved the error rather
    # than removing it: black specks trailing every moving object, smears at the window,
    # fringes on the fig. There is nothing to invent. Take the layer.
    #
    # It is also why rendering the PLY directly looked right: that used both complete
    # layers and peeled nothing.
    pw = int(round(g["width"] * args.plate_scale))
    ph = int(round(g["height"] * args.plate_scale))
    t0 = time.time()
    print(f"rasterizing back layer at {pw}x{ph} ...")
    layer_b = np.zeros(n, bool)
    layer_b[g["n_half"]:] = True
    back = rasterize(g, layer_b, pw, ph, args.plate_scale, want_colour=True)

    thin = back["coverage"] < 0.05
    colour = push_fill((np.clip(back["colour"], 0, 1) * 255 + 0.5).astype(np.uint8), thin)
    Image.fromarray(colour).save(out("-layer0.png"))
    write_depth(fill_holes(back["depth"]), out("-layer0-depth.png"), lo, hi)
    print(f"  {100 * thin.mean():.2f}% of it too thinly covered to trust, push-filled")
    print(f"wrote {out('-layer0.png')} and its depth  ({pw}x{ph})   {time.time()-t0:.1f}s")

    # ---- the sidecar: what the renderer needs to reconstruct in real metres --------
    # SHARP is metric, so nearZ/farZ stop being a feel dial and become a measurement.
    # How far the camera may move, budgeted the way ml-sharp budgets its own preview
    # videos (src/sharp/utils/camera.py, compute_max_offset). The insight is to size the
    # motion in *screen* terms and solve for metres: allow the nearest content to sweep
    # `max_disparity` of the image diagonal, and the metres follow from that point's own
    # distance. Apple ships 0.08 of the diagonal lateral and 0.15 of the near depth
    # forward, which is where their two-layer disocclusion still holds - the same place
    # ours does, since it is the same two layers.
    diag = float(np.hypot(g["width"] / g["fx"], g["height"] / g["fx"]))
    meta = {
        "nearZ": round(near_z, 4),
        "farZ": round(far_z, 4),
        "fovDeg": round(float(2 * np.degrees(np.arctan(g["cy"] / g["fx"]))), 3),
        "maxLateralM": round(0.08 * diag * near_z, 4),
        "maxPushM": round(0.15 * near_z, 4),
        "width": g["width"],
        "height": g["height"],
        "source": args.ply.name,
    }
    out("-scene.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {out('-scene.json')}  {meta}")


if __name__ == "__main__":
    main()
