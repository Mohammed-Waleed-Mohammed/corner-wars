// 29 — Frostmarch materials (26 §A/§F): sub-arctic tundra, snowfields, spruce and lakes that never
// quite freeze. Cool whites with blue shadows; roads are kept clear.

import type { TexKey } from "../../content/biomes";
import { sz } from "./types";
import type { TextureDesc } from "./types";

export const FROSTMARCH_TEX: Record<TexKey, TextureDesc> = {
  ground: {
    name: "Snowfield",
    what: "an open, wind-packed snowfield, seen from straight above",
    detail: [
      `wind-scalloped snow: shallow, cup-shaped scallops and low rounded ridges ${sz(20, 80)} across, facing in RANDOM directions — never parallel drifts`,
      "cool off-white snow (#dfe6ee) with faint blue shadows (#b8c6d8) in the hollows and on the bottom-right side of each scallop",
      "a fine, even sparkle: tiny bright ice glints (pure white, 1–2 px), scattered over the whole image",
      `a few tiny bits of blown grass or grit (${sz(1, 3)}), very sparse`,
    ],
    feel: "bright but not blown out: the snow keeps visible texture everywhere, mid-grey-blue shadows, no pure white areas",
    exclude: ["sastrugi or drift lines all running one way", "footprints or tracks", "rocks", "trees or shadows of trees", "ice sheets"],
  },
  forest_floor: {
    name: "Spruce floor",
    what: "trampled snow on the floor of a spruce forest, seen from straight above",
    detail: [
      "thinner, grey-blue snow (#b8c4cc) than the open snowfield, unevenly packed",
      `fallen spruce needles, small twigs and cone scales ${sz(2, 10)}, dark brown (#4a3a2a), scattered at random`,
      `drip pits and small hollows ${sz(5, 20)} across, slightly darker`,
      `a few patches of dark earth and moss (#5a5a4a) ${sz(15, 50)} showing through the snow`,
    ],
    feel: "greyer and busier than the snowfield, as if under a canopy",
    exclude: ["trunks or roots", "whole branches", "footprints in a line", "light beams"],
  },
  road: {
    name: "Cleared road",
    what: "a ploughed and gravelled winter road, seen from straight above — only the road surface, never its edges",
    detail: [
      "grey compacted gravel and grit (#8c8a86) with a dusting of frost",
      `small stones ${sz(1, 5)} in grey and brown-grey, spread evenly`,
      `irregular patches of packed ice and dirty slush (#a8b0b8) ${sz(20, 80)} across, at random`,
      `a few glazed, frozen puddle spots (#9aa4ae) ${sz(10, 30)} across, matte (no glare)`,
    ],
    feel: "darker than the snow and clearly cleared, with NO direction",
    exclude: ["tyre tracks, plough lines or ruts", "snow banks or road edges", "stripes or lines", "glare on ice"],
  },
  hill: {
    name: "Snowdrift ridge",
    what: "the top of a deep snowdrift ridge, seen from straight above",
    detail: [
      "bright, deep, smooth drifted snow (#eef2f6), softer and smoother than the snowfield",
      `gentle rounded drift mounds ${sz(60, 160)} across with soft blue-grey shading (#cfd8e4) on their bottom-right sides, in random orientations`,
      "a fine, even sparkle of tiny ice glints",
    ],
    feel: "the brightest and smoothest surface of the biome, so high ground reads at a glance",
    exclude: ["drift lines running one way", "cornices or edges", "rocks", "tracks"],
  },
  sand: {
    name: "Frozen shore",
    what: "a frozen gravel lake shore, seen from straight above",
    detail: [
      "grey coarse sand and gravel (#c8d0d4) glazed with white frost",
      `rounded pebbles ${sz(2, 8)} in grey, blue-grey and brown-grey, scattered at random`,
      `thin, clear ice crusts ${sz(10, 40)} across in a few hollows, matte`,
    ],
    feel: "grey-blue and gritty, between the snowfield and the frozen shallows",
    exclude: ["ripple lines", "open water or foam", "snow drifts", "plants"],
  },
  shallows: {
    name: "Frozen shallows",
    what: "thin, clear ice over shallow water, seen from straight above — walkable",
    detail: [
      "pale blue ice (#a8c8dc) through which a pebbly bottom is faintly visible",
      `trapped air bubbles: tiny white dots and small clusters (${sz(1, 4)}), scattered at random`,
      `hairline white cracks ${sz(20, 100)} long running in random directions, never parallel`,
      `frosted, whiter patches (#d4e2ec) ${sz(20, 70)} across`,
    ],
    feel: "clearly lighter than the deep icy lake and clearly ice, not water",
    exclude: ["glare or reflections", "open water", "snow drifts", "skate marks or lines"],
  },
  water: {
    name: "Icy lake",
    what: "the surface of a deep, near-freezing lake, seen from straight above",
    detail: [
      "dark, cold blue water (#1e3a52) with no bottom visible",
      `small, soft ripples ${sz(10, 25)} across, all similar in size, spread evenly and facing every way`,
      `a few tiny slush crystals and ice specks (${sz(2, 6)}), grey-white, scattered evenly and far apart`,
    ],
    feel: "calm and even: the game draws the drifting ice floes and animates the water itself",
    exclude: ["large ice floes", "shoreline", "foam", "reflections of sky, sun or clouds"],
  },
  mountain: {
    name: "Glacier rock",
    what: "the icy top of a glacier-scoured granite ridge, seen from straight above — hard and impassable",
    detail: [
      `blue-grey granite (#7c8894) in irregular crags and smooth glacier-polished slabs ${sz(50, 150)} across, of mixed sizes`,
      "snow and ice (#e6eef6) lying in the cracks and on the flatter ledges, about a third of the area",
      "deep crevices (#2e3640) between the crags, with rime on their edges",
      "strong relief: top-left faces lit, bottom-right faces and crevices dark blue-grey",
    ],
    feel: "colder and bluer than the snowfield, clearly rock",
    exclude: ["a single summit", "trees", "open water", "perspective cliff walls"],
  },
  bridge: {
    name: "Iron-braced bridge",
    what: "the deck of a heavy iron-braced timber bridge, seen from straight above — only the deck, filling the image",
    detail: [
      "dark weathered timber planks (#6a5444) running LEFT-TO-RIGHT, in exactly the rows of Image 1: 16 rows, each 64 px tall, with the same gaps",
      "white frost and a little packed snow in the gaps between rows",
      "two dark iron straps (#3a3a3e), each about 32 px wide, running top-to-bottom across every plank exactly where Image 1 has them (at about 23% and 73% of the width), bolted to each plank with a round bolt head",
      "where two planks meet end to end, a thin joint with two small nail heads; joints staggered differently in every row, never lining up vertically",
      "grain running along each plank; a few darker, wetter boards",
    ],
    feel: "belongs to the cleared road; painted, never a photograph",
    exclude: ["railings or posts", "the ends or outline of the bridge", "water or banks", "more than the two iron straps"],
  },
};
