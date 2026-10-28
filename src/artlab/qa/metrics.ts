// 29 §D — the raw texture measurements (the same methodology as the analysis that rejected the first
// batch). Pure functions over square images.

import { lumaMap, meanRGB, rgbDist } from "../image";
import type { Img, RGB } from "../image";

const BLOCK = 16; // px, seam block size

/** Seam: mean block difference across the wrap edge ÷ the mean difference between neighbouring blocks. */
export function seamRatio(img: Img): { x: number; y: number } {
  const W = img.width, G = Math.floor(W / BLOCK), d = img.data;
  const B: RGB[] = [];
  for (let by = 0; by < G; by++) for (let bx = 0; bx < G; bx++) {
    let r = 0, g = 0, b = 0;
    for (let y = by * BLOCK; y < (by + 1) * BLOCK; y++) for (let x = bx * BLOCK; x < (bx + 1) * BLOCK; x++) {
      const i = (y * W + x) * 4;
      r += d[i]; g += d[i + 1]; b += d[i + 2];
    }
    const n = BLOCK * BLOCK;
    B.push([r / n, g / n, b / n]);
  }
  const at = (bx: number, by: number): RGB => B[by * G + bx];
  let inX = 0, inY = 0, edX = 0, edY = 0;
  for (let k = 0; k < G; k++) {
    for (let j = 0; j < G - 1; j++) { inX += rgbDist(at(j, k), at(j + 1, k)); inY += rgbDist(at(k, j), at(k, j + 1)); }
    edX += rgbDist(at(G - 1, k), at(0, k));
    edY += rgbDist(at(k, G - 1), at(k, 0));
  }
  const typX = inX / (G * (G - 1)), typY = inY / (G * (G - 1));
  return { x: edX / G / Math.max(typX, 1e-3), y: edY / G / Math.max(typY, 1e-3) };
}

/** Lighting: (max − min) of the 4×4 cell mean luminances ÷ their mean. */
export function lightingSpread(img: Img): number {
  const W = img.width, L = lumaMap(img), c = W / 4, m: number[] = [];
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
    let s = 0;
    for (let y = cy * c; y < (cy + 1) * c; y++) for (let x = cx * c; x < (cx + 1) * c; x++) s += L[y * W + x];
    m.push(s / (c * c));
  }
  const mean = m.reduce((a, b) => a + b, 0) / m.length;
  return (Math.max(...m) - Math.min(...m)) / Math.max(mean, 1e-3);
}

export interface Repetition { min: number; median: number; ratio: number; worstAxis: "x" | "y"; worstShift: number }

/**
 * Internal repetition: mean |ΔL| between the image and itself shifted (with wrap) by 15%…85% of the
 * width in ~8 px steps, on each axis; ratio = lowest ÷ median. Shifts below 15% are excluded because
 * a smooth image trivially matches itself at small shifts. A 2×2 repeat gives ≈ 0 at a 50% shift.
 * The coarse grid is centred on the 50% shift (so it is always sampled); the lowest coarse shift of
 * each axis is then refined to 1 px, because fine detail decorrelates within a few px of a true repeat.
 */
export function repetition(img: Img, axes: readonly ("x" | "y")[]): Repetition {
  const W = img.width, L = lumaMap(img), step = Math.max(1, Math.round(W / 64));
  const lo = Math.ceil(W * 0.15), hi = Math.floor(W * 0.85), half = Math.round(W / 2);
  const diff = (axis: "x" | "y", s: number): number => {
    let sum = 0, n = 0;
    for (let y = 0; y < W; y += 2) for (let x = 0; x < W; x += 2) {
      const j = axis === "x" ? y * W + ((x + s) % W) : ((y + s) % W) * W + x;
      sum += Math.abs(L[y * W + x] - L[j]); n++;
    }
    return sum / n;
  };
  const coarse: number[] = [];
  let worst = { v: Infinity, axis: "x" as "x" | "y", s: half };
  for (const axis of axes) {
    let best = { v: Infinity, s: half };
    for (let s = half - Math.floor((half - lo) / step) * step; s <= hi; s += step) {
      const v = diff(axis, s);
      coarse.push(v);
      if (v < best.v) best = { v, s };
    }
    for (let s = Math.max(lo, best.s - step + 1); s <= Math.min(hi, best.s + step - 1); s++) {
      const v = s === best.s ? best.v : diff(axis, s);
      if (v < worst.v) worst = { v, axis, s };
    }
  }
  const median = coarse.sort((a, b) => a - b)[coarse.length >> 1];
  return { min: worst.v, median, ratio: worst.v / Math.max(median, 1e-6), worstAxis: worst.axis, worstShift: worst.s / W };
}

/** Palette distance: Euclidean distance from the mean RGB to the target mid-tone. */
export function paletteDistance(img: Img, target: RGB): number {
  return rgbDist(meanRGB(img), target);
}

/**
 * Corner artefact: how far the bottom-right block's brightest pixels stand out from every other
 * block (robust z-score). Gemini can stamp a small sparkle watermark there.
 */
export function cornerArtefact(img: Img): { z: number; delta: number } {
  const W = img.width, G = 16, c = W / G, L = lumaMap(img), peaks: number[] = [];
  for (let by = 0; by < G; by++) for (let bx = 0; bx < G; bx++) {
    let mx = 0;
    for (let y = by * c; y < (by + 1) * c; y++) for (let x = bx * c; x < (bx + 1) * c; x++) mx = Math.max(mx, L[y * W + x]);
    peaks.push(mx);
  }
  const corner = Math.max(peaks[G * G - 1], peaks[G * G - 2], peaks[G * (G - 1) - 1]);
  const s = [...peaks].sort((a, b) => a - b), med = s[s.length >> 1];
  const mad = [...peaks].map((p) => Math.abs(p - med)).sort((a, b) => a - b)[peaks.length >> 1];
  return { z: (corner - med) / (1.4826 * mad + 1), delta: corner - med };
}
