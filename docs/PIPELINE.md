# Asset pipeline

Why a generated master becomes the files the browser loads *this particular way*. The
commands themselves are not here — they are in [SCENE.md](SCENE.md), and they are there
once. This file is what you read when a result looks wrong or before changing a stage.

| Doc                      | Answers                                   |
| ------------------------ | ----------------------------------------- |
| [PLAN.md](PLAN.md)       | _why_ the site is built this way          |
| [PROMPTS.md](PROMPTS.md) | _what to type_ into the image generator   |
| [SCENE.md](SCENE.md)     | _what to run_, start to finish            |
| **PIPELINE.md** (this)   | _why the runbook is shaped the way it is_ |

---

## Where the commands are

**[SCENE.md](SCENE.md) is the runbook** — setup, the seven commands, what to look at, how
to start over, how to re-run for a new master. This file is the *why*: read it when a
result looks wrong, or before changing how a stage works.

Two rules that the runbook states and this file justifies:

- Offline authoring tools, **not site dependencies.** Nothing in `tools/` enters
  `package.json`; the browser loads plain images. CLAUDE.md's zero-dependency bias governs
  what ships, not what builds.
- Only four inputs are hand-authored: the master, `art/objects.json`, `art/masks-manual/`
  and `art/fills/`. Everything else is derived, lives under `art/build/`, is gitignored,
  and can be deleted at any time — the split is drawn there precisely so that
  "can I delete this?" never needs thinking about.

`$S` and `$B` below are the two path variables SCENE.md sets: `$S` is the master you were
given (`art/<name>`), `$B` is everything derived from it (`art/build/<name>`).

### The segmentation model

SAM 2.1 (`facebook/sam2.1-hiera-large`), prompted, through `transformers`. Two results
worth not re-deriving:

**HQ-SAM is the model this problem asks for, and its `transformers` 5.16.1 integration is
broken.** It exists precisely for thin structure and boundary precision. But
`syscv-community/sam-hq-vit-huge` loads with zero missing keys and then returns **26% of
the frame at a claimed IoU of 0.982** for a single positive click on the speaker,
against 0.6% from both SAM 1 and SAM 2.1 on the same click. Both `hq_token_only` paths do
it. Reaching a working HQ means the separate `segment-anything-hq` package and its own
weights. Re-test it when transformers moves; do not assume it is the harness.

**A box beats points on anything large and cluttered.** The desk is the case: seven
positives and three negatives score 0.739 and lose the left leg; the bounding box alone
scores 0.862 and takes the slab and both legs. This is why the desk stopped being four
hand-drawn polygons. Boxes and points combine, and one negative click still handles the
chair the box swallows. Points remain right for small objects and for separating one
thing from a group.

**No segmenter fixes a plant, and neither does resolution.** SAM 1-huge and SAM 2.1 score
the same on the corner plant (2.47% vs 2.01% area, 62.3% vs 62.1% foliage purity). Both
decode the mask at 256×256 and upsample, so a 3px leaf gap is sub-pixel in that grid. The
same crop re-run at 1×, 3× and 6× returns 69.3 / 69.3 / 68.7% purity — more pixels buy
nothing, because the limit is the decoder, not the image. **Alpha matting is the fix**, and
it is applied to `open_frame` objects only: ViTMatte over a trimap built from the SAM mask,
thresholded back to binary. 62.1% → 67.0% on the corner plant. It runs on a **crop** around
the boundary, never the whole frame: ViTMatte's backbone has global attention layers, so
cost is quadratic in pixels and the 5504×3072 master asked for a 97 GiB buffer. The crop is
also strictly better — the model has no use for pixels far from the boundary, and it puts
more real resolution on the foliage than the full frame ever could.

Even so, the fix that stuck was in the art: the fine-frond plant that used to stand in
that corner was replaced in the prompt by a rubber plant — broad solid leaves, no
sub-pixel structure, nothing for a 256×256 decoder to lose. Fixing the art is cheaper
than fixing the matte, and PROMPTS.md is where that decision lives.

Bigger is not automatically better with fixed prompts: two click points that gave SAM 1
`vit_b` the whole wall shelf give both huge models the *books* alone, because a larger
model returns a tighter, more confident object for the same click. Re-pick after changing
model, in `pick.py`, where you can see it.

### The depth model

`depth.py` runs Depth Anything V2-Large locally through the stock `transformers`
depth-estimation pipeline. It replaced a manual upload to the HF demo space for two
reasons beyond convenience: the space fixes the model version to whatever it happens to
serve, and it quantises its "16-bit raw" export — the same image came back with **365
distinct depth levels** from the space and **58 424** run locally.

Depth Anything **V3** needs ByteDance's own `depth_anything_3` package, so it is a
dependency change rather than a `--model` string. Worth taking when the master is
regenerated; it does not fix a compositing artifact, which is a different row of the table
below.

---

## Four problems that look like one

The camera push has several distinct failure modes. They were conflated for a while and
that wasted effort, so they are named separately here. **Each has its own fix, and no fix
helps with any other row.**

| Symptom                                       | Actual cause                                    | Fix                                    |
| --------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| Smearing / rubber-sheeting at silhouettes     | disocclusion — surface the art never painted    | **layers + inpainting** (this doc)     |
| Silhouettes wobble, edges ramp instead of cut | soft depth edges in the model output            | guided filter against the colour image |
| Objects sit at the wrong distance             | monocular depth guesses semantics wrong         | authored depth corrections             |
| Everything goes soft near the end of a push   | source resolution, magnified past native        | 4K master                              |
| Arrival at an object never looks right        | the information is not in the image at any scale | cross-fade to a close-up plate at ~70%  |

**Resolution does not fix smearing.** Smearing is geometric — the mesh is asked for surface
that was never painted. A 4K master gives sharper smears.

The constraint that makes all of this work: **cap the excursion.** Lateral camera motion is
the only motion that produces real parallax, and it is also the only motion that produces
disocclusion — they are the same motion, so there is no parameter setting that gets one
without the other. Layers buy a larger honest budget; they do not buy an unlimited one.

---

## What a layer is for

**Layers separate objects that _occlude_ each other — not objects that merely differ in
depth.** Every layer is a displaced mesh, so one layer already holds many depths correctly.
The chair earns its own layer because it hides desk pixels that have to exist underneath
it; the keyboard does not, because nothing needs to be revealed from behind it.

Two rules follow, and both are load-bearing:

**1. The shell is never cut.** Walls, floor, ceiling and the window plane are one
continuous connected surface and stay whole. Slicing a continuous surface puts a seam where
there is no occlusion boundary, and the moment the camera moves laterally the two halves
slide apart and open a crack — a manufactured artifact worse than the one being fixed.
There is no global depth threshold anywhere in this pipeline.

**2. Within a layer, the mesh is cut at alpha boundaries.** Separate objects in the same
layer must not be connected by triangles, or they stretch between each other exactly as a
single mesh does.

**Layers are occlusion rank, never depth range.** The 3D printer reads *farther* (0.33)
than the cabinet it stands on (0.49) — it sits at the back of the cabinet top, near the
window. Grouping by depth value therefore puts printer and cabinet in the same layer,
leaves no cut between them, and smears across a 0.16 jump. Measured, on this master:

| boundary            | in front | behind | gap       |
| ------------------- | -------- | ------ | --------- |
| printer ↔ cabinet   | 0.494    | 0.333  | **0.161** |
| monitors ↔ desk     | 0.473    | 0.298  | **0.175** |
| robot ↔ cabinet     | 0.286    | 0.176  | **0.110** |

Rank instead:

```
rank(shell) = 0                      the shell hides nothing
rank(A)     = 1 + max rank of what A hides
```

The count is the longest occlusion chain, not the object count. Objects that never
overlap share a plate however far apart they are — the foreground plant and the monitors
sit together quite happily, because each is its own alpha island and the mesh is cut
between them. For this master that is three:

| Layer | Contents                                                                                     | %frame | Alpha | Inpainted behind |
| ----- | -------------------------------------------------------------------------------------------- | ------ | ----- | ---------------- |
| 0     | the shell — walls, floor, ceiling, window plane                                               | 71.4   | no    | yes              |
| 1     | cabinet, desk, foreground plant, floor lamp, guitar, wall shelf                                | 17.1   | yes   | yes              |
| 2     | 3D printer, robot, speaker, monitors ×2, desk lamp, office chair, rubber plant                 | 11.5   | yes   | —                |
| yard  | separate quad behind the glass, for the seasonal swap                                          | —      | no    | n/a              |

Layer 1 is furniture and wall-mounted things; layer 2 is what stands on them.

---

## The only hand-authored file

`art/objects.json` lists **every object that hides another object.** Each needs a mask so
the mesh can be cut at its silhouette and the surface behind it inpainted. Anything that
hides nothing needs no entry — the framed picture is flat on the wall, the keyboard lies
on the desk. Fifteen entries for this master.

```json
{ "name": "3d-printer",
  "in_front_of": ["cabinet"],
  "points":   [[0.335, 0.655], [0.322, 0.55], [0.355, 0.60]],
  "negative": [[0.27, 0.50], [0.41, 0.48], [0.30, 0.72]] }
```

`points` say *where* (SAM prompts), `in_front_of` says *what it hides*, and an optional
`op` corrects the distance where monocular depth is semantically wrong (three objects: the
chair, the corner plant, the shelf, plus the window plane).

**Depth corrections are relief-preserving.** They move an object; they never replace it
with one number. The first version did replace, and it was visibly wrong: flattening the
the corner plant turned every leaf into a card, and it and the shelf above it landed on the
*identical* value (51/255), reading as two cut-outs at one distance. `stand` shifts the
whole mask so its base meets the floor beneath it; `flatten` compresses relief toward the
median by `relief` (0.25) rather than deleting it, which takes the shelf's pothos from
85/255 in front of its own board down to 21 while the leaves keep their shape; `fill`
solves for the smoothest surface meeting the region border, and **writes back only outside
other masks** — the window rectangle contains the foreground plant, and painting the wall
plane across 29% of it cut the plant in half. Normalised 0–1 so they survive re-export at
another size, mapped by eye against the locked master — the same discipline as hotspot
rects. Every entry carries a `why`.

**`in_front_of` is authored, not inferred.** Deriving it from the depth map was built and
measured, and it does not survive contact: an object standing on a surface shares a long
boundary with it where nothing is hidden, and that contact edge outvotes the short
silhouette edge that matters. The floor came back "occluding" the cabinet on evidence of
26 against a real silhouette, and the shell fell out of the back layer. Restricting the
vote to abrupt steps helped and still lost the speaker and the right monitor.
"The speaker stands on the cabinet" is a stable fact about a locked image, cheap to
state and trivial to check — so it is stated once. `assign.py` still measures the depth
evidence and warns wherever it disagrees with what was authored. It currently disagrees
nowhere.

---

## The stages

Seven tools, one per stage, each reading files and writing files. There is no state
between them, so any stage can be re-run alone once the ones above it have run — which is
what makes `rm -rf art/build` cheap.

```
      AUTHORED                        DERIVED  (all of it under art/build/)
 ──────────────────────────────────────────────────────────────────────────────
 colour master ─┬──► 0. depth ─────► depth 16-bit
                │                        │
                ├────────────────────────┴──► 1. depth_prep ─► depth8
                │                                                 │
 objects.json ──┼──► 2. segment ──► one mask per object           │
 masks-manual/ ─┘         │  SAM 2.1, PROMPTED - never automatic   │
                          │  + ViTMatte where open_frame is set    │
                          ▼                                        │
                     3. depth_fix ◄─────────────────────────────────┘
                          │  applies the `op` on an entry: flatten | fill | stand
                          ▼         ─► depth8-fixed
                     4. assign ─► one mask per occlusion rank, + _layers.json
                          │  ranks the authored in_front_of graph. NOT depth range.
                          ▼
 fills/ ───────────► 5. inpaint   colour → LaMa, peeled one object at a time
                          │       depth  → harmonic interpolation
                          │  cumulative, back to front; only hole pixels are ever taken
                          ▼         ─► layer{N}, layer{N}-depth, layer{N}-hole
                     6. export ─► public/art/*.webp   ← the only thing the site loads
```

### 1 — `depth_prep.py`

Rescale the 16-bit raw by its own min/max (it is relative and un-normalised; see
[art/README.md](../art/README.md)), median-blur the speckle, then **guided-filter with the
colour image as the guide** so depth edges snap onto painted edges. A soft depth edge is a
separate artifact from disocclusion: it turns a clean cut into a smeared ramp.

### 2 — `segment.py`

Prompted SAM, one mask per entry in `objects.json`. It handles exactly this scene's hard
cases: a mesh chair back you can see the floor through, a five-spoke base, an open printer
frame against a blown-out window, the thin leaf gaps of a houseplant. Fourteen came back usable on
the first pass; the cabinet and the desk needed two extra click points each.

Entries with `polygons` are rasterised directly, for regions SAM has no single object to
grab — currently just the window.

**Enclosed holes are closed, unless the object is marked `open_frame`.** See stage 5 for
why the two cases are opposite and why nothing tries to infer which is which.

**Automatic mode is not used.** It was tried: at default settings it covered 32% of the
frame and missed the desk, the chair, the printer and the floor outright, so the graph
built on it had nothing to connect. Denser sampling is a slow guess on CPU — SAM's
coordinate transform is float64, which MPS rejects — and prompted mode is both the
reliable mode and cheap at this object count.

### 3 — `depth_fix.py`

Each exception object's pixels are set to its authored depth. SAM gives the shape; the JSON
gives the distance. This is where the chair stops reading at desk depth. The window uses
`fill` instead — interpolate inward from the border — so the glass returns as the receding
wall plane rather than a constant. Corrected borders are feathered so a correction does not
introduce a step edge of its own.

**Check the spread, not just the median.** An object whose depth histogram is *bimodal* is
one the model has split in half, and the median hides it completely. The wall shelf came
back as 4485px of board at 48–63 and 4098px of trailing pothos at 128–143 — the vine
placed ~85/255 in front of the shelf it hangs from, so the leaves swam off the board
whenever the camera moved, while the object's median looked entirely reasonable. `flatten`
is the right op there rather than `set`: a wall shelf really is one flat thing against the
wall, and the median is already the board's own value.

This is a different failure from a wrong distance, and it is the one to look for when a
single object appears to come apart in motion rather than move to the wrong place.

**`stand` beats a constant picked by eye, and beats the depth model too.** A hand-authored
depth is only as good as the eye that chose it, and the eye is bad at this. The corner
plant was set to 0.56 on the reasoning that it stands beside the cabinet; the floor directly
under its pot reads **0.20**, because it is in the far corner, not beside the cabinet's
near end. 90/255 too near — it parallaxed like a foreground prop while plainly reading as
distant, which is exactly how it was reported.

The floor is the one surface in this scene whose depth a monocular model gets reliably
right: large, continuous, textured, perspective cues throughout. Where an object meets it
is therefore a physical anchor, free to read. `op: "stand"` takes the median floor depth in
a strip just below the mask, excluding other props. Measured against it, most objects lean
*too far*: desk −65, chair −24, cabinet −17. The corner plant was the only one badly too near,
and the only one anyone noticed — a reminder that the error that matters is the one
inconsistent with its neighbours, not the largest one.

**Prefer an anchor to an opinion.** This is the general form of the rule, and it is why a
better depth model is not the answer to a wrong distance: a model states an opinion about
an object, while the floor states a fact about the room.

### 4 — `assign.py`

Ranks the authored `in_front_of` graph and writes one mask per rank. Two details are
load-bearing:

**Overlapping SAM masks resolve to the smaller mask, never to the nearer one.** Resolving
by depth hands the printer's own pixels to the cabinet, for the same reason depth cannot
choose layers. The thing standing on a surface is always smaller than the surface.

**An enclosed unclaimed island joins the object around it, unless depth says it is a
see-through gap.** The keyboard, mousepad and headphones carry no mask of their own — they
hide nothing — so they land in the shell and then vanish behind the desk drawn in front of
them. The gaps between the plant's leaves and through the printer's open frame look
identical topologically and must stay in the shell. Depth separates them, and this is a
comparison monocular depth is reliable at: local, and between neighbours.

**Everything unclaimed is the shell** — 71.4% of this frame. No thresholding of it, ever;
see rule 1 above.

### 5 — inpainting

Cumulative, back to front:

```
master  ──near──► plate1 ──mid──► plate2   (= the far shell, opaque, complete)
depth   ──near──► dplate1 ──mid──► dplate2
```

**Colour → LaMa, for now.** [LaMa](https://arxiv.org/abs/2109.07161) offline, via
[simple-lama-inpainting](https://github.com/enesmsahin/simple-lama-inpainting) — the
`big-lama` TorchScript weights and nothing else. IOPaint was the first choice and pins a
Pillow version that will not build on Python 3.13; it also ships a web server and a model
zoo we have no use for. LaMa is free, local, deterministic and strongest at texture
continuation, which keeps the whole chain reproducible from the master by one command.

**Depth → interpolation, never a generator.** LaMa is trained on natural images, so depth
is off-distribution and it can hallucinate texture into what must be a smooth gradient.
Depth behind an object is plain floor or wall.

For the small holes behind objects, Telea (`cv2.inpaint`) is fine. For a *large* region —
the window plane, 29% of the frame — it is not: Telea marches inward along the distance
transform, so it comes back streaked and lumpy. Measured against a best-fit plane the
window deviated by a mean of 22/255 and a max of 110. That is not a window, it is terrain,
and since depth is what the mesh is built from, it became real geometry: the mullions
rippled as the camera moved. Stage 3's `fill` op solves Laplace's equation instead —
the smoothest field agreeing with the region's border — which takes the residual to 8/255,
the remainder being that the polygon legitimately spans two walls.

**Paint wide, keep narrow.** What the inpainter is asked to fill and what is taken from
its answer are two different regions, and conflating them put 6.4% of the frame visibly
wrong. `--halo` widens the *painted* region so the model cannot read the object's own
contact shadow as context. `--keep` narrows the *kept* region to just inside the
silhouette, so every replaced pixel lies under the alpha of the layer that covers it.
Keeping the whole dilated hole blanks a 12px ring of genuine background around every
object — and at the home camera nothing is drawn over that ring, so it is on screen before
the visitor has moved.

**Depth owes nothing to the at-rest frame.** At the reference viewpoint every depth value
reprojects to the same pixel, so rewriting depth is invisible until the camera moves.
That asymmetry with colour is worth exploiting twice:

- *Depth fills cover the whole dilated hole, not the eroded keep.* The depth model blends
  across silhouettes, so master depth within a few px of a removed object still carries
  the object. Kept, it left a ridge of chair-depth rug around every hole that warped the
  revealed fill in motion — measured at p99 36/255 of depth jump in the ring around
  removed objects, now 3.5/255.
- *Each cut layer's silhouette depth is rebuilt from its interior* (`--depth-pad`). The
  same soft edges put blended object-to-background values inside the visible silhouette,
  and background depth right outside it — a cliff under the visible edge, which is the
  single-mesh smear reintroduced per layer. Stage 5 erodes the alpha by a 3px trust
  radius, then propagates the nearest interior depth outward across the boundary and
  `depth-pad` (8px) beyond it, so the silhouette moves rigidly with the object and the
  cliff lands where alpha is zero and every stretched fragment is discarded. Propagation
  is nearest-neighbour, not grayscale dilation — dilation takes the *max* over its disc,
  which on a sloped surface like the desk slab cuts a seam at the trust boundary.
  Visible-edge depth jumps: layer 1 p99 32 → 17, layer 2 p99 27 → 8.5.

**Alpha is the mask exactly, and `keep` is the same region.** Both used to erode inward —
alpha by 1px to stop the object's outermost texels (already blended with the background
they were painted against) showing as a fringe, `keep` by 2px to protect the at-rest
tiling. Each is defensible alone; together they opened a gap that anything thinner than
their sum fell through, dropped from its own layer *and* left behind in the shell.
**5.1% of all object area, in 1804 fragments**, stayed nailed to the wall while its object
moved: the plant's leaf tips, the chair's mesh and spokes.

Erosion cannot be the answer for a structure that is *entirely* boundary. So neither
erodes: every object pixel is blanked from the shell by exactly the layer that draws it,
which makes at-rest exact by construction rather than by tuning (0.00/255).

**Then a binary mask ran out of road, and alpha became fractional.** Not eroding fixed
the fragments, but it did not fix the edge, and it could not: a mask boundary has to be
placed *somewhere* inside a silhouette that is genuinely several px of blend, and
whatever is left on the far side is wrong. Measured on this master, **60% of the first
ring outside the masks was still object-coloured, and still 39% eight px out** — object
sitting in the plate behind, staying put while the object moved. That is the ghost
outline around everything, and it is not a mask-quality problem. No better mask removes
it, because the true answer at those pixels is not a side, it is a fraction. SAM was
never the limit here; binary was.

So solve the compositing equation instead. `M = a*F + (1-a)*B`, and both B and F are
already known — B is the surface behind this layer, which exists because layers are built
back to front, and F is the nearest interior colour. Alpha is the projection of `M-B` on
`F-B`; the unmixed foreground follows by inverting the same equation, and must be
recovered rather than reusing the master's blended pixel, or the background it was
painted against gets counted twice. Thin structure is the case this exists for: a frond
tip two texels wide has no interior to round to, so it travels at half weight instead of
being dropped or doubled. Ghost content in the ring: **60% → 16%**, which is the fill's
own noise floor.

**Alpha needs a floor, and the floor is not a fudge.** The projection assumes every band
pixel is a mix of F and B, and a *contact shadow is neither*: under the cabinet the master
is darker than the floor and darker than the cabinet, so `M-B` points away from `F-B`, the
projection returns 0, and the pixel is left transparent over a background already blanked.
That one mechanism was the entire 1.00% at-rest error when matting first went in, and it
sat exactly along the lines where things meet the floor. The fix is to take the least
opacity at which the layer can still reproduce the master over the background it will
actually be composited against — `F' = B + (M-B)/a` staying in gamut bounds `a` from below
directly. Where master and background already agree the floor is 0 and the pixel stays
transparent. Where they disagree, the layer is *obliged* to carry the difference, so
at-rest exactness stops depending on the inpainter having been right.

**A bad fill is now paid for in motion, not at rest.** The alpha floor makes at-rest
exactness independent of inpaint quality — which is a real gain, but it does not make the
fill error disappear, it *relocates* it. Where the fill disagrees with the master, the
floor forces alpha up, and the layer carries an opaque patch of correction that then
travels with the object. That is the halo visible around the corner plant in solo view.
Measured in the feather ring, the fill's error is mean **30.6/255, p90 74** — so fill
quality now converts almost directly into halo strength, and it is the single largest
remaining lever. Note also what the layers hold: layer 1 is 17.6% real object and **12.1%
opaque margin band**, 0.69x its own area, every pixel of it inpainter output that is
invisible at rest and is the *first* thing a moving camera reveals.

`--feather` is 6px. The measurement says where to stop: ghost content is flat at ~16-19%
right across the band and jumps back to 39% outside it, so 6px covers this art's blend
width. Raising it further would only start dragging contact shadows along with objects,
and a shadow belongs to the floor.

**An enclosed hole in a mask means one of two opposite things.** In a solid object it is a
segmentation defect and its pixels belong to the object; left open, the layer draws
nothing there and that patch stays stuck to the wall — the pass-through in the middle of
the chair seat, where SAM lost 342px to a highlight on the upholstery. In an object with
an open frame the identical hole is *correct*: the yard really is visible through the 3D
printer's gantry and really should stay put when the printer moves. Same shape, same
statistics, opposite handling — so `open_frame` in `objects.json` states which, and
nothing tries to infer it. Four of sixteen objects carry it (printer, both plants, the
shelf's trailing vine); the rest are filled, which recovered 1029px.

**The layers must tile the frame at rest.** Composited at the home camera they have to
reproduce the master exactly, because that is where the reconstruction reprojects to the
original art pixel for pixel. Stage 5 now checks it and prints the residual (currently
mean 0.01/255, 0.00% badly wrong). It catches the whole class of bug where the layers
leave a gap — a fill kept too wide, an alpha eroded too far, a mask missing from
`objects.json` — none of which showed up in any per-stage log line.

**The z-buffer never arbitrates between layers.** The render-side half of the same
contract. Layers are occlusion rank precisely because depth values give the wrong order —
the printer reads *farther* than the cabinet it stands on — so letting layer draws share
one depth buffer re-imposes exactly the ordering the cut rejects: any object that reads
farther than the fill painted behind it fails the depth test and the fill shows through
its middle. Measured at 6% of the frame, at rest, sitting squarely on the objects
occlusion rank exists for (guitar, printer, robot vacuum). The renderer clears the depth
buffer between layers: painter's order decides across layers, z only within one, where it
still catches a heightfield folding over itself off-axis.

**Feed the inpainter dilated masks** (`--halo`, 12px). Undilated, it reads the object's own
contact shadow and anti-aliased rim as valid context and faithfully continues them inward.
That is what a "ghost of the object" actually is, and it is a mask-coverage problem, not a
model-capacity one — the two are easy to confuse and were confused here for a whole pass.

**Fill the whole hole, and look at the plate.** An earlier version painted only a `margin`-
wide rim just inside each silhouette, arguing that a capped excursion never reveals the
interior. Two things were wrong with it.

*It saved nothing.* `inpaint.py` now measures the share of each hole a `margin` excursion
can uncover: **95.1%** for the shell, 97.3% for layer 1. The occluders here are thin — a
chair's spokes, a plant's fronds, an open printer frame, a desk slab — so almost no pixel
is more than 32px from an edge. The rim was painting nearly the whole hole anyway, in a
worse shape, with less context.

*It destroyed reviewability.* Leaving every object's interior in the plate meant the shell
plate never looked like an empty room, so nothing about it could be judged by eye — and
two badly broken masks (the guitar leaked down the entire right wall; the desk came back
with 2107 interior holes and its top edge up on the wall) survived a full pass unnoticed.
A filled hole makes a bad mask obvious at a glance. Stage 5 now writes
`$B-shell-review.png`: master, shell plate, and the plate with never-revealed pixels
greyed out.

**`--margin` is the excursion budget**, stated in pixels. It sets how far a layer's alpha
is extended underneath the layers in front of it; uncover more than that at render time
and a hard alpha edge shows. It is the one number the renderer and the pipeline must agree
on. Now that the whole hole is filled, raising it is free — the band just keeps more of a
fill that already exists — so it is 64, set by the deepest camera move rather than by
inpainting cost.

**The inpainter is a swappable stage.** It was a generator for a while, on the reasoning
below; peeling (further down) since made LaMa good enough that a made fill is now the
exception. The reasoning is kept because the *comparison* is what matters, not the winner
of one round.

LaMa is a texture-continuation model — it cannot reason "this is a rug under a window
grid, continue the grid". Handed the whole hole it invented two star-shaped artefacts
where the chair's base was and a phantom plank under the desk. One Gemini pass — *edit
this image, remove the furniture, change nothing else* — returned a genuinely empty room,
including the part of the yard the cabinet had hidden.

That framing had a flaw worth naming, because it cost two rounds of generation: a
generator asked to remove the furniture removes the *light the furniture casts* with it.
Every object we take out is still in the composed scene in a nearer layer, still lighting
the surface behind it, so what comes back is a genuinely empty room where what is wanted
is this room with the objects lifted straight up off it. Measured against the master
outside the hole, where the two must agree, two successive Gemini plates were 21.3 and
23.2 levels RMS out at low frequency — the monitors' glow and the cabinet's shadow simply
gone. Prompting for it explicitly did not fix it. LaMa cannot make that mistake: it
continues what is there.

The old objection, that a generator "repaints the whole frame and has to re-pass a
registration diff", does not survive contact with the compositing rule: only masked pixels
are ever taken, so whatever it did to the rest of the frame is discarded. Measured on the
actual return, the frame outside the hole matched the master to a mean of 3–6/255 across
the window frame, the picture, the wall corner and the ceiling. It is not perfect — the
right-hand skirting drifted badly (88.7% of pixels >20 apart) because the desk had hidden
it, so the generator invented its height — but drift only matters where it crosses the
hole boundary.

It also disobeys. Asked to remove the furniture and add nothing, it removed the guitar
and hung a lit wall sconce in its place — *inside* the hole, where compositing keeps
whatever it drew. Outside the hole the rule protects registration automatically; inside
it the fill is trusted, so the fill must be reviewed against the hole mask before use. An
invented object over plain wall is a quick local fix — LaMa over that patch of the fill
file — not a reason to regenerate.

**The fill is anchored to the master at the hole boundary. This reverses an earlier
decision, on measurement.** A `--tone-sigma` pass once spread the master-vs-fill
difference into the hole by normalised convolution and was removed as code that makes a
bad input survivable — the argument being that a generator asked to *edit* the master has
already failed if the exposure moved. Two things were then measured on the 5504px master
and both cut against that.

*The error is not exposure.* Comparing the plate to the master outside the hole, where
they are supposed to be identical, gives 21 levels RMS. Fitting a per-channel gain and
offset on those same pixels takes it from 20.1 to 18.8 — a global correction explains
almost none of it. Split by spatial frequency it is 21.3 above ~64px against 9.3 below:
lighting, not detail. Per screen block it is 83 levels on the floor behind the cabinet and
43 on the wall behind the monitors, and the reason is structural rather than sloppy — the
generator removed the cabinet, so it removed the cabinet's shadow; it removed the
monitors, so it removed their glow. Every object we take out is still in the composed
scene in a nearer layer, still lighting the surface behind it, so the brief asks the
generator for something no generator does reliably across 47% of a frame.

*A blur and a boundary condition are not the same operation.* Normalised convolution
smears the residual across the hole edge, which is why it left "a hard blobby step along
the mask outline" — it softens the seam without removing it. Solving Laplace's equation
with the residual as Dirichlet data on a ring of real master pixels makes the correction
*equal* the residual at the edge, so the step is zero by construction, at any fill
quality. That is the photometric form of the rule that already makes registration
unbreakable: never take an inpainter's output whole, only what is inside the mask,
referenced to the master. Measured across every silhouette, the colour step went 8.71 →
3.45 levels.

The old rule survives where it was actually right. The anchor fixes *level*; it is a
membrane and has no detail of its own, so an invented object, a wall in the wrong place,
or a shadow edge missing from the middle of a large hole is still a fill to regenerate.
`--no-anchor` shows the plate raw.

**A good filler buys tolerance for imperfect masks** — `--halo` can be raised when the
fill is convincing, because every extra pixel is one the filler paints rather than one it
invents. But that trade has a hard limit in the other direction, and it is not about
masks: **widening the halo scrubs off cast shadows and then eats geometry.** Measured on
the guitar, at 64px its shadow on the wall survives; at 192px it is gone; at 384px LaMa
loses the room corner. The soft object-shaped tone left on a wall is not a leftover
contour to be chased — it is the shadow of an object that is still in the composed scene,
still casting it. 64px stays.

So stage 5 emits `$B-layer{N}-hole.png` every run, and `--fill-dir` reads back
`art/fills/$NAME-layer{N}-fill.png` if present. Layers without one use peeled LaMa, the
default path now — the chain runs unattended end to end and needs no generator at all.
Make a fill only for what the review actually shows wrong, which on this master is the
skirting board behind the cabinet and nothing else.

**LaMa's output is composited, never used whole.** The model re-encodes the entire frame;
only its masked pixels are taken, so everything outside the hole stays bit-identical to
the master. That is the property the locked-master discipline depends on.

#### How much does the generator fill actually buy?

Measured on this master, LaMa against the generator's empty room over the same layer-0
hole (51.8% of the frame): mean difference **18/255** inside the hole. But the number is
not the argument — the failure mode is. Two kinds of LaMa error show up, and only one of
them is what it looks like:

- **Leftover-contour errors.** A brown blob on the wall where the guitar's mask was a few
  pixels short; a pale smear under the desk. These are *mask* failures, and a better mask
  or a wider `--halo` fixes them. If this were all of it, LaMa would be enough.
- **Structural invention.** LaMa continued the window straight through the room corner —
  the wall/wall junction and the floor line simply do not exist in its output. That is not
  a leftover contour and no mask fixes it. LaMa continues texture; it has no notion that a
  room has a corner, and 52% of the frame is too much hole to infer one from.

#### Peel the objects off one at a time, and most of that goes away

The paragraph above blamed hole *size*, and that was the right diagnosis of the wrong
variable. What actually breaks LaMa is how far a hole pixel sits from real paint, and
handing it the whole layer-0 hole made that distance enormous for no reason: 47% of the
frame gone at once, half of it more than 128px from anything real, the worst point 875px
in. Nothing at that distance still says the wall was warm or that the monitors glowed, so
it returned a wash — and the room corner it "could not infer" was 500px from the nearest
real pixel.

Take the objects off one at a time instead and that distance never gets large. Lift the
printer and it is surrounded by real window and real cabinet top; lift the cabinet and it
is surrounded by real floor, real skirting, and the printer's answer from a moment ago.
Nearest layer first, because that is the order the room actually uncovers. `lama_peel()`
does exactly this, in a crop around each object with 384px of context — which also fixes a
second, quieter handicap: `lama_fill` caps what the model sees at `max_side`, so against a
5504px frame *every* fill had been running at 0.37x and being upsampled 2.7x. Per object
the same cap is 0.76–1.0x.

| | whole hole at once | peeled, one object at a time |
| --- | --- | --- |
| hole the model faces | 47% of the frame | 9–46% of a 1000–2700px crop |
| resolution | 0.37x | 0.76–1.0x |
| room corner | invented straight through | **survives** |
| blue monitor glow, lamp pools, sun patches | washed out | **survive** |
| window bars, curtain, rug | soft | **sharp** |

What peeling does *not* fix is long straight structure across a wide hole: the skirting
board behind the cabinet is a 2000px line with wall above and floor below, and LaMa still
returns a cabinet-shaped smear rather than a skirting board. Structural invention was the
real failure mode all along; hole size was only making it worse everywhere else. That is
the one case still worth a made fill, and `--fill-dir` is still how it gets in.

**Depth in the hole is harmonic, not Telea, and for the same reason as the window plane.**
Telea marches inward along the distance transform, so a wide region comes back streaked —
and depth is what the mesh is *built from*, so lumpiness there is real geometry. Measured
inside the fig's footprint, Telea strayed from its own smooth version by mean 1.16 / p99
8.11 levels against 0.26 / 0.79 for the real window plane beside it: four times rougher
than the surface it is continuing, peaking at 24.8 levels = 33px of displacement at full
push. It was visible over the window and nowhere else, because the window is the one
surface flat enough for a ripple to show against. `laplace_fill()` had been written for
exactly this a stage earlier and simply never applied here. Afterwards the fig's footprint
is *smoother than the real window plane beside it* — p99 0.51 against 1.01.

It also very nearly halved the served payload, which is the tell that the streaks were
noise: depth ships as lossless WebP, and noise does not compress. `layer0-depth` went
2353 → 217 KB, `layer1-depth` 1721 → 265 KB, the whole set 7559 → 3967 KB. Worth
remembering as a smell — if a lossless depth plate is large, the depth is probably wrong
rather than merely detailed.

**Do not widen `--halo` to chase "ghosts".** The soft object-shaped tone left on the wall
is the object's own *cast shadow*, and it belongs there — the object is still in the
composed scene in a nearer layer, still casting it. Measured on the guitar: at 64px the
shadow survives; at 192px it is scrubbed off; at 384px LaMa eats the room corner. Widening
the halo trades a correct shadow for invented geometry.

**Judge a fill in the band that is actually revealed, not over the whole hole.** At the
home camera the excursion is 73–148px of a 5504px plate — 1.3–2.7% of frame width beside
each silhouette, 6% at the deepest push. A blob in the middle of a large hole is never
seen. `$B-shell-review.png` marks the never-revealed area purple for exactly this reason.

LaMa stays the unattended fallback so the chain always runs end to end, and peeled it is
now good enough that a made fill is the exception rather than the rule.

#### Getting a fill

```sh
# 1. run stage 5 once for $B-layer{N}-hole.png, then use prompt EMPTY-0 (empty room) or
#    EMPTY-1 (bare surfaces) in PROMPTS.md - the generator EDITS $S.jpg, nothing else.
# 2. save its output, full frame, same pixel size as the master:
cp <generator output> art/fills/room-day-summer-layer0-fill.png   # authored, committed
# 3. re-run stage 5, which already passes --fill-dir art/fills
```

Fills are **authored inputs**, like `objects.json` — not reproducible from the master, and
committed. Layers with no fill file fall back to LaMa.

**A good filler buys tolerance for imperfect masks.** `--halo` can be raised freely once
the fill is convincing, because every extra pixel of dilation is one the generator repaints
well instead of one LaMa invents badly. Mask precision and fill quality trade against each
other, and the fill is usually the cheaper side to improve.

### 6 — export

| File                                        | Format                     |
| ------------------------------------------- | -------------------------- |
| `room-day-summer-layer0.webp`               | WebP, opaque, lossy        |
| `room-day-summer-layer{1..N}.webp`          | WebP **with alpha**, lossy |
| `room-day-summer-layer{0..N}-depth.webp`    | WebP, **lossless**         |

Depth stays lossless — WebP's lossy mode invents ringing at exactly the high-contrast edges
that matter most.

Colour resamples with Lanczos, depth with bilinear: Lanczos overshoots at a step edge,
and every depth edge that matters is a step.

**Do not erode alpha to fight the edge fringe, and do not widen the mask either.** An
object's outermost pixels really are blended object-and-background. Eroding deletes thin
structure outright; dilating drags a rim of old background along with the object. Both
are the same mistake — rounding a fraction to a side. Alpha matting is the answer and is
now implemented, so the choice does not arise; see stage 5.

---

## Division of labour

- **Alex:** generate the master (PROMPTS.md), run the Depth Anything V2 demo, then eyeball
  two previews — segmentation and layer assignment — and say what looks wrong.
- **Claude:** author `objects.json`, run stages 1–6, build the layered renderer.
- Everything except `objects.json` regenerates from the master with no manual step.

## Order of operations, and when to spend on 4K

A native 4K render is a **fresh generation, not an edit** — it drifts geometry, so it does
not upgrade the current master, it *replaces* it. Hotspot rects, depth, masks and all six
variants re-derive. That fact sets the sequence:

1. **Iterate composition free at low resolution.** This loop is still open.
2. **Prove the pipeline once at 1024** with the `near` layer only, to validate the geometry
   before any money is spent. Renderer code is resolution-independent.
3. **Lock the composition, then buy one 4K render.** A few attempts plus night, four
   seasonal edits and the close-up plates lands around $3–8 total.
4. **Re-derive everything from the 4K master.** Only the click points need nudging.
5. **Close-up plates last**, once hotspots are final.

**Upscaling is the fallback, not the plan.** Real-ESRGAN and friends are free and
registration-perfect, and painterly art upscales far better than photography — but they
invent detail rather than reveal it.

---

## Settled — do not reopen

- **Thresholding the depth map into layers.** It cuts continuous surfaces — the first
  attempt sliced the floor horizontally across the middle. Layers follow occlusion, not
  depth values.
- **`3D Photography using Context-aware Layered Depth Inpainting` (Shih et al., 2020) as
  a drop-in replacement.** It is the same architecture as this pipeline — LDI, inpaint
  the disocclusion, render the layers — which is a good sign, not a reason to switch. Its
  advantages are automation and its own occlusion analysis; both are things we
  deliberately author here, because inference on this master returned the floor
  "occluding" the cabinet. Its inpainting predates LaMa by two years and is far behind a
  generator pass, it emits a mesh (heavier to ship than four WebPs, and it re-encodes the
  colour so registration against the locked master is lost), and its layer cuts cannot be
  reviewed by eye the way `$B-shell-review.png` is. Worth reading, not worth adopting.
- **Three.js for the room.** The renderer is one quad grid, three draw calls, six textures
  and a 4×4 matrix. Three.js is ~600 KB to wrap that, against a total art payload of
  ~700 KB. CLAUDE.md's zero-dependency bias is the whole argument, and nothing about
  the camera math has forced it yet.
- **A better depth model as the fix for *compositing* artefacts.** Ghosting, smearing,
  stranded fragments and stepped silhouettes all resolved to compositing rules (shared
  z-buffer, double erosion, filled see-through holes, binary alpha) and reproduced
  identically no matter the depth values. Precision is not the constraint either: the V2
  master's raw 16-bit output holds only **365 distinct levels**, so the working 8-bit map
  is barely coarser than its source.

  **Depth *accuracy* is a separate axis, and it is not settled.** Where an object moves
  wrongly *relative to another object*, that is depth, and no compositing rule fixes it —
  the pothos reading 85/255 in front of the shelf it hangs from is a depth failure, and
  so was the corner plant coming back at 0.129, behind the back wall. Those are corrected by
  hand in `objects.json` today. Re-running depth is worth doing when the 4K master lands,
  and V3 is the one to run — but check its output against the same question, because a
  monocular model that gets a painterly foreground plant wrong will get it wrong at any
  resolution.
- **A layer per object.** Objects that occlude nothing need no layer of their own; a
  displaced mesh already carries many depths within one layer.
- **Generator inpainting.** Rejected against LaMa on registration grounds — see stage 5.
- **LaMa on the depth map.** Off-distribution; Telea is correct and simpler.
- **Re-running the depth model on an inpainted plate.** Its output is relative and
  un-normalised, so the plate lands on a different scale and needs a fit to realign.
- **Buying resolution to fix smearing.** Different problem — see the table at the top.
