// Procedural icon system (21 §E) — zero image assets, zero emoji. The HUD's icons ARE the in-world
// draw functions rendered small: unit/building kinds call the SAME drawUnit/drawBuilding the world
// renderer uses (so HUD icons always match what spawns, and stay correct when sprites land later).
// Resource / citadel-power / misc glyphs are drawn here with the §E formulas. Everything is cached
// by (kind,size,color) in offscreen canvases. Read-only w.r.t. the game — icons never touch the sim.

import { BUILDING_STATS, HUD, ownerColor, TILE_SIZE } from "../config/constants";
import type { Building, BuildingType, FormationRole, PlayerId, Unit, UnitType } from "../core/types";
import { Camera } from "../render/camera";
import { drawBuilding } from "../render/draw/buildings";
import { drawUnit } from "../render/draw/units";
import { generateSlots, slotsToIcon } from "../sim/formations";

export type IconKind =
  | UnitType
  | BuildingType
  | "artillery_power" | "reinforcements" | "frenzy" | "repair" | "ion"
  | "gold" | "power" | "energy" | "cap"
  | "citadel" | "flask" | "speaker" | "speakerMuted" | "warning" | "lock" | "check" | "shield" | "speed"
  | `formation:${string}`;

const UNIT_KINDS = new Set<string>(["worker", "rifleman", "rocket", "tank", "grenadier", "scoutBuggy", "heavyTank", "artillery", "medic"]);
const BUILDING_KINDS = new Set<string>([
  "constructionYard", "powerPlant", "refinery", "barracks", "warFactory", "lab", "turret",
  "wall", "gate", "pillbox", "antiArmorCannon", "missileTower",
]);

// NOTE: "artillery" is both a unit and a citadel power — the power uses the key "artillery_power".

// Approximate on-screen px of each unit shape at zoom 1 (draw fns size in px, not tiles).
const UNIT_PX: Record<string, number> = {
  worker: 16, medic: 16, rifleman: 14, rocket: 13, grenadier: 14,
  scoutBuggy: 15, tank: 18, heavyTank: 22, artillery: 18,
};

let iconOwner: PlayerId = 0; // "local player's color unless specified" — set once per match by the HUD
export function setIconOwner(pid: PlayerId): void {
  iconOwner = pid;
  cache.clear(); // palette may differ per match
}

const cache = new Map<string, HTMLCanvasElement>();
const scratchCam = new Camera();

export function renderIcon(kind: IconKind, size: number, color?: string): HTMLCanvasElement {
  const col = color ?? (UNIT_KINDS.has(kind) || BUILDING_KINDS.has(kind) ? ownerColor(iconOwner) : HUD.TEXT);
  const key = `${kind}:${size}:${col}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { draw(ctx, kind, size, col); } catch { /* icon draw must never break the HUD */ }
  }
  cache.set(key, canvas);
  return canvas;
}

function draw(ctx: CanvasRenderingContext2D, kind: IconKind, size: number, col: string): void {
  if (UNIT_KINDS.has(kind)) return drawUnitIcon(ctx, kind as UnitType, size);
  if (BUILDING_KINDS.has(kind)) return drawBuildingIcon(ctx, kind as BuildingType, size);
  if (kind.startsWith("formation:")) return drawFormationIcon(ctx, kind.slice(10), size);

  const s = size;
  const u = s / 100; // §E glyph formulas are on a 0–100 grid
  ctx.lineWidth = Math.max(1.5, s / 12); // ≈2px at 24
  ctx.lineCap = "square";
  ctx.strokeStyle = col;
  ctx.fillStyle = col;

  switch (kind) {
    case "gold": { // filled TRIM_GOLD circle with a darker inner ring
      ctx.fillStyle = HUD.TRIM_GOLD;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#a8871a";
      ctx.lineWidth = Math.max(1, s / 10);
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.26, 0, Math.PI * 2); ctx.stroke();
      return;
    }
    case "power": { // lightning bolt, exact §E points
      ctx.fillStyle = "#facc15";
      const pts = [[55, 5], [25, 55], [45, 55], [40, 95], [75, 40], [52, 40]];
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * u, y * u) : ctx.lineTo(x * u, y * u)));
      ctx.closePath(); ctx.fill();
      return;
    }
    case "frenzy": { // the same bolt tinted BAD
      ctx.fillStyle = HUD.BAD;
      const pts = [[55, 5], [25, 55], [45, 55], [40, 95], [75, 40], [52, 40]];
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * u, y * u) : ctx.lineTo(x * u, y * u)));
      ctx.closePath(); ctx.fill();
      return;
    }
    case "energy": { // 4-point star, ENERGY
      ctx.fillStyle = HUD.ENERGY;
      const c = s / 2, r = s * 0.46, r2 = s * 0.14;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const rad = i % 2 === 0 ? r : r2;
        const a = (Math.PI / 4) * i - Math.PI / 2;
        const x = c + Math.cos(a) * rad, y = c + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      return;
    }
    case "cap": { // three 2px vertical bars, TEXT
      ctx.fillStyle = col;
      const bw = Math.max(2, s / 8);
      for (let i = 0; i < 3; i++) {
        const x = s * 0.25 + i * s * 0.25 - bw / 2;
        const hgt = s * (0.4 + i * 0.18);
        ctx.fillRect(x, s * 0.85 - hgt, bw, hgt);
      }
      return;
    }
    case "artillery_power": { // crosshair: circle + 4 ticks
      const c = s / 2, r = s * 0.32;
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        ctx.beginPath();
        ctx.moveTo(c + dx * (r + s * 0.06), c + dy * (r + s * 0.06));
        ctx.lineTo(c + dx * (r + s * 0.2), c + dy * (r + s * 0.2));
        ctx.stroke();
      }
      return;
    }
    case "reinforcements": { // three small triangles in a row
      ctx.fillStyle = col;
      const tw = s * 0.22, th = s * 0.3, y0 = s * 0.62;
      for (let i = 0; i < 3; i++) {
        const cx = s * 0.22 + i * s * 0.28;
        ctx.beginPath();
        ctx.moveTo(cx, y0 - th);
        ctx.lineTo(cx - tw / 2, y0);
        ctx.lineTo(cx + tw / 2, y0);
        ctx.closePath(); ctx.fill();
      }
      return;
    }
    case "repair": { // plus-cross with squared ends
      const c = s / 2, arm = s * 0.34, t = Math.max(2, s / 6);
      ctx.fillStyle = col;
      ctx.fillRect(c - t / 2, c - arm, t, arm * 2);
      ctx.fillRect(c - arm, c - t / 2, arm * 2, t);
      return;
    }
    case "ion": { // circle with 3 lines converging from above
      const c = s / 2, cy = s * 0.62, r = s * 0.22;
      ctx.beginPath(); ctx.arc(c, cy, r, 0, Math.PI * 2); ctx.stroke();
      for (const dx of [-0.28, 0, 0.28]) {
        ctx.beginPath();
        ctx.moveTo(c + dx * s, s * 0.06);
        ctx.lineTo(c + dx * s * 0.35, cy - r - s * 0.06);
        ctx.stroke();
      }
      return;
    }
    case "citadel": { // hexagon outline (the objective's silhouette)
      const c = s / 2, r = s * 0.4;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
      return;
    }
    case "flask": { // research flask outline
      ctx.beginPath();
      ctx.moveTo(s * 0.42, s * 0.12); ctx.lineTo(s * 0.42, s * 0.4);
      ctx.lineTo(s * 0.2, s * 0.82); ctx.lineTo(s * 0.8, s * 0.82);
      ctx.lineTo(s * 0.58, s * 0.4); ctx.lineTo(s * 0.58, s * 0.12);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.34, s * 0.12); ctx.lineTo(s * 0.66, s * 0.12); ctx.stroke();
      return;
    }
    case "speaker":
    case "speakerMuted": {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(s * 0.14, s * 0.38); ctx.lineTo(s * 0.32, s * 0.38); ctx.lineTo(s * 0.52, s * 0.2);
      ctx.lineTo(s * 0.52, s * 0.8); ctx.lineTo(s * 0.32, s * 0.62); ctx.lineTo(s * 0.14, s * 0.62);
      ctx.closePath(); ctx.fill();
      if (kind === "speaker") {
        ctx.beginPath(); ctx.arc(s * 0.56, s * 0.5, s * 0.18, -Math.PI / 3, Math.PI / 3); ctx.stroke();
        ctx.beginPath(); ctx.arc(s * 0.56, s * 0.5, s * 0.3, -Math.PI / 3, Math.PI / 3); ctx.stroke();
      } else {
        ctx.strokeStyle = HUD.BAD;
        ctx.beginPath(); ctx.moveTo(s * 0.6, s * 0.34); ctx.lineTo(s * 0.86, s * 0.66); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.86, s * 0.34); ctx.lineTo(s * 0.6, s * 0.66); ctx.stroke();
      }
      return;
    }
    case "warning": { // triangle + exclamation
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.12); ctx.lineTo(s * 0.9, s * 0.85); ctx.lineTo(s * 0.1, s * 0.85);
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(s * 0.46, s * 0.36, s * 0.08, s * 0.26);
      ctx.fillRect(s * 0.46, s * 0.68, s * 0.08, s * 0.08);
      return;
    }
    case "lock": {
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(s * 0.5, s * 0.38, s * 0.18, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.42);
      return;
    }
    case "check": {
      ctx.beginPath();
      ctx.moveTo(s * 0.18, s * 0.55); ctx.lineTo(s * 0.42, s * 0.78); ctx.lineTo(s * 0.84, s * 0.24);
      ctx.stroke();
      return;
    }
    case "shield": { // armor: shield outline
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.1);
      ctx.lineTo(s * 0.84, s * 0.24); ctx.lineTo(s * 0.84, s * 0.52);
      ctx.quadraticCurveTo(s * 0.84, s * 0.78, s * 0.5, s * 0.92);
      ctx.quadraticCurveTo(s * 0.16, s * 0.78, s * 0.16, s * 0.52);
      ctx.lineTo(s * 0.16, s * 0.24);
      ctx.closePath(); ctx.stroke();
      return;
    }
    case "speed": { // mobility: double chevrons →
      for (const x0 of [0.18, 0.48]) {
        ctx.beginPath();
        ctx.moveTo(s * x0, s * 0.22);
        ctx.lineTo(s * (x0 + 0.28), s * 0.5);
        ctx.lineTo(s * x0, s * 0.78);
        ctx.stroke();
      }
      return;
    }
  }
}

// ── entity icons: the world draw functions on a scratch camera, centered @80% ──
function drawUnitIcon(ctx: CanvasRenderingContext2D, type: UnitType, size: number): void {
  const fake = {
    id: -1, kind: "unit", owner: iconOwner, x: 0, y: 0, hp: 1, maxHp: 1, sightRadius: 0,
    unitType: type, combatType: undefined, damage: 0, cooldown: 1, attackTimer: 0, range: 0,
    speed: 0, collisionRadius: 0.35, state: "idle", target: null, moveTarget: null, path: [],
  } as unknown as Unit;
  scratchCam.setViewport(size, size);
  scratchCam.zoom = (size * 0.8) / (UNIT_PX[type] ?? 14);
  scratchCam.x = -size / 2 / scratchCam.zoom;
  scratchCam.y = -size / 2 / scratchCam.zoom;
  drawUnit(ctx, scratchCam, fake, false);
}

function drawBuildingIcon(ctx: CanvasRenderingContext2D, type: BuildingType, size: number): void {
  const s = BUILDING_STATS[type];
  const fake = {
    id: -1, kind: "building", owner: iconOwner, x: 0, y: 0, hp: s.hp, maxHp: s.hp, sightRadius: 0,
    buildingType: type, width: s.width, height: s.height, buildProgress: 1,
    productionQueue: [], productionTimer: 0, rallyPoint: null, attackTimer: 0,
  } as unknown as Building;
  scratchCam.setViewport(size, size);
  scratchCam.zoom = (size * 0.8) / (Math.max(s.width, s.height) * TILE_SIZE);
  scratchCam.x = (s.width / 2) * TILE_SIZE - size / 2 / scratchCam.zoom;
  scratchCam.y = (s.height / 2) * TILE_SIZE - size / 2 / scratchCam.zoom;
  drawBuilding(ctx, scratchCam, fake, false, false, false, 0);
}

// ── formation dot-silhouettes (§E): front dots larger; from a representative layout ──
const SAMPLE_COUNTS: Record<FormationRole, number> = { front: 6, flank: 2, rear: 4, artillery: 1, support: 1 };
function drawFormationIcon(ctx: CanvasRenderingContext2D, id: string, size: number): void {
  const pts = slotsToIcon(generateSlots(id, SAMPLE_COUNTS));
  ctx.fillStyle = HUD.TEXT;
  for (const p of pts) {
    const r = (p.role === "front" ? 1.5 : 1.1) * (size / 24);
    ctx.beginPath();
    ctx.arc(size * 0.1 + p.x * size * 0.8, size * 0.1 + p.y * size * 0.8, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
