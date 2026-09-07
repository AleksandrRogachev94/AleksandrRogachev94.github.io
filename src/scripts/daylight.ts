/**
 * Which lighting the room is in, and who decided.
 *
 * CLAUDE.md rule 5 calls this a "day/night **override**", and the word is load-bearing:
 * the room's default is not a stored preference, it is the visitor's own clock. Someone
 * opening the page at eleven at night should find a room that is lit like eleven at night,
 * without having asked. The control exists to disagree with that, and disagreement is the
 * only thing worth persisting.
 *
 * So the stored value is tri-state — `day`, `night`, or absent meaning "follow the clock" —
 * rather than a boolean. A boolean cannot express "no opinion", and the difference shows up
 * the next morning: a visitor who toggled to night once at midnight would be stuck in a dark
 * room at noon the following day, with no way back to automatic short of clearing storage.
 *
 * The room is a *painting* of a room, not a simulation, so there are exactly two states and
 * the boundary is blunt. Dawn and dusk would each need their own master, their own SHARP
 * colour raster and their own night-adjacent set of lit objects; that is the seasonal
 * ladder's problem (docs/PROMPTS.md), not this module's.
 */

export type Daylight = 'day' | 'night';

const KEY = 'room-daylight';

/**
 * Night runs 19:00–07:00 by the visitor's own clock.
 *
 * Deliberately not sunrise/sunset from a latitude. That needs a location — either a
 * permission prompt or an IP lookup, and this site ships no third-party requests — to move
 * a boundary that only decides which of two paintings loads first. `getHours()` is already
 * local to wherever the browser thinks it is, which is the same answer for the cost of
 * nothing.
 */
export function inferred(now: Date = new Date()): Daylight {
  const h = now.getHours();
  return h >= 19 || h < 7 ? 'night' : 'day';
}

/** The visitor's explicit choice, or null if they have not made one. */
export function override(): Daylight | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'day' || v === 'night' ? v : null;
  } catch {
    return null;
  }
}

/** Persist a choice, or pass null to hand the room back to the clock. */
export function remember(value: Daylight | null): void {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* Private browsing, or storage disabled. The room still works; it just forgets. */
  }
}

/** What the room should be showing right now. */
export function current(): Daylight {
  return override() ?? inferred();
}

/**
 * Switch the room, and decide on the visitor's behalf whether that is an opinion worth
 * storing.
 *
 * **A two-state control over tri-state storage, and this is the join.** The control is one
 * button because the room is one room with the lights on or off; nobody wants a three-way
 * switch on a portfolio site, and an "auto" position is a setting, not an interaction. But
 * the storage has to stay tri-state for the reason in the header — an override that outlives
 * the hour it was made in strands someone in a dark room at noon.
 *
 * So: **choosing what the clock already says is not an override, it is agreement.** Toggling
 * to night at midnight stores nothing, because the room was going to be night anyway.
 * Toggling to day at midnight stores `day`, because that is a real disagreement. Toggle back
 * and the override clears itself rather than pinning `night` forever.
 *
 * The visitor never sees three states and never has to find a reset, and the only way to
 * hold an override past its natural hours is to leave the room in the state you had to ask
 * for — which is exactly when you meant it.
 */
export function choose(next: Daylight, now: Date = new Date()): Daylight {
  remember(next === inferred(now) ? null : next);
  return next;
}
