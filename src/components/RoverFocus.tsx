/**
 * RoboTrail: what the rover becomes once the camera has pushed across the floor toward it.
 *
 * **The destination is the dashboard from the project's own demo** — the rover's camera feed
 * beside the occupancy grid assembling itself — played full-bleed as the panel's ground, with
 * the text column over the camera pane so the map stays clear on the right.
 *
 * **It keeps the window's cut, and now on the merits rather than as a placeholder's
 * borrowing.** `feed-expose` is a camera exposing, and both destinations are footage off a
 * machine with a camera on it. What the cut still refuses to claim is the takeover's
 * assertion that an object *becomes the viewport*, which a monitor is and a robot is not.
 *
 * **It autoplays, muted and looped, and that is the point of the push**: the room's claim is
 * that driving the camera into an object makes it go live. Under `prefers-reduced-motion` it
 * does not, and degrades to the poster with real controls rather than to nothing.
 *
 * **Being video, it claims the stage manager's single slot** (CLAUDE.md rule 1) — the first
 * destination outside the bench to do so, which is also what gets it paused on a hidden tab.
 *
 * Prose, rail and clip come from src/data/robotrail.ts, which /robotrail also reads.
 */

import { useEffect, useRef, useState } from 'react';
import type { Hotspot } from '../data/hotspots';
import { DEMO, HEADLINE, LEDE, FACTS, REPO } from '../data/robotrail';
import * as stage from '../scripts/stage';
import type { LastInputRef } from './useLastInput';

interface Props {
  hotspot: Hotspot;
  /** False once the exit has begun, so the panel can dissolve before it unmounts. */
  open: boolean;
  /**
   * When the cut fires, in ms from the click — this destination's own `veil.full`, 0.80 of
   * the push (hotspots.ts), past which the room is a dark smear at 7.1x magnification. Zero
   * when nothing preceded the panel (reduced motion, no WebGL). It is also the head start
   * the `<video>` gets to buffer, which is why `preload` below is `auto`.
   */
  atMs: number;
  /**
   * Whether the last interaction was a pointer, so the focus move below can be skipped for
   * mouse users. Owned by Room.tsx — see useLastInput.ts for why it cannot be owned here.
   */
  lastInputRef: LastInputRef;
  /**
   * `prefers-reduced-motion`, passed rather than measured: Room.tsx already owns it. `atMs
   * === 0` cannot stand in for it, being equally true with motion allowed and no WebGL2.
   */
  reduced: boolean;
  onExit(): void;
}

export default function RoverFocus({
  hotspot, open, atMs, lastInputRef, reduced, onExit,
}: Props) {
  const backRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * Set when autoplay is refused — a data-saver mode, a per-site setting. The failure is
   * silent and leaves a poster that looks broken, so the controls appear instead: degrade
   * explicitly, never silently.
   */
  const [refused, setRefused] = useState(false);

  /** Whether the native player chrome is on screen. Drives both the layout and the resume
   *  rule below, so it is named once. */
  const player = reduced || refused;

  // Put the keyboard on the way out, so Tab continues from here. Room.tsx puts it back on
  // the hotspot when the panel closes.
  useEffect(() => {
    if (lastInputRef.current === 'pointer') return;
    backRef.current?.focus();
  }, [lastInputRef]);

  /**
   * The single live slot, and the tab rule that comes with it. Registered even under reduced
   * motion, because a visitor who presses play is running a video and rule 1 does not care
   * how it started. `destroy` only pauses: unlike flowlab's cross-origin iframe, a stopped
   * `<video>` holds nothing, and the element unmounts with this effect anyway — what
   * `destroy` is really for is eviction while the panel is still mounted.
   *
   * **`resumeOnReturn` seeds to the autoplay intent, not to `false`.** `stage.mount` pauses
   * at once if the tab is already hidden (the room opened in a background tab), so reading
   * playback state there would latch "was not playing" before it ever could be, and the run
   * would never start. The one case that seeding gets wrong is a visitor pausing deliberately
   * — possible only with controls up, which is why `player` gates it.
   */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    // Belt and braces for the autoplay policy: React does set `muted` as a property, but a
    // muted autoplay that is muted only by attribute is refused, and this is cheap.
    el.muted = true;

    let resumeOnReturn = !reduced;

    return stage.mount({
      id: `focus:${hotspot.id}:demo`,
      destroy() { el.pause(); },
      pause() {
        if (el.paused) {
          // Already stopped. Theirs if they had the means to do it, ours otherwise.
          if (player) resumeOnReturn = false;
          return;
        }
        resumeOnReturn = true;
        el.pause();
      },
      resume() {
        if (!resumeOnReturn) return;
        void el.play().catch(() => setRefused(true));
      },
    });
  }, [hotspot.id, reduced, player]);

  /** Start the run. Not left to the attribute alone: a rejected `play()` promise is the
   *  only way to find out autoplay was declined. */
  useEffect(() => {
    if (reduced) return;
    const el = videoRef.current;
    if (!el) return;
    void el.play().catch(() => setRefused(true));
  }, [reduced]);

  /**
   * The same two the window sets. The crop anchor differs per destination but is a constant,
   * so it lives in room.css as `--view-pos`; only `--t0` is arithmetic done at click time.
   */
  const style = {
    '--accent': hotspot.accent,
    '--t0': `${Math.round(atMs)}ms`,
  } as React.CSSProperties;

  const className = [
    'focus', 'field',
    open ? 'focus--open' : 'focus--closing',
    // The cut, shared with the window — see "the cut" in room.css. Overrides the base
    // open/closing animations on specificity.
    'focus--rover',
    // The control bar is drawn along the bottom edge of a full-bleed video, which is where
    // `.field__read` already lives. Lifts the column clear of it. See room.css.
    player && 'field--player',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} style={style} role="dialog" aria-modal="true" aria-label="RoboTrail">
      {/*
        The arrival, full-bleed and behind everything. `aria-label` because a `<video>` has no
        `alt`, and it says what is in the frame rather than naming the file.

        No `controls` while it plays: this is the ground the column sits on, not a player, and
        native chrome would collide with the column and announce the panel as a media widget.
        The write-up gives the same file real controls, which is where reading it is the point.
      */}
      <video
        ref={videoRef}
        className="field__view"
        src={DEMO.src}
        poster={DEMO.poster}
        aria-label={DEMO.label}
        autoPlay={!reduced}
        loop
        muted
        playsInline
        // `auto`, not `metadata`: the element is in the DOM from the click and the cut does
        // not fire until `--t0`, so there is a whole camera push of head start to spend.
        preload="auto"
        controls={player}
        controlsList="nodownload"
      />

      {/* Legibility for the column, and nothing else. */}
      <div className="field__scrim" aria-hidden="true" />

      <header className="field__bar">
        <button ref={backRef} type="button" className="chrome-back" onClick={onExit}>
          &larr; back to the room <kbd>Esc</kbd>
        </button>
        <span className="deck__spacer" />
        <span className="field__dot" aria-hidden="true" />
        <span className="field__name">RoboTrail</span>
        <span className="field__where">the floor, by the desk</span>
      </header>

      <div className="field__read">
        <p className="field__eyebrow">an autonomous run</p>
        <h2 className="field__h">{HEADLINE}</h2>
        <p className="field__lede">{LEDE}</p>

        <dl className="field__rail">
          {FACTS.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {/* The notes, the hardware photograph, the full dashboard run and the repo's
            derivations all live on the write-up. A focus state is an arrival, not an
            article — the same line BirdLense holds, and the reason neither panel has grown
            a gallery. */}
        <p className="field__links">
          <a href={hotspot.href}>the write-up &rarr;</a>
          <a href={REPO} target="_blank" rel="noopener">source &#8599;</a>
        </p>
      </div>
    </div>
  );
}
