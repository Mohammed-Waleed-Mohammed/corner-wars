// 27 §H — procedural faction units, seen from straight above, FACING UP (front toward the top edge;
// the game rotates them). These are the Art Lab's unit guides; in game, units keep their readable
// role shapes until real art exists (detail at 18–40 px would just blur).

import { UNIT_ART } from "../../content/factionArt";
import type { FactionId, UnitType } from "../../core/types";
import { banner, barrel, block, crystals, disc, emblem, hex, look, rgba, rust, shade, spikes, stripe, type G } from "./factionKit";

// ── infantry ────────────────────────────────────────────────────────────────────────────────────

/** One soldier at (cx, cy), shoulder width W, facing up: pack/cloak, shoulders, pauldrons, then
 *  `held` (weapon + arms), then the head on top. */
function soldier(g: G, f: FactionId, cx: number, cy: number, W: number, held: () => void): void {
  const P = look(f).palette;
  const body = f === "concord" ? P.mid : f === "halcyon" ? P.base : f === "cantons" ? P.base : P.base;
  // Pack / cloak behind (below) the shoulders.
  if (f === "choir") { // hooded robe trailing behind
    g.fillStyle = shade(P.base, 0.85);
    g.beginPath(); g.moveTo(cx - W * 0.42, cy); g.quadraticCurveTo(cx, cy + W * 0.95, cx + W * 0.42, cy); g.closePath(); g.fill();
    g.strokeStyle = P.dark; g.lineWidth = Math.max(1, W * 0.04); g.stroke();
  } else {
    block(g, f === "cantons" ? "cantons" : "halcyon", cx - W * 0.24, cy + W * 0.05, W * 0.48, W * 0.36, f === "cantons" ? "#7a6a44" : shade(P.dark, 1.6), 3);
    if (f === "cantons") { g.fillStyle = "#4a5a34"; g.fillRect(cx - W * 0.3, cy + W * 0.36, W * 0.6, W * 0.1); } // bedroll
  }
  // Shoulders.
  g.fillStyle = body;
  g.beginPath(); g.ellipse(cx, cy, W * 0.5, W * 0.26, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = P.dark; g.lineWidth = Math.max(1, W * 0.05); g.stroke();
  // Pauldrons.
  const pad = f === "concord" ? P.base : f === "halcyon" ? P.mid : f === "cantons" ? shade(P.base, 1.15) : "#2a1a1c";
  disc(g, cx - W * 0.36, cy - W * 0.02, W * 0.16, pad, P.dark);
  disc(g, cx + W * 0.36, cy - W * 0.02, W * 0.16, pad, P.dark);
  if (f === "halcyon") { g.strokeStyle = P.accent; g.lineWidth = Math.max(1, W * 0.04); g.beginPath(); g.arc(cx + W * 0.36, cy - W * 0.02, W * 0.12, Math.PI, Math.PI * 1.8); g.stroke(); }
  if (f === "concord" || f === "cantons") stripe(g, f, cx + W * 0.26, cy - W * 0.08, W * 0.2, W * 0.06);
  held();
  // Head (helmet / cap / hood), always on top.
  const helm = f === "concord" ? P.base : f === "halcyon" ? "#3a3a42" : f === "cantons" ? "#5a6038" : shade(P.base, 0.9);
  if (f === "choir") { // hood point trailing back
    g.fillStyle = shade(P.base, 0.75); g.beginPath(); g.moveTo(cx - W * 0.15, cy); g.lineTo(cx, cy + W * 0.28); g.lineTo(cx + W * 0.15, cy); g.closePath(); g.fill();
  }
  disc(g, cx, cy - W * 0.04, W * 0.17, helm, P.dark);
  g.fillStyle = "rgba(255,255,255,0.22)"; g.beginPath(); g.arc(cx - W * 0.05, cy - W * 0.09, W * 0.07, 0, Math.PI * 2); g.fill(); // top-left highlight
  if (f === "halcyon") { g.fillStyle = rgba(P.accent, 0.9); g.fillRect(cx - W * 0.11, cy - W * 0.17, W * 0.22, W * 0.05); } // visor
  if (f === "concord") { g.fillStyle = P.accent; g.fillRect(cx - W * 0.02, cy - W * 0.2, W * 0.04, W * 0.14); } // crest stripe
  if (f === "cantons") { g.fillStyle = "#4a5030"; g.beginPath(); g.ellipse(cx, cy - W * 0.18, W * 0.15, W * 0.07, 0, 0, Math.PI * 2); g.fill(); } // cap brim
  if (f === "choir") { g.fillStyle = "#8a6cf0"; g.beginPath(); g.arc(cx, cy - W * 0.24, W * 0.05, 0, Math.PI * 2); g.fill(); } // crystal pendant
}

/** Both arms reaching forward to a held item at (tx, ty) (sleeves in the uniform colour). */
function arms(g: G, f: FactionId, cx: number, cy: number, W: number, tx: number, ty: number): void {
  const P = look(f).palette, sleeve = f === "concord" ? P.mid : f === "choir" ? shade(P.base, 0.9) : P.base;
  g.lineCap = "round";
  for (const [sx, ex, ey] of [[-0.36, tx - W * 0.04, ty + W * 0.22], [0.36, tx + W * 0.02, ty + W * 0.04]] as const) {
    g.strokeStyle = P.dark; g.lineWidth = W * 0.2;
    g.beginPath(); g.moveTo(cx + sx * W, cy); g.lineTo(ex, ey); g.stroke();
    g.strokeStyle = sleeve; g.lineWidth = W * 0.13;
    g.beginPath(); g.moveTo(cx + sx * W, cy); g.lineTo(ex, ey); g.stroke();
    disc(g, ex, ey, W * 0.07, f === "halcyon" ? "#2a2a30" : "#3a3028", "#0a0a0a"); // glove
  }
}

function infantry(g: G, f: FactionId, type: UnitType, S: number): void {
  const P = look(f).palette, cx = S / 2, cy = S * 0.55, W = S * 0.42;
  const gunTone = shade(P.dark, 1.25);
  const gx = cx + W * 0.16; // the weapon line, held off the right shoulder
  soldier(g, f, cx, cy, W, () => {
    switch (type) {
      case "rifleman":
        barrel(g, gx, cy + W * 0.12, gx, cy - W * 0.68, W * 0.09, gunTone, "#0a0a0a");
        arms(g, f, cx, cy, W, gx, cy - W * 0.34);
        break;
      case "grenadier":
        g.fillStyle = "#6a6a3e"; // grenade bandolier across the chest
        for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(cx - W * 0.38 + k * W * 0.17, cy - W * 0.14 + k * W * 0.07, W * 0.055, 0, Math.PI * 2); g.fill(); }
        barrel(g, gx, cy + W * 0.06, gx, cy - W * 0.56, W * 0.19, gunTone, "#0a0a0a");
        disc(g, gx, cy - W * 0.56, W * 0.07, "#1a1a1a", "#000000"); // wide muzzle
        arms(g, f, cx, cy, W, gx, cy - W * 0.28);
        break;
      case "rocket":
        barrel(g, cx + W * 0.3, cy + W * 0.42, cx + W * 0.3, cy - W * 0.74, W * 0.17, f === "halcyon" ? "#3a3a42" : f === "cantons" ? "#5a6038" : f === "choir" ? "#3a1a1e" : "#8a96a6", "#0a0a0a");
        disc(g, cx + W * 0.3, cy - W * 0.74, W * 0.1, "#c84a3a", "#0a0a0a"); // warhead
        arms(g, f, cx, cy, W, cx + W * 0.3, cy - W * 0.22);
        break;
      case "medic":
        g.fillStyle = "#e8e4dc"; // pale cross on the medical pack
        g.fillRect(cx - W * 0.05, cy + W * 0.16, W * 0.1, W * 0.22); g.fillRect(cx - W * 0.12, cy + W * 0.22, W * 0.24, W * 0.09);
        block(g, "halcyon", cx - W * 0.18, cy - W * 0.6, W * 0.36, W * 0.22, "#d8d8d0", 4); // med-kit carried forward
        g.fillStyle = "#b8202c"; g.fillRect(cx - W * 0.03, cy - W * 0.57, W * 0.06, W * 0.16); g.fillRect(cx - W * 0.08, cy - W * 0.52, W * 0.16, W * 0.06);
        arms(g, f, cx, cy, W, cx, cy - W * 0.38);
        break;
      case "worker":
        g.fillStyle = "#e8c040"; g.fillRect(cx - W * 0.3, cy + W * 0.12, W * 0.6, W * 0.07); // hi-vis strip
        barrel(g, gx, cy + W * 0.05, gx, cy - W * 0.6, W * 0.08, "#7a5a3a", "#2a1a10"); // tool handle
        block(g, "concord", gx - W * 0.2, cy - W * 0.74, W * 0.4, W * 0.15, "#9aa0a6", 5); // pick / wrench head
        arms(g, f, cx, cy, W, gx, cy - W * 0.3);
        break;
      default: break;
    }
  });
}

// ── vehicles ────────────────────────────────────────────────────────────────────────────────────

function tracks(g: G, f: FactionId, x: number, y: number, w: number, h: number): void {
  const P = look(f).palette;
  g.fillStyle = shade(P.dark, 0.9); g.fillRect(x, y, w, h);
  g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 1;
  for (let k = 1; k < 10; k++) { g.beginPath(); g.moveTo(x, y + (h * k) / 10); g.lineTo(x + w, y + (h * k) / 10); g.stroke(); }
  g.strokeStyle = "#000000"; g.lineWidth = Math.max(1, w * 0.08); g.strokeRect(x, y, w, h);
}

function hullFlair(g: G, f: FactionId, x: number, y: number, w: number, h: number, seed: number): void {
  const P = look(f).palette, u = Math.min(w, h);
  switch (f) {
    case "concord": stripe(g, f, x + w * 0.12, y + h * 0.82, w * 0.76, Math.max(2, u * 0.06)); emblem(g, f, x + w * 0.5, y + h * 0.68, u * 0.26); break;
    case "halcyon":
      g.strokeStyle = P.accent; g.lineWidth = Math.max(1, u * 0.035);
      g.beginPath(); g.moveTo(x + w * 0.14, y + h * 0.86); g.lineTo(x + w * 0.86, y + h * 0.86); g.stroke();
      hex(g, x + w * 0.22, y + h * 0.7, u * 0.08, "#1c1c22", P.accent); hex(g, x + w * 0.78, y + h * 0.7, u * 0.08, "#1c1c22", P.accent);
      break;
    case "cantons":
      rust(g, x + w * 0.3, y + h * 0.75, u * 0.12, seed); rust(g, x + w * 0.75, y + h * 0.3, u * 0.1, seed + 1);
      block(g, "cantons", x + w * 0.62, y + h * 0.7, w * 0.26, h * 0.16, "#5a6038", seed + 2); // jerry cans / crate
      stripe(g, f, x + w * 0.1, y + h * 0.2, w * 0.26, Math.max(2, u * 0.06));
      break;
    case "choir":
      spikes(g, x, y + h * 0.15, x, y + h * 0.85, 3, u * 0.12, "#1a1012");
      spikes(g, x + w, y + h * 0.85, x + w, y + h * 0.15, 3, u * 0.12, "#1a1012");
      banner(g, x + w * 0.4, y + h * 0.82, u * 0.16, u * 0.34);
      crystals(g, x + w * 0.78, y + h * 0.72, u * 0.18, seed);
      break;
  }
}

function vehicle(g: G, f: FactionId, type: UnitType, S: number): void {
  const P = look(f).palette, cx = S / 2, L = S * 0.55; // L: hull length (front→back)
  const hullTone = f === "concord" ? P.base : f === "halcyon" ? P.base : f === "cantons" ? P.base : P.base;
  const gun = shade(P.dark, 1.35);
  if (type === "scoutBuggy") {
    const w = L * 0.5, h = L * 0.8, x = cx - w / 2, y = S / 2 - h / 2;
    for (const [ox, oy] of [[-0.62, 0.18], [0.62, 0.18], [-0.62, 0.78], [0.62, 0.78]] as const) {
      g.fillStyle = "#141414"; g.fillRect(cx + ox * w * 0.85 - w * 0.12, y + oy * h - h * 0.12, w * 0.24, h * 0.24); // wheels
    }
    block(g, f, x, y, w, h, hullTone, 31);
    g.strokeStyle = "#1a1a1a"; g.lineWidth = Math.max(1, w * 0.06); g.strokeRect(x + w * 0.18, y + h * 0.3, w * 0.64, h * 0.36); // roll cage
    disc(g, cx, y + h * 0.48, w * 0.12, "#2a2a2a", "#000000"); // seat
    barrel(g, cx + w * 0.16, y + h * 0.36, cx + w * 0.16, y - h * 0.1, w * 0.07, gun, "#0a0a0a");
    hullFlair(g, f, x, y, w, h, 31);
    return;
  }
  const heavy = type === "heavyTank", arty = type === "artillery";
  const w = L * (heavy ? 0.78 : 0.62), h = L * (heavy ? 0.95 : 0.85), x = cx - w / 2, y = S / 2 - h / 2 + (arty ? L * 0.18 : 0);
  const tw = w * (heavy ? 0.22 : 0.18);
  tracks(g, f, x - tw * 0.4, y - h * 0.02, tw, h * 1.04);
  tracks(g, f, x + w - tw * 0.6, y - h * 0.02, tw, h * 1.04);
  block(g, f, x + tw * 0.4, y, w - tw * 0.8, h, hullTone, 32 + (heavy ? 1 : 0));
  hullFlair(g, f, x + tw * 0.4, y, w - tw * 0.8, h, 33);
  if (arty) {
    block(g, f, cx - w * 0.22, y + h * 0.18, w * 0.44, h * 0.38, P.mid, 34); // casemate
    barrel(g, cx, y + h * 0.3, cx, y - L * 0.62, w * 0.11, gun, "#0a0a0a");
    disc(g, cx, y - L * 0.62, w * 0.07, P.dark, "#000000"); // muzzle brake
    return;
  }
  const tr = w * (heavy ? 0.3 : 0.26), ty = y + h * 0.42;
  barrel(g, cx, ty, cx, y - h * (heavy ? 0.42 : 0.32), w * (heavy ? 0.12 : 0.09), gun, "#0a0a0a");
  if (heavy) barrel(g, cx + tr * 0.55, ty, cx + tr * 0.55, y - h * 0.05, w * 0.05, gun, "#0a0a0a"); // coax
  if (f === "halcyon") hex(g, cx, ty, tr, P.mid, P.accent);
  else disc(g, cx, ty, tr, f === "concord" ? shade(P.base, 1.05) : P.mid, P.dark);
  if (f === "concord") emblem(g, f, cx, ty, tr * 0.9);
  if (f === "choir") crystals(g, cx - tr * 0.5, ty + tr * 0.3, tr * 0.6, 35);
}

/** Draw a faction unit facing UP into a size×size canvas (fitDraw normalises the footprint). */
export function drawFactionUnit(g: G, f: FactionId, type: UnitType, S: number): void {
  if (UNIT_ART[type].vehicle) vehicle(g, f, type, S);
  else infantry(g, f, type, S);
}
