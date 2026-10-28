// 29 §C faction buildings: the sprite key (trim → magenta key → specks → bbox at alpha ≥ 0.5), then
// a UNIFORM scale so the bbox fits a centred (outW × fill) × (outH × fill) rectangle, resampled into
// an outW × outH transparent output. Proportions are never stretched: QA judges them. Pure.

import { resample } from "../image";
import type { Img } from "../image";
import { alphaBox, keySprite } from "./sprite";
import type { KeyedSprite } from "./sprite";

export interface BuildingOptions {
  outW: number; outH: number; // processed size (footprint tiles × BUILDING_PX_PER_TILE)
  fill: number; // BUILDING_FILL: the target rectangle is (outW × fill) × (outH × fill), centred
  trim?: number;
}
export interface BuildingResult extends KeyedSprite {
  out: Img | null; // null when no subject was found
  aspect: number; // keyed bbox width ÷ height (Gemini's proportions)
  targetAspect: number; // outW ÷ outH (the footprint's proportions)
  fillX: number; fillY: number; // the output bbox ÷ the target rectangle, per axis (1 = edge to edge)
}

/** How much of the centred (W × fill) × (H × fill) target rectangle an output's bbox spans, per axis. */
export function measureFill(img: Img, fill: number): { fillX: number; fillY: number } {
  const b = alphaBox(img);
  if (!b) return { fillX: 0, fillY: 0 };
  return { fillX: (b.x1 - b.x0) / (img.width * fill), fillY: (b.y1 - b.y0) / (img.height * fill) };
}

export function processBuilding(src: Img, o: BuildingOptions): BuildingResult {
  const { base, box } = keySprite(src, o.trim ?? 0);
  const targetAspect = o.outW / o.outH;
  if (!box) return { ...base, out: null, aspect: 0, targetAspect, fillX: 0, fillY: 0 };
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const tw = o.outW * o.fill, th = o.outH * o.fill;
  const scale = Math.min(tw / bw, th / bh); // uniform: the limiting axis fills its side exactly
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const sw = o.outW / scale, sh = o.outH / scale;
  const out = resample(base.keyed, cx - sw / 2, cy - sh / 2, sw, sh, o.outW, o.outH, "transparent");
  const limit = tw / bw <= th / bh ? "width" : "height";
  base.steps.push(`Subject box ${bw}×${bh} px → scaled uniformly ×${scale.toFixed(3)} so it fits ${Math.round(tw)}×${Math.round(th)} (${Math.round(o.fill * 100)}% of ${o.outW}×${o.outH}), centred; the ${limit} fills its side.`);
  return { ...base, out, aspect: bw / bh, targetAspect, ...measureFill(out, o.fill) };
}
