// Per-frame simulation step. Everything time-based uses dt (seconds) so the sim is
// frame-rate independent (08-combat-formulas.md). Order: production -> construction
// -> per-unit (combat/move/harvest) -> turrets -> projectiles -> reap dead -> separation
// -> effects -> citadel -> win check -> frenzy expire. Sound is emitted into state.soundEvents
// for the host to play; cleared each frame.
//
// NOTE (17-multiplayer M2): this is now the PURELY MECHANICAL sim step. All order-driven
// decisions (AI + human) enter through executeCommand (sim/commands.ts) BEFORE this runs each
// tick — the Session (net/session.ts) drains commands then calls updateGame. updateGame no longer
// runs the AI itself; the Session calls runAI (which emits commands) on the same cadence.

import type { GameState, Unit } from "../core/types";
import { updateCitadel } from "./citadel";
import { updateCombatUnit, updateDefense, updateGates, updateGuard, removeDead } from "./combat";
import { updateBuilder, updateConstruction, updateRepair, updateRepairer } from "./construction";
import { DEFENSE_STATS } from "../config/constants";
import { updateEffects } from "./effects";
import { updateHarvest } from "./harvest";
import { updateUnitMovement } from "./movement";
import { updateProduction } from "./production";
import { updateProjectiles } from "./projectiles";
import { updateSeparation } from "./separation";
import { updateWinConditions } from "./wincheck";
import { updateFog } from "./fog";
import { entityHash, unitHash } from "./spatial";
import { isLowPower } from "../state/gameState";
import { updateResearch } from "../state/upgrades";

export function updateGame(state: GameState, dt: number): void {
  state.soundEvents = []; // host drained last frame's; collect this frame's
  if (state.winner !== null) return; // match over — freeze the sim
  state.time += dt;
  state.tick++;

  // Snapshot positions for render interpolation (fixed-timestep loop lerps prev -> current).
  for (const e of state.entities) {
    if (e.kind === "unit") {
      e.prevX = e.x;
      e.prevY = e.y;
    }
  }
  for (const p of state.projectiles) {
    p.prevX = p.x;
    p.prevY = p.y;
  }

  // Age last frame's effects + tick feedback timers FIRST, so effects created this frame
  // (muzzle/tracer/hit/death) survive to the render that follows this update.
  updateEffects(state, dt);

  updateProduction(state, dt); // may spawn units
  updateConstruction(state, dt); // may complete buildings (+ refinery free worker)
  updateRepair(state, dt); // Workers repair damaged friendly buildings (spends gold)
  updateResearch(state, dt); // Lab research; applies per-player upgrades on completion

  // Broad-phase index for this step's targeting + Citadel capture (rebuilt once).
  entityHash.rebuild(state);
  updateGates(state, dt); // open/close gates by friendly proximity (uses the fresh hash)

  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0) continue;
    dispatchUnit(state, e, dt);
  }

  for (const e of state.entities) {
    if (e.kind === "building" && e.buildProgress >= 1 && e.owner !== "neutral" && DEFENSE_STATS[e.buildingType]) {
      updateDefense(state, e, dt);
    }
  }

  updateProjectiles(state, dt); // apply ranged damage on arrival
  removeDead(state); // spawn death explosions (rendered this frame, aged next)
  unitHash.rebuild(state, true); // units-only index for separation (post-movement)
  updateSeparation(state); // push overlapping units apart
  updateCitadel(state, dt);
  updateWinConditions(state);
  updateFog(state, dt); // human-only visibility (timed)

  // Expire Battle Frenzy buffs.
  for (const p of state.players) {
    if ((p.frenzyTimer ?? 0) > 0) p.frenzyTimer = Math.max(0, (p.frenzyTimer ?? 0) - dt);
  }

  // Power-low warning cue on the LOCAL player's transition into low power (§10). viewPlayer (not a
  // hardcoded 0) so a non-host client hears its OWN warning; sounds are cosmetic + unhashed.
  const lowNow = isLowPower(state, state.viewPlayer);
  if (lowNow && !state.humanLowPower) state.soundEvents.push("powerLow");
  state.humanLowPower = lowNow;
}

function dispatchUnit(state: GameState, u: Unit, dt: number): void {
  // Guard order holds a point and defends a radius around it (any unit type).
  if (u.guardPoint != null && u.forcedTargetId == null) {
    updateGuard(state, u, dt);
    return;
  }
  // Workers: build an assigned site, else harvest; either yields to an explicit attack order.
  if (u.unitType === "worker" && u.forcedTargetId == null) {
    if (u.buildTargetId != null) {
      updateBuilder(state, u, dt); // walk to the site and build it
    } else if (u.repairTarget != null) {
      updateRepairer(state, u, dt); // walk to a damaged building and repair it (16 §7)
    } else {
      updateUnitMovement(state, u, dt); // player-issued move (A*-routed)
      updateHarvest(state, u, dt); // harvest loop (skips while manually moving)
    }
  } else {
    updateCombatUnit(state, u, dt);
  }
}
