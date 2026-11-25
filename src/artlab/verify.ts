// 29 §H — verifying a FINISHED asset file before it is tagged completed. Pure and DOM-free: the
// caller decodes the PNG (src/dev/artcheck/png.ts in Node) and hands over its header facts and
// RGBA pixels. Hard requirements (format, dimensions, alpha) and the 29 §D QA checks that can be
// measured on a processed file both run here; a FAIL anywhere blocks the completed tag.

import { BUILDING_FILL, UNIT_OUT } from "../content/factionArt";
import { PORTRAIT_OUT, SPRITE_FOOTPRINT, SPRITE_OUT, TEX_OUT, assetTone, buildingTiles, unitSpec } from "./catalog";
import type { Asset, BuildingAsset, TextureAsset } from "./catalog";
import { meanRGB, rgbToHex } from "./image";
import type { Img, RGB } from "./image";
import { measureFill } from "./process/building";
import { alphaBox, cleanBorder, edgeTouching, measureFootprint } from "./process/sprite";
import { QA } from "./qa";
import type { Verdict } from "./qa";
import { lightingSpread, paletteDistance, seamRatio } from "./qa/metrics";

/** What the decoder learned about the file, plus its pixels as 8-bit RGBA. */
export interface DecodedPng {
  bytes: number; // file size
  width: number; height: number;
  bitDepth: number; colorType: number; // PNG IHDR values (colour type 6 = RGBA, 2 = RGB, 3 = palette…)
  interlaced: boolean;
  alphaChannel: boolean; // colour type 4/6, or a tRNS chunk
  img: Img;
}

export interface Check { label: string; value: string; expected: string; verdict: Verdict; note: string }
export interface Verification { verdict: Verdict; checks: Check[] }

const RANK: Record<Verdict, number> = { PASS: 0, WARN: 1, FAIL: 2 };
export const worstVerdict = (cs: readonly { verdict: Verdict }[]): Verdict =>
  cs.reduce<Verdict>((v, c) => (RANK[c.verdict] > RANK[v] ? c.verdict : v), "PASS");
const pct = (v: number, d = 1): string => `${(v * 100).toFixed(d)}%`;
function grade(v: number, pass: number, fail: number, higher = false): Verdict {
  if (higher) return v >= pass ? "PASS" : v < fail ? "FAIL" : "WARN";
  return v <= pass ? "PASS" : v > fail ? "FAIL" : "WARN";
}

/** Does the slot need a transparent background (keyed sprites) or a fully opaque image? */
export const needsAlpha = (a: Asset): boolean => a.kind === "sprite" || a.kind === "unit" || a.kind === "building";

/** The exact pixel size the slot's file must have (29 §C). */
export function expectedSize(a: Asset): { w: number; h: number } {
  switch (a.kind) {
    case "texture": return { w: TEX_OUT, h: TEX_OUT };
    case "portrait": return { w: PORTRAIT_OUT, h: PORTRAIT_OUT };
    case "sprite": return { w: SPRITE_OUT[a.sprite], h: SPRITE_OUT[a.sprite] };
    case "unit": return { w: UNIT_OUT, h: UNIT_OUT };
    case "building": return { w: a.outW, h: a.outH };
  }
}

/** A sane upper bound for the file: the raw 8-bit RGBA pixels plus 64 KiB of headers. */
export function maxBytes(a: Asset): number {
  const s = expectedSize(a);
  return s.w * s.h * 4 + 64 * 1024;
}

function alphaStats(img: Img): { min: number; below: number } {
  const d = img.data;
  let min = 255, below = 0;
  for (let i = 3; i < d.length; i += 4) { if (d[i] < min) min = d[i]; if (d[i] < 255) below++; }
  return { min, below };
}

/** The format, size and dimension checks every slot shares. */
function fileChecks(a: Asset, p: DecodedPng): Check[] {
  const s = expectedSize(a), cs: Check[] = [];
  const dimsOk = p.width === s.w && p.height === s.h;
  cs.push({ label: "Dimensions", value: `${p.width}×${p.height}`, expected: `${s.w}×${s.h}`, verdict: dimsOk ? "PASS" : "FAIL",
    note: dimsOk ? "" : `The slot needs exactly ${s.w}×${s.h}. Drop the Gemini output into the Art Lab and save it from there: it resamples to the right size.` });
  const depthOk = p.bitDepth === 8;
  cs.push({ label: "Bit depth", value: `${p.bitDepth}-bit`, expected: "8-bit", verdict: depthOk ? "PASS" : "WARN",
    note: depthOk ? "" : "The game reads it, but the Art Lab writes 8-bit; re-save it as 8-bit for a smaller file." });
  const max = maxBytes(a), sizeOk = p.bytes <= max;
  cs.push({ label: "File size", value: `${Math.ceil(p.bytes / 1024)} KiB`, expected: `≤ ${Math.floor(max / 1024)} KiB`, verdict: sizeOk ? "PASS" : "WARN",
    note: sizeOk ? "" : "The file is larger than its raw pixels, so it carries extra data (metadata, an embedded profile or a thumbnail). Re-save it from the Art Lab." });
  if (needsAlpha(a)) {
    cs.push({ label: "Alpha channel", value: p.alphaChannel ? "yes" : "no", expected: "yes (transparent background)", verdict: p.alphaChannel ? "PASS" : "FAIL",
      note: p.alphaChannel ? "" : "A sprite needs a transparent background. Save the keyed result from the Art Lab, not Gemini's magenta original." });
  } else {
    const { min, below } = alphaStats(p.img);
    const ok = min === 255;
    cs.push({ label: "Opaque", value: ok ? "every pixel" : `${below} px below full alpha (min ${min})`, expected: "every pixel opaque", verdict: ok ? "PASS" : "FAIL",
      note: ok ? "" : `A ${a.kind} is drawn edge to edge, so transparent pixels show as holes in the game. Re-save it without transparency.` });
  }
  return cs;
}

function textureChecks(a: TextureAsset, img: Img): Check[] {
  const cs: Check[] = [];
  const s = seamRatio(img), sv = Math.max(s.x, s.y);
  let v = grade(sv, QA.seam.pass, QA.seam.fail);
  cs.push({ label: "Seam (29 §D)", value: `${sv.toFixed(2)} (x ${s.x.toFixed(2)}, y ${s.y.toFixed(2)})`, expected: `≤ ${QA.seam.pass} pass · > ${QA.seam.fail} fail`, verdict: v,
    note: v === "PASS" ? "" : "A line shows where the texture repeats. Run the Gemini output through the Art Lab, which makes it seamless, or regenerate." });
  const light = lightingSpread(img);
  v = grade(light, QA.lighting.pass, QA.lighting.fail);
  cs.push({ label: "Lighting (29 §D)", value: pct(light), expected: `≤ ${pct(QA.lighting.pass, 0)} pass · > ${pct(QA.lighting.fail, 0)} fail`, verdict: v,
    note: v === "PASS" ? "" : "Light and dark patches will stripe the map when it tiles. The Art Lab flattens lighting; regenerate if that isn't enough." });
  const target = [...assetTone(a).mid] as RGB, pal = paletteDistance(img, target);
  v = grade(pal, QA.palette.pass, QA.palette.fail);
  cs.push({ label: "Palette (29 §D)", value: `${pal.toFixed(1)} (${rgbToHex(meanRGB(img))} vs ${rgbToHex(target)})`, expected: `≤ ${QA.palette.pass} pass · > ${QA.palette.fail} fail`, verdict: v,
    note: v === "PASS" ? "" : "The mean colour is off the biome palette (26 §F). Raise Palette lock in the Art Lab, or regenerate." });
  return cs;
}

/** Subject, clean background, clipping and leftover magenta: shared by sprites, units and buildings (29 §D). */
function keyedChecks(img: Img): { cs: Check[]; found: boolean } {
  const cs: Check[] = [];
  const d = img.data, total = img.width * img.height;
  let subject = 0, magenta = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    subject++;
    if (d[i] > 150 && d[i + 2] > 150 && Math.min(d[i], d[i + 2]) - d[i + 1] > 90) magenta++;
  }
  const found = subject >= total * 0.002;
  cs.push({ label: "Subject", value: `${pct(subject / total)} of the image opaque`, expected: "≥ 0.2%", verdict: found ? "PASS" : "FAIL",
    note: found ? "" : "The image is (almost) fully transparent." });
  const clean = cleanBorder(img);
  let v = grade(clean, QA.cleanBg.pass, QA.cleanBg.fail, true);
  cs.push({ label: "Clean background (29 §D)", value: pct(clean), expected: `≥ ${pct(QA.cleanBg.pass, 0)} pass · < ${pct(QA.cleanBg.fail, 0)} fail`, verdict: v,
    note: v === "PASS" ? "" : "Something that isn't transparent reaches the border ring (a background, a shadow or a glow)." });
  const clipped = edgeTouching(img);
  v = clipped === 0 ? "PASS" : "FAIL";
  cs.push({ label: "Clipped (29 §D)", value: `${clipped} px on the edge`, expected: "none", verdict: v,
    note: v === "PASS" ? "" : "The object touches the image edge, so part of it is cut off." });
  const mag = subject ? magenta / subject : 0;
  v = mag <= 0.005 ? "PASS" : "WARN";
  cs.push({ label: "Magenta left", value: pct(mag, 2), expected: "≤ 0.5%", verdict: v,
    note: v === "PASS" ? "" : "A pink fringe or pink colours survived the key; look at the sprite on the ground." });
  return { cs, found };
}

function footprintCheck(img: Img, spec: number, widthOnly: boolean, found: boolean): Check {
  const fp = measureFootprint(img, widthOnly), ok = found && Math.abs(fp - spec) <= QA.footprintTol;
  return { label: `Footprint (${widthOnly ? "width" : "larger side"})`, value: pct(fp), expected: `${pct(spec, 0)} ± ${pct(QA.footprintTol, 0)}`, verdict: ok ? "PASS" : "WARN",
    note: ok ? "" : "The object is off its spec size, so it looks too big or too small in the game. The Art Lab normalises it." };
}

function buildingChecks(a: BuildingAsset, img: Img, found: boolean): Check[] {
  const cs: Check[] = [];
  const f = measureFill(img, BUILDING_FILL), big = Math.max(f.fillX, f.fillY);
  const fillOk = found && Math.abs(big - 1) <= QA.footprintTol;
  cs.push({ label: "Footprint (bbox ÷ target rectangle)", value: `${pct(f.fillX)} × ${pct(f.fillY)}`, expected: `fuller axis 100% ± ${pct(QA.footprintTol, 0)}`, verdict: fillOk ? "PASS" : "WARN",
    note: fillOk ? "" : "The building doesn't fill its tiles as specified; the Art Lab normalises it." });
  const { w, h } = buildingTiles(a.buildingType), b = alphaBox(img);
  const aspect = b ? (b.x1 - b.x0) / (b.y1 - b.y0) : 0, target = w / h;
  const ratio = aspect > 0 ? aspect / target : 0, rel = ratio > 0 ? Math.max(ratio, 1 / ratio) - 1 : Infinity;
  const v = found ? grade(rel, QA.aspect.pass, QA.aspect.fail) : "FAIL";
  cs.push({ label: `Aspect vs the ${w}×${h} footprint (29 §D)`, value: b ? `${aspect.toFixed(3)} vs ${target.toFixed(3)} (off by ${pct(rel)})` : "—", expected: `≤ ${pct(QA.aspect.pass, 0)} pass · > ${pct(QA.aspect.fail, 0)} fail`, verdict: v,
    note: v === "PASS" ? "" : "The building's proportions don't match its footprint; regenerate keeping the guide's rectangle." });
  return cs;
}

/** Every check for one finished file. The pixel checks run only once the dimensions (and alpha) are right. */
export function verifyAsset(a: Asset, p: DecodedPng): Verification {
  const cs = fileChecks(a, p);
  const s = expectedSize(a);
  if (p.width === s.w && p.height === s.h && !(needsAlpha(a) && !p.alphaChannel)) {
    if (a.kind === "texture") cs.push(...textureChecks(a, p.img));
    else if (a.kind !== "portrait") {
      const { cs: k, found } = keyedChecks(p.img);
      cs.push(...k);
      if (a.kind === "sprite") cs.push(footprintCheck(p.img, SPRITE_FOOTPRINT[a.sprite], a.sprite === "tuft", found));
      else if (a.kind === "unit") cs.push(footprintCheck(p.img, unitSpec(a.unitType).footprint, false, found));
      else cs.push(...buildingChecks(a, p.img, found));
    }
  }
  return { verdict: worstVerdict(cs), checks: cs };
}
