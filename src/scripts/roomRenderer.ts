/**
 * The room, drawn as a depth-displaced mesh so the camera can move through it in real 3D.
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
 * Deliberately not Three.js: this is one quad, one draw call, two textures and a 4x4
 * matrix. See CLAUDE.md.
 */

import { lookAt, mat4, multiply, perspective, type Mat4, type Vec3 } from './mat4';

export interface RoomRendererOptions {
  canvas: HTMLCanvasElement;
  colorSrc: string;
  depthSrc: string;
  /** Vertical field of view, degrees. Also the lens the art is assumed to have been shot with. */
  fovDeg?: number;
  /** World-space distance of the *nearest* content (disparity 1.0). */
  nearZ?: number;
  /** World-space distance of the *farthest* content (disparity 0.0). */
  farZ?: number;
  /**
   * Mesh columns; rows follow from the image aspect. This is the resolution at which
   * silhouettes are cut, so too low reads as wobbly, stair-stepped object outlines.
   * One draw call either way — 512 is ~290k triangles, which is nothing for a GPU.
   */
  gridCols?: number;
  /**
   * Extend the mesh past the edges of the art, in uv units. Textures are CLAMP_TO_EDGE,
   * so the border pixels smear outward and fill the wedge that would otherwise show as
   * black when the camera moves off-axis. Cheap, and invisible if kept small.
   */
  overscan?: number;
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
   * drawn. 1.0 draws everything (stretched triangles smear across disocclusions); lower
   * values cut them, leaving holes. Holes or smears — pick your poison per scene.
   */
  setEdgeCut(threshold: number): void;
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

  // How much does depth jump across one quad from here? A triangle spanning a silhouette
  // (chair against floor, feeder against fence) has a large value; a flat surface has
  // almost none. This is the signal that identifies the rubber-sheet triangles.
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
uniform float uEdgeCut;   // 1.0 = draw everything (smears); lower = cut the stretch
out vec4 outColor;
void main() {
  // Discard, rather than fade: a half-transparent smear still reads as a smear, and
  // blending would need back-to-front sorting we do not have.
  if (vStretch > uEdgeCut) discard;
  outColor = vec4(texture(uColor, vUv).rgb, 1.0);
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
  const { canvas, colorSrc, depthSrc } = opts;
  let fovY = ((opts.fovDeg ?? 42) * Math.PI) / 180;
  let nearZ = opts.nearZ ?? 1.0;
  let farZ = opts.farZ ?? 6.0;
  const cols = opts.gridCols ?? 512;
  const overscan = opts.overscan ?? 0.06;

  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true });
  if (!gl) return null;

  const [colorImg, depthImg] = await Promise.all([loadImage(colorSrc), loadImage(depthSrc)]);
  const imageAspect = colorImg.naturalWidth / colorImg.naturalHeight;
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
  const colorTex = texture(gl, colorImg, true);
  const depthTex = texture(gl, depthImg, false);

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
  };
  gl.uniform1i(u.color, 0);
  gl.uniform1i(u.depth, 1);
  gl.uniform1f(u.tanHalfFov, Math.tan(fovY / 2));
  gl.uniform1f(u.imageAspect, imageAspect);
  gl.uniform1f(u.invNear, 1 / nearZ);
  gl.uniform1f(u.invFar, 1 / farZ);
  const span = 1 + 2 * overscan;
  gl.uniform2f(u.gridStep, span / (cols - 1), span / (rows - 1));
  gl.uniform1f(u.edgeCut, 1.0);   // everything drawn until a caller says otherwise
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, colorTex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.enable(gl.DEPTH_TEST);

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

  function frame() {
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
    gl!.drawElements(gl!.TRIANGLES, indices.length, gl!.UNSIGNED_INT, 0);

    if (running) raf = requestAnimationFrame(frame);
  }

  // Rule 1's baseline obligation: never burn GPU on a tab nobody is looking at.
  function onVisibility() {
    if (document.hidden) stop();
    else if (!running) start();
  }
  document.addEventListener('visibilitychange', onVisibility);

  function start() {
    if (running || document.hidden) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  return {
    camera,
    home,
    canvas,
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
    start,
    stop,
    destroy() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      gl!.deleteTexture(colorTex);
      gl!.deleteTexture(depthTex);
      gl!.deleteBuffer(vbo);
      gl!.deleteBuffer(ibo);
      gl!.deleteVertexArray(vao);
      gl!.deleteProgram(program);
    },
  };
}
