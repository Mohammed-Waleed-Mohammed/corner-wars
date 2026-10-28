// Art Lab — the ONLY bridge to the game's art modules: guide images (the procedural versions),
// real-file URLs and the "current" version of an asset. Everything else in the Art Lab is pure.

import { BIOMES } from "../../content/biomes";
import type { TexKey } from "../../content/biomes";
import type { BiomeId } from "../../core/types";
import { emblemCanvas, portraitCanvas, realPortraitUrl } from "../../render/portraits";
import { TEX_WORLD, generateSprite, generateTexture, realAssetUrl } from "../../render/terrainArt";
import { generateBuildingSprite, generateUnitSprite, realBuildingUrl, realUnitUrl } from "../../render/unitArt";
import { GUIDE_SIZE, assetById, buildingGuideRect, buildingTiles } from "../catalog";
import type { Asset, BuildingAsset, SpriteAsset, UnitAsset } from "../catalog";
import { canvas, ctx2d, loadImage, toCanvas } from "./dom";

export { TEX_WORLD, emblemCanvas };

export const KEY_HEX = "#FF00FF";

/** URL of the real file for an asset, or null while it is still procedural. */
export function realUrl(a: Asset): string | null {
  switch (a.kind) {
    case "portrait": return realPortraitUrl(a.charId);
    case "unit": return realUnitUrl(a.faction, a.unitType);
    case "building": return realBuildingUrl(a.faction, a.buildingType);
    default: return realAssetUrl(a.biome, a.name);
  }
}
export const hasReal = (a: Asset): boolean => realUrl(a) !== null;

/** A GUIDE_SIZE canvas of flat #FF00FF with `img` drawn into (x, y, w, h). */
function onKey(img: CanvasImageSource, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const c = canvas(GUIDE_SIZE, GUIDE_SIZE), g = ctx2d(c);
  g.fillStyle = KEY_HEX;
  g.fillRect(0, 0, GUIDE_SIZE, GUIDE_SIZE);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, x, y, w, h);
  return c;
}

const guides = new Map<string, HTMLCanvasElement>();
/**
 * The 1024 guide for an asset (29 §A): the game's procedural version. Sprites and units fill the
 * square on flat #FF00FF; a building is drawn at a whole number of px per tile, its larger side
 * ≈ 90% of the canvas, centred on #FF00FF (catalog buildingGuideRect).
 */
export function guideCanvas(a: Asset): HTMLCanvasElement {
  const hit = guides.get(a.id);
  if (hit) return hit;
  let c: HTMLCanvasElement;
  switch (a.kind) {
    case "texture": c = generateTexture(a.biome, a.tex, GUIDE_SIZE); break;
    case "portrait": c = portraitCanvas(a.charId, GUIDE_SIZE); break;
    case "sprite": c = onKey(generateSprite(a.biome, a.sprite, a.index, GUIDE_SIZE), 0, 0, GUIDE_SIZE, GUIDE_SIZE); break;
    case "unit": c = onKey(generateUnitSprite(a.faction, a.unitType, GUIDE_SIZE), 0, 0, GUIDE_SIZE, GUIDE_SIZE); break;
    case "building": {
      const r = buildingGuideRect(a.buildingType);
      c = onKey(generateBuildingSprite(a.faction, a.buildingType, r.pxPerTile), r.x, r.y, r.w, r.h);
      break;
    }
  }
  if (guides.size > 12) guides.delete(guides.keys().next().value!);
  guides.set(a.id, c);
  return c;
}

/** The transparent procedural sprite (no magenta) at a size, for previews. */
export function proceduralSprite(a: SpriteAsset, size: number): HTMLCanvasElement {
  return generateSprite(a.biome, a.sprite, a.index, size);
}

/** The transparent procedural unit (faces UP) on a size × size canvas. */
export function proceduralUnit(a: UnitAsset, size: number): HTMLCanvasElement {
  return generateUnitSprite(a.faction, a.unitType, size);
}

/** The transparent procedural building on a (w × pxPerTile) × (h × pxPerTile) canvas. */
export function proceduralBuilding(a: BuildingAsset, pxPerTile: number): HTMLCanvasElement {
  return generateBuildingSprite(a.faction, a.buildingType, pxPerTile);
}

/** A building as the game shows it now, at pxPerTile: the real file scaled to its footprint, else procedural. */
export async function currentBuilding(a: BuildingAsset, pxPerTile: number): Promise<HTMLCanvasElement> {
  const url = realUrl(a);
  if (url) {
    const { w, h } = buildingTiles(a.buildingType);
    try { return toCanvas(await loadImage(url), Math.round(w * pxPerTile), Math.round(h * pxPerTile)); } catch { /* fall through to procedural */ }
  }
  return proceduralBuilding(a, pxPerTile);
}

/**
 * The asset as the game shows it now: the real file if present, else the procedural version.
 * `size` is the square side; for a building it is the LARGER side (the canvas keeps the footprint's
 * proportions).
 */
export async function currentImage(a: Asset, size: number): Promise<HTMLCanvasElement> {
  if (a.kind === "building") {
    const { w, h } = buildingTiles(a.buildingType);
    return currentBuilding(a, size / Math.max(w, h));
  }
  const url = realUrl(a);
  if (url) {
    try { return toCanvas(await loadImage(url), size, size); } catch { /* fall through to procedural */ }
  }
  switch (a.kind) {
    case "texture": return generateTexture(a.biome, a.tex, size);
    case "sprite": return proceduralSprite(a, size);
    case "unit": return proceduralUnit(a, size);
    case "portrait": return portraitCanvas(a.charId, size);
  }
}

/** Current texture of a biome material (for sprite previews and the biome sheet). */
export function currentTexture(biome: BiomeId, k: TexKey, size = 512): Promise<HTMLCanvasElement> {
  return currentImage(assetById(`${biome}/${k}`)!, size);
}

/** Display label for the current version of an asset. */
export function currentLabel(a: Asset): string {
  return hasReal(a) ? "real file" : "procedural";
}

export function biomeName(b: BiomeId): string { return BIOMES[b].name; }
