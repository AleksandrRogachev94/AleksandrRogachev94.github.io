# Asset pipeline

How a generated master becomes the files the browser loads.

Three docs, three jobs — keep them separate:

| Doc                        | Answers                                          |
| -------------------------- | ------------------------------------------------ |
| [PLAN.md](PLAN.md)         | _why_ the site is built this way                 |
| [PROMPTS.md](PROMPTS.md)   | _what to type_ into the image generator          |
| **PIPELINE.md** (this)     | _how_ a master turns into shipped layers         |

---

## Four problems that look like one

The camera push has several distinct failure modes. They were conflated for a while and
that wasted effort, so they are named separately here. **Each has its own fix, and no fix
helps with any other row.**

| Symptom                                     | Actual cause                                     | Fix                                      |
| ------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| Smearing / rubber-sheeting at silhouettes   | disocclusion — surface the art never painted      | **layers + inpainting** (this doc)       |
| Silhouettes wobble, edges ramp instead of cut | soft depth edges in the model output              | bilateral median filter on depth          |
| Everything goes soft near the end of a push | source resolution, magnified past native          | 4K master                                 |
| Arrival at an object never looks right      | the information is not in the image at any scale  | cross-fade to a close-up plate at ~70%    |

**Resolution does not fix smearing.** Smearing is geometric — the mesh is asked for surface
that was never painted. A 4K master gives sharper smears. Do not spend money on the
generator expecting the artifacts to go away.

The constraint that makes all of this work: **cap the excursion.** Lateral camera motion is
the only motion that produces real parallax, and it is also the only motion that produces
disocclusion — they are the same motion, so there is no parameter setting that gets one
without the other. Layers buy a larger honest budget; they do not buy an unlimited one.
Ambient parallax stays small, and the push hands off to a plate before the mesh runs out.

---

## Stage 0 — the locked master

`art/room-day-summer.png` is the geometry lock. Hotspot rects, the depth map, every layer
mask and every variant derive from it. See PROMPTS.md rule 1.

Everything downstream of here is **derived and reproducible**. If the master changes, every
artifact in stages 1–4 is regenerated from scratch. That is cheap by design — the only
manual step in the whole chain is drawing two masks.

## Stage 1 — depth

Depth Anything V2, HuggingFace demo, **"16-bit raw output"**. Format details (disparity
polarity, un-normalised range, why not the colour-mapped preview) are in
[art/README.md](../art/README.md).

Two things happen here:

1. **Rescale 16-bit → 8-bit** by the image's own min/max. Browsers truncate texture uploads
   to 8 bits anyway, and LaMa wants 8-bit input, so this is the working format from here on.
2. **Sharpen the edges** with a bilateral median filter. A soft depth edge turns a clean
   silhouette into a smeared ramp, which is a separate artifact from disocclusion and is
   cheap to remove. This is the same preprocessing step Shih et al. use in
   [3D Photo Inpainting](https://shihmengli.github.io/3D-Photo-Inpainting/).

The window is deliberately absent from the depth map — the model reads glass as one flat
surface, which is the room layer we want. The yard is arranged as its own quad, never
inferred. See PROMPTS.md § Layers.

## Stage 2 — the layer cut

This is a **layered depth image**: the scene split at depth discontinuities so that the
background behind each foreground layer actually exists.

**Cut by depth, not by object.** Objects at similar depth have no relative parallax
between them, so there is nothing to disocclude and nothing to inpaint. Enumerating props
one by one is the wrong axis and produces a pile of layers that buy nothing.

| Layer  | Contents                                                    | Alpha | Inpainted |
| ------ | ----------------------------------------------------------- | ----- | --------- |
| `near` | cropped foreground prop, chair                              | yes   | no        |
| `mid`  | bench, desk, monitors, printer, lamps, feeder               | yes   | yes       |
| `far`  | walls, window frame and muntins, floor recession            | no    | yes       |
| yard   | separate quad behind the glass — see PROMPTS.md § Layers    | no    | n/a       |

Three room layers is where the returns flatten. Do not add a fourth without a visible
artifact that demands it.

**Masks are authored once, by hand, against the locked master** — same discipline as
hotspot rects. Threshold the depth map to get a first cut, then clean up by hand. Two
masks only (`near`, `mid`); `far` is whatever is left.

Two mask variants come out of each drawing, and confusing them is the classic mistake:

- **Alpha mask** — un-dilated, ~1px feather. Cuts the layer out for compositing.
- **Inpaint mask** — the same shape **dilated by several pixels**. Fed to LaMa. The dilation
  matters: without it LaMa sees the object's own anti-aliased halo as valid context and
  paints a ghost of the object back into the hole.

## Stage 3 — inpainting with LaMa

**Tool: [LaMa](https://arxiv.org/abs/2109.07161) via [IOPaint](https://github.com/Sanster/IOPaint),
run offline. Not the image generator.**

Why LaMa and not a Gemini edit, decided deliberately:

- **It only touches masked pixels.** Everything outside the mask returns bit-identical, so
  registration is structurally impossible to break. A generator edit repaints the whole
  frame and has to pass a diff test every single time.
- **Free and local**, so it reruns at zero cost whenever the master changes — and it will.
- **The content needed is texture continuation** (floor, wall, desk surface), which is
  LaMa's exact strength. Generator inpainting is good at inventing novel objects, which is
  precisely what we do not want: new objects mean new geometry.
- **Resolution-robust** — trained at 256, generalises well past 2K, so it holds up on a 4K
  master.

Run it **cumulatively, on colour and depth alike** — depth is just a grayscale image, and
inpainting it with the same mask and model keeps colour and depth in the same scale for
free. Re-running the depth model on an inpainted plate does not, and would need a rescale
fit to realign.

```
master + depth
  ├─ mask(near) ──► LaMa ──► plate_1  (near removed, hole filled)   colour + depth
  └─ mask(mid)  ──► LaMa ──► plate_2  (near+mid removed, filled)    colour + depth

near = master  masked by alpha(near)      depth = original depth masked
mid  = plate_1 masked by alpha(mid)       depth = plate_1 depth masked
far  = plate_2, opaque, full frame        depth = plate_2 depth
```

Two LaMa runs on colour, two on depth. Renderer draws far → mid → near, back to front.

Tooling shape (check `iopaint run --help`; it downloads weights once, CPU is fine):

```sh
pip install iopaint
iopaint run --model=lama --device=cpu \
  --image=<file-or-dir> --mask=<file-or-dir> --output=<dir>
```

**This is authoring tooling, not a site dependency.** CLAUDE.md's zero-dependency bias
governs what ships to the browser. Nothing here is in `package.json`; the site still loads
plain images.

## Stage 4 — export

Masters and derived masters stay in `art/`, committed, never served. Only `public/art/`
ships.

| File                                   | Format                        |
| -------------------------------------- | ----------------------------- |
| `room-day-summer-far.webp`             | WebP, opaque, lossy           |
| `room-day-summer-{mid,near}.webp`       | WebP **with alpha**, lossy    |
| `room-day-summer-{far,mid,near}-depth.webp` | WebP, **lossless**        |

Depth stays lossless — WebP's lossy mode invents ringing at exactly the high-contrast edges
that matter most. Colour is lossy; nobody will see it.

---

## Order of operations, and when to spend on 4K

A native 4K render is a **fresh generation, not an edit** — it drifts geometry, so it does
not upgrade the current master, it *replaces* it. Hotspot rects, depth, masks, layers and
all six variants re-derive. That fact sets the sequence:

1. **Iterate composition free at low resolution.** This is the loop that is still open.
2. **Prove the layer pipeline once at 1024, with the `near` layer only.** Renderer code is
   resolution-independent, so this validates the geometry before any money is spent.
3. **Lock the composition, then buy one 4K render.** A handful of attempts plus night, four
   seasonal edits and the close-up plates lands somewhere around $3–8 total. Against the
   hero asset of the entire site that is not a real number.
4. **Re-derive everything from the 4K master**, in the order above.
5. **Close-up plates last**, once hotspots are final.

**Upscaling is the fallback, not the plan.** Real-ESRGAN and friends are free and
registration-perfect, and painterly art upscales far better than photography — but they
invent detail rather than reveal it. Keep upscaling for bumping a variant that cannot
afford to drift; do not build the site on it.

---

## Settled — do not reopen

- **Per-object layers.** The cut is by depth, not by prop. See stage 2.
- **Generator inpainting** (asking the image model to redraw the room without the chair).
  Rejected in favour of LaMa on registration grounds — see stage 3.
- **Re-running the depth model on an inpainted plate.** Its output is relative and
  un-normalised, so the plate's depth lands on a different scale than the original and
  needs a fit to realign. Inpaint the depth map instead.
- **Buying resolution to fix smearing.** Different problem, see the table at the top.
