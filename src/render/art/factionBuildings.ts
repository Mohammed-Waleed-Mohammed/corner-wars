// 27 §H — procedural faction buildings, seen from straight above (roof plans). Each type is drawn
// around its 27 §H.1 SIGNATURE, laid out as BUILDING_ART's layout says (crane + helipad = yard,
// hollow cooling towers = power, molten gold + ore = refinery, parade ground + flag = barracks…), in
// the shared SIG colours, so every type reads at a glance and alike in all four factions; the
// faction changes the shapes, materials and decorations around it. These are also the in-game
// fallback, the HUD icons and the Art Lab's building guides (file 29 §G).

import { SIG } from "../../content/factionArt";
import type { ArtBuildingType } from "../../content/factionArt";
import type { FactionId } from "../../core/types";
import {
  banner, barrel, block, blockPath, crystals, disc, emblem, hex, h01, look, rgba, rivets, rust, sandbags, shade, spikes, stripe, type G,
} from "./factionKit";

interface R { x: number; y: number; w: number; h: number }
const sub = (r: R, x: number, y: number, w: number, h: number): R => ({ x: r.x + r.w * x, y: r.y + r.h * y, w: r.w * w, h: r.h * h });
const TAU = Math.PI * 2;

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

// ── signature pieces (27 §H.1) ──────────────────────────────────────────────────────────────────

/** A straight bar in construction yellow with black bands across it (crane jib, gantry bridge). */
function hazardBar(g: G, x0: number, y0: number, x1: number, y1: number, w: number, bands: number): void {
  barrel(g, x0, y0, x1, y1, w, SIG.hazard, SIG.hazardDark);
  const len = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  g.strokeStyle = SIG.hazardDark; g.lineWidth = Math.max(1, w * 0.32);
  for (let k = 1; k < bands; k++) {
    const t = k / bands, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    g.beginPath();
    g.moveTo(cx - uy * w * 0.5 - ux * w * 0.35, cy + ux * w * 0.5 - uy * w * 0.35);
    g.lineTo(cx + uy * w * 0.5 + ux * w * 0.35, cy - ux * w * 0.5 + uy * w * 0.35);
    g.stroke();
  }
}

/** A rectangle of diagonal yellow / black hazard stripes (a vehicle bay door). */
function hazardBand(g: G, x: number, y: number, w: number, h: number): void {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = SIG.hazard; g.fillRect(x, y, w, h);
  g.fillStyle = SIG.hazardDark;
  const s = h * 0.8;
  for (let t = -h; t < w + h; t += s * 2) {
    g.beginPath(); g.moveTo(x + t, y + h); g.lineTo(x + t + s, y + h); g.lineTo(x + t + s + h, y); g.lineTo(x + t + h, y); g.closePath(); g.fill();
  }
  g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x, y + h * 0.75, w, h * 0.25);
  g.restore();
  g.strokeStyle = SIG.hazardDark; g.lineWidth = Math.max(1, h * 0.12); g.strokeRect(x, y, w, h);
}

/** A cooling tower from straight above: a pale concrete rim around a deep, dark opening. */
function coolingTower(g: G, f: FactionId, x: number, y: number, rr: number, seed: number): void {
  const P = look(f).palette;
  disc(g, x, y, rr, f === "choir" ? shade(SIG.towerRim, 0.84) : f === "cantons" ? shade(SIG.towerRim, 0.94) : SIG.towerRim, P.dark);
  const hole = rr * 0.66;
  const gr = g.createRadialGradient(x + hole * 0.25, y + hole * 0.25, hole * 0.05, x, y, hole);
  gr.addColorStop(0, "#000000"); gr.addColorStop(0.7, SIG.towerHole); gr.addColorStop(1, "#33373c");
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, hole, 0, TAU); g.fill();
  g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = Math.max(1, rr * 0.05); g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = Math.max(1, rr * 0.04);
  g.beginPath(); g.arc(x, y, hole * 1.08, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); // lit inner lip (bottom-right)
  if (f === "halcyon") { g.strokeStyle = rgba(P.accent, 0.8); g.lineWidth = Math.max(1, rr * 0.04); g.beginPath(); g.arc(x, y, rr * 0.86, 0, TAU); g.stroke(); }
  if (f === "cantons") rust(g, x + rr * 0.55, y - rr * 0.55, rr * 0.22, seed);
  for (let k = 0; k < 3; k++) { // red warning lamps on the rim
    const a = -Math.PI / 2 + (k * TAU) / 3;
    disc(g, x + Math.cos(a) * rr * 0.83, y + Math.sin(a) * rr * 0.83, Math.max(1, rr * 0.06), "#e23b2e", "#5a0e08");
  }
}

/** A heap of raw gold-ore nuggets on dark rock. */
function oreHeap(g: G, cx: number, cy: number, rx: number, ry: number, u: number, seed: number): void {
  const gr = g.createRadialGradient(cx - rx * 0.3, cy - ry * 0.3, 1, cx, cy, Math.max(rx, ry));
  gr.addColorStop(0, "#7a6236"); gr.addColorStop(1, "#3a2c1a");
  g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.fill();
  g.strokeStyle = "#241a0e"; g.lineWidth = Math.max(1, u * 0.01); g.stroke();
  for (let k = 0; k < 28; k++) {
    const a = h01(seed, k, 1) * TAU, d = Math.sqrt(h01(seed, k, 2)) * 0.82;
    disc(g, cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, u * (0.024 + 0.022 * h01(seed, k, 3)), SIG.ore, SIG.oreDark);
  }
  for (let k = 0; k < 5; k++) { // glints
    g.fillStyle = "rgba(255,246,200,0.9)";
    g.beginPath(); g.arc(cx + (h01(seed, k, 4) - 0.5) * rx * 1.2, cy + (h01(seed, k, 5) - 0.5) * ry * 1.2, Math.max(0.6, u * 0.008), 0, TAU); g.fill();
  }
}

/** The Resonance Tap's crystal core: cyan shards, lit from inside (the glow stays in the pit). */
function cyanCrystal(g: G, cx: number, cy: number, size: number, seed: number): void {
  g.save();
  g.shadowColor = rgba(SIG.cyanCore, 0.8);
  g.shadowBlur = size * 0.5;
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k - 2) * 0.62 + (h01(seed, k, 5) - 0.5) * 0.3;
    const len = size * (0.75 + 0.45 * h01(seed, k, 6)), wdt = size * 0.24;
    const tx = cx + Math.cos(a) * len, ty = cy + Math.sin(a) * len;
    const px = -Math.sin(a) * wdt, py = Math.cos(a) * wdt;
    g.beginPath(); g.moveTo(cx + px, cy + py); g.lineTo(tx, ty); g.lineTo(cx - px, cy - py); g.closePath();
    const gr = g.createLinearGradient(cx, cy, tx, ty);
    gr.addColorStop(0, SIG.cyanEdge); gr.addColorStop(1, "#e6feff");
    g.fillStyle = gr; g.fill();
  }
  g.restore();
}

// ── the eleven buildings ────────────────────────────────────────────────────────────────────────

/** Signature: a tower crane from the bottom-left corner to the top-right corner, and a helipad. */
function constructionYard(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  // Vehicle bays along the bottom edge, supply containers down the right side.
  for (let k = 0; k < 2; k++) block(g, f, r.x + r.w * (0.3 + k * 0.25), r.y + r.h * 0.76, r.w * 0.21, r.h * 0.17, wallTone(f), 10 + k);
  for (let k = 0; k < 5; k++) {
    const tone = k % 2 ? shade(P.mid, 1.2) : f === "cantons" ? "#8a6a44" : shade(P.base, 0.82);
    block(g, "concord", r.x + r.w * 0.8, r.y + r.h * (0.09 + k * 0.13), r.w * 0.13, r.h * 0.1, tone, 20 + k);
  }
  // The command block, the largest roof, with the helipad.
  const c = sub(r, 0.06, 0.06, 0.68, 0.64), cu = Math.min(c.w, c.h);
  block(g, f, c.x, c.y, c.w, c.h, roofTone(f), 2);
  flair(g, f, sub(c, 0.7, 0.08, 0.28, 0.84), 3, false);
  const hx = c.x + c.w * 0.44, hy = c.y + c.h * 0.48, hr = cu * 0.32;
  disc(g, hx, hy, hr, shade(P.dark, 1.3), P.dark);
  g.strokeStyle = SIG.helipad; g.lineCap = "butt";
  g.lineWidth = hr * 0.14; g.beginPath(); g.arc(hx, hy, hr * 0.74, 0, TAU); g.stroke();
  g.lineWidth = hr * 0.17; g.beginPath(); g.moveTo(hx - hr * 0.42, hy); g.lineTo(hx + hr * 0.42, hy); g.moveTo(hx, hy - hr * 0.42); g.lineTo(hx, hy + hr * 0.42); g.stroke();
  emblem(g, f, c.x + c.w * 0.14, c.y + c.h * 0.16, cu * 0.18);
  // The tower crane, drawn last: it stands highest. Counter-jib + counterweight toward the corner.
  const bx = r.x + r.w * 0.14, by = r.y + r.h * 0.86, ex = r.x + r.w * 0.93, ey = r.y + r.h * 0.08;
  hazardBar(g, bx, by, bx - u * 0.07, by + u * 0.07, u * 0.05, 2);
  block(g, "concord", bx - u * 0.11, by + u * 0.03, u * 0.08, u * 0.08, "#3a3a3a", 40);
  hazardBar(g, bx, by, ex, ey, u * 0.055, 11);
  const t = 0.6, tx = bx + (ex - bx) * t, ty = by + (ey - by) * t;
  block(g, "concord", tx - u * 0.035, ty - u * 0.035, u * 0.07, u * 0.07, "#2a2a2a", 41); // trolley + hook
  disc(g, bx, by, u * 0.055, SIG.hazard, SIG.hazardDark); // slewing ring
}

/** Signature: two hollow cooling towers across the top half. */
function powerPlant(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  const hall = sub(r, 0.06, 0.6, 0.42, 0.34);
  block(g, f, hall.x, hall.y, hall.w, hall.h, roofTone(f), 4);
  flair(g, f, hall, 5, false);
  emblem(g, f, hall.x + hall.w * 0.5, hall.y + hall.h * 0.48, u * 0.17);
  // Transformer yard: a grid of insulators and cables.
  const yd = sub(r, 0.52, 0.6, 0.42, 0.34);
  block(g, "concord", yd.x, yd.y, yd.w, yd.h, shade(P.dark, 1.35), 6);
  g.strokeStyle = "#0c0c0c"; g.lineWidth = Math.max(1, u * 0.014);
  for (let k = 0; k < 2; k++) { const y = yd.y + yd.h * (0.32 + k * 0.38); g.beginPath(); g.moveTo(yd.x + yd.w * 0.1, y); g.lineTo(yd.x + yd.w * 0.9, y); g.stroke(); }
  for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 3; ix++) disc(g, yd.x + yd.w * (0.2 + ix * 0.3), yd.y + yd.h * (0.32 + iy * 0.38), u * 0.032, "#c8ccd2", "#2a2a2a");
  g.strokeStyle = "#151515"; g.lineWidth = Math.max(1, u * 0.022);
  g.beginPath(); g.moveTo(r.x + r.w * 0.36, r.y + r.h * 0.46); g.lineTo(yd.x + yd.w * 0.2, yd.y + yd.h * 0.2);
  g.moveTo(r.x + r.w * 0.73, r.y + r.h * 0.5); g.lineTo(yd.x + yd.w * 0.6, yd.y + yd.h * 0.2); g.stroke();
  coolingTower(g, f, r.x + r.w * 0.27, r.y + r.h * 0.29, u * 0.21, 1);
  coolingTower(g, f, r.x + r.w * 0.73, r.y + r.h * 0.29, u * 0.21, 2);
}

/** Signature: a crucible of molten gold (top-left) and a heap of gold ore (bottom-right). */
function refinery(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  // Smelter-hall roofs fill the other two quarters.
  const hallA = sub(r, 0.54, 0.06, 0.4, 0.42), hallB = sub(r, 0.06, 0.56, 0.4, 0.38);
  block(g, f, hallA.x, hallA.y, hallA.w, hallA.h, roofTone(f), 6);
  block(g, f, hallB.x, hallB.y, hallB.w, hallB.h, roofTone(f), 7);
  flair(g, f, hallB, 7, false);
  disc(g, hallA.x + hallA.w * 0.7, hallA.y + hallA.h * 0.3, u * 0.07, "#3a3a3a", "#0a0a0a"); // chimney
  disc(g, hallA.x + hallA.w * 0.7, hallA.y + hallA.h * 0.3, u * 0.042, "#080808", "#000000");
  emblem(g, f, hallA.x + hallA.w * 0.3, hallA.y + hallA.h * 0.64, u * 0.15);
  // A pallet of gold ingots on the lower hall.
  const px = hallB.x + hallB.w * 0.5, py = hallB.y + hallB.h * 0.3;
  g.fillStyle = "#5a3e22"; g.fillRect(px, py, u * 0.15, u * 0.11);
  for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 3; ix++) {
    const x = px + u * (0.012 + ix * 0.046), y = py + u * (0.012 + iy * 0.05);
    g.fillStyle = SIG.ore; g.fillRect(x, y, u * 0.04, u * 0.04);
    g.strokeStyle = SIG.oreDark; g.lineWidth = Math.max(1, u * 0.006); g.strokeRect(x, y, u * 0.04, u * 0.04);
  }
  oreHeap(g, r.x + r.w * 0.74, r.y + r.h * 0.75, u * 0.2, u * 0.18, u, 51);
  // Conveyor from the heap up into the crucible, carrying nuggets.
  const c0x = r.x + r.w * 0.64, c0y = r.y + r.h * 0.64, c1x = r.x + r.w * 0.41, c1y = r.y + r.h * 0.41;
  barrel(g, c0x, c0y, c1x, c1y, u * 0.075, "#3a3a3a", "#121212");
  for (let k = 1; k < 4; k++) disc(g, c0x + (c1x - c0x) * k / 4, c0y + (c1y - c0y) * k / 4, u * 0.022, SIG.ore, SIG.oreDark);
  // The crucible, drawn last: the hottest, brightest thing in the base.
  const cx = r.x + r.w * 0.28, cy = r.y + r.h * 0.28, cr = u * 0.225;
  disc(g, cx, cy, cr, f === "choir" ? "#2e1a1a" : "#3a322c", "#0e0c0a");
  rivets(g, cx - cr * 0.7, cy + cr * 0.86, cx + cr * 0.7, cy + cr * 0.86, 4, Math.max(1, u * 0.01), shade(P.light, 0.8));
  const pool = cr * 0.74, gr = g.createRadialGradient(cx - pool * 0.2, cy - pool * 0.2, 0, cx, cy, pool);
  gr.addColorStop(0, "#fff6c8"); gr.addColorStop(0.3, SIG.goldHot); gr.addColorStop(0.82, SIG.goldRim); gr.addColorStop(1, shade(SIG.goldRim, 0.7));
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, pool, 0, TAU); g.fill();
  g.strokeStyle = "rgba(150,60,0,0.45)"; g.lineWidth = Math.max(1, u * 0.012);
  for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(cx + pool * 0.15, cy + pool * 0.1, pool * (0.35 + k * 0.18), 0.3 + k, 1.4 + k); g.stroke(); } // slow swirls of crust
}

/** Signature: a pale parade ground with a big flag, beside narrow parallel bunkhouse roofs. */
function barracks(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  for (let k = 0; k < 3; k++) {
    const b = sub(r, 0.06, 0.06 + k * 0.16, 0.88, 0.13);
    block(g, f, b.x, b.y, b.w, b.h, k === 1 ? shade(roofTone(f), 0.9) : roofTone(f), 8 + k);
    g.strokeStyle = rgba("#000000", 0.3); g.lineWidth = Math.max(1, u * 0.012);
    g.beginPath(); g.moveTo(b.x + b.w * 0.04, b.y + b.h / 2); g.lineTo(b.x + b.w * 0.96, b.y + b.h / 2); g.stroke(); // ridge
  }
  flair(g, f, sub(r, 0.06, 0.06, 0.88, 0.45), 9, false);
  emblem(g, f, r.x + r.w * 0.82, r.y + r.h * 0.285, u * 0.12);
  // The parade ground.
  const pg = sub(r, 0.4, 0.55, 0.54, 0.39);
  g.fillStyle = SIG.parade; g.fillRect(pg.x, pg.y, pg.w, pg.h);
  g.strokeStyle = "rgba(90,80,60,0.25)"; g.lineWidth = Math.max(1, u * 0.008);
  for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(pg.x + pg.w * 0.08, pg.y + (pg.h * k) / 4); g.lineTo(pg.x + pg.w * 0.92, pg.y + (pg.h * k) / 4); g.stroke(); }
  if (f === "cantons") {
    sandbags(g, pg.x, pg.y, pg.x + pg.w, pg.y, u * 0.05);
    sandbags(g, pg.x, pg.y, pg.x, pg.y + pg.h, u * 0.05);
  } else { g.strokeStyle = shade(P.dark, 1.1); g.lineWidth = Math.max(1, u * 0.022); g.strokeRect(pg.x, pg.y, pg.w, pg.h); }
  // The flagpole in the middle and a big flag streaming to the right.
  const fx = pg.x + pg.w * 0.2, fy = pg.y + pg.h * 0.5, fw = u * 0.36, fh = u * 0.19;
  const flagTone = f === "choir" ? "#b8202c" : P.accent;
  const fg = g.createLinearGradient(fx, fy, fx + fw, fy);
  fg.addColorStop(0, shade(flagTone, 1.15)); fg.addColorStop(1, shade(flagTone, 0.8));
  g.fillStyle = fg;
  g.beginPath(); g.moveTo(fx, fy - fh / 2);
  g.quadraticCurveTo(fx + fw * 0.5, fy - fh * 0.75, fx + fw, fy - fh * 0.45); g.lineTo(fx + fw, fy + fh * 0.55);
  g.quadraticCurveTo(fx + fw * 0.5, fy + fh * 0.25, fx, fy + fh / 2); g.closePath(); g.fill();
  g.strokeStyle = shade(flagTone, 0.5); g.lineWidth = Math.max(1, u * 0.008); g.stroke();
  emblem(g, f, fx + fw * 0.5, fy, fh * 0.8);
  disc(g, fx, fy, u * 0.024, "#a0a0a0", "#202020");
  // The gate and its sentry box in the bottom-left corner.
  block(g, f, r.x + r.w * 0.08, r.y + r.h * 0.6, r.w * 0.17, r.h * 0.17, wallTone(f), 12);
  hazardBar(g, r.x + r.w * 0.1, r.y + r.h * 0.87, r.x + r.w * 0.34, r.y + r.h * 0.87, u * 0.03, 5);
}

/** Signature: one huge ribbed hall, a gantry crane across it, a hazard-striped bay door in front. */
function warFactory(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  const hall = sub(r, 0.03, 0.05, 0.94, 0.72);
  block(g, f, hall.x, hall.y, hall.w, hall.h, roofTone(f), 11);
  // Curved, ribbed roof sheets: the ribs run from top to bottom.
  g.save();
  blockPath(g, f, hall.x, hall.y, hall.w, hall.h, 11); g.clip();
  const ribs = 22;
  for (let k = 1; k < ribs; k++) {
    const x = hall.x + (hall.w * k) / ribs;
    g.strokeStyle = "rgba(0,0,0,0.28)"; g.lineWidth = Math.max(1, u * 0.012); g.beginPath(); g.moveTo(x, hall.y); g.lineTo(x, hall.y + hall.h); g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.16)"; g.lineWidth = Math.max(1, u * 0.008); g.beginPath(); g.moveTo(x - u * 0.015, hall.y); g.lineTo(x - u * 0.015, hall.y + hall.h); g.stroke();
  }
  g.restore();
  // Skylights along the centre line.
  for (let k = 0; k < 6; k++) {
    const x = hall.x + hall.w * (0.08 + k * 0.145), y = hall.y + hall.h * 0.36;
    g.fillStyle = rgba(P.glass, 0.85); g.fillRect(x, y, hall.w * 0.08, hall.h * 0.16);
    g.strokeStyle = P.dark; g.lineWidth = Math.max(1, u * 0.012); g.strokeRect(x, y, hall.w * 0.08, hall.h * 0.16);
  }
  flair(g, f, sub(hall, 0.52, 0.5, 0.46, 0.48), 12, false);
  emblem(g, f, hall.x + hall.w * 0.78, hall.y + hall.h * 0.72, u * 0.2);
  // Gantry rails along the top and bottom edges, and the crane bridge across the hall.
  g.strokeStyle = "#1c1c1c"; g.lineWidth = Math.max(1, u * 0.028);
  for (const t of [0.07, 0.93]) { g.beginPath(); g.moveTo(hall.x + hall.w * 0.02, hall.y + hall.h * t); g.lineTo(hall.x + hall.w * 0.98, hall.y + hall.h * t); g.stroke(); }
  const gx = r.x + r.w * 0.33;
  hazardBar(g, gx, hall.y + hall.h * 0.02, gx, hall.y + hall.h * 0.98, u * 0.1, 7);
  block(g, "concord", gx - u * 0.07, hall.y + hall.h * 0.42, u * 0.14, u * 0.12, "#2a2a2a", 13); // trolley
  // The bay door on the front (bottom) edge.
  hazardBand(g, r.x + r.w * 0.17, r.y + r.h * 0.79, r.w * 0.66, r.h * 0.15);
}

/** Signature: a big glass dome lit from inside, and a large pale radar dish. */
function lab(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  block(g, f, r.x + r.w * 0.06, r.y + r.h * 0.06, r.w * 0.88, r.h * 0.88, wallTone(f), 14);
  // Antenna masts and cooling units, bottom-right.
  for (let k = 0; k < 2; k++) {
    const x = r.x + r.w * (0.76 + k * 0.1);
    barrel(g, x, r.y + r.h * 0.62, x, r.y + r.h * 0.74, u * 0.018, "#c8ccd2", "#333333");
    disc(g, x, r.y + r.h * 0.62, u * 0.02, "#e23b2e", "#400");
  }
  for (let k = 0; k < 2; k++) {
    const x = r.x + r.w * (0.74 + k * 0.1), y = r.y + r.h * 0.8;
    block(g, "concord", x - u * 0.045, y - u * 0.045, u * 0.09, u * 0.09, "#5a5f66", 16 + k);
    disc(g, x, y, u * 0.03, "#2a2d31", "#111111");
  }
  // The dome on its walkway ring.
  const cx = r.x + r.w * 0.4, cy = r.y + r.h * 0.53, rr = u * 0.29;
  disc(g, cx, cy, rr * 1.1, shade(P.base, 0.9), P.dark);
  const gr = g.createRadialGradient(cx - rr * 0.35, cy - rr * 0.35, rr * 0.08, cx, cy, rr);
  gr.addColorStop(0, shade(P.glass, 1.55)); gr.addColorStop(0.65, P.glass); gr.addColorStop(1, shade(P.glass, 0.55));
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.fill();
  g.strokeStyle = P.dark; g.lineWidth = Math.max(1, u * 0.02); g.stroke();
  g.strokeStyle = rgba(P.dark, 0.55); g.lineWidth = Math.max(1, u * 0.01);
  g.beginPath(); g.arc(cx, cy, rr * 0.55, 0, TAU); g.stroke();
  for (let k = 0; k < 8; k++) {
    const a = (k * TAU) / 8;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * rr * 0.55, cy + Math.sin(a) * rr * 0.55); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); g.stroke();
  }
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.beginPath(); g.ellipse(cx - rr * 0.38, cy - rr * 0.4, rr * 0.22, rr * 0.11, -0.7, 0, TAU); g.fill(); // highlight
  // The radar dish, top-right.
  const dx = r.x + r.w * 0.78, dy = r.y + r.h * 0.22, dr = u * 0.14;
  disc(g, dx, dy, dr, SIG.dish, "#4a4f55");
  g.strokeStyle = "rgba(0,0,0,0.2)"; g.lineWidth = Math.max(1, u * 0.008); g.beginPath(); g.arc(dx, dy, dr * 0.6, 0, TAU); g.stroke();
  barrel(g, dx + dr * 0.7, dy + dr * 0.7, dx, dy, u * 0.016, "#9aa0a8", "#333333");
  disc(g, dx, dy, dr * 0.16, "#8a8f96", "#222222");
  if (f === "halcyon") hex(g, r.x + r.w * 0.16, r.y + r.h * 0.17, u * 0.06, "#1c1c22", P.accent);
  if (f === "cantons") rust(g, r.x + r.w * 0.78, r.y + r.h * 0.45, u * 0.06, 16);
  emblem(g, f, r.x + r.w * 0.16, r.y + r.h * 0.86, u * 0.13);
}

/** Signature: a glowing cyan crystal core in a round pit, four conductor pylons on its diagonals.
 *  The core is cyan for everyone; the Choir's grows violet crystals around it. */
function resonanceTap(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  const cx = r.x + r.w * 0.47, cy = r.y + r.h * 0.47;
  // Control hut in the bottom-right corner + cables from the pylons.
  block(g, f, r.x + r.w * 0.68, r.y + r.h * 0.68, r.w * 0.25, r.h * 0.25, roofTone(f), 31);
  g.strokeStyle = "#141414"; g.lineWidth = Math.max(1, u * 0.025);
  for (const [px, py] of [[0.2, 0.2], [0.74, 0.2], [0.2, 0.74]] as const) {
    g.beginPath(); g.moveTo(r.x + r.w * px, r.y + r.h * py); g.lineTo(r.x + r.w * 0.74, r.y + r.h * 0.74); g.stroke();
  }
  // The pit and the glowing core.
  disc(g, cx, cy, u * 0.25, f === "halcyon" ? "#1c1c22" : f === "choir" ? "#1e1214" : "#3a3f46", P.dark);
  const glow = g.createRadialGradient(cx, cy, u * 0.02, cx, cy, u * 0.22);
  glow.addColorStop(0, "#e6feff"); glow.addColorStop(0.4, SIG.cyanCore); glow.addColorStop(1, rgba(SIG.cyanEdge, 0));
  g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, u * 0.22, 0, TAU); g.fill();
  cyanCrystal(g, cx, cy + u * 0.05, u * 0.15, 33);
  if (f === "choir") { crystals(g, cx - u * 0.15, cy + u * 0.12, u * 0.07, 34); crystals(g, cx + u * 0.14, cy - u * 0.1, u * 0.06, 35); }
  // Four conductor pylons on the diagonals, cyan tips.
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2, px = cx + Math.cos(a) * u * 0.33, py = cy + Math.sin(a) * u * 0.33;
    if (f === "halcyon") hex(g, px, py, u * 0.065, "#2a2a30", P.accent);
    else disc(g, px, py, u * 0.065, f === "cantons" ? "#8a7a5a" : shade(P.mid, 1.1), P.dark);
    disc(g, px, py, u * 0.03, SIG.cyanCore, SIG.cyanEdge);
  }
  if (f === "concord") stripe(g, f, r.x + r.w * 0.1, r.y + r.h * 0.9, r.w * 0.5, u * 0.04);
  if (f === "cantons") rust(g, r.x + r.w * 0.8, r.y + r.h * 0.77, u * 0.06, 36);
  emblem(g, f, r.x + r.w * 0.8, r.y + r.h * 0.8, u * 0.14);
}

/** 1×1 defences stand on a fortified round base (centre offset `oy` × the side, radius `rad`). */
function ringBase(g: G, f: FactionId, r: R, oy = 0, rad = 0.44): { cx: number; cy: number; u: number } {
  const P = look(f).palette, u = Math.min(r.w, r.h), cx = r.x + r.w / 2, cy = r.y + r.h / 2 + u * oy;
  if (f === "cantons") {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU, x = cx + Math.cos(a) * u * (rad - 0.08), y = cy + Math.sin(a) * u * (rad - 0.08);
      sandbags(g, x - u * 0.06, y, x + u * 0.06, y, u * 0.12);
    }
  } else {
    disc(g, cx, cy, u * rad, f === "choir" ? "#2a1a1c" : f === "halcyon" ? "#2a2a30" : "#9aa3ad", P.dark);
    if (f === "choir") spikes(g, cx - u * rad * 0.7, cy + u * rad * 0.72, cx + u * rad * 0.7, cy + u * rad * 0.72, 3, u * 0.07, "#1a1012");
  }
  return { cx, cy, u };
}

/** Signature: two short, thick barrels side by side, pointing at the top edge. */
function turret(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, { cx, cy, u } = ringBase(g, f, r);
  for (const dx of [-0.08, 0.08]) barrel(g, cx + u * dx, cy, cx + u * dx, cy - u * 0.45, u * 0.075, shade(P.dark, 1.5), P.dark);
  if (f === "halcyon") hex(g, cx, cy, u * 0.23, roofTone(f), P.accent);
  else disc(g, cx, cy, u * 0.23, roofTone(f), P.dark);
  if (f === "concord") stripe(g, f, cx - u * 0.16, cy + u * 0.08, u * 0.32, u * 0.05);
  if (f === "cantons") rust(g, cx + u * 0.08, cy + u * 0.06, u * 0.06, 21);
  if (f === "choir") crystals(g, cx + u * 0.15, cy + u * 0.17, u * 0.08, 21);
}

/** Signature: a flat octagonal bunker with a firing slit in each of its eight sides, no barrel. */
function pillbox(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const R0 = f === "cantons" ? 0.38 : 0.44;
  if (f === "cantons") ringBase(g, f, r, 0, 0.5);
  const oct = (rad: number): void => {
    g.beginPath();
    for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + (k * Math.PI) / 4, x = cx + Math.cos(a) * u * rad, y = cy + Math.sin(a) * u * rad; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
    g.closePath();
  };
  const t = f === "cantons" ? "#8a8a70" : f === "choir" ? "#3a2226" : f === "halcyon" ? "#3a3b42" : "#b0b8c2";
  const gr = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  gr.addColorStop(0, shade(t, 1.2)); gr.addColorStop(1, shade(t, 0.7));
  oct(R0); g.fillStyle = gr; g.fill(); g.strokeStyle = P.dark; g.lineWidth = Math.max(1, u * 0.03); g.stroke();
  // The flat roof slab inside the thick wall.
  oct(R0 * 0.66); g.fillStyle = shade(t, 0.92); g.fill(); g.strokeStyle = rgba(P.dark, 0.7); g.lineWidth = Math.max(1, u * 0.018); g.stroke();
  // Eight firing slits, one per side.
  g.fillStyle = "#070707";
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    g.save(); g.translate(cx + Math.cos(a) * u * R0 * 0.84, cy + Math.sin(a) * u * R0 * 0.84); g.rotate(a + Math.PI / 2);
    g.fillRect(-u * 0.07, -u * 0.022, u * 0.14, u * 0.044); g.restore();
  }
  emblem(g, f, cx - u * 0.04, cy - u * 0.04, u * 0.2, 0.9);
  disc(g, cx + u * 0.11, cy + u * 0.11, u * 0.045, shade(t, 0.75), P.dark); // hatch
}

/** Signature: one very long, thick barrel with a muzzle brake, reaching the top edge. */
function antiArmorCannon(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, { cx, cy, u } = ringBase(g, f, r, 0.12, 0.35);
  block(g, f, cx - u * 0.13, cy - u * 0.16, u * 0.26, u * 0.26, roofTone(f), 22); // breech
  barrel(g, cx, cy - u * 0.1, cx, cy - u * 0.52, u * 0.1, shade(P.dark, 1.4), P.dark);
  block(g, "concord", cx - u * 0.09, cy - u * 0.59, u * 0.18, u * 0.08, shade(P.dark, 1.3), 23); // muzzle brake
  g.strokeStyle = shade(P.mid, 1.1); g.lineWidth = u * 0.07; g.lineCap = "butt"; // curved gun shield
  g.beginPath(); g.arc(cx, cy + u * 0.02, u * 0.2, -Math.PI * 0.86, -Math.PI * 0.14); g.stroke();
  g.strokeStyle = P.dark; g.lineWidth = Math.max(1, u * 0.012);
  g.beginPath(); g.arc(cx, cy + u * 0.02, u * 0.235, -Math.PI * 0.86, -Math.PI * 0.14); g.stroke();
  if (f === "choir") crystals(g, cx + u * 0.2, cy + u * 0.18, u * 0.08, 23);
  if (f === "halcyon") rivets(g, cx - u * 0.14, cy + u * 0.2, cx + u * 0.14, cy + u * 0.2, 4, u * 0.02, P.accent);
  if (f === "concord") stripe(g, f, cx - u * 0.14, cy + u * 0.18, u * 0.28, u * 0.04);
}

/** Signature: a square launcher packed with a 3 × 3 grid of red missile tips. */
function missileTower(g: G, f: FactionId, r: R): void {
  const P = look(f).palette, u = Math.min(r.w, r.h);
  block(g, f, r.x + r.w * 0.06, r.y + r.h * 0.06, r.w * 0.88, r.h * 0.88, roofTone(f), 24);
  for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 3; ix++) {
    const x = r.x + r.w * (0.29 + ix * 0.19), y = r.y + r.h * (0.35 + iy * 0.19);
    disc(g, x, y, u * 0.078, "#161616", "#000000");
    disc(g, x, y, u * 0.052, SIG.missile, shade(SIG.missile, 0.5));
    g.strokeStyle = SIG.missileBand; g.lineWidth = Math.max(1, u * 0.012);
    g.beginPath(); g.arc(x, y, u * 0.034, 0, TAU); g.stroke();
  }
  disc(g, r.x + r.w * 0.82, r.y + r.h * 0.16, u * 0.075, SIG.dish, "#333333"); // radar
  disc(g, r.x + r.w * 0.82, r.y + r.h * 0.16, u * 0.018, "#8a8f96", "#222222");
  if (f === "concord") stripe(g, f, r.x + r.w * 0.14, r.y + r.h * 0.86, r.w * 0.6, u * 0.035);
  if (f === "cantons") rust(g, r.x + r.w * 0.16, r.y + r.h * 0.18, u * 0.06, 25);
  if (f === "choir") banner(g, r.x + r.w * 0.1, r.y + r.h * 0.1, u * 0.09, u * 0.22);
  if (f === "halcyon") hex(g, r.x + r.w * 0.16, r.y + r.h * 0.16, u * 0.05, "#1c1c22", P.accent);
}

const DRAW: Record<ArtBuildingType, (g: G, f: FactionId, r: R) => void> = {
  constructionYard, powerPlant, refinery, barracks, warFactory, lab, turret, pillbox, antiArmorCannon, missileTower, resonanceTap,
};

/** Draw a faction building into the rectangle (x, y, w, h) — the building fills it. */
export function drawFactionBuilding(g: G, f: FactionId, type: ArtBuildingType, x: number, y: number, w: number, h: number): void {
  const r: R = { x, y, w, h };
  const big = type === "constructionYard" || type === "powerPlant" || type === "refinery" || type === "barracks" || type === "warFactory" || type === "lab" || type === "resonanceTap";
  if (big) pad(g, f, r);
  DRAW[type](g, f, r);
  if (f === "choir" && big) banner(g, x + w * 0.02, y + h * 0.3, Math.min(w, h) * 0.07, Math.min(w, h) * 0.22);
}
