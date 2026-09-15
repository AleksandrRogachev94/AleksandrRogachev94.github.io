/**
 * One room control — an object that answers in place.
 *
 * **A `<button aria-pressed>`, where `Hotspot.tsx` is an `<a href>`, and the difference is
 * the point.** A hotspot navigates: rule 2 gives every destination a real URL, so it is a
 * link, and cmd-click, middle-click and "copy link address" all do something useful. A
 * control navigates nowhere and has a state, so it is a toggle button — and `aria-pressed`
 * is what makes that state exist for a screen reader, which is the only channel where a
 * light coming up on a speaker says nothing at all.
 *
 * **Two lights, and they say different things.** That separation is the correction; it took
 * a version where they were one light to find it.
 *
 *   the wake (`ObjectLight`)   hover and focus, exactly as on a hotspot — *you are pointing
 *                              at this*
 *   the LED (`.control__led`)  always there — *this is a machine, and here is its state*
 *
 * The first version had only the wake, pulsing slowly at rest to stand in for both. It could
 * not work, and not because of its amplitude: a wake at rest is a dimmer copy of the thing
 * that means "hovered", so the strongest statement it can make is "faintly hovered". The
 * resting tell has to be a *different kind of object* than the hover response. data/controls.ts
 * carries the rest of that argument, including why the pulse was also literally invisible.
 *
 * **Cadence carries the state, not colour or brightness.** Breathing means standby and steady
 * means playing, which is how the hardware itself behaves — and it is the same distinction the
 * ambient tier already draws between the feeder blinking (a camera taking a frame) and the
 * rover breathing (a machine idling). What separates the two *grammars* is hue: destinations
 * light in their own accent, a control in the room's amber.
 *
 * The lit state is also the only feedback audio can have. A toggle whose entire effect is a
 * sound is unusable the moment the sound fails to start, and `roomAudio.ts` is explicit that
 * it often will — no gesture, no file, a codec the browser refuses. The state comes back from
 * the attempt, never from the click.
 */

import type { CSSProperties } from 'react';
import type { RoomControl } from '../data/controls';
import { imageRectToScreen, pinToArt, type ScreenRect } from '../scripts/roomGeometry';
import ObjectLight from './ObjectLight';

interface Props {
  control: RoomControl;
  box: ScreenRect;
  /** The room's own size, so the overlays land through the same cover-crop as the art. */
  view: { w: number; h: number };
  /** The art's aspect, for that same crop. */
  aspect: number;
  on: boolean;
  onToggle(): void;
}

export default function RoomControlButton({ control, box, view, aspect, on, onToggle }: Props) {
  // Glued to the art exactly the way a hotspot is — same placement, same reasons.
  const style = {
    ...pinToArt(box, control.distanceM),
    '--accent': control.accent,
  } as CSSProperties;

  // Offset back out of the button it lives inside, the same way the wake is: both are
  // authored against the master and both have to land on the object rather than on the
  // tap target's corner.
  const led = imageRectToScreen(control.ledRect, view.w, view.h, aspect);
  const ledStyle: CSSProperties = {
    left: `${led.left - box.left}px`,
    top: `${led.top - box.top}px`,
    width: `${led.width}px`,
    height: `${led.height}px`,
  };

  return (
    <button
      id={`control-${control.id}`}
      type="button"
      className={`control ${on ? 'control--on' : ''}`}
      style={style}
      aria-pressed={on}
      onClick={onToggle}
    >
      <ObjectLight
        src={control.wake}
        wakeRect={control.wakeRect}
        box={box}
        view={view}
        aspect={aspect}
      />
      {/* Wrapper carries the rect, `.glow` inside it carries the light — the same split the
          ambient tier uses, and it is structural: the bloom reaches past its own rect with
          `inset`, which an element that already has left/top/width/height on it cannot do. */}
      <span className="control__led" style={ledStyle} aria-hidden="true">
        <span className="glow" />
      </span>
      {/* The label carries the state, because the light cannot say which way the switch is
          for someone who cannot see it — and `aria-pressed` above cannot say what the two
          positions mean. */}
      <span className="hotspot__label">{on ? control.labelOn : control.label}</span>
    </button>
  );
}
