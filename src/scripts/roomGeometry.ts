/**
 * Where the art actually is on screen, and how to turn a point on it into a point in the
 * room.
 *
 * The renderer reconstructs in the *art's* own frame and then fits it to whatever aspect the
 * canvas happens to be. Everything that has to line up with the painting has to redo that
 * same fit: hotspot buttons sitting over their objects, a click turned back into a room
 * coordinate, the takeover growing out of the screen's centre.
 *
 * **Cover, capped** — `fitZoom` below. On a canvas wider than the art's 1.79:1 the art's full
 * width lands on screen and the top and bottom are cropped, which is what it has always done.
 * On a canvas *narrower* than that it now scales up until the height is covered too, up to a
 * ceiling, and letterboxes only past that ceiling.
 *
 * It was width-locked with no zoom at all, and the reason was sound as far as it went: a true
 * `object-fit: cover` crops whichever axis fits, and the room's hotspots are spread from x
 * 0.246 (the window) to x 0.801 (the monitor), so on a portrait phone cover would take the
 * window clean off the screen. What that argument missed is that the two cases are nothing
 * alike in *degree*. A laptop window at 3:2 needs 1.12x to fill; a phone in portrait needs
 * 3.9x. One is a couple of percent off each side, the other is most of the room. Refusing
 * both cost every desktop visitor a mat above and below the picture — and a mat says
 * "photograph on a page", where this wants to say "you are in the room".
 *
 * So the ceiling is the whole design, and `MAX_ZOOM` says where it comes from.
 *
 * Doing it in one place is the point. Three copies of this fit drift apart the first time
 * someone resizes the window to a shape nobody tested — and there are four now, since the
 * poster's is in CSS (`.room__still` in room.css) and cannot call this.
 */

/** A rectangle on the art, normalised 0..1, origin top-left. Same convention as hotspots.ts. */
export type NormRect = readonly [number, number, number, number];

export type Vec3 = [number, number, number];

/** A rectangle in CSS pixels, relative to the viewport element. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * **How far past the viewport's width the art is scaled, so that a viewport taller than the
 * art fills instead of letterboxing.** 1 means the old width-locked fit.
 *
 * The ceiling is 1.25 — 10% of the width off each side — and it is set by the hotspots, not
 * by taste. The leftmost is the window at x 0.246 and the rightmost the monitor at 0.801, so
 * at the cap the visible band is 0.10 to 0.90 and the window still has 0.146 of frame outside
 * it. That is margin enough that no reachable viewport puts a destination against the edge,
 * let alone past it. 1.25 covers every viewport down to 1.433:1, which is every landscape
 * desktop window including a deliberately tall one; below that — phones in portrait, which is
 * where the width-locked fit was defending something real — the mat comes back and the room
 * is centred in it.
 *
 * It is a mild win for the renderer too, not just a cosmetic one: cropping the sides moves the
 * frame edge away from where lateral drift opens disocclusion, so the pixels most likely to
 * show a hole are the first ones off screen.
 */
export const MAX_ZOOM = 1.25;

export function fitZoom(viewW: number, viewH: number, imageAspect: number): number {
  // What it would take to cover the height as well. Below 1 the viewport is already wider
  // than the art, which crops top/bottom — the case that never needed a zoom.
  const cover = (viewH * imageAspect) / viewW;
  return Math.min(MAX_ZOOM, Math.max(1, cover));
}

/**
 * The art's placement inside a viewport of the given size: the size it is drawn at, and where
 * its top-left corner falls. `top` is negative when the art is cropped vertically and positive
 * when it is letterboxed; `left` is zero or negative, and is only non-zero once `fitZoom` has
 * scaled the art past the viewport's width.
 */
function fit(viewW: number, viewH: number, imageAspect: number) {
  const width = viewW * fitZoom(viewW, viewH, imageAspect);
  const height = width / imageAspect;
  return { width, height, left: (viewW - width) / 2, top: (viewH - height) / 2 };
}

/** A normalised rect on the art -> its box in CSS pixels inside the viewport. */
export function imageRectToScreen(
  rect: NormRect,
  viewW: number,
  viewH: number,
  imageAspect: number,
): ScreenRect {
  const c = fit(viewW, viewH, imageAspect);
  return {
    left: c.left + rect[0] * c.width,
    top: c.top + rect[1] * c.height,
    width: (rect[2] - rect[0]) * c.width,
    height: (rect[3] - rect[1]) * c.height,
  };
}

/**
 * A point in CSS pixels inside the viewport -> normalised coordinates on the art. Values
 * outside 0..1 mean the point landed on the letterboxed gap, which only exists below
 * `MAX_ZOOM`'s cutoff aspect; cropped-away image simply cannot be pointed at.
 */
export function screenToImage(
  x: number,
  y: number,
  viewW: number,
  viewH: number,
  imageAspect: number,
): [number, number] {
  const c = fit(viewW, viewH, imageAspect);
  return [(x - c.left) / c.width, (y - c.top) / c.height];
}

/**
 * A point on the art plus how far away it is -> the point in the room the renderer put
 * there.
 *
 * This is the vertex shader's reconstruction run on the CPU, and it has to stay identical
 * to it or the camera aims at somewhere the art is not. Note it uses the *art's* aspect,
 * never the canvas's — the reconstruction happens before any cropping, so this answer does
 * not change when the window does.
 *
 * `distanceM` is **metres**, and it used to be the bake's normalised disparity. That cost a
 * live bug worth remembering: disparity is a position within `[1/farZ, 1/nearZ]`, so it is a
 * property of *the bake's quantisation range* and not of the room. Re-locking the masters
 * moved `farZ` from 98m to 14m — nothing in the room moved, the deepest thing in it did — and
 * every authored number silently came to mean somewhere else. The feeder, authored at 8.31m,
 * decoded as 5.70m and the camera stopped short of it in mid-air.
 *
 * Metres cannot do that. The room is metric because SHARP's output is, the distance to the
 * feeder is a fact about the room, and a re-bake is now free to move the planes.
 */
export function imagePointToWorld(
  nx: number,
  ny: number,
  distanceM: number,
  opts: { fovDeg: number; imageAspect: number },
): Vec3 {
  const ndcX = nx * 2 - 1;
  const ndcY = 1 - ny * 2;
  const z = distanceM;
  const tanHalf = Math.tan((opts.fovDeg * Math.PI) / 180 / 2);
  return [ndcX * tanHalf * opts.imageAspect * z, ndcY * tanHalf * z, -z];
}

/**
 * An authored distance as the reciprocal depth that `parallaxCoeff` multiplies against.
 *
 * Now that the stored number is metres this is a reciprocal and nothing else, and `pinToArt`
 * below is its only caller — it used to be exported, back when the three overlay layers each
 * did their own placement and only shared this one step. It stays a named function because it
 * is the one place that knows overlay parallax goes as 1/z, and `pinToArt` reads better for
 * saying so than for a bare `1 / distanceM`.
 */
function reciprocalDepth(distanceM: number): number {
  return 1 / distanceM;
}

/**
 * The four CSS declarations that pin an overlay to a rect on the art and hold it there while
 * the room parallaxes underneath.
 *
 * Three layers need exactly this and nothing else — hotspots, room controls, the ambient
 * tier — and it was written out in all three: three copies of one placement are three chances
 * for the layers to disagree about where a thing is.
 *
 * **`left`/`top`, never a transform.** A transform makes the element a stacking context, and
 * every one of these layers contains a `screen`-blended light that has to mix with the
 * canvas; isolate the group and it turns back into a flat accent decal. That trap is the
 * whole reason this is worth having in one place.
 *
 * `--par-x`/`--par-y` are written on `.room` once per frame by the rig, so the multiply
 * happens in the stylesheet and a drifting camera costs no React renders.
 */
export function pinToArt(
  box: ScreenRect,
  distanceM: number,
): { left: string; top: string; width: string; height: string } {
  const invZ = reciprocalDepth(distanceM).toFixed(4);
  return {
    left: `calc(${box.left}px + var(--par-x, 0) * ${invZ} * 1px)`,
    top: `calc(${box.top}px + var(--par-y, 0) * ${invZ} * 1px)`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  };
}

/**
 * How far the room slides under a screen-space overlay when the camera translates.
 *
 * Hotspot rects are authored against the master and placed by `imageRectToScreen`, which
 * knows the viewport and nothing else — so at rest they are nailed to the screen while the
 * art parallaxes underneath them. That was invisible while ambient motion peaked at 0.042m
 * (~15px of slip at mid-room depth) and is not at 0.115m (~41px).
 *
 * The slip is pure perspective and depends only on depth, so one pair of coefficients
 * serves every hotspot: multiply by the object's own `1/z` to get its offset in CSS px.
 * `imagePointToWorld` already takes a hotspot's distance in the same units, which is why the
 * depth never has to be stored twice.
 *
 * Returned as coefficients rather than applied here because the camera moves 60 times a
 * second and the rects do not: the caller writes these into two custom properties and the
 * stylesheet does the multiply, the same division of labour `--push` already uses.
 */
export function parallaxCoeff(
  dx: number,
  dy: number,
  viewW: number,
  viewH: number,
  opts: { fovDeg: number; imageAspect: number },
): { kx: number; ky: number } {
  const c = fit(viewW, viewH, opts.imageAspect);
  const tanHalf = Math.tan((opts.fovDeg * Math.PI) / 180 / 2);
  // Moving the eye right slides the art left; moving it up slides the art down. Both are
  // the renderer's own `world - camera`, read back out in image coordinates.
  return {
    kx: (-dx * c.width) / (2 * tanHalf * opts.imageAspect),
    ky: (dy * c.height) / (2 * tanHalf),
  };
}

/**
 * Where a rect on the art has ended up on screen once the camera has pushed `travel` of
 * the way toward `aim`.
 *
 * The takeover needs this and the at-rest rect will not do. The camera re-aims as it moves,
 * so the thing you clicked is at the centre of the frame by the time it arrives, several
 * times larger than it started — a panel growing out of where the monitor *used to be* is
 * a panel growing out of empty wall.
 *
 * The scale is exact for content at the aim point's own depth, which is what the monitor
 * is: the eye travels `travel` of the way down the sightline, so the remaining distance is
 * `1 - travel` of the original and the object subtends `1 / (1 - travel)` as much. The
 * off-axis tilt foreshortens it by a few percent on top of that, which is not worth
 * modelling for a clip-path whose edges land on a near-black field.
 */
export function pushedRectToScreen(
  rect: NormRect,
  aim: readonly [number, number],
  travel: number,
  viewW: number,
  viewH: number,
  imageAspect: number,
): ScreenRect {
  const c = fit(viewW, viewH, imageAspect);
  const k = 1 / Math.max(0.05, 1 - travel);
  const width = (rect[2] - rect[0]) * c.width * k;
  const height = (rect[3] - rect[1]) * c.height * k;
  // The aim point lands dead centre; the rect's centre keeps its offset from it, magnified.
  const dx = ((rect[0] + rect[2]) / 2 - aim[0]) * c.width * k;
  const dy = ((rect[1] + rect[3]) / 2 - aim[1]) * c.height * k;
  return {
    left: viewW / 2 + dx - width / 2,
    top: viewH / 2 + dy - height / 2,
    width,
    height,
  };
}
