// Custom-map validation + import sanitization (18 §B). Pure + DOM-free so it's headlessly testable.
// A map must pass validateMap() to be saved or played: exactly maxPlayers starts, a Citadel, nothing
// on impassable/void or overlapping, and — the key check — every start walkably reaches the Citadel and
// a gold mine over ground (BFS on the terrain grid). sanitizeMap() coerces untrusted imported JSON into
// a safe GameMap so a hand-edited / hostile file can't inject bad shapes.

import { BUILDING_STATS, MAP_EDITOR } from "../config/constants";
import type { GameMap, MapTile } from "../core/types";

const CY = BUILDING_STATS.constructionYard.width; // 3 — a start's Construction Yard footprint
const TILES: MapTile[] = ["ground", "mountain", "water", "rock", "void"];

/** A failure with an optional world location — the editor's validation panel (20 §H) lists issues as
 *  clickable items that jump the camera to (x,y) when present. `errors` stays for old callers. */
export interface MapIssue { msg: string; x?: number; y?: number }
export interface MapValidation { ok: boolean; errors: string[]; issues: MapIssue[] }

const key = (x: number, y: number): string => `${x},${y}`;

/** BFS over "ground" tiles from (sx,sy); returns the set of reachable "x,y" keys. */
function reachableGround(map: GameMap, sx: number, sy: number): Set<string> {
  const { width: W, height: H } = map;
  const vis = new Set<string>();
  const walk = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && map.terrain[y][x] === "ground";
  if (!walk(sx, sy)) return vis;
  const q: [number, number][] = [[sx, sy]];
  vis.add(key(sx, sy));
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (walk(nx, ny) && !vis.has(key(nx, ny))) { vis.add(key(nx, ny)); q.push([nx, ny]); }
    }
  }
  return vis;
}

export function validateMap(map: GameMap): MapValidation {
  const issues: MapIssue[] = [];
  const err = (msg: string, x?: number, y?: number): void => { issues.push(x !== undefined ? { msg, x, y } : { msg }); };
  const { minSize: lo, maxSize: hi } = MAP_EDITOR;
  const W = map.width, H = map.height;

  const done = (): MapValidation => ({ ok: issues.length === 0, errors: issues.map((i) => i.msg), issues });

  if (!(Number.isInteger(W) && Number.isInteger(H) && W >= lo && W <= hi && H >= lo && H <= hi)) {
    err(`Map size must be ${lo}–${hi} tiles (is ${W}×${H}).`);
  }
  const gridOk = Array.isArray(map.terrain) && map.terrain.length === H && map.terrain.every((r) => Array.isArray(r) && r.length === W);
  if (!gridOk) { err("Terrain grid doesn't match the map size."); return done(); }

  const ground = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && map.terrain[y][x] === "ground";
  const occ = new Map<string, string>();
  const claim = (x: number, y: number, what: string): void => {
    const k = key(x, y);
    if (occ.has(k)) err(`${what} overlaps ${occ.get(k)} at ${x},${y}.`, x, y);
    else occ.set(k, what);
  };

  const starts = map.startPositions ?? [];
  if (starts.length !== map.maxPlayers) err(`Place exactly ${map.maxPlayers} start positions (have ${starts.length}).`);
  // Slots must be EXACTLY {0..maxPlayers-1} — the lobby seats players by index, so a gap/stray-high slot
  // (e.g. {0,1,3} for 3 players) would seat a player with no start position (eliminated at t=0).
  const slotSet = new Set(starts.map((s) => s.slot));
  const contiguous = Array.from({ length: map.maxPlayers }, (_, i) => i).every((i) => slotSet.has(i));
  if (slotSet.size !== starts.length) err("Two start positions share a slot number.");
  else if (starts.length === map.maxPlayers && !contiguous) err(`Start slots must be numbered 1–${map.maxPlayers} with no gaps.`);
  for (const s of starts) {
    let fits = true;
    for (let dy = 0; dy < CY && fits; dy++) for (let dx = 0; dx < CY; dx++) if (!ground(s.x + dx, s.y + dy)) { fits = false; break; }
    if (!fits) err(`Start ${s.slot + 1}'s base doesn't fit on ground at ${s.x},${s.y}.`, s.x, s.y);
    claim(s.x, s.y, `Start ${s.slot + 1}`);
  }

  for (const g of map.goldMines ?? []) {
    if (!ground(g.x, g.y)) err(`A gold mine at ${g.x},${g.y} isn't on ground.`, g.x, g.y);
    if (!(g.amount > 0)) err(`A gold mine has a non-positive amount.`, g.x, g.y);
    claim(g.x, g.y, "A gold mine");
  }

  if (!map.citadel) err("Place the Citadel.");
  else {
    const cx = Math.floor(map.citadel.x), cy = Math.floor(map.citadel.y);
    if (!ground(cx, cy)) err("The Citadel must sit on ground.", cx, cy);
    claim(cx, cy, "The Citadel");
  }

  // Connectivity: every start must walk to the Citadel and to at least one gold mine.
  if (map.citadel && starts.length && gridOk) {
    const cx = Math.floor(map.citadel.x), cy = Math.floor(map.citadel.y);
    for (const s of starts) {
      const reach = reachableGround(map, s.x, s.y);
      if (!reach.has(key(cx, cy))) err(`Start ${s.slot + 1} can't reach the Citadel.`, s.x, s.y);
      if (!(map.goldMines ?? []).some((g) => reach.has(key(g.x, g.y)))) err(`Start ${s.slot + 1} can't reach any gold mine.`, s.x, s.y);
    }
  }

  return done();
}

// ── Import sanitization (untrusted JSON → safe GameMap) ──────────────────────

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}

/** Coerce arbitrary parsed JSON into a well-formed GameMap (or null if unrecoverable). Guarantees the
 *  terrain grid matches the size, tiles are valid, and coords are in-bounds — so imported data can't
 *  crash the editor/loader. Does NOT guarantee the map is *playable* — run validateMap() for that. */
export function sanitizeMap(raw: unknown): GameMap | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const { minSize: lo, maxSize: hi } = MAP_EDITOR;
  const W = clampInt(o.width, lo, hi, 40);
  const H = clampInt(o.height, lo, hi, 40);
  const maxPlayers = ([2, 3, 4] as number[]).includes(Number(o.maxPlayers)) ? (Number(o.maxPlayers) as 2 | 3 | 4) : 4;

  const rawT = o.terrain as unknown[][] | undefined;
  const terrain: MapTile[][] = [];
  for (let y = 0; y < H; y++) {
    const row: MapTile[] = [];
    for (let x = 0; x < W; x++) {
      const t = rawT?.[y]?.[x];
      row.push(TILES.includes(t as MapTile) ? (t as MapTile) : "ground");
    }
    terrain.push(row);
  }

  const inB = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const rawS = Array.isArray(o.startPositions) ? o.startPositions : [];
  const startPositions = rawS
    .filter((s): s is { slot: number; x: number; y: number } => typeof s === "object" && s !== null)
    .map((s) => ({ slot: clampInt(s.slot, 0, 3, 0), x: clampInt(s.x, 0, W - 1, 0), y: clampInt(s.y, 0, H - 1, 0) }))
    .filter((s) => inB(s.x, s.y))
    .slice(0, 4);

  const rawM = Array.isArray(o.goldMines) ? o.goldMines : [];
  const goldMines = rawM
    .filter((g): g is { x: number; y: number; amount: number } => typeof g === "object" && g !== null)
    .map((g) => ({ x: clampInt(g.x, 0, W - 1, 0), y: clampInt(g.y, 0, H - 1, 0), amount: clampInt(g.amount, 1, MAP_EDITOR.maxMineAmount, MAP_EDITOR.defaultMineAmount) }))
    .slice(0, 40);

  const rc = o.citadel as { x?: unknown; y?: unknown } | null | undefined;
  const citadel = rc && typeof rc === "object" ? { x: clampInt(rc.x, 0, W - 1, Math.floor(W / 2)), y: clampInt(rc.y, 0, H - 1, Math.floor(H / 2)) } : null;

  const name = (typeof o.name === "string" ? o.name : "Imported Map").slice(0, 40);
  const id = typeof o.id === "string" && /^[\w-]{1,40}$/.test(o.id) ? o.id : `custom-${name.replace(/\W+/g, "").slice(0, 12)}`;
  const author = typeof o.author === "string" ? o.author.slice(0, 24) : "custom";

  return { id, name, author, maxPlayers, width: W, height: H, terrain, startPositions, goldMines, citadel };
}
