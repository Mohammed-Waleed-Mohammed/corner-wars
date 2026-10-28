// 29 §F — texture prompts. The RULES section encodes every lesson from the rejected first batch:
// a quarter of the image repeated 2×2, glare/gradients that striped when tiled, a road with
// directional ruts, and a photo-real bridge.

import type { TexKey } from "../../content/biomes";
import { BIOMES } from "../../content/biomes";
import { GUIDE_SIZE, TEX_METRES, assetTone, textureDesc } from "../catalog";
import type { AttachPlan, TextureAsset } from "../catalog";
import { DO_NOT_COMMON, GAME, STYLE_COMMON, assemble, biomeLabel, bullets, numbered, referenceLines, section, toneHex } from "./common";

/** What each material is used for in the game (so the model knows its job). */
const ROLE: Record<TexKey, string> = {
  ground: "base ground texture that covers most of every map",
  forest_floor: "forest-floor texture (the ground under the trees of a forest)",
  road: "road texture",
  hill: "hill-top texture (raised high ground)",
  sand: "shoreline texture (the ring between the ground and the water)",
  shallows: "shallow-water texture (wadeable)",
  water: "deep-water texture (impassable)",
  mountain: "mountain-top texture (impassable)",
  bridge: "bridge-deck texture",
};

const PX_PER_M = GUIDE_SIZE / TEX_METRES;
const MAX_FEATURE = `about 15% of the image width (${Math.round(GUIDE_SIZE * 0.15)} px)`;

export function texturePrompt(a: TextureAsset, plan: AttachPlan): string {
  const d = textureDesc(a);
  const t = toneHex(assetTone(a));
  const bridge = a.tex === "bridge";
  const liquid = a.tex === "water" && BIOMES[a.biome].water === "lava" ? "molten lava" : null;

  const task = section("TASK", [
    `Repaint Image 1 as a finished, seamless, tileable game texture: "${d.name}", the ${ROLE[a.tex]} of ${biomeLabel(a.biome)} in ${GAME}.` +
      `${liquid ? ` In this biome the "water" is ${liquid}.` : ""}`,
    `Output exactly ONE square image, ${GUIDE_SIZE} × ${GUIDE_SIZE} pixels.`,
    "Image 1 is the game's own placeholder for this texture. It already has the correct layout, colours, scale and lighting, and it is already seamless. Your job is to replace its flat procedural look with painted surface detail — not to invent a new picture.",
  ]);

  const keep = section("KEEP EXACTLY", bullets([
    `Canvas: square, ${GUIDE_SIZE} × ${GUIDE_SIZE} px, the surface filling it edge to edge.`,
    "Camera: orthographic, looking straight down at 90°. No perspective, no horizon, no tilt, no visible sides of anything.",
    `Scale: the image covers ${TEX_METRES} × ${TEX_METRES} metres of ground, so 1 metre = ${PX_PER_M} px.`,
    "Layout: every lighter and darker area of Image 1 stays where it is, with the same size and shape. Do not move, add, remove or resize areas.",
    `Colour: the average colour of the whole image stays ${t.mid}. The darkest details go down to about ${t.dark}; the brightest up to about ${t.light}. No other dominant colours.`,
    bridge ? "Rows: the rows of the deck stay exactly where Image 1 has them: same number, same heights, same gaps, running left-to-right." : "Seamlessness: Image 1 tiles perfectly; your image must too.",
  ]));

  const paint = section("PAINT", [`${d.what[0].toUpperCase()}${d.what.slice(1)}.`, ...bullets(d.detail), `Overall: ${d.feel}.`]);

  const style = section("STYLE", bullets([
    ...STYLE_COMMON,
    "In the game this image is shown at 256 × 256 px and repeated side by side, so details must stay readable at a quarter of their size.",
    ...(bridge ? ["The deck is PAINTED like the other terrain textures — simplified wood grain and clean shapes. It must not look like a photograph of real timber or stone."] : []),
  ]));

  const light = section("LIGHT", bullets([
    "Sun from the top-left, 45° above the ground.",
    "The sun shows ONLY in the small shading of each detail: lit on its top-left side, shaded on its bottom-right side.",
    "The overall brightness is identical everywhere: the four corners, the four edges and the centre have the same average brightness and colour.",
  ]));

  const rules = section("RULES", numbered([
    "ONE continuous surface. Not a grid, collage, 2×2 preview, contact sheet, tile set or set of variations.",
    `No copied regions. Do not repeat, copy, mirror or rotate any part of the image inside itself: every ${PX_PER_M} × ${PX_PER_M} px area must be different from every other. The game repeats the WHOLE image by placing copies side by side, so any repetition inside it shows as an obvious pattern. (A previous attempt repeated one quarter of the image 2×2 — that is wrong.)`,
    "Perfectly even brightness: no glare, no sun hotspot, no reflection of the sun, no light beams, no vignette, no gradient, no darker or lighter side, corner, band or stripe. (A previous attempt had glare and a gradient, which made visible stripes when tiled.)",
    bridge
      ? "Direction: ONLY the deck rows run left-to-right, exactly as in Image 1. Joints are staggered differently in every row so that no joint line runs from top to bottom (anything Image 1 already runs top-to-bottom, such as iron straps, stays exactly as it is). Nothing else has a direction."
      : "No direction: the surface must look equally natural when rotated by 90°. Nothing runs mainly one way — no ruts, tracks, streaks, ripples, waves, stripes, cracks or grain lining up, and no features arranged in rows, diagonals or a grid. (A previous road attempt had directional wheel ruts — that is wrong.)",
    `Even density: features are scattered at random but evenly over the whole image — no clusters, no empty areas, no single feature larger than ${MAX_FEATURE}.`,
    "Seamless: the left edge continues perfectly into the right edge, and the top edge into the bottom edge. Nothing is cut off differently at an edge; no edge shading.",
  ]));

  const refs = section("REFERENCES", bullets(referenceLines(plan.list, a)));

  const doNot = section("DO NOT", bullets([
    ...DO_NOT_COMMON,
    "people, animals, vehicles, buildings or man-made objects",
    ...d.exclude,
    "a grid, collage or 2×2 preview, or any repeated, copied or mirrored region",
    "glare, highlights on the whole surface, a vignette, a gradient or light beams",
    ...(bridge ? ["a photo-real or photographic look of wood or stone"] : ["anything with a direction: ruts, tracks, stripes, rows or parallel lines"]),
  ]));

  return assemble([task, keep, paint, style, light, rules, refs, doNot]);
}
