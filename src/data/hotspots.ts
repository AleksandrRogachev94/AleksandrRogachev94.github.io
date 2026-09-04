/**
 * The room's clickable objects.
 *
 * Mapped by eye against the locked day master with the `map-hotspots` skill, and stored
 * normalised so re-exporting the art at another size cannot rot them. Every variant —
 * night, and all four seasons — is a pixel-registered edit of that master, so this one set
 * of rects serves all six. Do not re-map per variant.
 *
 * **Order is tab order.** Entries run left to right across the room, because that is the
 * order a keyboard user should walk them (CLAUDE.md rule 3).
 *
 * Adding a physical object to the room is an entry here and nothing else — no change to
 * the art, the layers or the renderer (rule 6).
 */

/** Normalised against the art, origin top-left. Never pixels. */
export type NormRect = readonly [x0: number, y0: number, x1: number, y1: number];

export interface Hotspot {
  id: string;
  /** Shown on hover and focus, in the room's warm language — not the focus state's. */
  label: string;
  /** A real URL. The island intercepts it for the camera move; the page exists regardless. */
  href: string;
  /** Which accent token this destination lights once it is focused. */
  accent: string;
  /**
   * The tap target, and the box the label hangs off. Taken from the bounding box of the
   * same SAM mask the wake is baked from, so what lights up and what accepts the click
   * are the same object rather than two hand-mapped approximations of it. `pick.py
   * --mask-dir` prints this line on save; it is copied, not measured by eye.
   */
  rect: NormRect;
  /**
   * The object's own light, baked by `tools/wake.py` from the same SAM mask.
   *
   * This is the affordance, and it is deliberately a *glow the object emits* rather than a
   * contour the interface draws around it. A hairline rim was tried and had to go: it is a
   * screen-space overlay on a room whose art is always slightly in motion, and a few pixels
   * of parallax drift visibly unglues a line from the edge it is tracing. Soft light does
   * not have that failure mode, and it reads as the room reacting instead of as UI.
   */
  wake?: string;
  /**
   * Where that image sits in the frame, normalised — printed by `tools/wake.py` beside the
   * file it belongs to. The wake used to carry the whole frame and be placed with
   * `mask-size: cover`, which needed no coordinates at all; it was changed because the
   * element is `screen`-blended, a blend mode costs a repaint of the element's whole box on
   * every frame of the hover fade, and at full frame that box is the viewport. The fade
   * came in two or three visible steps. This is the arithmetic that buys it back.
   */
  wakeRect?: NormRect;
  /** Where the camera aims, normalised on the art. Separate from `rect` so a target can be
   * framed differently from how it is hit — the window aims at the feeder, not at the
   * middle of the glass. */
  aim: readonly [number, number];
  /**
   * How far away that aim point is, in the depth map's own units — 1 nearest, 0 farthest.
   *
   * Authored rather than sampled at runtime. Reading it live would mean shipping the
   * whole-frame depth plate (424KB the site otherwise never needs) and a `getImageData`
   * stall on the main thread, to answer a question about eight fixed objects. It also lets
   * a bad reading be overruled: the value under the bird feeder is contaminated by the fig
   * leaf crossing in front of it, so the window aims at the window plane instead.
   */
  disparity: number;
  /**
   * Fraction of the way to the aim point the push travels. Never 1 — the reconstruction
   * runs out of resolution before the camera runs out of distance, and the arrival is
   * covered by the focus state rather than delivered by the art.
   *
   * **Set by how much of the frame the object should end up filling, not by taste.** An
   * object at the aim depth subtends `1 / (1 - travel)` of its at-rest size, so the
   * ultrawide's 0.158 of frame width becomes 0.98 at travel 0.84 — it fills the frame
   * edge to edge, and past that its bezels leave frame while the camera magnifies a dark
   * gradient, because PROMPTS.md keeps content off the painted screen.
   *
   * **The ceiling is splat magnification, and it is per-object.** A push magnifies the
   * reconstruction by `1 / (1 - travel)`, and SHARP's 768 grid on this master is 7.17
   * master px per splat across — ~2.1 CSS px at rest on a 1600px viewport. At travel 0.84
   * that is ~13 screen px per splat, against the 9px blur and 0.12 brightness room.css
   * has faded in by the end of the push. Objects narrower than the monitor hit that wall
   * before they fill the frame: the rover would need 0.89 (~19px splats) and the feeder
   * 0.95, so both are capped below their fill target. `tools/splat_probe.py --travel`
   * prints this trade for any aim point.
   *
   * Distance also changes what the number means, because it is a fraction of the ray to
   * the target, not an absolute. 0.84 of the monitor's 4.51m is 3.8m; the same fraction
   * of the feeder's 8.31m would fly the camera through the glass.
   */
  travel: number;
  /**
   * Which focus state this hotspot opens, if one is built yet. A hotspot without one stays
   * an ordinary link to its own page — no camera move, no takeover.
   *
   * PLAN.md wants the room populated with props that are visible but inert, because three
   * live hotspots in a bare wide room feels sparse and a room where some things are not
   * clickable *yet* is exactly right. This is the same idea one layer up: the rects are
   * mapped for the whole room in one pass because that is one pass of work, and each one
   * lights up when its destination is built.
   */
  focusState?: 'bench';
}

export const HOTSPOTS: readonly Hotspot[] = [
  {
    id: 'feeder',
    label: 'the bird feeder',
    // Anchors into the real document rather than a page that does not exist yet.
    href: '/#birdlense',
    accent: 'var(--accent-birdlense)',
    // The feeder itself, not the window it is seen through. The old master had to map the
    // whole window because a monocular depth model reads glass as one flat plane and put
    // the yard on it, so aiming at the feeder aimed at a wall. The splat build
    // reconstructs the yard as real geometry at its real distance, so the hotspot can
    // finally be the thing the project is about.
    rect: [0.2458, 0.3441, 0.3051, 0.4561],
    wake: '/art/wake-feeder.webp',
    wakeRect: [0.2217, 0.2865, 0.3372, 0.4805],
    // **Not the mask centroid**, which is the one aim here that had to be authored. The
    // centroid is [0.281, 0.383] and lands on a window mullion: it measures p75 0.255 -
    // the frame at 4m - against the yard's 0.116 at 8.3m. A column scan found x=0.280
    // straddling at every height with 0.265 and 0.290 clean. Aim between the bars.
    aim: [0.265, 0.385],
    // 8.31m, measured with tools/splat_probe.py.
    disparity: 0.116,
    // Deliberately short, and NOT set by frame fill like the monitor below. The feeder is
    // 0.059 of frame width, so filling the frame would need travel 0.95 - and 0.95 of
    // 8.31m is a 7.9m translation that flies the camera through the glass and leaves the
    // room behind it. Distance changes what `travel` means: it is a fraction of a much
    // longer ray. BirdLense's focus state is a later increment and will want a close-
    // plate to carry the last stretch, as the ladder in docs/PROMPTS.md intends.
    travel: 0.55,
  },
  {
    id: 'robot',
    label: 'the rover',
    href: '/#robotrail',
    accent: 'var(--accent-robotrail)',
    rect: [0.4459, 0.7516, 0.5509, 0.9102],
    wake: '/art/wake-robot.webp',
    wakeRect: [0.4164, 0.707, 0.5821, 0.9531],
    aim: [0.5, 0.835],
    // 3.18m, and clean - p25 0.316 / p75 0.318 - because the rover sits in open floor
    // with nothing crossing in front of it.
    disparity: 0.317,
    // 0.75 of frame width. Filling it outright needs travel 0.89, which magnifies 9.1x
    // and puts one splat at ~19 screen px against the 9px veil room.css fades in: at
    // 0.105 of frame width the rover runs out of reconstruction before it runs out of
    // frame. RoboTrail's focus state is a later increment; revisit then.
    travel: 0.86,
  },
  {
    id: 'monitor',
    label: 'the software bench',
    href: '/software',
    accent: 'var(--accent-flowlab)',
    // The ultrawide alone, not the pair. Framing both put the aim point in the *gap*
    // between two bezels, so the camera spent the whole approach converging on a seam and
    // the arrival never read as landing on a screen. The vertical secondary stays room,
    // like the guitar and the printer. The stand is deliberately NOT in the mask: it is
    // only 6% of the area, but it sits in the wake's near-crisp *fill* rather than in its
    // outward spill, so it read as an emissive pillar under the screen. The screen is the
    // thing that lights up; the stand receives that light like the desk does.
    rect: [0.6434, 0.3981, 0.8011, 0.5254],
    wake: '/art/wake-monitor.webp',
    wakeRect: [0.6083, 0.3359, 0.8358, 0.5794],
    // The screen's own centre, which is now also the mask centroid (0.457) since the
    // stand came out.
    aim: [0.723, 0.457],
    // 4.51m. Spread across the sample window is 0.001 - a flat frontal panel is the
    // easiest thing in the room to get a depth reading on.
    disparity: 0.221,
    // **Set by frame fill, and the fill is now ~1.0 rather than the 0.76 it was.** At
    // 0.158 of frame width the screen reaches 0.98 of the frame at travel 0.84, which is
    // the point of diminishing return in both directions: past it the bezels leave frame
    // and the camera is magnifying a dark gradient, because PROMPTS.md keeps content off
    // the painted screen and there is nothing further in to see.
    //
    // The cost is measured, not assumed: 6.25x magnification puts one splat at ~13 screen
    // px on a 1600px viewport, against the 9px blur and 0.12 brightness room.css has
    // faded in by the end of the push. If that ever reads badly, this number is the dial.
    travel: 0.84,
    focusState: 'bench',
  },
];

export const hotspotById = (id: string) => HOTSPOTS.find((h) => h.id === id);
