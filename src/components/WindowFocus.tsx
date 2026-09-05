/**
 * BirdLense: what the window becomes once the camera has pushed toward the feeder.
 *
 * **Why this looks nothing like the bench, and should not.** The monitor's focus state is a
 * machine's own screen, so it boots, keeps a clock, and reports facts about itself. The
 * window is not a screen — it is a view onto a thing that lives in the yard and runs whether
 * or not anyone is on this website. So there is no power-on here: a feeder does not turn on
 * when you look at it. The panel simply opens onto what the feeder saw, and the arrival cue
 * is the content resolving rather than a device waking. Same palette, same takeover, same
 * `.focus` shell — different behaviour, because they are different kinds of object.
 *
 * **So it cuts rather than opening.** The bench's `takeover` is a clip that starts as the
 * object's own rectangle and pushes its edges off the frame — a shape that asserts *this
 * object becomes the viewport*. That is true of a monitor and false of a bird feeder, and
 * running it here made clicking the feeder feel like being teleported into the monitor.
 * BirdLense is a camera, so the honest gesture is the one a feed switch makes: the room falls
 * away and the feeder's own view is what is there instead.
 *
 * **And the destination had to change too, which is the part the transition could not fix.**
 * The first version of this panel showed the project's dashboard — a screenshot of a web UI,
 * framed, on a dark surface — so it still read as another monitor however you arrived at it.
 * No cut, no easing and no veil schedule can rescue a destination that is a picture of a
 * computer screen. What the feeder actually sees is a bird on a rail, so that is what fills
 * the frame, with the tracker's box and the classifier's 88% still on it because those are
 * the *output*, not chrome. The app's own screens moved to /birdlense.
 *
 * **The camera stops much further out here (travel 0.55) than at the monitor (0.84)**, and
 * that is a fact about the reconstruction, not a preference: the feeder is 8.31m away and
 * 0.059 of frame width, so filling the frame would need travel 0.95 — a 7.9m translation
 * that flies the camera through the glass (hotspots.ts). Off-axis at that distance is also
 * the worst case in the room for SHARP, which is why the veil starts at 0.15 here and is
 * finished by 0.70: magnifying that reconstruction finds holes. **That schedule and the cut
 * are one decision.** A panel that grows out of an object needs the room legible up to the
 * handoff, so it cannot dim early; a cut has no seam to protect, so it can. Getting the
 * grammar wrong is what made the artifacts unavoidable.
 *
 * The view then carries what the push cannot: it is the "close plate" PLAN.md's asset ladder
 * wants, except it is a real frame from the real device rather than a painting of one.
 *
 * **The cut is made invisible by matching both sides of it**, not by covering it. The room
 * bottoms out at 12% brightness and 9px of blur, so the view *starts* at 12% and 6px and
 * then exposes and pulls focus while still moving inward — a camera adjusting, which is what
 * the object on the other end of this push actually is. An earlier version held a beat of
 * black first (borrowed from the bench, where a machine really is powering on) and the
 * result was stop, hold, flash: three events where there should be one motion.
 *
 * **No state, and no stage-manager slot.** There was a thumbnail gallery here and it is gone
 * with the dashboards it switched between — a focus state is an arrival, not an article, and
 * the strip of framed screenshots was half of why this read as a second monitor. What is left
 * is one image and some prose, so rule 1 has nothing to protect against. If the frame ever
 * becomes real video, that changes and this comment is where to start.
 */

import { useEffect, useRef } from 'react';
import type { Hotspot } from '../data/hotspots';
import { VIEW, FACTS, REPO } from '../data/birdlense';
import type { LastInputRef } from './useLastInput';

interface Props {
  hotspot: Hotspot;
  /** False once the exit has begun, so the panel can dissolve before it unmounts. */
  open: boolean;
  /**
   * **When the cut fires, in ms from the click** — the one number this panel's whole
   * timeline hangs off, and it is not the end of the push.
   *
   * Room.tsx puts it at the moment the room finishes disappearing (push 0.70, hotspots.ts),
   * which is a third of the way before the camera stops. Past that point the room is a dark
   * smear and there is nothing to watch, and it is also where the camera starts visibly
   * slowing down — so cutting there means the deceleration is never seen and the arrival
   * lands while everything is still moving. Zero when nothing preceded the panel (reduced
   * motion, no WebGL), where there is no approach to trail.
   */
  atMs: number;
  /**
   * Whether the last interaction was a pointer, so the focus move below can be skipped for
   * mouse users. Owned by Room.tsx — see useLastInput.ts for why it cannot be owned here.
   */
  lastInputRef: LastInputRef;
  onExit(): void;
}

/**
 * Deliberately **not** taking the pushed rect the bench takes. That rectangle exists to be
 * the first frame of a clip growing out of the object, and there is no clip here. Accepting
 * it "in case" would leave the next person to read this file believing the window still
 * animates out of the feeder.
 */
export default function WindowFocus({ hotspot, open, atMs, lastInputRef, onExit }: Props) {
  const backRef = useRef<HTMLButtonElement>(null);

  // Put the keyboard on the way out, so Tab continues from here. Room.tsx puts it back on
  // the hotspot when the panel closes.
  useEffect(() => {
    if (lastInputRef.current === 'pointer') return;
    backRef.current?.focus();
  }, [lastInputRef]);

  // Two custom properties, where the bench needs five. Four of the bench's five are the
  // clip's starting rectangle, and there is no clip. `--t0` is inline rather than a class
  // because it is a computed instant, not one of two states — which is what let the
  // `focus--cut` class go.
  const style = {
    '--accent': hotspot.accent,
    '--t0': `${Math.round(atMs)}ms`,
  } as React.CSSProperties;

  const className = [
    'focus', 'field',
    open ? 'focus--open' : 'focus--closing',
    // Overrides the base open/closing animations on specificity: a hard cut in, a dissolve
    // out, no clip and no display-waking blur. See "the cut" in room.css.
    'focus--feed',
  ].join(' ');

  return (
    <div className={className} style={style} role="dialog" aria-modal="true" aria-label="BirdLense">
      {/*
        Full-bleed, behind everything, and it is the arrival — not an illustration of it.
        `alt` is real: this image carries the only content in the panel that is not also in
        the prose beside it.
      */}
      <img className="field__view" src={VIEW.src} alt={VIEW.alt} />

      {/* Legibility for the column, and nothing else. Weighted to the left because the bird
          sits right of centre in the frame — the text goes where the picture is quiet. */}
      <div className="field__scrim" aria-hidden="true" />

      <header className="field__bar">
        <button ref={backRef} type="button" className="chrome-back" onClick={onExit}>
          ← back to the room <kbd>Esc</kbd>
        </button>
        <span className="deck__spacer" />
        <span className="field__dot" aria-hidden="true" />
        <span className="field__name">BirdLense</span>
        <span className="field__where">the yard, through the window</span>
      </header>

      <div className="field__read">
        <p className="field__eyebrow">the feeder&rsquo;s camera</p>
        <h2 className="field__h">A feeder that watches, listens and keeps a log</h2>
        <p className="field__lede">
          A Raspberry Pi in the yard records what visits the feeder, works out what it was
          from the video and the audio, and writes it down. The box is the tracker holding
          one identity across the clip; the label and the 88% are the classifier.
        </p>

        <dl className="field__rail">
          {FACTS.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {/* The three notes and the app's own screens live on the write-up. A focus state is
            an arrival, not an article — and putting dashboards back in here is exactly what
            made this panel read as a second monitor. */}
        <p className="field__links">
          <a href={hotspot.href}>the write-up &rarr;</a>
          <a href={REPO} target="_blank" rel="noopener">source &#8599;</a>
        </p>
      </div>
    </div>
  );
}
