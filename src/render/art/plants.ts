// Procedural BUSHES and TUFTS (26 §D). Bushes are top-down and fill ≈ 70% (radius 35 units).
// Tufts are the exception: a slightly raised FRONT view, base on the bottom edge at the centre,
// ≈ 60% wide, because the game sways them by skewing around that base.

import type { BiomeDef, BushSpecies, RGB, Tone, TuftSpecies } from "../../content/biomes";
import { css, darken, lighten } from "./noise";
import { branches, C, circle, facing, frond, glowDot, puffCrown, puffLayout, shard, tint, toneAt, toneOf, type G, type Rnd } from "./spriteKit";

const TAU = Math.PI * 2;
const R = 35;

export function drawBush(g: G, r: Rnd, sp: BushSpecies, b: BiomeDef, variant: number): void {
  const fol = b.foliage;
  switch (sp) {
    case "flowering": {
      puffCrown(g, r, puffLayout(r, C, C, R, 7, 0.4), tint(fol, [1.05, 1.1, 0.9]), R, C, C, 90);
      const petal: RGB = ([[236, 150, 186], [246, 244, 236], [240, 206, 80]] as RGB[])[variant % 3];
      for (let k = 0; k < 18; k++) {
        const a = r() * TAU, d = Math.sqrt(r()) * R * 0.85, x = C + Math.cos(a) * d, y = C + Math.sin(a) * d;
        g.fillStyle = css(petal);
        g.beginPath(); for (let p = 0; p < 5; p++) circle(g, x + Math.cos(p * 1.257) * 1.3, y + Math.sin(p * 1.257) * 1.3, 1); g.fill();
        g.fillStyle = css([250, 214, 90]);
        g.beginPath(); circle(g, x, y, 0.6); g.fill();
      }
      return;
    }
    case "boxwood": return puffCrown(g, r, puffLayout(r, C, C, R, 9, 0.36), tint(fol, [0.82, 1.0, 0.85]), R, C, C, 180);
    case "fern": return fronds(g, r, tint(fol, [1.05, 1.18, 0.9]), 9, 5);
    case "ashFern": return fronds(g, r, toneOf([50, 56, 46], [96, 104, 86], [152, 158, 138]), 8, 5);
    case "saltbush": return puffCrown(g, r, puffLayout(r, C, C, R, 10, 0.32), toneOf([84, 100, 90], [138, 152, 134], [196, 204, 186]), R, C, C, 150);
    case "tumbleweed": {
      g.lineWidth = 0.9;
      for (let k = 0; k < 90; k++) {
        const a = r() * TAU, d = Math.sqrt(r()) * R * 0.6, rr = 6 + r() * 12, a0 = r() * TAU;
        const x = C + Math.cos(a) * d, y = C + Math.sin(a) * d, lit = 0.5 - ((x - C) + (y - C)) / (R * 2.5) + (k / 90) * 0.35;
        g.strokeStyle = css(toneAt(toneOf([92, 70, 44], [156, 126, 82], [214, 190, 140]), lit), 0.9);
        g.beginPath(); g.arc(x, y, rr, a0, a0 + 1.2 + r()); g.stroke();
      }
      return;
    }
    case "dryShrub":
    case "deadShrub": {
      const tips: [number, number][] = [];
      branches(g, r, C, C, R, sp === "dryShrub" ? [118, 92, 62] : [74, 68, 62], 7, 2.2, 2, (x, y) => { tips.push([x, y]); });
      if (sp === "dryShrub") for (const [x, y] of tips) {
        g.fillStyle = css(toneAt(toneOf([86, 92, 56], [128, 132, 82], [176, 176, 120]), r()), 0.9);
        g.beginPath(); circle(g, x, y, 1.4 + r() * 1.4); g.fill();
      }
      return;
    }
    case "snowShrub": {
      const puffs = puffLayout(r, C, C, R, 8, 0.38);
      puffCrown(g, r, puffs, tint(fol, [0.9, 1.0, 0.95]), R, C, C, 60);
      for (const p of puffs) {
        g.fillStyle = css([186, 202, 220]);
        g.beginPath(); circle(g, p.x - p.r * 0.18, p.y - p.r * 0.2, p.r * 0.8); g.fill();
        g.fillStyle = css([246, 249, 253]);
        g.beginPath(); circle(g, p.x - p.r * 0.28, p.y - p.r * 0.32, p.r * 0.68); g.fill();
      }
      return;
    }
    case "emberMoss": {
      puffCrown(g, r, puffLayout(r, C, C, R, 9, 0.34), toneOf([24, 20, 18], [52, 44, 40], [86, 76, 68]), R, C, C, 130);
      for (let k = 0; k < 14; k++) {
        const a = r() * TAU, d = Math.sqrt(r()) * R * 0.8;
        glowDot(g, C + Math.cos(a) * d, C + Math.sin(a) * d, 0.6 + r() * 0.5, r() < 0.7 ? [255, 110, 36] : [255, 186, 80]);
      }
      return;
    }
    case "reedClump":
    case "cattail": {
      const tn = toneOf([70, 84, 40], [122, 134, 62], [184, 186, 106]);
      for (let k = 0; k < 26; k++) {
        const a = r() * TAU, len = R * (0.6 + 0.4 * r()), bend = (r() - 0.5) * 6, ex = C + Math.cos(a) * len, ey = C + Math.sin(a) * len;
        g.strokeStyle = css(toneAt(tn, 0.2 + facing(a) * 0.6 + (r() - 0.5) * 0.2));
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(C, C); g.quadraticCurveTo((C + ex) / 2 - Math.sin(a) * bend, (C + ey) / 2 + Math.cos(a) * bend, ex, ey); g.stroke();
        if (sp === "cattail" && k % 6 === 0) {
          g.save();
          g.translate(C + Math.cos(a) * len * 0.7, C + Math.sin(a) * len * 0.7); g.rotate(a);
          g.fillStyle = css([110, 70, 38]);
          g.beginPath(); g.ellipse(0, 0, 4, 1.8, 0, 0, TAU); g.fill();
          g.restore();
        }
      }
      return;
    }
    case "lilyMat": {
      const pads = 6;
      for (let k = 0; k < pads; k++) {
        const a = (k / pads) * TAU + r() * 0.4, pr = 9 + r() * 3, d = k === 0 ? 0 : R - pr; // pad 0 sits in the middle
        const x = C + Math.cos(a) * d, y = C + Math.sin(a) * d, notch = r() * TAU;
        const tn = tint(fol, [0.95, 1.08, 0.85]);
        const grd = g.createRadialGradient(x - pr * 0.4, y - pr * 0.4, 1, x, y, pr);
        grd.addColorStop(0, css(toneAt(tn, 0.85))); grd.addColorStop(1, css(toneAt(tn, 0.25)));
        g.fillStyle = grd;
        g.beginPath(); g.moveTo(x, y); g.arc(x, y, pr, notch + 0.3, notch + TAU - 0.3); g.closePath(); g.fill();
        g.strokeStyle = css(lighten(tn.light, 0.2), 0.4);
        g.lineWidth = 0.6;
        g.beginPath(); for (let v = 1; v < 7; v++) { const va = notch + 0.3 + (v / 7) * (TAU - 0.6); g.moveTo(x, y); g.lineTo(x + Math.cos(va) * pr * 0.9, y + Math.sin(va) * pr * 0.9); } g.stroke();
      }
      for (let p = 0; p < 8; p++) {
        const a = (p / 8) * TAU;
        g.fillStyle = css(p % 2 ? [246, 214, 230] : [236, 168, 200]);
        g.beginPath(); g.ellipse(C + 4 + Math.cos(a) * 2.6, C - 4 + Math.sin(a) * 2.6, 2.6, 1.3, a, 0, TAU); g.fill();
      }
      g.fillStyle = css([250, 214, 90]);
      g.beginPath(); circle(g, C + 4, C - 4, 1.2); g.fill();
      return;
    }
    case "crystalSprout": {
      const n = 5 + variant;
      for (let k = 0; k < n; k++) shard(g, C + (r() - 0.5) * 4, C + (r() - 0.5) * 4, (k / n) * TAU + r() * 0.5, R * (0.6 + 0.35 * r()), 4 + r() * 1.5, fol);
      return;
    }
  }
}

function fronds(g: G, r: Rnd, tn: Tone, n: number, w: number): void {
  for (let k = 0; k < n; k++) frond(g, C, C, (k / n) * TAU + r() * 0.35, R * (0.88 + 0.12 * r()), w, tn, 0.2 + (k % 2) * 0.4, (r() - 0.5) * 14, 16);
}

// ── tufts (front view) ──────────────────────────────────────────────────────────────────────────

/** A clump of blades rising from (50, 100); tips spread across x ∈ [20, 80]. */
export function drawTuft(g: G, r: Rnd, sp: TuftSpecies, tn: Tone, variant: number): void {
  const n = { grass: 9, dryGrass: 8, frostGrass: 9, ashGrass: 11, reed: 6, crystalGrass: 7 }[sp] + variant;
  const tall = sp === "reed" ? 1.15 : 1, w = sp === "ashGrass" ? 2.4 : sp === "reed" ? 3.6 : 3.4;
  const order = Array.from({ length: n }, (_, k) => ({ k, depth: r() }));
  order.sort((a, b) => a.depth - b.depth); // back (dark) blades first
  for (const { k, depth } of order) {
    const lean = n === 1 ? 0 : -1 + (2 * k) / (n - 1) + (r() - 0.5) * 0.12;
    const x0 = C + lean * 4 + (r() - 0.5) * 3, tx = C + Math.max(-1, Math.min(1, lean)) * 30;
    let h = (62 + 24 * (1 - Math.abs(lean)) + r() * 8) * tall;
    const droop = sp === "dryGrass" && k % 4 === 1;
    if (droop) h *= 0.6;
    const ty = Math.max(4, 100 - h), cx = x0 + (tx - x0) * (droop ? 0.7 : 0.25), cy = droop ? ty - 10 : 100 - h * 0.62;
    const lo = toneAt(tn, 0.1 + depth * 0.3), hi = sp === "frostGrass" ? [240, 246, 252] as RGB : toneAt(tn, 0.55 + depth * 0.45);
    if (sp === "crystalGrass") {
      for (const side of [-1, 1]) {
        g.fillStyle = css(side < 0 ? toneAt(tn, 0.55 + depth * 0.4) : toneAt(tn, 0.15 + depth * 0.25));
        g.beginPath(); g.moveTo(x0, 100); g.lineTo(x0 + side * w * 0.7, 100); g.lineTo(tx, ty); g.closePath(); g.fill();
      }
      g.fillStyle = css([246, 236, 255], 0.9);
      g.beginPath(); circle(g, tx, ty + 1, 1); g.fill();
      continue;
    }
    const grd = g.createLinearGradient(x0, 100, tx, ty);
    grd.addColorStop(0, css(darken(lo, 0.15)));
    grd.addColorStop(0.55, css(lo.map((v, i) => (v + hi[i]) / 2)));
    grd.addColorStop(1, css(hi));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x0 - w / 2, 100);
    g.quadraticCurveTo(cx - w * 0.35, cy, tx, ty);
    g.quadraticCurveTo(cx + w * 0.35, cy, x0 + w / 2, 100);
    g.closePath();
    g.fill();
    if (sp === "reed" && k % 3 === 1) { // cattail head near the top of the stem
      const hx = x0 + (tx - x0) * 0.78, hy = 100 - (100 - ty) * 0.82;
      g.fillStyle = css([112, 72, 40]);
      g.beginPath(); g.ellipse(hx, hy, 2.6, 7, Math.atan2(tx - x0, 100 - ty), 0, TAU); g.fill();
    }
  }
}
