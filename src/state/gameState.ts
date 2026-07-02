// Builds the starting GameState from a static GameMap (18 §A): terrain grid, gold mines, and the
// Citadel come straight from the data, and each start position gets that player's Construction Yard +
// one Worker. NO runtime RNG — a fixed, shared map is identical on every peer (one fewer desync
// source than the old random terrain/resource generation this replaces).

import { FOG_UPDATE_INTERVAL, START_GOLD } from "../config/constants";
import type { FogState, GameMap, GameState, Player, PlayerId } from "../core/types";
import { createBuilding, createGoldSource, createUnit } from "./entities";
import { DEFAULT_MAP, OPEN_MAP } from "./maps";

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
    stats: { produced: 0, lost: 0, goldMined: 0, buildingsRazed: 0, citadelSeconds: 0 },
    unlocks: { advancedVehicles: false, siegeDoctrine: false, advancedDefenses: false },
    upgrades: {
      mining: 0, weapons: 0, armor: 0, supplyLines: 0,
      constructionCrews: false, streamlinedProduction: false, fieldLogistics: false, combatStims: false,
    },
    // AI players (1-3) get a brain; stagger first decisions so they don't all fire together.
    ai: id === 0 ? undefined : { mode: "expand", decisionTimer: id * 0.15, attackClock: 0 },
  };
}

export interface MatchOptions {
  terrain?: boolean; // generate impassable terrain (default true); tests disable for open maps
}

/** Reconfigure player roles for a multiplayer match from the agreed lobby slots (17-multiplayer M4).
 *  Human seats never run AI; AI seats keep a brain. A seat that is neither human nor AI (closed/empty)
 *  is NOT in this match: it's eliminated and its base cleared — otherwise a map with a start position
 *  for that slot (e.g. closing seats on Four Corners for a 1v1) leaves an un-owned "ghost" base that
 *  nobody drives and the win check never removes, hanging the match forever (18 §M2 fix). Applied
 *  identically on every peer (slots are shared), and the checksum-relevant removals match, so it stays
 *  deterministic. */
export function configurePlayers(state: GameState, humanIds: PlayerId[], aiIds: PlayerId[]): void {
  const humans = new Set<PlayerId>(humanIds);
  const ais = new Set<PlayerId>(aiIds);
  for (const p of state.players) {
    p.isHuman = humans.has(p.id);
    p.ai = ais.has(p.id) ? (p.ai ?? { mode: "expand", decisionTimer: p.id * 0.15, attackClock: 0 }) : undefined;
    if (!humans.has(p.id) && !ais.has(p.id)) p.eliminated = true; // inert seat → not playing
  }
  // Drop the bases/units of eliminated (inert) seats so no ownerless base survives.
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const o = state.entities[i].owner;
    if (o !== "neutral" && state.players[o].eliminated) state.entities.splice(i, 1);
  }
  recomputePower(state);
}

/** THE loader (18 §A): build the world from static map data. Deterministic — no RNG. */
export function buildFromMap(map: GameMap): GameState {
  const state: GameState = {
    tick: 0,
    time: 0,
    seed: 0, // vestigial: no map/terrain/resource RNG remains (18 §A); kept for the field's type
    players: [createPlayer(0), createPlayer(1), createPlayer(2), createPlayer(3)],
    entities: [],
    formations: [],
    projectiles: [],
    effects: [],
    soundEvents: [],
    goldSources: [],
    citadel: {
      // Fall back to the loaded map's OWN centre (not a fixed 24,24) when no Citadel is specified.
      x: map.citadel?.x ?? map.width / 2,
      y: map.citadel?.y ?? map.height / 2,
      controllingPlayer: "neutral",
      capturingPlayer: null,
      captureTimer: 0,
    },
    // Copy the map terrain so the shared GameMap data is never mutated by the sim.
    terrain: map.terrain.map((row) => row.slice()),
    fog: Array.from({ length: map.height }, () => new Array<FogState>(map.width).fill("unexplored")),
    viewPlayer: 0, // SP default; MP overrides to the local player after build
    mapWidth: map.width,
    mapHeight: map.height,
    winner: null,
    nextId: 1,
    nextFormationId: 1,
    humanLowPower: false,
    fogTimer: FOG_UPDATE_INTERVAL, // force a fog compute on frame 1 (no startup black flash)
    fogVersion: 0,
  };

  // Gold mines (home + neutral + rich), all explicit in the data.
  for (const m of map.goldMines) {
    state.goldSources.push(createGoldSource(state, m.x, m.y, m.amount));
  }

  // Each start position → that player's Construction Yard + one starting Worker. Slots without a
  // start (fewer players than 4) simply get no base; the win check treats them as already out.
  for (const s of map.startPositions) {
    if (s.slot < 0 || s.slot > 3) continue;
    const owner = s.slot as PlayerId;
    state.entities.push(createBuilding(state, owner, "constructionYard", s.x, s.y));
    state.entities.push(createUnit(state, owner, "worker", s.x + 3.5, s.y + 3.5));
  }

  recomputePower(state);
  return state;
}

/** Back-compat entry (SP + headless tests). Maps are static now, so the `seed` arg is ignored;
 *  `terrain: false` selects the all-ground OPEN_MAP, otherwise the bordered DEFAULT_MAP. */
export function createInitialState(seed?: number, opts: MatchOptions = {}): GameState {
  void seed;
  return buildFromMap(opts.terrain === false ? OPEN_MAP : DEFAULT_MAP);
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
