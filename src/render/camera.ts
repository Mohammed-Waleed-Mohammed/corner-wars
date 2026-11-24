// Camera: a world<->screen transform that scrolls and zooms, clamped to the map plus an overscroll margin.
// `x,y` are the world-pixel coordinates shown at the top-left of the viewport.
// Game logic stays in tiles; helpers convert at the boundary (02-map.md).

import { CAMERA, TILE_SIZE, WORLD } from "../config/constants";
import { clamp } from "../core/math";
import type { Vec2 } from "../core/types";

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  viewportW = 0; // CSS px
  viewportH = 0;
  /** Share of the viewport the view may run past each map edge (02-map); 0 keeps it on the map. */
  overscroll: number = CAMERA.overscroll;
  // World extent in pixels — set per-match from the loaded map (18 §M2: maps vary in size).
  private worldW = WORLD.width;
  private worldH = WORLD.height;

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
    this.clampToBounds();
  }

  /** Set the scroll bounds to the loaded map's dimensions (in tiles). */
  setBounds(mapWidthTiles: number, mapHeightTiles: number): void {
    this.worldW = mapWidthTiles * TILE_SIZE;
    this.worldH = mapHeightTiles * TILE_SIZE;
    this.clampToBounds();
  }

  worldToScreen(wx: number, wy: number): Vec2 {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
  }

  tileToScreen(tx: number, ty: number): Vec2 {
    return this.worldToScreen(tx * TILE_SIZE, ty * TILE_SIZE);
  }

  screenToTile(sx: number, sy: number): Vec2 {
    const w = this.screenToWorld(sx, sy);
    return { x: w.x / TILE_SIZE, y: w.y / TILE_SIZE };
  }

  /** Size of one tile in screen px at the current zoom. */
  get tileScreenSize(): number {
    return TILE_SIZE * this.zoom;
  }

  /** Is the tile point (tx,ty) on screen, within `padTiles` of the viewport edge? (culling) */
  isTileVisible(tx: number, ty: number, padTiles = 2): boolean {
    const s = this.worldToScreen(tx * TILE_SIZE, ty * TILE_SIZE);
    const pad = padTiles * this.tileScreenSize;
    return s.x >= -pad && s.x <= this.viewportW + pad && s.y >= -pad && s.y <= this.viewportH + pad;
  }

  /** Pan by a screen-pixel delta (so feel is constant across zoom levels). */
  panScreen(dxScreen: number, dyScreen: number): void {
    this.x += dxScreen / this.zoom;
    this.y += dyScreen / this.zoom;
    this.clampToBounds();
  }

  /** Zoom toward a screen point so the point under the cursor stays put. */
  zoomAt(factor: number, screenX: number, screenY: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = clamp(this.zoom * factor, CAMERA.minZoom, CAMERA.maxZoom);
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToBounds();
  }

  centerOnTile(tx: number, ty: number): void {
    this.x = tx * TILE_SIZE - this.viewportW / this.zoom / 2;
    this.y = ty * TILE_SIZE - this.viewportH / this.zoom / 2;
    this.clampToBounds();
  }

  /** 02-map: the view may run past each map edge by CAMERA.overscroll of the viewport (0.5 = any edge
   *  or corner can be brought to the screen centre, clear of the HUD panels at the screen's sides). */
  private clampToBounds(): void {
    this.x = clampAxis(this.x, this.worldW, this.viewportW / this.zoom, this.overscroll);
    this.y = clampAxis(this.y, this.worldH, this.viewportH / this.zoom, this.overscroll);
  }
}

/** Clamp one axis of the camera origin; if no position is allowed (no overscroll and the world is
 *  smaller than the view), centre the world instead. */
function clampAxis(pos: number, world: number, view: number, overscroll: number): number {
  const over = view * overscroll;
  const lo = -over, hi = world - view + over;
  return lo <= hi ? clamp(pos, lo, hi) : (world - view) / 2;
}
