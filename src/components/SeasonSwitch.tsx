/**
 * The season switch.
 *
 * **A room control (CLAUDE.md rule 5), and chrome for the same reason the day/night toggle
 * is** — it changes the light in place, the camera never moves, and there is no object in the
 * room that means "October". It sits in the same corner, in the same glass-pill vocabulary,
 * and shares `.daylight`'s styling wholesale.
 *
 * **One pill that opens, rather than three laid out side by side.** The first version put all
 * three on the art permanently. Every argument for that still holds in isolation — each state
 * is one click, each carries its own label, and a wrong guess at a cycle button costs a ~11MB
 * fetch, now that a season brings its own geometry and not just its own colours — and it was
 * still wrong, because it got the *weighting* backwards. This is the second control in a
 * corner of a page whose whole subject is the picture behind it, and the season is something a
 * visitor changes at most once. Three permanent labels spend the room's quietest corner on an
 * affordance almost nobody uses twice.
 *
 * A disclosure keeps what mattered and drops what did not. Collapsed it is one pill the width
 * of its neighbour, showing the season the room is *in* — which is the only part that earns
 * permanent space, because it is the label for what you are looking at. Open, it is still three
 * discrete targets with three labels and no guessing. The cost is one click before the choice,
 * paid only by visitors who want it.
 *
 * **The trigger names the current season; the day/night button names its destination.** They
 * read as a pair and say opposite things, which is correct rather than sloppy: "Night" is one
 * switch with somewhere to go, and the room itself already shows you where you are, so
 * labelling it with its state would be a light switch marked with the light's state. This one
 * has three destinations and cannot name them all, so it names what it is — and then shows the
 * three when asked.
 *
 * **The current season stays clickable inside the menu.** It is `aria-pressed` and visually
 * held, but pressing it is not a no-op: `choose()` treats picking what the calendar already
 * says as *agreement* and clears any stored override, so tapping the lit one is how a visitor
 * gets back to automatic. Nothing advertises that, and nothing needs to — it is a way out, not
 * a feature.
 *
 * Spring is deliberately absent — it maps to summer, which is the one seasonal difference
 * the eye cannot find through a window at this size. See `variantFor` in data/scene.ts.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Season } from '../scripts/season';

/** Label per season. The mark beside it is drawn in CSS — see `.season__mark`. */
const SEASONS: readonly { id: Season; label: string }[] = [
  { id: 'summer', label: 'Summer' },
  { id: 'fall', label: 'Fall' },
  { id: 'winter', label: 'Winter' },
];

interface Props {
  /** What the room is showing. Null until the mount effect has read the visitor's clock. */
  season: Season | null;
  onChoose(next: Season): void;
}

export default function SeasonSwitch({ season, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  /** Close, and hand focus back to the trigger — but only when focus is still inside the
   *  menu that is about to disappear. Pulling it back after an outside click would yank the
   *  page to the corner the visitor just clicked away from. */
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); }
    };
    // `pointerdown`, not `click`: the room under this is a canvas that starts a drag on
    // pointerdown, so waiting for the click would leave the menu open over a moving room.
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    selected.current?.focus();
    // Capture on both, so Escape closes the menu before the room's own Esc handler reads it
    // as "pull the camera back" — a menu is the innermost thing open, and it goes first.
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [close, open]);

  // Nothing until the calendar has been read, for the reason DaylightToggle.tsx gives: this
  // is an island, so anything decided during render is decided at build time on a machine in
  // another month.
  if (!season) return null;

  const current = SEASONS.find((s) => s.id === season) ?? SEASONS[0];

  return (
    <div
      className="season"
      ref={root}
      // Tabbing off the last option closes the menu behind you. `relatedTarget` is null when
      // focus leaves the document entirely (another tab, the URL bar), which is not a reason
      // to collapse anything.
      onBlur={(e) => {
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="season__trigger"
        ref={trigger}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        // The visible word is the season alone — the corner has no room for a sentence — so
        // the accessible name adds the noun it leaves implicit. It *contains* the visible
        // label rather than replacing it, which is what voice control needs (WCAG 2.5.3).
        aria-label={`${current.label} season`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`season__mark season__mark--${current.id}`} aria-hidden="true" />
        <span className="season__label">{current.label}</span>
        <span className="season__caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="season__menu" id={menuId} role="group" aria-label="Season">
          {SEASONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="season__pick"
              aria-pressed={s.id === season}
              // Opening moves focus onto the season the room is already in, so the menu
              // starts where the visitor is and Escape has somewhere to come back from.
              // `:focus-visible` keeps that invisible to a mouse.
              ref={s.id === season ? selected : undefined}
              onClick={() => { onChoose(s.id); close(true); }}
            >
              <span className={`season__mark season__mark--${s.id}`} aria-hidden="true" />
              <span className="season__label">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
