// Short-lived combat effects (§10): muzzle flashes, hit sparks, tracers, death explosions,
// and optional damage numbers. Each fades over its lifetime; carries no game logic.

import { COLORS } from "../../config/constants";
import { fogAt } from "../../engine/fog";
import type { GameState } from "../../core/types";
import type { Camera } from "../camera";

export function drawEffects(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
  const z = camera.zoom;
  for (const e of state.effects) {
    if (!camera.isTileVisible(e.x, e.y)) continue; // cull off-screen
    if (fogAt(state, Math.floor(e.x), Math.floor(e.y)) !== "visible") continue; // hidden in fog
    const f = Math.max(0, 1 - e.age / e.lifetime); // 1 -> 0
    const s = camera.tileToScreen(e.x, e.y);
    switch (e.kind) {
      case "muzzle":
        ctx.fillStyle = COLORS.muzzle;
        ctx.globalAlpha = f;
        ctx.beginPath();
        ctx.arc(s.x, s.y, (3 + 4 * f) * z, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      case "hit":
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = f;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3 * f * z + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      case "tracer": {
        if (e.tx === undefined || e.ty === undefined) break;
        const to = camera.tileToScreen(e.tx, e.ty);
        ctx.strokeStyle = `rgba(255,240,180,${f})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        break;
      }
      case "death": {
        const r = (e.size ?? 0.6) * 16 * (1 - f) * z + 4 * z; // expands as it fades
        ctx.strokeStyle = `rgba(255,140,40,${f})`;
        ctx.lineWidth = 2 * z;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,90,30,${f * 0.5})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "number":
        ctx.fillStyle = `rgba(255,255,255,${f})`;
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(e.value ?? ""), s.x, s.y - (1 - f) * 16 * z);
        break;
    }
  }
}
