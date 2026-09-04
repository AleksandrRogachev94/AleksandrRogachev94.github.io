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

/** Which renderer-side treatment an entry gets. One per visual idea, not one per object. */
export type AmbientKind = 'steam';

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
   * How far away that patch is, in the depth map's own units (1 nearest, 0 farthest).
   *
   * Measured with `tools/splat_probe.py`, never guessed — this is what glues the overlay
   * to the art while the room parallaxes under it. An overlay pinned to the screen at the
   * room's current ambient amplitude slips by ~41px at mid-room depth, which on a patch
   * this size is the whole effect sliding off the surface it belongs to.
   */
  disparity: number;
}

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
    disparity: 0.263,
  },
];
