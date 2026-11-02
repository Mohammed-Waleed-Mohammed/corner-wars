// 32 §A the Resonance Tap: late-game gold that needs no mine and no workers. Every finished Tap adds
// RESONANCE_TAP.goldPerSec (×1.5 with Deep Resonance) to its owner each second; under low power it
// runs at half rate. Credited to the match's gold-mined stat like any income.

import { RESONANCE_TAP } from "../config/constants";
import type { GameState } from "../core/types";
import { isLowPower } from "../state/gameState";
import { tapGoldPerSec } from "../state/upgrades";

export function updateResonanceTaps(state: GameState, dt: number): void {
  for (const e of state.entities) {
    if (e.kind !== "building" || e.buildingType !== "resonanceTap" || e.owner === "neutral" || e.buildProgress < 1 || e.hp <= 0) continue;
    const p = state.players[e.owner];
    if (p.eliminated) continue;
    const gold = tapGoldPerSec(p) * (isLowPower(state, e.owner) ? RESONANCE_TAP.lowPowerMult : 1) * dt;
    p.gold += gold;
    p.stats.goldMined += gold;
  }
}
