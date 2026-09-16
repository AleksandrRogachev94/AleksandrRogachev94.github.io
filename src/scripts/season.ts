/**
 * Which season the room is in.
 *
 * **The same shape as daylight.ts: the visitor's own calendar, every load, with no memory.**
 * The switch changes the room while you are in it and is forgotten when you leave. The
 * reasoning is written out there.
 *
 * Separate module rather than one "lighting" module with four fields because the two answer
 * to different clocks — time of day turns over twice a day, season four times a year — and
 * they meet in exactly one place, `variantFor` in src/data/scene.ts.
 *
 * **Three seasons, not four.** Spring maps to summer — see `variantFor` for why it earns no
 * reconstruction of its own. Every other cell of the season x daylight matrix has one.
 */

export type Season = 'summer' | 'fall' | 'winter';

/**
 * Month indices (0 = January). Winter wraps the year, so it is listed rather than ranged.
 *
 * Exported for the same reason daylight.ts exports its hours: the pre-paint script in
 * `index.astro` needs the boundaries before the island exists, and interpolating them keeps
 * one definition rather than two that can drift.
 */
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
 * sunset: this decides which painting loads, not what time it is.
 */
export function inferred(now: Date = new Date()): Season {
  const m = now.getMonth();
  if (WINTER_MONTHS.includes(m)) return 'winter';
  if (FALL_MONTHS.includes(m)) return 'fall';
  return 'summer';
}

/** What the room should show on load. See the note on daylight.ts's `current`. */
export const current = inferred;
