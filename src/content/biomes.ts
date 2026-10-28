// 26 §A/§D/§F — biome PRESENTATION (render + UI + Art Lab). Nothing here touches the sim; the
// gameplay modifiers are in src/config/biomes.ts. Palettes mirror description/26-biomes.md §F.

import type { BiomeId, TerrainType } from "../core/types";

export type RGB = [number, number, number];
export interface Tone { dark: RGB; mid: RGB; light: RGB }

/** The nine tileable materials every biome provides (file 29 §A). */
export type TexKey = "ground" | "forest_floor" | "road" | "hill" | "sand" | "shallows" | "water" | "mountain" | "bridge";
export const TEX_KEYS: readonly TexKey[] = ["ground", "forest_floor", "road", "hill", "sand", "shallows", "water", "mountain", "bridge"];

export type SpriteKind = "tree" | "rock" | "bush" | "tuft";
export const SPRITE_COUNT: Record<SpriteKind, number> = { tree: 6, rock: 4, bush: 3, tuft: 3 };

export type TreeSpecies =
  | "oak" | "bushy" | "beech" | "birch" | "pine" | "fir"
  | "palm" | "acacia" | "cactus" | "thorn"
  | "snowSpruce" | "bareBirch" | "larch" | "dwarfPine"
  | "charred" | "burntPine" | "ashFern"
  | "mangrove" | "willow" | "cypress" | "reeds"
  | "crystal" | "glassTree" | "crystalDead";
export type RockStyle = "granite" | "sandstone" | "iceCap" | "basalt" | "mossy" | "obsidian";
export type BushSpecies =
  | "flowering" | "boxwood" | "fern"
  | "saltbush" | "tumbleweed" | "dryShrub"
  | "snowShrub"
  | "ashFern" | "deadShrub" | "emberMoss"
  | "reedClump" | "cattail" | "lilyMat"
  | "crystalSprout";
export type TuftSpecies = "grass" | "dryGrass" | "frostGrass" | "ashGrass" | "reed" | "crystalGrass";
export type WaterStyle = "lake" | "ice" | "lava" | "bog" | "resonant";
export type WeatherKind = "seeds" | "dust" | "snow" | "ash" | "mist" | "motes";

export interface BiomeDef {
  id: BiomeId;
  name: string;
  region: string; // file 25 §E
  tagline: string;
  description: string;
  shards: string[]; // the Fallen named in this region
  tileNames: Record<TerrainType, string>;
  palette: Record<TexKey, Tone>;
  trees: readonly [TreeSpecies, TreeSpecies, TreeSpecies, TreeSpecies, TreeSpecies, TreeSpecies];
  rock: RockStyle;
  rockTone: Tone;
  bushes: readonly [BushSpecies, BushSpecies, BushSpecies];
  tuft: TuftSpecies;
  tuftTone: Tone;
  foliage: Tone; // tree canopy palette base
  water: WaterStyle;
  weather: WeatherKind;
  grade: string | null; // multiply colour over the static terrain (null = none)
  shadow: RGB; // cast-shadow tint
  cliff: RGB; // mountain south-face colour
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const scale = (c: RGB, f: number): RGB => [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f))];
/** A tone from its mid hex (26 §F); dark/light derived unless given. */
function tone(mid: string, darkF = 0.72, lightF = 1.24, dark?: string, light?: string): Tone {
  const m = hex(mid);
  return { dark: dark ? hex(dark) : scale(m, darkF), mid: m, light: light ? hex(light) : scale(m, lightF) };
}
export const rgbHex = (c: RGB): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export const BIOMES: Record<BiomeId, BiomeDef> = {
  verdant: {
    id: "verdant", name: "Verdant Reach", region: "Temperate river valleys",
    tagline: "The last green country.",
    description: "River valleys and old farmland, the most ordinary land left after the Fall. Canton heartland. Woods give cover, lakes block the way, and the roads run straight to the shard.",
    shards: ["Ashby", "Greywater"],
    tileNames: { ground: "Meadow", road: "Dirt road", bridge: "Timber bridge", hill: "Grassy hill", forest: "Woodland", shallows: "Shallows", water: "Lake", mountain: "Granite mountain", rock: "Boulders", void: "—" },
    palette: {
      ground: tone("#486830", 0.72, 1.32), forest_floor: tone("#304222"), road: tone("#826846"), hill: tone("#6c8436", 0.74, 1.3),
      sand: tone("#c0ac7a"), shallows: tone("#4e8a8e"), water: tone("#1c4664", 0.7, 1.35), mountain: tone("#6c6252", 0.68, 1.3), bridge: tone("#7a5636"),
    },
    trees: ["oak", "bushy", "beech", "birch", "pine", "fir"],
    rock: "granite", rockTone: tone("#8a847a", 0.6, 1.3),
    bushes: ["flowering", "boxwood", "fern"],
    tuft: "grass", tuftTone: tone("#5f8a3a", 0.7, 1.4),
    foliage: tone("#46703a", 0.62, 1.45),
    water: "lake", weather: "seeds", grade: null, shadow: [8, 16, 6], cliff: [40, 34, 28],
  },
  saltglass: {
    id: "saltglass", name: "Saltglass", region: "Salt desert",
    tagline: "Where the sky fell first.",
    description: "The great salt desert around Ground Zero. The Fall's heat fused the crust into glass. Flat, open and bright, so wheels run fast and you can see far. Scrub hides little, and every well is worth a war.",
    shards: ["Kessel", "Meridian Flat"],
    tileNames: { ground: "Salt hardpan", road: "Caliche track", bridge: "Plank bridge", hill: "Mesa", forest: "Scrub & palms", shallows: "Salt marsh", water: "Brine pool", mountain: "Red sandstone", rock: "Salt pillars", void: "—" },
    palette: {
      ground: tone("#cdb991", 0.8, 1.12), forest_floor: tone("#8a7a52"), road: tone("#a88a62"), hill: tone("#c09a6a", 0.78, 1.14),
      sand: tone("#e8dcc0", 0.86, 1.06), shallows: tone("#7fb2a6"), water: tone("#2f6f78", 0.7, 1.3), mountain: tone("#9a5a3c", 0.66, 1.3), bridge: tone("#8a6844"),
    },
    trees: ["palm", "palm", "acacia", "acacia", "cactus", "thorn"],
    rock: "sandstone", rockTone: tone("#c8a882", 0.62, 1.15),
    bushes: ["saltbush", "tumbleweed", "dryShrub"],
    tuft: "dryGrass", tuftTone: tone("#b6a058", 0.7, 1.25),
    foliage: tone("#6c7a3a", 0.62, 1.4),
    water: "lake", weather: "dust", grade: "#fff0d8", shadow: [60, 40, 20], cliff: [96, 52, 34],
  },
  frostmarch: {
    id: "frostmarch", name: "Frostmarch", region: "Sub-arctic tundra",
    tagline: "Cold enough to keep secrets.",
    description: "Snowfields, spruce forest and lakes that never quite freeze. The Concord Remnant's fortress country. Snow slows anything off the cleared roads, but frozen shallows are faster to cross than open water.",
    shards: ["Hold Varga", "Coldwater"],
    tileNames: { ground: "Snowfield", road: "Cleared road", bridge: "Iron-braced bridge", hill: "Snowdrift ridge", forest: "Snow-laden spruce", shallows: "Frozen shallows", water: "Icy lake", mountain: "Glacier rock", rock: "Ice-capped boulders", void: "—" },
    palette: {
      ground: tone("#dfe6ee", 0.86, 1.05, "#c4ccd6"), forest_floor: tone("#b8c4cc", 0.8, 1.08), road: tone("#8c8a86"), hill: tone("#eef2f6", 0.9, 1.04, "#d2d8e0"),
      sand: tone("#c8d0d4", 0.86, 1.06), shallows: tone("#a8c8dc", 0.84, 1.1), water: tone("#1e3a52", 0.7, 1.35), mountain: tone("#7c8894", 0.66, 1.28), bridge: tone("#6a5444"),
    },
    trees: ["snowSpruce", "snowSpruce", "snowSpruce", "bareBirch", "larch", "dwarfPine"],
    rock: "iceCap", rockTone: tone("#8a929c", 0.6, 1.4),
    bushes: ["snowShrub", "snowShrub", "snowShrub"],
    tuft: "frostGrass", tuftTone: tone("#9aa88a", 0.7, 1.35),
    foliage: tone("#2e4a3c", 0.65, 1.5),
    water: "ice", weather: "snow", grade: "#dde9ff", shadow: [30, 40, 60], cliff: [70, 80, 96],
  },
  cinder: {
    id: "cinder", name: "Cinder Coast", region: "Volcanic arc",
    tagline: "The ground still remembers the impact.",
    description: "A volcanic arc that two shard impacts woke up. Black ash plains, rivers of lava and forests burned to the trunk. High basalt rises see for miles. The cooling crust underfoot is slower than it looks.",
    shards: ["Pyre", "Obsidian Gate"],
    tileNames: { ground: "Ash plain", road: "Cinder track", bridge: "Basalt-block bridge", hill: "Basalt rise", forest: "Charred forest", shallows: "Cooling crust", water: "Lava", mountain: "Obsidian ridge", rock: "Lava rock", void: "—" },
    palette: {
      ground: tone("#3a3634", 0.74, 1.3), forest_floor: tone("#2a2422"), road: tone("#5a4c44"), hill: tone("#4a4440", 0.72, 1.3),
      sand: tone("#2e2a28", 0.8, 1.3), shallows: tone("#5a3a2a", 0.7, 1.5, undefined, "#a8522a"), water: tone("#d2541e", 0.6, 1.25, "#7a1a08", "#ffb040"),
      mountain: tone("#2a2628", 0.7, 1.5), bridge: tone("#4a3a30"),
    },
    trees: ["charred", "charred", "charred", "burntPine", "burntPine", "ashFern"],
    rock: "basalt", rockTone: tone("#3c3836", 0.6, 1.5),
    bushes: ["ashFern", "deadShrub", "emberMoss"],
    tuft: "ashGrass", tuftTone: tone("#6a625a", 0.7, 1.35),
    foliage: tone("#2a2624", 0.7, 1.6),
    water: "lava", weather: "ash", grade: "#ffe0cc", shadow: [10, 6, 4], cliff: [22, 16, 14],
  },
  mire: {
    id: "mire", name: "Mirelands", region: "Marsh delta",
    tagline: "Every channel is somebody's road.",
    description: "A vast southern delta of marsh, mangrove and flooded towns, home of the Canton river-folk. Mud bogs down vehicles and mist shortens sight. Infantry who know the channels wade the bogs faster than tanks can.",
    shards: ["Lantern", "Deepfen"],
    tileNames: { ground: "Mudflat", road: "Boardwalk causeway", bridge: "Pile bridge", hill: "Hummock", forest: "Mangrove", shallows: "Bog", water: "Bog water", mountain: "Old levee", rock: "Mossy ruins", void: "—" },
    palette: {
      ground: tone("#4c4a2e", 0.74, 1.3), forest_floor: tone("#2c3420"), road: tone("#6a5638"), hill: tone("#5c6034", 0.74, 1.28),
      sand: tone("#7a6a48"), shallows: tone("#4a5a3a"), water: tone("#26301e", 0.7, 1.45), mountain: tone("#4a4a3a", 0.7, 1.35), bridge: tone("#5a4630"),
    },
    trees: ["mangrove", "mangrove", "willow", "willow", "cypress", "reeds"],
    rock: "mossy", rockTone: tone("#6a6a58", 0.6, 1.3),
    bushes: ["reedClump", "cattail", "lilyMat"],
    tuft: "reed", tuftTone: tone("#7a8a4a", 0.7, 1.3),
    foliage: tone("#3c5a2c", 0.62, 1.45),
    water: "bog", weather: "mist", grade: "#e2eedb", shadow: [10, 14, 6], cliff: [34, 34, 24],
  },
  scar: {
    id: "scar", name: "The Scar", region: "Crystal wasteland",
    tagline: "Where the Song is loudest.",
    description: "The land around Ground Zero and the oldest shards, slowly turning to violet crystal. Resonance runs strongest here, so Command Energy flows faster. Crystal groves turn bullets aside, and the glassed earth cracks under heavy treads.",
    shards: ["Halo", "Thornspire"],
    tileNames: { ground: "Glassed earth", road: "Glass road", bridge: "Crystal span", hill: "Crystal rise", forest: "Crystal grove", shallows: "Glass shallows", water: "Resonant pool", mountain: "Crystal massif", rock: "Crystal shards", void: "—" },
    palette: {
      ground: tone("#5a5070", 0.72, 1.3), forest_floor: tone("#3c3450"), road: tone("#7a7090"), hill: tone("#6c5a88", 0.72, 1.3),
      sand: tone("#9a90b0"), shallows: tone("#6a58a0", 0.72, 1.4), water: tone("#3a1e6a", 0.66, 1.6, undefined, "#9a6cf0"), mountain: tone("#3c3048", 0.7, 1.5), bridge: tone("#5a5068"),
    },
    trees: ["crystal", "crystal", "crystal", "glassTree", "glassTree", "crystalDead"],
    rock: "obsidian", rockTone: tone("#3a3046", 0.6, 1.8),
    bushes: ["crystalSprout", "crystalSprout", "crystalSprout"],
    tuft: "crystalGrass", tuftTone: tone("#a088e0", 0.7, 1.3),
    foliage: tone("#7a5ac8", 0.6, 1.45),
    water: "resonant", weather: "motes", grade: "#ece2ff", shadow: [20, 8, 34], cliff: [30, 20, 40],
  },
};

/** Minimap / thumbnail / editor colour of a tile in a biome (derived from the palette). */
export function biomeMapColor(biome: BiomeId, t: TerrainType): string {
  const p = BIOMES[biome].palette;
  switch (t) {
    case "ground": return rgbHex(p.ground.mid);
    case "road": return rgbHex(p.road.mid);
    case "bridge": return rgbHex(p.bridge.mid);
    case "hill": return rgbHex(p.hill.light);
    case "forest": return rgbHex(BIOMES[biome].foliage.dark);
    case "shallows": return rgbHex(p.shallows.mid);
    case "water": return rgbHex(p.water.mid);
    case "mountain": return rgbHex(p.mountain.dark);
    case "rock": return rgbHex(BIOMES[biome].rockTone.mid);
    case "void": return "#0b0d10";
  }
}

const MAP_COLORS = new Map<BiomeId, Readonly<Record<TerrainType, string>>>();
const TERRAIN_TYPES: readonly TerrainType[] = ["ground", "road", "bridge", "hill", "forest", "shallows", "water", "mountain", "rock", "void"];
/** biomeMapColor for every tile type, memoised per biome (for per-tile loops: minimap, editor). */
export function biomeMapColors(biome: BiomeId): Readonly<Record<TerrainType, string>> {
  let m = MAP_COLORS.get(biome);
  if (!m) {
    m = Object.fromEntries(TERRAIN_TYPES.map((t) => [t, biomeMapColor(biome, t)])) as Record<TerrainType, string>;
    MAP_COLORS.set(biome, m);
  }
  return m;
}
