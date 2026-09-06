/**
 * Who the site is about, and where else to find him.
 *
 * **Why this is a module and not just markup in index.astro.** Everything else the site
 * knows about itself is data — hotspots.ts, projects.ts, controls.ts, birdlense.ts — and
 * identity is the one piece that was still hardcoded in a page. It is also the piece most
 * likely to be needed twice: a footer, an `og:` tag, a JSON-LD block, an `author` on a
 * project page. One place to change a handle beats grep.
 *
 * **Nothing here is aspirational.** Same rule as everywhere else on this site: the dark
 * palette only recites checkable things, and a bio is exactly where that slips. Georgia
 * Tech OMSCS, Philadelphia, and the three projects are facts; "passionate about building
 * delightful experiences" is not a fact and is not here.
 */

export const SITE = {
  name: 'Alex Rogachev',
  /** The `<meta name="description">` and the page's own lede. One line, no adjectives. */
  tagline: 'Software, computer vision, and things built indoors.',
} as const;

export interface Link {
  label: string;
  href: string;
  /** Off-site links get `target="_blank" rel="noopener"` and the ↗ mark. */
  external?: boolean;
}

/**
 * **The room, in text — and the only crawlable path to any of it.**
 *
 * This is not a duplicate navigation, and the distinction is load-bearing. The room's
 * hotspots render as real `<a href>` elements (Hotspot.tsx), but they are positioned from a
 * viewport measurement taken in a `useEffect`, which never runs during Astro's prerender —
 * so `<div class="hotspots">` ships **empty** in the static HTML. Without these three links
 * in the document, /software, /birdlense and /robotrail are orphan pages reachable only by
 * a hydrated React island: invisible to a crawler, unreachable with JS off.
 *
 * So they stay. What went away is the three *sections* of project prose that used to sit
 * here restating pages that already exist — that was a second showcase competing with the
 * room, and the room wins. A sentence with three links in it is a table of contents, and it
 * doubles as the only explanation a no-JS visitor gets of what the blank rectangle above
 * them was supposed to be.
 */
export const ROOM_LINKS = {
  bench: { label: 'the software bench', href: '/software' },
  birdlense: { label: 'BirdLense', href: '/birdlense' },
  robotrail: { label: 'RoboTrail', href: '/robotrail' },
} as const satisfies Record<string, Link>;

/**
 * Off-site. **Deliberately short, and deliberately not a row of icons.**
 *
 * A wall of monochrome social glyphs is the single most generic thing a portfolio can
 * carry, and this site's whole argument is that it is not that. Named links in prose-sized
 * text cost nothing and say what they are.
 *
 * Two, both given by Alex directly. An email would be the obvious third and is deliberately
 * absent until he asks for it: publishing an address is his call, and a portfolio is a page
 * scrapers read.
 */
export const ELSEWHERE: readonly Link[] = [
  { label: 'GitHub', href: 'https://github.com/AleksandrRogachev94', external: true },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/aleksandr-rogachev/', external: true },
];
