/**
 * The room's ambient life: cheap, decorative motion that no visitor ever asks for.
 *
 * This is the *ambient tier* CLAUDE.md rule 1 carves out. It is deliberately not a live
 * element and never registers with `src/scripts/stage.ts` — a live element means heavy
 * work (a sim, a video, a cross-origin iframe), and everything here is a CSS animation on
 * a compositor layer, costing no JavaScript per frame and no GPU work worth the name.
 * There is nothing for the one-at-a-time rule to protect against.
 *
 * **The organising idea: animate the light, not the objects.** The room is one static
 * Gaussian reconstruction, so nothing painted in it can be made to move without deforming
 * geometry. But light is not an object — it is a screen-blended overlay, which is exactly
 * what the DOM is good at, and exactly what `.hotspot__light` already proves composites
 * correctly over the canvas. A silhouette bird pasted next to the painted one would read
 * as a sticker; a caustic that shimmers reads as the sun.
 *
 * Every entry is authored against the locked day master, the same way hotspot rects are
 * (rule 6, and "prefer authoring over inference" throughout PIPELINE.md). Nothing here is
 * sampled at runtime.
 *
 * **Removed, and worth not rebuilding: a shimmer on the prism's painted rainbow.** It was
 * the first entry here and it never earned its place. Two things were learned on the way
 * out and both generalise:
 *
 * 1. `screen` only shows where the backdrop has headroom. The prism's spectrum lies on a
 *    bright cream cabinet with none, so a screen-blended rainbow over it was invisible,
 *    and what little it did do walked saturated colour toward white. This is the same
 *    finding room.css records at `.hotspot__light`. The steam below works *because* its
 *    backdrop is a dark monitor panel. Check the backdrop before choosing the blend.
 * 2. `backdrop-filter` fixes that — it saturates the pixels already there rather than
 *    painting over them — but it is fragile: paint containment, `filter`, `mask` and
 *    `will-change` of those all create a backdrop root, and any of them between the
 *    element and the canvas silently turns the effect into nothing.
 *
 * What actually killed it was neither. On a patch that small, a caustic that shimmers is
 * a detail nobody looks at, and the version that *was* visible read as a rectangle sliding
 * over the art. Effects here have to be worth finding.
 */

import type { NormRect } from '../scripts/roomGeometry';

/**
 * Which treatment an entry gets. One per visual idea, not one per object.
 *
 * There were three. `blink` (a point light on a device) and `flicker` (a screen's own glow)
 * turned out to be the same element with two numbers in it — a soft radial bloom, screen
 * blended, keyframed opacity — differing only in how far the light spreads past the thing
 * emitting it and at what cadence. They are one `glow` now, tuned per id in room.css, and
 * collapsing them is also what fixed the monitor: the "screen" treatment was a hard-edged
 * rectangle of added colour, and you could see the box.
 */
export type AmbientKind = 'steam' | 'glow';

export interface AmbientEffect {
  id: string;
  kind: AmbientKind;
  /**
   * Where the effect sits on the master, normalised — the extent of the *painted* light it
   * animates, not of the object that casts it. The prism's entry is the spectrum on the
   * cabinet top; the glass pyramid itself does not move and needs no overlay.
   */
  rect: NormRect;
  /**
   * How far away that patch is, **in metres** — see the note on `Hotspot.distanceM`.
   *
   * Measured with `tools/splat_probe.py`, never guessed — this is what glues the overlay
   * to the art while the room parallaxes under it. An overlay pinned to the screen at the
   * room's current ambient amplitude slips by ~41px at mid-room depth, which on a patch
   * this size is the whole effect sliding off the surface it belongs to.
   */
  distanceM: number;
  /**
   * The light's own colour, for the electronic tells. Defaults to warm white.
   *
   * These are the destination accents, and that is not decoration leaking in from the UI —
   * a camera's status LED is green and a robot's is amber in the world too, and the accents
   * were chosen to belong to these objects in the first place. It does mean the room quietly
   * previews each destination's colour, which is a bonus rather than the reason.
   */
  accent?: string;
}

/**
 * **The organising rule, and the one a visitor actually learns: the things you can enter are
 * the things that are alive.**
 *
 * The room is a still painting except where something moves, and every hotspot has its own
 * small electronic tell. Nothing announces it; you notice within a few seconds that the
 * feeder's camera is blinking and the rover's panel is breathing, and that is the whole
 * affordance. It replaces a corner list of destinations that was built and removed — a
 * literal index is website chrome sitting on a painting, and PLAN.md's own rule is that the
 * room carries no lists. It also reaches the input the wake cannot: `:hover` and
 * `:focus-visible` do not exist on a phone, and a blinking light does.
 *
 * **The mug is not a counterexample.** Steam is drifting vapour on a hot drink; the tells are
 * point lights on an electronic cadence. They are different vocabularies and nobody confuses
 * them, so "alive" reads as "this machine is on" rather than as "click here". Adding warm
 * ambient life to *non*-interactive props is therefore fine and does not weaken the rule —
 * adding a blinking LED to one would.
 *
 * Every rect below is measured off the locked day master, not estimated: the feeder's entry
 * is the camera module visible inside the feeder box, and the rover's is the indicator
 * cluster on its front panel. Disparities are the ones already measured for those objects'
 * hotspots, because a light on an object is at that object's depth.
 */
export const AMBIENT: readonly AmbientEffect[] = [
  {
    id: 'mug',
    kind: 'steam',
    /**
     * The column of air above the mug on the desk, not the mug itself.
     *
     * Steam is `screen`-blended — it is real added light, so unlike a tint it is the right
     * use of that blend — but `screen` only shows where the backdrop has headroom left.
     * Above the mug is the secondary monitor's dark panel, which has nothing but headroom;
     * the lit lamp to its right has none. So the panel is what makes this effect visible
     * at all, and the column has to live on it.
     *
     * **Measured, and got there by overshooting in both directions.** The mug's body
     * centres on x 0.848 (pale ceramic, sampled on the row below the rim) and its rim is at
     * y 0.565. The dark panel's right edge is 0.8577 between y 0.45 and 0.51.
     *
     * The first column was centred on 0.845, which drawn over the master sat on the mug's
     * *handle* rather than the cup. Correcting it by biasing left onto the panel then made
     * it worse, not better: the axis moved to 0.835 while the wisps were already drifting
     * up to 38% of their own width further left, so the plume's visible centre landed near
     * 0.832 and read as rising beside the mug rather than out of it. **Both had to be
     * fixed at once** — a plume detached from its source is a worse artifact than one
     * slightly off-centre, and the drift is part of the position, not a separate dial.
     *
     * So: centred on the cup, and the two keyframe sets now lean opposite ways so their
     * mean drift is about zero. The right edge sits a little past the panel; wisps that
     * stray there simply fade, which is the correct behaviour and not worth narrowing the
     * column to avoid.
     *
     * The base sits at y 0.570, just *below* the rim at 0.565 rather than above it. Each
     * wisp's first keyframe also starts 16% of its own height lower still, so the plume
     * forms at the cup's mouth instead of appearing in the air above it.
     */
    rect: [0.828, 0.450, 0.868, 0.570],
    // 3.81m. tools/splat_probe.py reports median 0.263 at the rim and 0.262 a third of the
    // way up the column, so the whole plume sits at one depth and needs only one number.
    distanceM: 3.92,
  },
  {
    id: 'feeder-lens',
    kind: 'glow',
    /**
     * BirdLense's camera, which really is painted into the master — a dark module set back
     * inside the feeder box, visible through the window between two mullions. So this is not
     * a light invented and stuck onto the art; it is the light the thing in the picture
     * would actually be showing.
     *
     * Measured off a 2.2x crop of the feeder's `wakeRect`. Backdrop headroom is good: the
     * housing is the darkest surface in that window, which is what `screen` needs (see the
     * prism note above — that is the effect that died for want of it).
     *
     * PLAN.md already wanted this for the night variant, where the window would otherwise go
     * black and read as dead. Building it for day means night is a tuning change rather than
     * a new effect.
     *
     * **At night this is now the only ring there is — deleting it puts the feeder out.** The
     * night masters used to paint a glowing ring here and this bloom sat on top of it. They
     * no longer do, because the feeder is ~11 splats across at 8.29m and a glow in mid-air
     * has no surface for SHARP to attach it to, so the painted ring reconstructed as a broken
     * C that smeared across the glass, the feeder and the fence under lateral motion. The
     * masters keep what a reconstruction *can* hold — a dark lens and a warm pool lying flat
     * on the seed tray — and the ring moved here, where it is not geometry, cannot smear, and
     * gets to blink. docs/PROMPTS.md section B carries the full argument.
     *
     * That makes `room.css`'s `led-record` baseline load-bearing rather than decorative: it
     * rests at 0.10 between pulses, a floor chosen when paint was carrying the ring and this
     * only had to modulate it. If the feeder reads dead between pulses at night, that floor
     * is the dial — not the accent and not the rect.
     */
    rect: [0.2785, 0.3734, 0.2870, 0.3992],
    // The feeder's own hotspot distance. The window plane reading is contaminated by
    // the fig leaf crossing in front, which is why that number is authored there too.
    distanceM: 8.29,
    accent: 'var(--accent-birdlense)',
  },
  {
    id: 'rover-status',
    kind: 'glow',
    /**
     * The indicator cluster on the rover's front panel — the round port and the two slots
     * below the deck, measured off a 1.54x crop of its `wakeRect`.
     *
     * Slower than the feeder's, and it breathes rather than blinking: the feeder is a camera
     * taking a frame, the rover is a machine idling. Same effect, different cadence, and the
     * cadence is what stops two lights in one room reading as one animation applied twice.
     *
     * **Idling is the right word now that the destination exists.** This light shipped
     * before the rover had a real focus state, on PLAN.md's argument that a room should be
     * populated with things visible before they are finished. What it turned into is better
     * than that: the panel you arrive at is the rover *driving*, so the breathing light in
     * the room and the autonomous run behind the cut are the same machine in two states,
     * and the room reads as the place the run happens in.
     */
    rect: [0.5026, 0.8592, 0.5220, 0.8749],
    // 3.18m, and clean — the rover sits in open floor with nothing crossing in front of it.
    distanceM: 3.24,
    accent: 'var(--accent-robotrail)',
  },
  {
    id: 'monitor-glow',
    kind: 'glow',
    /**
     * The ultrawide's own glow, wobbling very slightly — a screen that is on rather than a
     * screen that is painted.
     *
     * The screen rect itself, from hotspots.ts — but it is the light's *source*, not its
     * extent. The first version painted the rect: a screen-blended rectangle, inset 0, with a
     * 4px corner radius, which is a box of added colour with a visible step at every edge. A
     * monitor's light does not stop at the bezel; it lands on the desk and the wall behind
     * it. The glow now blooms well past this rect and falls to nothing before it gets there,
     * so there is no edge to see (room.css, `--bloom`).
     *
     * It has more `screen`-blend headroom than anything else in the room: PROMPTS.md keeps
     * content off the painted screen, so it is a near-black rectangle with a teal spill.
     *
     * Amplitude is still the lowest of the three per unit area — this surface is ~750x an
     * indicator — but the *peak* is higher than the flat fill's was, because a radial falloff
     * only reaches full strength at one point.
     */
    rect: [0.6434, 0.3981, 0.8011, 0.5254],
    // 4.51m. A flat frontal panel is the easiest thing in the room to get a depth reading on.
    distanceM: 4.67,
    accent: 'var(--accent-flowlab)',
  },
];
