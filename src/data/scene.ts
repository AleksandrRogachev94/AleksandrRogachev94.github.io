/**
 * Which room build the renderer loads, and the numbers that build was measured with.
 *
 * There are three. They differ in where the *cut* comes from — the decision about what
 * hides what, which is the only hard problem in turning one painting into a room you can
 * move through — and the third one dissolves the question instead of answering it.
 *
 * `LAYERED` authors it. `art/objects.json` names sixteen objects and states `in_front_of`
 * for each; SAM cuts them, LaMa paints the surface behind them, and three plates come out.
 * Everything in docs/PIPELINE.md's "do not reopen" list is about tuning that.
 *
 * `SHARP` measures it. Apple's SHARP regresses a two-layer Gaussian scene from the same
 * master, so the geometry behind the frontmost surface is *rendered* rather than painted,
 * and the cut stops being a list of objects and becomes a threshold on the depth jump
 * across one mesh quad — applied everywhere, per quad, by the renderer. See
 * docs/SCENE-SHARP.md.
 *
 * `SHARP_SPLAT` skips the flattening and draws the Gaussians directly. It is what ships;
 * see docs/SCENE-SPLAT.md, and the note on `SHARP` below for why the middle build is kept
 * only as history. Switch by changing `SCENE` — nothing else in the app knows which one it
 * is looking at.
 */

import type { Daylight } from '../scripts/daylight';
import type { Season } from '../scripts/season';

export interface SceneLayer {
  colorSrc: string;
  depthSrc: string;
  /**
   * Disparity jump across one mesh quad above which geometry is discarded rather than
   * stretched — the tear. 1 draws everything.
   *
   * This is the SHARP build's entire occlusion model. A silhouette is a step in depth, so
   * a quad straddling one is snapped forward onto the near side rather than left to span
   * the gap. A smooth surface, however steeply it recedes, changes by a fraction of that
   * across one quad and is left alone.
   *
   * **Layer 0 must never do this.** Snapping looks free because at the home camera it
   * changes nothing — every vertex slides along its own ray and lands on the same pixel.
   * In motion it is not free: the snapped quad sits at the near depth so it travels
   * further than its far neighbour, and a gap opens between them. That gap is the whole
   * point for the front layer, which has layer 0 behind it. Behind layer 0 there is
   * nothing, so the gap is black — measured as black specks trailing every moving object.
   *
   * The backstop earns its smoothness in the bake instead: its depth is a background
   * surface with the foreground's silhouettes interpolated out, so it has no cliffs to
   * bridge and nothing to snap. See tools/sharp_bake.py.
   */
  edgeCut?: number;
}

export interface SceneBuild {
  id: string;
  /**
   * Which renderer draws it. `mesh` is a depth-displaced grid per layer
   * (src/scripts/roomRenderer.ts); `splat` is 3D Gaussians drawn directly
   * (src/scripts/splatRenderer.ts). This is the only thing in the app that knows.
   */
  kind: 'mesh' | 'splat';
  /** Back to front. Index 0 is opaque and never absent. `mesh` builds only. */
  layers?: SceneLayer[];
  /** Directory + basename the splat bake wrote. `splat` builds only. */
  assetPrefix?: string;
  /**
   * The lighting variants this build ships, as a `(season, time)` matrix — see `variantFor`.
   *
   * **Each is its own SHARP reconstruction of the same room under different light**, and
   * ships its own colour *and* geometry: `-splat-color-<name>.webp` plus
   * `-splat-{geom,shape,quat}-<name>.bin`, about 11MB a season. Only one is ever downloaded,
   * so the initial load is unchanged — a December visitor fetches winter's cloud instead of
   * summer's, not as well as.
   *
   * It was colour only for most of this build's life, on the argument that one cloud plus N
   * colours keeps every authored number valid and dissolves rather than swims. That holds
   * exactly while a variant master relights surfaces without *moving* them, and winter broke
   * it: its yard is bare branches against distant snow where summer's is a leafy canopy near
   * the glass. The colour-only path still exists for a master that really did only change the
   * light — a name the bake's manifest lists in `variants` but not in `variantGeom`.
   *
   * Every cloud is quantised against one shared range, so `nearZ`/`farZ` describe the whole
   * bake rather than whichever master was the `--ply`. Switching between two of them is a dip
   * — fade down, swap, fade up — never an interpolation; see docs/SCENE-SPLAT.md for why the
   * morph that looked obvious was built and thrown away.
   */
  variants?: readonly string[];
  /** Whole-frame plate for no-WebGL2 and prefers-reduced-motion. */
  still: string;
  /**
   * The same plate per variant. A visitor arriving at midnight gets the night poster, so the
   * flat fallback and the loading frame agree with the room that is about to draw instead of
   * flashing a sunlit version of it first.
   */
  variantStill?: Readonly<Record<string, string>>;
  /**
   * Whole-frame depth, for turning a click into a 3D point on the CPU. A /dev/room
   * affordance only — the site aims at authored points in hotspots.ts, so it never
   * downloads this. Absent under the splat build, which keeps no depth plate at all.
   */
  pickingDepth?: string;
  width: number;
  height: number;
  /** World distance of the nearest content (disparity 1.0). */
  nearZ: number;
  /** World distance of the farthest content (disparity 0.0). */
  farZ: number;
  /** Vertical fov, and the lens the art is assumed to have been painted with. */
  fovDeg: number;
  /**
   * How far the camera may leave home before it runs out of room, in world units. The
   * layered build is limited by the painted band around each plate (`--margin` in
   * tools/inpaint.py). The SHARP build has no painted band — its back layer is a full
   * frame — so it is limited only by the mesh overscan, which is much further.
   */
  excursion: number;
}

const ART = '/art/room-day-summer';

/**
 * The authored build: SAM masks, an `in_front_of` graph, LaMa fills. Three plates.
 *
 * **Its plates are no longer committed to `public/art/`.** They were 3.1MB that nothing
 * fetched — `SCENE` is the splat build, so `layers` is never read and `/dev/room` follows
 * `SCENE` too. The convention in CLAUDE.md is that `public/art/` holds what the site loads,
 * and they had stopped being that. Selecting this build again means re-running the chain in
 * docs/SCENE.md, which regenerates them from `art/` in full. The reasoning this build exists
 * to record is in docs/PIPELINE.md and docs/FILL.md and is not going anywhere.
 */
export const LAYERED: SceneBuild = {
  id: 'layered',
  kind: 'mesh',
  layers: [0, 1, 2].map((i) => ({
    colorSrc: `${ART}-layer${i}.webp`,
    depthSrc: `${ART}-layer${i}-depth.webp`,
  })),
  still: `${ART}.webp`,
  pickingDepth: `${ART}-depth.webp`,
  width: 5504,
  height: 3072,
  // Hand-tuned in /dev/room rather than measured; the depth map carries no scale, so
  // these were only ever a feel dial.
  nearZ: 1,
  farZ: 6,
  fovDeg: 42,
  // 344px of painted margin on the 5504px plate, converted to world units at nearZ.
  excursion: 0.12,
};

/**
 * The measured build. Two plates, from `tools/sharp_bake.py`.
 *
 * `nearZ`/`farZ`/`fovDeg` are not tuned here — SHARP's output is metric and its
 * intrinsics are in the PLY, so these are copied from
 * `art/build/room-day-summer-sharp-scene.json`. The room really is 1.16m to 98m deep and
 * the lens really is 38.7 degrees, which is what makes the yard hold still while the fig
 * sweeps: a true depth ratio of 85 instead of the layered build's assumed 6.
 */
export const SHARP: SceneBuild = {
  id: 'sharp',
  kind: 'mesh',
  layers: [
    // Back: the scene with its frontmost surface peeled off. Half resolution, because it
    // is only ever seen through gaps a few pixels wide.
    { colorSrc: `${ART}-sharp-layer0.webp`, depthSrc: `${ART}-sharp-layer0-depth.webp` },
    // Front: the master itself, at full resolution, torn at every depth step.
    { colorSrc: `${ART}-sharp-layer1.webp`, depthSrc: `${ART}-sharp-layer1-depth.webp`,
      edgeCut: 0.045 },
  ],
  still: `${ART}.webp`,
  // The front layer covers the whole frame, so it doubles as the picking depth.
  pickingDepth: `${ART}-sharp-layer1-depth.webp`,
  width: 5504,
  height: 3072,
  nearZ: 1.157,
  farZ: 98.18,
  fovDeg: 38.73,
  // Ported from ml-sharp's own preview-video budget (src/sharp/utils/camera.py,
  // compute_max_offset): let the nearest content sweep 8% of the image diagonal, and the
  // metres follow from that point's distance. For this scene, 0.134m — measured, not
  // guessed, and it agrees with where the hole fraction starts climbing.
  excursion: 0.1335,
};

/**
 * The measured build, drawn as what it actually is.
 *
 * Same SHARP reconstruction as `SHARP` above, but the Gaussians are rendered directly
 * instead of being flattened into plates first. That flattening was the mistake: a mesh
 * at a depth discontinuity must either bridge it and smear, or tear it and leave a hole
 * that something has to fill — and SHARP's second layer, measured at 25.1dB against the
 * master, is a thin ribbon of hidden geometry at silhouettes, not the full background
 * plate a torn mesh needs. Splats have no connectivity, so the question never arises.
 *
 * Everything here is measured, not tuned: `art/build/room-day-summer-splat.json` is
 * written by the bake straight out of the PLY's own intrinsics.
 *
 * What it costs: SHARP's grid is 768x768, so the room is reconstructed at ~7 master px
 * per splat. At rest that reads as the painting; at the end of a push into the monitor
 * (4.55x magnification) it is ~9.5 screen px per splat, by which point room.css has faded
 * in a 9px blur and a dim over it and the panel is taking over. If that stops holding,
 * the dial is `travel` on the hotspot in hotspots.ts, not the renderer.
 */
export const SHARP_SPLAT: SceneBuild = {
  id: 'splat',
  kind: 'splat',
  assetPrefix: ART,
  // Five, which is every cell of the 3x2 lighting matrix except summer day — and summer
  // day is the base raster, so the matrix is now fully covered with no cell borrowing
  // another's picture. See `variantFor`.
  //
  // Each is a full reconstruction: its own colour *and* its own geometry, ~8.5MB of
  // geometry plus ~2.4MB of colour apiece. See docs/SCENE-SPLAT.md; the short version is
  // that a variant may relight any surface but may not *move* one, and winter's yard
  // moved — bare branches where summer has canopy. Winter now moves something indoors too
  // (a throw over the chair), which is legal for the same reason and constrained only by
  // the rects in hotspots.ts, controls.ts and ambient.ts, which every cloud shares.
  //
  // **A visitor still downloads exactly one cloud.** These are fetched on switch, so the
  // count here costs deploy size, not load time.
  variants: ['night', 'fall', 'winter', 'winter-night', 'fall-night'],
  still: `${ART}.webp`,
  variantStill: {
    night: '/art/room-night-summer.webp',
    fall: '/art/room-day-fall.webp',
    winter: '/art/room-day-winter.webp',
    'winter-night': '/art/room-night-winter.webp',
    'fall-night': '/art/room-night-fall.webp',
  },
  width: 2752,
  height: 1536,
  // Straight out of the bake's manifest, and now spanning **every** reconstruction in the
  // bake rather than whichever one was the `--ply`. That is what stopped these from being a
  // trap: they were per-file, so re-locking the masters moved `farZ` 98m → 14m and silently
  // changed what every authored depth in src/data meant — the feeder, mapped at 8.3m, began
  // decoding as 5.7m and the camera stopped short of it in mid-air. Those are metres now
  // (roomGeometry.ts) and this is one shared range (encode() in the bake), so a re-bake can
  // move the planes freely — and they do move, by a lot. farZ is whatever the *furthest*
  // thing any of the six reconstructions saw, so it tracks the most open yard in the set:
  // summer alone gives ~14m, one winter master whose bare branches showed distant sky took
  // it to 125m, and regenerating that master brought it back to 40m. Do not hand-tune it or
  // treat a change in it as a regression; copy what the bake printed.
  //
  // It is also cheaper to get wrong than it looks. The quantisation is on *disparity*, so
  // the far plane stretching 9x moved p99 depth error inside 3m from 0.110mm to 0.121mm.
  // What is *not* cheap is disagreeing with the manifest, which is why these are copied
  // rather than rounded.
  nearZ: 1.014,
  farZ: 39.645,
  fovDeg: 38.73,
  // ml-sharp's own budget (compute_max_offset): 8% of the image diagonal of sweep at the
  // nearest content's distance, printed by the bake as `maxLateralM`. `ROOM_TUNING`'s ambient
  // peaks at 0.115 against this — see cameraRig.ts, which measured the disocclusion at each
  // offset rather than guessing.
  excursion: 0.117,
};

/**
 * Which colour raster a (season, time-of-day) pair draws — the room's lighting matrix.
 *
 * **Three seasons and two times is six cells, and every one of them now has its own
 * reconstruction.** Summer day is the base and needs no variant; the other five are named
 * here. `null` means the base raster — already on the GPU — so summer day costs no fetch.
 *
 * **Fall night used to fall back to summer's `night`, and that was wrong twice over.** The
 * argument for the fallback was that nothing separating fall from summer — a gold canopy,
 * leaf drift, spent beds — survives being in deep shadow, so the picture would be the same
 * dark blue yard either way. Two things defeated it. The smaller one is that a canopy still
 * reads warm-brown rather than cool-green in silhouette, and fallen leaves near the house
 * catch the window spill and are unmistakable. The larger one arrived with per-variant
 * geometry: the fallback no longer handed a fall visitor summer's *colours*, it handed them
 * summer's *shape* — a leafy crown where their season has a thinning one. A colour
 * compromise is a judgement call; a geometry compromise is a wrong room.
 *
 * Spring earns no master at all and maps to summer. It would be a sixth reconstruction to
 * say "green, slightly paler", which is the one seasonal difference the eye cannot find
 * through a window at this size — and unlike fall night, spring's *geometry* really is
 * summer's, so the fallback costs nothing but a name.
 */
export function variantFor(season: Season, daylight: Daylight): string | null {
  if (daylight === 'night') return season === 'summer' ? 'night' : `${season}-night`;
  return season === 'summer' ? null : season;
}

/** The flat poster for that same pair, for the load, no-WebGL2 and reduced motion. */
export function stillFor(season: Season, daylight: Daylight): string {
  const v = variantFor(season, daylight);
  return (v && SHARP_SPLAT.variantStill?.[v]) || SHARP_SPLAT.still;
}

/** The build the site loads. */
export const SCENE: SceneBuild = SHARP_SPLAT;
