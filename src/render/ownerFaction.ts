// 27 §H — which faction's art to draw for an owner. The draw functions (units.ts, buildings.ts) don't
// receive the GameState, so the renderer installs a resolver each frame (as it does for build times).
// Default: none → the classic role shapes / labelled blocks. Render-only.

import { factionOf } from "../config/commanders";
import type { FactionId, GameState, Owner } from "../core/types";

let resolve: (owner: Owner) => FactionId | null = () => null;

/** Point the resolver at a state (each player's commander → faction). */
export function setFactionSource(state: GameState | null): void {
  resolve = state ? (o) => (o === "neutral" ? null : factionOf(state.players[o]?.commander)) : () => null;
}

export function ownerFaction(owner: Owner): FactionId | null {
  return resolve(owner);
}
