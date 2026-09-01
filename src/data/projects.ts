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
    href: '/software#flowlab',
    accent: 'var(--accent-flowlab)',
    status: 'live',
  },
  {
    id: 'birdlense',
    name: 'BirdLense',
    tag: 'VISION',
    line: 'A smart bird feeder that knows what landed on it.',
    stack: 'YOLO · ByteTrack · BirdNET',
    href: '/software#birdlense',
    accent: 'var(--accent-birdlense)',
    status: 'live',
  },
  {
    id: 'robotrail',
    name: 'RoboTrail',
    tag: 'ROBOTICS',
    line: 'Graph SLAM on a Raspberry Pi, driving a tracked robot.',
    stack: 'ROS · pose graph · Pi 5',
    href: '/software#robotrail',
    accent: 'var(--accent-robotrail)',
    status: 'building',
  },
];
