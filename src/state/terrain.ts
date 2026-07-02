// Terrain queries. Terrain is now STATIC map data (18 §A) — the random generation that used to live
// here (mountain border + scattered features, seeded RNG) is gone; the mountain border is baked into
// the map data instead. Only "ground" is walkable/buildable; mountain/water/rock/void are impassable.

import type { GameState } from "../core/types";

export function isGround(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.mapWidth && y < state.mapHeight && state.terrain[y][x] === "ground";
}
