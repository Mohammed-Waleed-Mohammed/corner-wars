// Ground, tile grid, and map border. Sized to the LOADED map (18 §M2), not a fixed 48×48.

import { COLORS, TILE_SIZE } from "../../config/constants";
import { clamp } from "../../core/math";
import type { GameState } from "../../core/types";
import type { Camera } from "../camera";

export function drawBackground(ctx: CanvasRenderingContext2D, camera: Camera, state: GameState): void {
  ctx.fillStyle = COLORS.voidBg;
  ctx.fillRect(0, 0, camera.viewportW, camera.viewportH);

  const tl = camera.worldToScreen(0, 0);
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(tl.x, tl.y, state.mapWidth * TILE_SIZE * camera.zoom, state.mapHeight * TILE_SIZE * camera.zoom);
}

export function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, state: GameState): void {
  const W = camera.viewportW;
  const H = camera.viewportH;
  const tl = camera.screenToTile(0, 0);
  const br = camera.screenToTile(W, H);
  const x0 = clamp(Math.floor(tl.x), 0, state.mapWidth);
  const x1 = clamp(Math.ceil(br.x), 0, state.mapWidth);
  const y0 = clamp(Math.floor(tl.y), 0, state.mapHeight);
  const y1 = clamp(Math.ceil(br.y), 0, state.mapHeight);

  const top = camera.tileToScreen(0, y0).y;
  const bottom = camera.tileToScreen(0, y1).y;
  const left = camera.tileToScreen(x0, 0).x;
  const right = camera.tileToScreen(x1, 0).x;

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = x0; i <= x1; i++) {
    const sx = Math.round(camera.tileToScreen(i, 0).x) + 0.5;
    ctx.moveTo(sx, top);
    ctx.lineTo(sx, bottom);
  }
  for (let j = y0; j <= y1; j++) {
    const sy = Math.round(camera.tileToScreen(0, j).y) + 0.5;
    ctx.moveTo(left, sy);
    ctx.lineTo(right, sy);
  }
  ctx.stroke();

  // Map border.
  const a = camera.worldToScreen(0, 0);
  const b = camera.worldToScreen(state.mapWidth * TILE_SIZE, state.mapHeight * TILE_SIZE);
  ctx.strokeStyle = COLORS.mapBorder;
  ctx.lineWidth = 2;
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
}
