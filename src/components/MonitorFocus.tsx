/**
 * The software bench: what the monitor becomes once the camera has pushed into it.
 *
 * **Why this can be a flat, full-viewport panel and not a quad projected onto the painted
 * screen.** The screen in the art is a blank near-black rectangle with a teal glow —
 * PROMPTS.md keeps content off it deliberately, because a painted UI would be garbled,
 * unmaintainable and stale. `--focus-bg` is #0a0b0d. So the handoff is a cross-fade
 * between two dark rectangles, and nobody can audit the corners of a shape that is already
 * the colour it is turning into. Projecting instead would buy a few degrees of diegetic
 * accuracy and cost crisp text, working focus rings, and a second DOM tree to keep in sync
 * with /software.
 *
 * **Why the monitor needs no `close-` plate.** PLAN.md has the push stopping short and
 * cross-fading to a painted close-up, because a displaced mesh cannot deliver an arrival —
 * the information is not in the image. True where the arrival is a painting. This arrival
 * is live DOM, so the bench *is* the plate. The window will still need one.
 *
 * **The boot.** PLAN.md rejected one, on the grounds that a boot screen is a gate between
 * the visitor and the work. That was argued and reversed: the objection is to a *login* —
 * something to click through — and this is a power-on. Nothing waits on it, there is
 * nothing to dismiss, it is over in 1.3s, and it plays once per page load, so bouncing
 * between the bench and a project does not replay it. It earns its place by completing a
 * causal chain the camera move alone does not: the monitor is an object in a room, and
 * clicking an object in a room should turn it on. Without that, arriving here is a page
 * navigation wearing a camera move. Kept honest by the lines themselves — the project count
 * comes from projects.ts and the renderer line reports what actually initialised, so
 * nothing on screen is theatre pretending to be a measurement.
 *
 * **Why this is a dashboard and not the /software page.** Room → monitor → project. The
 * room is the person and carries no lists; the monitor is the index; a project is the
 * detail. Showing the article here would collapse the middle rank and waste the one
 * surface in the site that can plausibly be a machine's own screen.
 *
 * No vendor logo. There is no MacBook in frame — the Apple read comes from the peripherals,
 * the machine is off-camera — and borrowing another company's mark at the one moment the
 * site should be asserting Alex's is the wrong trade at any price.
 */

import { useEffect, useRef, useState } from 'react';
import type { Hotspot } from '../data/hotspots';
import { PROJECTS, type Project } from '../data/projects';
import type { ScreenRect } from '../scripts/roomGeometry';
import * as stage from '../scripts/stage';

interface Props {
  hotspot: Hotspot;
  /**
   * Where the screen has actually got to by the end of the push — not where it started.
   * The panel's clip-path begins as this rectangle and pushes its edges off the frame, so
   * the monitor becomes the viewport rather than being replaced by one.
   */
  screen: ScreenRect;
  /** The room's size, so the insets below are measured in the space `screen` was. */
  view: { w: number; h: number };
  /** False once the exit has begun, so the panel can shrink before it unmounts. */
  open: boolean;
  reducedMotion: boolean;
  /**
   * True when nothing preceded the panel — reduced motion, or the no-WebGL still. The
   * entrance is timed to trail a camera push, so with no push to trail it has to cut
   * rather than sit through a delay waiting for a move that never happened.
   */
  cut: boolean;
  /** Reported by the boot, because a self-test that cannot fail says nothing. */
  webgl: boolean;
  /**
   * Which project, if any, has been launched from the grid — lifted up to Room.tsx so Esc
   * can pop one level at a time (project → grid → room) instead of always leaving outright.
   */
  project: string | null;
  onSelectProject(p: Project): void;
  onExit(): void;
}

/**
 * The tile that pulses once after the set lands. It is whichever project is actually under
 * construction rather than a hardcoded index, so the flourish keeps pointing at something
 * true as the list changes — and if nothing is being built, nothing pulses.
 */
const latestId = PROJECTS.find((p) => p.status === 'building')?.id;

/** A corner: two walls meeting and a floor receding, which is the room's own composition. */
function Mark() {
  return (
    <svg className="boot__mark" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M4 10 20 5l16 5M4 30l16 5 16-5" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <path d="M4 10v20M36 10v20M20 5v30" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Time since this page loaded, not since the bench was entered — `performance.now()`, not a
 * counter reset by mounting. The point of a fact like this is that it is one; a value that
 * restarted every time you pushed into the monitor would be a prop pretending to be a
 * measurement, which is exactly what the rest of this file is careful not to do.
 */
function useUptime() {
  const format = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
    return parts.map((n) => String(n).padStart(2, '0')).join(':');
  };
  const [uptime, setUptime] = useState(() => format(performance.now()));
  useEffect(() => {
    const id = setInterval(() => setUptime(format(performance.now())), 1000);
    return () => clearInterval(id);
  }, []);
  return uptime;
}

export default function MonitorFocus({
  hotspot, screen, view, open, reducedMotion, cut, webgl, project, onSelectProject, onExit,
}: Props) {
  const deckBackRef = useRef<HTMLButtonElement>(null);
  const appBackRef = useRef<HTMLButtonElement>(null);
  const clock = useClock();
  const uptime = useUptime();
  const selectedProject = project ? PROJECTS.find((p) => p.id === project) : undefined;

  // Where the launch grows from: the clicked tile's own screen position, not the viewport
  // centre — the same "opening an app" read as double-clicking something on a Mac desktop,
  // where the window unfurls from roughly where you clicked rather than materialising in
  // the middle of the screen. Captured once per launch, not tracked continuously — the
  // tile is gone the instant the view swaps, so there is nothing to keep following.
  const [origin, setOrigin] = useState({ x: '50%', y: '50%' });

  // What is actually in the DOM lags behind `selectedProject` on the way out. Opening is
  // instant — there is nothing expensive to hide. Closing is not: unmounting the iframe
  // tears down its GPU context, and for a real WebGPU workload that teardown can stall the
  // main thread for a beat. Without a beat of cover, that stall is a bare black freeze
  // where the grid was supposed to already be. `shown` keeps the panel (and the iframe)
  // mounted through its own fade-out, so any stall lands mid-transition instead of on a
  // static frame.
  const [shown, setShown] = useState(selectedProject);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number>(0);

  useEffect(() => {
    clearTimeout(closeTimer.current);
    if (selectedProject) {
      setClosing(false);
      setShown(selectedProject);
      return;
    }
    if (!shown) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setShown(undefined);
      setClosing(false);
    }, reducedMotion ? 0 : 200);
    return () => clearTimeout(closeTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` is read, not a trigger
  }, [selectedProject, reducedMotion]);

  // The monitor turns on whenever you push into it. There is no "already booted" flag any
  // more, and it is not coming back: it was a module-scoped `let`, it was the only thing
  // that could suppress this sequence silently, and it made the one part of the site that
  // has to be *seen* to be judged impossible to see twice without a reload. The saving it
  // bought was a second on a return trip to a bench you can only return to through a full
  // page navigation, which reset the flag anyway.
  const booting = !cut && !reducedMotion;

  // Every line is true of the page behind it — that is the rule that keeps this from being
  // theatre (PLAN.md). `display` is the real viewport, `renderer` is what actually
  // initialised, `projects` is projects.ts's own length.
  const lines: [string, string][] = [
    ['display', `${view.w}×${view.h}`],
    ['renderer', webgl ? 'webgl2' : 'static'],
    ['room', 'day · summer'],
    ['projects', String(PROJECTS.length)],
  ];

  // Claim the single live slot only once something heavy is actually on screen — the
  // iframe, not the bench chrome around it. It is something you arrive at, never ambient
  // chrome (CLAUDE.md rule 1), so the bench grid itself never holds the slot.
  useEffect(() => {
    if (!shown?.demo) return;
    return stage.mount({
      id: `focus:${hotspot.id}:${shown.id}`,
      destroy() { /* the iframe unmounts with this effect; nothing else holds resources */ },
    });
  }, [hotspot.id, shown?.id, shown?.demo]);

  // Which input drove the most recent interaction — a click on a tile or the back link
  // itself already focuses that element the normal way, so forcing focus onto a *different*
  // control right after (below) is only for the benefit of someone navigating by keyboard.
  // Doing it unconditionally made every launch/return leave a focus ring parked on "back"
  // for mouse users too, since the browser can't tell a script's `.focus()` call apart from
  // one that followed a keypress.
  const lastInputRef = useRef<'pointer' | 'keyboard'>('keyboard');
  useEffect(() => {
    const onPointerDown = () => { lastInputRef.current = 'pointer'; };
    const onKeyDown = () => { lastInputRef.current = 'keyboard'; };
    addEventListener('pointerdown', onPointerDown, true);
    addEventListener('keydown', onKeyDown, true);
    return () => {
      removeEventListener('pointerdown', onPointerDown, true);
      removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  // Move focus onto whichever back control is on screen, so the keyboard follows both the
  // camera (on arrival) and a project launch/return. Keyed to `shown`, not `project`, so
  // this fires once the grid's back button actually exists rather than the instant the
  // close was requested. Room.tsx puts focus back on the hotspot once the whole panel closes.
  useEffect(() => {
    if (lastInputRef.current === 'pointer') return;
    (shown ? appBackRef : deckBackRef).current?.focus();
  }, [shown]);

  // Insets, because that is what clip-path: inset() wants: distance in from each edge.
  // Clamped at zero — a screen that has already overflowed the viewport starts the clip at
  // full frame, which degrades to a plain cross-fade rather than to a broken shape.
  const inset = (v: number) => `${Math.max(0, v)}px`;
  const style = {
    '--st': inset(screen.top),
    '--sr': inset(view.w - (screen.left + screen.width)),
    '--sb': inset(view.h - (screen.top + screen.height)),
    '--sl': inset(screen.left),
    '--accent': hotspot.accent,
  } as React.CSSProperties;

  const className = [
    'focus',
    open ? 'focus--open' : 'focus--closing',
    cut && 'focus--cut',
    !booting && 'focus--booted',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label="The software bench"
    >
      {/* Always mounted, even while a project is open on top of it. Keeping it here (rather
          than swapping it out for `.app`) is what makes the close a real cross-fade back to
          a screen that is already drawn, instead of a fade to whatever `.focus`'s own
          background is — which is how "back to bench" turned into a black hold: there was
          nothing behind `.app` to fade into. `inert` takes the grid out of the tab order and
          out of the accessibility tree while a project covers it, without needing to hand-manage
          `tabIndex` on every tile. */}
      <div className="deck" inert={!!shown} aria-hidden={!!shown}>
        <header className="deck__bar">
          <button ref={deckBackRef} type="button" className="chrome-back" onClick={onExit}>
            ← back to the room <kbd>Esc</kbd>
          </button>
          <span className="deck__spacer" />
          <span className="deck__id">Alex Rogachev</span>
          <span>~/bench</span>
          <span className="deck__clock">{clock}</span>
        </header>

        <div className="deck__body">
          {/* What the machine knows about itself. The same facts the boot recites, left
              standing afterwards, so the boot is a summary of the page rather than a
              performance that evaporates. */}
          <dl className="deck__rail">
            <dt>renderer</dt><dd>{webgl ? 'webgl2' : 'static'}</dd>
            <dt>index</dt><dd>{PROJECTS.length} project{PROJECTS.length === 1 ? '' : 's'}</dd>
            <dt>room</dt><dd>day · summer</dd>
            <dt>uptime</dt><dd>{uptime}</dd>
          </dl>

          <div>
            <h2 className="deck__h">Projects</h2>
            <ul className="tiles">
              {PROJECTS.map((p, i) => (
                <li key={p.id}>
                  <a
                    className={`tile ${p.id === latestId ? 'tile--latest' : ''}`}
                    href={p.href}
                    style={{ '--tile-accent': p.accent, '--i': i } as React.CSSProperties}
                    onClick={(e) => {
                      // No live pane to launch into: let the tile be a plain link to its
                      // own page, same as a modified click always is below.
                      if (!p.demo) return;
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      setOrigin({ x: `${r.left + r.width / 2}px`, y: `${r.top + r.height / 2}px` });
                      onSelectProject(p);
                    }}
                  >
                    <span className="tile__top">
                      <span>{p.tag}</span>
                      <span className="tile__status">{p.status}</span>
                    </span>
                    <span className="tile__name">{p.name}</span>
                    <span className="tile__line">{p.line}</span>
                    <span className="tile__stack">{p.stack}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="deck__status">
          <span className="deck__led" aria-hidden="true" />
          <span>system online</span>
        </footer>
      </div>

      {shown && (
        // Launching a project stays inside the same mounted panel — no page load, no
        // white flash — and takes over almost the whole frame the way the grid never did,
        // because a live demo is the thing worth arriving at, not the chrome around it.
        // Sits on top of `.deck` above rather than replacing it (see the comment there).
        <div
          className={`app ${closing ? 'app--closing' : ''}`}
          style={{ '--accent': shown.accent, '--ox': origin.x, '--oy': origin.y } as React.CSSProperties}
        >
          <header className="app__bar">
            <button ref={appBackRef} type="button" className="chrome-back" onClick={onExit}>
              ← back to bench <kbd>Esc</kbd>
            </button>
            <span className="deck__spacer" />
            <span className="app__dot" aria-hidden="true" />
            <span className="app__name">{shown.name}</span>
            <span className="app__live">{shown.status}</span>
            <span className="app__stack">{shown.stack}</span>
          </header>
          <div className="app__stage">
            {shown.demo && (
              <iframe
                className="app__frame"
                src={shown.demo}
                title={`${shown.name} — live`}
                allow="fullscreen"
                onLoad={(e) => {
                  // Same-origin, so this reaches straight into the loaded document, no
                  // postMessage handshake needed. Without it, a visitor who clicks into the
                  // demo to interact with it moves keyboard focus into the iframe's own
                  // window — keydown there does not bubble to the parent — and "Esc pulls
                  // back out" would quietly stop working for exactly the surface they are
                  // most likely to be on.
                  e.currentTarget.contentWindow?.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Escape') onExit();
                  });
                }}
              />
            )}
          </div>
          <footer className="app__foot">
            <span className="app__line">{shown.line}</span>
            {shown.repo && (
              <a className="app__repo" href={shown.repo} target="_blank" rel="noopener">
                source ↗
              </a>
            )}
          </footer>
        </div>
      )}

      {/* Not announced: it is a flourish over content that is already in the tree and
          already readable to a screen reader, and narrating a self-test would be noise. */}
      {booting && open && (
        <div className="boot" aria-hidden="true">
          {/* The wrapper is not decoration: `.boot` already animates its own opacity to
              leave, and a second animation on the same property would simply replace it,
              so the power-on flicker needs an element of its own. */}
          <div className="boot__panel">
            <Mark />
            <p className="boot__hail">system online</p>
            <div className="boot__lines">
              {/* Key first, value a beat later. The stagger is per line and the value's
                  offset is inside the line, so it reads as the machine being asked a
                  question and answering it — which is what a power-on self-test is. */}
              {lines.map(([k, v], i) => (
                <div key={k} className="boot__line" style={{ '--i': i } as React.CSSProperties}>
                  <span className="boot__key">{k}</span>
                  <span className="boot__val">{v}</span>
                </div>
              ))}
            </div>
            <p className="boot__ready">
              welcome<span className="boot__caret" />
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
