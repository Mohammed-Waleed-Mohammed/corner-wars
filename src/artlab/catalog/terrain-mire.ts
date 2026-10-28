// 29 — Mirelands materials (26 §A/§F): a southern marsh delta of mud, mangrove and flooded towns.
// Olive and peat browns, everything wet but matte (no glare).

import type { TexKey } from "../../content/biomes";
import { sz } from "./types";
import type { TextureDesc } from "./types";

export const MIRE_TEX: Record<TexKey, TextureDesc> = {
  ground: {
    name: "Mudflat",
    what: "a wet olive-brown mudflat, seen from straight above",
    detail: [
      "soft, smooth olive-brown mud (#4c4a2e) with a faint damp sheen that stays matte — no glare or reflections",
      `small, shallow puddles of dark brown water (#2e2e1e) ${sz(10, 40)} across, scattered at random, matte`,
      `patches of green algae film (#5a6a30) ${sz(20, 80)} across`,
      `bits of broken reed stem and leaf ${sz(3, 15)} long, lying at random angles`,
    ],
    feel: "soft and wet, browner and darker than any meadow",
    exclude: ["footprints or bird tracks", "reflections of sky", "drying-mud crack polygons", "rocks", "standing plants"],
  },
  forest_floor: {
    name: "Mangrove floor",
    what: "the wet mud floor of a mangrove thicket, seen from straight above",
    detail: [
      "dark, wet peaty mud (#2c3420)",
      `many small mangrove breathing-roots poking up through the mud, seen from above as round knobs and short pencil tips ${sz(1, 4)} across, scattered unevenly`,
      `fallen oval leaves ${sz(3, 8)} long, olive (#5a6a30) and yellow-brown (#8a7a3a), lying flat at random angles`,
      `patches of dark moss (#3a4a26) ${sz(15, 50)} across`,
    ],
    feel: "darker and greener than the mudflat",
    exclude: ["trunks or large roots crossing the image", "standing water pools", "light beams", "reflections"],
  },
  road: {
    name: "Causeway",
    what: "the surface of a packed-earth causeway through the marsh, seen from straight above — only the surface, never its edges",
    detail: [
      "compacted clay-mud (#6a5638) mixed with crushed pale shell (#b8a888) and fine gravel",
      `short pieces of trampled reed and broken plank fragments ${sz(5, 25)} long, lying at random angles`,
      `irregular darker, wetter patches (#544430) ${sz(30, 100)} across`,
    ],
    feel: "firmer and lighter than the mudflat, with NO direction",
    exclude: ["ruts or tracks", "planks laid in rows", "stripes or lines", "puddles", "edges or verges"],
  },
  hill: {
    name: "Hummock",
    what: "the top of a raised, drier hummock in the marsh, seen from straight above",
    detail: [
      `clumped tussock grass and sedge in olive (#5c6034) and straw (#9a9a5a), in tufts ${sz(15, 40)} across seen from above`,
      "bright green sphagnum moss (#6a8a3a) between the tussocks",
      `small patches of dark peat (#3a3020) ${sz(10, 30)} across`,
    ],
    feel: "greener and drier than the mudflat, so high ground reads at a glance",
    exclude: ["water", "slopes or edges", "trees or bushes", "paths"],
  },
  sand: {
    name: "Silt bank",
    what: "a silty, sandy bank at the water's edge, seen from straight above",
    detail: [
      "fine grey-brown silt and sand (#7a6a48)",
      `small freshwater snail shells and shell fragments ${sz(1, 3)}, scattered`,
      `bits of dead reed ${sz(3, 12)} long, at random angles`,
      `slightly darker damp patches (#665a3e) ${sz(30, 90)} across`,
    ],
    feel: "the lightest ground of the biome, between the mud and the bog",
    exclude: ["ripple lines", "water", "standing plants", "footprints"],
  },
  shallows: {
    name: "Bog",
    what: "shallow, murky bog water a hand deep, seen from straight above — wadeable",
    detail: [
      "murky olive water (#4a5a3a) with the muddy bottom faintly visible",
      `short sedge and grass stubble poking through the surface in small sparse clumps ${sz(5, 20)} across`,
      `floating duckweed specks (#7a9a3a) in loose patches ${sz(10, 40)} across`,
      `a few patches of sphagnum moss (#6a7a3a) ${sz(15, 40)} across`,
    ],
    feel: "between the mud and the dark bog water; clearly wet, clearly shallow",
    exclude: ["reflections of sky or trees", "foam or waves", "tall reeds", "glare"],
  },
  water: {
    name: "Bog water",
    what: "the still surface of deep bog water, seen from straight above",
    detail: [
      "dark, tannin-stained olive-black water (#26301e), perfectly still",
      `scattered small patches of duckweed (#5a7a2a) ${sz(5, 25)} across, spread evenly over the image, never one big mat`,
      "a few faint, tiny bubbles",
    ],
    feel: "dark and still: the game animates the water itself",
    exclude: ["reflections of sky or trees", "glare", "lily pads", "shoreline", "ripples in one direction"],
  },
  mountain: {
    name: "Old levee",
    what: "the overgrown top of an old, broken flood levee, seen from straight above — impassable",
    detail: [
      `broken slabs and blocks of weathered grey concrete and stone (#4a4a3a to #6a6a58) ${sz(50, 150)} across, tilted and cracked, of mixed sizes`,
      "thick moss (#4a6a2a), creeping vines and small ferns covering about half the surface and filling the cracks",
      "deep, dark gaps (#1e2014) between the slabs",
      "strong relief: top-left faces lit, bottom-right faces dark",
    ],
    feel: "a ruined man-made embankment reclaimed by the marsh; clearly not walkable",
    exclude: ["rebar or pipes", "buildings, walls or windows", "water", "a single summit", "text or graffiti"],
  },
  bridge: {
    name: "Pile bridge",
    what: "the deck of a timber pile bridge over the marsh, seen from straight above — only the deck, filling the image",
    detail: [
      "dark, wet timber planks (#5a4630) running LEFT-TO-RIGHT, in exactly the rows of Image 1: 16 rows, each 64 px tall, with the same gaps",
      "green moss and algae (#4a5a2a) growing in the gaps between rows and on a few boards",
      "where two planks meet end to end, a joint with two rusty nail heads; joints staggered differently in every row, never lining up vertically",
      "a few patched, mismatched boards (lighter, #7a6448)",
    ],
    feel: "belongs to the causeway; painted, never a photograph",
    exclude: ["railings, ropes or posts", "the ends or outline of the bridge", "water", "reflections"],
  },
};
