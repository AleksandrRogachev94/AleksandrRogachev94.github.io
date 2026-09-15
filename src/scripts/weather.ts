/**
 * The weather pass: instanced quads drawn inside the splat field, at a real depth in the yard.
 *
 * One program, one VAO, one draw call. It owns no camera and no clock of its own — the
 * splat renderer hands it both, along with the same intrinsics the splats are reconstructed
 * with, because a particle at master pixel `px` and depth `z` has to land exactly where a
 * splat carrying those numbers would. The projection below is copied from the splat vertex
 * shader for that reason and should be kept identical to it.
 *
 * **Nothing is simulated and nothing is stored.** A particle's position is a closed-form
 * function of its seed and the clock, evaluated in the vertex shader: no state, no buffer
 * updates, no readback, no growth. The only per-frame work on the CPU is a handful of
 * `uniform` calls. That is what lets this sit in the ambient tier (CLAUDE.md rule 1)
 * honestly rather than by exemption — it is closer in cost to a CSS keyframe than to a sim,
 * and it registers with nothing.
 *
 * **Depth is constant per particle, and that is load-bearing.** Flakes fall and sway but
 * never change `z`, so their position in a back-to-front ordering can never change either.
 * That is what lets the whole field be composited at one fixed point in the splat sequence
 * (data/weather.ts, `SPLIT_M`) instead of being re-sorted against 1.2M splats every frame.
 * A particle that drifted in depth would break that and buy nothing the eye can see.
 */

import type { WeatherLook } from '../data/weather';
import { YARD } from '../data/weather';

/** The reconstruction's intrinsics, straight off the splat manifest. */
export interface WeatherScene {
  fx: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * Everything that changes per frame. The renderer owns one of these and mutates it, so a
 * frame costs no allocation.
 */
export interface WeatherFrame {
  /** Pixels per unit at unit depth, after the cover-fit. */
  focal: number;
  centerX: number;
  centerY: number;
  viewW: number;
  viewH: number;
  /** World -> camera rotation, the same mat3 the splats get. */
  view: Float32Array;
  camX: number;
  camY: number;
  camZ: number;
  /** Seconds since the pass was created. */
  timeSec: number;
  /** The season dip, so the weather fades out and back with the room rather than through it. */
  dim: number;
}

export interface WeatherPass {
  /** Whether anything is falling. `false` means `draw` is a no-op and can be skipped. */
  readonly active: boolean;
  setLook(look: WeatherLook | null): void;
  draw(f: WeatherFrame): void;
  destroy(): void;
}

const VERT = `#version 300 es
precision highp float;

in vec2 aCorner;
in vec4 aSeed;            // u across the rect, v phase, depth t, one random

uniform vec3 uCam;
uniform mat3 uView;
uniform vec2 uFocal, uCenter, uViewport;
uniform vec3 uIntrin;     // fx, cx, cy of the master
uniform vec2 uPlate;      // master width, height
uniform vec4 uRect;       // x0, y0, x1, y1 of the yard rect, normalised
uniform vec2 uBand;       // near, far, metres
uniform vec2 uRadius;     // min, max world radius
uniform vec2 uFall;       // min, max m/s
uniform vec3 uMotion;     // sway metres, sway Hz, spin Hz
uniform vec3 uPal[4];
uniform float uOpacity, uTime, uDim, uLeaf;

flat out mediump vec4 vColor;
out mediump vec2 vQuad;

// Several independent streams out of one stored random. Cheaper than storing five of them,
// and decorrelated enough that no two particles share a size, a speed and a phase.
float pick(float r, float k) { return fract(r * k); }

void main() {
  float r = aSeed.w;
  float z = mix(uBand.x, uBand.y, aSeed.z);

  // ---- fall -----------------------------------------------------------------------------
  // Speed is constant in *metres per second* and converted here into the rect's own vertical
  // units. That conversion carries the 1/z, which is the whole of the perspective: a fixed
  // world speed covers less of the image the further away it is, so near flakes visibly
  // outrun far ones and nothing had to be tuned to make them.
  float rectH = (uRect.w - uRect.y) * uPlate.y;
  float vps = mix(uFall.x, uFall.y, pick(r, 7.31)) * uIntrin.x / (z * rectH);
  // fract() is the whole respawn mechanism: a particle leaving the bottom reappears at the
  // top with its identity intact. Both edges of the rect sit behind the wall, so the jump
  // is never on screen. See YARD.rect.
  float v = fract(aSeed.y + uTime * vps);

  float phase = r * 6.2831853;
  float rectW = (uRect.z - uRect.x) * uPlate.x;
  // Sway is metres for the same reason, and is not wrapped: it is small, and a particle
  // carried a little past the rect's edge is behind the wall anyway.
  float u = aSeed.x + sin(uTime * uMotion.y + phase) * uMotion.x * uIntrin.x / (z * rectW);

  vec2 px = vec2(mix(uRect.x, uRect.z, u) * uPlate.x,
                 mix(uRect.y, uRect.w, v) * uPlate.y);

  // Master pixel + depth -> a point in the room. Identical to the splat shader's
  // reconstruction step, deliberately: the two have to agree about where 6 metres is.
  vec3 world = vec3((px.x - uIntrin.y) / uIntrin.x * z,
                    (px.y - uIntrin.z) / uIntrin.x * z, z);
  vec3 p = uView * (world - uCam);
  if (p.z < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float iz = 1.0 / p.z;
  vec2 c = vec2(uFocal.x * p.x * iz + uCenter.x, uFocal.y * p.y * iz + uCenter.y);
  // World radius projected, so size is perspective too and not a second thing to tune.
  float rad = uFocal.x * mix(uRadius.x, uRadius.y, pick(r, 3.77)) * iz;

  // ---- tumble ---------------------------------------------------------------------------
  // The one line that separates a leaf from a brown snowflake. The quad turns, and its minor
  // axis is scaled by |cos(spin)| so the leaf goes edge-on and nearly disappears before
  // flashing broad again. The 0.18 floor stops it vanishing to a hairline, which reads as
  // flicker rather than as rotation.
  vec2 axis = vec2(1.0, 0.0);
  float squash = 1.0;
  if (uLeaf > 0.5) {
    float spin = uTime * uMotion.z * (0.7 + 0.6 * pick(r, 11.3)) + phase;
    axis = vec2(cos(spin * 0.45), sin(spin * 0.45));
    squash = 0.18 + 0.82 * abs(cos(spin));
  }
  vec2 corner = c + aCorner.x * axis * rad
                  + aCorner.y * vec2(-axis.y, axis.x) * (rad * squash);

  // Atmospheric perspective across 1.7m is not physics, it is a legibility dial: without it
  // the back of the slab reads as small near particles rather than as distant ones.
  float fade = mix(1.0, 0.55, (z - uBand.x) / max(uBand.y - uBand.x, 1e-4));
  vColor = vec4(uPal[int(min(pick(r, 5.13) * 4.0, 3.0))],
                uOpacity * fade * uDim * (0.7 + 0.3 * pick(r, 2.71)));
  vQuad = aCorner;
  gl_Position = vec4(2.0 * corner.x / uViewport.x - 1.0,
                     1.0 - 2.0 * corner.y / uViewport.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
flat in mediump vec4 vColor;
in mediump vec2 vQuad;
// highp, matching the vertex stage. A uniform declared in both shaders must agree on type
// AND precision or the program fails to link - and the vertex shader sets highp float, so
// its bare "float uLeaf" is highp. Declaring mediump here is a link error, not a warning.
// (No backticks in this file's shader strings: they are template literals.)
uniform highp float uLeaf;
out vec4 outColor;
void main() {
  float a;
  if (uLeaf > 0.5) {
    // A lens — two arcs meeting in a point at each end. The pointed tips are what read as a
    // leaf rather than as a lozenge, and they come free from the half-width going to zero.
    float wgt = pow(max(1.0 - vQuad.x * vQuad.x, 0.0), 0.62);
    float d = abs(vQuad.y) / max(wgt, 1e-3);
    if (d > 1.0) discard;
    // Flipped rather than written as smoothstep(1.0, 0.70, d): GLSL ES leaves the result
    // undefined when edge0 >= edge1, however reliably drivers happen to handle it.
    a = vColor.a * (1.0 - smoothstep(0.70, 1.0, d));
  } else {
    float r2 = dot(vQuad, vQuad);
    if (r2 > 1.0) discard;
    a = vColor.a * (1.0 - r2);
  }
  if (a < 0.004) discard;
  outColor = vec4(vColor.rgb * a, a);   // premultiplied, same as the splats
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`weather: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

/**
 * Deterministic per-particle randoms.
 *
 * Fixed seed on purpose: the field is identical on every load, so a layout that looked wrong
 * once can be looked at again, and nobody has to wonder whether a flake in an odd place is a
 * bug or this morning's dice.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Per-particle seeds: where it sits across the rect, where it is in its fall, how deep, and
 * one random the shader fans out into size, speed and phase.
 *
 * Depth is sampled so that particles-per-unit-depth grows as z^2. A frustum slice's volume
 * does, so uniform sampling would put the same number of particles in the far half as the
 * near one and the field would read thin at the back. Over this slab it is a mild correction
 * — the band is only 1.38x deep — but it is exact and costs one cube root at load.
 */
function seedsFor(count: number): Float32Array {
  const rand = mulberry32(0x5eed);
  const [zn, zf] = YARD.bandM;
  const zn3 = zn * zn * zn;
  const span = zf * zf * zf - zn3;
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const z = Math.cbrt(zn3 + rand() * span);
    out[i * 4 + 0] = rand();
    out[i * 4 + 1] = rand();
    out[i * 4 + 2] = (z - zn) / (zf - zn);
    out[i * 4 + 3] = rand();
  }
  return out;
}

/**
 * A pass that does nothing, for when the real one could not be built.
 *
 * The room is the product; the weather is decoration on it. This module throwing during
 * construction used to take `createSplatRenderer` down with it — the promise rejected, the
 * renderer was never assigned, and the whole room fell back to a still image with no ambient
 * drift. A missing snowfall must never cost the room, so the failure is logged loudly and
 * absorbed here. That is CLAUDE.md's "degrade explicitly, never silently" applied one level
 * down: the console says exactly what broke, and the visitor gets a room.
 */
const INERT: WeatherPass = {
  active: false,
  setLook() {},
  draw() {},
  destroy() {},
};

export function createWeather(gl: WebGL2RenderingContext, scene: WeatherScene): WeatherPass {
  try {
    return buildWeather(gl, scene);
  } catch (err) {
    console.error('weather: pass disabled, the room is unaffected —', err);
    return INERT;
  }
}

function buildWeather(gl: WebGL2RenderingContext, scene: WeatherScene): WeatherPass {
  const program = gl.createProgram()!;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`weather: ${gl.getProgramInfoLog(program)}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const u = Object.fromEntries(
    ['uCam', 'uView', 'uFocal', 'uCenter', 'uViewport', 'uIntrin', 'uPlate', 'uRect',
     'uBand', 'uRadius', 'uFall', 'uMotion', 'uPal', 'uOpacity', 'uTime', 'uDim', 'uLeaf']
      .map((n) => [n, gl.getUniformLocation(program, n)]),
  ) as Record<string, WebGLUniformLocation | null>;

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const cornerBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
                gl.STATIC_DRAW);
  const locCorner = gl.getAttribLocation(program, 'aCorner');
  gl.enableVertexAttribArray(locCorner);
  gl.vertexAttribPointer(locCorner, 2, gl.FLOAT, false, 0, 0);

  const seedBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
  const locSeed = gl.getAttribLocation(program, 'aSeed');
  gl.enableVertexAttribArray(locSeed);
  gl.vertexAttribPointer(locSeed, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(locSeed, 1);
  gl.bindVertexArray(null);

  // The constants. Set once — none of them depend on the look or the frame.
  gl.useProgram(program);
  gl.uniform3f(u.uIntrin, scene.fx, scene.cx, scene.cy);
  gl.uniform2f(u.uPlate, scene.width, scene.height);
  gl.uniform4f(u.uRect, YARD.rect[0], YARD.rect[1], YARD.rect[2], YARD.rect[3]);
  gl.uniform2f(u.uBand, YARD.bandM[0], YARD.bandM[1]);

  let look: WeatherLook | null = null;
  let count = 0;

  return {
    get active() {
      return count > 0;
    },

    setLook(next: WeatherLook | null) {
      look = next;
      count = next ? next.count : 0;
      if (!next) return;

      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf);
      gl.bufferData(gl.ARRAY_BUFFER, seedsFor(next.count), gl.STATIC_DRAW);
      gl.bindVertexArray(null);

      gl.uniform2f(u.uRadius, next.radiusM[0], next.radiusM[1]);
      gl.uniform2f(u.uFall, next.fallMps[0], next.fallMps[1]);
      gl.uniform3f(u.uMotion, next.swayM, next.swayHz, next.spinHz);
      gl.uniform1f(u.uOpacity, next.opacity);
      gl.uniform1f(u.uLeaf, next.kind === 'leaves' ? 1 : 0);
      // Always four, whatever the look supplies, because the shader indexes the array with a
      // value it computed and an out-of-range read there is undefined rather than clamped.
      const pal = new Float32Array(12);
      for (let i = 0; i < 4; i++) {
        const c = next.palette[i % next.palette.length];
        pal.set(c, i * 3);
      }
      gl.uniform3fv(u.uPal, pal);
    },

    draw(f: WeatherFrame) {
      if (!count || !look) return;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(u.uFocal, f.focal, f.focal);
      gl.uniform2f(u.uCenter, f.centerX, f.centerY);
      gl.uniform2f(u.uViewport, f.viewW, f.viewH);
      gl.uniformMatrix3fv(u.uView, false, f.view);
      gl.uniform3f(u.uCam, f.camX, f.camY, f.camZ);
      gl.uniform1f(u.uTime, f.timeSec);
      gl.uniform1f(u.uDim, f.dim);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
    },

    destroy() {
      gl.deleteBuffer(cornerBuf);
      gl.deleteBuffer(seedBuf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
