// Neutral world features: gold sources and the Citadel.

import {
  CENTRAL_DEPOSIT_GOLD,
  CITADEL,
  COLORS,
  HOME_MINE_GOLD,
  ownerColor,
} from "../../config/constants";
import { clamp, lerp } from "../../core/math";
import type { Citadel, GoldSource } from "../../core/types";
import type { Camera } from "../camera";
import { hexPath } from "./shapes";

export function drawGoldSource(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  src: GoldSource,
  visible: boolean,
): void {
  const c = camera.tileToScreen(src.x + 0.5, src.y + 0.5);
  const frac = clamp(src.goldRemaining / src.maxGold, 0, 1);
  // Richer deposits read as bigger piles.
  const tier =
    src.maxGold >= CENTRAL_DEPOSIT_GOLD ? 1.35 : src.maxGold >= HOME_MINE_GOLD ? 1.12 : 1.0;
  const baseR = camera.tileScreenSize * 0.5 * tier;
  const r = baseR * lerp(0.55, 1, frac); // pile shrinks as it depletes

  // A small faceted cluster of amber hexagons.
  ctx.fillStyle = COLORS.neutralGold;
  hexPath(ctx, c.x, c.y, r);
  ctx.fill();
  ctx.fillStyle = COLORS.goldShadow;
  hexPath(ctx, c.x - r * 0.55, c.y + r * 0.45, r * 0.55);
  ctx.fill();
  hexPath(ctx, c.x + r * 0.6, c.y + r * 0.35, r * 0.5);
  ctx.fill();

  // Live remaining-gold count only while actually visible (not through fog).
  if (camera.zoom > 0.55 && visible) {
    ctx.fillStyle = COLORS.uiText;
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(String(Math.round(src.goldRemaining)), c.x, c.y - r - 2);
  }
}

export function drawCitadel(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  citadel: Citadel,
): void {
  const c = camera.tileToScreen(citadel.x, citadel.y);
  const r = CITADEL.visualRadius * camera.tileScreenSize;
  const held = citadel.controllingPlayer !== "neutral";
  const fill = held ? ownerColor(citadel.controllingPlayer) : COLORS.citadelNeutral;

  // Energy aura when held.
  if (held) {
    ctx.save();
    ctx.shadowColor = COLORS.citadelEnergy;
    ctx.shadowBlur = 24;
  }

  hexPath(ctx, c.x, c.y, r, false);
  ctx.fillStyle = fill;
  ctx.fill();
  if (held) ctx.restore();

  hexPath(ctx, c.x, c.y, r, false);
  ctx.strokeStyle = COLORS.outlineDeep;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Capture ring: fills clockwise in the capturing player's color (0 -> captureTime).
  if (citadel.capturingPlayer !== null && citadel.capturingPlayer !== "neutral" && citadel.captureTimer > 0) {
    const frac = clamp(citadel.captureTimer / CITADEL.captureTime, 0, 1);
    ctx.strokeStyle = ownerColor(citadel.capturingPlayer);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r + 6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
  }

  if (camera.zoom > 0.5) {
    ctx.fillStyle = COLORS.outlineDeep;
    ctx.font = "bold 12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CITADEL", c.x, c.y);
  }
}
