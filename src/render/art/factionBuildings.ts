// 27 §H — procedural faction buildings, seen from straight above (roof plans). Each type has a fixed
// layout so it reads at a glance (cooling stacks = power, silos + ore = refinery, crane = yard…);
// the faction changes the shapes, materials and decorations. Also the Art Lab's building guides.

import type { ArtBuildingType } from "../../content/factionArt";
import type { FactionId } from "../../core/types";
import {
  banner, barrel, block, crystals, disc, emblem, hex, h01, look, rgba, rivets, rust, sandbags, shade, spikes, stripe, type G,
} from "./factionKit";

interface R { x: number; y: number; w: number; h: number }
const sub = (r: R, x: number, y: number, w: number, h: number): R => ({ x: r.x + r.w * x, y: r.y + r.h * y, w: r.w * w, h: r.h * h });

/** The ground pad the building stands on (fills the whole footprint). */
function pad(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  const tone = f === "concord" ? "#9aa3ad" : f === "halcyon" ? "#3a3b42" : f === "cantons" ? "#7a6a4a" : "#3a2a2a";
  block(g, f === "halcyon" ? "halcyon" : "concord", r.x, r.y, r.w, r.h, tone, 1);
  if (f === "concord") { g.strokeStyle = rgba(P.light, 0.35); g.lineWidth = Math.max(1, u * 0.012); g.strokeRect(r.x + u * 0.05, r.y + u * 0.05, r.w - u * 0.1, r.h - u * 0.1); }
  if (f === "halcyon") { g.strokeStyle = rgba(P.accent, 0.7); g.lineWidth = Math.max(1, u * 0.012); g.strokeRect(r.x + u * 0.04, r.y + u * 0.04, r.w - u * 0.08, r.h - u * 0.08); }
  if (f === "cantons") {
    const b = u * 0.07;
    sandbags(g, r.x + b, r.y + r.h - b * 0.8, r.x + r.w * 0.45, r.y + r.h - b * 0.8, b);
    sandbags(g, r.x + b * 0.8, r.y + b, r.x + b * 0.8, r.y + r.h * 0.5, b);
  }
  if (f === "choir") {
    g.strokeStyle = rgba("#000000", 0.35); g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(r.x, r.y + (r.h * k) / 4); g.lineTo(r.x + r.w, r.y + (r.h * k) / 4); g.stroke(); }
    g.strokeStyle = rgba(P.accent, 0.5); g.lineWidth = Math.max(1, u * 0.014); g.strokeRect(r.x + u * 0.03, r.y + u * 0.03, r.w - u * 0.06, r.h - u * 0.06);
  }
}

/** Faction flair on a main roof block. */
function flair(g: G, f: FactionId, r: R, seed: number, withEmblem = true): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  switch (f) {
    case "concord":
      stripe(g, f, r.x + r.w * 0.08, r.y + r.h * 0.84, r.w * 0.84, Math.max(2, u * 0.05));
      if (withEmblem) emblem(g, f, r.x + r.w / 2, r.y + r.h * 0.45, u * 0.42);
      break;
    case "halcyon":
      g.strokeStyle = P.accent; g.lineWidth = Math.max(1, u * 0.025);
      g.beginPath(); g.moveTo(r.x + r.w * 0.12, r.y + r.h * 0.16); g.lineTo(r.x + r.w * 0.88, r.y + r.h * 0.16); g.stroke();
      for (let k = 0; k < 3; k++) hex(g, r.x + r.w * (0.25 + k * 0.25), r.y + r.h * 0.78, u * 0.07, "#1c1c22", shade(P.accent, 0.8));
      if (withEmblem) emblem(g, f, r.x + r.w / 2, r.y + r.h * 0.47, u * 0.36);
      break;
    case "cantons":
      for (let k = 0; k < 3; k++) rust(g, r.x + r.w * (0.2 + 0.3 * h01(seed, k, 1)), r.y + r.h * (0.2 + 0.6 * h01(seed, k, 2)), u * 0.1, seed + k);
      g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1;
      for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(r.x + (r.w * k) / 6, r.y + u * 0.05); g.lineTo(r.x + (r.w * k) / 6, r.y + r.h - u * 0.05); g.stroke(); } // corrugation
      stripe(g, f, r.x + r.w * 0.1, r.y + r.h * 0.12, r.w * 0.3, Math.max(2, u * 0.05));
      if (withEmblem) emblem(g, f, r.x + r.w * 0.68, r.y + r.h * 0.55, u * 0.32, 0.85);
      break;
    case "choir":
      spikes(g, r.x + u * 0.08, r.y, r.x + r.w - u * 0.08, r.y, 4, u * 0.1, "#1a1012");
      if (withEmblem) emblem(g, f, r.x + r.w / 2, r.y + r.h * 0.5, u * 0.38);
      crystals(g, r.x + r.w * 0.82, r.y + r.h * 0.78, u * 0.16, seed);
      break;
  }
}

function roofTone(f: FactionId): string { return look(f).palette.base; }
function wallTone(f: FactionId): string { return look(f).palette.mid; }

// ── the ten buildings ───────────────────────────────────────────────────────────────────────────

function constructionYard(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  // Vehicle bays along the bottom, crates along the right.
  for (let k = 0; k < 3; k++) block(g, f, r.x + r.w * (0.08 + k * 0.29), r.y + r.h * 0.74, r.w * 0.24, r.h * 0.18, wallTone(f), 10 + k);
  for (let k = 0; k < 4; k++) block(g, "concord", r.x + r.w * 0.86, r.y + r.h * (0.1 + k * 0.13), u * 0.08, u * 0.08, f === "cantons" ? "#8a6a44" : shade(P.mid, 1.2), 20 + k);
  // Command building with a helipad.
  const c = sub(r, 0.18, 0.14, 0.58, 0.52);
  block(g, f, c.x, c.y, c.w, c.h, roofTone(f), 2);
  disc(g, c.x + c.w * 0.36, c.y + c.h * 0.5, Math.min(c.w, c.h) * 0.3, shade(P.dark, 1.3), P.dark);
  g.strokeStyle = P.light; g.lineWidth = Math.max(1, u * 0.015);
  g.beginPath(); g.arc(c.x + c.w * 0.36, c.y + c.h * 0.5, Math.min(c.w, c.h) * 0.22, 0, Math.PI * 2); g.stroke();
  emblem(g, f, c.x + c.w * 0.36, c.y + c.h * 0.5, Math.min(c.w, c.h) * 0.3);
  flair(g, f, sub(c, 0.6, 0.1, 0.36, 0.8), 3, false);
  // Crane arm from a pivot near the top-left corner, across the yard.
  const px = r.x + r.w * 0.1, py = r.y + r.h * 0.1;
  barrel(g, px, py, r.x + r.w * 0.7, r.y + r.h * 0.62, u * 0.045, f === "halcyon" ? P.accent : f === "concord" ? "#e8c040" : f === "cantons" ? "#c8a040" : "#5a2026", P.dark);
  disc(g, px, py, u * 0.06, shade(P.mid, 1.1), P.dark);
}

function powerPlant(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  block(g, f, r.x + r.w * 0.08, r.y + r.h * 0.6, r.w * 0.84, r.h * 0.32, roofTone(f), 4); // turbine hall
  flair(g, f, sub(r, 0.08, 0.6, 0.84, 0.32), 5, false);
  for (const cx of [0.3, 0.7]) {
    const x = r.x + r.w * cx, y = r.y + r.h * 0.3, rr = u * 0.2;
    disc(g, x, y, rr, f === "choir" ? "#3a2226" : shade(P.mid, 1.15), P.dark);
    disc(g, x, y, rr * 0.62, shade(P.dark, 0.9), "#000000"); // stack opening
    if (f === "choir") crystals(g, x, y, rr * 0.55, Math.round(cx * 10));
    else { g.fillStyle = rgba(f === "halcyon" ? P.accent : "#ffd27a", 0.35); g.beginPath(); g.arc(x, y, rr * 0.35, 0, Math.PI * 2); g.fill(); }
  }
  g.strokeStyle = "#1a1a1a"; g.lineWidth = Math.max(1, u * 0.02);
  g.beginPath(); g.moveTo(r.x + r.w * 0.3, r.y + r.h * 0.5); g.lineTo(r.x + r.w * 0.3, r.y + r.h * 0.6); g.moveTo(r.x + r.w * 0.7, r.y + r.h * 0.5); g.lineTo(r.x + r.w * 0.7, r.y + r.h * 0.6); g.stroke();
  emblem(g, f, r.x + r.w * 0.5, r.y + r.h * 0.76, u * 0.2);
}

function refinery(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  for (let k = 0; k < 3; k++) disc(g, r.x + r.w * (0.22 + k * 0.28), r.y + r.h * 0.24, u * 0.12, f === "halcyon" ? shade(P.mid, 1.2) : shade(P.base, 0.95), P.dark); // silos
  block(g, f, r.x + r.w * 0.08, r.y + r.h * 0.48, r.w * 0.5, r.h * 0.42, roofTone(f), 6); // furnace hall
  disc(g, r.x + r.w * 0.22, r.y + r.h * 0.6, u * 0.07, "#2a2a2a", "#000000"); // chimney
  flair(g, f, sub(r, 0.08, 0.48, 0.5, 0.42), 7, false);
  // Conveyor to the ore pad with gold ore.
  barrel(g, r.x + r.w * 0.58, r.y + r.h * 0.69, r.x + r.w * 0.78, r.y + r.h * 0.69, u * 0.05, "#3a3a3a", "#141414");
  g.fillStyle = "#3a3226"; g.beginPath(); g.ellipse(r.x + r.w * 0.82, r.y + r.h * 0.74, u * 0.12, u * 0.1, 0, 0, Math.PI * 2); g.fill();
  for (let k = 0; k < 9; k++) {
    g.fillStyle = k % 3 ? "#f5c518" : "#d9a400";
    g.beginPath(); g.arc(r.x + r.w * (0.76 + 0.12 * h01(k, 1, 3)), r.y + r.h * (0.68 + 0.12 * h01(k, 2, 3)), u * 0.025, 0, Math.PI * 2); g.fill();
  }
}

function barracks(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  const roof = sub(r, 0.08, 0.08, 0.84, 0.54);
  block(g, f, roof.x, roof.y, roof.w, roof.h, roofTone(f), 8);
  g.strokeStyle = rgba("#000000", 0.3); g.lineWidth = Math.max(1, u * 0.015);
  g.beginPath(); g.moveTo(roof.x + roof.w * 0.05, roof.y + roof.h / 2); g.lineTo(roof.x + roof.w * 0.95, roof.y + roof.h / 2); g.stroke(); // ridge
  flair(g, f, roof, 9);
  // Parade ground with a flagpole and the faction flag.
  g.fillStyle = f === "choir" ? "#2a1a1a" : f === "halcyon" ? "#26262c" : f === "cantons" ? "#6a5a3a" : "#b8bec6";
  g.fillRect(r.x + r.w * 0.12, r.y + r.h * 0.68, r.w * 0.56, r.h * 0.24);
  disc(g, r.x + r.w * 0.8, r.y + r.h * 0.78, u * 0.03, "#888888", "#222222");
  g.fillStyle = f === "choir" ? "#b8202c" : P.accent;
  g.fillRect(r.x + r.w * 0.8, r.y + r.h * 0.74, u * 0.12, u * 0.06);
}

function warFactory(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  const hall = sub(r, 0.05, 0.06, 0.9, 0.7);
  block(g, f, hall.x, hall.y, hall.w, hall.h, roofTone(f), 11);
  // Skylights.
  for (let k = 0; k < 5; k++) {
    g.fillStyle = rgba(P.glass, 0.75);
    g.fillRect(hall.x + hall.w * (0.08 + k * 0.17), hall.y + hall.h * 0.18, hall.w * 0.1, hall.h * 0.22);
  }
  flair(g, f, sub(hall, 0, 0.45, 1, 0.55), 12);
  // Gantry rails and the bay door on the front (bottom) edge.
  g.strokeStyle = "#1c1c1c"; g.lineWidth = Math.max(1, u * 0.025);
  g.beginPath(); g.moveTo(r.x + r.w * 0.05, r.y + r.h * 0.84); g.lineTo(r.x + r.w * 0.95, r.y + r.h * 0.84); g.stroke();
  block(g, "concord", r.x + r.w * 0.32, r.y + r.h * 0.76, r.w * 0.36, r.h * 0.18, shade(P.dark, 1.4), 13);
  for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? "#e8c040" : "#1a1a1a"; g.fillRect(r.x + r.w * (0.32 + k * 0.09), r.y + r.h * 0.92, r.w * 0.09, r.h * 0.03); }
}

function lab(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  block(g, f, r.x + r.w * 0.08, r.y + r.h * 0.08, r.w * 0.84, r.h * 0.84, wallTone(f), 14);
  const cx = r.x + r.w * 0.46, cy = r.y + r.h * 0.48, rr = u * 0.28;
  const gr = g.createRadialGradient(cx - rr * 0.35, cy - rr * 0.35, rr * 0.1, cx, cy, rr);
  gr.addColorStop(0, shade(P.glass, 1.4)); gr.addColorStop(0.7, P.glass); gr.addColorStop(1, shade(P.glass, 0.5));
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill();
  g.strokeStyle = P.dark; g.lineWidth = Math.max(1, u * 0.02); g.stroke();
  g.strokeStyle = rgba("#000000", 0.25); g.lineWidth = 1;
  for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(cx + k * rr * 0.36, cy - rr * 0.95); g.lineTo(cx + k * rr * 0.36, cy + rr * 0.95); g.stroke(); }
  // Antenna mast + dish.
  barrel(g, r.x + r.w * 0.82, r.y + r.h * 0.18, r.x + r.w * 0.82, r.y + r.h * 0.4, u * 0.02, "#bbbbbb", "#333333");
  disc(g, r.x + r.w * 0.8, r.y + r.h * 0.76, u * 0.09, "#d0d4da", "#333333");
  if (f === "choir") crystals(g, cx + rr * 0.9, cy + rr * 0.6, u * 0.14, 15);
  if (f === "halcyon") hex(g, r.x + r.w * 0.2, r.y + r.h * 0.8, u * 0.07, "#1c1c22", P.accent);
  if (f === "cantons") rust(g, r.x + r.w * 0.22, r.y + r.h * 0.22, u * 0.08, 16);
  emblem(g, f, r.x + r.w * 0.2, r.y + r.h * 0.2, u * 0.16);
}

/** 1×1 defences share a fortified ring base. */
function ringBase(g: G, f: FactionId, r: R): { cx: number; cy: number; R: number } {
  const P = look(f).palette, u = Math.min(r.w, r.h), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (f === "cantons") {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, x = cx + Math.cos(a) * u * 0.36, y = cy + Math.sin(a) * u * 0.36;
      sandbags(g, x - u * 0.06, y, x + u * 0.06, y, u * 0.12);
    }
  } else {
    disc(g, cx, cy, u * 0.44, f === "choir" ? "#2a1a1c" : f === "halcyon" ? "#2a2a30" : "#9aa3ad", P.dark);
    if (f === "choir") spikes(g, cx - u * 0.3, cy - u * 0.32, cx + u * 0.3, cy - u * 0.32, 3, u * 0.08, "#1a1012");
  }
  return { cx, cy, R: u };
}

function turret(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, { cx, cy, R: u } = ringBase(g, f, r);
  barrel(g, cx, cy, cx, cy - u * 0.46, u * 0.08, shade(P.dark, 1.5), P.dark);
  if (f === "halcyon") hex(g, cx, cy, u * 0.24, roofTone(f), P.accent);
  else disc(g, cx, cy, u * 0.24, roofTone(f), P.dark);
  if (f === "concord") stripe(g, f, cx - u * 0.18, cy + u * 0.08, u * 0.36, u * 0.05);
  if (f === "choir") crystals(g, cx + u * 0.16, cy + u * 0.16, u * 0.1, 21);
}

function pillbox(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  g.beginPath();
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + (k * Math.PI) / 4; const x = cx + Math.cos(a) * u * 0.44, y = cy + Math.sin(a) * u * 0.44; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
  g.closePath();
  const gr = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  const t = f === "cantons" ? "#8a8a70" : f === "choir" ? "#3a2226" : f === "halcyon" ? "#3a3b42" : "#b0b8c2";
  gr.addColorStop(0, shade(t, 1.2)); gr.addColorStop(1, shade(t, 0.7));
  g.fillStyle = gr; g.fill(); g.strokeStyle = P.dark; g.lineWidth = Math.max(1, u * 0.03); g.stroke();
  g.fillStyle = "#0a0a0a";
  for (let k = 0; k < 4; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 2; g.save(); g.translate(cx + Math.cos(a) * u * 0.34, cy + Math.sin(a) * u * 0.34); g.rotate(a + Math.PI / 2); g.fillRect(-u * 0.1, -u * 0.025, u * 0.2, u * 0.05); g.restore(); }
  emblem(g, f, cx, cy, u * 0.3, 0.9);
}

function antiArmorCannon(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, { cx, cy, R: u } = ringBase(g, f, r);
  block(g, f, cx - u * 0.18, cy - u * 0.12, u * 0.36, u * 0.36, roofTone(f), 22);
  barrel(g, cx, cy - u * 0.02, cx, cy - u * 0.48, u * 0.11, shade(P.dark, 1.4), P.dark);
  disc(g, cx, cy - u * 0.47, u * 0.06, P.dark, "#000000");
  if (f === "choir") crystals(g, cx + u * 0.2, cy + u * 0.22, u * 0.1, 23);
  if (f === "halcyon") rivets(g, cx - u * 0.14, cy + u * 0.18, cx + u * 0.14, cy + u * 0.18, 4, u * 0.02, P.accent);
}

function missileTower(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  block(g, f, r.x + r.w * 0.08, r.y + r.h * 0.08, r.w * 0.84, r.h * 0.84, roofTone(f), 24);
  for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 3; ix++) {
    const x = r.x + r.w * (0.28 + ix * 0.2), y = r.y + r.h * (0.3 + iy * 0.2);
    disc(g, x, y, u * 0.07, "#1a1a1a", "#000000");
    disc(g, x, y, u * 0.035, f === "choir" ? "#8a6cf0" : f === "halcyon" ? P.accent : "#d84a3a", "#000000");
  }
  if (f === "concord") stripe(g, f, r.x + r.w * 0.14, r.y + r.h * 0.84, r.w * 0.72, u * 0.04);
  if (f === "cantons") rust(g, r.x + r.w * 0.8, r.y + r.h * 0.2, u * 0.07, 25);
  if (f === "choir") banner(g, r.x + r.w * 0.8, r.y + r.h * 0.12, u * 0.1, u * 0.28);
}

const DRAW: Record<ArtBuildingType, (g: G, f: FactionId, r: R) => void> = {
  constructionYard, powerPlant, refinery, barracks, warFactory, lab, turret, pillbox, antiArmorCannon, missileTower,
};

/** Draw a faction building into the rectangle (x, y, w, h) — the building fills it. */
export function drawFactionBuilding(g: G, f: FactionId, type: ArtBuildingType, x: number, y: number, w: number, h: number): void {
  const r: R = { x, y, w, h };
  const big = type === "constructionYard" || type === "powerPlant" || type === "refinery" || type === "barracks" || type === "warFactory" || type === "lab";
  if (big) pad(g, f, r);
  DRAW[type](g, f, r);
  if (f === "choir" && big) banner(g, x + w * 0.02, y + h * 0.3, Math.min(w, h) * 0.07, Math.min(w, h) * 0.22);
}
