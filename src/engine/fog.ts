// Fog of war (§11), for the LOCAL player (state.viewPlayer) — the AI sees the whole map (a v1
// simplification). Three states per tile: unexplored (never seen) -> explored (seen before; static
// objects shown dimmed, but not live enemy positions) -> visible (currently in a friendly sight
// radius). Recomputed on a slow timer for performance, not every frame. Fog is cosmetic/local — it
// is NOT hashed by the checksum, so computing it per-peer-perspective doesn't affect determinism.

import { FOG_UPDATE_INTERVAL } from "../config/constants";
import type { FogState, GameState } from "../core/types";

export function updateFog(state: GameState, dt: number): void {
  state.fogTimer = (state.fogTimer ?? 0) + dt;
  if (state.fogTimer < FOG_UPDATE_INTERVAL) return;
  state.fogTimer = 0;
  state.fogVersion = (state.fogVersion ?? 0) + 1; // invalidate the render-side fog cache

  // Everything currently visible drops to explored; sight then re-lights what's in range.
  for (let y = 0; y < state.mapHeight; y++) {
    const row = state.fog[y];
    for (let x = 0; x < state.mapWidth; x++) {
      if (row[x] === "visible") row[x] = "explored";
    }
  }

  for (const e of state.entities) {
    if (e.owner !== state.viewPlayer || e.hp <= 0) continue;
    const cx = e.kind === "building" ? e.x + e.width / 2 : e.x;
    const cy = e.kind === "building" ? e.y + e.height / 2 : e.y;
    reveal(state, cx, cy, e.sightRadius);
  }
}

function reveal(state: GameState, cx: number, cy: number, r: number): void {
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(state.mapWidth - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(state.mapHeight - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) state.fog[y][x] = "visible";
    }
  }
}

export function fogAt(state: GameState, tx: number, ty: number): FogState {
  if (ty < 0 || ty >= state.mapHeight || tx < 0 || tx >= state.mapWidth) return "unexplored";
  return state.fog[ty][tx];
}
