// Procedural LAND materials (26 §D/§F): ground, forest floor, road, hill, shore sand and mountain
// tops. Each factory takes the biome's tone for that material and a seed and returns a pixel shader
// over torus coords (u, v) ∈ [0, 1). Layering is the same everywhere: multi-octave base relief →
// low-frequency hue drift (colour variation without a brightness gradient) → material character →
// a small speck layer. Low octaves start at 8 cells per repeat (one tile) so the lighting stays even.

import type { RGB, Tone } from "../../content/biomes";
import { blend, cell, fbm, perlin, ramp, ridge, shadeBy, smooth, speck, speckR, warm, worley, lighten, darken } from "./noise";

export type Shader = (u: number, v: number, o: number[]) => void;
export type Mat = (tn: Tone, s: number) => Shader;

const L = 0.7071; // light from the top-left: L = (−L, −L)

/** Common base: fBm relief + fine grain + hue drift. `c` = contrast. */
function base(u: number, v: number, tn: Tone, s: number, o: number[], c = 1, grain = 0.07): number {
  const t = 0.5 + (fbm(u, v, 8, 5, s) - 0.5) * c + perlin(u, v, 128, 128, s + 31) * grain;
  ramp(tn, t, o);
  warm(o, perlin(u, v, 4, 4, s + 47) * 0.8);
  return t;
}
/** Generic light/dark speckle (pebbles, grit). */
function grit(u: number, v: number, tn: Tone, s: number, o: number[], d: number): void {
  const a = speck(u, v, s + 61, d);
  if (a > 0) blend(o, speckR < 0.5 ? lighten(tn.light, 0.25) : darken(tn.dark, 0.25), a * (0.35 + 0.35 * speckR));
}

// ── vegetated ground ────────────────────────────────────────────────────────────────────────────

export const grass = (flowers: boolean): Mat => (tn, s) => (u, v, o) => {
  const clump = smooth(0.1, 0.55, perlin(u, v, 24, 24, s + 11));
  const t = 0.5 + (fbm(u, v, 8, 5, s) - 0.5) - clump * 0.12 + perlin(u, v, 128, 128, s + 13) * 0.14 + perlin(u, v, 256, 256, s + 14) * 0.06;
  ramp(tn, t, o);
  warm(o, perlin(u, v, 4, 4, s + 15) * 0.9 + smooth(0.2, 0.6, perlin(u, v, 12, 12, s + 16)) * 0.5);
  let a = speck(u, v, s + 17, 0.03);
  if (a > 0) blend(o, lighten(tn.light, 0.15), a * 0.6);
  a = speck(u, v, s + 18, 0.02);
  if (a > 0) blend(o, darken(tn.dark, 0.2), a * 0.55);
  if (flowers) {
    a = speck(u, v, s + 19, 0.0025, 0.75);
    if (a > 0) blend(o, speckR < 0.4 ? [236, 232, 214] : speckR < 0.75 ? [232, 206, 84] : [198, 150, 214], a * 0.85);
  }
};

/** Leaf litter / needle beds under trees; `bits` are the litter colours. */
export const litter = (bits: RGB[], density: number, mossy: boolean): Mat => (tn, s) => (u, v, o) => {
  base(u, v, tn, s, o, 0.9, 0.1);
  if (mossy) blend(o, [tn.mid[0] * 0.85, tn.mid[1] * 1.15, tn.mid[2] * 0.8], smooth(0.15, 0.5, perlin(u, v, 12, 12, s + 3)) * 0.5);
  const a = speck(u, v, s + 5, density, 0.8);
  if (a > 0) blend(o, bits[Math.floor(speckR * bits.length)], a * 0.6);
  grit(u, v, tn, s, o, 0.012);
};

// ── bare ground ─────────────────────────────────────────────────────────────────────────────────

/** Packed earth / gravel track (no direction). `stones` = pebble density. */
export const dirt = (stones: number, chips?: RGB): Mat => (tn, s) => (u, v, o) => {
  const t = base(u, v, tn, s, o, 0.9, 0.09);
  shadeBy(o, 1 - smooth(0.62, 0.9, ridge(u, v, 10, s + 7)) * 0.08 * t);
  grit(u, v, tn, s, o, stones);
  if (chips) {
    const a = speck(u, v, s + 9, 0.02, 0.7);
    if (a > 0) blend(o, chips, a * 0.55);
  }
};

/** Fine sand / powder; `sparkle` adds glints (salt, glass, black sand). */
export const sand = (sparkle: number): Mat => (tn, s) => (u, v, o) => {
  const t = 0.5 + (fbm(u, v, 16, 4, s) - 0.5) * 0.7 + perlin(u, v, 128, 128, s + 3) * 0.1 + perlin(u, v, 256, 256, s + 4) * 0.08;
  ramp(tn, t, o);
  warm(o, perlin(u, v, 4, 4, s + 5) * 0.5);
  grit(u, v, tn, s, o, 0.03);
  if (sparkle > 0) {
    const a = speck(u, v, s + 8, sparkle, 0.55);
    if (a > 0) blend(o, [255, 252, 244], a * 0.75);
  }
};

/** Saltglass hardpan: a polygonal network of raised white salt ridges over a pale crust. */
export const saltCrust: Mat = (tn, s) => (u, v, o) => {
  const wu = u + perlin(u, v, 6, 6, s + 1) * 0.012, wv = v + perlin(u, v, 6, 6, s + 2) * 0.012;
  worley(wu, wv, 10, s + 3);
  const e = cell.f2 - cell.f1, id = cell.id;
  ramp(tn, 0.46 + (id - 0.5) * 0.14 + (fbm(u, v, 16, 4, s) - 0.5) * 0.45 + perlin(u, v, 128, 128, s + 4) * 0.06, o);
  warm(o, perlin(u, v, 4, 4, s + 5) * 0.5);
  worley(wu, wv, 26, s + 6);
  shadeBy(o, 1 - (1 - smooth(0, 0.05, cell.f2 - cell.f1)) * 0.06); // faint secondary cracks
  blend(o, lighten(tn.light, 0.55), (1 - smooth(0.02, 0.11, e)) * 0.6); // raised ridge
  shadeBy(o, 1 - (1 - smooth(0, 0.022, e)) * 0.2); // the split along the ridge's crest
  grit(u, v, tn, s, o, 0.015);
};

/** Snowfield: wind scallops lit from the top-left, blue shadows and sparkle. */
export const snow = (scallop: number): Mat => (tn, s) => (u, v, o) => {
  const wu = u + perlin(u, v, 4, 4, s + 1) * 0.02, wv = v + perlin(u, v, 4, 4, s + 2) * 0.02;
  worley(wu, wv, 12, s + 3);
  const lit = -(cell.dx + cell.dy) * L; // concave dish: its far wall faces the light
  const t = 0.55 + (fbm(u, v, 8, 4, s) - 0.5) * 0.6 + lit * 0.16 * scallop + (1 - smooth(0, 0.08, cell.f2 - cell.f1)) * 0.06 + perlin(u, v, 128, 128, s + 4) * 0.04;
  ramp(tn, t, o);
  blend(o, [168, 186, 212], smooth(0, 0.5, -lit) * 0.3 * scallop); // blue shade on the dish walls facing away
  warm(o, -0.35 * (1 - t) + perlin(u, v, 4, 4, s + 5) * 0.25); // cooler in the hollows
  const a = speck(u, v, s + 6, 0.012, 0.5);
  if (a > 0) blend(o, speckR < 0.7 ? [255, 255, 255] : [214, 236, 255], a);
};

/** Snow over gravel, ground or ice: patches of `tn` showing through white. */
export const snowPatches = (cover: number, flecks: number): Mat => (tn, s) => (u, v, o) => {
  base(u, v, tn, s, o, 0.9, 0.1);
  grit(u, v, tn, s, o, 0.05);
  const p = smooth(cover - 0.08, cover + 0.06, fbm(u, v, 16, 3, s + 9));
  blend(o, [236, 241, 247], p * 0.9);
  const a = speck(u, v, s + 10, flecks, 0.6);
  if (a > 0) blend(o, [242, 246, 250], a * 0.8);
};

/** Cinder ash plain: soft grey drifts, flakes and sparse glowing ember flecks. */
export const ash = (embers: number, charcoal: number): Mat => (tn, s) => (u, v, o) => {
  base(u, v, tn, s, o, 0.8, 0.08);
  let a = speck(u, v, s + 3, 0.035);
  if (a > 0) blend(o, lighten(tn.light, 0.2), a * 0.35);
  a = speck(u, v, s + 4, charcoal, 0.85);
  if (a > 0) blend(o, [18, 16, 15], a * 0.7);
  a = speck(u, v, s + 5, embers, 0.75);
  if (a > 0) blend(o, speckR < 0.6 ? [255, 120, 36] : [255, 196, 90], a * 0.95);
};

/** Mudflat: brown-olive mud with wet, glossy sheen patches. */
export const mud = (grassBits: number): Mat => (tn, s) => (u, v, o) => {
  base(u, v, tn, s, o, 0.85, 0.08);
  const wet = smooth(0.5, 0.66, fbm(u, v, 8, 3, s + 20));
  shadeBy(o, 1 - wet * 0.2);
  blend(o, [150, 162, 166], wet * smooth(-0.1, 0.5, perlin(u, v, 8, 8, s + 21)) * 0.22); // soft wet sheen
  blend(o, [196, 206, 204], wet * Math.pow(ridge(u, v, 12, s + 23), 14) * 0.25); // glints along ripples
  const a = speck(u, v, s + 22, grassBits, 0.8);
  if (a > 0) blend(o, [96, 112, 54], a * 0.6 * (1 - wet));
  grit(u, v, tn, s, o, 0.015);
};

/** Glassed / crystal ground: faint facets with thin bright cracks and rare glints. */
export const facets = (n: number, strength: number): Mat => (tn, s) => (u, v, o) => {
  worley(u, v, n, s + 1, 0.9);
  const lit = (cell.dx + cell.dy) * L; // facet tilted away from its seed → lit edge toward light
  const t = 0.5 + (fbm(u, v, 8, 4, s) - 0.5) * 0.7 + (cell.id - 0.5) * 0.14 * strength + lit * 0.1 * strength + perlin(u, v, 128, 128, s + 2) * 0.05;
  ramp(tn, t, o);
  warm(o, perlin(u, v, 4, 4, s + 3) * 0.4);
  blend(o, lighten(tn.light, 0.35), (1 - smooth(0, 0.035, cell.f2 - cell.f1)) * 0.4 * strength);
  const a = speck(u, v, s + 4, 0.006, 0.6);
  if (a > 0) blend(o, [236, 220, 255], a * 0.9);
};

// ── rock ────────────────────────────────────────────────────────────────────────────────────────

/** Weathered rock: relief, crack network with lit lips, speckled minerals. `snowCap` > 0 adds snow. */
export const rock = (minerals: number, snowCap: number, mossy: boolean): Mat => (tn, s) => (u, v, o) => {
  base(u, v, tn, s, o, 1.05, 0.1);
  // fractures: a warped cellular network, each crack a dark line with a lit lip on its upper-left
  worley(u + perlin(u, v, 6, 6, s + 2) * 0.025, v + perlin(u, v, 6, 6, s + 3) * 0.025, 7, s + 4, 0.9);
  const e = cell.f2 - cell.f1, lip = (cell.dx + cell.dy) * L;
  shadeBy(o, 1 - (1 - smooth(0, 0.03, e)) * 0.3);
  blend(o, lighten(tn.light, 0.15), (1 - smooth(0.03, 0.08, e)) * smooth(0, 0.3, lip) * 0.2);
  shadeBy(o, 1 + perlin(u, v, 24, 24, s + 9) * 0.08); // facet relief
  let a = speck(u, v, s + 5, minerals, 0.7);
  if (a > 0) blend(o, speckR < 0.5 ? lighten(tn.light, 0.3) : darken(tn.dark, 0.3), a * 0.5);
  if (mossy) blend(o, [70, 92, 44], smooth(0.58, 0.72, fbm(u, v, 16, 3, s + 6)) * 0.55);
  if (snowCap > 0) {
    const p = smooth(snowCap - 0.06, snowCap + 0.04, fbm(u, v, 16, 3, s + 7) + smooth(0.05, 0.2, e) * 0.05);
    blend(o, [232, 238, 246], p * 0.92);
  }
  a = speck(u, v, s + 8, 0.01);
  if (a > 0) blend(o, darken(tn.dark, 0.4), a * 0.5);
};

/** Glassy faceted rock (obsidian, crystal massif): flat-shaded facets with bright edges. */
export const glassRock = (edge: RGB, veins: boolean): Mat => (tn, s) => (u, v, o) => {
  worley(u, v, 7, s + 1, 0.95);
  const lit = (cell.dx + cell.dy) * L * 1.6 + (cell.id - 0.5) * 0.6;
  ramp(tn, 0.45 + lit * 0.32 + (fbm(u, v, 16, 3, s) - 0.5) * 0.3, o);
  const e = cell.f2 - cell.f1;
  blend(o, edge, (1 - smooth(0, 0.05, e)) * 0.55);
  if (veins) blend(o, edge, Math.pow(ridge(u, v, 6, s + 2), 10) * 0.5);
  const a = speck(u, v, s + 3, 0.008, 0.5);
  if (a > 0) blend(o, lighten(edge, 0.5), a * 0.8);
};

/** Columnar basalt tops: polygon plates with dark joints. */
export const basalt: Mat = (tn, s) => (u, v, o) => {
  worley(u + perlin(u, v, 8, 8, s) * 0.006, v + perlin(u, v, 8, 8, s + 1) * 0.006, 11, s + 2, 0.7);
  ramp(tn, 0.5 + (cell.id - 0.5) * 0.3 + (fbm(u, v, 16, 3, s + 3) - 0.5) * 0.5 + perlin(u, v, 128, 128, s + 4) * 0.08, o);
  shadeBy(o, 1 - (1 - smooth(0.02, 0.1, cell.f2 - cell.f1)) * 0.55);
  grit(u, v, tn, s, o, 0.03);
};
