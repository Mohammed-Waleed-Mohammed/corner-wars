// Spatial hash for broad-phase neighbor queries (15-logic §6 performance). Entities are
// bucketed into coarse cells; a radius query returns everything in the overlapping cells
// (a superset — callers still do the exact distance check). Rebuilt each fixed step. One
// shared singleton serves combat targeting, Citadel capture, and separation, replacing the
// O(n) per-unit scans. queryInto() reuses a caller-supplied array to avoid per-query GC.

import type { AnyEntity, GameState } from "../core/types";

const CELL = 4; // tiles per cell — covers typical query radii (aggro 6, turret 7) in a few cells
const STRIDE = 1024; // > any column count, with an offset for slight off-map coords

function key(x: number, y: number): number {
  const cx = Math.floor(x / CELL) + 64;
  const cy = Math.floor(y / CELL) + 64;
  return cy * STRIDE + cx;
}

export class SpatialHash {
  private cells = new Map<number, AnyEntity[]>();

  private add(k: number, e: AnyEntity): void {
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(e);
    else this.cells.set(k, [e]);
  }

  /** Rebuild from live entities. `unitsOnly` skips buildings (separation only needs units). */
  rebuild(state: GameState, unitsOnly = false): void {
    this.cells.clear();
    for (const e of state.entities) {
      if (e.hp <= 0) continue;
      if (e.kind === "building") {
        if (unitsOnly) continue;
        // Buildings span multiple cells — bucket every cell the footprint overlaps.
        const cx0 = Math.floor(e.x / CELL) + 64;
        const cx1 = Math.floor((e.x + e.width - 1e-6) / CELL) + 64;
        const cy0 = Math.floor(e.y / CELL) + 64;
        const cy1 = Math.floor((e.y + e.height - 1e-6) / CELL) + 64;
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) this.add(cy * STRIDE + cx, e);
        }
      } else {
        this.add(key(e.x, e.y), e);
      }
    }
  }

  /** Fill `out` with entities in cells overlapping the (x,y,radius) box. Clears `out` first. */
  queryInto(x: number, y: number, radius: number, out: AnyEntity[]): void {
    out.length = 0;
    const minCx = Math.floor((x - radius) / CELL) + 64;
    const maxCx = Math.floor((x + radius) / CELL) + 64;
    const minCy = Math.floor((y - radius) / CELL) + 64;
    const maxCy = Math.floor((y + radius) / CELL) + 64;
    for (let cy = minCy; cy <= maxCy; cy++) {
      const row = cy * STRIDE;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells.get(row + cx);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
  }
}

// Shared instances: one over all entities (targeting/capture), one units-only (separation).
export const entityHash = new SpatialHash();
export const unitHash = new SpatialHash();
