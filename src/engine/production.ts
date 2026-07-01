// Building production (06-buildings.md): one unit at a time, queue up to 5. Gold is paid
// up front on enqueue. The build timer advances at a speed multiplier that already folds
// in the low-power penalty (04-power.md) and the Citadel holder bonus (07-citadel.md), so
// later milestones get those effects for free.

import {
  CITADEL,
  GRID,
  LOW_POWER_PRODUCTION_MULT,
  PRODUCES,
  PRODUCTION_QUEUE_MAX,
  REFUND,
  UNIT_STATS,
} from "../config/constants";
import { clamp } from "../core/math";
import type { Building, GameState, PlayerId, UnitType } from "../core/types";
import { createUnit } from "../state/entities";
import { isLowPower } from "../state/gameState";
import { isResearched, productionUpgradeMult, unitCap } from "../state/upgrades";
import { nearestPassableTile } from "./pathfinding";

/** Combined production-speed multiplier for a player's buildings. */
export function productionSpeedMult(state: GameState, owner: PlayerId): number {
  let m = 1;
  if (isLowPower(state, owner)) m *= LOW_POWER_PRODUCTION_MULT;
  if (state.citadel.controllingPlayer === owner) m *= 1 + CITADEL.productionSpeedBonus;
  m *= productionUpgradeMult(state.players[owner]); // Streamlined Production (15-logic §2)
  return m;
}

/** Try to queue a unit at a building. Returns false if blocked (cost / queue / tech / unlock). */
export function enqueueUnit(state: GameState, building: Building, unitType: UnitType): boolean {
  if (building.owner === "neutral" || building.buildProgress < 1) return false;
  const producible = PRODUCES[building.buildingType];
  if (!producible || !producible.includes(unitType)) return false;
  if (building.productionQueue.length >= PRODUCTION_QUEUE_MAX) return false;

  const player = state.players[building.owner];
  const stat = UNIT_STATS[unitType];
  if (stat.unlock && !isResearched(player, stat.unlock)) return false; // research-locked (Heavy Tank/Artillery)
  if (player.gold < stat.gold) return false;

  player.gold -= stat.gold;
  building.productionQueue.push(unitType);
  return true;
}

/** Cancel a queued unit, refunding gold (full if not started, 50% if in progress; 15-logic §7). */
export function cancelProduction(state: GameState, building: Building, index: number): boolean {
  const q = building.productionQueue;
  if (index < 0 || index >= q.length) return false;
  const inProgress = index === 0 && building.productionTimer > 0;
  const refund = UNIT_STATS[q[index]].gold * (inProgress ? REFUND.inProgress : REFUND.queued);
  if (building.owner !== "neutral") state.players[building.owner].gold += refund;
  q.splice(index, 1);
  if (inProgress) building.productionTimer = 0; // the next item starts fresh
  return true;
}

export function updateProduction(state: GameState, dt: number): void {
  for (const e of state.entities) {
    if (e.kind !== "building" || e.owner === "neutral" || e.buildProgress < 1) continue;
    if (e.productionQueue.length === 0) {
      e.productionTimer = 0;
      continue;
    }

    const unitType = e.productionQueue[0];
    const buildTime = UNIT_STATS[unitType].buildTime;
    e.productionTimer += dt * productionSpeedMult(state, e.owner);

    if (e.productionTimer >= buildTime) {
      if (countUnits(state, e.owner) >= unitCap(state.players[e.owner])) {
        e.productionTimer = buildTime; // finished but capped — hold until room (Supply Lines raises cap)
        continue;
      }
      e.productionTimer = 0;
      e.productionQueue.shift();
      spawnUnit(state, e, unitType);
    }
  }
}

function spawnUnit(state: GameState, building: Building, unitType: UnitType): void {
  if (building.owner === "neutral") return;
  const sx = clamp(building.x + building.width / 2, 0, GRID.width);
  const sy = clamp(building.y + building.height + 0.5, 0, GRID.height);
  const sp = nearestPassableTile(state, sx, sy); // never spawn inside terrain (§3)
  const u = createUnit(state, building.owner, unitType, sp.x, sp.y);
  if (building.rallyPoint) {
    u.moveTarget = { x: building.rallyPoint.x, y: building.rallyPoint.y };
    u.state = "moving";
    if (u.unitType === "worker") u.autoHarvest = false;
  }
  state.entities.push(u);
  if (building.owner === state.viewPlayer) state.soundEvents.push("unitReady"); // local player only — avoid AI beeps
}

function countUnits(state: GameState, owner: PlayerId): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === "unit" && e.owner === owner) n++;
  return n;
}
