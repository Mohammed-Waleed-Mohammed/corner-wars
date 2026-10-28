// 29 §C sprites: magenta key (soft edge + despill) → drop detached specks (e.g. a corner watermark)
// → bbox at alpha ≥ 0.5 → normalise footprint and anchor → resample to the output size. Pure.

import { cloneImg, resample, rgbDist, rgbToHex } from "../image";
import type { Img, RGB } from "../image";

const T0 = 48, T1 = 120; // key: colour distance ≤ T0 → transparent, ≥ T1 → opaque, soft in between
const RING = 0.02; // border ring (fraction of the short side) used for the key colour and clean-background check
const SPECK = 0.02; // components smaller than this × the largest are specks
const KEEP_HALO = 2; // px: semi-transparent pixels farther than this from the kept subject are dropped

/** Median key colour of the magenta-ish border pixels (Gemini's "#FF00FF" is rarely exact). */
function estimateKey(img: Img): RGB {
  const W = img.width, H = img.height, d = img.data, ring = Math.max(2, Math.round(Math.min(W, H) * RING));
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= ring && x < W - ring && y >= ring && y < H - ring) continue;
    const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 140 && b > 140 && g < 110 && Math.abs(r - b) < 80) { rs.push(r); gs.push(g); bs.push(b); }
  }
  if (rs.length < 16) return [255, 0, 255];
  const med = (a: number[]): number => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

/** Alpha from the distance to the key, then un-mix the key from edge pixels and cap magenta spill. */
export function keyMagenta(src: Img): { img: Img; key: RGB } {
  const img = cloneImg(src), d = img.data, key = estimateKey(src);
  const n = img.width * img.height;
  for (let p = 0; p < n; p++) {
    const i = p * 4, dist = rgbDist([d[i], d[i + 1], d[i + 2]], key);
    const a = Math.max(0, Math.min(1, (dist - T0) / (T1 - T0)));
    if (a > 0 && a < 1) for (let c = 0; c < 3; c++) d[i + c] = (d[i + c] - (1 - a) * key[c]) / a; // C = aF + (1−a)K
    d[i + 3] = Math.round(a * 255 * (src.data[i + 3] / 255));
  }
  // Spill cap: edge pixels may not be more magenta (min(R,B) − G) than the subject's interior median.
  const W = img.width, H = img.height, ex: number[] = [];
  const nearEdge = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || d[(yy * W + xx) * 4 + 3] < 128) return true;
    }
    return false;
  };
  const edge = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3] === 0) continue;
    if (d[i + 3] < 250 || nearEdge(x, y)) edge[y * W + x] = 1;
    else ex.push(Math.min(d[i], d[i + 2]) - d[i + 1]);
  }
  ex.sort((p, q) => p - q);
  const cap = Math.max(0, ex.length ? ex[ex.length >> 1] : 0) + 12;
  for (let p = 0; p < n; p++) {
    if (!edge[p]) continue;
    const i = p * 4, e = Math.min(d[i], d[i + 2]) - d[i + 1];
    if (e > cap) { d[i] -= e - cap; d[i + 2] -= e - cap; }
  }
  return { img, key };
}

/** Remove detached specks and stray haze; returns how many specks were dropped. */
export function dropSpecks(img: Img): { specks: number; speckPx: number } {
  const W = img.width, H = img.height, d = img.data, n = W * H;
  const label = new Int32Array(n), sizes: number[] = [0], stack = new Int32Array(n);
  for (let p = 0; p < n; p++) {
    if (label[p] || d[p * 4 + 3] < 128) continue;
    const id = sizes.length;
    let top = 0, size = 0;
    stack[top++] = p; label[p] = id;
    const visit = (r: number): void => {
      if (!label[r] && d[r * 4 + 3] >= 128) { label[r] = id; stack[top++] = r; }
    };
    while (top) {
      const q = stack[--top], x = q % W, y = (q - x) / W;
      size++;
      if (x > 0) visit(q - 1);
      if (x < W - 1) visit(q + 1);
      if (y > 0) visit(q - W);
      if (y < H - 1) visit(q + W);
    }
    sizes.push(size);
  }
  let largest = 0;
  for (const s of sizes) if (s > largest) largest = s;
  let specks = 0, speckPx = 0;
  const keep = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (label[p] && sizes[label[p]] >= largest * SPECK) keep[p] = 1;
  for (let id = 1; id < sizes.length; id++) if (sizes[id] < largest * SPECK) { specks++; speckPx += sizes[id]; }
  // Dilate the kept mask by KEEP_HALO px; anything outside it becomes fully transparent.
  const near = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!keep[y * W + x]) continue;
    for (let dy = -KEEP_HALO; dy <= KEEP_HALO; dy++) for (let dx = -KEEP_HALO; dx <= KEEP_HALO; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) near[yy * W + xx] = 1;
    }
  }
  for (let p = 0; p < n; p++) if (!near[p]) d[p * 4 + 3] = 0;
  return { specks, speckPx };
}

/** Bounding box of pixels with alpha ≥ 0.5 (x1/y1 exclusive), or null if empty. */
export function alphaBox(img: Img): { x0: number; y0: number; x1: number; y1: number } | null {
  const W = img.width, H = img.height, d = img.data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] < 128) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Fraction of border-ring pixels that are (nearly) transparent. */
export function cleanBorder(img: Img): number {
  const W = img.width, H = img.height, d = img.data, ring = Math.max(2, Math.round(Math.min(W, H) * RING));
  let clean = 0, total = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= ring && x < W - ring && y >= ring && y < H - ring) continue;
    total++;
    if (d[(y * W + x) * 4 + 3] <= 26) clean++;
  }
  return total ? clean / total : 1;
}

/** Opaque (alpha ≥ 0.5) pixels on the outermost 1-px border. */
export function edgeTouching(img: Img): number {
  const W = img.width, H = img.height, d = img.data;
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x > 0 && x < W - 1 && y > 0 && y < H - 1) continue;
    if (d[(y * W + x) * 4 + 3] >= 128) n++;
  }
  return n;
}

export interface SpriteOptions { footprint: number; out: number; baseAtBottom: boolean }
export interface SpriteResult {
  out: Img | null; // null when no subject was found
  keyed: Img; // full-resolution keyed source (after speck removal)
  steps: string[];
  key: RGB; cleanBg: number; clippedPx: number; specks: number; speckPx: number;
  subjectPx: number; magentaPx: number; footprint: number; heightClamped: boolean;
}

/** Measured footprint of an output sprite: larger side (tufts: width) ÷ size. */
export function measureFootprint(img: Img, widthOnly: boolean): number {
  const b = alphaBox(img);
  if (!b) return 0;
  return (widthOnly ? b.x1 - b.x0 : Math.max(b.x1 - b.x0, b.y1 - b.y0)) / img.width;
}

export function processSprite(src: Img, o: SpriteOptions): SpriteResult {
  const steps: string[] = [];
  const { img: keyed, key } = keyMagenta(src);
  const cleanBg = cleanBorder(keyed);
  steps.push(`Keyed ${rgbToHex(key)} (estimated from the border; distance ≤ ${T0} transparent, ≥ ${T1} opaque), un-mixed edge pixels and capped magenta spill.`);
  const { specks, speckPx } = dropSpecks(keyed);
  if (specks) steps.push(`Removed ${specks} detached speck${specks > 1 ? "s" : ""} (${speckPx} px), e.g. a watermark or stray particle.`);
  const clippedPx = edgeTouching(keyed);
  const d = keyed.data;
  let subjectPx = 0, magentaPx = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    subjectPx++;
    if (d[i] > 150 && d[i + 2] > 150 && Math.min(d[i], d[i + 2]) - d[i + 1] > 90) magentaPx++;
  }
  const box = alphaBox(keyed);
  const base = { keyed, steps, key, cleanBg, clippedPx, specks, speckPx, subjectPx, magentaPx };
  if (!box) return { ...base, out: null, footprint: 0, heightClamped: false };
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0, S = o.out;
  let scale = (o.footprint * S) / (o.baseAtBottom ? bw : Math.max(bw, bh));
  let heightClamped = false;
  if (o.baseAtBottom && bh * scale > S * 0.97) { scale = (S * 0.97) / bh; heightClamped = true; }
  const cx = (box.x0 + box.x1) / 2, sw = S / scale;
  const sx = cx - sw / 2;
  const sy = o.baseAtBottom ? box.y1 - sw : (box.y0 + box.y1) / 2 - sw / 2;
  const out = resample(keyed, sx, sy, sw, sw, S, S, "transparent");
  steps.push(`Subject box ${bw}×${bh} px → scaled ×${scale.toFixed(3)} so its ${o.baseAtBottom ? "width" : "larger side"} fills ${Math.round(o.footprint * 100)}% of ${S}×${S}${o.baseAtBottom ? ", base on the bottom edge" : ", centred"}${heightClamped ? " (height clamped to 97%)" : ""}.`);
  return { ...base, out, footprint: measureFootprint(out, o.baseAtBottom), heightClamped };
}
