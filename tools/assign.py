#!/usr/bin/env python3
"""Stage 4 - group object masks into render layers by occlusion rank.

Layers are not depth bands. The 3D printer reads farther (0.33) than the cabinet it
stands on (0.49), because it sits at the back of the cabinet top near the window. Any
grouping by depth value therefore puts the printer and the cabinet in the same layer,
leaves no cut between them, and the mesh smears across a 0.16 disparity jump - which is
exactly the artifact layering exists to remove.

So the rule is structural: A is drawn in front of B whenever A *hides part of* B, and
rank falls out of that graph:

    rank(shell) = 0                     the shell hides nothing
    rank(A)     = 1 + max rank of what A hides

The relation is authored in objects.json, not inferred. Inferring it from the depth map
was tried and does not survive contact: an object standing on a surface shares a long
boundary with it where nothing is hidden, and that contact edge drowns out the short
silhouette edge that matters. "The speaker stands on the cabinet" is a stable fact
about the room, cheap to state and trivial to check, so it is stated once.

The depth evidence is still measured - as a cross-check that warns on disagreement,
never as the source of truth.

The layer count is the longest occlusion chain, not the object count: objects that never
overlap share a plate however far apart they are, because each is its own alpha island
and the mesh is cut between them.
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np


def depth_evidence(depth, abrupt, a, b, min_gap, reach=9):
    """Which of a, b the depth map thinks is in front, from silhouette pixels only.

    Only abrupt steps vote. Where two surfaces meet in 3D, depth is continuous across
    the join and merely changes slope; nothing is hidden there.
    """
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (reach, reach))
    da = cv2.dilate(np.where(a, depth, -1.0), k)
    db = cv2.dilate(np.where(b, depth, -1.0), k)
    border = (cv2.dilate(a.astype(np.uint8), k) > 0) & (cv2.dilate(b.astype(np.uint8), k) > 0)
    border &= (da >= 0) & (db >= 0) & abrupt
    if border.sum() < 12:
        return None
    gap = (da - db)[border]
    ahead = float(np.clip(gap - min_gap, 0, None).sum())
    behind = float(np.clip(-gap - min_gap, 0, None).sum())
    if max(ahead, behind) < 5.0:
        return None
    return ahead >= behind


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--depth", required=True, type=Path, help="depth8-fixed.png")
    ap.add_argument("--objects", required=True, type=Path)
    ap.add_argument("--masks", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--color", type=Path, help="colour master, for the preview")
    ap.add_argument("--preview", type=Path)
    ap.add_argument("--min-gap", type=float, default=0.04)
    args = ap.parse_args()

    depth = cv2.imread(str(args.depth), cv2.IMREAD_GRAYSCALE)
    if depth is None:
        raise SystemExit(f"cannot read {args.depth}")
    depth = depth.astype(np.float32) / 255.0
    spec = json.loads(args.objects.read_text())
    objects = [o for o in spec["objects"] if not o.get("shell")]

    masks = {}
    for o in objects:
        m = cv2.imread(str(args.masks / f"{o['name']}.png"), cv2.IMREAD_GRAYSCALE)
        if m is None:
            raise SystemExit(f"missing mask for {o['name']} - run tools/segment.py first")
        masks[o["name"]] = m > 127

    # SAM masks can overlap. Give each contested pixel to the SMALLER mask, never to
    # whichever is nearer: the printer reads farther than the cabinet it stands on, so
    # resolving by depth hands the printer's own pixels to the cabinet. The thing
    # standing on a surface is always the smaller of the two.
    claim = np.zeros(depth.shape, np.int32)
    order = sorted(enumerate(objects, start=1), key=lambda p: -int(masks[p[1]["name"]].sum()))
    for i, o in order:
        claim[masks[o["name"]]] = i
    # An enclosed unclaimed island is either a thing lying on the object (the keyboard on
    # the desk) or a genuine see-through gap (between the plant's leaves, through the
    # printer's frame). Left alone, the first kind lands in the shell and then hides
    # behind the object drawn in front of it. Depth tells them apart, and this is a
    # comparison depth is reliable at: local, and between neighbours.
    ring = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    n_iso, iso = cv2.connectedComponents((claim == 0).astype(np.uint8), 4)
    border = set(np.unique(np.concatenate([iso[0], iso[-1], iso[:, 0], iso[:, -1]])))
    adopted = 0
    for c in range(1, n_iso):
        if c in border:
            continue
        isl = iso == c
        halo = cv2.dilate(isl.astype(np.uint8), ring).astype(bool) & ~isl
        owners = set(np.unique(claim[halo])) - {0}
        if len(owners) != 1:
            continue
        owner = owners.pop()
        rim = halo & (claim == owner)
        if rim.sum() < 8:
            continue
        # Farther than its surround by a real step -> a see-through gap, leave it shell.
        if float(np.median(depth[isl])) >= float(np.median(depth[rim])) - args.min_gap:
            claim[isl] = owner
            adopted += int(isl.sum())
    if adopted:
        print(f"  adopted {adopted} enclosed px into their surrounding object")

    for i, o in enumerate(objects, start=1):
        masks[o["name"]] = claim == i
    region = {"shell": claim == 0, **masks}
    print(f"{len(objects)} objects, shell is {100 * region['shell'].mean():.1f}% of frame")

    occludes = {o["name"]: list(o.get("in_front_of", [])) for o in objects}
    for name, backs in occludes.items():
        for b in backs:
            if b not in region:
                raise SystemExit(f"{name}: in_front_of names unknown object {b!r}")
        if not backs:
            print(f"  note: {name} hides nothing - it needs no mask")

    # --- cross-check the authored relation against the depth map ---------------------
    def grad(r):
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
        return cv2.dilate(depth, k) - cv2.erode(depth, k)

    s1, s4 = grad(1), grad(4)
    abrupt = (s1 > 0.05) & (s4 / np.maximum(s1, 1e-4) < 2.0)

    disagreed = 0
    for name, backs in occludes.items():
        for b in backs:
            says = depth_evidence(depth, abrupt, region[name], region[b], args.min_gap)
            if says is False:
                disagreed += 1
                print(f"  WARNING: depth says {b} is in front of {name}, "
                      f"but objects.json says the opposite")
    print(f"depth cross-check: {disagreed} disagreement(s)")

    # --- rank ------------------------------------------------------------------------
    rank = {n: 0 for n in region}
    for _ in range(len(region) + 1):
        changed = False
        for name, backs in occludes.items():
            if backs and 1 + max(rank[b] for b in backs) > rank[name]:
                rank[name] = 1 + max(rank[b] for b in backs)
                changed = True
        if not changed:
            break
    else:
        raise SystemExit("in_front_of contains a cycle")

    layers = defaultdict(list)
    for n in region:
        layers[rank[n]].append(n)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    # Clear previous layer masks: a run that yields fewer layers than the last one would
    # otherwise leave stale ones behind for the next stage to pick up.
    for stale in args.out_dir.glob("_layer*.png"):
        stale.unlink()
    print(f"\n{max(rank.values()) + 1} layers, back to front:")
    tint = [(70, 70, 235), (70, 235, 70), (235, 160, 60), (235, 70, 200)]  # BGR, by rank
    vis = None if args.color is None else cv2.imread(str(args.color)).astype(np.float32)
    for r in sorted(layers):
        m = np.zeros(depth.shape, bool)
        for n in layers[r]:
            m |= region[n]
        cv2.imwrite(str(args.out_dir / f"_layer{r}.png"), (m * 255).astype(np.uint8))
        print(f"  {r}  {100 * m.mean():5.1f}%  {', '.join(sorted(layers[r]))}")
        if vis is not None and r > 0:
            vis[m] = vis[m] * 0.45 + np.float32(tint[(r - 1) % len(tint)]) * 0.55

    if vis is not None and args.preview:
        # Rank 0 is left untinted: the shell is what everything else is measured against,
        # and a hole in it is the failure this preview exists to show.
        cv2.imwrite(str(args.preview), vis.astype(np.uint8))
        print(f"preview: {args.preview}   (untinted = shell, then by rank)")

    (args.out_dir / "_layers.json").write_text(json.dumps(
        {"rank": rank, "layers": {str(k): sorted(v) for k, v in layers.items()}}, indent=2) + "\n")


if __name__ == "__main__":
    main()
