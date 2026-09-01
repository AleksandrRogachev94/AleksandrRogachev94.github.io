/**
 * One live element at a time, site-wide.
 *
 * "Live" means *heavy*: a GPU sim, a video, a cross-origin iframe. flowlab is a real
 * WebGPU workload and it is something you arrive at, never ambient chrome — so the rule is
 * not a suggestion and there is no per-page opt-out. Anything heavy registers here, and
 * mounting a second one destroys the first (CLAUDE.md rule 1).
 *
 * Two deliberate non-members:
 *
 * - **The room renderer.** It is the baseline live surface — the thing every focus state
 *   is mounted *over* — so it can hardly be evicted by one. Its ambient tier (idle drift,
 *   cursor parallax, dust) lives inside its own single rAF and pauses when a focus state
 *   mounts, which the focus state arranges directly.
 * - **Ambient audio.** Cheap enough to be exempt from the one-at-a-time rule, but *not*
 *   exempt from `document.hidden` — audio that keeps playing in a background tab is the
 *   fastest way to lose a visitor. It registers as a pausable element and simply never
 *   claims the single slot.
 *
 * Deliberately tiny. Its whole value is that there is one place to look when asking "what
 * is running right now", and one place that guarantees the answer is at most one thing.
 */

export interface LiveElement {
  id: string;
  /** Tear it down completely: stop the loop, release the context, remove the iframe. */
  destroy(): void;
  /** Optional cheaper stop, used for tab visibility rather than eviction. */
  pause?(): void;
  resume?(): void;
}

let live: LiveElement | null = null;
/** Registered but not holding the slot — ambient audio, which only needs the tab rule. */
const ambient = new Set<LiveElement>();
let listening = false;

function onVisibility() {
  if (document.hidden) {
    live?.pause?.();
    for (const a of ambient) a.pause?.();
  } else {
    live?.resume?.();
    for (const a of ambient) a.resume?.();
  }
}

function listen() {
  if (listening || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', onVisibility);
  listening = true;
}

/**
 * Claim the single live slot, destroying whatever held it. Returns a disposer, so a React
 * effect can be `useEffect(() => stage.mount(el), [])` and get the rule enforced on
 * unmount for free.
 */
export function mount(el: LiveElement): () => void {
  listen();
  if (live && live.id !== el.id) live.destroy();
  live = el;
  if (document.hidden) el.pause?.();
  return () => unmount(el.id);
}

/** Release the slot if `id` still holds it. Safe to call twice, and safe if it does not. */
export function unmount(id: string): void {
  if (live?.id !== id) return;
  live.destroy();
  live = null;
}

/** What holds the slot, or null. The answer to "what is running right now". */
export function current(): string | null {
  return live?.id ?? null;
}

/**
 * Register something cheap that must still obey `document.hidden` without competing for
 * the slot. Currently only the record player.
 */
export function registerAmbient(el: LiveElement): () => void {
  listen();
  ambient.add(el);
  if (document.hidden) el.pause?.();
  return () => { ambient.delete(el); };
}
