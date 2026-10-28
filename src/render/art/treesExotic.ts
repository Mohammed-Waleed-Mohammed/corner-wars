// Procedural trees, part 2 (26 §D): desert (palm, acacia, cactus, thorn), bare (bareBirch, charred,
// burntPine), wetland (mangrove, willow, reeds), crystal (crystal, glassTree, crystalDead) and the
// ash fern. Same contract as trees.ts: 100-unit box, crown ≈ 85%, light from the top-left.

import type { BiomeDef, RGB, TreeSpecies } from "../../content/biomes";
import { css, darken, lighten } from "./noise";
import {
  branches, C, CROWN, circle, facing, frond, glowDot, puffCrown, puffLayout, shard, snowDots, starLayers, tint, toneAt, toneOf,
  type G, type Rnd,
} from "./spriteKit";

const TAU = Math.PI * 2;
type Pt = [number, number, number]; // x, y, angle

export function drawExoticTree(g: G, r: Rnd, sp: TreeSpecies, b: BiomeDef, variant: number): void {
  const fol = b.foliage, R = CROWN, snowy = b.weather === "snow";
  const tips: Pt[] = [];
  const keep = (x: number, y: number, a: number): void => { tips.push([x, y, a]); };
  switch (sp) {
    case "palm": {
      const tn = tint(fol, [1.0, 1.1, 0.85]), lower = 7 + (variant % 2);
      for (let k = 0; k < lower; k++) frond(g, C, C, (k / lower) * TAU + r() * 0.3, R * (0.9 + 0.1 * r()), 7, tn, 0.1, (r() - 0.5) * 12);
      for (let k = 0; k < 6; k++) frond(g, C, C, ((k + 0.5) / 6) * TAU + r() * 0.3, R * (0.66 + 0.1 * r()), 6.5, tn, 0.65, (r() - 0.5) * 10);
      ball(g, C - 0.5, C - 0.5, 5.5, [118, 88, 50]);
      for (let k = 0; k < 6; k++) {
        const a = r() * TAU;
        g.fillStyle = css([196, 116 + r() * 30, 40]);
        g.beginPath(); circle(g, C + Math.cos(a) * 4.5, C + Math.sin(a) * 4.5, 1.4); g.fill();
      }
      return;
    }
    case "acacia": {
      branches(g, r, C, C, R * 0.95, [92, 70, 48], 6, 2.4, 2);
      puffCrown(g, r, puffLayout(r, C, C, R, 20, 0.19, 0.8), tint(fol, [1.1, 1.06, 0.78]), R, C, C, 260, 0.96);
      return;
    }
    case "cactus": return cactus(g, r, 2 + (variant % 2));
    case "thorn": {
      branches(g, r, C, C, R, [74, 54, 38], 7, 3, 2, keep);
      const tn = tint(fol, [1.05, 1.0, 0.85]);
      for (const [x, y] of tips) for (let k = 0; k < 4; k++) {
        g.fillStyle = css(toneAt(tn, 0.3 + r() * 0.6), 0.9);
        g.beginPath(); circle(g, x + (r() - 0.5) * 6, y + (r() - 0.5) * 6, 1.6 + r() * 2); g.fill();
      }
      return;
    }
    case "bareBirch": {
      branches(g, r, C, C, R * 1.05, [216, 212, 202], 8, 3.2, 3, keep);
      for (const [x, y] of tips) if (r() < 0.6) {
        g.fillStyle = snowy ? css([250, 252, 255], 0.9) : css([214, 184, 70], 0.85);
        g.beginPath(); circle(g, x, y, 1 + r() * 0.8); g.fill();
      }
      ball(g, C, C, 3.5, [200, 196, 186]);
      if (snowy) snowDots(g, r, R * 0.5, 8);
      return;
    }
    case "charred": {
      branches(g, r, C, C, R * 1.05, [46, 40, 36], 6 + (variant % 2), 4.4, 2, keep);
      ball(g, C, C, 5, [52, 46, 42]);
      for (let k = 0; k < tips.length; k += 3) {
        const [x, y] = tips[k], f = 0.35 + r() * 0.4;
        glowDot(g, C + (x - C) * f, C + (y - C) * f, 0.8, [255, 118, 40]); // embers along the limbs
      }
      return;
    }
    case "burntPine": {
      starLayers(g, r, C, C, R, toneOf([16, 14, 14], [42, 38, 36], [84, 78, 72]), { layers: 4, points: 9, inner: 0.45, jag: 0.32, top: 0.3 });
      for (let k = 0; k < 11; k++) {
        const a = r() * TAU, d = Math.sqrt(r()) * R * 0.8;
        glowDot(g, C + Math.cos(a) * d, C + Math.sin(a) * d, 0.7 + r() * 0.6, r() < 0.7 ? [255, 112, 36] : [255, 190, 80]);
      }
      return;
    }
    case "ashFern": {
      const tn = toneOf([50, 56, 46], [96, 104, 86], [152, 158, 138]);
      for (let k = 0; k < 8; k++) frond(g, C, C, (k / 8) * TAU + r() * 0.35, R * (0.88 + 0.12 * r()), 6, tn, 0.15, (r() - 0.5) * 16, 20);
      for (let k = 0; k < 6; k++) frond(g, C, C, ((k + 0.5) / 6) * TAU + r() * 0.35, R * (0.6 + 0.1 * r()), 5, tn, 0.6, (r() - 0.5) * 12, 16);
      ball(g, C, C, 3, [60, 58, 52]);
      return;
    }
    case "mangrove": {
      for (const pass of [0, 1]) for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU + ((k * 7) % 5) * 0.06, a2 = a + (((k * 3) % 5) - 2) * 0.08, e = R * (0.93 + 0.07 * ((k * 5) % 3) / 2);
        g.strokeStyle = pass === 0 ? css([62, 44, 30]) : css(lighten([110, 84, 58], 0.1 * facing(a)), 0.9);
        g.lineWidth = pass === 0 ? 2.4 : 1;
        const o = pass === 0 ? 0 : -0.5;
        g.beginPath();
        g.moveTo(C + Math.cos(a) * R * 0.5 + o, C + Math.sin(a) * R * 0.5 + o);
        g.quadraticCurveTo(C + Math.cos(a2) * R * 0.85 + o, C + Math.sin(a2) * R * 0.85 + o, C + Math.cos(a2) * e + o, C + Math.sin(a2) * e + o);
        g.stroke();
      }
      puffCrown(g, r, puffLayout(r, C, C, R * 0.78, 12, 0.3), tint(fol, [0.85, 1.0, 0.85]), R * 0.78, C, C, 220);
      return;
    }
    case "willow": {
      const tn = tint(fol, [1.12, 1.18, 0.82]);
      for (let i = 0; i < 3; i++) {
        const ri = R * (1 - i * 0.27), n = 80 - i * 18;
        g.lineWidth = 1.3;
        for (let k = 0; k < n; k++) {
          const a = r() * TAU, r0 = ri * (0.45 + 0.1 * r()), r1 = ri * (0.92 + 0.08 * r()), bend = (r() - 0.5) * 4;
          g.strokeStyle = css(toneAt(tn, 0.12 + i * 0.25 + facing(a) * 0.35 + (r() - 0.5) * 0.15), 0.9);
          g.beginPath();
          g.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0);
          g.quadraticCurveTo(C + Math.cos(a) * (r0 + r1) / 2 - Math.sin(a) * bend, C + Math.sin(a) * (r0 + r1) / 2 + Math.cos(a) * bend, C + Math.cos(a) * r1, C + Math.sin(a) * r1);
          g.stroke();
        }
      }
      puffCrown(g, r, puffLayout(r, C, C, R * 0.28, 5, 0.45), tn, R * 0.28, C, C, 30);
      return;
    }
    case "reeds": return reedBed(g, r, R);
    case "crystal": {
      const tn = fol, n = 7 + (variant % 2);
      halo(g, R * 0.75, tn.light, 0.35);
      const spires: Pt[] = [];
      for (let k = 0; k < n; k++) spires.push([C + (r() - 0.5) * 5, C + (r() - 0.5) * 5, (k / n) * TAU + (r() - 0.5) * 0.5]);
      spires.sort((p, q) => (Math.cos(q[2]) + Math.sin(q[2])) - (Math.cos(p[2]) + Math.sin(p[2]))); // far side first
      for (const [x, y, a] of spires) shard(g, x, y, a, R * (0.62 + 0.28 * r()), 6 + r() * 3, tn);
      for (let k = 0; k < 3; k++) shard(g, C, C, -2.4 + k * 0.9 + r() * 0.3, 9 + r() * 4, 5, tn); // upright core
      return;
    }
    case "glassTree": {
      branches(g, r, C, C, R * 0.9, [64, 44, 96], 6, 3, 2);
      const tn = tint(fol, [1.25, 1.2, 1.15]);
      puffCrown(g, r, puffLayout(r, C, C, R, 10, 0.3), tn, R, C, C, 90, 0.7);
      g.lineWidth = 0.8;
      for (let k = 0; k < 14; k++) {
        const a = r() * TAU, d = Math.sqrt(r()) * R * 0.75, x = C + Math.cos(a) * d, y = C + Math.sin(a) * d, b2 = r() * TAU;
        g.strokeStyle = css(lighten(tn.light, 0.6), 0.55);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b2) * 6, y + Math.sin(b2) * 6); g.stroke();
      }
      return;
    }
    case "crystalDead": {
      branches(g, r, C, C, R * 0.8, [72, 62, 86], 6, 3.6, 2, keep);
      for (const [x, y, a] of tips) if (r() < 0.75) shard(g, x, y, a + (r() - 0.5) * 0.6, 7 + r() * 4, 3, fol);
      for (let k = 0; k < 3; k++) shard(g, C, C, -2.4 + k * 1.1, 8 + r() * 3, 3.5, fol);
      return;
    }
    default: // broadleaf/conifer species are handled in trees.ts; fall back to a plain crown
      puffCrown(g, r, puffLayout(r, C, C, R, 9, 0.35), fol, R, C, C, 120);
  }
}

/** A shaded sphere-ish disc (trunk tops, palm hearts). */
function ball(g: G, x: number, y: number, rad: number, col: RGB): void {
  const grd = g.createRadialGradient(x - rad * 0.4, y - rad * 0.4, rad * 0.1, x, y, rad);
  grd.addColorStop(0, css(lighten(col, 0.3)));
  grd.addColorStop(1, css(darken(col, 0.35)));
  g.fillStyle = grd;
  g.beginPath(); circle(g, x, y, rad); g.fill();
}

/** Soft coloured glow under a crystal. */
function halo(g: G, rad: number, col: RGB, a: number): void {
  const grd = g.createRadialGradient(C, C, 0, C, C, rad);
  grd.addColorStop(0, css(col, a));
  grd.addColorStop(1, css(col, 0));
  g.fillStyle = grd;
  g.beginPath(); circle(g, C, C, rad); g.fill();
}

/** Saguaro from above: a ribbed main disc with 2–3 ribbed arms reaching the footprint. */
function cactus(g: G, r: Rnd, arms: number): void {
  const tn = toneOf([44, 82, 50], [84, 128, 74], [150, 188, 120]);
  const discs: [number, number, number][] = [];
  for (let k = 0; k < arms; k++) {
    const a = (k / arms) * TAU + r() * 0.8 + 0.4, ra = 9 + r() * 1.5, d = CROWN - ra;
    discs.push([C + Math.cos(a) * d, C + Math.sin(a) * d, ra]);
    g.strokeStyle = css(toneAt(tn, 0.35));
    g.lineWidth = ra * 1.3;
    g.beginPath(); g.moveTo(C, C); g.lineTo(C + Math.cos(a) * d, C + Math.sin(a) * d); g.stroke();
  }
  discs.push([C, C, 16]);
  for (const [x, y, rad] of discs) {
    ball(g, x, y, rad, tn.mid);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU, cx = Math.cos(a), sy = Math.sin(a);
      g.strokeStyle = css(darken(tn.dark, 0.2), 0.55);
      g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(x + cx * rad * 0.2, y + sy * rad * 0.2); g.lineTo(x + cx * rad * 0.95, y + sy * rad * 0.95); g.stroke();
      g.fillStyle = css([236, 230, 200], 0.8);
      for (const f of [0.45, 0.75]) { g.beginPath(); circle(g, x + Math.cos(a + 0.26) * rad * f, y + Math.sin(a + 0.26) * rad * f, 0.5); g.fill(); }
    }
  }
  for (let k = 0; k < 5; k++) { // a small flower on the crown
    const a = (k / 5) * TAU;
    g.fillStyle = css([236, 120, 150]);
    g.beginPath(); circle(g, C - 3 + Math.cos(a) * 2, C - 3 + Math.sin(a) * 2, 1.6); g.fill();
  }
  g.fillStyle = css([250, 220, 90]);
  g.beginPath(); circle(g, C - 3, C - 3, 1.1); g.fill();
}

/** A reed bed: several clumps of radiating blades, some carrying cattail heads. */
function reedBed(g: G, r: Rnd, R: number): void {
  const tn = toneOf([70, 84, 40], [122, 134, 62], [184, 186, 106]);
  const clumps: [number, number][] = [[C, C]];
  for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + r() * 0.5; clumps.push([C + Math.cos(a) * R * 0.5, C + Math.sin(a) * R * 0.5]); }
  for (const [x, y] of clumps) {
    for (let k = 0; k < 16; k++) {
      const a = r() * TAU, len = R * (0.32 + 0.16 * r()), bend = (r() - 0.5) * 5;
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      g.strokeStyle = css(toneAt(tn, 0.2 + facing(a) * 0.6 + (r() - 0.5) * 0.2));
      g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + ex) / 2 - Math.sin(a) * bend, (y + ey) / 2 + Math.cos(a) * bend, ex, ey); g.stroke();
      if (r() < 0.22) {
        g.save();
        g.translate(x + Math.cos(a) * len * 0.72, y + Math.sin(a) * len * 0.72); g.rotate(a);
        g.fillStyle = css([112, 72, 40]);
        g.beginPath(); g.ellipse(0, 0, 3.2, 1.4, 0, 0, TAU); g.fill();
        g.restore();
      }
    }
  }
}
