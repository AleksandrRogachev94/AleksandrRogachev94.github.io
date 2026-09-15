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

**Shipped after v1:** RoboTrail, on the floor by the desk rather than the work surface —
the reconstruction put it there and 3.18m of open floor is the cleanest depth reading in
the room. Its destination is the rover's own autonomous run playing full-bleed, which
makes it the first focus state outside the bench to claim the stage manager's single
live slot. It shares the window's cut for a reason that only became true once the
content existed: both grounds are footage off a machine with a camera on it, and
`feed-expose` is a camera exposing. See src/data/robotrail.ts and RoverFocus.tsx.

**Deferred, already addressed:** the guitar, sim rig, PC and keyboards. These props are **painted into the room art from day one, visible but
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


### The window does not open a panel — it cuts

**Corrected after it shipped wrong, and the correction is worth keeping.** The bench's
takeover is a clip that starts as the object's own rectangle and pushes its edges off the
frame. That shape is not neutral: it *asserts* that this object becomes the viewport, which
is true of a monitor and false of everything else. Reusing it for the feeder made clicking a
bird feeder feel like being teleported into the monitor.

BirdLense is a camera, so the window cuts to the other camera. Each destination gets its own
verb — you sit down at the monitor, you look through the window — and that is what makes the
room a place rather than a menu with good art.

Three things had to be true at once, and getting any one wrong brought the seam back:

1. **The room falls away early.** The veil is per-object now (`veil` in `hotspots.ts`): the
   feeder starts dimming at push 0.15 and is at the floor by 0.70, against the monitor's
   0.45–1.0. It can afford that *because* it cuts — a panel that grows out of an object needs
   the room legible up to the handoff, so it cannot dim early. The feeder is 8.3m out and
   off-axis, which is the worst case in the room for SHARP, so this also fixed visible black
   holes in the reconstruction. **The arrival grammar and the veil schedule are one decision.**
2. **No held beat.** The first attempt kept `blackPauseMs` from the bench. That produced
   stop → hold → flash: three events where there should be one motion. The bench earns its
   pause because a machine is powering on; nothing is powering on here.
3. **The two sides of the cut must match.** The room bottoms out at 12% brightness and 9px of
   blur, so the incoming view *starts* at 12% and 6px and then exposes and pulls focus while
   still moving inward. Matching luminance and softness across a cut is what makes it
   invisible; without that it is a bright rectangle replacing a dark room, which is the
   "flash" no easing can hide.
4. **The incoming view must move the same way the camera was moving.** The first exposure ran
   `scale(1.06) → 1.0`: the camera pushed *in* for 900ms and the picture that replaced it
   moved *out*. A reversal of sign at a cut is the most visible thing that can be put there,
   and it read as a flash even though nothing about it was bright. It scales up now, and
   decelerates once, at the end.
5. **The cut fires while the camera is still moving, not when it stops.** This is the one that
   needed measuring. `LINEAR_TAIL` in `cameraRig.ts` exists so the push does not arrive at
   zero velocity — but *apparent* size is what the eye reads, and that gain is hyperbolic in
   `travel`. At the monitor's 0.84 the magnification is still accelerating at the handoff,
   1.56x the average rate; at the feeder's 0.55 the same tail leaves it at **0.56x**, so the
   push visibly glides to a halt and then a second thing starts. That is the whole of
   "it decelerates and stops for a moment, then the screen expands". A number tuned for one
   `travel` does not carry to another.

   The fix is not to retune the ease. The feeder's veil is at its floor by push 0.70, so the
   last third of that approach is a dark smear with nothing in it — and it is exactly the
   third in which the camera slows down. Cutting on 0.70 rather than on 1.0 means the camera
   is still at speed on the frame it leaves and its stop is never seen by anyone. Room.tsx
   converts push units into wall-clock with `pushTimeFor` (0.70 of the push is 0.60 of its
   duration, because `progress()` is eased), so nothing hand-picks the instant. The gesture
   went from 900 + 1150ms to 536 + 760.

**And the destination itself had to change.** The first version showed the project's
dashboard — a screenshot of a web UI, framed, on a dark panel — so it still read as another
monitor no matter how you arrived at it. No transition can fix a destination that is a
picture of a computer screen. It now shows one frame from the feeder's own camera, full
bleed, with the tracker's box and the classifier's 88% still on it. The app's own screens
moved to `/birdlense`, where a scrolled page is the right container for them.

### The last stretch is the screen's, not the camera's

Settled after building it the other way twice. The push stops with the monitor filling
~80% of the frame and **never travels the rest** — that stretch is pure disocclusion, which
is the one thing a displaced mesh cannot invent. The remaining distance is covered by the
monitor's *screen*: the panel arrives at exactly the rectangle the screen has reached, lit,
as though its backlight had come up, and then pushes its own edges off the frame. Move
toward the monitor; transition through the screen. `roomGeometry.pushedRectToScreen` is
what makes the two rectangles the same rectangle.

Two things were built and removed, and should not come back:

- **A full-frame accent vignette closing in during the approach.** It reads as a circle
  sliding over the picture — a transition effect announcing itself, and nothing the room
  would ever do. The room stays completely untouched for the first half of the push, and a
  blur-and-dim veil ramps in over the second half; that is the whole of the artifact cover.
- **A circular iris for the takeover.** Same objection. An iris says "a new page is
  arriving"; a rectangle that starts as the screen says "you are looking at the screen now".

#### It is one motion, and that is a timing property

The handoff is invisible only if nothing arrives twice. Getting there cost three fixes, all
recorded in `src/scripts/transition.ts`, and each one is a thing not to undo:

- **The camera push has a duration, not a decay rate.** An exponential approach never
  finishes, so its last stretch reads as hesitation, nothing downstream can be told when the
  move is over, and the panel — which is sized for a *completed* push — arrives a few
  percent too large for the screen it is supposed to be growing out of.
- **One timeline, shared.** `transition.ts` owns the numbers; Room.tsx writes them onto the
  room as custom properties and the rig imports them. The stylesheet never guesses when the
  camera will be done. It used to guess 600ms, and the guess was wrong in both directions
  depending on the frame rate.
- **The ease does not come to a stop, and the panel does not fade in.** The camera's curve
  is blended a quarter of the way to linear so it still has velocity at the handoff, and the
  panel steps to opaque in half a percent of its duration rather than spending a quarter of
  it fading up at a fixed size. That fade was a 95ms hold in the middle of a move — the
  stall that made the whole thing read as two steps.

The exit is the same claim in reverse: the panel clears in a fifth of the retreat so the
pull-back happens in the open.

**The pull-back has to actually move the camera, and for a long time it did not.**
`release()` cleared the rig's target, and the next frame fell through to the "at home"
branch and *teleported*. It was invisible in the code and invisible in review, because
everything around it looked alive: `t` went on decaying over the full release duration,
`progress()` went on reporting it, and the blur that reads `progress()` went on lifting. So
the exit looked like a room that unblurs rather than a room you retreat into, and two
successive attempts to fix it by retiming the release changed only the blur. **The target
must outlive the release and only be retired once `t` is back at 0.** If the exit ever
looks static again, check what the camera is doing before touching a duration.

### The bench boots, once

Reversed from the earlier position that a boot screen is a gate. The objection holds
against a *login* — something to click through — and not against a **power-on**: nothing
waits on it, there is nothing to dismiss, it is over in ~1.3s, and it plays once per page
load, so bouncing between the bench and a project does not replay it. It earns its place by
finishing a causal chain the camera move alone leaves open — the monitor is an object in a
room, and clicking an object in a room should turn it on. The lines are a self-test and
every one of them is true of the page behind it (`projects.ts` supplies the count, the
renderer line reports what actually initialised), which is what keeps it from being theatre.

Not a vendor logo, not a fake OS, no progress bar counting to 100%.

**The backlight flare is an ignition, not a wash.** The first build had it decaying over
760ms — a full-frame sheet of accent laid across the boot for the whole of the boot's life,
while the boot's own lines faded up underneath it. Both were on screen and the sequence was
invisible: the machine appeared not to boot at all. The flare now spikes in ~30ms and is
gone before the first line arrives, which is also what a backlight actually does. Anything
that dims the boot must finish before the boot speaks.

**The lines need dwell.** They stagger in over ~460ms and then *stand* for ~300ms before
the panel takes them. A self-test nobody can finish reading is indistinguishable from a
glitch.

### The monitor is the second navigation layer

Room → monitor → project. The room is the person and carries no lists; the monitor is the
index; a project is the detail. So the bench is laid out as a machine's own screen — an
identity bar, a telemetry rail, a grid of tiles — and not as the article `/software`
already is. Collapsing it back into that article would waste the one surface in the site
that can plausibly be a screen.

## Room controls — a second interaction grammar

Hotspots mean *the camera pushes in*. Some objects should respond **without taking you
anywhere**, and overloading a destination with a toggle breaks the grammar. So the room
has a second, smaller class of object: **room controls — click, something changes, the
camera never moves.**

**Ambient audio — built.** The speaker on the shelf (`src/data/controls.ts`,
`src/scripts/roomAudio.ts`). Chill music, **off by default** — browsers block autoplaying
audio without a user gesture, so "on by default" is not implementable, and unsolicited
sound is the fastest way to lose a visitor regardless. One click starts it, and every page
load starts from silence. Audio is cheap, so like the ambient tier it is exempt from
the one-live-element rule — but it **must pause on `document.hidden`**, or it keeps playing
in a background tab. `stage.registerAmbient` is that hook and this is its only member. It
ships "Sakura Meditate Beat" by moodmode under the **Pixabay Content License** — free for
commercial use, attribution not required, credited in index.astro's colophon anyway. Note it
is *not* Creative Commons: it permits use in a work, not redistribution of the file, which
matters if it is ever swapped. The right long-term answer is **Alex's own guitar**, which
retroactively justifies the instrument on the wall.

Three things fell out of building it that the plan did not have:

- **The preference is not remembered, and the version that remembered it was wrong.** It
  stored the choice and re-armed it at mount — *armed, not obeyed*, on the theory that a page
  load is not a gesture and the browser would refuse. It does refuse, on every profile except
  the one that has already earned an autoplay grant by playing this loop before: the visitor
  who liked it. A preference that takes effect only where it is least wanted is not one. It
  also made the speaker's light unreadable — `audioOn` could come up true at load, leaving the
  LED lit over a silent room. The toggle still resolves to what *happened* rather than to what
  was asked, which is why the lit state is driven by the attempt's result and not by the click;
  a missing file or a codec Safari will not take is still a refusal.
- **Nothing is fetched until the first click.** The `<audio>` element is built on first play,
  so a visitor who never touches the speaker never downloads the loop.
- **Nothing on a control lights in a destination accent.** The accents are one per project
  and each belongs to one; borrowing one would say the control took you somewhere. Its
  *wake* — the object brightening under the pointer — comes up in `--room-amber`, the room's
  own practicals, so it reads as the room responding. Its *standby LED* is white, because
  that is what a power indicator is on hardware and white belongs to nobody. That is the two
  grammars said in light, and it is worth keeping as a rule.

**It has a standby light at rest, and getting there meant giving up a rule and then failing
three more times.** The first build left the speaker dark until clicked, on the argument that
an unprompted light would make the promise the ambient tells make — *the things that are alive
are the things you can enter* — and then break it. Two problems: that rule already had an
exception, since the mug steams and is not clickable, and in practice nobody could tell the
speaker was interactive at all.

The rule that replaces it is **an electronic light means an object you can act on**, and the
grammars are separated by *how* rather than whether:

| | destinations | room controls |
|---|---|---|
| cadence | blink or breathe — a device taking a frame, a machine idling | breathe at rest; snap when switched |
| colour | the destination's own accent | white for the LED, `--room-amber` for the wake |
| on | n/a | steady, and it arrives in ~90ms |

Breathing means waiting and steady means on, which is how the hardware behaves. The lit state
is also the only feedback an audio toggle can have, since a toggle whose entire effect is a
sound is unusable the moment the sound fails to start.

**Three attempts failed before that worked, and each failed for a reason worth writing down.**

- **A slow pulse of the object's own wake.** Invisible, and not because of its amplitude: a
  slow, edgeless, low-contrast luminance ramp is close to the worst case for human vision,
  while the hover reads instantly because it is a *step*. The deeper fault is that the tell
  and the hover response were then *the same visual*, so the most a resting light could ever
  say was "faintly hovered". **A resting affordance has to be a different kind of object than
  the hover response** — which is what made it a point light instead of a tint.
- **The point light placed on the middle of the cabinet, then off to one side.** Both read as
  a blemish on the paint. The x offset was never the problem: **the curved side of that
  speaker has no feature to host a light** — no bezel, no panel, no seam — so a dot anywhere
  on it attaches to nothing. It went to the top face, where a cylindrical speaker's indicator
  physically is. **A light needs a surface that explains it**, which is the same finding the
  ambient tier reached from the other end: the feeder's tell works because there is an actual
  camera module painted where it sits.
- **A 260ms fade between standby and playing.** Pressing the speaker felt like moving a
  slider. A device coming on does not ramp — it is up inside a tenth of a second, dips once
  as the thing behind it draws current, and settles.

One thing that is *not* on that list: colour temperature does the work the blend mode could
not. The speaker is a pale cylinder in a sun patch, so `screen` has no headroom to add light
into and a white `screen` layer over it is arithmetically nothing. The LED is painted instead
— a near-white dot on warm plaster, **brighter and cooler** than everything around it, which
is what an LED on a cream speaker actually looks like.

**It stays a control, not a hotspot.** Rule 5 says never make one object both, and the
concrete cost of promoting it is the point: a hotspot pushes the camera until the object
fills the frame and hands over to a focus state, and there is nothing to put behind a
speaker. You would trade "start the music and stay in the room, watching the room respond"
for a 900ms move onto a near-black panel with a play button on it. If a *music destination*
is wanted later, that is the guitar, which PLAN.md already reserves — two objects, two
grammars, neither overloaded.

The guitar itself stays a *destination* (a future music/hobby focus state), not the audio
toggle.

**Day / night.** The room ships in two lighting states, selected from the visitor's local
clock, with an override in the corner UI. The night variant is produced by **editing the
locked day image, never by re-prompting** — a fresh generation drifts the geometry, which
invalidates both the hotspot rectangles and the depth map. If geometry holds, the day
depth map is reused; verify by running Depth Anything over both and diffing.

At night the window would otherwise go dark, and the window is the BirdLense hotspot — a
black rectangle reads as dead. The feeder therefore carries **a small glowing ring around its
camera lens**, spilling onto the seed tray. At night the window says *it is still watching*.

**Built, and the ring ended up split across the two halves of the build.** The masters paint
what a reconstruction can hold — a dark lens and a warm pool lying flat on the seed tray — and
the ring itself is the `feeder-lens` entry in the ambient tier (`src/data/ambient.ts`), a
screen-blended bloom pinned at the feeder's depth. It was painted into the night masters first
and that failed on resolution, not on art direction: the feeder is ~11 splats across at 8.29m,
and a glow in mid-air has no surface for the fit to attach it to. See docs/PROMPTS.md section
B. The intent above is unchanged; only which half of the pipeline draws it.

Every room control is a real focusable `<button>` and is mirrored in the corner UI, so
none of this is mouse-only or discoverable by accident alone.

## Discoverability

A room full of things whose contents nobody finds is the main UX risk. All required:

- ~~Hover/focus gives a soft rim-light plus the object's label.~~ Built, and the rim-light
  became a *wake* — the object's own light coming up, baked from its SAM mask. A hairline
  rim on the silhouette was tried and is in CLAUDE.md's do-not-reopen list: it is a
  screen-space overlay on art that parallax keeps nudging, so it comes visibly unglued.
- **A quiet persistent list of destinations in a corner — built, then pulled.** It worked
  and it was still wrong: a literal index is website chrome sitting on a painting, and the
  rule two sections up is that *the room is the person and carries no lists*. What it was
  covering for is real, though, and had to be replaced rather than dropped — see below.
- ~~First visit plays one slow ambient drift past the live objects.~~ **Superseded by
  something better: the objects announce themselves continuously instead of once.** Every
  hotspot now carries a small electronic tell in the ambient tier — the feeder's camera
  blinks a recording cadence, the rover's panel breathes, the ultrawide's glow is never
  quite still — so the room teaches one rule with no text at all: **the things that are
  alive are the things you can enter.** A visitor picks it up in seconds, it never reads as
  UI, and unlike a one-time introduction there is no way to miss it by arriving late.

  This is also the only affordance that reaches touch. The wake answers to `:hover` and
  `:focus-visible`; a phone has neither, so before the tells the room on a phone was a
  still picture with three invisible tap targets. That, not desktop discoverability, is
  what the corner list was really for, and it is what the tells actually solve.

  The earlier failed attempt — every hotspot lighting itself once, staggered, after the
  room settled — is worth distinguishing from this. It failed because it *ended*: motion
  that plays once and stops is an event, and an event nothing explains reads as a glitch.
  A light that has always been blinking is a property of the object and explains itself.

  **The mug is not a counterexample.** Steam is drifting vapour; the tells are point lights
  on a machine cadence. Different vocabularies, so warm ambient life on non-interactive
  props stays free — it is putting a *blinking indicator* on one that would break the rule.
- ~~Every hotspot is a real focusable `<button>`; Tab walks them in order.~~ Built, as an
  `<a href>` — see the note at the top of `src/components/Hotspot.tsx` for why a link
  serves rule 3's actual intent better than a button does.

**Known gaps.** Two, both small and both real.

`.room--busy` hides the hotspot layer with `opacity` and `pointer-events`, which closes the
mouse half but not the keyboard half: the anchors stay tabbable behind an `aria-modal`
panel, so Tab can move the keyboard somewhere the visitor cannot see. `visibility: hidden`
is the fix.

`prefers-reduced-motion` disables the whole ambient layer (`display: none`), which is
correct — a frozen LED is a painted dot, not a light. But it means a visitor on reduced
motion *and* touch gets no in-room affordance at all and falls back to the document below.
A defensible floor rather than a bug, but it is the one combination the room cannot speak
to itself.

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
- Audio track for the record player: a Pixabay-licensed loop for v1 (moodmode, "Sakura
  Meditate Beat"), Alex's own playing later.
