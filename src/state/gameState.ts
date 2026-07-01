// Builds the starting GameState: 4 corner bases, their home mines, one Worker each,
// and the neutral Citadel. Random neutral deposits are added in a later milestone
// (build-order step 6).

import {
  BASES,
  CITADEL_POS,
  FOG_UPDATE_INTERVAL,
  GRID,
  HOME_MINE_GOLD,
  START_GOLD,
} from "../config/constants";
import { mulberry32 } from "../sim/rng";
import type { FogState, GameState, Player, PlayerId, TerrainType } from "../core/types";
import { createBuilding, createGoldSource, createUnit } from "./entities";
import { generateNeutralDeposits } from "./resources";
import { generateTerrain } from "./terrain";

function createPlayer(id: PlayerId): Player {
  return {
    id,
    isHuman: id === 0,
    gold: START_GOLD,
    powerProduced: 0,
    powerUsed: 0,
    commandEnergy: 0,
    citadelHoldTime: 0,
    eliminated: false,
    frenzyTimer: 0,
    unlocks: { advancedVehicles: false, siegeDoctrine: false, advancedDefenses: false },
    upgrades: {
      mining: 0, weapons: 0, armor: 0, supplyLines: 0,
      constructionCrews: false, streamlinedProduction: false, fieldLogistics: false,
    },
    // AI players (1-3) get a brain; stagger first decisions so they don't all fire together.
    ai: id === 0 ? undefined : { mode: "expand", decisionTimer: id * 0.15, attackClock: 0 },
  };
}

export interface MatchOptions {
  terrain?: boolean; // generate impassable terrain (default true); tests disable for open maps
}

export function createInitialState(seed?: number, opts: MatchOptions = {}): GameState {
  const resolvedSeed = seed ?? Math.floor(Math.random() * 0xffffffff);
  const state: GameState = {
    tick: 0,
    time: 0,
    seed: resolvedSeed,
    players: [createPlayer(0), createPlayer(1), createPlayer(2), createPlayer(3)],
    entities: [],
    projectiles: [],
    effects: [],
    soundEvents: [],
    goldSources: [],
    citadel: {
      x: CITADEL_POS.x,
      y: CITADEL_POS.y,
      controllingPlayer: "neutral",
      capturingPlayer: null,
      captureTimer: 0,
    },
    // All-ground terrain (until M8). Fog starts unexplored and is revealed by sight (§11).
    terrain: Array.from({ length: GRID.height }, () => new Array<TerrainType>(GRID.width).fill("ground")),
    fog: Array.from({ length: GRID.height }, () => new Array<FogState>(GRID.width).fill("unexplored")),
    mapWidth: GRID.width,
    mapHeight: GRID.height,
    winner: null,
    nextId: 1,
    humanLowPower: false,
    fogTimer: FOG_UPDATE_INTERVAL, // force a fog compute on frame 1 (no startup black flash)
    fogVersion: 0,
  };

  for (const base of BASES) {
    // Construction Yard (the base) — losing it eliminates the player.
    state.entities.push(
      createBuilding(state, base.player, "constructionYard", base.x, base.y),
    );
    // Home gold mine.
    state.goldSources.push(
      createGoldSource(state, base.mine.x, base.mine.y, HOME_MINE_GOLD),
    );
    // One starting Worker, placed just outside the yard toward the mine.
    const w = createUnit(state, base.player, "worker", base.x + 3.5, base.y + 3.5);
    state.entities.push(w);
  }

  // Neutral mid-map deposits, mirrored for fairness.
  const rng = mulberry32(resolvedSeed);
  generateNeutralDeposits(state, rng);

  // Terrain after deposits so generation can avoid burying gold (§3). Default on.
  if (opts.terrain !== false) generateTerrain(state, rng);

  recomputePower(state);
  return state;
}

/** Recompute each player's produced/used power from their live buildings (04-power.md). */
export function recomputePower(state: GameState): void {
  for (const p of state.players) {
    p.powerProduced = 0;
    p.powerUsed = 0;
  }
  for (const e of state.entities) {
    if (e.kind !== "building" || e.owner === "neutral") continue;
    if (e.buildProgress < 1) continue; // only finished buildings count
    const p = state.players[e.owner];
    p.powerProduced += e.powerProduced;
    p.powerUsed += e.powerUsed;
  }
}

export function isLowPower(state: GameState, owner: PlayerId): boolean {
  const p = state.players[owner];
  return p.powerUsed > p.powerProduced;
}
