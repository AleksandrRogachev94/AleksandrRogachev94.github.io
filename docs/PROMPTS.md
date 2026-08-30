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

**4. Generate at the largest resolution offered — 2K minimum, 4K preferred.** The camera
push travels ~70% into the frame, so the image is magnified well past native exactly when
the viewer is closest. A 1024px-wide render goes visibly soft at the end of the push.

**5. No readable text anywhere, ever.** Image models garble it, and the paper note is a
hotspot whose label is rendered by the site, not painted in.

## Asset ladder

| #   | Asset                   | Produced by              | Master filename            |
| --- | ----------------------- | ------------------------ | -------------------------- |
| A   | Day / summer (base)     | generation, prompt below | `room-day-summer.png`      |
| B   | Night / summer          | edit of A                | `room-night-summer.png`    |
| C   | Day / spring            | edit of A                | `room-day-spring.png`      |
| D   | Day / autumn            | edit of A                | `room-day-autumn.png`      |
| E   | Day / winter            | edit of A                | `room-day-winter.png`      |
| F   | Night / winter          | edit of B                | `room-night-winter.png`    |

Summer needs no variant — A and B _are_ summer. Night in spring and autumn is
indistinguishable through dark glass, so only winter earns a night variant.

From C–F we crop the window region and composite it behind the window plane at runtime.
A and B ship whole.


## Where the files live

```
art/                 masters, committed, never served — untouched generator output
public/art/          what the site loads: WebP, resized, plus depth maps
```

Naming is `room-{time}-{season}.png` for masters and `.webp` for what ships, with
suffixes for derived assets:

| Suffix    | Meaning                                      | Example                      |
| --------- | -------------------------------------------- | ---------------------------- |
| `-depth`  | depth map, same dimensions as its colour art | `room-day-summer-depth.webp` |
| `window-` | window region cropped from a seasonal edit   | `window-winter.webp`         |
| `close-`  | fill-frame close-up plate for one hotspot    | `close-monitor.webp`         |

Hotspot rectangles are **not** files — they live in `src/data/hotspots.ts` in normalised
0–1 coordinates, so re-exporting the art at a different size does not invalidate them.
They are mapped once against the day master with the `map-hotspots` skill, and because
every variant is a pixel-registered edit of that master, one set of rects serves all six.

## Depth

One depth map serves every variant, because the interior is identical across all of them.
Produce it once, from A, and never per-variant.

**The window is not in the depth map.** Depth Anything reads the yard as roughly the same
distance as the room — painterly art has no atmospheric perspective, so the fence at
fifteen metres is painted as crisp and saturated as the desk at two, and the model has no
cue to work from. Removing the glazing does not fix this; it was tried, and the yard still
came back at interior depth.

So the yard does not go through the depth model at all. It is a **separate layer behind
the window plane** — which the seasonal swap already required, since C–F exist precisely
to have their window region cropped and composited in. Two layers:

- **Room layer** — image A with the window panes cut to transparent. The muntin bars and
  the frame stay opaque and stay on this layer, so they hold still against the moving yard,
  which is the whole occlusion cue. The pane mask is generated from the window rect and the
  6-over-6 grid, then touched up at the curtain edges.
- **Yard layer** — the window region, drawn on its own quad set back behind the room plane.
  Parallax then falls out of the geometry: move the camera and the yard slides against the
  frame, exactly as a real window behaves.

Flat is fine for the yard quad. If the feeder ever needs to parallax against the fence,
hand-author a gradient for it — do not go back to the depth model, and do not let the yard's
range grow. A large depth step at the window edge is what tears a displaced mesh.

Two consequences worth remembering: the window and feeder **hotspot rects live in yard-layer
space** and must take the yard quad's parallax offset, not the room's; and Depth Anything's
output for the interior is a starting point, not a deliverable — expect to hand-correct the
cropped foreground plant and the dracaena fronds (thin foliage reads far), and to flatten the
poster and the guitar back onto the wall plane.

---

## A — Day / summer (base generation)

Attach: `[ANCHOR]` (the previously approved daytime image, style reference only) plus the
photo references `[DESK]`, `[SUNROOM]`, `[YARD]`, `[FEEDER]`, `[ROBOT]`.

```text
Create a single wide interior illustration, 16:9, very high detail.
The attached [ANCHOR] image is a STYLE REFERENCE ONLY. Match its rendering style,
brushwork, color palette, warmth and general spatial layout. Do NOT copy its monitor
proportions and do NOT copy its bird feeder placement — for those two things follow the
written instructions below exactly, as they are corrections to the anchor. Use the other
attached photos only as subject reference for specific objects; do not copy any photo's
camera angle, lighting or photographic look.

STYLE: Warm painterly digital illustration, like a background painting from a modern
animated feature. Soft visible brushwork, rich layered color. NO black ink outlines, NO
flat cartoon fills, NO vector or clip-art look, NO cel shading. Real material weight:
wood grain, metal sheen, glass, soft fabric. Entire frame in sharp focus — no bokeh, no
depth-of-field.

LIGHTING — treat as high priority:
Strong directional late-morning sun through the left windows throwing distinct bright
shafts across the wooden floor, with genuinely DEEP soft shadows pooling beneath the
desk, beneath the console cabinet and behind the chair. High contrast between lit and
shadowed areas — not evenly lit.
The monitors are clearly emitting light: a cool glow washing across the desk slab, over
the keyboard, and onto the wall behind them. A warm desk lamp adds amber. Cool daylight
and warm lamplight meet in the middle of the room.

COMPOSITION: The corner of a room, seen wide from slightly above standing eye level,
pulled back. Two walls meet near center-right and the floor recedes convincingly.
Foreground, midground and background clearly separated. The desk and both monitors sit
fully inside the frame with breathing room — nothing on the desk is cropped by the frame
edge.

FOREGROUND, bottom-left, cropped by the frame edge: a large leafy potted plant in a
terracotta pot, close to the camera, softly shadowed, clearly nearest the viewer. It must
not overlap the window or the desk.

LEFT WALL: tall white multi-pane windows in a six-over-six grid, sheer curtains drawn to
the sides. The window frame and every one of its white dividing bars must be complete and
unbroken across the entire window — no missing or interrupted sections anywhere.

OUTSIDE, beyond the glass: a sunlit summer backyard with a wooden privacy fence, raised
vegetable beds in full growth, a young fruit tree in leaf, raspberry bushes, several
potted citrus trees on a stone patio, the roofline of a neighboring house, blue sky with
light cloud.

THE BIRD FEEDER IS OUTDOORS IN THE GARDEN, NOT INSIDE THE ROOM. It hangs from a tall
metal shepherd's hook whose base is clearly planted in the garden bed outside and visible
through the glass.
CRITICAL: the white window dividing bars must be drawn ON TOP OF the feeder and its hook,
passing IN FRONT of them, exactly as they pass in front of the trees and fence outside.
The feeder is BEHIND the glass and BEHIND the window grid. Never draw the feeder or its
hook over the top of the window bars. It is modest in
size and reads as set back in the yard, with a faint reflection of glass across it. Matte
brown 3D-printed plastic, a boxy hopper with a wide peaked roof, a seed tray along the
front, a small dark camera lens in a square recess in its back wall, a cylindrical suet
cage hanging from one side arm. One small songbird perched on the tray.

LEFT-CENTER, against the window wall: a white console cabinet used as a maker bench. At
its far left end, a small modern bluetooth speaker — a compact fabric-covered cylinder in
muted warm grey with a subtle indicator light. Beside it, an open-frame FDM 3D printer
with a black aluminium extrusion frame, a filament spool on top, a small control screen,
mid-print. Next to the printer, a small round black disc-shaped robot about the size of a
dinner plate, its top plate removed to expose a Raspberry Pi board, a tangle of red,
yellow, blue and black jumper wires, a small camera and a stubby antenna — charming and
hand-built, not sleek.
Around the bench, large leafy houseplants and a tall dracaena. A slim modern floor lamp
stands beside the dracaena, switched OFF in this daylight scene. Pothos vines trail from
a high shelf.

RIGHT, in the corner, FULLY IN FRAME: a live-edge wooden slab desk with a turquoise epoxy
river running through it, on a black electric standing-desk frame.
A curved ultrawide monitor in normal 21:9 proportions — wide, but NOT extremely
elongated, and not dominating the frame. Beside it a second monitor rotated vertical,
angled slightly toward the viewer, fully visible as a clearly distinct separate screen.
Both screens are ON, showing only a soft dark abstract glow with NO interface and NO
readable content, but casting clearly visible light onto the desk and the wall.
On the desk: a white mechanical keyboard, a dark mousepad, over-ear headphones resting
beside the keyboard, a ceramic mug, a warm desk lamp, and a small pale paper note leaning
against the base of the ultrawide monitor. THE NOTE IS COMPLETELY BLANK — no letters, no
words, no numbers, no writing of any kind.
A white-and-black mesh office chair turned slightly, positioned so it does not block the
monitors. Cables visible but tidy.

RIGHT WALL: an electric guitar on a wall mount — Les Paul style single-cutaway body,
sunburst finish, gold hardware. A small wooden shelf with a few worn books and a trailing
plant, with a strand of small warm fairy lights draped along its edge, switched OFF in
this daylight scene. A small framed poster showing two sports coupes drifting in tandem,
seen from a low three-quarter front angle with thick tire smoke billowing behind them:
the lead car a white Nissan Silvia S15 with falkon bold green and blue graphic stripes along its
flank, front wheels turned on opposite lock; close behind it a BMW 2 Series coupe (F22)
in gloss black with one wide matte-white stripe running over the hood and roof, angled
the same way.
Stylized and graphic, with a deliberately limited palette — the white lead car, the black
chase car, grey smoke and blue sky. No
lettering, no numbers, no sponsor logos, no badges.

FLOOR: warm wide-plank wood, a soft rug beneath the desk, bright sunlight falling across
the boards.

MUST AVOID: people, pets, babies, baby gear, toys, swimming pool, sim racing rig, racing
wheel, pedals, desktop PC tower, laptop, RGB lighting, fireplace, mess or laundry on the
floor, oranges, record player or turntable, any readable text, letters, numbers, logos or
brand names anywhere in the image, mirrors, reflections on the screens, motion blur, lens
flare, watermark, signature. Tidy but lived-in — not sterile, not cluttered.
```

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
floor lamp beside the dracaena now switched ON casting a warm pool over the plants, the
strand of fairy lights along the wooden shelf now lit with small warm points, small
indicator lights on the 3D printer and the bluetooth speaker, and the two monitors
casting cool blue light across the desk, the keyboard and the wall behind them. Deep warm
shadows everywhere else — rich and cozy rather than black.

IMPORTANT: remove ALL daylight from the room. There must be no bright sunlit shafts or
window-shaped patches of sunlight anywhere on the floor, the rug or the walls — those are
daylight and must be replaced by warm pools of lamplight and cool spill from the monitors.

Same painterly style and same palette relationships, inverted for night. No readable text
anywhere. The paper note stays blank.
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
