// Projectile rendering (§9, §15): shells are small fast dots; rockets are short
// owner-colored bodies with a brief flame trail, oriented along their flight.

import { COLORS, ownerColor } from "../../config/constants";
import { fogAt } from "../../engine/fog";
import type { GameState } from "../../core/types";
import type { Camera } from "../camera";

export function drawProjectiles(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, alpha = 1): void {
  const z = camera.zoom;
  for (const p of state.projectiles) {
    const px = (p.prevX ?? p.x) + (p.x - (p.prevX ?? p.x)) * alpha; // interpolate
    const py = (p.prevY ?? p.y) + (p.y - (p.prevY ?? p.y)) * alpha;
    if (!camera.isTileVisible(px, py)) continue; // cull off-screen
    if (fogAt(state, Math.floor(px), Math.floor(py)) !== "visible") continue; // hidden in fog
    const s = camera.tileToScreen(px, py);
    // "bullet" is hitscan-only (§9) — never spawned as a Projectile — so only shell/rocket reach here.
    if (p.kind === "shell" || p.kind === "bullet") {
      ctx.fillStyle = COLORS.shell;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(1.5, 2 * z), 0, Math.PI * 2);
      ctx.fill();
    } else {
      const ang = Math.atan2(p.ty - py, p.tx - px);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(ang);
      ctx.strokeStyle = "rgba(255,176,80,0.55)";
      ctx.lineWidth = 2 * z;
      ctx.beginPath();
      ctx.moveTo(-9 * z, 0);
      ctx.lineTo(-2 * z, 0);
      ctx.stroke();
      ctx.fillStyle = ownerColor(p.owner);
      ctx.fillRect(-2 * z, -1.6 * z, 6 * z, 3.2 * z);
      ctx.restore();
    }
  }
}
