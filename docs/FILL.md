# The collar around the leaves

Findings from the pass that went looking for "visible artifacts, and I want more parallax".
The runbook is [SCENE.md](SCENE.md); the reasoning behind the pipeline is in
[PIPELINE.md](PIPELINE.md).

The headline: **the artifact was not the inpainter, and it was not the masks.** The
pipeline was manufacturing it, and `--feather` was the dial.

## The measurement that settled it

Everything here turned on one question — how wide is the painted edge of a leaf? Three
attempts to measure it, two of them wrong in ways worth remembering.

**Wrong: high-frequency energy in the fill.** The "detail ratio" this document used to lead
with cannot tell hallucinated texture from correct texture, and punishes a fill for being
smooth where the surface is smooth. It never detected the artifact at all.

**Wrong: object-colouredness against local background.** Comparing each object's
surroundings to its own interior colour said the master was still meaningfully
object-coloured 24–48px outside the mask — fig 0.25 at 12–24px, chair 0.67. On a lacy
plant that window is measuring **the next leaf**, not one leaf's edge. This one was
actively harmful: it justified widening `feather` and made things worse.

**Right: sample the master along the mask's outward normal, with no fill involved.**

| | −6px | −3px | 0px | +3px | +6px | +10px | +18px | +32px | +80px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fig leaf edge | −0.01 | 0.01 | 0.67 | 0.98 | 0.99 | 1.01 | 1.03 | 1.02 | 0.98 |

0.0 is leaf colour, 1.0 is clean background. **Leaf to background in three pixels.** No
soft rim, no defocus tail, no glow.

## What the artifact was

`--feather` sets the soft-alpha band *and* how far the surface behind a layer is blanked
and refilled. Blank N px of real background out of the plate behind, and `matte()` has to
reconstruct it from the object — so the object is charged partial alpha across the whole
ring. That is a hard-edged collar welded to every silhouette, and it travels with the
object.

It is invisible at rest, because the recovered foreground makes the composite exact by
construction. It is obvious the moment the camera drifts. What the fig carries 4–12px
outside its own mask:

| feather | 3 | 4 | 6 | 16 |
| --- | --- | --- | --- | --- |
| alpha on the collar | 0.00 | 0.01 | 0.08 | **0.31** |

Linear in `feather`, because it *is* `feather`. Shipping at **4**, which spans the measured
3px transition with a pixel in hand. `feather` does not scale with the plate: a generator
asked for a bigger image draws a sharper edge, not a proportionally softer one. The
original code had this right and it was broken and restored during this pass.

## Bisecting it

The step that actually found it: with `prefers-reduced-motion` on, which zeroes both drift
and cursor parallax, the outline vanished. That one observation ruled out the plates, the
WebP export, the premultiplied-alpha path and the depth pad in a single move, all of which
had been verified numerically and none of which was the problem. **At-rest exactness is not
evidence of correctness under motion** — `matte()` guarantees the first and says nothing
about the second.

Worth keeping as a habit: at-rest error was 0.03/255 while the room looked wrong.

## Things that did not work

**Anchoring on `hole`.** Provably a no-op: `lama_fill` composites, so outside the hole the
work is bit-identical to the master and the residual ring is exactly zero. +0.0 on both
layers. Anchoring has to run on `keep` — see below, it is now the fix for the contour.

**Grading the composite across the halo ring** instead of cutting it hard. Kills the step
by construction and breaks the invariant: at-rest 0.03 → 1.56/255, 1.13% badly wrong. The
ring between a layer's alpha and the halo edge is visible at rest, and grading it blanks
genuine background. The hard cut was defending something real.

**Widening `feather` to 16 or 32.** The subject of this document. Improved the layer-0 seam
metric (17.0 → 12.7 → 9.5 mean) and made the room visibly worse, because the seam metric
was measuring a boundary that is hidden at rest and the collar is not.

**A masked diffusion pass (FLUX.1 Fill via mflux), `tools/refine.py`.** Written, run, and
deleted. ~20 min/tile, about 13 hours for both layers, and its raised-cosine window blended
tile against tile but not tile against the LaMa fallback, so the edge of the tile set was
itself a hard seam. Aimed at fill sharpness, which was not what the eye was seeing. If it
is ever wanted, `--fill-dir` is still the handover point and stage 5 still emits
`-layerN-hole.png` every run. Both the venv and the 32 GB of
weights have been deleted.

## The second artifact: the contour that stands off the leaf

With the collar gone, what remained was a leaf-shaped outline that stays put while the leaf
moves, with revealed fill between it and the leaf. That is the layer-0 composite seam: LaMa
fills the footprint grown by `halo`, only the footprint is pasted back, so the fill was made
continuous with its own answer in the halo ring and then meets real paint there instead. It
is hidden at rest under the layer in front of it.

`anchor_to_master` on `keep`, solved at **full resolution**, cancels it:

| discontinuity in layer 0 across the keep boundary | none | anchored |
| --- | --- | --- |
| mean | 22.5 | **6.7** |
| >8 levels | 73.7% | **21.7%** |
| >16 levels | 48.2% | **8.3%** |
| >25 levels | 32.8% | **3.9%** |

`solve_scale` is the whole difference. At the 0.25 default the correction is a membrane far
too coarse to follow a lacy contour and the seam barely moves.

**This was dismissed twice on broken metrics**, which is the more useful lesson. The first
measured the step between the fill and the master *inside* `keep` — where the master is the
object, so it was comparing fill against leaf. The second defined the boundary as "where
layer 0 differs from the master", which anchoring *shrinks* rather than moves, so the number
was structurally incapable of improving. The right measurement is the discontinuity within
layer 0 itself across a boundary derived from the masks, since that is what the eye sees.

## Still open

- **`--margin` is 344px and nothing has yet been raised to use it.** With the collar gone,
  raising the ambient `parallax` / `drift` in `ROOM_TUNING` is the next thing to try.
- **The peel feeds itself.** By the cabinet, 57% of what LaMa sees as context is earlier
  LaMa output — desk 29%, wall shelf 29%, left monitor 27%, the fig's pot 93%. Whole-hole
  removal was measured worse, so the peel stays; the middle ground is untested.
- **`gridCols` is 1024 against a 5504px plate**, 5.4 texels per mesh quad. Not measured as
  an artifact source; raising it is the main cost dial on weak GPUs.
