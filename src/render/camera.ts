// Camera: a world<->screen transform that scrolls and zooms, clamped to the map.
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

  private clampToBounds(): void {
    const viewW = this.viewportW / this.zoom;
    const viewH = this.viewportH / this.zoom;
    // If the world is smaller than the viewport on an axis, center it (negative
    // origin pushes the map inward); otherwise clamp so we can't scroll past an edge.
    this.x =
      this.worldW <= viewW
        ? (this.worldW - viewW) / 2
        : clamp(this.x, 0, this.worldW - viewW);
    this.y =
      this.worldH <= viewH
        ? (this.worldH - viewH) / 2
        : clamp(this.y, 0, this.worldH - viewH);
  }
}
