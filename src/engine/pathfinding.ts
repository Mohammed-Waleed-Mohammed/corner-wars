// A* on the tile grid (§12): 8-directional, octile heuristic, no diagonal corner-cutting.
// Impassable = non-ground terrain OR a building footprint. If the goal tile is blocked
// (e.g. a building), routes to the nearest passable tile and lets the caller close the last
// gap. Paths are string-pulled (line-of-sight smoothing) to remove per-tile zig-zag. A node
// cap bounds worst-case cost; callers cache the result and only recompute when needed.

import { NAV } from "../config/constants";
import type { GameState, Owner, Vec2 } from "../core/types";
import { isGround } from "../state/terrain";

// A gate never blocks generic movement (it's owner-gated in computePath instead); every other
// building blocks. Used by navPassable (separation, spawn-snapping, no-route inching).
export function occupiedByBuilding(state: GameState, x: number, y: number): boolean {
  for (const e of state.entities) {
    if (e.kind !== "building" || e.hp <= 0 || e.buildingType === "gate") continue;
    if (x >= e.x && x < e.x + e.width && y >= e.y && y < e.y + e.height) return true;
  }
  return false;
}

export function navPassable(state: GameState, x: number, y: number): boolean {
  return isGround(state, x, y) && !occupiedByBuilding(state, x, y);
}

/** A gate NOT owned by `owner` covers this tile (closed to that owner). Lets movement — not
 *  just A* routing — keep enemies out of a friendly gate (15-logic §1). */
export function enemyGateAt(state: GameState, x: number, y: number, owner: Owner): boolean {
  for (const e of state.entities) {
    if (e.kind !== "building" || e.hp <= 0 || e.buildingType !== "gate" || e.owner === owner) continue;
    if (x >= e.x && x < e.x + e.width && y >= e.y && y < e.y + e.height) return true;
  }
  return false;
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

function buildingOccupancy(state: GameState): Set<number> {
  const W = state.mapWidth;
  const occ = new Set<number>();
  for (const e of state.entities) {
    if (e.kind !== "building" || e.hp <= 0 || e.buildingType === "gate") continue; // gates: owner-gated below
    for (let y = e.y; y < e.y + e.height; y++) {
      for (let x = e.x; x < e.x + e.width; x++) occ.add(y * W + x);
    }
  }
  return occ;
}

// Gates owned by someone OTHER than `owner` block the path (closed to enemies). With no owner
// (generic queries) ALL gates block — conservative, like a wall.
function gateOccupancy(state: GameState, owner: Owner | undefined): Set<number> {
  const W = state.mapWidth;
  const occ = new Set<number>();
  for (const e of state.entities) {
    if (e.kind !== "building" || e.hp <= 0 || e.buildingType !== "gate") continue;
    if (owner !== undefined && e.owner === owner) continue; // friendly gate is passable
    for (let y = e.y; y < e.y + e.height; y++) {
      for (let x = e.x; x < e.x + e.width; x++) occ.add(y * W + x);
    }
  }
  return occ;
}

export function computePath(
  state: GameState, fromX: number, fromY: number, toX: number, toY: number, owner?: Owner,
): Vec2[] {
  const W = state.mapWidth;
  const H = state.mapHeight;
  const sx = clampI(Math.floor(fromX), 0, W - 1);
  const sy = clampI(Math.floor(fromY), 0, H - 1);
  let gx = clampI(Math.floor(toX), 0, W - 1);
  let gy = clampI(Math.floor(toY), 0, H - 1);

  const occ = buildingOccupancy(state);
  const gates = gateOccupancy(state, owner);
  const pass = (x: number, y: number) => isGround(state, x, y) && !occ.has(y * W + x) && !gates.has(y * W + x);

  if (sx === gx && sy === gy) return [];
  if (!pass(gx, gy)) {
    const near = nearestPassable(gx, gy, pass);
    if (!near) return [];
    gx = near.x;
    gy = near.y;
    if (sx === gx && sy === gy) return [];
  }

  const N = W * H;
  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = sy * W + sx;
  const goal = gy * W + gx;
  g[start] = 0;

  const open = new MinHeap();
  open.push(start, heuristic(sx, sy, gx, gy));
  let expansions = 0;

  while (open.size > 0 && expansions < NAV.maxAStarNodes) {
    const cur = open.pop();
    if (cur === goal) return smooth(fromX, fromY, reconstruct(came, goal, W), pass);
    if (closed[cur]) continue;
    closed[cur] = 1;
    expansions++;
    const cx = cur % W;
    const cy = (cur / W) | 0;

    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0];
      const dy = DIRS[d][1];
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !pass(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!pass(cx + dx, cy) || !pass(cx, cy + dy))) continue; // no corner cut
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const tentative = g[cur] + DIRS[d][2];
      if (tentative < g[ni]) {
        came[ni] = cur;
        g[ni] = tentative;
        open.push(ni, tentative + heuristic(nx, ny, gx, gy));
      }
    }
  }
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
