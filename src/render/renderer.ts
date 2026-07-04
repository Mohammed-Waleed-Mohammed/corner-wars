// Render orchestrator: reads GameState (+ a RenderView for selection/UI overlays) and
// draws. It never mutates state — the update step owns all mutation.

import { BUILDING_STATS, COLORS, GUARD, ownerColor } from "../config/constants";
import type { GameState } from "../core/types";
import { slotWorld } from "../sim/formations";
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
import { drawAIOverlay } from "./draw/aiDebug";
import { drawMinimap } from "./draw/minimap";
import { fogAt } from "../engine/fog";
import { isLowPower } from "../state/gameState";

export function renderGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  view: RenderView,
  alpha = 1,
  minimap?: { ctx: CanvasRenderingContext2D; w: number; h: number } | null, // 21 §J: TACTICAL well canvas
): void {
  drawBackground(ctx, camera, state);
  drawTerrainLayer(ctx, state, camera); // cached offscreen terrain, blitted
  drawGrid(ctx, camera, state);

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

  drawHealBeams(ctx, state, camera, alpha); // §D medic beams, above units

  // Projectiles and combat effects above the units (hidden in fog inside their fns).
  drawProjectiles(ctx, state, camera, alpha);
  drawEffects(ctx, state, camera);

  // Fog overlay over the world; then the buildable-area wash while placing.
  drawFogLayer(ctx, state, camera);
  if (view.placement) drawBuildArea(ctx, state, camera);

  // Guard rings: faint at active guard points, dashed preview while issuing the order (§6).
  for (const gp of view.guardPoints) drawGuardCircle(ctx, camera, gp.x, gp.y, false);
  if (view.guardReticle) drawGuardCircle(ctx, camera, view.guardReticle.x, view.guardReticle.y, true);

  drawFormations(ctx, state, camera, view.formationGroups); // 19: anchor + facing + slot ghosts + banner
  if (view.formationPreview) drawFormationPreview(ctx, camera, view.formationPreview); // 20 §I hover ghost

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
  if (view.aiDebug) drawAIOverlay(ctx, state, camera); // 22 §O (F5, local read-only)

  // 21 §J: the minimap lives in the bottom console's TACTICAL well (its own canvas); without one
  // (headless/tests) it simply isn't drawn.
  if (minimap) drawMinimap(minimap.ctx, state, camera, minimap.w, minimap.h);
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

/** 20 §I hover ghost: faint dashed circles where units would stand + a facing arrow at the anchor. */
function drawFormationPreview(ctx: CanvasRenderingContext2D, camera: Camera, p: { points: { x: number; y: number }[]; anchor: { x: number; y: number }; facing: number }): void {
  ctx.strokeStyle = COLORS.selection;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  for (const pt of p.points) {
    if (!camera.isTileVisible(pt.x, pt.y)) continue;
    const s = camera.tileToScreen(pt.x, pt.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 0.32 * camera.tileScreenSize, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Facing arrow.
  const a = camera.tileToScreen(p.anchor.x, p.anchor.y);
  const tip = camera.tileToScreen(p.anchor.x + Math.cos(p.facing) * 2, p.anchor.y + Math.sin(p.facing) * 2);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  const ang = Math.atan2(tip.y - a.y, tip.x - a.x);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - 8 * Math.cos(ang - 0.4), tip.y - 8 * Math.sin(ang - 0.4));
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - 8 * Math.cos(ang + 0.4), tip.y - 8 * Math.sin(ang + 0.4));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const FORMATION_ICON: Record<string, string> = { spear: "S", line: "L", box: "B", column: "C" };

/** Own formations (19 §J): faint slot ghosts (the intended shape) + facing tick, plus a BANNER at the
 *  anchor — control-group number (or formation letter), an integrity ring (green→amber→red = % of
 *  slots still filled), and a red flash while the formation is "breaking" (>30% lost in 10s). */
function drawFormations(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, groups: Record<number, number>): void {
  for (const f of state.formations) {
    if (f.owner !== state.viewPlayer) continue; // only the local player's own formations
    const a = camera.tileToScreen(f.anchor.x, f.anchor.y);
    // Slot ghosts.
    ctx.fillStyle = ownerColor(f.owner);
    ctx.globalAlpha = 0.2;
    for (const s of f.slots) {
      const w = slotWorld(f.anchor, f.facing, s.dx, s.dy);
      if (!camera.isTileVisible(w.x, w.y)) continue;
      const p = camera.tileToScreen(w.x, w.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.26 * camera.tileScreenSize, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Facing tick (forward = (cos,sin)).
    const fwd = camera.tileToScreen(f.anchor.x + Math.cos(f.facing) * 1.3, f.anchor.y + Math.sin(f.facing) * 1.3);
    ctx.strokeStyle = ownerColor(f.owner);
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(fwd.x, fwd.y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Banner: a small badge above the anchor.
    const by = a.y - 26;
    const rInt = 13;
    const integrity = f.slots.length > 0 ? f.unitIds.length / f.slots.length : 1;
    // Integrity ring (full circle backing + colored arc for the filled fraction).
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath(); ctx.arc(a.x, by, rInt, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = integrity > 0.66 ? COLORS.hpFull : integrity > 0.33 ? "#eab308" : COLORS.hpLow;
    ctx.beginPath(); ctx.arc(a.x, by, rInt, -Math.PI / 2, -Math.PI / 2 + integrity * Math.PI * 2); ctx.stroke();
    // Badge fill (owner color) + breaking flash.
    const flash = f.breaking ? 0.5 + 0.5 * Math.sin(state.time * 12) : 0;
    ctx.beginPath(); ctx.arc(a.x, by, rInt - 3, 0, Math.PI * 2);
    ctx.fillStyle = ownerColor(f.owner); ctx.fill();
    if (flash > 0) { ctx.globalAlpha = flash; ctx.fillStyle = COLORS.hpLow; ctx.fill(); ctx.globalAlpha = 1; }
    // Label: bound control-group number, else the formation letter.
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(groups[f.id] != null ? String(groups[f.id]) : (FORMATION_ICON[f.formationDefId] ?? "?"), a.x, by + 0.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}

/** Field Medic heal beams (19 §D): a soft green pulsing line medic → patient, fog-gated like units. */
function drawHealBeams(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, alpha: number): void {
  const lerp = (e: { x: number; y: number; prevX?: number; prevY?: number }): { x: number; y: number } => ({
    x: (e.prevX ?? e.x) + (e.x - (e.prevX ?? e.x)) * alpha,
    y: (e.prevY ?? e.y) + (e.y - (e.prevY ?? e.y)) * alpha,
  });
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.unitType !== "medic" || e.healTarget == null) continue;
    const target = state.entities.find((t) => t.id === e.healTarget);
    if (!target || target.kind !== "unit" || target.hp <= 0) continue;
    const mp = lerp(e);
    if (!camera.isTileVisible(mp.x, mp.y)) continue;
    if (e.owner !== state.viewPlayer && fogAt(state, Math.floor(mp.x), Math.floor(mp.y)) !== "visible") continue;
    const a = camera.tileToScreen(mp.x, mp.y);
    const tp = lerp(target);
    const b = camera.tileToScreen(tp.x, tp.y);
    const pulse = 0.45 + 0.25 * Math.sin(state.time * 8);
    ctx.strokeStyle = COLORS.hpFull;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // Small cross at the patient end.
    ctx.strokeStyle = COLORS.hpFull;
    ctx.beginPath();
    ctx.moveTo(b.x - 4, b.y);
    ctx.lineTo(b.x + 4, b.y);
    ctx.moveTo(b.x, b.y - 4);
    ctx.lineTo(b.x, b.y + 4);
    ctx.stroke();
  }
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
