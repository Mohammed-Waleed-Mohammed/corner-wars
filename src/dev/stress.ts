// Dev-only performance test (`?stress=N` on a skirmish URL): spawn N mixed units for every player in a
// spiral around their Construction Yard at match start — or, with `&clash`, around the Citadel, each
// army 9 tiles out on its own side, so they fight at once — so big-battle frame times can be measured
// and profiled in the browser. Never runs in a production build or in multiplayer (main.ts gates it).

import type { Building, GameState, UnitType } from "../core/types";
import { nearestPassableTile } from "../engine/pathfinding";
import { createUnit } from "../state/entities";

const MIX: UnitType[] = ["rifleman", "rifleman", "rocket", "grenadier", "tank", "medic", "scoutBuggy", "heavyTank", "artillery"];

export function spawnStressArmies(state: GameState, perPlayer: number, clash = false): void {
  for (const p of state.players) {
    if (p.eliminated) continue;
    const yard = state.entities.find((e): e is Building => e.kind === "building" && e.owner === p.id && e.buildingType === "constructionYard");
    if (!yard) continue;
    let cx = yard.x + yard.width / 2, cy = yard.y + yard.height / 2;
    if (clash) {
      const a = Math.atan2(cy - state.citadel.y, cx - state.citadel.x);
      cx = state.citadel.x + Math.cos(a) * 9;
      cy = state.citadel.y + Math.sin(a) * 9;
    }
    for (let i = 0; i < perPlayer; i++) {
      const a = i * 2.399, r = (clash ? 0.5 : 4) + Math.sqrt(i) * (clash ? 0.8 : 1.1); // golden-angle spiral
      const t = nearestPassableTile(state, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      state.entities.push(createUnit(state, p.id, MIX[i % MIX.length], t.x, t.y));
    }
  }
}
