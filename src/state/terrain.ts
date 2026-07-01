// Terrain generation (§3): a Mountain border ring + impassable features (mountain/water/
// rock) scattered in one quadrant and mirrored 90/180/270 about (24,24) for fairness. Never
// buries a base, home mine, the Citadel, or a gold deposit. A MANDATORY connectivity check
// (BFS from every base to the Citadel and its home mine) guarantees no player is walled off;
// if a layout fails after many tries, it falls back to a border-only (open) map.

import { BASES, CITADEL_POS, TERRAIN_GEN, TERRAIN_WEIGHTS } from "../config/constants";
import { distanceXY } from "../core/math";
import { randInt, type Rng } from "../sim/rng";
import type { GameState, TerrainType, Vec2 } from "../core/types";

const C = TERRAIN_GEN;

export function generateTerrain(state: GameState, rng: Rng): void {
  for (let attempt = 0; attempt < C.maxAttempts; attempt++) {
    fillGround(state);
    addBorder(state);
    scatterFeatures(state, rng);
    if (connectivityOk(state)) return;
  }
  // Couldn't find a connected layout — ship a guaranteed-safe border-only map.
  fillGround(state);
  addBorder(state);
}

export function isGround(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.mapWidth && y < state.mapHeight && state.terrain[y][x] === "ground";
}

function fillGround(state: GameState): void {
  for (let y = 0; y < state.mapHeight; y++) state.terrain[y].fill("ground");
}

function addBorder(state: GameState): void {
  const b = C.border;
  const W = state.mapWidth;
  const H = state.mapHeight;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < b || y < b || x >= W - b || y >= H - b) state.terrain[y][x] = "mountain";
    }
  }
}

function scatterFeatures(state: GameState, rng: Rng): void {
  for (let i = 0; i < C.featuresPerQuadrant; i++) {
    // Seed in the top-left inner region (between border and the Citadel).
    let cx = randInt(rng, C.border + 2, CITADEL_POS.x - C.citadelMargin - 1);
    let cy = randInt(rng, C.border + 2, CITADEL_POS.y - C.citadelMargin - 1);
    const type = pickType(rng);
    const size = randInt(rng, C.clusterMin, C.clusterMax);
    for (let k = 0; k < size; k++) {
      placeMirrored(state, cx, cy, type);
      cx += randInt(rng, -1, 1); // random-walk the cluster
      cy += randInt(rng, -1, 1);
    }
  }
}

/** Place a tile in all four quadrants, or none — so terrain stays perfectly symmetric even
 *  where one rotation lands in an exclusion zone (fairness, §3). */
function placeMirrored(state: GameState, x: number, y: number, type: TerrainType): void {
  const pts: Vec2[] = [];
  for (let q = 0; q < 4; q++) {
    const p = rotate(x, y, q);
    if (p.x < 0 || p.y < 0 || p.x >= state.mapWidth || p.y >= state.mapHeight) return;
    if (blocked(state, p.x, p.y)) return; // any quadrant excluded -> place in none
    pts.push(p);
  }
  for (const p of pts) state.terrain[p.y][p.x] = type;
}

/** Tiles that must stay walkable ground (bases, home mines, Citadel, gold). */
function blocked(state: GameState, x: number, y: number): boolean {
  const b = C.border;
  if (x < b || y < b || x >= state.mapWidth - b || y >= state.mapHeight - b) return true;
  for (const base of BASES) {
    if (
      x >= base.x - C.baseMargin && x < base.x + 3 + C.baseMargin &&
      y >= base.y - C.baseMargin && y < base.y + 3 + C.baseMargin
    ) {
      return true;
    }
    if (distanceXY(x, y, base.mine.x, base.mine.y) <= C.mineMargin) return true;
  }
  if (distanceXY(x, y, CITADEL_POS.x, CITADEL_POS.y) <= C.citadelMargin) return true;
  for (const g of state.goldSources) {
    if (distanceXY(x, y, g.x, g.y) <= C.mineMargin) return true;
  }
  return false;
}

function rotate(x: number, y: number, quarterTurns: number): Vec2 {
  let dx = x - CITADEL_POS.x;
  let dy = y - CITADEL_POS.y;
  for (let i = 0; i < quarterTurns; i++) {
    const ndx = -dy;
    const ndy = dx;
    dx = ndx;
    dy = ndy;
  }
  return { x: CITADEL_POS.x + dx, y: CITADEL_POS.y + dy };
}

function pickType(rng: Rng): TerrainType {
  const total = TERRAIN_WEIGHTS.reduce((s, w) => s + w.weight, 0);
  let r = rng() * total;
  for (const w of TERRAIN_WEIGHTS) {
    r -= w.weight;
    if (r <= 0) return w.type;
  }
  return "mountain";
}

/** Every base must reach the Citadel and its own home mine over walkable ground. */
function connectivityOk(state: GameState): boolean {
  for (const base of BASES) {
    const seen = floodGround(state, base.x + 1, base.y + 1); // start inside the CY footprint
    if (!seen.has(idx(state, CITADEL_POS.x, CITADEL_POS.y))) return false;
    if (!seen.has(idx(state, base.mine.x, base.mine.y))) return false;
  }
  return true;
}

const idx = (state: GameState, x: number, y: number) => y * state.mapWidth + x;

function floodGround(state: GameState, sx: number, sy: number): Set<number> {
  const seen = new Set<number>();
  const stack: number[] = [sx, sy];
  seen.add(idx(state, sx, sy));
  const dirs = [1, 0, -1, 0, 0, 1, 0, -1]; // 4-connected (conservative)
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    for (let d = 0; d < 8; d += 2) {
      const nx = x + dirs[d];
      const ny = y + dirs[d + 1];
      if (!isGround(state, nx, ny)) continue;
      const k = idx(state, nx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push(nx, ny);
    }
  }
  return seen;
}
