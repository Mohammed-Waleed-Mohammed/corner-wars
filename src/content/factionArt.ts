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

/** The 9 unit types and the 11 building types that get faction art (walls and gates stay generic). */
export const ART_UNIT_TYPES: readonly UnitType[] = ["worker", "rifleman", "grenadier", "rocket", "medic", "scoutBuggy", "tank", "heavyTank", "artillery"];
export type ArtBuildingType = Exclude<BuildingType, "wall" | "gate">;
export const ART_BUILDING_TYPES: readonly ArtBuildingType[] = [
  "constructionYard", "powerPlant", "refinery", "barracks", "warFactory", "lab", "turret", "pillbox", "antiArmorCannon", "missileTower",
  "resonanceTap",
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
  peacemaker: { footprint: 0.5, gamePx: 18, vehicle: false, noun: "an unarmed envoy carrying a white flag",
    look: "a single unarmed person seen from straight above in a long coat, a satchel of letters on the hip, holding a tall pole with a white flag" },
  spy: { footprint: 0.5, gamePx: 18, vehicle: false, noun: "an unarmed spy in a dark hooded cloak",
    look: "a single person seen from straight above in a dark hooded cloak, hood toward the top, a spyglass at the belt, no weapon" },
  treatyCart: { footprint: 0.9, gamePx: 34, vehicle: true, noun: "an armoured tribute cart",
    look: "a heavy four-wheeled armoured wagon seen from straight above, front toward the top: a plated strongbox in the bed, a white pennant on a short mast" },
  artillery: { footprint: 0.88, gamePx: 36, vehicle: true, noun: "a self-propelled artillery gun",
    look: "a tracked self-propelled howitzer seen from straight above, front toward the top: a compact hull and a very long gun barrel reaching toward the top edge" },
};

/**
 * What a building type looks like from straight above (27 §H.1). Every building has ONE signature:
 * the element that names it at a glance from across the map, the same for all four factions (the
 * faction changes the skin, never the signature), so no two types read alike at game size.
 */
export interface BuildingArtSpec {
  noun: string; // "the Refinery", mid-sentence
  short: string; // "a Refinery": what a player must say at a glance
  role: string; // what it does in the game, so the art knows what it has to communicate
  signature: string; // the one identifying element: the largest, highest-contrast thing on the roof
  layout: readonly string[]; // where everything sits in the footprint ("top" = the image's top edge)
  colours?: string; // signature colours shared by every faction (hex), if the type has any
  notLike: string; // the types it is most easily confused with, and what tells them apart
}

/**
 * 27 §H.1 signature colours, the same for every faction. Used by the procedural buildings
 * (render/art/factionBuildings.ts, which are also the Art Lab guides) and quoted in BUILDING_ART.
 */
export const SIG = {
  hazard: "#e0a526", hazardDark: "#1a1a1a", // construction yellow + black bands (Yard crane, Factory door and gantry)
  helipad: "#e8e4d8",
  towerRim: "#d9d6cc", towerHole: "#121416", // Power Plant cooling towers
  goldHot: "#ffd23f", goldRim: "#f29a1a", ore: "#e0a82e", oreDark: "#8a5a12", // Refinery
  parade: "#c8bfa6", // Barracks parade ground
  dish: "#e8ecef", // Lab radar dish
  cyanCore: "#5ee8ff", cyanEdge: "#1aa6c8", // Resonance Tap crystal
  missile: "#d8342a", missileBand: "#f2f2f2", // Missile Tower tips
} as const;

const HAZARD = `construction-yellow ${SIG.hazard} with black ${SIG.hazardDark} hazard bands`;

export const BUILDING_ART: Record<ArtBuildingType, BuildingArtSpec> = {
  constructionYard: {
    noun: "the Construction Yard", short: "the Construction Yard",
    role: "the command base: it builds every other structure, and losing it loses the match",
    signature: "a big tower crane whose long lattice jib runs diagonally across the whole yard, from a heavy square crane base near the bottom-left corner to the top-right corner, together with a round helipad on the main roof (a pale painted ring with a cross inside it, no letter)",
    layout: [
      "the main command block fills the top-left two-thirds: the largest and tallest roof, with the helipad on it",
      "the crane base sits in the bottom-left corner; its jib reaches over the roof to the top-right corner and is the longest single line in the picture",
      "along the bottom edge, two or three vehicle-bay roofs side by side",
      "down the right side, stacked supply containers and crates in the faction's colours",
    ],
    colours: `the crane jib in ${HAZARD}; the helipad ring pale ${SIG.helipad}`,
    notLike: "the War Factory: no long ribbed hall roof, no bay door across the front",
  },
  powerPlant: {
    noun: "the Power Plant", short: "a Power Plant",
    role: "it makes the electricity every other building runs on",
    signature: "two large round cooling towers seen from straight above, each a thick pale concrete ring around a deep, dark round opening, side by side and together covering more than half the roof: the only building with big dark round holes in it",
    layout: [
      "the two cooling towers side by side across the top half, each about 40% of the footprint wide",
      "the bottom-left quarter: a flat turbine-hall roof",
      "the bottom-right quarter: a transformer yard, rows of insulators and thick black cables in a tidy grid",
      "a few small red warning lamps on the tower rims",
    ],
    colours: `tower rims pale concrete ${SIG.towerRim} around near-black ${SIG.towerHole} openings: the strongest light/dark contrast in the base`,
    notLike: "the Refinery (no gold, no ore, nothing glowing) and the Research Lab (the round shapes are open dark holes, not glass domes)",
  },
  refinery: {
    noun: "the gold Refinery", short: "the gold Refinery",
    role: "the workers bring raw gold ore here and it is smelted into the player's money; it is the one building that must say GOLD at a glance",
    signature: "an open round crucible full of glowing molten gold, next to a big heap of raw gold-ore nuggets: the brightest, warmest spot in the whole base",
    layout: [
      "the molten-gold crucible fills the top-left, about 45% of the footprint wide: a thick dark iron ring around a glowing pool of liquid gold",
      "the gold-ore heap, a mound of chunky gold nuggets and rock, fills the bottom-right corner",
      "a conveyor belt runs from the ore heap up into the crucible, carrying gold nuggets",
      "the rest is a low smelter-hall roof with one short chimney (no smoke) and a small stack of gold ingots on a pallet",
    ],
    colours: `molten gold ${SIG.goldHot} at the centre to ${SIG.goldRim} at the rim; ore and ingots ${SIG.ore} with ${SIG.oreDark} shadows. They are brighter and more saturated than any faction trim, Halcyon's brushed gold included. This gold is the ore and the metal, not decoration: it is required for every faction, including those that never use gold trim`,
    notLike: "the Power Plant: the round shape is a glowing pool of gold, not a dark hole",
  },
  barracks: {
    noun: "the Barracks", short: "the Barracks",
    role: "it trains the infantry",
    signature: "an open parade ground (a flat pale square of packed sand inside the footprint) with a tall flagpole flying a big flag in the faction's accent colour, next to long, narrow, parallel bunkhouse roofs: the only building with an open square and a flag",
    layout: [
      "two or three long, narrow bunkhouse roofs run side by side across the top half, left to right",
      "the parade ground fills the bottom-right, about 40% of the footprint, edged by a low wall or sandbags",
      "the flagpole stands in the middle of the parade ground; the flag (accent colour, faction emblem on it) streams to the right and is clearly visible",
      "a guarded gate with a small sentry box in the bottom-left corner",
    ],
    colours: `the parade ground pale sand ${SIG.parade}, against the darker roofs; the flag in the faction's accent colour`,
    notLike: "the War Factory: many narrow roofs and an open square, not one big hall",
  },
  warFactory: {
    noun: "the War Factory", short: "the War Factory",
    role: "it builds the tanks and the other vehicles",
    signature: "one huge assembly hall: a long roof of curved, ribbed metal sheets with a row of skylights, crossed by a heavy overhead gantry crane, with a wide vehicle bay door along the bottom edge",
    layout: [
      "the hall roof fills almost the whole footprint, its ribs running from top to bottom",
      "a row of glass skylights along the roof's centre line, left to right",
      "the gantry crane: two rails along the top and bottom edges and a thick crane bridge across the roof, about one third of the way from the left",
      "the bay door: a wide hazard-striped band along the bottom edge, about two-thirds of its width, centred",
    ],
    colours: `the bay door and the crane bridge in ${HAZARD}`,
    notLike: "the Construction Yard: no tower-crane jib and no helipad",
  },
  lab: {
    noun: "the Research Lab", short: "the Research Lab",
    role: "it researches upgrades and new technology",
    signature: "a big glass dome, the largest single glass surface in the base and softly lit from inside, with a large pale radar dish beside it",
    layout: [
      "the glass dome, divided by a fine frame into panels, fills the centre-left, about 55% of the footprint wide",
      "a big round sensor dish (pale, with its feed arm) in the top-right corner",
      "two or three slim antenna masts and small cooling units in the bottom-right",
      "a narrow walkway ring around the dome",
    ],
    colours: `the dome in the faction's glass colour, bright and glossy; the dish pale ${SIG.dish}`,
    notLike: "the Power Plant (the dome is shiny glass, not a dark hole) and the Resonance Tap (no crystals, no pylons)",
  },
  turret: {
    noun: "the Gun Turret", short: "a Gun Turret",
    role: "the basic gun defence, against infantry and vehicles",
    signature: "a round armoured gun turret with two short, thick barrels side by side, pointing straight at the top edge",
    layout: [
      "a heavy round ring base fills the footprint",
      "the turret housing, a smaller circle, sits in the centre",
      "the twin barrels run from the centre to just inside the top edge",
    ],
    notLike: "the Pillbox (it has barrels) and the Anti-Armor Cannon (two short barrels, not one long one)",
  },
  pillbox: {
    noun: "the Pillbox", short: "a Pillbox",
    role: "a cheap, squat bunker that shelters riflemen",
    signature: "a low, flat octagonal bunker with a thick rim and a dark firing slit in each of its eight sides, and no gun barrel at all",
    layout: [
      "the octagon fills the footprint",
      "a thick outer wall with eight dark firing slits, one per side",
      "a flat armoured roof slab in the middle with a small round hatch",
      "a ring of sandbags or armour plates hugging the outer wall",
    ],
    notLike: "the Gun Turret (no barrels) and the Missile Tower (an octagon with slits, not a square with a grid)",
  },
  antiArmorCannon: {
    noun: "the Anti-Armor Cannon", short: "an Anti-Armor Cannon",
    role: "the heavy tank-killer gun",
    signature: "one very long, very thick gun barrel with a big muzzle brake at its tip, running from the centre all the way to the top edge: the longest gun in the base",
    layout: [
      "a round, sandbagged or armoured base in the lower two-thirds",
      "a heavy curved gun-shield plate at the centre",
      "the barrel from the shield to just inside the top edge; the muzzle brake is a clearly wider block at its tip",
    ],
    notLike: "the Gun Turret: one long barrel, not two short ones",
  },
  missileTower: {
    noun: "the Missile Tower", short: "a Missile Tower",
    role: "the long-range missile defence",
    signature: "a square launcher box packed with a 3 × 3 grid of missile tubes, each showing a bright red missile tip",
    layout: [
      "a square armoured box with cut corners fills the footprint",
      "the 3 × 3 grid of round tube openings fills its centre, each with a red-and-white missile tip",
      "a small radar dish in the top-right corner",
    ],
    colours: `missile tips red ${SIG.missile} with white ${SIG.missileBand} bands`,
    notLike: "the Pillbox: a square with a grid of red tips, not an octagon with slits",
  },
  resonanceTap: {
    noun: "the Resonance Tap", short: "a Resonance Tap",
    role: "it draws Resonance energy up from deep underground and turns it into gold: the late-game economy",
    signature: "a round pit holding a big glowing cyan crystal core, ringed by four tall conductor pylons",
    layout: [
      "the pit and its crystal core in the centre, about 45% of the footprint wide; the crystal glows cyan from inside",
      "four conductor pylons at the four diagonal points around the pit, each with a glowing cyan tip",
      "thick cables run from the pylons to a small control hut in the bottom-right corner",
    ],
    colours: `the crystal cyan ${SIG.cyanCore} at the core to ${SIG.cyanEdge} at its edges; the pylon tips the same cyan`,
    notLike: "the Research Lab (a crystal and pylons, not a glass dome) and the Refinery (cyan, never gold)",
  },
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
