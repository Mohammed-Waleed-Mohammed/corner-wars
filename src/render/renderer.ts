// Render orchestrator: reads GameState (+ a RenderView for selection/UI overlays) and
// draws. It never mutates state — the update step owns all mutation.

import { BUILDING_STATS, COLORS, GUARD } from "../config/constants";
import type { GameState } from "../core/types";
import type { Camera } from "./camera";
import type { HoverInfo, PlacementGhost, PowerReticle, RenderView } from "./view";
import { drawBackground, drawGrid } from "./draw/grid";
import { drawTerrainLayer, drawFogLayer } from "./draw/worldLayers";
import { drawBuilding } from "./draw/buildings";
import { drawUnit } from "./draw/units";
import { drawCitadel, drawGoldSource } from "./draw/world";
import { drawDragBox, drawMoveMarker } from "./draw/overlays";
import { drawProjectiles } from "./draw/projectiles";
import { drawEffects } from "./draw/effects";
import { drawBuildArea } from "./draw/fog";
import { drawMinimap } from "./draw/minimap";
import { fogAt } from "../engine/fog";
import { isLowPower } from "../state/gameState";

export function renderGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  view: RenderView,
  alpha = 1,
): void {
  drawBackground(ctx, camera);
  drawTerrainLayer(ctx, state, camera); // cached offscreen terrain, blitted
  drawGrid(ctx, camera);

  // Ground decals: destination markers + player movement lines under everything else.
  for (const m of view.moveMarkers) drawMoveMarker(ctx, camera, m, state.viewPlayer);
  drawCommandMarkers(ctx, state, camera, view);

  // Gold deposits + Citadel are static landmarks: shown once explored (live count only when visible).
  for (const src of state.goldSources) {
    if (!camera.isTileVisible(src.x, src.y)) continue;
    const f = fogAt(state, Math.floor(src.x), Math.floor(src.y));
    if (f !== "unexplored") drawGoldSource(ctx, camera, src, f === "visible");
  }
  drawCitadel(ctx, camera, state.citadel); // always visible — the central objective

  // Buildings (incl. enemies) show as last-known once explored; enemy UNITS only while
  // currently visible. The human's own units always draw. Off-screen entities are culled.
  for (const e of state.entities) {
    if (e.kind !== "building") continue;
    if (!camera.isTileVisible(e.x + e.width / 2, e.y + e.height / 2, 3)) continue;
    const f = fogAt(state, Math.floor(e.x + e.width / 2), Math.floor(e.y + e.height / 2));
    if (f === "unexplored") continue;
    const visible = f === "visible";
    const low = visible && e.owner !== "neutral" && isLowPower(state, e.owner); // §5 red tint when visible
    drawBuilding(ctx, camera, e, view.selectedIds.has(e.id), !visible, low, state.time);
  }
  for (const e of state.entities) {
    if (e.kind !== "unit") continue;
    // Interpolate position between sim steps for smooth motion.
    const rx = (e.prevX ?? e.x) + (e.x - (e.prevX ?? e.x)) * alpha;
    const ry = (e.prevY ?? e.y) + (e.y - (e.prevY ?? e.y)) * alpha;
    if (!camera.isTileVisible(rx, ry)) continue;
    if (e.owner !== state.viewPlayer && fogAt(state, Math.floor(rx), Math.floor(ry)) !== "visible") continue;
    drawUnit(ctx, camera, e, view.selectedIds.has(e.id), rx, ry);
  }

  // Projectiles and combat effects above the units (hidden in fog inside their fns).
  drawProjectiles(ctx, state, camera, alpha);
  drawEffects(ctx, state, camera);

  // Fog overlay over the world; then the buildable-area wash while placing.
  drawFogLayer(ctx, state, camera);
  if (view.placement) drawBuildArea(ctx, state, camera);

  // Guard rings: faint at active guard points, dashed preview while issuing the order (§6).
  for (const gp of view.guardPoints) drawGuardCircle(ctx, camera, gp.x, gp.y, false);
  if (view.guardReticle) drawGuardCircle(ctx, camera, view.guardReticle.x, view.guardReticle.y, true);

  // Hover glow around the thing under the cursor (§10).
  if (view.hover.glow) drawHoverGlow(ctx, camera, view.hover.glow);

  // Drag-to-build wall preview (§1): green valid+affordable, red otherwise.
  if (view.buildDrag) {
    const sz = camera.tileScreenSize;
    for (const seg of view.buildDrag) {
      const tl = camera.tileToScreen(seg.x, seg.y);
      ctx.fillStyle = seg.valid ? "rgba(34,197,94,0.32)" : "rgba(239,68,68,0.32)";
      ctx.fillRect(tl.x, tl.y, sz, sz);
      ctx.strokeStyle = seg.valid ? COLORS.hpFull : COLORS.hpLow;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tl.x, tl.y, sz, sz);
    }
  }

  // Placement ghost, power reticle, and the selection box, on top.
  if (view.placement) drawPlacementGhost(ctx, camera, view.placement);
  if (view.powerTarget) drawPowerReticle(ctx, camera, view.powerTarget);
  if (view.dragBox) drawDragBox(ctx, view.dragBox.start, view.dragBox.end);

  // Minimap last, anchored to the screen corner.
  drawMinimap(ctx, state, camera);
}

/** §3: player move (white) / attack-move (red) lines from each ordered unit to the destination,
 *  fading over ~1.5s. Large groups collapse to a single centroid line to avoid clutter. */
function drawCommandMarkers(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, view: RenderView): void {
  for (const m of view.commandMarkers) {
    const alpha = Math.max(0, 1 - m.age / m.lifetime);
    if (alpha <= 0) continue;
    ctx.strokeStyle = m.kind === "attackMove" ? `rgba(239,68,68,${alpha})` : `rgba(226,232,240,${alpha * 0.9})`;
    ctx.lineWidth = 1.5;
    const to = camera.tileToScreen(m.to.x, m.to.y);
    const units = m.unitIds
      .map((id) => state.entities.find((e) => e.id === id && e.kind === "unit"))
      .filter((e): e is NonNullable<typeof e> => !!e);
    if (units.length === 0) continue;
    if (units.length > 12) {
      let cx = 0;
      let cy = 0;
      for (const u of units) { cx += u.x; cy += u.y; }
      const from = camera.tileToScreen(cx / units.length, cy / units.length);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else {
      for (const u of units) {
        const from = camera.tileToScreen(u.x, u.y);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(to.x, to.y, 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawGuardCircle(ctx: CanvasRenderingContext2D, camera: Camera, tx: number, ty: number, preview: boolean): void {
  const c = camera.tileToScreen(tx, ty);
  const r = GUARD.radius * camera.tileScreenSize;
  ctx.strokeStyle = preview ? "rgba(96,165,250,0.9)" : "rgba(96,165,250,0.3)";
  ctx.lineWidth = preview ? 2 : 1.5;
  ctx.setLineDash(preview ? [6, 5] : []);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (preview) {
    ctx.beginPath();
    ctx.moveTo(c.x - 7, c.y);
    ctx.lineTo(c.x + 7, c.y);
    ctx.moveTo(c.x, c.y - 7);
    ctx.lineTo(c.x, c.y + 7);
    ctx.stroke();
  }
}

function drawHoverGlow(ctx: CanvasRenderingContext2D, camera: Camera, glow: NonNullable<HoverInfo["glow"]>): void {
  const c = camera.tileToScreen(glow.x, glow.y);
  ctx.strokeStyle = glow.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c.x, c.y, glow.r * camera.tileScreenSize, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPowerReticle(ctx: CanvasRenderingContext2D, camera: Camera, r: PowerReticle): void {
  const c = camera.tileToScreen(r.x, r.y);
  const rad = r.radius * camera.tileScreenSize;
  ctx.fillStyle = COLORS.citadelEnergy;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COLORS.citadelEnergy;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // Crosshair.
  ctx.beginPath();
  ctx.moveTo(c.x - 7, c.y);
  ctx.lineTo(c.x + 7, c.y);
  ctx.moveTo(c.x, c.y - 7);
  ctx.lineTo(c.x, c.y + 7);
  ctx.stroke();
}

function drawPlacementGhost(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  g: PlacementGhost,
): void {
  const tl = camera.tileToScreen(g.x, g.y);
  const w = g.w * camera.tileScreenSize;
  const h = g.h * camera.tileScreenSize;
  const color = g.valid ? COLORS.hpFull : COLORS.hpLow;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(tl.x, tl.y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(tl.x, tl.y, w, h);

  if (camera.zoom > 0.45) {
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.min(w, h) * 0.4}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(BUILDING_STATS[g.type].letter, tl.x + w / 2, tl.y + h / 2);
  }
}
