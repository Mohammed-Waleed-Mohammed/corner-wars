// Custom-map persistence (18 §B): the host's "My Maps" list in localStorage, plus JSON export/import
// so maps can be shared out-of-band. All imports go through sanitizeMap so a hand-edited/hostile file
// can't inject a malformed GameMap. Browser-only (localStorage) — kept out of the DOM-free engine.

import { MAP_EDITOR } from "../../config/constants";
import type { GameMap } from "../../core/types";
import { sanitizeMap } from "../../state/mapValidation";

const KEY = "cornerwars.mymaps";

export function loadMyMaps(): GameMap[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map((m) => sanitizeMap(m)).filter((m): m is GameMap => m !== null);
  } catch {
    return [];
  }
}

function persist(maps: GameMap[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(maps.slice(0, MAP_EDITOR.maxCustomMaps)));
  } catch {
    /* quota / disabled storage — silently ignore */
  }
}

/** Save (or overwrite by id). Returns false if the list is full and this is a new map. */
export function saveMyMap(map: GameMap): boolean {
  const maps = loadMyMaps().filter((m) => m.id !== map.id);
  if (maps.length >= MAP_EDITOR.maxCustomMaps) return false;
  maps.push(map);
  persist(maps);
  return true;
}

export function deleteMyMap(id: string): void {
  persist(loadMyMaps().filter((m) => m.id !== id));
}

export function exportMap(map: GameMap): string {
  return JSON.stringify(map);
}

export function importMap(json: string): GameMap | null {
  try {
    return sanitizeMap(JSON.parse(json));
  } catch {
    return null;
  }
}
