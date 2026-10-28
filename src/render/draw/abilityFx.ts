// 27 §C/§F — on-map visuals for commander abilities and campaign strikes: Aegis domes, Prism fields,
// Ashstorm clouds, Ghost Roads (owner only), and telegraphed strikes (Hammerfall, the Sundering Hymn,
// shard-fall). Fog-honest: an enemy effect shows only where the local player currently has vision.
// Render-only; reads state, never mutates it.

import { TILE_SIZE } from "../../config/constants";
import type { AbilityField, GameState, PendingStrike } from "../../core/types";
import { fogAt } from "../../engine/fog";
import type { Camera } from "../camera";

const TS = TILE_SIZE;

function visible(state: GameState, x: number, y: number): boolean {
  return fogAt(state, Math.floor(x), Math.floor(y)) === "visible";
}

export function drawAbilityFx(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, timeMs: number): void {
  if (state.fields.length === 0 && state.strikes.length === 0) return;
  const t = timeMs / 1000;
  const me = state.viewPlayer;
  for (const f of state.fields) {
    if (f.kind === "cloak" && f.owner !== me) continue;
    if (f.owner !== me && !visible(state, f.x, f.y)) continue;
    drawField(ctx, state, camera, f, t);
  }
  for (const s of state.strikes) {
    if (s.owner !== me && !visible(state, s.x, s.y)) continue;
    drawStrike(ctx, state, camera, s, t);
  }
}

function drawField(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, f: AbilityField, t: number): void {
  const p = camera.worldToScreen(f.x * TS, f.y * TS);
  const R = f.r * TS * camera.zoom;
  const left = f.until - state.time;
  const fade = Math.max(0, Math.min(1, left / 1.5)); // fade out over the last 1.5 s
  ctx.save();
  ctx.globalAlpha = fade;
  switch (f.kind) {
    case "aegis": {
      const g = ctx.createRadialGradient(p.x, p.y, R * 0.2, p.x, p.y, R);
      g.addColorStop(0, "rgba(120,180,255,0.04)");
      g.addColorStop(0.85, "rgba(120,180,255,0.14)");
      g.addColorStop(1, "rgba(170,210,255,0.28)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(190,220,255,0.8)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.lineDashOffset = -t * 18;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case "prism": {
      ctx.fillStyle = "rgba(60,230,230,0.10)";
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(120,255,240,0.85)";
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 6; k++) {
        const a = t * 0.8 + (k * Math.PI) / 3;
        const x = p.x + Math.cos(a) * R, y = p.y + Math.sin(a) * R, s = 6 * Math.max(0.6, camera.zoom);
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.8, y + s * 0.6); ctx.lineTo(x - s * 0.8, y + s * 0.6); ctx.closePath(); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case "ash": {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, "rgba(40,34,32,0.55)");
      g.addColorStop(0.75, "rgba(54,46,42,0.4)");
      g.addColorStop(1, "rgba(60,50,46,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(150,130,120,0.35)";
      ctx.lineWidth = 3;
      for (let k = 0; k < 5; k++) {
        const a = t * (0.5 + k * 0.07) + k * 1.3, rr = R * (0.35 + k * 0.12);
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, a, a + 1.2); ctx.stroke();
      }
      break;
    }
    case "cloak": {
      ctx.strokeStyle = "rgba(140,230,160,0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 7]);
      ctx.lineDashOffset = t * 10;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function drawStrike(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, s: PendingStrike, t: number): void {
  const p = camera.worldToScreen(s.x * TS, s.y * TS);
  const R = s.r * TS * camera.zoom;
  const total = Math.max(0.01, s.at - s.castAt);
  const prog = Math.max(0, Math.min(1, (state.time - s.castAt) / total)); // 0 → just called, 1 → impact
  const pulse = 0.5 + 0.5 * Math.sin(t * (6 + prog * 14));
  ctx.save();
  if (s.kind === "hymn") {
    ctx.fillStyle = `rgba(190,120,255,${0.08 + 0.22 * prog})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, R * prog, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(220,170,255,${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
  } else {
    const col = s.kind === "shard" ? "200,170,255" : "255,90,60";
    ctx.strokeStyle = `rgba(${col},${0.45 + 0.45 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, R * (1 - prog * 0.85), 0, Math.PI * 2); ctx.stroke();
    const c = R * 0.35;
    ctx.beginPath(); ctx.moveTo(p.x - c, p.y); ctx.lineTo(p.x + c, p.y); ctx.moveTo(p.x, p.y - c); ctx.lineTo(p.x, p.y + c); ctx.stroke();
  }
  ctx.restore();
}
