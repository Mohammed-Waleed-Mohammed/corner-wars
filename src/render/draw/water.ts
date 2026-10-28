// Animated water (24 §D, 26 §D water styles), drawn by drawTerrainAnim in WORLD px over the visible
// tiles only. Shared by every style: real hand-made frames are cycled when provided; otherwise the
// water texture (real or procedural) is animated per style. Only OPEN water is overlaid — tiles next
// to mountain/rock are skipped because those blobs and shadows overhang them in the static layer.
//   lake      drifting mirrored copy (real art) + shimmer arcs
//   ice       darker, slow-drifting pale floes, subdued shimmer
//   lava      scrolling crust copy + travelling glow pulses (the shore glow ring is static)
//   bog       very slow drift, bubbles that rise and pop
//   resonant  violet light rings travelling outward from the Citadel

import { TILE_SIZE } from "../../config/constants";
import type { BiomeId, GameState, TerrainType } from "../../core/types";
import { BIOMES } from "../../content/biomes";
import { TEX_WORLD, hasRealTexture, texture, textureScale, tileHash, waterAnimFrames } from "../terrainArt";

const TS = TILE_SIZE;
const TAU = Math.PI * 2;
export interface TileView { x0: number; y0: number; x1: number; y1: number }

let patSrc: CanvasImageSource | null = null;
let patFor: CanvasRenderingContext2D | null = null;
let pat: CanvasPattern | null = null;
/** One reusable pattern per (context, image): re-creating it every frame copies the image. */
function patternOf(ctx: CanvasRenderingContext2D, src: CanvasImageSource): CanvasPattern | null {
  if (src !== patSrc || ctx !== patFor) { pat = ctx.createPattern(src, "repeat"); patSrc = src; patFor = ctx; }
  return pat;
}

export function drawWaterAnim(ctx: CanvasRenderingContext2D, state: GameState, biome: BiomeId, v: TileView, t: number, z: number): void {
  const T = state.terrain, style = BIOMES[biome].water;
  const water = (x: number, y: number): boolean => T[y]?.[x] === "water" || T[y]?.[x] === "bridge";
  const open: number[] = [];
  const path = new Path2D();
  for (let y = v.y0; y <= v.y1; y++) {
    for (let x = v.x0; x <= v.x1; x++) {
      if (T[y][x] !== "water" || nearRock(T, x, y)) continue;
      open.push(x, y);
      path.rect(x * TS, y * TS, TS, TS);
    }
  }
  const frames = waterAnimFrames(biome);
  if (open.length > 0) {
    if (frames.length >= 2) {
      const f = frames[Math.floor(t * 4) % frames.length] as HTMLImageElement;
      const p = ctx.createPattern(f, "repeat");
      if (p) {
        p.setTransform(new DOMMatrix().scale(TEX_WORLD / (f.naturalWidth || f.width || TEX_WORLD)));
        ctx.fillStyle = p;
        ctx.fill(path);
      }
    } else if (style === "lava") {
      drift(ctx, biome, path, t * 5, t * 2, 0.5, false); // the crust creeps one way…
      ctx.globalCompositeOperation = "lighter";
      drift(ctx, biome, path, -t * 3, t * 4, 0.14, true); // …a faint mirrored copy the other: shifting hot seams
      ctx.globalCompositeOperation = "source-over";
    } else if (style === "bog") {
      drift(ctx, biome, path, t * 1.2, t * 0.8, 0.35, true);
    } else if (hasRealTexture(biome, "water")) {
      drift(ctx, biome, path, t * 7, t * 4, 0.45, true);
    }
  }
  switch (style) {
    case "lake":
      if (frames.length < 2) shimmer(ctx, T, v, t, z, "190,225,240", 1);
      return;
    case "ice":
      ctx.fillStyle = "rgba(6,14,26,0.2)";
      ctx.fill(path);
      floes(ctx, open, water, t);
      if (frames.length < 2) shimmer(ctx, T, v, t, z, "200,220,235", 0.4);
      return;
    case "lava":
      lavaPulse(ctx, open, t);
      return;
    case "bog":
      bubbles(ctx, open, t, z);
      return;
    case "resonant":
      rings(ctx, state, path, v, t);
      if (frames.length < 2) shimmer(ctx, T, v, t, z, "200,170,255", 0.5);
      return;
  }
}

function nearRock(T: TerrainType[][], x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const n = T[y + dy]?.[x + dx];
    if (n === "mountain" || n === "rock") return true;
  }
  return false;
}

/** The water texture drifting over itself (optionally mirrored so the copies never line up). */
function drift(ctx: CanvasRenderingContext2D, biome: BiomeId, path: Path2D, dx: number, dy: number, alpha: number, mirror: boolean): void {
  const p = patternOf(ctx, texture(biome, "water"));
  if (!p) return;
  const s = textureScale(biome, "water");
  p.setTransform(new DOMMatrix().translate(dx % TEX_WORLD, dy % TEX_WORLD).scale(mirror ? -s : s, s));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p;
  ctx.fill(path);
  ctx.globalAlpha = 1;
}

/** Short glinting arcs on water and shallows (3 alpha buckets → 3 strokes). */
function shimmer(ctx: CanvasRenderingContext2D, T: TerrainType[][], v: TileView, t: number, z: number, rgb: string, k: number): void {
  if (z < 0.5) return;
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  for (let bucket = 0; bucket < 3; bucket++) {
    ctx.strokeStyle = `rgba(${rgb},${((0.1 + 0.09 * bucket) * k).toFixed(3)})`;
    ctx.beginPath();
    for (let y = v.y0; y <= v.y1; y++) {
      for (let x = v.x0; x <= v.x1; x++) {
        const tt = T[y][x];
        if (tt !== "water" && tt !== "shallows") continue;
        const ph = tileHash(x, y, 120) * TAU, s = Math.sin(t * 1.6 + ph);
        if (Math.min(2, Math.floor((s + 1) * 1.5)) !== bucket) continue;
        const cx = x * TS + TS * (0.25 + 0.5 * tileHash(x, y, 121)), cy = y * TS + TS * (0.3 + 0.4 * tileHash(x, y, 122));
        const drift = Math.sin(t * 0.7 + ph) * 3;
        ctx.moveTo(cx - 6 + drift, cy);
        ctx.quadraticCurveTo(cx + drift, cy - 2.5, cx + 6 + drift, cy);
      }
    }
    ctx.stroke();
  }
}

/** Pale ice floes on interior water tiles: irregular polygons bobbing slowly about their tile. */
function floes(ctx: CanvasRenderingContext2D, open: number[], water: (x: number, y: number) => boolean, t: number): void {
  const body = new Path2D(), under = new Path2D();
  for (let i = 0; i < open.length; i += 2) {
    const x = open[i], y = open[i + 1];
    if (tileHash(x, y, 140) > 0.11) continue;
    let interior = true;
    for (let dy = -1; dy <= 1 && interior; dy++) for (let dx = -1; dx <= 1; dx++) if (!water(x + dx, y + dy)) { interior = false; break; }
    if (!interior) continue;
    const ph = tileHash(x, y, 141) * TAU, h = tileHash(x, y, 142);
    const cx = x * TS + TS / 2 + Math.sin(t * 0.06 + ph) * 7, cy = y * TS + TS / 2 + Math.cos(t * 0.05 + ph * 1.3) * 5;
    const rot = ph + t * 0.04 * (h - 0.5), n = 5 + Math.floor(h * 3), rad = 6 + 7 * tileHash(x, y, 143);
    for (const [p, ox, oy] of [[under, 1.5, 2], [body, 0, 0]] as [Path2D, number, number][]) {
      for (let k = 0; k < n; k++) {
        const a = rot + (k / n) * TAU, rr = rad * (0.62 + 0.38 * tileHash(x * 7 + k, y, 144));
        const px = cx + ox + Math.cos(a) * rr, py = cy + oy + Math.sin(a) * rr;
        if (k === 0) p.moveTo(px, py); else p.lineTo(px, py);
      }
      p.closePath();
    }
  }
  ctx.fillStyle = "rgba(4,10,20,0.35)";
  ctx.fill(under);
  ctx.fillStyle = "rgba(214,230,242,0.88)";
  ctx.fill(body);
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 0.8;
  ctx.stroke(body);
}

/** Lava breathing: a slow brightness wave travels across the flow (4 alpha buckets, additive). */
function lavaPulse(ctx: CanvasRenderingContext2D, open: number[], t: number): void {
  const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  for (let i = 0; i < open.length; i += 2) {
    const x = open[i], y = open[i + 1];
    const s = Math.sin(t * 0.9 - x * 0.42 - y * 0.27 + tileHash(x, y, 160) * 0.8);
    paths[Math.min(3, Math.floor((s + 1) * 2))].rect(x * TS, y * TS, TS, TS);
  }
  const g = 0.75 + 0.25 * Math.sin(t * 0.37);
  ctx.globalCompositeOperation = "lighter";
  paths.forEach((p, k) => {
    ctx.fillStyle = `rgba(255,${100 + k * 18},30,${((0.02 + 0.035 * k) * g).toFixed(3)})`;
    ctx.fill(p);
  });
  ctx.globalCompositeOperation = "source-over";
}

/** Bog bubbles: a few tiles grow a bubble that pops into a fading ring, then re-seed elsewhere. */
function bubbles(ctx: CanvasRenderingContext2D, open: number[], t: number, z: number): void {
  if (z < 0.45) return;
  const blobs = new Path2D(), ringsA = new Path2D(), ringsB = new Path2D();
  for (let i = 0; i < open.length; i += 2) {
    const x = open[i], y = open[i + 1];
    if (tileHash(x, y, 150) > 0.2) continue;
    const P = 3.5 + 5 * tileHash(x, y, 151), u = (t + tileHash(x, y, 152) * P) / P, cyc = Math.floor(u), f = u - cyc;
    if (f > 0.34) continue;
    const bx = x * TS + TS * (0.2 + 0.6 * tileHash(x + cyc * 131, y, 153)), by = y * TS + TS * (0.2 + 0.6 * tileHash(x, y + cyc * 137, 154));
    if (f < 0.26) {
      const r = 0.6 + 2.4 * (f / 0.26);
      blobs.moveTo(bx + r, by);
      blobs.arc(bx, by, r, 0, TAU);
    } else {
      const k = (f - 0.26) / 0.08, p = k < 0.5 ? ringsA : ringsB, r = 3 + 5 * k;
      p.moveTo(bx + r, by);
      p.arc(bx, by, r, 0, TAU);
    }
  }
  ctx.fillStyle = "rgba(170,182,140,0.35)";
  ctx.fill(blobs);
  ctx.strokeStyle = "rgba(214,224,190,0.55)";
  ctx.lineWidth = 0.8;
  ctx.stroke(blobs);
  ctx.strokeStyle = "rgba(200,212,176,0.4)";
  ctx.stroke(ringsA);
  ctx.strokeStyle = "rgba(200,212,176,0.18)";
  ctx.stroke(ringsB);
}

/** Resonance: soft violet rings expanding from the Citadel, clipped to the open water. */
function rings(ctx: CanvasRenderingContext2D, state: GameState, path: Path2D, v: TileView, t: number): void {
  const cx = state.citadel.x * TS, cy = state.citadel.y * TS;
  const L = 10 * TS, speed = 28;
  const qx = Math.max(v.x0 * TS, Math.min(cx, (v.x1 + 1) * TS)), qy = Math.max(v.y0 * TS, Math.min(cy, (v.y1 + 1) * TS));
  const dmin = Math.hypot(qx - cx, qy - cy);
  const dmax = Math.max(Math.hypot(v.x0 * TS - cx, v.y0 * TS - cy), Math.hypot((v.x1 + 1) * TS - cx, v.y0 * TS - cy),
    Math.hypot(v.x0 * TS - cx, (v.y1 + 1) * TS - cy), Math.hypot((v.x1 + 1) * TS - cx, (v.y1 + 1) * TS - cy));
  const far = Math.hypot(state.mapWidth, state.mapHeight) * TS * 0.6;
  ctx.save();
  ctx.clip(path);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(140,90,240,${(0.03 + 0.025 * Math.sin(t * 0.8)).toFixed(3)})`;
  ctx.fill(path);
  const phase = (t * speed) % L;
  for (let r = phase + Math.max(0, Math.floor((dmin - 30 - phase) / L)) * L; r <= dmax + 30; r += L) {
    const a = 0.14 * Math.max(0.2, 1 - r / far);
    for (const [w, k] of [[26, 0.3], [12, 0.55], [4, 1]] as [number, number][]) {
      ctx.strokeStyle = `rgba(180,130,255,${(a * k).toFixed(3)})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, r), 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}
