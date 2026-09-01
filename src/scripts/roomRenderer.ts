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
 * The renderer takes the layers as given and must not exceed the excursion budget they
 * were painted for (`--margin` in tools/inpaint.py, which scales with the plate: 64px at
 * its 1024px reference, so 344px on the 5504px master). Move further than
 * that and the camera reaches past the painted band to a hard alpha edge.
 *
 * Deliberately not Three.js: this is one quad grid, three draw calls, six textures and a
 * 4x4 matrix. See CLAUDE.md.
 */

import { lookAt, mat4, multiply, perspective, type Mat4, type Vec3 } from './mat4';

/** One layer's plates. Colour carries alpha; layer 0's is opaque and may be RGB. */
export interface RoomLayerSource {
  colorSrc: string;
  depthSrc: string;
}

export interface RoomRendererOptions {
  canvas: HTMLCanvasElement;
  /** Back to front. Index 0 is the shell — opaque, uncut, and never absent. */
  layers: RoomLayerSource[];
  /** Vertical field of view, degrees. Also the lens the art is assumed to have been shot with. */
  fovDeg?: number;
  /** World-space distance of the *nearest* content (disparity 1.0). */
  nearZ?: number;
  /** World-space distance of the *farthest* content (disparity 0.0). */
  farZ?: number;
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
   * drawn. 1.0 draws everything. Cutting layers offline is what removes the smears this
   * used to fight, so it now defaults to off and stays only as a diagnostic — if it has
   * to be turned down to make a scene look right, a layer is missing from objects.json.
   */
  setEdgeCut(threshold: number): void;
  /** Draw only layer `i`, or all of them again with -1. Diagnostic. */
  setSoloLayer(index: number): void;
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

in vec2 aUv;                 // 0..1 across the image; the only attribute we need

uniform sampler2D uDepth;
uniform float uTanHalfFov;   // tan(fovY / 2) of the *reference* camera
uniform float uImageAspect;  // aspect of the art, which fixes the reconstruction
uniform float uInvNear;      // 1 / nearZ
uniform float uInvFar;       // 1 / farZ
uniform mat4 uViewProj;
uniform vec2 uGridStep;      // one mesh quad, in uv units

out vec2 vUv;
out float vStretch;          // local depth discontinuity, 0 = flat surface

void main() {
  // The depth map is disparity: near = 1.0, far = 0.0 (see art/README.md).
  float disparity = texture(uDepth, aUv).r;

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

  // How much does depth jump across one quad from here? Within a layer this should now
  // be small everywhere — that is what the offline cut buys — so it survives as a
  // diagnostic rather than as the fix it once had to be.
  float dx = texture(uDepth, aUv + vec2(uGridStep.x, 0.0)).r - disparity;
  float dy = texture(uDepth, aUv + vec2(0.0, uGridStep.y)).r - disparity;
  vStretch = max(abs(dx), abs(dy));

  gl_Position = uViewProj * vec4(world, 1.0);
  vUv = aUv;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in float vStretch;
uniform sampler2D uColor;
uniform float uEdgeCut;    // 1.0 = draw everything; lower = cut on depth jump
uniform float uAlphaCut;   // below this a fragment is not drawn at all
out vec4 outColor;
void main() {
  if (vStretch > uEdgeCut) discard;
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

/** A flat grid of `cols x rows` vertices over -overscan .. 1+overscan, as a triangle mesh. */
function buildGrid(cols: number, rows: number, overscan: number) {
  const span = 1 + 2 * overscan;
  const uvs = new Float32Array(cols * rows * 2);
  for (let y = 0, i = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      uvs[i++] = -overscan + span * (x / (cols - 1));
      uvs[i++] = -overscan + span * (y / (rows - 1));
    }
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  for (let y = 0, i = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const a = y * cols + x, b = a + 1, c = a + cols, d = c + 1;
      indices[i++] = a; indices[i++] = c; indices[i++] = b;
      indices[i++] = b; indices[i++] = c; indices[i++] = d;
    }
  }
  return { uvs, indices };
}

/**
 * Returns null when WebGL2 is unavailable. Callers must handle that by leaving the
 * static image in place — degrade explicitly, never silently (CLAUDE.md).
 */
export async function createRoomRenderer(opts: RoomRendererOptions): Promise<RoomRenderer | null> {
  const { canvas } = opts;
  if (opts.layers.length === 0) throw new Error('roomRenderer: no layers');
  let fovY = ((opts.fovDeg ?? 42) * Math.PI) / 180;
  let nearZ = opts.nearZ ?? 1.0;
  let farZ = opts.farZ ?? 6.0;
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

  const { uvs, indices } = buildGrid(cols, rows, overscan);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'aUv');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

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
    gridStep: gl.getUniformLocation(program, 'uGridStep'),
    edgeCut: gl.getUniformLocation(program, 'uEdgeCut'),
    alphaCut: gl.getUniformLocation(program, 'uAlphaCut'),
  };
  gl.uniform1i(u.color, 0);
  gl.uniform1i(u.depth, 1);
  gl.uniform1f(u.tanHalfFov, Math.tan(fovY / 2));
  gl.uniform1f(u.imageAspect, imageAspect);
  gl.uniform1f(u.invNear, 1 / nearZ);
  gl.uniform1f(u.invFar, 1 / farZ);
  const span = 1 + 2 * overscan;
  gl.uniform2f(u.gridStep, span / (cols - 1), span / (rows - 1));
  gl.uniform1f(u.edgeCut, 1.0);
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
    // Reconstruction is fixed to the art's own frame, so the canvas showing a different
    // aspect must *crop* the room rather than letterbox it. When the canvas is wider than
    // the art, narrow the vertical fov until the art's width exactly fills it; when it is
    // taller, the vertical fov already governs. This is `object-fit: cover` in fov terms.
    const fovYProj = canvasAspect > imageAspect
      ? 2 * Math.atan((Math.tan(fovY / 2) * imageAspect) / canvasAspect)
      : fovY;
    perspective(proj, fovYProj, canvasAspect, 0.05, farZ * 4);
    lookAt(view, camera.eye, camera.center, UP);
    multiply(viewProj, proj, view);
    gl!.uniformMatrix4fv(u.viewProj, false, viewProj);

    gl!.clearColor(0, 0, 0, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    for (let i = 0; i < textures.length; i++) {
      if (solo >= 0 && solo !== i) continue;
      // Painter's order decides what covers what across layers; z only within one.
      gl!.clear(gl!.DEPTH_BUFFER_BIT);
      gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, textures[i].color);
      gl!.activeTexture(gl!.TEXTURE1); gl!.bindTexture(gl!.TEXTURE_2D, textures[i].depth);
      gl!.drawElements(gl!.TRIANGLES, indices.length, gl!.UNSIGNED_INT, 0);
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
    setEdgeCut(threshold) {
      gl!.uniform1f(u.edgeCut, threshold);
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
      gl!.deleteBuffer(vbo);
      gl!.deleteBuffer(ibo);
      gl!.deleteVertexArray(vao);
      gl!.deleteProgram(program);
    },
  };
}
