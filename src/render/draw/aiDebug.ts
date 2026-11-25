// 22 §O — the F5 AI Commander overlay. Local + read-only: draws each AI's blackboard (personality,
// stance, target, army values, top intents, squad roster) as stacked panels, plus on-map intent
// lines (squad → objective) and the base-plan ghost (wall ring, gates, planned towers). Only the peer
// that runs the Commander (SP, or the MP host) has blackboards to draw — elsewhere it's a no-op.

import { HUD, UNIT_STATS, ownerColor } from "../../config/constants";
import type { GameState, Unit } from "../../core/types";
import type { Camera } from "../camera";
import { PLANS } from "../../engine/commander/plan";
import { moodLine } from "../../engine/commander/feelings";

export function drawAIOverlay(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, inset?: { top: number; right: number }): void {
  let panelY = inset?.top ?? 52;
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
      const rings = [cs.basePlan, ...(cs.basePlan.layers ?? [])]; // 36 §C outer rings too
      for (const ring of rings) for (const w of ring.walls) {
        const s = camera.tileToScreen(w.x, w.y);
        ctx.strokeRect(s.x, s.y, camera.zoom * 32, camera.zoom * 32);
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = HUD.TRIM_GOLD;
      for (const ring of rings) for (const g of ring.gates) {
        const s = camera.tileToScreen(g.x, g.y);
        ctx.strokeRect(s.x, s.y, camera.zoom * 32, camera.zoom * 32);
      }
      // §G v4 planned towers: a ring at each spot (filled = core, built by every personality)
      ctx.strokeStyle = ctx.fillStyle = col;
      for (const d of cs.basePlan.plannedDefenses) {
        const s = camera.tileToScreen(d.x + 0.5, d.y + 0.5);
        ctx.beginPath();
        ctx.arc(s.x, s.y, camera.zoom * 10, 0, Math.PI * 2);
        if (d.core) ctx.fill(); else ctx.stroke();
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
    lines.push(`P${p.id + 1} ${cs.personality.toUpperCase()} · ${cs.stance} → ${cs.targetPlayer != null ? `P${cs.targetPlayer + 1}` : "—"}`); // players count from 1, as on screen
    lines.push(`army ${myArmy | 0} vs ${tArmy | 0} · gold ${p.gold | 0}`);
    const moodNow = moodLine(cs, state.tick, 1, 3); // 37 the King's feelings
    if (moodNow) lines.push(`♥ ${moodNow}`);
    // 33: what it believes and wants (belief of the target, danger, desired army, income, saving)
    const tb = cs.targetPlayer != null ? cs.beliefs?.enemies[cs.targetPlayer] : undefined;
    lines.push(`belief ${tb ? `${tb.known | 0}/${tb.est | 0}` : "—"} · danger ${(cs.danger ?? 0).toFixed(2)} · want ${(cs.desiredArmy ?? 0) | 0}`);
    lines.push(`income ${(cs.beliefs?.income ?? 0).toFixed(1)}/s${cs.saveKey ? ` · saving ${(cs.saveFor ?? 0) | 0} for ${cs.saveKey}` : ""}${cs.beliefs?.alert ? ` · ALERT ETA ${cs.beliefs.alert.eta | 0}s` : ""}`);
    // 34 §G the council: the plan phase and one line per seat, then the latest rulings that weren't "fund"
    const c = cs.council;
    if (c) {
      const plan = PLANS[cs.personality];
      const ph = c.plan ? plan[Math.min(plan.length - 1, c.plan.phase)].name : "—";
      const spy = cs.targetPlayer != null ? c.reports.spymaster?.enemies[cs.targetPlayer] ?? c.prev.spymaster?.enemies[cs.targetPlayer] : undefined;
      const w = c.reports.warden ?? c.prev.warden;
      const qm = c.reports.quartermaster ?? c.prev.quartermaster;
      const f = c.reports.marshal ?? c.prev.marshal;
      lines.push(`plan ${ph}${c.plan?.pauseStart != null ? " (paused)" : ""} · Spymaster conf ${spy ? spy.conf.toFixed(2) : "—"}${spy && !spy.at ? " (army lost)" : ""}`);
      lines.push(`Warden home ${(w?.home.total ?? 0) | 0} · QM short ${(qm?.shortfall ?? 0) | 0} · Marshal ${f?.mission ?? "—"}${f && f.etaHomeS > 0 && Number.isFinite(f.etaHomeS) ? ` ${f.etaHomeS | 0}s out` : ""}`);
      const ar = c.reports.architect ?? c.prev.architect; // 36 §E
      if (ar) lines.push(`⌂ fort ${ar.fort} · walls ${ar.layers.map((l) => `${l.built}/${l.walls}`).join(" + ") || "—"} · outposts ${ar.outposts}${ar.blockedDoors ? ` · ${ar.blockedDoors} doors blocked` : ""}`);
      for (const r of c.rulings.filter((x) => x.verdict !== "fund").slice(-2)) lines.push(`⚖ ${r.seat} ${r.verdict} ${r.key}: ${r.why}`.slice(0, 64));
    }
    for (const it of cs.intents.slice(0, 3)) lines.push(`» ${it}`);
    for (const s of cs.squads) lines.push(`[${s.role}] ${s.unitIds.length}u ${s.formation ?? "-"} ${s.mission}`);

    const w = 300, lh = 13, h = lines.length * lh + 12;
    const x = camera.viewportW - w - 12 - (inset?.right ?? 0);
    ctx.save();
    ctx.fillStyle = "rgba(10,12,15,0.85)";
    ctx.fillRect(x, panelY, w, h);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, panelY + 0.5, w - 1, h - 1);
    ctx.fillStyle = HUD.TEXT;
    ctx.font = "700 10px Rajdhani, monospace";
    ctx.textAlign = "left"; // earlier draws can leave right/centre alignment behind
    ctx.textBaseline = "alphabetic";
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
