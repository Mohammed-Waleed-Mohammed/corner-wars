// 29 — The Scar materials (26 §A/§F): the land around Ground Zero, slowly turning to violet crystal.
// Cool violets and lavender-greys. Never pink or magenta (the sprite key colour is #FF00FF).

import type { TexKey } from "../../content/biomes";
import { sz } from "./types";
import type { TextureDesc } from "./types";

export const SCAR_TEX: Record<TexKey, TextureDesc> = {
  ground: {
    name: "Glassed earth",
    what: "earth fused into dark glass by the Fall, seen from straight above",
    detail: [
      "dark violet-grey ground (#5a5070) with a hard, glazed surface — glossy in places, matte in others, but never with glare",
      `a network of fine cracks running in random directions, dividing the glaze into irregular pieces ${sz(15, 60)} across`,
      `patches of matte ash-grey soil (#6a6470) ${sz(20, 70)} across where the glaze has flaked off`,
      `tiny violet crystal grains (#b8a0e8, ${sz(1, 2)}) catching the light, scattered evenly`,
    ],
    feel: "the baseline of the biome: cool, dark, slightly unnatural, but still ground",
    exclude: ["large crystals", "glowing lines", "pink or magenta", "plants", "footprints"],
  },
  forest_floor: {
    name: "Crystal grove floor",
    what: "the ground between crystal growths in a crystal grove, seen from straight above",
    detail: [
      "dark violet soil (#3c3450)",
      `shed crystal shards and glassy fragments ${sz(2, 10)}, lilac (#9a88c8) and clear, lying at random angles`,
      `tiny faint violet glow specks (#9a6cf0) ${sz(1, 2)}, scattered sparsely`,
      `small patches of glassed crust (#4a4060) ${sz(15, 50)} across`,
    ],
    feel: "darker and more cluttered than the glassed earth",
    exclude: ["standing crystals or trees", "bright glow", "pink or magenta", "light beams"],
  },
  road: {
    name: "Glass road",
    what: "a road of smoothed, fused glass, seen from straight above — only the road surface, never its edges",
    detail: [
      "smooth lavender-grey glassy pavement (#7a7090), matte from wear",
      "fine scuffs and scratches running in RANDOM directions",
      `embedded grit and tiny dark specks ${sz(1, 3)}, spread evenly`,
      `a few hairline cracks ${sz(10, 50)} long, random directions`,
    ],
    feel: "the lightest and smoothest man-used surface of the biome, with NO direction",
    exclude: ["ruts or tracks", "stripes or lines", "edges", "glare or reflections", "tiles or paving slabs"],
  },
  hill: {
    name: "Crystal rise",
    what: "the top of a rise where crystal pushes through the ground, seen from straight above",
    detail: [
      "purple-grey glassed earth (#6c5a88)",
      `small angular crystal tips ${sz(5, 15)} across poking up through it, scattered unevenly, each lit on its top-left facet (#c0a8ff) and dark on its bottom-right (#3a2a5a)`,
      `fine crystal grit (#a090c8, ${sz(1, 2)}) around the tips`,
    ],
    feel: "brighter and more crystalline than the glassed earth, so high ground reads at a glance",
    exclude: ["large crystal clusters", "glow", "pink or magenta", "slopes or edges"],
  },
  sand: {
    name: "Glass sand",
    what: "a shore of crushed glass sand, seen from straight above",
    detail: [
      "fine lavender-grey glass sand (#9a90b0) with a soft, even sparkle",
      `tiny clear and lilac shards (${sz(1, 4)}), scattered`,
      "soft, non-directional dimples",
    ],
    feel: "the palest surface of the biome, the ring around the resonant pools",
    exclude: ["ripple lines", "water", "large crystals", "pink or magenta"],
  },
  shallows: {
    name: "Glass shallows",
    what: "shallow violet water over a crystalline bed, seen from straight above — wadeable",
    detail: [
      "clear violet water (#6a58a0) over a bed of small crystal points and glass sand",
      "faint, soft luminous caustic lines (#9a6cf0) on the bed, irregular and subtle",
      `small crystal points ${sz(2, 8)} on the bed, slightly blurred by the water, scattered at random`,
    ],
    feel: "lighter than the resonant pool; clearly shallow",
    exclude: ["glare or reflections", "foam or waves", "pink or magenta", "a bright centre"],
  },
  water: {
    name: "Resonant pool",
    what: "the still surface of a deep resonant pool, seen from straight above",
    detail: [
      "deep violet water (#3a1e6a), still, with no bottom visible",
      `soft, small inner glow spots (#7a4ac0) ${sz(10, 40)} across, spread evenly over the image`,
      `tiny luminous motes (#c8b0ff, ${sz(1, 2)}), scattered evenly`,
    ],
    feel: "deep and quietly alive; the game adds its slow pulses of light itself, so keep it even",
    exclude: ["a bright centre or glare", "reflections", "pink or magenta", "shoreline"],
  },
  mountain: {
    name: "Crystal massif",
    what: "the top of a crystal massif, seen from straight above — hard and impassable",
    detail: [
      `massive dark obsidian-violet crystal formations (#3c3048): the faceted tops of large hexagonal prisms ${sz(50, 150)} across, packed tightly, tilted at random`,
      "bright violet edges (#9a6cf0) where facets face the top-left; dark indigo (#1e1630) on facets facing the bottom-right",
      "deep black gaps between the prisms",
    ],
    feel: "the hardest, darkest surface of the biome",
    exclude: ["a single summit", "glow filling the gaps", "pink or magenta", "perspective cliff walls"],
  },
  bridge: {
    name: "Crystal span",
    what: "the deck of a bridge made of cut glass-stone slabs, seen from straight above — only the deck, filling the image",
    detail: [
      "rows of rectangular slabs of smoky violet glass-stone (#5a5068) laid LEFT-TO-RIGHT, in exactly the courses of Image 1: 8 courses, each 128 px tall, of blocks 256 px long, every other course offset by half a block",
      "thin dark joints (#241e30) between rows; the end joints are staggered differently in every row, never lining up vertically",
      "a faint frosted texture and fine scratches on each slab; a dusting of glass sand",
    ],
    feel: "belongs to the glass road",
    exclude: ["parapets or posts", "the ends or outline of the bridge", "water", "glow", "pink or magenta"],
  },
};
