// The command system (17-multiplayer §2). Every player/AI order becomes a Command, and
// executeCommand is the ONLY function that mutates sim state from orders — deterministic and
// ownership-validated so every peer makes the identical accept/reject decision. SP and MP both
// push commands through here (LocalSession / NetworkSession), so SP is a strict subset of MP.
//
// Selection, camera, hover, HUD, sound, and screen markers are LOCAL-only and never become
// commands — they don't affect the sim. Costs / tech gates / build-once limits / power-energy
// checks all live INSIDE executeCommand (or the engine helpers it calls), so a rejected order is a
// desync-safe no-op on every peer.
//
// Spec note: the §2.2 table omits a harvest order, but right-clicking a gold source with a Worker
// is a real networked player action, so we add HARVEST alongside the listed types.

import { BUILDING_STATS, CONSTRUCTION, FORMATION_SPACING, GRID } from "../config/constants";
import { clamp } from "../core/math";
import type { Building, GameState, PlayerId, Unit } from "../core/types";
import { assignBuilders } from "../engine/construction";
import { planWallLine, wallLineTiles, footprintClear, withinBuildRadius } from "../engine/placement";
import { firePower } from "../engine/powers";
import { cancelProduction, enqueueUnit } from "../engine/production";
import { buildAvailability } from "../state/buildRules";
import { createBuilding } from "../state/entities";
import { cancelResearch, enqueueResearch } from "../state/upgrades";
import type { BuildingType, ResearchKey, UnitType } from "../core/types";

export type CommandType =
  | "MOVE" | "ATTACK_MOVE" | "ATTACK_TARGET" | "GUARD" | "STOP" | "HOLD"
  | "PLACE_BUILDING" | "PLACE_WALL_LINE" | "ASSIGN_BUILD" | "SET_RALLY"
  | "QUEUE_UNIT" | "CANCEL_QUEUE" | "RESEARCH" | "REPAIR" | "HARVEST" | "USE_POWER";

export interface Command {
  type: CommandType;
  playerId: PlayerId; // whose command; the only entities it may affect
  seq: number;        // per-player monotonic sequence, for deterministic (playerId, seq) ordering
  payload: any;       // per-type, see the builders below
}

// ── entity lookup + ownership gates ─────────────────────────────────────────

function ownedUnits(state: GameState, pid: PlayerId, ids: number[]): Unit[] {
  const set = new Set(ids);
  const out: Unit[] = [];
  // Iterate state.entities (ascending id) rather than the id list so order is deterministic.
  for (const e of state.entities) {
    if (e.kind === "unit" && e.owner === pid && e.hp > 0 && set.has(e.id)) out.push(e);
  }
  return out;
}

function ownedBuilding(state: GameState, pid: PlayerId, id: number): Building | null {
  for (const e of state.entities) {
    if (e.kind === "building" && e.id === id && e.owner === pid && e.hp > 0) return e;
  }
  return null;
}

function wallCount(state: GameState, pid: PlayerId): number {
  let n = 0;
  for (const e of state.entities) {
    if (e.kind === "building" && e.owner === pid && (e.buildingType === "wall" || e.buildingType === "gate")) n++;
  }
  return n;
}

/** Clear the shared "new order" fields on a unit (drops stale path + auto-jobs). */
function clearOrder(u: Unit): void {
  u.guardPoint = null;
  u.repairTarget = null;
  u.path = [];
  u.pathGoal = null;
}

// ── the single order-driven mutation point ──────────────────────────────────

export function executeCommand(state: GameState, cmd: Command): void {
  const pid = cmd.playerId;
  const pl = cmd.payload;
  switch (cmd.type) {
    case "MOVE":
      applyMove(state, pid, pl.unitIds, pl.x, pl.y, false, pl.spread === true);
      break;
    case "ATTACK_MOVE":
      applyMove(state, pid, pl.unitIds, pl.x, pl.y, true, pl.spread === true);
      break;
    case "ATTACK_TARGET":
      applyAttackTarget(state, pid, pl.unitIds, pl.targetId, pl.keepHarvest === true);
      break;
    case "GUARD":
      for (const u of ownedUnits(state, pid, pl.unitIds)) {
        clearOrder(u);
        u.guardPoint = { x: pl.x, y: pl.y };
        u.state = "guarding";
        u.moveTarget = null;
        u.forcedTargetId = null;
        u.target = null;
        if (u.unitType === "worker") { u.autoHarvest = false; u.buildTargetId = null; }
      }
      break;
    case "STOP":
    case "HOLD": // no distinct hold-ground behavior in v1 — HOLD stops in place like STOP
      for (const u of ownedUnits(state, pid, pl.unitIds)) {
        clearOrder(u);
        u.moveTarget = null;
        u.forcedTargetId = null;
        u.target = null;
        u.attackMove = false;
        u.state = "idle";
        if (u.unitType === "worker") { u.autoHarvest = false; u.buildTargetId = null; }
      }
      break;
    case "PLACE_BUILDING":
      placeBuilding(state, pid, pl.buildingType, pl.x, pl.y);
      break;
    case "PLACE_WALL_LINE":
      placeWallLine(state, pid, pl.fromX, pl.fromY, pl.toX, pl.toY);
      break;
    case "ASSIGN_BUILD": {
      const site = ownedBuilding(state, pid, pl.buildingId);
      if (!site || site.buildProgress >= 1) break;
      for (const u of ownedUnits(state, pid, pl.workerIds)) {
        if (u.unitType !== "worker") continue;
        clearOrder(u);
        u.buildTargetId = site.id;
        u.forcedTargetId = null;
        u.target = null;
        u.moveTarget = null;
      }
      break;
    }
    case "REPAIR": {
      const b = ownedBuilding(state, pid, pl.buildingId);
      if (!b || b.buildProgress < 1 || b.hp >= b.maxHp) break;
      for (const u of ownedUnits(state, pid, pl.workerIds)) {
        if (u.unitType !== "worker") continue;
        clearOrder(u);
        u.repairTarget = b.id;
        u.buildTargetId = null;
        u.autoHarvest = false;
        u.forcedTargetId = null;
        u.target = null;
        u.moveTarget = null;
      }
      break;
    }
    case "HARVEST": {
      const src = state.goldSources.find((g) => g.id === pl.sourceId);
      if (!src) break;
      for (const u of ownedUnits(state, pid, pl.workerIds)) {
        if (u.unitType !== "worker") continue;
        clearOrder(u);
        u.autoHarvest = true;
        u.forcedTargetId = null;
        u.buildTargetId = null;
        u.gatherSourceId = src.id;
        u.harvestPhase = (u.carryingGold ?? 0) > 0 ? "returning" : "seeking";
        u.state = "gathering";
        u.moveTarget = null;
      }
      break;
    }
    case "SET_RALLY": {
      const b = ownedBuilding(state, pid, pl.buildingId);
      if (b) b.rallyPoint = { x: pl.x, y: pl.y };
      break;
    }
    case "QUEUE_UNIT": {
      const b = ownedBuilding(state, pid, pl.buildingId);
      if (b) enqueueUnit(state, b, pl.unitType as UnitType); // validates gold/tech/queue/producible
      break;
    }
    case "CANCEL_QUEUE": {
      const b = ownedBuilding(state, pid, pl.buildingId);
      if (!b) break;
      if (b.buildingType === "lab") cancelResearch(state, b, pl.slotIndex);
      else cancelProduction(state, b, pl.slotIndex);
      break;
    }
    case "RESEARCH": {
      const lab = ownedBuilding(state, pid, pl.labId);
      if (lab) enqueueResearch(state, lab, pl.upgradeId as ResearchKey); // validates gold/tech/dupes
      break;
    }
    case "USE_POWER":
      // firePower re-checks Command Energy + target requirement internally (desync-safe).
      firePower(state, pid, pl.powerId, pl.x != null && pl.y != null ? { x: pl.x, y: pl.y } : null);
      break;
  }
}

function applyMove(state: GameState, pid: PlayerId, ids: number[], x: number, y: number, attackMove: boolean, spread: boolean): void {
  const units = ownedUnits(state, pid, ids);
  if (units.length === 0) return;
  const cols = Math.max(1, Math.ceil(Math.sqrt(units.length)));
  const rows = Math.ceil(units.length / cols);
  units.forEach((u, i) => {
    let tx = x, ty = y;
    if (spread) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      tx = clamp(x + (col - (cols - 1) / 2) * FORMATION_SPACING, 0, GRID.width);
      ty = clamp(y + (row - (rows - 1) / 2) * FORMATION_SPACING, 0, GRID.height);
    }
    clearOrder(u);
    u.moveTarget = { x: tx, y: ty };
    u.state = "moving";
    u.attackMove = attackMove;
    u.forcedTargetId = null;
    if (u.unitType === "worker") { u.autoHarvest = false; u.buildTargetId = null; }
  });
}

function applyAttackTarget(state: GameState, pid: PlayerId, ids: number[], targetId: number, keepHarvest: boolean): void {
  for (const u of ownedUnits(state, pid, ids)) {
    clearOrder(u);
    u.forcedTargetId = targetId;
    u.target = targetId;
    u.attackMove = false;
    u.moveTarget = null;
    if (u.unitType === "worker" && !keepHarvest) { u.autoHarvest = false; u.buildTargetId = null; }
  }
}

function placeBuilding(state: GameState, pid: PlayerId, type: BuildingType, x: number, y: number): void {
  if (!buildAvailability(state, pid, type).ok) return; // tech / gold / power / build-once limit
  const s = BUILDING_STATS[type];
  if (!footprintClear(state, x, y, s.width, s.height)) return;
  if (!withinBuildRadius(state, pid, x, y, s.width, s.height)) return;
  state.players[pid].gold -= s.gold;
  const site = createBuilding(state, pid, type, x, y, false);
  state.entities.push(site); // createBuilding takes the next id, so append keeps ascending order
  assignBuilders(state, site, pid, CONSTRUCTION.autoAssignWorkers);
}

function placeWallLine(state: GameState, pid: PlayerId, fromX: number, fromY: number, toX: number, toY: number): void {
  const tiles = wallLineTiles(fromX, fromY, toX, toY);
  const segs = planWallLine(state, pid, tiles, state.players[pid].gold, wallCount(state, pid));
  const cost = BUILDING_STATS.wall.gold;
  let first: Building | null = null;
  for (const seg of segs) {
    if (!seg.valid) continue;
    state.players[pid].gold -= cost;
    const site = createBuilding(state, pid, "wall", seg.x, seg.y, false);
    state.entities.push(site);
    if (!first) first = site;
  }
  if (first) assignBuilders(state, first, pid, CONSTRUCTION.autoAssignWorkers);
}
