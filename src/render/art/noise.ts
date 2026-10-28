// Deterministic hashing + TILEABLE noise for the procedural terrain art (24 §D, 26 §F). Everything
// here is a pure function of its inputs (no Math.random), so procedural art is identical on every
// load and every machine. Noise works in torus coordinates u, v ∈ [0, 1): every lattice has an
// integer number of cells per repeat and wraps, so textures are seamless by construction.

import type { RGB, Tone } from "../../content/biomes";

// ── hashing ─────────────────────────────────────────────────────────────────────────────────────

/** Legacy per-tile hash in [0, 1) (kept bit-identical: map decoration placement depends on it). */
export function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Well-mixed 32-bit lattice hash (murmur3 finaliser) for noise. */
export function ihash(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) + Math.imul(y | 0, 0x165667b1) + Math.imul(s | 0, 0x3c6ef372)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export const uhash = (x: number, y: number, s: number): number => ihash(x, y, s) / 4294967296;

/** Small seeded PRNG (mulberry32) for sprite composition. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── tileable gradient noise ─────────────────────────────────────────────────────────────────────

// 16 gradient directions, offset half a step so none is axis-aligned (no grid-aligned streaks).
const GX = new Float64Array(16), GY = new Float64Array(16);
for (let k = 0; k < 16; k++) { const a = ((k + 0.5) / 16) * Math.PI * 2; GX[k] = Math.cos(a) * 1.4142; GY[k] = Math.sin(a) * 1.4142; }
const grad = (h: number, x: number, y: number): number => GX[h & 15] * x + GY[h & 15] * y;
const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** Tileable Perlin noise with nx × ny lattice cells per repeat; roughly [-1, 1], mean 0. */
export function perlin(u: number, v: number, nx: number, ny: number, s: number): number {
  const x = u * nx, y = v * ny;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const ix = wrap(x0, nx), iy = wrap(y0, ny);
  const jx = ix + 1 === nx ? 0 : ix + 1, jy = iy + 1 === ny ? 0 : iy + 1;
  const a = grad(ihash(ix, iy, s), fx, fy);
  const b = grad(ihash(jx, iy, s), fx - 1, fy);
  const c = grad(ihash(ix, jy, s), fx, fy - 1);
  const d = grad(ihash(jx, jy, s), fx - 1, fy - 1);
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const ab = a + (b - a) * sx, cd = c + (d - c) * sx;
  return ab + (cd - ab) * sy;
}

/** Fractal noise: `oct` octaves from `n` cells per repeat (doubling), → [0, 1] centred on 0.5. */
export function fbm(u: number, v: number, n: number, oct: number, s: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * perlin(u, v, n, n, s + i * 7919);
    norm += amp;
    amp *= gain;
    n *= 2;
  }
  return clamp01(0.5 + (sum / norm) * 1.15);
}

/** Ridged noise: 1 at the zero-crossings of Perlin noise (thin veins/cracks), → [0, 1]. */
export function ridge(u: number, v: number, n: number, s: number): number {
  return 1 - Math.min(1, Math.abs(perlin(u, v, n, n, s)) * 2.2);
}

// ── tileable cellular (Worley) noise ────────────────────────────────────────────────────────────

/** Results of the last worley() call (module scratch, no allocation per pixel). */
export const cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };

/** Jittered-grid cellular noise, n × n cells per repeat. Distances are in cell units; `dx, dy` is
 *  the vector from the sample to the nearest feature point; `id` hashes the nearest cell. */
export function worley(u: number, v: number, n: number, s: number, jitter = 0.85): void {
  const x = u * n, y = v * n;
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, bx = 0, by = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox, cy = iy + oy;
      const wx = wrap(cx, n), wy = wrap(cy, n);
      const h = ihash(wx, wy, s);
      const px = cx + 0.5 + jitter * ((h & 0xffff) / 65536 - 0.5);
      const py = cy + 0.5 + jitter * ((h >>> 16) / 65536 - 0.5);
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = ihash(wx, wy, s + 1); bx = dx; by = dy; } else if (d < f2) f2 = d;
    }
  }
  cell.f1 = f1; cell.f2 = f2; cell.id = id / 4294967296; cell.dx = bx; cell.dy = by;
}

// ── colour ──────────────────────────────────────────────────────────────────────────────────────

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth = (a: number, b: number, t: number): number => {
  const k = clamp01((t - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** o ← tone ramp at t (0 dark, 0.5 mid, 1 light). */
export function ramp(tn: Tone, t: number, o: number[]): void {
  t = clamp01(t);
  const lo = t < 0.5;
  const a = lo ? tn.dark : tn.mid, b = lo ? tn.mid : tn.light, k = lo ? t * 2 : t * 2 - 1;
  o[0] = a[0] + (b[0] - a[0]) * k; o[1] = a[1] + (b[1] - a[1]) * k; o[2] = a[2] + (b[2] - a[2]) * k;
}
/** o ← mix(o, c, t). */
export function blend(o: number[], c: RGB | number[], t: number): void {
  if (t <= 0) return;
  if (t > 1) t = 1;
  o[0] += (c[0] - o[0]) * t; o[1] += (c[1] - o[1]) * t; o[2] += (c[2] - o[2]) * t;
}
/** Multiply brightness (keeps hue). */
export function shadeBy(o: number[], f: number): void { o[0] *= f; o[1] *= f; o[2] *= f; }
/** Warm (+) / cool (−) hue drift at roughly constant luminance — subtle colour variation. */
export function warm(o: number[], w: number): void {
  const k = w * Math.min(1, (o[0] + o[1] + o[2]) / 450); // proportional, so dark tones don't turn violet
  o[0] += k * 14; o[1] += k * 3; o[2] -= k * 16;
}
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c: RGB | number[], a = 1): string =>
  a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
export const lighten = (c: RGB, f: number): RGB => mixRGB(c, [255, 255, 255], f);
export const darken = (c: RGB, f: number): RGB => [c[0] * (1 - f), c[1] * (1 - f), c[2] * (1 - f)];

// ── speck layer ─────────────────────────────────────────────────────────────────────────────────

/** Last speck()'s random value in [0, 1) (for colouring). */
export let speckR = 0;
/** A sparse speck on a 256-per-repeat lattice, drawn as a soft dot (one pixel at 256 px, a small
 *  disc at 1024 px). Returns its coverage in [0, 1]; `density` = chance per lattice cell. */
export function speck(u: number, v: number, s: number, density: number, radius = 0.6): number {
  const x = u * 256, y = v * 256;
  const cx = Math.floor(x), cy = Math.floor(y);
  const h = ihash(cx & 255, cy & 255, s);
  if (h / 4294967296 >= density) return 0;
  speckR = ihash(cx & 255, cy & 255, s + 3) / 4294967296;
  const fx = x - cx - 0.5, fy = y - cy - 0.5;
  return clamp01(1 - (fx * fx + fy * fy) / (radius * radius));
}

/** A canvas (DOM). */
export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
