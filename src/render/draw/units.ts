// One small draw function per unit type (11-visuals-assets.md): shape = role,
// fill = owner, size = weight. Sprites can later replace each body in place.

import { COLORS, EFFECTS, ownerColor, RENDER } from "../../config/constants";
import type { Unit } from "../../core/types";
import type { Camera } from "../camera";
import { drawHpBar, drawSelectionRing } from "./overlays";

/** Travel/attack facing in radians; defaults to "up" when stationary. */
function facing(u: Unit): number {
  if (u.moveTarget) {
    return Math.atan2(u.moveTarget.y - u.y, u.moveTarget.x - u.x);
  }
  return -Math.PI / 2;
}

export function drawUnit(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  u: Unit,
  selected: boolean,
  rx = u.x, // interpolated render position (fixed-timestep smoothing)
  ry = u.y,
): void {
  // Melee lunge: ease forward then back over the lunge window (§10).
  let dx = rx;
  let dy = ry;
  if (u.attackLungeTimer && u.attackLungeTimer > 0 && u.lungeDx !== undefined) {
    const off = Math.sin((1 - u.attackLungeTimer / EFFECTS.lungeTime) * Math.PI) * EFFECTS.lungeDist;
    dx += u.lungeDx * off;
    dy += (u.lungeDy ?? 0) * off;
  }
  const p = camera.tileToScreen(dx, dy);
  const z = camera.zoom;
  let selectR = RENDER.workerRadius;

  switch (u.unitType) {
    case "worker":
      drawWorker(ctx, p.x, p.y, z, u);
      selectR = RENDER.workerRadius;
      break;
    case "rifleman":
      drawRifleman(ctx, p.x, p.y, z, u);
      selectR = RENDER.riflemanSize * 0.6;
      break;
    case "rocket":
      drawRocket(ctx, p.x, p.y, z, u);
      selectR = RENDER.rocketSize * 0.6;
      break;
    case "tank":
      drawTank(ctx, p.x, p.y, z, u);
      selectR = RENDER.tankSize * 0.6;
      break;
    case "grenadier":
      drawGrenadier(ctx, p.x, p.y, z, u);
      selectR = RENDER.grenadierSize * 0.6;
      break;
    case "scoutBuggy":
      drawScoutBuggy(ctx, p.x, p.y, z, u);
      selectR = RENDER.scoutBuggySize * 0.6;
      break;
    case "heavyTank":
      drawHeavyTank(ctx, p.x, p.y, z, u);
      selectR = RENDER.heavyTankSize * 0.6;
      break;
    case "artillery":
      drawArtillery(ctx, p.x, p.y, z, u);
      selectR = RENDER.artillerySize * 0.6;
      break;
  }

  // White hit-flash when recently struck (§10).
  if (u.hitFlashTimer && u.hitFlashTimer > 0) {
    ctx.globalAlpha = Math.min(1, u.hitFlashTimer / EFFECTS.hitFlashTime) * 0.8;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, (selectR + 1) * z, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (selected) {
    drawSelectionRing(ctx, p.x, p.y, (selectR + RENDER.selectionPadding) * z);
  }

  if (u.hp < u.maxHp || selected) {
    const width = RENDER.tankSize * z;
    drawHpBar(ctx, p.x, p.y - (selectR + 8) * z, width, u.hp / u.maxHp, RENDER.hpBarHeight);
  }
}

function drawWorker(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, u: Unit): void {
  const r = RENDER.workerRadius * z;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = ownerColor(u.owner);
  ctx.fill();
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Amber harvester dot.
  ctx.beginPath();
  ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.neutralGold;
  ctx.fill();
}

function drawRifleman(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, u: Unit): void {
  const s = RENDER.riflemanSize * z;
  withFacing(ctx, x, y, facing(u), () => {
    ctx.beginPath();
    ctx.moveTo(s * 0.6, 0);
    ctx.lineTo(-s * 0.4, s * 0.45);
    ctx.lineTo(-s * 0.4, -s * 0.45);
    ctx.closePath();
    ctx.fillStyle = ownerColor(u.owner);
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

function drawRocket(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, u: Unit): void {
  const s = RENDER.rocketSize * z;
  withFacing(ctx, x, y, facing(u), () => {
    ctx.beginPath();
    ctx.moveTo(s * 0.5, 0);
    ctx.lineTo(0, s * 0.5);
    ctx.lineTo(-s * 0.5, 0);
    ctx.lineTo(0, -s * 0.5);
    ctx.closePath();
    ctx.fillStyle = ownerColor(u.owner);
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Rocket accent line out the front.
    ctx.beginPath();
    ctx.moveTo(s * 0.5, 0);
    ctx.lineTo(s * 0.85, 0);
    ctx.strokeStyle = COLORS.uiText;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

function drawTank(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, u: Unit): void {
  const s = RENDER.tankSize * z;
  withFacing(ctx, x, y, facing(u), () => {
    ctx.fillStyle = ownerColor(u.owner);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    // Barrel out the front.
    ctx.beginPath();
    ctx.moveTo(s * 0.3, 0);
    ctx.lineTo(s * 0.8, 0);
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 3;
    ctx.stroke();
  });
}

// Grenadier: infantry chevron (like a rifleman) with a small dark grenade on top.
function drawGrenadier(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, u: Unit): void {
  const s = RENDER.grenadierSize * z;
  withFacing(ctx, x, y, facing(u), () => {
    ctx.beginPath();
    ctx.moveTo(s * 0.55, 0);
    ctx.lineTo(-s * 0.4, s * 0.5);
    ctx.lineTo(-s * 0.4, -s * 0.5);
    ctx.closePath();
    ctx.fillStyle = ownerColor(u.owner);
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(x, y, RENDER.grenadierSize * 0.22 * z, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.outlineDeep;
  ctx.fill();
}

// Scout Buggy: small, fast wedge with a light dot — reads as a quick vehicle.
function drawScoutBuggy(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, u: Unit): void {
  const s = RENDER.scoutBuggySize * z;
  withFacing(ctx, x, y, facing(u), () => {
    ctx.beginPath();
    ctx.moveTo(s * 0.6, 0);
    ctx.lineTo(-s * 0.5, s * 0.4);
    ctx.lineTo(-s * 0.3, 0);
    ctx.lineTo(-s * 0.5, -s * 0.4);
    ctx.closePath();
    ctx.fillStyle = ownerColor(u.owner);
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

// Heavy Tank: a larger tank body with a thicker barrel and an inner plate.
function drawHeavyTank(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, u: Unit): void {
  const s = RENDER.heavyTankSize * z;
  withFacing(ctx, x, y, facing(u), () => {
    ctx.fillStyle = ownerColor(u.owner);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 2;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.strokeRect(-s * 0.28, -s * 0.28, s * 0.56, s * 0.56); // turret plate
    ctx.beginPath();
    ctx.moveTo(s * 0.25, 0);
    ctx.lineTo(s * 0.95, 0);
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 4;
    ctx.stroke();
  });
}

// Artillery: a small body with a very long barrel — the long-range siege piece.
function drawArtillery(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, u: Unit): void {
  const s = RENDER.artillerySize * z;
  withFacing(ctx, x, y, facing(u), () => {
    ctx.fillStyle = ownerColor(u.owner);
    ctx.fillRect(-s * 0.4, -s * 0.32, s * 0.8, s * 0.64);
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-s * 0.4, -s * 0.32, s * 0.8, s * 0.64);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 1.1, 0); // long barrel
    ctx.strokeStyle = COLORS.outlineDeep;
    ctx.lineWidth = 3;
    ctx.stroke();
  });
}

function withFacing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  draw: () => void,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  draw();
  ctx.restore();
}
