// The STATIC terrain cache (24 §D, 26 §D), painted once per (map, biome, art version) into an
// offscreen world-resolution canvas. Materials are biome textures drawn as organic "blobs" (a disc per
// tile, bridged to same-type neighbours) so edges are rounded; hills and mountains cast shadows in the
// biome's shadow tint and show cliff faces in its cliff colour; lakes get a shore ring and shallows;
// lava gets an additive glow at its shore; trees and boulders cast shadows; finally the biome's
// colour grade is multiplied over everything.

import { TILE_SIZE } from "../../config/constants";
import type { BiomeId, GameState, TerrainType } from "../../core/types";
import { BIOMES, type BiomeDef, type RGB, type TreeSpecies } from "../../content/biomes";
import { spriteVariants, texture, textureScale, tileHash, type TexKey } from "../terrainArt";

const TS = TILE_SIZE;
const rgba = (c: RGB, a: number): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// ── trees ───────────────────────────────────────────────────────────────────────────────────────

/** Species drawn smaller than a full crown, and how much each sways (rigid ones don't). */
const TREE_SCALE: Partial<Record<TreeSpecies, number>> = { cactus: 0.78, dwarfPine: 0.86, reeds: 0.9, ashFern: 0.85, crystalDead: 0.95 };
const TREE_SWAY: Partial<Record<TreeSpecies, number>> = { cactus: 0, crystal: 0, crystalDead: 0, glassTree: 0.4, charred: 0.35, burntPine: 0.5, bareBirch: 0.6 };

export interface TreeAt { wx: number; wy: number; size: number; v: number; phase: number; sway: number }

/** Deterministic tree placements for a forest tile: 1–2 trees, jittered, varied size/variant. */
export function treesAt(x: number, y: number, b: BiomeDef): TreeAt[] {
  const n = tileHash(x, y, 31) > 0.45 ? 2 : 1;
  const out: TreeAt[] = [];
  for (let k = 0; k < n; k++) {
    const v = Math.floor(tileHash(x, y, 70 + k) * 6), sp = b.trees[v];
    out.push({
      wx: (x + 0.2 + 0.6 * tileHash(x, y, 40 + k)) * TS,
      wy: (y + 0.2 + 0.6 * tileHash(x, y, 50 + k)) * TS,
      size: TS * (1.25 + 0.6 * tileHash(x, y, 60 + k)) * (TREE_SCALE[sp] ?? 1),
      v,
      phase: tileHash(x, y, 80 + k) * Math.PI * 2,
      sway: TREE_SWAY[sp] ?? 1,
    });
  }
  return out;
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

function pattern(g: CanvasRenderingContext2D, biome: BiomeId, k: TexKey): CanvasPattern | string {
  const p = g.createPattern(texture(biome, k), "repeat");
  if (!p) return "#000";
  const s = textureScale(biome, k);
  if (s !== 1) p.setTransform(new DOMMatrix().scale(s));
  return p;
}

/** Union of discs (one per matching tile, radius r·TS, edge wobble ±10%) bridged to same-kind
 *  neighbours — rounded convex corners, filled concave ones. One path, one fill. */
function blob(
  g: CanvasRenderingContext2D, state: GameState, is: (t: TerrainType) => boolean,
  fill: string | CanvasPattern, r: number, dx = 0, dy = 0, salt = 1,
): void {
  const W = state.mapWidth, H = state.mapHeight, T = state.terrain;
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && is(T[y][x]);
  g.fillStyle = fill;
  g.beginPath();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!is(T[y][x])) continue;
      const cx = x * TS + TS / 2 + dx, cy = y * TS + TS / 2 + dy;
      const rr = r * TS * (0.9 + 0.2 * tileHash(x, y, salt));
      g.moveTo(cx + rr, cy);
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      const R = r * TS;
      if (at(x + 1, y)) g.rect(cx, cy - R, TS, 2 * R);
      if (at(x, y + 1)) g.rect(cx - R, cy, 2 * R, TS);
      if (at(x + 1, y) && at(x, y + 1) && at(x + 1, y + 1)) g.rect(cx, cy, TS, TS);
    }
  }
  g.fill();
}

/** Travel direction of a bridge tile: horizontal if its run left/right ends on land on both sides. */
function bridgeRunsHorizontally(state: GameState, x: number, y: number): boolean {
  const T = state.terrain, W = state.mapWidth;
  let l = x, r = x;
  while (l > 0 && T[y][l - 1] === "bridge") l--;
  while (r < W - 1 && T[y][r + 1] === "bridge") r++;
  const land = (t: TerrainType | undefined): boolean => t !== undefined && t !== "water" && t !== "bridge" && t !== "shallows";
  return land(T[y][l - 1]) && land(T[y][r + 1]);
}

// ── the build ───────────────────────────────────────────────────────────────────────────────────

export function buildTerrain(c: HTMLCanvasElement, state: GameState, biome: BiomeId): void {
  const g = c.getContext("2d")!;
  const b = BIOMES[biome];
  const W = state.mapWidth, H = state.mapHeight, T = state.terrain;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, c.width, c.height);

  // 1. The base material everywhere.
  g.fillStyle = pattern(g, biome, "ground");
  g.fillRect(0, 0, c.width, c.height);

  // 2. Hills: a cast shadow down-right, the hill material, and a lit crest toward the light.
  const hill = (t: TerrainType): boolean => t === "hill";
  blob(g, state, hill, rgba(b.shadow, 0.34), 0.86, 6, 8, 2);
  blob(g, state, hill, pattern(g, biome, "hill"), 0.84, 0, 0, 3);
  blob(g, state, hill, "rgba(255,250,210,0.12)", 0.5, -4, -5, 11);

  // 3. Forest floor (the trees go on top in the animated layer).
  blob(g, state, (t) => t === "forest", pattern(g, biome, "forest_floor"), 0.85, 0, 0, 4);

  // 4. Roads (narrower blobs read as a path).
  blob(g, state, (t) => t === "road" || t === "bridge", pattern(g, biome, "road"), 0.62, 0, 0, 5);

  // 5. Lakes & rivers: shore → shallows ring → deep water.
  const wet = (t: TerrainType): boolean => t === "water" || t === "shallows" || t === "bridge";
  blob(g, state, wet, pattern(g, biome, "sand"), 1.0, 0, 0, 6);
  blob(g, state, wet, pattern(g, biome, "shallows"), 0.82, 0, 0, 7);
  blob(g, state, (t) => t === "water" || t === "bridge", pattern(g, biome, "water"), 0.74, 0, 0, 8);
  if (b.water === "lava") lavaGlow(g, state);

  // 6. Mountains: drop shadow, rock, then the biome's cliff colour on south-facing edges.
  const mtn = (t: TerrainType): boolean => t === "mountain";
  blob(g, state, mtn, rgba(b.shadow, 0.38), 0.86, 7, 9, 9);
  blob(g, state, mtn, pattern(g, biome, "mountain"), 0.84, 0, 0, 10);
  const cliff = g.createLinearGradient(0, 0, 0, TS * 0.6);
  cliff.addColorStop(0, rgba(b.cliff, 0));
  cliff.addColorStop(0.35, rgba(b.cliff, 0.75));
  cliff.addColorStop(1, rgba(b.cliff, 0));
  g.fillStyle = cliff;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      if (T[y][x] !== "mountain" || T[y + 1][x] === "mountain") continue;
      g.setTransform(1, 0, 0, 1, x * TS, y * TS + TS * 0.55); // one gradient, moved per tile
      g.fillRect(0, 0, TS, TS * 0.6);
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);

  // 7. Bridges: a deck across the water, planks perpendicular to travel, with rails.
  const deck = pattern(g, biome, "bridge");
  const bd = b.palette.bridge.dark, rail = rgba([bd[0] * 0.7, bd[1] * 0.7, bd[2] * 0.7], 0.9);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (T[y][x] !== "bridge") continue;
      const horizontal = bridgeRunsHorizontally(state, x, y);
      g.save();
      g.beginPath();
      g.rect(x * TS, y * TS, TS, TS);
      g.clip();
      if (horizontal) { g.translate(x * TS + TS / 2, y * TS + TS / 2); g.rotate(Math.PI / 2); g.translate(-(x * TS + TS / 2), -(y * TS + TS / 2)); }
      g.fillStyle = deck;
      g.fillRect(x * TS - TS, y * TS - TS, TS * 3, TS * 3);
      g.restore();
      g.fillStyle = rail;
      if (horizontal) {
        if (y === 0 || T[y - 1][x] !== "bridge") g.fillRect(x * TS, y * TS, TS, 3);
        if (y + 1 >= H || T[y + 1][x] !== "bridge") g.fillRect(x * TS, y * TS + TS - 3, TS, 3);
      } else {
        if (x === 0 || T[y][x - 1] !== "bridge") g.fillRect(x * TS, y * TS, 3, TS);
        if (x + 1 >= W || T[y][x + 1] !== "bridge") g.fillRect(x * TS + TS - 3, y * TS, 3, TS);
      }
    }
  }

  // 8. Boulders (with shadows), crags, bushes, and the trees' shadows (canopies are animated).
  const rocks = spriteVariants(biome, "rock"), bushes = spriteVariants(biome, "bush");
  const treeShadow = rgba(b.shadow, 0.35), rockShadow = rgba(b.shadow, 0.3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = T[y][x];
      if (t === "mountain" && tileHash(x, y, 97) < 0.3) {
        // scattered crags break up the rock texture so ridges read as rugged, not paved
        const s = TS * (0.9 + 0.5 * tileHash(x, y, 98));
        g.globalAlpha = 0.85;
        g.drawImage(rocks[Math.floor(tileHash(x, y, 99) * rocks.length)], x * TS + TS / 2 - s / 2, y * TS + TS / 2 - s / 2, s, s);
        g.globalAlpha = 1;
      } else if (t === "rock") {
        const s = TS * (1.05 + 0.3 * tileHash(x, y, 90));
        const cx = x * TS + TS / 2, cy = y * TS + TS / 2;
        g.fillStyle = rockShadow;
        g.beginPath(); g.ellipse(cx + 4, cy + 6, s * 0.36, s * 0.27, 0, 0, Math.PI * 2); g.fill();
        g.drawImage(rocks[Math.floor(tileHash(x, y, 91) * rocks.length)], cx - s / 2, cy - s / 2, s, s);
      } else if (t === "forest") {
        g.fillStyle = treeShadow;
        g.beginPath();
        for (const tr of treesAt(x, y, b)) { g.moveTo(tr.wx + 5 + tr.size * 0.4, tr.wy + 7); g.ellipse(tr.wx + 5, tr.wy + 7, tr.size * 0.4, tr.size * 0.32, 0, 0, Math.PI * 2); }
        g.fill();
      } else if (t === "ground" && tileHash(x, y, 92) < 0.035) {
        const s = TS * (0.6 + 0.35 * tileHash(x, y, 93));
        g.drawImage(bushes[Math.floor(tileHash(x, y, 94) * bushes.length)], x * TS + TS * tileHash(x, y, 95) * 0.5, y * TS + TS * tileHash(x, y, 96) * 0.5, s, s);
      } else if (t === "void") {
        g.fillStyle = "#0b0d10";
        g.fillRect(x * TS, y * TS, TS, TS);
      }
    }
  }

  // 9. Biome colour grade, multiplied over the whole cache.
  if (b.grade) {
    g.globalCompositeOperation = "multiply";
    g.fillStyle = b.grade;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "source-over";
  }
}

/** Lava shore glow: one additive radial gradient per lava tile that touches anything but lava. */
function lavaGlow(g: CanvasRenderingContext2D, state: GameState): void {
  const T = state.terrain, R = TS * 1.7;
  const lava = (x: number, y: number): boolean => { const t = T[y]?.[x]; return t === undefined || t === "water" || t === "bridge"; };
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, R);
  grd.addColorStop(0, "rgba(255,120,40,0.2)");
  grd.addColorStop(0.45, "rgba(255,90,24,0.08)");
  grd.addColorStop(1, "rgba(255,80,20,0)");
  g.globalCompositeOperation = "lighter";
  g.fillStyle = grd;
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      if (T[y][x] !== "water") continue;
      let shore = false;
      for (let dy = -1; dy <= 1 && !shore; dy++) for (let dx = -1; dx <= 1; dx++) if (!lava(x + dx, y + dy)) { shore = true; break; }
      if (!shore) continue;
      g.setTransform(1, 0, 0, 1, x * TS + TS / 2, y * TS + TS / 2);
      g.fillRect(-R, -R, R * 2, R * 2);
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
}
