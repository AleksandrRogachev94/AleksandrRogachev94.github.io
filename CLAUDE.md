# CLAUDE.md

You are a senior, experienced software engineer.

- Follow established coding and architecture best practices.
- Prefer simple, clear, maintainable solutions over unnecessary complexity.
- Avoid over-engineering and premature abstractions.
- Consider the existing codebase and patterns before introducing new ones.
- Aim for production-quality code.

Personal site for Alex Rogachev. Not a blog, not a learning journal, not a resume.

Full design rationale lives in [docs/PLAN.md](docs/PLAN.md). Read it before making
structural changes — it records _why_ several obvious-looking ideas were rejected, and
re-proposing them wastes everyone's time. Art generation prompts are in
[docs/PROMPTS.md](docs/PROMPTS.md). To build a scene, follow [docs/SCENE.md](docs/SCENE.md);
[docs/PIPELINE.md](docs/PIPELINE.md) is why that runbook is shaped the way it is.
[docs/FILL.md](docs/FILL.md) is where the layered build's quality work is: the visible
artifact was the composite seam, not the inpainter, and it records what that cost to find.

There are now **three scene builds**. The *authored* one is everything above. The one
that **ships** draws an Apple SHARP Gaussian reconstruction directly — no plates, no
masks, no inpainting, four files and two commands. Its runbook is
[docs/SCENE-SPLAT.md](docs/SCENE-SPLAT.md). The third
([docs/SCENE-SHARP.md](docs/SCENE-SHARP.md)) flattened the same reconstruction into plates
and a torn mesh; it is superseded and its doc says why.

**The finding that settled it:** a triangle mesh at a depth discontinuity must either
bridge it (and smear) or tear it (and need a complete background behind it). SHARP's
second layer is not that background — it measures 25.1dB against the master, with only
2.23% of the frame genuinely behind the front surface. It is the visible surface plus a
thin ribbon of hidden geometry at silhouettes, which is exactly enough for a renderer with
no connectivity and nowhere near enough for a mesh. Gaussians never face the choice.

`src/data/scene.ts` selects which build ships and is the only thing in the app that knows;
`kind` picks the renderer. Most of the "Do not reopen" list below is about tuning an
inpainter that neither SHARP build runs.

Implement functionality step-by-step and educational, explaining what and why at each step. Do not try to implement everything in one go. The user is new to astro framework and wants to learn.

Do not spend extensive turns trying to test and look at various visuals yourself, it's too expensive and time consuming. Ask the user for feedback instead.

## What this is

One indoor room, rendered third-person wide, that acts as a hub. Objects in the room are
the navigation: the camera pushes into an object until it fills the frame and goes live,
then pulls back out. The room is the landing page; there is no separate intro.

**The organizing principle:** things that exist _physically_ get room addresses (window →
BirdLense, work surface → RoboTrail). Things that exist only as _code_ live on the
monitor, which is the software bench — a nested surface listing many projects, not one.

## Stack

- **Astro** — static, prerenders a real crawlable page per software project.
- **One React island** (`src/components/Room.tsx`) holding camera + focus state. The rest
  of the page is server-rendered HTML.
- **Plain WebGL2** for the depth-displaced camera push. No Three.js unless the camera
  math genuinely forces it.
- **TypeScript** throughout.
- Deployed by GitHub Actions to GitHub Pages as the user-pages repo
  `aleksandrrogachev94.github.io` (root, no base path); custom domain `alexrogachev.com`
  via `public/CNAME`.

## Rules that are load-bearing

**1. Exactly one live element at a time, site-wide.** `src/scripts/stage.ts` enforces it:
mount on focus, destroy on exit, pause everything on `document.hidden`. flowlab is a real
GPU workload — it is something you _arrive at_, never ambient chrome. If you add a live
element, it registers with the stage manager. No exceptions.

"Live element" means heavy work: sims, video, iframes. The room renderer itself is the
baseline live surface — its cheap ambient tier (idle drift, cursor parallax, dust
motes, the window bird) lives inside its single rAF, pauses whenever a focus state
mounts, and never registers with the stage. All ambient motion is off under
`prefers-reduced-motion`. Ambient audio is likewise exempt because it is cheap — but
it must still pause on `document.hidden`.

**2. The document is real.** Every destination is a server-rendered `<section>` with
genuine headings and prose, and every software project has a real URL. This is
simultaneously the SEO layer, the accessibility layer, and the reduced-motion fallback.
The room renders _on top of_ it. Never let the world become the only source of content.

**3. Every hotspot is a real focusable `<button>`.** Tab must walk them in order, Esc must
pull back out, and the focus ring must always be visible.

**4. Warm room, dark focus states.** The room is warm painterly semi-realism — cozy,
lived-in. Focus states invert to near-black with one saturated accent belonging to that
object plus a mono status strip. The room is the person; the focus states are the
engineering. Do not blend the two palettes.

**5. Two interaction grammars, kept separate.** A _hotspot_ pushes the camera in and goes
live. A _room control_ changes something in place and never moves the camera — currently
the record player (ambient audio, off by default, remembered in `localStorage`) and the
day/night override. Never make one object both. The guitar is a future destination, not
the audio toggle.

**6. Adding things should not touch the room art.** A new software project is an entry in
`src/data/projects.ts` plus a page. A new physical object is an entry in
`src/data/hotspots.ts`. Recomposing the room is a last resort.

## Do not reopen

These were argued through and settled. See docs/PLAN.md for the reasoning.

- Horizontally scrolling scenes/bays — rejected as disconnected.
- Deriving the site's visual identity from any one project (e.g. running the scene art
  through the fluid solver as a dye field) — projects are peers.
- Generated video for transitions — smoothness comes from real camera motion.
- Cosmos / particle fields / glowing node graphs — that _is_ the generated-portfolio look.
- CAD or blueprint styling — software first; electronics is not the identity.
- Photography, and any garage or basement setting. Everything is indoors.
- A flat, near-frontal view of the room — it looks inert and starves the depth model.
  The composition is a corner: two walls meeting, floor receding, cropped foreground prop.
- Regenerating the night variant from the prompt — it drifts geometry and breaks both the
  hotspot rectangles and the depth map. Night is an _edit_ of the locked day image.
- Asking a monocular depth model to resolve the yard through the window. It reads glass
  as one flat surface by design, so the window returns as wall plane — which is the room
  layer we want. The yard is a separate quad behind it, as the seasonal swap requires
  regardless. Parallax is arranged, not inferred.
- Baking any UI into the monitor art. The screens carry glow, never content — the software
  bench is rendered live in the browser.
- A layer per object. Props that occlude nothing need no layer of their own, and a
  displaced mesh already carries many depths within one layer.
- Thresholding the depth map to produce layers. It cuts continuous surfaces — the first
  attempt sliced the floor horizontally across the middle, which opens a crack under
  lateral motion. Layers follow occlusion, not depth values.
- LaMa on the depth map. It is trained on natural images, so depth is off-distribution;
  depth behind an object is plain floor or wall, and interpolation is correct, simpler,
  and keeps the original scale. Harmonic interpolation, not Telea — Telea marches inward
  along the distance transform and comes back streaked, and depth is what the mesh is
  _built from_, so streaks are real geometry. Measured four times rougher than the surface
  it was continuing; visible as ripple over the window and nowhere else.
- Letting an inpainter's output be used whole. Only its masked pixels are ever taken —
  `lama_fill` composites, and `--fill-dir` composites the same way. That rule, not the
  choice of model, is what makes registration structurally unbreakable. _Which_ inpainter
  fills the hole is deliberately open. Stage 5 emits a hole mask every run and reads a
  hand-made fill back through `--fill-dir`.
- Fixing a washed-out fill by giving the inpainter _more_. More context around the crop
  (384px → 1200px → the whole frame) leaves the detail ratio at 0.30/0.30/0.31, and a
  wider mask — `--halo`, or a loose hand-painted brush shape — makes it measurably worse,
  because dilating a hole deepens it. The only thing that moves it is `--fill-reach`:
  fewer _model_ pixels between the hole's centre and real paint. A browser LaMa demo beats
  the local one for exactly this reason and no other.
- Peeling objects off in any order but nearest-first, or dropping the peel now that the
  reach cap exists. Both were measured and both cost: whole hole at once 5.72, farthest
  first 6.71, nearest first 7.70. Reversing the order bleeds the fig's green into the
  floor behind it. Sorting _within_ a layer is free either way and is not worth arguing.
- Progressive band-peeling of a single large hole — fill the outer ring, composite, work
  inward. It regrows the plant: each band feeds leaf-adjacent colour to the next.
- Handing an inpainter the whole hole at once. It faces 47% of the frame with half of it
  > 128px from real paint, and answers with a wash. **Peel the objects off one at a time,
  > nearest layer first, each in a crop with real room around it** — the room corner, the
  > monitors' glow, the lamp pools and the sun patches all survive that and none of them
  > survived the other. That, not the choice of model, was what made LaMa look weak.
- Asking a generator for the empty room. It removes the _light each object casts_ along
  with the object, and every object we remove is still in the composed scene in a nearer
  layer, still lighting the surface behind it. Two prompted attempts came back 21 and 23
  levels RMS out at low frequency, worse the second time. Peeled LaMa cannot make that
  mistake — it continues what is actually there. A made fill is now the exception, for
  long straight structure across a wide hole (the skirting behind the cabinet).
- Widening `--halo` to chase "ghosts". The soft object-shaped tone on a wall is that
  object's cast shadow and it belongs there. On the guitar: 64px keeps the shadow, 192px
  scrubs it off, 384px loses the room corner.
- **Widening `--feather` past the painted edge.** It sets the soft-alpha band *and* how far
  the surface behind a layer is blanked, and blanking real background obliges `matte()` to
  rebuild it from the object — a hard-edged, ~30%-opaque collar welded to every silhouette
  that travels with it. Invisible at rest, obvious under drift. Sampled along the mask's
  outward normal in the master alone, the fig's edge runs leaf → clean background in **three
  pixels** (0.01 at -3px, 0.67 at 0, 0.98 at +3, flat thereafter): there is no soft rim,
  defocus tail or glow to clear. The fig's collar alpha 4-12px out is 0.00/0.01/0.08/0.31 at
  feather 3/4/6/16 — linear, because it *is* feather. It does not scale with the plate; a
  generator asked for a bigger image draws a sharper edge. Shipping 4.
- **Measuring an edge by object-colouredness against local background.** On a lacy plant a
  wide comparison window measures the *next leaf*, not one leaf's edge. It reported the
  master as object-coloured 24-48px out, which justified widening feather and made the room
  worse. Sample along the normal instead.
- **Trusting at-rest exactness as evidence the plates are right.** `matte()` makes the
  composite exact at rest *by construction* — the recovered foreground compensates for
  whatever was blanked — so at-rest error says nothing about motion. It sat at 0.03/255
  while the room looked wrong. Bisect a suspected artifact with `prefers-reduced-motion`
  first: it zeroes drift and parallax, and separates static bugs from motion ones in one
  step.
- **Grading the fill across the halo ring** to hide the layer-0 seam. Kills the step and
  breaks at-rest, 0.03 → 1.56/255 — that ring is visible at the home camera and grading it
  blanks genuine background. The seam's actual fix is `anchor_to_master` on `keep` at
  `solve_scale=1.0`, which cuts the leaf-shaped contour from 22.5 to 6.7 mean; anchoring on
  `hole` instead is provably a no-op because `lama_fill` composites.
- **Measuring a composite seam by comparing the fill to the master.** Inside `keep` the
  master *is* the object, so that compares fill against leaf; and defining the boundary as
  "where layer 0 differs from the master" makes the number shrink the boundary rather than
  improve. Both dismissed the anchor fix. Measure the discontinuity *within* layer 0 across
  a boundary derived from the masks — that is what the eye sees.
- **Judging a fill by high-frequency energy.** The "detail ratio" metric cannot tell
  hallucinated texture from correct texture, punishes a fill for being smooth where the
  surface is smooth, and never detected the artifact that was the actual complaint.
  Several entries in this list rest on it and are worth re-checking by eye before being
  cited. Look at the picture.
- **Narrowing `--halo` to buy a shallower hole**, or stopping it scaling with the plate.
  The argument for it is good and the measurement refutes it. Dilating the footprint is
  what makes a hole deep, and depth from real paint is what decides whether a fill is a
  picture or a wash — 64px of halo closes every gap between the fig's leaves and takes its
  hole from 385 plate px deep to 862, which is the whole reason that one fill runs at
  0.26x. Cutting halo to a fixed 12 delivers exactly that: the fig stops being downsampled
  at all. The fill still gets **worse**. Over all fifteen objects, in the 0–150px band the
  camera actually reveals, mean detail ratio falls 0.70 → 0.59, and ghosting rises most on
  the objects that were cleanest (guitar 0.046 → 0.298, robot 0.029 → 0.344, wall-shelf
  0.154 → 0.407). The rim halo stops excluding is object-coloured, and LaMa faithfully
  continues it inward. Depth is not the only thing that decides a fill: what surrounds the
  hole has to *be* background, and a rim of object is not.
- Grouping layers by depth range, or inferring what-hides-what from the depth map. Both
  were built and measured. Depth range puts the printer and the cabinet it stands on in
  one layer. Inference dies on contact edges: an object standing on a surface shares a
  long boundary with it where nothing is hidden, and that outvotes the short silhouette
  that matters — the floor came back "occluding" the cabinet.
- SAM's automatic mode for layer assignment. At default settings it covered 32% of the
  frame and missed the desk, chair, printer and floor; prompted mode is the reliable one
  and fifteen objects is not many.
- Buying resolution to fix smearing. Smearing is geometric — a 4K master yields sharper
  smears. Resolution fixes softness under magnification, which is a different row of the
  table in docs/PIPELINE.md.

## Conventions

- Zero-dependency bias, matching the sibling `flowlab` repo: reach for a library only
  when hand-rolling is genuinely worse, not merely longer. **This governs what ships to
  the browser.** Offline art tooling — the depth model, SAM, LaMa, image scripts — is
  not a site dependency, never enters `package.json`, and is free to use whatever is best
  for the job. The site loads plain images.
- Art assets are placeholders until late — build and verify against flat blocks so nothing
  blocks on image generation. Every generation prompt lives in [docs/PROMPTS.md](docs/PROMPTS.md);
  regenerate from there, never from memory.
- **The day image locks geometry.** Hotspot rectangles and the depth map derive from it,
  and every other variant (night, seasons) is an _edit_ of a locked image so registration
  holds. Anything that glows at night must already exist, unlit, in the day image.
- **Art is split by authorship, not by kind.** `art/` holds only what a hand or a
  generator produced and no script can recreate: the master, `objects.json`,
  `masks-manual/`, `fills/` — committed, never served. `art/build/` holds everything the
  tools derive from those (depth, layer masks, inpainted plates, review previews) and is
  **gitignored and disposable**; `rm -rf art/build` is always safe and costs one re-run.
  `public/art/` holds what the site loads: WebP, resized, plus depth maps. The runbook is
  docs/SCENE.md, naming and the asset ladder are in docs/PROMPTS.md, and the reasoning is
  in docs/PIPELINE.md.
- **The room renders as a layered depth image, not one displaced mesh.** A single mesh
  smears at every silhouette and no parameter setting avoids it — lateral motion is
  simultaneously the only source of real parallax and the only source of disocclusion.
  **Layers are occlusion rank, never depth range.** Every layer is itself a displaced
  mesh, so one layer already carries many depths; what earns a cut is hiding something,
  not being far away. The 3D printer reads _farther_ (0.33) than the cabinet it stands on
  (0.49), so grouping by depth value leaves no cut between them and smears across the
  join. `in_front_of` in `art/objects.json` states what hides what, and is authored rather
  than inferred. The shell (walls, floor, ceiling, window plane) is one continuous surface
  and is never cut; cutting it opens a crack the moment the camera moves. Masks come from
  SAM, the surface behind each layer is inpainted offline with LaMa, and the layers draw
  back to front. Three layers for the current master. Process in docs/PIPELINE.md.
- **Hotspot rectangles are mapped by eye, once, against the day master**, using the
  `map-hotspots` skill, and stored in `src/data/hotspots.ts` in normalised 0–1
  coordinates. No object detector — these props are in no dataset, there are eight of
  them, and normalised coords survive re-exporting the art at a different size.
- Generated art carries **no licensed IP**. Props are Alex's own things.
- Degrade explicitly, never silently: WebGPU → CPU → poster; WebGL → static image;
  `prefers-reduced-motion` → instant cuts, no camera animation.

## Related repos

- `../flowlab` — the WebGPU fluid solver (git remote is named `stable-fluids`). Embedded
  here via its deployed GitHub Pages URL with `?embed=1`, not vendored.
- `../BirdLense` — smart bird feeder, YOLO + ByteTrack + BirdNET.
- `../robot` — RoboTrail, graph SLAM on a Raspberry Pi (deferred to a later phase).
