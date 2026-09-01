/**
 * Where the art actually is on screen, and how to turn a point on it into a point in the
 * room.
 *
 * The renderer reconstructs in the *art's* own frame and then crops to whatever aspect the
 * canvas happens to be — `object-fit: cover` expressed as a field of view
 * (roomRenderer.ts, `fovYProj`). Everything that has to line up with the painting has to
 * redo that same crop: hotspot buttons sitting over their objects, a click turned back
 * into a room coordinate, the takeover growing out of the screen's centre.
 *
 * Doing it in one place is the point. Three copies of a cover-crop drift apart the first
 * time someone resizes the window to a shape nobody tested.
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
 * where its top-left corner falls. One or other offset is always negative or zero, because
 * cover overflows on the axis it is not fitting.
 */
function cover(viewW: number, viewH: number, imageAspect: number) {
  const viewAspect = viewW / Math.max(1, viewH);
  const width = viewAspect > imageAspect ? viewW : viewH * imageAspect;
  const height = viewAspect > imageAspect ? viewW / imageAspect : viewH;
  return { width, height, left: (viewW - width) / 2, top: (viewH - height) / 2 };
}

/** A normalised rect on the art -> its box in CSS pixels inside the viewport. */
export function imageRectToScreen(
  rect: NormRect,
  viewW: number,
  viewH: number,
  imageAspect: number,
): ScreenRect {
  const c = cover(viewW, viewH, imageAspect);
  return {
    left: c.left + rect[0] * c.width,
    top: c.top + rect[1] * c.height,
    width: (rect[2] - rect[0]) * c.width,
    height: (rect[3] - rect[1]) * c.height,
  };
}

/**
 * A point in CSS pixels inside the viewport -> normalised coordinates on the art. Values
 * outside 0..1 mean the point landed on cropped-away image, which is possible: cover shows
 * less than the whole painting.
 */
export function screenToImage(
  x: number,
  y: number,
  viewW: number,
  viewH: number,
  imageAspect: number,
): [number, number] {
  const c = cover(viewW, viewH, imageAspect);
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
  const c = cover(viewW, viewH, imageAspect);
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
