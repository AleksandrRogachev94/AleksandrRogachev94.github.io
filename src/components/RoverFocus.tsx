/**
 * RoboTrail: what the rover becomes. **This is a placeholder, and it is shaped so that
 * replacing it is cheap.**
 *
 * What is real here is the *arrival* — the camera push, the veil schedule, the cut, the
 * history entry, Esc, the focus move. What is provisional is everything inside the panel.
 * That split is deliberate: the approach is the part that has to be tuned against the
 * reconstruction (hotspots.ts), and tuning it now against a real 3.18m push is worth more
 * than tuning it later against content that does not exist yet.
 *
 * **It borrows the window's verb rather than inventing its own**, and that is a decision
 * with a shelf life. room.css is clear that `takeover` — the clip growing out of the
 * object's own rect — *asserts* that the object becomes the viewport, which is true of a
 * monitor and false of everything else in the room; running it on a bird feeder made the
 * feeder behave like a screen. A rover is not a screen either, so the takeover is out. What
 * is left is the cut, which claims nothing: the room falls away and something else is there.
 *
 * The reason not to go further than that yet is the one WindowFocus.tsx paid for. The
 * window's first destination was a screenshot of a dashboard, and *no* transition could have
 * rescued it, because the problem was the destination. A rover that maps a room should
 * probably arrive as the map — its own occupancy grid drawing itself, or the pose graph
 * closing a loop — and the verb should follow from whatever that turns out to be. Picking a
 * third verb before the content exists is guessing in the same direction that already cost
 * one rebuild.
 *
 * **No state, no stage-manager slot.** Static text on a flat ground: rule 1 has nothing to
 * protect against. The moment this shows a live map — a canvas, a replayed bag, anything
 * that runs — it registers with `src/scripts/stage.ts` like everything else, and this
 * paragraph is where to start.
 */

import { useEffect, useRef } from 'react';
import type { Hotspot } from '../data/hotspots';
import type { LastInputRef } from './useLastInput';

interface Props {
  hotspot: Hotspot;
  /** False once the exit has begun, so the panel can dissolve before it unmounts. */
  open: boolean;
  /**
   * When the cut fires, in ms from the click — the moment the room has finished falling
   * away (push 0.80, hotspots.ts), which is a fifth of the way before the camera stops.
   * Room.tsx converts that push fraction into wall-clock; the ease means it is not 0.80 of
   * the duration. Zero when nothing preceded the panel (reduced motion, no WebGL), where
   * there is no approach to trail.
   */
  atMs: number;
  /** Whether the last interaction was a pointer, so mouse users are not focus-yanked. */
  lastInputRef: LastInputRef;
  onExit(): void;
}

/**
 * Facts about the machine, in the dark palette's voice — mono, measured, no adjectives.
 *
 * **Every line is one the document downstairs already makes** (index.astro's `#robotrail`,
 * and CLAUDE.md's note on `../robot`). A first draft of this list said "differential drive"
 * and "odometry + imu", and neither is written down anywhere — they were guesses that
 * *sounded* like a rover. The rest of this site is built on the rule that the dark palette
 * only recites things that are checkable, and a placeholder is exactly where that rule is
 * easiest to break, because nobody is going to fact-check filler. Four short lines that are
 * true beat eight that read well.
 */
const FACTS: readonly [string, string][] = [
  ['form', 'tracked rover'],
  ['platform', 'raspberry pi'],
  ['mapping', 'graph slam'],
  ['closes on', 'its own odometry'],
];

export default function RoverFocus({ hotspot, open, atMs, lastInputRef, onExit }: Props) {
  const backRef = useRef<HTMLButtonElement>(null);

  // Put the keyboard on the way out, so Tab continues from here. Room.tsx puts it back on
  // the hotspot when the panel closes.
  useEffect(() => {
    if (lastInputRef.current === 'pointer') return;
    backRef.current?.focus();
  }, [lastInputRef]);

  const style = {
    '--accent': hotspot.accent,
    '--t0': `${Math.round(atMs)}ms`,
  } as React.CSSProperties;

  const className = [
    'focus', 'bay',
    open ? 'focus--open' : 'focus--closing',
    // The cut, shared with the window — see "the cut" in room.css. Overrides the base
    // open/closing animations on specificity, exactly as `.focus--feed` does.
    'focus--rover',
  ].join(' ');

  return (
    <div className={className} style={style} role="dialog" aria-modal="true" aria-label="RoboTrail">
      <header className="field__bar">
        <button ref={backRef} type="button" className="chrome-back" onClick={onExit}>
          &larr; back to the room <kbd>Esc</kbd>
        </button>
        <span className="deck__spacer" />
        <span className="field__dot" aria-hidden="true" />
        <span className="field__name">RoboTrail</span>
        <span className="field__where">the floor, by the desk</span>
      </header>

      <div className="bay__read">
        <p className="field__eyebrow">the rover</p>
        <h2 className="field__h">A tracked rover that maps where it has been</h2>
        <p className="field__lede">
          Graph SLAM on a Raspberry Pi. It drives, keeps a graph of the poses it thinks it
          passed through, and corrects the whole graph against its own odometry when it
          arrives somewhere it has been before.
        </p>

        <dl className="field__rail">
          {FACTS.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {/* Honest about its own state. A placeholder that pretends to be finished is the
            one thing worse than a placeholder — and the room already says elsewhere that
            props being visible but not yet live is the intended condition, not a gap. */}
        <p className="bay__note">The map, and the write-up it belongs to, are still being built.</p>

        <p className="field__links">
          <a href={hotspot.href}>what it is, for now &rarr;</a>
        </p>
      </div>
    </div>
  );
}
