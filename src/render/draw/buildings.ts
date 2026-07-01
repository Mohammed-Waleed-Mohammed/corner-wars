// Buildings render as labeled, owner-colored rounded rectangles with a type accent
// and letter so they read at a glance (11-visuals-assets.md). One function; sprites
// can later swap the body without touching game logic.

import {
  BUILDING_ACCENT,
  BUILDING_STATS,
  COLORS,
  ownerColor,
  RENDER,
  UNIT_STATS,
} from "../../config/constants";
import type { Building } from "../../core/types";
import type { Camera } from "../camera";
import { drawHpBar, drawSelectionRect } from "./overlays";
import { roundRectPath } from "./shapes";

export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  b: Building,
  selected: boolean,
  lastKnown = false, // true = shown through fog (explored, not currently visible)
  lowPower = false, // owner is in power deficit (§5): red tint + dim + pulse
  time = 0, // sim time, for the low-power pulse
): void {
  if (b.buildingType === "wall" || b.buildingType === "gate") {
    drawWallOrGate(ctx, camera, b, selected, lastKnown, lowPower, time);
    return;
  }
  const stat = BUILDING_STATS[b.buildingType];
  const tl = camera.tileToScreen(b.x, b.y);
  const w = b.width * camera.tileScreenSize;
  const h = b.height * camera.tileScreenSize;
  const radius = Math.min(6, w * 0.15);
  const underConstruction = b.buildProgress < 1;

  ctx.globalAlpha = underConstruction ? 0.45 : 1;

  // Body.
  roundRectPath(ctx, tl.x, tl.y, w, h, radius);
  ctx.fillStyle = ownerColor(b.owner);
  ctx.fill();

  // Type accent stripe across the top.
  ctx.save();
  roundRectPath(ctx, tl.x, tl.y, w, h, radius);
  ctx.clip();
  ctx.fillStyle = BUILDING_ACCENT[b.buildingType];
  ctx.fillRect(tl.x, tl.y, w, Math.max(3, h * 0.18));
  ctx.restore();

  // Border (thicker for the Construction Yard — it's the base).
  roundRectPath(ctx, tl.x, tl.y, w, h, radius);
  ctx.strokeStyle = b.buildingType === "constructionYard" ? ownerColor(b.owner) : COLORS.outline;
  ctx.lineWidth = b.buildingType === "constructionYard" ? 3 : 1.5;
  ctx.stroke();

  // Letter label.
  if (camera.zoom > 0.45) {
    ctx.fillStyle = COLORS.outline;
    const fontPx = Math.min(w, h) * 0.5;
    ctx.font = `bold ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(stat.letter, tl.x + w / 2, tl.y + h / 2 + h * 0.05);
  }

  ctx.globalAlpha = 1;

  // Low-power overlay over the body (under HUD bars).
  if (lowPower) drawLowPowerTint(ctx, tl.x, tl.y, w, h, radius, time);

  // Under-construction progress bar — only for currently-visible sites. §2a: an explored enemy
  // building shows a static silhouette, never a live-ticking progress bar (that leaks real progress).
  if (underConstruction && !lastKnown) {
    const n = b.activeBuilders ?? 0;
    const pad = 3;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(tl.x + pad, tl.y + h - 7, w - pad * 2, 4);
    ctx.fillStyle = lastKnown ? COLORS.selection : n > 0 ? COLORS.production : COLORS.hpLow;
    ctx.fillRect(tl.x + pad, tl.y + h - 7, (w - pad * 2) * b.buildProgress, 4);
    if (!lastKnown && camera.zoom > 0.4) {
      ctx.fillStyle = n > 0 ? COLORS.production : COLORS.hpLow;
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(n > 0 ? `⚒${n}` : "⏸", tl.x + w - 3, tl.y + 3);
    }
  }

  // Live overlays (HP, production) are hidden through fog — a last-known building shows
  // only its silhouette, not its current state.
  if (lastKnown) {
    if (selected) drawSelectionRect(ctx, tl.x, tl.y, w, h);
    return;
  }

  // Production progress + queue badge (finished, producing buildings).
  if (!underConstruction && b.productionQueue.length > 0) {
    const buildTime = UNIT_STATS[b.productionQueue[0]].buildTime;
    const frac = buildTime > 0 ? Math.min(1, b.productionTimer / buildTime) : 0;
    const pad = 3;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(tl.x + pad, tl.y + h - 7, w - pad * 2, 4);
    ctx.fillStyle = COLORS.production;
    ctx.fillRect(tl.x + pad, tl.y + h - 7, (w - pad * 2) * frac, 4);
    if (camera.zoom > 0.4) {
      ctx.fillStyle = COLORS.production;
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(`×${b.productionQueue.length}`, tl.x + w - 3, tl.y + 3);
    }
  }

  // HP bar (always visible for buildings).
  drawHpBar(ctx, tl.x + w / 2, tl.y - 6, w * 0.9, b.hp / b.maxHp, RENDER.hpBarHeight);

  // Rising-HP indicator while a Worker repairs (16 §7): a pulsing green "+".
  if (b.isRepairing) {
    const pulse = 0.55 + 0.45 * Math.sin(time * 6);
    ctx.fillStyle = `rgba(34,197,94,${pulse})`;
    ctx.font = "bold 14px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+", tl.x + w - 7, tl.y + 8);
  }

  if (selected) drawSelectionRect(ctx, tl.x, tl.y, w, h);
}

/** Red tint + dim + slow pulse marking a building whose owner is in power deficit (§5). */
function drawLowPowerTint(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, time: number,
): void {
  const pulse = 0.5 + 0.5 * Math.sin(time * 4);
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.fillStyle = `rgba(220,38,38,${0.32 + 0.18 * pulse})`; // ~45% red, pulsing
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.34)"; // dim to ~60% brightness
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Walls (solid stone block, owner-tinted cap) and gates (posts + a bar that splits when open). */
function drawWallOrGate(
  ctx: CanvasRenderingContext2D, camera: Camera, b: Building,
  selected: boolean, lastKnown: boolean, lowPower: boolean, time: number,
): void {
  const tl = camera.tileToScreen(b.x, b.y);
  const w = b.width * camera.tileScreenSize;
  const h = b.height * camera.tileScreenSize;
  const col = ownerColor(b.owner);
  const under = b.buildProgress < 1;
  const ix = tl.x + w * 0.08;
  const iy = tl.y + h * 0.08;
  const iw = w * 0.84;
  const ih = h * 0.84;

  ctx.globalAlpha = under ? 0.45 : 1;
  ctx.fillStyle = "#3a3f47"; // stone
  ctx.fillRect(ix, iy, iw, ih);

  if (b.buildingType === "wall") {
    ctx.fillStyle = col; // owner-tinted cap
    ctx.fillRect(ix, iy, iw, ih * 0.22);
  } else {
    ctx.fillStyle = col; // gate posts
    ctx.fillRect(ix, iy, iw * 0.2, ih);
    ctx.fillRect(ix + iw * 0.8, iy, iw * 0.2, ih);
    ctx.strokeStyle = b.gateOpen ? COLORS.hpFull : COLORS.outline; // bar: green split when open
    ctx.lineWidth = Math.max(2, ih * 0.16);
    ctx.beginPath();
    const my = iy + ih * 0.5;
    if (b.gateOpen) {
      ctx.moveTo(ix + iw * 0.2, my); ctx.lineTo(ix + iw * 0.34, my);
      ctx.moveTo(ix + iw * 0.66, my); ctx.lineTo(ix + iw * 0.8, my);
    } else {
      ctx.moveTo(ix + iw * 0.2, my); ctx.lineTo(ix + iw * 0.8, my);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(ix, iy, iw, ih);
  ctx.globalAlpha = 1;

  if (under && !lastKnown) {
    const n = b.activeBuilders ?? 0;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(tl.x + 2, tl.y + h - 5, w - 4, 3);
    ctx.fillStyle = n > 0 ? COLORS.production : COLORS.hpLow;
    ctx.fillRect(tl.x + 2, tl.y + h - 5, (w - 4) * b.buildProgress, 3);
  }
  if (lowPower) drawLowPowerTint(ctx, tl.x, tl.y, w, h, 2, time);

  if (lastKnown) {
    if (selected) drawSelectionRect(ctx, tl.x, tl.y, w, h);
    return;
  }
  if (b.hp < b.maxHp || selected) {
    drawHpBar(ctx, tl.x + w / 2, tl.y - 4, w * 0.85, b.hp / b.maxHp, RENDER.hpBarHeight);
  }
  if (selected) drawSelectionRect(ctx, tl.x, tl.y, w, h);
}
