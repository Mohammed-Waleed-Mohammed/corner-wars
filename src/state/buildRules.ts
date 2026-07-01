// Build/production availability + tooltip reasons (16 §5/§6). Pure state-layer helpers shared by
// the input controller (gating tryPlace / hotkeys) and the HUD (grey-out + tooltips), so the
// priority order — tech → can't afford → no power → at limit → available — lives in ONE place.

import {
  BUILD_MAX_COUNT,
  BUILDING_DESC,
  BUILDING_LABEL,
  BUILDING_STATS,
  PRODUCTION_QUEUE_MAX,
  STRUCTURE_CAP,
  UNIT_DESC,
  UNIT_STATS,
  UNLOCK_LABEL,
} from "../config/constants";
import type { Building, BuildingType, GameState, PlayerId, UnitType } from "../core/types";
import { isLowPower } from "./gameState";

export interface Availability {
  ok: boolean;
  reason: string; // tooltip text: the unmet requirement, or "cost — description" when available
}

function hasFinished(state: GameState, owner: PlayerId, type: BuildingType): boolean {
  return state.entities.some(
    (e) => e.kind === "building" && e.owner === owner && e.buildingType === type && e.buildProgress >= 1 && e.hp > 0,
  );
}
function countOwned(state: GameState, owner: PlayerId, type: BuildingType): number {
  let n = 0;
  for (const e of state.entities) {
    if (e.kind === "building" && e.owner === owner && e.buildingType === type && e.hp > 0) n++;
  }
  return n;
}
export function wallGateCount(state: GameState, owner: PlayerId): number {
  let n = 0;
  for (const e of state.entities) {
    if (e.kind === "building" && e.owner === owner && (e.buildingType === "wall" || e.buildingType === "gate")) n++;
  }
  return n;
}

/** Can `owner` place `type` right now? Reason follows §6 priority (tech > afford > power > limit). */
export function buildAvailability(state: GameState, owner: PlayerId, type: BuildingType): Availability {
  const stat = BUILDING_STATS[type];
  const p = state.players[owner];
  if (stat.requires && !hasFinished(state, owner, stat.requires)) {
    return { ok: false, reason: `Requires ${BUILDING_LABEL[stat.requires]}` };
  }
  if (stat.unlock && !p.unlocks[stat.unlock]) {
    return { ok: false, reason: `Requires Lab: ${UNLOCK_LABEL[stat.unlock]}` };
  }
  if (p.gold < stat.gold) return { ok: false, reason: `Need ${stat.gold} gold (${Math.ceil(stat.gold - p.gold)} more)` };
  if (stat.power < 0 && isLowPower(state, owner)) return { ok: false, reason: "Insufficient power" };
  const max = BUILD_MAX_COUNT[type];
  if (max !== undefined && countOwned(state, owner, type) >= max) return { ok: false, reason: "Maximum built" };
  if ((type === "wall" || type === "gate") && wallGateCount(state, owner) >= STRUCTURE_CAP.wallsPerPlayer) {
    return { ok: false, reason: `Wall/gate limit (${STRUCTURE_CAP.wallsPerPlayer})` };
  }
  return { ok: true, reason: `${stat.gold}g — ${BUILDING_DESC[type]}` };
}

/** Can `building` queue `type` right now? Same priority order (§6) applied to unit production. */
export function unitAvailability(state: GameState, owner: PlayerId, building: Building, type: UnitType): Availability {
  const stat = UNIT_STATS[type];
  const p = state.players[owner];
  if (stat.unlock && !p.unlocks[stat.unlock]) {
    return { ok: false, reason: `Requires Lab: ${UNLOCK_LABEL[stat.unlock]}` };
  }
  if (p.gold < stat.gold) return { ok: false, reason: `Need ${stat.gold} gold (${Math.ceil(stat.gold - p.gold)} more)` };
  if (building.buildProgress < 1) return { ok: false, reason: "Building still under construction" };
  if (building.productionQueue.length >= PRODUCTION_QUEUE_MAX) return { ok: false, reason: `Queue full (${PRODUCTION_QUEUE_MAX})` };
  return { ok: true, reason: `${stat.gold}g — ${UNIT_DESC[type]}` };
}
