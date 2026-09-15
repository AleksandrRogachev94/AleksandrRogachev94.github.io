/**
 * The room: the site's single React island.
 *
 * It owns three things and delegates everything else — the WebGL renderer (which knows
 * nothing but how to draw), the camera rig (which knows nothing but how the camera feels),
 * and the focus state currently mounted over them. Keeping those separate is what lets
 * /dev/room tune the camera against the same code the site ships.
 *
 * The document underneath is never replaced. This island is one screenful at the top of a
 * real page; scroll past it and the prose is still there, server-rendered, which is
 * simultaneously the SEO layer, the screen-reader layer and the no-JS fallback
 * (CLAUDE.md rule 2). Nothing here hides it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoomRenderer, type RoomRenderer } from "../scripts/roomRenderer";
import { createSplatRenderer } from "../scripts/splatRenderer";
import { current as currentDaylight, type Daylight } from "../scripts/daylight";
import { current as currentSeason, type Season } from "../scripts/season";
import {
  createCameraRig,
  pushTimeFor,
  type CameraRig,
} from "../scripts/cameraRig";
import {
  parallaxCoeff,
  imageRectToScreen,
  pushedRectToScreen,
  type ScreenRect,
} from "../scripts/roomGeometry";
import { TRANSITION, TRANSITION_VARS } from "../scripts/transition";
import { HOTSPOTS, hotspotById, type Hotspot } from "../data/hotspots";
import { CONTROLS } from "../data/controls";
import { SCENE, stillFor, variantFor } from "../data/scene";
import { weatherFor } from "../data/weather";
import { SITE } from "../data/site";
import type { Project } from "../data/projects";
import { createRoomAudio, type RoomAudio } from "../scripts/roomAudio";
import HotspotButton from "./Hotspot";
import RoomControlButton from "./RoomControl";
import DaylightToggle from "./DaylightToggle";
import SeasonSwitch from "./SeasonSwitch";
import { useLastInput } from "./useLastInput";
import Ambient from "./Ambient";
import MonitorFocus from "./MonitorFocus";
import WindowFocus from "./WindowFocus";
import RoverFocus from "./RoverFocus";

/** Which build's plates to load, and the numbers they were measured with. */
const LAYERS = SCENE.layers ?? [];
/** The whole-frame plate, for browsers with no WebGL2. Degrade explicitly, never silently. */
const STILL = SCENE.still;
const ART_ASPECT = SCENE.width / SCENE.height;

/**
 * When the panel covers the viewport, and when it is gone again. Derived rather than
 * chosen: both used to be hand-picked numbers that trailed the stylesheet's own hand-picked
 * numbers, and keeping four values in step by eye is how the handoff drifted apart in the
 * first place. See transition.ts for the timeline these come from.
 */
const COVER_MS = TRANSITION.pushMs + TRANSITION.takeoverMs;
const UNCOVER_MS = TRANSITION.closeMs;

/**
 * **When a cut destination cuts — and it is before the camera stops, deliberately.**
 *
 * A cut fires on its destination's own `veil.full` — 0.70 for the window, 0.80 for the rover
 * (hotspots.ts). From there to the end of the approach the room is 12% brightness under 9px of
 * blur, so the tail of the push is a dark smear with nothing in it. And that is exactly the
 * stretch in which the camera decelerates. The ease keeps a linear tail so the *monitor* is
 * still gaining apparent size at the handoff — at travel 0.84 the magnification's hyperbolic
 * gain outruns the slowdown, 1.56x the average rate. At the feeder's travel 0.55 it does not:
 * the same tail leaves the apparent zoom at 0.56x its average, so the push visibly glides to a
 * halt and then a second thing starts moving. That is the "decelerates, stops, then the screen
 * expands" this fixes.
 *
 * So the cut happens the moment the room has finished disappearing. The camera is still
 * moving at speed underneath, and its stop is never seen by anyone. Converted out of push
 * units into wall-clock by `pushTimeFor`, because `progress()` is eased and 0.70 of the push
 * is not 0.70 of the duration.
 */
/**
 * The curve for a destination that has not authored one — the monitor's, which is the curve
 * the whole room used before the schedule became per-object. Named once because three places
 * need it and three copies of a default is how a default quietly becomes two defaults.
 */
const DEFAULT_VEIL = { start: 0.45, full: 1 };

const cutMsFor = (h: Hotspot) =>
  TRANSITION.pushMs * pushTimeFor((h.veil ?? DEFAULT_VEIL).full);

/**
 * Whether this destination arrives by cutting rather than by expanding a panel out of the
 * object's own rectangle.
 *
 * **Stated as "not the bench" rather than as a list of the cutters**, because that is the
 * shape of the actual rule: `takeover` asserts that the object *becomes* the viewport, and
 * the monitor is the only thing in the room for which that is true (room.css, "the cut").
 * Written this way, a new destination gets the claim-nothing grammar by default and has to
 * opt in to the screen one, which is the right way round — the feeder inheriting the
 * monitor's grammar by accident is the bug this encodes against.
 */
const cuts = (h: Hotspot) => h.focusState !== "bench";

/**
 * When this destination's panel is opaque, and therefore when the room can stop drawing.
 *
 * Not one number, because the focus states cover the frame by different means. The bench
 * *expands* out of the monitor's rectangle, so it is not opaque until the clip has finished
 * sweeping — `pushMs + takeoverMs`. A cut is opaque the instant it fires, which is well
 * before the camera would have arrived. Using the bench's number for a cut would leave the
 * room drawing (and visibly artifacting) underneath a panel already opaque over it.
 *
 * The camera being frozen mid-push by the `stop()` this schedules is intended: nothing is
 * looking at it, and the retreat simply starts from where it got to.
 */
const coverMsFor = (h: Hotspot) =>
  // One frame's grace on a cut. `setPhase('live')` hides the canvas, and the panel that has
  // to be covering it by then goes opaque from a CSS animation on the same instant — two
  // clocks, one of which is React's. If the timer lands first the room is a frame of bare
  // `--room-bg`, which is warm paper, in the middle of a fade to black.
  cuts(h) ? cutMsFor(h) + 80 : COVER_MS;


/**
 * How long the title card stays *after* the room is ready to draw.
 *
 * **The whole design is in this one number being a hold rather than a deadline.** The card
 * exists because 9.6MB of splats is dead time the visitor spends looking at a room with no
 * explanation and no name on it — and dead time you have to spend anyway is the one honest
 * place to put orientation. But tying it to "gone when loaded" makes it useless in the case
 * that matters most: a repeat visit with everything cached, where it would flash past in
 * 80ms and teach nobody anything. Holding a beat past ready costs a first-time visitor
 * nothing (they waited seconds already) and is the entire value on a warm cache.
 *
 * It is emphatically **not** a gate. Nothing has to be dismissed, nothing is waiting on a
 * click, and the first deliberate input of any kind removes it early (see the effect below).
 * Splash screens people must click through are the pattern this is avoiding, not the
 * pattern it is.
 */
const INTRO_HOLD_MS = 2000;

/** How long the card takes to leave. Must match `.room__intro`'s transition in room.css. */
const INTRO_FADE_MS = 450;

/**
 * How long the room may go without receiving a single byte before it says so.
 *
 * **Measured against silence, not against elapsed time**, and the difference is the whole
 * point. A load that takes twenty seconds on a thin connection is working correctly and
 * needs no apology; a load that has received nothing for six seconds is a different event,
 * and it is the only one a visitor cannot distinguish from a broken page by looking at it.
 * A deadline on total duration would fire on the first case, which is the common one, and
 * teach the visitor to ignore it before the second one ever happened.
 *
 * Six seconds because the bar's own transition is 220ms and a healthy chunked download
 * refreshes it many times a second, so a gap this long is not jitter under any network
 * this runs on. It is checked by polling a ref rather than by a state write per chunk —
 * `onProgress` fires dozens of times per load and must stay off React's path.
 */
const STALL_MS = 6000;

/**
 * How many Gaussians the room is made of: the bake's 768x768 grid times its two layers.
 *
 * Stated here rather than read from the manifest because the loading screen has to say it
 * *before* the manifest arrives — and because it is a property of the bake's shape, which
 * lives in docs/SCENE-SPLAT.md, not a number that drifts per run. If the grid or the layer
 * count ever changes, `art/build/room-day-summer-splat.json`'s `count` is the check.
 */
const SPLAT_COUNT = 768 * 768 * 2;


type Phase = "idle" | "entering" | "live" | "leaving";

export default function Room() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RoomRenderer | null>(null);
  const rigRef = useRef<CameraRig | null>(null);
  const timerRef = useRef<number>(0);

  const [webgl, setWebgl] = useState(true);
  /**
   * Whether the renderer can actually draw. Distinct from `webgl`, which is about whether
   * it ever will: between mount and here the splat build downloads 9.6MB across four
   * rasters it needs *all* of before its first frame, and the canvas is blank for every
   * millisecond of it. The poster covers that window.
   */
  const [drawable, setDrawable] = useState(false);
  /**
   * When the last byte of the room arrived, for `STALL_MS`. Written from `onProgress` — a
   * ref, not state, because that callback fires once per network chunk and its entire
   * contract is that it costs no renders.
   *
   * Seeded at mount rather than at the first chunk, so a load that never starts — a hung
   * manifest fetch, a captive portal swallowing the request — is covered by the same timer
   * as one that starts and dies. Those look identical to a visitor and should say the same
   * thing.
   */
  const lastByteRef = useRef(0);
  /** Whether the room has gone `STALL_MS` without a byte, and has said so. */
  const [stalled, setStalled] = useState(false);
  /**
   * The megabyte readout, written into directly from the fetch callback.
   *
   * A ref to the node rather than state holding the text, for the same reason `--load` is a
   * custom property: this changes once per network chunk — dozens of times across a load —
   * and re-rendering the room's whole tree to retype four characters would be absurd.
   */
  const bytesRef = useRef<HTMLParagraphElement>(null);
  /**
   * Whether every byte has landed and the work left is decode and upload.
   *
   * A single state flip, not a continuum, which is why this one is allowed to be state: it
   * happens exactly once per load. It is also the most interesting thing the loading screen
   * gets to say, because it is the moment the download stops being the bottleneck and a
   * million Gaussians are actually being unpacked.
   */
  const [decoding, setDecoding] = useState(false);
  const [aspect, setAspect] = useState(ART_ASPECT);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [focus, setFocus] = useState<Hotspot | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  // A second, nested level inside the monitor's focus state: which project (if any) has
  // been launched from the bench grid. Lives here rather than inside MonitorFocus because
  // Esc has to know about it — the first Esc inside a project steps back to the grid, and
  // only a second one leaves the monitor (mirrors requestExit below).
  const [project, setProject] = useState<string | null>(null);
  /**
   * Whether the room's ambient audio is actually playing — not whether it was asked for.
   * `roomAudio.toggle()` resolves to what happened, because a browser is entitled to refuse
   * a file it cannot decode. It starts false on every load and only a click can change it.
   */
  const [audioOn, setAudioOn] = useState(false);
  const audioRef = useRef<RoomAudio | null>(null);
  /**
   * Which lighting is on screen, or null before the mount effect has read the visitor's
   * clock. Null rather than a default because this is an island — a value chosen during
   * render is chosen at *build* time, on a machine in another timezone, and the switch would
   * visibly correct itself on hydration.
   */
  const [daylight, setDaylight] = useState<Daylight | null>(null);
  /**
   * Which season the room is in. Null before the mount effect, same as `daylight` and for the
   * same reason — a value chosen during render is chosen at build time, in whatever month the
   * CI machine ran in.
   *
   * Held separately from `daylight` rather than as one "lighting" value, because the two are
   * overridden independently and on completely different timescales; scripts/season.ts has
   * the argument. They meet in exactly one place, `variantFor`, and nowhere else.
   */
  const [season, setSeason] = useState<Season | null>(null);
  /**
   * The veil schedule currently in force — which destination the camera is approaching, in
   * the only terms the rig cares about. A ref rather than state because `onBeforeFrame` is
   * built once at mount and reads this 60 times a second; making it state would rebuild the
   * renderer's whole callback chain on every push.
   *
   * The default is the monitor's curve, which is the curve the room had before any of this
   * was per-destination.
   */
  const veilRef = useRef<{ start: number; full: number }>(DEFAULT_VEIL);

  /**
   * Which input drove the last interaction, for the focus panels' arrival focus. Owned here
   * rather than inside each panel because a panel mounts *because of* the click it needs to
   * classify, so its own listener is always a beat too late — see useLastInput.ts.
   */
  const lastInputRef = useLastInput();

  // The rAF callback and the observers need the current phase without being re-created
  // every time it changes, so it is mirrored into a ref.
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const focusRef = useRef<Hotspot | null>(null);
  focusRef.current = focus;

  const reduced = useMemo(
    () =>
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // ---- renderer + rig ------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;

    let disposed = false;
    let renderer: RoomRenderer | null = null;
    let rig: CameraRig | null = null;

    // Whether the camera is anywhere other than home. Mirrored here rather than read back
    // off the DOM, so the attribute below is written only when it actually changes.
    let inTransit = false;

    // One rAF for the whole room. The rig writes the camera, and the push progress goes
    // out as a custom property rather than React state — this runs 60 times a second and
    // only ever changes how two things look.

    const onBeforeFrame = (dt: number) => {
      if (!rig || !renderer) return;
      rig.update(dt);
      const push = rig.progress();
      root.style.setProperty("--push", push.toFixed(3));

      // The veil, resolved here rather than in CSS. Its schedule is per destination now
      // (hotspots.ts), which makes the CSS expression need a start, a slope and clamps at
      // both ends — and an unparseable `filter` fails silently and totally. See the note
      // above `.room--busy .room__canvas`.
      const { start, full } = veilRef.current;
      const t = Math.min(1, Math.max(0, (push - start) / (full - start)));
      root.style.setProperty("--veil-t", t.toFixed(3));

      // **The ambient layer comes back when the camera is home, not when the panel clears.**
      // Those are 550ms apart: `.room--busy` is dropped at `closeMs` (200ms), because that
      // is when the panel is gone and the hotspots have to be live again, but the retreat
      // runs for `releaseMs` (750ms) after that — deliberately, so the pull-back happens in
      // the open where it can be watched (transition.ts). Steam reappearing in the middle
      // of that is an overlay pinned to a rest-position rect being switched on over art
      // that is still moving under it, which is exactly what `.room--busy` exists to
      // prevent at the other end of the gesture.
      //
      // Taken from the rig rather than from a second timer: `t` is clamped to its target,
      // so `progress()` reaches exactly 0 and this cannot drift out of step with
      // `releaseMs` the way a hand-copied duration would.
      //
      // An *attribute*, not a class. `className` is a React-managed prop, so the re-render
      // that sets `.room--busy` rewrites the whole attribute and would silently drop a
      // class added from here — and since this only writes on change, it would never be
      // put back. Nothing renders `data-transit`, so React leaves it alone, which is the
      // same reason `--push` above survives.
      const transit = push > 0;
      if (transit !== inTransit) {
        inTransit = transit;
        root.toggleAttribute("data-transit", transit);
      }
      // Keep the hotspots glued to their objects while the room parallaxes under them.
      // Two numbers for the whole layer; each hotspot scales them by its own 1/z in CSS.
      const k = parallaxCoeff(
        renderer.camera.eye[0] - renderer.home.eye[0],
        renderer.camera.eye[1] - renderer.home.eye[1],
        canvas.clientWidth,
        canvas.clientHeight,
        { fovDeg: SCENE.fovDeg, imageAspect: renderer.imageAspect },
      );
      root.style.setProperty("--par-x", k.kx.toFixed(2));
      root.style.setProperty("--par-y", k.ky.toFixed(2));
      // The third axis. Forward displacement in metres, which `pinToArt` turns into a
      // per-depth magnification — without it every pinned overlay keeps its home-pose size
      // while the art under it grows, and the speaker's LED detaches from the speaker.
      root.style.setProperty(
        "--par-f",
        (renderer.home.eye[2] - renderer.camera.eye[2]).toFixed(4),
      );
    };

    // Read here, inside the effect, rather than during render: this is an island, so its
    // initial HTML is produced at build time, and `current()` reads the *visitor's* clock.
    // Resolved at render it would bake the build machine's timezone into the page.
    // The stall clock starts at mount, not at the first chunk — see `lastByteRef`.
    lastByteRef.current = performance.now();

    const initialDaylight = currentDaylight();
    const initialSeason = currentSeason();
    setDaylight(initialDaylight);
    setSeason(initialSeason);

    // Both renderers satisfy the same interface, so nothing below this line — the rig, the
    // stage manager, the hotspots — knows which build is mounted. See src/data/scene.ts.
    const created =
      SCENE.kind === "splat"
        ? createSplatRenderer({
            canvas,
            assetPrefix: SCENE.assetPrefix!,
            onBeforeFrame,
            // The room opens in whatever lighting the visitor's own clock and calendar
            // imply. Decided here rather than switched after mount so the right raster is
            // fetched in the same batch as the geometry — someone arriving in October never
            // watches the summer room resolve and then dissolve away.
            variant: variantFor(initialSeason, initialDaylight) ?? undefined,
            // Same argument, and the same clock: someone arriving in December should find it
            // already snowing rather than watch it start. Null under reduced motion — the
            // weather is ambient motion and rule 1 turns all of it off there, and the
            // renderer then has nothing animating and goes back to drawing only when the
            // camera moves, which under reduced motion is never.
            weather: reduced ? null : weatherFor(initialSeason, initialDaylight),
            // Straight onto the element as a custom property, not through React state. This
            // fires once per network chunk — dozens of times over a few seconds — and all it
            // ever does is set the width of one bar.
            onProgress: (f, loaded, total) => {
              root.style.setProperty("--load", f.toFixed(3));
              // A timestamp beside the bar's width. Both are O(1) writes outside React —
              // the stall is detected by polling this below, not by setting state here.
              lastByteRef.current = performance.now();
              // Straight into the node. One decimal place: the figure is there to explain
              // the size of the wait, and a second decimal changes too fast to read.
              const mb = (n: number) => (n / 1048576).toFixed(1);
              if (bytesRef.current) {
                bytesRef.current.textContent = `${mb(loaded)} / ${mb(total)} MB`;
              }
              // The one flip worth a render, and only ever once.
              if (f >= 1) setDecoding(true);
            },
          })
        : createRoomRenderer({
            canvas,
            layers: LAYERS,
            // The reconstruction has to be the same shape as the room the rig aims into.
            fovDeg: SCENE.fovDeg,
            nearZ: SCENE.nearZ,
            farZ: SCENE.farZ,
            onBeforeFrame,
          });

    created
      .then((r) => {
        if (disposed) {
          r?.destroy();
          return;
        }
        if (!r) {
          setWebgl(false);
          return;
        }
        renderer = r;
        rig = createCameraRig(r, r.imageAspect);
        rendererRef.current = r;
        rigRef.current = rig;
        setAspect(r.imageAspect);
        r.start();
        // Only now — after the rasters are decoded and uploaded, not when the last byte
        // arrived — is there something on the canvas worth uncovering.
        setDrawable(true);
      })
      .catch(() => {
        if (!disposed) setWebgl(false);
      });

    return () => {
      disposed = true;
      rig?.dispose();
      renderer?.destroy();
      rendererRef.current = null;
      rigRef.current = null;
    };
  }, []);

  // ---- the record player ---------------------------------------------------
  //
  // Created once and disposed with the island. Nothing is fetched here — `roomAudio` builds
  // its `<audio>` on the first play, so a visitor who never touches the speaker never pays
  // for the loop.
  //
  // **It always starts silent, and no preference is restored.** A stored "on" used to be
  // replayed here without a gesture, on the theory that the browser would refuse it — which
  // it does, except on the one browser profile that has already earned an autoplay grant by
  // playing this loop before. roomAudio.ts has the rest of that argument. The practical
  // symptom was this: `audioOn` could come up true at load, so the speaker's LED sat lit over
  // a silent room with no way to tell that from a bug.

  useEffect(() => {
    const audio = createRoomAudio();
    audioRef.current = audio;
    return () => {
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  const toggleAudio = useCallback(() => {
    void audioRef.current?.toggle().then(setAudioOn);
  }, []);

  // ---- the day/night switch ------------------------------------------------
  //
  // A room control: it changes the light in place and never touches the camera (rule 5). The
  // renderer owns the transition — `setVariant` fetches whatever this variant is missing and
  // then dips: fade down, swap colour *and* geometry at the bottom, fade back up — so all this
  // does is decide which variant and record whether that was a disagreement with the clock
  // worth keeping.
  //
  // The state is set optimistically rather than waiting on the fetch. The dip is the feedback,
  // and a switch that stays in its old position for as long as ~11MB takes reads as broken; if
  // the fetch fails the renderer keeps the lighting it has and logs, which is the same shape
  // as everything else here degrading explicitly.
  //
  // **Both switches route through one function**, because a variant is a cell in a matrix and
  // not a property of either axis: picking "fall" while the room is dark draws the night
  // raster, and picking "night" in winter draws a different one than picking it in summer.
  // Deciding that at each call site is how the two controls end up disagreeing about what is
  // on screen.
  const applyLighting = useCallback((s: Season, d: Daylight) => {
    rendererRef.current?.setVariant?.(variantFor(s, d));
    // Straight after the variant, and deliberately not merged into it: the renderer defers
    // this to the bottom of the dip on its own, so the cloud, the colour and the weather all
    // land on the frame where the room is dark. See `applyWeather` in splatRenderer.ts.
    rendererRef.current?.setWeather?.(reduced ? null : weatherFor(s, d));
  }, [reduced]);

  // Both read the *other* axis from state and depend on it, rather than reaching for it
  // inside a `setState` updater. An updater has to be pure — React is entitled to run it
  // twice — and `setVariant` starts a fetch of up to ~11MB and a dip, which is not something
  // to hand a function that may be replayed. Two small buttons re-taking a closure on each
  // change costs nothing.
  const toggleDaylight = useCallback(() => {
    if (!daylight || !season) return;
    const next: Daylight = daylight === "night" ? "day" : "night";
    setDaylight(next);
    applyLighting(season, next);
  }, [applyLighting, daylight, season]);

  const pickSeason = useCallback((next: Season) => {
    if (!daylight) return;
    setSeason(next);
    applyLighting(next, daylight);
  }, [applyLighting, daylight]);

  // ---- viewport size, for placing the hotspots -----------------------------

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () =>
      setView({ w: root.clientWidth, h: root.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  // ---- don't draw a room nobody is looking at ------------------------------
  //
  // The renderer already handles `document.hidden`. This handles the other half: the room
  // is the top screenful of a scrollable document, so it can leave the viewport without the
  // tab ever being hidden. Never resumes while a focus state is mounted.

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        const r = rendererRef.current;
        if (!r) return;
        if (!entry.isIntersecting) r.stop();
        else if (phaseRef.current === "idle") r.start();
      },
      { threshold: 0.01 },
    );
    io.observe(root);
    return () => io.disconnect();
  }, []);

  // ---- entering and leaving a focus state ----------------------------------

  const enter = useCallback(
    (h: Hotspot) => {
      const rig = rigRef.current;
      // No rig means no approach — the no-WebGL path is a still image, and there is no camera
      // to move. The takeover's delay exists to trail a push, so without one it is just dead
      // air over a photograph. Cut instead, the same way reduced motion does.
      const noApproach = reduced || !rig;

      // Arm this destination's own veil schedule before the camera starts. How fast the room
      // has to fall away is a fact about the object being approached — what the reconstruction
      // has for it, and how hard the push magnifies it — so it is authored per hotspot rather
      // than being one curve for the whole room.
      veilRef.current = h.veil ?? DEFAULT_VEIL;

      rig?.pushToImagePoint(h.aim[0], h.aim[1], h.distanceM, h.travel);
      setFocus(h);
      setPhase("entering");
      clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(
        () => {
          setPhase("live");
          // Only now, with the panel opaque, is it safe to stop drawing. Doing it earlier
          // freezes the last frame of the push in plain sight.
          rendererRef.current?.stop();
        },
        noApproach ? 0 : coverMsFor(h),
      );
    },
    [reduced],
  );

  const leave = useCallback(() => {
    // Both at once, and in this order. The room has to be drawing again *before* the panel
    // starts to uncover it, and the camera has to be moving while it is still covered, so
    // that what appears from behind the collapsing panel is a room already in motion. The
    // panel is gone a fifth of the way through the retreat (transition.ts), so the pull-out
    // happens in the open rather than behind the thing it is pulling out of — which is what
    // "there is no motion back" was: the retreat was real, but all of it worth watching had
    // already happened by the time you could see it.
    rendererRef.current?.start();
    rigRef.current?.release();
    setPhase("leaving");
    clearTimeout(timerRef.current);
    // Read outside the timer: by the time it fires, `focus` may already be something else.
    const returnTo = focusRef.current;
    timerRef.current = window.setTimeout(
      () => {
        setPhase("idle");
        setFocus(null);
        setProject(null);
        // Put the keyboard back where it came from, or Esc silently drops focus to the top of
        // the page and the room becomes unreachable without re-tabbing through everything.
        if (returnTo)
          document.getElementById(`hotspot-${returnTo.id}`)?.focus();
      },
      reduced ? 0 : UNCOVER_MS,
    );
  }, [reduced]);

  /** Activation goes through history, so the browser's back button is the same gesture. */
  const activate = useCallback(
    (h: Hotspot) => {
      if (!h.focusState) return; // Hotspot let the link through; nothing to do here.
      history.pushState({ hotspot: h.id }, "", h.href);
      enter(h);
    },
    [enter],
  );

  /**
   * Launching a project from the bench grid pushes its own history entry on top of the
   * monitor's, the same way entering the monitor pushed one on top of the room's — so the
   * URL bar reflects it and the back button is still the one gesture that undoes everything,
   * one step at a time.
   */
  const selectProject = useCallback(
    (p: Project) => {
      if (!focus) return;
      history.pushState({ hotspot: focus.id, project: p.id }, "", p.href);
      setProject(p.id);
    },
    [focus],
  );

  const requestExit = useCallback(() => {
    if (history.state?.hotspot)
      history.back(); // popstate below does the work
    else leave();
  }, [leave]);

  useEffect(() => {
    const onPop = () => {
      const state = history.state as {
        hotspot?: string;
        project?: string;
      } | null;
      const next = state?.hotspot ? hotspotById(state.hotspot) : undefined;
      if (next?.focusState) {
        // Already on this hotspot — a project was pushed or popped underneath it, so just
        // follow that; re-entering would replay the camera push for no reason.
        if (focusRef.current?.id !== next.id) enter(next);
        setProject(state?.project ?? null);
      } else {
        leave();
      }
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [enter, leave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phaseRef.current !== "idle") {
        e.preventDefault();
        requestExit();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [requestExit]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // ---- the poster ----------------------------------------------------------
  //
  // The poster is the same master the splats were reconstructed from, at 407KB against
  // their 9.6MB, drawn through the same cover-crop — so it is not a placeholder standing in
  // for the room, it *is* the room, one frame flat. When the canvas takes over it does so
  // in register, and what the visitor sees is the picture gaining depth rather than a page
  // finally loading.
  //
  // **Exported at half the master's width (2752px), and register is why that is safe.**
  // Register is a geometric property — same framing, same cover-crop — not a resolution
  // one, and this is an `<img>` scaled to the viewport in both directions it is used: the
  // handover here, and the flat fallback under no-WebGL2 or prefers-reduced-motion. 2752px
  // is still 1.7x a 1600px viewport. Full width cost 981KB and bought nothing anyone can
  // see, on the one asset that is on the critical path for first paint.
  //
  // Kept mounted through the fade and unmounted after, so a decoded full-frame image and
  // its composited layer are not left behind for the whole session.
  /**
   * The title card over the poster. Starts up, comes down on its own.
   *
   * Deliberately not gated on `webgl`: with no WebGL2 there is no `drawable` and never will
   * be, so the effect below treats that as "ready now" rather than leaving the card parked
   * over the static fallback forever.
   */
  /**
   * **Starts false and is switched on after mount, which is the point.** Astro prerenders
   * this island, so anything `true` at first render ships inside the static HTML — and with
   * JavaScript off nothing ever hydrates to take it down again. The card would sit there
   * permanently, over a room whose hotspots were never rendered (they need a viewport
   * measurement from a `useEffect`), telling a visitor to click objects that do not exist.
   *
   * A card that instructs someone to do something has to be sure the something is possible.
   * Switching it on from an effect makes hydration the precondition, which is exactly the
   * condition under which the instruction is true. The cost is that it appears a beat into
   * the load rather than in the first paint; the poster and the load bar already cover that
   * window, and both are honest with or without JS.
   */
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    setIntro(true);
  }, []);
  /**
   * Whether the card has *started* leaving, as distinct from being gone. Two flags because
   * it fades rather than vanishing, and a fade needs the element to still be mounted while
   * it runs — one boolean would either cut it off hard or leave it mounted and invisible.
   */
  const [introGoing, setIntroGoing] = useState(false);

  // Ready, plus a beat. `!drawable && webgl` is the still-loading case, which is exactly
  // what the card is covering, so the hold does not even start until the room could be shown.
  useEffect(() => {
    if (!drawable && webgl) return;
    const t = window.setTimeout(
      () => setIntroGoing(true),
      reduced ? 0 : INTRO_HOLD_MS,
    );
    return () => clearTimeout(t);
  }, [drawable, webgl, reduced]);

  /**
   * The stall watch. Runs only while there is genuinely something to wait for, and stops
   * the moment the room is drawable — so on a warm cache it never starts a timer at all.
   *
   * Polling at a second, rather than a timer armed and re-armed from `onProgress`: the
   * callback stays free of scheduling work, and a poll that finds nothing costs one
   * subtraction. It clears itself as well as setting itself, so a connection that comes
   * back takes the line away again without needing a second mechanism.
   */
  useEffect(() => {
    if (drawable || !webgl) {
      setStalled(false);
      return;
    }
    const id = window.setInterval(() => {
      setStalled(performance.now() - lastByteRef.current > STALL_MS);
    }, 1000);
    return () => clearInterval(id);
  }, [drawable, webgl]);

  // Any deliberate input takes it down early — a visitor who has started doing something
  // has, by definition, stopped needing to be told what to do. Pointer *movement* is
  // excluded on purpose: the room reacts to the cursor at rest (parallax), so a mouse that
  // merely enters the window is not a decision, and treating it as one would delete the card
  // before it had been read.
  useEffect(() => {
    if (introGoing) return;
    const go = () => setIntroGoing(true);
    const events = [
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
      "scroll",
    ] as const;
    for (const e of events) addEventListener(e, go, { passive: true });
    return () => {
      for (const e of events) removeEventListener(e, go);
    };
  }, [introGoing]);

  // Unmount once the fade has actually run, so a decoded layer is not left over the room
  // for the rest of the session.
  useEffect(() => {
    if (!introGoing) return;
    const t = window.setTimeout(
      () => setIntro(false),
      reduced ? 0 : INTRO_FADE_MS,
    );
    return () => clearTimeout(t);
  }, [introGoing, reduced]);

  /**
   * Whether the canvas is up. It has been drawing since `drawable` — behind nothing, at zero
   * opacity — which is what lets the camera take its start pose unobserved and means what
   * fades up is a room already moving rather than one starting from a standstill.
   *
   * **There is no poster over the splat download any more, and that is deliberate.** Handing a
   * flat master over to the canvas is free only while the camera is at home, where the
   * reconstruction reprojects to the master exactly. The establishing move starts away from
   * home, and no correction closes that gap: the error is per-depth (the 1m foreground wants
   * ~8x the screen shift the 8.3m yard does) while a CSS transform has one value to give.
   *
   * So the load shows the room's own ground, the load bar and the title card, and the canvas
   * fades up out of it. Nothing can misregister against a flat colour. The still image remains
   * for the two cases where it genuinely is the room: no WebGL2, and no scripting.
   *
   * The fade's duration lives in room.css and nothing here reads it — the reveal is a class
   * change, not a timer.
   */
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!drawable) return;
    rigRef.current?.playIntro();
    setRevealed(true);
  }, [drawable]);

  // ---- at-rest parallax ----------------------------------------------------

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    rigRef.current?.setPointer(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      1 - ((e.clientY - r.top) / r.height) * 2,
    );
  }, []);

  // The cursor has left the room. Distinct from it merely stopping, which keeps its lean —
  // see `pointerIn` in cameraRig.ts. `pointerleave` fires for touch too, at the end of a
  // drag, which is the right moment there as well.
  const onPointerLeave = useCallback(() => {
    rigRef.current?.clearPointer();
  }, []);

  // ---- render --------------------------------------------------------------

  const boxes = useMemo(() => {
    const out = new Map<string, ScreenRect>();
    if (view.w && view.h) {
      for (const h of HOTSPOTS)
        out.set(h.id, imageRectToScreen(h.rect, view.w, view.h, aspect));
      // Same crop, same map. The two grammars are separate everywhere the *interaction*
      // differs and identical everywhere it does not, and where a rect lands on the art is
      // not a question about what happens when you click it.
      for (const c of CONTROLS)
        out.set(c.id, imageRectToScreen(c.rect, view.w, view.h, aspect));
    }
    return out;
  }, [view, aspect]);

  const busy = phase !== "idle";
  /**
   * No push to trail, and nothing for the takeover to grow out of but the art as it is.
   *
   * `!drawable` belongs here too: a hotspot clicked while the poster is still up has no rig
   * to move (`enter` already cuts in that case), so growing the panel out of the rect the
   * screen *would have* reached is a rectangle appearing out of nowhere.
   */
  const noCamera = reduced || !webgl || !drawable;

  return (
    <div
      ref={rootRef}
      className={`room ${busy ? "room--busy" : ""} ${phase === "live" ? "room--live" : ""}`}
      // Drives the letterbox mat in room.css. Same state as the renderer's variant, so the
      // bands beside the art cannot disagree with the room inside them.
      data-daylight={daylight ?? undefined}
      // Seasons move the mat too: a winter room sits in a cooler frame than a summer one,
      // and the bands beside the art must not disagree with the room inside them.
      data-season={season ?? undefined}
      // The timeline, handed to the stylesheet so the camera and the keyframes cannot
      // disagree about when the camera stops. `--push` is written on this same element
      // every frame by the rig; React only touches the keys it owns, so the two coexist.
      style={TRANSITION_VARS as React.CSSProperties}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {webgl && (
        <canvas
          ref={canvasRef}
          className={`room__canvas ${revealed ? "" : "room__canvas--down"}`}
          aria-hidden="true"
        />
      )}

      {/* **The still is now the fallback and nothing else.** It used to double as the cover
          over the splat download, which is what put a flat image on screen at the same moment
          as a moving camera — see `revealed`. On this path there is no camera to disagree with
          it: `drawable` never becomes true without WebGL2, so this is simply the room.
          Degrade explicitly, never silently. */}
      {!webgl && (
        <img
          className="room__canvas room__still"
          // **No `src` until the visitor's clock and calendar have been read**, and that is
          // the whole point rather than an oversight. This island is server-rendered, so a
          // `src` here is chosen at build time — and the browser's preload scanner finds an
          // `<img src>` in the body long before React can correct it. Shipping the summer
          // poster unconditionally meant every off-season visitor downloaded 425KB that was
          // never shown, competing for bandwidth with the one that was. index.astro's inline
          // script has already pointed the `<link rel=preload>` at the right poster by the
          // time this mounts, so setting the src here is a cache hit rather than a fetch.
          src={season && daylight ? stillFor(season, daylight) : undefined}
          alt=""
          aria-hidden="true"
          fetchPriority="high"
        />
      )}

      {/* The no-JS room. With scripting off this island never hydrates, so the img above
          never gets a src — and the poster *is* the room in that case (rule 2). This carries
          it, and costs scripted visitors nothing: a browser with scripting enabled does not
          parse `<noscript>` contents as markup, so nothing in here is ever fetched. Summer
          day, because a static page cannot know better and that is the base build. */}
      {!drawable && !(season && daylight) && (
        <noscript>
          <img className="room__canvas room__still" src={STILL} alt="" />
        </noscript>
      )}

      {/* Wordless, and gone the moment it is not needed. The room's own language is warm
          light, not chrome — so this is a line of light along the floor of the frame rather
          than a spinner, and it is driven by real bytes (`--load`), never by a timeline
          guessing at how long a network takes. */}
      {!drawable && webgl && (
        <div className="room__load" aria-hidden="true">
          {/* **The wait is the one moment this site has the visitor's full attention and
             * nothing to show them, so it tells them what is actually arriving.** The room is
             * 1,179,648 Gaussians regressed from a single photograph, which is genuinely
             * interesting and is the reason the download is large — and a wait you understand
             * is a different experience from the same wait spent watching a spinner. The
             * figures are real: the count is the bake's own (768x768 grid, two layers), and
             * the megabytes come from `Content-Length`, not from a guess.
             *
             * Two moving parts, alive from the first frame and neither dependent on `--load`
             * to be visible:
             *
             *   the arc    fills with the bytes
             *   the sheen  turns on its own clock, so a stalled connection still has
             *              something on screen saying the page has not died
             *
             * Drawn, not fetched. The objection to a GIF here was never animation — it was
             * megabytes of looping raster competing with the 11.2MB it would be covering, on
             * exactly the connection that made it necessary. */}
          <div className="room__load-dial">
            <span className="room__load-arc" />
            <span className="room__load-sheen" />
          </div>

          <div className="room__load-say">
            {/* Three phases, each fading in over its own slice of the download. Pure CSS
                against `--load` (room.css) rather than React state, because this element has
                to change dozens of times over a load and none of those may cost a render.
                The last one is a state flip instead — `decoding` is a single transition, not
                a continuum, and it is the one phase that is not about bytes at all. */}
            {decoding ? (
              <p className="room__load-phase room__load-phase--now">
                Decoding {SPLAT_COUNT.toLocaleString("en-US")} splats
              </p>
            ) : (
              <>
                {/* **The first slice starts below zero so this line is lit on the first
                    frame.** It carries the interesting fact rather than saving it for later:
                    on the slow connection this screen exists for, the opening phase is the
                    one a visitor spends the longest looking at, and "Fetching the room" is
                    not worth ten seconds of anyone's attention. */}
                <p className="room__load-phase" style={{ "--from": -0.05, "--to": 0.34 } as React.CSSProperties}>
                  Downloading the room &mdash; {SPLAT_COUNT.toLocaleString("en-US")} Gaussian
                  splats
                </p>
                <p className="room__load-phase" style={{ "--from": 0.34, "--to": 0.72 } as React.CSSProperties}>
                  All reconstructed from a single photograph
                </p>
                <p className="room__load-phase" style={{ "--from": 0.72, "--to": 1.05 } as React.CSSProperties}>
                  Unpacking depth and light
                </p>
              </>
            )}
            {/* Written straight into the node from the fetch callback, never through state —
                same rule as `--load` itself.
 
                **React renders nothing inside it, and the placeholder is in the stylesheet
                (`:empty::before`).** `Content-Length` is not known until the four responses'
                headers land — seconds in on a slow connection — so this must not be blank
                until then, which is the same mistake as a phase that ramps up from zero. But
                giving React a child here would mean two owners for one text node: React
                reconciling it and the callback overwriting it. That works only for as long as
                the literal never changes, which is not a property worth depending on. CSS
                fills the empty state, the callback fills the real one, and neither can erase
                the other. */}
            <p className="room__load-bytes" ref={bytesRef} />
          </div>
        </div>
      )}

      {/*
        The title card. **`aria-hidden`, and that is not an oversight** — every word here is
        already in the document below as real, structured content (the `<h1>` and the prose),
        so announcing it twice would make a screen reader read the page's identity out before
        the landmark that properly carries it. This is a visual cover for a visual wait.

        `pointer-events: none` in the stylesheet: it sits over the room and must never be
        the thing a click lands on, including during its fade.
      */}
      {intro && (
        <div
          className={`room__intro ${introGoing ? "room__intro--going" : ""}`}
          aria-hidden="true"
        >
          <p className="room__intro-name">{SITE.name}</p>
          <p className="room__intro-line">
            Click the objects in the room &mdash; each one goes somewhere.
          </p>
          {/* Only when the room has actually gone quiet — see `STALL_MS`. It says what is
              happening rather than apologising for it: a visitor looking at a warm
              rectangle cannot tell a thin connection from a dead page, and this is the one
              fact that separates them. It lives in the card because the card has already
              solved legibility over a ground that is paper by day and plum at night, and
              because the card is the room's voice during the wait.

              **It inherits the card's `aria-hidden`, and that is the right answer rather
              than an omission carried over.** It is the one line here that is not also in
              the document below, so the question is real — but a screen reader is reading
              that document, which is server-rendered and complete, and nothing it conveys
              is waiting on these 11MB. There is no wait to announce. A live region firing
              "still loading" into the middle of the prose would interrupt a visitor to
              describe a delay they are not experiencing. */}
          {stalled && (
            <p className="room__intro-line room__intro-wait">
              Still loading &mdash; the room is a 3D scene, and this connection is slow.
            </p>
          )}
        </div>
      )}

      {/* Scenery, below the hotspot layer in source order because the affordance must
          always win: a wake and a focus ring draw over ambient light, never under it. */}
      <Ambient view={view} aspect={aspect} />

      {/* `inert`, not `aria-hidden`. While a focus panel is open this layer is behind an
          `aria-modal` dialog and must be unreachable — but `aria-hidden` on a container of
          real `<button>`s hides them from the accessibility tree while leaving them in the
          tab order, which is the one combination the spec calls out as broken: Tab lands on
          a control a screen reader cannot describe. `inert` removes them from both, and the
          CSS `pointer-events: none` on `.room--busy .hotspots` becomes redundant rather than
          load-bearing. At rest the layer is fully exposed, as rule 3 requires. */}
      <div className="hotspots" inert={busy || undefined}>
        {HOTSPOTS.map((h) => {
          const box = boxes.get(h.id);
          return box ? (
            <HotspotButton
              key={h.id}
              hotspot={h}
              box={box}
              view={view}
              aspect={aspect}
              onActivate={activate}
            />
          ) : null;
        })}
      </div>

      {/* The second grammar, in its own layer (rule 5, data/controls.ts): these change
          something in place and never move the camera, so they are toggle buttons rather
          than links and they do not belong in the layer above. Same `inert` gate — a
          control behind an open `aria-modal` panel has to be unreachable too. */}
      <div className="controls" inert={busy || undefined}>
        {CONTROLS.map((c) => {
          const box = boxes.get(c.id);
          return box ? (
            <RoomControlButton
              key={c.id}
              control={c}
              box={box}
              view={view}
              aspect={aspect}
              on={audioOn}
              onToggle={toggleAudio}
            />
          ) : null;
        })}
      </div>

      {/* Chrome, not furniture, and it says so by sitting in the frame's corner rather than
          on an object. The floor lamp is where this belongs; docs are in DaylightToggle.tsx.
          Same `inert` gate as the other control layer — unreachable behind an open panel. */}
      <div className="daylight-layer" inert={busy || undefined}>
        {/* One row, season first: it names what you are looking at, where the day/night pill
            names where a click goes, so the pair reads left-to-right as state then action. */}
        <div className="room-controls">
          <SeasonSwitch season={season} onChoose={pickSeason} />
          <DaylightToggle daylight={daylight} onToggle={toggleDaylight} />
        </div>
      </div>

      {focus &&
        (() => {
          // One branch per `focusState`, and they do not share a props shape — which is the
          // honest outcome, not a wart. The destinations arrive by different mechanisms (see
          // "the cut" in room.css), so pretending they take the same inputs is what let the
          // feeder inherit the monitor's grammar in the first place.
          const open = phase !== "leaving";

          // **Neither cut destination takes a rectangle**, and that is the whole difference.
          // The bench's panel is a clip that starts as the monitor's own rect and pushes its
          // edges off the frame — it needs to know where the screen got to. A cut replaces the
          // frame outright, so there is nothing to grow out of and nothing to measure. The two
          // still get their own components rather than one parameterised panel: they cut by
          // the same mechanism but they are not the same destination. The window's ground is
          // a still frame and the rover's is a running video that claims the stage manager's
          // single slot (RoverFocus.tsx), which is a difference no shared prop list hides.
          if (focus.focusState === "window") {
            return (
              <WindowFocus
                hotspot={focus}
                open={open}
                // When the cut fires, in ms from the click. Zero on the paths with no approach
                // to trail (reduced motion, no WebGL, poster still up) — which is why this
                // replaced a `cut` boolean plus a `.focus--cut` class that only ever set the
                // same number in CSS.
                atMs={noCamera ? 0 : cutMsFor(focus)}
                lastInputRef={lastInputRef}
                onExit={requestExit}
              />
            );
          }

          if (focus.focusState === "rover") {
            return (
              <RoverFocus
                hotspot={focus}
                open={open}
                atMs={noCamera ? 0 : cutMsFor(focus)}
                lastInputRef={lastInputRef}
                // The one prop the window does not take. The rover's ground is a video, so
                // it needs to know whether it may play on arrival — and `noCamera` above
                // cannot answer that, being equally true with motion allowed and no WebGL2.
                reduced={reduced}
                onExit={requestExit}
              />
            );
          }

          // Where the clip starts: the object's rect *after* the push, or — on the paths where
          // no camera ever moves — where it simply is. Handing the pushed rect to a still
          // image would open the panel from a big centred rectangle sitting on nothing.
          const screen = noCamera
            ? imageRectToScreen(focus.rect, view.w, view.h, aspect)
            : pushedRectToScreen(
                focus.rect,
                focus.aim,
                focus.travel,
                view.w,
                view.h,
                aspect,
              );
          return (
            <MonitorFocus
              hotspot={focus}
              screen={screen}
              view={view}
              open={open}
              cut={noCamera}
              project={project}
              onSelectProject={selectProject}
              reducedMotion={reduced}
              webgl={webgl}
              lastInputRef={lastInputRef}
              onExit={requestExit}
            />
          );
        })()}
    </div>
  );
}
