/**
 * The room, drawn as a stack of depth-displaced meshes so the camera can move through it
 * in real 3D.
 *
 * The idea in one paragraph: we know what the room looks like from exactly one viewpoint
 * (the art) and roughly how far away every pixel is (the depth map). That is enough to
 * rebuild a coarse 3D surface — push each pixel out along the ray it was seen through,
 * as far as its depth says — and then photograph *that* from a camera we can move. At the
 * original viewpoint the reconstruction reprojects to the original image exactly, so the
 * room at rest is pixel-perfect; move even slightly and you get true parallax, because
 * near things really are nearer.
 *
 * This is why the push cannot be faked with a CSS scale. A scale moves every pixel by the
 * same proportion. Here the foreground plant sweeps across the frame while the far corner
 * barely shifts, which is the entire difference between "zooming a photo" and "moving
 * through a room".
 *
 * **Why a stack and not one mesh.** One mesh has a triangle bridging every silhouette —
 * chair to floor, printer to window — and the moment the camera moves sideways those
 * triangles stretch into smears. The smear is not a bug in the parameters: lateral motion
 * is simultaneously the only source of real parallax and the only thing that uncovers
 * surface the art never painted. You cannot have one without the other. So the art is cut
 * offline into layers, the surface behind each one is painted in, and each layer becomes
 * its own displaced mesh with its own colour, depth and alpha. Drawn back to front, a
 * moving camera reveals painted background instead of stretched foreground.
 *
 * Layers are **occlusion rank**, not depth range: layer N is "hides something in layer
 * N-1". The 3D printer reads *farther* than the cabinet it stands on, so grouping by
 * depth value would put them in one layer and smear across the join. See docs/PIPELINE.md.
 *
 * That describes the *layered* build, where the cut is authored offline and this file just
 * draws what it is given. Under the SHARP build there are two layers instead of three and
 * the cut happens here, per quad, from the depth jump (`edgeCut` below) — the plates come
 * from a Gaussian reconstruction that renders what stands behind the frontmost surface,
 * so no mask or fill is involved. Both are supported; src/data/scene.ts selects one, and
 * everything below is common to them. See docs/SCENE-SHARP.md.
 *
 * The renderer takes the layers as given and must not exceed the excursion budget they
 * were painted for (`--margin` in tools/inpaint.py, which scales with the plate: 64px at
 * its 1024px reference, so 344px on the 5504px master). Move further than
 * that and the camera reaches past the painted band to a hard alpha edge.
 *
 * Deliberately not Three.js: this is one quad grid, three draw calls, six textures and a
 * 4x4 matrix. See CLAUDE.md.
 */

import type { WeatherLook } from '../data/weather';
import { lookAt, mat4, multiply, perspective, type Mat4, type Vec3 } from './mat4';
import { fitZoom } from './roomGeometry';

/** One layer's plates. Colour carries alpha; layer 0's is opaque and may be RGB. */
export interface RoomLayerSource {
  colorSrc: string;
  depthSrc: string;
  /**
   * Disparity jump across one mesh quad above which this layer's geometry is discarded
   * rather than stretched. 1 (the default) draws everything.
   *
   * Per layer, because the two builds want opposite answers from it. The layered build
   * cuts offline, so every layer is already free of internal silhouettes and this stays
   * off. The SHARP build makes it the entire occlusion model: its front layer tears at
   * every depth step and its back layer never tears, because a hole in the backstop is a
   * hole in the room. See src/data/scene.ts.
   */
  edgeCut?: number;
}

export interface RoomRendererOptions {
  canvas: HTMLCanvasElement;
  /** Back to front. Index 0 is the shell — opaque, uncut, and never absent. */
  layers: RoomLayerSource[];
  /**
   * Vertical field of view in degrees, the nearest content's distance (disparity 1.0) and
   * the farthest content's (disparity 0.0).
   *
   * Required, and deliberately so. These used to default to 1 / 6 / 42, which silently
   * agreed with `ROOM_TUNING` until `ROOM_TUNING` started coming from the scene — after
   * which the rig placed aim points in a 98m room while the renderer reconstructed a 6m
   * one, and every silhouette stretched. The same three numbers living in two places with
   * no link between them is the bug; a required argument is the fix. Pass `SCENE`'s.
   */
  fovDeg: number;
  nearZ: number;
  farZ: number;
  /**
   * Mesh columns; rows follow from the image aspect. This is the resolution the room's
   * *geometry* is sampled at, and it is the first thing to raise if a push looks melted:
   * a grid coarser than the art means the camera magnifies triangles, not detail. One
   * vertex per texel of the master is the useful ceiling — finer cannot resolve more.
   * Three draw calls either way, but the vertex count is per layer, so this is the main
   * cost dial on weak GPUs.
   */
  gridCols?: number;
  /**
   * Extend the mesh past the edges of the art, in uv units. Textures are CLAMP_TO_EDGE,
   * so the border pixels smear outward and fill the wedge that would otherwise show as
   * black when the camera moves off-axis. Cheap, and invisible if kept small.
   */
  overscan?: number;
  /**
   * Called at the top of every frame with the milliseconds since the last one, before the
   * view-projection is rebuilt — so whatever it writes to `camera` is what gets drawn.
   *
   * This exists so the site has exactly *one* rAF. CLAUDE.md rule 1 puts the ambient tier
   * (idle drift, cursor parallax, dust) "inside its single rAF" precisely so that stopping
   * the renderer stops all of it; a second loop alongside would keep running in a hidden
   * tab and survive a focus state mounting. Camera logic is that loop's first client.
   */
  onBeforeFrame?(dtMs: number): void;
}

export interface Camera {
  eye: [number, number, number];
  center: [number, number, number];
}

export interface RoomRenderer {
  /** Mutable. Write to it from your animation logic; the next frame picks it up. */
  readonly camera: Camera;
  /** The camera position that reproduces the original artwork exactly. */
  readonly home: Readonly<Camera>;
  /** Retune how far the room extends. This is the main feel dial. */
  setDepthRange(nearZ: number, farZ: number): void;
  /** Retune the assumed lens. Changes reconstruction and projection together. */
  setFov(fovDeg: number): void;
  /**
   * Threshold on the per-quad depth jump above which geometry is discarded instead of
   * drawn. 1.0 draws everything. With no `layer`, sets every layer.
   *
   * What this is for depends on the build. Under the layered build the cut happened
   * offline, so every layer arrives free of internal silhouettes and this is only a
   * diagnostic: if it has to be turned down to make the scene look right, a layer is
   * missing from objects.json. Under the SHARP build it is the occlusion model itself —
   * the front layer tears here and the back layer shows through. See src/data/scene.ts.
   */
  setEdgeCut(threshold: number, layer?: number): void;
  /** Draw only layer `i`, or all of them again with -1. Diagnostic. */
  setSoloLayer(index: number): void;
  /**
   * Crossfade to a colour variant from `SCENE.variants`, or to the base art with null.
   *
   * Optional because it is a property of the splat build: variants there are one extra
   * raster over shared geometry, so the room can be relit without reloading it. The mesh
   * builds have no equivalent — their colour is baked into per-layer plates — and rather
   * than give them a no-op that silently does nothing, the method is simply absent and
   * callers check for it.
   */
  setVariant?(name: string | null): void;
  /**
   * What is falling in the yard, or null for nothing — see src/data/weather.ts.
   *
   * Optional for the same reason `setVariant` is, and a stronger one: the pass is composited
   * into the splat draw order at a measured depth, and a mesh build has no draw order to cut.
   * Callers check for it rather than being handed a no-op.
   */
  setWeather?(look: WeatherLook | null): void;
  readonly layerCount: number;
  /**
   * Aspect of the art itself, which is what the reconstruction is fixed to. Anything that
   * has to line up with the painting needs this rather than the canvas's aspect — see
   * roomGeometry.ts.
   */
  readonly imageAspect: number;
  start(): void;
  stop(): void;
  destroy(): void;
  readonly canvas: HTMLCanvasElement;
}

const VERT = `#version 300 es
precision highp float;

in vec2 aUv;                 // 0..1 across the image
in float aDepth;             // <0 = read the depth map; >=0 = use this disparity instead

uniform sampler2D uDepth;
uniform float uTanHalfFov;   // tan(fovY / 2) of the *reference* camera
uniform float uImageAspect;  // aspect of the art, which fixes the reconstruction
uniform float uInvNear;      // 1 / nearZ
uniform float uInvFar;       // 1 / farZ
uniform mat4 uViewProj;

out vec2 vUv;

void main() {
  // The depth map is disparity: near = 1.0, far = 0.0 (see art/README.md).
  //
  // A vertex on a quad that bridges a silhouette overrides it, and sits at the near side's
  // depth instead. This costs nothing at rest: at the home camera every vertex lies on the
  // ray through its own pixel, so moving it along that ray does not move where it lands —
  // the frame is still the master, pixel for pixel. It is only once the camera moves that
  // the choice matters, and then the flap travels with the foreground it belongs to and
  // the gap opens behind it, where the layer below is waiting. See buildMesh below.
  float disparity = aDepth < 0.0 ? texture(uDepth, aUv).r : aDepth;

  // Interpolate in *inverse* depth, not depth. Parallax is proportional to 1/z, so
  // interpolating 1/z is what makes displacement linear in the value the model gave us.
  // Lerping z directly would crush all the near detail into a sliver of the range.
  float z = 1.0 / mix(uInvFar, uInvNear, disparity);

  // Ray through this pixel from the reference camera (at the origin, looking down -Z),
  // scaled out to the distance the depth map claims. This is the reconstruction.
  vec2 ndc = aUv * 2.0 - 1.0;
  vec3 world = vec3(ndc.x * uTanHalfFov * uImageAspect,
                    ndc.y * uTanHalfFov,
                    -1.0) * z;

  gl_Position = uViewProj * vec4(world, 1.0);
  vUv = aUv;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uColor;
uniform float uAlphaCut;   // below this a fragment is not drawn at all
out vec4 outColor;
void main() {
  vec4 c = texture(uColor, vUv);
  // Blend the edge, don't cut it. The plates now carry hard 0/255 alpha, so LINEAR
  // filtering turns each silhouette into a ramp exactly one texel wide — and since the
  // canvas is always larger than the 1024px plate, every silhouette is magnified and a
  // binary cut shows as a visible staircase. Sampling the ramp instead is free
  // antialiasing at the one moment it is needed.
  //
  // The threshold survives only to keep fully-empty fragments from writing depth. It has
  // to stay low: it is no longer choosing where the silhouette is, and raising it back
  // toward 0.5 just reinstates the staircase.
  if (c.a < uAlphaCut) discard;
  outColor = vec4(c.rgb, c.a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

function texture(gl: WebGL2RenderingContext, img: HTMLImageElement, mipmap: boolean): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  // CLAMP_TO_EDGE matters: at the frame edge the mesh must not wrap around and sample
  // the opposite side of the room.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mipmap) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  return tex;
}

/**
 * The depth map resampled onto the mesh's own vertices, on the CPU.
 *
 * Sampled exactly where the vertex shader samples it, including the overscan's clamp, so
 * the CPU and the GPU agree about where the surface is. Nearest-neighbour on purpose:
 * smoothing would average across the silhouettes this exists to find. Drawn at grid size
 * rather than the plate's, so the readback is ~1024x572 and not 5504x3072.
 */
function sampleDepthGrid(
  img: HTMLImageElement, cols: number, rows: number, overscan: number,
): Float32Array {
  const c = document.createElement('canvas');
  c.width = cols; c.height = rows;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, cols, rows);
  const px = ctx.getImageData(0, 0, cols, rows).data;
  const span = 1 + 2 * overscan;
  const out = new Float32Array(cols * rows);
  for (let y = 0, i = 0; y < rows; y++) {
    // The depth texture is uploaded with UNPACK_FLIP_Y, so uv.y 0 is the image's bottom.
    const v = -overscan + span * (y / (rows - 1));
    const sy = Math.round(Math.min(1, Math.max(0, 1 - v)) * (rows - 1));
    for (let x = 0; x < cols; x++, i++) {
      const u = -overscan + span * (x / (cols - 1));
      const sx = Math.round(Math.min(1, Math.max(0, u)) * (cols - 1));
      out[i] = px[(sy * cols + sx) * 4] / 255;
    }
  }
  return out;
}

/**
 * The mesh for one layer: a vertex grid, with the quads that bridge a silhouette snapped
 * forward onto the near side instead of spanning the gap.
 *
 * **Why not simply drop them.** That was the previous answer and it is worse than doing
 * nothing. A bridging quad is not wrong at home — at the reference camera every vertex is
 * on the ray through its own pixel, so the reconstruction reprojects to the master exactly
 * whatever depth it is given, and the stretch exists only once the camera moves. Removing
 * the quad therefore removes something correct: measured on this master, 1.81% of quads
 * dropped left **2.9% of the frame as an open hole with the camera perfectly still**, and
 * what showed through was the half-resolution peeled plate, outlining every object in the
 * room with a seven-pixel comb. The artifact looked like a tearing bug and was a hole.
 *
 * Snapping is the fix that costs nothing at rest and does the right thing in motion: the
 * flap sits at the foreground's depth, so it travels with the object it belongs to, and
 * the gap opens *behind* it — which is where the layer below is waiting. The quad keeps
 * its own texture coordinates, so at rest it is still the master's own pixels.
 *
 * Before this, the tear was a per-vertex `vStretch` varying discarded in the fragment
 * shader, which interpolated across the quad and left a sliver of stretched foreground
 * welded to the background side: a comb of spikes along every silhouette that grew with
 * camera motion. A quad bridges or it does not; there is no partial answer.
 *
 * Cheap to do here because it is view-independent — the depth map and the mesh are both
 * static, so which quads bridge never changes.
 *
 * Vertices are (u, v, depthOverride), the override being negative wherever the depth map
 * should be read normally.
 */
function buildMesh(
  depth: Float32Array, cols: number, rows: number, overscan: number, cut: number,
) {
  const span = 1 + 2 * overscan;
  const uvAt = (x: number, y: number): [number, number] => [
    -overscan + span * (x / (cols - 1)),
    -overscan + span * (y / (rows - 1)),
  ];

  const verts: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const [u, v] = uvAt(x, y);
      verts.push(u, v, -1);
    }
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let n = 0;
  let flaps = 0;
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const a = y * cols + x, b = a + 1, c = a + cols, d = c + 1;
      let q0 = a, q1 = b, q2 = c, q3 = d;
      if (cut < 1) {
        const da = depth[a], db = depth[b], dc = depth[c], dd = depth[d];
        const hi = Math.max(da, db, dc, dd);
        if (hi - Math.min(da, db, dc, dd) > cut) {
          // Four fresh vertices, same texture coordinates, all at the near depth.
          const base = verts.length / 3;
          for (const [vx, vy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
            const [u, v] = uvAt(vx, vy);
            verts.push(u, v, hi);
          }
          q0 = base; q1 = base + 1; q2 = base + 2; q3 = base + 3;
          flaps++;
        }
      }
      indices[n++] = q0; indices[n++] = q2; indices[n++] = q1;
      indices[n++] = q1; indices[n++] = q2; indices[n++] = q3;
    }
  }
  return { verts: new Float32Array(verts), indices, flaps };
}

/**
 * Returns null when WebGL2 is unavailable. Callers must handle that by leaving the
 * static image in place — degrade explicitly, never silently (CLAUDE.md).
 */
export async function createRoomRenderer(opts: RoomRendererOptions): Promise<RoomRenderer | null> {
  const { canvas } = opts;
  if (opts.layers.length === 0) throw new Error('roomRenderer: no layers');
  let fovY = (opts.fovDeg * Math.PI) / 180;
  let nearZ = opts.nearZ;
  let farZ = opts.farZ;
  const cols = opts.gridCols ?? 1024;
  // 0.06 was not enough: a deep push with any lateral component walked the camera off
  // the mesh and showed the void as a black wedge down one side of the frame.
  const overscan = opts.overscan ?? 0.18;

  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true });
  if (!gl) return null;

  const images = await Promise.all(
    opts.layers.map((l) => Promise.all([loadImage(l.colorSrc), loadImage(l.depthSrc)])),
  );
  // The shell fixes the frame; every other plate is a cut-out of the same master and is
  // required to match it, so a mismatch is an export bug worth failing loudly on.
  const imageAspect = images[0][0].naturalWidth / images[0][0].naturalHeight;
  const rows = Math.max(2, Math.round(cols / imageAspect));

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  // A mesh per layer, because each layer's silhouettes are its own. The vertex grid is
  // identical between them; only the snapped-forward flaps differ.
  const aUvLoc = gl.getAttribLocation(program, 'aUv');
  const aDepthLoc = gl.getAttribLocation(program, 'aDepth');
  const cuts = opts.layers.map((l) => l.edgeCut ?? 1.0);
  const grids = images.map(([, d]) => sampleDepthGrid(d, cols, rows, overscan));
  const meshes = grids.map(() => ({
    vao: gl.createVertexArray()!,
    vbo: gl.createBuffer()!,
    ibo: gl.createBuffer()!,
    count: 0,
  }));
  function rebuild(i: number) {
    const m = meshes[i];
    const { verts, indices, flaps } = buildMesh(grids[i], cols, rows, overscan, cuts[i]);
    m.count = indices.length;
    gl!.bindVertexArray(m.vao);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, m.vbo);
    gl!.bufferData(gl!.ARRAY_BUFFER, verts, gl!.STATIC_DRAW);
    gl!.enableVertexAttribArray(aUvLoc);
    gl!.vertexAttribPointer(aUvLoc, 2, gl!.FLOAT, false, 12, 0);
    gl!.enableVertexAttribArray(aDepthLoc);
    gl!.vertexAttribPointer(aDepthLoc, 1, gl!.FLOAT, false, 12, 8);
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, m.ibo);
    gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, indices, gl!.STATIC_DRAW);
    gl!.bindVertexArray(null);
    return flaps;
  }
  for (let i = 0; i < grids.length; i++) rebuild(i);

  // flipY so uv (0,0) is the bottom-left of the image, matching NDC's y-up.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  // Alpha stays straight, not premultiplied, to match the classic blend func below.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const textures = images.map(([c, d]) => ({
    color: texture(gl, c, true),
    depth: texture(gl, d, false),
  }));

  const u = {
    color: gl.getUniformLocation(program, 'uColor'),
    depth: gl.getUniformLocation(program, 'uDepth'),
    tanHalfFov: gl.getUniformLocation(program, 'uTanHalfFov'),
    imageAspect: gl.getUniformLocation(program, 'uImageAspect'),
    invNear: gl.getUniformLocation(program, 'uInvNear'),
    invFar: gl.getUniformLocation(program, 'uInvFar'),
    viewProj: gl.getUniformLocation(program, 'uViewProj'),
    alphaCut: gl.getUniformLocation(program, 'uAlphaCut'),
  };
  gl.uniform1i(u.color, 0);
  gl.uniform1i(u.depth, 1);
  gl.uniform1f(u.tanHalfFov, Math.tan(fovY / 2));
  gl.uniform1f(u.imageAspect, imageAspect);
  gl.uniform1f(u.invNear, 1 / nearZ);
  gl.uniform1f(u.invFar, 1 / farZ);
  gl.uniform1f(u.alphaCut, 0.05);
  gl.enable(gl.DEPTH_TEST);
  // Back to front, so ordinary source-over blending is already in the right order and no
  // per-fragment sorting is needed. Depth testing still earns its keep *within* a layer,
  // where an off-axis camera can fold a displaced heightfield over itself — but the
  // depth buffer is cleared between layers, because it must never arbitrate BETWEEN
  // them. Layers are occlusion rank precisely because depth values give the wrong
  // order: the printer reads farther than the cabinet it stands on, so letting its
  // fragments z-test against the cabinet's fill punches the fill through the printer.
  // Measured at 6% of the frame before the per-layer clear.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Home is the reference viewpoint: origin, looking down -Z. At exactly this position
  // the mesh reprojects to the original artwork, pixel for pixel.
  const home: Camera = { eye: [0, 0, 0], center: [0, 0, -1] };
  const camera: Camera = { eye: [...home.eye], center: [...home.center] };

  const proj: Mat4 = mat4();
  const view: Mat4 = mat4();
  const viewProj: Mat4 = mat4();
  const UP: Vec3 = [0, 1, 0];

  let raf = 0;
  let running = false;
  let solo = -1;
  let lastFrame = 0;
  // `running` says whether a frame is queued; `paused` says whether anyone *wants* frames.
  // They differ while the tab is hidden, and keeping them apart is the whole point: a
  // focus state that calls stop() must stay stopped across a tab switch, which a single
  // flag cannot express (the visibility handler would restart it on the way back).
  let paused = true;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl!.viewport(0, 0, canvas.width, canvas.height);
  }

  function frame(now: number) {
    const dt = lastFrame === 0 ? 16.7 : Math.min(now - lastFrame, 100);
    lastFrame = now;
    opts.onBeforeFrame?.(dt);
    resize();
    const canvasAspect = canvas.width / canvas.height;
    // Reconstruction is fixed to the art's own frame; the canvas showing a different aspect
    // has to be fitted to it — see the header of roomGeometry.ts, whose `fit()` this must
    // keep agreeing with pixel-for-pixel, since that is what places the hotspot buttons over
    // this same render. Solving for the vertical fov that pins the *horizontal* fov to the
    // art's own width crops top/bottom on a canvas wider than the art and letterboxes
    // top/bottom on one narrower; dividing that horizontal half-angle by `fitZoom` is the
    // zoom, which narrows the horizontal fov so the art is drawn wider than the canvas and
    // fills the height instead. One formula, all three cases.
    const zoom = fitZoom(canvas.width, canvas.height, imageAspect);
    const fovYProj = 2 * Math.atan((Math.tan(fovY / 2) * (imageAspect / zoom)) / canvasAspect);
    perspective(proj, fovYProj, canvasAspect, 0.05, farZ * 4);
    lookAt(view, camera.eye, camera.center, UP);
    multiply(viewProj, proj, view);
    gl!.uniformMatrix4fv(u.viewProj, false, viewProj);

    // `--room-bg` (tokens.css), as a literal — a shader can't read a CSS custom property.
    // Only visible as the letterbox mat on a canvas narrower than the master (see
    // roomGeometry.ts); it used to be black, which read as broken rather than as a frame
    // around the picture, and disagreed with `.room__still`'s own background besides.
    gl!.clearColor(0.949, 0.914, 0.863, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    for (let i = 0; i < textures.length; i++) {
      if (solo >= 0 && solo !== i) continue;
      // Painter's order decides what covers what across layers; z only within one.
      gl!.clear(gl!.DEPTH_BUFFER_BIT);
      gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, textures[i].color);
      gl!.activeTexture(gl!.TEXTURE1); gl!.bindTexture(gl!.TEXTURE_2D, textures[i].depth);
      gl!.bindVertexArray(meshes[i].vao);
      gl!.drawElements(gl!.TRIANGLES, meshes[i].count, gl!.UNSIGNED_INT, 0);
    }

    if (running) raf = requestAnimationFrame(frame);
  }

  // Rule 1's baseline obligation: never burn GPU on a tab nobody is looking at. Note this
  // only ever touches `running` — a hidden tab suspends the loop, it does not un-pause one
  // the caller deliberately stopped.
  function onVisibility() {
    if (document.hidden) halt();
    else if (!paused) run();
  }
  document.addEventListener('visibilitychange', onVisibility);

  function run() {
    if (running || document.hidden) return;
    running = true;
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
  }

  function halt() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function start() {
    paused = false;
    run();
  }

  function stop() {
    paused = true;
    halt();
  }

  return {
    camera,
    home,
    canvas,
    layerCount: textures.length,
    imageAspect,
    setDepthRange(n, f) {
      nearZ = n; farZ = f;
      gl!.uniform1f(u.invNear, 1 / nearZ);
      gl!.uniform1f(u.invFar, 1 / farZ);
    },
    setFov(deg) {
      fovY = (deg * Math.PI) / 180;
      gl!.uniform1f(u.tanHalfFov, Math.tan(fovY / 2));
    },
    setEdgeCut(threshold, layer) {
      // Rebuilds a mesh rather than setting a uniform. A few milliseconds, and only ever
      // from the dev harness's slider — the site sets it once, from the scene.
      const targets = layer === undefined ? cuts.map((_, i) => i) : [layer];
      for (const i of targets) {
        if (i < 0 || i >= cuts.length || cuts[i] === threshold) continue;
        cuts[i] = threshold;
        rebuild(i);
      }
    },
    setSoloLayer(index) {
      solo = index;
    },
    start,
    stop,
    destroy() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const t of textures) {
        gl!.deleteTexture(t.color);
        gl!.deleteTexture(t.depth);
      }
      for (const m of meshes) {
        gl!.deleteBuffer(m.vbo);
        gl!.deleteBuffer(m.ibo);
        gl!.deleteVertexArray(m.vao);
      }
      gl!.deleteProgram(program);
    },
  };
}
