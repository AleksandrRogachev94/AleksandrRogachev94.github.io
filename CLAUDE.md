# CLAUDE.md

Personal site for Alex Rogachev. Not a blog, not a learning journal, not a resume.

Full design rationale lives in [docs/PLAN.md](docs/PLAN.md). Read it before making
structural changes — it records _why_ several obvious-looking ideas were rejected, and
re-proposing them wastes everyone's time.

Implement functionality step-by-step and educational, explaining what and why. Do not try to implement everything in one go.

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
- Asking a monocular depth model to resolve the yard through the window. It reads the
  glass as one plane, and removing the glazing does not help — painterly art gives it no
  atmospheric perspective to work from. The yard is a separate quad behind the room plane;
  the muntins stay on the room layer. Parallax is arranged, not inferred.
- Baking any UI into the monitor art. The screens carry glow, never content — the software
  bench is rendered live in the browser.

## Conventions

- Zero-dependency bias, matching the sibling `flowlab` repo: reach for a library only
  when hand-rolling is genuinely worse, not merely longer.
- Art assets are placeholders until late — build and verify against flat blocks so nothing
  blocks on image generation. Every generation prompt lives in [docs/PROMPTS.md](docs/PROMPTS.md);
  regenerate from there, never from memory.
- **The day image locks geometry.** Hotspot rectangles and the depth map derive from it,
  and every other variant (night, seasons) is an _edit_ of a locked image so registration
  holds. Anything that glows at night must already exist, unlit, in the day image.
- **Art lives in two places.** `art/` holds untouched generator masters — committed, never
  served. `public/art/` holds what the site loads: WebP, resized, plus depth maps. Naming
  and the full asset ladder are in docs/PROMPTS.md.
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
