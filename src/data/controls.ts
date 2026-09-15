/**
 * Room controls: the room's *second* interaction grammar.
 *
 * A hotspot means **the camera pushes in and a focus state goes live**. A control means
 * **something changes in place and the camera never moves** (CLAUDE.md rule 5). Overloading
 * one object with both is what the rule exists to prevent — which is why the guitar stays a
 * future destination rather than becoming the audio toggle, and why this is a separate file
 * rather than an `isControl` flag on `Hotspot`. A flag would put two grammars in one array
 * and one component, and the next person to add an entry would have to know which half of
 * the interface they were touching.
 *
 * **Nothing here lights in a destination accent**, and that is the visual half of the same
 * rule. The accents are one per destination and each belongs to a project (tokens.css); a
 * control does not take you anywhere, so borrowing one would say it did.
 *
 * Its two lights go about that differently, because they are doing different jobs. The *wake*
 * — the object brightening under the pointer — comes up in the room's own warm amber, the
 * token the lamp and the monitor spill already use, so it reads as the room responding rather
 * than as an exit opening. The *standby LED* is white, because that is what a power indicator
 * is on real hardware, and white is the one colour that cannot be mistaken for an accent.
 *
 * The rects come from the same place the hotspots' do: `tools/pick.py --objects
 * art/hotspots.json --mask-dir art/build/masks-hotspots`, then `tools/wake.py`. That file's
 * question is "what can be clicked", which covers both grammars — only what happens on the
 * click differs, and that is decided here, not there.
 */

import type { NormRect } from "../scripts/roomGeometry";

export interface RoomControl {
  id: string;
  /**
   * Shown on hover and focus. Two of them, because a control has a state and a label that
   * does not say which state you are in is a light switch with no marking.
   */
  label: string;
  labelOn: string;
  /**
   * What the *wake* comes up in — the hover and focus light, not the standby LED, which is
   * white and set in room.css. Warm, for the reason in the header.
   */
  accent: string;
  /** The tap target — the mask's bounding box, printed by `wake.py`. */
  rect: NormRect;
  /** The object's own light, baked from the same mask. */
  wake: string;
  /** Where that crop sits in the frame, also printed by `wake.py`. */
  wakeRect: NormRect;
  /**
   * **The standby light: a point on the object, not a tint of it.**
   *
   * This replaced a slow amber pulse over the whole silhouette, and the reason it had to is
   * the thing worth keeping. That pulse ran 0.12 -> 0.34 opacity over 7.5s of ease-in-out,
   * and nobody could see it — a slow, edgeless, low-contrast luminance ramp with nothing
   * beside it to compare against is close to the worst case for human vision, while the
   * hover reads instantly because it is a *step*. Amplitude was not the fix and was tried.
   *
   * The deeper fault was that the tell and the hover response were the same visual. A wake
   * at rest can only ever say "faintly hovered"; it can never say "this machine is on",
   * because it is a dimmer copy of the thing that means hovered. **A resting affordance has
   * to be a different kind of object than the hover response.** The room already had the
   * right vocabulary — the feeder's camera blinks, the rover's panel breathes
   * (data/ambient.ts) — and a point light has a core and a bloom, so it survives at a few
   * pixels where a broad tint does not.
   *
   * **On the top face**, and that took two wrong answers to get to. Both were on the body:
   * centred first, then 18% in from the left edge. Neither looked like hardware, and the
   * lesson is that the x offset was never the problem. **The curved side of this cabinet has
   * no feature to host a light** — no bezel, no panel, no seam — so a dot anywhere on it
   * attaches to nothing and reads as a blemish on the paint. Moving it sideways just moves
   * the blemish.
   *
   * The top face is a real feature: it has an edge, it catches its own light, and on a
   * cylindrical speaker it is where the indicator physically *is* — HomePod, Echo, Sonos, all
   * of them. **A light needs a surface that explains it**, which is the same finding
   * data/ambient.ts records from the other end: the feeder's tell works because there is an
   * actual camera module painted where it sits.
   *
   * Authored against the current wake mask rather than estimated: the body runs y 0.5326 ->
   * 0.5820 and its silhouette widens from 0.0015 to 0.0153 over the first 16% of that, which
   * is the top face turning toward us. This sits at 11% down, on its centre line. Nudging it
   * is a two-number edit and nothing else depends on it.
   */
  ledRect: NormRect;
  /** Distance in metres, so the overlay parallaxes with the art. See `Hotspot.distanceM`. */
  distanceM: number;
}

export const CONTROLS: readonly RoomControl[] = [
  {
    id: "speaker",
    label: "play something",
    labelOn: "stop the music",
    // The room's own light, not a destination accent — a control changes something here
    // rather than taking you somewhere, and the accents belong one-to-one to projects.
    //
    // **This is the wake's colour and only the wake's.** The standby LED is white and sets
    // its own in room.css. One field cannot be both: the wake is `screen`-blended, and white
    // `screen` over pale sunlit art adds nothing at all, while an amber power indicator is
    // not what the hardware does. The two lights want opposite things from a colour.
    accent: "var(--room-amber)",
    rect: [0.4162, 0.5218, 0.4457, 0.5957],
    // Baked with `wake.py --feather 2`, not the default 4, and that is not taste.
    // `build_wake`'s spill is `blur(feather * 6)` in *output* pixels — an absolute radius —
    // while the speaker is 40px wide at the default width against the monitor's 217px. A
    // 24px blur on a 40px shape erases it: the default came back peaking at alpha 0.67 with
    // a mean of 0.11, against the monitor's 0.96/0.33, and no opacity in the stylesheet
    // could rescue a mask that faint. At feather 2 it peaks at 0.93 with a mean of 0.23 —
    // the robot's profile to two decimals. **Scale feather with the object, not the frame.**
    wake: "/art/wake-speaker.webp",
    wakeRect: [0.3997, 0.4922, 0.4629, 0.6237],
    // ~14 master px across, which is ~4 CSS px of core at a 1600px viewport and ~16px once
    // the bloom is counted. Small on purpose: an indicator that reads as a lamp is not an
    // indicator.
    //
    // **Deliberately not round.** A circle would be right on a surface facing us and is wrong
    // here: this sits on a horizontal face seen from above and in front, so it foreshortens.
    // The height is the width times the master's 1.79 aspect — which is what makes a rect
    // square *on the art* — times 0.55 for the tilt. A perfect circle on a receding surface
    // is one of the surest tells that something was pasted on rather than built in.
    ledRect: [0.4296, 0.5368, 0.4322, 0.5393],
    // 4.40m, and clean: p25 0.221 / p75 0.229 across three probes, because the speaker is a
    // solid box with nothing crossing in front of it. tools/splat_probe.py.
    distanceM: 4.46,
  },
];
