// 29 §F — sprite prompts: one object on flat #FF00FF, keeping the guide's silhouette and footprint.
// The Art Lab keys the magenta out, so the rules are about a clean key: flat background, no shadow,
// no halo, nothing clipped, no magenta inside the object.

import { BIOMES, SPRITE_COUNT } from "../../content/biomes";
import { GUIDE_SIZE, SPRITE_FOOTPRINT, SPRITE_GAME_PX, assetTone, spriteDesc } from "../catalog";
import type { AttachPlan, SpriteAsset } from "../catalog";
import { DO_NOT_COMMON, GAME, STYLE_COMMON, assemble, biomeLabel, bullets, numbered, referenceLines, section, toneHex } from "./common";

const KIND_WORD = { tree: "tree", rock: "rock", bush: "bush", tuft: "grass tuft" } as const;
const MARGIN = 0.04; // empty magenta band required on every side
const TUFT_BASE = 0.94; // where the tuft's base sits (fraction of height from the top)

export function spritePrompt(a: SpriteAsset, plan: AttachPlan): string {
  const d = spriteDesc(a);
  const t = toneHex(assetTone(a));
  const tuft = a.sprite === "tuft";
  const fp = SPRITE_FOOTPRINT[a.sprite];
  const fpPx = Math.round(fp * GUIDE_SIZE);
  const marginPx = Math.round(MARGIN * GUIDE_SIZE);
  const [gMin, gMax] = SPRITE_GAME_PX[a.sprite];
  const scar = a.biome === "scar";

  const task = section("TASK", [
    `Repaint Image 1 as a finished game sprite: ${d.subject} — "${d.name}", ${KIND_WORD[a.sprite]} ${a.index + 1} of ${SPRITE_COUNT[a.sprite]} for ${biomeLabel(a.biome)} in ${GAME}.`,
    `Output exactly ONE square image, ${GUIDE_SIZE} × ${GUIDE_SIZE} pixels: the single object on a perfectly flat #FF00FF magenta background.`,
    "Image 1 is the game's own placeholder for this sprite: it already has the correct silhouette, footprint, colours and light. Your job is to replace its flat procedural look with painted detail — not to invent a new composition.",
  ]);

  const keep = section("KEEP EXACTLY", bullets([
    `Canvas: square, ${GUIDE_SIZE} × ${GUIDE_SIZE} px.`,
    tuft
      ? "Camera: a side (front) view at eye level, because the game stands the tuft upright on the ground and sways it in the wind."
      : "Camera: orthographic, looking straight down at 90° onto the top of the object. No perspective, no side view, no visible trunk or underside.",
    tuft
      ? `Silhouette and footprint: the same outline as Image 1, centred left-to-right, ${Math.round(fp * 100)}% of the image width (${fpPx} px) wide. Its base sits on an imaginary ground line at ${Math.round(TUFT_BASE * 100)}% of the image height (${Math.round(TUFT_BASE * GUIDE_SIZE)} px from the top), even if Image 1's base is lower.`
      : `Silhouette and footprint: the object stays exactly where Image 1 has it, at the same size, with the same outline. It is centred, and its larger dimension spans ${Math.round(fp * 100)}% of the image (${fpPx} px) — never more.`,
    `Colour: the object's average colour stays close to ${t.mid}; its shadows go down to about ${t.dark} and its highlights up to about ${t.light}, plus the accent colours named in PAINT.`,
    "Background: flat #FF00FF everywhere outside the object, exactly as in Image 1.",
  ]));

  const paint = section("PAINT", [`${d.subject[0].toUpperCase()}${d.subject.slice(1)}.`, ...bullets(d.detail)]);

  const style = section("STYLE", bullets([
    ...STYLE_COMMON,
    `In the game this sprite is drawn only ${gMin === gMax ? `${gMin}` : `${gMin}–${gMax}`} px wide, so the silhouette and the light/dark split must read instantly; avoid fussy noise.`,
    `It must belong with ${BIOMES[a.biome].name}'s other terrain art: same painting style, same light, same colour harmony.`,
  ]));

  const light = section("LIGHT", bullets([
    "Sun from the top-left, 45° above the ground.",
    tuft
      ? "Each blade is lit on its left side and shaded on its right side."
      : "Every part of the object is lit on its top-left and shaded on its bottom-right: a clear sense of volume, with self-shading only.",
    "No light falls on the background: the background stays flat #FF00FF.",
  ]));

  const rules = section("RULES", numbered([
    "Background: every pixel that is not the object is exactly #FF00FF (red 255, green 0, blue 255) — flat, with no gradient, texture, noise, vignette, or lighter or darker magenta.",
    "No cast shadow (the game draws shadows itself), no ground, grass, soil, snow or water under or around the object, no halo, no glow, no outline and no stroke. The edge goes straight from the object's own colours to #FF00FF.",
    `Nothing touches or crosses the image edge: keep at least ${Math.round(MARGIN * 100)}% (${marginPx} px) of pure #FF00FF on every side${tuft ? ", including below the base" : ""}.`,
    scar
      ? "The object must contain no magenta, pink or hot-purple, and no colour close to #FF00FF — they would be cut out with the background. Violets must be clearly BLUE-violet (like #7a5ac8 or #a088e0), never pink-violet."
      : "The object must contain no magenta, pink or purple, and no colour close to #FF00FF — they would be cut out with the background.",
    "Exactly ONE object: no second object, no floating leaves, petals, sparks, particles or debris anywhere in the background.",
    "Keep Image 1's silhouette: the same outline, the same footprint, the same centre. Every variant must fill the same footprint in the game.",
  ]));

  const refs = section("REFERENCES", bullets(referenceLines(plan.list, a)));

  const doNot = section("DO NOT", bullets([
    ...DO_NOT_COMMON,
    "cast shadows, drop shadows, contact shadows, a ground plane, a base, a plinth or a pot",
    "glow, halo, outline, stroke or a pink/magenta fringe around the object",
    "a second object, particles or debris",
    ...d.exclude,
    tuft ? "a top-down view" : "a side view, perspective or a visible horizon",
  ]));

  return assemble([task, keep, paint, style, light, rules, refs, doNot]);
}
