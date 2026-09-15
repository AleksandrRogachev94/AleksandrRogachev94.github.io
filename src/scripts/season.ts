/**
 * Which season the room is in, and who decided.
 *
 * **The same shape as daylight.ts, deliberately.** Default to the visitor's own calendar,
 * store only a *disagreement* with it, and let choosing what the calendar already says clear
 * the override rather than pin it. The reasoning is written out in full there and is not
 * repeated here; what is worth saying is why the two are separate modules rather than one
 * "lighting" module with four fields.
 *
 * They answer to different clocks. Time of day turns over twice a day and season four times a
 * year, so an override on one has nothing to say about the other: someone who forces night at
 * noon in October has expressed no opinion about October. Folded into a single stored value
 * those two opinions could not be held apart, and the visitor would have to re-state one every
 * time they changed the other. Two keys, two inferences, one matrix where they meet
 * (`variantFor` in src/data/scene.ts).
 *
 * **Three seasons, not four.** Spring maps to summer — see `variantFor` for why it earns no
 * reconstruction of its own. Every other cell of the season x daylight matrix has one.
 */

export type Season = 'summer' | 'fall' | 'winter';

/** Exported for the same reason daylight.ts exports its own: index.astro infers the season
 *  in an inline script before the island exists, and the boundaries live here only. */
export const KEY = 'room-season';
/** Month indices (0 = January). Winter wraps the year, so it is listed rather than ranged. */
export const WINTER_MONTHS = [11, 0, 1];
export const FALL_MONTHS = [8, 9, 10];

/**
 * Meteorological seasons off the visitor's own clock: Dec–Feb winter, Sep–Nov fall, the rest
 * summer.
 *
 * **Northern hemisphere, and that is a real limitation rather than an oversight.**
 * `getMonth()` is local to the browser but a month does not carry a hemisphere, so a visitor
 * in Sydney gets snow in July. Fixing it needs a latitude — a permission prompt or an IP
 * lookup, and this site ships no third-party requests — to flip a boundary the switch in the
 * corner already overrides in one click. The astronomical boundaries (the 20th-ish of the
 * month) are skipped for the same reason the day/night line is 19:00 rather than a computed
 * sunset: this decides which of a few paintings loads first, not what time it is.
 */
export function inferred(now: Date = new Date()): Season {
  const m = now.getMonth();
  if (WINTER_MONTHS.includes(m)) return 'winter';
  if (FALL_MONTHS.includes(m)) return 'fall';
  return 'summer';
}

const parse = (v: string | null): Season | null =>
  v === 'summer' || v === 'fall' || v === 'winter' ? v : null;

/** The visitor's explicit choice, or null if they have not made one. */
export function override(): Season | null {
  try {
    return parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Persist a choice, or pass null to hand the room back to the calendar. */
export function remember(value: Season | null): void {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* Private browsing, or storage disabled. The room still works; it just forgets. */
  }
}

/** What the room should be showing right now. */
export function current(): Season {
  return override() ?? inferred();
}

/**
 * Switch the season, storing it only if it disagrees with the calendar.
 *
 * The same join daylight.ts makes, and it matters more here, not less: a season override
 * lasts months by construction. Picking winter in December stores nothing, so the room
 * quietly returns to fall next September instead of being frozen in a snowdrift by one
 * curious click a year earlier.
 */
export function choose(next: Season, now: Date = new Date()): Season {
  remember(next === inferred(now) ? null : next);
  return next;
}
