/**
 * The ambient layer: painted light that moves.
 *
 * Structurally this is `Hotspot.tsx` with the interaction taken out. Each effect is an
 * authored rect on the master, placed by `imageRectToScreen` and glued to the art with the
 * same two parallax coefficients the rig writes onto `.room` once per frame — so an
 * overlay stays on the surface it belongs to while the room drifts underneath it.
 *
 * **No JavaScript runs per frame here, and that is the point.** The motion is CSS
 * keyframes on a compositor layer; React's only job is to put four numbers in a `style`
 * attribute when the viewport resizes. That is what makes this cheap enough to be exempt
 * from the one-live-element rule rather than an exception to it (see data/ambient.ts).
 *
 * The layer is `aria-hidden`: it is decoration with no content and no affordance, and the
 * document below carries everything a screen reader needs (rule 2).
 */

import type { CSSProperties } from 'react';
import { AMBIENT, type AmbientEffect } from '../data/ambient';
import { SCENE } from '../data/scene';
import { imageRectToScreen, reciprocalDepth } from '../scripts/roomGeometry';

interface Props {
  /** The room's size in CSS px, for the same cover-crop the renderer uses. */
  view: { w: number; h: number };
  /** The art's aspect, for that same crop. */
  aspect: number;
}

function Effect({ effect, view, aspect }: { effect: AmbientEffect } & Props) {
  const box = imageRectToScreen(effect.rect, view.w, view.h, aspect);
  // Placed in `left`/`top` rather than a transform for the reason Hotspot.tsx records: a
  // transform would make this a stacking context and the children's blending would stop
  // mixing with the canvas, which turns light back into a flat decal.
  const invZ = reciprocalDepth(effect.disparity, SCENE);
  const style = {
    left: `calc(${box.left}px + var(--par-x, 0) * ${invZ.toFixed(4)} * 1px)`,
    top: `calc(${box.top}px + var(--par-y, 0) * ${invZ.toFixed(4)} * 1px)`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  } as CSSProperties;

  return (
    <div className={`ambient__fx ambient__fx--${effect.kind}`} style={style}>
      {/* Five wisps at five periods sharing no common multiple worth noticing, with
          negative delays so the plume is already mid-flight on the first frame rather than
          starting with a puff. Each carries its own shape and drift in CSS; three was too
          few to hide that they are one keyframe repeated. */}
      <span className="ambient__wisp ambient__wisp--a" />
      <span className="ambient__wisp ambient__wisp--b" />
      <span className="ambient__wisp ambient__wisp--c" />
      <span className="ambient__wisp ambient__wisp--d" />
      <span className="ambient__wisp ambient__wisp--e" />
    </div>
  );
}

export default function Ambient({ view, aspect }: Props) {
  // Nothing to place until the room has been measured.
  if (!view.w || !view.h) return null;

  return (
    <div className="ambient" aria-hidden="true">
      {AMBIENT.map((e) => (
        <Effect key={e.id} effect={e} view={view} aspect={aspect} />
      ))}
    </div>
  );
}
