// Cached static world layers (15-logic §6). Terrain never changes after generation, and fog
// changes only every ~0.2s, so both are rendered ONCE to offscreen world-resolution canvases
// and then blitted (a single drawImage of the visible region) each frame instead of thousands
// of per-tile fillRects. The fog canvas is rebuilt when state.fogVersion bumps.

import { COLORS, FOG_ALPHA, TILE_SIZE } from "../../config/constants";
import type { GameState, TerrainType } from "../../core/types";
import type { Camera } from "../camera";

const TERRAIN_COLOR: Record<Exclude<TerrainType, "ground">, string> = {
  mountain: COLORS.mountain,
  water: COLORS.water,
  rock: COLORS.rock,
  void: COLORS.void, // 18 §A: rendered as an off-map background tile, not a terrain material
};

let terrainCanvas: HTMLCanvasElement | null = null;
let fogCanvas: HTMLCanvasElement | null = null;
let lastFogVersion = -1;

// Offscreen canvases are sized to the LOADED map (18 §M2: maps vary in size), not a fixed 48×48.
function make(state: GameState): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = state.mapWidth * TILE_SIZE;
  c.height = state.mapHeight * TILE_SIZE;
  return c;
}

export function drawTerrainLayer(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
  if (!terrainCanvas) {
    terrainCanvas = make(state);
    const tc = terrainCanvas.getContext("2d")!;
    for (let ty = 0; ty < state.mapHeight; ty++) {
      const row = state.terrain[ty];
      for (let tx = 0; tx < state.mapWidth; tx++) {
        if (row[tx] === "ground") continue;
        tc.fillStyle = TERRAIN_COLOR[row[tx] as Exclude<TerrainType, "ground">];
        tc.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
  blit(ctx, terrainCanvas, camera);
}

export function drawFogLayer(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
  const version = state.fogVersion ?? 0;
  if (!fogCanvas || lastFogVersion !== version) {
    if (!fogCanvas) fogCanvas = make(state);
    const fc = fogCanvas.getContext("2d")!;
    fc.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
    for (let ty = 0; ty < state.mapHeight; ty++) {
      const row = state.fog[ty];
      for (let tx = 0; tx < state.mapWidth; tx++) {
        const st = row[tx];
        if (st === "visible") continue;
        fc.fillStyle = `rgba(0,0,0,${st === "unexplored" ? FOG_ALPHA.unexplored : FOG_ALPHA.explored})`;
        fc.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    lastFogVersion = version;
  }
  blit(ctx, fogCanvas, camera);
}

/** Blit the visible world region of an offscreen canvas to the viewport (clamped to the map). */
function blit(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, camera: Camera): void {
  const z = camera.zoom;
  let sx = camera.x;
  let sy = camera.y;
  let sw = camera.viewportW / z;
  let sh = camera.viewportH / z;
  let dx = 0;
  let dy = 0;
  let dw = camera.viewportW;
  let dh = camera.viewportH;

  if (sx < 0) { dx += -sx * z; dw -= -sx * z; sw += sx; sx = 0; }
  if (sy < 0) { dy += -sy * z; dh -= -sy * z; sh += sy; sy = 0; }
  if (sx + sw > canvas.width) { const cut = sx + sw - canvas.width; sw -= cut; dw -= cut * z; }
  if (sy + sh > canvas.height) { const cut = sy + sh - canvas.height; sh -= cut; dh -= cut * z; }
  if (sw <= 0 || sh <= 0) return;

  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = prev;
}
