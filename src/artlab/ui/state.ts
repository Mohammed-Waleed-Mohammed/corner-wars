// Art Lab — persisted UI state (localStorage) and the in-memory work session per asset. Saving a
// file makes Vite reload the page (the art modules glob the asset folders), so everything the user
// needs afterwards — selection, verdicts, "saved" notice — survives a reload.

import { BIOME_IDS } from "../../config/biomes";
import type { BiomeId, FactionId } from "../../core/types";
import { ART_FACTIONS, ASSETS, assetById } from "../catalog";
import type { Asset } from "../catalog";
import type { Img } from "../image";
import { LOCK_DEFAULT } from "../process";
import type { BuildingResult, PortraitResult, SpriteResult, TextureResult } from "../process";
import type { QAReport, Verdict } from "../qa";

const KEY = "artlab.v1";
const FLASH = "artlab.flash";

export interface Persisted {
  selected: string;
  biome: BiomeId;
  faction: FactionId; // the faction shown in the Buildings / Units groups
  verdicts: Record<string, { verdict: Verdict; at: number; saved?: boolean }>;
  lock: number;
  trim: number;
}

function load(): Persisted {
  const def: Persisted = { selected: ASSETS[0].id, biome: "verdant", faction: "concord", verdicts: {}, lock: LOCK_DEFAULT, trim: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Persisted>;
    const p = { ...def, ...raw };
    if (!assetById(p.selected)) p.selected = def.selected;
    if (!BIOME_IDS.includes(p.biome)) p.biome = def.biome;
    if (!ART_FACTIONS.includes(p.faction)) p.faction = def.faction;
    return p;
  } catch { return def; }
}

export const persisted: Persisted = load();

export function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(persisted)); } catch { /* storage full / blocked: the lab still works */ }
}

export function recordVerdict(id: string, verdict: Verdict, saved = false): void {
  persisted.verdicts[id] = { verdict, at: Date.now(), saved };
  save();
}

/** One-shot notice shown after the reload that follows a save. */
export function setFlash(msg: string): void { try { sessionStorage.setItem(FLASH, msg); } catch { /* ignore */ } }
export function takeFlash(): string | null {
  try { const m = sessionStorage.getItem(FLASH); sessionStorage.removeItem(FLASH); return m; } catch { return null; }
}

// ── in-memory work per asset (lost on reload, by design: the saved file is the result) ──────────
export type Result =
  | { kind: "texture"; r: TextureResult }
  | { kind: "sprite"; r: SpriteResult }
  | { kind: "portrait"; r: PortraitResult }
  | { kind: "unit"; r: SpriteResult }
  | { kind: "building"; r: BuildingResult };

export interface Session {
  file: string; // dropped file name
  source: Img; // decoded drop
  result: Result | null;
  report: QAReport | null;
  out: HTMLCanvasElement | null; // processed output, ready to save
  error: string | null;
  saved: string | null; // repo path after a successful save
}

const sessions = new Map<string, Session>();
export function session(a: Asset): Session | undefined { return sessions.get(a.id); }
export function setSession(a: Asset, s: Session): void { sessions.set(a.id, s); }
