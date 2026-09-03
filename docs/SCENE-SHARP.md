> **Superseded, 2026-09-02.** This build flattens SHARP's Gaussians into plates and a
> torn mesh. It does not work, and the reason is structural rather than a tuning problem:
> a torn mesh needs a complete background behind it, and SHARP's second layer is a
> *blurred near-copy* of the first (25.1dB against the master; only 2.23% of the frame
> more than 2/255 disparity behind the front surface), not a background plate. Anything
> below that reads as settled about the back layer is wrong. The build that ships is
> [SCENE-SPLAT.md](SCENE-SPLAT.md), which draws the Gaussians directly. Kept because the
> depth measurements and the excursion budget here are still good, and because the failed
> designs are worth not repeating.

# Building a scene with SHARP

The runbook for the **measured** build. The authored build — SAM masks, an `in_front_of`
graph, LaMa fills, three plates — is still here and still works; its runbook is
[SCENE.md](SCENE.md) and its reasoning is [PIPELINE.md](PIPELINE.md). Nothing below
replaces those files. Switch between the two builds by changing `SCENE` at the bottom of
`src/data/scene.ts`; nothing else in the app knows which one it is looking at.

## What changed, in one paragraph

Both builds answer the same question — *what hides what* — because that is the only hard
problem in turning one painting into a room you can move through. The authored build
answers it with a list: sixteen objects in `art/objects.json`, each stating what it stands
in front of, cut by SAM and backfilled by LaMa. The measured build answers it with
geometry: Apple's SHARP regresses a **two-layer Gaussian scene** from the same master, so
what stands behind the frontmost surface is *rendered* rather than painted, and the cut
becomes a threshold on the depth jump across one mesh quad — applied everywhere, per quad,
by the renderer at run time.

Consequently there is no `objects.json` in this path, no `masks-manual/`, no `fills/`, no
peel order, no `--halo` and no `--feather`. Most of PIPELINE.md's "do not reopen" list is
about tuning an inpainter that no longer runs.

## Prerequisites

`art/room-day-summer.ply`, produced by [apple/ml-sharp](https://github.com/apple/ml-sharp)
from the locked day master. That repo is not a dependency of this one and never enters
`package.json`; run it wherever it is convenient and copy the PLY in. The PLY is 66 MB,
carries the master's own intrinsics, and is committed-half art: it is authorship, no
script can recreate it.

## Stage 1 — bake

```
tools/.venv/bin/python tools/sharp_bake.py \
    --ply art/room-day-summer.ply \
    --master art/room-day-summer.jpg \
    --out-prefix art/build/room-day-summer-sharp
```

About three minutes on an M-series laptop. It writes into the disposable half of `art/`:

| file | what it is |
| --- | --- |
| `-layer1.png`, `-layer1-depth.png` | **front**: the master unchanged, plus SHARP's depth at full 5504×3072 |
| `-layer0.png`, `-layer0-depth.png` | **back**: SHARP's second layer on its own, half resolution |
| `-depth16.png` | the front depth at 16 bits, in stage 0's format, for feeding the older `depth_prep.py` path |
| `-scene.json` | the measurements the renderer needs |

Named `-layerN` so `tools/export.py` — which globs `-layerN.png` and pairs each with its
`-depth.png` — needs no knowledge of where the plates came from.

Three things are worth understanding about what comes out.

**The back layer is SHARP's second layer, taken whole.** `save_ply` flattens
(layer, pixel) and `num_layers` is 2, so the PLY is literally two 768x768 rasters in one
camera frame — a layered depth image, already. Rendered on its own the second one leaves
**0.00% of the frame uncovered**. There is nothing to peel and nothing to invent.

Getting this wrong cost four rounds and is the single most expensive mistake in this
pipeline, so it is worth stating what the wrong version was. It rasterized *everything*
with a `behind = z_front * 1.02 + 0.03` test to "remove the frontmost surface" — which
keeps only the **2.7%** of grid cells where B sits materially behind A and discards the
other 97%. Having discarded it, the plate had to be invented back: the master wherever
nothing was hidden, then a morphological top-hat plus a harmonic fill of the footprints,
then an erosion envelope. Each invention was wrong somewhere and each repair moved the
error rather than removing it — black specks trailing every moving object, smears at the
window, fringes on the fig. It is also exactly why rendering the PLY directly in a splat
viewer looked flawless by comparison: that used both complete layers and peeled nothing.

**Both depth plates share one disparity scale**, taken from the front. Two layers
normalised independently would each be internally sensible and would fail to register with
each other in 3D, which is the one thing a layer stack cannot survive.

**Depth plates are 8-bit.** WebP has no 16-bit mode and PIL does not say so: handed an
`I;16` image it writes a file that reopens as RGB and decodes to noise, measured at mean
error 183/255 against the source. Silent, and invisible until the mesh is built from it.
The plates are therefore written at the precision they will actually ship at, so what is
reviewed offline is what the renderer gets, and `export.py` now refuses anything deeper.

## Stage 2 — export

```
tools/.venv/bin/python tools/export.py \
    --prefix art/build/room-day-summer-sharp --out-dir public/art
```

Four files, 2.16 MB, against the layered build's seven and 3.25 MB. Colour lossy, depth
lossless, for the reason in `export.py`'s docstring. The poster (`room-day-summer.webp`)
is shared with the layered build and is not re-exported. There is no separate picking
depth: the front layer covers the whole frame, so it doubles as one.

## Stage 3 — wire it up

Copy the numbers from `-scene.json` into the `SHARP` entry in `src/data/scene.ts`. For
this master:

```json
{ "nearZ": 1.1571, "farZ": 98.1845, "fovDeg": 38.728,
  "maxLateralM": 0.1335, "maxPushM": 0.1736 }
```

These are not feel dials. SHARP's output is metric and its intrinsics are in the PLY, so
the room really is 1.16 m to 98 m deep and the lens really is 38.7°. The layered build
assumed 1 to 6 and 42°, and a true depth ratio of 85 against an assumed 6 is exactly why
the yard used to slide with the wall as the camera moved.

`maxLateralM` and `maxPushM` are ported from ml-sharp's own preview-video budget
(`src/sharp/utils/camera.py`, `compute_max_offset`). The idea is to size camera motion in
*screen* terms and solve for metres: allow the nearest content to sweep 8% of the image
diagonal, and the metres follow from that point's own distance. Ambient motion here peaks
at `parallax + drift` = 0.042 m against that 0.134 m budget — about a third of the way to
where two layers stop having an answer, which is the right side of it to be on.

## The cut

`edgeCut` on the front layer, in `src/data/scene.ts`. It is the disparity range across one
mesh quad above which that quad is treated as bridging a silhouette.

**A bridging quad is snapped forward, not dropped.** It keeps its texture coordinates and
all four of its vertices move to the near side's depth. This costs exactly nothing at rest:
at the home camera every vertex lies on the ray through its own pixel, so moving it along
that ray does not move where it lands, and the frame is still the master pixel for pixel.
It only matters once the camera moves, and then the flap travels with the foreground it
belongs to while the gap opens *behind* it, where layer 0 is waiting.

Both earlier attempts were worse, and worth recording because both looked principled:

- **A per-vertex `vStretch` varying, discarded in the fragment shader.** Interpolating it
  is the bug: across the bridging quad the value runs from huge at the near vertex to zero
  at the far one, so a sliver of stretched foreground survives welded to the background
  side — a comb of spikes along every silhouette that grows with camera motion — while the
  same ramp eats most of the object's own last quad from the other side.
- **Dropping the bridging quads from the index buffer.** Exact per-quad, no interpolation,
  and still wrong, because a bridging quad *is not wrong at home*. Removing it removes
  something correct: 1.81% of quads dropped left **2.9% of the frame as an open hole with
  the camera perfectly still**, showing the half-resolution peeled plate through a
  seven-pixel comb around every object. It read as a tearing artifact and was a hole.

The residual artifact is bounded by the grid: under motion an object's silhouette is
dilated by up to one quad (7 master px at the default 1024 columns) of background-coloured
texels riding at foreground depth. `/dev/room?grid=2048` halves it at 4x the vertices.

| threshold | front quads snapped |
| --- | --- |
| 0.02 | 2.63% |
| 0.04 | 1.81% |
| 0.08 | 1.55% |

At the 1024-column grid's own 7 px sample spacing, smooth surface sits at 0.012 (p95) and
silhouettes at 0.098 (p98). 0.04 is in the middle of that gap.

**Every layer gets this, including layer 0.** The rule that the backstop must never tear
is about *dropping* quads; snapping drops nothing — it moves four vertices along their own
rays, which cannot open a hole. Leaving layer 0 whole makes it a plain single-mesh renderer
with every smear that implies, and those smears are precisely what shows through the front
layer's gaps. On this master that was worst at the window, where layer 0 carries the same
2 m to 98 m cliff at every glazing bar.

## Settled here

- **The window needs no special case.** The layered build flattens it (`op: fill` in
  `objects.json`) and the stated reason is not the one in CLAUDE.md's do-not-reopen list:
  Depth Anything *did* see through the glass on this master, returning the yard bimodally
  at 32–39 against mullions and wall at 81. It was flattened because that 48-level cliff
  sat "inside the one mesh that is never cut", so every glazing bar became a stretched
  triangle. A mesh that tears has no such problem, and real depth behind the glass is what
  stops the yard sliding with the wall. Do not clip it: `--far-clip` defaults to 0, and
  the theory that a 100 m yard crushes the room's range is refuted by disparity being 1/z
   — the room under 8 m still keeps 220 of 255 levels.
- **The back plate looks alarming as a picture and is sound where it is used.** Peeling
  the front surface off leaves ragged boundaries where SHARP's hidden layer runs out, soft
  detail from its 768×768 grid, and dark smears where an object stood. Measured: 1.65% of
  the frame is spuriously dark, and only 10.5% of *that* lies within the ±8 px band a tear
  can reveal — 0.17% of the frame. Inside that band the plate is 86% real hidden geometry
  and 14% master fallback. It is never viewed as a picture; it is viewed through slivers.
- **Do not ship the Gaussians.** Measured: 1.16M primitives at 46 fps on a fast Mac, 10.5
  MB gzipped after pruning against 2.40 MB of plates, and a colour cap of SHARP's internal
  768×768 against the 5504×3072 master. WebGL2 cannot do the tile-based early termination
  that makes this cheap on Apple's own hardware, because fixed-function blending cannot
  stop when transmittance runs out. Harvest it offline; ship images.
- **Do not prune SHARP's layer 1 by "distance behind layer 0".** Keeping it only where it
  sits more than 5 cm back drops 41% of the Gaussians and looked free under a normalising
  rasterizer. Under honest alpha compositing those near-coincident Gaussians carry real
  coverage, and removing them opens black speckle across the whole frame. The measurement
  that said otherwise was measuring `acc/wsum`, which fills any pixel receiving any
  contribution at all.
- **SHARP gets the feeder post wrong**, splitting it across two depth levels. The
  authored build could correct that in `depth_fix.py`; this one has nowhere to put it
  short of editing the depth plate by hand. Live with it or regenerate the master.
