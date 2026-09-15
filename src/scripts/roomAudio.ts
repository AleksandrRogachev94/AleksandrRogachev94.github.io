/**
 * The room's ambient audio — the thing behind the speaker.
 *
 * **Off on every visit, and that is not a preference either.** Browsers refuse to start audio
 * without a user gesture, so "on by default" is not implementable even if it were wanted; and
 * unsolicited sound is the fastest way to lose a visitor regardless. One click starts it, and
 * the next page load starts from silence again.
 *
 * **The preference used to be remembered in `localStorage` and it is not any more.** The
 * argument for it was that a return visit could *arm* the resume and let the browser refuse —
 * and on the browsers that refuse, that is exactly what happened and it was harmless. The
 * problem is the browsers that do not: Chrome grants autoplay to an origin the visitor has
 * played media on before, so the one visitor guaranteed to have earned that grant — the person
 * who liked the loop enough to turn it on — is the one who gets sound with no gesture. A
 * preference that only takes effect where it is least wanted is not a feature. It also made
 * the speaker's light unexplainable: the LED could be lit at load with nothing audible, and
 * there was no way for the visitor to tell that from a bug.
 *
 * **Nothing is fetched until that click.** The `<audio>` element is created on first play,
 * not at mount, so a visitor who never touches the speaker never downloads the loop. That is
 * the same reason the splat rasters are not preloaded behind the poster (index.astro): the
 * room's bytes are the ones worth spending.
 *
 * **It registers with the stage manager but never claims the slot.** Audio is cheap, so
 * rule 1's one-live-element limit has nothing to protect against here — but the *other* half
 * of that rule, `document.hidden`, absolutely applies: audio that keeps playing in a
 * background tab is exactly the failure the rule exists to prevent. `registerAmbient` is the
 * hook stage.ts already carries for this, and it is the only member.
 *
 * **The caller is told what actually happened, never what was asked for.** `toggle()` resolves
 * to what is playing afterwards, which is not always what was requested — a missing file and a
 * codec the browser will not take both land in the same `catch`. Degrade explicitly.
 */

import { registerAmbient } from './stage';

/**
 * **"Sakura Meditate Beat" by moodmode, under the Pixabay Content License** — free for
 * commercial use, no attribution required. Credited anyway, in the colophon at the foot of
 * index.astro. Note that the Pixabay licence is *not* Creative Commons and grants no right to
 * redistribute the file on its own, which is a distinction worth keeping straight if this is
 * ever swapped: what it permits is use in a work, which is what this is.
 *
 * The long-term answer PLAN.md wants is Alex's own guitar, which retroactively justifies the
 * instrument on the wall.
 *
 * **Ogg Opus, and one file rather than a `<source>` ladder.** At 397KB it is a twentieth of
 * the MP3 it replaced, which matters for something nobody asked to download. The cost is
 * that Ogg support is the one thing Safari has been slowest on, so this is the asset most
 * likely to be refused — and that is survivable here in a way it would not be anywhere else
 * on the site: a media element whose resource fails to load rejects `play()` with
 * NotSupportedError, which lands in the same `catch` as a missing gesture, so the light
 * simply stays off. **A refusal is already a first-class
 * outcome of this module**, which is why it needs no format detection to go with it. If it
 * turns out to be refused on a browser worth caring about, the fix is a second file and a
 * `canPlayType` check here — not a change to anything that calls this.
 */
const SRC = '/audio/room-loop.opus';

/** Well under the room's own presence. This is furniture, not a soundtrack. */
const VOLUME = 0.3;

/** Long enough that it reads as a speaker coming up, short enough to feel like a switch. */
const FADE_MS = 800;

export interface RoomAudio {
  /**
   * Start it or stop it. Resolves to what is *actually* playing afterwards, which is not
   * always what was asked: the file may be missing, or the browser may refuse.
   */
  toggle(): Promise<boolean>;
  dispose(): void;
}

export function createRoomAudio(): RoomAudio {
  let el: HTMLAudioElement | null = null;
  /** What the visitor asked for, which `pause()` on a hidden tab must not overwrite. */
  let wanted = false;
  let ramp = 0;
  let unregister: (() => void) | null = null;

  const stopRamp = () => {
    if (ramp) { clearInterval(ramp); ramp = 0; }
  };

  /** Ramp the volume. An interval rather than a Web Audio node: this is one gain on one
   *  element, and an AudioContext is a whole graph plus its own suspend/resume lifecycle to
   *  keep in step with the tab rule above. */
  const fade = (to: number, then?: () => void) => {
    stopRamp();
    const a = el;
    if (!a) return;
    const from = a.volume;
    const t0 = performance.now();
    ramp = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / FADE_MS);
      a.volume = from + (to - from) * k;
      if (k === 1) { stopRamp(); then?.(); }
    }, 16);
  };

  const ensure = (): HTMLAudioElement => {
    if (el) return el;
    el = new Audio(SRC);
    el.loop = true;
    el.preload = 'none';
    el.volume = 0;
    // Cheap, and it never holds the slot — so a WebGPU demo launched from the bench does
    // not evict the music, which is the correct behaviour for something that is furniture.
    unregister = registerAmbient({
      id: 'room-audio',
      destroy: () => { el?.pause(); },
      // `wanted` is deliberately untouched by both: a hidden tab is not the visitor
      // changing their mind, so coming back resumes exactly what was playing.
      pause: () => { stopRamp(); el?.pause(); },
      resume: () => { if (wanted) void el?.play().catch(() => {}); },
    });
    return el;
  };

  const start = async (): Promise<boolean> => {
    const a = ensure();
    try {
      await a.play();
    } catch {
      // No gesture, no file, or a codec the browser will not take. Say so by staying off.
      wanted = false;
      return false;
    }
    wanted = true;
    fade(VOLUME);
    return true;
  };

  const stop = (): void => {
    wanted = false;
    // Fade first, pause at the bottom — a hard `pause()` on a loop with any low end in it
    // is a click, and this one is meant to sound like a speaker being switched off.
    fade(0, () => el?.pause());
  };

  return {
    async toggle() {
      if (wanted) { stop(); return false; }
      return start();
    },
    dispose() {
      stopRamp();
      unregister?.();
      el?.pause();
      el = null;
    },
  };
}
