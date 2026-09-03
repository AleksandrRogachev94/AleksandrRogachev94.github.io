/**
 * One clickable object in the room.
 *
 * **On rule 3.** CLAUDE.md says "every hotspot is a real focusable `<button>`", and the
 * intent behind it — tab walks them in order, Enter activates, Esc pulls out, the ring is
 * always visible — is met here in full. The element is an `<a href>` rather than a
 * `<button>` because rule 2 gives every destination a real URL, and a thing that navigates
 * to a URL is a link: screen readers announce it as one, cmd-click opens a tab, middle
 * click works, and "copy link address" does something useful. Wrapping one in the other is
 * not an option — nesting interactive content is invalid HTML. The camera move is an
 * enhancement layered over a working link, which is also exactly what makes the no-JS path
 * free.
 *
 * Positioned in CSS from the normalised rect rather than projected per frame. The camera
 * does move under it, but hotspots are only interactive at rest, the at-rest parallax is a
 * couple of pixels on a target this size, and they fade out as soon as a push starts.
 * Re-projecting every frame would buy nothing and cost a layout pass per hotspot.
 *
 * **The affordance is the object's own light coming up** — the monitor wakes — baked by
 * tools/wake.py from the SAM mask the layer pipeline already cuts. Three earlier attempts
 * are worth not repeating. A bordered rectangle reads as a debug overlay. A soft accent
 * glow over the whole *rect* was invisible, because `screen` blending adds light and there
 * is very little to add to sunlit warm art. And a hairline rim on the true silhouette,
 * which looked right in a still and was wrong in motion: it is a screen-space overlay, the
 * art beneath it is a displaced mesh that is always slightly moving, and two or three
 * pixels of parallax drift visibly unglues a line from the edge it traces. Soft light has
 * no such failure mode — and unlike a contour, which is something the interface says
 * *about* an object, light is something the object does.
 *
 * It is not on at rest. A permanent glow is a neon sign, and it is also the state in which
 * parallax drift is most visible, because nothing the visitor did explains the motion. It
 * answers to hover and focus, and it goes out in a single frame when a push starts — gated
 * on the busy class rather than eased against `--push`, so it can never be caught sitting
 * over art the camera has already moved.
 *
 * There was also a one-time introduction: every hotspot lighting itself once, staggered,
 * after the room settled. It is gone, and so — belatedly — is the second blended layer per
 * hotspot that existed only to keep its animation from fighting the hover transition over
 * one opacity. It put motion on screen that nothing the visitor did explained, and its tail
 * could still overlap a hover and change the fade's apparent rate halfway through.
 * Discoverability is the pointer's job and the label's.
 *
 * **The wake is cropped to its own lit extent** and placed by `wakeRect` through the same
 * cover-crop the renderer uses. The whole-frame version was simpler — `mask-size: cover`,
 * no coordinates — but it made this element the size of the viewport, and `mix-blend-mode`
 * takes an element off the compositor's fast path, so every frame of the hover fade
 * repainted and re-blended the entire room. That is what made the glow ease and then snap.
 * It still lives inside the anchor, offset back out, because that is what makes hover and
 * focus a plain CSS descendant selector rather than a piece of React state.
 */

import { useRef, type CSSProperties } from 'react';
import type { Hotspot } from '../data/hotspots';
import { SCENE } from '../data/scene';
import { imageRectToScreen, type ScreenRect } from '../scripts/roomGeometry';

interface Props {
  hotspot: Hotspot;
  box: ScreenRect;
  /** The room's own size, so the wake can be placed against the same cover-crop as the art. */
  view: { w: number; h: number };
  /** The art's aspect, for that same crop. */
  aspect: number;
  onActivate(hotspot: Hotspot): void;
}

/**
 * Fade and hit-testing are not props. They follow the camera, which moves every frame, and
 * a prop would mean a React render per frame for something CSS can do on the compositor:
 * Room.tsx writes the push progress to a custom property and the stylesheet reads it.
 */
export default function HotspotButton({ hotspot, box, view, aspect, onActivate }: Props) {
  const lightRef = useRef<HTMLSpanElement>(null);

  // The room parallaxes under this layer, so the rect has to follow it. `--par-x/y` are
  // written on `.room` once per frame by the rig; the multiply by this object's own
  // reciprocal depth happens here, in `left`/`top` rather than a transform — a transform
  // would make this a stacking context and `.hotspot__light`'s `screen` blend would stop
  // mixing with the canvas, which is the trap the comment above `.hotspot__wake` records.
  const invZ = 1 / SCENE.farZ + (1 / SCENE.nearZ - 1 / SCENE.farZ) * hotspot.disparity;
  const style = {
    left: `calc(${box.left}px + var(--par-x, 0) * ${invZ.toFixed(4)} * 1px)`,
    top: `calc(${box.top}px + var(--par-y, 0) * ${invZ.toFixed(4)} * 1px)`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    '--accent': hotspot.accent,
  } as CSSProperties;

  // The wake is cropped to its own lit extent, so it is placed by its own rect rather than
  // by the anchor's — through the same cover-crop the renderer uses, which is the only
  // thing that has to be true for it to land on the object. Offset back out of the anchor,
  // because it lives inside it: that is what makes hover and focus a plain CSS descendant
  // selector rather than a piece of React state.
  const lit = hotspot.wakeRect && imageRectToScreen(hotspot.wakeRect, view.w, view.h, aspect);
  const wakeStyle = lit && ({
    left: `${lit.left - box.left}px`,
    top: `${lit.top - box.top}px`,
    width: `${lit.width}px`,
    height: `${lit.height}px`,
  } as CSSProperties);

  const maskStyle = {
    maskImage: `url(${hotspot.wake})`,
    WebkitMaskImage: `url(${hotspot.wake})`,
  } as CSSProperties;

  return (
    <a
      id={`hotspot-${hotspot.id}`}
      className="hotspot"
      style={style}
      href={hotspot.href}
      onClick={(e) => {
        // A modified click stays a real navigation: new tab, new window, save. The camera
        // move is an enhancement over the link, never a replacement for it.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        // So does a click on a hotspot whose destination has not been built yet.
        if (!hotspot.focusState) return;
        e.preventDefault();
        // Kill the light synchronously, imperatively, right here — not through the
        // `.room--busy` CSS rule alone. That rule is correct but trails a frame behind the
        // camera: the rig's own state is mutated directly in `onActivate` below and starts
        // moving on the very next rAF tick, while React's re-render (which is what actually
        // applies `.room--busy`) commits and paints on its own schedule. In that gap the
        // light — pinned to the hotspot's rest-position rect — is visible over art that has
        // already started moving, which reads as the glow being a little misplaced.
        //
        // The inline override is a bridge, not a replacement, and has to be handed back: an
        // inline style sits outside React's own bookkeeping (it never appears in `style={}`,
        // so nothing about a later re-render clears it), and `.room--busy` is what is
        // actually supposed to own this once it has had a frame to apply. Left in place, it
        // pins the light at opacity 0 forever — hover stops working on return visits to the
        // room, which is worse than the one-frame flash this exists to fix. One rAF is
        // enough: by the following frame the class has committed and painted.
        const light = lightRef.current;
        if (light) {
          light.style.opacity = '0';
          requestAnimationFrame(() => { light.style.opacity = ''; });
        }
        onActivate(hotspot);
      }}
    >
      {hotspot.wake && wakeStyle && (
        // A bare positioning wrapper, and it has to stay bare: the light is `screen`-blended
        // and any ancestor carrying opacity or a filter would isolate the group, stop it
        // mixing with the canvas, and turn it back into a flat accent decal.
        <span className="hotspot__wake" style={wakeStyle} aria-hidden="true">
          <span ref={lightRef} className="hotspot__light" style={maskStyle} />
        </span>
      )}
      <span className="hotspot__label">{hotspot.label}</span>
    </a>
  );
}
