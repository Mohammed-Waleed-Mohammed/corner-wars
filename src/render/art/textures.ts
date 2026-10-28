// Which procedural material each biome uses for each of the nine textures (26 §A/§D), and the
// rasteriser that turns a material shader into a seamless canvas of any size. Pure + deterministic.

import type { BiomeId } from "../../core/types";
import { BIOMES, TEX_KEYS, type TexKey } from "../../content/biomes";
import { canvas } from "./noise";
import { ash, basalt, dirt, facets, glassRock, grass, litter, mud, rock, sand, saltCrust, snow, snowPatches, type Mat } from "./landTex";
import { bog, caustic, crust, deck, glassShallows, ice, lake, lava, resonant } from "./liquidTex";

const MATERIALS: Record<BiomeId, Record<TexKey, Mat>> = {
  verdant: {
    ground: grass(true),
    forest_floor: litter([[112, 84, 44], [138, 104, 52], [92, 70, 40], [70, 92, 40]], 0.07, true),
    road: dirt(0.04),
    hill: grass(false),
    sand: sand(0),
    shallows: caustic(null),
    water: lake(1),
    mountain: rock(0.1, 0, false),
    bridge: deck("wood"),
  },
  saltglass: {
    ground: saltCrust,
    forest_floor: dirt(0.05, [118, 112, 64]),
    road: dirt(0.05),
    hill: rock(0.03, 0, false),
    sand: sand(0.01),
    shallows: caustic([236, 230, 214]),
    water: lake(0.8),
    mountain: rock(0.04, 0, false),
    bridge: deck("wood"),
  },
  frostmarch: {
    ground: snow(1),
    forest_floor: litter([[56, 70, 52], [80, 70, 56], [44, 56, 48]], 0.06, false),
    road: snowPatches(0.72, 0.06),
    hill: snow(1.4),
    sand: snowPatches(0.5, 0.03),
    shallows: ice,
    water: lake(0.55),
    mountain: rock(0.06, 0.58, false),
    bridge: deck("iron"),
  },
  cinder: {
    ground: ash(0.0028, 0.012),
    forest_floor: ash(0.0018, 0.07),
    road: dirt(0.14, [96, 44, 30]),
    hill: basalt,
    sand: sand(0.012),
    shallows: crust,
    water: lava,
    mountain: glassRock([120, 112, 130], false),
    bridge: deck("stone"),
  },
  mire: {
    ground: mud(0.02),
    forest_floor: litter([[60, 78, 34], [84, 96, 44], [52, 44, 30]], 0.08, true),
    road: dirt(0.03, [104, 82, 52]),
    hill: grass(false),
    sand: mud(0.01),
    shallows: bog(1),
    water: bog(0.55),
    mountain: rock(0.04, 0, true),
    bridge: deck("weathered"),
  },
  scar: {
    ground: facets(9, 1),
    forest_floor: litter([[170, 130, 240], [200, 170, 255], [120, 90, 190]], 0.03, false),
    road: facets(5, 0.45),
    hill: facets(7, 1.5),
    sand: sand(0.02),
    shallows: glassShallows,
    water: resonant(1),
    mountain: glassRock([188, 150, 255], true),
    bridge: deck("glass"),
  },
};

/** Render a biome material into a new size × size canvas: seamless, evenly lit, deterministic. */
export function renderTexture(biome: BiomeId, key: TexKey, size: number): HTMLCanvasElement {
  size = Math.max(8, Math.round(size));
  const seed = 1009 * (BIOME_INDEX[biome] + 1) + 131 * (TEX_KEYS.indexOf(key) + 1);
  const shader = MATERIALS[biome][key](BIOMES[biome].palette[key], seed);
  const c = canvas(size, size);
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  const d = img.data, o = [0, 0, 0], inv = 1 / size;
  for (let y = 0, i = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++, i += 4) {
      shader((x + 0.5) * inv, v, o);
      d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = 255; // Uint8Clamped rounds + clamps
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const BIOME_INDEX: Record<BiomeId, number> = { verdant: 0, saltglass: 1, frostmarch: 2, cinder: 3, mire: 4, scar: 5 };
