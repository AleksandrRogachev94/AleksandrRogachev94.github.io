/**
 * The camera's behaviour: where it drifts at rest, how it pushes into a thing, and how it
 * comes back.
 *
 * This is lifted wholesale out of the dev harness, where it was written and tuned against
 * the real art. The maths is unchanged; what changed is that there is now one copy of it,
 * driven from the renderer's single rAF, so the site and the tuning harness cannot
 * disagree about how the camera feels.
 *
 * The renderer knows nothing about any of this. It exposes a mutable `camera` and redraws
 * whatever is in it — which is what makes the push interruptible for free: the rig reads
 * its target every frame, so a click during a pull-out simply reverses, with no state
 * machine and no cancellation.
 */

import type { RoomRenderer } from './roomRenderer';
import { imagePointToWorld, type Vec3 } from './roomGeometry';
import { TRANSITION } from './transition';
import { SCENE } from '../data/scene';

export interface RoomTuning {
  /** World-space distance of the nearest content (disparity 1.0). */
  nearZ: number;
  /** World-space distance of the farthest content (disparity 0.0). */
  farZ: number;
  /** Vertical field of view, and the lens the art is assumed to have been painted with. */
  fovDeg: number;
  /** Fraction of the way to the target the push travels. Never 1 — see below. */
  travel: number;
  /** Amplitude of the at-rest cursor parallax, in world units. Small on purpose. */
  parallax: number;
  /**
   * Amplitude of the autonomous idle wander, in world units — the room's own small life,
   * present with no cursor in the room at all. Kept below `parallax` so a moving mouse
   * still reads as the dominant motion; drift is what is left when nothing else is
   * happening, not a second, competing parallax.
   */
  drift: number;
  /**
   * Amplitude of the idle *forward* breath — a third, slower drift axis along Z.
   *
   * Separate from `drift` because it is bounded by something else. Lateral drift is capped by
   * disocclusion; a forward dolly reveals nothing, so it costs none of that budget.
   *
   * **One-sided, and not by taste.** The renderer scissors to the master's rectangle, so
   * behind home the picture shrinks away from a frame it cannot grow past. The breath runs
   * home -> forward -> home and never crosses.
   */
  breath: number;
  /**
   * Multiplier on `INTRO_START` — how far the establishing move reaches. 1 is the shipping
   * offset; the harness's slider is the point of it being a number rather than a constant.
   *
   * Reach and duration are the two dials that decide whether the move reads as assertive or
   * as showing off, and that is not a judgement anybody can make from the numbers. It is
   * also not one that survives a round trip through a rebuild, which is why they live here
   * with the rest of the feel rather than as module constants.
   */
  introReach: number;
  /** How long the establishing move takes, in ms. See `introReach`. */
  introMs: number;
  /** How much of the push is translation rather than rotation. See the note in `update`. */
  lateral: number;
}

/**
 * Tuned in `/dev/room` against the 5504px master. These are the shipping values; the
 * harness starts its sliders from them, so "tuned in the harness" and "what the site does"
 * are the same numbers by construction.
 *
 * `nearZ`, `farZ` and `fovDeg` are no longer among them. They belong to the *scene*, not
 * to the feel: the SHARP build's are metric and come out of the PLY's own intrinsics, so
 * they are a measurement and moving them makes the room a different shape rather than a
 * different mood. See src/data/scene.ts.
 *
 * The amplitudes below are world units, which under the SHARP build are metres. Ambient
 * motion peaks at parallax + drift = 0.115m against the 0.119m budget the scene reports
 * (`maxLateralM`, ported from ml-sharp) — the distance at which the model says its second
 * layer runs out of hidden geometry to reveal.
 *
 * 0.115 rather than the 0.042 this shipped with first, because that timidity was bought
 * with the wrong currency. The room was measured for disocclusion at increasing lateral
 * offsets — fraction of pixels the splat field fails to cover — and it holds right up to
 * the budget: 0.000% at 0.042, 0.000% at 0.090, 0.015% at 0.119, and only at 0.150 does
 * the fig corner start opening, at 0.357%. There was nothing to be afraid of; the
 * whole-frame speckle that made the room look fragile was a decoder eating the disparity
 * raster, not the reconstruction running out of answers.
 *
 * The second ceiling was the hotspots, which were pinned to the screen while the art moved
 * under them — 15px of slip at the old amplitude, 41px at this one. They now track their
 * own objects (`parallaxCoeff`), so the only limit left is the one measured above.
 *
 * `drift` sits below `parallax` again, which is what the paragraph above it always claimed
 * and the old numbers quietly contradicted.
 */
export const ROOM_TUNING: RoomTuning = {
  nearZ: SCENE.nearZ,
  farZ: SCENE.farZ,
  fovDeg: SCENE.fovDeg,
  travel: 0.55,
  // Three motion states with different jobs, and the sizes say which is which: the intro
  // proves the room is spatial, the cursor says you can look around it, drift says it is
  // alive while you do nothing. Drift is quietest — past a point autonomous motion reads as
  // floating rather than living. The cursor is largest, because it is the one motion a
  // visitor *causes* and so has to be legible as a response; below ~0.07 it only registered
  // on a fast flick, which is indistinguishable from lag. The clamp in `update` composes all
  // three, so none has to be sized for the worst case of the others.
  parallax: 0.085,
  drift: 0.03,
  breath: 0.025,
  introReach: 1,
  introMs: 2600,
  lateral: 1,
};

/**
 * Properties of the plates on disk, needed to report the excursion budget in the units it
 * was painted in. Under the layered build `marginPx` mirrors `tools/inpaint.py --margin`,
 * which scales with the plate: 64px at its 1024px reference, so 344px on this master.
 * Move the camera further sideways than that and it reaches past the painted band to a
 * hard alpha edge.
 *
 * The SHARP build has no painted band — its back layer is a whole frame — so the limit is
 * not a margin at all but the point where the two layers run out of hidden geometry to
 * show. `SCENE.excursion` carries whichever of the two applies, in world units.
 */
export const PLATE = {
  width: SCENE.width,
  height: SCENE.height,
  marginPx: Math.round(
    (SCENE.excursion * (1 / SCENE.nearZ - 1 / SCENE.farZ))
      / (Math.tan((SCENE.fovDeg * Math.PI) / 180 / 2) * (SCENE.width / SCENE.height))
      * (SCENE.width / 2),
  ),
};

export interface PushTarget {
  point: Vec3;
  /** Per-object override of `tuning.travel`, since not every object can afford the same. */
  travel?: number;
}

export interface CameraRig {
  /** Mutable — the harness writes slider values straight into it. */
  readonly tuning: RoomTuning;
  /** Drive one frame. Wire this to the renderer's `onBeforeFrame`. */
  update(dtMs: number): void;
  /** Start pushing toward a point in the room. Safe to call mid-move. */
  pushTo(target: PushTarget): void;
  /** Push toward a point on the art at a known depth. Disparity is 1 near, 0 far. */
  pushToImagePoint(nx: number, ny: number, distanceM: number, travel?: number): void;
  /** Come home. Safe to call mid-push. */
  release(): void;
  /**
   * Play the one-shot establishing move. Call it while the canvas is still hidden: the
   * envelope is 1 on its first frame, and 1 *is* the start pose, so this is a teleport
   * followed by a settle. Anything watching at that instant sees the teleport — which is
   * exactly the jump that removing the poster fixed (Room.tsx, `revealed`). Calling it again
   * restarts it, and under reduced motion it does nothing at all.
   *
   * **It takes no aim point.** Turning the camera toward an object as it travels improves
   * the move and breaks everything else: `pinToArt` glues overlays to the art by compensating
   * translation and magnification, and a rotation is neither. A 1.5deg yaw slides the frame
   * ~38px while every hotspot, control and light stays put — enough to take the speaker's LED
   * off the speaker. Screen-space overlays and a rotating camera cannot both be right.
   */
  playIntro(): void;
  /** Eased progress, 0 at home and 1 fully pushed in. Drives the UI cross-fade. */
  progress(): number;
  /** Cursor position in -1..1, for the at-rest parallax. */
  setPointer(x: number, y: number): void;
  /** The cursor has left the room; ease the lean away. See `pointerIn` in the factory. */
  clearPointer(): void;
  /** Harness affordance: wheel offset along -Z. Not used by the site. */
  setDolly(z: number): void;
  /** How much painted background the current camera position is asking for, in plate px. */
  excursionPx(): number;
  /** True when the OS asks for reduced motion. Live — it tracks changes without a reload. */
  reducedMotion(): boolean;
  dispose(): void;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * How much of the ease is linear. The rest is the cubic above.
 *
 * **This number is why the push no longer reads as two moves.** A plain ease-in-out
 * arrives at *zero velocity* — the camera glides to a halt, and then, a moment later,
 * something else starts moving. Two arrivals in a row is exactly what "it feels like a two
 * step process" describes, and no amount of retiming the second move fixes it, because the
 * problem is that the first one finished.
 *
 * Blending a quarter of the way to linear leaves the camera still moving when the panel
 * picks the motion up, so there is one continuous gesture with a handoff inside it rather
 * than two gestures with a stall between them. The panel's own curve starts at roughly the
 * rate the screen's edges were already sweeping outward (see `--ease-takeover` in
 * room.css, where that rate is worked out) and decelerates from there, so the *whole*
 * move decelerates exactly once, at the end, where an arrival belongs.
 */
const LINEAR_TAIL = 0.25;
const ease = (k: number) => (1 - LINEAR_TAIL) * easeInOut(k) + LINEAR_TAIL * k;

/**
 * The fraction of `pushMs` at which the eased push reaches progress `p`. The inverse of
 * `ease`.
 *
 * `progress()` is eased, so a schedule written in push units — hotspots.ts's `veil` — does
 * not land at the same fraction of the *duration*. The feeder's veil bottoms out at push
 * 0.70, which happens 0.60 of the way through the push, not 0.70. Anything that has to fire
 * at a point on that schedule needs this, and hand-picking the number is precisely how the
 * camera and the stylesheet drifted apart before (transition.ts). `ease` is monotone, so
 * bisection is exact enough and needs no closed form for a curve that may yet change.
 */
export const pushTimeFor = (p: number): number => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ease(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/**
 * Idle drift's two periods, in ms. Deliberately not a round ratio of one another — a
 * Lissajous figure with commensurate periods traces a closed loop and repeats visibly
 * inside a single sitting; incommensurate ones only realign after their product, decades
 * from now. Slow because this has to read as the room settling, not as something
 * animating — a shorter period is the first thing that would make it look like a demo.
 */
const DRIFT_PERIOD_X_MS = 21_000;
const DRIFT_PERIOD_Y_MS = 15_000;
/**
 * The breath's period, and the same incommensurability argument as above — 26 shares no
 * small factor with 21 or 15, so the three axes realign on a timescale nobody sits through.
 *
 * Slowest of the three on purpose. Depth motion is the most noticeable of the three axes
 * per unit of amplitude, so it is the one that most easily tips from "the room is being
 * looked at" into "something is animating", which is the failure the two periods above are
 * already written to avoid.
 */
const DRIFT_PERIOD_Z_MS = 26_000;

/**
 * The establishing move: the room's one chance to say it is a reconstruction rather than a
 * photograph with a slow pan on it.
 *
 * Idle drift cannot carry that claim. It is deliberately below the threshold of "something
 * is animating" (see the periods above), and anything under that threshold is indis-
 * tinguishable from a Ken Burns pan — which is exactly the reading this move exists to
 * foreclose. So the evidence has to be delivered once, deliberately, in the window the
 * visitor is already spending on the title card, and then never again.
 *
 * **It is monotonic: it starts pushed in, travels once, and arrives home. That is the whole
 * lesson of the version before it,** which went out from home and came back so that the
 * poster could hand over in exact register at the start. It read as "still, then forward,
 * then backward", and every part of that was structural rather than a tuning problem. The
 * return leg is a reversal, and a camera that reverses has not been anywhere. The stillness
 * was the ease-*in* that protected the handover — a move that begins at zero velocity
 * begins by not moving, and 250ms of a camera not moving is a stall, not an anticipation.
 *
 * A settle has neither defect. It begins at its maximum speed, decelerates the whole way,
 * and stops once. There is one arrival, at the end, which is where arrivals belong — the
 * same argument `LINEAR_TAIL` makes about the push.
 *
 * **Starting pushed in is safe; starting pulled back would not be.** The renderer scissors
 * to the master's own rectangle (splatRenderer.ts, "Nothing draws outside the master's own
 * rectangle"), so behind home the picture shrinks away from a frame it cannot grow past.
 * This move never goes there: it lives entirely on the forward side and approaches home
 * from it. The near clip is 0.05 against nearest content at ~1.0m, so 0.22m of forward
 * travel is nowhere near anything.
 *
 * **The depth separation is not authored, and must not be.** The obvious way to sell
 * parallax is to give each layer a multiplier — background 0.2x, foreground 1.5x. That is
 * how you fake it in a 2.5D stack, and it is exactly wrong here: this is real geometry, so
 * a dolly produces the separation by construction. At 0.22m the ~1m foreground magnifies
 * 1.28x and the 8.3m yard 1.03x. Authoring multipliers on top of that would be distorting a
 * measurement to look more like itself.
 */
/**
 * Where the establishing move begins, relative to home. It ends at home.
 *
 * **A zoom-out: the camera starts inside the room and withdraws to the composed viewpoint.**
 * Any move that ends where it began has to turn around, and a turn-around reads as the camera
 * changing its mind however smoothly it is eased. Starting away and arriving is the only
 * shape with no reversal in it.
 *
 * Forward does the work, because a dolly is what makes foreground and background *disagree*
 * about how fast they move — withdrawing 0.30m shrinks the ~1m foreground by a third while
 * the 8.3m yard barely changes. A lateral pan of the same size moves everything alike, which
 * is what a photograph does. The lateral component is along for the ride, to keep the path
 * off a straight line.
 *
 * Only ever approaches home from the forward side. Behind home the renderer's scissor runs
 * out of reconstruction (splatRenderer.ts); the near clip is 0.05 against content at ~1.0m,
 * so the forward end has room to spare.
 */
const INTRO_START: Vec3 = [-0.09, 0.02, -0.30];

export function createCameraRig(
  renderer: RoomRenderer,
  imageAspect: number,
  tuning: RoomTuning = { ...ROOM_TUNING },
): CameraRig {
  /**
   * Where the camera is going, *or where it is coming back from*. This outlives `pushing`
   * on purpose, and that is the whole of the pull-out.
   *
   * It used to be cleared by `release()`, which meant the next frame fell through to the
   * "at home" branch below and the camera **teleported**. Nothing about that was visible in
   * the code: `t` went on decaying, `progress()` went on reporting it, and the blur it
   * drives went on lifting over the full duration — so the exit looked like a room that
   * unblurs rather than a room you retreat into, and every attempt to fix it by retiming the
   * decay changed the blur and moved the camera not at all. The target has to survive until
   * `t` is actually back at 0.
   */
  let target: PushTarget | null = null;
  /** Whether we still *want* to be at the target. Cleared by `release`; `target` is not. */
  let pushing = false;
  let t = 0; // 0 = home, 1 = fully pushed in. Linear; `eased` is what anything else reads.
  let eased = 0;
  // `pointerTarget` is the raw cursor position, updated instantly by `setPointer` — a mouse
  // entering the canvas from outside can jump straight from the centre to an edge in one
  // event. `pointer` is what `update` actually reads, eased toward the target each frame so
  // that jump doesn't reach the camera as a snap. Time-constant smoothing rather than a flat
  // lerp factor, so it doesn't get sharper or softer at different refresh rates.
  let pointerTarget = { x: 0, y: 0 };
  let pointer = { x: 0, y: 0 };
  const POINTER_SMOOTH_MS = 100;
  /**
   * How long the camera holds a cursor position after the cursor stops, and how quickly it
   * gives it up afterwards.
   *
   * **Without this the room does not return to rest.** `setPointer` only fires on movement,
   * so a mouse parked at the edge of the window — or one that left it entirely, which sends
   * no event at all — left the camera leaning that way indefinitely, with idle drift
   * wandering around an off-centre home. The room had a resting pose that depended on where
   * a cursor had last been, which is not a resting pose.
   *
   * Returning makes the two ambient layers say different things, which is the point of
   * having both: parallax is the room answering *you*, and drift is what it does when you
   * are not there. A lean that never decays merges them into one permanent offset and the
   * answer stops reading as an answer.
   *
   * The hold exists so that reading something in a corner of the room is not treated as
   * leaving. 700ms is longer than a glance and shorter than a pause; the return itself is
   * slow enough that it is never the motion you notice, only the absence of a lean.
   */
  const POINTER_RETURN_MS = 1400;
  /**
   * Whether the cursor is still in the room. Only its *leaving* retires a lean.
   *
   * Holding where the cursor stops is intended — a camera that creeps back while you are
   * still looking at the corner you moved it toward is taking the room off you. But a cursor
   * that leaves the window sends no event at all, so without this the room kept a lean nobody
   * was holding, with drift wandering around a rest pose set by where a pointer last was.
   */
  let pointerIn = false;
  let dolly = 0;
  /**
   * Milliseconds into the establishing move, or null when it is not playing. Advanced by
   * `update`, so it is paused by everything that already pauses the rAF — a visitor who
   * loads the page on a background tab still gets the move when they arrive at it, rather
   * than having it play to nobody.
   */
  let introMs: number | null = null;
  /** Runs whenever `update` does, so drift is paused for free by everything that already
   * stops the rAF (tab hidden, room scrolled off, a focus state live) — see roomRenderer's
   * `onBeforeFrame`, which is the only caller. */
  let clockMs = 0;

  // Read live rather than once at startup. Toggling the OS setting used to need a reload,
  // which made the reduced-motion path awkward to actually test.
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motionQuery.matches;
  const onMotionChange = () => { reduced = motionQuery.matches; };
  motionQuery.addEventListener('change', onMotionChange);

  /**
   * How much of `INTRO_START` is still applied: 1 at the first frame, 0 once home. Both
   * components only ever decay, so nothing reverses.
   *
   * **Two exponents, and which decays faster is the whole of the arc.** A single curve is a
   * straight line in the X-Z plane. Letting the lateral go first (power 4 against 2.2) spends
   * it while the camera is still deep in the room — where a given world-X offset buys the
   * most screen movement, because near objects are nearest — and leaves the remaining
   * two-thirds as a clean withdrawal. Swoop, then open out.
   *
   * Ease-out in both: maximum speed on the first frame, decelerating to nothing. A move that
   * departs from rest can start at full velocity, which is why this needs no ease-in and
   * therefore has no stall. The stall is what made the very first version read as two moves.
   *
   * Returns null when nothing is playing, which includes the whole of reduced motion. Read
   * live, so toggling the OS setting mid-move stops it rather than needing a reload.
   */
  function introEnv(): { lat: number; dep: number } | null {
    if (introMs === null || reduced) return null;
    const u = introMs / tuning.introMs;
    if (u >= 1) {
      // Home, and nothing left to do. Retiring it here keeps this a pure function of a live
      // move, and means a later `playIntro()` — the harness replaying it — starts clean.
      introMs = null;
      return null;
    }
    const k = 1 - u;
    return { lat: Math.pow(k, 4), dep: Math.pow(k, 2.2) };
  }

  const offsetX = () => renderer.camera.eye[0] - renderer.home.eye[0];
  const offsetY = () => renderer.camera.eye[1] - renderer.home.eye[1];

  function update(dtMs: number) {
    const want = pushing ? 1 : 0;
    // A duration, not a decay rate.
    //
    // This was an exponential approach, which has no end: it gets arbitrarily close to the
    // target and never reaches it. Three things went wrong with that, and all three were
    // visible. The tail is long and slow, so the last stretch of the push looked like the
    // camera hesitating. Nothing downstream could be told *when* the move was over, so the
    // takeover fired on a guessed delay instead. And because the camera was still short of
    // its target when the panel arrived, the panel — which is sized for a completed push —
    // was a few percent too big for the screen it was supposed to be growing out of.
    //
    // Advancing linearly over a known duration and easing the *result* fixes all three and
    // keeps what the decay was good at: this is still just a number moving toward another
    // number, so a click during a pull-out reverses on the next frame with no state machine
    // and nothing to cancel.
    if (reduced) t = want;
    else {
      const step = dtMs / (pushing ? TRANSITION.pushMs : TRANSITION.releaseMs);
      t = t < want ? Math.min(want, t + step) : Math.max(want, t - step);
    }
    // Home again: only now is it safe to forget where we were, and at t = 0 the branch
    // below puts the camera in exactly the place this would have snapped it to anyway.
    if (t === 0 && !pushing) target = null;
    const e = eased = ease(clamp(t, 0, 1));

    // Ambient parallax fades out as the push takes over, so the two never fight — and is
    // off entirely under reduced motion, which CLAUDE.md asks for and which this used to
    // get wrong: `reduced` only ever shortened the push, so the room still swam under the
    // cursor for the people who had asked it not to.
    const amp = reduced ? 0 : tuning.parallax;
    clockMs += dtMs;
    if (introMs !== null) introMs += dtMs;
    // Give up a stale cursor. Eased rather than dropped, and applied to the *target* rather
    // than to the smoothed value, so the return goes through the same 120ms smoothing every
    // other pointer change does and cannot arrive as a snap.
    if (!pointerIn) {
      const returnK = 1 - Math.exp(-dtMs / POINTER_RETURN_MS);
      pointerTarget = {
        x: lerp(pointerTarget.x, 0, returnK),
        y: lerp(pointerTarget.y, 0, returnK),
      };
    }
    const pointerK = reduced ? 1 : 1 - Math.exp(-dtMs / POINTER_SMOOTH_MS);
    pointer = {
      x: lerp(pointer.x, pointerTarget.x, pointerK),
      y: lerp(pointer.y, pointerTarget.y, pointerK),
    };
    // The idle wander. Same fade-on-push and same reduced-motion cutoff as cursor
    // parallax — it is added to `pointer`'s contribution rather than replacing it, so a
    // moving mouse and the room's own drift are one offset, not two fights over the eye.
    const driftAmp = reduced ? 0 : tuning.drift;
    const driftX = Math.sin((clockMs / DRIFT_PERIOD_X_MS) * Math.PI * 2) * driftAmp;
    const driftY = Math.sin((clockMs / DRIFT_PERIOD_Y_MS) * Math.PI * 2) * driftAmp * 0.6;
    // Raised cosine rather than a sine, which is the whole of the one-sidedness: it leaves
    // home at zero velocity, reaches `breath` forward, and returns, without ever going
    // positive. A sine here would spend half its period *behind* home, where the scissored
    // frame has nothing to show — see the note on `RoomTuning.breath`.
    const breathAmp = reduced ? 0 : tuning.breath;
    const driftZ = -((1 - Math.cos((clockMs / DRIFT_PERIOD_Z_MS) * Math.PI * 2)) / 2) * breathAmp;
    // The establishing move *replaces* ambient motion rather than adding to it — a cross-fade
    // on `ia`, not a sum. Summing would put the peak at 0.10 + 0.115 = 0.215m, nearly double
    // the disocclusion budget, and would do it at the one moment the room has a visitor's
    // whole attention. Cross-faded, the total offset is bounded by the larger of the two.
    //
    // Both then fade together on `e`, so a hotspot clicked mid-intro simply wins: the push
    // takes the camera over and the intro's clock runs out unwatched, with no cancellation
    // and no state to unwind. Same reason `release()` does not clear `target`.
    const env = introEnv();
    const iLat = env ? env.lat : 0;
    const iDep = env ? env.dep : 0;

    // Ambient motion cross-fades against the move rather than adding to it. Summed, an intro
    // and a full-strength drift-plus-cursor would be well over the disocclusion budget at the
    // one moment the room has a visitor's whole attention — and would be a second, slower
    // gesture inside a deliberate one. It arrives as the move leaves.
    const ambient = 1 - iLat;
    const reach = tuning.introReach;

    let px = INTRO_START[0] * reach * iLat + (pointer.x * amp + driftX) * ambient;
    let py = INTRO_START[1] * reach * iLat + (pointer.y * amp * 0.6 + driftY) * ambient;

    // **One clamp on total lateral excursion, applied after everything has had its say.**
    // Several independent sources contribute to it — the move, idle drift, the cursor — and
    // each is individually inside the budget while their sum need not be. Capping the composed
    // offset rather than rationing each source means no source has to be sized for the worst
    // case of the others, and the reconstruction's real limit is enforced in exactly one place.
    const lateral = Math.hypot(px, py);
    if (lateral > SCENE.excursion) {
      const k = SCENE.excursion / lateral;
      px *= k;
      py *= k;
    }
    px *= 1 - e;
    py *= 1 - e;

    const pz = (INTRO_START[2] * reach * iDep + driftZ * ambient) * (1 - e);
    const home: Vec3 = [px, py, -dolly + pz];

    const cam = renderer.camera;
    if (target) {
      // Split the push into the part that costs artifacts and the part that does not.
      //
      // Rotating the camera reveals no new surface at all, and dollying straight forward
      // reveals almost none - it mostly magnifies. Translating *sideways* is what uncovers
      // the hidden area behind foreground objects, and that hidden area is exactly what the
      // mesh has to smear. `lateral` is the dial between the two.
      //
      // It sits at 1 (full translation, camera ends up square in front of the object)
      // rather than the 0.25 it was first tuned to, because the trade is not the one the
      // paragraph above predicts. Turning instead of moving does avoid disocclusion, but it
      // views the displaced heightfield at a slant, and a slanted heightfield stretches
      // across its whole surface rather than only at silhouettes. Face-on looks cleaner
      // than oblique-but-thrifty. The cost is paid in `excursionPx`, so watch that number.
      const travel = target.travel ?? tuning.travel;
      const ex = home[0] + tuning.lateral * (target.point[0] * travel - home[0]);
      const ey = home[1] + tuning.lateral * (target.point[1] * travel - home[1]);
      const ez = target.point[2] * travel;
      cam.eye = [lerp(home[0], ex, e), lerp(home[1], ey, e), lerp(home[2], ez, e)];
      cam.center = [
        lerp(home[0], target.point[0], e),
        lerp(home[1], target.point[1], e),
        lerp(home[2] - 1, target.point[2], e),
      ];
    } else {
      cam.eye = home;
      cam.center = [home[0], home[1], home[2] - 1];
    }
  }

  return {
    tuning,
    update,
    pushTo(next) { target = next; pushing = true; },
    pushToImagePoint(nx, ny, distanceM, travel) {
      target = {
        point: imagePointToWorld(nx, ny, distanceM, { ...tuning, imageAspect }),
        travel,
      };
      pushing = true;
    },
    // Stop wanting the target; keep it. `update` retires it once the camera is actually
    // home, which is what makes the retreat a move rather than a cut.
    release() { pushing = false; },
    // Restartable by design: assigning rather than guarding means the dev harness can replay
    // the move from a button without a reset, and a second call mid-move is a legible
    // "do it again" rather than a silent no-op.
    playIntro() { introMs = 0; },
    // What `update` actually applied this frame, not a second evaluation of the curve —
    // the two must agree, because the stylesheet uses this to decide how much to blur the
    // room and the panel is registered against where the camera really is.
    progress: () => eased,
    setPointer(x, y) { pointerTarget = { x, y }; pointerIn = true; },
    // The room has been left. The lean goes with it — see `pointerIn`.
    clearPointer() { pointerIn = false; },
    setDolly(z) { dolly = clamp(z, -1.5, 1.5); },
    /**
     * Sideways camera motion is the only thing that uncovers painted background, so it is
     * the only thing the offline `--margin` has to cover. A point at depth z shifts by
     * (e / z) / (tanHalf * aspect) in ndc when the eye moves by e, so the *disocclusion* —
     * near surface against far background — is the difference of that across the depth
     * range. Reported in plate pixels, the unit --margin is stated in, so the two numbers
     * are directly comparable.
     */
    excursionPx() {
      const e = Math.hypot(offsetX(), offsetY());
      const tanHalf = Math.tan((tuning.fovDeg * Math.PI) / 180 / 2);
      const aspect = PLATE.width / PLATE.height;
      return ((e * (1 / tuning.nearZ - 1 / tuning.farZ)) / (tanHalf * aspect)) * (PLATE.width / 2);
    },
    reducedMotion: () => reduced,
    dispose() { motionQuery.removeEventListener('change', onMotionChange); },
  };
}
