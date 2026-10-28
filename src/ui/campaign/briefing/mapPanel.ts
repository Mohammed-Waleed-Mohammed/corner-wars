// Briefing: the theatre panel. A map preview drawn in the mission's biome, the biome's name and
// tagline, the tile types on this map in that biome's terms (swatch + name), and the biome's
// gameplay modifiers as short field notes (from config/biomes.ts, so they never go stale).

import { BIOME_RULES } from "../../../config/biomes";
import type { MissionDef } from "../../../content/campaign";
import { BIOMES, biomeMapColor } from "../../../content/biomes";
import type { BiomeId, MoveClass, TerrainType } from "../../../core/types";
import { MAP_BY_ID } from "../../../state/officialMaps";
import { drawMapThumb } from "../../components/mapThumb";
import { el } from "../../components/ui";

const CLASS_NAME: Record<MoveClass, string> = { foot: "infantry", wheeled: "wheels", tracked: "treads" };
const TILE_ORDER: TerrainType[] = ["ground", "road", "forest", "hill", "shallows", "water", "mountain", "rock", "bridge"];

function signedPct(mult: number): string {
  const v = Math.round((mult - 1) * 100);
  return `${v > 0 ? "+" : "−"}${Math.abs(v)}%`;
}

/** 26 §C modifiers as one-line field notes in the biome's own tile names. */
export function biomeNotes(biome: BiomeId): string[] {
  const r = BIOME_RULES[biome];
  const names = BIOMES[biome].tileNames;
  const notes: string[] = [];
  for (const [t, byClass] of Object.entries(r.speed ?? {}) as [TerrainType, Partial<Record<MoveClass, number>>][]) {
    const parts = (Object.entries(byClass) as [MoveClass, number][])
      .filter(([, m]) => m !== 1)
      .map(([c, m]) => `${CLASS_NAME[c]} ${signedPct(m)}`);
    if (parts.length) notes.push(`${names[t]}: ${parts.join(", ")} speed`);
  }
  if (r.coverMult && r.coverMult !== 1) notes.push(`${names.forest}: cover ${signedPct(r.coverMult)}`);
  if (r.sightBonus) notes.push(`All units ${r.sightBonus > 0 ? "+" : "−"}${Math.abs(r.sightBonus)} sight`);
  if (r.hillSightBonus) notes.push(`${names.hill}: +${r.hillSightBonus} extra sight`);
  if (r.energyMult && r.energyMult !== 1) notes.push(`Command Energy ${signedPct(r.energyMult)} while holding the Uplink`);
  if (notes.length === 0) notes.push("No terrain modifiers. The baseline.");
  return notes;
}

export function mapPanel(m: MissionDef): HTMLElement {
  const biome = BIOMES[m.biome];
  const box = el("section", "bf-map st-panel");
  box.append(el("div", "st-label", "Theatre"));

  const frame = el("div", "bf-map-frame");
  const canvas = el("canvas", "bf-map-canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(236 * dpr);
  const map = MAP_BY_ID.get(m.mapId);
  if (map) drawMapThumb(canvas, { ...map, biome: m.biome });
  frame.append(canvas, el("div", "bf-map-grid"), el("span", "bf-map-id st-mono", map ? map.name.toUpperCase() : m.mapId));
  box.append(frame);

  const head = el("div", "bf-biome-head");
  head.append(el("div", "st-title bf-biome-name", biome.name), el("div", "bf-biome-tag", biome.tagline));
  box.append(head);

  // Tile legend: only the tile types this map actually uses.
  const used = new Set<TerrainType>();
  if (map) for (const row of map.terrain) for (const t of row) used.add(t);
  const legend = el("div", "bf-legend");
  for (const t of TILE_ORDER) {
    if (map && !used.has(t)) continue;
    const item = el("span", "bf-legend-item");
    const sw = el("span", "st-swatch");
    sw.style.background = biomeMapColor(m.biome, t);
    item.append(sw, el("span", "", biome.tileNames[t]));
    legend.append(item);
  }
  box.append(legend);

  const notes = el("ul", "bf-notes");
  for (const n of biomeNotes(m.biome)) notes.append(el("li", "", n));
  box.append(el("div", "st-label", "Field notes"), notes);
  return box;
}
