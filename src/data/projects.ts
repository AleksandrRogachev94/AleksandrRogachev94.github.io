/**
 * What sits on the software bench.
 *
 * CLAUDE.md rule 6: adding a software project is an entry here plus a page — never a
 * change to the room art. The bench reads this list, and so does `/software`, so the
 * focus state and the server-rendered page cannot drift apart.
 *
 * `tag` is the one-word category shown on the tile. It exists because the bench is a
 * *dashboard*: a reader scanning it should be able to tell GPU work from vision work
 * without reading three lines of prose. It is not a taxonomy and nothing filters on it.
 *
 * There is deliberately no "experiments" section. The obvious dashboard layout is two
 * columns of tiles, and filling a second column would mean inventing work that does not
 * exist. Three real projects, stated plainly, is the honest shape.
 *
 * **BirdLense and RoboTrail are not here.** CLAUDE.md's organizing principle: things
 * that exist physically get room addresses (window → BirdLense, work surface →
 * RoboTrail); only things that exist purely as code live on the bench. Listing them here
 * too would give each a second, competing address. They land in their own hotspots later.
 */

export interface Project {
  id: string;
  name: string;
  /** Scanning aid on the tile, not a taxonomy. */
  tag: string;
  /** One line, in the focus states' voice: what it is, not why it matters. */
  line: string;
  /** The parts worth naming. Shown small, under the line. */
  stack: string;
  /**
   * Real URL. Anchors into `/software` for now — every one of these resolves to something
   * a crawler and a no-JS reader can actually read. `/software/[slug]` is the next
   * increment and only the hrefs change when it lands.
   */
  href: string;
  /**
   * Where the live, playable thing lives, if there is one — iframed both inline on the
   * bench (MonitorFocus) and as the hero on this project's own page. Same URL both
   * places so there is exactly one thing to keep pointed at a deploy.
   */
  demo?: string;
  /** Public repo, if there is one. Shown as a small "source ↗" link next to `demo`. */
  repo?: string;
  /** The accent this project lights. Peers — see tokens.css. */
  accent: string;
  /** Shown in the tile's corner. True statements only. */
  status: 'live' | 'building';
}

export const PROJECTS: readonly Project[] = [
  {
    id: 'flowlab',
    name: 'flowlab',
    tag: 'GPU',
    line: 'A stable-fluids solver running in the browser.',
    stack: 'WebGPU · compute shaders · CPU fallback',
    href: '/software/flowlab',
    demo: 'https://alexrogachev.com/flowlab',
    repo: 'https://github.com/AleksandrRogachev94/flowlab',
    accent: 'var(--accent-flowlab)',
    status: 'live',
  },
];
