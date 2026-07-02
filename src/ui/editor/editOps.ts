// Editor edit operations (20 §H) — pure + DOM-free so the symmetry/brush/undo core is headlessly
// testable. Every mutating op takes the GameMap and applies the action AND its symmetry images
// (Mirror ×2/×3/×4 around the map centre — the exact rotation the official maps use, via rot()).
// The editor shell (editor.ts) owns the DOM/canvas and calls these.

import { MAP_EDITOR } from "../../config/constants";
import type { GameMap, MapTile } from "../../core/types";
import { rot } from "../../state/officialMaps";

export type Symmetry = "off" | "x2" | "x3" | "x4";
export type BrushSize = 1 | 3 | 5;
export type EditorTool = MapTile | "mine" | "start" | "citadel" | "erase" | "pick";

export const SYMMETRY_FOLD: Record<Symmetry, number> = { off: 1, x2: 2, x3: 3, x4: 4 };

interface Pt { x: number; y: number }

/** All symmetry images of a tile (incl. itself), deduped + clamped to the map. */
export function symmetryPoints(map: GameMap, sym: Symmetry, x: number, y: number): Pt[] {
  const fold = SYMMETRY_FOLD[sym];
  const seen = new Set<string>();
  const out: Pt[] = [];
  for (let k = 0; k < fold; k++) {
    const p = rot(map.width, map.height, fold, k, x, y);
    if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) continue;
    const key = `${p.x},${p.y}`;
    if (!seen.has(key)) { seen.add(key); out.push(p); }
  }
  return out;
}

/** Square brush footprint offsets for size 1/3/5 (centered). */
export function brushOffsets(size: BrushSize): Pt[] {
  const r = (size - 1) / 2;
  const out: Pt[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push({ x: dx, y: dy });
  return out;
}

/** Paint terrain with the brush + symmetry. Returns true if anything changed. */
export function paintTerrain(map: GameMap, sym: Symmetry, size: BrushSize, x: number, y: number, tile: MapTile): boolean {
  let changed = false;
  for (const o of brushOffsets(size)) {
    const bx = x + o.x, by = y + o.y;
    if (bx < 0 || by < 0 || bx >= map.width || by >= map.height) continue;
    for (const p of symmetryPoints(map, sym, bx, by)) {
      if (map.terrain[p.y][p.x] !== tile) { map.terrain[p.y][p.x] = tile; changed = true; }
    }
  }
  return changed;
}

/** Place a gold mine (+ its symmetry images, identical amounts). Skips occupied tiles. */
export function placeMine(map: GameMap, sym: Symmetry, x: number, y: number, amount: number): boolean {
  const amt = Math.max(1, Math.min(MAP_EDITOR.maxMineAmount, Math.round(amount)));
  let changed = false;
  for (const p of symmetryPoints(map, sym, x, y)) {
    if (map.goldMines.some((g) => g.x === p.x && g.y === p.y)) continue;
    map.goldMines.push({ x: p.x, y: p.y, amount: amt });
    changed = true;
  }
  return changed;
}

/** Place start positions: one per symmetry image, taking the lowest free slots in orbit order.
 *  With symmetry on this is "paint one corner, get a fair set". No-op if not enough free slots. */
export function placeStart(map: GameMap, sym: Symmetry, x: number, y: number): boolean {
  const pts = symmetryPoints(map, sym, x, y).filter((p) => !map.startPositions.some((s) => s.x === p.x && s.y === p.y));
  const used = new Set(map.startPositions.map((s) => s.slot));
  const free: number[] = [];
  for (let s = 0; s < 4 && free.length < pts.length; s++) if (!used.has(s)) free.push(s);
  if (pts.length === 0 || free.length < pts.length) return false;
  pts.forEach((p, i) => map.startPositions.push({ slot: free[i], x: p.x, y: p.y }));
  return true;
}

/** Place the Citadel. Under symmetry the only self-symmetric point is the map centre — snap there. */
export function placeCitadel(map: GameMap, sym: Symmetry, x: number, y: number): boolean {
  const p = sym === "off" ? { x, y } : { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
  map.citadel = { x: p.x, y: p.y };
  return true;
}

/** Erase whatever sits at (x,y) + its symmetry images: feature first, else terrain → ground. */
export function eraseAt(map: GameMap, sym: Symmetry, size: BrushSize, x: number, y: number): boolean {
  let changed = false;
  for (const o of brushOffsets(size)) {
    const bx = x + o.x, by = y + o.y;
    if (bx < 0 || by < 0 || bx >= map.width || by >= map.height) continue;
    for (const p of symmetryPoints(map, sym, bx, by)) {
      const mi = map.goldMines.findIndex((g) => g.x === p.x && g.y === p.y);
      if (mi >= 0) { map.goldMines.splice(mi, 1); changed = true; continue; }
      const si = map.startPositions.findIndex((s) => s.x === p.x && s.y === p.y);
      if (si >= 0) { map.startPositions.splice(si, 1); changed = true; continue; }
      if (map.citadel && Math.floor(map.citadel.x) === p.x && Math.floor(map.citadel.y) === p.y) { map.citadel = null; changed = true; continue; }
      if (map.terrain[p.y][p.x] !== "ground") { map.terrain[p.y][p.x] = "ground"; changed = true; }
    }
  }
  return changed;
}

// ── Undo/redo (20 §H #2) — whole-map snapshots, capped. Simple + bulletproof: one snapshot per
// stroke/discrete action (~12 KB each × 50 ≈ 600 KB worst case). ──────────────────────────────
export const UNDO_LIMIT = 50;

export function snapshot(map: GameMap): string {
  return JSON.stringify(map);
}

export class UndoStack {
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  /** Push the PRE-change state (call before mutating). Clears redo. */
  push(pre: string): void {
    this.undoStack.push(pre);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  undo(current: GameMap): GameMap | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(snapshot(current));
    return JSON.parse(prev) as GameMap;
  }

  redo(current: GameMap): GameMap | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(snapshot(current));
    return JSON.parse(next) as GameMap;
  }

  clear(): void { this.undoStack = []; this.redoStack = []; }
}
