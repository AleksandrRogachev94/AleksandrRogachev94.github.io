/**
 * The day/night switch.
 *
 * **A room control (CLAUDE.md rule 5): it changes something in place and never moves the
 * camera.** That is the whole of its grammar, and it is why this is a `<button
 * aria-pressed>` rather than the `<a href>` every hotspot is. There is nowhere to go.
 *
 * **Chrome, not an object, and that is a deliberate stop rather than the intended end.** The
 * room's other control is the speaker: a rect on the art, its own wake mask, a standby LED
 * on its top face (data/controls.ts). The floor lamp is the object this one belongs on, and
 * it cannot have it yet for a reason that is worth writing down rather than rediscovering —
 * `tools/wake.py` bakes an object's wake from the **day** master, where the lamp is off. A
 * wake is the object's own light; baking "lamp, unlit" and using it to say "the lamp
 * responds" would be the wrong picture in the one place the object is about light. Anchoring
 * it needs a wake cut from the night master, and then a rule for which one to show. Until
 * then a corner button is honest about being chrome instead of pretending to be furniture.
 *
 * When that lands this file is deleted, not extended: the lamp becomes a second entry in
 * `CONTROLS` and reuses `RoomControl.tsx` whole. Nothing else here is load-bearing.
 *
 * **The label says where the click goes, not where you are.** The room itself says where you
 * are — it is lit — so a button reading "night" beside a dark room is ambiguous in exactly
 * the way a light switch marked with its current state is. `aria-pressed` carries the state
 * for anyone who cannot see the room, which is the channel that needs it.
 */

import type { Daylight } from '../scripts/daylight';

interface Props {
  /** What the room is showing. Null until the mount effect has read the visitor's clock. */
  daylight: Daylight | null;
  onToggle(): void;
}

export default function DaylightToggle({ daylight, onToggle }: Props) {
  // Nothing until the clock has been read. This is an island: its HTML is produced at build
  // time, so rendering a state here would ship the build machine's timezone and then correct
  // it on hydration — a switch that visibly flips itself on load.
  if (!daylight) return null;

  const night = daylight === 'night';
  return (
    <button
      type="button"
      className="daylight"
      aria-pressed={night}
      onClick={onToggle}
    >
      {/* Two glyphs rather than one that swaps: both are always in the DOM and the CSS
          crossfades them, so the button cannot reflow mid-transition and a screen reader is
          not read a label that changes under it. `aria-hidden` because the text below is
          what should be announced. */}
      <span className="daylight__icons" aria-hidden="true">
        <span className="daylight__sun" />
        <span className="daylight__moon" />
      </span>
      <span className="daylight__label">{night ? 'Daylight' : 'Night'}</span>
    </button>
  );
}
