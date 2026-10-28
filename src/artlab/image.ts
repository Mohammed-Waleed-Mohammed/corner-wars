// Art Lab — a minimal RGBA image type and pixel helpers. Pure functions over ImageData-shaped
// objects (no DOM), so processing and QA run the same in the page and in a Node test.

export type RGB = [number, number, number];

/** Structurally an ImageData: RGBA, 8 bits per channel, row-major. */
export interface Img { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> }

export function makeImg(width: number, height: number): Img {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneImg(img: Img): Img {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/** Rec. 601 luma of one pixel. */
export const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/** Per-pixel luminance as floats. */
export function lumaMap(img: Img): Float32Array {
  const n = img.width * img.height, out = new Float32Array(n), d = img.data;
  for (let i = 0; i < n; i++) out[i] = luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  return out;
}

/** Mean RGB of the pixels with alpha ≥ minAlpha (all pixels by default). */
export function meanRGB(img: Img, minAlpha = 0): RGB {
  const d = img.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < minAlpha) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

export const rgbDist = (a: RGB, b: RGB): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const hexToRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const rgbToHex = (c: RGB): string => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Force every pixel opaque (textures and portraits have no alpha). */
export function opaque(img: Img): Img {
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  return img;
}

// ── resampling ──────────────────────────────────────────────────────────────────────────────────
type Taps = { idx: number[]; w: number[] }[];

/** 1-D filter taps: area-average when shrinking, linear when enlarging. "clamp" repeats the edge;
 *  "transparent" drops out-of-range taps (they contribute nothing, i.e. alpha 0). */
function taps(start: number, len: number, dst: number, size: number, edge: "clamp" | "transparent"): Taps {
  const k = len / dst, out: Taps = [];
  for (let i = 0; i < dst; i++) {
    const idx: number[] = [], w: number[] = [];
    const push = (j: number, wt: number): void => {
      if (wt <= 0) return;
      if (j < 0 || j >= size) { if (edge === "transparent") return; j = Math.max(0, Math.min(size - 1, j)); }
      idx.push(j); w.push(wt);
    };
    if (k >= 1) {
      const a = start + i * k, b = a + k;
      for (let j = Math.floor(a); j < Math.ceil(b); j++) push(j, (Math.min(b, j + 1) - Math.max(a, j)) / k);
    } else {
      const c = start + (i + 0.5) * k - 0.5, j0 = Math.floor(c), t = c - j0;
      push(j0, 1 - t); push(j0 + 1, t);
    }
    out.push({ idx, w });
  }
  return out;
}

/**
 * Resample the source rectangle (sx, sy, sw, sh) — which may extend past the image — to dw × dh.
 * Works in premultiplied alpha so transparent pixels never darken edges.
 */
export function resample(src: Img, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number, edge: "clamp" | "transparent" = "clamp"): Img {
  const W = src.width, H = src.height, s = src.data;
  const tx = taps(sx, sw, dw, W, edge), ty = taps(sy, sh, dh, H, edge);
  // Horizontal pass → H × dw premultiplied floats.
  const mid = new Float32Array(H * dw * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < dw; x++) {
      const t = tx[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < t.idx.length; k++) {
        const p = (y * W + t.idx[k]) * 4, al = s[p + 3] / 255, w = t.w[k] * al;
        r += s[p] * w; g += s[p + 1] * w; b += s[p + 2] * w; a += t.w[k] * al;
      }
      const q = (y * dw + x) * 4;
      mid[q] = r; mid[q + 1] = g; mid[q + 2] = b; mid[q + 3] = a;
    }
  }
  // Vertical pass → output, un-premultiplied.
  const out = makeImg(dw, dh), o = out.data;
  for (let y = 0; y < dh; y++) {
    const t = ty[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < t.idx.length; k++) {
        const q = (t.idx[k] * dw + x) * 4, w = t.w[k];
        r += mid[q] * w; g += mid[q + 1] * w; b += mid[q + 2] * w; a += mid[q + 3] * w;
      }
      const p = (y * dw + x) * 4;
      if (a > 1e-6) { o[p] = r / a; o[p + 1] = g / a; o[p + 2] = b / a; }
      o[p + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  return out;
}

/** Centre-crop to a square (after trimming `trim` × the short side off every edge), then resample. */
export function centreSquare(src: Img, size: number, trim = 0): { img: Img; side: number; cropLoss: number } {
  const short = Math.min(src.width, src.height);
  const side = Math.max(8, Math.round(short * (1 - 2 * trim)));
  const sx = (src.width - side) / 2, sy = (src.height - side) / 2;
  const img = resample(src, sx, sy, side, side, size, size, "clamp");
  return { img, side, cropLoss: 1 - (side * side) / (src.width * src.height) };
}
