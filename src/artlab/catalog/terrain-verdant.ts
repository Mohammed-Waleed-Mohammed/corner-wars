// 29 — Verdant Reach materials (26 §A/§F): temperate river valleys. verdant/ground is the MASTER
// STYLE of the whole game (29 §B step 1), so it is described most carefully.

import type { TexKey } from "../../content/biomes";
import { sz } from "./types";
import type { TextureDesc } from "./types";

export const VERDANT_TEX: Record<TexKey, TextureDesc> = {
  ground: {
    name: "Meadow",
    what: "a dense, even carpet of short meadow grass, seen from straight above — you see the blade tips, never the sides of clumps",
    detail: [
      `fine grass blades ${sz(3, 7)} long, pointing in every direction, with no combed or wind-blown look`,
      "muted mid-green overall (#486830); deeper green (#344b22) in the gaps between blades; sunlit blade tips in soft yellow-green (#6a8a40 to #8a9a48)",
      `soft, irregular lighter and darker patches ${sz(40, 150)} across, scattered at random: slightly drier and slightly lusher grass, not light and shadow`,
      `a few tiny three-leaf clover leaves (${sz(2, 4)}), scattered`,
      `at most 12 very small white and pale-yellow wildflowers (${sz(2, 4)}), each far from the others`,
    ],
    feel: "the baseline green of the game: calm, natural, slightly muted, never neon",
    exclude: ["paths or bare dirt", "rocks or pebbles", "trees, bushes or their shadows", "water or puddles", "groups of flowers", "mushrooms"],
  },
  forest_floor: {
    name: "Woodland floor",
    what: "the floor of a temperate oak-and-pine woodland under the canopy, seen from straight above",
    detail: [
      `a loose layer of fallen leaves ${sz(3, 8)} long in brown (#6a5232), olive (#5a5a2a) and dull ochre (#8a6a32), lying flat at random angles`,
      `patches of dark green moss (#2a3a1a) and short shade grass ${sz(20, 80)} across`,
      `scattered pine needles and small twigs ${sz(5, 25)} long, pointing every way`,
      "a few patches of dark, rich soil (#2a2418)",
    ],
    feel: "clearly darker and browner than the meadow, as if under a canopy — the shade is in the colours, not in painted shadows",
    exclude: ["tree trunks or roots crossing the image", "whole branches", "mushrooms larger than a leaf", "ferns or bushes", "rocks", "light beams or sun spots"],
  },
  road: {
    name: "Dirt road",
    what: "the surface of a packed dirt road, seen from straight above — only the road surface, never its edges",
    detail: [
      "compacted warm-brown earth (#826846) with fine gravel grit",
      `small pebbles ${sz(2, 6)} in grey (#8a8680) and tan (#a89070), spread evenly over the whole image`,
      `soft, irregular, slightly darker patches of damp, compacted earth (#6a5438), ${sz(30, 120)} across, at random`,
      `a very few flattened wisps of dry grass, each ${sz(4, 8)} long`,
    ],
    feel: "reads as a road at a glance, but has NO direction: the game lays it unrotated on roads running every way",
    exclude: ["wheel ruts, tyre tracks, hoof prints or drag marks", "stripes or lines of any kind", "road edges, verges, kerbs or grass borders", "puddles", "large stones"],
  },
  hill: {
    name: "Grassy hill",
    what: "the top of a low, sunny grassy hill, seen from straight above",
    detail: [
      `short, dry grass blades ${sz(2, 5)} long in yellow-green (#6c8436) with straw-coloured tips (#a8a060)`,
      `small patches of bare light-brown earth (#a08a5e), ${sz(10, 40)} across, of different shapes, scattered at random over about 15% of the area`,
      `a few tiny pebbles (${sz(1, 3)}) where the earth shows`,
    ],
    feel: "clearly drier, shorter, sparser and lighter than the meadow, so high ground reads at a glance",
    exclude: ["slopes, edges or contour lines", "large rocks", "trees or bushes", "paths"],
  },
  sand: {
    name: "Lake shore",
    what: "fine, pale lake-shore sand, seen from straight above",
    detail: [
      "fine golden-beige sand (#c0ac7a) — warm, never white — with grains too small to see one by one",
      "soft, shallow, non-directional dimples and low mounds",
      `a few tiny pebbles (${sz(1, 3)}) and small shell fragments, scattered far apart`,
      `a few slightly darker, damper patches (#a89468), ${sz(30, 100)} across`,
    ],
    feel: "the ring between the meadow and the shallows: lighter than both",
    exclude: ["wind ripples or ripple lines", "water, foam or waves", "grass", "footprints", "driftwood or large shells"],
  },
  shallows: {
    name: "Shallows",
    what: "shallow, clear lake water a few centimetres deep over a sandy bottom, seen from straight above — it must read as wadeable",
    detail: [
      "the sandy, pebbly bottom clearly visible through calm, clear green-teal water (#4e8a8e)",
      "faint, soft caustic light lines on the bottom — thin, wavy and net-like, irregular and subtle, never a bright web",
      `small rounded pebbles (${sz(2, 6)}) on the bottom, scattered at random`,
      "very gentle surface ripples with no main direction",
    ],
    feel: "darker than the sand and much lighter than the deep lake, a clear temperate lake (not a tropical sea)",
    exclude: ["shoreline", "foam or breaking waves", "reflections of sky or clouds", "fish or water plants", "deep dark areas"],
  },
  water: {
    name: "Lake",
    what: "the surface of a deep, calm temperate lake, seen from straight above (not an underwater view)",
    detail: [
      "deep blue-teal water (#1c4664) with no bottom visible",
      `small, soft ripples and wavelets ${sz(10, 30)} across, all in the same size range, spread evenly over the whole image and facing every way`,
      "a few tiny, faint sky highlights on ripple crests, scattered evenly, never grouped",
    ],
    feel: "calm and even: the game animates the water itself by drifting a copy over it",
    exclude: ["shoreline or sand", "foam or whitecaps", "boats, plants, fish or rocks", "reflections of the sun, sky, clouds or trees", "large swells"],
  },
  mountain: {
    name: "Granite mountain",
    what: "the rugged rocky top of an impassable granite ridge, seen from straight above — hard, rough and clearly not walkable",
    detail: [
      `weathered grey-brown granite (#6c6252) broken into irregular crags and ledges ${sz(50, 150)} across, of mixed sizes`,
      "deep, dark cracks and crevices (#2a241c) between the crags",
      `small piles of loose scree (${sz(3, 10)} stones) in the cracks`,
      "a few small patches of grey-green lichen (#7a826a) and moss",
      "strong relief: every crag's top-left face is clearly lit, its bottom-right face and the crevices clearly dark",
    ],
    feel: "the hardest, roughest surface of the biome; it must never look like paving",
    exclude: ["grass or snow", "trees", "water", "paths", "a single summit or peak", "perspective cliff walls"],
  },
  bridge: {
    name: "Timber bridge",
    what: "the deck of a sturdy timber bridge, seen from straight above — only the deck, filling the image",
    detail: [
      "weathered timber planks running LEFT-TO-RIGHT, in exactly the rows of Image 1: 16 rows, each 64 px tall, with the same gaps, with a thin dark gap (#2a1c10) between rows",
      "plank tones from warm brown (#7a5636) to grey-brown (#6a5a48), with wood grain running along each plank",
      "where two planks meet end to end, a thin dark joint with two small dark iron nail heads; the joints are staggered differently in every row and never line up vertically",
      "a few worn, darker or cracked boards and a light dusting of road dirt",
    ],
    feel: "belongs to the dirt road; painted in the same style as the other textures, never a photograph of wood",
    exclude: ["railings or posts", "the ends or outline of the bridge", "water or river banks", "vehicles"],
  },
};
