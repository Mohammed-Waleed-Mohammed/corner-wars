// 29 — Art Lab catalog: shared description shapes, output specs and the feature-size helper.
// The catalog/* files are the single source for every material, species and portrait description;
// prompts.ts turns them into Gemini prompts. DOM-free (prompts can be exported from Node).

import type { SpriteKind } from "../../content/biomes";

/** Every guide and every Gemini output is worked at this size (px, square). */
export const GUIDE_SIZE = 1024;
/** A texture image covers this many metres of ground per side (one repeat = 256 world px = 8 tiles). */
export const TEX_METRES = 8;
/** 29 §C output sizes. */
export const TEX_OUT = 512;
export const PORTRAIT_OUT = 512;
export const SPRITE_OUT: Record<SpriteKind, number> = { tree: 256, rock: 128, bush: 128, tuft: 128 };
/** 29 §C footprint: the object's larger dimension (tufts: width) as a fraction of the image. */
export const SPRITE_FOOTPRINT: Record<SpriteKind, number> = { tree: 0.85, rock: 0.75, bush: 0.7, tuft: 0.6 };
/** In-game draw size range in world px at zoom 1 (render/draw/worldLayers.ts). */
export const SPRITE_GAME_PX: Record<SpriteKind, readonly [number, number]> = { tree: [40, 60], rock: [24, 36], bush: [24, 36], tuft: [22, 22] };

/** A tileable material (one biome × one TexKey). Colours name hex values; the prompt adds the palette tone. */
export interface TextureDesc {
  name: string; // in-world name, e.g. "Meadow"
  what: string; // what the surface is, one sentence
  detail: string[]; // micro-detail: material, colour (hex), size
  feel: string; // how it must read next to its neighbours in the biome
  exclude: string[]; // asset-specific "do not include"
}

/** One sprite slot (tree_3, rock_2, …). */
export interface SpriteDesc {
  name: string; // short species/variant name, e.g. "Oak"
  subject: string; // what the object is, as seen by the camera
  detail: string[]; // materials, colours (hex), structure
  exclude: string[];
}

/** One character portrait. */
export interface PortraitDesc {
  human: boolean;
  age: string; // "58 years old"
  face: string;
  hair: string;
  wear: string; // headwear, uniform, insignia
  expression: string;
  extra: string[]; // anything else that must be in the picture
  exclude: string[];
}

const PX_PER_M = GUIDE_SIZE / TEX_METRES; // 128 px per metre in a 1024-px texture

const unit = (cm: number): string => (cm >= 100 ? `${+(cm / 100).toFixed(2)} m` : `${cm} cm`);
const px = (cm: number): number => Math.max(1, Math.round((cm / 100) * PX_PER_M));

/** A feature size in the 1024-px texture: "30–80 cm (38–102 px)". */
export function sz(minCm: number, maxCm: number): string {
  const range = maxCm < 100 ? `${minCm}–${maxCm} cm` : minCm >= 100 ? `${+(minCm / 100).toFixed(2)}–${+(maxCm / 100).toFixed(2)} m` : `${unit(minCm)}–${unit(maxCm)}`;
  return `${range} (${px(minCm)}–${px(maxCm)} px)`;
}
