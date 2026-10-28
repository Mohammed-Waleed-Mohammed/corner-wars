// 29 §F — faction building prompts: one building as a straight top-down roof plan on flat #FF00FF,
// filling exactly the guide's footprint rectangle (its tile proportions). The game draws the owner
// trim and the shadows itself, so the rules are about the rectangle, a clean key and readability.

import { BUILDING_FILL, FACTION_LOOK, factionFlavour } from "../../content/factionArt";
import { FACTIONS } from "../../content/factions";
import { GUIDE_SIZE, buildingGamePx, buildingGuideRect, buildingSpec, buildingTiles } from "../catalog";
import type { AttachPlan, BuildingAsset } from "../catalog";
import { DO_NOT_COMMON, GAME, assemble, bullets, factionLabel, factionMotifs, factionPaletteLines, keyedRules, numbered, referenceLines, section, styleLines } from "./common";

const cap = (s: string): string => `${s[0].toUpperCase()}${s.slice(1)}`;

export function buildingPrompt(a: BuildingAsset, plan: AttachPlan): string {
  const f = a.faction, look = FACTION_LOOK[f], p = look.palette, spec = buildingSpec(a.buildingType);
  const { w, h } = buildingTiles(a.buildingType), r = buildingGuideRect(a.buildingType), game = buildingGamePx(a.buildingType);
  const tiles = `${w} × ${h} tile${w * h > 1 ? "s" : ""}`;
  const ratio = w === h ? "square (1 : 1)" : `${w} : ${h} (${w > h ? "wider than tall" : "taller than wide"})`;

  const task = section("TASK", [
    `Repaint Image 1 as a finished game building sprite: ${spec.noun} of ${factionLabel(f)}, for ${GAME}.`,
    `Output exactly ONE square image, ${GUIDE_SIZE} × ${GUIDE_SIZE} pixels: the single building, seen from straight above as a roof plan, on a perfectly flat #FF00FF magenta background.`,
    "Image 1 is the game's own placeholder for this building: it already has the correct footprint, roof layout, colours and light. Your job is to replace its flat procedural look with painted detail — not to invent a new composition.",
  ]);

  const keep = section("KEEP EXACTLY", bullets([
    `Canvas: square, ${GUIDE_SIZE} × ${GUIDE_SIZE} px.`,
    "Camera: orthographic, looking straight down at 90° — a roof plan. Only the roofs and the tops of things are visible: no walls or facades, no perspective, no isometric or three-quarter view.",
    `Footprint: the building occupies exactly the rectangle shown in Image 1: ${tiles}, ${r.w} × ${r.h} px, centred (left edge at x = ${r.x} px, top edge at y = ${r.y} px). It fills that rectangle edge to edge, its outline is ${ratio}, and nothing lies beyond it: no extra wings, annexes, yard, fence or apron.`,
    "Layout: every part of the roof plan stays where Image 1 has it, at the same size and with the same outline.",
    `Colours: as in Image 1 — mostly ${p.base} and ${p.mid}, with ${p.dark} shadows and frames, ${p.light} highlights and trim, ${p.accent} faction markings and ${p.glass} glass.`,
    "Background: flat #FF00FF everywhere outside the building, exactly as in Image 1.",
  ]));

  const paint = section("PAINT", [
    `${cap(spec.look)}.`,
    ...bullets([
      `Faction look (${FACTIONS[f].short}): ${factionFlavour(f, "building")}`,
      `Shape language: ${look.shape}`,
      `Materials: ${look.materials.join("; ")}.`,
      `Faction motifs: ${factionMotifs(f).join("; ")}.`,
      `Palette, as exact hex colours: ${factionPaletteLines(f, "building").join("; ")}.`,
    ]),
  ]);

  const style = section("STYLE", bullets([
    ...styleLines("buildings and bases"),
    `In the game this building is drawn only ${game.w} × ${game.h} px (32 px per tile), so the roof layout must read at that size: big clear roof shapes, a strong light/dark split, the faction colours and emblem visible, no fussy noise.`,
    "The same painting style, rendering and level of detail as the attached reference images, so every building and unit of every faction looks painted by one artist.",
  ]));

  const light = section("LIGHT", bullets([
    "Sun from the top-left, 45° above the ground.",
    "Raised parts (roof ridges, stacks, domes, masts, cranes, barrels) are lit on their top-left and shaded on their bottom-right, with self-shading only: no shadow falls outside the building's outline.",
    "No light falls on the background: the background stays flat #FF00FF.",
  ]));

  const rules = section("RULES", numbered([
    ...keyedRules("building", f),
    "Exactly ONE building: no units, vehicles, people, trees or a second building around it, and no particles or debris anywhere in the background.",
    "No smoke, steam, fire or sparks from chimneys, stacks or guns: the building is shown at rest.",
    `Keep Image 1's rectangle and roof layout: the same outline, the same centre, the same ${w} : ${h} proportions. The game fits the result into ${Math.round(BUILDING_FILL * 100)}% of the ${tiles} footprint without stretching it, so a building with other proportions leaves gaps and is rejected.`,
  ]));

  const refs = section("REFERENCES", bullets(referenceLines(plan.list, a)));

  const doNot = section("DO NOT", bullets([
    ...DO_NOT_COMMON,
    "perspective, visible walls or facades, an isometric or three-quarter view, or a visible horizon",
    "ground, grass, soil, roads, paths, a yard, fences, a concrete apron or anything else around the building",
    "cast shadows, drop shadows or contact shadows",
    "a player or team-colour border or trim around the footprint: the game draws the owner's trim itself, so paint only the faction palette",
    "units, vehicles, people or a second building",
    "glow, halo, outline, stroke or a pink/magenta fringe around the building",
    "smoke, steam, fire, sparks or particles",
    ...look.avoid,
  ]));

  return assemble([task, keep, paint, style, light, rules, refs, doNot]);
}
