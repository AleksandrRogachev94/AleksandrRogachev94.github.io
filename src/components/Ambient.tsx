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
 *
 * **It is no longer only decoration, though, and that is worth being honest about.** The
 * electronic tells (data/ambient.ts) are what tells a visitor which objects can be entered —
 * on a touch device they are the *only* thing that does, because the hotspot wake answers to
 * `:hover` and `:focus-visible` and a phone has neither. They stay `aria-hidden` regardless:
 * a screen reader gets the real links, in the room and in the document below, and describing
 * a blinking light to someone who cannot see it is noise, not information. The rule is that
 * every channel carries the affordance in its own terms, not that every channel carries the
 * same artifact.
 */

import type { CSSProperties } from 'react';
import { AMBIENT, type AmbientEffect } from '../data/ambient';
import { SCENE } from '../data/scene';
import { imageRectToScreen, pinToArt } from '../scripts/roomGeometry';

interface Props {
  /** The room's size in CSS px, for the same cover-crop the renderer uses. */
  view: { w: number; h: number };
  /** The art's aspect, for that same crop. */
  aspect: number;
}

function Effect({ effect, view, aspect }: { effect: AmbientEffect } & Props) {
  const box = imageRectToScreen(effect.rect, view.w, view.h, aspect);
  const style = {
    ...pinToArt(box, effect.disparity, SCENE),
    ...(effect.accent ? { '--accent': effect.accent } : {}),
  } as CSSProperties;

  // The id rides along as a class so one entry can carry its own cadence without earning a
  // whole `kind` of its own: the feeder's camera and the rover's panel are the same effect
  // at different rhythms, and two lights blinking in lockstep would read as one animation
  // applied twice rather than as two machines.
  const cls = `ambient__fx ambient__fx--${effect.kind} ambient__fx--${effect.id}`;

  if (effect.kind === 'glow') {
    return (
      <div className={cls} style={style}>
        {/* One soft bloom. It reaches well past its own rect — the visible light of an
            indicator is much bigger than the indicator, and a screen's light lands on the
            desk in front of it. How far, and how fast it pulses, is the id's business
            (room.css); the markup is the same for a 30px LED and a 25-inch panel — and for
            a room control's standby light, which wears the same class. */}
        <span className="glow" />
      </div>
    );
  }

  return (
    <div className={cls} style={style}>
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
