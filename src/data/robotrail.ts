/**
 * RoboTrail: what the rover becomes.
 *
 * **This is the module src/pages/robotrail.astro promised.** That page shipped as a stub
 * with a note saying that when the write-up landed it would "grow a src/data/robotrail.ts
 * the way BirdLense has one, and the room's placeholder reads from it — one module, two
 * surfaces, no drift". This is that file, and RoverFocus.tsx and robotrail.astro now both
 * read it.
 *
 * **It shares the headline and the lede, where src/data/birdlense.ts does not.** That file
 * shares only the structured parts and lets each surface write its own prose, and the two
 * ledes have already drifted a sentence apart. Nothing was gained by it: the panel and the
 * page are making the same claim to the same reader, one of them just arrived by camera.
 * So the sentences live here once. What stays per-surface is *selection* — the panel takes
 * the demo and the rail, the page takes everything — because a focus state is an arrival
 * and a page is an article, which is the one distinction that has earned its keep.
 *
 * **Everything here is checkable against the repo's README**, which is the rule the dark
 * palette runs on: it may only recite facts about the thing it is describing. This matters
 * more than usual here, because the stub it replaces got one wrong. It said the rover
 * "closes on its own odometry", which sounds like a loop-closure mechanism and is close to
 * the opposite of what the code does: loops close on *ICP scan matching*, and odometry is
 * what an ICP result gets sanity-checked against before it is allowed into the graph. An
 * ICP result that disagrees with odometry by more than 10cm or 20 degrees is thrown away.
 * The four facts in the stub were guesses that sounded like a rover; these are the README's.
 */

/**
 * **The run, and both surfaces play the same file.** A screen recording of the project's
 * dashboard: the rover's camera feed beside the occupancy grid assembling itself, frontier
 * cells resolving as they are visited, the pose graph growing and its trajectory bending
 * when the graph is optimised. The map is the project, so the map is what the panel shows.
 *
 * **The app title bar is hidden in CSS, not in a second encode.** `STOP` and `SHOW HUD` are
 * the only part of the frame that reads as a web page rather than an instrument, and the
 * panel already has chrome of its own across the top. room.css lifts the rover's video above
 * the panel's edge and `.focus` clips it. Doing that without re-encoding matters because
 * every re-encode measured worse — see "Re-encoding the demo" in CLAUDE.md, which also
 * records why the panel is not cropped to the camera pane alone.
 *
 * Shipped as the source encode, remuxed only: `moov` sat behind all 4.5MB of `mdat`, so
 * nothing could play until the whole file landed. `+faststart` moved it to byte 32 with the
 * video stream bit-identical.
 *
 * **Muted, looped, and it claims the stage manager's single slot** — CLAUDE.md rule 1 names
 * video as a live element. See RoverFocus.tsx.
 */
export const DEMO = {
  src: '/projects/robotrail/demo.mp4',
  /**
   * **t=30s, not frame 0**, which is an empty grid the run has not scanned into yet. The
   * panel barely shows it (faststart starts playback within a frame or two of the cut); it
   * matters under reduced motion, which does not autoplay. Chosen by eye — by metric it
   * would be wrong, since drawn map pixels peak at t=15 and then fall as the map is rebuilt
   * from corrected poses. See "Using frame 0 as a video poster" in CLAUDE.md.
   */
  poster: '/projects/robotrail/demo-poster.webp',
  /** The accessible name for a `<video>`, which has no `alt`. Says what is in the frame. */
  label: "RoboTrail's dashboard during an autonomous run: the rover's camera feed beside a "
    + 'live occupancy grid, with frontier cells, the pose graph and its driven trajectory '
    + 'drawn over the map as it explores.',
  /** Shown under the video on the write-up. */
  caption: 'One autonomous run, as the rover sees it and as it reasons about it. It picks a '
    + 'frontier, drives to it, stops, sweeps the room, folds the scan into the pose graph '
    + 'and repeats. The orange trail is where it has been; the pink cells are what it still '
    + 'does not know.',
} as const;

/**
 * **The machine itself, and it stays on the write-up.** Portrait, 1200x1600 — the shape is
 * the reason, not a preference: the focus panel is a landscape viewport with a text column
 * across its lower left, and a vertical photograph in it is either cropped to the middle
 * third of the robot or letterboxed against black. A scrolled page is the container a tall
 * image wants. Same split BirdLense's SHOTS make for the same reason.
 *
 * Off the repo's `robotrail.jpg`, resized to the asset ladder's long edge and stripped of
 * its EXIF (docs/PROMPTS.md — nothing ships at capture size; this arrived 1920x2560 and
 * 1.0MB from a phone).
 */
export const HARDWARE = {
  src: '/projects/robotrail/hardware.webp',
  width: 1200,
  height: 1600,
  alt: "RoboTrail's top plate: a Raspberry Pi 5 with a camera module on a printed mast, a "
    + 'buck converter with a lit voltage display, the time-of-flight laser in a printed '
    + 'bracket, and the motor driver and battery on the deck below.',
  caption: 'Two printed decks, about 155mm across. Everything above the plate is sensing '
    + 'and compute; the motors, driver and 2S pack are underneath. The lit red dot is the '
    + 'debug laser, which exists only to show where the rangefinder is actually pointing.',
} as const;

/**
 * Shared between both surfaces, so the room and the page make the same claim.
 *
 * "Maps a room by itself" is doing the work in the headline. The rover is not remarkable
 * for driving or for having a camera; it is remarkable for being handed no map and building
 * one, which is also the only thing in the demo a viewer can see happening.
 */
export const HEADLINE = 'A rover that maps a room by itself';

/**
 * Three sentences, and the length is a constraint rather than a style: this has to read in
 * the focus panel's 46ch column *above* a five-row rail, so a fourth sentence is one that
 * scrolls. The page has NOTES for everything that did not fit.
 */
export const LEDE = 'A 3D-printed robot on a Raspberry Pi 5, given no map and no lidar. It '
  + 'picks an unexplored edge of what it knows, drives there, sweeps a single laser through '
  + '180 degrees, and corrects every pose it has ever held against what it sees. Pose-graph '
  + 'SLAM, frontier exploration and ICP, written from scratch in numpy and scipy.';

/**
 * The mono rail: the stack as measurements rather than prose (rule 4).
 *
 * Five rather than the window's four, and the fifth is `written in`. "No ROS" is the claim
 * the whole project rests on — it is the difference between wiring up gmapping and deriving
 * scan matching — and burying it in a paragraph would be underselling the one fact a
 * roboticist reading this page will care about most.
 */
export const FACTS: readonly [string, string][] = [
  ['chassis', '3d-printed, tank tracks'],
  ['compute', 'raspberry pi 5'],
  ['scanner', 'one tof laser on a servo'],
  ['slam', 'pose graph + icp'],
  ['written in', 'numpy + scipy, no ros'],
];

/**
 * The five things worth knowing, in the focus states' voice: what it is and what decision
 * was made, not why it matters. BirdLense gets three; this gets five because two of them
 * are the guards and the frontier logic, and on this project those are the engineering —
 * the difference between a pipeline that demos and one that finishes a room.
 *
 * Every number below is the README's. None of them are rounded.
 */
export const NOTES: readonly { h: string; p: string }[] = [
  {
    h: 'There is no lidar',
    p: 'The scanner is one VL53L1X time-of-flight sensor on a hobby servo, taking 80 '
      + 'readings across a 180 degree arc every time the rover stops. A real lidar returns '
      + 'thousands of points, continuously, in every direction. Eighty points across half '
      + 'the compass, from a sensor that gives up past 250cm, is a sparse and half-blind '
      + 'view of a room — and making the rest of the pipeline work on that is most of what '
      + 'the project is.',
  },
  {
    h: 'A pose graph, not a filter',
    p: 'There is no EKF or particle filter in the running system. Every scan becomes a node, '
      + 'stored in sensor frame so it can be replayed later at a corrected pose, and edges '
      + 'come from odometry, from sequential ICP and from loop closures — each weighted by '
      + "an information matrix derived from its match ratio and residual. scipy's "
      + 'least_squares solves every pose jointly against a sparse Jacobian, and then the map '
      + 'is thrown away and rebuilt from the corrected trajectory. That runs every five '
      + 'nodes, or immediately when a loop closes.',
  },
  {
    h: 'Scan matching that knows about walls',
    p: 'ICP here is hybrid point-to-line. Surface normals are estimated from each map '
      + "point's six nearest neighbours, and where they are reliable the solver "
      + 'constrains a scan point to lie somewhere on the wall itself rather than on top of one '
      + 'specific dot of the map. With only 80 points in a scan that distinction is the '
      + 'difference between converging and not. Where the normals are unreliable it falls '
      + 'back to point-to-point SVD, and a match ratio under 25% aborts the alignment.',
  },
  {
    h: 'The guards are the work',
    p: 'An ICP result that disagrees with odometry by more than 10cm or 20 degrees is '
      + 'rejected outright, because alongside a long blank wall ICP hits the aperture '
      + 'problem: a confident match, the rotation right, the translation off by half the '
      + 'wall. A loop closure additionally needs a five-node gap, a candidate within 70cm, '
      + 'a heading gap under 90 degrees and a match ratio of 0.6 — two scans facing away '
      + 'from each other share no visible geometry, so a confident match between them is a '
      + 'lie. Turns over 60 degrees trigger a mid-turn scan, because otherwise a 90 degree '
      + 'turn leaves consecutive scans with nothing to overlap.',
  },
  {
    h: 'It decides where to go next',
    p: 'Frontier cells — traversable cells that touch unknown space — are clustered by BFS '
      + 'flood fill, and clusters under 30 cells are dismissed as noise. Obstacles are '
      + "inflated by the rover's own radius of 7.75cm plus 5cm of padding, then A* on "
      + 'the 8-connected grid plans a route which line-of-sight checks then simplify. It '
      + 'drives exactly one waypoint per iteration and re-detects frontiers after every '
      + 'scan, so it never keeps chasing a frontier the last scan already resolved. When '
      + 'nothing reachable is left unknown, the run is over.',
  },
];

export const REPO = 'https://github.com/AleksandrRogachev94/RoboTrail';

/**
 * **The repo is half write-up, and linking that is the point.** These are derivations and a
 * build log, not API docs — which is the most credible thing about the project and the
 * hardest thing for a portfolio page to assert about itself. Pointing at them beats
 * claiming it.
 *
 * EKF_GUIDE.md is deliberately not here. The README says plainly that it is background
 * reading from the learning path and not a description of what runs, and linking it from a
 * page whose own rail says "pose graph + icp" would invite exactly the wrong conclusion.
 */
export const DOCS: readonly { href: string; title: string; note: string }[] = [
  {
    href: `${REPO}/blob/main/LEARNING_PATH.md`,
    title: 'LEARNING_PATH.md',
    note: 'The stage-by-stage build log, dead reckoning through visual SLAM.',
  },
  {
    href: `${REPO}/blob/main/ICM_SCAN_MATCHING.md`,
    title: 'ICM_SCAN_MATCHING.md',
    note: 'ICP derived from first principles.',
  },
  {
    href: `${REPO}/blob/main/GRAPH_SLAM_GUIDE.md`,
    title: 'GRAPH_SLAM_GUIDE.md',
    note: 'Pose graphs, information matrices and loop closure.',
  },
  {
    href: `${REPO}/blob/main/CHASSIS.md`,
    title: 'CHASSIS.md',
    note: 'Chassis design, printing and wiring.',
  },
];
