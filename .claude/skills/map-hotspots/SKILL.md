---
name: map-hotspots
description: Locate hotspot rectangles in a room render and emit src/data/hotspots.ts. Use when new or regenerated room art needs its clickable object regions mapped, or when existing hotspot rects need to be re-fitted or verified.
---

# Mapping hotspots in the room art

The room's clickable objects are hand-mapped, once per locked master image. No object
detector is used: the props here (a SMARS robot, a 3D-printed feeder, a drift poster) are
not in any detection dataset, and there are perhaps eight of them. Reading the image
directly is both more accurate and less work than training or prompting a detector.

Do not eyeball coordinates off a single glance at the full image — that consistently
lands 3–8% out. Use the loop below; it converges in two or three passes.

## Setup

`hotspot_tool.py` needs Pillow. If `python3 -c "import PIL"` fails, make a venv in the
scratchpad directory and use its interpreter:

```
python3 -m venv "$SCRATCH/venv" && "$SCRATCH/venv/bin/pip" -q install pillow
```

Work on the **master** in `art/`, not the downscaled copy in `public/art/`, and write all
intermediate PNGs to the scratchpad — none of them belong in the repo.

## The loop

**1. Coarse read.** Overlay a labelled grid and look at it.

```
python3 hotspot_tool.py grid art/room-day-summer.png $SCRATCH/grid.png --cols 20 --rows 12
```

Read `$SCRATCH/grid.png`. Every cell is labelled (`A1`, `B1`, …) and the command prints
the normalised cell size. For each object, note the cells it spans and convert to a
normalised `x0,y0,x1,y1`. This pass only needs to be within a cell or so.

**2. Refine, one object at a time.** Crop around the candidate rect with padding, so the
proposed edge is visible against what lies just outside it.

```
python3 hotspot_tool.py crop art/room-day-summer.png $SCRATCH/monitor.png \
  --rect 0.55,0.31,0.79,0.52
```

Read the crop. The green box is the proposed rect; the padding around it shows what you
are cutting off. Adjust and re-run until the box contains the whole object and little
else. Two iterations is typical.

**3. Verify all rects together.** Write the candidates to JSON and draw them back onto
the full image.

```
python3 hotspot_tool.py draw art/room-day-summer.png $SCRATCH/check.png --rects $SCRATCH/rects.json
```

Read `$SCRATCH/check.png` and confirm: every rect sits on its object, no two overlap, and
nothing important is unmapped. Overlap matters — overlapping rects make the topmost
button swallow clicks meant for its neighbour.

**4. Emit.** Write `src/data/hotspots.ts` with the rects in normalised coordinates.

## Rules

- **Normalised 0–1, origin top-left.** Never store pixels. The master gets re-exported at
  different resolutions and pixel rects silently rot.
- **Rects are shared across every variant.** Day, night and all four seasons are edits of
  the locked day image and register to it pixel-for-pixel, so one set of rects serves all
  six. Map against the day master and do not re-map per variant.
- **Size for the hand, not for the object.** A hotspot smaller than roughly 0.05 × 0.05
  normalised is an unusable tap target on a phone. Grow the rect past the object's real
  outline rather than shrinking it to fit; the robot in particular is small enough to need
  this.
- **A hotspot is a real `<button>`.** The rect is its position; tab order comes from the
  order of entries in `hotspots.ts`, so write them in the order they should be walked
  (left to right across the room), not in the order you happened to map them.
