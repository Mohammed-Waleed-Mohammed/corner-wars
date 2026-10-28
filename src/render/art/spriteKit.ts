// Drawing kit for the procedural sprites (26 §D). Sprites are drawn in a 100 × 100 unit box scaled
// to the requested size, top-down with the light from the top-left (L = (−1, −1)/√2), no cast
// shadows (the renderer draws those). Randomness comes from a seeded PRNG only — deterministic.

import type { RGB, Tone } from "../../content/biomes";
import { canvas, css, darken, lighten, mixRGB, prng } from "./noise";

export type G = CanvasRenderingContext2D;
export type Rnd = () => number;
const TAU = Math.PI * 2;
const L = 0.7071;

/** Footprint rule (29 §C): the subject's larger side (or, base-anchored, its width) as a fraction. */
export interface Fit { fp: number; baseAtBottom: boolean }

/** A transparent size × size canvas whose context draws in 100-unit space. With `fit`, a first pass
 *  measures the drawn subject (alpha ≥ 0.5) and a second, identical vector pass (same seed) is
 *  transformed so the subject fills the footprint exactly, centred or standing on the bottom edge. */
export function unitCanvas(size: number, seed: number, draw: (g: G, r: Rnd) => void, fit?: Fit): HTMLCanvasElement {
  size = Math.max(8, Math.round(size));
  const pass = (setup: (g: G) => void): HTMLCanvasElement => {
    const c = canvas(size, size), g = c.getContext("2d", { willReadFrequently: !!fit })!;
    g.scale(size / 100, size / 100);
    setup(g);
    g.lineCap = "round";
    g.lineJoin = "round";
    draw(g, prng(seed));
    return c;
  };
  const first = pass(() => {});
  if (!fit) return first;
  const box = alphaBox(first);
  if (!box) return first;
  const u = 100 / size, x0 = box.x0 * u, x1 = box.x1 * u, y0 = box.y0 * u, y1 = box.y1 * u;
  let k = (fit.fp * 100) / (fit.baseAtBottom ? x1 - x0 : Math.max(x1 - x0, y1 - y0));
  if (fit.baseAtBottom) k = Math.min(k, 97 / (y1 - y0)); // never taller than the canvas
  const ty = fit.baseAtBottom ? 100 : 50, by = fit.baseAtBottom ? y1 : (y0 + y1) / 2;
  return pass((g) => { g.translate(50, ty); g.scale(k, k); g.translate(-(x0 + x1) / 2, -by); });
}

/** Bounding box (px, exclusive max) of pixels with alpha ≥ 128, or null if empty. */
function alphaBox(c: HTMLCanvasElement): { x0: number; y0: number; x1: number; y1: number } | null {
  const w = c.width, h = c.height, d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4) {
      if (d[i] < 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Brightness 0..1 of a surface facing direction `a` (radians, screen space) under the light. */
export const facing = (a: number): number => 0.5 - 0.5 * (Math.cos(a) + Math.sin(a)) * L;
/** Colour on a tone at t ∈ [0, 1]. */
export function toneAt(tn: Tone, t: number): RGB {
  t = Math.max(0, Math.min(1, t));
  return t < 0.5 ? mixRGB(tn.dark, tn.mid, t * 2) : mixRGB(tn.mid, tn.light, t * 2 - 1);
}
export const circle = (g: G, x: number, y: number, r: number): void => { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); };

export const C = 50; // sprite centre (units)
export const CROWN = 42.5; // tree crown radius: 85% footprint

/** A tone with every stop multiplied per channel (hue/brightness variant of a palette). */
export function tint(tn: Tone, m: RGB): Tone {
  const f = (c: RGB): RGB => [Math.min(255, c[0] * m[0]), Math.min(255, c[1] * m[1]), Math.min(255, c[2] * m[2])];
  return { dark: f(tn.dark), mid: f(tn.mid), light: f(tn.light) };
}
export const toneOf = (dark: RGB, mid: RGB, light: RGB): Tone => ({ dark, mid, light });

/** Loose snow clumps sitting on a crown of radius R around the centre. */
export function snowDots(g: G, r: Rnd, R: number, n: number): void {
  for (let k = 0; k < n; k++) {
    const a = r() * TAU, d = Math.sqrt(r()) * R * 0.85;
    const x = C + Math.cos(a) * d, y = C + Math.sin(a) * d, s = 1.2 + r() * 1.6;
    g.fillStyle = css(darken([200, 214, 230], 0.15), 0.6); // underside first, then the lit clump
    g.beginPath(); circle(g, x + 0.6, y + 0.6, s); g.fill();
    g.fillStyle = css([248, 250, 255], 0.9);
    g.beginPath(); circle(g, x, y, s); g.fill();
  }
}

/** A small glowing dot (embers, fireflies in sprites). */
export function glowDot(g: G, x: number, y: number, rad: number, col: RGB): void {
  const grd = g.createRadialGradient(x, y, 0, x, y, rad * 2.6);
  grd.addColorStop(0, css(lighten(col, 0.5)));
  grd.addColorStop(0.35, css(col, 0.85));
  grd.addColorStop(1, css(col, 0));
  g.fillStyle = grd;
  g.beginPath(); circle(g, x, y, rad * 2.6); g.fill();
}

// ── broadleaf crowns ────────────────────────────────────────────────────────────────────────────

export interface Puff { x: number; y: number; r: number }

/** Lay out puffs so their union fills radius R around (cx, cy) (`ry` squashes vertically). */
export function puffLayout(r: Rnd, cx: number, cy: number, R: number, n: number, pr: number, ry = 1): Puff[] {
  const out: Puff[] = [];
  const ring = Math.max(4, n - 1 - Math.floor(n / 3));
  for (let k = 0; k < ring; k++) {
    const a = (k / ring) * TAU + r() * 0.5, rr = R * pr * (0.85 + 0.3 * r());
    const d = R - rr;
    out.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * ry, r: rr });
  }
  for (let k = ring; k < n - 1; k++) {
    const a = r() * TAU, rr = R * pr * (0.8 + 0.3 * r()), d = (R - rr) * 0.5 * r();
    out.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * ry, r: rr });
  }
  out.push({ x: cx - R * 0.06, y: cy - R * 0.06, r: R * Math.max(0.45, pr) }); // crown top, drawn last
  return out;
}

/** Shaded puff crown: dark silhouette, per-puff radial light, then leaf clumps. */
export function puffCrown(g: G, r: Rnd, puffs: Puff[], tn: Tone, R: number, cx: number, cy: number, leaves: number, alpha = 1): void {
  g.globalAlpha = alpha;
  g.fillStyle = css(darken(tn.dark, 0.25));
  g.beginPath();
  for (const p of puffs) circle(g, p.x, p.y, p.r + 1.2);
  g.fill();
  for (const p of puffs) {
    const bias = ((p.x - cx) + (p.y - cy)) / (R * 2.4); // bottom-right puffs sit in shade
    const grd = g.createRadialGradient(p.x - p.r * 0.38, p.y - p.r * 0.38, p.r * 0.08, p.x, p.y, p.r * 1.05);
    grd.addColorStop(0, css(toneAt(tn, 0.92 - bias * 0.5)));
    grd.addColorStop(0.55, css(toneAt(tn, 0.55 - bias * 0.5)));
    grd.addColorStop(1, css(toneAt(tn, 0.12)));
    g.fillStyle = grd;
    g.beginPath(); circle(g, p.x, p.y, p.r); g.fill();
  }
  for (let k = 0; k < leaves; k++) {
    const p = puffs[Math.floor(r() * puffs.length)];
    const a = r() * TAU, d = Math.sqrt(r()) * p.r * 0.85;
    const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
    const lit = 0.5 - ((x - cx) + (y - cy)) / (R * 2.2) - ((x - p.x) + (y - p.y)) / (p.r * 3) + (r() - 0.5) * 0.3;
    g.fillStyle = css(toneAt(tn, lit), 0.75 * alpha);
    g.beginPath(); circle(g, x, y, 1.4 + r() * 1.8); g.fill();
  }
  g.globalAlpha = 1;
}

// ── conifers ────────────────────────────────────────────────────────────────────────────────────

export interface StarOpts { layers: number; points: number; inner: number; jag: number; top: number; ry?: number; snow?: number }

/** Conifer seen from above: stacked star layers, each smaller and lighter; optional snow load. */
export function starLayers(g: G, r: Rnd, cx: number, cy: number, R: number, tn: Tone, o: StarOpts): void {
  const ry = o.ry ?? 1;
  for (let i = 0; i < o.layers; i++) {
    const k = i / Math.max(1, o.layers - 1), Ri = R * (1 - (1 - o.top) * k), rot = r() * TAU;
    const lx = cx - R * 0.05 * k, ly = cy - R * 0.05 * k; // upper layers lean toward the light
    g.beginPath();
    for (let p = 0; p < o.points * 2; p++) {
      const a = rot + (p / (o.points * 2)) * TAU;
      const rr = p % 2 === 0 ? Ri * (1 - o.jag * r()) : Ri * o.inner * (0.9 + 0.2 * r());
      const x = lx + Math.cos(a) * rr, y = ly + Math.sin(a) * rr * ry;
      if (p === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    const grd = g.createLinearGradient(lx - Ri, ly - Ri, lx + Ri, ly + Ri);
    grd.addColorStop(0, css(toneAt(tn, 0.45 + 0.5 * k)));
    grd.addColorStop(1, css(toneAt(tn, 0.05 + 0.4 * k)));
    g.fillStyle = grd;
    g.fill();
    g.strokeStyle = css(darken(tn.dark, 0.3), 0.45);
    g.lineWidth = 0.7;
    g.stroke();
    if (o.snow) {
      g.save();
      g.clip();
      g.fillStyle = css([240, 245, 250], o.snow);
      g.beginPath(); circle(g, lx - Ri * 0.3, ly - Ri * 0.3, Ri * 0.78); g.fill();
      g.fillStyle = css([255, 255, 255], o.snow * 0.8);
      g.beginPath(); circle(g, lx - Ri * 0.42, ly - Ri * 0.42, Ri * 0.4); g.fill();
      g.restore();
    }
  }
}

/** Needle tufts: short strokes radiating from the centre, light on the top-left. */
export function needles(g: G, r: Rnd, cx: number, cy: number, R: number, tn: Tone, n: number): void {
  g.lineWidth = 0.9;
  for (let k = 0; k < n; k++) {
    const a = r() * TAU, d = R * (0.2 + 0.75 * Math.sqrt(r())), l = 2 + r() * 3;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    g.strokeStyle = css(toneAt(tn, facing(a + Math.PI) * 0.6 + 0.3 + (r() - 0.5) * 0.2), 0.7);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}

// ── branches, fronds, shards ────────────────────────────────────────────────────────────────────

/** Bare radial limbs from (cx, cy), forking `depth` times; drawn dark then with a lit top edge. */
export function branches(g: G, r: Rnd, cx: number, cy: number, R: number, col: RGB, limbs: number, width: number, depth: number, tips?: (x: number, y: number, a: number) => void): void {
  const segs: [number, number, number, number, number][] = [];
  const grow = (x: number, y: number, a: number, len: number, w: number, d: number): void => {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    segs.push([x, y, x2, y2, w]);
    if (d <= 0) { tips?.(x2, y2, a); return; }
    const forks = 2 + (r() < 0.3 ? 1 : 0);
    for (let f = 0; f < forks; f++) grow(x2, y2, a + (f - (forks - 1) / 2) * (0.55 + r() * 0.3), len * (0.55 + r() * 0.15), w * 0.62, d - 1);
  };
  const reach = R / (1 + 0.62 + 0.62 * 0.62 + 0.4);
  for (let k = 0; k < limbs; k++) grow(cx, cy, (k / limbs) * TAU + r() * 0.6, reach * (0.85 + r() * 0.3), width, depth);
  for (const pass of [0, 1]) {
    for (const [x, y, x2, y2, w] of segs) {
      g.strokeStyle = pass === 0 ? css(darken(col, 0.45)) : css(lighten(col, 0.25), 0.8);
      g.lineWidth = pass === 0 ? w : w * 0.45;
      const o = pass === 0 ? 0 : -w * 0.22;
      g.beginPath(); g.moveTo(x + o, y + o); g.lineTo(x2 + o, y2 + o); g.stroke();
    }
  }
}

/** A feathery frond (palm, fern): curved rib with tapered leaflets on both sides. */
export function frond(g: G, cx: number, cy: number, a: number, len: number, w: number, tn: Tone, shade: number, curl: number, steps = 16): void {
  const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len;
  const px = -Math.sin(a), py = Math.cos(a);
  const mx = (cx + ex) / 2 + px * curl, my = (cy + ey) / 2 + py * curl;
  const at = (t: number): [number, number] => [
    (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * mx + t * t * ex,
    (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * my + t * t * ey,
  ];
  for (const side of [-1, 1]) {
    const lit = facing(a + side * Math.PI / 2) * 0.5 + shade * 0.5;
    g.strokeStyle = css(toneAt(tn, lit));
    g.lineWidth = Math.max(0.9, w * 0.22);
    g.beginPath();
    for (let i = 1; i < steps; i++) {
      const t = i / steps, [x, y] = at(t), lw = w * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7);
      g.moveTo(x, y);
      g.lineTo(x + (px * side + Math.cos(a) * 0.55) * lw, y + (py * side + Math.sin(a) * 0.55) * lw);
    }
    g.stroke();
  }
  g.strokeStyle = css(lighten(toneAt(tn, 0.6 + shade * 0.3), 0.2));
  g.lineWidth = Math.max(0.7, w * 0.14);
  g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
}

/** A crystal prism from (x, y) toward angle `a`: two flat-lit faces and a bright ridge. */
export function shard(g: G, x: number, y: number, a: number, len: number, w: number, tn: Tone, alpha = 1): void {
  const dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
  const tx = x + dx * len, ty = y + dy * len, sx = x + dx * len * 0.72, sy = y + dy * len * 0.72;
  for (const side of [-1, 1]) {
    g.fillStyle = css(toneAt(tn, 0.15 + 0.85 * facing(a + side * Math.PI / 2)), alpha);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + px * side * w * 0.8, y + py * side * w * 0.8);
    g.lineTo(sx + px * side * w, sy + py * side * w);
    g.lineTo(tx, ty);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = css(lighten(tn.light, 0.5), 0.85 * alpha);
  g.lineWidth = Math.max(0.6, w * 0.18);
  g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); g.stroke();
}
