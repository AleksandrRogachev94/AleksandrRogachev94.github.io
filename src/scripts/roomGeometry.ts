/**
 * Where the art actually is on screen, and how to turn a point on it into a point in the
 * room.
 *
 * The renderer reconstructs in the *art's* own frame and then fits it to whatever aspect
 * the canvas happens to be, width-locked: the art's full width always lands on screen, and
 * the vertical axis absorbs the mismatch — cropped top/bottom on a canvas wider than the
 * art, letterboxed top/bottom on one narrower (a phone in portrait). Expressed as a field
 * of view in roomRenderer.ts (`fovYProj`). Everything that has to line up with the painting
 * has to redo that same fit: hotspot buttons sitting over their objects, a click turned back
 * into a room coordinate, the takeover growing out of the screen's centre.
 *
 * Width-locked rather than a true `object-fit: cover` (which would crop *either* axis,
 * whichever fits) because the room's hotspots are spread wide — 0.25 to 0.80 of the frame —
 * and only two objects sit in the vertical middle. Cropping width on a portrait phone
 * cropped those hotspots off-screen entirely; a phone is tall enough to spare that gets
 * back as harmless letterboxing instead.
 *
 * Doing it in one place is the point. Three copies of this fit drift apart the first time
 * someone resizes the window to a shape nobody tested.
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
 * The art's placement inside a viewport of the given size: the size it is drawn at, and
 * where its top-left corner falls. Width always matches the viewport exactly (`left` is
 * always 0) — see the file header for why this is width-locked rather than true cover.
 * `top` is negative when the viewport is wide enough to crop the art vertically, positive
 * when it is narrow enough to letterbox it instead.
 */
function fit(viewW: number, viewH: number, imageAspect: number) {
  const width = viewW;
  const height = viewW / imageAspect;
  return { width, height, left: 0, top: (viewH - height) / 2 };
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
 * outside 0..1 mean the point landed off the art — either on cropped-away image (wide
 * viewport) or on the letterboxed gap (narrow one).
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
 * `disparity` is the depth map's own units: 1 is nearest, 0 is farthest. Depth is
 * interpolated in inverse space because parallax goes as 1/z, so lerping 1/z is what makes
 * displacement linear in the model's output.
 */
export function imagePointToWorld(
  nx: number,
  ny: number,
  disparity: number,
  opts: { fovDeg: number; nearZ: number; farZ: number; imageAspect: number },
): Vec3 {
  const ndcX = nx * 2 - 1;
  const ndcY = 1 - ny * 2;
  const invZ = 1 / opts.farZ + (1 / opts.nearZ - 1 / opts.farZ) * disparity;
  const z = 1 / invZ;
  const tanHalf = Math.tan((opts.fovDeg * Math.PI) / 180 / 2);
  return [ndcX * tanHalf * opts.imageAspect * z, ndcY * tanHalf * z, -z];
}

/**
 * An authored `disparity` as the reciprocal depth that `parallaxCoeff` multiplies against.
 *
 * Every screen-space overlay glued to the room needs this exact number and no other part
 * of the world: the hotspot layer, and the ambient layer that sits beside it. It was
 * inlined in both until the second one existed, at which point two copies of one formula
 * were two chances for the layers to disagree about where a thing is.
 */
export function reciprocalDepth(
  disparity: number,
  opts: { nearZ: number; farZ: number },
): number {
  return 1 / opts.farZ + (1 / opts.nearZ - 1 / opts.farZ) * disparity;
}

/**
 * The four CSS declarations that pin an overlay to a rect on the art and hold it there while
 * the room parallaxes underneath.
 *
 * Three layers need exactly this and nothing else — hotspots, room controls, the ambient
 * tier — and it was written out in all three. Same argument as `reciprocalDepth` above, one
 * step later: three copies of one placement are three chances for the layers to disagree
 * about where a thing is.
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
  disparity: number,
  opts: { nearZ: number; farZ: number },
): { left: string; top: string; width: string; height: string } {
  const invZ = reciprocalDepth(disparity, opts).toFixed(4);
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
 * `imagePointToWorld` already turns a hotspot's `disparity` into exactly that reciprocal,
 * which is why the depth never has to be stored twice.
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
