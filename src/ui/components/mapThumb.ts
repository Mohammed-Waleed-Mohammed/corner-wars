// Shared map thumbnail renderer (18 §D, reused by 20 §E). Draws a minimap-style preview of a GameMap
// — terrain colors, gold-mine dots, start-slot markers, Citadel icon — into any canvas. Used by the
// map browser cards + details strip, the lobby, and (later) the editor. Pure canvas, no state.

import { COLORS } from "../../config/constants";
import type { GameMap } from "../../core/types";

export function drawMapThumb(canvas: HTMLCanvasElement, map: GameMap): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const sx = W / map.width, sy = H / map.height;
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.terrain[y][x];
      if (t === "ground") continue;
      ctx.fillStyle = t === "mountain" ? COLORS.mountain : t === "water" ? COLORS.water : t === "rock" ? COLORS.rock : COLORS.void;
      ctx.fillRect(x * sx, y * sy, sx + 0.6, sy + 0.6);
    }
  }
  ctx.fillStyle = COLORS.neutralGold;
  const mineR = Math.max(1.4, Math.min(sx, sy) * 0.9);
  for (const g of map.goldMines) ctx.fillRect(g.x * sx - mineR / 2, g.y * sy - mineR / 2, mineR, mineR);
  if (map.citadel) {
    ctx.fillStyle = COLORS.citadelNeutral;
    const r = Math.max(2, Math.min(sx, sy) * 1.3);
    ctx.fillRect(map.citadel.x * sx - r / 2, map.citadel.y * sy - r / 2, r, r);
  }
  for (const p of map.startPositions) {
    ctx.fillStyle = COLORS.players[p.slot] ?? "#fff";
    ctx.beginPath();
    ctx.arc(p.x * sx, p.y * sy, Math.max(2, Math.min(sx, sy) * 1.2), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
