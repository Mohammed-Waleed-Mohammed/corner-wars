// 29 §B step 6 — faction building sprites: the generation order, titles and every size a building
// has (footprint tiles, processed output, the guide's rectangle, in-game size). What each building
// LOOKS like lives in content/factionArt.ts (BUILDING_ART, FACTION_LOOK). DOM-free.

import { BUILDING_LABEL, BUILDING_STATS, TILE_SIZE } from "../../config/constants";
import { ART_BUILDING_TYPES, BUILDING_ART, BUILDING_PX_PER_TILE } from "../../content/factionArt";
import type { ArtBuildingType, BuildingArtSpec } from "../../content/factionArt";
import { FACTIONS } from "../../content/factions";
import type { FactionId } from "../../core/types";
import { GUIDE_SIZE } from "./types";

/** Buildings within a faction: the Construction Yard first (the faction anchor), then ART_BUILDING_TYPES order. */
export const BUILDING_ORDER: readonly ArtBuildingType[] = ["constructionYard", ...ART_BUILDING_TYPES.filter((t) => t !== "constructionYard")];

/** In the 1024 guide, the footprint rectangle's larger side spans this fraction of the canvas. */
export const GUIDE_RECT = 0.9;

export function buildingSpec(t: ArtBuildingType): BuildingArtSpec { return BUILDING_ART[t]; }

/** Footprint in tiles (BUILDING_STATS). */
export function buildingTiles(t: ArtBuildingType): { w: number; h: number } {
  const s = BUILDING_STATS[t];
  return { w: s.width, h: s.height };
}

/** Processed output size: footprint × BUILDING_PX_PER_TILE (a 3×2 War Factory → 288 × 192). */
export function buildingOut(t: ArtBuildingType): { outW: number; outH: number } {
  const { w, h } = buildingTiles(t);
  return { outW: w * BUILDING_PX_PER_TILE, outH: h * BUILDING_PX_PER_TILE };
}

/**
 * The footprint rectangle in the 1024 guide: a whole number of px per tile, the larger side ≈ 90%
 * of the canvas, centred (3 × 2 tiles → 307 px per tile → 921 × 614 px at x 52, y 205).
 */
export function buildingGuideRect(t: ArtBuildingType): { pxPerTile: number; w: number; h: number; x: number; y: number } {
  const { w, h } = buildingTiles(t);
  const pxPerTile = Math.floor((GUIDE_SIZE * GUIDE_RECT) / Math.max(w, h));
  const rw = w * pxPerTile, rh = h * pxPerTile;
  return { pxPerTile, w: rw, h: rh, x: Math.round((GUIDE_SIZE - rw) / 2), y: Math.round((GUIDE_SIZE - rh) / 2) };
}

/** Size in world px at zoom 1 (TILE_SIZE px per tile). */
export function buildingGamePx(t: ArtBuildingType): { w: number; h: number } {
  const { w, h } = buildingTiles(t);
  return { w: w * TILE_SIZE, h: h * TILE_SIZE };
}

/** "Concord Construction Yard". */
export function buildingTitle(f: FactionId, t: ArtBuildingType): string {
  return `${FACTIONS[f].short} ${BUILDING_LABEL[t]}`;
}
