/**
 * The room → screen transition, as one timeline.
 *
 * **Why this file exists.** The handoff is spread across three mechanisms — the camera rig
 * (JS, driven by rAF), the panel's clip-path and boot (CSS keyframes), and the two timers
 * in Room.tsx that decide when it is safe to stop drawing the room. They used to carry
 * three independent sets of numbers, and the numbers disagreed: the camera eased
 * asymptotically toward its target with no defined end, while the panel took over on a
 * hardcoded 600ms delay that was a *guess* at when the camera would be there. The result
 * read as two moves with a stall between them — the thing this file removes. One set of
 * numbers, imported by the rig and written onto the room as custom properties, so the
 * camera cannot finish at a moment the stylesheet does not know about.
 *
 * The order of events, and why each boundary is where it is:
 *
 *   0                                  the click. The camera starts moving.
 *   pushMs                             the camera has arrived, and the screen is now ~98%
 *                                      of the frame. It stops here for good — past this
 *                                      the bezels leave frame and the splats magnify
 *                                      faster than the veil hides them. The panel takes
 *                                      over on this exact frame, at exactly the rectangle
 *                                      the screen reached.
 *   pushMs + takeoverMs                the panel covers the viewport — genuinely black by
 *                                      now, both the room (dimmed to ~12%) and the panel
 *                                      itself, so the room can stop drawing.
 *   pushMs + takeoverMs + blackPauseMs the boot sequence is allowed to start. The pause is
 *                                      a deliberate held beat of plain black before the
 *                                      machine says anything — the arrival gets to read as
 *                                      an arrival first.
 *   pushMs + takeoverMs + blackPauseMs
 *     + bootMs                         the machine has finished coming up.
 *
 * and on the way out:
 *
 *   0                       the panel starts collapsing *and* the camera starts back. Both
 *   closeMs                 the panel is gone; the rest of the pull-back is in the open.
 *   releaseMs               the camera is home.
 *
 * `closeMs` is deliberately much shorter than `releaseMs`. The exit used to hide the fast
 * part of the pull-back behind the panel and reveal only the slow tail, which is why it
 * read as no motion at all: by the time you could see the room, it had almost finished
 * moving. The panel now clears in a fifth of the retreat, so the retreat is the thing you
 * watch.
 */

export const TRANSITION = {
  /** Click → the camera has arrived and stopped. */
  pushMs: 900,
  /**
   * The screen becoming the viewport. Starts the frame the camera stops.
   *
   * Longer than the 420ms it was: at that speed the expansion outran the camera it was
   * supposed to be continuing, so the handoff read as a snap even with the velocities
   * matched at the seam. The panel also arrives slightly out of focus and resolves over the
   * first half of this (see `focus-in` in room.css), which is the other half of not landing
   * on a hard edge.
   */
  takeoverMs: 520,
  /**
   * Plain black, held after the takeover finishes covering the viewport and before the boot
   * sequence is allowed to start (room.css's `--boot0`).
   *
   * There used to be a bright radial flare here instead, timed to spike the instant the
   * takeover *started* — meant to mask the swap from room art to panel. It read as a flash
   * no matter how it was tuned, because the swap it was covering for was the real problem
   * (see `.room__canvas` in room.css). With that fixed, the fade-to-black doesn't need
   * hiding — it's the destination, not an artifact — and this pause is what lets it read as
   * one: the frame gets to be black on purpose for a beat before anything happens on it,
   * rather than the boot content elbowing in on a screen still mid-expansion.
   */
  blackPauseMs: 130,
  /** The panel collapsing back onto the monitor. Short: leaving is never a negotiation. */
  closeMs: 200,
  /** The camera pulling back out into the room. */
  releaseMs: 750,
  /**
   * Power-on, measured from `--boot0` (after the takeover *and* the black pause). Plays
   * every time you push into the monitor — there is no "already booted" flag; see
   * MonitorFocus.
   *
   * The sequence needs room to be a sequence. At 820ms it was over before the eye had
   * finished arriving; the lines now stagger in, the machine answers each one, and the
   * finished screen *stands* for ~300ms before it hands over to the interface.
   *
   * 1600 → 1800: each row grew a beat (the dotted leader now visibly sweeps between the key
   * and the value instead of both fading in together — see `.boot__line::after` in
   * room.css), which pushed WELCOME later. Widened to keep it standing for the same ~300ms
   * once it arrives, rather than cutting to the interface right on its heels.
   */
  bootMs: 1800,
} as const;

/**
 * The same numbers as custom properties, for the stylesheet. Room.tsx puts these on the
 * room element; room.css declares the same values as fallbacks so it can still be read on
 * its own, but these are what actually apply.
 */
export const TRANSITION_VARS = {
  '--push-ms': `${TRANSITION.pushMs}ms`,
  '--takeover-ms': `${TRANSITION.takeoverMs}ms`,
  '--black-pause-ms': `${TRANSITION.blackPauseMs}ms`,
  '--close-ms': `${TRANSITION.closeMs}ms`,
  '--boot-ms': `${TRANSITION.bootMs}ms`,
} as const;
