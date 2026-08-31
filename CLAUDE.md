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

Implement functionality step-by-step and educational, explaining what and why at each step. Do not try to implement everything in one go. The user is new to astro framework and wants to learn.

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
  *built from*, so streaks are real geometry. Measured four times rougher than the surface
  it was continuing; visible as ripple over the window and nowhere else.
- Letting an inpainter's output be used whole. Only its masked pixels are ever taken —
  `lama_fill` composites, and `--fill-dir` composites the same way. That rule, not the
  choice of model, is what makes registration structurally unbreakable. *Which* inpainter
  fills the hole is deliberately open. Stage 5 emits a hole mask every run and reads a
  hand-made fill back through `--fill-dir`.
- Handing an inpainter the whole hole at once. It faces 47% of the frame with half of it
  >128px from real paint, and answers with a wash. **Peel the objects off one at a time,
  nearest layer first, each in a crop with real room around it** — the room corner, the
  monitors' glow, the lamp pools and the sun patches all survive that and none of them
  survived the other. That, not the choice of model, was what made LaMa look weak.
- Asking a generator for the empty room. It removes the *light each object casts* along
  with the object, and every object we remove is still in the composed scene in a nearer
  layer, still lighting the surface behind it. Two prompted attempts came back 21 and 23
  levels RMS out at low frequency, worse the second time. Peeled LaMa cannot make that
  mistake — it continues what is actually there. A made fill is now the exception, for
  long straight structure across a wide hole (the skirting behind the cabinet).
- Widening `--halo` to chase "ghosts". The soft object-shaped tone on a wall is that
  object's cast shadow and it belongs there. On the guitar: 64px keeps the shadow, 192px
  scrubs it off, 384px loses the room corner.
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
