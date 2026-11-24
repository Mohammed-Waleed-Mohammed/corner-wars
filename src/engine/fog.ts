// Fog of war (§11), for the LOCAL player (state.viewPlayer). AI players have their own fog with the
// same rules, kept AI-side (engine/aiPerception.ts, 22 §C v3). Three states per tile: unexplored (never seen) -> explored (seen before; static
// objects shown dimmed, but not live enemy positions) -> visible (currently in a friendly sight
// radius). Recomputed on a slow timer for performance, not every frame. Fog is cosmetic/local — it
// is NOT hashed by the checksum, so computing it per-peer-perspective doesn't affect determinism.
//
// 35 spectator mode: with `state.observer` set, every player's grid is recomputed side by side (so
// each keeps its explored memory) and `state.fog` shows the chosen POV — or the whole map for "All".

import { FOG_UPDATE_INTERVAL } from "../config/constants";
import type { AnyEntity, FogState, GameState, PlayerId } from "../core/types";
import { concealedFrom, sightOf } from "../state/terrain";

export function updateFog(state: GameState, dt: number): void {
  state.fogTimer = (state.fogTimer ?? 0) + dt;
  if (state.fogTimer < FOG_UPDATE_INTERVAL) return;
  state.fogTimer = 0;
  state.fogVersion = (state.fogVersion ?? 0) + 1; // invalidate the render-side fog cache

  if (state.observer) {
    updateObserverFog(state);
    return;
  }

  // 22 §W3: an eliminated local player SPECTATES with full map vision. Fog is local-only (never
  // hashed), so this may differ per client without touching determinism.
  if (state.players[state.viewPlayer]?.eliminated) {
    for (const row of state.fog) row.fill("visible");
    return;
  }
  lightGrid(state, state.fog, state.viewPlayer);
}

/** Everything visible in `grid` drops to explored; `pid`'s sight then re-lights what's in range. */
function lightGrid(state: GameState, grid: FogState[][], pid: PlayerId): void {
  for (let y = 0; y < state.mapHeight; y++) {
    const row = grid[y];
    for (let x = 0; x < state.mapWidth; x++) {
      if (row[x] === "visible") row[x] = "explored";
    }
  }
  for (const e of state.entities) {
    if (e.owner !== pid || e.hp <= 0) continue;
    const cx = e.kind === "building" ? e.x + e.width / 2 : e.x;
    const cy = e.kind === "building" ? e.y + e.height / 2 : e.y;
    reveal(state, grid, cx, cy, sightOf(state, e)); // 24 §B: +2 from high ground
  }
}

function reveal(state: GameState, grid: FogState[][], cx: number, cy: number, r: number): void {
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(state.mapWidth - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(state.mapHeight - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) grid[y][x] = "visible";
    }
  }
}

// ── 35 spectator mode ─────────────────────────────────────────────────────────

/** Turn on observer fog: one unexplored grid per player, starting on the whole-map view. */
export function enableObserverFog(state: GameState): void {
  const blank = (): FogState[][] => Array.from({ length: state.mapHeight }, () => new Array<FogState>(state.mapWidth).fill("unexplored"));
  state.observer = { pov: null, grids: state.players.map(() => blank()) };
  refreshFog(state);
}

/** Switch the observer's POV (null = the whole map) and redraw the fog at once, even while paused.
 *  A player POV also becomes `viewPlayer`, so its own cues (unit ready, low power) are the ones heard. */
export function setObserverPov(state: GameState, pov: PlayerId | null): void {
  if (!state.observer) return;
  state.observer.pov = pov;
  if (pov !== null) state.viewPlayer = pov;
  refreshFog(state);
}

/** Recompute the fog now instead of on the next timer beat. */
export function refreshFog(state: GameState): void {
  state.fogTimer = FOG_UPDATE_INTERVAL;
  updateFog(state, 0);
}

function updateObserverFog(state: GameState): void {
  const obs = state.observer!;
  for (const p of state.players) {
    const grid = obs.grids[p.id];
    if (grid && !p.eliminated) lightGrid(state, grid, p.id);
  }
  const pov = obs.pov;
  // "All", or a beaten player (no sight of their own left): the whole map, as 22 §W3 does.
  if (pov === null || state.players[pov]?.eliminated) {
    for (const row of state.fog) row.fill("visible");
    return;
  }
  const src = obs.grids[pov];
  for (let y = 0; y < state.mapHeight; y++) {
    const from = src[y], to = state.fog[y];
    for (let x = 0; x < state.mapWidth; x++) to[x] = from[x];
  }
}

/** Render-side forest/cloak concealment from the current view: the observer's "All" view sees
 *  everything; otherwise the rules of whoever `viewPlayer` is (24 §B). */
export function concealedFromView(state: GameState, e: AnyEntity): boolean {
  if (state.observer && state.observer.pov === null) return false;
  return concealedFrom(state, state.viewPlayer, e);
}

export function fogAt(state: GameState, tx: number, ty: number): FogState {
  if (ty < 0 || ty >= state.mapHeight || tx < 0 || tx >= state.mapWidth) return "unexplored";
  return state.fog[ty][tx];
}
