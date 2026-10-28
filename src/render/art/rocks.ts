// Procedural ROCKS (26 §D): one RockStyle per biome, 4 variants by index. A boulder is a low-poly
// solid seen from above — a top face plus side facets lit by their facing (light from the top-left)
// — filling ≈ 75% of the sprite (radius 37.5 units). Style details are painted clipped to it.

import type { RockStyle, Tone } from "../../content/biomes";
import { css, darken, lighten } from "./noise";
import { C, circle, facing, glowDot, toneAt, type G, type Rnd } from "./spriteKit";

const TAU = Math.PI * 2;
const R = 37.5;
type P = [number, number];

export function drawRock(g: G, r: Rnd, style: RockStyle, tn: Tone, variant: number): void {
  if (style === "mossy" && variant === 3) return ruinBlock(g, r, tn);
  const angular = style === "basalt" || style === "obsidian";
  const n = (angular ? 6 : 8) + (variant % 3), squash = 0.78 + 0.16 * r(), rot = r() * TAU;
  const outer: P[] = [], inner: P[] = [];
  for (let k = 0; k < n; k++) {
    const a = rot + ((k + (r() - 0.5) * 0.35) / n) * TAU, rr = 0.8 + 0.2 * r();
    outer.push([Math.cos(a) * rr, Math.sin(a) * rr * squash]);
  }
  let ext = 0; // normalise so the widest point sits exactly on the footprint
  for (const [x, y] of outer) ext = Math.max(ext, Math.abs(x), Math.abs(y));
  for (const p of outer) { p[0] = C + (p[0] / ext) * R; p[1] = C + (p[1] / ext) * R; }
  const top = angular ? 0.42 : 0.55, ox = -R * 0.08, oy = -R * 0.1; // the top face leans to the light
  for (let k = 0; k < n; k++) {
    const p = outer[k], q = outer[(k + 1) % n];
    inner.push([C + ((p[0] + q[0]) / 2 - C) * top + ox, C + ((p[1] + q[1]) / 2 - C) * top + oy]);
  }
  const outline = (): void => { g.beginPath(); outer.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  // side facets: outer vertex k sits between inner k−1 and inner k
  const gloss = style === "obsidian" ? 0.3 : 0;
  for (let k = 0; k < n; k++) {
    const a = outer[k], b = inner[k], c = outer[(k + 1) % n], d = inner[(k + n - 1) % n];
    for (const [p, q, s] of [[d, b, a], [b, c, a]] as [P, P, P][]) {
      const mx = (p[0] + q[0] + s[0]) / 3 - C, my = (p[1] + q[1] + s[1]) / 3 - C;
      const lit = facing(Math.atan2(my, mx));
      g.fillStyle = css(toneAt(tn, 0.1 + 0.62 * lit + (r() - 0.5) * 0.08 + gloss * lit * lit));
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.lineTo(s[0], s[1]); g.closePath(); g.fill();
      g.strokeStyle = g.fillStyle; g.lineWidth = 0.4; g.stroke(); // hide AA seams between facets
    }
  }
  g.fillStyle = css(toneAt(tn, 0.7 + gloss * 0.2));
  g.beginPath(); inner.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  g.strokeStyle = css(lighten(tn.light, 0.2), 0.35);
  g.lineWidth = 0.7;
  g.stroke();
  g.save();
  outline();
  g.clip();
  texture(g, r, style, tn, inner, variant);
  g.restore();
  outline();
  g.strokeStyle = css(darken(tn.dark, 0.4), 0.7);
  g.lineWidth = 1.2;
  g.stroke();
}

/** Style surface detail, drawn while clipped to the boulder. */
function texture(g: G, r: Rnd, style: RockStyle, tn: Tone, top: P[], variant: number): void {
  for (let k = 0; k < 70; k++) { // mineral speckle
    const a = r() * TAU, d = Math.sqrt(r()) * R;
    g.fillStyle = r() < 0.5 ? css(lighten(tn.light, 0.3), 0.3) : css(darken(tn.dark, 0.3), 0.3);
    g.beginPath(); circle(g, C + Math.cos(a) * d, C + Math.sin(a) * d, 0.5 + r() * 0.7); g.fill();
  }
  switch (style) {
    case "sandstone":
      g.lineWidth = 1;
      for (let k = 0; k < 6; k++) { // strata
        const y = C - R + (k + 0.5) * (R * 2 / 6) + (r() - 0.5) * 3;
        g.strokeStyle = css(darken(tn.mid, 0.25), 0.3);
        g.beginPath(); g.moveTo(C - R, y); g.bezierCurveTo(C - R / 3, y - 3 + r() * 6, C + R / 3, y - 3 + r() * 6, C + R, y); g.stroke();
      }
      if (variant % 2 === 1) blobs(g, r, top, [244, 240, 228], 0.85, 7); // salt crust
      return;
    case "iceCap":
      for (const [col, d] of [[[176, 196, 216], 1.6], [[244, 248, 252], 0]] as [[number, number, number], number][]) {
        g.fillStyle = css(col);
        g.beginPath();
        top.forEach(([x, y], k) => {
          const px = C + (x - C) * 1.45 + d - 3, py = C + (y - C) * 1.45 + d - 4;
          if (k) g.lineTo(px, py); else g.moveTo(px, py);
        });
        g.closePath(); g.fill();
      }
      return;
    case "basalt":
      cracks(g, r, [255, 110, 30], [255, 200, 90], 4);
      for (let k = 0; k < 4; k++) glowDot(g, C + (r() - 0.5) * R, C + (r() - 0.5) * R, 0.7, [255, 120, 40]);
      return;
    case "mossy":
      blobs(g, r, top, [86, 116, 52], 0.8, 9);
      blobs(g, r, top, [120, 150, 70], 0.6, 6);
      return;
    case "obsidian":
      cracks(g, r, [140, 90, 230], [214, 190, 255], 3);
      return;
    case "granite":
      if (variant === 2) blobs(g, r, top, [150, 160, 120], 0.35, 5); // lichen
      return;
  }
}

/** Patches (moss, salt, lichen) scattered over the top face. */
function blobs(g: G, r: Rnd, top: P[], col: [number, number, number], a: number, n: number): void {
  g.fillStyle = css(col, a);
  g.beginPath();
  for (let k = 0; k < n; k++) {
    const p = top[Math.floor(r() * top.length)], f = r() * 0.7;
    circle(g, p[0] + (C - p[0]) * f + (r() - 0.5) * 6, p[1] + (C - p[1]) * f + (r() - 0.5) * 6, 2.5 + r() * 4);
  }
  g.fill();
}

/** Glowing crack lines across the stone: a soft wide glow, then a hot thin core. */
function cracks(g: G, r: Rnd, glow: [number, number, number], core: [number, number, number], n: number): void {
  const paths: P[][] = [];
  for (let k = 0; k < n; k++) {
    let a = r() * TAU, x = C + (r() - 0.5) * 10, y = C + (r() - 0.5) * 10;
    const pts: P[] = [[x, y]];
    for (let s = 0; s < 6; s++) { a += (r() - 0.5) * 1.1; x += Math.cos(a) * 6.5; y += Math.sin(a) * 6.5; pts.push([x, y]); }
    paths.push(pts);
  }
  for (const [col, w, al] of [[glow, 3.2, 0.35], [core, 1, 0.95]] as [[number, number, number], number, number][]) {
    g.strokeStyle = css(col, al);
    g.lineWidth = w;
    g.beginPath();
    for (const pts of paths) pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
}

/** Mire variant 4: a mossy cut block from an old ruin (bevelled top, coursed masonry). */
function ruinBlock(g: G, r: Rnd, tn: Tone): void {
  g.save();
  g.translate(C, C); g.rotate((r() - 0.5) * 0.5); g.translate(-C, -C);
  const w = R * 1.7, h = R * 1.25, x0 = C - w / 2, y0 = C - h / 2, b = 5;
  const face = (pts: number[], t: number): void => {
    g.fillStyle = css(toneAt(tn, t));
    g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill();
  };
  face([x0, y0, x0 + w, y0, x0 + w - b, y0 + b, x0 + b, y0 + b], 0.9); // north bevel (lit)
  face([x0, y0, x0 + b, y0 + b, x0 + b, y0 + h - b, x0, y0 + h], 0.8); // west bevel (lit)
  face([x0 + w, y0, x0 + w, y0 + h, x0 + w - b, y0 + h - b, x0 + w - b, y0 + b], 0.25);
  face([x0, y0 + h, x0 + b, y0 + h - b, x0 + w - b, y0 + h - b, x0 + w, y0 + h], 0.15);
  face([x0 + b, y0 + b, x0 + w - b, y0 + b, x0 + w - b, y0 + h - b, x0 + b, y0 + h - b], 0.62);
  g.strokeStyle = css(darken(tn.dark, 0.3), 0.55);
  g.lineWidth = 0.9;
  g.beginPath();
  const rows = 3, rh = (h - 2 * b) / rows;
  for (let i = 1; i < rows; i++) { g.moveTo(x0 + b, y0 + b + i * rh); g.lineTo(x0 + w - b, y0 + b + i * rh); }
  for (let i = 0; i < rows; i++) for (let j = 1; j < 3; j++) {
    const x = x0 + b + ((j + (i % 2) * 0.5) / 3) * (w - 2 * b);
    g.moveTo(x, y0 + b + i * rh); g.lineTo(x, y0 + b + (i + 1) * rh);
  }
  g.stroke();
  g.strokeStyle = css(darken(tn.dark, 0.45), 0.8);
  g.lineWidth = 1.2;
  g.strokeRect(x0, y0, w, h);
  blobs(g, r, [[x0 + b, y0 + b], [x0 + w / 2, y0 + b], [x0 + b, y0 + h / 2], [x0 + w - b, y0 + b]], [86, 116, 52], 0.75, 10);
  g.restore();
}
