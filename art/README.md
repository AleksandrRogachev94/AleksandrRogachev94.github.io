# Masters

Untouched generator output. Committed, never served, never edited in place.

`public/art/` holds what the site actually loads — WebP, resized, plus depth maps.
Regenerate anything here from [docs/PROMPTS.md](../docs/PROMPTS.md), never from memory,
and see that file for the naming convention.

Masters are not the only thing in this folder. The **layer plates, layer masks and their
depth maps** are derived from a master and also live here — committed, also never served.
They are reproducible: everything except the two hand-drawn masks regenerates from the
locked master by re-running [docs/PIPELINE.md](../docs/PIPELINE.md).

The day image is the geometry lock. Every other variant is an *edit* of a locked master,
because edits register pixel-for-pixel and fresh generations drift.

## Depth maps

Produced by the **Depth Anything V2** HuggingFace demo, "16-bit raw output". Three things
about that format matter downstream:

- **It is disparity, not distance.** Near is a *high* value, far is *low*. Anything that
  displaces a mesh with it wants near-is-high, so no inversion is needed — but do not
  assume the opposite when reading it.
- **It is relative and un-normalised.** The values occupy a narrow slice of the 16-bit
  range (`room-day-summer-depth.png` uses 12–376 of 65535). **Always rescale by the
  image's own min/max** before using or exporting it. Treating the raw values as 0–65535
  yields a nearly flat map.
- **Same pixel dimensions as its colour image**, always.

Take the 16-bit PNG rather than the 8-bit grayscale or the colour-mapped preview — the
colour map is a visualisation and destroys the values. `public/art/*-depth.webp` is the
8-bit rescaled export; WebP cannot carry 16 bits, so the master here is the one to edit
from if editing is ever needed.

The 16-bit master is the archive. The **8-bit rescaled version is the working format** —
browsers truncate texture uploads to 8 bits anyway, and LaMa takes 8-bit input — so the
layer and inpainting stages all operate on it.
