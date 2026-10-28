// 29 §F — faction unit prompts: one unit, straight top-down, FACING UP, on flat #FF00FF, keeping the
// guide's silhouette and footprint. The game rotates the sprite to the unit's heading and draws its
// shadow and owner ring itself, so the rules are about facing, a clean key and a bold silhouette.

import { FACTION_LOOK, factionFlavour } from "../../content/factionArt";
import { FACTIONS, UNIT_NAMES } from "../../content/factions";
import { GUIDE_SIZE, unitSpec } from "../catalog";
import type { AttachPlan, UnitAsset } from "../catalog";
import { DO_NOT_COMMON, GAME, assemble, bullets, factionLabel, factionMotifs, factionPaletteLines, keyedRules, numbered, referenceLines, section, styleLines } from "./common";

const cap = (s: string): string => `${s[0].toUpperCase()}${s.slice(1)}`;

export function unitPrompt(a: UnitAsset, plan: AttachPlan): string {
  const f = a.faction, look = FACTION_LOOK[f], p = look.palette, spec = unitSpec(a.unitType);
  const fp = spec.footprint, fpPx = Math.round(fp * GUIDE_SIZE);
  const fac = factionLabel(f);
  const what = spec.vehicle ? "vehicle" : "soldier";
  const front = spec.vehicle ? "its nose and main gun or barrel" : "the head, shoulders and the weapon or tool held forward";

  const task = section("TASK", [
    `Repaint Image 1 as a finished game unit sprite: ${spec.noun} of ${fac}, called the "${UNIT_NAMES[f][a.unitType]}", for ${GAME}.`,
    `Output exactly ONE square image, ${GUIDE_SIZE} × ${GUIDE_SIZE} pixels: the single unit, seen from straight above and facing UP, on a perfectly flat #FF00FF magenta background.`,
    "Image 1 is the game's own placeholder for this unit: it already has the correct silhouette, footprint, facing, colours and light. Your job is to replace its flat procedural look with painted detail — not to invent a new composition.",
  ]);

  const keep = section("KEEP EXACTLY", bullets([
    `Canvas: square, ${GUIDE_SIZE} × ${GUIDE_SIZE} px.`,
    `Camera: orthographic, looking straight down at 90° onto the top of the ${what}. No perspective, no isometric or three-quarter view, no visible side walls or underside.`,
    `Facing: the unit faces UP — ${front} point straight at the top edge of the image (12 o'clock), exactly as in Image 1. The game rotates the sprite to the unit's heading, so any other direction breaks it.`,
    `Silhouette and footprint: the unit stays exactly where Image 1 has it, at the same size, with the same outline. It is centred, and its larger dimension spans exactly ${Math.round(fp * 100)}% of the image (${fpPx} px) — never more.`,
    `Colours: as in Image 1 — mostly ${p.base} and ${p.mid}, with ${p.dark} shadows and frames, ${p.light} highlights, ${p.accent} faction markings and ${p.glass} glass.`,
    "Background: flat #FF00FF everywhere outside the unit, exactly as in Image 1.",
  ]));

  const paint = section("PAINT", [
    `${cap(spec.look)}.`,
    ...bullets([
      `Faction look (${FACTIONS[f].short}): ${factionFlavour(f, "unit", spec.vehicle)}`,
      `Shape language: ${look.shape}`,
      `Materials: ${look.materials.join("; ")}.`,
      `Faction motifs (use the ones that fit a ${what} this small, kept simple): ${factionMotifs(f).join("; ")}.`,
      `Palette, as exact hex colours: ${factionPaletteLines(f, "unit").join("; ")}.`,
    ]),
  ]);

  const style = section("STYLE", bullets([
    ...styleLines("unit sprites"),
    `In the game this unit is only ${spec.gamePx} px long, so make the silhouette bold and readable: big clear shapes, a strong light/dark split, the faction accent colour visible, no fussy noise or tiny detail.`,
    "The same painting style, rendering and level of detail as the attached reference images, so every unit and building of every faction looks painted by one artist.",
  ]));

  const light = section("LIGHT", bullets([
    "Sun from the top-left, 45° above the ground.",
    "Every part of the unit is lit on its top-left and shaded on its bottom-right: a clear sense of volume, with self-shading only.",
    "No light falls on the background: the background stays flat #FF00FF.",
  ]));

  const rules = section("RULES", numbered([
    ...keyedRules("unit", f),
    `Exactly ONE unit: no second unit, no crew standing beside it, no particles, sparks, cartridges or debris anywhere in the background.`,
    "No muzzle flash, smoke, dust, exhaust, tracer fire or motion blur: the unit is shown at rest.",
    "Keep Image 1's silhouette and facing: the same outline, the same footprint, the same centre, the front toward the top edge.",
  ]));

  const refs = section("REFERENCES", bullets(referenceLines(plan.list, a)));

  const doNot = section("DO NOT", bullets([
    ...DO_NOT_COMMON,
    "cast shadows, drop shadows, contact shadows, a ground plane, a base, a plinth or a selection ring",
    "a player or team-colour ring, disc or outline: the game adds the owner's colour itself, so paint only the faction palette",
    "glow, halo, outline, stroke or a pink/magenta fringe around the unit",
    "muzzle flash, smoke, fire, explosions, motion blur, dust or exhaust",
    "a side view, perspective, an isometric or three-quarter view or a visible horizon",
    "the unit facing any direction but up, or turned at an angle",
    ...look.avoid,
  ]));

  return assemble([task, keep, paint, style, light, rules, refs, doNot]);
}
