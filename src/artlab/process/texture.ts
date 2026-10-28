// 29 §C textures: centre-crop → 1024 → flatten lighting → palette lock → seamless → 512. Pure.

import { centreSquare, cloneImg, lumaMap, makeImg, meanRGB, opaque, resample, rgbDist, rgbToHex, smoothstep } from "../image";
import type { Img, RGB } from "../image";

export const WORK = 1024; // working resolution
export const TEX_OUT_PX = 512;
export const LOCK_DEFAULT = 0.6;

// ── 2. flatten lighting ─────────────────────────────────────────────────────────────────────────
const LOW = 128; // the low-frequency luminance is estimated on a LOW × LOW grid (exact enough: it's a σ = W/12 blur)
// σ = W/12 (85 px at 1024): wide enough to keep every painted detail under ~150 px, narrow enough to
// remove lighting at the scale the QA lighting check measures (4×4 cells) — a W/6 blur only removed
// image-wide gradients and let half-image glare through.
const SIGMA_FRAC = 1 / 12;

/** Mirror an index into [0, n). */
const reflect = (i: number, n: number): number => { while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1; return i; };

/** Separable Gaussian blur of an n × n float grid, reflected at the edges. */
function gaussian(src: Float32Array, n: number, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 0;
    for (let i = -r; i <= r; i++) v += src[y * n + reflect(x + i, n)] * k[i + r];
    tmp[y * n + x] = v;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 0;
    for (let i = -r; i <= r; i++) v += tmp[reflect(y + i, n) * n + x] * k[i + r];
    out[y * n + x] = v;
  }
  return out;
}

/** Low-frequency luminance (Gaussian σ = W/12) at full resolution, plus its mean. */
export function lowFrequency(img: Img): { low: Float32Array; mean: number; range: number } {
  const W = img.width, f = W / LOW, L = lumaMap(img);
  const small = new Float32Array(LOW * LOW);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) small[Math.floor(y / f) * LOW + Math.floor(x / f)] += L[y * W + x] / (f * f);
  const blur = gaussian(small, LOW, LOW * SIGMA_FRAC);
  let mean = 0, lo = Infinity, hi = -Infinity;
  for (const v of blur) { mean += v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  mean /= blur.length;
  const low = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const fy = Math.max(0, Math.min(LOW - 1.0001, (y + 0.5) / f - 0.5)), y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.max(0, Math.min(LOW - 1.0001, (x + 0.5) / f - 0.5)), x0 = Math.floor(fx), tx = fx - x0;
      const a = blur[y0 * LOW + x0], b = blur[y0 * LOW + x0 + 1], c = blur[(y0 + 1) * LOW + x0], d = blur[(y0 + 1) * LOW + x0 + 1];
      low[y * W + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return { low, mean, range: hi - lo };
}

/** Subtract the low-frequency luminance deviation from every channel (keeps the mean and the detail). */
export function flattenLighting(img: Img): { img: Img; rangeBefore: number; rangeAfter: number } {
  const { low, mean, range } = lowFrequency(img);
  const out = cloneImg(img), d = out.data;
  for (let i = 0; i < low.length; i++) {
    const dev = low[i] - mean;
    d[i * 4] -= dev; d[i * 4 + 1] -= dev; d[i * 4 + 2] -= dev;
  }
  return { img: out, rangeBefore: range, rangeAfter: lowFrequency(out).range };
}

// ── 3. palette lock ─────────────────────────────────────────────────────────────────────────────
/** Shift the mean colour toward `target` by `strength` (0…1); detail and contrast are untouched. */
export function paletteLock(img: Img, target: RGB, strength: number): { img: Img; before: RGB; after: RGB } {
  const before = meanRGB(img), out = cloneImg(img), d = out.data;
  const sh = [0, 1, 2].map((c) => (target[c] - before[c]) * strength);
  for (let i = 0; i < d.length; i += 4) { d[i] += sh[0]; d[i + 1] += sh[1]; d[i + 2] += sh[2]; }
  return { img: out, before, after: meanRGB(out) };
}

// ── 4. seamless ─────────────────────────────────────────────────────────────────────────────────
/** Mask band, as a fraction of W from the nearest edge: 0 (all offset copy) below E0, 1 (all original) above E1. */
const E0 = 0.04, E1 = 0.11, AMP = 0.02; // AMP < E0, so the very edge is ALWAYS the (seamless) offset copy

/** Periodic value noise in [-1, 1] (period W on both axes), two octaves. */
function periodicNoise(W: number, seed: number): Float32Array {
  const out = new Float32Array(W * W);
  const hash = (x: number, y: number, s: number): number => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  for (const [cells, amp, s] of [[5, 0.65, seed], [11, 0.35, seed + 7]]) {
    const c = W / cells;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const gx = x / c, gy = y / c, x0 = Math.floor(gx), y0 = Math.floor(gy);
      const tx = smoothstep(0, 1, gx - x0), ty = smoothstep(0, 1, gy - y0);
      const v = (i: number, j: number): number => hash((x0 + i) % cells, (y0 + j) % cells, s);
      const n = (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty;
      out[y * W + x] += (n * 2 - 1) * amp;
    }
  }
  return out;
}

/** One pass: blend the image with its half-offset copy along one axis through a noisy edge mask.
 *  Variance-preserving blend (mean + Σwᵢ(xᵢ−mean)/√Σwᵢ²), so the blend band keeps its contrast. */
function seamPass(img: Img, axis: "x" | "y", seed: number): Img {
  const W = img.width, h = W / 2, s = img.data, noise = periodicNoise(W, seed);
  const mu = meanRGB(img), out = makeImg(W, W), o = out.data;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const p = axis === "x" ? x : y;
    const e = Math.min(p + 0.5, W - p - 0.5) / W;
    const m = smoothstep(E0, E1, e + AMP * noise[y * W + x]);
    const i = (y * W + x) * 4;
    const j = axis === "x" ? (y * W + ((x + h) % W)) * 4 : (((y + h) % W) * W + x) * 4;
    const norm = Math.sqrt(m * m + (1 - m) * (1 - m));
    for (let c = 0; c < 3; c++) o[i + c] = mu[c] + (m * (s[i + c] - mu[c]) + (1 - m) * (s[j + c] - mu[c])) / norm;
    o[i + 3] = 255;
  }
  return out;
}

/** Make an image tile seamlessly: an x pass then a y pass, so the two seam systems never cross. */
export function makeSeamless(img: Img): Img {
  return seamPass(seamPass(img, "x", 1301), "y", 2903);
}

// ── the whole pipeline ──────────────────────────────────────────────────────────────────────────
export interface TextureOptions { target: RGB; lock: number; trim: number }
export interface TextureResult {
  out: Img; // 512, final
  preSeam: Img; // 512, flattened + palette-locked, before the seamless blend (shows what Gemini drew)
  steps: string[];
  srcW: number; srcH: number; cropLoss: number;
  paletteBefore: number; // distance of Gemini's mean colour to the target, before the lock
}

export function processTexture(src: Img, o: TextureOptions): TextureResult {
  const steps: string[] = [];
  const crop = centreSquare(src, WORK, o.trim);
  steps.push(`Centre-cropped ${src.width}×${src.height} to ${crop.side}×${crop.side}${o.trim > 0 ? ` (trimmed ${Math.round(o.trim * 100)}% per edge)` : ""} and resampled to ${WORK}×${WORK}.`);
  const flat = flattenLighting(opaque(crop.img));
  steps.push(`Flattened lighting: low-frequency luminance (Gaussian σ = ${Math.round(WORK * SIGMA_FRAC)} px) range ${flat.rangeBefore.toFixed(1)} → ${flat.rangeAfter.toFixed(1)} levels.`);
  const lock = paletteLock(flat.img, o.target, o.lock);
  const paletteBefore = rgbDist(lock.before, o.target);
  steps.push(`Palette lock ${Math.round(o.lock * 100)}%: mean ${rgbToHex(lock.before)} → ${rgbToHex(lock.after)} (target ${rgbToHex(o.target)}, distance ${paletteBefore.toFixed(0)} → ${rgbDist(lock.after, o.target).toFixed(0)}).`);
  const seam = makeSeamless(lock.img);
  steps.push(`Seamless: half-offset cross-blend, x then y, through a noise-perturbed mask (edges ${Math.round(E0 * 100)}–${Math.round(E1 * 100)}% from each border).`);
  const out = resample(seam, 0, 0, WORK, WORK, TEX_OUT_PX, TEX_OUT_PX);
  steps.push(`Resampled to ${TEX_OUT_PX}×${TEX_OUT_PX}.`);
  return { out, preSeam: resample(lock.img, 0, 0, WORK, WORK, TEX_OUT_PX, TEX_OUT_PX), steps, srcW: src.width, srcH: src.height, cropLoss: crop.cropLoss, paletteBefore };
}
