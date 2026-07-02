// Shared overlays: HP bars, selection indicators, drag box, move markers.

import { clamp, lerp } from "../../core/math";
import { COLORS, ownerColor } from "../../config/constants";
import type { Camera } from "../camera";
import type { Owner } from "../../core/types";
import type { MoveMarker } from "../view";

/** Thin HP bar centered horizontally above a point. `frac` is 0..1. */
export function drawHpBar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  topY: number,
  width: number,
  frac: number,
  height: number,
): void {
  const f = clamp(frac, 0, 1);
  const x = cx - width / 2;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - 1, topY - 1, width + 2, height + 2);
  ctx.fillStyle = f > 0.5 ? COLORS.hpFull : COLORS.hpLow;
  ctx.fillRect(x, topY, width * f, height);
}

export function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.strokeStyle = COLORS.selection;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawSelectionRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.strokeStyle = COLORS.selection;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  ctx.setLineDash([]);
}

export function drawDragBox(
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.selection;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
}

/** Expanding, fading ring at the move destination (right-click feedback). */
export function drawMoveMarker(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  m: MoveMarker,
  owner: number,
): void {
  const t = clamp(m.ttl / m.maxTtl, 0, 1); // 1 -> 0 over its life
  const p = camera.tileToScreen(m.x, m.y);
  const r = lerp(2, 14, 1 - t) * camera.zoom;
  ctx.strokeStyle = ownerColor(owner as Owner); // the local player's color (move markers are their orders), palette-aware (§H)
  ctx.globalAlpha = t;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
