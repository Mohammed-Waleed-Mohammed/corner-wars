// 22 §O — the F5 AI Commander overlay. Local + read-only: draws each AI's blackboard (personality,
// stance, target, army values, top intents, squad roster) as stacked panels, plus on-map intent
// lines (squad → objective) and the base-plan ghost (perimeter/walls/gates outlines). Only the peer
// that runs the Commander (SP, or the MP host) has blackboards to draw — elsewhere it's a no-op.

import { HUD, UNIT_STATS, ownerColor } from "../../config/constants";
import type { GameState, Unit } from "../../core/types";
import type { Camera } from "../camera";

export function drawAIOverlay(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
  let panelY = 52;
  for (const p of state.players) {
    const cs = p.ai?.commander;
    if (!cs || p.eliminated) continue;
    const col = ownerColor(p.id);

    // ── on-map: base plan ghosts ──
    if (cs.basePlan) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = col;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      for (const w of cs.basePlan.walls) {
        const s = camera.tileToScreen(w.x, w.y);
        ctx.strokeRect(s.x, s.y, camera.zoom * 32, camera.zoom * 32);
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = HUD.TRIM_GOLD;
      for (const g of cs.basePlan.gates) {
        const s = camera.tileToScreen(g.x, g.y);
        ctx.strokeRect(s.x, s.y, camera.zoom * 32, camera.zoom * 32);
      }
      ctx.restore();
    }

    // ── on-map: intent lines (squad center → objective) ──
    for (const s of cs.squads) {
      if (!s.objective || s.unitIds.length === 0) continue;
      let cx = 0, cy = 0, n = 0;
      for (const e of state.entities) {
        if (e.kind === "unit" && e.hp > 0 && s.unitIds.includes(e.id)) { cx += e.x; cy += e.y; n++; }
      }
      if (n === 0) continue;
      const from = camera.tileToScreen(cx / n, cy / n);
      const to = camera.tileToScreen(s.objective.x, s.objective.y);
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = col;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.font = "700 10px Rajdhani, monospace";
      ctx.fillText(`${s.role}:${s.mission}`, to.x + 4, to.y - 4);
      ctx.restore();
    }

    // ── panel ──
    const lines: string[] = [];
    const myArmy = armyOf(state, p.id);
    const tArmy = cs.targetPlayer != null ? armyOf(state, cs.targetPlayer) : 0;
    lines.push(`P${p.id} ${cs.personality.toUpperCase()} · ${cs.stance} → ${cs.targetPlayer != null ? "P" + cs.targetPlayer : "—"}`);
    lines.push(`army ${myArmy | 0} vs ${tArmy | 0} · gold ${p.gold | 0}`);
    for (const it of cs.intents.slice(0, 3)) lines.push(`» ${it}`);
    for (const s of cs.squads) lines.push(`[${s.role}] ${s.unitIds.length}u ${s.formation ?? "-"} ${s.mission}`);

    const w = 240, lh = 13, h = lines.length * lh + 12;
    const x = camera.viewportW - w - 12;
    ctx.save();
    ctx.fillStyle = "rgba(10,12,15,0.85)";
    ctx.fillRect(x, panelY, w, h);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, panelY + 0.5, w - 1, h - 1);
    ctx.fillStyle = HUD.TEXT;
    ctx.font = "700 10px Rajdhani, monospace";
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? col : HUD.TEXT;
      ctx.fillText(l, x + 8, panelY + 14 + i * lh);
    });
    ctx.restore();
    panelY += h + 8;
  }
}

function armyOf(state: GameState, pid: number): number {
  let v = 0;
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.owner !== pid) continue;
    const u = e as Unit;
    if (u.unitType === "worker") continue;
    v += (u.hp / u.maxHp) * UNIT_STATS[u.unitType].gold;
  }
  return v;
}
