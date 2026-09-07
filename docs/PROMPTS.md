# Art prompts

Every prompt used to generate the room, kept here so runs are reproducible and so a
regenerated asset lands in the same world as the others. Gemini is re-run from scratch
each time, so each prompt below is standalone.

## The rules that make this work

**1. Geometry is locked by the day image.** The day render defines object positions for
every other variant. All hotspot rectangles and the depth map are derived from it. Never
regenerate a variant from the base text prompt — variants are _edits_ of a locked image,
because edits preserve registration and fresh generations drift.

**Under the splat build, registration is no longer a matter of looking right — it is sampled.**
The shipping build bakes geometry once from the day master and gives each variant only a
recoloured `-splat-color-*.webp`, whose colours are read out of the variant image at each
splat's own master pixel. So a night or seasonal edit that is reframed, rescaled, straightened
or returned at a different aspect does not merely look slightly off: every splat samples the
wrong pixel, and the error is largest exactly where contrast is highest — silhouettes. A
variant that drifts by ten pixels is not a slightly-wrong variant, it is a smeared one. Say
"do not crop, zoom, straighten or resize" in every variant prompt, and check the returned
file's dimensions against the master before using it.

**2. Anything lit at night must exist in the day image, unlit.** String lights, the floor
lamp, indicator LEDs. Adding an object at night changes geometry and costs us the shared
depth map.

The one that is easy to miss is the **bird feeder's camera lens**, because at rest it is a
16-device-pixel dark dot and reads as nothing. B and F both light a warm ring around it, so if
the day master does not carry the lens, night has to invent it — and that is new geometry in
the layer the depth map is built from. Check it before locking a master. A detail too small to
matter visually can still be load-bearing for a variant.

**3. Seasons live outside the glass only.** No indoor seasonal changes, no fireplace — the
interior is identical across all variants so one depth map serves everything.

**4. Generate at the largest resolution the generator offers — 4K, not 2K.** The master is
committed and never served, so its resolution costs nothing at runtime; what ships is
resampled from it. The arithmetic is simple: the room is sharp only while the on-screen
crop still has at least one master pixel per device pixel. A retina laptop is ~3200 device
pixels wide, so

| master width   | sharp at rest        | sharp until the push reaches |
| -------------- | -------------------- | ---------------------------- |
| 1024 (current) | no — already 3x soft | —                            |
| 2048           | no — 1.6x soft       | —                            |
| 4096           | yes                  | 1.3x                         |
| 5504           | yes                  | 1.7x                         |

No realistic master survives a _full_ push, which is why the ladder has `close-` plates:
the master carries the first part of the push and a fill-frame plate takes over. But 4K is
the smallest master that is sharp **at rest**, and the room at rest is the landing page.

Resolution buys sharpness and _nothing else._ It does not reduce silhouette smearing, which
is geometric — a 4K master gives sharper smears. It does not improve masks either: SAM
encodes at 1024 internally whatever you feed it, and three resolutions of the same master
scored 69.3 / 69.3 / 68.7%. Because a fresh 4K render drifts geometry it _replaces_ the
locked master rather than upgrading it, so iterate composition cheaply at low resolution and
buy 4K once, after the composition is locked. [PIPELINE.md](PIPELINE.md) has the ordering.

**5. No readable text anywhere, ever.** Image models garble it, and every label the site
needs — hotspot names, project titles, status strips — is rendered live in the browser over
the art, never painted into it. Book spines, screens and printed matter all stay blank.

**6. Global properties bracket the object list; they do not sit inside it.** Style, camera
and lighting are properties of the whole image, and in a prompt that then enumerates thirty
objects they get outvoted — the model's last impression is an inventory, so it renders an
inventory in its own default style. The first attempt at this prompt obeyed nearly every
object (the rubber plant came back exactly as written) and missed style, perspective,
foreground separation and lighting contrast, all four. Fix is ordering, not length: state
the globals in a fenced block _before_ the objects and restate them in one paragraph
_after_. Describe technique, never category — "warm painterly illustration" is a label the
model can satisfy with cel shading; "colour mixed on the canvas, edges formed where two
colours meet, no line art anywhere" is an instruction.

**7. Do not specify detail smaller than the pixels it will get.** A prop occupying 4% of
frame width is ~55px in a 1408px render. Shard graphics on a car that size, or the fabric
weave of a speaker at ~40px, cannot exist, and asking for them spends attention to produce
a generic object anyway. Specify _silhouette and hue_ for small props — what survives — and
save the detail for the `close-` plate, which is generated at fill-frame scale. The F22's
angular shard livery is worth retrying once the master is 4K and the poster is ~370px wide.

**8. A hotspot must present its face to the camera.** Camera instructions are global, but
they land on specific objects, and the objects the camera _pushes into_ have a geometric
requirement the set dressing does not: the push ends with the object filling the frame, and
the monitor additionally carries a live-rendered surface. A screen painted at a steep raking
angle makes both of those bad — the live UI has to be projected onto a near-edge-on quad and
stays illegible through most of the push, and the `close-` plate has to match an awkward
angle to cut cleanly. Asking for a deep room and asking for a square-on monitor are not in
conflict; they are the left wall and the right wall. Push recession into the wall that holds
no hotspots.

Corollary, learned the same way: say **two-point** perspective and pin the verticals. "Three
point" invites vertical convergence, which leans the walls and shears rectangular furniture
into wedges. An interior at eye level wants vertical lines dead vertical.

**9. Buy resolution by regenerating with the approved low-res attached — and re-pick
everything afterwards.** Once the composition is locked at test resolution, attach that
approved image as `[ANCHOR]` and generate at 4K with the same text. It pulls camera,
layout, palette and style close, which is exactly what a from-scratch 4K run drifts on.

What it does **not** buy is registration. The 4K output differs by tens of pixels
everywhere, so it _replaces_ the master rather than upgrading it — every mask, every
`in_front_of` and every hotspot rect derives from the new image. **So generate at 4K before
picking a single mask**, not after. Picking against a test render and regenerating is the
one ordering mistake that wastes real work.

Say explicitly in the prompt that the attachment defines layout and everything is to be
redrawn at full detail. Given an image reference, models will happily reproduce its softness
and its mistakes along with its composition.

**And once an anchor is attached, stop re-describing what the anchor already shows.** Six
emphatic sentences were added about the wall corner — a feature the approved render already
had by accident. Being global, emphatic and long, they outranked the anchor: the generator
re-planned the room around them, turned a shallow recess into a wall block filling the right
half of the frame, pulled the camera back and shrank every hotspot. Describe geometry in the
text only where the anchor is _wrong_; everywhere else let the picture carry it.

The registration-preserving alternative is to upscale the approved image with Real-ESRGAN:
geometry stays exact and masks survive, but no new detail is invented — it makes the same
pixels bigger and smoother. That is the fallback for a master that already has masks
authored against it, not the path for a fresh scene.

**10. Every hotspot needs margin from the frame edge.** The push ends with the object
filling the frame, so the final crop is the object's own bounding box grown to the frame's
aspect. If the object sits near an edge, that crop runs off the image and there is nothing
to show. The rule of thumb: **a hotspot's bounding box should end no closer than 5% of frame
width to any edge.** Measured on the third test render, the monitor group spanned x
0.713-0.981, leaving 1.9% — 19px at test size, 76px at 4K. It fits, but with no room for
the push to overshoot or for the close-up plate to breathe.

This is a composition constraint, not a rendering one, so it has to be asked for in the
prompt. Say where the hotspot objects sit relative to the frame, not just relative to each
other: _"the desk and both monitors sit fully inside the frame with a clear band of wall
visible beyond the far end of the desk."_

**11. Spend words where the pixels are — and count them.** Prompt A had grown to 2031
words, 1604 of them after the globals, spread over ~30 objects. Measured per paragraph, the
budget was upside down: the framed drift poster, a few inches of wall that renders ~50px
wide at test size, was the **largest paragraph in the prompt at 157 words** — more than the
STYLE block (111) and more than both monitors (111). The rover got 109 for a chassis whose
requested defining feature, two wheels on one axle, is ~15px and half-hidden by the body.
Neither obeyed, and the corner — which every object competes with — drifted run to run.

Three different failures hide under "it ignored my prompt", and they have three different
fixes:

- **Below the pixel floor.** The livery cannot exist at 50px, so words spent on it buy a
  generic car _and_ tax everything else. Rule 7. Fix: silhouette and hue only, and move the
  detail to the `close-` plate. **But cut adjectives, not identities.** The first trim also
  dropped "Nissan Silvia S15" and "BMW 2 Series coupe (F22)", which are not detail — they are
  two-token handles on a whole silhouette, the cheapest prior in the prompt, and the same
  device that fixed the rover. Without them the poster came back as two unrelated cars on a
  green-striped track. Restored at 80 words, against 157 before and 58 after.
- **Fighting a prior.** A differential-drive rover with a trailing caster, or a feeder bolted
  flat to a fence, are rare next to four-wheeled rovers and hanging feeders. Emphasis loses
  to frequency; more sentences do not help. Fix: give the model a prior it already has to
  land on ("a round chassis like a robot vacuum"), and make the object big enough that the
  feature has pixels.

  **A term of art is not an instruction.** The poster paragraph has said "on opposite lock"
  since the first draft and every render has come back with the front wheels dead straight —
  because the prior behind "two cars drifting through tyre smoke" is a million photographs in
  which the wheels are a blur and the steering angle is invisible. Two words of jargon do not
  beat that, however precisely they name the thing. The fix is the same as the rover's: state
  the geometry the picture must show ("the near front wheel is turned off the centreline, you
  see the side of the tyre") and say what wrong looks like, so there is something to check
  against. That is worth about forty words, which rule 11 says to spend, because this is a
  constraint that demonstrably broke.
- **Attention competition.** Thirty described objects means the room gets re-planned around
  whichever one is loudest. Fix: tier the list. Hotspots and composition-critical objects get
  40–60 words; set dressing gets one clause and no negations.

Negations are the cheapest thing to cut: each one costs as much attention as an instruction
and forces the model to represent what it must avoid. On a 40px speaker, "no visible drivers,
grille or cones" is pure noise. Keep negations global, in MUST AVOID, for the things that
ruin the whole image.

The arc is worth recording because the naive reading of this rule is wrong. Prompt A fell
2031 → 1499, then six renders bought every word back: 2015, within sixteen of where it began.
Each buy-back paid for a constraint that had visibly broken — the two-wall statement, the
desk's orientation stated in frame coordinates, the two car models, the warmth pass, the fire
ban. Only then was there enough evidence to cut properly, to **1067** — because by then six
renders had shown which sentences no render had ever broken. Those went: style synonyms, a
fourth restatement of square-on, and negations that lose to a category prior anyway.

**So the rule is not "write less."** It is: spend on what breaks, and you cannot know what
breaks until it has broken. A first draft is allowed to be long. What it is not allowed to do
is stay long in the places where nothing ever went wrong.

**12. Show the effect, not the emblem.** A framed figure that is centred, high-contrast,
perfectly symmetrical and abstract on a black ground is the visual grammar of a _badge_, and
that is what it reads as — the conoscopic interference figure came back looking like a logo
for a company, which at 50px is all it could ever have been. Physics on the wall is a picture
_of_ physics. Physics in the room is physics: put something in the light the scene already
has and let it do what it really does. A prism standing in a sun patch throws a spectrum a
foot long across the surface it sits on, so the thing that reads from across the room is the
effect, not the object — and it costs the prompt about 30 words while reinforcing the directional-sun spec
instead of competing with it.

**Does it survive the variants?** Yes, and almost for free — rule 3 is what pays for it.
Seasons change the view through the glass and nothing else, so the interior lighting of C, D
and E is the day master's lighting, pixel for pixel: the spectrum rides along with the sun
patches on the floor, unedited. Only night takes it away, and it takes the sun shafts too —
at night the prism is simply dark glass on a sill, which is what a prism is at night. It
needs no glow and must not be given one (see B).

Lighting it from the floor lamp instead does not fix anything and breaks the physics. A drum
shade is a large diffuse source; dispersion needs a small bright one, and a diffuse source
through a prism gives a washed smear rather than a band, because every point of the shade
projects its own overlapping spectrum. The sun is the only source in this room that can do
it, so the effect is a daylight effect — the same as every other thing sunlight does here.

Rejected alternatives, for the record: crossed polarizers over a stressed acrylic offcut
(same birefringence physics as the conoscopic figure and honest to a bench, but obscure and
unreadable at bench scale); an oscilloscope showing a Lissajous trace (a real instrument, but
it adds a third light colour and invites a painted graticule with numbers on it, against the
no-text rule); a diffraction grating taped to the glass (the window plane must stay
pixel-identical across every seasonal variant — nothing new ever goes on the glass).

## Asset ladder

| #   | Asset               | Produced by                                              | Master filename                             |
| --- | ------------------- | -------------------------------------------------------- | ------------------------------------------- |
| A   | Day / summer (base) | generation, prompt below                                 | `room-day-summer.jpg`                       |
| —   | Empty plates        | edit of A — **not a variant, never served**; see A-empty | `art/fills/room-day-summer-layer0-fill.png` |
| B   | Night / summer      | edit of A                                                | `room-night-summer.jpg`                     |
| C   | Day / spring        | edit of A                                                | `room-day-spring.jpg`                       |
| D   | Day / autumn        | edit of A                                                | `room-day-autumn.jpg`                       |
| E   | Day / winter        | edit of A                                                | `room-day-winter.jpg`                       |
| F   | Night / winter      | edit of B                                                | `room-night-winter.jpg`                     |

A and the empty plates are the whole of phase one; B-F are a later phase.
Summer needs no variant — A and B _are_ summer. Night in spring and autumn is
indistinguishable through dark glass, so only winter earns a night variant.

From C–F we crop the window region and composite it behind the window plane at runtime.
A and B ship whole.

## Where the files live

```
art/<name>.jpg       the master — untouched generator output. AUTHORED, committed.
art/objects.json     what hides what.                        AUTHORED, committed.
art/masks-manual/    masks SAM could not win.                AUTHORED, committed.
art/fills/           the empty plates.                       AUTHORED, committed.
art/build/           everything the tools derive from those — GITIGNORED, disposable
art/build/masks/       per-object masks, layer membership
art/build/<name>-*     depth maps, layer plates, hole masks, review previews
public/art/          what the site loads: WebP, resized, plus depth maps
```

Only `public/art/` is ever served. Nothing under `art/` reaches the browser, and
`art/build/` regenerates from the four authored files by one run of the chain in
[SCENE.md](SCENE.md) — so it is gitignored, and `rm -rf art/build` is always safe.

Naming is `room-{time}-{season}.jpg` for masters and `.webp` for what ships, with
suffixes for derived assets:

| Suffix           | Meaning                                                                          | Example                                     |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| `-depth`         | depth map, same dimensions as its colour art                                     | `room-day-summer-depth.webp`                |
| `window-`        | window region cropped from a seasonal edit                                       | `window-winter.webp`                        |
| `close-`         | fill-frame close-up plate for one hotspot                                        | `close-monitor.webp`                        |
| `-layer{N}`      | one layer, back to front; every layer but 0 carries alpha                        | `room-day-summer-layer1.webp`               |
| `_layer{N}`      | layer membership mask, `art/build/masks/` only, never served                     | `art/build/masks/_layer1.png`               |
| `-layer{N}-hole` | what the inpainter must invent, written by stage 5; the brief for an empty plate | `room-day-summer-layer0-hole.png`           |
| `-layer{N}-fill` | the empty plate answering that hole, `art/fills/` only                           | `art/fills/room-day-summer-layer0-fill.png` |

Hotspot rectangles are **not** files — they live in `src/data/hotspots.ts` in normalised
0–1 coordinates, so re-exporting the art at a different size does not invalidate them.
They are mapped once against the day master with the `map-hotspots` skill, and because
every variant is a pixel-registered edit of that master, one set of rects serves all six.

## What the pipeline needs from a generation

The mechanics — depth, masking, inpainting, export — are in [PIPELINE.md](PIPELINE.md).
Only three things about them constrain what the prompt asks for:

**Sharp front to back.** The depth model and the layer cut both read edges. Bokeh or
depth-of-field in the master turns a silhouette into a gradient and there is no cut to
make.

**The yard never goes through the depth model.** Depth Anything reads glass as one flat
surface by design, and painterly art gives it no atmospheric perspective to work from, so
the fence at fifteen metres comes back at desk distance. The yard is a separate quad
behind the window plane — which the seasonal swap required anyway. That is why every
variant edit must leave the window frame and its bars pixel-identical: the room layer
keeps the bars, the yard layer slides behind them, and registration is the whole effect.

**Nothing thin, and nothing crossing a window bar.** The reconstruction that ships is a
768x768 Gaussian grid regressed from this image — ~7 master px per splat — so anything
narrower than two or three cells has no depth of its own and inherits its background, and a
window bar across it destroys the continuity that ties its pieces together. The first
master's shepherd's hook was 16px wide, cut by two muntins, and came back at 4.0m at its
base and 14.1m at its top while the feeder it held sat correctly at 7.65m. Masking it and
authoring the depth back in was built and reverted — a mask that half-selects a thin thing
strands the rest at the old depth. **Fix it in the picture.** Asking for it _further away_
is the wrong instinct; that makes it thinner.

**Width decides how much a crossing bar costs, and the two cases are not the same.** The hook
was 16px — under one splat cell — so it had no depth of its own at all, and the bar was fatal.
An object many cells wide is a different problem: in the 4K master a single feeder sits across
a mullion, ~280px and ~40 cells, so each half still spans ~20 cells and regresses its own depth
perfectly well. What is at risk there is not the depth but the *agreement*: the two halves can
land at slightly different distances and the object shears along the bar. That is a thing to
**measure after stage 2 and correct if it appears**, not a reason to move a well-placed object
— sample the depth either side of the bar and compare. Worth knowing how convincing the visual
split is, though: the bar breaks the feeder's roofline so cleanly, a lean-to on one side and a
gable on the other, that it reads as two separate birdhouses at a zoomed crop, and only the
seed tray running unbroken behind the bar gives it away.

The other thing to get right at master scale is the roof: **flat, overhanging, no gable** — a
silhouette fact, readable at the 160 device pixels the feeder gets at rest. "Wide peaked roof"
in the prompt is simply wrong about the real object. Its 3D-printed layer lines, the suet cage
and the orange half are real too and belong in `close-window`, not here — at rest they are
invisible, and the cage is exactly the lace-like shape the mask rule warns about.

The rule has a corollary that decides what looks like a taste question. A thin thing lying
_against_ a surface is fine — the fairy lights on the shelf — because the depth it inherits
from its background is the depth it actually has. A thin thing crossing _open air_ is not: a
cable looping from desk to floor inherits the floor metres behind it and separates from the
desk the moment the camera moves.

Cable went further than that and came out of the master entirely, for a reason worth keeping
separate from the geometry one. At the room's resting scale a power cord is a two-pixel
hairline; it cannot deliver the lived-in reading it was there for, while every run of it
that leaves a surface is a smear waiting for the camera to move. The mug, the headphones,
the books and the rug carry lived-in at that scale and cost nothing. Where cable would
genuinely be seen is the `close-` plate, which is drawn at fill-frame scale and separately —
so that is where it belongs, if anywhere.

**Anything the camera pushes into must be about as wide in frame as the ultrawide
monitor.** The push fills the frame with the target, and the magnification that needs is
just `0.76 / its width fraction`. The ultrawide is 16.8% of the frame and reaches 4.55x,
which is already where the splats become visible (9.5 screen px each) and where room.css
starts hiding them behind a blur. The first master's robot was 6.2% wide — it would have
needed 12x, four times the splat size, and could never have become a destination. Check the
fraction before drawing something you intend to make a hotspot; see docs/SCENE-SPLAT.md for
the magnification table.

**Simple silhouettes cost nothing; fine ones cost a day.** Every object that hides another
object needs a mask, and a mask is only as good as the shape. Fronds, ferns, split leaves,
lace and wire mesh are where segmentation fails, and no model or resolution fixes them —
the plant in the corner was swapped to a rubber plant for exactly this reason. Ask for big, solid,
simply-shaped things wherever the object is only set dressing.

---

## A — Day / summer (base generation)

Attach: **nothing** for a from-scratch run. But read the next section first — once a render is
mostly right, *editing* it is far cheaper than rolling this again.

Budgeted per rule 11. The from-scratch prompt went 2031 → 1499 → 2015 across six renders as
constraints broke and were bought back, then to the length below once those six renders showed
which words had never been doing anything. What was cut is style synonyms, restated
constraints, and negations that lose to a category prior anyway. What was kept is every
sentence a render has actually broken.

```text
Create a single wide interior illustration, 16:9, very high detail.

=== GLOBAL. These apply to the whole image and outrank every object below. ===

STYLE: An oil-and-gouache background painting for an animated feature. Every surface is built
from visible brush strokes with the colour mixed on the canvas. Edges form where two colours
meet — there is no line art anywhere, and no outline around any object. Real material weight:
wood grain, brushed metal, glass, soft fabric. Semi-realistic proportions.

CAMERA: A room corner in TWO-POINT perspective, from slightly above standing eye level, pulled
well back, normal lens.

EXACTLY TWO WALLS ARE VISIBLE, meeting in one corner near centre-right. No third wall, no far
end wall, no back wall. The LEFT wall carries the windows — the only windows in the image —
and runs steeply away from the camera, so the window is markedly taller at the left edge of
the frame than where it ends, and the floorboards run diagonally to a vanishing point on that
wall. The RIGHT wall nearly faces the viewer, so everything against it reads square-on.

ALL VERTICAL LINES STAY DEAD VERTICAL — wall corners, window frames, monitor edges, table
legs. No vertical convergence, no tilt, no fisheye, no wedge-shaped furniture.

LIGHT: Strong late-morning sun through the left windows throws distinct bright shafts across
the floor. Everything away from the sun falls off into shadow — ceiling, upper walls and
corners noticeably darker — so the sun patches read as pools of light in a warm room. Shadows
are warm and transparent, never neutral grey. The monitors emit a cool glow onto the desk and
the wall behind them; a warm desk lamp adds amber.

DEPTH: Three clear distances — a foreground object cut by the frame edge, the furniture in the
midground, the window wall behind. Sharp focus front to back, no bokeh.

=== END GLOBAL. Below is what is in the room. ===

FOREGROUND, bottom-left: a fiddle-leaf fig in a terracotta pot, far nearer the camera than
anything else — the frame cuts through it and most of its pot is outside the picture. Big
broad glossy leaves, two to three times the size of any other plant's.

LEFT WALL: tall white multi-pane windows in a six-over-six grid, sheer curtains to the sides.
Every white dividing bar runs unbroken across the whole window.

OUTSIDE: a sunlit summer backyard — a tall wooden privacy fence, raised vegetable beds, a
young fruit tree, potted citrus on a stone patio, blue sky. A faint haze and cooler contrast
than the room, so the glass reads as glass.

MOUNTED FLAT ON THAT FENCE, past the glass, back plate against the boards, no post or hook: a
bird feeder in matte brown 3D-printed plastic — a single box with a FLAT slab roof overhanging
it on all sides, no gable, peak or shingles; an open front recessed under that roof, a wide
seed tray along the bottom, and a small dark camera lens centred above the tray, looking out
over it, unlit. Its whole silhouette sits below the fence top with boards behind it, ideally
within one pane, and it casts a shadow on the boards. One songbird on the tray.

LEFT-CENTRE, against the window wall: a console cabinet in warm pale wood used as a maker
bench, carrying an open-frame FDM 3D printer mid-print and a small grey cylindrical speaker.

On that cabinet's top, in direct sun: a triangular prism of plain clear colourless glass, with
no tint or rainbow in the glass itself. On the side away from the window, lying flat on the
cabinet top and clearly separated from the prism, the sun paints one crisp narrow band of
spectrum, violet through red.

Beside the cabinet, a tall rubber plant — one upright stem, big glossy oval leaves — and a
floor lamp with a cream drum shade, switched off.

ON THE FLOOR between cabinet and desk, in the sunlight: a hand-built rover, as wide in the
frame as the office chair. A round black chassis like a robot vacuum's, on two wheels on one
axle with a small trailing caster. Top plate off, showing a Raspberry Pi, jumper wires and a
small camera on a mast.

RIGHT, against that wall and fully in frame: a live-edge wooden slab desk with a turquoise
epoxy river, on a black standing-desk frame. THE SLAB RUNS LEFT-TO-RIGHT ACROSS THE PICTURE —
you see the whole length of its front edge, never its end, and it does not run away from the
camera.

On it a curved ultrawide monitor and, beside it, a second monitor rotated vertical, with wall
visible between them. BOTH SCREENS FACE THE VIEWER ALMOST SQUARE-ON, each a full generous
rectangle of glowing glass showing a soft dark abstract glow with no interface. Desk and
monitors sit fully inside the frame, with a band of wall and floor beyond the desk's far end.

Also on the desk: a white mechanical keyboard, a dark mousepad, over-ear headphones, a mug and
a warm desk lamp. A mesh office chair turned slightly, not blocking the monitors.

RIGHT WALL: an electric guitar on a wall mount, sunburst Les Paul. A plain flat wooden shelf —
one board on two brackets, flush to the wall — holding worn books, a trailing plant, and an
unlit strand of fairy lights along its edge.

A framed poster, a flat screen-printed illustration rather than a photograph: two cars
drifting in tandem through grey tyre smoke, low three-quarter front angle. In front a
pearl-white Nissan Silvia S15 with a magenta-to-orange wedge down its flank; behind it a navy
BMW 2 Series (F22) with an acid-green diagonal band and a black GT wing, chasing close — its
nose nearly level with the lead car's rear quarter, not trailing a car's length back. The
bodywork is bare apart from those colour shapes.

Both cars are on opposite lock, and it has to be VISIBLE. The rear of each car has stepped out
toward the outside of the corner, and the front wheels are steered the other way — back along
the direction the car is actually travelling, not along the way its body is pointing. On each
car the near front wheel is turned clearly off the centreline, showing the side of the tyre and
its tread rather than sitting flat and square to the camera. Front wheels pointing straight
ahead are wrong.

FLOOR AND WALLS: warm wide-plank wood with sun falling across it, a rug in warm rust and ochre
under the desk and chair, and walls in a warm putty — never cool grey, never white.

RE-READ: a painting with visible brush strokes and no line art; two walls only, verticals dead
vertical, the desk running left-to-right and both screens square-on; the fig cut by the
bottom-left frame edge; high contrast, sun pools in a warm room.

MUST AVOID: line art, outlines, cel shading, anime style, fisheye or converging verticals, a
third wall or a window on any other wall, a desk running away from the camera, fire or flames,
a fireplace, people, pets, a laptop or PC tower, RGB lighting, mirrors, visible cables, a
rainbow anywhere but that one band, and any readable text, letters, numbers, logos or brand
names anywhere in the image.
```

### A-fix — repairing a nearly-right render

**This is the real simplification.** A from-scratch prompt has to re-derive the whole room on
every roll, so every roll re-rolls the parts that were already right — six renders here fixed
the feeder and lost the poster, fixed the poster and lost the walls. An edit changes what it
is asked to change and leaves the rest alone, which is exactly why every variant B–F is an
edit and not a generation.

Once a render is mostly right, stop generating. Attach it and ask for the defects by name, one
short paragraph each, in the same voice as the variant prompts.

**Subtract, don't redraw.** The smallest edit that fixes a defect preserves the most. A poster
whose livery you like but whose sponsor decals violate rule 5 does not need redrawing from a
spec — it needs the lettering taken off and the colour shapes left alone. Asking for a redraw
throws away the thing you were trying to keep, and hands the generator a fresh chance to drift.

```text
Edit the attached image. It is a screenshot: crop away the black bars around the picture and
any interface icons or buttons on top of it, so the output is the painting alone, filling the
frame edge to edge in 16:9. Apart from that crop, keep the composition, camera angle,
furniture, objects, lighting and their exact positions PERFECTLY identical — change only what
is listed below.

1. Remove the fire burning near the window entirely. Put back the potted plants and sunlit
   sill it is sitting on, lit by the same daylight as the rest of the room.
2. On the framed poster, keep both cars exactly as they are — same shapes, same colours, same
   livery graphics, same smoke, same angle. Remove ONLY the writing: every sponsor decal,
   logo, number, word and letter on the cars and along the top of the poster, leaving the
   coloured livery shapes clean and unbroken where the lettering was.
3. Redraw the shelf on the right wall as a plain flat board on two brackets, flush against the
   wall — not a box, alcove or shadow frame.
4. Give the lower half of every window the same white dividing bars the upper half already
   has, so each window is a matching six-over-six grid top and bottom. The bars are the same
   width, the same white and in line with the ones above them, and every bar runs complete and
   unbroken from frame to frame. No window is left with a single undivided lower pane.
5. Move the bird feeder to the right, clear of the fiddle-leaf fig, so it sits over sunlit
   fence boards with open fence visible all around it and no leaf near it — mounted flat to
   the fence, below the fence top, casting a shadow on the boards, and about a quarter larger
   than it is now. It must sit INSIDE ONE PANE of the completed grid from item 4, with no
   white bar crossing any part of it.
6. Stand the vertical monitor on the desk instead of leaving it hanging in the air: give it a
   visible stand — a neck running down to a solid base resting flat on the desk top — and a
   soft contact shadow under that base. It plainly rests on the same surface as the ultrawide.
7. Separate the floor lamp from the rubber plant. Move the lamp along the wall so its full
   height is clear of the plant, with a band of wall visible between them: its stem reads as
   one unbroken vertical line from its round base on the floor all the way up to the shade,
   passing behind no leaf at any point, and the shade sits clear of the foliage rather than
   appearing to grow out of it.

Change nothing else. Identical camera, daylight, exposure, colour and brushwork. Add no new
object. Output at the same pixel size as the input.
```

Seven defects, ~380 words, and the twenty things that were already right are not at risk.

Two of them interact, which is why item 5 names item 4: completing the lower sashes adds bars
across the half of the window the feeder lives in, and a bar across the feeder is the failure
the thin-things rule exists to prevent — the first master's shepherd's hook was cut by two
muntins and came back spanning ten metres of depth. Whenever one change alters the surface
another change sits on, say so in the change that lands on it; the generator will not infer it.

Items 6 and 7 are the same rule seen twice more, and neither is only cosmetic. An object with
no visible contact — a monitor floating above a desk — gives the depth regression nothing to
tie it to the surface it belongs on; the base and its shadow *are* the depth cue. And a thin
vertical interrupted by foliage is the shepherd's hook again: a lamp stem crossing behind
leaves is segmented, and each segment inherits whatever is behind it. **Contact and continuity
are load-bearing. What looks like a styling note is usually the depth model's only evidence.**

**What limits a change list is scope, not count.** All seven of these are object-scoped: each
names one thing and what should be true of it. That is not what re-plans a room. The recorded
failure in rule 9 was *global* re-description — six emphatic sentences about the wall corner
outranking an anchor that already had the corner right. Keep changes local and a long list is
fine; add one paragraph about camera or perspective and even a short list is not.

**Crop before attaching if you can.** The instruction above works, but asking a generator to
crop invites it to reframe or rescale, which moves everything. `sips` or two lines of Pillow
does it deterministically and for free, and it keeps the whole edit object-scoped.

Item 4 is the only one that moves geometry, and it is the last chance to: after this edit the
master locks, hotspot rects and masks derive from it, and every later change is a variant edit
that must hold registration. Do geometry now or not at all.

**A note on the poster.** If you keep a livery you liked from a render rather than the one the
prompt specifies, the master and the prompt above have diverged. That is fine — the master is
the authority, and the prompt is only for starting over — but say so here rather than
discovering it later: *the shipped poster is whatever the locked master shows.*

Two known divergences, both deliberate. The master's livery is orange-and-blue on white, not
the magenta-to-orange wedge the prompt asks for. And the prompt wants the chase car right on
the lead car's door, where the master has it a car's length back: closing that gap was
specified, then dropped from the fix pass, because moving a car means redrawing it and the
livery is the thing we were trying to keep. **Repositioning is never a subtraction.** Steering
angle and lettering are — you can change a wheel's angle or lift a decal without the rest of
the car being re-derived — which is why those two shipped and this one did not. If the gap ever
matters enough, it is a from-scratch roll of A, not an edit.

### Export, don't screenshot

The master is the generator's own file, downloaded — never a screen capture of the generator's
UI. A screenshot arrives at the display's resolution rather than the render's, re-compressed,
usually with the app's letterboxing baked in, and at whatever aspect the window happened to be.
All three matter here: the black bars become part of the image the depth model reads and the
next edit reproduces, the resolution is silently capped below what was generated, and the
aspect no longer matches 16:9.

It matters most at the edit step. An edit is told to hold framing identical, so a bordered
input yields a bordered output — and the border is then structure, not packaging. Download the
file. If a crop is ever unavoidable, crop losslessly and re-check the dimensions.

---

## A-4K — buying resolution (anchored regeneration of A)

Attach: `[ANCHOR]` — the approved, locked day image, downloaded at full size.

**A screenshot is an acceptable anchor here, and only here.** It is not acceptable as a master
and not as the input to an edit, but this run repaints every pixel from scratch: all the anchor
supplies is layout, palette and where the light falls, and a display-resolution capture carries
those perfectly well. Trim the letterbox and restore 16:9 before attaching — a bar the anchor
carries is a bar the redraw treats as structure — and let the text below tell it to ignore the
capture's softness. If the original download is gone, this is the recovery path, not a re-run
of A.

This is rule 9 in practice, and the answer to "regenerate or upscale" is *neither of the
obvious ones*: a plain upscale invents no detail, and a fresh generation with the same text
drifts the whole room. The anchored regeneration asks for a **redraw** — the anchor is the
authority on structure, the text is the authority on how much detail to paint into it.

Three things about this run, all of which cost real work if forgotten:

- **It replaces the master; it does not upgrade it.** The output differs by tens of pixels
  everywhere, so every mask, every `in_front_of`, every hotspot rect and every fill in
  `art/fills/` derives from the new file. **Generate at 4K before picking a single mask.**
- **Say the attachment defines layout and everything is redrawn at full detail.** Given an
  image reference, models reproduce its softness and its mistakes along with its composition.
- **Check what actually came back.** Generators routinely return a fraction of the requested
  size — the mask runs here came back at an exact quarter. Measure the file before trusting it.

Do not restate the room's geometry: no camera paragraph, no two-walls paragraph, no object
placement. The anchor carries all of it, and six emphatic sentences about the corner once
outranked an anchor that already had the corner right.

```text
Redraw the attached image at the maximum resolution available, in full detail.

The attachment is the AUTHORITY on everything structural: camera position and distance, the
room's perspective and corner, where every object sits and how much of the frame each one
fills, the palette, the light, and where every shadow and sun patch falls. Reproduce all of
that exactly. Do not move, resize, add or remove anything, do not recompose, and do not crop
or zoom — same 16:9 framing, edge to edge, with no border, bar or margin around the picture.

This is a REDRAW, not an upscale and not a copy. Repaint every surface from scratch at the new
resolution as an oil-and-gouache painting: visible brush strokes, colour mixed on the canvas,
edges formed where two colours meet, no line art or outlines anywhere. Do not reproduce the
attachment's softness, blur or small mistakes — wherever it is vague, paint what is actually
there, sharply.

Spend the extra resolution on real material and real mechanism:
- wood grain in the desk slab and the floorboards, and the slab's live edge
- the 3D printer's extrusion frame, belts and filament spool
- the rover's Raspberry Pi, jumper wires, camera and wheels
- the bird feeder's 3D-printed layer lines, seed tray and camera lens, and the songbird
- the prism's clear glass and the clean violet-to-red band lying on the cabinet top
- the guitar's sunburst finish, strings and hardware
- the fiddle-leaf fig's leaf veins and the terracotta pot
- the rug's weave and the fabric of the lamp shade
- the unlit strand of fairy lights along the shelf — small clear beads on a fine dark wire

That last one is there because the redraw **lost** it. An anchored regeneration preserves what
it can see, and a two-pixel wire is below what survives being repainted at another resolution:
the strand was in the anchor, was never named here, and simply did not come back. Anything the
anchor carries at hairline scale has to be listed, or it is silently dropped — check the
master against the object list before locking it, not after.

The whole frame stays in sharp focus front to back — no bokeh, no depth of field, no
atmospheric blur, no vignette, no film grain.

NO READABLE TEXT ANYWHERE: no lettering, numbers, logos, brand names or sponsor decals on the
poster, the screens, the book spines, the printer or anywhere else. The monitors show only a
soft dark abstract glow with no interface.
```

**Folding A-fix into this run.** If the approved render still has defects and the only copy of
it is a screenshot, do not spend an edit pass on the screenshot and then a redraw on the
result — that stacks one lossy generation on another. Run this prompt with the fix list
appended as its own block, immediately before the NO READABLE TEXT paragraph:

```text
CHANGES — these four things differ from the attachment. Everything else about the attachment
is reproduced exactly as described above.

1. The fire burning near the window is gone. In its place, the potted plants and sunlit sill
   it was standing on, lit by the same daylight as the rest of the room.
2. On the framed poster, both cars keep their exact shapes, colours, livery graphics, smoke
   and angle — but every sponsor decal, logo, number, word and letter is gone, from the cars
   and from the top of the poster, leaving the coloured livery shapes clean and unbroken.
3. The shelf on the right wall is a plain flat board on two brackets, flush against the wall —
   not a box, alcove or shadow frame.
4. The bird feeder sits further right, well clear of the fiddle-leaf fig, over sunlit fence
   boards with open fence all around it and no leaf near it — still mounted flat to the fence,
   below the fence top, casting a shadow on the boards, inside a single pane with no white bar
   crossing it, and about a quarter larger.
```

Four changes against twenty things held by the anchor is a ratio the anchor wins. A longer
change list is not: past six or so, the text starts outranking the picture and the room gets
re-planned — which is the failure rule 9 records. Split it across two runs instead.

If the result drifts the room despite the anchor, the fallback is Real-ESRGAN on the approved
image: geometry stays exact and any masks already picked survive, but no new detail is
invented. That is the path for a master that has masks authored against it — not this one,
which has none yet.
---

## A-empty — The empty plates (edits of A)

**A and EMPTY-0 are the only two generations the room needs.** B-F below are a separate,
later phase; these are a prerequisite. They are not variants — the site never loads them.
They are the hand-made fills read back by `tools/inpaint.py --fill-dir art/fills`, and they
exist because LaMa continues texture but cannot invent structure: given layer 0's hole it
drew the window straight through the room corner. Reasoning in
[PIPELINE.md](PIPELINE.md#how-much-does-the-generator-fill-actually-buy); the runbook step
is [SCENE.md](SCENE.md) §5.

They come immediately after A, but not before the pipeline has run once: stage 5 writes
`$S-layer{N}-hole.png`, white where an inpainter has to invent, and **that mask is the
brief** — it is what tells you which objects to remove. So the order is A → pick masks →
run the chain → read the hole mask → EMPTY-0 → re-run stages 5-7.

Two rules cover both plates:

- **Edit the master, never regenerate.** Same camera, same lighting, same exposure, same
  pixel size. Only the removed objects change.
- **Only the hole pixels are ever taken.** Whatever the generator does elsewhere is
  discarded by the compositor, so drift outside the hole is harmless — and a beautiful
  plate that moved the camera is still useless.

### EMPTY-0 — empty room (fills layer 0)

Attach: `[MASTER]` (the locked day image) and `[HOLE0]` (`$S-layer0-hole.png`).
Save the result as **`art/fills/<name>-layer0-fill.png`** — `inpaint.py --fill-dir`
looks for exactly that name and silently falls back to LaMa if it is not there.
It must be the master's pixel size; the generator returns a quarter of it, so
upscale before saving.

```text
Edit the attached image. Remove the furniture and everything standing in the room — the
desk, the chair, the cabinet, the plants, the printer, the shelf, the lamps, the guitar and
everything on any surface — leaving an empty room.

KEEP the room itself exactly as it is: the walls, the floor and the rug lying on it, the
skirting board, the window with all its bars, the curtains, the view through the glass, and
the framed picture on the wall.

Remove only the BODY of each object. Every light and shadow it casts on the room STAYS
exactly where it is: the pale blue glow the monitors throw on the wall behind them, the warm
pools the floor lamp and the desk lamp throw on the wall and the ceiling, the guitar's shadow
on the wall, the shadow each piece of furniture casts on the floor and the rug, and all the
daylight from the window with its bright sun patches and window-frame shadows. Paint each
surface AS IT IS LIT NOW, with the object lifted straight up off it — not as it would look in
a genuinely empty room. This picture is never seen on its own; it is only ever glimpsed
alongside the objects, which are still there and still lighting it.

The second attached image is a mask and it is the authority: everything WHITE in it must be
gone, everything else must stay exactly where it is. Use it as a checklist of what to
remove, not as a stencil to paint inside — paint one coherent empty room across the whole
frame, with no seam or outline anywhere the mask's edge fell.

Paint what was behind each removed object as it really continues: the corner where the two
walls meet, the line where wall meets floor running unbroken across the room, the
floorboards continuing in perspective, the skirting board unbroken, the rug continuing
under where the furniture stood with its pattern unbroken, and the part of the yard the
furniture was hiding.

Change NOTHING else. Identical camera position, identical framing, identical daylight,
identical time of day, identical exposure and colour. Same painting style and brushwork.
Do not add any new object or decoration to the empty room. Do not crop, zoom, straighten
or re-light. Output at the same pixel size as the input.
```

### EMPTY-1 — bare surfaces (fills layer 1) — only if needed

Attach: `[MASTER]` and `[HOLE1]` (`$S-layer1-hole.png`). Save as
**`art/fills/<name>-layer1-fill.png`**, master pixel size.

**Do not generate this up front.** Layer 1's hole is mostly flat desk and cabinet top,
which LaMa handles well. Run the chain, open `$S-layer1.png`, and generate this plate only
if LaMa left something structural — the known case is the chair's base sitting over the
desk's steel leg, which comes back as a chair-shaped pale slab.

```text
Edit the attached image. Keep every piece of furniture exactly where it is — the desk, the
cabinet, the shelf, the plants and the room itself are unchanged. Remove only the objects
STANDING ON the furniture and the chair in front of the desk, so their surfaces are bare.
The second attached image is a mask — everything white in it must be gone.

Continue each surface underneath as it really is: unbroken desk top and its wood grain,
unbroken cabinet top, the wall behind where the objects stood, and the desk's full leg and
frame where the chair was covering them.

Change NOTHING else. Identical camera, framing, lighting, exposure, colour and brushwork.
Add nothing. Output at the same pixel size as the input.
```

Both plates are **authored inputs**, like `objects.json` — committed, and not reproducible
from the master. They are pixel-registered to one master, so a regenerated master voids
them: delete `art/fills/*` and make them again.

---

## A-mask — Object masks (edits of A, for segmentation)

Also not a variant, also never served. When SAM cannot be argued into an object, ask the
generator to paint the mask instead. On the desk this beat SAM outright and beat what a
hand would trace: it followed the live edge of the wood, went up and around the mug and the
headphones where they break the back-edge silhouette, threaded between both monitor stands,
traced the cables hanging under the top, and stopped cleanly at the chair. Reach for it
after SAM has failed twice on the same object, not before — thirteen of fifteen objects
here were one box each in `pick.py`.

Two things to expect, neither fatal:

- **It returns small.** 1376x768 for a 5504x3072 master — an exact 1/4. Upscale, threshold
  at 127, and accept 4px of edge quantisation; that is 0.07% of frame width.
- **It excludes flat things lying on the surface**, however firmly you ask for them.
  Enclosed ones (a mouse pad) `fill_holes` closes for free. One that touches the mask
  boundary does not: the keyboard escaped through a narrow channel where a monitor stand
  met its corner, and had to be patched locally. **Always overlay the result on the art
  before using it.**

Attach `[MASTER]`. Replace the bracketed parts.

```text
Edit the attached image into a black-and-white segmentation mask of the [OBJECT], at
exactly the same pixel size as the input.

Paint PURE WHITE (#FFFFFF) everywhere the [OBJECT] is: [ITS PARTS - name them, including
every part that might read as a separate thing], and EVERYTHING RESTING ON IT: [LIST].

Paint PURE BLACK (#000000) everywhere else: [THE NEIGHBOURS IT WILL BE CONFUSED WITH],
and every other object in the room.

IMPORTANT - the outline is not a straight line along the object's edge. Some things stand
up higher than that edge and are seen against the background behind. Where that happens the
white shape must follow the object's own silhouette, going up and around it:
[ONE LINE PER SUCH THING - which to go around, which lie flat and are simply passed]
[ONE LINE PER ENCLOSED GAP that is really background and must stay BLACK]
[ONE LINE PER THING THAT CROSSES IT and is not part of it]

The white shape must sit in exactly the same position, at exactly the same scale, and with
exactly the same outline as the [OBJECT] in the input image. Do not move, resize, straighten
or redraw it. Follow its true edges as precisely as you can. No white may spill onto
[NEIGHBOURS], and no gap may be left unpainted inside the [OBJECT].

Only two colours in the output - pure white and pure black. No grey, no anti-aliasing, no
soft edges, no outlines, no shadows, no text, no labels, no watermark. Output at exactly
the same resolution as the input.
```

If it re-renders rather than traces — the shape right but shifted — switch to a flat fill:
ask it to paint the object opaque **pure magenta (#FF00FF)** over the otherwise untouched
master. Extraction is then unambiguous, and every non-magenta pixel still matching the
master is proof it held registration, which a pure mask can never give you.

Masks made this way are authored inputs. They live in `art/masks-manual/`, are committed,
and are voided by a new master.

---

## B — Night / summer (edit of A)

Attach the locked day image A.

Four things this prompt got wrong for a long time, all fixed below and all worth knowing
because the same mistakes are easy to reintroduce in C–F:

- **It named the floor lamp as "beside the rubber plant".** That was true of an early render
  and stopped being true the moment A-fix item 7 separated them — the lamp is now far left by
  the window, four metres from the plant. A stale positional description in a variant prompt is
  worse than none: it invites the generator to move the object to match the words. **Describe
  variant objects by where they are in the locked master, or not at all.**
- **It ended with "Ultra realistic."** A contradictory global, and by rule 6 globals outrank
  everything — so this one sentence was quietly arguing against the STYLE block on every roll.
  Gone.
- **It knew about one strand of fairy lights.** There are now two, and at night they are the
  single biggest thing separating "cosy" from "dark room with lamps in it". They get named
  first, not last.
- **It asked for an indicator light on the speaker.** The speaker's LED is a room *control*
  — `src/data/controls.ts` renders it live on the top face, and it is the only thing saying
  whether the music is playing. A painted one is always on, so the night room claimed the
  speaker was playing when it was not, from a second position 145px away. **Nothing the site
  renders live may also be painted into the art**, which is the same rule as "no UI on the
  monitors" (CLAUDE.md). The printer and the rover keep theirs: the printer has no live light,
  and the rover's painted dot lands inside the `rover-status` tell in `src/data/ambient.ts`,
  which is what a painted light is *for* — giving the live one a surface that explains it.
  The one this prompt drew was erased from the night master by hand — a harmonic fill of an
  r=18px disc at (2423.5, 1794.5) — and SHARP re-run on the result, because the colour raster
  comes from a reconstruction and a reconstruction fitted before the edit still carries the
  light. Patching the raster instead was built first and thrown away: re-running SHARP is one
  command, and it leaves nothing to remember on the next bake.

```text
Edit this image to night time. Keep the composition, camera angle, furniture, objects and
their exact positions PERFECTLY identical — change only the lighting and the view outside the
window. Do not crop, zoom, straighten, resize or re-frame, and output at exactly the same
pixel size as the input.

Inside, the room is lit only by warm practical light, and the string lights carry it:

- The strand along the top of the window and down its casing is lit — every small bulb a warm
  amber point, bright enough to read as the room's main decoration, throwing a gentle warm
  wash onto the window frame and the curtain beside it.
- The strand along the wooden shelf on the right wall is lit the same way, its bulbs picking
  out the books and the trailing plant and washing warm light down the wall below.
- The desk lamp glows amber over the desk. The floor lamp on the LEFT, by the window behind
  the fiddle-leaf fig, is now switched ON, casting a warm pool up the curtain and across the
  nearby plants — it stays exactly where it is and does not move toward the rubber plant.
- Small indicator lights on the 3D printer and on the rover on the floor. The grey speaker
  beside the printer stays dark — nothing on it lights up.
- Both monitors cast cool blue light across the desk, the keyboard and the wall behind them,
  which is the one cool note against all that amber.

Deep warm shadows everywhere else — rich and cosy rather than black. The room should read as
lamplit and lived-in at night, not as a dark room.

Outside it is a summer night: deep blue sky with a few stars, the neighbouring rooftop in
silhouette, the garden in deep blue shadow. The bird feeder outside stays clearly visible, lit
by a small warm glowing ring around its camera lens casting a soft pool of light onto its seed
tray. Keep that ring modest and contained — a small ring and a small pool, not a lantern.

IMPORTANT: remove ALL daylight from the room. There must be no bright sunlit shafts or
window-shaped patches of sunlight anywhere on the floor, the rug or the walls — those are
daylight and must be replaced by warm pools of lamplight and cool spill from the monitors. The
glass prism on the cabinet top stays exactly where it is but is now unlit: dark glass catching
a little lamplight, with no spectrum, no rainbow and no glow of its own.

Every object stays exactly where it is and keeps its exact shape: the window and all its white
dividing bars, the curtains, the desk and both monitors, the guitar, the framed poster, the
shelf, the cabinet, the printer, the plants, the chair, the rover and the rug. Nothing is
added, removed, moved or resized — only the light on it changes.

Same painterly style, same brushwork, same palette relationships, inverted for night. No
readable text anywhere.
```

**Keep the feeder's lens ring modest.** `src/data/ambient.ts` already draws a live pulsing glow
at that exact rect (`feeder-lens`), so the painted ring is the fixture the pulse sits on top of,
not the effect itself. Painted too hot, the two stack and the feeder blooms.

---

## C — Day / spring (edit of A)

```text
Edit this image. Change ONLY the view outside the window — every element inside the room,
the window frame, the curtains, the lighting inside and the camera angle stay PERFECTLY
identical.

Outside it is early spring: the fruit tree is in blossom with soft white and pink
flowers, the raised beds hold small young seedlings and bare dark soil, the grass is
fresh bright green, the raspberry canes are just budding, and the citrus trees in pots
have been brought back out onto the patio. Bright but softer sunlight, a pale blue sky
with light cloud. The bird feeder on the fence and the songbird stay
exactly where they are.
```

## D — Day / autumn (edit of A)

```text
Edit this image. Change ONLY the view outside the window — every element inside the room,
the window frame, the curtains, the lighting inside and the camera angle stay PERFECTLY
identical.

Outside it is autumn: the fruit tree has turned gold and amber with some leaves fallen on
the grass, the raised beds are spent and mostly bare with a few last plants, the grass is
duller green scattered with fallen leaves, the raspberry canes have reddened. Lower, more
golden sunlight and a slightly hazier sky. The bird feeder on the fence and the songbird
stay exactly where they are.
```

## E — Day / winter (edit of A)

```text
Edit this image. Change ONLY the view outside the window — every element inside the room,
the window frame, the curtains, the lighting inside and the camera angle stay PERFECTLY
identical.

Outside it is winter: everything is under a clean blanket of snow — snow on the ground,
capping the raised beds, along the top of the wooden fence, on the neighboring rooftop
and on the bare branches of the leafless fruit tree. The potted citrus trees are gone
from the patio (overwintered indoors). Cool, pale, low winter light and a soft overcast
white-blue sky. Snow caps the roof of the bird feeder, but the feeder itself and the
songbird stay exactly where they are.
```

## F — Night / winter (edit of B)

Attach the locked night image B.

```text
Edit this image. Change ONLY the view outside the window — every element inside the room,
the window frame, the curtains, the indoor lighting and the camera angle stay PERFECTLY
identical.

Outside it is a winter night: snow covers the ground, the raised beds, the fence top, the
neighboring rooftop and the bare branches of the leafless fruit tree, glowing faintly
blue in the darkness. The potted citrus trees are gone from the patio. A cold, clear,
deep blue night sky. Snow caps the roof of the bird feeder; the warm glowing ring around
its camera lens still lights the seed tray, and its glow catches the falling edge of the
snow. The feeder and the songbird stay exactly where they are.
```

---

## Still to write

- Close-up plates for each hotspot (monitor fill-frame, window fill-frame), generated as
  edits or crops of the locked day image so they inherit the same world.
