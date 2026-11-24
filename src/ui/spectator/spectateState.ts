// 35 — the spectator match state, built from a frozen spectate setup. Pure (no DOM, no CSS), so the
// aisim harness can build exactly what the spectator runs.

import { randomCommander } from "../../config/commanders";
import type { CommanderId, GameState, PlayerId } from "../../core/types";
import { enableObserverFog } from "../../engine/fog";
import { applyBiome, applyCommanders, buildFromMap, configurePlayers } from "../../state/gameState";
import type { SpectateSetup } from "../screens/spectateSetup";

/** Build the match state for a spectate setup (seats past the map's player count are ignored). */
export function createSpectateState(setup: SpectateSetup, seed: number): { state: GameState; live: PlayerId[]; commanders: (CommanderId | null)[] } {
  const maxP = setup.map.maxPlayers;
  const live = setup.seats.map((s, i) => (s.on && i < maxP ? (i as PlayerId) : null)).filter((x): x is PlayerId => x !== null);
  const commanders = setup.seats.map((s, i) => (live.includes(i as PlayerId) ? (s.commander === "random" ? randomCommander(seed, i) : s.commander) : null));

  const state = buildFromMap(setup.map);
  state.seed = seed >>> 0;
  configurePlayers(state, [], live); // every seat an AI, none human
  if (setup.biome) applyBiome(state, setup.biome);
  applyCommanders(state, commanders);
  for (const p of state.players) {
    if (p.eliminated || !p.ai) continue;
    const seat = setup.seats[p.id];
    p.gold = setup.startingGold;
    p.ai.difficulty = seat.difficulty;
    if (seat.difficulty !== "easy" && seat.personality !== "random") p.ai.personalityOverride = seat.personality;
  }
  state.viewPlayer = live[0] ?? 0;
  enableObserverFog(state);
  return { state, live, commanders };
}
