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
   * same SAM mask the rim is derived from, so what lights up and what accepts the click
   * are the same object rather than two hand-mapped approximations of it.
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
   * Fraction of the way to the aim point the push travels. Never 1 — the mesh smears and
   * the master goes soft long before then, and the arrival is covered by the focus state
   * rather than delivered by the art.
   *
   * **Set by how much of the frame the object should end up filling, not by taste.** An
   * object at the aim depth subtends `1 / (1 - travel)` of its at-rest size, so the
   * ultrawide's 0.168 of frame width becomes 0.76 at travel 0.78 — it dominates the frame
   * without the camera ever trying to reconstruct the last stretch, which is the part a
   * displaced mesh cannot deliver. The screen itself carries the rest of the distance by
   * becoming the panel.
   *
   * The ceiling on that number is the depth *spread* around the target, not the distance
   * to it: the global excursion readout in /dev/room is a worst case dominated by whatever
   * is nearest in frame — here the fig, which leaves frame early in a push to the right.
   * Around the monitor the real spread is desk (0.358) against alcove wall (0.299), which
   * at travel 0.78 asks for ~153px of painted band against the 344px the plates carry.
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
    id: 'window',
    label: 'the window',
    // Anchors into the real document rather than a page that does not exist yet. The
    // window is mapped now because mapping is one pass for the whole room; BirdLense's own
    // focus state and page are a later increment.
    href: '/#birdlense',
    accent: 'var(--accent-birdlense)',
    rect: [0.048, 0.0, 0.412, 0.72],
    wake: '/art/wake-window.webp',
    wakeRect: [0.0131, 0.0, 0.4469, 0.776],
    // The feeder, which is the subject — but at the window plane's depth, because the
    // depth model reads glass as one flat surface and the yard behind it is not in the map.
    aim: [0.18, 0.44],
    disparity: 0.3,
    travel: 0.6,
    // BirdLense's focus state is a later increment; until then this is a plain link.
  },
  {
    id: 'monitor',
    label: 'the software bench',
    href: '/software',
    accent: 'var(--accent-flowlab)',
    // The ultrawide alone, not the pair. Framing both put the aim point in the *gap*
    // between two bezels, so the camera spent the whole approach converging on a seam and
    // the arrival never read as landing on a screen. The ultrawide is the surface the
    // bench becomes; the vertical secondary stays room, like the guitar and the printer.
    rect: [0.726, 0.424, 0.894, 0.616],
    wake: '/art/wake-monitor.webp',
    wakeRect: [0.6919, 0.362, 0.9281, 0.6628],
    // The screen's own centre, so the panel that grows out of it is growing out of the
    // thing you were looking at.
    aim: [0.81, 0.52],
    disparity: 0.314,
    travel: 0.78,
    focusState: 'bench',
  },
];

export const hotspotById = (id: string) => HOTSPOTS.find((h) => h.id === id);
