// Ages short-lived visual effects out, and ticks the per-entity feedback timers
// (white hit-flash, melee lunge) — all purely cosmetic, no game logic (§10).

import type { GameState } from "../core/types";
import { releaseEffect } from "../state/entities";

export function updateEffects(state: GameState, dt: number): void {
  // Age + compact in place (no new array each frame), releasing expired effects to the pool.
  const arr = state.effects;
  let w = 0;
  for (let r = 0; r < arr.length; r++) {
    const e = arr[r];
    e.age += dt;
    if (e.age < e.lifetime) arr[w++] = e;
    else releaseEffect(e);
  }
  arr.length = w;

  for (const e of state.entities) {
    if (e.hitFlashTimer && e.hitFlashTimer > 0) e.hitFlashTimer = Math.max(0, e.hitFlashTimer - dt);
    if (e.kind === "unit" && e.attackLungeTimer && e.attackLungeTimer > 0) {
      e.attackLungeTimer = Math.max(0, e.attackLungeTimer - dt);
    }
  }
}
