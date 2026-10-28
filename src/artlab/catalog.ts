// 29 §A/§B — the Art Lab catalog: every asset (6 biomes × 25 terrain assets, the portraits, and
// 4 factions × 10 buildings + 9 units), its file path, output spec, description and the style
// anchors it attaches, in GENERATION ORDER. Descriptions live in catalog/* and
// content/factionArt.ts; this file only assembles them. DOM-free.

import { BIOME_IDS } from "../config/biomes";
import { BIOMES, SPRITE_COUNT, TEX_KEYS, rgbHex } from "../content/biomes";
import type { SpriteKind, TexKey, Tone } from "../content/biomes";
import { FACTION_LOOK, UNIT_OUT, artStem } from "../content/factionArt";
import type { ArtBuildingType } from "../content/factionArt";
import { CHARACTERS, COMMANDER_INFO, characterInfo, fullName } from "../content/factions";
import type { BiomeId, FactionId, UnitType } from "../core/types";
import { BUILDING_ORDER, buildingOut, buildingTitle } from "./catalog/buildings";
import { bushDesc, rockDesc, tuftDesc } from "./catalog/ground-cover";
import { PORTRAIT_DESC } from "./catalog/portraits";
import { CINDER_TEX } from "./catalog/terrain-cinder";
import { FROSTMARCH_TEX } from "./catalog/terrain-frostmarch";
import { MIRE_TEX } from "./catalog/terrain-mire";
import { SALTGLASS_TEX } from "./catalog/terrain-saltglass";
import { SCAR_TEX } from "./catalog/terrain-scar";
import { VERDANT_TEX } from "./catalog/terrain-verdant";
import { TREE_DESC } from "./catalog/trees";
import { PORTRAIT_OUT, SPRITE_OUT, TEX_OUT } from "./catalog/types";
import type { PortraitDesc, SpriteDesc, TextureDesc } from "./catalog/types";
import { ART_FACTIONS, UNIT_ORDER, unitTitle } from "./catalog/units";

export * from "./catalog/types";
export * from "./catalog/units";
export * from "./catalog/buildings";
export { EMBLEM_DESC } from "./catalog/portraits";

export const SPRITE_KINDS: readonly SpriteKind[] = ["tree", "rock", "bush", "tuft"];

// ── assets ───────────────────────────────────────────────────────────────────────────────────────
interface AssetBase {
  id: string; // "verdant/ground", "verdant/tree_1", "portraits/varga", "units/concord/rifleman"
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7; // 29 §B generation step
  order: number; // 1-based position in the full generation order
  name: string; // file stem
  path: string; // repo path of the real file (29 §E)
  title: string; // human name
  outSize: number; // processed output, px (square; buildings: the larger of outW / outH)
}
export interface TextureAsset extends AssetBase { kind: "texture"; biome: BiomeId; tex: TexKey }
export interface SpriteAsset extends AssetBase { kind: "sprite"; biome: BiomeId; sprite: SpriteKind; index: number } // index 0-based
export interface PortraitAsset extends AssetBase { kind: "portrait"; charId: string; faction: FactionId | "none" }
/** A faction unit sprite: faces UP, square UNIT_OUT, subject spans UNIT_ART footprint. */
export interface UnitAsset extends AssetBase { kind: "unit"; faction: FactionId; unitType: UnitType }
/** A faction building sprite: top-down, outW × outH = footprint tiles × BUILDING_PX_PER_TILE. */
export interface BuildingAsset extends AssetBase { kind: "building"; faction: FactionId; buildingType: ArtBuildingType; outW: number; outH: number }
export type Asset = TextureAsset | SpriteAsset | PortraitAsset | UnitAsset | BuildingAsset;
export type AssetKind = Asset["kind"];
/** The kinds that belong to a biome (they have `biome`), and the ones that belong to a faction's set. */
export type BiomeAsset = TextureAsset | SpriteAsset;
export type FactionAsset = UnitAsset | BuildingAsset;
export const isBiomeAsset = (a: Asset): a is BiomeAsset => a.kind === "texture" || a.kind === "sprite";
export const isFactionAsset = (a: Asset): a is FactionAsset => a.kind === "unit" || a.kind === "building";

const TEX_DESC: Record<BiomeId, Record<TexKey, TextureDesc>> = {
  verdant: VERDANT_TEX, saltglass: SALTGLASS_TEX, frostmarch: FROSTMARCH_TEX, cinder: CINDER_TEX, mire: MIRE_TEX, scar: SCAR_TEX,
};

export function textureDesc(a: TextureAsset): TextureDesc { return TEX_DESC[a.biome][a.tex]; }

/** Which repeat of the same species this slot is (two palms → 0, 1), so repeats get distinct variants. */
function repeatIndex<T>(list: readonly T[], i: number): number {
  return list.slice(0, i).filter((s) => s === list[i]).length;
}

export function spriteDesc(a: SpriteAsset): SpriteDesc {
  const b = BIOMES[a.biome];
  switch (a.sprite) {
    case "tree": return TREE_DESC[b.trees[a.index]](repeatIndex(b.trees, a.index));
    case "rock": return rockDesc(b.rock, a.index);
    case "bush": return bushDesc(b.bushes[a.index], repeatIndex(b.bushes, a.index));
    case "tuft": return tuftDesc(b.tuft, a.index);
  }
}

export function portraitDesc(a: PortraitAsset): PortraitDesc { return PORTRAIT_DESC[a.charId]; }

/** Portrait ids in order: commanders, then the supporting cast (the narrator has no portrait). */
export const PORTRAIT_IDS: readonly string[] = [...Object.keys(COMMANDER_INFO), ...Object.keys(CHARACTERS)].filter((id) => id in PORTRAIT_DESC);

/** An asset before build() numbers and names it. */
type Draft<A = Asset> = A extends Asset ? Omit<A, "order" | "title"> : never;

function titleOf(a: Asset): string {
  switch (a.kind) {
    case "texture": return textureDesc(a).name;
    case "sprite": return spriteDesc(a).name;
    case "portrait": return fullName(characterInfo(a.charId)!);
    case "unit": return unitTitle(a.faction, a.unitType);
    case "building": return buildingTitle(a.faction, a.buildingType);
  }
}

function build(): Asset[] {
  const out: Asset[] = [];
  const add = (a: Draft): void => {
    const full = { ...a, order: out.length + 1, title: "" } as Asset;
    full.title = titleOf(full);
    out.push(full);
  };
  const tex = (biome: BiomeId, k: TexKey, step: 1 | 2 | 3): void =>
    add({ kind: "texture", id: `${biome}/${k}`, biome, tex: k, step, name: k, path: `src/assets/terrain/${biome}/${k}.png`, outSize: TEX_OUT });
  // Steps 1–2: every biome's ground (verdant first: the master style).
  for (const b of BIOME_IDS) tex(b, "ground", b === "verdant" ? 1 : 2);
  // Steps 3–4, biome by biome: the other textures, then the sprites.
  for (const b of BIOME_IDS) {
    for (const k of TEX_KEYS) if (k !== "ground") tex(b, k, 3);
    for (const kind of SPRITE_KINDS) {
      for (let i = 0; i < SPRITE_COUNT[kind]; i++) {
        const name = `${kind}_${i + 1}`;
        add({ kind: "sprite", id: `${b}/${name}`, biome: b, sprite: kind, index: i, step: 4, name, path: `src/assets/terrain/${b}/${name}.png`, outSize: SPRITE_OUT[kind] });
      }
    }
  }
  // Step 5: portraits.
  for (const id of PORTRAIT_IDS) {
    const info = characterInfo(id)!;
    add({ kind: "portrait", id: `portraits/${id}`, charId: id, faction: info.faction, step: 5, name: id, path: `src/assets/portraits/${id}.png`, outSize: PORTRAIT_OUT });
  }
  // Step 6: faction buildings, faction by faction (the Concord first), each Construction Yard first.
  for (const f of ART_FACTIONS) {
    for (const t of BUILDING_ORDER) {
      const name = artStem(t), { outW, outH } = buildingOut(t);
      add({ kind: "building", id: `buildings/${f}/${name}`, faction: f, buildingType: t, outW, outH, step: 6, name, path: `src/assets/buildings/${f}/${name}.png`, outSize: Math.max(outW, outH) });
    }
  }
  // Step 7: faction units, same faction order, each Rifleman first.
  for (const f of ART_FACTIONS) {
    for (const t of UNIT_ORDER) {
      const name = artStem(t);
      add({ kind: "unit", id: `units/${f}/${name}`, faction: f, unitType: t, step: 7, name, path: `src/assets/units/${f}/${name}.png`, outSize: UNIT_OUT });
    }
  }
  return out;
}

/** Every asset, in generation order (29 §B). */
export const ASSETS: readonly Asset[] = build();
const BY_ID = new Map(ASSETS.map((a) => [a.id, a]));
export function assetById(id: string): Asset | undefined { return BY_ID.get(id); }

function texAsset(b: BiomeId, k: TexKey): TextureAsset { return BY_ID.get(`${b}/${k}`) as TextureAsset; }
function spriteAsset(b: BiomeId, kind: SpriteKind, index: number): SpriteAsset { return BY_ID.get(`${b}/${kind}_${index + 1}`) as SpriteAsset; }
export function unitAsset(f: FactionId, t: UnitType): UnitAsset { return BY_ID.get(`units/${f}/${artStem(t)}`) as UnitAsset; }
export function buildingAsset(f: FactionId, t: ArtBuildingType): BuildingAsset { return BY_ID.get(`buildings/${f}/${artStem(t)}`) as BuildingAsset; }

// ── palette per asset (spec card swatches + prompt colours) ──────────────────────────────────────
export interface Swatch { label: string; hex: string }

export function toneSwatches(t: Tone): Swatch[] {
  return [{ label: "dark", hex: rgbHex(t.dark) }, { label: "mid", hex: rgbHex(t.mid) }, { label: "light", hex: rgbHex(t.light) }];
}

/** The palette tone an asset is matched against (textures: 26 §F; sprites: the biome's sprite tone). */
export function assetTone(a: TextureAsset | SpriteAsset): Tone {
  const b = BIOMES[a.biome];
  if (a.kind === "texture") return b.palette[a.tex];
  return a.sprite === "rock" ? b.rockTone : a.sprite === "tuft" ? b.tuftTone : b.foliage;
}

/** A faction's art palette (content/factionArt.ts), in the order the prompts name it. */
export function factionSwatches(f: FactionId): Swatch[] {
  const p = FACTION_LOOK[f].palette;
  return [
    { label: "base", hex: p.base }, { label: "mid", hex: p.mid }, { label: "dark", hex: p.dark },
    { label: "light", hex: p.light }, { label: "accent", hex: p.accent }, { label: "glass", hex: p.glass },
  ];
}

export function assetSwatches(a: Asset): Swatch[] {
  if (isBiomeAsset(a)) return toneSwatches(assetTone(a));
  if (isFactionAsset(a)) return factionSwatches(a.faction);
  const p = characterInfo(a.charId)!.portrait;
  return [
    { label: "skin", hex: p.skin }, { label: "hair", hex: p.hair }, { label: "eyes", hex: p.eyes },
    { label: "uniform", hex: p.uniform }, { label: "trim", hex: p.trim }, { label: "backdrop", hex: p.bg },
  ];
}

// ── attachments (29 §B) ──────────────────────────────────────────────────────────────────────────
// style: the Concord's matching asset (painting style only); faction: this faction's Construction Yard.
export type AttachRole = "guide" | "master" | "ground" | "family" | "portrait" | "style" | "faction";
export interface Attachment {
  n: number; // image number in the prompt (1-based)
  role: AttachRole;
  asset: Asset; // whose guide (role "guide") or whose real file this is
}
export interface MissingAnchor { asset: Asset; role: AttachRole; required: boolean }
export interface AttachPlan { list: Attachment[]; missing: MissingAnchor[] }

/**
 * The ordered images to attach for `a`. Image 1 is always its guide. Required anchors (the ground
 * textures, every faction anchor) are listed even when missing (make them first); optional anchors
 * (a family's first sprite, the first portrait) are attached only once they exist (29 §B "once it
 * exists"). Faction sets (steps 6–7):
 *   - concord Construction Yard: verdant/ground (master);
 *   - other Construction Yards: the Concord's (style) + verdant/ground (master);
 *   - other buildings: their faction's Construction Yard (faction) + verdant/ground (master);
 *   - concord Rifleman: the Concord Construction Yard (faction);
 *   - other Riflemen: the Concord Rifleman (style) + their faction's Construction Yard (faction);
 *   - other units: their faction's Rifleman (family) + Construction Yard (faction).
 */
export function planAttachments(a: Asset, exists: (x: Asset) => boolean): AttachPlan {
  const list: Attachment[] = [{ n: 1, role: "guide", asset: a }];
  const missing: MissingAnchor[] = [];
  const anchor = (x: Asset, role: AttachRole, required: boolean): void => {
    const ok = exists(x);
    if (!ok) missing.push({ asset: x, role, required });
    if (ok || required) list.push({ n: list.length + 1, role, asset: x });
  };
  if (a.kind === "texture") {
    if (a.tex === "ground") { if (a.biome !== "verdant") anchor(texAsset("verdant", "ground"), "master", true); }
    else anchor(texAsset(a.biome, "ground"), "ground", true);
  } else if (a.kind === "sprite") {
    anchor(texAsset(a.biome, "ground"), "ground", true);
    if (a.index > 0) anchor(spriteAsset(a.biome, a.sprite, 0), "family", false);
  } else if (a.kind === "building") {
    const cy = buildingAsset(a.faction, "constructionYard");
    if (a.buildingType !== "constructionYard") anchor(cy, "faction", true);
    else if (a.faction !== "concord") anchor(buildingAsset("concord", "constructionYard"), "style", true);
    anchor(texAsset("verdant", "ground"), "master", true);
  } else if (a.kind === "unit") {
    const cy = buildingAsset(a.faction, "constructionYard");
    if (a.unitType !== "rifleman") anchor(unitAsset(a.faction, "rifleman"), "family", true);
    else if (a.faction !== "concord") anchor(unitAsset("concord", "rifleman"), "style", true);
    anchor(cy, "faction", true);
  } else {
    const first = BY_ID.get(`portraits/${PORTRAIT_IDS[0]}`)!;
    if (first.id !== a.id) anchor(first, "portrait", false);
  }
  return { list, missing };
}
