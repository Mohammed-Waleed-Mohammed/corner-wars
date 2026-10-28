// 26 — biome GAMEPLAY rules (deterministic; every number mirrors description/26-biomes.md §C).
// Presentation (names, palettes, species, weather) lives in src/content/biomes.ts — render-only.

import type { BiomeId, MoveClass, TerrainType } from "../core/types";

export const BIOME_IDS: readonly BiomeId[] = ["verdant", "saltglass", "frostmarch", "cinder", "mire", "scar"];
export const DEFAULT_BIOME: BiomeId = "verdant";

export interface BiomeRules {
  /** Speed multiplier per terrain type and movement class (× the file-24 base factor). */
  speed?: Partial<Record<TerrainType, Partial<Record<MoveClass, number>>>>;
  coverMult?: number; // × TERRAIN_FX.FOREST_COVER
  sightBonus?: number; // + every unit's sight (tiles; may be negative)
  hillSightBonus?: number; // + on top of TERRAIN_FX.HILL_SIGHT_BONUS
  energyMult?: number; // × Command Energy gain while holding the Citadel
}

const SNOW = { foot: 0.9, wheeled: 0.8, tracked: 0.95 } as const;

export const BIOME_RULES: Record<BiomeId, BiomeRules> = {
  verdant: {},
  saltglass: {
    speed: { ground: { wheeled: 1.1 } },
    coverMult: 0.5,
    sightBonus: 1,
  },
  frostmarch: {
    speed: { ground: SNOW, hill: SNOW, shallows: { foot: 1.2, wheeled: 1.5, tracked: 1.0 } },
  },
  cinder: {
    speed: { shallows: { foot: 0.9, wheeled: 0.9 } },
    coverMult: 0.6,
    hillSightBonus: 1,
  },
  mire: {
    speed: { ground: { wheeled: 0.85, tracked: 0.9 }, shallows: { foot: 1.25, tracked: 0.85 } },
    coverMult: 1.3,
    sightBonus: -1,
  },
  scar: {
    speed: { ground: { tracked: 0.9 } },
    coverMult: 1.2,
    energyMult: 1.25,
  },
};

/** Sight never drops below this from biome modifiers (26 §C mire). */
export const MIN_SIGHT = 3;

/** 26 §B: each official map's default biome. */
export const MAP_DEFAULT_BIOME: Record<string, BiomeId> = {
  duel: "verdant",
  four_corners: "verdant",
  crossfire: "saltglass",
  goldrush: "saltglass",
  divide: "frostmarch",
  bastion: "frostmarch",
  scorched: "cinder",
  junction: "cinder",
  riverline: "mire",
  trident: "mire",
  triad: "scar",
  quadrant: "scar",
};

export function isBiomeId(x: unknown): x is BiomeId {
  return typeof x === "string" && (BIOME_IDS as readonly string[]).includes(x);
}

/** A map's biome (stored, else its official default, else verdant). */
export function biomeOfMap(map: { id: string; biome?: unknown }): BiomeId {
  if (isBiomeId(map.biome)) return map.biome;
  return MAP_DEFAULT_BIOME[map.id] ?? DEFAULT_BIOME;
}
