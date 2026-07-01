// AI opponents (09-ai.md). Each AI player runs the same brain on a slow cadence (not every
// frame). A small state machine — EXPAND / BUILD_ARMY / ATTACK / DEFEND — drives an economy
// build order, a counter-aware army, and target selection that favours the *weakest* rival so
// the AIs fight each other, not just the human. They use the same rules/economy as the player.
//
// 17-multiplayer M2: the AI no longer mutates sim state directly — it EMITS commands (the same
// Command pipeline the human uses) via a `submit` callback. In MP only the host runs this; in SP
// the Session runs it locally. Either way its output is commands into executeCommand. Decision
// heuristics still read live state (gold, army makeup, build spots); the resulting orders are
// applied — and their costs/limits enforced — inside executeCommand, so every peer agrees.

import { AI, BUILDING_STATS, CITADEL_POS, CITADEL_POWERS } from "../config/constants";
import type { AnyEntity, Building, GameState, Player, PlayerId, Unit } from "../core/types";
import type { Command } from "../sim/commands";
import { footprintClear, withinBuildRadius } from "./placement";
import { isLowPower } from "../state/gameState";

export type Submit = (cmd: Command) => void;

// ── command builders (seq is stamped by the Session on submit) ───────────────
const atkMove = (pid: PlayerId, unitIds: number[], x: number, y: number): Command =>
  ({ type: "ATTACK_MOVE", playerId: pid, seq: 0, payload: { unitIds, x, y, spread: false } });
const atkTarget = (pid: PlayerId, unitIds: number[], targetId: number, keepHarvest: boolean): Command =>
  ({ type: "ATTACK_TARGET", playerId: pid, seq: 0, payload: { unitIds, targetId, keepHarvest } });
const queueUnit = (pid: PlayerId, buildingId: number, unitType: Unit["unitType"]): Command =>
  ({ type: "QUEUE_UNIT", playerId: pid, seq: 0, payload: { buildingId, unitType } });
const placeBuilding = (pid: PlayerId, buildingType: Building["buildingType"], x: number, y: number): Command =>
  ({ type: "PLACE_BUILDING", playerId: pid, seq: 0, payload: { buildingType, x, y } });
const usePower = (pid: PlayerId, powerId: string, pos: { x: number; y: number } | null): Command =>
  ({ type: "USE_POWER", playerId: pid, seq: 0, payload: { powerId, x: pos?.x ?? null, y: pos?.y ?? null } });

export function runAI(state: GameState, dt: number, submit: Submit): void {
  for (const p of state.players) {
    if (p.isHuman || p.eliminated || !p.ai) continue;
    p.ai.decisionTimer += dt;
    p.ai.attackClock += dt;
    if (p.ai.decisionTimer >= AI.decisionInterval) {
      p.ai.decisionTimer = 0;
      decide(state, p, submit);
    }
  }
}

function decide(state: GameState, p: Player, submit: Submit): void {
  const id = p.id;
  const cy = findBuilding(state, id, "constructionYard", false);
  if (!cy) return; // about to be eliminated
  const base = { x: cy.x + cy.width / 2, y: cy.y + cy.height / 2 };

  const workers = unitsOf(state, id).filter((u) => u.unitType === "worker");
  const army = combatUnitsOf(state, id);

  maintainEconomy(state, p, cy, workers.length, submit);

  const threatened = enemyCombatWithin(state, id, base, AI.threatRadius);
  if (threatened) {
    p.ai!.mode = "defend";
    if (army.length) submit(atkMove(id, army.map((u) => u.id), base.x, base.y));
    // Pull a few Workers to help repel the attack (09-ai.md). keepHarvest leaves autoHarvest on,
    // so they return to mining once their forced target dies.
    const threat = nearestEnemyUnit(state, id, base);
    if (threat) {
      const helpers = workers.slice(0, 3).map((w) => w.id);
      if (helpers.length) submit(atkTarget(id, helpers, threat.id, true));
    }
  } else if (army.length >= AI.armyAttackThreshold) {
    p.ai!.mode = "attack";
    if (p.ai!.attackClock >= AI.reattackInterval) {
      p.ai!.attackClock = 0;
      doAttack(state, id, army, submit);
    }
  } else {
    p.ai!.mode = workers.length < AI.workerTarget ? "expand" : "buildArmy";
    // While building up, contest the Citadel rather than idling at base (09-ai.md).
    if (army.length >= 3) submit(atkMove(id, army.map((u) => u.id), CITADEL_POS.x, CITADEL_POS.y));
  }

  // Spend Command Energy — banked energy is usable even after losing the Citadel.
  useCitadelPowers(state, p, army, submit);
}

function maintainEconomy(state: GameState, p: Player, cy: Building, workerCount: number, submit: Submit): void {
  const id = p.id;

  // Ramp workers toward the target, counting those already queued so we don't overshoot.
  const queuedWorkers = cy.productionQueue.filter((t) => t === "worker").length;
  if (workerCount + queuedWorkers < AI.workerTarget) submit(queueUnit(id, cy.id, "worker"));

  // Reactive power safety net (one plant at a time).
  if (isLowPower(state, id) && countInProgress(state, id, "powerPlant") === 0) {
    aiBuild(state, p, "powerPlant", submit);
  }

  // Build order (09-ai.md): a Refinery for economy, a Barracks, then a Power Plant
  // *before* the War Factory so the player never falls into a low-power window.
  if (
    workerCount >= 5 &&
    !anyBuilding(state, id, "refinery") &&
    p.gold > BUILDING_STATS.refinery.gold + AI.goldBuffer
  ) {
    aiBuild(state, p, "refinery", submit);
  }
  if (workerCount >= 4 && !anyBuilding(state, id, "barracks")) aiBuild(state, p, "barracks", submit);

  const barracks = findBuilding(state, id, "barracks", true);
  if (barracks) submit(queueUnit(id, barracks.id, chooseInfantry(state, id)));

  // War Factory, gated behind a Power Plant (build the plant first if it's missing).
  if (
    workerCount >= AI.workerTarget &&
    findBuilding(state, id, "barracks", true) &&
    !anyBuilding(state, id, "warFactory")
  ) {
    if (!anyBuilding(state, id, "powerPlant")) {
      aiBuild(state, p, "powerPlant", submit);
    } else if (p.gold > BUILDING_STATS.warFactory.gold + AI.goldBuffer) {
      aiBuild(state, p, "warFactory", submit);
    }
  }

  const wf = findBuilding(state, id, "warFactory", true);
  if (wf) submit(queueUnit(id, wf.id, "tank"));
}

/** Counter-awareness: rockets if the enemy leans heavy, else riflemen (05-units.md). */
function chooseInfantry(state: GameState, id: PlayerId): "rifleman" | "rocket" {
  let heavy = 0;
  let ranged = 0;
  for (const e of state.entities) {
    if (e.kind !== "unit" || !isEnemyOf(id, e) || e.hp <= 0) continue;
    if (e.combatType === "heavy") heavy++;
    else if (e.combatType === "ranged") ranged++;
  }
  return heavy > ranged ? "rocket" : "rifleman";
}

function doAttack(state: GameState, id: PlayerId, army: Unit[], submit: Submit): void {
  const target = pickAttackTarget(state, id);
  const contest = army.slice(0, AI.citadelContestCount).map((u) => u.id);
  const strike = army.slice(AI.citadelContestCount).map((u) => u.id);
  if (contest.length) submit(atkMove(id, contest, CITADEL_POS.x, CITADEL_POS.y));
  if (strike.length) submit(atkMove(id, strike, target.x, target.y));
}

function pickAttackTarget(state: GameState, id: PlayerId): { x: number; y: number } {
  const weakest = weakestEnemy(state, id);
  if (weakest !== null) {
    const cy = findBuilding(state, weakest, "constructionYard", false);
    if (cy) return { x: cy.x + cy.width / 2, y: cy.y + cy.height / 2 };
  }
  return CITADEL_POS;
}

function useCitadelPowers(state: GameState, p: Player, army: Unit[], submit: Submit): void {
  const id = p.id;
  const energy = p.commandEnergy;

  if (energy >= CITADEL_POWERS.ion.energy) {
    const pos = weakestEnemyBase(state, id);
    if (pos) {
      submit(usePower(id, "ion", pos));
      return;
    }
  }
  if (energy >= CITADEL_POWERS.frenzy.energy && p.ai!.mode === "attack" && army.length >= 5 && (p.frenzyTimer ?? 0) <= 0) {
    submit(usePower(id, "frenzy", null));
    return;
  }
  if (energy >= CITADEL_POWERS.artillery.energy) {
    const cluster = nearestEnemyUnit(state, id, CITADEL_POS);
    if (cluster) submit(usePower(id, "artillery", { x: cluster.x, y: cluster.y }));
  }
}

// ── building helpers ─────────────────────────────────────────────────────────

/** Decide to build `type`: affordability + tech + a valid spot, then EMIT a PLACE_BUILDING command
 *  (executeCommand pays, creates the site, and pulls Workers). Heuristics read live gold; the real
 *  gold/limit check happens inside executeCommand, so an over-optimistic order is a safe no-op. */
function aiBuild(state: GameState, p: Player, type: Building["buildingType"], submit: Submit): void {
  const stat = BUILDING_STATS[type];
  if (p.gold < stat.gold) return;
  if (stat.requires && !findBuilding(state, p.id, stat.requires, true)) return;
  const spot = findBuildSpot(state, p.id, stat.width, stat.height);
  if (!spot) return;
  submit(placeBuilding(p.id, type, spot.x, spot.y));
}

function findBuildSpot(state: GameState, id: PlayerId, w: number, h: number): { x: number; y: number } | null {
  const cy = findBuilding(state, id, "constructionYard", false);
  if (!cy) return null;
  const ox = Math.round(cy.x + cy.width / 2 - w / 2);
  const oy = Math.round(cy.y + cy.height / 2 - h / 2);
  for (let r = 2; r <= 12; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring perimeter only
        if (
          footprintClear(state, ox + dx, oy + dy, w, h) &&
          withinBuildRadius(state, id, ox + dx, oy + dy, w, h)
        ) {
          return { x: ox + dx, y: oy + dy };
        }
      }
    }
  }
  return null;
}

// ── queries ──────────────────────────────────────────────────────────────────

function isEnemyOf(id: PlayerId, e: AnyEntity): boolean {
  return e.owner !== "neutral" && e.owner !== id;
}

function unitsOf(state: GameState, owner: PlayerId): Unit[] {
  return state.entities.filter((e) => e.kind === "unit" && e.owner === owner && e.hp > 0) as Unit[];
}

function combatUnitsOf(state: GameState, owner: PlayerId): Unit[] {
  return unitsOf(state, owner).filter((u) => u.combatType !== undefined);
}

function findBuilding(
  state: GameState,
  owner: PlayerId,
  type: Building["buildingType"],
  finishedOnly: boolean,
): Building | undefined {
  for (const e of state.entities) {
    if (e.kind !== "building" || e.owner !== owner || e.buildingType !== type || e.hp <= 0) continue;
    if (finishedOnly && e.buildProgress < 1) continue;
    return e;
  }
  return undefined;
}

function anyBuilding(state: GameState, owner: PlayerId, type: Building["buildingType"]): boolean {
  return findBuilding(state, owner, type, false) !== undefined;
}

function countInProgress(state: GameState, owner: PlayerId, type: Building["buildingType"]): number {
  let n = 0;
  for (const e of state.entities) {
    if (e.kind === "building" && e.owner === owner && e.buildingType === type && e.buildProgress < 1 && e.hp > 0) n++;
  }
  return n;
}

function enemyCombatWithin(state: GameState, id: PlayerId, c: { x: number; y: number }, radius: number): boolean {
  for (const e of state.entities) {
    if (e.kind !== "unit" || !isEnemyOf(id, e) || e.hp <= 0 || e.combatType === undefined) continue;
    if (Math.hypot(e.x - c.x, e.y - c.y) <= radius) return true;
  }
  return false;
}

function nearestEnemyUnit(state: GameState, id: PlayerId, from: { x: number; y: number }): Unit | undefined {
  let best: Unit | undefined;
  let bestD = Infinity;
  for (const e of state.entities) {
    if (e.kind !== "unit" || !isEnemyOf(id, e) || e.hp <= 0) continue;
    const d = Math.hypot(e.x - from.x, e.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function weakestEnemy(state: GameState, id: PlayerId): PlayerId | null {
  const ownCy = findBuilding(state, id, "constructionYard", false);
  const ownBase = ownCy
    ? { x: ownCy.x + ownCy.width / 2, y: ownCy.y + ownCy.height / 2 }
    : CITADEL_POS;

  let best: PlayerId | null = null;
  let bestScore = Infinity;
  for (const other of state.players) {
    if (other.id === id || other.eliminated) continue;
    const cy = findBuilding(state, other.id, "constructionYard", false);
    if (!cy) continue;
    const army = combatUnitsOf(state, other.id).length;
    const dist = Math.hypot(cy.x + cy.width / 2 - ownBase.x, cy.y + cy.height / 2 - ownBase.y);
    // Weakest first (fewest units, then lowest base HP), but prefer *reachable* (nearer)
    // rivals and add a small per-AI bias so the three brains don't dog-pile one victim.
    const score = army * 1000 + cy.hp + dist * 8 + ((other.id + id) % 3) * 40;
    if (score < bestScore) {
      bestScore = score;
      best = other.id;
    }
  }
  return best;
}

function weakestEnemyBase(state: GameState, id: PlayerId): { x: number; y: number } | null {
  const w = weakestEnemy(state, id);
  if (w === null) return null;
  const cy = findBuilding(state, w, "constructionYard", false);
  return cy ? { x: cy.x + cy.width / 2, y: cy.y + cy.height / 2 } : null;
}
