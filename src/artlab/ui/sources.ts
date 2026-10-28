// Art Lab — the ONLY bridge to the game's art modules: guide images (the procedural versions),
// real-file URLs and the "current" version of an asset. Everything else in the Art Lab is pure.

import { BIOMES } from "../../content/biomes";
import type { TexKey } from "../../content/biomes";
import type { BiomeId } from "../../core/types";
import { emblemCanvas, portraitCanvas, realPortraitUrl } from "../../render/portraits";
import { TEX_WORLD, generateSprite, generateTexture, realAssetUrl } from "../../render/terrainArt";
import { GUIDE_SIZE, assetById } from "../catalog";
import type { Asset, SpriteAsset } from "../catalog";
import { canvas, ctx2d, loadImage, toCanvas } from "./dom";

export { TEX_WORLD, emblemCanvas };

export const KEY_HEX = "#FF00FF";

/** URL of the real file for an asset, or null while it is still procedural. */
export function realUrl(a: Asset): string | null {
  return a.kind === "portrait" ? realPortraitUrl(a.charId) : realAssetUrl(a.biome, a.name);
}
export const hasReal = (a: Asset): boolean => realUrl(a) !== null;

const guides = new Map<string, HTMLCanvasElement>();
/** The 1024 guide for an asset (29 §A): the game's procedural version; sprites on flat #FF00FF. */
export function guideCanvas(a: Asset): HTMLCanvasElement {
  const hit = guides.get(a.id);
  if (hit) return hit;
  let c: HTMLCanvasElement;
  if (a.kind === "texture") c = generateTexture(a.biome, a.tex, GUIDE_SIZE);
  else if (a.kind === "portrait") c = portraitCanvas(a.charId, GUIDE_SIZE);
  else {
    c = canvas(GUIDE_SIZE, GUIDE_SIZE);
    const g = ctx2d(c);
    g.fillStyle = KEY_HEX;
    g.fillRect(0, 0, GUIDE_SIZE, GUIDE_SIZE);
    g.drawImage(generateSprite(a.biome, a.sprite, a.index, GUIDE_SIZE), 0, 0, GUIDE_SIZE, GUIDE_SIZE);
  }
  if (guides.size > 12) guides.delete(guides.keys().next().value!);
  guides.set(a.id, c);
  return c;
}

/** The transparent procedural sprite (no magenta) at a size, for previews. */
export function proceduralSprite(a: SpriteAsset, size: number): HTMLCanvasElement {
  return generateSprite(a.biome, a.sprite, a.index, size);
}

/** The asset as the game shows it now: the real file if present, else the procedural version. */
export async function currentImage(a: Asset, size: number): Promise<HTMLCanvasElement> {
  const url = realUrl(a);
  if (url) {
    try { return toCanvas(await loadImage(url), size, size); } catch { /* fall through to procedural */ }
  }
  if (a.kind === "texture") return generateTexture(a.biome, a.tex, size);
  if (a.kind === "sprite") return proceduralSprite(a, size);
  return portraitCanvas(a.charId, size);
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
