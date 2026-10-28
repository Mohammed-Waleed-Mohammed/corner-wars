// 27 §H / 29 §G — each faction's VISUAL identity for units and buildings: palette, materials, shape
// language, and a per-type description. It is the single source for the procedural faction art
// (render/art/faction*.ts) and the Art Lab's unit/building prompts. DOM-free data.

import type { BuildingType, FactionId, UnitType } from "../core/types";

export interface FactionLook {
  id: FactionId;
  palette: {
    base: string; // dominant armour / wall colour
    mid: string; // secondary panels
    dark: string; // shadows, tracks, frames
    light: string; // highlights, trim
    accent: string; // faction colour markings (stripes, lights)
    glass: string; // windows, sensors, lenses
  };
  shape: string; // shape language, one sentence
  materials: string[];
  motifs: string[];
  avoid: string[]; // things that would read as another faction
}

export const FACTION_LOOK: Record<FactionId, FactionLook> = {
  concord: {
    id: "concord",
    palette: { base: "#c9d2dc", mid: "#5b6b80", dark: "#2b3442", light: "#eef3ff", accent: "#3b82f6", glass: "#7fb4e8" },
    shape: "Disciplined, angular military engineering: rectangles with chamfered (cut) corners, symmetrical layouts, flat armour plates in tidy rows.",
    materials: ["matte off-white composite armour plates", "slate-blue steel panels", "dark gunmetal frames and tracks", "blue-tinted armoured glass"],
    motifs: ["the white Custody Bar emblem (a ring split by a vertical bar) painted on roofs and hulls", "thin Concord-blue identification stripes", "numbered stencil plates", "neat antenna masts"],
    avoid: ["gold trim", "rust or patched repairs", "crystals", "rounded luxury curves"],
  },
  halcyon: {
    id: "halcyon",
    palette: { base: "#2f3036", mid: "#4a4a52", dark: "#18181c", light: "#d8c48a", accent: "#eab308", glass: "#f5d77a" },
    shape: "Sleek corporate high-tech: smooth rounded hulls and roofs, hexagonal panels and hatches, clean seamless surfaces.",
    materials: ["charcoal composite with a satin sheen", "brushed-gold trim lines", "black ceramic panels", "warm amber light strips"],
    motifs: ["the gold rising-sun-in-a-hexagon emblem", "hexagonal vents and hatches", "thin glowing amber strips", "solar panels with a gold tint"],
    avoid: ["white armour", "rust, timber or sandbags", "crystals", "gothic or ritual shapes"],
  },
  cantons: {
    id: "cantons",
    palette: { base: "#6b7046", mid: "#8a6a44", dark: "#3a3a24", light: "#b8b48a", accent: "#22c55e", glass: "#9ccf9a" },
    shape: "Improvised and practical: slightly irregular outlines, mismatched welded plates, things bolted and strapped on, nothing perfectly symmetrical.",
    materials: ["olive-drab painted steel with chipped paint", "rust-brown patches and weld seams", "weathered timber planks", "canvas tarps and sandbags"],
    motifs: ["hand-painted green stripes and the three-chevron emblem", "jerry cans, crates and spare wheels strapped to vehicles", "corrugated metal roofs", "camouflage netting"],
    avoid: ["pristine factory-new surfaces", "gold trim", "crystals", "white armour"],
  },
  choir: {
    id: "choir",
    palette: { base: "#4a1c22", mid: "#2a1a1c", dark: "#120a0c", light: "#d8c8b8", accent: "#ef4444", glass: "#8a6cf0" },
    shape: "Ritual war-machines: pointed, cathedral-like silhouettes, spikes and spires, long trailing banners, stolen machines re-clad in iron.",
    materials: ["dark oxblood-red painted iron", "blackened iron and riveted plates", "bone-white trim and cloth", "blue-violet Resonance crystals that glow softly"],
    motifs: ["the black hollow-sun emblem (a ring with seven rays)", "torn red banners and prayer cloth", "crystal shards growing from roofs and hulls", "censers and chains"],
    avoid: ["clean white armour", "gold corporate trim", "green camouflage", "pink or magenta tones (crystals are BLUE-violet)"],
  },
};

/** The 9 unit types and the 10 building types that get faction art (walls and gates stay generic). */
export const ART_UNIT_TYPES: readonly UnitType[] = ["worker", "rifleman", "grenadier", "rocket", "medic", "scoutBuggy", "tank", "heavyTank", "artillery"];
export type ArtBuildingType = Exclude<BuildingType, "wall" | "gate">;
export const ART_BUILDING_TYPES: readonly ArtBuildingType[] = [
  "constructionYard", "powerPlant", "refinery", "barracks", "warFactory", "lab", "turret", "pillbox", "antiArmorCannon", "missileTower",
];

/** File stem for a type: "constructionYard" → "construction_yard". */
export function artStem(type: string): string {
  return type.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// ── output + in-game sizes ────────────────────────────────────────────────────────────────────────
/** Processed unit sprite size (px, square). */
export const UNIT_OUT = 128;
/** Processed building sprite: px per footprint tile (a 3×2 War Factory → 288 × 192). */
export const BUILDING_PX_PER_TILE = 96;
/** A building fills this fraction of its footprint rectangle (a hair of margin for the owner trim). */
export const BUILDING_FILL = 0.96;

export interface UnitArtSpec {
  footprint: number; // the unit's larger dimension as a fraction of the square sprite
  gamePx: number; // its length in world px at zoom 1 (the sprite is drawn gamePx / footprint wide)
  noun: string; // "a rifle infantryman"
  look: string; // what the camera sees from straight above, facing UP
  vehicle: boolean;
}

export const UNIT_ART: Record<UnitType, UnitArtSpec> = {
  worker: { footprint: 0.55, gamePx: 18, vehicle: false, noun: "an engineer / field worker on foot",
    look: "a single person seen from straight above: helmet or cap, shoulders, a large tool pack on the back, a pick or wrench held forward" },
  rifleman: { footprint: 0.55, gamePx: 20, vehicle: false, noun: "a rifle infantry soldier",
    look: "a single soldier seen from straight above: helmet, shoulders with pauldrons, a rifle held forward pointing to the top of the image" },
  grenadier: { footprint: 0.55, gamePx: 20, vehicle: false, noun: "a grenadier with a launcher",
    look: "a single heavily-equipped soldier seen from straight above: helmet, wide shoulders, a stubby grenade launcher held forward, a bandolier of grenades" },
  rocket: { footprint: 0.6, gamePx: 21, vehicle: false, noun: "an anti-armour rocket soldier",
    look: "a single soldier seen from straight above with a long rocket tube resting on one shoulder, pointing to the top of the image" },
  medic: { footprint: 0.55, gamePx: 18, vehicle: false, noun: "a field medic",
    look: "a single soldier seen from straight above with a medical backpack marked by a pale cross, carrying a med-kit, no weapon pointed forward" },
  scoutBuggy: { footprint: 0.72, gamePx: 24, vehicle: true, noun: "a fast four-wheeled scout buggy",
    look: "a small open-frame four-wheeled buggy seen from straight above, nose toward the top: roll cage, driver seat, a light machine gun on a pintle" },
  tank: { footprint: 0.8, gamePx: 32, vehicle: true, noun: "a main battle tank",
    look: "a tracked tank seen from straight above, front toward the top: two tracks, a hull, a round turret in the middle and one cannon pointing to the top" },
  heavyTank: { footprint: 0.88, gamePx: 40, vehicle: true, noun: "a super-heavy tank",
    look: "a very large tracked tank seen from straight above, front toward the top: wide double tracks, a massive hull, a big turret with a long, thick cannon pointing to the top" },
  artillery: { footprint: 0.88, gamePx: 36, vehicle: true, noun: "a self-propelled artillery gun",
    look: "a tracked self-propelled howitzer seen from straight above, front toward the top: a compact hull and a very long gun barrel reaching toward the top edge" },
};

export interface BuildingArtSpec {
  noun: string; // "the Construction Yard"
  look: string; // what the camera sees from straight above (layout)
}

export const BUILDING_ART: Record<ArtBuildingType, BuildingArtSpec> = {
  constructionYard: { noun: "the Construction Yard (command base)", look: "a large fortified compound seen from straight above: a central command building with a helipad on its roof, a big construction crane arm reaching across the yard, vehicle bays and supply crates around the edge" },
  powerPlant: { noun: "a Power Plant", look: "a compact power station seen from straight above: two round cooling stacks or reactor domes, a turbine hall, thick cables and a transformer yard" },
  refinery: { noun: "a gold Refinery", look: "an ore refinery seen from straight above: round storage silos, a smelting furnace with a chimney, conveyor belts and a small loading pad with a pile of golden ore" },
  barracks: { noun: "the Barracks", look: "an infantry barracks seen from straight above: a long low roof over sleeping halls, a small parade ground with a flagpole, a guarded entrance" },
  warFactory: { noun: "the War Factory", look: "a big vehicle factory seen from straight above: a long assembly-hall roof with skylights, a wide vehicle bay door on the front edge, an overhead gantry crane" },
  lab: { noun: "the Research Lab", look: "a research laboratory seen from straight above: a domed or glazed roof, antenna masts and sensor dishes, small cooling units" },
  turret: { noun: "a Gun Turret", look: "a single round defensive turret seen from straight above: a fortified ring base and a rotating gun housing with a cannon pointing to the top" },
  pillbox: { noun: "a Pillbox", look: "a low squat bunker seen from straight above: a thick octagonal concrete or iron roof with firing slits around the edge" },
  antiArmorCannon: { noun: "an Anti-Armor Cannon", look: "a heavy anti-tank gun emplacement seen from straight above: a sandbagged or armoured round base and one very long, thick barrel pointing to the top" },
  missileTower: { noun: "a Missile Tower", look: "a square missile tower seen from straight above: a launcher box with a grid of missile tubes (missile tips visible), radar on the roof" },
};

/** Per-faction flavour line for a building or a unit (appended to the type's look). */
export function factionFlavour(f: FactionId, kind: "unit" | "building", vehicle = false): string {
  switch (f) {
    case "concord":
      return kind === "building" ? "Clean prefabricated military architecture: off-white armour-plate roofs with chamfered corners, slate-blue walls, the white Custody Bar emblem on the main roof, tidy blue stripes."
        : vehicle ? "Off-white armour with chamfered edges, slate-blue lower hull, dark tracks, a small Custody Bar emblem and a blue stripe on the hull." : "Off-white helmet and pauldrons, slate-blue fatigues, dark webbing, a small blue shoulder stripe.";
    case "halcyon":
      return kind === "building" ? "Sleek corporate architecture: charcoal composite roofs with smooth rounded corners, hexagonal hatches and vents, brushed-gold trim lines, warm amber light strips, gold-tinted solar panels."
        : vehicle ? "Smooth charcoal hull with rounded edges, hexagonal plating, brushed-gold trim lines and a thin amber light strip." : "Charcoal armour with gold trim, a smooth visored helmet, a thin amber light on the shoulder.";
    case "cantons":
      return kind === "building" ? "Improvised frontier architecture: corrugated-metal and timber roofs with rust patches, sandbag walls, tarps and camouflage netting, hand-painted green stripes."
        : vehicle ? "Olive-drab welded plates with rust patches and chipped paint, spare wheel, jerry cans and crates strapped on, a hand-painted green stripe." : "Olive-drab fatigues, a soft cap or old helmet, a canvas backpack and bedroll, a green armband.";
    case "choir":
      return kind === "building" ? "Ritual war architecture: oxblood-red iron roofs with pointed spires and spikes, blackened riveted plates, red banners, blue-violet Resonance crystals growing from the roof and glowing softly."
        : vehicle ? "Oxblood-red iron plates with spikes, blackened rivets, trailing red banners and one or two glowing blue-violet crystal shards on the hull." : "A hooded oxblood robe over black armour, bone-white trim, a red sash, a small blue-violet crystal pendant.";
  }
}
