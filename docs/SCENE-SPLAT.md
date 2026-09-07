# Building the room, third way: draw the Gaussians

This is the runbook for the **splat build** — `SHARP_SPLAT` in `src/data/scene.ts`, which
is what ships.

**There is no mesh in this build, and no hybrid.** One renderer, one bake, one splat
cloud. A hybrid (splats behind a torn mesh) was proposed on 2026-09-02 and rejected the
same day — see "Why not a mesh, and why not a hybrid" below, because that question comes
up naturally and the answer is not obvious.

The other two builds still exist: [SCENE.md](SCENE.md) is the authored layered build,
[SCENE-SHARP.md](SCENE-SHARP.md) is the superseded one that flattened SHARP into plates.

---

## Why not a mesh, and why not a hybrid

**The mesh was the original approach and it is what failed.** A triangle spanning a depth
discontinuity has two options and both are wrong:

- **Bridge it** and the silhouette stretches into whatever is behind — the smear.
- **Tear it** and a hole opens with nothing to draw in it.

Everything in the layered pipeline — SAM masks, `objects.json`, `in_front_of`, the peel
order, LaMa, all of [FILL.md](FILL.md) — exists only to manufacture something to put in
that hole. That is the complexity, and it is *caused by the mesh*.

SHARP looked like it removed the need for all that, because it predicts a second layer of
hidden geometry. **It does not, in the form a mesh needs.** Measured:

| | |
|---|---|
| SHARP layer B vs. the master | **25.1 dB** — a blurred near-copy, not a background |
| layer B >2/255 disparity behind the front | **2.23%** of frame |
| layer B >8/255 behind | 0.80% |
| how far it extends from a discontinuity | ~58 master px |

So layer B is what the paper says: *the visible surface plus a thin ribbon of hidden
geometry at silhouettes*. Enough for a renderer with no connectivity; nowhere near enough
to fill a torn mesh. Five rounds of increasingly elaborate repairs to the flattened build
each fixed the previous artifact and introduced a new one.

**Gaussians have no connectivity, so the bridge-or-tear choice never arises.** Under
lateral motion the primitives move apart and layer B's ribbon is what shows through.

A **hybrid** — splats as backdrop behind a torn full-resolution mesh — was proposed to
solve the push magnification problem below, then dropped. It would have reintroduced the
tear threshold, which is the single parameter that caused every artifact in the
superseded build, in exchange for sharpness during a 900ms transition that is blurred and
dimmed anyway. Splats-only is both simpler and lower-risk, and the escape hatch (reduce
`travel`) costs one number.

## "Layers" means three different things — this is the naming trap

Nothing in this build is layered in the sense the old pipeline was. Three unrelated
things share the word:

1. **The old build's layers** — plates cut by occlusion rank, needing `in_front_of`, SAM
   and LaMa. **Gone. Not used here.**
2. **SHARP's two layers** — `num_layers = 2` in the model. Its own output format: layer A
   is the visible surface, layer B the thin hidden ribbon. We do not choose these, author
   them, or cut them. They arrive in the PLY and are drawn as one cloud sorted by depth.
3. **The four `.webp` files** — these are **not layers**. They are attribute *channels* of
   one splat cloud: position, colour, size, rotation. A splat needs 15 numbers and an RGBA
   image carries 4, so it takes four images. Four files is the minimum, not a structure.

The alternative to four files is a single `.ply` (66 MB) or `.splat` (37 MB), or a `.sog`
container that needs a renderer library to read. Four WebPs is the simple end of that
range, not the complicated end.

## What it costs

SHARP's grid is 768×768, hardcoded (`internal_shape` in `sharp/cli/predict.py`), against
the master's 5504×3072 — ~7 master px per splat.

| eased push `e` | magnification | splat size | `room.css` blur |
|---|---|---|---|
| 0.0 | 1.00× | 2.1 px | 0 |
| 0.4 | 1.46× | 3.0 px | 0 |
| 0.6 | 1.88× | 3.9 px | 2.2 px |
| 0.8 | 2.66× | 5.5 px | 5.6 px |
| 1.0 | 4.55× | 9.5 px | 9.0 px |

(1600 CSS px viewport; magnification is `1/(1 - travel·e)` with the monitor's
`travel: 0.78`, which is where `room.css`'s "~76% of the frame" comes from.)

Magnification passes 2× only in the last third of the push, exactly where the veil
arrives; past `e`=0.8 the blur and the splat are the same size. **If that stops holding,
the dial is `travel` in `src/data/hotspots.ts` or the blur ramp in `room.css`. Not the
renderer.**

## Running it

```bash
tools/.venv/bin/python tools/sharp_splat_bake.py \
    --ply art/room-day-summer.ply --out-prefix art/build/room-day-summer \
    --variant night=art/room-night-summer.ply
cp art/build/room-day-summer-splat*.{webp,bin,json} public/art/
# then check /dev/splat: it verifies the rasters reached the GPU byte-for-byte
```

**Both PLYs are required build inputs**, and neither is committed (`art/*.ply` is
gitignored — see [art/README.md](../../art/README.md)). The bake cannot run from a fresh
clone; the rasters it writes are what ships. Keep both copies outside git.

The bake prints its own quantisation errors and fails loudly if a lossless raster does not
round-trip, and asserts the two invariants that keep an image decoder from eating the
geometry (see below). `--no-despeckle` disables the one clean-up stage for A/B.

**Do not drop the `--variant` flags.** They are not optional extras: `variants` in
`src/data/scene.ts` names every colour raster the site expects to be able to fetch, and a
bake run without them writes a manifest with a new `version` and no night raster, so the
lamp switches to a 404. Every variant is re-baked from the same PLY every time.

## Variants: one geometry, N colour rasters

`night` is a **second SHARP reconstruction** of the same room under different light. Only
its `f_dc` is taken. Position, size, rotation and opacity all stay the day build's, so the
variant costs one extra `-splat-color-<name>.webp` (~2.4 MB) rather than a second 12 MB
bake, every authored number — the aim points in `hotspots.ts`, the disparities in
`ambient.ts`, `excursion` in `scene.ts` — stays valid across all variants, and a day→night
crossfade dissolves between two colours instead of swimming between two clouds.

That is sound because SHARP's grid is 768×768 hardcoded and predicted from a single
camera, so **cell `i` is the same ray in both files**. `check_variant_ply()` asserts the
framing that guarantees it — focal length, principal point, master size, splat count — and
fails the bake rather than scattering one room's colours across another's splats.

The two fits are independent, so geometry drifts a little: on this scene the median splat
is within 0.9% in depth and 2% in size, with a real tail (p99 depth 56%, p10 scale 0.66).
`f_dc` is a blend coefficient rather than a surface colour, so a coefficient fitted for a
slightly different Gaussian is slightly wrong on this one. The bake prints that drift every
run. **The check that it does not matter is rendering the result at the home camera against
the variant's own master**, where this build scores 6.01/255 — better than the day build
manages against the day master (7.94). If a future variant's drift ever does matter, that
number is where it will show, and the escalation is to ship the variant's geometry too
(+10 MB, and `nearZ`/`farZ`/`fovDeg` re-copied from its manifest).

**Do not drop the `--variant` flags.** They are not optional extras: `variants` in
`src/data/scene.ts` names every colour raster the site expects to be able to fetch, and a
bake run without them writes a manifest with a new `version` and no night raster, so the
day/night control switches to a 404. Every variant is re-baked from the day PLY every time.

## What gets written

All four rasters are 768×1536 (grid × grid·layers), layer A on top.

**Three of them are not images.** `color` is a picture and ships as one; `geom`, `shape` and
`quat` are lookup tables indexed by splat, and they ship as raw planes because a browser is
entitled to colour-manage anything it decodes as an image — see the last row of the bug
table below. The `.bin` layout is `SPLT` + uint32 width + uint32 height + four planes,
deflated, read back through `DecompressionStream('deflate')`.

| file | contents | encoding |
|---|---|---|
| `-splat-geom.bin` | RG offset from cell centre, B/A 15-bit disparity, A biased ≥128 | planar + deflate |
| `-splat-color.webp` | RGB colour, A opacity | lossless WebP |
| `-splat-shape.bin` | per-axis scale | planar + deflate, log-quantised |
| `-splat-quat.bin` | rotation quaternion | planar + deflate |
| `-splat.json` | grid, intrinsics, every range needed to undo the above, plus `version` (content hash, appended to the raster URLs as `?v=`) and `geomAdler32` | — |

```
offset x    p50 0.18  p99.9 5.83  max 7.90  master px   (< one grid cell)
offset y    p50 0.13  p99.9 4.43  max 5.98  master px
depth       p50 0.00  p99.9 0.14  max 0.18  m           (at 113m)
scale       p50 0.9%  p99.9 1.9%  max 1.9%  relative
```

## Adding a clickable object

**Two files carry SAM prompts and only one of them is live.** This is the trap:

| | file | masks | build |
|---|---|---|---|
| legacy | `art/objects.json` — 16 objects, "what hides what" | `art/build/masks/` | layered, superseded |
| **live** | **`art/hotspots.json`** — "what can be clicked" | **`art/build/masks-hotspots/`** | splat |

The splat build has no layers, nothing to inpaint and no plates to cut, so it never asks the
occlusion question at all. `objects.json` and everything derived from it is dead — and worse
than dead, because the masters were **regenerated at the same resolution** on 2026-09-03, so
the stale masks have the right dimensions and the wrong pixels. They look registered and are
not: `monitor-left` sits at `[0.7260, 0.4238, …]` against the shipped `[0.6434, 0.3981, …]`.
Matching dimensions is not evidence. Check a bounding box against `src/data/hotspots.ts`.

`rm -rf art/build/masks art/build/_layer*` costs nothing and removes the ambiguity.

The run, for a hotspot or a room control alike — that file's question is "what can be
clicked", and only what happens on the click differs:

```
tools/.venv/bin/python tools/pick.py \
  --color art/room-day-summer.jpg --objects art/hotspots.json \
  --mask-dir art/build/masks-hotspots
# http://localhost:8765 -> "+ new" -> name it -> drag a box -> s

tools/.venv/bin/python tools/wake.py --masks art/build/masks-hotspots --out-dir public/art \
  --wake <name>=<name>          # prints rect and wakeRect
  # small object? --feather 2. The spill is blur(feather * 6) in *output* px, an absolute
  # radius, so the default is tuned for something the monitor's size. On the 40px speaker it
  # came back peaking at alpha 0.67 against the monitor's 0.96 and no stylesheet can rescue
  # that. Check the peak, not the printed size.

tools/.venv/bin/python tools/splat_probe.py --prefix art/build/room-day-summer \
  --at <cx>,<cy>                # disparity, and the spread that says whether to trust it
```

Then the entry goes in `src/data/hotspots.ts` (camera pushes in, needs `aim`, `travel`,
`veil`, a focus state) or `src/data/controls.ts` (changes something in place, needs none of
those, and needs a `ledRect` instead). Which one is the rule-5 decision and it is not
reversible by adding a flag.

**A control also needs a place to put its standby light, and that is a question about the
art, not about the data.** It has to land on a surface that explains it — a face with an
edge, a panel, a seam. A point light on a blank curved side reads as a blemish no matter
where along it you slide it; the speaker's went to its top face for that reason, and the
same test is why the feeder's ambient tell sits on the camera module actually painted there.

## Bugs found, and what they looked like

All seven were silent, and **six were data going through a picture pipeline** — the
recurring hazard in this design and the thing to suspect first. The last one ended the
argument: three of the four rasters do not go through one any more.

| bug | where | symptom |
|---|---|---|
| WebP discards RGB under transparent pixels | bake | splats teleported to the origin — `exact=True` required, now asserted |
| canvas `getImageData` round-trips premultiplied alpha, corrupting the geom raster's high byte for **49.6%** of splats | renderer | scrambled sort keys → severe global wash. Fixed by `readPixels` off an FBO |
| SH decode applied twice | bake | contrast crushed to 0.29× (std 0.070 vs master 0.241), rendering as a grey veil |
| covariance dilated without compensating alpha | renderer | sub-pixel splats promoted to hard dots — Mip-Splatting's determinant-ratio fix. Worth 0.32dB; **not** the speckle, though it was credited with it for a while |
| **`createImageBitmap` un-premultiplies the geom raster** | renderer | 103,221 splats moved >5% of their depth and **12,679 flung to the near plane**, keeping their own colour — bits of objects floating at arm's length over the whole frame |
| **WebCodecs `ImageDecoder` returns WebP as YUV, so `copyTo` subsamples chroma** | renderer | geometry low-passed — splats drift toward their neighbours and take on their sizes and rotations. The whole room soft and subtly wrong, alpha-bias check silent throughout |
| **Safari colour-manages the tables on decode**, ignoring `colorSpaceConversion: 'none'` | renderer, Safari only | the room soft and speckled with black where the field stops tiling. `/dev/splat` said `geom alpha bias intact` *and* `geom raster REWRITTEN in transit` — a colour transform does not touch alpha, which is that signature and no other |

### Why the tables stopped being images

The last row has no flag that fixes it. `UNPACK_COLORSPACE_CONVERSION_WEBGL` covers the
upload and changed nothing, because the damage is done at decode; the files carry no ICC
chunk to strip, and an untagged image is assumed sRGB and converted to the **display's**
profile, so there is nothing to pre-compensate for either. Chrome's default is a no-op for
these files, which is why it only ever appeared in Safari.

So the tables leave the image pipeline: raw planes, deflated, inflated with
`DecompressionStream`. Planar rather than interleaved because the channels are unrelated
quantities and interleaving puts four uncorrelated byte streams under one entropy model —
**8.69 MB over the three against 10.34 interleaved**, and against lossless WebP's 7.57 the
**+1.12 MB is what exactness costs**. WebP's spatial predictors are genuinely good at this
and no filter tried (up, left, either one planar) beat plain planar. A browser without
`DecompressionStream` throws in `loadRaster` and gets the poster, the same ladder WebGL2 is
already on.

**The rule this settles: pictures go through the image decoder, tables do not.** `color`
stays WebP because it really is a picture, and colour-managing it is the browser doing its
job.

### The one that took a day

The last row is the whole-frame speckle, and it resisted five wrong diagnoses (floaters,
layer-B bleed, giant splats, colour outliers, the dilation) because **the data was never
wrong**. A numpy replay of the shipped rasters — decode, EWA projection, back-to-front alpha
compositing, ~150 lines — rendered *clean* at the browser's own resolution, at home, in
motion, with the renderer's own draw order. That is what proved the corruption happened
during upload rather than in the bake.

`premultiplyAlpha: 'none'` is honoured; some decoders simply reach it by storing the image
premultiplied and dividing alpha back out, rounding to 8 bits each way. `geom`'s alpha was
the disparity's low byte, so any splat whose low byte was small had its high byte scaled up
and clamped to 255 — disparity 1.0, the near plane.

The reference-free detector: `P(B==255 | A<16)` is **0.00%** in the written file and
**1.34%** under a damaged upload, and predicting that number from a modelled round trip
matched the browser to four significant figures. Two fixes were applied, belt and braces:
bias the alpha channel so the round trip can only cost one LSB, and decode via WebCodecs.

**Only the first of those was a fix.** The alpha bias is the real one — it lives in the
data, so it protects whichever decoder runs, and it is what makes `createImageBitmap` safe
today. The second traded this bug for a worse one (the YUV row above) and has been removed.
The lesson is in the shape of the mistake: the reference-free detector was built to catch
*one* corruption and was then treated as evidence that the raster was intact. It is not a
general test. The general test is `geomAdler32` — the bake's own checksum of the bytes it
wrote, recomputed off the GPU — which both the renderer and `/dev/splat` now check.

### For reading the history

`f_dc_*` genuinely holds **spherical-harmonic coefficients** (range ±1.77) and
`0.5 + SH_C0·x` is the correct decode — ml-sharp's `save_ply` calls
`convert_rgb_to_spherical_harmonics(linearRGB2sRGB(...))`, so the SH coefficients encode an
already-sRGB colour. An earlier version of this doc claimed the opposite and called the SH
decode wrong; it is not, and acting on that would break the colour. The real bug was
applying it *twice*.

The evaluation prototype (`art/build/sharp-eval/viewer.html`) has the crushed decode.
The interactive harness that replaced it now lives at `src/pages/dev/splat.astro`, served at
`/dev/splat`. Its
"flawless" verdict was about *motion*, which was genuinely good — the wash hid every other
defect, so each fix revealed the next one.

## Settled here

- **No coverage fit.** An earlier stage grew every Gaussian until it tiled its own sampling
  cell, because SHARP's square grid on a 16:9 master leaves 60.6% of splats narrower than
  their horizontal spacing, so the field "would not tile". Measured, it tiles: accumulated
  alpha is ≥0.9 on **100.00%** of pixels without it, at the home camera and at the 4.5×
  magnification the monitor push reaches. It cost **3.70dB** — it is a low-pass filter, and
  it was the only lossy stage in the bake — and bought nothing. It was credited with
  suppressing speckle that turned out to be the premultiply bug above. Removing it took the
  bake from 3.5–4.9dB behind the raw float PLY to **within 0.3–0.8dB** of it.

- **Position cannot collapse to depth alone.** The obvious compression — a splat lies on
  the ray through its grid cell, so store one depth channel — is false. SHARP moves splats
  off their cell: median 1.8 master px, p95 157, max 1033. The offset is square-companded,
  spending precision near zero (~0.02px) where half the splats are.

- **The draw order is computed once, at load.** A general splat renderer re-sorts every
  frame because its camera can go anywhere; ours cannot. Forward motion — the whole 2.5m
  push — translates every view depth equally and cannot reorder anything. Only lateral
  motion can, and ambient is ±4cm in a room metres deep. One counting sort at load, no
  worker, no GPU radix sort.

- **The covariance is rebuilt in the vertex shader.** Precomputing needs two RGBA32F
  textures (37MB) and a 1.2M-iteration JS loop before the first frame.

- **`colorSpaceConversion: 'none'` on every `createImageBitmap`.** Three of the four
  rasters are quantised geometry; a colour-management pass rewrites them with no error.

- **No alpha channel may carry a small value.** `geom`'s disparity is 15 bits with the low
  7 biased into `[128, 255]`, and the quaternion is sign-flipped so its alpha component is
  non-negative — `q` and `−q` are the same rotation, so that one is free. Both exist because
  a decoder may store an image premultiplied and divide alpha back out, scaling RGB by
  255/A. See "Bugs found" above for what that cost. The bake asserts both; the renderer
  asserts the geom one again on load.

- **Decode with `createImageBitmap`, not WebCodecs `ImageDecoder`.** This is the reverse of
  what this file said until 2026-09-03, and the reversal was measured in the harness: same
  bytes, same shader, same canvas size, `createImageBitmap` clean and `ImageDecoder`
  artifacted. `ImageDecoder` may decode a WebP into a **YUV** `VideoFrame`, and
  `copyTo({format:'RGBA'})` then converts — with chroma subsampled. Alpha survives exactly,
  so the alpha-bias check stays silent, while R, G and B are averaged with their
  neighbours: the sub-pixel offsets, the disparity's high byte, and in the other rasters
  scale and rotation. It is a **low-pass filter on the geometry**, and it renders as a soft,
  subtly wrong room with nothing logged. The original argument for it — "no alpha step" —
  was true and incomplete; avoiding one liberty an image pipeline can take is not the same
  as avoiding all of them. The alpha bias is what makes `createImageBitmap` safe, and that
  fix lives in the data, so it protects whichever decoder runs.

## Do not reopen

- **Flattening the Gaussians into plates** — see the measurement at the top.

- **Inferring a variant's colours from an image of it.** The whole idea, not a detail of it.
  A night master is a pixel-registered edit, so the geometry is still exactly right and only
  the light changed — which makes moving each splat's colour by the lighting ratio read at
  its own pixel look like the obvious cheap win: one reconstruction, one 8MB ply, a variant
  costs a jpg. It cannot be made to work, because the question is undetermined. **A
  photograph does not record what is behind a leaf.** A hidden splat has no pixel of its own,
  so it is lit through whatever covers it; here that is a white glazing bar, which looks the
  same at midnight as at noon, in front of a yard that does not. At 12cm of lateral travel a
  sunlit fence slid out from behind every bar — `f_dc` from the *day* fit, dimmed by a ratio
  measured on the mullion.

  Roughly 250 lines went on bounding that, and each fixed something real: a difference
  anchored on the master keeps the master's lighting wherever the delta is wrong, so anchor
  on a ratio; a raw point sample painted across an elongated splat smears along its long axis
  (structure kept 0.465 against `f_dc`'s 1.000), so anchor on `f_dc`; a fixed ±6-cell search
  for a same-depth neighbour is sized for the *ribbon* when what bounds it is the size of the
  *occluder*, so make the search radius-free. None of them fixed it. Measured against the
  night master at the home camera: inferred **8.93**/255, reconstructed **6.01**, with the
  day build at **7.94** against its own master.

  Two process lessons cost more than the bug. Every metric was computed on the rasters, which
  are the renderer's *input*, while the complaint was about rendered frames under camera
  motion — and an offline renderer that draws circular discs where the shader draws
  anisotropic conics reproduces none of it (8.9/255 at home against the real conic's 6.0,
  and it showed the fence as clean). **If the artifact only appears when the camera moves,
  nothing measured on a still raster can find it.**

- **Believing a crop of the splat grid without converting the coordinates.** The grid is
  768×768 over a 16:9 master, so rows compress: `master_y = grid_y / 768 × 3072`. A box
  picked by eye off the master and applied to the grid measures the wrong band — it is how a
  variant fix that had not worked got reported as working, because the region checked was sky
  and the complaint was about the fence.

- **TripoSplat, or any object-reconstruction model, for a room.** Tried 2026-09-02. Its
  background-removal stage *deleted the room*: the preprocessed input keeps the 3D printer,
  the office chair and a sliver of the monitor stand on black. It outputs 262,144 splats
  (512², 4.5× fewer than SHARP) in a **canonical unit cube**, not the master's camera
  frame, which alone breaks every rect in `hotspots.ts`. Its code is MIT — genuinely better
  than SHARP's research-only weights — but MIT on a model that cannot do this job. For a
  future candidate check: permissive **weights** (not just code), output in the input
  image's camera frame, and a grid finer than 768².

- **Hand-rolled attribute compression cleverer than this.** Measured. k-means VQ of the
  joint (log-scale, quaternion) vector: K=4096 gives 1.79 MB at 12.5% p90 splat-radius
  error — *worse* than plain lossy WebP (2.06 MB, 14.9%) once the codebook is counted. The
  reasoning that predicted otherwise was instructive and wrong: SOGS's compression comes
  mostly from vector quantisation, **not** from the PLAS spatial sort, so "our data is
  already grid-ordered, therefore we beat SOGS" does not follow. Only the sort is free.

- **A Three.js splat library** (Spark, `@mkkellogg/gaussian-splats-3d`, PlayCanvas) — all
  MIT, all good. Rejected because their headline features are per-frame GPU sorting and
  LOD and this scene needs neither, so it is ~200KB gzipped of three + library to use none
  of it. **A cheap retreat, not a closed door:** Spark reads SOG and the bake can emit it.

- **Pruning layer B.** The memory note claiming "pruning layer 1 is free" is **wrong** and
  was refuted twice: `room.splat` and `room-fit.splat` are the failed pruned sets, and
  `sharp_export.py` carries its own retraction — the pruning was validated with a
  rasterizer that normalised by accumulated weight, which hid that near-coincident layer-B
  Gaussians carry real *coverage*. Under honest alpha compositing, pruning them speckles
  the render.

  **Refuted a third time**, from a new direction, by someone optimising rather than
  exporting — so here is the measurement that looks most convincing and is not: 90.79% of
  layer B sits within 1% of layer A's depth *in the same grid cell*, which reads as a
  redundant second copy of the visible surface and is 45.4% of the scene. It is not. Those
  pairs are separated in the image plane by a median of 4.1 master px against a cell pitch
  of 7.2 x 4.0, and **27.8% of them are more than a full cell pitch apart**. The two layers
  scatter samples across the same surface at different positions; coverage is their union.
  Depth agreement says nothing about coverage. Compensating the survivor with the pair's
  combined opacity does not save it either — that fixes the tone and not the holes.

## Where the frame time actually goes

Measured on an M4 laptop at 3420x1628, using `/dev/splat`'s `ms gpu` (a
`EXT_disjoint_timer_query_webgl2` reading; fps is useless here because it pins to the
refresh rate). Three plausible culprits were each ruled out by a one-click A/B, and the
order matters — every one of them would have been the obvious thing to optimise:

| Suspect | Test | Result |
|---|---|---|
| Fragments / overdraw | `render scale` 1.00 -> 0.75 | little change |
| Per-vertex covariance rebuild | `cov` -> CPU float32 precompute | **no** change |
| Scattered texture reads | `sort` -> sequential (coherent fetches) | little change |

What *did* move it, by a lot, was cutting the vertex stage's output: five interpolated
highp floats (a conic and a centre, with the offset rebuilt from `gl_FragCoord`) down to
two mediump ones, by building the quad on the covariance's eigenvectors so a corner at
parameter (u, v) is at Mahalanobis distance^2 = sigma^2 (u^2 + v^2) and the fragment shader
is one dot product.

Once that landed the balance moved. Fitting `time = geometry + fill x pixels` across two
render scales (15.0ms at 1.00, 10.0ms at 0.70) splits the frame into **9.8ms of fill and
5.2ms of geometry**, so after the varying cut fill is the larger half and render scale
matters again where it had not before. `maxPixels` is set from that: 3.2M is a 0.76x scale
on a 1710x814 window, which is where Alex put the quality floor, and it predicts ~10.8ms.

Two further structural changes were considered and both are refuted by these numbers rather
than by taste:

- **A transform-feedback pre-pass** (per-splat geometry computed once, 1.18M invocations
  instead of 4.72M) saves ALU and texture fetches, and removing ALU and fetches was
  measured at *exactly zero*. Same varyings, same 2.36M triangles.
- **Point sprites** (one vertex per splat, `gl_PointCoord` for the interpolant) cut geometry
  4x but force an axis-aligned square instead of an oriented ellipse, which this renderer
  already measured at ~2.4x the fragments: 5.2/4 + 9.8x2.4 = 14.7ms against 10.8ms. Worse.

What is left is not the frame but how often it is drawn, and the rule is one line: draw
when the camera has moved at least 0.4 device px since the frame on screen, measured at the
nearest content because parallax goes as 1/z, capped at 60Hz. Drift settles around 28Hz, a
cursor or a push clears the threshold instantly, and under `prefers-reduced-motion` the rig
zeroes both drift and parallax so the distance is exactly zero and the renderer stops
entirely — redrawing a still room for the people who asked for less motion was the opposite
of what they asked for.

This replaced a first attempt that classified the camera's *speed* and picked between a 60Hz
and a 24Hz cadence, with a separate exact-equality test for the frozen case. Three rules and
three constants, where one threshold in the unit that actually matters — pixels the viewer
can see — covers all of it.

So this is **tiler-bound, not fill-bound or ALU-bound**: on a tile-based deferred GPU the
cost scales with primitives x varying bytes, and 1.18M splats is 2.36M triangles a frame.
The levers that work are the ones that shrink either factor — `flat` on the colour varying,
`maxPixels`, and not redrawing a frame that has not changed by a pixel. The levers that do
not work are the ones that make the shader smarter.

`/dev/splat` deliberately does none of this: it draws full-scale at a flat 60Hz so it
measures the whole cost, and it prints what the site would use underneath, because reading
its number as the shipped one overstates the room by about half.

## Open

### 1. Payload — 8.89 MB

geom 2.75 + quat 2.66 + shape 2.27 + colour 1.22, against the layered build's 3.10 MB.
The one thing about this build that is worse. Routes, in order:

1. Convert to **SOG** (`playcanvas/sogs`, 15–20× on raw PLY → ~3–4 MB) and read it with
   Spark. The reference implementation needs CUDA (`torchpq`, `cupy`, PLAS) so it will not
   run on the Mac as-is; PLAS is the part we could skip, since our data is already ordered.
2. A coarser grid, trading directly against the push magnification table above.

~~Note the four files carry stable names and no content hash…~~ **Done.** The bake writes a
`version` (a content hash of the four rasters) into the manifest and both the renderer and
`/dev/splat` append it as `?v=`; the manifest itself is fetched with `cache: 'no-cache'`,
which is ~500 bytes against the 8.9 MB it points at. The harness also moved to `/dev/splat`
so it is served from the site's own origin — it used to be opened through a separate static
server, which is a separate HTTP cache, which is how the two could disagree about which
bake they were showing.

### 2. Resolution — the ceiling is upstream, in SHARP

The room reconstructs at ~7.17 master px per splat horizontally against 4.00 vertically,
and that asymmetry is the pixelation. It is not a bake setting: `predict_image` resizes the
master to a **square 1536×1536** before inference, a 1.79× horizontal crush, and emits a
768² grid.

A 16:9 `internal_shape` does not work. `split()`/`merge()` in `spn_encoder.py` derive their
tile counts from `image.shape[-1]` alone, and the pyramid's lowest level has to land exactly
on the ViT's 384², which only a square 1536 input does.

The route past it is **tiled inference**: run SHARP on overlapping square crops of the
master and merge the Gaussian sets in a common frame. Two square-ish crops of a 16:9 master
are each a ~1.1× stretch instead of a 1.79× crush, roughly doubling both the splat count and
the horizontal detail. It needs `predict_image` to accept a principal-point offset — it
currently hardcodes the image centre, which is what would otherwise break every rect in
`hotspots.ts` — plus a merge step. Not started.

