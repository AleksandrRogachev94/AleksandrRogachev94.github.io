/**
 * BirdLense: what the window becomes.
 *
 * **Why this is not an entry in projects.ts.** CLAUDE.md's organizing principle splits the
 * site by where a thing exists, not by what it is made of: things that exist *physically*
 * get room addresses, and only things that exist purely as code live on the monitor. A bird
 * feeder in the yard is as physical as it gets. Listing it on the bench as well would give
 * it a second, competing address — which is exactly what projects.ts already says in its own
 * header, and this file is the other half of that decision finally being built.
 *
 * **Everything here is checkable.** The stack lines come from the repo's README; the
 * numbers come off the screenshots themselves and are labelled as one day at one feeder,
 * because that is what they are. A portfolio that rounds "9 species on May 23" up into
 * "hundreds of species" is worth less than one that does not, and this whole site is built
 * around the rule that the boot sequence may only recite facts about the page it is on.
 *
 * The shots are the deployed app's own UI, exported to WebP at 1600px (docs/PROMPTS.md's
 * asset ladder — nothing ships at generation size). They are screenshots of a thing that
 * runs on a Raspberry Pi in Alex's yard, so there is no live demo to iframe and no stage
 * manager slot to claim: this focus state is three images and some prose, which is the
 * cheapest destination in the site.
 */

/**
 * **The arrival: one frame from the feeder's own camera, cropped out of the app around it.**
 *
 * This is the fix for a real complaint — pushing into the feeder and landing on a screenshot
 * of a dashboard made the window feel like a second monitor, and no amount of retuning the
 * *transition* could have fixed that, because the destination itself was a picture of a
 * computer screen in a frame. What the feeder sees is a bird on a rail. So the panel shows
 * that, full-bleed, and the app screenshots move to the write-up where they belong.
 *
 * Cropped to the player region only: above it are the Video/Spectrogram tabs and the Tracks
 * toggle, and those are the app talking about itself. What survives is the tracker's box,
 * the classifier's label and its 88% — which is not chrome, it is the output, and it is the
 * whole reason the project exists.
 */
export const VIEW = {
  src: '/projects/birdlense/view.webp',
  alt: 'A northern cardinal on a weathered feeder rail, with a tracking box labelled '
    + '"#1 Northern Cardinal (Adult Male)" and an 88% confidence chip.',
} as const;

export interface Shot {
  id: string;
  src: string;
  /** Real alt text. The focus state is a `dialog`; nothing here gets to be decorative. */
  alt: string;
  /** Shown under the hero, and used as the thumbnail's accessible name. */
  caption: string;
  /** Two or three words on the strip, so the thumbnails are navigable without hovering. */
  short: string;
}

/**
 * The app's own screens. **These are the write-up's, not the room's** — see VIEW above for
 * why the focus state stopped showing them. Still exactly right on a page you scrolled to.
 */
export const SHOTS: readonly Shot[] = [
  {
    id: 'detection',
    src: '/projects/birdlense/detection.webp',
    alt: 'A recorded clip of a northern cardinal on a feeder rail, with a tracking box '
      + 'labelled "#1 Northern Cardinal (Adult Male)" and an 88% confidence chip.',
    caption: 'One recording. The box is the tracker holding an identity across the clip; '
      + 'the label and the 88% are the classifier. Tracks and spectrogram are toggles.',
    short: 'detection',
  },
  {
    id: 'dashboard',
    src: '/projects/birdlense/dashboard.webp',
    alt: "BirdLense's dashboard: unique species, total visits, mean visit duration, "
      + 'busiest hour, recording time, weather, and an hourly activity chart.',
    caption: 'A day at the feeder — 9 species, 107 visits, mean visit 87 seconds, busiest '
      + 'at 9 AM. Detections are plotted against temperature, because they correlate.',
    short: 'the day',
  },
  {
    id: 'activity',
    src: '/projects/birdlense/activity.webp',
    alt: 'A 24-hour polar activity chart and a species distribution donut listing house '
      + 'sparrow, squirrel, house finch, pileated woodpecker, northern cardinal and others.',
    caption: 'The same day by species and by hour. The squirrel is not a misdetection — it '
      + 'is a class, because something eating the seed is worth counting either way.',
    short: 'who came',
  },
];

/** The mono rail, and the one place the stack is stated as facts rather than prose. */
export const FACTS: readonly [string, string][] = [
  ['device', 'raspberry pi'],
  ['vision', 'yolo + bytetrack'],
  ['audio', 'birdnet-analyzer'],
  ['data', 'stays on the pi'],
];

/**
 * The three things worth knowing, in the focus states' voice: what it is, not why it
 * matters. Each one is a decision with a reason — a feature list would say more and
 * explain less.
 */
export const NOTES: readonly { h: string; p: string }[] = [
  {
    h: 'Two stages, not one big model',
    p: 'A binary detector decides whether there is a bird at all, and only then does a '
      + 'species classifier run. On a Pi that is the difference between keeping up with the '
      + 'camera and not. ByteTrack sits on top so one visit is one bird, not forty frames '
      + 'of separate sightings.',
  },
  {
    h: 'It listens as well as looks',
    p: 'BirdNET-Analyzer runs on the USB mic, so a bird calling from the tree behind the '
      + 'feeder is still recorded. Vision and audio are two independent votes on what was '
      + 'there, which is the point of having both.',
  },
  {
    h: 'Nothing leaves the yard',
    p: 'Detection, classification, storage and the web UI all run on the device, in Docker. '
      + 'The cloud is opt-in and used for exactly two things: the weather, and an optional '
      + 'Gemini call that writes the day up in a paragraph.',
  },
];

export const REPO = 'https://github.com/AleksandrRogachev94/BirdLense';
