// 27 §H / 29 §G — faction unit + building art. Real files are picked up automatically from
// src/assets/units/<faction>/<stem>.png and src/assets/buildings/<faction>/<stem>.png (Vite glob,
// no 404s); until a file exists the game draws:
//   • buildings: the procedural faction building (render/art/factionBuildings.ts);
//   • units: their clear role shapes (render/draw/units.ts) — procedural unit detail is reserved for
//     the Art Lab guides, because at 18–40 px it would only blur the silhouette.
// Render-only; nothing here touches the sim.

import { BUILDING_STATS } from "../config/constants";
import { BUILDING_FILL, UNIT_ART, artStem, type ArtBuildingType } from "../content/factionArt";
import type { FactionId, UnitType } from "../core/types";
import { drawFactionBuilding } from "./art/factionBuildings";
import { alphaBounds, canvas, fitDraw } from "./art/factionKit";
import { drawFactionUnit } from "./art/factionUnits";

let version = 0;
const urls = new Map<string, string>(); // "units/concord/rifleman" → URL
const loaded = new Map<string, HTMLImageElement>();
const procBuildings = new Map<string, HTMLCanvasElement>();
let started = false;

function start(): void {
  if (started) return;
  started = true;
  const files = {
    ...(import.meta.glob("../assets/units/*/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>),
    ...(import.meta.glob("../assets/buildings/*/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>),
  };
  for (const [path, url] of Object.entries(files)) {
    const m = /assets\/(units|buildings)\/([a-z]+)\/([a-z0-9_]+)\.png$/.exec(path);
    if (m) urls.set(`${m[1]}/${m[2]}/${m[3]}`, url);
  }
  if (typeof Image === "undefined") return;
  for (const [key, url] of urls) {
    const img = new Image();
    img.onload = () => { loaded.set(key, img); version++; };
    img.src = url;
  }
}

start(); // load at boot, so the HUD's build icons (rendered once per match) already see real art

/** Bumps whenever a real unit/building image finishes loading. */
export function unitArtVersion(): number { start(); return version; }

const unitKey = (f: FactionId, t: UnitType): string => `units/${f}/${artStem(t)}`;
const buildingKey = (f: FactionId, t: ArtBuildingType): string => `buildings/${f}/${artStem(t)}`;

export function realUnitUrl(faction: FactionId, type: UnitType): string | null { start(); return urls.get(unitKey(faction, type)) ?? null; }
export function realBuildingUrl(faction: FactionId, type: ArtBuildingType): string | null { start(); return urls.get(buildingKey(faction, type)) ?? null; }

/** The real unit sprite once loaded (faces UP), else null → draw the role shape. */
export function unitSprite(faction: FactionId, type: UnitType): HTMLImageElement | null {
  start();
  return loaded.get(unitKey(faction, type)) ?? null;
}

/** The building sprite to draw: the real file once loaded, else the procedural faction building. */
export function buildingSprite(faction: FactionId, type: ArtBuildingType): CanvasImageSource {
  start();
  const real = loaded.get(buildingKey(faction, type));
  if (real) return real;
  const key = buildingKey(faction, type);
  let c = procBuildings.get(key);
  if (!c) { c = generateBuildingSprite(faction, type, 64); procBuildings.set(key, c); }
  return c;
}

export function isArtBuilding(t: string): t is ArtBuildingType {
  return t !== "wall" && t !== "gate";
}

// ── procedural generators (also the Art Lab guides) ───────────────────────────────────────────────

/** A unit facing UP on a transparent size×size canvas; its larger side = UNIT_ART footprint × size. */
export function generateUnitSprite(faction: FactionId, type: UnitType, size: number): HTMLCanvasElement {
  return fitDraw(size, UNIT_ART[type].footprint, (g, S) => drawFactionUnit(g, faction, type, S));
}

/** A building on a transparent (w × px) × (h × px) canvas; its opaque bbox fills exactly BUILDING_FILL
 *  of it, centred. Overhangs (a crane arm, a banner) are measured and pulled back inside. */
export function generateBuildingSprite(faction: FactionId, type: ArtBuildingType, pxPerTile: number): HTMLCanvasElement {
  const s = BUILDING_STATS[type];
  const W = s.width * pxPerTile, H = s.height * pxPerTile;
  const iw = W * BUILDING_FILL, ih = H * BUILDING_FILL;
  const draw = (g: CanvasRenderingContext2D): void => drawFactionBuilding(g, faction, type, (W - iw) / 2, (H - ih) / 2, iw, ih);
  const probe = canvas(W, H);
  draw(probe.getContext("2d")!);
  const b = alphaBounds(probe);
  if (!b) return probe;
  const c = canvas(W, H), g = c.getContext("2d")!;
  g.translate(W / 2, H / 2);
  g.scale(iw / (b.x1 - b.x0), ih / (b.y1 - b.y0)); // per axis: the footprint is the contract
  g.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
  draw(g);
  return c;
}
