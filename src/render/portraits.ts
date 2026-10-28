// 27 §F / 29 §E — commander & character portraits and faction emblems. Real art is picked up from
// src/assets/portraits/<id>.png (Vite glob, no 404s); until then a procedural bust is drawn from the
// PortraitSpec in content/factions.ts. The procedural version is also the Art Lab's guide image, so
// its framing (head-and-shoulders, ¾ light from the top-left, rim light in the faction colour) is the
// composition the final art keeps. Render-only.

import { FACTIONS, characterInfo, type EmblemShape, type PortraitSpec } from "../content/factions";
import type { FactionId } from "../core/types";

let version = 0;
const real = new Map<string, HTMLImageElement>();
const urls = new Map<string, string>();
const cache = new Map<string, HTMLCanvasElement>();
let started = false;

function start(): void {
  if (started) return;
  started = true;
  if (typeof Image === "undefined") return;
  const files = import.meta.glob("../assets/portraits/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
  for (const [path, url] of Object.entries(files)) {
    const id = path.slice(path.lastIndexOf("/") + 1, -4);
    urls.set(id, url);
    const img = new Image();
    img.onload = () => { real.set(id, img); cache.clear(); version++; };
    img.src = url;
  }
}

/** Bumps whenever a real portrait finishes loading (UI re-renders its cards). */
export function portraitVersion(): number { start(); return version; }
export function realPortraitUrl(id: string): string | null { start(); return urls.get(id) ?? null; }

/** A square portrait canvas (real art if present, else procedural). Cached per id + size. */
export function portraitCanvas(id: string, size: number): HTMLCanvasElement {
  start();
  const key = `${id}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = real.get(id);
  if (img) {
    const s = Math.min(img.width, img.height);
    g.imageSmoothingQuality = "high";
    g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  } else {
    drawProcedural(g, id, size);
  }
  cache.set(key, c);
  return c;
}

// ── procedural bust ───────────────────────────────────────────────────────────────────────────────

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawProcedural(g: CanvasRenderingContext2D, id: string, S: number): void {
  const info = characterInfo(id);
  const spec = info?.portrait;
  const fac = info && info.faction !== "none" ? FACTIONS[info.faction] : null;
  const rim = fac?.color ?? "#9aa4b2";
  const bg = spec?.bg ?? "#14161a";

  // Backdrop: deep radial gradient + a faint emblem watermark.
  const grad = g.createRadialGradient(S * 0.42, S * 0.38, S * 0.05, S * 0.5, S * 0.5, S * 0.75);
  grad.addColorStop(0, shade(bg, 1.9));
  grad.addColorStop(1, shade(bg, 0.7));
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  if (fac) {
    g.save();
    g.globalAlpha = 0.09;
    g.drawImage(emblemCanvas(fac.id, Math.round(S * 0.9)), S * 0.32, S * 0.02, S * 0.9, S * 0.9);
    g.restore();
  }
  if (!spec || id === "narrator") return;
  if (id === "meridian") { drawMeridian(g, S, rim); return; }

  const cx = S * 0.5, headY = S * 0.42, headW = S * 0.25, headH = S * 0.31;

  // Shoulders + uniform.
  g.fillStyle = spec.uniform;
  g.beginPath();
  g.moveTo(S * 0.06, S);
  g.bezierCurveTo(S * 0.1, S * 0.76, S * 0.26, S * 0.7, cx, S * 0.7);
  g.bezierCurveTo(S * 0.74, S * 0.7, S * 0.9, S * 0.76, S * 0.94, S);
  g.closePath();
  g.fill();
  // Uniform shading (light from the top-left) + collar + shoulder boards in the trim colour.
  const ug = g.createLinearGradient(0, S * 0.7, S, S);
  ug.addColorStop(0, "rgba(255,255,255,0.10)");
  ug.addColorStop(1, "rgba(0,0,0,0.35)");
  g.fillStyle = ug;
  g.fill();
  g.fillStyle = shade(spec.uniform, 0.7);
  g.beginPath();
  g.moveTo(cx - S * 0.1, S * 0.7); g.lineTo(cx, S * 0.83); g.lineTo(cx + S * 0.1, S * 0.7); g.closePath();
  g.fill();
  g.fillStyle = spec.trim;
  g.fillRect(S * 0.16, S * 0.79, S * 0.13, S * 0.025);
  g.fillRect(S * 0.71, S * 0.79, S * 0.13, S * 0.025);
  // Insignia pin.
  g.beginPath(); g.arc(S * 0.66, S * 0.88, S * 0.022, 0, Math.PI * 2); g.fill();

  // Hood behind the head.
  if (spec.hairStyle === "hood" || spec.headwear === "hood") {
    g.fillStyle = shade(spec.uniform, 0.85);
    g.beginPath();
    g.ellipse(cx, headY - S * 0.01, headW * 1.32, headH * 1.25, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Long hair falls behind the shoulders.
  if (spec.hairStyle === "long" || spec.hairStyle === "braids") {
    g.fillStyle = spec.hair;
    g.beginPath();
    g.ellipse(cx, headY + S * 0.1, headW * 1.18, headH * 1.15, 0, 0, Math.PI * 2);
    g.fill();
    if (spec.hairStyle === "braids") {
      g.strokeStyle = shade(spec.hair, 1.4); g.lineWidth = S * 0.012;
      for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) {
        g.beginPath(); g.arc(cx + sx * headW * 1.05, headY + S * 0.08 + k * S * 0.045, S * 0.02, 0, Math.PI); g.stroke();
      }
    }
  }

  // Neck.
  g.fillStyle = shade(spec.skin, 0.82);
  g.fillRect(cx - S * 0.065, headY + headH * 0.62, S * 0.13, S * 0.14);

  // Head with ¾ shading.
  const hg = g.createRadialGradient(cx - headW * 0.35, headY - headH * 0.3, S * 0.02, cx, headY, headW * 1.3);
  hg.addColorStop(0, shade(spec.skin, 1.12));
  hg.addColorStop(0.65, spec.skin);
  hg.addColorStop(1, shade(spec.skin, 0.62));
  g.fillStyle = hg;
  g.beginPath();
  g.ellipse(cx, headY, headW, headH, 0, 0, Math.PI * 2);
  g.fill();
  // Ears.
  g.fillStyle = shade(spec.skin, 0.85);
  for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * headW * 0.98, headY + S * 0.01, S * 0.022, S * 0.04, 0, 0, Math.PI * 2); g.fill(); }

  const masked = spec.headwear === "mask";
  if (masked) drawMask(g, cx, headY, headW, headH, S, spec);
  else drawFace(g, cx, headY, headW, headH, S, spec);

  drawHair(g, cx, headY, headW, headH, spec);
  drawHeadwear(g, cx, headY, headW, headH, S, spec);

  // Rim light on the right edge in the faction colour.
  g.save();
  g.globalCompositeOperation = "lighter";
  const rg = g.createLinearGradient(cx + headW * 0.4, 0, cx + headW * 1.25, 0);
  rg.addColorStop(0, "rgba(0,0,0,0)");
  rg.addColorStop(1, alpha(rim, 0.45));
  g.fillStyle = rg;
  g.beginPath(); g.ellipse(cx, headY, headW * 1.02, headH * 1.02, 0, -Math.PI * 0.45, Math.PI * 0.45); g.lineTo(cx, headY); g.fill();
  const rs = g.createLinearGradient(S * 0.6, 0, S, 0);
  rs.addColorStop(0, "rgba(0,0,0,0)");
  rs.addColorStop(1, alpha(rim, 0.35));
  g.fillStyle = rs;
  g.fillRect(S * 0.6, S * 0.72, S * 0.4, S * 0.28);
  g.restore();

  // Vignette.
  const vg = g.createRadialGradient(cx, S * 0.5, S * 0.35, cx, S * 0.5, S * 0.78);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);
}

function drawFace(g: CanvasRenderingContext2D, cx: number, hy: number, hw: number, hh: number, S: number, spec: PortraitSpec): void {
  const eyeY = hy - hh * 0.08, eyeDX = hw * 0.4;
  // Brows.
  g.strokeStyle = shade(spec.hair === "#e8e0f0" ? "#8a8090" : spec.hair, spec.age === "old" ? 1.0 : 0.9);
  g.lineWidth = S * 0.013;
  g.lineCap = "round";
  for (const sx of [-1, 1]) {
    g.beginPath(); g.moveTo(cx + sx * eyeDX - S * 0.035, eyeY - S * 0.04); g.lineTo(cx + sx * eyeDX + S * 0.03, eyeY - S * 0.047 + (sx > 0 ? 0.004 * S : 0)); g.stroke();
  }
  // Eyes.
  for (const sx of [-1, 1]) {
    g.fillStyle = "#eee8e0";
    g.beginPath(); g.ellipse(cx + sx * eyeDX, eyeY, S * 0.03, S * 0.015, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = spec.eyes;
    g.beginPath(); g.arc(cx + sx * eyeDX + S * 0.004, eyeY, S * 0.012, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#0a0806";
    g.beginPath(); g.arc(cx + sx * eyeDX + S * 0.004, eyeY, S * 0.005, 0, Math.PI * 2); g.fill();
  }
  // Nose (shadow on the far side) + mouth.
  g.strokeStyle = shade(spec.skin, 0.6); g.lineWidth = S * 0.009;
  g.beginPath(); g.moveTo(cx + S * 0.005, eyeY + S * 0.02); g.lineTo(cx + S * 0.02, hy + hh * 0.27); g.lineTo(cx - S * 0.012, hy + hh * 0.3); g.stroke();
  g.strokeStyle = shade(spec.skin, 0.5); g.lineWidth = S * 0.011;
  g.beginPath(); g.moveTo(cx - S * 0.045, hy + hh * 0.5); g.quadraticCurveTo(cx, hy + hh * 0.53, cx + S * 0.045, hy + hh * 0.49); g.stroke();
  // Age lines.
  if (spec.age === "old") {
    g.strokeStyle = alpha("#000000", 0.18); g.lineWidth = S * 0.006;
    for (const sx of [-1, 1]) {
      g.beginPath(); g.moveTo(cx + sx * hw * 0.62, eyeY + S * 0.005); g.lineTo(cx + sx * hw * 0.74, eyeY + S * 0.02); g.stroke();
      g.beginPath(); g.moveTo(cx + sx * S * 0.055, hy + hh * 0.33); g.quadraticCurveTo(cx + sx * S * 0.075, hy + hh * 0.43, cx + sx * S * 0.06, hy + hh * 0.52); g.stroke();
    }
  }
  // Marks.
  switch (spec.mark) {
    case "scar":
      g.strokeStyle = alpha("#f0d0c0", 0.75); g.lineWidth = S * 0.008;
      g.beginPath(); g.moveTo(cx + eyeDX + S * 0.01, eyeY - S * 0.06); g.lineTo(cx + eyeDX - S * 0.02, eyeY + S * 0.09); g.stroke();
      break;
    case "glasses":
      g.strokeStyle = "#1a1612"; g.lineWidth = S * 0.009;
      for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * eyeDX, eyeY, S * 0.045, S * 0.032, 0, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(cx - eyeDX + S * 0.045, eyeY); g.lineTo(cx + eyeDX - S * 0.045, eyeY); g.stroke();
      g.fillStyle = "rgba(255,255,255,0.18)";
      for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * eyeDX - S * 0.012, eyeY - S * 0.01, S * 0.014, S * 0.008, -0.5, 0, Math.PI * 2); g.fill(); }
      break;
    case "beard":
      g.fillStyle = spec.hair;
      g.beginPath();
      g.moveTo(cx - hw * 0.9, hy + hh * 0.05);
      g.quadraticCurveTo(cx - hw * 0.85, hy + hh * 1.15, cx, hy + hh * 1.12);
      g.quadraticCurveTo(cx + hw * 0.85, hy + hh * 1.15, cx + hw * 0.9, hy + hh * 0.05);
      g.quadraticCurveTo(cx + hw * 0.5, hy + hh * 0.42, cx, hy + hh * 0.42);
      g.quadraticCurveTo(cx - hw * 0.5, hy + hh * 0.42, cx - hw * 0.9, hy + hh * 0.05);
      g.fill();
      g.strokeStyle = shade(spec.skin, 0.5); g.lineWidth = S * 0.01;
      g.beginPath(); g.moveTo(cx - S * 0.04, hy + hh * 0.52); g.lineTo(cx + S * 0.04, hy + hh * 0.51); g.stroke();
      break;
    case "stubble":
      g.fillStyle = alpha("#000000", 0.16);
      g.beginPath(); g.ellipse(cx, hy + hh * 0.55, hw * 0.75, hh * 0.38, 0, 0, Math.PI); g.fill();
      break;
    case "crystal":
      g.fillStyle = alpha("#c4a0ff", 0.85);
      for (const [dx, dy, s] of [[0.55, 0.15, 1], [0.68, 0.0, 0.7], [0.6, 0.32, 0.6]] as const) {
        const x = cx + hw * dx, y = hy + hh * dy, r = S * 0.03 * s;
        g.beginPath(); g.moveTo(x, y - r * 1.8); g.lineTo(x + r, y); g.lineTo(x, y + r * 0.6); g.lineTo(x - r, y); g.closePath(); g.fill();
      }
      break;
    case "freckles":
      g.fillStyle = alpha("#3a2010", 0.35);
      for (let k = 0; k < 14; k++) {
        const a = k * 2.399, rr = (k % 5) * 0.012 * S + 0.01 * S;
        g.beginPath(); g.arc(cx + Math.cos(a) * rr * (k % 2 ? 1 : -1) * 1.6, hy + hh * 0.12 + Math.sin(a) * rr * 0.5, S * 0.0045, 0, Math.PI * 2); g.fill();
      }
      break;
    case "none":
      break;
  }
}

function drawMask(g: CanvasRenderingContext2D, cx: number, hy: number, hw: number, hh: number, S: number, spec: PortraitSpec): void {
  // A smooth, featureless mask with two burning eye-slits (the Penitent).
  const mg = g.createLinearGradient(cx - hw, hy - hh, cx + hw, hy + hh);
  mg.addColorStop(0, "#d8d0c8");
  mg.addColorStop(0.55, "#a8a098");
  mg.addColorStop(1, "#4a4440");
  g.fillStyle = mg;
  g.beginPath(); g.ellipse(cx, hy + S * 0.005, hw * 0.92, hh * 0.98, 0, 0, Math.PI * 2); g.fill();
  g.save();
  g.shadowColor = spec.eyes; g.shadowBlur = S * 0.04;
  g.fillStyle = spec.eyes;
  for (const sx of [-1, 1]) {
    g.beginPath(); g.ellipse(cx + sx * hw * 0.4, hy - hh * 0.08, S * 0.035, S * 0.008, sx * -0.12, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  g.strokeStyle = alpha("#000000", 0.25); g.lineWidth = S * 0.006;
  g.beginPath(); g.moveTo(cx, hy - hh * 0.9); g.lineTo(cx, hy + hh * 0.9); g.stroke(); // seam
}

function drawHair(g: CanvasRenderingContext2D, cx: number, hy: number, hw: number, hh: number, spec: PortraitSpec): void {
  if (spec.hairStyle === "bald" || spec.hairStyle === "none" || spec.hairStyle === "hood") {
    if (spec.hairStyle === "bald") {
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.beginPath(); g.ellipse(cx - hw * 0.3, hy - hh * 0.7, hw * 0.35, hh * 0.15, -0.3, 0, Math.PI * 2); g.fill();
    }
    return;
  }
  const hairG = g.createLinearGradient(cx - hw, hy - hh, cx + hw, hy);
  hairG.addColorStop(0, shade(spec.hair, 1.25));
  hairG.addColorStop(1, shade(spec.hair, 0.75));
  g.fillStyle = hairG;
  const top = hy - hh;
  const cover = spec.hairStyle === "buzz" ? 0.45 : spec.hairStyle === "crop" ? 0.55 : 0.68;
  g.beginPath();
  g.ellipse(cx, hy - hh * 0.18, hw * 1.04, hh * cover + hh * 0.18, 0, Math.PI * 1.02, Math.PI * 1.98);
  g.quadraticCurveTo(cx + hw * 0.6, top + hh * 0.42, cx - hw * 0.15, top + hh * 0.36);
  g.quadraticCurveTo(cx - hw * 0.7, top + hh * 0.45, cx - hw * 1.03, hy - hh * 0.12);
  g.closePath();
  g.fill();
  if (spec.hairStyle === "bun") {
    g.beginPath(); g.ellipse(cx + hw * 0.25, top - hh * 0.05, hw * 0.38, hh * 0.22, 0.3, 0, Math.PI * 2); g.fill();
  }
  if (spec.hairStyle === "long") {
    g.beginPath(); g.ellipse(cx - hw * 0.95, hy + hh * 0.2, hw * 0.22, hh * 0.75, 0.1, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + hw * 0.95, hy + hh * 0.2, hw * 0.22, hh * 0.75, -0.1, 0, Math.PI * 2); g.fill();
  }
}

function drawHeadwear(g: CanvasRenderingContext2D, cx: number, hy: number, hw: number, hh: number, S: number, spec: PortraitSpec): void {
  const top = hy - hh;
  switch (spec.headwear) {
    case "beret": {
      g.fillStyle = shade(spec.uniform, 1.15);
      g.beginPath(); g.ellipse(cx - hw * 0.15, top + hh * 0.18, hw * 1.15, hh * 0.32, -0.18, 0, Math.PI * 2); g.fill();
      g.fillStyle = spec.trim;
      g.beginPath(); g.arc(cx - hw * 0.62, top + hh * 0.3, S * 0.022, 0, Math.PI * 2); g.fill();
      break;
    }
    case "cap": {
      g.fillStyle = shade(spec.uniform, 1.1);
      g.beginPath(); g.ellipse(cx, top + hh * 0.28, hw * 1.06, hh * 0.36, 0, Math.PI, Math.PI * 2); g.fill();
      g.fillStyle = shade(spec.uniform, 0.7);
      g.beginPath(); g.ellipse(cx - hw * 0.15, top + hh * 0.3, hw * 1.0, hh * 0.09, -0.05, 0, Math.PI * 2); g.fill();
      break;
    }
    case "headset": {
      g.strokeStyle = "#1a1c20"; g.lineWidth = S * 0.018;
      g.beginPath(); g.ellipse(cx, hy - hh * 0.1, hw * 1.08, hh * 0.95, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      g.fillStyle = "#24272c";
      g.beginPath(); g.ellipse(cx - hw * 1.02, hy + S * 0.01, S * 0.03, S * 0.05, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#24272c"; g.lineWidth = S * 0.008;
      g.beginPath(); g.moveTo(cx - hw * 1.0, hy + S * 0.05); g.quadraticCurveTo(cx - hw * 0.8, hy + hh * 0.55, cx - hw * 0.25, hy + hh * 0.5); g.stroke();
      break;
    }
    case "veil": {
      g.fillStyle = alpha("#f4ecff", 0.22);
      g.beginPath(); g.ellipse(cx, hy - hh * 0.05, hw * 1.25, hh * 1.18, 0, Math.PI * 0.95, Math.PI * 2.05); g.fill();
      g.strokeStyle = alpha(spec.trim, 0.8); g.lineWidth = S * 0.006;
      g.beginPath(); g.ellipse(cx, top + hh * 0.18, hw * 0.9, hh * 0.16, 0, 0, Math.PI * 2); g.stroke(); // circlet
      break;
    }
    case "hood": case "mask": case "none":
      break;
  }
  if (spec.hairStyle === "hood" || spec.headwear === "hood") {
    // Hood rim over the forehead.
    g.strokeStyle = shade(spec.uniform, 0.6); g.lineWidth = S * 0.03;
    g.beginPath(); g.ellipse(cx, hy - hh * 0.02, hw * 1.12, hh * 1.08, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
  }
}

/** MERIDIAN: an abstract corporate AI glyph instead of a face. */
function drawMeridian(g: CanvasRenderingContext2D, S: number, col: string): void {
  const cx = S / 2, cy = S * 0.48;
  g.save();
  g.shadowColor = col; g.shadowBlur = S * 0.06;
  g.strokeStyle = col; g.lineWidth = S * 0.02;
  hexPath(g, cx, cy, S * 0.3); g.stroke();
  g.lineWidth = S * 0.01;
  hexPath(g, cx, cy, S * 0.22); g.stroke();
  g.fillStyle = col;
  g.beginPath(); g.ellipse(cx, cy, S * 0.12, S * 0.05, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#0a0a0c";
  g.beginPath(); g.arc(cx, cy, S * 0.035, 0, Math.PI * 2); g.fill();
  g.restore();
  g.fillStyle = alpha(col, 0.5);
  for (let k = 0; k < 7; k++) g.fillRect(cx - S * 0.25 + k * S * 0.075, S * 0.84, S * 0.05, S * 0.012 * (1 + (k % 3)));
}

function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

// ── faction emblems (vector; crisp at any size) ───────────────────────────────────────────────────

/** A square, transparent-background emblem for a faction. Cached per faction + size. */
export function emblemCanvas(faction: FactionId, size: number): HTMLCanvasElement {
  const key = `emblem:${faction}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  drawEmblem(c.getContext("2d")!, FACTIONS[faction].emblem, FACTIONS[faction].color, FACTIONS[faction].colorDeep, size);
  cache.set(key, c);
  return c;
}

function drawEmblem(g: CanvasRenderingContext2D, shape: EmblemShape, col: string, deep: string, S: number): void {
  const cx = S / 2, cy = S / 2;
  g.lineJoin = "round";
  switch (shape) {
    case "custodyBar": {
      // Shield → white ring → the vertical Custody Bar.
      g.fillStyle = deep; g.strokeStyle = col; g.lineWidth = S * 0.05;
      g.beginPath();
      g.moveTo(cx, S * 0.05); g.lineTo(S * 0.88, S * 0.18); g.lineTo(S * 0.84, S * 0.58);
      g.quadraticCurveTo(S * 0.78, S * 0.82, cx, S * 0.96);
      g.quadraticCurveTo(S * 0.22, S * 0.82, S * 0.16, S * 0.58); g.lineTo(S * 0.12, S * 0.18); g.closePath();
      g.fill(); g.stroke();
      g.strokeStyle = "#eef3ff"; g.lineWidth = S * 0.06;
      g.beginPath(); g.arc(cx, S * 0.48, S * 0.2, 0, Math.PI * 2); g.stroke();
      g.fillStyle = "#eef3ff";
      g.fillRect(cx - S * 0.035, S * 0.2, S * 0.07, S * 0.58);
      break;
    }
    case "risingSun": {
      // Hexagon with a half-sun rising from a horizon line.
      g.fillStyle = deep; g.strokeStyle = col; g.lineWidth = S * 0.05;
      hexPath(g, cx, cy, S * 0.44); g.fill(); g.stroke();
      g.save();
      hexPath(g, cx, cy, S * 0.4); g.clip();
      g.fillStyle = col;
      g.beginPath(); g.arc(cx, S * 0.64, S * 0.17, Math.PI, 0); g.fill();
      g.strokeStyle = col; g.lineWidth = S * 0.04; g.lineCap = "round";
      for (let k = 0; k < 7; k++) {
        const a = Math.PI + (k + 0.5) * (Math.PI / 7);
        g.beginPath(); g.moveTo(cx + Math.cos(a) * S * 0.22, S * 0.64 + Math.sin(a) * S * 0.22); g.lineTo(cx + Math.cos(a) * S * 0.32, S * 0.64 + Math.sin(a) * S * 0.32); g.stroke();
      }
      g.fillRect(S * 0.12, S * 0.66, S * 0.76, S * 0.04);
      g.restore();
      break;
    }
    case "threeChevrons": {
      g.fillStyle = deep; g.strokeStyle = col; g.lineWidth = S * 0.05;
      g.beginPath(); g.arc(cx, cy, S * 0.43, 0, Math.PI * 2); g.fill(); g.stroke();
      g.strokeStyle = "#eafff0"; g.lineWidth = S * 0.075; g.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        const y = S * (0.36 + k * 0.17);
        g.beginPath(); g.moveTo(S * 0.27, y + S * 0.1); g.lineTo(cx, y - S * 0.04); g.lineTo(S * 0.73, y + S * 0.1); g.stroke();
      }
      break;
    }
    case "hollowSun": {
      // Seven rays around a black ring with a hollow centre.
      g.fillStyle = col;
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k * Math.PI * 2) / 7;
        const ax = Math.cos(a), ay = Math.sin(a), px = -ay, py = ax;
        g.beginPath();
        g.moveTo(cx + ax * S * 0.26 + px * S * 0.07, cy + ay * S * 0.26 + py * S * 0.07);
        g.lineTo(cx + ax * S * 0.48, cy + ay * S * 0.48);
        g.lineTo(cx + ax * S * 0.26 - px * S * 0.07, cy + ay * S * 0.26 - py * S * 0.07);
        g.closePath(); g.fill();
      }
      g.fillStyle = "#0c0606";
      g.beginPath(); g.arc(cx, cy, S * 0.29, 0, Math.PI * 2); g.fill();
      g.strokeStyle = col; g.lineWidth = S * 0.035;
      g.beginPath(); g.arc(cx, cy, S * 0.29, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = deep; g.lineWidth = S * 0.02;
      g.beginPath(); g.arc(cx, cy, S * 0.15, 0, Math.PI * 2); g.stroke();
      break;
    }
  }
}
