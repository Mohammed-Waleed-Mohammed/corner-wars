// 22 §G v4 — terrain-aware base planning. The base is the area within walking distance r of the main
// Construction Yard; its wall is the ring of tiles at exactly that distance that lead further out. r is
// chosen where that ring is SHORTEST — a few tiles across a choke between cliffs and water, a short
// line on open ground — so the wall really closes the base instead of drawing straight lines in a field.
//
//   0. (36 §C) Only ring tiles facing the open map are walled: a corner the ring would close off against
//      cliffs or the map edge is a dead end, so it joins the base rather than becoming a sealed pocket.
//   1. Walking distance (4-connected BFS over walkable terrain) from the yard's footprint. Any path from
//      inside (d < r) to outside (d > r) must step on a tile at d = r, and with no diagonal corner
//      cutting a diagonal step can't slip past two ring tiles either — so walling the ring seals the base.
//   2. r is the cheapest ring between rIn and WALL_R_MAX: rIn leaves room for the base (existing
//      buildings and the home mine inside, plus BASE_AREA_MIN buildable tiles); ring tiles that can't
//      take a wall (forest, shallows, bridge, a gold pile) cost extra because they stay open.
//   3. Gates (2 tiles wide, so an army can get out) go exactly where the AI's own routes cross the ring:
//      toward the nearest enemy base (the MAIN gate, gates[0]), the Citadel and outlying gold.
//   4. Defenses: a Gun Turret just inside every gate, beside the lane (the main gate also gets a Pillbox
//      on the other side), a Pillbox behind every gap that can't be walled, Pillboxes along long
//      threat-facing wall stretches, and Anti-Armor / Missile towers at the main gate when the enemy mix
//      calls for them.
//   5. Lanes: the walk from each gate to the yard (3 wide) is reserved; buildings go inside the ring,
//      one tile clear of it, and never on a lane — the AI can't wall in its own army.
// The ring and gates freeze once the first wall or gate is placed, so later re-plans never move them.
// 36 §C: the Architect adds outer rings (planOuterLayer) beyond a frozen first one, as the match calls for them.

import { COMMANDER, TERRAIN } from "../../config/constants";
import type { AIBasePlan, ArchLayer, Building, BuildingType, GameState, Vec2 } from "../../core/types";
import { isBuildable } from "../../state/terrain";
import { baseCenter, buildingsOf, composition, frontDistance, livingEnemies } from "./assess";
import type { Ctx } from "./commander";

const N4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function walkable(state: GameState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.mapWidth && y < state.mapHeight && TERRAIN[state.terrain[y][x]].passable;
}

/** 4-connected BFS walking distance from `seeds` (tile indices) over walkable terrain, up to `max`
 *  (Infinity = whole map). Unreached tiles are -1. Buildings are ignored: the plan is about terrain. */
function bfs(state: GameState, seeds: number[], max: number): Int16Array {
  const W = state.mapWidth, H = state.mapHeight;
  const d = new Int16Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let head = 0, tail = 0;
  for (const s of seeds) { if (d[s] < 0) { d[s] = 0; q[tail++] = s; } }
  while (head < tail) {
    const i = q[head++];
    const di = d[i];
    if (di >= max) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!walkable(state, nx, ny)) continue;
      const ni = ny * W + nx;
      if (d[ni] >= 0) continue;
      d[ni] = di + 1;
      q[tail++] = ni;
    }
  }
  return d;
}

/** 36 §D walking distance from the tile nearest `at` over the whole map (terrain only). */
export function walkFrom(state: GameState, at: Vec2): Int16Array {
  return bfs(state, [nearestWalkable(state, at.x, at.y)], Infinity);
}

function nearestWalkable(state: GameState, x: number, y: number): number {
  const W = state.mapWidth;
  const tx = Math.floor(x), ty = Math.floor(y);
  for (let r = 0; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (walkable(state, tx + dx, ty + dy)) return (ty + dy) * W + tx + dx;
    }
  }
  return ty * W + tx;
}

/** A tile that can take a wall (structure terrain, no gold pile, not the Citadel). */
function wallable(state: GameState, x: number, y: number): boolean {
  if (!isBuildable(state, x, y)) return false;
  if (state.goldSources.some((g) => g.x === x && g.y === y)) return false;
  const c = state.citadel, cv = 2;
  return !(Math.abs(x + 0.5 - c.x) <= cv + 0.5 && Math.abs(y + 0.5 - c.y) <= cv + 0.5);
}

/** Tiles at walking distance r that lead further out (a 4-neighbour at r + 1): the wall line. */
function ringAt(state: GameState, d: Int16Array, r: number): number[] {
  const W = state.mapWidth, out: number[] = [];
  for (let i = 0; i < d.length; i++) {
    if (d[i] !== r) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (walkable(state, nx, ny) && d[ny * W + nx] === r + 1) { out.push(i); break; }
    }
  }
  return out;
}

/** 36 §C the ring tiles that face the open map: those with a 4-neighbour beyond the ring that the far
 *  side of the map reaches without crossing the ring. A ring tile that only faces a dead end (a corner
 *  closed off by cliffs, water or the map edge) needs no wall — the corner becomes part of the base
 *  instead of a pocket sealed outside it. The open map is what the Citadel and the enemy bases reach
 *  (a far corner can be beyond the BFS limit and still a dead end); only if none of them is outside the
 *  ring, every tile the BFS never reached seeds it. */
function exitRing(ctx: Ctx, d: Int16Array, ring: number[], r: number): number[] {
  const { state, pid } = ctx;
  const W = state.mapWidth, H = state.mapHeight;
  const out = new Uint8Array(W * H);
  const q: number[] = [];
  const open = (i: number): boolean => (d[i] < 0 || d[i] > r) && walkableTile(state, i);
  const seeds: Vec2[] = [{ x: state.citadel.x, y: state.citadel.y }];
  for (const e of livingEnemies(state, pid)) { const c = baseCenter(state, e); if (c) seeds.push(c); }
  for (const s of seeds) { const c = nearestWalkable(state, s.x, s.y); if (!out[c] && open(c)) { out[c] = 1; q.push(c); } }
  if (q.length === 0) for (let i = 0; i < d.length; i++) if (d[i] < 0 && open(i)) { out[i] = 1; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!out[ni] && open(ni)) { out[ni] = 1; q.push(ni); }
    }
  }
  return ring.filter((i) => {
    const x = i % W, y = (i / W) | 0;
    return N4.some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < H && out[ny * W + nx] === 1; });
  });
}

/** Walk downhill on `d` from tile `from` to the yard (distance 0): the lane a gate's traffic uses. */
function laneFrom(state: GameState, d: Int16Array, from: number, toward: Vec2, stopAt = 0): number[] {
  const W = state.mapWidth, lane: number[] = [from];
  let cur = from;
  for (let guard = 0; guard < 64 && d[cur] > stopAt; guard++) {
    const x = cur % W, y = (cur / W) | 0;
    let best = -1, bestKey = Infinity;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= state.mapHeight) continue;
      const ni = ny * W + nx;
      if (d[ni] !== d[cur] - 1) continue;
      const key = Math.hypot(nx + 0.5 - toward.x, ny + 0.5 - toward.y);
      if (key < bestKey) { bestKey = key; best = ni; }
    }
    if (best < 0) break;
    lane.push(best);
    cur = best;
  }
  return lane;
}

export interface PlanStats { radius: number; ring: number; walls: number; gates: number; openings: number; defenses: number }

/** Build (or keep) the base plan for the main yard `cy`. Cheap enough to call every operational tick:
 *  it only recomputes when the yard changes or every PLAN_REFRESH_TICKS while nothing is built yet. */
export function planBase(ctx: Ctx, cy: Building): void {
  const { state, cs, pid } = ctx;
  const old = cs.basePlan;
  const frozen = !!old && old.yardId === cy.id && old.frozen;
  if (old && old.yardId === cy.id && (frozen || state.tick - old.plannedTick < COMMANDER.PLAN_REFRESH_TICKS)) {
    if (frozen) refreshDefenses(ctx, old);
    return;
  }
  const W = state.mapWidth;
  const anchor = { x: cy.x + cy.width / 2, y: cy.y + cy.height / 2 };
  const seeds: number[] = [];
  for (let y = cy.y; y < cy.y + cy.height; y++) for (let x = cy.x; x < cy.x + cy.width; x++) seeds.push(y * W + x);
  const R_MAX = COMMANDER.WALL_R_MAX;
  const d = bfs(state, seeds, R_MAX + 1);

  // rIn: existing base buildings and the home mine inside (with a clear tile), plus room to grow.
  const mine = buildingsOf(state, pid).filter((b) => b.buildingType !== "wall" && b.buildingType !== "gate");
  let rIn: number = COMMANDER.WALL_R_MIN;
  for (const b of mine) {
    let far = -1;
    for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) far = Math.max(far, d[y * W + x]);
    if (far >= 0 && far <= R_MAX - 2) rIn = Math.max(rIn, far + 2); // a far outpost (expansion) stays outside
  }
  // The home gold field stays inside: the nearest pile by walking distance, and every pile within a few
  // tiles of it (a field is several piles), with room for the workers around it.
  let gNear = Infinity;
  for (const g of state.goldSources) { const gd = d[g.y * W + g.x]; if (gd >= 0) gNear = Math.min(gNear, gd); }
  if (gNear <= R_MAX - 4) {
    for (const g of state.goldSources) {
      const gd = d[g.y * W + g.x];
      if (gd >= 0 && gd <= Math.max(COMMANDER.HOME_MINE_DIST, gNear + 4) && gd <= R_MAX - 4) rIn = Math.max(rIn, gd + 3);
    }
  }
  let area = 0;
  const areaAt: number[] = [];
  for (let r = 0; r <= R_MAX; r++) areaAt.push(0);
  for (let i = 0; i < d.length; i++) {
    if (d[i] < 0 || d[i] > R_MAX) continue;
    const x = i % W, y = (i / W) | 0;
    if (isBuildable(state, x, y)) areaAt[d[i]]++;
  }
  for (let r = 0; r <= R_MAX; r++) {
    area += areaAt[r];
    if (r >= 1 && area >= COMMANDER.BASE_AREA_MIN) { rIn = Math.max(rIn, r + 2); break; }
  }

  // The cheapest closing ring.
  const cap = COMMANDER.RING_WALLS_SOFT - 2 * COMMANDER.GATES_MAX;
  let best: { r: number; ring: number[]; score: number } | null = null;
  for (let r = Math.min(rIn, R_MAX - 1); r <= R_MAX - 1; r++) {
    const ring = exitRing(ctx, d, ringAt(state, d, r), r);
    if (ring.length === 0) continue;
    let open = 0;
    for (const i of ring) if (!wallable(state, i % W, (i / W) | 0)) open++;
    const over = Math.max(0, ring.length - open - cap);
    const score = ring.length + COMMANDER.OPENING_COST * open + 0.6 * r + 10 * over;
    if (!best || score < best.score) best = { r, ring, score };
  }
  if (!best) { cs.basePlan = emptyPlan(cy, anchor, state.tick); return; }
  const r = best.r;
  const { gates, gateCenters, walls, openings, lanes } = ringPlan(ctx, d, best.ring, r, anchor, 0, null);

  const plan: AIBasePlan = {
    yardId: cy.id, anchor, radius: r, perimeter: best.ring.map((i) => ({ x: i % W, y: (i / W) | 0 })),
    gates, gateCenters, walls, openings, plannedDefenses: [],
    dist: d, reserved: [...lanes].filter((i) => i >= 0 && i < d.length), plannedTick: state.tick, frozen: false,
    distMax: R_MAX + 1,
  };
  plan.plannedDefenses = defenseSpots(ctx, plan);
  cs.basePlan = plan;
}

interface RingPlan { gates: Vec2[]; gateCenters: Vec2[]; walls: Vec2[]; openings: Vec2[]; lanes: Set<number> }

/** Gates where my routes cross `ring` (at walking distance r): toward the nearest enemy (the MAIN gate),
 *  the Citadel, the other enemies and outlying gold; the lanes from each gate inward to distance `stopAt`;
 *  every other wallable ring tile a wall (nearest the main gate first), the rest openings. Tiles in `skip`
 *  (under my own buildings) need neither. */
function ringPlan(ctx: Ctx, d: Int16Array, ring: number[], r: number, anchor: Vec2, stopAt: number, skip: Set<number> | null): RingPlan {
  const { state, pid } = ctx;
  const W = state.mapWidth;
  const ringSet = new Set(ring);

  // Gates where my routes cross the ring: nearest enemy (main), the Citadel, outlying gold.
  const enemies = livingEnemies(state, pid);
  const dests: Vec2[] = [];
  const nearestE = enemies.length ? enemies.reduce((a, b) => (frontDistance(state, pid, a) < frontDistance(state, pid, b) ? a : b)) : null;
  const eBase = nearestE != null ? baseCenter(state, nearestE) : null;
  if (eBase) dests.push(eBase);
  dests.push({ x: state.citadel.x, y: state.citadel.y });
  for (const e of enemies) { const c = baseCenter(state, e); if (c && e !== nearestE) dests.push(c); }
  const outsideGold = state.goldSources
    .filter((g) => { const gd = d[g.y * W + g.x]; return gd < 0 || gd > r; })
    .sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y))
    .slice(0, 2);
  for (const g of outsideGold) dests.push({ x: g.x + 0.5, y: g.y + 0.5 });

  const gateCenters: Vec2[] = [];
  const gates: Vec2[] = [];
  const openings: Vec2[] = [];
  const gateTiles = new Set<number>();
  const lanes = new Set<number>();
  for (const dst of dests) {
    if (gateCenters.length >= COMMANDER.GATES_MAX) break;
    const dd = bfs(state, [nearestWalkable(state, dst.x, dst.y)], Infinity);
    let g = -1, gk = Infinity;
    for (const i of ring) {
      if (dd[i] < 0) continue;
      const k = d[i] + dd[i];
      if (k < gk) { gk = k; g = i; }
    }
    if (g < 0) continue;
    const gx = g % W, gy = (g / W) | 0;
    if (gateCenters.some((c) => Math.abs(c.x - gx) + Math.abs(c.y - gy) <= COMMANDER.GATE_MERGE)) continue;
    // a second gate tile: the ring neighbour on this route's side (so the opening is 2 wide)
    let g2 = -1, g2k = Infinity;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const ni = (gy + dy) * W + gx + dx;
      if (!ringSet.has(ni) || dd[ni] < 0) continue;
      if (dd[ni] < g2k) { g2k = dd[ni]; g2 = ni; }
    }
    gateCenters.push({ x: gx, y: gy });
    for (const t of g2 >= 0 ? [g, g2] : [g]) {
      gateTiles.add(t);
      const tx = t % W, ty = (t / W) | 0;
      if (wallable(state, tx, ty) && !skip?.has(t)) gates.push({ x: tx, y: ty });
      for (const li of laneFrom(state, d, t, anchor, stopAt)) {
        const lx = li % W, ly = (li / W) | 0;
        for (const [dx, dy] of [[0, 0], ...N4]) lanes.add((ly + dy) * W + lx + dx); // 3 wide
      }
    }
  }

  // Walls: every wallable ring tile except the gates, nearest the main gate first (the front closes first).
  const main = gateCenters[0] ?? anchor;
  const walls: Vec2[] = [];
  for (const i of ring) {
    const x = i % W, y = (i / W) | 0;
    if (gateTiles.has(i) || skip?.has(i)) continue;
    if (wallable(state, x, y)) walls.push({ x, y });
    else openings.push({ x, y });
  }
  walls.sort((a, b) => Math.hypot(a.x - main.x, a.y - main.y) - Math.hypot(b.x - main.x, b.y - main.y));
  return { gates, gateCenters, walls, openings, lanes };
}

function emptyPlan(cy: Building, anchor: Vec2, tick: number): AIBasePlan {
  return { yardId: cy.id, anchor, radius: 0, perimeter: [], gates: [], gateCenters: [], walls: [], openings: [], plannedDefenses: [], dist: null, reserved: [], plannedTick: tick, frozen: false };
}

/** Is tile (x, y) strictly inside the planned wall with a clear tile to spare, and off every lane? */
export function insideBase(plan: AIBasePlan, state: GameState, x: number, y: number, margin = 2): boolean {
  if (!plan.dist || plan.radius <= 0) return true;
  if (x < 0 || y < 0 || x >= state.mapWidth || y >= state.mapHeight) return false;
  const i = y * state.mapWidth + x;
  const di = plan.dist[i];
  return di >= 0 && di <= plan.radius - margin && !reservedSet(plan).has(i);
}

const reservedCache = new WeakMap<AIBasePlan, Set<number>>();
function reservedSet(plan: AIBasePlan): Set<number> {
  let s = reservedCache.get(plan);
  if (!s) { s = new Set(plan.reserved); reservedCache.set(plan, s); }
  return s;
}

/** Is (x, y) on the planned wall ring or a reserved gate lane? */
export function onRingOrLane(plan: AIBasePlan, state: GameState, x: number, y: number): boolean {
  if (!plan.dist || plan.radius <= 0 || x < 0 || y < 0 || x >= state.mapWidth || y >= state.mapHeight) return false;
  const i = y * state.mapWidth + x;
  const di = plan.dist[i];
  return di === plan.radius || reservedSet(plan).has(i) || !!plan.layers?.some((l) => di === l.radius);
}

/** 36 §B: tiles of every planned ring that will be wall (not gates or openings) — the flow check treats
 *  them as blocked before they are built. Cached per plan and layer count. */
const wallCache = new WeakMap<AIBasePlan, { n: number; set: Set<number> }>();
export function plannedWallSet(plan: AIBasePlan, W: number): Set<number> {
  const n = plan.layers?.length ?? 0;
  const c = wallCache.get(plan);
  if (c && c.n === n) return c.set;
  const set = new Set<number>();
  for (const w of plan.walls) set.add(w.y * W + w.x);
  for (const l of plan.layers ?? []) for (const w of l.walls) set.add(w.y * W + w.x);
  wallCache.set(plan, { n, set });
  return set;
}

/** Make sure `plan.dist` reaches walking distance `need` (outer rings lie beyond the first plan's
 *  WALL_R_MAX). The BFS is over terrain only, so the values already there do not change. */
function ensureDist(state: GameState, plan: AIBasePlan, need: number): Int16Array | null {
  if (plan.dist && (plan.distMax ?? COMMANDER.WALL_R_MAX + 1) >= need) return plan.dist;
  const cy = state.entities.find((e) => e.id === plan.yardId && e.kind === "building");
  if (!cy || cy.kind !== "building") return null;
  const W = state.mapWidth, seeds: number[] = [];
  for (let y = cy.y; y < cy.y + cy.height; y++) for (let x = cy.x; x < cy.x + cy.width; x++) seeds.push(y * W + x);
  plan.dist = bfs(state, seeds, need);
  plan.distMax = need;
  return plan.dist;
}

/** 36 §C plan the next outer ring beyond the last one (layer 2 beyond the first, layer 3 beyond that):
 *  the cheapest ring in [previous + GAP_MIN, previous + GAP_MAX] that, walled, still lets a flood from
 *  outside reach every gate of the previous ring and cuts off at most POCKET_MAX free tiles between the
 *  two. Its gates sit on the same routes, its lanes run in to the previous ring, two towers stand behind
 *  each gate. When no radius qualifies: why the best one failed (a string). Adds the layer to the plan. */
export function planOuterLayer(ctx: Ctx, plan: AIBasePlan): ArchLayer | string {
  const { state, pid } = ctx;
  const A = COMMANDER.ARCH;
  const layers = (plan.layers ??= []);
  const prev = layers.length ? layers[layers.length - 1] : null;
  const prevR = prev ? prev.radius : plan.radius;
  const prevGates = prev ? prev.gates : plan.gates;
  if (prevR <= 0 || prevGates.length === 0) return "the previous ring has no gate";
  const need = prevR + A.GAP_MAX + 2;
  const d = ensureDist(state, plan, need);
  if (!d) return "no yard";
  const W = state.mapWidth, H = state.mapHeight;
  // blocked for the check: every building but my gates, and every planned wall tile so far
  const blocked = new Uint8Array(W * H);
  const mine = new Set<number>();
  for (const e of state.entities) {
    if (e.kind !== "building" || e.hp <= 0) continue;
    const myGate = e.owner === pid && e.buildingType === "gate";
    for (let ty = Math.max(0, e.y); ty < Math.min(H, e.y + e.height); ty++)
      for (let tx = Math.max(0, e.x); tx < Math.min(W, e.x + e.width); tx++) {
        if (!myGate) blocked[ty * W + tx] = 1;
        if (e.owner === pid) mine.add(ty * W + tx);
      }
  }
  for (const i of plannedWallSet(plan, W)) blocked[i] = 1;
  const cands: { r: number; ring: number[]; score: number }[] = [];
  for (let r = prevR + A.GAP_MIN; r <= Math.min(prevR + A.GAP_MAX, need - 2); r++) {
    const ring = exitRing(ctx, d, ringAt(state, d, r), r);
    if (ring.length === 0) continue;
    let open = 0;
    for (const i of ring) if (!mine.has(i) && !wallable(state, i % W, (i / W) | 0)) open++;
    cands.push({ r, ring, score: ring.length + COMMANDER.OPENING_COST * open + 0.6 * r });
  }
  cands.sort((a, b) => a.score - b.score || a.r - b.r);
  let fail = cands.length ? "" : "no ring beyond the first";
  const note = (s: string): void => { if (!fail) fail = s; };
  for (const c of cands) {
    const rp = ringPlan(ctx, d, c.ring, c.r, plan.anchor, prevR, mine);
    if (rp.gateCenters.length === 0) { note(`r=${c.r}: no route crosses it`); continue; }
    // flood from just outside the new ring, its walls up; terrain can split the ground between the
    // rings into pieces no route gate reaches — each such piece gets a gate of its own (up to EXTRA_GATES)
    const wallT = new Set(rp.walls.map((w) => w.y * W + w.x));
    const free = (i: number): boolean => d[i] >= 0 && d[i] <= c.r + 1 && !blocked[i] && !wallT.has(i) && walkableTile(state, i);
    let seen = new Uint8Array(0);
    let cut = 0, pocket = 0;
    for (let extra = 0; ; extra++) {
      seen = new Uint8Array(W * H);
      const q: number[] = [];
      for (let i = 0; i < d.length; i++) if (d[i] === c.r + 1 && free(i)) { seen[i] = 1; q.push(i); }
      for (let k = 0; k < q.length; k++) {
        const i = q[k], tx = i % W, ty = (i / W) | 0;
        for (const [dx, dy] of N4) {
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (!seen[ni] && free(ni)) { seen[ni] = 1; q.push(ni); }
        }
      }
      cut = prevGates.filter((g) => !seen[g.y * W + g.x] && !blocked[g.y * W + g.x]).length;
      const sealed: number[] = [];
      for (let i = 0; i < d.length; i++) if (d[i] > prevR && d[i] < c.r && free(i) && !seen[i]) sealed.push(i);
      pocket = sealed.length;
      if ((cut === 0 && pocket <= A.POCKET_MAX) || extra >= A.EXTRA_GATES) break;
      // the wall tile of the new ring touching the biggest sealed stretch first: open it as a gate
      const sealedSet = new Set(sealed);
      let pick = -1, pickN = 0;
      for (const w of rp.walls) {
        const wi = w.y * W + w.x;
        let n = 0, outside = false;
        for (const [dx, dy] of N4) {
          const nx = w.x + dx, ny = w.y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (sealedSet.has(ni)) n++;
          if (seen[ni]) outside = true;
        }
        if (outside && n > pickN) { pickN = n; pick = wi; }
      }
      if (pick < 0) break;
      const px = pick % W, py = (pick / W) | 0;
      wallT.delete(pick);
      rp.walls = rp.walls.filter((w) => w.x !== px || w.y !== py);
      rp.gates.push({ x: px, y: py });
      rp.gateCenters.push({ x: px, y: py });
    }
    if (cut > 0) { note(`r=${c.r}: ${cut} inner gate tiles cut off`); continue; }
    if (pocket > A.POCKET_MAX) { note(`r=${c.r}: ${pocket} tiles sealed between the rings`); continue; }
    const layer: ArchLayer = {
      radius: c.r, perimeter: c.ring.map((i) => ({ x: i % W, y: (i / W) | 0 })),
      gates: rp.gates, gateCenters: rp.gateCenters, walls: rp.walls, openings: rp.openings, towers: [],
    };
    layers.push(layer);
    plan.reserved = [...new Set([...plan.reserved, ...[...rp.lanes].filter((i) => i >= 0 && i < d.length)])];
    reservedCache.delete(plan);
    const taken: Vec2[] = [];
    for (const g of layer.gateCenters) {
      for (const type of ["turret", "pillbox"] as const) {
        const at = insideSpot(plan, state, g, c.r - 3, c.r - 2, 5, taken, true);
        if (at) { layer.towers.push({ type, x: at.x, y: at.y }); taken.push(at); }
      }
    }
    return layer;
  }
  return fail;
}

/** §G v4.6 never wall myself in: would a structure at (x, y, w, h) cut any open ground inside the base
 *  off from the gates? Flood fill (4-connected — with no diagonal corner cutting that is exactly what a
 *  unit can walk) from the gate tiles over free tiles inside the ring, treating the rest of the ring as
 *  the wall it will become; the placement is fine if it doesn't add a single unreachable tile. */
export function keepsBaseConnected(plan: AIBasePlan, state: GameState, x: number, y: number, w: number, h: number): boolean {
  if (!plan.dist || plan.radius <= 0 || plan.gates.length === 0) return true;
  const W = state.mapWidth, H = state.mapHeight, d = plan.dist, r = plan.radius;
  const blocked = new Uint8Array(W * H);
  for (const e of state.entities) {
    if (e.kind !== "building" || e.hp <= 0 || e.buildingType === "gate") continue;
    for (let ty = Math.max(0, e.y); ty < Math.min(H, e.y + e.height); ty++)
      for (let tx = Math.max(0, e.x); tx < Math.min(W, e.x + e.width); tx++) blocked[ty * W + tx] = 1;
  }
  const gateSet = new Set(plan.gates.map((g) => g.y * W + g.x));
  const free = (i: number, extra: boolean): boolean => {
    const di = d[i];
    if (di < 0 || di > r || blocked[i]) return false;
    if (di === r && !gateSet.has(i)) return false; // the ring is (or will be) wall
    if (extra) { const tx = i % W, ty = (i / W) | 0; if (tx >= x && tx < x + w && ty >= y && ty < y + h) return false; }
    return walkableTile(state, i);
  };
  const unreached = (extra: boolean): number => {
    const seen = new Uint8Array(W * H);
    const q: number[] = [];
    for (const g of gateSet) if (free(g, extra)) { seen[g] = 1; q.push(g); }
    for (let k = 0; k < q.length; k++) {
      const i = q[k], tx = i % W, ty = (i / W) | 0;
      for (const [dx, dy] of N4) {
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (!seen[ni] && free(ni, extra)) { seen[ni] = 1; q.push(ni); }
      }
    }
    let n = 0;
    for (let i = 0; i < d.length; i++) if (d[i] >= 0 && d[i] < r && !seen[i] && free(i, extra)) n++;
    return n;
  };
  return unreached(true) <= unreached(false);
}

function walkableTile(state: GameState, i: number): boolean {
  const W = state.mapWidth;
  return walkable(state, i % W, (i / W) | 0);
}

/** Footprint fully inside the base and off the lanes. */
export function footprintInside(plan: AIBasePlan, state: GameState, x: number, y: number, w: number, h: number): boolean {
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (!insideBase(plan, state, tx, ty)) return false;
  return true;
}

/** Inside spot nearest `at` (within `maxR`), at walking distance [lo, hi] from the yard, off the lanes. */
function insideSpot(plan: AIBasePlan, state: GameState, at: Vec2, lo: number, hi: number, maxR = 4, avoid: Vec2[] = [], hill = true): Vec2 | null {
  const W = state.mapWidth;
  let best: Vec2 | null = null, bd = Infinity;
  const ax = Math.round(at.x), ay = Math.round(at.y);
  for (let dy = -maxR; dy <= maxR; dy++) for (let dx = -maxR; dx <= maxR; dx++) {
    const x = ax + dx, y = ay + dy;
    if (x < 0 || y < 0 || x >= W || y >= state.mapHeight) continue;
    const di = plan.dist![y * W + x];
    if (di < lo || di > hi || reservedSet(plan).has(y * W + x) || !isBuildable(state, x, y)) continue;
    if (avoid.some((a) => Math.abs(a.x - x) + Math.abs(a.y - y) < 3)) continue;
    const dd = Math.hypot(dx, dy) - (hill && state.terrain[y][x] === "hill" ? 2 : 0); // 36 §C: high ground, +1 range
    if (dd < bd) { bd = dd; best = { x, y }; }
  }
  return best;
}

/** §G v4.4 where the towers go. `core` ones (main gate turret, gaps) are built for every personality. */
function defenseSpots(ctx: Ctx, plan: AIBasePlan): AIBasePlan["plannedDefenses"] {
  const { state, pid } = ctx;
  if (!plan.dist || plan.radius <= 0) return [];
  const r = plan.radius;
  const out: AIBasePlan["plannedDefenses"] = [];
  const taken: Vec2[] = [];
  const add = (type: BuildingType, at: Vec2 | null, core: boolean, gate = false): void => {
    if (!at) return;
    out.push(gate ? { type, x: at.x, y: at.y, core, gate } : { type, x: at.x, y: at.y, core });
    taken.push(at);
  };
  // gates, 2–3 tiles inside beside the lane: a turret and a pillbox at each. The main gate's pair is core
  // (built from the start: the opening's only static defense); the other gates' pillboxes are 36 §C's
  // second tower, built once ring 1 is commissioned
  plan.gateCenters.forEach((g, k) => {
    add("turret", insideSpot(plan, state, g, r - 3, r - 2, 4, taken), k === 0);
    add("pillbox", insideSpot(plan, state, g, r - 3, r - 2, 5, taken), k === 0, k > 0);
  });
  // gaps that can't be walled: a pillbox behind each cluster
  const gaps: Vec2[] = [];
  for (const o of plan.openings) if (!gaps.some((g) => Math.abs(g.x - o.x) + Math.abs(g.y - o.y) <= 4)) gaps.push(o);
  for (const g of gaps.slice(0, 3)) add("pillbox", insideSpot(plan, state, g, r - 3, r - 1, 4, taken), true);
  // long threat-facing wall stretches: a pillbox every ~DEF_WALL_SPACING tiles not already covered
  const main = plan.gateCenters[0] ?? plan.anchor;
  const front = plan.walls.filter((w) => Math.hypot(w.x - main.x, w.y - main.y) < 14);
  for (const w of front) {
    if (out.length >= 7) break;
    if (taken.some((t) => Math.hypot(t.x - w.x, t.y - w.y) < COMMANDER.DEF_WALL_SPACING)) continue;
    add("pillbox", insideSpot(plan, state, w, r - 3, r - 2, 3, taken), false);
  }
  // reactive heavy towers at the main gate
  const enemyComps = livingEnemies(state, pid).map((e) => composition(state, e));
  if (enemyComps.some((c) => c.heavy > COMMANDER.DEF_HEAVY_SHARE)) add("antiArmorCannon", insideSpot(plan, state, main, r - 5, r - 3, 5, taken), false);
  if (enemyComps.some((c) => c.infantry + c.ranged > COMMANDER.DEF_BLOB_SHARE)) add("missileTower", insideSpot(plan, state, main, r - 5, r - 3, 5, taken), false);
  return out;
}

/** Frozen plans keep their ring and gates; only the reactive towers follow the enemy's army mix. */
function refreshDefenses(ctx: Ctx, plan: AIBasePlan): void {
  if (ctx.state.tick - plan.plannedTick < COMMANDER.PLAN_REFRESH_TICKS) return;
  plan.plannedTick = ctx.state.tick;
  plan.plannedDefenses = defenseSpots(ctx, plan);
}

export function planStats(plan: AIBasePlan | null): PlanStats | null {
  if (!plan) return null;
  return { radius: plan.radius, ring: plan.perimeter.length, walls: plan.walls.length, gates: plan.gateCenters.length, openings: plan.openings.length, defenses: plan.plannedDefenses.length };
}

