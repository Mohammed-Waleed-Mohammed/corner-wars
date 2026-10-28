// Selling a structure (06 §Selling). Any of your buildings except a Construction Yard (losing your
// yards eliminates you) can be sold — or, while still under construction, cancelled. Queued units and
// research are refunded first, exactly as if each were cancelled. The building then disappears at
// once: no wreck, no explosion, and it never counts as razed or lost. Deterministic (runs from the
// SELL_BUILDING command on every peer); gold refunds are whole numbers.

import { BUILDING_STATS, EFFECTS, SELL } from "../config/constants";
import type { Building, GameState } from "../core/types";
import { spawnEffect } from "../state/entities";
import { recomputePower } from "../state/gameState";
import { cancelResearch } from "../state/upgrades";
import { cancelProduction } from "./production";

export function canSell(b: Building): boolean {
  return b.owner !== "neutral" && b.hp > 0 && b.buildingType !== "constructionYard";
}

/** Gold back for the structure itself: a finished building returns SELL.refund of its price, scaled
 *  by its health; an unfinished site returns everything not yet built plus SELL.refund of what was. */
export function sellRefund(b: Building): number {
  const price = BUILDING_STATS[b.buildingType].gold;
  if (b.buildProgress < 1) return Math.floor(price * (1 - b.buildProgress * (1 - SELL.refund)));
  return Math.floor(price * SELL.refund * Math.max(0, Math.min(1, b.hp / b.maxHp)));
}

export function sellBuilding(state: GameState, b: Building): void {
  if (!canSell(b) || b.owner === "neutral") return;
  const p = state.players[b.owner];
  while (b.productionQueue.length > 0) cancelProduction(state, b, b.productionQueue.length - 1);
  while ((b.researchQueue?.length ?? 0) > 0) cancelResearch(state, b, b.researchQueue!.length - 1);
  const refund = sellRefund(b);
  p.gold += refund;
  const i = state.entities.indexOf(b);
  if (i >= 0) state.entities.splice(i, 1);
  recomputePower(state);
  spawnEffect(state, "number", b.x + b.width / 2, b.y + b.height / 2, EFFECTS.sellLife, { owner: b.owner, value: refund });
}
