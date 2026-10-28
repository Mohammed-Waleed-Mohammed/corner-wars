// World layers (15-logic §6, 24 §D, 26 §D), all in the state's biome (`state.biome`).
//  • STATIC terrain cache (terrainCache.ts): built once per map/biome (and again when real art
//    finishes loading) into an offscreen world-resolution canvas, then blitted (one drawImage of the
//    visible region) per frame.
//  • ANIMATED overlay (visible area only, cheap, batched): the biome's water style (water.ts), tufts
//    swaying in a travelling wind wave, tree canopies swaying.
//  • FOG cache: ONE PIXEL PER TILE, rebuilt (putImageData) when state.fogVersion bumps, drawn scaled up
//    with smoothing — soft edges for free. It used to be a world-resolution canvas (32 px per tile:
//    4608² px on a 144-tile map) refilled tile by tile; the minimap now reuses the same tiny canvas.

import { FOG_ALPHA, TILE_SIZE } from "../../config/constants";
import type { BiomeId, GameState, TerrainType } from "../../core/types";
import { BIOMES, type TuftSpecies } from "../../content/biomes";
import type { Camera } from "../camera";
import { artVersion, hasRealSprite, spriteVariants, tileHash } from "../terrainArt";
import { buildTerrain, treesAt } from "./terrainCache";
import { drawWaterAnim } from "./water";

const TS = TILE_SIZE;
/** While real images stream in, rebuild the static cache at most this often (each load bumps). */
const ART_REBUILD_MS = 400;

let terrainCanvas: HTMLCanvasElement | null = null;
let terrainFor: TerrainType[][] | null = null; // the map the cache was built for (new match → rebuild)
let terrainBiome: BiomeId | null = null;
let terrainArtVersion = -1;
let lastBuild = 0;
let fogCanvas: HTMLCanvasElement | null = null;
let fogImage: ImageData | null = null;
let fogFor: unknown = null;
let lastFogVersion = -1;

/** The state's biome (falls back to verdant for states built before biomes existed). */
export function biomeOf(state: GameState): BiomeId {
  return state.biome && BIOMES[state.biome] ? state.biome : "verdant";
}

// Offscreen canvases are sized to the LOADED map (18 §M2: maps vary in size), not a fixed 48×48.
function make(state: GameState): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = state.mapWidth * TS;
  c.height = state.mapHeight * TS;
  return c;
}

export function drawTerrainLayer(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
  const v = artVersion(), biome = biomeOf(state), now = performance.now();
  const fresh = !terrainCanvas || terrainFor !== state.terrain || terrainBiome !== biome
    || terrainCanvas.width !== state.mapWidth * TS || terrainCanvas.height !== state.mapHeight * TS;
  if (fresh || (terrainArtVersion !== v && now - lastBuild >= ART_REBUILD_MS)) {
    if (fresh) terrainCanvas = make(state);
    buildTerrain(terrainCanvas!, state, biome);
    terrainFor = state.terrain;
    terrainBiome = biome;
    terrainArtVersion = artVersion(); // building may itself have started this biome's image loads
    lastBuild = now;
  }
  blit(ctx, terrainCanvas!, camera, true);
}

// ── animated overlay (visible region only) ────────────────────────────────────────────────────────

/** Procedural (vector) tuft look per species: density, height, curl, highlight colour. */
const TUFT: Record<TuftSpecies, { density: number; h: number; curl: number; tip?: string }> = {
  grass: { density: 0.38, h: 1, curl: 1 },
  dryGrass: { density: 0.26, h: 0.9, curl: 1.3 },
  frostGrass: { density: 0.22, h: 0.85, curl: 0.8, tip: "rgba(240,246,252,0.85)" },
  ashGrass: { density: 0.24, h: 0.9, curl: 0.9 },
  reed: { density: 0.3, h: 1.45, curl: 0.4 },
  crystalGrass: { density: 0.24, h: 1.05, curl: 0 },
};

export function drawTerrainAnim(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera, timeMs: number): void {
  const biome = biomeOf(state), b = BIOMES[biome];
  const z = camera.zoom, t = timeMs / 1000;
  const x0 = Math.max(0, Math.floor(camera.x / TS) - 2), y0 = Math.max(0, Math.floor(camera.y / TS) - 2);
  const x1 = Math.min(state.mapWidth - 1, Math.ceil((camera.x + camera.viewportW / z) / TS) + 1);
  const y1 = Math.min(state.mapHeight - 1, Math.ceil((camera.y + camera.viewportH / z) / TS) + 1);
  const T = state.terrain;
  // World px → device px, composed with the caller's CSS-px (HiDPI) transform.
  const m = ctx.getTransform(), S = z * m.a, ex = m.e - camera.x * S, ey = m.f - camera.y * S;
  ctx.save();
  ctx.setTransform(S, 0, 0, S, ex, ey);

  drawWaterAnim(ctx, state, biome, { x0, y0, x1, y1 }, t, z);

  // Tufts swaying in a travelling wind wave: vector blades in the biome's tones, or real sprites.
  if (z >= 0.6) {
    const look = TUFT[b.tuft];
    if (!hasRealSprite(biome, "tuft")) {
      const tone = b.tuftTone;
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? `rgba(${tone.dark.join(",")},0.85)` : look.tip ?? `rgba(${tone.light.join(",")},0.75)`;
        ctx.lineWidth = pass === 0 ? 1.6 : 1.1;
        ctx.lineCap = "round";
        ctx.beginPath();
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (T[y][x] !== "ground" && T[y][x] !== "hill") continue;
            if (tileHash(x, y, 130) > look.density) continue;
            const bx = x * TS + TS * tileHash(x, y, 131), by = y * TS + TS * (0.5 + 0.45 * tileHash(x, y, 132));
            const sway = Math.sin(t * 2 - (bx + by) * 0.012 + tileHash(x, y, 133)) * 2.2 * (look.curl > 0 ? 1 : 0.4);
            for (let k = 0; k < 3; k++) {
              if (pass === 1 && k !== 1) continue; // pass 0: all three blades dark; pass 1: lit middle blade
              const ox = (k - 1) * 2.6, h = (7 + 3 * tileHash(x, y, 134 + k)) * look.h;
              ctx.moveTo(bx + ox, by);
              if (look.curl === 0) ctx.lineTo(bx + ox * 1.4 + sway, by - h); // crystal needles: straight
              else ctx.quadraticCurveTo(bx + ox + sway * 0.4 * look.curl, by - h * 0.6, bx + ox * 1.6 + sway, by - h);
            }
          }
        }
        ctx.stroke();
      }
    } else {
      const tufts = spriteVariants(biome, "tuft");
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (T[y][x] !== "ground" && T[y][x] !== "hill") continue;
          if (tileHash(x, y, 130) > Math.min(0.3, look.density)) continue;
          const bx = x * TS + TS * tileHash(x, y, 131), by = y * TS + TS * (0.5 + 0.45 * tileHash(x, y, 132));
          const sway = Math.sin(t * 2 - (bx + by) * 0.012 + tileHash(x, y, 133)) * 0.18;
          const img = tufts[Math.floor(tileHash(x, y, 135) * tufts.length)];
          const s = TS * 0.7;
          ctx.setTransform(S, 0, sway * S, S, ex + bx * S, ey + by * S); // skew around the base = sway
          ctx.drawImage(img, -s / 2, -s, s, s);
        }
      }
      ctx.setTransform(S, 0, 0, S, ex, ey);
    }
  }

  // Tree canopies, gently swaying (shadows are in the static cache). Forest tiles draw the biome's
  // species (woodland, palms, spruce, charred trunks, mangroves, crystal groves…).
  const trees = spriteVariants(biome, "tree");
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (T[y][x] !== "forest") continue;
      for (const tr of treesAt(x, y, b)) {
        const a = Math.sin(t * 1.1 + tr.phase) * 0.035 * tr.sway;
        const cos = Math.cos(a) * S, sin = Math.sin(a) * S;
        ctx.setTransform(cos, sin, -sin, cos, ex + tr.wx * S, ey + tr.wy * S);
        ctx.drawImage(trees[tr.v % trees.length], -tr.size / 2, -tr.size / 2, tr.size, tr.size);
      }
    }
  }
  ctx.restore();
}

// ── fog ─────────────────────────────────────────────────────────────────────────────────────────

/** The fog as a mapWidth × mapHeight canvas (one pixel per tile, black with the fog alpha). Rebuilt
 *  only when the fog recomputes (state.fogVersion); shared by the world fog layer and the minimap. */
export function fogTileCanvas(state: GameState): HTMLCanvasElement {
  const version = state.fogVersion ?? 0;
  const W = state.mapWidth, H = state.mapHeight;
  if (!fogCanvas || fogFor !== state.fog || fogCanvas.width !== W || fogCanvas.height !== H || lastFogVersion !== version) {
    if (!fogCanvas || fogCanvas.width !== W || fogCanvas.height !== H) {
      fogCanvas = document.createElement("canvas");
      fogCanvas.width = W;
      fogCanvas.height = H;
      fogImage = null;
    }
    const fc = fogCanvas.getContext("2d")!;
    fogImage ??= fc.createImageData(W, H);
    const d = fogImage.data; // RGB stay 0 (black); only alpha varies
    const aUnexplored = Math.round(FOG_ALPHA.unexplored * 255), aExplored = Math.round(FOG_ALPHA.explored * 255);
    for (let ty = 0; ty < H; ty++) {
      const row = state.fog[ty];
      for (let tx = 0; tx < W; tx++) {
        const st = row[tx];
        d[(ty * W + tx) * 4 + 3] = st === "visible" ? 0 : st === "unexplored" ? aUnexplored : aExplored;
      }
    }
    fc.putImageData(fogImage, 0, 0);
    lastFogVersion = version;
    fogFor = state.fog;
  }
  return fogCanvas;
}

export function drawFogLayer(ctx: CanvasRenderingContext2D, state: GameState, camera: Camera): void {
  blit(ctx, fogTileCanvas(state), camera, true, TS); // smoothing on → soft fog edges (24 §D)
}

/** Blit the visible world region of an offscreen canvas to the viewport (clamped to the map). `scale`
 *  is world px per canvas px (1 for world-resolution canvases, TILE_SIZE for a per-tile one). */
function blit(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, camera: Camera, smooth: boolean, scale = 1): void {
  const z = camera.zoom * scale; // viewport px per canvas px
  let sx = camera.x / scale;
  let sy = camera.y / scale;
  let sw = camera.viewportW / z;
  let sh = camera.viewportH / z;
  let dx = 0;
  let dy = 0;
  let dw = camera.viewportW;
  let dh = camera.viewportH;

  if (sx < 0) { dx += -sx * z; dw -= -sx * z; sw += sx; sx = 0; }
  if (sy < 0) { dy += -sy * z; dh -= -sy * z; sh += sy; sy = 0; }
  if (sx + sw > canvas.width) { const cut = sx + sw - canvas.width; sw -= cut; dw -= cut * z; }
  if (sy + sh > canvas.height) { const cut = sy + sh - canvas.height; sh -= cut; dh -= cut * z; }
  if (sw <= 0 || sh <= 0) return;

  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = prev;
}
