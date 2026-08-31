"""Stage 2 - one SAM mask per object in objects.json.

Prompted mode only. It handles this scene's hard cases: a mesh chair back you can see the
floor through, a five-spoke base, an open printer frame against a blown-out window, the
thin leaf gaps of a houseplant. Entries carrying `polygons` are rasterised directly instead, for regions
with no single object to grab.

Automatic mode is deliberately absent. At default settings it covered 32% of the frame and
missed the desk, the chair, the printer and the floor, so nothing downstream could be
built on it; see docs/PIPELINE.md.

Masks are shapes only. How far away an object sits, and what it hides, are both authored in
objects.json - monocular depth gets the first semantically wrong, and no segmentation can
recover the second.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

# Model class is pinned per entry, never left to AutoModel: the SAM 2.1 checkpoints
# declare model_type "sam2_video", so AutoModel hands back Sam2VideoModel, whose forward
# demands an inference_session we have no use for on a still image.
MODELS = {
    "sam2.1-large": ("facebook/sam2.1-hiera-large", "Sam2Model"),
    "sam2.1-base": ("facebook/sam2.1-hiera-base-plus", "Sam2Model"),
    "sam1-huge": ("facebook/sam-vit-huge", "SamModel"),
}
MATTE_MODEL = "hustvl/vitmatte-small-composition-1k"

# Distinct preview colours, BGR.
PALETTE = [(80, 80, 255), (80, 255, 80), (255, 160, 60), (255, 80, 200), (60, 220, 255)]


def pick_device(requested: str) -> str:
    import torch
    if requested != "auto":
        return requested
    if torch.backends.mps.is_available():
        return "mps"
    return "cuda" if torch.cuda.is_available() else "cpu"


class Segmenter:
    """Prompted SAM over one image, encoded once.

    Both this stage and `pick.py` go through here, so what you see while clicking is what
    the batch run produces. The encoder is the expensive half and the prompt does not
    change it, so it runs in __init__ and each predict() is only the mask decoder.

    **Why SAM 2.1 and not SAM-HQ.** HQ-SAM is the model aimed squarely at this problem -
    thin structure, boundary precision - and on paper it is the right choice. Its
    `transformers` 5.16.1 integration is broken: `syscv-community/sam-hq-vit-huge` loads
    with zero missing keys and then returns 26% of the frame, at a claimed IoU of 0.982,
    for a single positive click on the speaker. Both `hq_token_only` paths do it.
    Reaching a working HQ would mean the separate `segment-anything-hq` package and its
    own weights; measured against that cost, SAM 2.1 and SAM 1-huge score the same on
    the plant in the corner (2.01% vs 2.47% area, 62.1% vs 62.3% foliage purity), and 2.1 is
    the maintained line and the faster one. Foliage is fixed by matting, below, not by
    swapping segmenter.
    """

    def __init__(self, color_bgr: np.ndarray, model: str = "sam2.1-large",
                 device: str = "auto"):
        import torch
        import transformers
        from transformers import AutoProcessor
        from PIL import Image

        self.torch = torch
        self.h, self.w = color_bgr.shape[:2]
        self.device = pick_device(device)
        mid, cls_name = MODELS.get(model, (model, "AutoModel"))
        self.processor = AutoProcessor.from_pretrained(mid)
        cls = getattr(transformers, cls_name)
        self.model = cls.from_pretrained(mid).to(self.device).eval()
        image = Image.fromarray(cv2.cvtColor(color_bgr, cv2.COLOR_BGR2RGB))
        self.image = image
        base = self.processor(image, return_tensors="pt")
        with torch.no_grad():
            self.embeddings = self.model.get_image_embeddings(
                base["pixel_values"].to(self.device))

    def predict(self, points=(), negative=(), box=None) -> tuple[np.ndarray, float]:
        """Prompts are normalised 0-1. Returns (uint8 mask, SAM's IoU score).

        A box is the strongest prompt SAM takes and the right one for anything large and
        cluttered. Measured on the desk - a wood slab under a keyboard, a mouse, headphones
        and a mug, with one leg hidden behind the chair: seven points and three negatives
        score 0.739 and lose the left leg entirely; the bounding box alone scores 0.862 and
        takes the slab and both legs. Points remain right for small objects and for
        carving one object out of a group; the two combine freely.
        """
        kwargs = {}
        if box is not None:
            kwargs["input_boxes"] = [[[box[0] * self.w, box[1] * self.h,
                                       box[2] * self.w, box[3] * self.h]]]
        if points or negative:
            pts = [[x * self.w, y * self.h] for x, y in list(points) + list(negative)]
            # Nesting is [image][object][point][x, y] - one object, many points. Passing
            # one level less is silently accepted and means something different.
            kwargs["input_points"] = [[pts]]
            kwargs["input_labels"] = [[[1] * len(points) + [0] * len(negative)]]
        if not kwargs:
            raise ValueError("need at least one point or a box")
        inp = self.processor(self.image, return_tensors="pt", **kwargs)
        # Move only what the model consumes, and cast the points. BatchFeature.to() would
        # drag `original_sizes` along, and SAM 1's processor emits both it and the point
        # coordinates as float64, which MPS refuses outright.
        prompts = {k: (v.to(self.device, self.torch.float32)
                       if v.dtype == self.torch.float64 else v.to(self.device))
                   for k, v in inp.items()
                   if k in ("input_points", "input_labels", "input_boxes")}
        with self.torch.no_grad():
            out = self.model(image_embeddings=self.embeddings, multimask_output=True,
                             **prompts)
        extra = {}
        if "reshaped_input_sizes" in inp:
            extra["reshaped_input_sizes"] = inp["reshaped_input_sizes"].cpu()
        masks = self.processor.post_process_masks(
            out.pred_masks.cpu(), inp["original_sizes"].cpu(), **extra)[0]
        masks = np.asarray(masks).reshape(-1, self.h, self.w)
        scores = out.iou_scores.cpu().numpy().reshape(-1)[:masks.shape[0]]
        best = int(np.argmax(scores))
        return (masks[best] > 0.5).astype(np.uint8) * 255, float(scores[best])


def refine_matte(color_bgr: np.ndarray, mask: np.ndarray, band: int = 15,
                 device: str = "cpu", max_side: int = 1600) -> np.ndarray:
    """Re-cut a mask's boundary with an alpha matting model. For see-through objects only.

    SAM decodes its mask at 256x256 and upsamples, so a 3px gap between leaves is sub-pixel in
    the decoder's own grid and comes back as part of a solid blob - the gaps between the
    corner plant's leaves are inside its mask, and 38% of that mask is window. That is
    architectural and shared by SAM 1, SAM 2 and every prompt we tried; it is not fixed
    by a better segmenter and it is not fixed by more pixels (measured: the same crop at
    1x, 3x and 6x returns 69.3 / 69.3 / 68.7% foliage purity).

    Matting is the right tool because it answers a different question - per-pixel coverage
    rather than in-or-out. Build a trimap from the mask (eroded = definitely object,
    dilated ring = unknown) and let ViTMatte decide the band, then threshold back to
    binary because everything downstream expects a binary mask. Foliage purity 62.1% ->
    67.0% on the corner plant, and the leaves separate.

    **Runs on a crop, never the whole frame.** ViTMatte's ViTDet backbone has global
    attention layers, so cost is quadratic in pixel count: the full 5504x3072 master asked
    for a 97 GiB attention buffer and died. Cropping is not merely a workaround - the model
    has no use for pixels far from the boundary it is refining, and a crop at `max_side`
    puts far more real resolution on the fronds than the whole frame ever could. The
    boundary sits inside the padded crop by construction, so nothing outside it can change.
    """
    import torch
    from PIL import Image
    from transformers import AutoProcessor, VitMatteForImageMatting

    k = lambda n: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (n, n))
    unknown = cv2.dilate(mask, k(band))
    inner = cv2.erode(mask, k(max(3, band // 2)))
    if not (inner > 0).any():
        return mask                                   # too thin to erode; leave it alone

    H, W = mask.shape
    ys, xs = np.where(unknown > 0)
    pad = band * 2
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + 1 + pad)

    trimap = np.zeros((y1 - y0, x1 - x0), np.uint8)
    trimap[unknown[y0:y1, x0:x1] > 0] = 128           # unknown
    trimap[inner[y0:y1, x0:x1] > 0] = 255             # definitely object
    crop = color_bgr[y0:y1, x0:x1]

    ch, cw = trimap.shape
    scale = min(1.0, max_side / max(ch, cw))
    if scale < 1.0:
        sw, sh = max(1, round(cw * scale)), max(1, round(ch * scale))
        crop = cv2.resize(crop, (sw, sh), interpolation=cv2.INTER_AREA)
        # INTER_NEAREST: a trimap's three values are labels, and interpolating them
        # invents 190s and 60s that mean nothing.
        trimap = cv2.resize(trimap, (sw, sh), interpolation=cv2.INTER_NEAREST)

    proc = AutoProcessor.from_pretrained(MATTE_MODEL)
    model = VitMatteForImageMatting.from_pretrained(MATTE_MODEL).to(device).eval()
    image = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
    inp = proc(images=image, trimaps=Image.fromarray(trimap), return_tensors="pt")
    inp = {key: val.to(device) for key, val in inp.items()}
    with torch.no_grad():
        alpha = model(**inp).alphas[0, 0].float().cpu().numpy()[:trimap.shape[0],
                                                                :trimap.shape[1]]
    if scale < 1.0:
        alpha = cv2.resize(alpha, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)

    out = mask.copy()
    out[y0:y1, x0:x1] = ((alpha > 0.5) * 255).astype(np.uint8)
    return out


def fill_holes(mask: np.ndarray) -> np.ndarray:
    """Close background regions fully enclosed by the mask.

    A hole in a *solid* object is a segmentation defect, and its pixels belong to the
    object. Left in, the hole strands them: the layer draws nothing there, so the shell
    keeps the master's pixels and that patch of object stays nailed to the wall while
    the object moves. That is the pass-through in the middle of the chair seat, where
    SAM lost 342px to a highlight on the upholstery.

    In an object with an *open frame* the identical hole is correct and must be kept -
    the yard really is visible through the 3D printer's gantry, and it really should
    stay put when the printer moves. The two are the same shape and the same statistics;
    only knowing the object tells them apart, so `open_frame` in objects.json says which
    is which rather than any rule here trying to infer it.

    Flood from the border: whatever the flood cannot reach is enclosed, so it is object.
    """
    inv = (mask == 0).astype(np.uint8)
    pad = cv2.copyMakeBorder(inv, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=1)
    n, lab = cv2.connectedComponents(pad)
    outside = lab == lab[0, 0]
    enclosed = (inv > 0) & ~outside[1:-1, 1:-1]
    out = mask.copy()
    out[enclosed] = 255
    return out


def polygon_mask(polygons, shape) -> np.ndarray:
    h, w = shape
    mask = np.zeros((h, w), np.uint8)
    for poly in polygons:
        pts = np.array([[round(x * w), round(y * h)] for x, y in poly], np.int32)
        cv2.fillPoly(mask, [pts], 255)
    return mask


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--color", required=True, type=Path, help="colour master")
    ap.add_argument("--objects", required=True, type=Path, help="objects.json")
    ap.add_argument("--out-dir", required=True, type=Path, help="where masks are written")
    ap.add_argument("--model", default="sam2.1-large",
                    help=f"one of {sorted(MODELS)}")
    ap.add_argument("--device", default="auto", choices=["auto", "mps", "cuda", "cpu"])
    ap.add_argument("--no-matte", action="store_true",
                    help="skip alpha-matting refinement of see-through objects")
    args = ap.parse_args()

    color = cv2.imread(str(args.color), cv2.IMREAD_COLOR)
    if color is None:
        raise SystemExit(f"could not read {args.color}")
    h, w = color.shape[:2]
    spec = json.loads(args.objects.read_text())
    args.out_dir.mkdir(parents=True, exist_ok=True)

    needs_model = any("polygons" not in o and "mask" not in o for o in spec["objects"])
    seg = None
    if needs_model:
        seg = Segmenter(color, args.model, args.device)
        print(f"{MODELS[args.model][0]} on {seg.device}")

    overlay = color.copy().astype(np.float32)
    for i, obj in enumerate(spec["objects"]):
        name = obj["name"]
        if "mask" in obj:
            # A hand-painted mask, for the objects SAM cannot be argued into. The desk is
            # the standing case: a slab under a keyboard, a mouse, headphones and a mug,
            # with an epoxy river down its length that SAM reads as a separate object and
            # a live edge no box follows. Points, boxes and polygons were all tried. An
            # exact mask painted once costs less than a day of prompting and cannot drift.
            # Taken verbatim - no matting, no hole filling, no cleverness.
            mp = Path(obj["mask"])
            mask = cv2.imread(str(mp), cv2.IMREAD_GRAYSCALE)
            if mask is None:
                raise SystemExit(f"{name}: cannot read mask {mp}")
            if mask.shape != (h, w):
                raise SystemExit(f"{name}: mask {mask.shape} != master {(h, w)}")
            mask = ((mask > 127) * 255).astype(np.uint8)
            if not mask.any():
                raise SystemExit(f"{name}: mask {mp} is empty")
            how = f"hand-painted {mp}"
        elif "polygons" in obj:
            mask = polygon_mask(obj["polygons"], (h, w))
            how = "polygons"
        else:
            if not obj.get("points") and not obj.get("box"):
                raise SystemExit(
                    f"{obj['name']}: no prompt yet - open it in tools/pick.py, drag a "
                    f"box or click points, and save. objects.json ships seeded with the "
                    f"occlusion graph and no coordinates. If SAM cannot be argued into "
                    f"this one, paint the mask by hand and point \"mask\" at the file.")
            mask, score = seg.predict(obj.get("points", []), obj.get("negative", []),
                                      obj.get("box"))
            how = f"SAM score {score:.3f}"

        if obj.get("open_frame"):
            # See-through objects are the ones whose boundary SAM cannot resolve, and the
            # ones whose enclosed holes are real. Both follow from the same flag.
            note = "   see-through, holes kept"
            if not args.no_matte and "polygons" not in obj and "mask" not in obj:
                before = int((mask > 0).sum())
                mask = refine_matte(color, mask, device=seg.device if seg else "cpu")
                note += f", matted {before} -> {int((mask > 0).sum())}px"
        elif "mask" not in obj:
            holed = mask
            mask = fill_holes(mask)
            filled = int((mask > 0).sum() - (holed > 0).sum())
            note = f"   +{filled}px of enclosed holes" if filled else ""
        else:
            note = "   verbatim"

        cv2.imwrite(str(args.out_dir / f"{name}.png"), mask)
        area = 100.0 * (mask > 0).sum() / mask.size
        print(f"  {name:<14} {area:5.1f}% of frame   {how}{note}")

        c = np.array(PALETTE[i % len(PALETTE)], np.float32)
        sel = mask > 0
        overlay[sel] = overlay[sel] * 0.5 + c * 0.5
        # draw the prompts so a bad click is obvious in the preview
        for (px, py) in [(round(x * w), round(y * h)) for x, y in obj.get("points", [])]:
            cv2.circle(overlay, (px, py), 5, (255, 255, 255), -1)
            cv2.circle(overlay, (px, py), 5, (0, 0, 0), 1)
        for (px, py) in [(round(x * w), round(y * h)) for x, y in obj.get("negative", [])]:
            cv2.drawMarker(overlay, (px, py), (0, 0, 0), cv2.MARKER_TILTED_CROSS, 9, 2)

    preview = args.out_dir / "_preview.png"
    cv2.imwrite(str(preview), overlay.astype(np.uint8))
    print(f"\npreview: {preview}   (dots = positive prompts, crosses = negative)")


if __name__ == "__main__":
    main()
