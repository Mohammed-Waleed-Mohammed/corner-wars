// 39 whole-map scouting: the staleness map. The map in CELL-tile cells, each aged by how long since this
// AI last had it in sight (intel.lastSeen, five sample tiles a cell; never seen counts as the cap), and
// weighted by where news matters: the lanes between my base and each rival's (where armies march) count
// more. Cells I can see from home, by a rival's base (the base looks cover those), under a known tower,
// or with no ground to stand on are left out. The Hard scout weighs the stalest few against its points
// of interest (spymaster.ts runScout), so between looks at their bases and mines it sweeps the ground
// nobody has looked at — a flank route, a hidden expansion, an army staging out of the way. Pure: reads
// the perceived view and intel, returns cells.

import { COMMANDER } from "../../config/constants";
import type { AIIntel, GameState, PlayerId, Vec2 } from "../../core/types";
import { staleness } from "../aiPerception";
import { nearestPassableTile } from "../pathfinding";
import { baseCenter, defenseCover, livingEnemies } from "./assess";

const W = COMMANDER.INTEL.SWEEP;

export interface StaleCell { at: Vec2; age: number; w: number }

/** Distance from `p` to the segment a–b. */
function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
}

/** Every cell worth a look, aged in ticks (capped at AGE_CAP) — in grid order. */
export function staleCells(state: GameState, pid: PlayerId, intel: AIIntel, homes: (e: PlayerId) => Vec2 | null): StaleCell[] {
  const home = baseCenter(state, pid);
  const foes = livingEnemies(state, pid);
  const lanes = foes.map((e) => homes(e)).filter((h): h is Vec2 => !!h);
  const out: StaleCell[] = [];
  const C = W.CELL, h = C / 4;
  for (let cy = 0; cy * C < state.mapHeight; cy++) for (let cx = 0; cx * C < state.mapWidth; cx++) {
    const c = { x: Math.min(state.mapWidth - 1, cx * C + C / 2), y: Math.min(state.mapHeight - 1, cy * C + C / 2) };
    if (home && Math.hypot(c.x - home.x, c.y - home.y) < W.NEAR_HOME) continue;
    if (lanes.some((l) => Math.hypot(c.x - l.x, c.y - l.y) < W.NEAR_RIVAL)) continue;
    const at = nearestPassableTile(state, c.x, c.y);
    if (Math.hypot(at.x - c.x, at.y - c.y) > C / 2) continue; // no ground here (water, cliffs)
    if (foes.some((e) => defenseCover(state, e, at) > 0)) continue; // a scout can't look there and live
    let age = 0;
    for (const [ox, oy] of [[0, 0], [-h, -h], [h, -h], [-h, h], [h, h]]) {
      const a = staleness(state, intel, c.x + ox, c.y + oy);
      age += Math.min(a, W.AGE_CAP);
    }
    age /= 5;
    const lane = !!home && lanes.some((l) => toSegment(c, home, l) <= W.LANE_DIST);
    out.push({ at, age, w: lane ? W.LANE_W : 1 });
  }
  return out;
}

/** The few cells that most want a look from `from`: age × weight, less the trip — stale enough only. */
export function stalestCells(state: GameState, pid: PlayerId, intel: AIIntel, homes: (e: PlayerId) => Vec2 | null, from: Vec2, n = W.TOP): StaleCell[] {
  return staleCells(state, pid, intel, homes)
    .filter((c) => c.age >= W.MIN_AGE_TICKS)
    .map((c) => ({ c, s: c.age * c.w - Math.hypot(c.at.x - from.x, c.at.y - from.y) * 10 }))
    .sort((a, b) => b.s - a.s || a.c.at.y - b.c.at.y || a.c.at.x - b.c.at.x)
    .slice(0, n)
    .map((x) => x.c);
}
