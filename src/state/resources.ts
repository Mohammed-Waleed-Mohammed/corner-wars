// Random neutral-deposit generation (03-resources-economy.md §"Random generation").
// Candidates are seeded in the top-left quadrant, then rotated 90/180/270 around the
// map center so every player faces an identical *shape* of opportunity with a different
// layout each game. Rich central deposits ring the Citadel.

import {
  BASES,
  CENTRAL_DEPOSIT_GOLD,
  GRID,
  MAP_CENTER,
  NEUTRAL_DEPOSIT_GOLD,
  RESOURCE_GEN,
} from "../config/constants";
import { distanceXY } from "../core/math";
import { randInt, randRange, type Rng } from "../sim/rng";
import type { GameState, Vec2 } from "../core/types";
import { createGoldSource } from "./entities";

/** Rotate a point around the map center by `quarterTurns` * 90° CCW (integer-preserving). */
function rotateAroundCenter(p: Vec2, quarterTurns: number): Vec2 {
  let dx = p.x - MAP_CENTER.x;
  let dy = p.y - MAP_CENTER.y;
  for (let i = 0; i < quarterTurns; i++) {
    const ndx = -dy;
    const ndy = dx;
    dx = ndx;
    dy = ndy;
  }
  return { x: MAP_CENTER.x + dx, y: MAP_CENTER.y + dy };
}

export function generateNeutralDeposits(state: GameState, rng: Rng): void {
  const g = RESOURCE_GEN;
  const baseA = BASES[0];
  const baseCenter = { x: baseA.x + 1.5, y: baseA.y + 1.5 }; // CY footprint center
  const homeMineA = baseA.mine;

  // Seed N candidates in the top-left inner region (between base and center).
  const n = randInt(rng, g.minPerQuadrant, g.maxPerQuadrant);
  const accepted: Vec2[] = [];
  let attempts = 0;
  while (accepted.length < n && attempts < 300) {
    attempts++;
    const c: Vec2 = {
      x: Math.round(randRange(rng, 4, MAP_CENTER.x - 3)),
      y: Math.round(randRange(rng, 4, MAP_CENTER.y - 3)),
    };
    if (distanceXY(c.x, c.y, baseCenter.x, baseCenter.y) < g.baseExclusion) continue;
    if (distanceXY(c.x, c.y, MAP_CENTER.x, MAP_CENTER.y) < g.citadelExclusion) continue;
    if (distanceXY(c.x, c.y, homeMineA.x, homeMineA.y) < g.minSpacing) continue;
    if (accepted.some((p) => distanceXY(p.x, p.y, c.x, c.y) < g.minSpacing)) continue;
    accepted.push(c);
  }

  // Mirror each accepted candidate into all four quadrants.
  for (const c of accepted) {
    for (let q = 0; q < 4; q++) {
      const p = rotateAroundCenter(c, q);
      state.goldSources.push(createGoldSource(state, p.x, p.y, NEUTRAL_DEPOSIT_GOLD));
    }
  }

  // Rich central deposits, evenly spaced on a ring just outside the Citadel.
  const k = randInt(rng, g.centralCountMin, g.centralCountMax);
  const phase = randRange(rng, 0, Math.PI * 2);
  for (let i = 0; i < k; i++) {
    let ang = phase + (Math.PI * 2 * i) / k;
    let x = ringX(ang, g.centralRingRadius);
    let y = ringY(ang, g.centralRingRadius);
    // Nudge along the ring if this lands on an existing deposit's tile.
    for (let tries = 0; tries < 8 && state.goldSources.some((s) => s.x === x && s.y === y); tries++) {
      ang += Math.PI / 12;
      x = ringX(ang, g.centralRingRadius);
      y = ringY(ang, g.centralRingRadius);
    }
    state.goldSources.push(createGoldSource(state, x, y, CENTRAL_DEPOSIT_GOLD));
  }
}

function ringX(ang: number, radius: number): number {
  return clampTile(Math.round(MAP_CENTER.x + radius * Math.cos(ang)));
}
function ringY(ang: number, radius: number): number {
  return clampTile(Math.round(MAP_CENTER.y + radius * Math.sin(ang)));
}

function clampTile(v: number): number {
  return Math.max(1, Math.min(GRID.width - 2, v));
}
