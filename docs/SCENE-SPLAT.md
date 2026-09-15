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
    --variant night=art/room-night-summer.ply \
    --variant fall=art/room-day-fall.ply \
    --variant winter=art/room-day-winter.ply \
    --variant winter-night=art/room-night-winter.ply \
    --variant fall-night=art/room-night-fall.ply
cp art/build/room-day-summer-splat-color*.webp \
   art/build/room-day-summer-splat*.bin \
   art/build/room-day-summer-splat.json public/art/

# the flat posters (no-WebGL2, prefers-reduced-motion, and the frame shown while the
# cloud downloads). One per master, and re-run for any master you regenerated.
for m in room-day-summer room-night-summer room-day-fall room-night-fall \
         room-day-winter room-night-winter; do
  tools/.venv/bin/python tools/export.py --prefix art/build/room-day-summer \
      --out-dir public/art --poster-only --master "art/$m.jpg"
done
# then check /dev/splat: it verifies the rasters reached the GPU byte-for-byte
```

**Both of those lines are narrow on purpose, and `art/build/` is why.** It is disposable but
it is never *emptied*, so it keeps outputs from encodings and from builds this one no longer
uses — and anything that globs it promotes them into `public/art/`, where they are megabytes
that nothing fetches and `git add` commits. It happened twice before the commands above were
tightened: `-geom/-shape/-quat.webp` from before the geometry tables moved to `.bin` (7.6 MB),
and the LAYERED `-layer*.webp` plates (2.6 MB), which `export.py` re-wrote on **every** run
because it finds plates by globbing rather than by being asked for them. `--poster-only` is
the fix for the second; the bake's own outputs are exactly `-splat-color*.webp`, `-splat*.bin`
and `-splat.json`, which is what the `cp` names. If in doubt, `rm -rf art/build` first and let
one clean run define the set.

**All six PLYs are required build inputs**, and none is committed (`art/*.ply` is
gitignored — see [art/README.md](../../art/README.md)). The bake cannot run from a fresh
clone; the rasters it writes are what ships. Keep both copies outside git.

The bake prints its own quantisation errors and fails loudly if a lossless raster does not
round-trip, and asserts the two invariants that keep an image decoder from eating the
geometry (see below). `--no-despeckle` disables the one clean-up stage for A/B.

**Do not drop the `--variant` flags.** They are not optional extras: `variants` in
`src/data/scene.ts` names every raster set the site expects to be able to fetch, and a bake
run without them writes a manifest with a new `version` and no night tables at all, so the
lamp switches to a 404. Every variant is re-baked from the same day PLY every time, because
they share its quantisation range — see "One number line for every cloud".

## Variants: one lattice, N reconstructions

There are five: `night`, `fall`, `winter`, `winter-night` and `fall-night`. Which one a
visitor sees is a (season, time-of-day) lookup — `variantFor` in `src/data/scene.ts`, the only
place the matrix exists. Summer day is the base raster and costs no fetch, so the 3x2 matrix is
now fully covered with no cell borrowing another's picture.

**`fall-night` used to be that borrow, and per-variant geometry is what ended it.** The argument
for reusing `night` was that nothing distinguishing fall from summer outdoors survives deep
shadow, which is a defensible claim about *colour*. It stopped being defensible once a variant
carried shape: the fallback handed a fall visitor summer's leafy crown, not merely summer's
palette. A colour compromise is a judgement call; a geometry compromise is a wrong room.

Each is a **second SHARP reconstruction** of the same room under different light, and each
ships its own colour *and* its own geometry — four tables, ~11 MB a season. The bake is
therefore six reconstructions and writes ~67 MB, but **a visitor still downloads exactly one
cloud**: geometry is fetched on switch, so the count is deploy size, not load time.

It was colour only for most of this build's life: `f_dc` crossed over and position, size,
rotation and opacity stayed the day build's, so a variant cost one 2.4 MB raster instead of a
second bake, every authored number stayed valid across all of them, and a day→night change
dissolved between two colours rather than swimming between two clouds. That is a good trade
and it is why the colour-only path still exists — a name in `variants` but not in
`variantGeom` takes it. What it assumes is that **a variant master may relight any surface
but may not move one**, and winter broke that. Its yard is bare branches against distant snow
where summer's is a leafy canopy near the glass: not the same surface recoloured, a different
surface at a different distance. Colours fitted for one landed on the other and the window
came back with smeared branches, string-light bulbs turned to soft blobs, and a ghost streak
across the panes.

Measured at the home camera against each variant's own master (MAE/255):

| | bulb strip | window band | feeder | interior |
| --- | --- | --- | --- | --- |
| winter-night on the day cloud | 5.86 | 6.17 | 8.22 | 3.46 |
| winter-night on its own | **4.86** | **5.58** | **6.27** | 3.64 |

Note the interior column going the *wrong* way. The day build is fitted to this exact room
and the room does not change between masters — only the yard does, which is the whole shape
of the problem.

**All four tables travel together or none do.** The tempting middle — take the variant's
`scale` so a bulb gets its own small Gaussian back, keep the day's centres so nothing moves —
is much worse than either whole; the do-not-reopen list has the numbers. `f_dc` is a blend
coefficient fitted so *overlapping* Gaussians sum to the master, so position, scale, rotation
and colour are one joint solution, and half of one plus half of another satisfies neither.

That is all sound because SHARP's grid is 768×768 hardcoded and predicted from a single
camera, so **cell `i` is the same ray in both files**. `check_variant_ply()` asserts the
framing that guarantees it — focal length, principal point, master size, splat count — and
fails the bake rather than scattering one room's colours across another's splats. Under the
colour-only path a mismatch was a wrong colour; now it would be 1.2M splats flying to the
wrong places, so the assertion matters more, not less.

### One number line for every cloud

Every reconstruction in a bake is quantised against the **same** disparity and log-scale
range (`encode()` in `tools/sharp_splat_bake.py`), spanning all of them rather than each file
normalising to its own min and max.

`nearZ`/`farZ` stop being an accident of whichever master was the `--ply`. They were
per-file, and re-locking the masters moved `farZ` 98 m → 14 m — nothing in the room moved,
the deepest thing in it did — which silently changed what every stored depth in `src/data`
meant. The feeder, mapped at 8.3 m, began decoding as 5.7 m and the camera stopped short of
it in mid-air. Those are **metres** now (`imagePointToWorld` in `src/scripts/roomGeometry.ts`)
and the range is shared, so a re-bake is free to move the planes.

The union costs almost nothing, because disparity is quantised linearly in 1/z and stretching
the far end is nearly free at the near end where the parallax is. Over these five
reconstructions it takes `farZ` from 13.9 m to **111 m** — winter's bare branches let distant
sky through where summer's canopy stops at the fence — and the p99 depth error inside 3 m
goes 0.110 mm → 0.121 mm.

### Changing the lighting: a dip, not a dissolve and not a morph

Both of the other two were built and neither survived contact with the seasons.

A **colour dissolve** was right while a variant was `f_dc` alone on one shared cloud: nothing
moved between variants, so crossfading two colour rasters read exactly as the light changing.
It stopped being available the moment each season brought its own geometry — there are two
different rooms to get between now, not two lightings of one.

A **morph** was the obvious replacement and the maths is clean. Correspondence is exact (cell
`i` is the same ray in every reconstruction), so it is a plain lerp with nothing to match:
disparity, the offset in master pixels, the scale byte in log space, nlerp on the rotation,
each interpolated in the space the bake stored it in. It looked bad. Two independent fits
disagree about a surface in ways that are individually tiny and collectively **incoherent**,
so the midpoint is not a room halfway between two rooms — it is 1.2M splats each taking its
own short wrong path, and the eye reads the whole window as boiling. That is not fixable by
easing it differently: the interpolant is wrong, not its schedule. A lerp assumes the
in-between states mean something, and between two independent least-squares solutions they do
not.

So: **fade the room down, swap everything at the bottom, fade it back up.** The swap is
invisible because there is nothing on screen to see it happen to, it costs one uniform and no
second set of texture units, and it cannot boil.

**Two sign errors lived in that one sentence, and both looked like a broken feature rather
than a mis-tuned one.** They are worth naming because neither is visible in the code without
evaluating it at the endpoints.

The first was the ramp's *polarity*. `uDim` was driven by a triangle that read 0 at both ends
and 1 in the middle — the dip upside down. What that plays is: black on the first frame, the
**old** room fading up to full, a hard cut to the new season at full brightness, a fade down
to black, and a snap back. Two visible steps with the swap sitting in the open between them,
which is the one thing the dip exists to hide. Assert the endpoints by eye: the multiplier
must be **1 when `dip` is 0 or 1, and 0 at 0.5**.

The second was the bottom's *colour*. The clear colour lerped between the two rooms' own
backgrounds on the theory that dipping through them was gentler than dipping through nothing.
It is not gentler. Dimming a splat makes it **translucent before it makes it invisible**, so
a bright clear colour arrives through every surface in the room at once and the objects appear
to light up from inside on the way down — and the base cloud has no measured background entry,
so it falls back to `--room-bg` at 0.95 while every variant sits at 0.10–0.33. Every
transition touching summer day bottomed out on a bright field. `setClear` now takes the same
eased curve as `uDim`, so the room and the ground behind it reach black together.

It also deleted more than it added: no `uColorB`, no `uMix`, no B-slot samplers. The shader
reads four textures, which is fewer than it did before any of this started.

The **draw order** is per-cloud, and it swaps at the bottom with everything else. Order is a
discrete permutation and could not have been interpolated anyway. The existing "sort once,
never again" argument is about the *rig* — it only translates, so every splat's view depth
shifts by the same amount and nothing reorders — and it says nothing about swapping the cloud
underneath it. Two fits disagree about what is behind what.

At most **three clouds stay resident** (`LIVE_CLOUDS`). One would refetch on every change;
two would cover a season switch but not the day/night toggle *inside* a season, which is the
most-used control in the room. Three covers every two-step path through the six states.

### How far the yards actually diverge

The drift the bake prints is a whole-frame median and it hides where the trouble is. Split it
by region — layer A, relative depth against the day build, 2026-09-13:

| variant | interior (p90) | window band (p90) | the string-light strip (p90) |
| --- | --- | --- | --- |
| `fall` | 0.014 | 0.113 | 0.189 |
| `night` | 0.046 | 0.153 | 0.252 |
| `winter` | 0.008 | 0.389 | **0.654** |
| `winter-night` | 0.046 | 0.439 | 0.464 |

**The room is free and the yard is not.** Every master is the same room from the same camera,
so interior geometry agrees to within 1–5%; nothing indoors has ever caused a variant artifact.
The window is where a season is expressed and it is the only part of the frame that genuinely
moves. That is the measurement that ended the colour-only path for seasons — and it is also
why `fall` and `night`, at 0.113 and 0.153, would have been survivable on it. They ship their
own geometry anyway, because a rule with an exception list is a rule someone has to re-derive.

The one artifact this does **not** fix is the **feeder's glow ring**. It is ~160 master px at
8.3 m seen through glazing bars — about 11 grid cells across, the reconstruction's resolution
floor — and at night it is a bright luminous annulus where the day master has a dark recess.
Its own geometry still scores 6.27, the worst region in the frame, and the ring still renders
as a broken C. Softening the halo in the night masters is the lever; the ring inside the
feeder mouth is the subject and should stay. Resolution, not registration.

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

- **Transferring *part* of a variant's geometry along with its colour.** When winter's blur
  was diagnosed, the cheap repair looked obvious: take the variant's `scale` too, so a bulb
  gets its own small Gaussian back while position — and therefore every authored number —
  stays the day build's. Measured on winter-night at the home camera, MAE/255 against its own
  master:

  | transferred with `f_dc` | bulbs strip | window/yard | feeder | interior |
  | --- | --- | --- | --- | --- |
  | nothing (what ships) | 5.86 | 6.17 | 8.22 | 3.46 |
  | `scale` | 8.16 | 8.83 | **41.50** | 3.47 |
  | `scale` + `quat` | 7.74 | 8.59 | 38.61 | 3.47 |
  | `xyz` | 8.43 | 8.19 | 9.99 | 3.42 |
  | `alpha` | 5.85 | 6.11 | 8.05 | 3.46 |
  | everything (own geometry) | **4.86** | **5.58** | **6.27** | 3.64 |

  **Every partial transfer is worse than either whole.** `f_dc` is a blend coefficient, not a
  surface colour — it is fitted so the *overlapping* Gaussians sum to the master — so position,
  scale, rotation and colour are one joint solution to one least-squares problem, and half of
  one solution plus half of another satisfies neither. Lending a variant its own splat sizes on
  the day build's centres puts five times the error on the feeder than leaving it alone. So the
  choice is binary: colour only, or a second full cloud — which is what the build now ships.
  There is no dial between them, and `alpha` is not a loophole: it is within noise, which is
  the same result.

  It is also why a **delta encoding** of a variant's tables against the day build's does not
  pay. The interior barely moves, so most of the difference is ~zero and deflate should eat
  it — measured, 8.14–8.74 MB against 8.49–8.93 raw, a few percent. Two independent fits
  disagree in the low bits *everywhere*, so the delta is small in magnitude and high in
  entropy, which is the one thing deflate cannot help with.

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

### 1. Payload — 11.16 MB for a first load

geom 2.73 + quat 3.06 + shape 2.89 + colour 2.49, against the layered build's 3.10 MB. The
one thing about this build that is worse.

**A visitor arriving in a variant pays more, and only a little more.** Winter night is
13.49 MB: its own four tables plus the base colour raster, which is fetched at open because
it is what "back to day" fades to and skipping it would make the first toggle the slow one.
Its 8.5 MB of *geometry* is not prefetched — see the note at `openGeom` in
`src/scripts/splatRenderer.ts`, which is the whole reason six reconstructions on disk do not
cost a visitor six. Routes, in order:

1. Convert to **SOG** (`playcanvas/sogs`, 15–20× on raw PLY → ~3–4 MB) and read it with
   Spark. The reference implementation needs CUDA (`torchpq`, `cupy`, PLAS) so it will not
   run on the Mac as-is; PLAS is the part we could skip, since our data is already ordered.
2. A coarser grid, trading directly against the push magnification table above.

~~Note the four files carry stable names and no content hash…~~ **Done.** The bake writes a
`version` (a content hash of the four rasters) into the manifest and both the renderer and
`/dev/splat` append it as `?v=`; the manifest itself is fetched with `cache: 'no-cache'`,
which is ~500 bytes against the 11 MB it points at. The harness also moved to `/dev/splat`
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

