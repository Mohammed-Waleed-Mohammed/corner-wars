// Procedural WATER, SHALLOWS and BRIDGE materials (26 §D). Same shader contract as landTex.ts.
// Liquids stay calm and directionless (the renderer animates them); bridges are the one material
// with a direction: planks/blocks run along X and the renderer rotates the deck for its run.

import type { RGB } from "../../content/biomes";
import { blend, cell, fbm, hash, perlin, ramp, ridge, shadeBy, smooth, speck, speckR, warm, worley, lighten, darken } from "./noise";
import type { Mat } from "./landTex";

/** Lake water: deep, gently varying, faint isotropic wave crests. `calm` lowers everything. */
export const lake = (calm: number): Mat => (tn, s) => (u, v, o) => {
  const t = 0.45 + (fbm(u, v, 8, 5, s) - 0.5) * 0.8 * calm;
  ramp(tn, t, o);
  warm(o, perlin(u, v, 4, 4, s + 1) * 0.3);
  const crest = Math.pow(ridge(u + perlin(u, v, 8, 8, s + 2) * 0.03, v, 16, s + 3), 6);
  blend(o, lighten(tn.light, 0.25), crest * 0.22 * calm);
  shadeBy(o, 1 - Math.pow(ridge(u, v, 24, s + 4), 8) * 0.08 * calm);
};

/** Clear shallows: water over a sandy bottom, with a caustic light network. */
export const caustic = (crust: RGB | null): Mat => (tn, s) => (u, v, o) => {
  ramp(tn, 0.5 + (fbm(u, v, 8, 4, s) - 0.5) * 0.7, o);
  warm(o, perlin(u, v, 4, 4, s + 1) * 0.4);
  worley(u + perlin(u, v, 6, 6, s + 2) * 0.02, v + perlin(u, v, 6, 6, s + 3) * 0.02, 14, s + 4);
  blend(o, lighten(tn.light, 0.4), (1 - smooth(0, 0.14, cell.f2 - cell.f1)) * 0.38);
  if (crust) blend(o, crust, smooth(0.6, 0.68, fbm(u, v, 6, 4, s + 5)) * 0.85); // salt crust islands
  const a = speck(u, v, s + 6, 0.02, 0.7);
  if (a > 0) blend(o, darken(tn.dark, 0.2), a * 0.3);
};

/** Ice sheet: pale blue with a white-rimmed crack network, frost blooms and trapped bubbles. */
export const ice: Mat = (tn, s) => (u, v, o) => {
  ramp(tn, 0.5 + (fbm(u, v, 8, 4, s) - 0.5) * 0.6 + perlin(u, v, 64, 64, s + 1) * 0.05, o);
  worley(u + perlin(u, v, 5, 5, s + 2) * 0.03, v + perlin(u, v, 5, 5, s + 3) * 0.03, 6, s + 4, 0.9);
  const e = cell.f2 - cell.f1;
  blend(o, [246, 250, 255], (1 - smooth(0.005, 0.05, e)) * 0.6);
  shadeBy(o, 1 - (1 - smooth(0, 0.012, e)) * 0.25);
  blend(o, [236, 244, 250], smooth(0.6, 0.75, fbm(u, v, 8, 4, s + 5)) * 0.55); // frost bloom
  const a = speck(u, v, s + 6, 0.01, 0.5);
  if (a > 0) blend(o, [250, 252, 255], a * 0.7);
};

/** Lava (cinder `water`): dark crust plates floating on bright molten cracks. */
export const lava: Mat = (tn, s) => (u, v, o) => {
  worley(u + perlin(u, v, 4, 4, s) * 0.03, v + perlin(u, v, 4, 4, s + 1) * 0.03, 6, s + 2, 0.9);
  const e = cell.f2 - cell.f1, heat = fbm(u, v, 8, 4, s + 3);
  ramp(tn, 0.62 + heat * 0.38, o); // molten: orange → yellow
  const plate = smooth(0.04, 0.2, e) * (0.55 + 0.45 * cell.id);
  blend(o, darken(tn.dark, 0.35), plate * (0.7 + 0.25 * heat));
  shadeBy(o, 1 - plate * Math.pow(ridge(u, v, 18, s + 4), 6) * 0.3); // cooler seams on the crust
  blend(o, [255, 224, 140], (1 - smooth(0, 0.035, e)) * 0.85); // white-hot crack cores
};

/** Cinder shallows ("cooling crust"): mostly dark crust with thin glowing orange cracks. */
export const crust: Mat = (tn, s) => (u, v, o) => {
  worley(u + perlin(u, v, 6, 6, s) * 0.02, v + perlin(u, v, 6, 6, s + 1) * 0.02, 9, s + 2);
  const e = cell.f2 - cell.f1;
  ramp(tn, 0.18 + cell.id * 0.18 + (fbm(u, v, 16, 3, s + 3) - 0.5) * 0.3, o);
  blend(o, tn.light, (1 - smooth(0, 0.09, e)) * 0.8);
  blend(o, [255, 168, 70], (1 - smooth(0, 0.03, e)) * 0.8);
  const a = speck(u, v, s + 4, 0.004, 0.6);
  if (a > 0) blend(o, [255, 140, 50], a * 0.8);
};

/** Bog water / bog: dark still water with clustered duckweed flecks. */
export const bog = (weed: number): Mat => (tn, s) => (u, v, o) => {
  ramp(tn, 0.35 + (fbm(u, v, 8, 4, s) - 0.5) * 0.5, o);
  warm(o, perlin(u, v, 4, 4, s + 1) * 0.5);
  const cluster = smooth(0.45, 0.75, fbm(u, v, 8, 3, s + 2));
  blend(o, [74, 96, 40], cluster * 0.25 * weed);
  const a = speck(u, v, s + 3, 0.01 + 0.14 * cluster * weed, 0.85);
  if (a > 0) blend(o, speckR < 0.7 ? [118, 150, 52] : [150, 176, 70], a * 0.8);
  blend(o, [150, 160, 150], Math.pow(ridge(u, v, 10, s + 4), 12) * 0.12); // oily sheen
};

/** Resonant pool: deep violet with soft light veins. */
export const resonant = (glow: number): Mat => (tn, s) => (u, v, o) => {
  ramp(tn, 0.3 + (fbm(u, v, 8, 4, s) - 0.5) * 0.45, o);
  const wu = u + perlin(u, v, 3, 3, s + 1) * 0.05, wv = v + perlin(u, v, 3, 3, s + 2) * 0.05;
  const vein = Math.pow(ridge(wu, wv, 5, s + 3), 7) * 0.6 + Math.pow(ridge(wu, wv, 9, s + 4), 10) * 0.35;
  blend(o, tn.light, vein * glow);
  const a = speck(u, v, s + 5, 0.004, 0.6);
  if (a > 0) blend(o, [220, 200, 255], a * 0.7 * glow);
};

/** Glass shallows: translucent violet facets with a caustic glow. */
export const glassShallows: Mat = (tn, s) => (u, v, o) => {
  worley(u, v, 9, s + 1, 0.9);
  ramp(tn, 0.45 + (cell.dx + cell.dy) * 0.18 + (fbm(u, v, 8, 3, s) - 0.5) * 0.5, o);
  blend(o, lighten(tn.light, 0.3), (1 - smooth(0, 0.05, cell.f2 - cell.f1)) * 0.45);
  worley(u, v, 15, s + 2);
  blend(o, tn.light, (1 - smooth(0, 0.12, cell.f2 - cell.f1)) * 0.22);
};

// ── bridges (along X) ───────────────────────────────────────────────────────────────────────────

export type DeckStyle = "wood" | "iron" | "weathered" | "stone" | "glass";

/** Bridge deck. Wood: 16 planks per repeat with staggered butt joints and nails. Stone/glass: 8
 *  courses of staggered blocks/panels. Iron: wood with two cross straps. */
export const deck = (style: DeckStyle): Mat => (tn, s) => (u, v, o) => {
  const x = u * 256, y = v * 256;
  const blocky = style === "stone" || style === "glass";
  const H = blocky ? 32 : 16, Lj = blocky ? 64 : 128;
  const row = Math.floor(y / H), fy = y - row * H;
  const off = blocky ? (row & 1) * (Lj / 2) : Math.floor(hash(row, 0, s) * 8) * 16;
  const xs = (((x - off) % 256) + 256) % 256, piece = Math.floor(xs / Lj), fx = xs - piece * Lj;
  const pid = hash(row, piece, s + 1);
  const ey = Math.min(fy, H - fy), ex = Math.min(fx, Lj - fx);
  if (blocky) {
    ramp(tn, 0.5 + (pid - 0.5) * 0.35 + (fbm(u, v, 16, 3, s + 2) - 0.5) * 0.5, o);
    const bevel = smooth(3, 0, fy) * 0.18 + smooth(3, 0, fx) * 0.12 - smooth(H - 3, H, fy) * 0.25 - smooth(Lj - 3, Lj, fx) * 0.15;
    if (style === "glass") {
      blend(o, lighten(tn.light, 0.35), (1 - smooth(0.5, 2.5, Math.min(ey, ex))) * 0.6 + Math.pow(ridge(u, v, 8, s + 3), 12) * 0.25);
      shadeBy(o, 1 + bevel);
    } else {
      shadeBy(o, 1 + bevel);
      const a = speck(u, v, s + 4, 0.05, 0.7);
      if (a > 0) blend(o, darken(tn.dark, 0.3), a * 0.4);
    }
    shadeBy(o, 1 - (1 - smooth(0.4, 1.4, Math.min(ey, ex))) * 0.55); // mortar / seams
    return;
  }
  const grain = perlin(u, v, 3, 96, s + 5) * 0.5 + perlin(u, v, 8, 160, s + 6) * 0.3;
  ramp(tn, 0.5 + (pid - 0.5) * 0.35 + grain * 0.35 + perlin(u, v, 64, 64, s + 7) * 0.05, o);
  shadeBy(o, 1 + smooth(2, 0, fy) * 0.1 - smooth(H - 2.5, H, fy) * 0.18);
  shadeBy(o, 1 - (1 - smooth(0.3, 1.2, Math.min(ey, ex))) * 0.6); // plank seams + butt joints
  const nx = Math.min(Math.abs(fx - 4), Math.abs(fx - (Lj - 4))), ny = Math.min(Math.abs(fy - 4), Math.abs(fy - 12));
  if (nx < 1 && ny < 1) blend(o, [52, 50, 48], (1 - Math.max(nx, ny)) * 0.9); // nails
  if (style === "weathered") {
    blend(o, [92, 110, 64], smooth(0.55, 0.75, fbm(u, v, 12, 3, s + 8)) * 0.4);
    warm(o, -0.3);
  }
  if (style === "iron") {
    const sx = (((x - 60) % 128) + 128) % 128; // straps at x ≈ 60 and 188
    if (sx < 8) {
      ramp({ dark: [40, 42, 46], mid: [72, 76, 82], light: [120, 126, 134] }, 0.5 + (fbm(u, v, 32, 2, s + 9) - 0.5) * 0.6 - smooth(6, 8, sx) * 0.3 + smooth(2, 0, sx) * 0.25, o);
      if (Math.abs(sx - 4) < 1.2 && Math.abs(fy - 8) < 1.2) blend(o, [150, 156, 164], 0.8); // rivet
    }
  }
};
