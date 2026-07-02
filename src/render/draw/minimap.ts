// Minimap: a fixed bottom-right panel showing the whole map at a glance — gold, the
// Citadel, entities colored by owner, the fog overlay, and the current camera viewport.
// Respects the human's fog (enemy units only while visible; static objects once explored).
// Click/drag it to move the camera (handled in the input controller via minimapRect).

import { COLORS, FOG_ALPHA, RENDER, ownerColor } from "../../config/constants";
import { fogAt } from "../../engine/fog";
import { isLowPower } from "../../state/gameState";
import type { GameState } from "../../core/types";
import type { Camera } from "../camera";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function minimapRect(viewportW: number, viewportH: number): Rect {
  const s = RENDER.minimapSize;
  const m = RENDER.minimapMargin;
  return { x: viewportW - s - m, y: viewportH - s - m, w: s, h: s };
}

export function drawMinimap(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
  const r = minimapRect(camera.viewportW, camera.viewportH);
  const sx = r.w / state.mapWidth;
  const sy = r.h / state.mapHeight;
  const px = (tx: number) => r.x + tx * sx;
  const py = (ty: number) => r.y + ty * sy;
  const fog = (tx: number, ty: number) => fogAt(state, Math.floor(tx), Math.floor(ty));

  ctx.fillStyle = COLORS.uiPanel;
  ctx.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // §5: radar goes dark while the local player is in power deficit — no map, no dots.
  if (isLowPower(state, state.viewPlayer)) {
    ctx.fillStyle = "#0c0e12";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = COLORS.hpLow;
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("RADAR OFFLINE", r.x + r.w / 2, r.y + r.h / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.strokeStyle = COLORS.mapBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();

  // Terrain shading.
  for (let ty = 0; ty < state.mapHeight; ty++) {
    const row = state.terrain[ty];
    for (let tx = 0; tx < state.mapWidth; tx++) {
      const t = row[tx];
      if (t === "ground") continue;
      ctx.fillStyle = t === "mountain" ? COLORS.mountain : t === "water" ? COLORS.water : COLORS.rock;
      ctx.fillRect(px(tx), py(ty), sx + 0.6, sy + 0.6);
    }
  }

  // Gold deposits (once explored).
  ctx.fillStyle = COLORS.neutralGold;
  for (const g of state.goldSources) {
    if (fog(g.x, g.y) !== "unexplored") ctx.fillRect(px(g.x) - 1, py(g.y) - 1, 2, 2);
  }

  // Citadel.
  ctx.fillStyle =
    state.citadel.controllingPlayer === "neutral"
      ? COLORS.citadelNeutral
      : ownerColor(state.citadel.controllingPlayer);
  ctx.fillRect(px(state.citadel.x) - 3, py(state.citadel.y) - 3, 6, 6);

  // Entities: buildings (once explored) as blocks; enemy units only while visible.
  for (const e of state.entities) {
    if (e.kind === "building") {
      if (fog(e.x + e.width / 2, e.y + e.height / 2) === "unexplored") continue;
      ctx.fillStyle = ownerColor(e.owner);
      ctx.fillRect(px(e.x), py(e.y), Math.max(2, e.width * sx), Math.max(2, e.height * sy));
    } else {
      if (e.owner !== state.viewPlayer && fog(e.x, e.y) !== "visible") continue;
      ctx.fillStyle = ownerColor(e.owner);
      ctx.fillRect(px(e.x) - 1, py(e.y) - 1, 2.5, 2.5);
    }
  }

  // Fog overlay (overlap padding only for opaque unexplored, to avoid alpha double-darkening).
  for (let ty = 0; ty < state.mapHeight; ty++) {
    const row = state.fog[ty];
    for (let tx = 0; tx < state.mapWidth; tx++) {
      const st = row[tx];
      if (st === "visible") continue;
      const opaque = st === "unexplored";
      ctx.fillStyle = `rgba(0,0,0,${opaque ? FOG_ALPHA.unexplored : FOG_ALPHA.explored})`;
      ctx.fillRect(px(tx), py(ty), opaque ? sx + 0.6 : sx, opaque ? sy + 0.6 : sy);
    }
  }

  // 19 §J: ping own "breaking" formations — a pulsing red ring at the anchor draws the eye.
  for (const f of state.formations) {
    if (f.owner !== state.viewPlayer || !f.breaking) continue;
    const pulse = 3 + 2 * Math.sin(state.time * 12);
    ctx.strokeStyle = COLORS.hpLow;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px(f.anchor.x), py(f.anchor.y), pulse, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Camera viewport rectangle.
  const tl = camera.screenToTile(0, 0);
  const br = camera.screenToTile(camera.viewportW, camera.viewportH);
  ctx.strokeStyle = COLORS.selection;
  ctx.lineWidth = 1;
  ctx.strokeRect(px(tl.x), py(tl.y), (br.x - tl.x) * sx, (br.y - tl.y) * sy);

  ctx.restore();

  ctx.strokeStyle = COLORS.mapBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
}
