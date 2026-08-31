# Personal site — "The Room"

## Context

`/Users/alex/Documents/code/portfolio` is empty and not yet a git repo. Alex wants a
home site showcasing projects and hobbies — explicitly **not** a blog, learning journal,
or resume, and explicitly not the generated-portfolio house style (hero banner, gradient
cards, three-column feature grid).

The seed was a YouTube video where AI stills were stitched with AI video into a
continuous island. **That transcript was never provided** — this works from Alex's
description. We keep the structure (one continuous space, camera movement, no page
loads) and drop the technique.

A Hollow YouTube end-card was offered as a **mood reference only** — cozy, warm,
lived-in. Not a composition spec.

Decisions already made and paid for. Do not casually reopen:

- **Hub, not traverse.** Horizontally scrolling bays were rejected as disconnected.
- **Identity must not derive from one project.** Feeding the scene art through the fluid
  solver as a dye field was rejected — every future object would inherit a fluid
  aesthetic. Projects are peers.
- **Nothing heavy runs as ambient chrome.** flowlab at 1134×600 GPU multigrid is a real
  workload. It mounts on entry, and is destroyed on exit.
- **No generated video, anywhere.** Smoothness comes from real camera motion instead.
- **Everything is indoors.** No garage, no basement — the setup, robot included, is one
  indoor room.
- **Software is the main body of work**, so it gets the most space and must grow without
  the room being recomposed.

Also ruled out: cosmos / particles / node graphs (that *is* the boilerplate look),
CAD-blueprint styling (software first), photography, Stålenhag (too cold once "cozy"
was clarified).

## The concept

**One indoor room, third-person wide** — from slightly back and above eye level, so it
reads as *here is my world* rather than *you are me*. Third-person specifically because
it holds more objects: the room must keep absorbing new work.

Objects are the navigation. Click one, the camera pushes in until it fills the frame and
goes live; back pulls out. The room is the landing page — no separate intro.

**The organizing principle:** things that exist *physically* get room addresses. Things
that exist only as *code* live on the screen. BirdLense is a device outdoors, so the
window is honest. RoboTrail is a physical build. Pure software has no physical form — so
the monitor is not one project, it is **the software bench**.

**Corner composition, not a flat wall.** An early attempt framed the room almost
frontally, on the theory that it would keep the camera push balanced. That was wrong
twice over: it looked inert, and a flat wall gives the depth model almost nothing, so
the push reads as a zoom into a photo rather than movement through a space. Two walls
meeting near center-right, with a receding floor and a cropped foreground object, is
what makes the parallax convincing.

```
  corner composition, camera wide and slightly above eye level
  +--------------------------------------------------------+
  |  [ WINDOW ]                        shelf   poster       |
  |  feeder hangs OUTSIDE the glass    books   guitar       |
  |  yard: beds, citrus, fig, fence                         |
  |                                   [ MONITORS ]          |
  |  === maker bench: console cabinet ===  SOFTWARE BENCH   |
  |  turntable   robot   3D printer   slab desk, note, mug  |
  |                                                         |
  |  potted plant (foreground, cropped)     rug             |
  +--------------------------------------------------------+
```

**v1:** monitor (software bench, containing flowlab), window (BirdLense), desk note
(contact).

**Deferred, already addressed:** RoboTrail on the work surface, guitar, sim rig, PC and
keyboards. These props are **painted into the room art from day one, visible but
inert** — three hotspots in a bare wide room would feel sparse, and a lived-in room
where some things are not clickable *yet* is exactly right. New software projects need
no room change at all — they are entries in the bench.

**The robot is small** — a SMARS chassis that reads like a little vacuum robot. It sits
on a surface at desk height, not lost on the floor, and needs a generous hit area and a
label or it will never be found.

**Gardening lives in the window, not as a destination.** Alex grows far more than citrus
— veggies, fig, apple, raspberries, perennials — and the point is the general idea, not
an inventory. The window carries feeder and yard as one view. The potted citrus indoors
is the one specific prop worth keeping, since it genuinely overwinters inside.

**Settled prop list.** Window with the 3D-printed feeder hanging *outside* the glass;
maker bench (console cabinet) carrying the record player, the round disc robot and the
3D printer; slab desk with curved ultrawide plus a vertical second monitor, mechanical
keyboard, headphones, mug, desk lamp and the contact note; Les Paul on the wall; shelf
with books; a small tandem-drift poster (an S15 leading a BMW F22, no lettering or logos);
abundant plants; a foreground potted plant cropped by the frame. **No sim rig** — it was
tried in the foreground and cut. No people, no pets, no pool.

**Seasons live outside the glass only.** The interior is identical in every variant, so
one depth map and one set of hotspot rectangles serve them all. No indoor seasonal
dressing, and **no fireplace** — that is architecture, not a prop; it would rewrite a wall
and have to exist in all eight variants or none.

Do **not** generate a room per season. Two base images (day, night) are generated; every
other variant is an *edit* of one of them changing only the view beyond the glass, because
edits hold registration and fresh generations drift. The window region is then cropped from
each and composited behind the window plane. Six images total. **All prompts live in
[PROMPTS.md](PROMPTS.md).**

Anything that glows at night must already exist in the day image, unlit — the fairy lights
along the shelf and the floor lamp by the rubber plant. Introducing an object at night would
break the shared geometry.

## Art direction

**Hollow's warmth, not its composition.** Warm painterly semi-realism, lived-in, amber
practicals against cool daylight. Differs from the reference in three ways: third-person
wide rather than first-person over a desk, less dense than that wall of collectibles,
and Alex's own props with **no licensed IP**. No people in the room.

**Focus states invert it.** Pushing into an object switches the frame to the language
flowlab already uses: near-black, one saturated accent for that object, mono status
strip along the bottom (`1134x600 grid · gpu-mg · 60fps`). The room is the person; the
focus states are the engineering. Pulling out returns you home.

## Ambient life

A perfectly still painting with buttons reads as a menu, not a place. The room carries a
**cheap ambient tier** — all of it procedural, all of it inside the room renderer's
single rAF, no video anywhere:

- **Idle camera breathing** — the first-visit drift never fully stops; at rest the
  camera sits on a very slow, very small orbit. The depth mesh makes this free.
- **Cursor parallax** — a few pixels of depth-true response to pointer position.
- **Procedural life:** dust motes in the window light shaft, steam off the mug, a faint
  flicker in the monitor glow, and slow dappled light from the window moving across the
  floor (animated noise mask — it reads as wind outside without animating foliage).
- **A bird crosses the window** every thirty seconds or so — a two-second silhouette.
  Says the outside is alive, and quietly points at what the window contains.

This tier does **not** register with the stage manager — the one-live-element rule
governs *heavy* work (sims, video, iframes). The room renderer is the baseline live
surface; when a focus state mounts, its rAF pauses, so ambient cost while focused is
zero. Every item above is disabled under `prefers-reduced-motion`, and the no-WebGL
path is simply the still image.

*Optional, deferred:* an ambient sound layer (rain, birds), muted by default behind a
small toggle. Not v1 scope.

## Transitions — real camera motion

A cross-fade between flat images reads as a cross-fade, not as moving through a space.
The fix is not video.

**Depth map + 2.5D push.** Each scene ships a colour image and a depth map. The room
renders as a mesh displaced by depth in a shader, so the camera moves in genuine 3D:
true parallax, correct perspective, continuous, and **interruptible mid-move**.

- **Generate the depth map with a monocular depth model** (Depth Anything V2) run over
  the finished art — far more reliable than asking an image model to draw one, and
  squarely in Alex's own CV wheelhouse.
- **The window is a portal, not part of the depth map — and the model already does the
  right thing here.** Depth Anything reads glass as a single flat surface (that behaviour
  is deliberate; it is what stops robots walking into windows), so the window comes back
  as part of the wall plane with no yard structure in it at all. That is exactly the room
  layer we want. The yard is **its own quad set back behind the room plane**, which the
  seasonal swap required anyway, so the parallax is arranged rather than estimated. The
  muntin bars stay on the room layer, holding still against the moving yard; that contrast
  is the entire occlusion cue. The yard quad stays flat and its depth range stays small — a large step
  at the window edge is exactly what tears a displaced mesh.
- **The first run came back clean** — foreground plant, cabinet, desk, chair and floor
  recession all separate correctly, and the window is flat wall as described above. No
  hand-editing of the depth map is planned. If the camera push reveals tearing, fix what
  visibly breaks and nothing else.
- **A single displaced mesh smears at every silhouette, and no parameter escapes it.**
  Lateral motion is the only motion that produces real parallax and the only one that
  produces disocclusion — the same motion, so the effect and the artifact cannot be
  separated by tuning. The fix is a **layered depth image**: objects that occlude one
  another are cut apart with SAM, the surface behind each is inpainted offline with LaMa,
  and the renderer draws them back to front. Sliding the camera then reveals real painted
  floor instead of stretched pixels. **Layers follow occlusion, not depth values** — every
  layer is itself a displaced mesh, so one layer carries many depths, and the shell is one
  continuous surface that is never cut. Layers are occlusion rank, not depth range — what
  earns a cut is hiding something, not being far away. Three ranks here: the shell, then
  furniture and wall-mounted things, then what stands on them. Process in
  [PIPELINE.md](PIPELINE.md).
- **The depth model gets some objects semantically wrong**, and no segmentation can detect
  that. The office chair comes back at the same distance as the desk it sits in front of,
  and the corner plant reads as further away than the wall behind it. A short list of authored
  corrections in `art/objects.json` fixes what visibly breaks, and nothing else.
- **Layers enlarge the excursion budget; they do not remove it.** Ambient parallax stays
  small, and the push still travels ~70% of the way and **cross-fades to a dedicated
  close-up** for final detail. A mesh cannot deliver the arrival at any resolution — the
  information is not in the image — so the plate is load-bearing, not polish.
- Renderer: plain WebGL2, a displaced mesh per layer, ~250 lines — matches flowlab's
  zero-dependency house style. Three.js only if the camera math turns fiddly.
- Cost is trivial next to a fluid sim, but it still pauses when a focus state is live and
  on `document.hidden`.
- No WebGL → static image, CSS scale. `prefers-reduced-motion` → no camera move at all,
  instant cut.

**Assets per scene:** colour + depth, from which the three layers and their depth maps are
derived offline, plus a close-up for each hotspot. Two hand-drawn masks are the only manual
step; everything else regenerates from the master. **Build against flat placeholder blocks first** — art drops in
with no code changes.

## Room controls — a second interaction grammar

Hotspots mean *the camera pushes in*. Some objects should respond **without taking you
anywhere**, and overloading a destination with a toggle breaks the grammar. So the room
has a second, smaller class of object: **room controls — click, something changes, the
camera never moves.**

**Ambient audio.** A small record player on the maker bench. Chill music, **off by
default** — browsers block autoplaying audio without a user gesture, so "on by default"
is not implementable, and unsolicited sound is the fastest way to lose a visitor
regardless. One click starts it; the choice is remembered in `localStorage`. Audio is
cheap, so like the ambient tier it is exempt from the one-live-element rule — but it
**must pause on `document.hidden`**, or it keeps playing in a background tab. v1 ships a
CC-licensed loop; the right long-term answer is **Alex's own guitar**, which
retroactively justifies the instrument on the wall.

The guitar itself stays a *destination* (a future music/hobby focus state), not the audio
toggle.

**Day / night.** The room ships in two lighting states, selected from the visitor's local
clock, with an override in the corner UI. The night variant is produced by **editing the
locked day image, never by re-prompting** — a fresh generation drifts the geometry, which
invalidates both the hotspot rectangles and the depth map. If geometry holds, the day
depth map is reused; verify by running Depth Anything over both and diffing.

At night the window would otherwise go dark, and the window is the BirdLense hotspot — a
black rectangle reads as dead. The feeder therefore carries **a small glowing ring around
its camera lens**, spilling onto the seed tray. At night the window says *it is still
watching*.

Every room control is a real focusable `<button>` and is mirrored in the corner UI, so
none of this is mouse-only or discoverable by accident alone.

## Discoverability

A room full of things whose contents nobody finds is the main UX risk. All required:

- Hover/focus gives a soft rim-light plus the object's label.
- A quiet persistent list of destinations in a corner — never the only way in.
- First visit plays one slow ambient drift past the live objects.
- Every hotspot is a real focusable `<button>`; Tab walks them in order.

## Architecture

**Stack:** Astro + a single React island, TypeScript, plain WebGL2. GitHub Actions →
GitHub Pages. Deploys as the user-pages repo **`aleksandrrogachev94.github.io`**, which
serves from root with no base path; `public/CNAME` carries **`alexrogachev.com`**, wired
up whenever DNS is pointed.

Astro prerenders **a real crawlable page per software project** (`/software/flowlab`).
The island intercepts navigation for the in-room camera move, but the URLs are real, and
every project has genuine server-rendered prose and headings. This is the SEO layer, the
accessibility layer, and the reduced-motion fallback simultaneously — and it is why
Astro earns its place here rather than just riding along.

**Stage manager — load-bearing.** One module enforces *exactly one live element
site-wide*: mount on focus, destroy on exit, pause everything on `document.hidden`. This
is what keeps the site from becoming the heavy thing Alex was right to worry about.

### Files

```
portfolio/
  CLAUDE.md                      repo conventions       (write first)
  docs/PLAN.md                   this plan, checked in  (write first)
  astro.config.mjs
  src/data/hotspots.ts           physical room objects
  src/data/projects.ts           software bench registry - grows here
  src/pages/index.astro          room + semantic document
  src/pages/software/[slug].astro  prerendered page per project
  src/components/Room.tsx        React island: camera + focus state
  src/components/Hotspot.tsx     focusable button over the art
  src/components/focus/MonitorFocus.tsx   software bench: list + live pane
  src/components/focus/WindowFocus.tsx
  src/scripts/roomRenderer.ts    WebGL2 depth-displaced camera push
  src/scripts/stage.ts           one-live-element manager
  src/scripts/detections.ts      BirdLense box overlay from JSON
  src/styles/tokens.css          warm room palette + dark focus palette + accents
  art/                           master + objects.json + hand masks/fills, committed
  art/build/                     everything derived from them, gitignored
  public/art/room-{day,night}-{season}.webp
  public/art/room-day-summer-depth.webp   one depth map serves every variant
  public/art/window-{spring,autumn,winter}.webp
  public/art/close-{monitor,window}.webp
  public/media/birdlense/{clip.mp4,detections.json}
  public/CNAME
  .github/workflows/deploy.yml
```

### Monitor → the software bench

Push in and the screen becomes a browsable surface in the dark technical language: a
list of software projects, each with its own accent, status strip, and live pane.
flowlab is entry one; adding a project is an entry in `projects.ts` plus a page.

**flowlab embed — stripped showcase mode.** This work happens in the **separate
`/Users/alex/Documents/code/flowlab` repo — confirm before I touch it.** Add `?embed=1`
to `src/main.ts` / `src/ui/controls.ts`: lock to one scene, hide the settings panel, keep
drag-to-stir and the diagnostics strip, don't capture page scroll. Redeploy via its
existing `deploy.yml`. The site iframes the deployed URL — cross-origin, no vendoring,
and flowlab's own deploys keep it current. "Open the full lab →" alongside.

Degradation: WebGPU → flowlab's existing CPU path at reduced grid → poster with
tap-to-run. Small viewports, `save-data` and `prefers-reduced-motion` get the poster.

### Window → BirdLense

Preferred: a short looping muted clip **plus a `detections.json` track export**, so boxes
are drawn by `detections.ts` in the accent colour — crisp, on-language, hoverable for
species and confidence. Fallback: burn the overlay in.

Status strip carries real values: `birdlense · yolo + bytetrack · <species> · conf 0.94`.

**Needed from Alex:** the clip, plus the detection track for the preferred route.

## Sequence

1. `git init`, Astro scaffold, **`CLAUDE.md` and `docs/PLAN.md`**, tokens, deploy
   workflow → confirm a blank deploy lands.
2. `roomRenderer.ts` against a placeholder image and hand-painted depth ramp — prove the
   2.5D push feels right before any real art exists. **This is the riskiest piece; do it
   early.**
3. `hotspots.ts`, `Room.tsx`, camera push/pull, stage manager, placeholder art.
4. Software bench: `projects.ts`, `MonitorFocus`, prerendered project pages. flowlab
   `?embed=1` in its own repo; redeploy; wire it in.
5. Window focus state with the real clip and detection overlay.
6. Room prose, desk note, discoverability affordances.
7. Generate real art, run Depth Anything V2 for depth maps, replace placeholders.

## Verification

- `npm run build && npm run preview`, then a real deploy on the custom domain.
- **Stage manager:** in devtools, confirm leaving the monitor destroys the iframe and GPU
  work stops. This is the entire performance argument — verify it, don't assume it.
- **Camera push:** interrupt a push mid-move and confirm it recovers cleanly; check
  stretch artifacts at the extremes of travel.
- Disable WebGPU → CPU fallback appears, no console errors. Disable WebGL → static room.
- Mid-tier mobile throttle → poster path, not the sim.
- `prefers-reduced-motion: reduce` → no camera animation, focus states cut instantly.
- Keyboard only: Tab reaches every hotspot, Esc pulls out, focus ring always visible.
- `/software/flowlab` loads directly, renders real prose, and is crawlable with JS off.
- Disable CSS → sane document with a correct heading outline.
- Real iPhone and Android: tap targets, the small-robot hit area, poster path.

## Open

- ~~Domain~~ resolved: `alexrogachev.com`, deployed via `aleksandrrogachev94.github.io`.
  Site title still open.
- Explicit OK to make the `?embed=1` change in the flowlab repo.
- ~~Which props go in the room~~ — settled, see the prop list above.
- ~~Whether the night variant holds geometry tightly enough to share the day depth map~~ —
  **answered: yes, exactly.** A phase-correlation and block-wise displacement test over a
  day/night test pair measured a global shift of 0px and 0px local displacement in 59 of
  60 sample blocks (mean 0.08px). Editing a locked image preserves geometry pixel-for-pixel,
  so one depth map and one set of hotspot rectangles serve every variant, and day/night can
  be cross-faded directly. Fresh *generations*, by contrast, do drift — hence rule 1 in
  PROMPTS.md.
- Audio track for the record player: CC-licensed loop for v1, Alex's own playing later.
