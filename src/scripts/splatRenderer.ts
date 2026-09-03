/**
 * The room as 3D Gaussians, drawn straight.
 *
 * **Why this exists next to roomRenderer.ts.** A triangle mesh at a depth discontinuity
 * has exactly two options and both are wrong: bridge it, and the silhouette smears into
 * whatever is behind; tear it, and a hole opens with nothing to put in it. Everything the
 * layered build does — SAM masks, `in_front_of`, the peel order, LaMa — exists to
 * manufacture something to put in that hole. Gaussians have no connectivity, so they never
 * face the choice: under lateral motion the primitives simply move apart and the
 * disocclusion is filled by the ones SHARP predicted behind them. That is the whole reason
 * this file is shorter than the one it replaces.
 *
 * **What it gives up.** SHARP's grid is 768x768, so the room is reconstructed at ~7 master
 * pixels per splat against the master's own 5504. At the home camera that is ~2 screen px
 * per splat and reads as the painting; at the end of a push into the monitor it is ~9.5px.
 * That is affordable only because the push is 900ms long and `room.css` fades a 9px blur
 * and a dim over its second half — the veil and the artifact are the same size by the time
 * either is visible, and the panel takes over on the frame the camera stops. If that trade
 * ever stops holding, the dial is `travel` on the hotspot, not this file.
 *
 * The maths is the standard EWA splat projection and is lifted from the evaluation
 * prototype in art/build/sharp-eval/viewer.html, which is what Alex judged at full size.
 *
 * Interface-compatible with `RoomRenderer` so the rig, the stage manager and the dev
 * harness cannot tell which build is mounted. src/data/scene.ts chooses.
 */

import type { Camera, RoomRenderer } from './roomRenderer';

/** The manifest `tools/sharp_splat_bake.py` writes beside the rasters. */
export interface SplatManifest {
  /**
   * Content hash of the four rasters, written by the bake. Appended to their URLs so a
   * re-bake cannot be served from a browser cache holding the previous one.
   */
  version: string;
  /** Adler-32 of the geom raster as written. See `loadRaster` for what it is guarding. */
  geomAdler32?: number;
  grid: number;
  layers: number;
  count: number;
  width: number;
  height: number;
  fx: number;
  cx: number;
  cy: number;
  dispLo: number;
  dispHi: number;
  offsetRange: number;
  scaleLogLo: number;
  scaleLogHi: number;
  nearZ: number;
  farZ: number;
  fovDeg: number;
  maxLateralM: number;
  maxPushM: number;
}

export interface SplatRendererOptions {
  canvas: HTMLCanvasElement;
  /** Directory + basename the bake wrote, e.g. `/art/room-day-summer`. */
  assetPrefix: string;
  /**
   * Quad half-extent in standard deviations. 2 is the usual choice: beyond it the Gaussian
   * is under 1.4% of its peak and the extra fragments are shaded for nothing.
   */
  sigma?: number;
  /**
   * Added to the diagonal of the projected 2D covariance, in px^2. Guarantees every splat
   * covers at least ~half a pixel so the field cannot develop sampling holes when the
   * camera magnifies it. The prototype's 0.3 is the value Alex looked at.
   */
  dilate?: number;
  /** See RoomRendererOptions.onBeforeFrame — the site has exactly one rAF and this is it. */
  onBeforeFrame?(dtMs: number): void;
}

/**
 * Splat index -> texel. Kept in one place because the bake, the sort and the shader all
 * have to agree, and a disagreement shows as a room made of confetti.
 *
 * Comments *inside* this template literal are string content, not TypeScript comments, so
 * they survive minification and ship in the bundle. Keep them about the maths and out of
 * the provenance — everything a reader needs about where this reconstruction came from is
 * in the TS comments above, which esbuild strips.
 */
const VERT = `#version 300 es
precision highp float;
precision highp int;

uniform highp sampler2D uGeom;   // RG offset (companded), BA disparity (15-bit, A biased)
uniform highp sampler2D uColor;  // RGB colour, A opacity
uniform highp sampler2D uShape;  // RGB per-axis scale, log-quantised
uniform highp sampler2D uQuat;   // RGBA rotation quaternion

uniform vec3 uCam;            // camera eye, in the reconstruction's own frame
uniform mat3 uView;           // world -> camera rotation
uniform vec2 uFocal, uCenter, uViewport;
uniform float uDilate, uSigma;

// Everything needed to undo the bake's quantisation. All from the manifest.
uniform int   uGrid;
uniform vec2  uPlate;          // master width, height
uniform vec3  uIntrin;         // fx, cx, cy of the master
uniform vec2  uDisp;           // dispLo, dispHi
uniform float uOffsetRange;
uniform vec2  uScaleLog;       // scaleLogLo, scaleLogHi

in vec2 aCorner;
in uint aIndex;

out vec4 vColor;
out vec3 vConic;
out vec2 vCenterPx;

ivec2 texelOf(uint i) { return ivec2(int(i) % uGrid, int(i) / uGrid); }

// Inverse of the bake's compand(): precision concentrated near zero.
float uncompand(float byte01) {
  float t = (byte01 * 255.0 - 127.5) / 127.5;
  return sign(t) * t * t * uOffsetRange;
}

void main() {
  ivec2 tx = texelOf(aIndex);
  vec4 geom = texelFetch(uGeom, tx, 0);

  // ---- position: the splat's own grid cell, plus the offset it was predicted at ------
  // 15-bit disparity: high 8 bits in B, low 7 biased into the top half of A. Disparity
  // rather than depth because parallax goes as 1/z, so the bits land where motion is
  // visible instead of on the far wall; the bias is why an image decoder cannot destroy
  // it. See the bake and loadRaster.
  float d15 = (floor(geom.b * 255.0 + 0.5) * 128.0
               + floor(geom.a * 255.0 + 0.5) - 128.0) / 32767.0;
  float z = 1.0 / mix(uDisp.x, uDisp.y, d15);

  int cell = int(aIndex) % (uGrid * uGrid);
  vec2 cellPx = (vec2(float(cell % uGrid), float(cell / uGrid)) + 0.5)
                / float(uGrid) * uPlate;
  vec2 px = cellPx + vec2(uncompand(geom.r), uncompand(geom.g));

  // Master pixel + depth -> a point in the room. This is the reconstruction, and it is
  // exact: the bake stored where the splat actually projects, not where its cell is.
  vec3 world = vec3((px.x - uIntrin.y) / uIntrin.x * z,
                    (px.y - uIntrin.z) / uIntrin.x * z,
                    z);
  vec3 p = uView * (world - uCam);
  if (p.z < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // The bake zeroes the opacity of near-invisible Gaussians rather than removing them, so
  // the grid the rasters are addressed by stays intact. 2.00% of the scene, and reading
  // that here rather than after the projection drops their quads before they are
  // rasterised — the fragment shader would only have discarded them one pixel at a time.
  vColor = texelFetch(uColor, tx, 0);
  if (vColor.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // ---- 3D covariance, rebuilt from scale and rotation --------------------------------
  // Done here rather than precomputed on the CPU at load: precomputing needs two RGBA32F
  // textures (37MB of GPU memory for this scene) and a 1.2M-iteration JS loop before the
  // first frame can draw. The GPU rebuilds it per vertex for free.
  vec3 s = exp(mix(vec3(uScaleLog.x), vec3(uScaleLog.y), texelFetch(uShape, tx, 0).rgb));
  vec4 q = normalize(texelFetch(uQuat, tx, 0) * (255.0 / 127.0) - (128.0 / 127.0));
  float w = q.x, x = q.y, y = q.z, zz = q.w;
  mat3 R = mat3(
    1.0 - 2.0 * (y * y + zz * zz), 2.0 * (x * y + w * zz),       2.0 * (x * zz - w * y),
    2.0 * (x * y - w * zz),        1.0 - 2.0 * (x * x + zz * zz), 2.0 * (y * zz + w * x),
    2.0 * (x * zz + w * y),        2.0 * (y * zz - w * x),       1.0 - 2.0 * (x * x + y * y));
  mat3 M = uView * R;                       // world scale axes, expressed in view space
  mat3 Vrk = M * mat3(s.x * s.x, 0.0, 0.0,
                      0.0, s.y * s.y, 0.0,
                      0.0, 0.0, s.z * s.z) * transpose(M);

  // ---- project it ---------------------------------------------------------------------
  float iz = 1.0 / p.z;
  mat3 J = mat3(uFocal.x * iz, 0.0, 0.0,
                0.0, uFocal.y * iz, 0.0,
                -uFocal.x * p.x * iz * iz, -uFocal.y * p.y * iz * iz, 0.0);
  // J is built in true (row) form here, so the projection is J*Vrk*J^T directly. The
  // reference shaders build J transposed and write transpose(T)*Vrk*T instead.
  mat3 C = J * Vrk * transpose(J);

  // uDilate stops a splat falling below a pixel, but widening a Gaussian without dimming
  // it also raises the total light it emits, which promotes a sub-pixel splat into a small
  // hard dot at full alpha. Mip-Splatting's fix: scale alpha by the ratio of the
  // determinants, the factor that keeps integrated energy unchanged under the widening.
  //
  // Worth 0.32dB on this scene, so it is a correctness tidy rather than a rescue. It was
  // once believed to be the cause of the speckle over the whole frame; it was not. That
  // was the geom raster losing its disparity to a premultiply round trip on upload — see
  // loadRaster, which is where the fix actually lives.
  float detOrig = C[0][0] * C[1][1] - C[0][1] * C[0][1];
  float a = C[0][0] + uDilate, b = C[0][1], c = C[1][1] + uDilate;
  float det = a * c - b * b;
  if (det <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float compensation = sqrt(max(detOrig, 0.0) / det);
  vConic = vec3(c, -b, a) / det;

  float mid = 0.5 * (a + c), rad = sqrt(max(mid * mid - det, 0.0));
  float l1 = mid + rad, l2 = max(mid - rad, 0.1);
  if (uSigma * sqrt(l1) > 1024.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // Oriented quad. An axis-aligned square of half-extent = the major axis costs ~2.4x the
  // fragments the ellipse needs at the elongations here, and far worse at 45 degrees.
  vec2 e1 = (abs(b) < 1e-9) ? (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0))
                            : normalize(vec2(b, l1 - a));
  vec2 major = e1 * (uSigma * sqrt(l1));
  vec2 minor = vec2(-e1.y, e1.x) * (uSigma * sqrt(l2));
  vec2 centerPx = vec2(uFocal.x * p.x * iz + uCenter.x, uFocal.y * p.y * iz + uCenter.y);
  vec2 corner = centerPx + aCorner.x * major + aCorner.y * minor;

  vCenterPx = centerPx;
  vColor.a *= compensation;
  gl_Position = vec4(2.0 * corner.x / uViewport.x - 1.0,
                     1.0 - 2.0 * corner.y / uViewport.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec4 vColor;
in vec3 vConic;
in vec2 vCenterPx;
uniform vec2 uViewport;
out vec4 outColor;
void main() {
  vec2 d = gl_FragCoord.xy - vec2(vCenterPx.x, uViewport.y - vCenterPx.y);
  d.y = -d.y;
  float power = -0.5 * (vConic.x * d.x * d.x + vConic.z * d.y * d.y) - vConic.y * d.x * d.y;
  if (power > 0.0) discard;
  float alpha = min(1.0, vColor.a * exp(power));
  if (alpha < 0.004) discard;
  outColor = vec4(vColor.rgb * alpha, alpha);   // premultiplied
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

/** A decoded raster, however it was decoded. */
interface Raster {
  width: number;
  height: number;
  /** Tightly packed RGBA, when the exact path was available. */
  bytes?: Uint8Array;
  bmp?: ImageBitmap;
  close(): void;
}

/**
 * Decode a raster without letting an image pipeline touch the bytes.
 *
 * Three of these four rasters are not pictures — they are quantised geometry — so every
 * step an image decoder is entitled to take is a corruption here, and each one fails
 * silently.
 *
 *  * **Colour management.** A transform applied to `geom` rewrites positions. That is what
 *    `colorSpaceConversion: 'none'` is for.
 *  * **Premultiplied alpha.** `premultiplyAlpha: 'none'` is honoured, but a decoder is free
 *    to reach it by storing the image premultiplied and dividing alpha back out, rounding
 *    to 8 bits each way. In `geom` the alpha channel is the *low byte of the disparity*, so
 *    a splat whose low byte is small would have its other three channels scaled up and
 *    clamped. **The bake's alpha bias is what closes this**: every alpha is >= 128, so the
 *    round trip costs at most one LSB. That fix is in the data, and it protects any
 *    decoder — which is what makes the plain path below safe.
 *
 * **This used to try WebCodecs `ImageDecoder` first, and that was wrong.** The reasoning
 * was that it hands back the decoded plane with no alpha step, which is true and which is
 * also not the only thing that can happen to a buffer of numbers pretending to be a
 * picture. `ImageDecoder` may decode a WebP into a **YUV** `VideoFrame`;
 * `copyTo({ format: 'RGBA' })` then converts, and chroma is subsampled. Alpha survives
 * exactly — so `verifyGeomRaster`'s bias check stayed silent — while R, G and B are
 * averaged with their neighbours. R and G are the sub-pixel offsets, B is the disparity's
 * high byte, and in `shape` and `quat` the same channels carry scale and rotation. So the
 * decoder applies a **low-pass filter to the geometry**: splats drift toward their
 * neighbours, take on their neighbours' sizes and orientations, and the room comes back
 * soft and subtly wrong with nothing logged anywhere.
 *
 * Reproduced directly in the harness: `createImageBitmap` clean, `ImageDecoder` artifacted,
 * same bytes, same shader, same canvas size. `verifyGeomRaster` is no longer the only
 * guard — see the checksum in `createSplatRenderer`.
 */
async function loadRaster(src: string): Promise<Raster> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`failed to load ${src}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const bmp = await createImageBitmap(new Blob([buf]), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  return { width: bmp.width, height: bmp.height, bmp, close: () => bmp.close() };
}

function upload(gl: WebGL2RenderingContext, unit: number, r: Raster): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  if (r.bytes) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, r.width, r.height, 0,
                  gl.RGBA, gl.UNSIGNED_BYTE, r.bytes);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, r.bmp!);
  }
  // NEAREST throughout: these are attribute tables addressed by texelFetch, and any
  // filtering would blend one splat's rotation into its neighbour's.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * The geometry raster's own bytes, read back off the GPU.
 *
 * **Not via a 2D canvas.** `getImageData` round-trips through premultiplied alpha: the
 * canvas stores colour premultiplied and hands it back divided out again, so a pixel with
 * a small alpha loses most of the precision in its other three channels. For a picture
 * that is invisible. Here the alpha channel is the *low byte of the disparity*, so every
 * splat whose low byte happens to be small came back with a corrupted high byte — which
 * poisons the sort keys, blends the room in the wrong order, and renders as a washed-out
 * average with dark specks where the order inverted.
 *
 * `readPixels` off a framebuffer has no such step and returns the texels exactly.
 */
function readTexture(
  gl: WebGL2RenderingContext, tex: WebGLTexture, w: number, h: number,
): Uint8Array {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const out = new Uint8Array(w * h * 4);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  return out;
}

/**
 * Assert the geometry raster survived the trip from the file to the GPU.
 *
 * The bake biases the disparity's low 7 bits into the top half of the alpha channel, so
 * every texel of `geom` must have A >= 128. Nothing that rewrites those bytes preserves
 * that: a pass that touches alpha breaks it directly, and one that only divides alpha out
 * of RGB is what this build already lost a session to. One exact test, no reference copy
 * and no statistics — worth a pass over bytes the sort has already paid to read.
 */
function adler32(bytes: Uint8Array, len: number): number {
  let a = 1, b = 0;
  // Blocked so the modulo runs once per 5552 bytes instead of once per byte; that is the
  // largest run for which the accumulators cannot overflow a 32-bit int.
  for (let i = 0; i < len;) {
    const end = Math.min(i + 5552, len);
    for (; i < end; i++) { a += bytes[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function verifyGeomRaster(bytes: Uint8Array, count: number): void {
  for (let i = 0; i < count; i++) {
    if (bytes[i * 4 + 3] < 128) {
      console.error(
        'splat: the geom raster lost its alpha bias between the file and the GPU, so every '
        + 'splat\'s disparity is suspect. Expect bits of the room at the wrong depth.',
      );
      return;
    }
  }
}

export async function createSplatRenderer(
  opts: SplatRendererOptions,
): Promise<RoomRenderer | null> {
  const { canvas, assetPrefix } = opts;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false });
  if (!gl) return null;

  // The four rasters carry stable filenames and Astro serves `public/` verbatim, with no
  // content fingerprint in the path — so a returning browser will happily keep whatever it
  // fetched the first time, forever, across every re-bake. That is not a theoretical
  // hazard: every stage this bake has ever *lost* was a low-pass filter (the coverage fit
  // alone cost 3.70dB), so a stale cache does not fail loudly, it just serves a softer
  // room than the one on disk. `?v=` is the bake's own content hash of the four files.
  //
  // The manifest is the one thing that has to be fresh for the rest to follow, so it is
  // revalidated on every load. It is ~500 bytes; a conditional request for it costs
  // nothing next to the 8.9MB it points at.
  const m: SplatManifest = await (
    await fetch(`${assetPrefix}-splat.json`, { cache: 'no-cache' })
  ).json();
  const v = m.version ? `?v=${m.version}` : '';
  const [geomRaster, colorRaster, shapeRaster, quatRaster] = await Promise.all(
    ['geom', 'color', 'shape', 'quat']
      .map((n) => loadRaster(`${assetPrefix}-splat-${n}.webp${v}`)),
  );

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  const textures = [
    upload(gl, 0, geomRaster), upload(gl, 1, colorRaster),
    upload(gl, 2, shapeRaster), upload(gl, 3, quatRaster),
  ];
  (['uGeom', 'uColor', 'uShape', 'uQuat'] as const).forEach((n, i) =>
    gl.uniform1i(gl.getUniformLocation(program, n), i));

  const N = m.count;
  const u = Object.fromEntries(
    ['uCam', 'uView', 'uFocal', 'uCenter', 'uViewport', 'uDilate', 'uSigma', 'uGrid',
     'uPlate', 'uIntrin', 'uDisp', 'uOffsetRange', 'uScaleLog']
      .map((n) => [n, gl.getUniformLocation(program, n)]),
  ) as Record<string, WebGLUniformLocation | null>;

  gl.uniform1i(u.uGrid, m.grid);
  gl.uniform2f(u.uPlate, m.width, m.height);
  gl.uniform3f(u.uIntrin, m.fx, m.cx, m.cy);
  gl.uniform2f(u.uDisp, m.dispLo, m.dispHi);
  gl.uniform1f(u.uOffsetRange, m.offsetRange);
  gl.uniform2f(u.uScaleLog, m.scaleLogLo, m.scaleLogHi);
  gl.uniform1f(u.uSigma, opts.sigma ?? 2.0);
  gl.uniform1f(u.uDilate, opts.dilate ?? 0.3);

  // ---- instanced unit quad, one instance per splat -----------------------------------
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const cornerBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const locCorner = gl.getAttribLocation(program, 'aCorner');
  gl.enableVertexAttribArray(locCorner);
  gl.vertexAttribPointer(locCorner, 2, gl.FLOAT, false, 0, 0);

  const orderBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, orderBuf);
  const locIndex = gl.getAttribLocation(program, 'aIndex');
  gl.enableVertexAttribArray(locIndex);
  gl.vertexAttribIPointer(locIndex, 1, gl.UNSIGNED_INT, 0, 0);
  gl.vertexAttribDivisor(locIndex, 1);

  // ---- the draw order, computed once ---------------------------------------------------
  //
  // Splats must be blended back to front, and a general splat renderer re-sorts every
  // frame because its camera can go anywhere. Ours cannot: the rig only ever translates the
  // eye, never rotates it (cameraRig.ts keeps `center` at `eye + (0,0,-1)`), so a splat's
  // view depth is its world z minus the eye's, and *every* splat shifts by the same amount.
  // Neither the 2.5m push nor the ambient sweep can reorder anything. So this runs once, at
  // load, and never again: no worker, no GPU radix sort, no per-frame readback. It does not
  // depend on the ambient amplitude, which is free to change.
  const bytes = readTexture(gl, textures[0], geomRaster.width, geomRaster.height);
  verifyGeomRaster(bytes, N);
  // The general detector. The alpha-bias check above catches only what touches alpha, and a
  // decoder was found that leaves alpha perfect while averaging every other channel with its
  // neighbours (see loadRaster). This compares the bytes that actually reached the GPU
  // against the bake's own Adler-32 of what it wrote — position-weighted on purpose, since
  // neighbour-averaging is close to sum-preserving and a plain sum would not see it.
  if (m.geomAdler32 !== undefined) {
    const got = adler32(bytes, N * 4);
    if (got !== m.geomAdler32) {
      console.error(
        `splat: the geom raster was rewritten between the file and the GPU `
        + `(adler32 ${got}, expected ${m.geomAdler32}). Every splat's position, depth, size `
        + `and rotation is suspect; the room will render soft and subtly wrong.`,
      );
    }
  }
  const depth = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const d15 = (bytes[i * 4 + 2] * 128 + bytes[i * 4 + 3] - 128) / 32767;
    depth[i] = 1 / (m.dispLo + d15 * (m.dispHi - m.dispLo));
  }
  const order = new Uint32Array(N);
  {
    // 16-bit counting sort on view depth, far to near. O(n), ~15ms for 1.2M.
    const BUCKETS = 65536;
    const counts = new Uint32Array(BUCKETS);
    const key = new Uint16Array(N);
    const zmin = m.nearZ, k = (BUCKETS - 1) / Math.max(m.farZ - zmin, 1e-6);
    for (let i = 0; i < N; i++) {
      const q = (BUCKETS - 1) - ((depth[i] - zmin) * k) | 0;
      key[i] = q < 0 ? 0 : q > BUCKETS - 1 ? BUCKETS - 1 : q;
      counts[key[i]]++;
    }
    let sum = 0;
    for (let i = 0; i < BUCKETS; i++) { const c = counts[i]; counts[i] = sum; sum += c; }
    for (let i = 0; i < N; i++) order[counts[key[i]]++] = i;
  }
  // Drawn count, and which layer if one is soloed. Solo is the diagnostic that tells a
  // problem in SHARP's visible surface from one in its hidden layer: the two carry the
  // same scene, so an artifact that survives `L0` alone is in the reconstruction of what
  // you can see, and one that only appears with both is layer B showing through.
  let drawn = order;
  gl.bindBuffer(gl.ARRAY_BUFFER, orderBuf);
  gl.bufferData(gl.ARRAY_BUFFER, order, gl.STATIC_DRAW);

  const perLayer = m.grid * m.grid;
  function solo(index: number) {
    drawn = index < 0
      ? order
      : order.filter((i) => Math.floor(i / perLayer) === index);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, orderBuf);
    gl!.bufferData(gl!.ARRAY_BUFFER, drawn, gl!.STATIC_DRAW);
  }

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  // Premultiplied source-over, which is what the fragment shader emits.
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 1);

  // ---- camera ---------------------------------------------------------------------------
  // Same convention as roomRenderer and roomGeometry: origin, looking down -Z, +Y up. The
  // reconstruction's own frame is the other handedness (+Z forward, +Y down), so the
  // conversion happens here, once, rather than in the bake — the world the rig aims into
  // stays the world imagePointToWorld describes.
  const home: Camera = { eye: [0, 0, 0], center: [0, 0, -1] };
  const camera: Camera = { eye: [...home.eye], center: [...home.center] };
  const imageAspect = m.width / m.height;

  const view = new Float32Array(9);
  function updateView() {
    const fx = camera.center[0] - camera.eye[0];
    const fy = -(camera.center[1] - camera.eye[1]);
    const fz = -(camera.center[2] - camera.eye[2]);
    const fl = Math.hypot(fx, fy, fz) || 1;
    const f: [number, number, number] = [fx / fl, fy / fl, fz / fl];
    // "Down" in the reconstruction's frame. Right = down x forward, which is the identity
    // basis when the camera is home — the frame then *is* the PLY's.
    const d: [number, number, number] = [0, 1, 0];
    const r: [number, number, number] = [
      d[1] * f[2] - d[2] * f[1], d[2] * f[0] - d[0] * f[2], d[0] * f[1] - d[1] * f[0],
    ];
    const rl = Math.hypot(...r) || 1;
    r[0] /= rl; r[1] /= rl; r[2] /= rl;
    const up: [number, number, number] = [
      f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0],
    ];
    // Rows are the basis; mat3 is column-major, so transpose on the way in.
    view.set([r[0], up[0], f[0], r[1], up[1], f[1], r[2], up[2], f[2]]);
  }

  let raf = 0;
  let last = 0;
  let running = false;

  function frame(now: number) {
    if (!running) return;
    const dt = last ? now - last : 16.7;
    last = now;
    opts.onBeforeFrame?.(dt);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

    // `object-fit: cover`, in the reconstruction's own pixel units — the same crop
    // roomGeometry.cover() computes, so hotspot rects still land on their objects.
    const s = Math.max(w / m.width, h / m.height);
    gl!.uniform2f(u.uFocal, m.fx * s, m.fx * s);
    gl!.uniform2f(u.uCenter, m.cx * s + (w - m.width * s) / 2, m.cy * s + (h - m.height * s) / 2);
    gl!.uniform2f(u.uViewport, w, h);

    updateView();
    gl!.uniformMatrix3fv(u.uView, false, view);
    gl!.uniform3f(u.uCam, camera.eye[0], -camera.eye[1], -camera.eye[2]);

    // Re-establish everything this draw depends on, every frame.
    //
    // It used to be set once at construction and assumed to survive, which is true only
    // while this renderer is the sole owner of the context. It is not guaranteed to be:
    // `getContext('webgl2')` returns the *same* context for the life of a canvas element,
    // and this function is async — it awaits a manifest and four rasters before it binds a
    // program, uploads to texture units 0-3 and fills a VAO. So two overlapping creations
    // on one canvas (a dev-server hot reload landing mid-load, an island remounting) do all
    // of that against shared global state, in whatever order the fetches happen to resolve.
    // The loser draws with the winner's texture bindings and, worse, with the winner's
    // `orderBuf` in its VAO — the wrong back-to-front order, which in an alpha-composited
    // splat field is not a crash but a wash: a soft, slightly wrong room with no error
    // anywhere. Ten calls a frame is nothing next to 1.2M instances, and it makes the
    // renderer independent of whatever else has touched the context.
    gl!.useProgram(program);
    gl!.bindVertexArray(vao);
    for (let i = 0; i < textures.length; i++) {
      gl!.activeTexture(gl!.TEXTURE0 + i);
      gl!.bindTexture(gl!.TEXTURE_2D, textures[i]);
    }
    gl!.disable(gl!.DEPTH_TEST);
    gl!.enable(gl!.BLEND);
    gl!.blendFuncSeparate(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA, gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);

    gl!.viewport(0, 0, w, h);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.drawArraysInstanced(gl!.TRIANGLE_STRIP, 0, 4, drawn.length);
    raf = requestAnimationFrame(frame);
  }

  const renderer: RoomRenderer = {
    camera,
    home,
    imageAspect,
    canvas,
    layerCount: m.layers,
    // The three knobs below describe a *mesh* reconstruction, and this one is measured:
    // fov, near and far come out of the PLY's own intrinsics, so changing them would not
    // retune the room, it would describe a different room than the one that was captured.
    // Kept as no-ops so the dev harness and the rig do not need to know which build is up.
    setDepthRange() {},
    setFov() {},
    setEdgeCut() {},
    setSoloLayer(index: number) { solo(index); },
    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    destroy() {
      renderer.stop();
      textures.forEach((t) => gl!.deleteTexture(t));
      gl!.deleteBuffer(cornerBuf);
      gl!.deleteBuffer(orderBuf);
      gl!.deleteVertexArray(vao);
      gl!.deleteProgram(program);
      [geomRaster, colorRaster, shapeRaster, quatRaster].forEach((b) => b.close());
    },
  };
  return renderer;
}
