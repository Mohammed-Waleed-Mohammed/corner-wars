// 29 §F/§G — faction building prompts: one building as a straight top-down roof plan on flat #FF00FF,
// filling exactly the guide's footprint rectangle (its tile proportions). Unlike every other asset,
// a building takes only its rectangle, camera and colours from the guide: the roof is laid out from
// its SIGNATURE and LAYOUT (27 §H.1), so each type reads at a glance and the same type looks alike
// across factions. The game draws the owner trim and the shadows itself.

import { BUILDING_FILL, FACTION_LOOK, factionFlavour } from "../../content/factionArt";
import type { ArtBuildingType } from "../../content/factionArt";
import { FACTIONS } from "../../content/factions";
import { GUIDE_SIZE, buildingGamePx, buildingGuideRect, buildingSpec, buildingTiles } from "../catalog";
import type { AttachPlan, BuildingAsset } from "../catalog";
import { DO_NOT_COMMON, GAME, assemble, bullets, factionLabel, factionMotifs, factionPaletteLines, keyedRules, numbered, referenceLines, section, styleLines } from "./common";

const cap = (s: string): string => `${s[0].toUpperCase()}${s.slice(1)}`;

/** A faction "avoid" line that would forbid a type's own signature, reworded for that type. */
const AVOID_EXCEPT: Partial<Record<ArtBuildingType, Record<string, string>>> = {
  refinery: { "gold trim": "gold trim (the gold ore, molten gold and ingots are the signature, not trim: they stay)" },
  resonanceTap: { crystals: "crystals anywhere except the Tap's own cyan crystal core" },
};

export function buildingPrompt(a: BuildingAsset, plan: AttachPlan): string {
  const f = a.faction, look = FACTION_LOOK[f], p = look.palette, spec = buildingSpec(a.buildingType);
  const { w, h } = buildingTiles(a.buildingType), r = buildingGuideRect(a.buildingType), game = buildingGamePx(a.buildingType);
  const tiles = `${w} × ${h} tile${w * h > 1 ? "s" : ""}`;
  const ratio = w === h ? "square (1 : 1)" : `${w} : ${h} (${w > h ? "wider than tall" : "taller than wide"})`;

  const task = section("TASK", [
    `Paint a finished game building sprite: ${spec.noun} of ${factionLabel(f)}, for ${GAME}. In the game, ${spec.role}.`,
    `Output exactly ONE square image, ${GUIDE_SIZE} × ${GUIDE_SIZE} pixels: the single building, seen from straight above as a roof plan, on a perfectly flat #FF00FF magenta background.`,
    "Image 1 is the game's plain placeholder for this building. Take from it ONLY the footprint rectangle, the camera and the faction colours. Its roof is a rough stand-in: lay the roof out as SIGNATURE and LAYOUT describe, even where that differs from Image 1.",
  ]);

  const keep = section("KEEP EXACTLY", bullets([
    `Canvas: square, ${GUIDE_SIZE} × ${GUIDE_SIZE} px.`,
    "Camera: orthographic, looking straight down at 90° — a roof plan. Only the roofs and the tops of things are visible: no walls or facades, no perspective, no isometric or three-quarter view.",
    `Footprint: the building occupies exactly the rectangle shown in Image 1: ${tiles}, ${r.w} × ${r.h} px, centred (left edge at x = ${r.x} px, top edge at y = ${r.y} px). It fills that rectangle edge to edge, its outline is ${ratio}, and nothing lies beyond it: no extra wings, annexes, yard, fence or apron.`,
    `Colours: the building is mostly ${p.base} and ${p.mid}, with ${p.dark} shadows and frames, ${p.light} highlights and trim, ${p.accent} faction markings and ${p.glass} glass. The signature colours in SIGNATURE are used only where SIGNATURE puts them.`,
    "Background: flat #FF00FF everywhere outside the building, exactly as in Image 1.",
  ]));

  const signature = section("SIGNATURE — what it must read as, from far away", [
    `${cap(spec.signature)}.`,
    ...bullets([
      `This is what tells a player at a glance, zoomed out from across the map, that this is ${spec.short}. It is the largest and highest-contrast element on the roof; everything else is secondary, smaller and quieter.`,
      `Readability test: shrunk to ${game.w} × ${game.h} px (its size in the game) and blurred, it must still read as ${spec.short}. Use a few big, simple shapes with a strong light/dark split; leave out fine clutter.`,
      ...(spec.colours ? [`Signature colours: ${spec.colours}.`] : []),
      `Every faction's ${spec.short.replace(/^(a|an|the) /, "")} has this same signature, painted in its own materials and style: the faction changes the skin, never the signature.`,
      `It must never be mistaken for ${spec.notLike}.`,
    ]),
  ]);

  const layout = section(`LAYOUT — inside the ${tiles} footprint (top = the image's top edge)`, bullets(spec.layout.map((l) => `${cap(l)}.`)));

  const paint = section("PAINT", [
    `Every roof, wall top, trim and secondary part is painted in ${FACTIONS[f].short} style; the signature keeps its shape and colours.`,
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
    `In the game this building is drawn only ${game.w} × ${game.h} px (32 px per tile), next to the other buildings of the base: it must not look like a recoloured copy of them.`,
    "The same painting style, rendering and level of detail as the attached reference images, so every building and unit of every faction looks painted by one artist.",
  ]));

  const light = section("LIGHT", bullets([
    "Sun from the top-left, 45° above the ground.",
    "Raised parts (roof ridges, stacks, domes, masts, cranes, barrels) are lit on their top-left and shaded on their bottom-right, with self-shading only: no shadow falls outside the building's outline.",
    "No light falls on the background: the background stays flat #FF00FF. A glow that SIGNATURE asks for (molten metal, a crystal, a lit dome) stays inside the building's outline.",
  ]));

  const rules = section("RULES", numbered([
    ...keyedRules("building", f),
    "Exactly ONE building: no units, vehicles, people, trees or a second building around it, and no particles or debris anywhere in the background.",
    "No smoke, steam, fire or sparks from chimneys, stacks or guns: the building is shown at rest.",
    `Keep Image 1's rectangle: the same outline, the same centre, the same ${ratio} proportions. The game fits the result into ${Math.round(BUILDING_FILL * 100)}% of the ${tiles} footprint without stretching it, so a building with other proportions leaves gaps and is rejected.`,
  ]));

  const refs = section("REFERENCES", bullets(referenceLines(plan.list, a)));

  const doNot = section("DO NOT", bullets([
    ...DO_NOT_COMMON,
    "perspective, visible walls or facades, an isometric or three-quarter view, or a visible horizon",
    "ground, grass, soil, roads, paths, a yard, fences, a concrete apron or anything else outside the footprint (an open area that LAYOUT puts inside it is part of the building)",
    "cast shadows, drop shadows or contact shadows",
    "a player or team-colour border or trim around the footprint: the game draws the owner's trim itself, so paint only the faction palette",
    "units, vehicles, people or a second building",
    "a glow, halo, outline, stroke or pink/magenta fringe around the building",
    "smoke, steam, fire, sparks or particles",
    "a copy of another building type's signature, or a roof that is just Image 1 with more detail",
    ...look.avoid.map((x) => AVOID_EXCEPT[a.buildingType]?.[x] ?? x),
  ]));

  return assemble([task, keep, signature, layout, paint, style, light, rules, refs, doNot]);
}
