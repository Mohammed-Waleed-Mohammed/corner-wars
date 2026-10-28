// Minimap = the TACTICAL section of the bottom console (21 §J). It renders into a DEDICATED small
// canvas that sits inside the console's inset well (the DOM console would otherwise cover anything
// drawn on the game canvas). Content logic is unchanged from file 15/18/19: terrain, gold, Citadel,
// fog-gated entity dots, breaking-formation pings, camera rectangle. New per §J: a bezel (1px inner
// frame + 4px gold corner ticks) and a low-power state that shows ANIMATED STATIC + a blinking
// RADAR OFFLINE instead of a blank square. Click/drag-to-move stays in the controller via
// minimapRect(), which now reports the well's on-screen rect (set by the HUD each layout change).

import { COLORS, HUD, RENDER, ownerColor } from "../../config/constants";
import { BIOMES, biomeMapColors } from "../../content/biomes";
import { fogAt } from "../../engine/fog";
import { fogTileCanvas } from "./worldLayers";
import { isLowPower } from "../../state/gameState";
import { concealedFrom } from "../../state/terrain";
import type { GameState } from "../../core/types";
import type { Camera } from "../camera";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The TACTICAL well's viewport rect, reported by the HUD (bottom console) whenever layout changes.
// The controller reads it for click/drag hit-testing; before the first report we fall back to the
// legacy bottom-right corner square so nothing breaks headless or mid-boot.
let screenRect: Rect | null = null;

// 30 §D: HUD alerts ping the minimap (tile coords). Render-only state.
const PING_MS = 2400;
let pings: { x: number; y: number; color: string; at: number }[] = [];
export function pingMinimap(x: number, y: number, color: string): void {
  pings.push({ x, y, color, at: performance.now() });
}

export function setMinimapScreenRect(r: Rect | null): void {
  screenRect = r;
}
export function minimapRect(viewportW: number, viewportH: number): Rect {
  if (screenRect) return screenRect;
  const s = RENDER.minimapSize;
  const m = RENDER.minimapMargin;
  return { x: viewportW - s - m, y: viewportH - s - m, w: s, h: s };
}

/** Tiny deterministic PRNG for the radar static (render-only; seeded per animation frame so the
 *  noise dances without touching Math.random or the sim). */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** §C.5/§J bezel: 1px light/dark frame + 4px gold L-ticks at the four corners. */
function drawBezel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.strokeStyle = HUD.BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.strokeStyle = HUD.TRIM_GOLD;
  ctx.lineWidth = 2;
  const t = 4;
  for (const [cx, cy, dx, dy] of [[1, 1, 1, 1], [w - 1, 1, -1, 1], [w - 1, h - 1, -1, -1], [1, h - 1, 1, -1]] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * t, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * t);
    ctx.stroke();
  }
}

// The static terrain picture, drawn once per map / biome / minimap size (31 §D perf: it used to
// be re-filled tile by tile — thousands of fillRects — every frame).
let base: HTMLCanvasElement | null = null;
let baseKey = "";
let baseFor: unknown = null;
function terrainBase(state: GameState, w: number, h: number, dpr: number): HTMLCanvasElement {
  const biome = BIOMES[state.biome] ? state.biome : "verdant";
  const key = `${biome}:${w}x${h}@${dpr}`;
  if (base && baseKey === key && baseFor === state.terrain) return base;
  base ??= document.createElement("canvas");
  base.width = Math.max(1, Math.round(w * dpr));
  base.height = Math.max(1, Math.round(h * dpr));
  const g = base.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sx = w / state.mapWidth, sy = h / state.mapHeight;
  const tileColor = biomeMapColors(biome); // 26: the biome's palette
  g.fillStyle = tileColor.ground;
  g.fillRect(0, 0, w, h);
  // Terrain shading (24 §D: one flat colour per type).
  for (let ty = 0; ty < state.mapHeight; ty++) {
    const row = state.terrain[ty];
    for (let tx = 0; tx < state.mapWidth; tx++) {
      const t = row[tx];
      if (t === "ground") continue;
      g.fillStyle = tileColor[t];
      g.fillRect(tx * sx, ty * sy, sx + 0.6, sy + 0.6);
    }
  }
  baseKey = key;
  baseFor = state.terrain;
  return base;
}

/** Render the minimap into its own canvas context (already DPR-transformed), at 0,0..w,h. */
export function drawMinimap(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, w: number, h: number): void {
  const sx = w / state.mapWidth;
  const sy = h / state.mapHeight;
  const px = (tx: number) => tx * sx;
  const py = (ty: number) => ty * sy;
  const fog = (tx: number, ty: number) => fogAt(state, Math.floor(tx), Math.floor(ty));

  // §J radar offline: animated static + blinking label, never a blank square.
  if (isLowPower(state, state.viewPlayer)) {
    ctx.fillStyle = "#0a0c0f"; // BG_WELL, opaque (own canvas)
    ctx.fillRect(0, 0, w, h);
    const rnd = noise(Math.floor(state.time * 8) * 2654435761 + 1);
    ctx.fillStyle = HUD.TEXT_DIM;
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < 300; i++) {
      const x = rnd() * w, y = rnd() * h, s = 1 + rnd();
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
    if (Math.floor(state.time) % 2 === 0) { // 1s blink
      ctx.fillStyle = HUD.BAD;
      ctx.font = `700 11px ${'"Rajdhani", "Segoe UI", system-ui, sans-serif'}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("RADAR OFFLINE", w / 2, h / 2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    drawBezel(ctx, w, h);
    return;
  }

  ctx.drawImage(terrainBase(state, w, h, ctx.getTransform().a || 1), 0, 0, w, h);

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
      if (concealedFrom(state, state.viewPlayer, e)) continue; // 24 §B forest concealment
      ctx.fillStyle = ownerColor(e.owner);
      ctx.fillRect(px(e.x) - 1, py(e.y) - 1, 2.5, 2.5);
    }
  }

  // Fog overlay: the shared one-pixel-per-tile fog canvas, scaled up (one drawImage).
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fogTileCanvas(state), 0, 0, w, h);
  ctx.imageSmoothingEnabled = smooth;

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

  // 30 §D alert pings: two expanding rings over ~2.4 s (display-only; real time, not sim time).
  const now = performance.now();
  pings = pings.filter((p) => now - p.at < PING_MS);
  for (const p of pings) {
    const k = (now - p.at) / PING_MS;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1.5;
    for (const off of [0, 0.35]) {
      const kk = (k + off) % 1;
      ctx.globalAlpha = 1 - kk;
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), 3 + kk * 14, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Camera viewport rectangle (§J: TEXT at 80% alpha).
  const tl = camera.screenToTile(0, 0);
  const br = camera.screenToTile(camera.viewportW, camera.viewportH);
  ctx.strokeStyle = HUD.TEXT;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1;
  ctx.strokeRect(px(tl.x), py(tl.y), (br.x - tl.x) * sx, (br.y - tl.y) * sy);
  ctx.globalAlpha = 1;

  drawBezel(ctx, w, h);
}
