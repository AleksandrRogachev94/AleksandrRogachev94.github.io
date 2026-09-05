/**
 * Which input drove the most recent interaction.
 *
 * A focus state moves the keyboard onto its own back control when it opens, so that Tab
 * continues from where the visitor now *is* rather than from the top of a document they can
 * no longer see. But a click already focuses whatever was clicked the normal way, and the
 * browser cannot tell a script's `.focus()` call apart from one that followed a keypress —
 * so doing it unconditionally left a focus ring parked on "back" after every mouse click
 * too. This is the ref that says whether the move is wanted.
 *
 * Capture phase, on `window`, so it sees the event before anything can stop it propagating.
 *
 * **It has to be called from a component that outlives the click, which means Room.tsx.**
 * Calling it inside a focus panel does not work and is not obviously broken: the panel mounts
 * *because* of the click, so its listeners are registered a beat after the `pointerdown` that
 * opened it, and the ref still holds its initial `'keyboard'` on the one render that matters.
 * The guard then passes for everybody and the ring parks on "back" after every mouse click —
 * exactly the bug this exists to prevent, with the code in place that was supposed to prevent
 * it. Room is mounted from the first paint, so by the time anything is clicked the listener
 * has been up for as long as the room has.
 *
 * Shared by both focus states rather than copied into each: it is the same twelve lines and
 * the same reasoning, and the failure mode of them drifting apart is a focus ring that
 * appears for mouse users in one destination and not the other.
 */

import { useEffect, useRef, type RefObject } from 'react';

/** What the hook hands out, so a focus panel can take it as a prop. */
export type LastInputRef = RefObject<'pointer' | 'keyboard'>;

export function useLastInput(): LastInputRef {
  const ref = useRef<'pointer' | 'keyboard'>('keyboard');
  useEffect(() => {
    const onPointerDown = () => { ref.current = 'pointer'; };
    const onKeyDown = () => { ref.current = 'keyboard'; };
    addEventListener('pointerdown', onPointerDown, true);
    addEventListener('keydown', onKeyDown, true);
    return () => {
      removeEventListener('pointerdown', onPointerDown, true);
      removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
  return ref;
}
