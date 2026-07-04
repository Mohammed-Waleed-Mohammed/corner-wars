// Win / lose (22 §W1 — the EXACT rule):
//   - A player is ELIMINATED when their count of Construction Yards reaches 0.
//   - The match ends IF AND ONLY IF exactly one non-eliminated player remains — that player wins.
//   - No other event may end the match (no Citadel win, no timer, no kill count). Concede works by
//     destroying the conceder's entities, which flows through this same rule.
//
// §W2 elimination procedure (deterministic, same on every peer):
//   1. eliminated = true immediately (their commands become no-ops the same tick — 22 §W3).
//   2. Units are removed at once (hp = 0 → death effects via removeDead next pass).
//   3. Buildings are DESTROYED STAGGERED: 3 per tick in ascending entity id (~2 s of rolling
//      explosions for a real base). Stateless: each tick kills the 3 lowest-id survivors, so every
//      peer computes the identical sequence with no extra sim state.
//   4. Citadel hold/capture progress is freed.
//   5. The HUD toasts the elimination (it watches the eliminated flags — display side).

import type { GameState } from "../core/types";
import { recomputePower } from "../state/gameState";

const DEMOLITION_PER_TICK = 3; // §W2: staggered building destruction, ordered by entity id

export function updateWinConditions(state: GameState): void {
  if (state.winner !== null) return;

  const aliveBefore = state.players.filter((p) => !p.eliminated).map((p) => p.id);

  // ── eliminate players whose last Construction Yard fell (§W1) ──
  let changed = false;
  for (const p of state.players) {
    if (p.eliminated) continue;
    const hasCY = state.entities.some(
      (e) => e.kind === "building" && e.owner === p.id && e.buildingType === "constructionYard" && e.hp > 0,
    );
    if (!hasCY) {
      p.eliminated = true;
      changed = true;
      // §W2.3: units die immediately (death effects); buildings enter the staggered demolition below.
      for (const e of state.entities) {
        if (e.owner === p.id && e.kind === "unit") e.hp = 0;
      }
      // §W2.4: free the Citadel.
      if (state.citadel.controllingPlayer === p.id) state.citadel.controllingPlayer = "neutral";
      if (state.citadel.capturingPlayer === p.id) {
        state.citadel.capturingPlayer = null;
        state.citadel.captureTimer = 0;
      }
      p.citadelHoldTime = 0;
    }
  }

  // ── §W2.2 staggered demolition: 3 lowest-id surviving buildings per eliminated player per tick ──
  for (const p of state.players) {
    if (!p.eliminated) continue;
    let killed = 0;
    for (const e of state.entities) { // state.entities is ascending-id — deterministic order
      if (killed >= DEMOLITION_PER_TICK) break;
      if (e.kind === "building" && e.owner === p.id && e.hp > 0) {
        e.hp = 0;
        killed++;
        changed = true;
      }
    }
  }
  if (changed) recomputePower(state);

  // ── §W1: end if and only if one player remains ──
  const alive = state.players.filter((p) => !p.eliminated);
  if (alive.length === 1) {
    state.winner = alive[0].id;
    return;
  }
  if (alive.length === 0) {
    // Simultaneous wipe (two last CYs fall the same tick): award deterministically to a player who
    // was alive at the start of the tick so the match still ends.
    state.winner = aliveBefore.length > 0 ? aliveBefore[0] : 0;
  }
}
