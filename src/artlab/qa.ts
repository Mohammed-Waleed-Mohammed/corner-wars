// 29 §D — QA: every metric with its threshold and a PASS / WARN / FAIL verdict. A FAIL blocks saving
// and its note names the fix. Measured on the processed images. Pure.

import { meanRGB, rgbToHex } from "./image";
import type { Img, RGB } from "./image";
import type { PortraitResult, SpriteResult, TextureResult } from "./process";
import { cornerArtefact, lightingSpread, paletteDistance, repetition, seamRatio } from "./qa/metrics";

export type Verdict = "PASS" | "WARN" | "FAIL";
export interface Metric { label: string; value: string; threshold: string; verdict: Verdict; note: string }
export interface QAReport { metrics: Metric[]; verdict: Verdict }

/** 29 §D thresholds. */
export const QA = {
  seam: { pass: 1.6, fail: 2.5 },
  lighting: { pass: 0.12, fail: 0.25 },
  repetition: { pass: 0.65, fail: 0.5 },
  palette: { pass: 28, fail: 60 },
  cleanBg: { pass: 0.98, fail: 0.9 },
  footprintTol: 0.03,
} as const;

const RANK: Record<Verdict, number> = { PASS: 0, WARN: 1, FAIL: 2 };
const worst = (ms: readonly Metric[]): Verdict => ms.reduce<Verdict>((v, m) => (RANK[m.verdict] > RANK[v] ? m.verdict : v), "PASS");
/** Grade a value: lower is better unless `higher`. */
function grade(v: number, pass: number, fail: number, higher = false): Verdict {
  if (higher) return v >= pass ? "PASS" : v < fail ? "FAIL" : "WARN";
  return v <= pass ? "PASS" : v > fail ? "FAIL" : "WARN";
}
const pct = (v: number, d = 1): string => `${(v * 100).toFixed(d)}%`;
const report = (metrics: Metric[]): QAReport => ({ metrics, verdict: worst(metrics) });

function sourceChecks(srcW: number, srcH: number, cropLoss: number, minSide: number): Metric[] {
  const side = Math.min(srcW, srcH);
  return [
    { label: "Square source", value: `${srcW}×${srcH} (crop removed ${pct(cropLoss, 0)})`, threshold: "crop ≤ 5% (info)", verdict: cropLoss <= 0.05 ? "PASS" : "WARN",
      note: cropLoss <= 0.05 ? "" : "Gemini didn't return a square, so the centre crop cut part of the picture. Check the framing; ask again for exactly 1024 × 1024 if anything important was lost." },
    { label: "Source resolution", value: `${side} px short side`, threshold: `≥ ${minSide} px (info)`, verdict: side >= minSide ? "PASS" : "WARN",
      note: side >= minSide ? "" : `The image was upscaled to the working size and will look soft. Regenerate at ${minSide} × ${minSide}.` },
  ];
}

// ── textures ────────────────────────────────────────────────────────────────────────────────────
export interface TextureQAOptions { target: RGB; lock: number; bridge: boolean; guide?: Img /* guide at 512, for context */ }

export function qaTexture(r: TextureResult, o: TextureQAOptions): QAReport {
  const g = o.guide;
  const guideNote = (v: string): string => (g ? ` Guide: ${v}.` : "");
  const s = seamRatio(r.out), sv = Math.max(s.x, s.y);
  const light = lightingSpread(r.out);
  const axes = o.bridge ? (["x"] as const) : (["x", "y"] as const);
  const rep = repetition(r.preSeam, axes), repFinal = repetition(r.out, axes);
  const pal = paletteDistance(r.out, o.target);
  const corner = cornerArtefact(r.preSeam);
  const ms: Metric[] = [];

  let v = grade(sv, QA.seam.pass, QA.seam.fail);
  ms.push({ label: "Seam (wrap-edge block difference ÷ typical neighbour difference)", value: `${sv.toFixed(2)} (x ${s.x.toFixed(2)}, y ${s.y.toFixed(2)})`, threshold: `≤ ${QA.seam.pass} pass · > ${QA.seam.fail} fail`, verdict: v,
    note: v === "FAIL" ? "A feature crosses the border in a way the blend cannot hide — usually a seam inside Gemini's own picture (a collage or 2×2 preview). Regenerate with the guide attached as Image 1." : v === "WARN" ? "Check the 3×3 preview for a visible line at the tile borders." : "" });

  v = grade(light, QA.lighting.pass, QA.lighting.fail);
  ms.push({ label: "Lighting (max − min of 4×4 cell means ÷ mean)", value: pct(light), threshold: `≤ ${pct(QA.lighting.pass, 0)} pass · > ${pct(QA.lighting.fail, 0)} fail`, verdict: v,
    note: (v === "FAIL" ? "Gemini painted glare, a hotspot or a gradient too strong to flatten. Regenerate: re-run with the guide attached as Image 1 and the prompt unchanged (it forbids glare and gradients)." : v === "WARN" ? "Large light/dark patches remain after flattening; check the 3×3 preview for stripes or blotches." : "") + guideNote(pct(lightingSpread(g ?? r.out))) });

  v = grade(rep.ratio, QA.repetition.pass, QA.repetition.fail, true);
  ms.push({ label: `Internal repetition (lowest ÷ median shift difference, shifts 15–85%${o.bridge ? ", x only: plank rows repeat by design" : ""})`, value: `${rep.ratio.toFixed(2)} (min ${rep.min.toFixed(1)} / median ${rep.median.toFixed(1)} at a ${pct(rep.worstShift, 0)} ${rep.worstAxis} shift)`, threshold: `≥ ${QA.repetition.pass} pass · < ${QA.repetition.fail} fail`, verdict: v,
    note: (v === "FAIL" ? `Regenerate: Gemini repeated part of the image (it matches itself at a ${pct(rep.worstShift, 0)} ${rep.worstAxis} shift). No filter can fix this.` : v === "WARN" ? "Part of the image may be repeated; look for copied patches in the 3×3 preview." : "") +
      ` Measured on Gemini's content before the seamless blend (the blend itself mirrors the outer ~10% by design; after it: ${repFinal.ratio.toFixed(2)}).${guideNote(repetition(g ?? r.out, axes).ratio.toFixed(2))}` });

  v = grade(pal, QA.palette.pass, QA.palette.fail);
  ms.push({ label: "Palette distance (mean RGB to target mid, Euclidean)", value: `${pal.toFixed(1)} (${rgbToHex(meanRGB(r.out))} vs ${rgbToHex(o.target)}; before lock ${r.paletteBefore.toFixed(0)})`, threshold: `≤ ${QA.palette.pass} pass · > ${QA.palette.fail} fail`, verdict: v,
    note: v === "PASS" ? "" : `The colours are off the biome palette. Raise Palette lock (now ${Math.round(o.lock * 100)}%) toward 100%, or regenerate — the prompt gives the exact hex colours.` });

  const cv = corner.z > 5 && corner.delta > 40 ? "WARN" : "PASS";
  ms.push({ label: "Corner artefact (bottom-right peak vs other blocks)", value: `z ${corner.z.toFixed(1)}, +${corner.delta.toFixed(0)} levels`, threshold: "z ≤ 5 (info)", verdict: cv,
    note: cv === "PASS" ? "" : "Something bright sits in the bottom-right corner — probably a watermark. Set Trim to 6% and process again, or regenerate." });

  ms.push(...sourceChecks(r.srcW, r.srcH, r.cropLoss, 1024));
  return report(ms);
}


// ── sprites ─────────────────────────────────────────────────────────────────────────────────────
export function qaSprite(r: SpriteResult, o: { footprint: number; baseAtBottom: boolean }): QAReport {
  const ms: Metric[] = [];
  const total = r.keyed.width * r.keyed.height;
  const found = r.out !== null && r.subjectPx >= total * 0.002;
  ms.push({ label: "Subject found", value: `${pct(r.subjectPx / total)} of the image opaque`, threshold: "≥ 0.2%", verdict: found ? "PASS" : "FAIL",
    note: found ? "" : "Nothing was keyed as the object: the background is not #FF00FF, or the object is magenta. Regenerate with the guide attached as Image 1." });

  let v = grade(r.cleanBg, QA.cleanBg.pass, QA.cleanBg.fail, true);
  ms.push({ label: "Clean background (border ring keyed transparent)", value: pct(r.cleanBg), threshold: `≥ ${pct(QA.cleanBg.pass, 0)} pass · < ${pct(QA.cleanBg.fail, 0)} fail`, verdict: v,
    note: v === "PASS" ? "" : `The background isn't flat magenta near the edges (key colour found: ${rgbToHex(r.key)}): a gradient, texture, cast shadow, glow or ground reaches the border. ${v === "FAIL" ? "Regenerate; the prompt requires flat #FF00FF everywhere outside the object." : "Check the keyed result for leftover haze."}` });

  v = r.clippedPx === 0 ? "PASS" : "FAIL";
  ms.push({ label: "Clipped (opaque pixels on the image edge)", value: `${r.clippedPx} px`, threshold: "none", verdict: v,
    note: v === "PASS" ? "" : "The object touches the image edge, so part of it is cut off. Regenerate: keep the guide's footprint with at least a 4% magenta margin on every side." });

  const err = Math.abs(r.footprint - o.footprint);
  v = found && err <= QA.footprintTol ? "PASS" : "WARN";
  ms.push({ label: `Footprint after normalising (${o.baseAtBottom ? "width" : "larger side"})`, value: pct(r.footprint), threshold: `${pct(o.footprint, 0)} ± ${pct(QA.footprintTol, 0)}`, verdict: v,
    note: v === "PASS" ? "" : r.heightClamped ? "The tuft is too tall for its width, so it was shrunk to fit the height. Regenerate with a wider, shorter tuft like the guide." : "The normalised size is off-spec; check the keyed result for stray pixels." });

  const mag = r.subjectPx ? r.magentaPx / r.subjectPx : 0;
  v = mag <= 0.005 ? "PASS" : "WARN";
  ms.push({ label: "Magenta left in the object", value: pct(mag, 2), threshold: "≤ 0.5% (info)", verdict: v,
    note: v === "PASS" ? "" : "A magenta fringe or halo, or pink colours inside the object, survived the key. Look at the result on the ground; regenerate if a pink edge shows." });

  v = r.specks === 0 ? "PASS" : "WARN";
  ms.push({ label: "Detached specks removed", value: `${r.specks}${r.specks ? ` (${r.speckPx} px)` : ""}`, threshold: "0 (info)", verdict: v,
    note: v === "PASS" ? "" : "Small detached pieces were deleted (a watermark, particles or floating leaves). Make sure nothing that belongs to the object was lost." });

  ms.push(...sourceChecks(r.keyed.width, r.keyed.height, 1 - Math.min(r.keyed.width, r.keyed.height) ** 2 / total, 1024).slice(1));
  return report(ms);
}

// ── portraits (29 §D sets no hard thresholds: these are WARN-only checks) ──────────────────────
export function qaPortrait(r: PortraitResult, o: { backdrop: RGB }): QAReport {
  const v: Verdict = r.backdropDist <= 40 ? "PASS" : "WARN";
  return report([
    ...sourceChecks(r.srcW, r.srcH, r.cropLoss, 1024),
    { label: "Backdrop colour (top and side bands)", value: `${rgbToHex(r.backdrop)} (distance ${r.backdropDist.toFixed(0)} to ${rgbToHex(o.backdrop)})`, threshold: "≤ 40 (info)", verdict: v,
      note: v === "PASS" ? "" : "The backdrop isn't the faction's dark colour (scenery, a bright backdrop or a wrong hue). Regenerate if it doesn't match the other portraits." },
  ]);
}
