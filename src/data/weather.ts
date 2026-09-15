/**
 * Weather in the yard: leaves falling in autumn, snow in winter.
 *
 * **Why this is not the particle field PLAN.md ruled out.** That entry bans cosmos, drifting
 * dot fields and glowing node graphs — decoration with no referent, pinned to the screen,
 * standing in for an idea the page does not otherwise have. The test that separates them is
 * whether the effect survives the camera: a starfield is stuck to the viewport and dies the
 * moment anything moves, because it was never anywhere. This is at 4.5-6.2 metres, behind
 * glass, occluded by the mullions and the wall, and it parallaxes with the yard because it is
 * *in* the yard. It is the same claim the ambient tier already makes (data/ambient.ts):
 * animate what the room would actually be doing, not what a website would.
 *
 * It is also the one thing the seasons could not say. Three reconstructions changed the
 * yard's colour and its geometry, and the room still reads as a photograph of a season rather
 * than a day in one. Snow that is lying is a texture; snow that is falling is weather.
 *
 * **The whole effect rests on one property of the splat build**, and it is worth stating
 * plainly because it is what makes this cheap instead of hard. splatRenderer.ts draws with
 * `DEPTH_TEST` disabled — occlusion comes entirely from compositing back to front in a
 * precomputed order. So anything inserted into that sequence at the right point is occluded
 * by everything nearer and occludes everything farther, *for free and with no depth buffer*.
 * The mullions hide flakes passing behind them, the wall hides every flake outside the
 * opening, and the fig leaf crossing the glass covers them and parallaxes against them
 * correctly. None of that is coded anywhere. It falls out of one split in one draw call.
 *
 * **What was rejected:** a CSS overlay in the ambient tier, which is where this obviously
 * belonged. It is a screen-space rectangle drawn over the canvas, so it paints over the
 * mullions and the fig like a sticker, and the mask that would fix it cannot exist —
 * `pinToArt` glues an overlay at *one* depth, and at the room's drift amplitude a
 * fig-shaped hole pinned at the glass's 8.3m slips about 100px away from the actual fig,
 * which is at a little over a metre. The mask detaches from the thing it is masking. The
 * renderer needs no mask at all.
 */

import type { Daylight } from '../scripts/daylight';
import type { Season } from '../scripts/season';

/**
 * Where the yard is, as a rectangle on the locked day master, and how deep a slab of it the
 * weather occupies. Authored from measurement, the same way every other rect in `src/data` is.
 *
 * **The rect deliberately overshoots the window opening.** Measured across all six
 * reconstructions (the bounding box of every splat deeper than 6.5m, which is the yard and
 * nothing else), the opening spans x 0.06-0.41 and y 0.02-0.60; winter is the widest because
 * its bare branches show sky where summer has canopy. The rect below is looser than that on
 * every side, and that is the point: a particle's vertical cycle wraps at the rect's edge, and
 * a flake teleporting from the bottom of the frame back to the top is the one artifact a
 * looping field can show. Overshooting puts both wrap edges *behind the wall*, where the draw
 * order hides them. It costs the ~37% of particles that are outside the opening at any moment
 * and never drawn to more than a few discarded fragments.
 */
export const YARD = {
  /** x0, y0, x1, y1 on the master, normalised. Looser than the opening, on purpose. */
  rect: [0.02, -0.06, 0.46, 0.68] as const,
  /**
   * The slab the weather falls through, in metres.
   *
   * These two numbers are the entire correctness argument, so they are measured rather than
   * felt. `tools/splat_probe.py` over the window region puts the glazing bars and the window
   * reveal at 3.3-4.4m and the nearest yard content — fence, feeder, the near trunk — at
   * 6.3m and beyond. Putting the slab strictly between those two makes the single split
   * below *exactly* right rather than approximately right: every splat in the far group is
   * genuinely behind every flake, and every splat in the near group is part of the opaque
   * shell (wall, frame, mullions) that must hide the yard in any case.
   *
   * Widening it is the obvious dial and it is the wrong one. Going nearer than 4.5 reaches
   * the window reveal at 4.4m, which then covers flakes that are in front of it; going
   * farther than 6.2 reaches real yard geometry, which then sits behind flakes it should
   * hide. Either way the failure is at the window's edge where the eye already is. If more
   * depth is genuinely wanted, the fix is more splits, not a bigger slab — see `SPLIT_M`.
   */
  bandM: [4.5, 6.2] as const,
} as const;

/**
 * Where the draw sequence is cut so the weather can be composited into it.
 *
 * splatRenderer.ts draws its splats far-to-near in one call. With weather up it draws
 * `[0, split)`, then the particles, then `[split, N)`, where `split` is the number of splats
 * deeper than this. Because the order is already sorted, finding it is a binary search done
 * once per cloud at load — there is no per-frame cost and nothing is re-sorted.
 *
 * 6.25m: inside the gap `YARD.bandM` was chosen to sit in, just past the far edge of the slab
 * and just short of the nearest yard geometry. A splat landing in the 6.2-6.25m sliver is the
 * only thing that can be ordered wrongly, and the measured histograms put almost nothing
 * there.
 *
 * **If a deeper snowfall is ever wanted, this becomes a list.** Particles would be bucketed by
 * depth into K slabs and the sequence interleaved K+1 times — both arrays are already sorted,
 * so it stays offset arithmetic and adds K draw calls of nothing. It is not built because the
 * errors it fixes are between a flake and a fence post a metre apart at six metres, which is
 * not a thing anyone can see; the errors that *are* visible — flakes over the mullions, over
 * the wall, over the fig — are the ones a single split already gets exactly right.
 */
export const SPLIT_M = 6.25;

/** Which shape the fragment shader draws, and therefore which motion the vertex shader uses. */
export type WeatherKind = 'snow' | 'leaves';

export interface WeatherLook {
  kind: WeatherKind;
  /**
   * How many quads. Roughly 63% are inside the window opening at any moment — see `YARD.rect`
   * — so this is about 1.6x the count actually on screen.
   */
  count: number;
  /** World radius, min to max, in metres. Screen size follows from perspective, not from here. */
  radiusM: readonly [number, number];
  /** World fall speed, min to max, in m/s. Constant in *world* units, so near flakes visibly
   *  outrun far ones on screen without that being tuned anywhere. */
  fallMps: readonly [number, number];
  /** Horizontal sway amplitude in metres, and its rate in Hz. */
  swayM: number;
  swayHz: number;
  /** Tumble rate in Hz. Snow does not tumble and passes 0. */
  spinHz: number;
  /** Up to four colours, picked per particle by seed. Plain sRGB 0-1. */
  palette: readonly (readonly [number, number, number])[];
  /** Peak alpha before the per-particle and depth variation the shader applies. */
  opacity: number;
}

/**
 * Snow: many, small, slow, near-round, barely swaying.
 *
 * Falling at ~0.8 m/s rather than anything faster because real snow in still air does about
 * that, and because the slab is only 1.7m deep — a fast field crosses the window before the
 * eye can read any depth in it. The size range is what carries the volume: 10mm at the back
 * of the slab is about 2 screen px on a 1600px viewport, 22mm at the front is about 6, and
 * that 3x is the difference between a flat sheet of dots and weather with air in it.
 */
const SNOW: WeatherLook = {
  kind: 'snow',
  count: 1100,
  radiusM: [0.010, 0.022],
  fallMps: [0.55, 0.95],
  swayM: 0.10,
  swayHz: 0.16,
  spinHz: 0,
  palette: [
    [0.97, 0.98, 1.00],
    [0.93, 0.95, 0.99],
    [0.99, 0.99, 0.99],
    [0.90, 0.94, 1.00],
  ],
  opacity: 0.85,
};

/**
 * Leaves: a few, small, slow, tumbling.
 *
 * **The tumble is the entire difference between a leaf and a brown snowflake**, and it is one
 * line in each shader: the quad is rotated by a per-particle spin, and its minor axis is
 * scaled by `|cos(spin)|` so the leaf periodically turns edge-on and nearly vanishes before
 * flashing broad again. Recolouring snow gets you grit falling past a window; the flutter is
 * what reads as something with a surface catching the light.
 *
 * **Retuned once, after looking at it, and it was wrong in three ways that compounded.** The
 * first pass ran 55 leaves at 0.45-0.80 m/s across 7-13cm, which is a leaf blizzard: too many
 * to follow one, too fast to see it turn, and big enough that the yard read as close. Autumn
 * through a window is *one leaf at a time*. The three fixes are one idea — give a single leaf
 * enough room and enough time to be watched:
 *
 * - **12, not 55.** About 8 in the opening at once (see `count` on the interface for where
 *   the 63% comes from). Sparse enough that the eye picks one and follows it.
 * - **0.18-0.34 m/s, not 0.45-0.80.** A tumbling leaf really does descend at about this
 *   rate — much slower than intuition says, because it is not falling so much as being held
 *   up. It now takes 10-15s to cross the window instead of 3, which is also what stops 12
 *   leaves from reading as a short loop.
 * - **4-8cm, not 7-13cm.** Honest for a birch or a small maple, and the slab is only 4.5-6.2m
 *   away — closer than the tree a leaf actually left, so erring small is what keeps the
 *   distance believable.
 *
 * Spin came down with the speed. A leaf that tumbles quickly while descending slowly reads as
 * a spinning ticket rather than as something being carried, so the two have to move together.
 *
 * The palette is warmer and wider than the first pass: a yellow, two oranges and a red-brown,
 * because at this count each leaf is looked at individually and four near-identical ambers
 * read as one leaf drawn repeatedly.
 */
const LEAVES: WeatherLook = {
  kind: 'leaves',
  count: 12,
  radiusM: [0.022, 0.042],
  fallMps: [0.18, 0.34],
  swayM: 0.34,
  swayHz: 0.19,
  spinHz: 0.34,
  palette: [
    [0.90, 0.72, 0.26],   // yellow
    [0.86, 0.52, 0.18],   // amber
    [0.76, 0.35, 0.14],   // orange-rust
    [0.62, 0.24, 0.14],   // red-brown
  ],
  opacity: 0.95,
};

/**
 * The night versions.
 *
 * Not a global dim — that is what the room's own `uDim` does, and applying it twice reads as
 * the weather having been switched off rather than as night. What actually changes outdoors
 * after dark is *which* light is on the particle: a flake in the yard at night is lit almost
 * entirely by the warm spill out of the window it is passing, so it is dimmer, much lower in
 * contrast against a dark sky, and warmer rather than cooler. Snow especially — a cool-white
 * flake against a night-blue yard reads as a dead pixel, and the same flake tinted toward the
 * lamp inside reads as snow catching the window.
 *
 * Leaves lose the most, because a mid-tone brown against a dark yard is nearly invisible and
 * chasing it with opacity just produces glowing leaves. They keep a little more alpha than
 * their contrast deserves and are left at that.
 */
const nightOf = (look: WeatherLook, tint: readonly [number, number, number],
                 opacity: number): WeatherLook => ({
  ...look,
  opacity,
  palette: look.palette.map((c) =>
    [c[0] * tint[0], c[1] * tint[1], c[2] * tint[2]] as const),
});

const SNOW_NIGHT = nightOf(SNOW, [0.80, 0.76, 0.72], 0.62);
const LEAVES_NIGHT = nightOf(LEAVES, [0.62, 0.55, 0.52], 0.70);

/**
 * What is falling outside, for a (season, time-of-day) pair — the same matrix `variantFor`
 * in scene.ts resolves, and deliberately a separate function rather than a field on the
 * variant. A variant is a reconstruction; this is a thing happening in front of one, and
 * summer has a variant and no weather.
 *
 * Summer gets nothing. Rain was considered and dropped: it wants streaks rather than quads,
 * it wants the glass to be wet, and a summer room with dry glass and rain behind it reads as
 * a bug rather than as weather.
 */
export function weatherFor(season: Season, daylight: Daylight): WeatherLook | null {
  const night = daylight === 'night';
  if (season === 'winter') return night ? SNOW_NIGHT : SNOW;
  if (season === 'fall') return night ? LEAVES_NIGHT : LEAVES;
  return null;
}
