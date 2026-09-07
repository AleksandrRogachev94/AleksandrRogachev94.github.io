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
  /**
   * Per-variant clear colour, linear 0-1 RGB, from the bake.
   *
   * Not decoration: every pixel no splat covers takes it, and lateral motion opens exactly
   * such pixels at every silhouette. A single hard-coded value meant a night room filled its
   * disocclusion holes with daylight cream. Absent for the base raster, which keeps
   * `DEFAULT_BG` so it agrees with `--room-bg` for the letterbox mat.
   */
  backgrounds?: Record<string, [number, number, number]>;
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
   * Fraction of the room's bytes that have arrived, 0..1, called as they stream in.
   *
   * The renderer is 8.9MB and cannot draw a single frame until all four rasters have
   * landed (they are one `Promise.all`), so without this the room is a blank rectangle for
   * as long as that takes. Never called if the server omits `Content-Length`.
   */
  onProgress?: (fraction: number) => void;
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
  /**
   * Ceiling on the drawing buffer, in device pixels.
   *
   * 3.2M is Alex's own judgement, transcribed: on a 1710x814 CSS window he put the lowest
   * acceptable render scale at 0.70-0.80 of dpr 2, and 0.75 of that window is 3.13M. Stated
   * as an area rather than as the scale he moved, so that the same verdict carries to a
   * window he did not test.
   *
   * The one lever that reduces cost without changing which splats are drawn or how they
   * compose — it can only cost sharpness, never coverage. It is worth having because the
   * field has far less resolution than a Retina buffer can show: SHARP's grid is 768x768
   * per layer, so at the home camera a splat is ~2 device px across at dpr 2. Above all it
   * bounds the damage on a 5K display, where dpr 2 asks for 4x the fragments of a laptop
   * for a reconstruction that has no more detail to give.
   *
   * A pixel budget rather than a dpr cap because the cost is the buffer's *area*, and dpr
   * alone does not determine that — a 5K monitor at dpr 2 and a laptop at dpr 2 differ by
   * 4x.
   */
  maxPixels?: number;
  /** See RoomRendererOptions.onBeforeFrame — the site has exactly one rAF and this is it. */
  onBeforeFrame?(dtMs: number): void;
  /**
   * Colour variant to open with, from `SCENE.variants` — or omitted for the day cloud.
   *
   * Passed at construction rather than set afterwards because a visitor arriving at
   * midnight should never see the day room first. Named here, the variant raster is fetched
   * in the same `Promise.all` as the other four and the room's first frame is already
   * night; set through `setVariant` later, it is fetched lazily, because most visitors
   * never touch the control and 1.2MB is not worth spending on a state they will not enter.
   */
  variant?: string;
}

/** `--room-bg` (tokens.css). The base raster's clear colour; see `setClear`. */
const DEFAULT_BG: readonly [number, number, number] = [0.949, 0.914, 0.863];

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
uniform highp sampler2D uColorB; // the variant being crossfaded to, same cloud
uniform float uMix;              // 0 = uColor, 1 = uColorB

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

// flat, because all four corners of a quad carry the same colour. An interpolated varying
// costs the tiler a gradient per component per triangle; a flat one is stored once from the
// provoking vertex. On a tile-based GPU drawing 2.4M triangles a frame, what the vertex
// stage hands to the fragment stage is bandwidth, and this scene has no other use for it.
flat out mediump vec4 vColor;
// The corner's position in the ellipse's own normalised frame: |vQuad| = 1 is the quad's
// edge. The one thing here that genuinely varies across the quad, and the reason this
// replaces a conic and a centre.
out mediump vec2 vQuad;

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
  // Every variant is baked off this same cloud and shares its opacity exactly - a variant
  // changes the light on a surface, never whether the surface is there - so the mix touches
  // colour only and the cull below is independent of it. The branch is on a uniform, so it
  // is coherent across every invocation and costs nothing at uMix 0, which is the steady
  // state: the second fetch happens only while a crossfade is actually running.
  vColor = texelFetch(uColor, tx, 0);
  if (uMix > 0.0) vColor.rgb = mix(vColor.rgb, texelFetch(uColorB, tx, 0).rgb, uMix);
  if (vColor.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float iz = 1.0 / p.z;
  vec2 centerPx = vec2(uFocal.x * p.x * iz + uCenter.x, uFocal.y * p.y * iz + uCenter.y);
  vec3 s = exp(mix(vec3(uScaleLog.x), vec3(uScaleLog.y), texelFetch(uShape, tx, 0).rgb));

  // ---- off-screen, cheaply ------------------------------------------------------------
  // The room is drawn width-locked to the master (see the uFocal/uCenter comment in
  // draw()), so a window that is not the master's 16:9 pushes one axis off-screen entirely
  // — at a 2.10 aspect that is 15% of the splats, every one of them taken through the
  // covariance rebuild and the projection before the clipper threw the quad away.
  //
  // A quad's half-extent is bounded without building the covariance at all: however the
  // ellipsoid is rotated, its projection cannot exceed its largest world axis, and the
  // dilation adds sqrt(uDilate). So this needs the scale — which is one fetch and is wanted
  // anyway — and not the rotation, which is the expensive half. Conservative, so nothing
  // that would have drawn a pixel is dropped.
  float cullRad = uSigma * (uFocal.x * max(max(s.x, s.y), s.z) * iz + sqrt(uDilate)) + 1.0;
  if (centerPx.x + cullRad < 0.0 || centerPx.x - cullRad > uViewport.x
      || centerPx.y + cullRad < 0.0 || centerPx.y - cullRad > uViewport.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;
  }

  // ---- 3D covariance, rebuilt from scale and rotation --------------------------------
  // Done here rather than precomputed on the CPU at load: precomputing needs two RGBA32F
  // textures (37MB of GPU memory for this scene) and a 1.2M-iteration JS loop before the
  // first frame can draw. The GPU rebuilds it per vertex for free.
  vec4 q = normalize(texelFetch(uQuat, tx, 0) * (255.0 / 127.0) - (128.0 / 127.0));
  float w = q.x, x = q.y, y = q.z, zz = q.w;
  mat3 R = mat3(
    1.0 - 2.0 * (y * y + zz * zz), 2.0 * (x * y + w * zz),       2.0 * (x * zz - w * y),
    2.0 * (x * y - w * zz),        1.0 - 2.0 * (x * x + zz * zz), 2.0 * (y * zz + w * x),
    2.0 * (x * zz + w * y),        2.0 * (y * zz - w * x),       1.0 - 2.0 * (x * x + y * y));
  mat3 M = uView * R;                       // world scale axes, expressed in view space
  // Vrk = M * diag(s^2) * M^T, written out for its six distinct entries instead of as two
  // mat3 products. It is symmetric by construction, so a general 3x3 multiply computes
  // three of the nine entries twice and the compiler cannot know that.
  // Mt[i] is the i-th ROW of M (a mat3 subscript selects a column), and Vrk_ij is
  // sum_k s2_k * M_ik * M_jk — a dot product of two rows weighted by s2.
  vec3 s2 = s * s;
  mat3 Mt = transpose(M);
  vec3 ms0 = Mt[0] * s2, ms1 = Mt[1] * s2, ms2 = Mt[2] * s2;
  float v00 = dot(ms0, Mt[0]), v01 = dot(ms0, Mt[1]), v02 = dot(ms0, Mt[2]);
  float v11 = dot(ms1, Mt[1]), v12 = dot(ms1, Mt[2]), v22 = dot(ms2, Mt[2]);

  // ---- project it ---------------------------------------------------------------------
  // Only the top-left 2x2 of J*Vrk*J^T is ever read, and J's bottom row is zero, so the
  // full 3x3 product computes a row and a column that nothing uses. Carrying J as its two
  // meaningful rows takes this from two mat3 products to eighteen multiplies.
  vec3 j0 = vec3(uFocal.x * iz, 0.0, -uFocal.x * p.x * iz * iz);
  vec3 j1 = vec3(0.0, uFocal.y * iz, -uFocal.y * p.y * iz * iz);
  vec3 r0 = vec3(dot(j0, vec3(v00, v01, v02)),
                 dot(j0, vec3(v01, v11, v12)),
                 dot(j0, vec3(v02, v12, v22)));
  vec3 r1 = vec3(dot(j1, vec3(v00, v01, v02)),
                 dot(j1, vec3(v01, v11, v12)),
                 dot(j1, vec3(v02, v12, v22)));
  mat2 C = mat2(dot(r0, j0), dot(r1, j0), dot(r0, j1), dot(r1, j1));

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

  float mid = 0.5 * (a + c), rad = sqrt(max(mid * mid - det, 0.0));
  float l1 = mid + rad, l2 = max(mid - rad, 1e-6);
  if (uSigma * sqrt(l1) > 1024.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // Oriented quad. An axis-aligned square of half-extent = the major axis costs ~2.4x the
  // fragments the ellipse needs at the elongations here, and far worse at 45 degrees.
  vec2 e1 = (abs(b) < 1e-9) ? (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0))
                            : normalize(vec2(b, l1 - a));
  // The quad is built on the covariance's own eigenvectors, so a corner at parameter
  // (u, v) sits at Mahalanobis distance^2 = uSigma^2 * (u*u + v*v) — the cross term
  // vanishes in the eigenbasis, and the eigenvalues cancel against the axis lengths. That
  // identity is what lets the fragment shader below drop the conic entirely and evaluate
  // one dot product on a value the rasteriser interpolates for free, instead of rebuilding
  // an offset from gl_FragCoord and running a full quadratic form on it. The old form
  // carried five interpolated floats to do that; this carries two.
  //
  // l2 is clamped away from zero so a degenerate needle cannot divide by it. ky is 1 in
  // every case that clamp does not fire, which with the default dilate of 0.3 is all of
  // them — adding uDilate to the diagonal raises both eigenvalues by uDilate.
  float l2c = max(l2, 0.1);
  float ky = sqrt(l2c / l2);
  vec2 major = e1 * (uSigma * sqrt(l1));
  vec2 minor = vec2(-e1.y, e1.x) * (uSigma * sqrt(l2c));
  vec2 corner = centerPx + aCorner.x * major + aCorner.y * minor;

  vQuad = vec2(aCorner.x, aCorner.y * ky);
  vColor.a *= compensation;
  gl_Position = vec4(2.0 * corner.x / uViewport.x - 1.0,
                     1.0 - 2.0 * corner.y / uViewport.y, 0.0, 1.0);
}`;

/**
 * mediump throughout, and one dot product.
 *
 * This shader runs tens of millions of times a frame — the field is ~1.2M quads over a
 * few million pixels — so it is the one place where precision and instruction count are
 * worth counting. Apple GPUs run mediump as fp16 at double the fp32 rate; desktop parts
 * promote it and lose nothing. Everything here is in range for it: vQuad is bounded by the
 * quad at +/-1, the exponent by -uSigma^2/2, and the colour was 8-bit to begin with.
 *
 * `1.0 - r2` is the same test the old `power > 0.0` was, before the exponential.
 */
const FRAG = `#version 300 es
precision mediump float;
flat in mediump vec4 vColor;
in mediump vec2 vQuad;
uniform mediump float uHalfSigma2;   // 0.5 * uSigma^2
out vec4 outColor;
void main() {
  float r2 = dot(vQuad, vQuad);
  if (r2 > 1.0) discard;
  float alpha = min(1.0, vColor.a * exp(-uHalfSigma2 * r2));
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
/** The rasters that are lookup tables rather than pictures. See `inflateTable`. */
const TABLES = new Set(['geom', 'shape', 'quat']);

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
/**
 * The three attribute tables do not come through an image decoder at all.
 *
 * They used to: lossless WebP, exact on disk, and it was still not enough. Safari applies a
 * colour transform on decode, ignoring `colorSpaceConversion: 'none'` above, and the files
 * carry no ICC chunk to strip — an untagged image is assumed sRGB and converted to the
 * *display's* profile, so there is nothing to pre-compensate for either. `/dev/splat` in
 * Safari reported `geom alpha bias intact` (a colour transform does not touch alpha)
 * together with `geom raster REWRITTEN in transit`, which is that signature and no other;
 * setting `UNPACK_COLORSPACE_CONVERSION_WEBGL` covers the upload and changed nothing,
 * because the damage is done at decode. R and G are sub-pixel offsets, B is the disparity's
 * high byte, and in `shape` and `quat` it is scale and rotation — so the transform is a
 * transform on the *geometry*, and it renders as a soft room with black speckle where the
 * field stops tiling.
 *
 * **Pictures go through the image decoder; tables do not.** `color` stays WebP, because it
 * really is a picture and colour-managing it is the browser doing its job.
 *
 * The file is `SPLT` + uint32 width + uint32 height + four planes, deflated. Planar because
 * the channels are unrelated quantities and interleaving puts four uncorrelated byte streams
 * under one entropy model: 8.69 MB over the three against 10.34 interleaved, and against
 * lossless WebP's 7.57 the +1.12 MB is what exactness costs. A browser with no
 * `DecompressionStream` throws here and gets the poster, the same ladder WebGL2 is on.
 */
async function inflateTable(buf: BlobPart): Promise<Raster> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('splat: no DecompressionStream, so the attribute tables cannot be read');
  }
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'));
  const blob = new Uint8Array(await new Response(stream).arrayBuffer());
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  if (dv.getUint32(0, false) !== 0x53504c54) {   // 'SPLT'
    throw new Error('splat: attribute table has no SPLT header');
  }
  const width = dv.getUint32(4, true);
  const height = dv.getUint32(8, true);
  const n = width * height;
  if (blob.byteLength !== 12 + n * 4) {
    throw new Error(`splat: attribute table is ${blob.byteLength} bytes, expected `
      + `${12 + n * 4} for ${width}x${height}`);
  }
  // Planar -> interleaved. ~1.2M iterations per table, a few ms, once at load.
  const bytes = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    bytes[i * 4] = blob[12 + i];
    bytes[i * 4 + 1] = blob[12 + n + i];
    bytes[i * 4 + 2] = blob[12 + 2 * n + i];
    bytes[i * 4 + 3] = blob[12 + 3 * n + i];
  }
  return { width, height, bytes, close: () => {} };
}

async function loadRaster(
  res: Response, onBytes?: (n: number) => void, table = false,
): Promise<Raster> {
  if (!res.ok) throw new Error(`failed to load ${res.url}: ${res.status}`);

  // Streamed rather than `res.arrayBuffer()` purely so the room can report how far along it
  // is. The bytes are concatenated and handed to exactly the same decoder as before — the
  // long comment above is about which decoder is allowed to touch these pixels, and this
  // changes nothing about that.
  //
  // `body` is absent on a few paths (mocked responses, very old Safari), so the
  // whole-buffer read stays as the fallback: no progress, same picture.
  // Typed as what it is for rather than as the union of what produces it. `Uint8Array` is
  // generic in its backing buffer, so a bare `Uint8Array` is `Uint8Array<ArrayBufferLike>`
  // — which admits `SharedArrayBuffer` and is therefore not a `BlobPart`. Neither branch
  // here can produce one; saying `BlobPart` states that, and keeps the constraint at the
  // declaration instead of casting it away at the call.
  let buf: BlobPart;
  if (onBytes && res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      onBytes(value.byteLength);
    }
    const joined = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { joined.set(c, at); at += c.byteLength; }
    buf = joined;
  } else {
    buf = await res.arrayBuffer();
  }

  if (table) return inflateTable(buf);

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
  // **The third flag, and the one this build was missing.** Its default is
  // BROWSER_DEFAULT_WEBGL, which lets the browser colour-manage the upload — and three of
  // these four rasters are quantised geometry, so a colour transform rewrites positions,
  // depths, sizes and rotations. Chrome leaves these alone and Safari on a wide-gamut
  // display does not: it reported `geom alpha bias intact` (a transform does not touch
  // alpha) together with `geom raster REWRITTEN in transit`, which is that signature and
  // no other. `colorSpaceConversion: 'none'` on createImageBitmap covers the decode; this
  // covers the upload, and both are needed.
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
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

  // **Headers first, then bodies.** `fetch` settles as soon as the response headers land,
  // so asking for all four up front costs no extra round trips and gives an exact byte
  // total *before* any progress is reported. Summing `Content-Length` as each body starts
  // instead would mean a denominator that grows while the bar is moving, which shows up as
  // a bar that slides backwards.
  //
  // Content-Length rather than a figure in the manifest: these are WebP, so nothing on the
  // wire re-compresses them and the header is exactly what the decoder will receive. A
  // server that omits it leaves `total` at 0, `onBytes` undefined, and the room simply
  // appears when it is ready — the poster underneath is what makes that acceptable.
  // A variant named at construction rides in this same batch and is uploaded *as* the
  // colour raster, rather than being faded in afterwards — there is nothing to fade from on
  // the first frame, and a visitor arriving at midnight must not watch the day room resolve
  // and then dissolve. The base raster is fetched anyway: it is what "back to day" fades to,
  // and skipping it would make the first toggle the slow one.
  const names = ['geom', 'color', 'shape', 'quat'];
  if (opts.variant) names.push(`color-${opts.variant}`);
  const responses = await Promise.all(
    names.map((n) => fetch(`${assetPrefix}-splat-${n}.${TABLES.has(n) ? 'bin' : 'webp'}${v}`)),
  );
  const total = responses.reduce(
    (n, r) => n + Number(r.headers.get('content-length') ?? 0), 0,
  );

  let seen = 0;
  const onBytes = total && opts.onProgress
    ? (n: number) => { seen += n; opts.onProgress!(Math.min(1, seen / total)); }
    : undefined;

  const [geomRaster, colorRaster, shapeRaster, quatRaster, variantRaster] =
    await Promise.all(responses.map((r, i) => loadRaster(r, onBytes, TABLES.has(names[i]))));

  // Decoding and upload still take a beat after the last byte lands, so this is the bar
  // reaching full, not the room being drawable. The caller's own completion is what says
  // the room can be shown.
  opts.onProgress?.(1);

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  // **Colour textures are keyed by variant, not by unit.** Each variant is uploaded once and
  // kept; the units are just which two the shader is currently blending. Unit 1 is what the
  // room is lit by now, unit 4 is what it is fading to, and `shown` — not the unit number —
  // is the answer to "which lighting is on screen".
  //
  // Opening on a variant means that variant *is* unit 1 from the first frame, with the day
  // raster parked as the thing "back to day" will fade to. With no variant loaded there is
  // nothing to fade to yet, so unit 4 shares unit 1's texture: `uMix` is 0 and the shader
  // never samples it, but a sampler still has to reference a complete texture for the draw
  // to be valid.
  // **`textures` is indexed by texture unit, and that is load-bearing.** `draw()` rebinds
  // every unit from this array on every frame — `activeTexture(TEXTURE0 + i)` for
  // `textures[i]` — so the index *is* the unit. Building it as a plain list in upload order
  // put shape in slot 1 and quat in slot 2, and the shader spent a frame reading quaternions
  // as log-quantised scale: the room came apart into radial spikes. Any binding done outside
  // this array lives exactly until the next frame.
  const textures: WebGLTexture[] = [];
  textures[0] = upload(gl, 0, geomRaster);
  textures[2] = upload(gl, 2, shapeRaster);
  textures[3] = upload(gl, 3, quatRaster);

  const colorTex = new Map<string | null, WebGLTexture>();
  colorTex.set(null, upload(gl, 1, colorRaster));
  if (variantRaster) colorTex.set(opts.variant!, upload(gl, 1, variantRaster));

  let shown: string | null = opts.variant ?? null;

  function bindColour(unit: 1 | 4, variant: string | null) {
    // Through the array, so the rebind in draw() agrees. Binding the unit directly here and
    // leaving the array alone is the bug above, one frame later.
    textures[unit] = colorTex.get(variant)!;
    gl!.activeTexture(gl!.TEXTURE0 + unit);
    gl!.bindTexture(gl!.TEXTURE_2D, textures[unit]);
  }
  bindColour(1, shown);
  bindColour(4, shown);

  /**
   * The clear colour follows whichever lighting is on screen, mixed the same way the colour
   * rasters are so a crossfade does not step.
   *
   * `DEFAULT_BG` is `--room-bg`, and the base raster deliberately keeps it: it is what the
   * letterbox mat has always been and what `.room__still` agrees with. A variant overrides
   * it with the median of its own visible layer, which is the least conspicuous thing a
   * disocclusion hole can be filled with.
   */
  function bgOf(variant: string | null): readonly [number, number, number] {
    return (variant && m.backgrounds?.[variant]) || DEFAULT_BG;
  }
  function setClear(from: string | null, to: string | null, t: number) {
    const a = bgOf(from);
    const b = bgOf(to);
    gl!.clearColor(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
                   a[2] + (b[2] - a[2]) * t, 1);
  }

  (['uGeom', 'uColor', 'uShape', 'uQuat', 'uColorB'] as const).forEach((n, i) =>
    gl.uniform1i(gl.getUniformLocation(program, n), i));

  const N = m.count;
  const u = Object.fromEntries(
    ['uCam', 'uView', 'uFocal', 'uCenter', 'uViewport', 'uDilate', 'uSigma', 'uGrid',
     'uPlate', 'uIntrin', 'uDisp', 'uOffsetRange', 'uScaleLog', 'uHalfSigma2', 'uMix']
      .map((n) => [n, gl.getUniformLocation(program, n)]),
  ) as Record<string, WebGLUniformLocation | null>;

  gl.uniform1f(u.uMix, 0);

  gl.uniform1i(u.uGrid, m.grid);
  gl.uniform2f(u.uPlate, m.width, m.height);
  gl.uniform3f(u.uIntrin, m.fx, m.cx, m.cy);
  gl.uniform2f(u.uDisp, m.dispLo, m.dispHi);
  gl.uniform1f(u.uOffsetRange, m.offsetRange);
  gl.uniform2f(u.uScaleLog, m.scaleLogLo, m.scaleLogHi);
  const sigma = opts.sigma ?? 2.0;
  gl.uniform1f(u.uSigma, sigma);
  gl.uniform1f(u.uHalfSigma2, 0.5 * sigma * sigma);
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
    dirty = true;
  }

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  // Premultiplied source-over, which is what the fragment shader emits.
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  // `--room-bg` (tokens.css), as a literal — a shader can't read a CSS custom property.
  //
  // **This is not only the letterbox mat, and believing that it was cost a long evening.**
  // It is what every pixel gets when no splat covers it, and the camera manufactures such
  // pixels every time it leaves centre: a disocclusion at a silhouette is a hole, and a hole
  // is this colour. At the home camera the field tiles completely, so it never shows and the
  // mat is genuinely the only place you see it — which is exactly why the assumption held
  // for as long as the room shipped one lighting state. Under a dark variant every hole the
  // camera opened was a daylight-cream patch. `setClear` keeps it on the variant.
  setClear(shown, shown, 0);

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

  /**
   * Draw when the picture would actually change, and never faster than 60Hz.
   *
   * The room is idle almost all the time — it is the top of a page people read — and its
   * ambient wander has periods of 21 and 15 seconds at an amplitude of 0.022, which crosses
   * the frame at about eleven device pixels a second. Redrawing 1.18M splats sixty times a
   * second to move them a fifth of a pixel is what makes a laptop warm on a page nobody is
   * touching.
   *
   * So the test is how far the camera has moved since the frame on screen, converted to
   * pixels at the nearest content — the worst case, since parallax goes as 1/z. Below
   * MOTION_EPS_PX there is nothing to see and the frame is skipped. This one rule covers
   * every case that used to need its own: drift settles around 28Hz, a moving cursor or a
   * push clears the threshold instantly and runs at the cap, and under
   * prefers-reduced-motion the rig zeroes both drift and parallax so the eye never leaves
   * home, the distance is exactly zero, and the renderer stops — which is what those
   * visitors asked for and what they were not getting.
   *
   * `dirty` is for everything that changes the image without moving the camera: the first
   * frame, a resize, a layer solo.
   *
   * The 60Hz cap is 3ms under the interval so vsync jitter cannot fall through it and halve
   * the rate by accident.
   */
  const MIN_FRAME_MS = 1000 / 60 - 3;
  const MOTION_EPS_PX = 0.4;
  let lastDrawAt = 0;
  const drawnEye: [number, number, number] = [0, 0, 0];
  let dirty = true;

  // ---- day/night crossfade -------------------------------------------------------------
  //
  // A dissolve rather than a cut, because nothing in the room *moves* between variants — the
  // same splats are simply lit differently — so a cut throws away the one thing that makes
  // the swap read as the light changing rather than as the page reloading.
  //
  // 900ms matches the hotspot push in cameraRig.ts. Under `prefers-reduced-motion` it snaps,
  // which is the same contract as every other transition here: the room still changes, it
  // just does not animate.
  const FADE_MS = 900;
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let mix = 0;
  let fadeTarget: string | null = null;
  let fadingTo = false;

  function stepCrossfade(dt: number) {
    if (!fadingTo) return;
    mix = Math.min(1, mix + dt / FADE_MS);
    // smoothstep: the linear ramp has a visible corner at both ends on a whole-frame
    // luminance change, which is exactly what this is.
    const eased = mix * mix * (3 - 2 * mix);
    gl!.uniform1f(u.uMix, eased);
    setClear(shown, fadeTarget, eased);
    if (mix >= 1) settleCrossfade();
  }

  /** The fade is over: promote the target to unit 1 and go back to a single texture fetch. */
  function settleCrossfade() {
    shown = fadeTarget;
    fadingTo = false;
    mix = 0;
    bindColour(1, shown);
    bindColour(4, shown);
    setClear(shown, shown, 0);
    gl!.uniform1f(u.uMix, 0);
  }

  async function setVariant(name: string | null) {
    const target = name ?? null;
    if (target === shown && !fadingTo) return;
    fadeTarget = target;

    if (!colorTex.has(target)) {
      // Lazily fetched, because most visitors never touch the control. `?v=` is the bake's
      // content hash, the same one the other rasters carry.
      // The base art is `-splat-color`, a variant is `-splat-color-<name>`. Unreachable for
      // null today — the base raster is always loaded at construction — but the URL has to
      // be right or the day case becomes `color-null.webp` the first time that changes.
      const suffix = target === null ? '' : `-${target}`;
      const res = await fetch(`${assetPrefix}-splat-color${suffix}.webp${v}`);
      if (!res.ok) return;                       // degrade to the lighting already on screen
      const raster = await loadRaster(res);
      if (!gl || fadeTarget !== target) { raster.close(); return; }
      colorTex.set(target, upload(gl, 4, raster));
      raster.close();
    }

    bindColour(1, shown);
    bindColour(4, target);
    mix = 0;
    fadingTo = true;
    // A stopped renderer has no frame to ease in — a hidden tab, a mounted focus state, or
    // reduced motion. Land on the new lighting immediately so it is correct whenever the
    // room is next looked at.
    if (!running || motionQuery.matches) settleCrossfade();
  }

  function frame(now: number) {
    if (!running) return;
    // Scheduled first, so a skipped frame still keeps the loop alive. `stop()` cancels it.
    raf = requestAnimationFrame(frame);

    // The rig integrates every tick even when the draw is skipped. It is a handful of
    // trig on the CPU, and stepping it at the display's rate rather than the draw's keeps
    // the drift's phase independent of how often we decide to paint it.
    const dt = last ? now - last : 16.7;
    last = now;
    opts.onBeforeFrame?.(dt);
    stepCrossfade(dt);

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Scale the whole buffer down until it fits the budget. Applied to dpr rather than to
    // the width and height separately so the aspect ratio — and therefore the fit the
    // hotspot rectangles are placed against — is untouched.
    const budget = opts.maxPixels ?? 3.2e6;
    const want = canvas.clientWidth * canvas.clientHeight * dpr * dpr;
    if (want > budget) dpr *= Math.sqrt(budget / want);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      dirty = true;
    }

    // Width-locked fit, in the reconstruction's own pixel units — the same fit
    // roomGeometry.fit() computes, so hotspot rects still land on their objects. Always
    // scaling by the width ratio (never `Math.max` with the height ratio, which was true
    // `object-fit: cover` and cropped the sides off on a canvas narrower than the master —
    // exactly a phone in portrait, where the room's widest-spread hotspots sit) crops
    // top/bottom on a wide canvas and letterboxes top/bottom on a narrow one instead.
    const s = w / m.width;

    const movedPx = Math.hypot(camera.eye[0] - drawnEye[0], camera.eye[1] - drawnEye[1],
                               camera.eye[2] - drawnEye[2]) * (m.fx * s) / m.nearZ;
    if (!dirty && (movedPx < MOTION_EPS_PX || now - lastDrawAt < MIN_FRAME_MS)) return;
    lastDrawAt = now;
    dirty = false;
    drawnEye[0] = camera.eye[0]; drawnEye[1] = camera.eye[1]; drawnEye[2] = camera.eye[2];
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

    // **Nothing draws outside the master's own rectangle.** The fit is width-locked
    // (roomGeometry.ts's header says why), so a canvas taller than the art's 1.79:1 —
    // any phone in portrait — letterboxes top and bottom, and those bands are outside
    // what the camera ever saw. They are not empty: a splat carries an offset of up to
    // ±1100 master px from its own cell, so the strays land past the frame edge and
    // speckle the mat with dots at whatever depth they were assigned. There is no
    // reconstruction out there to make them right, and no clear colour hides them,
    // because they are drawn *over* it.
    //
    // Scissor rather than a tighter cull: the cull is per-splat and conservative by
    // design (it must not drop anything that would have drawn a pixel), whereas this is
    // one rectangle that is exactly the picture, enforced by the rasteriser for free.
    // It bites only in the letterbox case — on a wide canvas the art is taller than the
    // canvas and the scissor clamps to it, which is the crop that was already happening.
    const artW = m.width * s;
    const artH = m.height * s;
    const artX = (w - artW) / 2;
    // GL's scissor origin is bottom-left; the fit is computed top-down.
    const artY = (h - artH) / 2;
    gl!.enable(gl!.SCISSOR_TEST);
    gl!.scissor(Math.floor(artX), Math.floor(h - artY - artH),
                Math.ceil(artW), Math.ceil(artH));
    gl!.drawArraysInstanced(gl!.TRIANGLE_STRIP, 0, 4, drawn.length);
    gl!.disable(gl!.SCISSOR_TEST);
  }

  /**
   * The rule in CLAUDE.md is "pause everything on `document.hidden`", and roomRenderer.ts
   * has always honoured it. This build did not — Room.tsx's IntersectionObserver covers the
   * room scrolling away, but not the tab going to the background. Browsers suspend rAF in a
   * hidden tab anyway, so this costs nothing in practice; it exists so the comment at
   * Room.tsx:154 is true of whichever renderer is mounted.
   */
  let wantRunning = false;
  function onVisibility() {
    if (document.hidden) { if (running) haltLoop(); }
    else if (wantRunning && !running) startLoop();
  }
  document.addEventListener('visibilitychange', onVisibility);

  function startLoop() {
    if (running || document.hidden) return;
    running = true;
    last = 0;
    lastDrawAt = 0;
    // Whatever stopped the loop may have left the canvas cleared or stale.
    dirty = true;
    raf = requestAnimationFrame(frame);
  }
  function haltLoop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
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
    setVariant(name: string | null) { void setVariant(name); },
    start() {
      wantRunning = true;
      startLoop();
    },
    stop() {
      wantRunning = false;
      haltLoop();
    },
    destroy() {
      renderer.stop();
      document.removeEventListener('visibilitychange', onVisibility);
      // A Set because slots 1 and 4 of `textures` are aliases into `colorTex`, and every
      // variant ever faded to lives only in the map.
      new Set([...textures, ...colorTex.values()]).forEach((t) => gl!.deleteTexture(t));
      colorTex.clear();
      gl!.deleteBuffer(cornerBuf);
      gl!.deleteBuffer(orderBuf);
      gl!.deleteVertexArray(vao);
      gl!.deleteProgram(program);
      [geomRaster, colorRaster, shapeRaster, quatRaster, variantRaster]
        .forEach((b) => b?.close());
    },
  };
  return renderer;
}
