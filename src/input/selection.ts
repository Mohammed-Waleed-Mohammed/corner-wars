// Pure hit-testing against game state, in tile space. Only a given owner's entities
// are selectable (the human can't command enemies).

import { RENDER, TILE_SIZE } from "../config/constants";
import { pointInRect, rectFromPoints } from "../core/math";
import type { AnyEntity, GameState, GoldSource, Owner, Unit, Vec2 } from "../core/types";

/** Gold source whose tile is under a tile point (for right-click-to-harvest). */
export function goldSourceAtTile(state: GameState, pt: Vec2): GoldSource | null {
  for (const s of state.goldSources) {
    if (Math.hypot(pt.x - (s.x + 0.5), pt.y - (s.y + 0.5)) <= 0.85) return s;
  }
  return null;
}

/** Topmost selectable entity under a tile point (units preferred over buildings). */
export function entityAtTile(state: GameState, pt: Vec2, owner: Owner): AnyEntity | null {
  // Units first (drawn on top).
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const e = state.entities[i];
    if (e.owner !== owner || e.kind !== "unit") continue;
    const rTiles = (RENDER.workerRadius + RENDER.selectionPadding) / TILE_SIZE + 0.15;
    if (Math.hypot(pt.x - e.x, pt.y - e.y) <= rTiles) return e;
  }
  // Then buildings (footprint hit-test).
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const e = state.entities[i];
    if (e.owner !== owner || e.kind !== "building") continue;
    if (pointInRect(pt, { x: e.x, y: e.y, w: e.width, h: e.height })) return e;
  }
  return null;
}

/** Topmost enemy entity (not `owner`, not neutral) under a tile point — for attack orders. */
export function enemyEntityAtTile(state: GameState, pt: Vec2, owner: Owner): AnyEntity | null {
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const e = state.entities[i];
    if (e.kind !== "unit" || e.owner === "neutral" || e.owner === owner) continue;
    const rTiles = (RENDER.workerRadius + RENDER.selectionPadding) / TILE_SIZE + 0.2;
    if (Math.hypot(pt.x - e.x, pt.y - e.y) <= rTiles) return e;
  }
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const e = state.entities[i];
    if (e.kind !== "building" || e.owner === "neutral" || e.owner === owner) continue;
    if (pointInRect(pt, { x: e.x, y: e.y, w: e.width, h: e.height })) return e;
  }
  return null;
}

/** All of `owner`'s units whose position falls inside the tile-space box. */
export function unitsInBox(state: GameState, a: Vec2, b: Vec2, owner: Owner): Unit[] {
  const rect = rectFromPoints(a, b);
  const out: Unit[] = [];
  for (const e of state.entities) {
    if (e.owner === owner && e.kind === "unit" && pointInRect({ x: e.x, y: e.y }, rect)) {
      out.push(e);
    }
  }
  return out;
}
