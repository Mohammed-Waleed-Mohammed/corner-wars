// 24 §D / 26 §D / 29 §E — terrain art, per biome. Every texture and sprite has a procedural stand-in
// (render/art/*: seamless, deterministic, built from the biome palette in content/biomes.ts). Real
// art is picked up AUTOMATICALLY from src/assets/terrain/<biome>/<name>.png (Vite resolves the glob at
// build time, so missing files simply don't exist — no 404s). Files at the ROOT of that folder are
// the legacy verdant set (grass.png → ground, water_0.png → water, grass_tuft_N.png → tuft_N).
// Everything is lazy: a biome's images start loading, and its procedural stand-ins are generated,
// only when that biome is first drawn. When an image finishes loading it replaces its stand-in and
// artVersion() bumps, which makes the cached terrain layer rebuild. Rendering only — never the sim.

import type { BiomeId } from "../core/types";
import { BIOMES, SPRITE_COUNT, TEX_KEYS, type SpriteKind, type TexKey } from "../content/biomes";
import { BIOME_IDS, isBiomeId } from "../config/biomes";
import { hash, ihash } from "./art/noise";
import { renderTexture } from "./art/textures";
import { unitCanvas, type Fit } from "./art/spriteKit";
import { drawTree } from "./art/trees";
import { drawRock } from "./art/rocks";
import { drawBush, drawTuft } from "./art/plants";

export type { TexKey, SpriteKind } from "../content/biomes";

/** One texture repeat spans this many world px (8 tiles at TILE_SIZE 32). Real images of any size
 *  are scaled to it. */
export const TEX_WORLD = 256;
/** In-game resolution of procedural sprites (px; scaled to world size when drawn, up to 2× zoom). */
const SPRITE_PX: Record<SpriteKind, number> = { tree: 160, rock: 112, bush: 80, tuft: 64 };

// ── real-art registry (URLs only; images load per biome on first use) ───────────────────────────

const FILES = import.meta.glob("../assets/terrain/**/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const LEGACY = new Map<string, string>([["grass", "ground"], ["water_0", "water"]]);

/** Canonical asset name for a file name, or null if it isn't a terrain asset. */
function canonical(name: string, root: boolean): string | null {
  if (root) {
    const alias = LEGACY.get(name);
    if (alias) return alias;
    const t = /^grass_tuft_(\d+)$/.exec(name);
    if (t) name = `tuft_${t[1]}`;
  }
  if ((TEX_KEYS as readonly string[]).includes(name) || /^water_[1-3]$/.test(name)) return name;
  const m = /^(tree|rock|bush|tuft)_(\d+)$/.exec(name);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= SPRITE_COUNT[m[1] as SpriteKind]) return name;
  return null;
}

const URLS = new Map<BiomeId, Map<string, string>>(BIOME_IDS.map((b) => [b, new Map<string, string>()]));
{
  const legacy = new Map<string, string>();
  for (const [path, url] of Object.entries(FILES)) {
    const parts = path.slice(path.indexOf("/terrain/") + 9, -4).split("/"); // ["verdant", "ground"] | ["grass"]
    if (parts.length === 1) {
      const n = canonical(parts[0], true);
      if (n) legacy.set(n, url);
    } else if (parts.length === 2 && isBiomeId(parts[0])) {
      const n = canonical(parts[1], false);
      if (n) URLS.get(parts[0])!.set(n, url);
    }
  }
  const verdant = URLS.get("verdant")!;
  for (const [n, url] of legacy) if (!verdant.has(n)) verdant.set(n, url); // the biome folder wins
}

// ── loaded images + procedural caches ───────────────────────────────────────────────────────────

let version = 0;
const loaded = new Map<BiomeId, Map<string, HTMLImageElement>>();
const procTex = new Map<string, HTMLCanvasElement>();
const procSprite = new Map<string, HTMLCanvasElement>();

/** The biome's loaded real images (the first call starts loading them). */
function real(biome: BiomeId): Map<string, HTMLImageElement> {
  let m = loaded.get(biome);
  if (m) return m;
  const into = new Map<string, HTMLImageElement>();
  loaded.set(biome, into);
  if (typeof Image !== "undefined") {
    for (const [name, url] of URLS.get(biome) ?? []) {
      const img = new Image();
      img.onload = () => { into.set(name, img); version++; };
      img.src = url;
    }
  }
  return into;
}

/** Bumps whenever any real image finishes loading (rebuild anything cached from art). */
export function artVersion(): number { return version; }

/** URL of a real file for a canonical `name` ("ground", "tree_3", "water_1"…), if one exists. */
export function realAssetUrl(biome: BiomeId, name: string): string | null {
  return URLS.get(biome)?.get(name) ?? null;
}

/** Texture for a terrain material (real art if loaded, else the cached procedural stand-in). */
export function texture(biome: BiomeId, key: TexKey): CanvasImageSource {
  const img = real(biome).get(key);
  if (img) return img;
  const id = `${biome}/${key}`;
  let c = procTex.get(id);
  if (!c) { c = generateTexture(biome, key, TEX_WORLD); procTex.set(id, c); }
  return c;
}
/** Pattern scale that maps the source image's one repeat onto TEX_WORLD world px. */
export function textureScale(biome: BiomeId, key: TexKey): number {
  const t = texture(biome, key);
  const w = t instanceof HTMLImageElement ? t.naturalWidth || t.width : (t as HTMLCanvasElement).width;
  return w > 0 ? TEX_WORLD / w : 1;
}
export function hasRealTexture(biome: BiomeId, key: TexKey): boolean { return real(biome).has(key); }

/** All variants of a sprite kind (real art where loaded, procedural elsewhere). */
export function spriteVariants(biome: BiomeId, kind: SpriteKind): CanvasImageSource[] {
  const m = real(biome), out: CanvasImageSource[] = [];
  for (let i = 0; i < SPRITE_COUNT[kind]; i++) {
    const img = m.get(`${kind}_${i + 1}`);
    if (img) { out.push(img); continue; }
    const id = `${biome}/${kind}_${i}`;
    let c = procSprite.get(id);
    if (!c) { c = generateSprite(biome, kind, i, SPRITE_PX[kind]); procSprite.set(id, c); }
    out.push(c);
  }
  return out;
}
export function hasRealSprite(biome: BiomeId, kind: SpriteKind): boolean {
  const m = real(biome);
  for (let i = 1; i <= SPRITE_COUNT[kind]; i++) if (m.has(`${kind}_${i}`)) return true;
  return false;
}

/** Hand-made water frames (water + water_1..3) once at least two are loaded, else []. */
export function waterAnimFrames(biome: BiomeId): CanvasImageSource[] {
  const m = real(biome), out: CanvasImageSource[] = [];
  for (const n of ["water", "water_1", "water_2", "water_3"]) {
    const img = m.get(n);
    if (img) out.push(img);
  }
  return out.length >= 2 ? out : [];
}

// ── procedural generators (also the Art Lab's guide images) ─────────────────────────────────────

/** Procedural texture: seamless, evenly lit, deterministic; any size (256 in game, 1024 guides). */
export function generateTexture(biome: BiomeId, key: TexKey, size: number): HTMLCanvasElement {
  return renderTexture(biome, key, size);
}

const KIND_SALT: Record<SpriteKind, number> = { tree: 1, rock: 2, bush: 3, tuft: 4 };
/** 29 §C footprints: larger side (tufts: width, standing on the bottom edge) ÷ sprite size. */
const FIT: Record<SpriteKind, Fit> = {
  tree: { fp: 0.85, baseAtBottom: false },
  rock: { fp: 0.75, baseAtBottom: false },
  bush: { fp: 0.7, baseAtBottom: false },
  tuft: { fp: 0.6, baseAtBottom: true },
};

/** Procedural sprite (index 0-based): transparent, subject centred. Footprints: tree crown ≈ 85%
 *  of size, rock ≈ 75%, bush ≈ 70%, tuft ≈ 60% wide with its base on the bottom edge. */
export function generateSprite(biome: BiomeId, kind: SpriteKind, index: number, size: number): HTMLCanvasElement {
  const b = BIOMES[biome], n = SPRITE_COUNT[kind], i = ((Math.floor(index) % n) + n) % n;
  const seed = ihash(BIOME_IDS.indexOf(biome) + 1, KIND_SALT[kind] * 16 + i, 4099);
  return unitCanvas(size, seed, (g, r) => {
    switch (kind) {
      case "tree": return drawTree(g, r, b.trees[i], b, i);
      case "rock": return drawRock(g, r, b.rock, b.rockTone, i);
      case "bush": return drawBush(g, r, b.bushes[i], b, i);
      case "tuft": return drawTuft(g, r, b.tuft, b.tuftTone, i);
    }
  }, FIT[kind]);
}

/** Cheap deterministic per-tile hash for placement/variation (render side). */
export function tileHash(x: number, y: number, salt: number): number { return hash(x, y, salt); }
