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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoomRenderer, type RoomRenderer } from '../scripts/roomRenderer';
import { createSplatRenderer } from '../scripts/splatRenderer';
import { createCameraRig, type CameraRig } from '../scripts/cameraRig';
import { parallaxCoeff, imageRectToScreen, pushedRectToScreen, type ScreenRect } from '../scripts/roomGeometry';
import { TRANSITION, TRANSITION_VARS } from '../scripts/transition';
import { HOTSPOTS, hotspotById, type Hotspot } from '../data/hotspots';
import { SCENE } from '../data/scene';
import type { Project } from '../data/projects';
import HotspotButton from './Hotspot';
import Ambient from './Ambient';
import MonitorFocus from './MonitorFocus';

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
 * How long the poster takes to hand over to the canvas, and therefore how long it stays
 * mounted after the renderer is ready. Must match `.room__still`'s transition in room.css.
 *
 * Not in transition.ts, deliberately: that file is one *timeline*, whose whole value is
 * that the camera, the panel and the two timers cannot disagree about a single gesture.
 * This is a load event that happens at most once and shares no boundary with any of it.
 */
const POSTER_FADE_MS = 700;

type Phase = 'idle' | 'entering' | 'live' | 'leaving';

export default function Room() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RoomRenderer | null>(null);
  const rigRef = useRef<CameraRig | null>(null);
  const timerRef = useRef<number>(0);

  const [webgl, setWebgl] = useState(true);
  /**
   * Whether the renderer can actually draw. Distinct from `webgl`, which is about whether
   * it ever will: between mount and here the splat build downloads 8.9MB across four
   * rasters it needs *all* of before its first frame, and the canvas is blank for every
   * millisecond of it. The poster covers that window.
   */
  const [drawable, setDrawable] = useState(false);
  const [aspect, setAspect] = useState(ART_ASPECT);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [focus, setFocus] = useState<Hotspot | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  // A second, nested level inside the monitor's focus state: which project (if any) has
  // been launched from the bench grid. Lives here rather than inside MonitorFocus because
  // Esc has to know about it — the first Esc inside a project steps back to the grid, and
  // only a second one leaves the monitor (mirrors requestExit below).
  const [project, setProject] = useState<string | null>(null);

  // The rAF callback and the observers need the current phase without being re-created
  // every time it changes, so it is mirrored into a ref.
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const focusRef = useRef<Hotspot | null>(null);
  focusRef.current = focus;

  const reduced = useMemo(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
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
      root.style.setProperty('--push', push.toFixed(3));

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
        root.toggleAttribute('data-transit', transit);
      }
      // Keep the hotspots glued to their objects while the room parallaxes under them.
      // Two numbers for the whole layer; each hotspot scales them by its own 1/z in CSS.
      const k = parallaxCoeff(
        renderer.camera.eye[0] - renderer.home.eye[0],
        renderer.camera.eye[1] - renderer.home.eye[1],
        canvas.clientWidth, canvas.clientHeight,
        { fovDeg: SCENE.fovDeg, imageAspect: renderer.imageAspect },
      );
      root.style.setProperty('--par-x', k.kx.toFixed(2));
      root.style.setProperty('--par-y', k.ky.toFixed(2));
    };

    // Both renderers satisfy the same interface, so nothing below this line — the rig, the
    // stage manager, the hotspots — knows which build is mounted. See src/data/scene.ts.
    const created = SCENE.kind === 'splat'
      ? createSplatRenderer({
        canvas,
        assetPrefix: SCENE.assetPrefix!,
        onBeforeFrame,
        // Straight onto the element as a custom property, not through React state. This
        // fires once per network chunk — dozens of times over a few seconds — and all it
        // ever does is set the width of one bar.
        onProgress: (f) => root.style.setProperty('--load', f.toFixed(3)),
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
        if (disposed) { r?.destroy(); return; }
        if (!r) { setWebgl(false); return; }
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
      .catch(() => { if (!disposed) setWebgl(false); });

    return () => {
      disposed = true;
      rig?.dispose();
      renderer?.destroy();
      rendererRef.current = null;
      rigRef.current = null;
    };
  }, []);

  // ---- viewport size, for placing the hotspots -----------------------------

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => setView({ w: root.clientWidth, h: root.clientHeight });
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
        else if (phaseRef.current === 'idle') r.start();
      },
      { threshold: 0.01 },
    );
    io.observe(root);
    return () => io.disconnect();
  }, []);

  // ---- entering and leaving a focus state ----------------------------------

  const enter = useCallback((h: Hotspot) => {
    const rig = rigRef.current;
    // No rig means no approach — the no-WebGL path is a still image, and there is no camera
    // to move. The takeover's delay exists to trail a push, so without one it is just dead
    // air over a photograph. Cut instead, the same way reduced motion does.
    const noApproach = reduced || !rig;
    rig?.pushToImagePoint(h.aim[0], h.aim[1], h.disparity, h.travel);
    setFocus(h);
    setPhase('entering');
    clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setPhase('live');
      // Only now, with the panel opaque, is it safe to stop drawing. Doing it earlier
      // freezes the last frame of the push in plain sight.
      rendererRef.current?.stop();
    }, noApproach ? 0 : COVER_MS);
  }, [reduced]);

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
    setPhase('leaving');
    clearTimeout(timerRef.current);
    // Read outside the timer: by the time it fires, `focus` may already be something else.
    const returnTo = focusRef.current;
    timerRef.current = window.setTimeout(() => {
      setPhase('idle');
      setFocus(null);
      setProject(null);
      // Put the keyboard back where it came from, or Esc silently drops focus to the top of
      // the page and the room becomes unreachable without re-tabbing through everything.
      if (returnTo) document.getElementById(`hotspot-${returnTo.id}`)?.focus();
    }, reduced ? 0 : UNCOVER_MS);
  }, [reduced]);

  /** Activation goes through history, so the browser's back button is the same gesture. */
  const activate = useCallback((h: Hotspot) => {
    if (!h.focusState) return;   // Hotspot let the link through; nothing to do here.
    history.pushState({ hotspot: h.id }, '', h.href);
    enter(h);
  }, [enter]);

  /**
   * Launching a project from the bench grid pushes its own history entry on top of the
   * monitor's, the same way entering the monitor pushed one on top of the room's — so the
   * URL bar reflects it and the back button is still the one gesture that undoes everything,
   * one step at a time.
   */
  const selectProject = useCallback((p: Project) => {
    if (!focus) return;
    history.pushState({ hotspot: focus.id, project: p.id }, '', p.href);
    setProject(p.id);
  }, [focus]);

  const requestExit = useCallback(() => {
    if (history.state?.hotspot) history.back();  // popstate below does the work
    else leave();
  }, [leave]);

  useEffect(() => {
    const onPop = () => {
      const state = history.state as { hotspot?: string; project?: string } | null;
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
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [enter, leave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phaseRef.current !== 'idle') { e.preventDefault(); requestExit(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [requestExit]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // ---- the poster ----------------------------------------------------------
  //
  // The poster is the same master the splats were reconstructed from, at 965KB against
  // their 8.9MB, drawn through the same cover-crop — so it is not a placeholder standing in
  // for the room, it *is* the room, one frame flat. When the canvas takes over it does so
  // in register, and what the visitor sees is the picture gaining depth rather than a page
  // finally loading.
  //
  // Kept mounted through the fade and unmounted after, so a decoded full-frame image and
  // its composited layer are not left behind for the whole session.
  const [poster, setPoster] = useState(true);
  useEffect(() => {
    if (!drawable) return;
    const t = window.setTimeout(() => setPoster(false), reduced ? 0 : POSTER_FADE_MS);
    return () => clearTimeout(t);
  }, [drawable, reduced]);

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

  // ---- render --------------------------------------------------------------

  const boxes = useMemo(() => {
    const out = new Map<string, ScreenRect>();
    if (view.w && view.h) {
      for (const h of HOTSPOTS) out.set(h.id, imageRectToScreen(h.rect, view.w, view.h, aspect));
    }
    return out;
  }, [view, aspect]);

  const busy = phase !== 'idle';
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
      className={`room ${busy ? 'room--busy' : ''} ${phase === 'live' ? 'room--live' : ''}`}
      // The timeline, handed to the stylesheet so the camera and the keyframes cannot
      // disagree about when the camera stops. `--push` is written on this same element
      // every frame by the rig; React only touches the keys it owns, so the two coexist.
      style={TRANSITION_VARS as React.CSSProperties}
      onPointerMove={onPointerMove}
    >
      {webgl && <canvas ref={canvasRef} className="room__canvas" aria-hidden="true" />}

      {/* On top of the canvas until there is something on it, and the *only* thing there is
          when WebGL2 is missing — `drawable` never becomes true on that path, so this never
          fades and the still fallback is unchanged. Degrade explicitly, never silently. */}
      {poster && (
        <img
          className={`room__canvas room__still ${drawable ? 'room__still--gone' : ''}`}
          src={STILL}
          alt=""
          aria-hidden="true"
          fetchPriority="high"
        />
      )}

      {/* Wordless, and gone the moment it is not needed. The room's own language is warm
          light, not chrome — so this is a line of light along the floor of the frame rather
          than a spinner, and it is driven by real bytes (`--load`), never by a timeline
          guessing at how long a network takes. */}
      {poster && webgl && <div className="room__load" aria-hidden="true" />}

      {/* Scenery, below the hotspot layer in source order because the affordance must
          always win: a wake and a focus ring draw over ambient light, never under it. */}
      <Ambient view={view} aspect={aspect} />

      {/* The hotspots duplicate links that already exist in the document below, so the
          layer is hidden from assistive tech rather than announced twice. The links
          themselves stay real and focusable. */}
      <div className="hotspots" aria-hidden={busy ? 'true' : undefined}>
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

      {focus && (
        <MonitorFocus
          hotspot={focus}
          project={project}
          onSelectProject={selectProject}
          // Where the clip starts: the screen's rect *after* the push, or — on the paths
          // where no camera ever moves — where it simply is. Handing the pushed rect to a
          // still image would open the panel from a big centred rectangle sitting on
          // nothing.
          screen={noCamera
            ? imageRectToScreen(focus.rect, view.w, view.h, aspect)
            : pushedRectToScreen(focus.rect, focus.aim, focus.travel, view.w, view.h, aspect)}
          view={view}
          open={phase !== 'leaving'}
          reducedMotion={reduced}
          cut={noCamera}
          webgl={webgl}
          onExit={requestExit}
        />
      )}
    </div>
  );
}
