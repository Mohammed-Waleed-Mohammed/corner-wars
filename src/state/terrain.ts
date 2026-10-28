// Terrain queries (file 24, biome rules 26 §C). Terrain is STATIC map data (18 §A). Passability,
// buildability, movement speed, cover, high-ground sight/range and concealment are all pure functions
// of the tile, the map's biome and the unit — deterministic, so lockstep-safe — and every system
// (movement, A*, combat, fog, AI perception, placement, map validation) asks THESE helpers rather
// than testing tile strings itself.

import { TERRAIN, TERRAIN_FX, UNIT_MOVE_CLASS } from "../config/constants";
import { BIOME_RULES, DEFAULT_BIOME, MIN_SIGHT } from "../config/biomes";
import type { AnyEntity, BiomeId, GameState, MoveClass, PlayerId, TerrainType, Unit } from "../core/types";
import { forestSpotRange, roughTerrainFactor } from "./doctrine";
import { cloakSpotRange, hostileSpeedMult } from "./fields";

/** Tile at (x, y); out of bounds reads as impassable void. */
export function terrainAt(state: GameState, x: number, y: number): TerrainType {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= state.mapWidth || ty >= state.mapHeight) return "void";
  return state.terrain[ty][tx];
}

/** Can units walk on this tile (ignoring buildings)? */
export function isPassable(state: GameState, x: number, y: number): boolean {
  return TERRAIN[terrainAt(state, x, y)].passable;
}

/** Can a structure stand on this tile? (ground, road, hill) */
export function isBuildable(state: GameState, x: number, y: number): boolean {
  return TERRAIN[terrainAt(state, x, y)].buildable;
}

/** Back-compat name (pre-24): "may a unit walk here". Every walkable type counts now. */
export function isGround(state: GameState, x: number, y: number): boolean {
  return isPassable(state, x, y);
}

export function moveClassOf(u: Unit): MoveClass {
  return UNIT_MOVE_CLASS[u.unitType];
}

/** Movement multiplier for a class on a tile type in a biome (0 = impassable). 26 §C. */
export function speedFactor(tile: TerrainType, cls: MoveClass, biome: BiomeId = DEFAULT_BIOME): number {
  const base = TERRAIN[tile].speed[cls];
  if (base <= 0) return 0;
  return base * (BIOME_RULES[biome].speed?.[tile]?.[cls] ?? 1);
}

const fastestCache = new Map<string, number>();
/** The fastest factor a class can reach anywhere in a biome — scales the A* heuristic so weighted
 *  pathfinding stays admissible under every biome's modifiers (26 §C). */
export function fastestFactor(biome: BiomeId, cls: MoveClass): number {
  const key = `${biome}:${cls}`;
  let v = fastestCache.get(key);
  if (v === undefined) {
    v = 0;
    for (const t of Object.keys(TERRAIN) as TerrainType[]) v = Math.max(v, speedFactor(t, cls, biome));
    fastestCache.set(key, v);
  }
  return v;
}

const ROUGH: ReadonlySet<TerrainType> = new Set<TerrainType>(["forest", "hill", "shallows"]);

/** Speed multiplier for this unit where it stands now: the tile (biome-adjusted), the owner's
 *  doctrine on rough ground (27 §B Lindqvist), an active Rally buff, and enemy Prism/Ashstorm fields.
 *  Never 0 — a unit nudged onto an impassable tile by separation still gets out at normal speed. */
export function terrainSpeedMult(state: GameState, u: Unit): number {
  const tile = terrainAt(state, u.x, u.y);
  let f = speedFactor(tile, moveClassOf(u), state.biome);
  if (f <= 0) f = 1;
  const p = u.owner === "neutral" ? null : state.players[u.owner];
  if (p) {
    if (ROUGH.has(tile)) f = roughTerrainFactor(p, f);
    f *= p.abilityBuff?.speedMult ?? 1;
  }
  return f * hostileSpeedMult(state, u.owner, u.x, u.y);
}

/** Damage-taken multiplier from cover (forest), for a unit; buildings get none. Biome-scaled (26 §C). */
export function coverMult(state: GameState, e: AnyEntity): number {
  if (e.kind !== "unit" || terrainAt(state, e.x, e.y) !== "forest") return 1;
  const k = BIOME_RULES[state.biome]?.coverMult ?? 1;
  return 1 - Math.min(0.9, TERRAIN_FX.FOREST_COVER[moveClassOf(e)] * k);
}

function centerTile(e: AnyEntity): { x: number; y: number } {
  return e.kind === "building" ? { x: e.x + e.width / 2, y: e.y + e.height / 2 } : { x: e.x, y: e.y };
}

/** Sight radius including high ground and the biome — the human fog and AI perception both use this. */
export function sightOf(state: GameState, e: AnyEntity): number {
  const c = centerTile(e);
  const rules = BIOME_RULES[state.biome] ?? {};
  let s = e.sightRadius;
  if (terrainAt(state, c.x, c.y) === "hill") s += TERRAIN_FX.HILL_SIGHT_BONUS + (rules.hillSightBonus ?? 0);
  if (e.kind === "unit" && rules.sightBonus) s = Math.max(Math.min(MIN_SIGHT, s), s + rules.sightBonus);
  return s;
}

/** Attack range including high ground: +1 on a hill for units with base range ≥ 2. */
export function rangeOf(state: GameState, u: Unit): number {
  if (u.range < TERRAIN_FX.HILL_RANGE_MIN_BASE) return u.range;
  return u.range + (terrainAt(state, u.x, u.y) === "hill" ? TERRAIN_FX.HILL_RANGE_BONUS : 0);
}

/** A defensive building's range including high ground (any defense on a hill gets the bonus). */
export function defenseRangeOf(state: GameState, b: AnyEntity, baseRange: number): number {
  const c = centerTile(b);
  return baseRange + (terrainAt(state, c.x, c.y) === "hill" ? TERRAIN_FX.HILL_RANGE_BONUS : 0);
}

/** True when any of the viewer's live entities is within `range` of (x, y). */
function viewerNear(state: GameState, viewer: PlayerId, x: number, y: number, range: number): boolean {
  const r2 = range * range;
  for (const o of state.entities) {
    if (o.owner !== viewer || o.hp <= 0) continue;
    const c = centerTile(o);
    const dx = c.x - x, dy = c.y - y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

/** Concealment (24 §B, 27 §C): is unit `e` hidden from `viewer`? Two sources —
 *   • forest: inside a forest and no viewer entity within FOREST_SPOT_RANGE (Lindqvist: 3);
 *   • Ghost Roads / Ashstorm: inside its owner's cloaking field and no viewer entity within the
 *     field's spot range (2).
 *  Visibility only — it never changes targeting. Spectators (eliminated viewers) see everything. */
export function concealedFrom(state: GameState, viewer: PlayerId, e: AnyEntity): boolean {
  if (e.kind !== "unit" || e.owner === viewer || e.owner === "neutral") return false;
  if (state.players[viewer]?.eliminated) return false;
  const cloak = cloakSpotRange(state, e);
  if (cloak !== null && !viewerNear(state, viewer, e.x, e.y, cloak)) return true;
  if (terrainAt(state, e.x, e.y) !== "forest") return false;
  const spot = forestSpotRange(state.players[e.owner], TERRAIN_FX.FOREST_SPOT_RANGE);
  return !viewerNear(state, viewer, e.x, e.y, spot);
}
