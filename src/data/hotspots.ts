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
   * When the room starts falling away on the approach, in `--push` units — `start` is where
   * the veil begins, `full` is where it has reached its floor (~12% brightness, 9px blur).
   *
   * **This is per-object because the thing it hides is per-object.** The veil covers
   * disocclusion and thinning reconstruction, and those arrive on a schedule set by
   * magnification and by how much real geometry SHARP has for that surface. The monitor is
   * a flat frontal panel 4.5m away that the reconstruction resolves well, so it can stay
   * legible until 0.45 — and it *must*, because its panel appears inside the room and a
   * seam matters. The feeder is 8.3m out, off-axis, and seen through glass; magnifying it
   * finds black holes where SHARP has nothing, and it needs the room gone much earlier.
   *
   * The feeder can afford that because it cuts rather than expanding a panel out of itself
   * (WindowFocus.tsx). Nothing has to survive the handoff for a cut, so there is no reason
   * to keep the room readable up to it. **The arrival grammar and the veil schedule are the
   * same decision**, which is why one being wrong made the other look wrong too.
   *
   * Optional: unset falls back to the monitor's curve (`DEFAULT_VEIL` in Room.tsx — the
   * stylesheet only declares `--veil-t: 0` and does no scheduling of its own). Every
   * destination that has been built now authors one; the fallback exists for the ones that
   * have not.
   */
  veil?: { start: number; full: number };
  /**
   * Which focus state this hotspot opens, if one is built yet. A hotspot without one stays
   * an ordinary link to its own page — no camera move, no takeover.
   *
   * PLAN.md wants the room populated with props that are visible but inert, because three
   * live hotspots in a bare wide room feels sparse and a room where some things are not
   * clickable *yet* is exactly right. This is the same idea one layer up: the rects are
   * mapped for the whole room in one pass because that is one pass of work, and each one
   * lights up when its destination is built.
   *
   * **The value names a destination, not a transition.** Two of the three cut rather than
   * expanding a panel out of their own rect, and Room.tsx works that out from `!== 'bench'`
   * rather than from a flag here — the monitor is the only object in the room that really
   * is a screen, so it is the exception and everything else is the rule.
   */
  focusState?: 'bench' | 'window' | 'rover';
}

export const HOTSPOTS: readonly Hotspot[] = [
  {
    id: 'feeder',
    label: 'the bird feeder',
    // A real page of its own now, not an anchor into the home document. Rule 2 wants every
    // destination to have a URL that stands up on its own — crawlable, shareable, and the
    // thing a visitor with JavaScript off or reduced motion on actually lands on. It got one
    // the moment there was enough to say to fill a page.
    href: '/birdlense',
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
    // Dark by 0.70, i.e. with 30% of the push still to run. Off-axis at 8.3m through glass
    // is the worst case in the room for the reconstruction, and the last third of this
    // approach is where the black holes open up. Nothing needs to be legible at the end of
    // it: the arrival is a cut.
    veil: { start: 0.15, full: 0.70 },
    // The short push is why this focus state opens on the feeder's own camera rather than
    // on a panel: at 0.55 the camera hands over a long way out, and a rectangle growing out
    // of a bird feeder would be claiming the feeder is a screen. See WindowFocus.tsx.
    focusState: 'window',
  },
  {
    id: 'robot',
    label: 'the rover',
    // A real page, not an anchor — same move BirdLense made, and for a sharper reason. This
    // used to be `/#robotrail`, pointing into a section of the home document; that section
    // was a second showcase competing with the room and it is gone, so the paragraph moved
    // to a page of its own. A destination whose only URL is a fragment of a page that no
    // longer has it is exactly what rule 2 exists to prevent.
    href: '/robotrail',
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
    // frame. Unchanged now that the destination exists: the arrival is a cut, so nothing
    // has to register against the art at the handoff and there is no reason to push
    // further into a reconstruction that is already at its limit.
    travel: 0.86,
    // Later than the feeder's 0.15, earlier than the monitor's 0.45, and both ends are the
    // same fact: the rover is 3.18m away in open floor with the cleanest depth reading in
    // the room (spread 0.002), so the first third of this push is the best parallax the
    // reconstruction has to offer and dimming it early would be throwing away the argument
    // for the whole renderer. It still has to be gone before the end, because 7.1x
    // magnification puts one splat at ~15 screen px — so the veil finishes at 0.80 and the
    // last fifth is a smear nobody reads.
    veil: { start: 0.35, full: 0.80 },
    // Cuts, like the window and unlike the bench. See RoverFocus.tsx for why a placeholder
    // gets to borrow a verb but not invent one.
    focusState: 'rover',
  },
  {
    id: 'monitor',
    label: 'the monitor',
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
    // The values room.css has always used, stated here now that they are one object's
    // answer rather than the room's. Late and gentle on purpose: the bench's panel appears
    // *inside* this room and grows out of this rectangle, so the room has to still be a
    // room at the handoff. The first half of the push is left completely unfiltered because
    // the parallax is the whole argument for the reconstruction.
    veil: { start: 0.45, full: 1.0 },
    focusState: 'bench',
  },
];

export const hotspotById = (id: string) => HOTSPOTS.find((h) => h.id === id);
