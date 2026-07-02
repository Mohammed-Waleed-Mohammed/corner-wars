// Shared building-placement geometry, used by both the human's placement UI and the AI.
// "Clear" = on the map and not overlapping another building, a gold source, or the
// Citadel. Gold/tech affordability is checked separately by each caller.

import { BUILD_RADIUS, BUILDING_STATS, CITADEL, STRUCTURE_CAP } from "../config/constants";
import type { GameState, Owner } from "../core/types";
import { isGround } from "../state/terrain";

/** Nearest edge-to-edge distance between two axis-aligned rects (0 if they overlap/touch). */
export function rectEdgeDist(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): number {
  const dx = Math.max(0, ax - (bx + bw), bx - (ax + aw));
  const dy = Math.max(0, ay - (by + bh), by - (ay + ah));
  return Math.hypot(dx, dy);
}

/** A new building must sit within BUILD_RADIUS of an existing friendly building (§7). */
export function withinBuildRadius(
  state: GameState, owner: Owner, x: number, y: number, w: number, h: number,
): boolean {
  for (const e of state.entities) {
    if (e.kind !== "building" || e.owner !== owner || e.hp <= 0) continue;
    if (rectEdgeDist(x, y, w, h, e.x, e.y, e.width, e.height) <= BUILD_RADIUS) return true;
  }
  return false;
}

export function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function footprintClear(state: GameState, x: number, y: number, w: number, h: number): boolean {
  if (x < 0 || y < 0 || x + w > state.mapWidth || y + h > state.mapHeight) return false;
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!isGround(state, tx, ty)) return false; // can't build on impassable terrain (§7)
    }
  }
  for (const e of state.entities) {
    if (e.kind === "building" && rectsOverlap(x, y, w, h, e.x, e.y, e.width, e.height)) return false;
  }
  for (const g of state.goldSources) {
    if (g.x >= x && g.x < x + w && g.y >= y && g.y < y + h) return false;
  }
  const cv = CITADEL.visualRadius;
  const cit = state.citadel;
  if (rectsOverlap(x, y, w, h, cit.x - cv, cit.y - cv, cv * 2, cv * 2)) return false;
  return true;
}

// ── Drag-to-build wall lines (16 §1) — deterministic; shared by the HUD preview, the click
// commit, and the PLACE_WALL_LINE command so every peer expands the SAME line the SAME way. ──

/** Bresenham tiles from (fromX,fromY) to (toX,toY): one 1×1 wall segment per tile along the line. */
export function wallLineTiles(fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number }[] {
  let x0 = Math.floor(fromX);
  let y0 = Math.floor(fromY);
  const x1 = Math.floor(toX);
  const y1 = Math.floor(toY);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  const out: { x: number; y: number }[] = [];
  for (let guard = 0; guard < 200; guard++) {
    out.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return out;
}

export interface WallSeg { x: number; y: number; valid: boolean }

/** Plan a wall line: each tile is valid when it's clear, affordable within the running gold+cap
 *  budget, and within build radius — chaining outward, since each accepted segment anchors the
 *  next (matching how the commit incrementally places sites). Preview and commit call this with the
 *  SAME inputs so what you see is exactly what builds. */
export function planWallLine(state: GameState, owner: Owner, tiles: { x: number; y: number }[], gold: number, wallGateCount: number): WallSeg[] {
  const cost = BUILDING_STATS.wall.gold;
  let budget = gold;
  let count = wallGateCount;
  const anchors: { x: number; y: number }[] = [];
  const out: WallSeg[] = [];
  for (const t of tiles) {
    const clear = footprintClear(state, t.x, t.y, 1, 1);
    const inRadius =
      clear &&
      (withinBuildRadius(state, owner, t.x, t.y, 1, 1) ||
        anchors.some((a) => rectEdgeDist(t.x, t.y, 1, 1, a.x, a.y, 1, 1) <= BUILD_RADIUS));
    const affordable = inRadius && budget >= cost && count < STRUCTURE_CAP.wallsPerPlayer;
    if (affordable) {
      budget -= cost;
      count++;
      anchors.push({ x: t.x, y: t.y });
    }
    out.push({ x: t.x, y: t.y, valid: affordable });
  }
  return out;
}
