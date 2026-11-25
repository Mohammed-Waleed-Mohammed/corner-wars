// 39 the Spy: once per tick, before the hash rebuild and every scanner, decide to whom each Spy is
// revealed. A player sees (and may target) an enemy Spy only while it stands within one of their
// finished, powered towers' reach + SPY.REVEAL_PAD (the tower's real range: high ground and Fire Mission
// count), and for SPY.LINGER_S after it leaves. An offline tower is blind. Deterministic: entity order,
// sim time.

import { DEFENSE_STATS, SPY } from "../config/constants";
import type { Building, GameState, Unit } from "../core/types";
import { defenseRangeBonus } from "../state/doctrine";
import { isLowPower } from "../state/gameState";
import { defenseRangeOf } from "../state/terrain";

export function updateSpies(state: GameState): void {
  let spies: Unit[] | null = null;
  for (const e of state.entities) if (e.kind === "unit" && e.unitType === "spy" && e.hp > 0) (spies ??= []).push(e);
  if (!spies) return;
  // every live detector: center, reach² and owner
  const eyes: { x: number; y: number; r2: number; owner: number }[] = [];
  for (const e of state.entities) {
    if (e.kind !== "building" || e.owner === "neutral" || e.hp <= 0 || e.buildProgress < 1) continue;
    const stat = DEFENSE_STATS[e.buildingType];
    if (!stat || isLowPower(state, e.owner)) continue;
    const b = e as Building;
    const r = defenseRangeOf(state, b, stat.range + defenseRangeBonus(state.players[e.owner], e.buildingType)) + SPY.REVEAL_PAD;
    eyes.push({ x: b.x + b.width / 2, y: b.y + b.height / 2, r2: r * r, owner: e.owner });
  }
  const t = state.time;
  for (const s of spies) {
    const until = (s.revealUntil ??= [-1, -1, -1, -1]);
    for (const d of eyes) {
      if (d.owner === s.owner) continue;
      const dx = d.x - s.x, dy = d.y - s.y;
      if (dx * dx + dy * dy <= d.r2) until[d.owner] = t + SPY.LINGER_S;
    }
    let mask = 0;
    for (let p = 0; p < until.length; p++) if (until[p] > t) mask |= 1 << p;
    s.revealedTo = mask;
  }
}
