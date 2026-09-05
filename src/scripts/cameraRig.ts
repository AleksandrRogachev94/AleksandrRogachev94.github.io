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
  parallax: 0.065,
  drift: 0.05,
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
  pushToImagePoint(nx: number, ny: number, disparity: number, travel?: number): void;
  /** Come home. Safe to call mid-push. */
  release(): void;
  /** Eased progress, 0 at home and 1 fully pushed in. Drives the UI cross-fade. */
  progress(): number;
  /** Cursor position in -1..1, for the at-rest parallax. */
  setPointer(x: number, y: number): void;
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
  let pointer = { x: 0, y: 0 };
  let dolly = 0;
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
    // The idle wander. Same fade-on-push and same reduced-motion cutoff as cursor
    // parallax — it is added to `pointer`'s contribution rather than replacing it, so a
    // moving mouse and the room's own drift are one offset, not two fights over the eye.
    const driftAmp = reduced ? 0 : tuning.drift;
    const driftX = Math.sin((clockMs / DRIFT_PERIOD_X_MS) * Math.PI * 2) * driftAmp;
    const driftY = Math.sin((clockMs / DRIFT_PERIOD_Y_MS) * Math.PI * 2) * driftAmp * 0.6;
    const px = (pointer.x * amp + driftX) * (1 - e);
    const py = (pointer.y * amp * 0.6 + driftY) * (1 - e);
    const home: Vec3 = [px, py, -dolly];

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
    pushToImagePoint(nx, ny, disparity, travel) {
      target = {
        point: imagePointToWorld(nx, ny, disparity, { ...tuning, imageAspect }),
        travel,
      };
      pushing = true;
    },
    // Stop wanting the target; keep it. `update` retires it once the camera is actually
    // home, which is what makes the retreat a move rather than a cut.
    release() { pushing = false; },
    // What `update` actually applied this frame, not a second evaluation of the curve —
    // the two must agree, because the stylesheet uses this to decide how much to blur the
    // room and the panel is registered against where the camera really is.
    progress: () => eased,
    setPointer(x, y) { pointer = { x, y }; },
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
