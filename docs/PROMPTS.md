# Art prompts

Every prompt used to generate the room, kept here so runs are reproducible and so a
regenerated asset lands in the same world as the others. Gemini is re-run from scratch
each time, so each prompt below is standalone.

## The rules that make this work

**1. Geometry is locked by the day image.** The day render defines object positions for
every other variant. All hotspot rectangles and the depth map are derived from it. Never
regenerate a variant from the base text prompt — variants are _edits_ of a locked image,
because edits preserve registration and fresh generations drift.

**2. Anything lit at night must exist in the day image, unlit.** String lights, the floor
lamp, indicator LEDs. Adding an object at night changes geometry and costs us the shared
depth map.

**3. Seasons live outside the glass only.** No indoor seasonal changes, no fireplace — the
interior is identical across all variants so one depth map serves everything.

**4. Generate at the largest resolution the generator offers — 4K, not 2K.** The master is
committed and never served, so its resolution costs nothing at runtime; what ships is
resampled from it. The arithmetic is simple: the room is sharp only while the on-screen
crop still has at least one master pixel per device pixel. A retina laptop is ~3200 device
pixels wide, so

| master width | sharp at rest | sharp until the push reaches |
| --- | --- | --- |
| 1024 (current) | no — already 3x soft | — |
| 2048 | no — 1.6x soft | — |
| 4096 | yes | 1.3x |
| 5504 | yes | 1.7x |

No realistic master survives a *full* push, which is why the ladder has `close-` plates:
the master carries the first part of the push and a fill-frame plate takes over. But 4K is
the smallest master that is sharp **at rest**, and the room at rest is the landing page.

Resolution buys sharpness and *nothing else.* It does not reduce silhouette smearing, which
is geometric — a 4K master gives sharper smears. It does not improve masks either: SAM
encodes at 1024 internally whatever you feed it, and three resolutions of the same master
scored 69.3 / 69.3 / 68.7%. Because a fresh 4K render drifts geometry it *replaces* the
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
the globals in a fenced block *before* the objects and restate them in one paragraph
*after*. Describe technique, never category — "warm painterly illustration" is a label the
model can satisfy with cel shading; "colour mixed on the canvas, edges formed where two
colours meet, no line art anywhere" is an instruction.

**7. Do not specify detail smaller than the pixels it will get.** A prop occupying 4% of
frame width is ~55px in a 1408px render. Shard graphics on a car that size, or the fabric
weave of a speaker at ~40px, cannot exist, and asking for them spends attention to produce
a generic object anyway. Specify *silhouette and hue* for small props — what survives — and
save the detail for the `close-` plate, which is generated at fill-frame scale. The F22's
angular shard livery is worth retrying once the master is 4K and the poster is ~370px wide.

**8. A hotspot must present its face to the camera.** Camera instructions are global, but
they land on specific objects, and the objects the camera *pushes into* have a geometric
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
everywhere, so it *replaces* the master rather than upgrading it — every mask, every
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
text only where the anchor is *wrong*; everywhere else let the picture carry it.

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
other: *"the desk and both monitors sit fully inside the frame with a clear band of wall
visible beyond the far end of the desk."*

## Asset ladder

| #   | Asset                   | Produced by              | Master filename            |
| --- | ----------------------- | ------------------------ | -------------------------- |
| A   | Day / summer (base)     | generation, prompt below | `room-day-summer.jpg`      |
| —   | Empty plates            | edit of A — **not a variant, never served**; see A-empty | `art/fills/room-day-summer-layer0-fill.png` |
| B   | Night / summer          | edit of A                | `room-night-summer.jpg`    |
| C   | Day / spring            | edit of A                | `room-day-spring.jpg`      |
| D   | Day / autumn            | edit of A                | `room-day-autumn.jpg`      |
| E   | Day / winter            | edit of A                | `room-day-winter.jpg`      |
| F   | Night / winter          | edit of B                | `room-night-winter.jpg`    |

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

| Suffix    | Meaning                                      | Example                      |
| --------- | -------------------------------------------- | ---------------------------- |
| `-depth`  | depth map, same dimensions as its colour art | `room-day-summer-depth.webp` |
| `window-` | window region cropped from a seasonal edit   | `window-winter.webp`         |
| `close-`  | fill-frame close-up plate for one hotspot    | `close-monitor.webp`         |
| `-layer{N}` | one layer, back to front; every layer but 0 carries alpha | `room-day-summer-layer1.webp` |
| `_layer{N}` | layer membership mask, `art/build/masks/` only, never served | `art/build/masks/_layer1.png` |
| `-layer{N}-hole` | what the inpainter must invent, written by stage 5; the brief for an empty plate | `room-day-summer-layer0-hole.png` |
| `-layer{N}-fill` | the empty plate answering that hole, `art/fills/` only | `art/fills/room-day-summer-layer0-fill.png` |

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

**Simple silhouettes cost nothing; fine ones cost a day.** Every object that hides another
object needs a mask, and a mask is only as good as the shape. Fronds, ferns, split leaves,
lace and wire mesh are where segmentation fails, and no model or resolution fixes them —
the plant in the corner was swapped to a rubber plant for exactly this reason. Ask for big, solid,
simply-shaped things wherever the object is only set dressing.

---

## A — Day / summer (base generation)

Attach: `[ANCHOR]` (the approved daytime image — composition and style reference) plus the
photo references `[DESK]`, `[SUNROOM]`, `[YARD]`, `[FEEDER]`, `[ROBOT]`.

```text
Create a single wide interior illustration, 16:9, very high detail.

=== THESE FOUR APPLY TO THE WHOLE IMAGE. They matter more than any object below. ===

STYLE: An oil-and-gouache background painting, of the kind painted for a live-action-scale
animated feature. Every surface is built from visible brush strokes with the colour mixed
on the canvas, so a wall carries four or five values across it and wood grain is drawn
stroke by stroke. Edges are formed where two colours meet, not by a drawn contour: there
is no line art anywhere in this image — no outline around any object, no uniform dark
contour, no inked edges. Real material weight — wood grain, brushed metal, glass, soft
fabric. Semi-realistic proportions. This is a painting, not a cartoon, not an anime
background, not a vector illustration, not cel-shaded.

CAMERA: A room corner in TWO-POINT perspective, viewed from slightly above standing eye
level and pulled well back, as if through a normal lens rather than a wide-angle one.

ALL VERTICAL LINES IN THE IMAGE STAY DEAD VERTICAL — wall corners, window frames, monitor
edges, table legs and the sides of the cabinet are all perfectly upright and parallel to the
sides of the frame. There is no vertical convergence, no tilt, no fisheye.

The LEFT wall recedes strongly: the window is markedly taller at the left edge of the frame
than where it ends, and its bars converge as they go back. The floorboards run diagonally
away toward a vanishing point on the left wall.

Where the two walls meet, near centre-right, the desk wall sits slightly SET BACK behind a
short return wall, so there is a vertical outside corner there rather than one flat fold.
The step is shallow — a recess about as deep as the desk, not a room divider.

The RIGHT wall, inside that recess, is close to facing the viewer, only mildly turned, so
everything standing against it reads nearly square-on.

The room must read as deep, not as a flat wall seen head-on — but the perspective is calm
and ordinary. No extreme foreshortening, no stretched or wedge-shaped furniture.

DEPTH: Three clearly separated distances — a foreground object close enough to the lens to
be cut by the frame edge, the furniture in the midground, and the window wall behind. The
viewer should be able to tell at a glance which of any two objects is nearer.

FOCUS: The entire frame is in sharp focus, front to back, every object crisp at its own
distance. No bokeh, no depth-of-field, no soft background.

=== END GLOBAL. Everything below is what is in the room. ===

The attached [ANCHOR] image is the COMPOSITION AND STYLE reference. Match its camera
position and distance, how much of the frame the furniture fills, where each piece of
furniture sits, and its brushwork, colour palette and warmth. Redraw everything at full
detail — do not reproduce its softness or its small mistakes, and do not merely upscale it.
Where the text differs from it, follow the text. Use the other attached photos as subject
reference for specific objects only; do not copy any photo's camera angle, lighting or
photographic look.

LIGHTING: Strong directional late-morning sun through the left windows throws distinct
bright shafts across the wooden floor, with deep soft shadows pooling beneath the desk,
beneath the console cabinet and behind the chair — high contrast between lit and shadowed
areas, not evenly lit. The monitors clearly emit light: a cool glow washes across the desk
slab, over the keyboard and onto the wall behind them. A warm desk lamp adds amber, so cool
daylight and warm lamplight meet in the middle of the room.

FOREGROUND, bottom-left: a fiddle-leaf fig in a terracotta pot, standing much closer to the
camera than anything else in the room. It is so close that the frame cuts through it —
roughly a third of the plant, including most of its pot, is outside the picture past the
bottom-left corner. Its leaves are big, broad, solid and glossy, each a simple rounded
shape, and because of its nearness they are two to three times the size of the rubber
plant's leaves across the room. It is softly shadowed and sits clear of both the window and
the desk, overlapping neither.

The desk and both monitors sit fully inside the frame with real breathing room: a clear band
of wall and floor stays visible beyond the far end of the desk, between it and the right
edge of the picture. Nothing on the desk touches or is cropped by the frame edge.

LEFT WALL: tall white multi-pane windows in a six-over-six grid, sheer curtains drawn to the
sides. Every white dividing bar runs complete and unbroken from frame to frame across the
whole window.

OUTSIDE, beyond the glass: a sunlit summer backyard — a wooden privacy fence, raised
vegetable beds in full growth, a young fruit tree in leaf, raspberry bushes, several potted
citrus trees on a stone patio, the roofline of a neighbouring house, blue sky with light
cloud. Everything outside carries a faint haze and slightly cooler, softer contrast than the
room, so the glass reads unmistakably as glass.

Among the raised beds, at the same distance as the fruit tree, a bird feeder hangs from a
tall metal shepherd's hook whose base is planted in the garden bed. It is seen through the
window exactly like everything else in the yard: the white dividing bars pass in front of
it, continuous and unbroken, just as they pass in front of the fence and the trees. It sits
well inside a single pane, clear of the window's outer frame, and it is small — no larger
than the potted citrus trees beside it — so it reads as set back in the garden. Matte brown
3D-printed plastic: a boxy hopper with a wide peaked roof, a seed tray along the front, a
small dark camera lens recessed into its back wall, a cylindrical suet cage hanging from one
side arm. One small songbird perched on the tray.

LEFT-CENTRE, against the window wall: a white console cabinet used as a maker bench. At its
far left end a small bluetooth speaker: a plain pale grey upright cylinder, taller than it
is wide, with no visible drivers, grille or cones on its face. Beside it an open-frame FDM 3D printer with a black aluminium
extrusion frame, a filament spool on top, a small control screen, mid-print. Next to the
printer a small round black disc-shaped robot about the size of a dinner plate, its top
plate removed to expose a Raspberry Pi board, a tangle of red, yellow, blue and black jumper
wires, a small camera and a stubby antenna — charming and hand-built, not sleek.

Beside the cabinet stands a tall rubber plant (Ficus elastica): a single upright stem
carrying a dozen big, broad, glossy oval leaves, each a simple rounded shape with no lobes,
no splits and no fine fronds. A floor lamp stands beside it: a slim dark metal
stem on a small round base, carrying a generous drum shade of warm cream linen, wide enough
to read as a soft solid cylinder of fabric rather than a bare bulb on a pole. In this
daylight scene it is switched off, so the shade is lit only by the room and glows faintly
where the sun catches it.

RIGHT, in the corner, FULLY IN FRAME: a live-edge wooden slab desk with a turquoise epoxy
river running through it, on a black electric standing-desk frame. It stands against the
right wall and is only mildly turned toward the viewer, so its slab reads as a clean
rectangle in gentle foreshortening: the front and back edges of the slab stay close to
parallel, its far end is nearly as wide as its near end, and it does not taper away into a
wedge or a triangle.

A curved ultrawide monitor in normal 21:9 proportions — wide, but not extremely elongated
and not dominating the frame. Beside it a second monitor rotated vertical, fully visible as
a clearly distinct separate screen with a visible gap of wall between the two, so they never
merge into one continuous dark panel. BOTH SCREENS FACE THE VIEWER ALMOST HEAD-ON: each one
reads as a full, generous rectangle of glowing glass seen close to square-on, not as a
narrow sliver seen from the side. Both are ON, showing only a soft dark abstract glow with
no interface and no readable content, but casting clearly visible light onto the desk and
the wall.

On the desk: a white mechanical keyboard, a dark mousepad, over-ear headphones resting
beside the keyboard, a ceramic mug and a warm desk lamp. Nothing on the desk carries any
writing, label or printed marking. A white-and-black mesh office chair turned slightly,
positioned so it does not block the monitors. Cables visible but tidy.

RIGHT WALL: an electric guitar on a wall mount — Les Paul style single-cutaway body,
sunburst finish, gold hardware. A small wooden shelf holding a few worn books and one
trailing plant whose vines hang no further than the depth of the shelf itself. A strand of
fairy lights is draped along the shelf's edge; in this daylight scene they are unlit, so
they read as small clear glass beads on a thin dark wire, giving off no glow at all.

A small framed poster showing two sports coupes drifting in tandem, seen from a low
three-quarter front angle with thick grey tyre smoke billowing behind them. The lead car is
a white Nissan Silvia S15, front wheels turned on opposite lock, with one broad teal stripe
sweeping the length of its flank. Close behind it, a BMW 2 Series coupe (F22) angled the
same way, painted a deep saturated crimson red with one broad white stripe running over its
hood and roof, and carrying a large black GT wing. Bold, flat, poster-like shapes — the
whole image is only a few inches wide on the wall, so it must read as two cars, one white
and one red, from across the room. No lettering, no numbers, no sponsor decals, no logos,
no badges.

FLOOR: warm wide-plank wood, bright sunlight falling across the boards, and a soft patterned
rug lying under the desk and the chair — large enough to be clearly visible, not hidden
beneath the furniture.

FINALLY, RE-READ THIS: the whole image is an oil-and-gouache painting with visible brush
strokes and NO line art or outlines of any kind; the camera looks into a deep room corner
with the floor and the left wall's window bars converging away from the viewer, while every
vertical line stays dead vertical and the desk and both screens face the viewer nearly
square-on; the fiddle-leaf fig is cut off by the bottom-left frame edge and is dramatically
nearer than everything else; and the light is high-contrast, with bright sun shafts and deep
pooled shadows rather than an evenly lit room.

MUST AVOID: line art, outlines, cel shading, flat uniform fills, anime style, a flat
head-on view of a wall, wide-angle or fisheye distortion, leaning or converging verticals,
a desk or monitor stretched into a wedge or seen at a steep raking angle, more than one
window wall, people, pets, toys, laptop, desktop PC tower, sim racing rig, RGB lighting,
fireplace, mirrors, reflections on the screens, mess or laundry on the floor, motion blur,
lens flare, watermark, signature, and any readable text, letters, numbers, logos or brand
names anywhere in the image. Tidy but lived-in — not sterile, not cluttered.
```

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

```text
Edit this image to night time. Keep the composition, camera angle, furniture, objects and
their exact positions PERFECTLY identical — change only the lighting and the view outside
the window.

Outside it is a summer night: deep blue sky with a few stars, the neighboring rooftop in
silhouette, the garden in deep blue shadow. The bird feeder outside remains clearly
visible, lit by a small warm glowing ring around its camera lens casting a soft pool of
light onto its seed tray.

Inside, the room is lit only by warm practical light: the desk lamp glowing amber, the
floor lamp beside the rubber plant now switched ON casting a warm pool over the plants, the
strand of fairy lights along the wooden shelf now lit with small warm points, small
indicator lights on the 3D printer and the bluetooth speaker, and the two monitors
casting cool blue light across the desk, the keyboard and the wall behind them. Deep warm
shadows everywhere else — rich and cozy rather than black.

IMPORTANT: remove ALL daylight from the room. There must be no bright sunlit shafts or
window-shaped patches of sunlight anywhere on the floor, the rug or the walls — those are
daylight and must be replaced by warm pools of lamplight and cool spill from the monitors.

Same painterly style and same palette relationships, inverted for night. No readable text
anywhere.
```

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
with light cloud. The bird feeder, its shepherd's hook and the songbird stay exactly
where they are.
```

## D — Day / autumn (edit of A)

```text
Edit this image. Change ONLY the view outside the window — every element inside the room,
the window frame, the curtains, the lighting inside and the camera angle stay PERFECTLY
identical.

Outside it is autumn: the fruit tree has turned gold and amber with some leaves fallen on
the grass, the raised beds are spent and mostly bare with a few last plants, the grass is
duller green scattered with fallen leaves, the raspberry canes have reddened. Lower, more
golden sunlight and a slightly hazier sky. The bird feeder, its shepherd's hook and the
songbird stay exactly where they are.
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
white-blue sky. Snow caps the roof of the bird feeder, but the feeder itself, its
shepherd's hook and the songbird stay exactly where they are.
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
snow. The feeder, its shepherd's hook and the songbird stay exactly where they are.
```

---

## Still to write

- Close-up plates for each hotspot (monitor fill-frame, window fill-frame), generated as
  edits or crops of the locked day image so they inherit the same world.
