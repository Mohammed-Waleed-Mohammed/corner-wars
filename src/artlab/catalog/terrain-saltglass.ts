// 29 — Saltglass materials (26 §A/§F): the salt desert around Ground Zero, its crust fused to glass
// by the Fall's heat. Bright, flat, warm.

import type { TexKey } from "../../content/biomes";
import { sz } from "./types";
import type { TextureDesc } from "./types";

export const SALTGLASS_TEX: Record<TexKey, TextureDesc> = {
  ground: {
    name: "Salt hardpan",
    what: "pale, salt-crusted desert hardpan, seen from straight above",
    detail: [
      `the crust is cracked into irregular polygons ${sz(30, 90)} across, with 4 to 7 sides of different lengths — never a regular honeycomb or grid`,
      "thin crack lines in dark tan (#9a8460), with fine pale sand (#d8c8a4) drifted into the cracks and slightly raised salt-white rims (#ece4d0) along their edges",
      "the polygon surfaces are pale sandy cream (#cdb991) with faint powdery mottling",
      `a few glassy fused patches ${sz(10, 35)} across: smooth, slightly translucent amber-tan glass (#b89a6a) with one or two tiny white glints each, scattered far apart`,
      "a fine dusting of drifting sand over everything",
    ],
    feel: "bright, flat and hard, the sunlit floor of a salt desert; warm cream, never pure white",
    exclude: ["dunes or sand ripples", "plants", "rocks larger than a pebble", "footprints or tracks", "puddles"],
  },
  forest_floor: {
    name: "Scrub floor",
    what: "the sandy ground under desert scrub and date palms, seen from straight above",
    detail: [
      "sandy tan soil (#8a7a52) with darker patches of dry humus (#6a5a3a)",
      `fragments of dry, fallen palm fronds and leaflets ${sz(10, 40)} long, sun-bleached straw (#b8a070) and brown (#7a5a32), lying flat at random angles`,
      `dead grass litter, thin twigs and seed pods ${sz(2, 8)}, scattered`,
      `a few small thorny twig fragments and date pits (${sz(1, 3)})`,
    ],
    feel: "darker and more cluttered than the hardpan, but still dry and dusty — no green carpet",
    exclude: ["whole palm fronds or trunks", "green grass", "salt polygons", "rocks", "shadows of trees"],
  },
  road: {
    name: "Caliche track",
    what: "a hard caliche (calcrete) desert track, seen from straight above — only the track surface, never its edges",
    detail: [
      "compacted pale-tan crust (#a88a62) with a chalky, powdery surface",
      `fine white caliche gravel and small angular stones ${sz(1, 5)} in cream (#d8ccb0) and rust-tan (#9a7a52), spread evenly`,
      `soft, irregular powder-dust patches (#bca07a), ${sz(30, 100)} across, at random`,
    ],
    feel: "reads as a track, but has NO direction",
    exclude: ["wheel ruts, tyre tracks or drag marks", "stripes or lines", "road edges or verges", "puddles", "salt-crack polygons"],
  },
  hill: {
    name: "Mesa top",
    what: "the flat top of a sandstone mesa, seen from straight above",
    detail: [
      "wind-scoured ochre-tan sandstone caprock (#c09a6a) under a thin, patchy veneer of sand",
      `a desert-pavement layer of small packed pebbles ${sz(1, 4)} in rust (#9a6a42), tan and cream, covering about half the surface`,
      `a few shallow, irregular hollows ${sz(20, 60)} across filled with paler sand (#d8bc90)`,
      "a few fine hairline cracks in random directions",
    ],
    feel: "warmer, redder and more pebbly than the hardpan, so high ground reads at a glance",
    exclude: ["cliff edges or slopes", "layered strata lines", "plants", "large boulders"],
  },
  sand: {
    name: "Brine shore",
    what: "pale fine sand on the shore of a brine pool, seen from straight above",
    detail: [
      "very pale cream sand (#e8dcc0) with grains too small to see one by one",
      `scattered thin flakes of white salt crust (#f4eee0) ${sz(3, 12)} across`,
      "soft, non-directional dimples",
      `a few slightly greyer, damp patches (#d4c8aa) ${sz(30, 90)} across`,
    ],
    feel: "the palest surface of the biome, between the hardpan and the salt marsh",
    exclude: ["wind ripples or ripple lines", "water or foam", "plants", "footprints"],
  },
  shallows: {
    name: "Salt marsh",
    what: "shallow, clear brine a few centimetres deep over a white salt bottom, seen from straight above",
    detail: [
      "clear, pale turquoise-green water (#7fb2a6) over a bottom of white and cream salt crystal crust",
      `submerged salt crystal clusters ${sz(3, 15)} across, slightly blurred by the water, scattered at random`,
      "faint, soft caustic light lines on the bottom, irregular and subtle",
      `a few small dark patches of mud (#5a6a5a) ${sz(10, 40)} across`,
    ],
    feel: "wadeable and bright; the bottom always visible",
    exclude: ["shoreline", "foam or waves", "reflections of sky", "plants or reeds", "deep dark areas"],
  },
  water: {
    name: "Brine pool",
    what: "the still surface of a deep brine pool, seen from straight above",
    detail: [
      "deep teal water (#2f6f78) with no bottom visible",
      `small, soft ripples ${sz(10, 30)} across, all in the same size range, spread evenly and facing every way`,
      `a few tiny floating rafts of white salt crystals (${sz(2, 8)}), scattered evenly and far apart`,
    ],
    feel: "calm and even: the game animates the water itself",
    exclude: ["shoreline or sand", "foam or whitecaps", "reflections of the sun, sky or clouds", "boats, plants or rocks"],
  },
  mountain: {
    name: "Red sandstone",
    what: "the broken top of red sandstone cliffs, seen from straight above — hard, rough and impassable",
    detail: [
      `blocky red sandstone (#9a5a3c) split into irregular ledges and blocks ${sz(50, 150)} across, of mixed sizes`,
      "inside each block, faint cross-bedded layering in a DIFFERENT direction from its neighbours, so no direction dominates the image",
      "deep crevices (#4a2618) between blocks, with pale sand (#d0a878) drifted into them",
      `wind-eroded hollows and pits ${sz(5, 25)} across on the block tops`,
      "strong relief: top-left faces lit and orange (#c0784a), bottom-right faces and crevices dark",
    ],
    feel: "the reddest, roughest surface of the biome",
    exclude: ["parallel strata running across the whole image", "plants", "snow", "a single summit", "perspective cliff walls"],
  },
  bridge: {
    name: "Plank bridge",
    what: "the deck of a desert plank bridge, seen from straight above — only the deck, filling the image",
    detail: [
      "sun-bleached, dry timber planks running LEFT-TO-RIGHT, in exactly the rows of Image 1: 16 rows, each 64 px tall, with the same gaps, with a thin dark gap (#3a2a18) between rows",
      "plank tones from warm tan-brown (#8a6844) to pale silver-grey (#a89a86), with dry, split grain along each plank",
      "where two planks meet end to end, a thin joint with two small dark nail heads; the joints are staggered differently in every row and never line up vertically",
      "fine pale sand (#d8c8a4) caught in the gaps and dusted over the boards",
    ],
    feel: "belongs to the caliche track; painted, never a photograph of wood",
    exclude: ["railings, posts or ropes", "the ends or outline of the bridge", "water or banks"],
  },
};
