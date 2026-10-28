// 27 §H — drawing kit for the procedural faction art (units + buildings). Each faction has a shape
// language (Concord chamfered, Halcyon rounded, Cantons irregular, Choir pointed) and a palette from
// content/factionArt.ts. Everything is lit from the top-left with self-shading only (no cast
// shadows: the game draws those). Deterministic: no Math.random. Render-only.

import { FACTION_LOOK } from "../../content/factionArt";
import type { FactionId } from "../../core/types";
import { emblemCanvas } from "../portraits";

export type G = CanvasRenderingContext2D;

/** Deterministic 0..1 hash (stable art across reloads). */
export function h01(a: number, b: number, s: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Shade a hex colour: f < 1 darker, f > 1 lighter (toward white). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f <= 1) { r *= f; g *= f; b *= f; } else { const t = Math.min(1, f - 1); r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const look = (f: FactionId) => FACTION_LOOK[f];

// ── faction-shaped outlines ─────────────────────────────────────────────────────────────────────

/** Trace a block outline in the faction's shape language (x,y = top-left, w×h). */
export function blockPath(g: G, f: FactionId, x: number, y: number, w: number, h: number, seed = 0): void {
  const m = Math.min(w, h);
  g.beginPath();
  switch (f) {
    case "concord": { // chamfered corners
      const c = m * 0.16;
      g.moveTo(x + c, y); g.lineTo(x + w - c, y); g.lineTo(x + w, y + c); g.lineTo(x + w, y + h - c);
      g.lineTo(x + w - c, y + h); g.lineTo(x + c, y + h); g.lineTo(x, y + h - c); g.lineTo(x, y + c);
      break;
    }
    case "halcyon": { // smooth rounded
      const r = m * 0.24;
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
      break;
    }
    case "cantons": { // slightly irregular, welded together
      const j = (k: number): number => (h01(seed, k, 77) - 0.5) * m * 0.07;
      g.moveTo(x + j(1), y + j(2)); g.lineTo(x + w * 0.55, y + j(3)); g.lineTo(x + w + j(4), y + j(5));
      g.lineTo(x + w + j(6), y + h * 0.5); g.lineTo(x + w + j(7), y + h + j(8)); g.lineTo(x + w * 0.4, y + h + j(9));
      g.lineTo(x + j(10), y + h + j(11)); g.lineTo(x + j(12), y + h * 0.45);
      break;
    }
    case "choir": { // pointed gables at the front and back, narrow chamfers
      const c = m * 0.1, p = m * 0.14;
      g.moveTo(x + c, y); g.lineTo(x + w / 2, y - p * 0.6); g.lineTo(x + w - c, y); g.lineTo(x + w, y + c);
      g.lineTo(x + w, y + h - c); g.lineTo(x + w - c, y + h); g.lineTo(x + w / 2, y + h + p * 0.6);
      g.lineTo(x + c, y + h); g.lineTo(x, y + h - c); g.lineTo(x, y + c);
      break;
    }
  }
  g.closePath();
}

/**
 * A lit block (roof slab / hull plate): body gradient lit from the top-left, a darker bottom-right
 * rim, a bright top-left edge and a crisp outline. `tone` is the body colour.
 */
export function block(g: G, f: FactionId, x: number, y: number, w: number, h: number, tone: string, seed = 0): void {
  const L = look(f).palette;
  blockPath(g, f, x, y, w, h, seed);
  const gr = g.createLinearGradient(x, y, x + w, y + h);
  gr.addColorStop(0, shade(tone, 1.18));
  gr.addColorStop(0.55, tone);
  gr.addColorStop(1, shade(tone, 0.72));
  g.fillStyle = gr;
  g.fill();
  // Bottom-right rim (self-shadow on the plate's own edge).
  g.save();
  blockPath(g, f, x, y, w, h, seed);
  g.clip();
  const rim = Math.max(1, Math.min(w, h) * 0.07);
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.fillRect(x, y + h - rim, w, rim + 4);
  g.fillRect(x + w - rim, y, rim + 4, h);
  g.fillStyle = "rgba(255,255,255,0.14)";
  g.fillRect(x - 2, y - 2, w + 4, rim * 0.6 + 2);
  g.fillRect(x - 2, y - 2, rim * 0.6 + 2, h + 4);
  g.restore();
  blockPath(g, f, x, y, w, h, seed);
  g.strokeStyle = shade(L.dark, 0.8);
  g.lineWidth = Math.max(1, Math.min(w, h) * 0.035);
  g.stroke();
}

/** A lit disc (domes, turrets, silos, heads). */
export function disc(g: G, cx: number, cy: number, r: number, tone: string, outline: string): void {
  const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  gr.addColorStop(0, shade(tone, 1.25));
  gr.addColorStop(0.6, tone);
  gr.addColorStop(1, shade(tone, 0.68));
  g.fillStyle = gr;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = outline; g.lineWidth = Math.max(1, r * 0.09); g.stroke();
}

/** A straight barrel / beam from (x0,y0) to (x1,y1). */
export function barrel(g: G, x0: number, y0: number, x1: number, y1: number, w: number, tone: string, outline: string): void {
  g.lineCap = "butt";
  g.strokeStyle = outline; g.lineWidth = w + Math.max(1, w * 0.3);
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = tone; g.lineWidth = w;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.22)"; g.lineWidth = Math.max(1, w * 0.3);
  g.beginPath(); g.moveTo(x0 - w * 0.2, y0); g.lineTo(x1 - w * 0.2, y1); g.stroke();
}

// ── faction decorations ─────────────────────────────────────────────────────────────────────────

/** The faction emblem stamped flat on a roof or hull. */
export function emblem(g: G, f: FactionId, cx: number, cy: number, size: number, alpha = 0.95): void {
  g.save();
  g.globalAlpha = alpha;
  g.drawImage(emblemCanvas(f, Math.max(16, Math.round(size * 2))), cx - size / 2, cy - size / 2, size, size);
  g.restore();
}

/** A thin identification stripe in the faction accent. */
export function stripe(g: G, f: FactionId, x: number, y: number, w: number, h: number): void {
  g.fillStyle = look(f).palette.accent;
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(x, y + h * 0.65, w, h * 0.35);
}

/** Halcyon hex vent / hatch. */
export function hex(g: G, cx: number, cy: number, r: number, fill: string, edge: string): void {
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = fill; g.fill();
  g.strokeStyle = edge; g.lineWidth = Math.max(1, r * 0.18); g.stroke();
}

/** A row of Canton sandbags along a line. */
export function sandbags(g: G, x0: number, y0: number, x1: number, y1: number, bag: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.floor(len / (bag * 1.05)));
  const ang = Math.atan2(y1 - y0, x1 - x0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    g.save(); g.translate(cx, cy); g.rotate(ang);
    g.fillStyle = i % 2 ? "#a99868" : "#b8a674";
    g.beginPath(); g.ellipse(0, 0, bag * 0.55, bag * 0.36, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#5a4e30"; g.lineWidth = Math.max(1, bag * 0.08); g.stroke();
    g.restore();
  }
}

/** Choir spikes along an edge (pointing outward along the normal). */
export function spikes(g: G, x0: number, y0: number, x1: number, y1: number, n: number, len: number, tone: string): void {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = dy / L, ny = -dx / L;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, cx = x0 + dx * t, cy = y0 + dy * t, b = (L / n) * 0.32;
    g.beginPath();
    g.moveTo(cx - (dx / L) * b, cy - (dy / L) * b); g.lineTo(cx + nx * len, cy + ny * len); g.lineTo(cx + (dx / L) * b, cy + (dy / L) * b);
    g.closePath(); g.fillStyle = tone; g.fill();
    g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 1; g.stroke();
  }
}

/** A Choir banner (seen from above: a cloth strip with a darker stripe and a frayed end). */
export function banner(g: G, x: number, y: number, w: number, h: number): void {
  g.fillStyle = "#b8202c";
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x + w / 2, y + h * 0.82); g.lineTo(x, y + h); g.closePath(); g.fill();
  g.fillStyle = "#6e0f18"; g.fillRect(x + w * 0.38, y, w * 0.24, h * 0.8);
  g.strokeStyle = "#2a0a0e"; g.lineWidth = 1; g.stroke();
}

/** A cluster of blue-violet Resonance crystals with a soft glow. Never magenta (it would be keyed). */
export function crystals(g: G, cx: number, cy: number, size: number, seed: number): void {
  g.save();
  g.shadowColor = "rgba(138,108,240,0.8)";
  g.shadowBlur = size * 0.6;
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k - 1) * 0.55 + (h01(seed, k, 5) - 0.5) * 0.3;
    const len = size * (0.7 + 0.5 * h01(seed, k, 6)), wdt = size * 0.22;
    const tx = cx + Math.cos(a) * len, ty = cy + Math.sin(a) * len;
    const px = -Math.sin(a) * wdt, py = Math.cos(a) * wdt;
    g.beginPath(); g.moveTo(cx + px, cy + py); g.lineTo(tx, ty); g.lineTo(cx - px, cy - py); g.closePath();
    const gr = g.createLinearGradient(cx, cy, tx, ty);
    gr.addColorStop(0, "#4a36a8"); gr.addColorStop(1, "#b4a4ff");
    g.fillStyle = gr; g.fill();
  }
  g.restore();
}

/** Small rivets / bolts along a line. */
export function rivets(g: G, x0: number, y0: number, x1: number, y1: number, n: number, r: number, tone: string): void {
  g.fillStyle = tone;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    g.beginPath(); g.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, 0, Math.PI * 2); g.fill();
  }
}

/** Rust / wear blotch (Cantons). */
export function rust(g: G, cx: number, cy: number, r: number, seed: number): void {
  g.fillStyle = `rgba(138,74,36,${0.35 + 0.25 * h01(seed, 1, 9)})`;
  g.beginPath(); g.ellipse(cx, cy, r, r * (0.5 + 0.5 * h01(seed, 2, 9)), h01(seed, 3, 9) * 3, 0, Math.PI * 2); g.fill();
}

// ── fitting ─────────────────────────────────────────────────────────────────────────────────────

/** Alpha bounding box (alpha ≥ 0.5) of a canvas, or null. */
export function alphaBounds(c: HTMLCanvasElement): { x0: number; y0: number; x1: number; y1: number } | null {
  const g = c.getContext("2d")!, { width: W, height: H } = c, d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] < 128) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * Draw a vector subject so its larger side spans exactly `footprint × size`, centred: draw once to
 * measure, then redraw with the corrective transform (crisp — the subject is vector).
 */
export function fitDraw(size: number, footprint: number, draw: (g: G, S: number) => void): HTMLCanvasElement {
  const probe = canvas(size, size);
  draw(probe.getContext("2d")!, size);
  const b = alphaBounds(probe);
  if (!b) return probe;
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0, s = (footprint * size) / Math.max(bw, bh);
  const out = canvas(size, size), g = out.getContext("2d")!;
  g.translate(size / 2, size / 2);
  g.scale(s, s);
  g.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
  draw(g, size);
  return out;
}
