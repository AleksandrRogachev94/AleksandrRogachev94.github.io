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
import { PROJECTS } from '../data/projects';
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
  hotspot, screen, view, open, reducedMotion, cut, webgl, onExit,
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const clock = useClock();
  const uptime = useUptime();

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

  // Claim the single live slot. Nothing heavy runs here yet — flowlab's iframe is the next
  // increment — but registering now means the eviction path is wired and testable before
  // there is anything expensive to get wrong.
  useEffect(() => stage.mount({
    id: `focus:${hotspot.id}`,
    destroy() { /* the panel unmounts with this effect; nothing else holds resources yet */ },
  }), [hotspot.id]);

  // Move focus into the panel so the keyboard follows the camera, and so Esc has an
  // obvious owner. Room.tsx puts focus back on the hotspot on the way out.
  useEffect(() => { closeRef.current?.focus(); }, []);

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
      <div className="deck">
        <header className="deck__bar">
          <span className="deck__id">Alex Rogachev</span>
          <span>~/bench</span>
          <span className="deck__spacer" />
          <span className="deck__clock">{clock}</span>
        </header>

        <div className="deck__body">
          {/* What the machine knows about itself. The same facts the boot recites, left
              standing afterwards, so the boot is a summary of the page rather than a
              performance that evaporates. */}
          <dl className="deck__rail">
            <dt>renderer</dt><dd>{webgl ? 'webgl2' : 'static'}</dd>
            <dt>index</dt><dd>{PROJECTS.length} projects</dd>
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
          <span className="deck__spacer" />
          <button ref={closeRef} type="button" className="deck__close" onClick={onExit}>
            back to the room <kbd>Esc</kbd>
          </button>
        </footer>
      </div>

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
