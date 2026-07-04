// What the renderer needs from input/selection that isn't part of GameState.

import type { BuildingType, Vec2 } from "../core/types";

export interface MoveMarker {
  x: number; // tile
  y: number;
  ttl: number; // seconds remaining
  maxTtl: number;
}

/** Translucent footprint shown while placing a structure. */
export interface PlacementGhost {
  type: BuildingType;
  x: number; // top-left tile
  y: number;
  w: number;
  h: number;
  valid: boolean;
}

/** Reticle shown while choosing where to fire a targeted Citadel power, or a guard radius. */
export interface PowerReticle {
  x: number; // tile
  y: number;
  radius: number; // tiles
}

/** Hover action feedback (15-logic §10): an action label (→ cursor) + an optional world-space glow. */
export type HoverAction = "none" | "attack" | "harvest" | "select" | "capture" | "move" | "invalid" | "repair";
export interface HoverInfo {
  action: HoverAction;
  glow?: { x: number; y: number; r: number; color: string }; // tile-space ring around the hovered thing
}

/** Transient movement-line marker for a PLAYER-issued move/attack-move order (16 §3). */
export interface CommandMarker {
  unitIds: number[];
  to: Vec2; // tile
  kind: "move" | "attackMove";
  age: number;
  lifetime: number;
}

/** One previewed drag-to-build wall segment (16 §1): green when valid+affordable, red otherwise. */
export interface WallSegment {
  x: number; // tile
  y: number;
  valid: boolean;
}

export interface RenderView {
  selectedIds: Set<number>;
  dragBox: { start: Vec2; end: Vec2 } | null; // screen px
  moveMarkers: MoveMarker[];
  placement: PlacementGhost | null;
  powerTarget: PowerReticle | null;
  guardReticle: Vec2 | null; // tile center while issuing a guard order (radius from GUARD.radius)
  guardPoints: Vec2[]; // guard points of currently-selected guarding units (faint rings)
  hover: HoverInfo;
  commandMarkers: CommandMarker[]; // §3 player move/attack-move lines
  buildDrag: WallSegment[] | null; // §1 wall drag-to-build preview
  formationGroups: Record<number, number>; // 19 §J: formationId → bound control-group number (local)
  // 20 §I: hovering a formation card ghosts its layout at the army's position (world slot points + facing).
  formationPreview: { points: Vec2[]; anchor: Vec2; facing: number } | null;
  aiDebug: boolean; // 22 §O: the F5 AI Commander overlay (local, read-only)
}
