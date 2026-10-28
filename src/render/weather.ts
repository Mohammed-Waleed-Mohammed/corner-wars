// 26 §D — screen-space weather, one kind per biome (BiomeDef.weather). Cosmetic and render-only: a
// fixed, seeded particle field (≤ 220 particles, never Math.random) lives in a wrap box slightly
// larger than the viewport. Each particle is offset by the camera's scroll × its depth, so the field
// moves with camera pans like things in (or just above) the world, with parallax between depths.
// Everything is drawn at low alpha above units and below fog/HUD, so weather never hides a unit.

import { TILE_SIZE } from "../config/constants";
import type { GameState } from "../core/types";
import { BIOMES, type WeatherKind } from "../content/biomes";
import type { Camera } from "./camera";
import { prng, uhash } from "./art/noise";

let enabled = true;
/** Settings hook: turn weather on/off (default on). */
export function setWeatherEnabled(on: boolean): void { enabled = on; }

const MAX_PARTICLES = 220;
const PAD = 60; // wrap-box margin so particles enter/leave off-screen
const TAU = Math.PI * 2;

/** A particle's fixed traits: base position in the wrap box (0..1), depth, size, speed, phase. */
interface P { x: number; y: number; d: number; s: number; v: number; ph: number }
const fields = new Map<string, P[]>();
function field(name: string, n: number, depth: (i: number, r: () => number) => number): P[] {
  let f = fields.get(name);
  if (f && f.length === n) return f;
  const r = prng(n * 7919 + name.length * 104729 + name.charCodeAt(0));
  f = Array.from({ length: n }, (_, i) => ({ x: r(), y: r(), d: depth(i, r), s: r(), v: r(), ph: r() * TAU }));
  fields.set(name, f);
  return f;
}
const mod = (a: number, n: number): number => ((a % n) + n) % n;

export function drawWeather(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, timeMs: number, viewportW: number, viewportH: number): void {
  if (!enabled || viewportW <= 0 || viewportH <= 0) return;
  const kind: WeatherKind = (BIOMES[state.biome] ?? BIOMES.verdant).weather;
  const t = timeMs / 1000, z = camera.zoom;
  const W = viewportW + PAD * 2, H = viewportH + PAD * 2;
  const cx = camera.x * z, cy = camera.y * z; // the camera's scroll in screen px
  const k = Math.max(0.35, Math.min(1, (viewportW * viewportH) / (1920 * 1080))); // density by screen area
  const count = (n: number): number => Math.min(MAX_PARTICLES, Math.round(n * k));
  /** Screen position of a particle drifting at (vx, vy) px/s, with extra offset (ox, oy). */
  const at = (p: P, vx: number, vy: number, ox: number, oy: number): [number, number] =>
    [mod(p.x * W + vx * t + ox - cx * p.d, W) - PAD, mod(p.y * H + vy * t + oy - cy * p.d, H) - PAD];

  ctx.save();
  const dpr = ctx.canvas.width / viewportW;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // screen space (CSS px)
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  switch (kind) {
    case "seeds": {
      const halo = new Path2D(), core = new Path2D();
      for (const p of field("seeds", count(60), (_, r) => 0.9 + 0.25 * r())) {
        const [x, y] = at(p, 14 + 10 * p.v, 4, Math.sin(t * 0.8 + p.ph) * 12, Math.cos(t * 0.5 + p.ph) * 8);
        const rad = 0.9 + 0.8 * p.s;
        halo.moveTo(x + rad * 2.6, y); halo.arc(x, y, rad * 2.6, 0, TAU);
        core.moveTo(x + rad, y); core.arc(x, y, rad, 0, TAU);
      }
      ctx.fillStyle = "rgba(245,242,230,0.1)"; ctx.fill(halo);
      ctx.fillStyle = "rgba(250,248,238,0.5)"; ctx.fill(core);
      break;
    }
    case "dust": {
      const bandY = mod(-cy * 0.7 + t * 6, H * 1.5) - H * 0.25, bh = H * 0.35;
      const grd = ctx.createLinearGradient(0, bandY - bh / 2, 0, bandY + bh / 2);
      grd.addColorStop(0, "rgba(220,196,150,0)"); grd.addColorStop(0.5, "rgba(220,196,150,0.07)"); grd.addColorStop(1, "rgba(220,196,150,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, bandY - bh / 2, viewportW, bh);
      const a = new Path2D(), b = new Path2D();
      field("dust", count(130), (_, r) => 0.85 + 0.35 * r()).forEach((p, i) => {
        const [x, y] = at(p, 110 + 80 * p.v, 6, 0, Math.sin(t * 0.9 + p.ph) * 5);
        const len = 10 + 30 * p.s, path = i % 2 ? a : b;
        path.moveTo(x, y); path.lineTo(x - len, y + 0.6);
      });
      ctx.lineWidth = 1; ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(214,190,140,0.16)"; ctx.stroke(a);
      ctx.strokeStyle = "rgba(226,204,156,0.26)"; ctx.stroke(b);
      break;
    }
    case "snow": {
      const layers = [new Path2D(), new Path2D(), new Path2D()], DEPTH = [0.75, 1, 1.3];
      for (const p of field("snow", count(220), (i) => DEPTH[i % 3])) {
        const li = DEPTH.indexOf(p.d);
        const [x, y] = at(p, 8 * p.d, (24 + 18 * p.v) * p.d, Math.sin(t * 0.7 + p.ph) * 10 * p.d, 0);
        const rad = (0.8 + 0.5 * p.s) * p.d * 1.2;
        layers[li].moveTo(x + rad, y); layers[li].arc(x, y, rad, 0, TAU);
      }
      [0.35, 0.5, 0.6].forEach((a, i) => { ctx.fillStyle = `rgba(250,252,255,${a})`; ctx.fill(layers[i]); });
      break;
    }
    case "ash": {
      const dark = new Path2D(), light = new Path2D();
      field("ash", count(110), (_, r) => 0.85 + 0.3 * r()).forEach((p, i) => {
        const [x, y] = at(p, 5 + 4 * p.v, 10 + 8 * p.v, Math.sin(t * 0.9 + p.ph) * 8, 0);
        const rad = 0.9 + 1.2 * p.s, path = i % 2 ? dark : light;
        path.moveTo(x + rad, y); path.ellipse(x, y, rad, rad * 0.6, p.ph + t * 0.5, 0, TAU);
      });
      ctx.fillStyle = "rgba(150,144,138,0.4)"; ctx.fill(dark);
      ctx.fillStyle = "rgba(196,190,184,0.35)"; ctx.fill(light);
      for (const p of field("embers", 16, () => 1.05)) { // rare rising embers
        const e = Math.sin(Math.PI * mod(t * 0.12 + p.ph / TAU, 1));
        const a = 0.55 * e * (0.6 + 0.4 * Math.sin(t * 9 + p.ph * 7));
        if (a < 0.04) continue;
        const [x, y] = at(p, 3, -(22 + 16 * p.v), Math.sin(t * 1.7 + p.ph) * 6, 0);
        glow(ctx, x, y, 3.5, 1.1, "255,140,50", "255,206,130", a);
      }
      break;
    }
    case "mist": {
      for (const p of field("mist", 4, () => 0.9)) {
        const R = (0.22 + 0.12 * p.s) * Math.max(W, H);
        const x = mod(p.x * W + t * (6 + 4 * p.v) - cx * p.d, W + 2 * R) - R, y = mod(p.y * H - cy * p.d, H + 2 * R) - R;
        const grd = ctx.createRadialGradient(x, y, 0, x, y, R);
        grd.addColorStop(0, `rgba(214,226,210,${(0.07 + 0.04 * p.v).toFixed(3)})`);
        grd.addColorStop(1, "rgba(214,226,210,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(x - R, y - R, R * 2, R * 2);
      }
      for (const p of field("fireflies", count(26), () => 1)) {
        const b = Math.pow(Math.max(0, Math.sin(t * (1.2 + p.v) + p.ph * 5)), 6);
        if (b < 0.05) continue;
        const [x, y] = at(p, 0, 0, Math.sin(t * 0.4 * (0.5 + p.v) + p.ph) * 30, Math.cos(t * 0.33 + p.ph * 1.7) * 22);
        glow(ctx, x, y, 4, 1.2, "200,255,120", "240,255,190", 0.8 * b);
      }
      break;
    }
    case "motes": {
      const stars = new Path2D(), cores = new Path2D();
      for (const p of field("motes", count(80), (_, r) => 0.9 + 0.3 * r())) {
        if (Math.sin(t * 3 + p.ph * 9) < -0.3) continue; // twinkle off
        const [x, y] = at(p, 0, -(10 + 14 * p.v), Math.sin(t * 0.6 + p.ph) * 10, 0);
        sparkle(stars, cores, x, y, 1.5 + 2 * p.s);
      }
      // A denser cloud rising around the Citadel, anchored to the world.
      const c = state.citadel, TS = TILE_SIZE;
      for (const [i, p] of field("citadel", 70, () => 1).entries()) {
        const P = 4 + 3 * p.v, u = t / P + p.ph, cyc = Math.floor(u), f = u - cyc;
        const r = Math.sqrt(uhash(i, cyc, 77)) * 7 * TS, a = uhash(i, cyc, 78) * TAU;
        const sx = (c.x * TS + Math.cos(a) * r - camera.x) * z, sy = (c.y * TS + Math.sin(a) * r - f * 50 - camera.y) * z;
        if (sx < -10 || sy < -10 || sx > viewportW + 10 || sy > viewportH + 10 || Math.sin(Math.PI * f) < 0.25) continue;
        sparkle(stars, cores, sx, sy, 1.5 + 2.2 * p.s);
      }
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = "rgba(200,170,255,0.32)"; ctx.stroke(stars);
      ctx.fillStyle = "rgba(226,206,255,0.55)"; ctx.fill(cores);
      break;
    }
  }
  ctx.restore();
}

/** A four-point sparkle: a thin cross plus a tiny core. */
function sparkle(stars: Path2D, cores: Path2D, x: number, y: number, s: number): void {
  stars.moveTo(x - s, y); stars.lineTo(x + s, y);
  stars.moveTo(x, y - s); stars.lineTo(x, y + s);
  cores.moveTo(x + 0.9, y); cores.arc(x, y, 0.9, 0, TAU);
}

/** A soft glowing point (embers, fireflies). */
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, halo: number, core: number, haloRgb: string, coreRgb: string, a: number): void {
  ctx.fillStyle = `rgba(${haloRgb},${(a * 0.3).toFixed(3)})`;
  ctx.beginPath(); ctx.arc(x, y, halo, 0, TAU); ctx.fill();
  ctx.fillStyle = `rgba(${coreRgb},${Math.min(0.9, a).toFixed(3)})`;
  ctx.beginPath(); ctx.arc(x, y, core, 0, TAU); ctx.fill();
}
