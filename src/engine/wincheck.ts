// Win / lose (16-build-ux-and-fixes.md §2b — LAST PLAYER STANDING is the ONLY win condition):
//   - A player is eliminated when they hold ZERO Construction Yards; their remaining entities
//     are cleared. The match ends only when exactly one player remains, who wins.
//   - The Citadel keeps its gold/production/power value but NO LONGER wins by domination (the
//     120s domination win from file 14 was removed in file 16).

import type { GameState } from "../core/types";
import { recomputePower } from "../state/gameState";

export function updateWinConditions(state: GameState): void {
  if (state.winner !== null) return;

  const aliveBefore = state.players.filter((p) => !p.eliminated).map((p) => p.id);

  let eliminatedSomeone = false;
  for (const p of state.players) {
    if (p.eliminated) continue;
    const hasCY = state.entities.some(
      (e) => e.kind === "building" && e.owner === p.id && e.buildingType === "constructionYard" && e.hp > 0,
    );
    if (!hasCY) {
      p.eliminated = true;
      eliminatedSomeone = true;
      for (let i = state.entities.length - 1; i >= 0; i--) {
        if (state.entities[i].owner === p.id) state.entities.splice(i, 1);
      }
    }
  }
  if (eliminatedSomeone) recomputePower(state);

  const alive = state.players.filter((p) => !p.eliminated);
  if (alive.length === 1) {
    state.winner = alive[0].id; // last player standing — the only victory condition
    return;
  }
  if (alive.length === 0) {
    // Simultaneous wipe (e.g. two CYs fall the same frame): award deterministically to a
    // player who was alive at the start of the frame so the match still ends.
    state.winner = aliveBefore.length > 0 ? aliveBefore[0] : 0;
  }
}
