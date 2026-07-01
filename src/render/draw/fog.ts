// Build-placement area highlight (§7). Draws per visible-camera tile only, so cost scales
// with the viewport. (The fog overlay itself now lives in the cached worldLayers offscreen.)

import { COLORS } from "../../config/constants";
import { clamp } from "../../core/math";
import { withinBuildRadius } from "../../engine/placement";
import type { GameState } from "../../core/types";
import type { Camera } from "../camera";

/** Faint green wash over tiles where the human may place a building (within build radius). */
export function drawBuildArea(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
  const tl = camera.screenToTile(0, 0);
  const br = camera.screenToTile(camera.viewportW, camera.viewportH);
  const x0 = clamp(Math.floor(tl.x), 0, state.mapWidth - 1);
  const x1 = clamp(Math.ceil(br.x), 0, state.mapWidth - 1);
  const y0 = clamp(Math.floor(tl.y), 0, state.mapHeight - 1);
  const y1 = clamp(Math.ceil(br.y), 0, state.mapHeight - 1);
  const size = camera.tileScreenSize + 1;
  ctx.fillStyle = COLORS.validPlace;
  ctx.globalAlpha = 0.12;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (withinBuildRadius(state, 0, tx, ty, 1, 1)) {
        const p = camera.tileToScreen(tx, ty);
        ctx.fillRect(p.x, p.y, size, size);
      }
    }
  }
  ctx.globalAlpha = 1;
}
