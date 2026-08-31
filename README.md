# alexrogachev.com

Personal site for Alex Rogachev. One indoor room, rendered third-person wide, that acts as
a hub: the objects in the room are the navigation. Astro static site, one React island for
camera state, plain WebGL2 for the depth-displaced camera push.

## Run it

```sh
npm install
npm run dev        # /dev/room is the renderer harness
npm run check      # astro check
npm run build
```

Deployed by GitHub Actions to GitHub Pages.

## Where things are

```
src/                the site. Astro pages, one React island, WebGL2 renderer.
public/art/         the only art the browser loads — WebP colour + depth per layer.
art/                authored art inputs: the master, objects.json, hand masks, fills.
art/build/          everything the tools derive from those. Gitignored, disposable.
tools/              offline Python art pipeline. Never a site dependency.
docs/               why the site is shaped this way, and how to rebuild the art.
```

## Docs

Read in this order; each one says what the one before it does not.

| | |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | the rules that are load-bearing, and the list of things not to reopen |
| [docs/PLAN.md](docs/PLAN.md) | the design: what the site is, and why several obvious ideas were rejected |
| [docs/SCENE.md](docs/SCENE.md) | **the runbook.** Start to finish, for a new master |
| [docs/PIPELINE.md](docs/PIPELINE.md) | why the runbook is shaped that way — read when something looks wrong |
| [docs/PROMPTS.md](docs/PROMPTS.md) | every generation prompt, the naming convention, the asset ladder |
| [art/README.md](art/README.md) | authored vs derived, and the depth map's format |

## The art pipeline in one paragraph

One painterly master image plus a monocular depth map become a **layered depth image**:
three layers, each its own displaced mesh with its own colour, depth and alpha, drawn back
to front. Layers are occlusion rank, never depth range — `art/objects.json` states what
hides what, by hand. The surface behind each layer is inpainted offline so the camera can
slide and uncover it. All of that runs in `tools/` on a laptop and ships as eight WebP
files; the browser does no inference. [docs/SCENE.md](docs/SCENE.md) is the runbook.
