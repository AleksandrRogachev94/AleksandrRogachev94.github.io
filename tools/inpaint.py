#!/usr/bin/env python3
"""Stage 5 - build one plate per layer, with the surface behind it painted in.

Back to front. Removing a layer reveals the surface underneath, which the master never
painted; that surface is what stops the mesh smearing when the camera moves laterally.

Two rules decide what each plate holds:

**Colour** for layer r is the master with everything in FRONT of r removed and filled.
The shell (rank 0) therefore ends up a complete, opaque image of the empty room - and
because it is complete, it can be judged by eye, which is the only review that catches a
bad mask.

**Alpha** for layer r is its own mask, plus two extensions that exist for opposite
reasons:

    alpha_r = mask_r | (dilate(mask_r, margin) & front_r) | matte(feather band)

The *margin* band is opaque fill, extended only underneath the layers in front of r.
Dilating everywhere would be wrong - the band would stick out past the silhouette and
show at rest as a halo. Extending it only where a nearer layer covers it means the band
is hidden until the camera moves, which is exactly when it is needed. It also handles
both cases without a special rule: where a layer-2 object stands on layer 1 the band is
filled from layer 1, and where it stands against the shell there is no band and the
shell - opaque and complete - shows through instead.

The *feather* band is the opposite: fractional alpha across the silhouette itself, where
the art is genuinely part object and part background. A binary mask has to round that
fraction to one side, and either side is a visible artefact - background left in the plate
behind becomes a ghost outline that stays put while the object moves. `matte` solves for
the fraction instead. See its docstring; it is the reason alpha is soft at all.

Colour is inpainted with LaMa, depth with Telea. LaMa is trained on natural images, so a
depth map is off-distribution and it can invent texture into what has to be a smooth
gradient; depth behind an object is plain floor or wall, where interpolation is both more
correct and cheaper.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from depth_fix import laplace_fill


def nearest_colour(bgr, sel, trust):
    """The colour of the nearest pixel well inside `sel`, propagated outward.

    Used as the foreground estimate for matting. Taken from the *interior* because the
    silhouette's own pixels are the ones already blended with the background - sampling
    them would make the estimate agree with the master by construction and drive every
    alpha to 1, which is the hard edge we are trying to get rid of.
    """
    inner = cv2.erode(sel.astype(np.uint8), trust) > 0
    if not inner.any():
        inner = sel
    _, labels = cv2.distanceTransformWithLabels(
        (~inner).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    out = np.empty_like(bgr)
    for c in range(3):
        lut = np.zeros(labels.max() + 1, np.uint8)
        lut[labels[inner]] = bgr[..., c][inner]
        out[..., c] = lut[labels]
    return out


def matte(bgr, under, mask, band_out, trust):
    """Solve the compositing equation across a layer's silhouette.

    A painterly silhouette is not a step. Every edge texel is genuinely part object, part
    background - M = a*F + (1-a)*B - and a binary mask has to round that to one or the
    other. Rounding it to background is what leaves 60% of the first ring outside every
    mask still object-coloured, sitting in the shell where it stays put while the object
    moves: the ghost outline. Rounding it to object instead just moves the error, dragging
    a rim of old wall along with the object.

    Both B and F are known here, which is what makes this cheap. B is the surface behind
    this layer - already built, because layers are made back to front. F is the nearest
    interior colour. With those, alpha is the projection of M-B onto F-B, and the
    unmixed foreground follows by inverting the same equation. Recovering F matters: the
    layer must carry *object* colour at partial alpha, not the blended master pixel,
    or the background it was painted against gets counted twice.

    Thin structure is the case this exists for. A frond tip two texels wide is entirely
    edge - it has no interior to round to - so a binary mask either drops it or doubles
    it. At a=0.5 it simply travels at half weight, which is what it physically is.
    """
    B = under.astype(np.float32)
    F = nearest_colour(bgr, mask, trust).astype(np.float32)
    M = bgr.astype(np.float32)
    d = F - B
    proj = (((M - B) * d).sum(-1) / np.maximum((d * d).sum(-1), 1.0)).clip(0.0, 1.0)

    # The projection alone is not enough, and the gap is not a rounding error: it assumes
    # every band pixel is a mix of F and B, and a contact shadow is neither. Under the
    # cabinet, M is darker than the floor *and* darker than the cabinet, so M-B points
    # away from F-B, the projection returns 0 - and the pixel is left fully transparent
    # over a background that has already been blanked. That single mechanism was the whole
    # of the 1.00% at-rest error, and it sat exactly where the eye checks first: the line
    # where things meet the floor.
    #
    # So put a floor under alpha: the least opacity at which this layer can still
    # reproduce the master over the background it will actually be composited against.
    # F' = B + (M-B)/a has to stay in gamut, which bounds a from below directly. Where the
    # master already agrees with the background the floor is 0 and the pixel stays
    # transparent; where it disagrees - a shadow, or a fill the inpainter got wrong - the
    # layer is obliged to carry the difference, and at-rest exactness stops depending on
    # the inpainter being right.
    headroom = np.maximum(np.where(M > B, 255.0 - B, B), 1.0)
    floor = (np.abs(M - B) / headroom).max(-1).clip(0.0, 1.0)
    a = np.maximum(proj, floor)

    alpha = mask.astype(np.float32)
    alpha[band_out] = a[band_out]
    # Invert the compositing equation for the unmixed foreground. With alpha at or above
    # the floor this is in gamut by construction, so a*F' + (1-a)*B == M exactly.
    rec = np.clip(B + (M - B) / np.maximum(alpha, 1e-3)[..., None], 0, 255)
    out = np.where(band_out[..., None], rec, M)
    return alpha, out.astype(np.uint8)


def lama_fill(lama, bgr, hole, max_side=2048, reach=None):
    """Inpaint `hole` and composite, so pixels outside the hole are bit-identical.

    The model returns a whole frame and re-encodes all of it. Registration against the
    locked master is the property this pipeline is built on, so the result is never used
    directly - only its masked pixels are taken.

    `max_side` caps what the model sees. LaMa re-encodes the entire frame, so cost scales
    with the master, not with the hole: at 5504x3072 it was killed by the OS (exit 137)
    before writing anything. And only the model's output is resampled: the hole mask stays
    full resolution, so the composite boundary is still exact and everything outside it is
    still bit-identical.

    `reach` caps something else, and it is the parameter that decides whether a fill comes
    back as a picture or as a wash. **What LaMa can do is bounded by how far the deepest
    hole pixel is from real paint, measured in the pixels the MODEL sees** - not in plate
    px, and not as a fraction of the frame. Past roughly 300 of them it stops continuing
    structure and returns a smooth average of the border; the wash is not a failure of
    capacity, it is what the model has left when nothing in range tells it what was there.

    Measured on this master, filling the fig at a range of scales - detail inside the hole
    as a fraction of the real paint around it:

        model px deep   675    337    253    169    127
        detail ratio    0.30   0.34   0.37   0.40   0.39

    Two things follow, and both are counter-intuitive enough to be worth stating.

    *A wider mask makes it worse, not better.* Dilating the fig's mask to 200px takes the
    hole from 675 model px to 1021 and the detail from 7.12 to 6.67. Whatever a bigger
    hole buys in context it loses twice over in depth, so `--halo` is not a lever on this
    and neither is a hand-painted brush mask (tested: 982 px deep, 6.63).

    *The crop makes it worse too.* lama_peel() crops for resolution, which is right for
    small objects and exactly backwards for large ones: the same fig hole is 321 model px
    when the whole 5504px frame is handed over at max_side, and 675 when cropped to the
    object. Cropping raised the effective resolution past what the hole could carry. That
    is the whole of why the shell used to wash out behind the fig while the guitar beside
    it came back clean - not the mask, not the model, not the amount of context.

    So the scale is whichever of the two caps binds harder. Shallow holes are untouched and
    keep native resolution; only a hole deep enough to defeat the model is downsampled, and
    only as far as it has to be. `reach` is in model px, so unlike --margin/--halo it does
    NOT scale with the plate: it is a property of LaMa, not of this room.
    """
    from PIL import Image

    h, w = bgr.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if reach:
        deep = cv2.distanceTransform((hole > 0).astype(np.uint8), cv2.DIST_L2, 5).max()
        scale = min(scale, reach / max(1.0, float(deep)))
    if scale < 1.0:
        sw, sh = int(round(w * scale)), int(round(h * scale))
        small = cv2.resize(bgr, (sw, sh), interpolation=cv2.INTER_AREA)
        # Dilate before downsampling: INTER_AREA on a binary mask thins it, and a hole
        # that comes back narrower leaves a rim of the object unfilled.
        hs = cv2.resize(cv2.dilate(hole, np.ones((3, 3), np.uint8)), (sw, sh),
                        interpolation=cv2.INTER_AREA)
        hs = ((hs > 64) * 255).astype(np.uint8)
    else:
        small, hs = bgr, hole

    out = lama(Image.fromarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB)),
               Image.fromarray(hs))
    out = cv2.cvtColor(np.array(out), cv2.COLOR_RGB2BGR)[:small.shape[0], :small.shape[1]]
    if scale < 1.0:
        out = cv2.resize(out, (w, h), interpolation=cv2.INTER_CUBIC)
    return np.where(hole[..., None] > 0, out, bgr)


def anchor_to_master(bgr, fill, hole, ring=64, solve_scale=0.25):
    """Re-light a hand-made fill so it is continuous with the master it fills.

    A generator cannot repaint this room to within a few levels of the original, and
    measurement says it does not come close. On this master, comparing the plate to the
    master *outside* the hole - where the two are supposed to be identical - the error is
    21 levels RMS, and it is low-frequency: split by spatial frequency it is 21.3 at
    scales above ~64px against 9.3 below. That is not lost detail, it is lighting. Per
    screen block it reaches 83 levels on the floor behind the cabinet (the generator
    removed the cabinet, so it removed the cabinet's shadow too) and 43 on the wall behind
    the monitors (it removed the monitors, so it removed their glow). Every one of those
    is a surface the camera slides across a silhouette to reveal, so what the viewer sees
    is a differently-lit slab appearing from behind an object - which is exactly the
    complaint that sent us looking.

    A global gain and offset does not fix it: fitting `fill = a*master + b` per channel on
    those same pixels takes the residual from 20.1 to 18.8. The error is not an exposure
    shift, it is a different opinion about the light in each part of the room.

    So anchor it. Take the residual on a ring of *real* master pixels just outside the
    hole, extend it inward as the smoothest field that agrees with that ring, and add it
    to the fill. Three properties follow, and they are the whole argument:

      - The composite boundary is seamless **by construction**, not by luck. At the edge
        the correction equals the residual exactly, so the fill meets the master with no
        step, whatever the generator did.
      - Structure survives. The correction is a membrane - it has no detail of its own -
        so the skirting board, the floorboards and the window bars the generator invented
        come through untouched. That is the half LaMa cannot do.
      - It is the photometric twin of the rule that already makes registration
        unbreakable: never use an inpainter's output whole, only what is inside the mask,
        referenced to the master.

    What it cannot do is put back a shadow *edge* that the generator omitted in the middle
    of a large hole - a membrane is smooth by definition. It fixes the level, not the
    drawing. A fill with an invented object in it is still a fill to regenerate.

    `ring` is where the residual is read. It sits outside `hole`, which is already the
    footprint grown by `halo`, so it never samples an object's own contact shadow.
    The solve runs at `solve_scale` because the answer is a membrane and a membrane has
    nothing above the low frequencies to resolve.
    """
    h, w = bgr.shape[:2]
    band = (cv2.dilate(hole, cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * ring + 1,) * 2)) > 0) & (hole == 0)
    if band.sum() < 1000:
        return fill, 0.0

    sw, sh = max(8, int(w * solve_scale)), max(8, int(h * solve_scale))
    resid = bgr.astype(np.float32) - fill.astype(np.float32)
    wgt = band.astype(np.float32)
    rs = cv2.resize(resid * wgt[..., None], (sw, sh), interpolation=cv2.INTER_AREA)
    ws = cv2.resize(wgt, (sw, sh), interpolation=cv2.INTER_AREA)
    known = ws > 0.5
    rs = np.where(known[..., None], rs / np.maximum(ws, 1e-6)[..., None], 0.0)

    corr = np.stack([laplace_fill(rs[..., c], ~known) for c in range(3)], -1)
    corr = cv2.resize(corr, (w, h), interpolation=cv2.INTER_CUBIC)
    moved = float(np.abs(corr[hole > 0]).mean())
    return np.clip(fill.astype(np.float32) + corr, 0, 255).astype(np.uint8), moved



def lama_peel(lama, bgr, jobs, context=384, max_side=2048, reach=None):
    """Remove the objects one at a time, nearest first, instead of all at once.

    LaMa fills a hole from what surrounds it, so the only thing that matters is how far
    any hole pixel is from real paint. Handed layer 0's hole whole, that distance is
    brutal: 47% of the frame gone, half of it more than 128px from anything real and the
    worst point 875px in. It answers the only way it can - a smooth wash, with the wall's
    warm daylight and the monitors' glow washed out of it, because at that distance there
    is nothing left telling it they were ever there.

    Take the objects off one at a time and that distance never gets large. Lift the
    printer and it is surrounded by real window and real cabinet top; lift the cabinet and
    it is surrounded by real floor, real skirting, and the printer's answer from a moment
    ago. Each fill is a small hole in a full picture, which is the case LaMa is good at
    and the case it was trained on. Nearest layer first, because that is the order the
    room actually uncovers: the printer hides cabinet, the cabinet hides floor.

    The crop is the second half of it. `lama_fill` caps what the model sees at `max_side`,
    and against a 5504px frame that is a 0.37x downsample - every fill came back soft and
    was then upsampled 2.7x. Cropped to one object plus `context` px of surroundings, the
    same cap is a mild downsample or none at all, so small objects fill at native
    resolution. Cost drops with it: the model re-encodes the crop, not the master.

    That is right for a small object and backwards for a large one, which is why the crop
    is paired with `reach`. Cropping raises the effective resolution, and raising the
    resolution of a *deep* hole is the one thing that turns a fill into a wash: the fig's
    hole is 321 model px when the whole frame goes in at `max_side` and 675 when cropped
    to the object. `lama_fill`'s reach cap gives the depth back whatever the crop took, so
    the crop keeps buying resolution for the objects that can use it and stops charging it
    to the objects that cannot. See lama_fill() for the measurements.

    `context` is deliberately NOT the fix for a deep hole and was measured not to be: 384px
    of surroundings, 1200px, and the entire frame all return the same wash (detail ratio
    0.30 / 0.30 / 0.31). Distance from real paint is a property of the hole's own shape, so
    no amount of room around it changes the number that matters.

    `jobs` is (name, hole) in the order to remove them. Composition is `lama_fill`'s, so
    every pass still takes only its own masked pixels and everything else stays exact.
    """
    work = bgr.copy()
    for name, h in jobs:
        ys, xs = np.where(h > 0)
        if len(ys) == 0:
            continue
        y0, y1 = max(0, ys.min() - context), min(work.shape[0], ys.max() + 1 + context)
        x0, x1 = max(0, xs.min() - context), min(work.shape[1], xs.max() + 1 + context)
        crop, hc = work[y0:y1, x0:x1], h[y0:y1, x0:x1]
        deep = cv2.distanceTransform((hc > 0).astype(np.uint8), cv2.DIST_L2, 5).max()
        scale = min(1.0, max_side / max(crop.shape[:2]))
        if reach:
            scale = min(scale, reach / max(1.0, float(deep)))
        # The depth in model px is the number that predicts the result, so log that and
        # not just the scale - a run that washes out is diagnosable from the log alone.
        print(f"      {name:<14} {crop.shape[1]}x{crop.shape[0]} crop"
              f"{'' if scale == 1.0 else f' at {scale:.2f}x'}, "
              f"hole {100.0 * (hc > 0).mean():.0f}% of it, "
              f"{deep * scale:.0f} model px deep")
        work[y0:y1, x0:x1] = lama_fill(lama, crop, hc, max_side=max_side, reach=reach)
    return work


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-anchor", dest="anchor", action="store_false",
                    help="do NOT re-light a --fill-dir plate to match the master at the "
                         "hole boundary. On by default; see anchor_to_master().")
    ap.add_argument("--color", required=True, type=Path, help="colour master")
    ap.add_argument("--depth", required=True, type=Path, help="depth8-fixed.png")
    ap.add_argument("--masks", required=True, type=Path, help="dir holding _layerN.png")
    ap.add_argument("--out-prefix", required=True, type=Path)
    ap.add_argument("--margin", type=int, default=None,
                    help="px a layer's alpha is extended underneath the layers in front "
                         "of it. This IS the excursion budget: uncovering more than this "
                         "reaches past the painted band and shows a hard alpha edge. "
                         "Raising it is free once the whole hole is filled - the band "
                         "just keeps more of a fill that already exists - so it is set "
                         "by the deepest camera move, not by inpainting cost. Default 64px at "
                         "the 1024px reference plate, scaled to this one.")
    ap.add_argument("--feather", type=int, default=None,
                    help="px of soft alpha outside each layer's mask, and the same "
                         "distance the surface behind it is blanked. A painterly "
                         "silhouette is a gradient several px wide; a binary mask rounds "
                         "it to background and leaves that gradient in the plate behind, "
                         "which is the ghost outline around every object. Widening the "
                         "blank alone would just move the seam - the two have to move "
                         "together, which is what makes the composite still reproduce the "
                         "master at rest. Does NOT scale with the plate - see main().")
    ap.add_argument("--halo", type=int, default=None,
                    help="px the inpaint mask is grown before filling. Must clear the "
                         "object's contact shadow and anti-aliased edge, or LaMa reads "
                         "them as context and paints the object back in. Cheap to raise; "
                         "too small is what ghosting looks like.")
    ap.add_argument("--depth-pad", type=int, default=None,
                    help="MINIMUM px a layer's own depth is extended outward past its "
                         "alpha; the actual reach is derived per pixel from the local "
                         "depth step and `margin`, because what the pad has to clear is "
                         "the stretch, and the stretch is proportional to the cliff. The "
                         "mesh is one continuous grid per layer, so the depth under the "
                         "transparent region still shapes the triangles at the "
                         "silhouette; left at background depth, the object-to-background "
                         "cliff sits exactly under the visible edge and a moving camera "
                         "stretches the last visible texels across the whole gap. Pushed "
                         "out past the feather, the cliff lands where alpha is zero and "
                         "every stretched fragment is discarded.")
    ap.add_argument("--fill-reach", type=int, default=220,
                    help="px, IN THE PIXELS THE MODEL SEES, that the deepest point of a "
                         "hole may sit from real paint. A crop is downsampled until its "
                         "hole fits, because past ~300 LaMa stops continuing structure "
                         "and returns a smooth wash. Does NOT scale with the plate - it "
                         "is a property of the model, not of this room. 0 disables it. "
                         "See lama_fill() for the measurements.")
    ap.add_argument("--device", default="cpu", choices=["cpu", "cuda", "mps"])
    ap.add_argument("--fill-dir", type=Path,
                    help="look here for {prefix}-layer{N}-fill.png - a hand-made fill for "
                         "that layer's hole, e.g. one generator pass over the emitted hole "
                         "mask. Only its masked pixels are used, so the plate stays "
                         "bit-identical to the master outside the hole no matter what the "
                         "generator did to the rest of the frame. Layers without a fill "
                         "file fall back to LaMa, so the chain still runs unattended.")
    args = ap.parse_args()

    bgr = cv2.imread(str(args.color))
    depth = cv2.imread(str(args.depth), cv2.IMREAD_GRAYSCALE)
    if bgr is None or depth is None:
        raise SystemExit("cannot read colour or depth master")
    if bgr.shape[:2] != depth.shape:
        raise SystemExit(f"size mismatch: colour {bgr.shape[:2]} vs depth {depth.shape}")

    # Every px parameter below is a *distance on the picture* - a band of fill to reveal,
    # a feather to blend across, a depth cliff to push clear of the silhouette - and all
    # four were tuned against a 1024x572 plate. They do not survive a change of master
    # resolution as constants. Re-rendering the same room at 5504px turns 64px of margin
    # from 6.3% of the frame into 1.2%, and the identical camera move then runs off the
    # end of the painted band and shows a hard alpha edge. That is a silent failure: the
    # log is unchanged and the tear only appears once the camera moves. Scale them with
    # the plate; an explicit flag still wins.
    # Three of the four scale; `feather` does not, and the difference is not a detail.
    #
    #   margin    is an excursion budget, and the excursion is reported in plate px -
    #             it scales with the plate by construction.
    #   halo      has to clear an object's contact shadow, which is a feature of the
    #             room and grows with the picture.
    #   depth-pad has to clear the stretch, and the stretch is proportional to margin.
    #
    #   feather   tracks the width of the painted edge itself, and a generator asked for
    #             a bigger image draws a *sharper* edge, not a proportionally softer one.
    #             Measured on this 5504px master, the blend outside the masks is down to
    #             ~30% of the way to object colour by 4px and flat after that - the same
    #             few px it was on the 1024px one. Scaling it to 32px was measurably
    #             wrong: it hands ViTMatte a 32px band where the true answer is opaque
    #             background, and the matte returns a wide soft halo that carries real
    #             background texture away with the object when the camera moves.
    REF_W = 1024
    k = bgr.shape[1] / REF_W
    for name, ref in (("margin", 64), ("halo", 12), ("depth_pad", 8)):
        if getattr(args, name) is None:
            setattr(args, name, max(1, round(ref * k)))
    if args.feather is None:
        args.feather = 6
    print(f"plate {bgr.shape[1]}x{bgr.shape[0]} = {k:.2f}x the {REF_W}px reference   "
          f"margin {args.margin}  feather {args.feather}  halo {args.halo}  "
          f"depth-pad {args.depth_pad}  fill-reach {args.fill_reach}")

    layer_paths = sorted(args.masks.glob("_layer*.png"))
    if not layer_paths:
        raise SystemExit(f"no _layerN.png in {args.masks} - run tools/assign.py first")
    masks = [cv2.imread(str(p), cv2.IMREAD_GRAYSCALE) > 127 for p in layer_paths]
    n = len(masks)

    # The individual objects behind each layer mask, so LaMa can be handed them one at a
    # time instead of all at once - see lama_peel(). assign.py already wrote which layer
    # each one landed in; nothing new is authored here.
    by_layer: dict[int, list[tuple[str, np.ndarray]]] = {}
    lj = args.masks / "_layers.json"
    if lj.exists():
        for name, rank in json.loads(lj.read_text())["rank"].items():
            mp = args.masks / f"{name}.png"
            if rank > 0 and mp.exists():
                by_layer.setdefault(rank, []).append(
                    (name, cv2.imread(str(mp), cv2.IMREAD_GRAYSCALE) > 127))

    lama = None

    def get_lama():
        nonlocal lama
        if lama is None:
            import torch
            from simple_lama_inpainting import SimpleLama
            print(f"loading big-lama on {args.device} (~200 MB on first run)...")
            lama = SimpleLama(device=torch.device(args.device))
        return lama

    ring = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.halo + 1,) * 2)
    reach = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.margin + 1,) * 2)
    trust = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    soft = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.feather + 1,) * 2)

    plates = []
    under = None  # the surface behind the current layer: plates 0..r-1, composited
    for r in range(n):
        # Grown by `feather`, because that is how much of each front layer this one has
        # to supply background for: the soft silhouette needs real background to be
        # transparent *against*, and the master only holds the already-blended edge.
        front = np.zeros(depth.shape, bool)
        for k in range(r + 1, n):
            front |= cv2.dilate(masks[k].astype(np.uint8), soft) > 0

        if front.any():
            # The whole footprint, grown by `halo`. An earlier version painted only a rim
            # `margin` px wide, on the theory that a capped excursion never reveals the
            # interior. That was true but wrong-headed: it left every object's interior
            # sitting in the plate as a ghost, which made the plates impossible to check
            # by eye and hid two broken masks for a whole pass. Fill the hole and a bad
            # mask is obvious at a glance.
            #
            # `halo` is doing the work the rim was wrongly credited with. LaMa reads the
            # ring just outside the mask as context, so a mask tight to the silhouette
            # feeds it the object's own shadow, contact edge and anti-aliased rim - and it
            # faithfully continues them inward. That is what produced the "ghost slab"
            # blamed on hole size; it is a coverage problem, not a capacity one.
            # Two different regions, and conflating them was a bug worth naming.
            #
            # `hole` is what the inpainter is asked to fill: the footprint grown by
            # `halo`, so the model cannot read the object's own contact shadow and
            # anti-aliased rim as context and continue them inward.
            #
            # `keep` is which of its answer is actually taken: the footprint exactly,
            # so every replaced pixel lies inside the alpha of the layer that covers it.
            # Taking the whole dilated hole instead blanks a `halo`-wide ring of genuine
            # background around every object, and at the home camera nothing is drawn over
            # that ring - it was 6.4% of the frame visibly wrong before the composite was
            # measured against the master. There was briefly a `--keep` erosion here as
            # well; the layer's own alpha is the right boundary and needs no parameter.
            hole = cv2.dilate(front.astype(np.uint8), ring) * 255
            # What the inpainter is asked to fill and what is kept from it are
            # different regions: `halo` widens the first for context, and the layer's
            # own alpha IS the second, exactly. Keeping the halo too would blank a ring
            # of real background that nothing covers at rest - 6.4% of the frame.
            keep = front

            # The hole mask is the handover point to any better inpainter. Emitted every
            # run so it cannot drift from the masks that produced it.
            hp = args.out_prefix.with_name(f"{args.out_prefix.name}-layer{r}-hole.png")
            cv2.imwrite(str(hp), hole)

            fill = None
            if args.fill_dir:
                fp = args.fill_dir / f"{args.out_prefix.name}-layer{r}-fill.png"
                if fp.exists():
                    fill = cv2.imread(str(fp))
                    if fill is None or fill.shape[:2] != bgr.shape[:2]:
                        raise SystemExit(f"{fp}: unreadable, or not {bgr.shape[1]}x"
                                         f"{bgr.shape[0]}")
            if fill is not None:
                source = f"fill {fp.name}"
                if args.anchor:
                    fill, moved = anchor_to_master(bgr, fill, hole)
                    source += f" anchored {moved:+.1f}"
                color_r = np.where(keep[..., None], fill, bgr)
            else:
                # Nearest layer first, and within a layer the small ones first: every
                # fill should face the least unpainted surface it can. The leftover pass
                # catches what the per-object holes do not cover - `front` is the layer
                # masks grown by `feather`, so its union is a little wider than theirs.
                jobs = []
                for k in range(n - 1, r, -1):
                    for name, om in sorted(by_layer.get(k, []), key=lambda t: t[1].sum()):
                        jobs.append((name, cv2.dilate(om.astype(np.uint8), ring) * 255))
                work = (lama_peel(get_lama(), bgr, jobs, reach=args.fill_reach)
                        if jobs else bgr)
                done = np.zeros(depth.shape, bool)
                for _, h in jobs:
                    done |= h > 0
                rest = ((hole > 0) & ~done).astype(np.uint8) * 255
                if rest.any():
                    print(f"      {'leftover':<14} {100.0 * (rest > 0).mean():.1f}% of frame")
                    work = lama_fill(get_lama(), work, rest, reach=args.fill_reach)
                color_r = np.where(keep[..., None], work, bgr)
                source = f"lama, {len(jobs)} objects one at a time"
            # Depth, unlike colour, owes nothing to the at-rest frame: at the reference
            # viewpoint every depth reprojects to the same pixel, so rewriting it is
            # invisible until the camera moves. That frees the depth fill to cover the
            # whole dilated hole rather than the eroded keep - which matters, because
            # the depth model blends across silhouettes, and master depth within a few
            # px of a removed object still carries the object. Keeping it would leave a
            # ridge of object depth around every hole that warps the revealed fill in
            # motion.
            #
            # Harmonic, not Telea, for the reason laplace_fill() was written for in the
            # first place: Telea marches inward along the distance transform, so a wide
            # region comes back streaked, and depth is what the mesh is *built from* -
            # lumpiness there is real geometry. Measured inside the fig's footprint,
            # Telea strayed from its own smooth version by a mean of 1.16 levels and a
            # p99 of 8.11, against 0.26 / 0.79 for the real window plane beside it: four
            # times rougher than the surface it is continuing, peaking at 24.8 levels =
            # 33px of displacement at full push. It shows up over the window and nowhere
            # else, because the window is the one large surface flat enough for a ripple
            # to be visible against.
            depth_r = laplace_fill(depth.astype(np.float32), hole > 0)
            depth_r = np.clip(depth_r, 0, 255).astype(np.uint8)
        else:
            color_r, depth_r = bgr.copy(), depth.copy()
            source = "nothing in front"

        if r == 0:
            # The shell is never cut and never has alpha: it is the complete empty room.
            alpha = np.full(depth.shape, 255, np.uint8)
        else:
            band = cv2.dilate(masks[r].astype(np.uint8), reach).astype(bool) & front
            # Alpha was hard, and exactly the mask, on the argument that the shader's
            # LINEAR filtering would antialias it. It does - but antialiasing was never
            # the problem. A mask boundary has to be placed *somewhere* inside a
            # silhouette that is genuinely several px of blend, and wherever it lands,
            # everything on the far side is wrong: kept in the plate behind, it stays
            # nailed to the wall while the object moves. Measured on this master, 60% of
            # the first ring outside the masks was still object-coloured, and still 39%
            # eight px out. That is the ghost outline, and no better mask removes it,
            # because the true answer at those pixels is not a side - it is a fraction.
            #
            # So solve for the fraction instead: `matte` recovers alpha and the unmixed
            # foreground across the band, the surface behind is blanked over the same
            # band, and the two reconstruct the master exactly at rest while separating
            # cleanly in motion.
            band_out = ((cv2.dilate(masks[r].astype(np.uint8), soft) > 0)
                        & ~masks[r] & ~band)
            soft_a, color_r = matte(color_r, under, masks[r], band_out, trust)
            soft_a[band] = 1.0  # the margin band is real fill, not a silhouette
            alpha = (soft_a * 255 + 0.5).astype(np.uint8)
            # See --depth-pad. The depth model's edges are soft, so the outermost few px
            # of the layer's own depth are already blended toward the background - the
            # very cliff the cut exists to remove, baked into the visible silhouette.
            # Trust only the interior (erode 3px), and propagate it by grayscale
            # dilation out across the boundary and `depth_pad` beyond the alpha, so the
            # silhouette moves rigidly with the object and the cliff lands where alpha
            # is zero and every stretched fragment is discarded. Structures thinner
            # than the trust radius erode away and keep their model depth; they are too
            # thin to stretch far.
            # Propagation is nearest-neighbour, not grayscale dilation: dilation takes
            # the MAX interior depth over its disc, which on a sloped surface (the desk
            # slab in perspective) puts a seam at the trust boundary. The nearest
            # interior value continues the surface instead.
            # Eroded from the MASK, not from `alpha > 0`. Once alpha went soft, `alpha > 0`
            # reached a feather-width further out, so the "trusted interior" swallowed the
            # whole feather band - and the band is precisely where the depth model's own
            # soft edge lives. The band therefore kept a depth ramp instead of the
            # object's depth, the mesh stretched it across the disocclusion, and because
            # those pixels carry recovered foreground at partial alpha they drew as pale
            # wisps trailing the object. Worst on the biggest cliff, which is why the
            # corner plant looked like the main offender while its leaves themselves were
            # already clean. Trusting only the mask hands the entire band rigid object
            # depth, so it travels with the object and the cliff lands outside it.
            inner = cv2.erode(masks[r].astype(np.uint8), trust) > 0
            if inner.any():
                dist, labels = cv2.distanceTransformWithLabels(
                    (~inner).astype(np.uint8), cv2.DIST_L2, 5,
                    labelType=cv2.DIST_LABEL_PIXEL)
                lut = np.zeros(labels.max() + 1, depth_r.dtype)
                lut[labels[inner]] = depth_r[inner]
                prop = lut[labels]
                # How far the pad has to reach is not a constant - it is set by the
                # depth step it has to clear. A fragment spanning a cliff of d (0-255)
                # is stretched by about margin*d/255 px at full excursion, and the cliff
                # has to land far enough outside the silhouette that every one of those
                # stretched fragments has alpha 0. One number cannot serve every object:
                # the corner plant stands 100/255 in front of the blown-out window behind it
                # - 2.4x the next largest cliff in the scene (chair 42, fg-plant 37) - so
                # it needs ~25px where the chair needs 10, and at a fixed 8 it was the
                # only object still visibly streaking. Derive it per pixel instead.
                need = (np.abs(prop.astype(np.float32) - depth_r.astype(np.float32))
                        * args.margin / 255.0)
                zone = ~inner & (dist <= np.maximum(need, float(args.depth_pad)))
                depth_r = np.where(zone, prop, depth_r)

        if front.any():
            # How much of the hole a `margin` excursion can actually uncover. This decides
            # how much inpaint QUALITY matters: if the revealed share is small, only the
            # rim needs to be convincing; if it is large, the whole fill is on screen.
            # Measured, not assumed - on this master it is 95%, because the occluders are
            # thin (a chair's spokes, a plant's fronds, an open printer frame) and almost
            # no pixel is more than `margin` from an edge.
            band = front & (cv2.dilate((~front).astype(np.uint8), reach) > 0)
            seen = 100.0 * band.sum() / front.sum()
        else:
            seen = 0.0

        cp = args.out_prefix.with_name(f"{args.out_prefix.name}-layer{r}.png")
        dp = args.out_prefix.with_name(f"{args.out_prefix.name}-layer{r}-depth.png")
        cv2.imwrite(str(cp), np.dstack([color_r, alpha]))
        plates.append((color_r, alpha))
        # The surface the *next* layer is matted against, composited exactly as the
        # renderer will: straight alpha, back to front.
        af = (alpha.astype(np.float32) / 255.0)[..., None]
        under = (color_r.astype(np.float32) if under is None
                 else color_r * af + under * (1 - af))
        if r == 0:
            shell_plate, shell_front = color_r, front
        cv2.imwrite(str(dp), depth_r)
        print(f"  layer{r}  alpha {100 * (alpha > 0).mean():5.1f}%  "
              f"inpainted {100 * front.mean():5.1f}%  "
              f"revealed {seen:5.1f}% of it  {source}")

    check_at_rest(bgr, plates, 0.05)  # the renderer's uAlphaCut
    review_sheet(bgr, shell_plate, shell_front, reach,
                 args.out_prefix.with_name(f"{args.out_prefix.name}-shell-review.png"))


def check_at_rest(bgr, plates, alpha_cut):
    """The layers, composited at the home camera, must reproduce the master exactly.

    This is the pipeline's one hard invariant. The renderer places the camera at the
    reference viewpoint by default, where the reconstruction reprojects to the original
    art pixel for pixel - so any disagreement here is visible on screen before the user
    has touched anything, and it is not something the renderer can fix.

    It catches the whole class of bug where the layers do not tile the frame: a fill kept
    wider than the layer that covers it, an alpha eroded too far, a mask missing from
    objects.json. Conflating the painted region with the kept region put 6.4% of the frame
    wrong this way, and it was invisible in every per-stage log line.
    """
    comp = None
    for rgb, alpha in plates:
        a = (alpha.astype(np.float32) / 255.0)[..., None]
        a = a * (a >= alpha_cut)
        comp = rgb.astype(np.float32) if comp is None else rgb * a + comp * (1 - a)
    d = np.abs(comp - bgr.astype(np.float32)).max(axis=2)
    bad = 100.0 * (d > 32).mean()
    flag = "" if bad < 0.05 else "   <-- LAYERS DO NOT TILE THE FRAME"
    print(f"at-rest vs master: mean {d.mean():.2f}/255, {bad:.2f}% badly wrong{flag}")
    return bad


def review_sheet(bgr, shell, front, reach, path):
    """master / shell plate / plate with the never-revealed pixels greyed out.

    The plate is the only place a bad mask or a hallucinated fill is visible, and neither
    shows up in a log line - two broken masks survived a whole pass because an earlier
    version painted only a rim and left every object's interior sitting in the plate.
    """
    band = front & (cv2.dilate((~front).astype(np.uint8), reach) > 0)
    vis = shell.copy()
    dead = front & ~band
    grey = cv2.cvtColor(cv2.cvtColor(shell, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    vis[dead] = (grey[dead] * 0.4 + np.array([50, 0, 70])).clip(0, 255).astype(np.uint8)
    sep = np.full((8, bgr.shape[1], 3), 255, np.uint8)
    cv2.imwrite(str(path), np.vstack([bgr, sep, shell, sep, vis]))
    print(f"review: {path}   (purple = never revealed, so its fill does not matter)")


if __name__ == "__main__":
    main()
