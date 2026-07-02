// Worker harvest loop (03-resources-economy.md, 08-combat-formulas.md):
//   seek nearest gold source -> mine 2s to fill 10 -> return to nearest drop-off ->
//   deposit (x1.25 at a Refinery) -> repeat. Depleted sources are removed.
// Workers drive their own movement here; the generic movement step only handles
// player-issued moves (a worker with moveTarget set is being manually relocated).

import { HARVEST, WORKER } from "../config/constants";
import type { Building, GameState, GoldSource, Unit } from "../core/types";
import { miningMult } from "../state/upgrades";
import { navigateTo } from "./navigation";

export function updateHarvest(state: GameState, w: Unit, dt: number): void {
  if (w.unitType !== "worker" || w.owner === "neutral") return;
  if (w.moveTarget) return; // a manual move is in progress
  if (!w.autoHarvest && w.state !== "gathering") return; // parked / idle

  if (w.state !== "gathering") {
    w.state = "gathering";
    w.harvestPhase = (w.carryingGold ?? 0) > 0 ? "returning" : "seeking";
  }

  switch (w.harvestPhase) {
    case "seeking": {
      let src = w.gatherSourceId != null ? sourceById(state, w.gatherSourceId) : undefined;
      if (!src) src = nearestSource(state, w);
      if (!src) {
        // Nothing left to mine anywhere.
        w.state = "idle";
        w.gatherSourceId = null;
        return;
      }
      w.gatherSourceId = src.id;
      if (navigateTo(state, w, src.x + 0.5, src.y + 0.5, dt, HARVEST.sourceContact)) {
        w.harvestPhase = "mining";
        w.mineTimer = WORKER.mineTime;
      }
      break;
    }
    case "mining": {
      const src = w.gatherSourceId != null ? sourceById(state, w.gatherSourceId) : undefined;
      if (!src) {
        w.harvestPhase = "seeking";
        w.gatherSourceId = null;
        return;
      }
      w.mineTimer = (w.mineTimer ?? 0) - dt;
      if ((w.mineTimer ?? 0) <= 0) {
        const amount = Math.min(WORKER.capacity, src.goldRemaining);
        w.carryingGold = amount;
        src.goldRemaining -= amount;
        if (src.goldRemaining <= 0) removeSource(state, src.id);
        w.harvestPhase = "returning";
      }
      break;
    }
    case "returning": {
      const drop = nearestDropoff(state, w);
      if (!drop) {
        w.state = "idle"; // owner has no drop-off (eliminated)
        return;
      }
      const cx = drop.x + drop.width / 2;
      const cy = drop.y + drop.height / 2;
      const contact = Math.max(drop.width, drop.height) / 2 + HARVEST.dropoffPadding;
      if (navigateTo(state, w, cx, cy, dt, contact)) {
        const bonus = drop.buildingType === "refinery" ? 1 + WORKER.refineryBonus : 1;
        // Improved Mining I/II scales gather income (global multiplier, 15-logic §2).
        const mined = (w.carryingGold ?? 0) * bonus * miningMult(state.players[w.owner]);
        state.players[w.owner].gold += mined;
        state.players[w.owner].stats.goldMined += mined; // 20 §J
        w.carryingGold = 0;
        w.harvestPhase = "seeking";
      }
      break;
    }
  }
}

function sourceById(state: GameState, id: number): GoldSource | undefined {
  return state.goldSources.find((s) => s.id === id);
}

function removeSource(state: GameState, id: number): void {
  const i = state.goldSources.findIndex((s) => s.id === id);
  if (i >= 0) state.goldSources.splice(i, 1);
}

function nearestSource(state: GameState, from: Unit): GoldSource | undefined {
  let best: GoldSource | undefined;
  let bestD = Infinity;
  for (const s of state.goldSources) {
    const d = Math.hypot(s.x + 0.5 - from.x, s.y + 0.5 - from.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function nearestDropoff(state: GameState, w: Unit): Building | undefined {
  let best: Building | undefined;
  let bestD = Infinity;
  for (const e of state.entities) {
    if (e.kind !== "building" || e.owner !== w.owner || e.buildProgress < 1) continue;
    if (e.buildingType !== "constructionYard" && e.buildingType !== "refinery") continue;
    const d = Math.hypot(e.x + e.width / 2 - w.x, e.y + e.height / 2 - w.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
