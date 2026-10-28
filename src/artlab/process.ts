// 29 §C — automatic processing of a Gemini output into the exact game spec. Pure functions over
// ImageData-shaped images (see image.ts); the page only decodes the file and encodes the PNG.

import { centreSquare, meanRGB, opaque, rgbDist } from "./image";
import type { Img, RGB } from "./image";

export { LOCK_DEFAULT, TEX_OUT_PX, WORK, flattenLighting, makeSeamless, paletteLock, processTexture } from "./process/texture";
export type { TextureOptions, TextureResult } from "./process/texture";
export { alphaBox, keyMagenta, measureFootprint, processSprite } from "./process/sprite";
export type { SpriteOptions, SpriteResult } from "./process/sprite";

// ── portraits: centre-crop to a square, resample, no keying ─────────────────────────────────────
export interface PortraitResult { out: Img; steps: string[]; srcW: number; srcH: number; cropLoss: number; backdrop: RGB; backdropDist: number }

/** Mean colour of the outer band of the image (the backdrop around the bust, above the shoulders). */
function backdropColour(img: Img): RGB {
  const W = img.width, band = Math.round(W * 0.06), d = img.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < Math.round(W * 0.6); y++) for (let x = 0; x < W; x++) {
    if (x >= band && x < W - band && y >= band) continue; // top band + both side bands (shoulders sit lower)
    const i = (y * W + x) * 4;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : meanRGB(img);
}

export function processPortrait(src: Img, o: { out: number; trim: number; backdrop: RGB }): PortraitResult {
  const crop = centreSquare(src, o.out, o.trim);
  const out = opaque(crop.img);
  const backdrop = backdropColour(out);
  return {
    out,
    steps: [
      `Centre-cropped ${src.width}×${src.height} to ${crop.side}×${crop.side}${o.trim > 0 ? ` (trimmed ${Math.round(o.trim * 100)}% per edge)` : ""}.`,
      `Resampled to ${o.out}×${o.out}; no keying.`,
    ],
    srcW: src.width, srcH: src.height, cropLoss: crop.cropLoss,
    backdrop, backdropDist: rgbDist(backdrop, o.backdrop),
  };
}
