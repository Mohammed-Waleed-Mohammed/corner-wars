// 29 — Cinder Coast materials (26 §A/§F): a volcanic arc of black ash plains and lava rivers. The
// biome's `water` is LAVA (emissive orange), its `shallows` a cooling crust.

import type { TexKey } from "../../content/biomes";
import { sz } from "./types";
import type { TextureDesc } from "./types";

export const CINDER_TEX: Record<TexKey, TextureDesc> = {
  ground: {
    name: "Ash plain",
    what: "a plain of fine volcanic ash, seen from straight above",
    detail: [
      "soft, powdery grey-black ash (#3a3634) with a matte surface",
      `scattered cinder pebbles (lapilli) ${sz(1, 4)}, dark grey (#2a2624) and rust-brown (#5a3a2a), spread evenly`,
      `soft, irregular drifts of lighter grey ash (#4c4644) ${sz(30, 120)} across, at random`,
      "a few tiny charcoal flecks",
    ],
    feel: "dark and dead but not black: every area keeps visible grey texture",
    exclude: ["glowing embers or lava", "plants", "rocks larger than a pebble", "footprints or tracks", "smoke"],
  },
  forest_floor: {
    name: "Charred forest floor",
    what: "the floor of a burned-out forest, seen from straight above",
    detail: [
      "black ash and scorched dark-brown soil (#2a2422)",
      `charcoal fragments and burnt twigs ${sz(5, 30)} long, lying at random angles, with cracked, alligator-skin char texture`,
      `pale grey ash flakes (#5a5450) ${sz(1, 4)}, scattered`,
      `at most 8 tiny, dull orange embers (#c04a1a, ${sz(1, 2)}) far apart — dull, not glowing brightly`,
    ],
    feel: "darker than the ash plain, cluttered with burnt wood",
    exclude: ["whole trunks or branches", "flames or smoke", "bright glow", "green plants"],
  },
  road: {
    name: "Cinder track",
    what: "a track of compacted cinder gravel, seen from straight above — only the track surface, never its edges",
    detail: [
      "tamped reddish-brown scoria gravel (#5a4c44)",
      `angular cinder grains ${sz(1, 4)} in rust-brown (#6a4a38) and dark grey (#3a3432), spread evenly`,
      `irregular, slightly darker compacted patches (#4a3e38) ${sz(30, 100)} across, at random`,
    ],
    feel: "warmer and lighter than the ash plain, with NO direction",
    exclude: ["ruts or tyre tracks", "stripes or lines", "road edges", "lava or embers"],
  },
  hill: {
    name: "Basalt rise",
    what: "the weathered top of a basalt rise, seen from straight above",
    detail: [
      `the tops of basalt columns: IRREGULAR polygons with 4 to 7 sides, ${sz(25, 60)} across, all different sizes — never a regular honeycomb`,
      "column tops in dark grey basalt (#4a4440), slightly rough, each with a faintly lighter top-left edge",
      "fine grey ash (#5a5450) filling the joints between the columns",
      "a few small cracks and chips on the column tops",
    ],
    feel: "lighter and more structured than the ash plain, so high ground reads at a glance",
    exclude: ["a regular hexagonal grid", "lava or embers", "plants", "perspective column sides"],
  },
  sand: {
    name: "Black sand",
    what: "a shore of black volcanic sand, seen from straight above",
    detail: [
      "fine black sand (#2e2a28) with a faint glossy glint on the grains",
      `small grey pumice pebbles (#6a6460) ${sz(1, 5)}, scattered far apart`,
      "soft, non-directional dimples",
    ],
    feel: "the darkest ground of the biome, the ring around the lava",
    exclude: ["ripple lines", "lava, glow or embers", "plants", "footprints"],
  },
  shallows: {
    name: "Cooling crust",
    what: "a crust of cooling lava at the edge of a lava river, seen from straight above",
    detail: [
      `dark brown-black crust plates (#3a2418) ${sz(25, 90)} across, with a wrinkled, ropy surface whose wrinkles face random directions`,
      "thin, glowing orange-red cracks (#a8522a to #ff7a2a) between the plates, a few px wide",
      "dull red-brown (#5a3a2a) areas where the crust is thin and still warm",
    ],
    feel: "mostly dark with a fine net of glow; clearly hotter than the black sand and clearly darker than the open lava",
    exclude: ["open molten lava pools", "flames or smoke", "bright glare", "rocks"],
  },
  water: {
    name: "Lava",
    what: "a flow of molten lava, seen from straight above",
    detail: [
      "bright molten lava (#d2541e) over most of the image, with hotter yellow-orange veins (#ffb040) swirling at random",
      `floating plates of cooling black crust (#3a1a0e to #7a1a08) ${sz(20, 80)} across, covering about a quarter of the area, broken by glowing orange cracks`,
      "soft, even emissive glow, the same strength everywhere",
    ],
    feel: "the brightest, hottest surface of the biome; the game animates it itself, so keep it evenly busy",
    exclude: ["flames, smoke or sparks", "a brighter centre or glare", "flow lines all running one way", "shoreline"],
  },
  mountain: {
    name: "Obsidian ridge",
    what: "the top of an obsidian and basalt ridge, seen from straight above — hard and impassable",
    detail: [
      `glossy black obsidian (#2a2628) in irregular crags ${sz(50, 150)} across, with conchoidal (shell-shaped) fractures and sharp glassy edges`,
      "a faint blue-grey sheen (#6a7080) on the faces turned to the top-left; deep black crevices",
      "grey ash (#4a4644) settled in the cracks",
    ],
    feel: "black and glassy, rougher and sharper than the basalt rise",
    exclude: ["lava or glow", "bright reflections or glare", "a single summit", "perspective cliff walls"],
  },
  bridge: {
    name: "Basalt-block bridge",
    what: "the deck of a bridge built from dressed basalt blocks, seen from straight above — only the deck, filling the image",
    detail: [
      "rows of rectangular dark-grey basalt blocks (#4a3a30 to #4a4440) laid LEFT-TO-RIGHT, in exactly the courses of Image 1: 8 courses, each 128 px tall, of blocks 256 px long, every other course offset by half a block",
      "thin dark mortar joints (#1e1814) between rows; the end joints are staggered differently in every row like brickwork, never lining up vertically",
      "slightly worn, chipped edges and a dusting of grey ash on every block",
    ],
    feel: "belongs to the cinder track; stone, not wood",
    exclude: ["parapets or posts", "the ends or outline of the bridge", "lava", "planks"],
  },
};
