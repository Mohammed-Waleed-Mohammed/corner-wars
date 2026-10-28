// 29 §B step 7 — faction unit sprites: the generation order, titles and sizes. What each unit LOOKS
// like (footprint, in-game size, top-down description, faction palette) lives in
// content/factionArt.ts, the single source shared with the procedural art. DOM-free.

import { UNIT_LABEL } from "../../config/constants";
import { ART_UNIT_TYPES, UNIT_ART } from "../../content/factionArt";
import type { UnitArtSpec } from "../../content/factionArt";
import { FACTIONS, UNIT_NAMES } from "../../content/factions";
import type { FactionId, UnitType } from "../../core/types";

/**
 * Faction order for steps 6–7. The Concord comes first: its Construction Yard and Rifleman are the
 * style anchors for the other three factions.
 */
export const ART_FACTIONS: readonly FactionId[] = ["concord", "halcyon", "cantons", "choir"];

/** Units within a faction: the rifleman first (every other unit's family anchor), then ART_UNIT_TYPES order. */
export const UNIT_ORDER: readonly UnitType[] = ["rifleman", ...ART_UNIT_TYPES.filter((t) => t !== "rifleman")];

export function unitSpec(t: UnitType): UnitArtSpec { return UNIT_ART[t]; }

/** "Custodian (Rifleman)": the faction's own name for the unit, then the generic role. */
export function unitTitle(f: FactionId, t: UnitType): string {
  const own = UNIT_NAMES[f][t], role = UNIT_LABEL[t];
  return own === role ? own : `${own} (${role})`;
}

/** World px (zoom 1) the whole square sprite is drawn at, so its subject spans gamePx (render/draw/units.ts). */
export function unitDrawPx(t: UnitType): number {
  const s = UNIT_ART[t];
  return s.gamePx / s.footprint;
}

/** "The Concord Remnant" → used in prompts and catalog headings. */
export function factionName(f: FactionId): string { return FACTIONS[f].name; }
export function factionShort(f: FactionId): string { return FACTIONS[f].short; }
export function factionColour(f: FactionId): string { return FACTIONS[f].color; }
