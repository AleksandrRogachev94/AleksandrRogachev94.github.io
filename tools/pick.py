"""Interactive SAM prompting - click points, see the mask, write them back.

Stage 2 (`segment.py`) is a batch run: it reads click points out of objects.json and
takes whatever SAM returns. That is the right shape for the pipeline, and the wrong
shape for *authoring* the points, because the feedback loop is edit-JSON → run → open
a preview → guess again. The desk is the standing proof: three rounds of that loop
ended in four hand-drawn polygons that miss the desk's left leg and its whole
underside, and those pixels are stranded in the shell.

So this serves the same predictor over HTTP with the image already embedded, and the
loop becomes click → look. The model is identical to the one segment.py runs, the
hole-filling is imported from it rather than reimplemented, and the output is the same
normalised 0-1 points in the same file. Nothing here is a second source of truth.

    tools/.venv/bin/python tools/pick.py \
      --color art/room-day-summer.jpg --objects art/objects.json

Then open http://localhost:8765.

  + new             create an object that is not in objects.json yet
  DRAG              draw a bounding box - the strongest prompt, use it for anything
                    large or cluttered (the desk, the cabinet, a bookshelf)
  left click        add a positive point   (this is the thing)
  right / shift     add a negative point   (this is not)
  u                 undo the last point
  c                 clear all points
  s / Save          write this object's points back to objects.json

objects.json may start empty - `{"objects": []}` - or not exist at all, in which case it
is created. It only ever lists objects that HIDE another object.

What it does NOT do is let you paint a mask by hand. A hand-painted mask is a fourth
authoring format that only matches the master it was painted on, and every mask here
has to survive the 4K re-derive. Normalised points survive it; pixels do not.
"""

from __future__ import annotations

import argparse
import base64
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import cv2
import numpy as np

from segment import MODELS, Segmenter, fill_holes, refine_matte

PAGE = r"""<!doctype html><meta charset=utf-8><title>pick - SAM prompts</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;background:#111;color:#eee;font:13px/1.5 ui-monospace,SFMono-Regular,monospace}
 #bar{position:fixed;inset:0 0 auto 0;display:flex;gap:10px;align-items:center;
      padding:8px 12px;background:#1b1b1bdd;backdrop-filter:blur(6px);z-index:2}
 select,button{font:inherit;background:#2a2a2a;color:#eee;border:1px solid #444;
      border-radius:5px;padding:3px 8px}
 button:hover{background:#383838}
 #stat{margin-left:auto;color:#8ab4f8}
 #warn{color:#ffb454}
 #wrap{position:absolute;top:44px;left:0;right:0;bottom:0;overflow:auto}
 canvas{display:block;margin:0 auto;cursor:crosshair;max-width:100%}
 kbd{background:#2a2a2a;border:1px solid #444;border-radius:3px;padding:0 4px}
</style>
<div id=bar>
  <select id=obj></select>
  <button id=add title="add an object that is not in objects.json yet">+ new</button>
  <button id=undo>undo</button><button id=nobox title="drop the box, keep the points">drop box</button><button id=clear>clear</button>
  <label title="Tick for plants, open frames, wire racks - anything you can see the room THROUGH.
Two things follow: enclosed holes in the mask are kept as real background instead of filled in,
and the boundary is re-cut by an alpha matting model, which is what separates individual fronds.
Leave unticked for solid objects.">
    <input type=checkbox id=open> see-through</label>
  <button id=save>save</button>
  <span id=warn></span>
  <span id=stat>loading…</span>
</div>
<div id=wrap><canvas id=c></canvas></div>
<script>
const c = document.getElementById('c'), ctx = c.getContext('2d');
const $ = id => document.getElementById(id);
let img = new Image(), spec = null, cur = null, pts = [], mask = new Image(), busy = 0;
let box = null, drag = null;

function draw() {
  ctx.drawImage(img, 0, 0);
  if (mask.complete && mask.naturalWidth) ctx.drawImage(mask, 0, 0);
  const b = drag || box;
  if (b) {
    ctx.save();
    ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = Math.max(2, img.width / 500);
    ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 3]);
    ctx.strokeRect(b[0] * img.width, b[1] * img.height,
                   (b[2] - b[0]) * img.width, (b[3] - b[1]) * img.height);
    ctx.restore();
  }
  const r = Math.max(4, img.width / 220);
  for (const [x, y, l] of pts) {
    ctx.beginPath(); ctx.arc(x * img.width, y * img.height, r, 0, 7);
    ctx.fillStyle = l ? '#fff' : '#000';
    ctx.strokeStyle = l ? '#000' : '#fff';
    ctx.lineWidth = Math.max(1, r / 3); ctx.fill(); ctx.stroke();
  }
}

async function predict() {
  if (!pts.length && !box) { mask = new Image(); $('stat').textContent = 'no prompts'; draw(); return; }
  const seq = ++busy;
  $('stat').textContent = 'predicting…';
  const r = await fetch('/predict', { method: 'POST', body: JSON.stringify(
      { points: pts, box, open_frame: $('open').checked }) }).then(r => r.json());
  if (seq !== busy) return;                 // a newer click already superseded this one
  $('stat').textContent = `${r.area.toFixed(2)}% of frame · SAM score ${r.score.toFixed(3)}`
    + (r.filled ? ` · +${r.filled}px enclosed holes filled` : '')
    + (r.matted ? ` · matted ${r.matted > 0 ? '+' : ''}${r.matted}px` : '');
  if (!r.mask) { mask = new Image(); draw(); return; }
  const m = new Image();
  m.onload = () => { mask = m; draw(); };
  m.src = r.mask;
}

function load(name) {
  cur = spec.objects.find(o => o.name === name);
  box = cur.box ? cur.box.slice() : null;
  pts = [...(cur.points || []).map(p => [p[0], p[1], 1]),
         ...(cur.negative || []).map(p => [p[0], p[1], 0])];
  $('open').checked = !!cur.open_frame;
  $('warn').textContent = cur.mask
    ? 'HAND-PAINTED (' + cur.mask + ') — edit that file in an image editor, not here; '
      + 'saving points here would replace it'
    : cur.polygons
    ? 'authored as polygons — saving points replaces them' : '';
  predict();
}

// Drag = box, click = point. No mode switch: a box is what you want for anything large
// and cluttered, points are for small things and for carving one object out of a group,
// and the gesture that produces each is already unambiguous.
const at = e => { const b = c.getBoundingClientRect();
  return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height]; };
let down = null;
c.addEventListener('contextmenu', e => e.preventDefault());
c.addEventListener('pointerdown', e => { down = at(e); c.setPointerCapture(e.pointerId); });
c.addEventListener('pointermove', e => {
  if (!down) return;
  const q = at(e);
  if (Math.hypot(q[0] - down[0], q[1] - down[1]) * img.width < 8) return;
  drag = [Math.min(down[0], q[0]), Math.min(down[1], q[1]),
          Math.max(down[0], q[0]), Math.max(down[1], q[1])];
  draw();
});
c.addEventListener('pointerup', e => {
  if (!down) return;
  if (drag) { box = drag; drag = null; }
  else pts.push([down[0], down[1], (e.button === 2 || e.shiftKey) ? 0 : 1]);
  down = null; draw(); predict();
});
$('undo').onclick = () => { pts.pop(); draw(); predict(); };
$('clear').onclick = () => { pts = []; box = null; draw(); predict(); };
$('nobox').onclick = () => { box = null; draw(); predict(); };
$('open').onchange = predict;
$('obj').onchange = e => load(e.target.value);
$('add').onclick = async () => {
  const name = prompt('name for the new object (kebab-case, e.g. "floor-lamp")');
  if (!name) return;
  const why = prompt('why does it need a mask? what does it hide?') || '';
  const front = prompt('what does it hide? space-separated names, or "shell"', 'shell') || 'shell';
  const r = await fetch('/create', { method: 'POST', body: JSON.stringify(
      { name, why, in_front_of: front.split(/\s+/).filter(Boolean) }) }).then(r => r.json());
  if (!r.ok) { $('warn').textContent = r.error; return; }
  spec.objects.push(r.object);
  $('obj').innerHTML = spec.objects.map(o => `<option>${o.name}</option>`).join('');
  $('obj').value = name; load(name);
  $('warn').textContent = `added ${name} — now click its points, then save`;
};
$('save').onclick = async () => {
  const r = await fetch('/save', { method: 'POST', body: JSON.stringify({
    name: cur.name, open_frame: $('open').checked,
    points: pts.filter(p => p[2]).map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]),
    negative: pts.filter(p => !p[2]).map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]),
    box,
  }) }).then(r => r.json());
  $('warn').textContent = r.ok ? `saved ${cur.name} → objects.json` : r.error;
  if (r.ok) { delete cur.polygons; delete cur.mask; cur.points = r.points; cur.negative = r.negative;
               cur.box = r.box; }
};
addEventListener('keydown', e => {
  if (e.key === 'u') $('undo').click();
  if (e.key === 'c') $('clear').click();
  if (e.key === 's') $('save').click();
});

(async () => {
  spec = await fetch('/objects').then(r => r.json());
  $('obj').innerHTML = spec.objects.map(o => `<option>${o.name}</option>`).join('');
  img.onload = () => { c.width = img.width; c.height = img.height; load($('obj').value); };
  img.src = '/master.png';
})();
</script>
"""


class Picker(BaseHTTPRequestHandler):
    # set on the class before serve_forever
    color: np.ndarray
    seg: object
    spec_path: Path

    def log_message(self, *a):  # one line per click is noise, not information
        pass

    def _send(self, code, ctype, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj):
        self._send(200, "application/json", json.dumps(obj).encode())

    def do_GET(self):
        if self.path == "/":
            return self._send(200, "text/html; charset=utf-8", PAGE.encode())
        if self.path == "/master.png":
            ok, buf = cv2.imencode(".png", self.color)
            return self._send(200, "image/png", buf.tobytes())
        if self.path == "/objects":
            return self._send(200, "application/json", self.spec_path.read_bytes())
        self._send(404, "text/plain", b"no")

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"] or 0)))
        if self.path == "/predict":
            return self._json(self.predict(body))
        if self.path == "/save":
            return self._json(self.save(body))
        if self.path == "/create":
            return self._json(self.create(body))
        self._send(404, "text/plain", b"no")

    def predict(self, body):
        h, w = self.color.shape[:2]
        pts = body["points"]
        pos = [(p[0], p[1]) for p in pts if p[2]]
        neg = [(p[0], p[1]) for p in pts if not p[2]]
        box = body.get("box")
        if not pos and not box:
            return {"mask": "", "score": 0.0, "area": 0.0, "filled": 0, "matted": 0}
        mask, score = self.seg.predict(pos, neg, box)

        # Exactly what segment.py will do with the same points, so what you see here is
        # what ships. An enclosed hole is a defect in a solid object and correct in a
        # see-through one; only the flag tells them apart. See-through objects also get
        # the matting pass, because that is where SAM's blobbing actually shows.
        filled = matted = 0
        if body.get("open_frame"):
            before = int((mask > 0).sum())
            mask = refine_matte(self.color, mask, device=self.seg.device)
            matted = int((mask > 0).sum()) - before
        else:
            closed = fill_holes(mask)
            filled = int((closed > 0).sum() - (mask > 0).sum())
            mask = closed

        sel = mask > 0
        # Translucent fill, opaque outline: the fill shows what is claimed, the outline
        # is where a mask is actually right or wrong.
        rgba = np.zeros((h, w, 4), np.uint8)
        rgba[sel] = (60, 60, 255, 105)
        edge = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT,
                                cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
        rgba[edge > 0] = (80, 255, 255, 255)
        ok, buf = cv2.imencode(".png", rgba)
        return {"mask": "data:image/png;base64," + base64.b64encode(buf).decode(),
                "score": score, "area": 100.0 * sel.mean(),
                "filled": filled, "matted": matted}

    def create(self, body):
        """Append a new object with no points yet.

        objects.json starts as `{"objects": []}` and grows one entry per thing that hides
        another thing. Only a human can answer that question and `in_front_of`, so both are
        asked for here; the points are then clicked in the normal loop. Nothing bootstraps
        this file from a detector - an automatic segmenter would happily mask the keyboard,
        which hides nothing and must not become a layer.
        """
        name = (body.get("name") or "").strip()
        if not name:
            return {"ok": False, "error": "a name is required"}
        spec = json.loads(self.spec_path.read_text())
        spec.setdefault("objects", [])
        if any(o["name"] == name for o in spec["objects"]):
            return {"ok": False, "error": f"{name} already exists"}
        obj = {"name": name, "why": body.get("why", ""),
               "points": [], "in_front_of": body.get("in_front_of") or ["shell"]}
        spec["objects"].append(obj)
        self.spec_path.write_text(json.dumps(spec, indent=2) + "\n")
        print(f"  created {name}")
        return {"ok": True, "object": obj}

    def save(self, body):
        """Rewrite one object's prompts in place, leaving every other key alone.

        Surgical rather than json.dump of the whole file: objects.json carries the
        `_comment` block and a `why` on every entry, and those are the reasoning this
        pipeline is held together by. A round-trip through a dict would keep them but
        reflow the whole file into one diff, which hides the one line that changed.
        """
        text = self.spec_path.read_text()
        spec = json.loads(text)
        obj = next((o for o in spec["objects"] if o["name"] == body["name"]), None)
        if obj is None:
            return {"ok": False, "error": f"no object named {body['name']}"}
        if not body["points"] and not body.get("box"):
            return {"ok": False, "error": "need at least one positive point, or a box"}

        obj.pop("points", None)
        if body["points"]:
            obj["points"] = body["points"]
        obj.pop("box", None)
        if body.get("box"):
            obj["box"] = [round(v, 4) for v in body["box"]]
        obj.pop("negative", None)
        if body["negative"]:
            obj["negative"] = body["negative"]
        obj.pop("polygons", None)          # points, polygons and a painted mask
        obj.pop("mask", None)              # are alternatives, never merged
        if body["open_frame"]:
            obj["open_frame"] = True
        else:
            obj.pop("open_frame", None)

        self.spec_path.write_text(json.dumps(spec, indent=2) + "\n")
        print(f"  saved {body['name']}: {len(body['points'])} positive, "
              f"{len(body['negative'])} negative"
              + (", box" if body.get("box") else ""))
        return {"ok": True, "points": body["points"], "negative": body["negative"],
                "box": obj.get("box")}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--color", required=True, type=Path, help="colour master")
    ap.add_argument("--objects", required=True, type=Path, help="objects.json")
    ap.add_argument("--model", default="sam2.1-large",
                    help=f"one of {sorted(MODELS)}; pass the same one to segment.py")
    ap.add_argument("--device", default="auto", choices=["auto", "mps", "cuda", "cpu"])
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()

    color = cv2.imread(str(args.color), cv2.IMREAD_COLOR)
    if color is None:
        raise SystemExit(f"could not read {args.color}")
    if not args.objects.exists():
        args.objects.write_text('{\n  "objects": []\n}\n')
        print(f"created {args.objects}")

    # The encoder runs once here, so every click afterwards is only the mask decoder -
    # milliseconds instead of a full forward pass. Same class segment.py uses.
    print("encoding the image, once...")
    Picker.seg = Segmenter(color, args.model, args.device)
    Picker.color = color
    Picker.spec_path = args.objects
    print(f"\n  http://localhost:{args.port}   (ctrl-c to stop)\n")
    HTTPServer(("127.0.0.1", args.port), Picker).serve_forever()


if __name__ == "__main__":
    main()
