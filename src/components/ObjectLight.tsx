/**
 * An object's own light, coming up over its own silhouette.
 *
 * Both interaction grammars use exactly this — a hotspot when you hover it, a room control
 * when you hover it — and both used to carry their own copy of the same fifteen lines. The
 * copies were identical, which is the only honest reason to extract something: the shared
 * part is not a coincidence, it is `tools/wake.py`'s output being placed the one way it can
 * be placed. Same argument as `pinToArt` one layer up.
 *
 * **The two spans are not decoration.** The outer one positions, the inner one blends, and
 * they cannot be merged: `mix-blend-mode` on a masked element that also carries a computed
 * `left`/`top` is fine, but the wrapper is what keeps the light's box independent of the
 * button's — the wake is cropped to its own lit extent, so it lands by `wakeRect` and is
 * offset back out of the anchor it lives inside. Living inside the anchor is what makes
 * hover and focus a plain CSS descendant selector rather than a piece of React state.
 *
 * **The wrapper has to stay bare** — no opacity, no filter, no transform. Any of those
 * makes it an isolated group, `screen` stops mixing with the canvas, and the light turns
 * back into a flat accent decal. That is the trap, and it is the reason this is one
 * component instead of a convention two files are each expected to remember.
 *
 * The class names say *the object's light*, not which grammar owns it, which is why a
 * control reuses them unchanged rather than getting a parallel set of its own.
 */

import type { CSSProperties, Ref } from 'react';
import { imageRectToScreen, type NormRect, type ScreenRect } from '../scripts/roomGeometry';

interface Props {
  /** The baked wake image (`public/art/wake-*.webp`). */
  src: string;
  /** Where that crop sits on the master, normalised — printed by `tools/wake.py`. */
  wakeRect: NormRect;
  /** The owning button's box, so the wake can be offset back out of it. */
  box: ScreenRect;
  /** The room's own size and the art's aspect, for the renderer's cover-crop. */
  view: { w: number; h: number };
  aspect: number;
  /** Hotspot.tsx pokes `opacity` on the light directly for one frame when a push starts. */
  lightRef?: Ref<HTMLSpanElement>;
}

export default function ObjectLight({ src, wakeRect, box, view, aspect, lightRef }: Props) {
  const lit = imageRectToScreen(wakeRect, view.w, view.h, aspect);

  const wakeStyle: CSSProperties = {
    left: `${lit.left - box.left}px`,
    top: `${lit.top - box.top}px`,
    width: `${lit.width}px`,
    height: `${lit.height}px`,
  };

  const maskStyle: CSSProperties = {
    maskImage: `url(${src})`,
    WebkitMaskImage: `url(${src})`,
  };

  return (
    <span className="hotspot__wake" style={wakeStyle} aria-hidden="true">
      <span ref={lightRef} className="hotspot__light" style={maskStyle} />
    </span>
  );
}
