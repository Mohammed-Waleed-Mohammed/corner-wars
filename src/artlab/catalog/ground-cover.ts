// 29 — rocks, bushes and tufts (26 §D). Rocks share four shapes across biomes (rock_1..4) in each
// biome's material; bushes are per species (variant = repeat index); tufts are per species × 3.

import type { BushSpecies, RockStyle, TuftSpecies } from "../../content/biomes";
import type { SpriteDesc } from "./types";

// ── rocks ───────────────────────────────────────────────────────────────────────────────────────
const ROCK_SHAPES = [
  "one large, rounded, slightly oval boulder",
  "one angular, freshly split rock with flat facets and sharp ridges",
  "a cluster of three stones of different sizes touching each other",
  "a low, flat slab with a smaller stone resting against its edge",
] as const;

const ROCK_MATERIAL: Record<RockStyle, { name: string; detail: string[] }> = {
  granite: { name: "Granite", detail: [
    "grey granite (#8a847a) with fine dark and white speckles",
    "a few cracks across the top and small chipped edges",
    "a patch of grey-green lichen (#7a826a) and moss (#4a6a30) on the bottom-right (shaded) side",
  ] },
  sandstone: { name: "Sandstone", detail: [
    "pale sandstone (#c8a882) with soft wind-eroded hollows and faint layering",
    "crusts of white salt (#f0e8d8) along the lower edges and in the hollows",
  ] },
  iceCap: { name: "Ice-capped granite", detail: [
    "blue-grey granite (#8a929c) with a cap of packed snow and clear ice (#eef2f6) covering the top-left half",
    "frost on the shaded bottom-right side",
  ] },
  basalt: { name: "Basalt", detail: [
    "black basalt (#3c3836), rough and pitted",
    "a few thin glowing orange cracks (#ff7a2a) running through it — the glow stays inside the cracks",
    "grey ash dust (#6a625a) on the upper surfaces",
  ] },
  mossy: { name: "Mossy stone", detail: [
    "weathered grey stone (#6a6a58); on the slab and cluster shapes, old cut masonry with one straight dressed edge",
    "thick green moss (#5a7a30) over about half the surface, mostly on top",
  ] },
  obsidian: { name: "Obsidian", detail: [
    "glossy black obsidian (#3a3046) with conchoidal (shell-shaped) fractures and sharp glassy edges",
    "thin violet veins (#9a6cf0) running through it; a faint blue-violet sheen on the top-left facets",
  ] },
};

export function rockDesc(style: RockStyle, index: number): SpriteDesc {
  const m = ROCK_MATERIAL[style];
  const shape = ROCK_SHAPES[index % ROCK_SHAPES.length];
  return {
    name: `${m.name} — ${["boulder", "split rock", "stone cluster", "slab"][index % 4]}`,
    subject: `${shape}, seen from straight above`,
    detail: [...m.detail, "strong volume: a clear highlight on the top-left, darker shading toward the bottom-right edge"],
    exclude: ["other loose pebbles around it", "grass, soil or snow around it", ...(style === "obsidian" ? ["pink or magenta"] : [])],
  };
}

// ── bushes ──────────────────────────────────────────────────────────────────────────────────────
const BUSH: Record<BushSpecies, (variant: number) => SpriteDesc> = {
  flowering: () => ({ name: "Flowering shrub", subject: "a round flowering shrub seen from straight above", detail: [
    "dense dark green leaves (#3a5a2a, highlights #6a9a4a)",
    "many small WHITE and pale-yellow flowers (#f4f0dc, #e8d870) scattered over the top",
  ], exclude: ["pink, red, purple or magenta flowers"] }),
  boxwood: () => ({ name: "Boxwood", subject: "a compact, rounded boxwood shrub seen from straight above", detail: [
    "tiny, densely packed leaves in deep green (#2e4a24) with fresh lighter tips (#5a8a3a)",
  ], exclude: ["clipped geometric shapes", "flowers"] }),
  fern: () => ({ name: "Fern", subject: "a fern seen from straight above", detail: [
    "a rosette of 7 to 9 finely divided fronds radiating from the centre",
    "bright green (#4a8a3a) fronds, darker (#2a4a22) near the centre",
  ], exclude: ["flowers"] }),
  saltbush: () => ({ name: "Saltbush", subject: "a low saltbush seen from straight above", detail: [
    "small, fleshy silvery grey-green leaves (#9aa08a, highlights #c8ccb8), densely clumped",
    "a fine white salt dust on the upper leaves",
  ], exclude: ["flowers"] }),
  tumbleweed: () => ({ name: "Tumbleweed", subject: "a dry tumbleweed seen from straight above", detail: [
    "a round, dense tangle of thin, dry, pale tan twigs (#b8a070) and darker stems (#7a6040)",
    "dense enough that the background shows only in small gaps near the edge",
  ], exclude: ["green leaves"] }),
  dryShrub: () => ({ name: "Dry shrub", subject: "a sparse, dry desert shrub seen from straight above", detail: [
    "twiggy grey-brown stems (#6a5a42) with small olive-brown leaves (#7a7a4a)",
  ], exclude: ["flowers", "bright green"] }),
  snowShrub: (v) => ({ name: ["Snowy shrub", "Twin snowy shrub", "Low snowy shrub"][Math.min(v, 2)], subject: "a shrub heavily covered in snow, seen from straight above", detail: [
    ["one round shrub", "two rounded humps grown together", "a low, wide, spreading shrub"][Math.min(v, 2)],
    "thick snow (#f0f4f8) with blue shadows (#b8c8dc) on top; dark twig tips (#3a2e26) and dark green leaves (#2e4a3c) peeking out at the edges",
  ], exclude: ["snow on the background"] }),
  ashFern: () => ({ name: "Ash fern", subject: "a small fern seen from straight above", detail: [
    "a rosette of finely divided fronds in dusty grey-green (#5a5a4a), heavily coated with pale ash (#8a847a)",
  ], exclude: ["bright green"] }),
  deadShrub: () => ({ name: "Dead shrub", subject: "a dead, burned shrub seen from straight above", detail: [
    "a tangle of bare, charred grey-black twigs (#2a2422) with grey ash on top",
  ], exclude: ["leaves", "flames"] }),
  emberMoss: () => ({ name: "Ember moss", subject: "a low cushion of dark moss seen from straight above", detail: [
    "a rounded mound of dark grey-green moss (#3a3a2e)",
    "tiny glowing orange specks (#ff7a2a) scattered inside it — the glow stays inside the moss",
  ], exclude: ["flames", "glow spilling onto the background"] }),
  reedClump: () => ({ name: "Reed clump", subject: "a clump of reeds seen from straight above", detail: [
    "narrow green reed leaves (#6a8a3a) arching outward from the centre in every direction",
    "two or three brown seed heads (#7a5a32) near the centre",
  ], exclude: ["purple or pink plumes", "water"] }),
  cattail: () => ({ name: "Cattails", subject: "a clump of cattails seen from straight above", detail: [
    "long, flat blade leaves (#6a7a3a) radiating from the centre",
    "three or four brown, sausage-shaped cattail heads (#6a4426) among them",
  ], exclude: ["water"] }),
  lilyMat: () => ({ name: "Lily mat", subject: "a small mat of water-lily pads seen from straight above", detail: [
    "5 to 7 round lily pads, each with a notch, overlapping (#4a6a2a, highlights #7a9a4a)",
    "one or two small WHITE lily flowers (#f4f0e4) with yellow centres",
  ], exclude: ["pink or magenta flowers", "water around the pads"] }),
  crystalSprout: (v) => ({ name: ["Crystal sprout", "Crystal fan", "Crystal ring"][Math.min(v, 2)], subject: "young violet crystals sprouting from the ground, seen from straight above", detail: [
    ["three crystal points grouped together", "five points fanning out from one side", "a small ring of short points"][Math.min(v, 2)],
    "translucent violet (#a088e0) with bright lavender facets (#d0c0ff) on the top-left and indigo (#4a3a7a) on the bottom-right",
  ], exclude: ["pink or magenta", "glow on the background"] }),
};

export function bushDesc(species: BushSpecies, variant: number): SpriteDesc {
  return BUSH[species](variant);
}

// ── tufts (seen from the SIDE: the game stands them upright on the ground and sways them) ──────
const TUFT_SHAPES = [
  "5 blades fanning out from one base point",
  "7 blades of different heights, one carrying a small seed head",
  "4 longer blades, two of them curving to the sides",
] as const;

const TUFT: Record<TuftSpecies, { name: string; detail: string }> = {
  grass: { name: "Grass tuft", detail: "green grass blades (#5f8a3a), darker at the base (#3a5a26), lighter at the tips (#8ab858)" },
  dryGrass: { name: "Dry grass tuft", detail: "dry straw-yellow blades (#b6a058), pale at the tips (#d8c890), tan-brown at the base (#8a7440)" },
  frostGrass: { name: "Frosted grass tuft", detail: "grey-green blades (#9aa88a) edged with white frost crystals (#f0f4f8)" },
  ashGrass: { name: "Ash grass tuft", detail: "dull grey blades (#6a625a) coated with pale ash (#8a847a), darker at the base (#3a3632)" },
  reed: { name: "Reed tuft", detail: "narrow olive reed leaves (#7a8a4a); the seed head, if any, is a brown cattail head (#6a4426)" },
  crystalGrass: { name: "Crystal grass", detail: "thin translucent crystal blades in lilac (#a088e0) with bright tips (#d0c0ff), deeper violet at the base (#5a4a90)" },
};

export function tuftDesc(species: TuftSpecies, index: number): SpriteDesc {
  const t = TUFT[species];
  return {
    name: `${t.name} ${index + 1}`,
    subject: `a small tuft of ${TUFT_SHAPES[index % TUFT_SHAPES.length]}, seen from the SIDE (front view), standing upright with its base at the bottom`,
    detail: [t.detail, "each blade is a clean, tapering stroke with a lit left side and a shaded right side"],
    exclude: ["soil, roots or a ground line under the base", "a top-down view", ...(species === "crystalGrass" ? ["pink or magenta"] : [])],
  };
}
