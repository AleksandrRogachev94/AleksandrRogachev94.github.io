"""Stage 0 - run the depth model locally instead of a demo site.

This used to be a manual step: upload the master to the Depth Anything HuggingFace
space, download "16-bit raw output", drop it in art/build/. That works, but it is the
one link in the chain that cannot be reproduced from the master by running a command, and
it silently fixes the model version to whatever the space happens to be serving.

Output format matches what the space returned, so stage 1 (`depth_prep.py`) is
unchanged and either source still works:

  * 16-bit PNG, same pixel dimensions as the colour master
  * **disparity, not distance** - near is HIGH, far is LOW
  * rescaled to the full 16-bit range (the space returned a narrow slice of it and
    `depth_prep` rescales anyway, so this is the same map with less quantisation)

See art/README.md for why those three properties matter downstream.

**V2 vs V3.** V2 is wired here because it is what the current master's depth came from
and it runs through the stock `transformers` depth-estimation pipeline. Depth Anything
V3 (ByteDance-Seed/Depth-Anything-3, weights at `depth-anything/DA3-*`, Apache 2.0) is
not in that pipeline yet and needs its own `depth_anything_3` package, so switching is
a real dependency change rather than a `--model` string. Worth doing when the 4K master
lands; not worth doing to fix a compositing artifact. See docs/PIPELINE.md.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

MODELS = {
    "v2-small": "depth-anything/Depth-Anything-V2-Small-hf",
    "v2-base": "depth-anything/Depth-Anything-V2-Base-hf",
    "v2-large": "depth-anything/Depth-Anything-V2-Large-hf",
}


def pick_device(requested: str) -> str:
    import torch
    if requested != "auto":
        return requested
    if torch.backends.mps.is_available():
        return "mps"
    return "cuda" if torch.cuda.is_available() else "cpu"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--color", required=True, type=Path, help="colour master")
    ap.add_argument("--out", required=True, type=Path, help="16-bit raw depth master")
    ap.add_argument("--model", default="v2-large",
                    help=f"a key of {sorted(MODELS)}, or any HF depth-estimation model id")
    ap.add_argument("--device", default="auto", choices=["auto", "mps", "cuda", "cpu"])
    args = ap.parse_args()

    color = cv2.imread(str(args.color), cv2.IMREAD_COLOR)
    if color is None:
        raise SystemExit(f"could not read {args.color}")
    h, w = color.shape[:2]

    import torch
    from PIL import Image
    from transformers import pipeline

    model_id = MODELS.get(args.model, args.model)
    device = pick_device(args.device)
    print(f"{model_id} on {device} (weights cache to ~/.cache/huggingface on first run)")
    pipe = pipeline("depth-estimation", model=model_id, device=device)

    rgb = Image.fromarray(cv2.cvtColor(color, cv2.COLOR_BGR2RGB))
    # `predicted_depth` is the raw tensor; the pipeline's `depth` key is an 8-bit
    # visualisation of it. Take the tensor - quantising to 8 bits and back is exactly
    # the precision loss art/README warns about in the colour-mapped preview.
    pred = pipe(rgb)["predicted_depth"]
    if isinstance(pred, torch.Tensor):
        pred = pred.detach().float().cpu().numpy()
    d = np.squeeze(np.asarray(pred, dtype=np.float32))

    # The model works at its own input resolution. Bilinear, not Lanczos: Lanczos
    # overshoots either side of a step, which in depth invents a near halo and a far
    # trench around every silhouette (same reason export.py resamples depth bilinear).
    if d.shape != (h, w):
        d = cv2.resize(d, (w, h), interpolation=cv2.INTER_LINEAR)

    lo, hi = float(d.min()), float(d.max())
    if hi <= lo:
        raise SystemExit("model returned constant depth")
    out = ((d - lo) / (hi - lo) * 65535.0 + 0.5).astype(np.uint16)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.out), out)
    print(f"wrote {args.out}  ({w}x{h}, 16-bit disparity, near=high)")
    print(f"model range {lo:.3f}..{hi:.3f}  ->  0..65535")
    print(f"distinct levels: {len(np.unique(out))}")


if __name__ == "__main__":
    main()
