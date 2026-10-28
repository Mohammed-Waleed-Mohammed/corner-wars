// A* on the tile grid (§12): 8-directional, octile heuristic, no diagonal corner-cutting.
// Impassable = impassable terrain OR a building footprint. If the goal tile is blocked
// (e.g. a building), routes to the nearest passable tile and lets the caller close the last
// gap. Paths are string-pulled (line-of-sight smoothing) to remove per-tile zig-zag. A node
// cap bounds worst-case cost; callers cache the result and only recompute when needed.
// 24 §B: with a movement class, entering a tile costs step / speedFactor(tile, class) and the
// heuristic is scaled by 1 / FASTEST_MOVE[class] (admissible), so units take roads and go round
// forests/shallows when that's faster; smoothing never shortcuts across slower-than-normal tiles.
//
// Performance (31 §C): every passability query reads a NAV GRID — terrain and building
// footprints rasterised once per sim tick (and again if the entity count changes mid-tick) — so a
// query is O(1) instead of a scan over every entity. Terrain costs per movement class are
// precomputed per map. A* reuses its buffers across searches (stamped, never cleared) instead of
// allocating ~270 KB per call. `pathStats.expansions` counts nodes expanded, for the per-tick budget.

import { NAV, TERRAIN } from "../config/constants";
import type { BiomeId, GameState, MoveClass, Owner, TerrainType, Vec2 } from "../core/types";
import { fastestFactor, speedFactor } from "../state/terrain";

// ── the nav grid ─────────────────────────────────────────────────────────────────────────────────

const BLOCK_TERRAIN = 1;
const BLOCK_BUILDING = 2;
interface NavGrid { tick: number; count: number; block: Uint8Array; gate: Int8Array }
const grids = new WeakMap<GameState, NavGrid>();
const terrainBlock = new WeakMap<TerrainType[][], Uint8Array>();

function ownerCode(o: Owner): number {
  return o === "neutral" ? 4 : o;
}

/** Static terrain passability for a map (the terrain array never changes during a match). */
function staticBlock(state: GameState): Uint8Array {
  let b = terrainBlock.get(state.terrain);
  if (!b || b.length !== state.mapWidth * state.mapHeight) {
    const W = state.mapWidth;
    b = new Uint8Array(W * state.mapHeight);
    for (let y = 0; y < state.mapHeight; y++) {
      const row = state.terrain[y];
      for (let x = 0; x < W; x++) if (!TERRAIN[row[x]].passable) b[y * W + x] = BLOCK_TERRAIN;
    }
    terrainBlock.set(state.terrain, b);
  }
  return b;
}

/** Terrain + live building footprints (gates kept apart with their owner: they are owner-gated). */
function navGrid(state: GameState): NavGrid {
  let g = grids.get(state);
  const count = state.entities.length;
  if (g && g.tick === state.tick && g.count === count) return g;
  const W = state.mapWidth, N = W * state.mapHeight;
  if (!g || g.block.length !== N) {
    g = { tick: -1, count: -1, block: new Uint8Array(N), gate: new Int8Array(N) };
    grids.set(state, g);
  }
  g.block.set(staticBlock(state));
  g.gate.fill(-1);
  for (const e of state.entities) {
    if (e.kind !== "building" || e.hp <= 0) continue;
    const gate = e.buildingType === "gate";
    const oc = ownerCode(e.owner);
    for (let y = Math.max(0, e.y); y < Math.min(state.mapHeight, e.y + e.height); y++) {
      for (let x = Math.max(0, e.x); x < Math.min(W, e.x + e.width); x++) {
        if (gate) g.gate[y * W + x] = oc;
        else g.block[y * W + x] |= BLOCK_BUILDING;
      }
    }
  }
  g.tick = state.tick;
  g.count = count;
  return g;
}

function inMap(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.mapWidth && y < state.mapHeight;
}

// A gate never blocks generic movement (it's owner-gated in computePath instead); every other
// building blocks. Used by navPassable (separation, spawn-snapping, no-route inching).
export function occupiedByBuilding(state: GameState, x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  return inMap(state, tx, ty) && (navGrid(state).block[ty * state.mapWidth + tx] & BLOCK_BUILDING) !== 0;
}

export function navPassable(state: GameState, x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  return inMap(state, tx, ty) && navGrid(state).block[ty * state.mapWidth + tx] === 0;
}

/** A gate NOT owned by `owner` covers this tile (closed to that owner). Lets movement — not
 *  just A* routing — keep enemies out of a friendly gate (15-logic §1). */
export function enemyGateAt(state: GameState, x: number, y: number, owner: Owner): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!inMap(state, tx, ty)) return false;
  const g = navGrid(state).gate[ty * state.mapWidth + tx];
  return g >= 0 && g !== ownerCode(owner);
}

/** Nearest passable position to (x,y) — used to keep spawns off impassable terrain (§3). */
export function nearestPassableTile(state: GameState, x: number, y: number): Vec2 {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (navPassable(state, sx, sy)) return { x, y };
  for (let r = 1; r <= 12; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (navPassable(state, sx + dx, sy + dy)) return { x: sx + dx + 0.5, y: sy + dy + 0.5 };
      }
    }
  }
  return { x, y };
}

// ── per-class terrain cost (1 / speed factor), precomputed per map + biome ──────────────────────────

const costCache = new WeakMap<TerrainType[][], Map<string, Float32Array>>();
function costGrid(state: GameState, cls: MoveClass, biome: BiomeId): Float32Array {
  let byKey = costCache.get(state.terrain);
  if (!byKey) { byKey = new Map(); costCache.set(state.terrain, byKey); }
  const key = `${cls}:${biome}`;
  let c = byKey.get(key);
  if (!c) {
    const W = state.mapWidth;
    c = new Float32Array(W * state.mapHeight);
    for (let y = 0; y < state.mapHeight; y++) {
      const row = state.terrain[y];
      for (let x = 0; x < W; x++) { const f = speedFactor(row[x], cls, biome); c[y * W + x] = f > 0 ? 1 / f : Infinity; }
    }
    byKey.set(key, c);
  }
  return c;
}

// ── A* (buffers reused across searches; a node's g/closed are valid only for the current stamp) ──

/** Nodes expanded by the most recent computePath (the navigator's per-tick budget reads this). */
export const pathStats = { expansions: 0 };
let cap = 0;
let gBuf = new Float64Array(0);
let cameBuf = new Int32Array(0);
let seenStamp = new Uint32Array(0);
let closedStamp = new Uint32Array(0);
let stamp = 0;
let heapInst: MinHeap | null = null; // created lazily (the class is declared further down)

function buffers(N: number): void {
  if (cap < N) {
    cap = N;
    gBuf = new Float64Array(N);
    cameBuf = new Int32Array(N);
    seenStamp = new Uint32Array(N);
    closedStamp = new Uint32Array(N);
    stamp = 0;
  }
  if (++stamp >= 0xffffffff) { seenStamp.fill(0); closedStamp.fill(0); stamp = 1; }
}

export function computePath(
  state: GameState, fromX: number, fromY: number, toX: number, toY: number, owner?: Owner, cls?: MoveClass,
): Vec2[] {
  pathStats.expansions = 0;
  const W = state.mapWidth;
  const H = state.mapHeight;
  const sx = clampI(Math.floor(fromX), 0, W - 1);
  const sy = clampI(Math.floor(fromY), 0, H - 1);
  let gx = clampI(Math.floor(toX), 0, W - 1);
  let gy = clampI(Math.floor(toY), 0, H - 1);

  const grid = navGrid(state);
  const block = grid.block, gate = grid.gate;
  const oc = owner === undefined ? -2 : ownerCode(owner); // no owner (generic queries): ALL gates block
  const passI = (i: number): boolean => block[i] === 0 && (gate[i] < 0 || gate[i] === oc);
  const pass = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && passI(y * W + x);
  // Weighted terrain (24 §B): cost multiplier per tile for this class; smoothing may only cross
  // normal-or-faster tiles, so a string-pulled shortcut never slices through a forest or a ford.
  const biome = state.biome;
  const cost = cls ? costGrid(state, cls, biome) : null;
  const hScale = cls ? 1 / fastestFactor(biome, cls) : 1; // 26 §C: admissible under the biome
  const passSmooth = cost
    ? (x: number, y: number): boolean => pass(x, y) && cost[y * W + x] <= 1
    : pass;

  if (sx === gx && sy === gy) return [];
  if (!pass(gx, gy)) {
    const near = nearestPassable(gx, gy, pass);
    if (!near) return [];
    gx = near.x;
    gy = near.y;
    if (sx === gx && sy === gy) return [];
  }

  buffers(W * H);
  const g = gBuf, came = cameBuf, seen = seenStamp, closed = closedStamp, id = stamp;
  const start = sy * W + sx;
  const goal = gy * W + gx;
  g[start] = 0;
  came[start] = -1;
  seen[start] = id;

  const heap = (heapInst ??= new MinHeap());
  heap.clear();
  heap.push(start, heuristic(sx, sy, gx, gy) * hScale);
  let expansions = 0;

  while (heap.size > 0 && expansions < NAV.maxAStarNodes) {
    const cur = heap.pop();
    if (cur === goal) {
      pathStats.expansions = expansions;
      return smooth(fromX, fromY, reconstruct(came, goal, W), passSmooth);
    }
    if (closed[cur] === id) continue;
    closed[cur] = id;
    expansions++;
    const cx = cur % W;
    const cy = (cur / W) | 0;

    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0];
      const dy = DIRS[d][1];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!passI(ni)) continue;
      if (dx !== 0 && dy !== 0 && (!passI(cy * W + nx) || !passI(ny * W + cx))) continue; // no corner cut
      if (closed[ni] === id) continue;
      const tentative = g[cur] + DIRS[d][2] * (cost ? cost[ni] : 1);
      if (seen[ni] !== id || tentative < g[ni]) {
        seen[ni] = id;
        came[ni] = cur;
        g[ni] = tentative;
        heap.push(ni, tentative + heuristic(nx, ny, gx, gy) * hScale);
      }
    }
  }
  pathStats.expansions = expansions;
  return []; // unreachable within the node cap
}

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

function heuristic(x: number, y: number, gx: number, gy: number): number {
  const dx = Math.abs(x - gx);
  const dy = Math.abs(y - gy);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function reconstruct(came: Int32Array, goal: number, W: number): Vec2[] {
  const tiles: number[] = [];
  let c = goal;
  while (c !== -1) {
    tiles.push(c);
    c = came[c];
  }
  tiles.reverse();
  const pts: Vec2[] = [];
  for (let i = 1; i < tiles.length; i++) {
    pts.push({ x: (tiles[i] % W) + 0.5, y: ((tiles[i] / W) | 0) + 0.5 }); // skip the start tile
  }
  return pts;
}

/** String-pull: drop waypoints the unit can reach in a straight clear line. */
function smooth(fromX: number, fromY: number, pts: Vec2[], pass: (x: number, y: number) => boolean): Vec2[] {
  if (pts.length <= 1) return pts;
  const out: Vec2[] = [];
  let ax = fromX;
  let ay = fromY;
  let i = 0;
  while (i < pts.length) {
    let j = i;
    while (j + 1 < pts.length && lineOfSight(ax, ay, pts[j + 1].x, pts[j + 1].y, pass)) j++;
    out.push(pts[j]);
    ax = pts[j].x;
    ay = pts[j].y;
    i = j + 1;
  }
  return out;
}

// Supercover (Amanatides–Woo) traversal: visits every tile the segment crosses, and at an
// exact corner crossing requires both flanking tiles passable — so smoothing can never cut a
// corner through a 1-tile wall.
function lineOfSight(ax: number, ay: number, bx: number, by: number, pass: (x: number, y: number) => boolean): boolean {
  let x = Math.floor(ax);
  let y = Math.floor(ay);
  const ex = Math.floor(bx);
  const ey = Math.floor(by);
  if (!pass(x, y)) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (stepX > 0 ? x + 1 - ax : ax - x) / Math.abs(dx) : Infinity;
  let tMaxY = dy !== 0 ? (stepY > 0 ? y + 1 - ay : ay - y) / Math.abs(dy) : Infinity;

  let guard = 0;
  while ((x !== ex || y !== ey) && guard++ < 256) {
    if (Math.abs(tMaxX - tMaxY) < 1e-9) {
      if (!pass(x + stepX, y) || !pass(x, y + stepY)) return false; // corner — no cutting
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      x += stepX;
      y += stepY;
    } else if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      x += stepX;
    } else {
      tMaxY += tDeltaY;
      y += stepY;
    }
    if (!pass(x, y)) return false;
  }
  return true;
}

function nearestPassable(gx: number, gy: number, pass: (x: number, y: number) => boolean): Vec2 | null {
  for (let r = 1; r <= 10; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (pass(gx + dx, gy + dy)) return { x: gx + dx, y: gy + dy };
      }
    }
  }
  return null;
}

function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Compact binary min-heap over (node, priority); allows duplicates (lazy via closed[]). */
class MinHeap {
  private node: number[] = [];
  private prio: number[] = [];
  get size(): number {
    return this.node.length;
  }
  clear(): void {
    this.node.length = 0;
    this.prio.length = 0;
  }
  push(node: number, prio: number): void {
    this.node.push(node);
    this.prio.push(prio);
    let i = this.node.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prio[p] <= this.prio[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.node[0];
    const last = this.node.length - 1;
    this.node[0] = this.node[last];
    this.prio[0] = this.prio[last];
    this.node.pop();
    this.prio.pop();
    const n = this.node.length;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let m = i;
      if (l < n && this.prio[l] < this.prio[m]) m = l;
      if (r < n && this.prio[r] < this.prio[m]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const tn = this.node[a];
    this.node[a] = this.node[b];
    this.node[b] = tn;
    const tp = this.prio[a];
    this.prio[a] = this.prio[b];
    this.prio[b] = tp;
  }
}
