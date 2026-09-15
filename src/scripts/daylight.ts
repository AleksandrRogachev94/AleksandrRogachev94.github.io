/**
 * Which lighting the room is in.
 *
 * **The visitor's own clock, every load, with no memory.** Someone opening the page at eleven
 * at night should find a room lit like eleven at night, without having asked — and someone
 * opening it at noon the next day should find a bright one, whatever they clicked last time.
 *
 * The switch in the corner is a room control (CLAUDE.md rule 5), and it changes the room for
 * as long as you are in it. It is not a preference. This used to persist a *disagreement*
 * with the clock in localStorage, tri-state so that agreeing cleared it — carefully built,
 * and solving a problem the room does not have. What it actually bought was a room that could
 * be wrong about the time of day for months because of one curious click, which is a strange
 * thing to inherit on a portfolio site. The record player already works this way: off on
 * every load, never restored.
 *
 * The room is a *painting* of a room, not a simulation, so there are exactly two states and
 * the boundary is blunt. Dawn and dusk would each need their own master, their own SHARP
 * colour raster and their own night-adjacent set of lit objects; that is the seasonal
 * ladder's problem (docs/PROMPTS.md), not this module's.
 */

export type Daylight = 'day' | 'night';

const NIGHT_FROM = 19;
const NIGHT_UNTIL = 7;

/**
 * Night runs 19:00–07:00 by the visitor's own clock.
 *
 * Deliberately not sunrise/sunset from a latitude. That needs a location — either a
 * permission prompt or an IP lookup, and this site ships no third-party requests — to move
 * a boundary that only decides which of two paintings loads. `getHours()` is already local to
 * wherever the browser thinks it is, which is the same answer for the cost of nothing.
 */
export function inferred(now: Date = new Date()): Daylight {
  const h = now.getHours();
  return h >= NIGHT_FROM || h < NIGHT_UNTIL ? 'night' : 'day';
}

/**
 * What the room should show on load. An alias for `inferred`, kept as its own name because
 * the callers are asking a different question — "what now?" rather than "what does the clock
 * say?" — and those were briefly different answers.
 */
export const current = inferred;
