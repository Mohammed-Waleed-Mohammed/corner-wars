// Official maps (18 §C): hand-designed, bundled, symmetric so every start is equally fair. The
// symmetry is ENFORCED by construction: put the Citadel at the exact rotation centre, then generate
// each player's start, mines, and terrain features as the ROTATION ORBIT of player 0's. Rotation
// preserves distance-to-centre, so all starts are exactly equidistant from the Citadel with identical
// resources and terrain shape. 90°/180° are exact square-lattice symmetries; Triad's 120° is not a
// lattice symmetry, so it uses best-effort placement (identical amounts, ~equal distances).

import { CENTRAL_DEPOSIT_GOLD, HOME_MINE_GOLD, NEUTRAL_DEPOSIT_GOLD } from "../config/constants";
import type { GameMap, MapTile } from "../core/types";

interface Pt { x: number; y: number }

function groundGrid(w: number, h: number): MapTile[][] {
  return Array.from({ length: h }, () => new Array<MapTile>(w).fill("ground"));
}
function inB(t: MapTile[][], x: number, y: number): boolean {
  return y >= 0 && y < t.length && x >= 0 && x < t[0].length;
}
function set(t: MapTile[][], x: number, y: number, tile: MapTile): void {
  if (inB(t, x, y)) t[y][x] = tile;
}
function rect(t: MapTile[][], x0: number, y0: number, x1: number, y1: number, tile: MapTile): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(t, x, y, tile);
}
function paintBorder(t: MapTile[][], b: number): void {
  const H = t.length, W = t[0].length;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < b || y < b || x >= W - b || y >= H - b) set(t, x, y, "mountain");
}

/** Rotate tile (x,y) by k·(360/fold)° around the map's true centre. Exact for fold 2 and 4.
 *  Exported: the map editor's symmetry mode (20 §H) mirrors with the SAME rotation the officials use. */
export function rot(W: number, H: number, fold: number, k: number, x: number, y: number): Pt {
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const a = (2 * Math.PI * k) / fold;
  const cos = Math.round(Math.cos(a) * 1e6) / 1e6, sin = Math.round(Math.sin(a) * 1e6) / 1e6;
  return { x: Math.round(cx + (x - cx) * cos - (y - cy) * sin), y: Math.round(cy + (x - cx) * sin + (y - cy) * cos) };
}
/** All rotation images of a point (the symmetry orbit). */
function orbit(W: number, H: number, fold: number, p: Pt): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < fold; k++) out.push(rot(W, H, fold, k, p.x, p.y));
  return out;
}
/** Paint each tile of `shape` and all its rotations (keeps terrain symmetric). */
function symTiles(t: MapTile[][], W: number, H: number, fold: number, shape: Pt[], tile: MapTile): void {
  for (const p of shape) for (const q of orbit(W, H, fold, p)) set(t, q.x, q.y, tile);
}

/** A natural feature in player-0's region, in BASE (pre-scale) tile coordinates; `r` = radius in base tiles. */
interface Feat { x: number; y: number; r: number }

interface MapSpec {
  id: string;
  name: string;
  maxPlayers: 2 | 3 | 4;
  width: number;
  height: number;
  fold: 2 | 3 | 4;
  border: number;
  /** player-0 features (top-left region); the rest are generated as rotation orbits. */
  start: Pt;
  home: Pt;      // home mine (HOME_MINE_GOLD, or homeGold override)
  homeGold?: number; // override the home-mine amount (20 §F Goldrush = poor 3000 homes)
  mid?: Pt[];    // neutral mid mines (NEUTRAL_DEPOSIT_GOLD)
  rich?: Pt[];   // rich mines (CENTRAL_DEPOSIT_GOLD)
  paint?: (t: MapTile[][], W: number, H: number, fold: number) => void; // characteristic terrain
  /** 24 §C natural features, painted at FULL resolution after scaling with organic (noise) edges and
   *  rotated to every player: forests, lakes (deep water + a wadeable shallows ring), hills, boulders,
   *  and an auto-routed road from player 0's base to the Citadel. */
  nature?: { seed: number; forests?: Feat[]; lakes?: Feat[]; hills?: Feat[]; rocks?: Pt[]; road?: boolean };
}

// User directive (2026-07-02): official maps are much bigger — every map is upscaled by an integer
// factor at build time (area ×MAP_SCALE² ≥ 5× the originals). Nearest-neighbor tile expansion; point
// features map to the CENTER of their scaled block (x → x·K + (K−1)/2), which keeps the Citadel at
// the exact rotation centre ((W·K−1)/2) and preserves every equidistance/symmetry guarantee.
const MAP_SCALE = 3;

function scaleMap(m: GameMap, K: number): GameMap {
  if (K <= 1) return m;
  const off = (K - 1) / 2;
  const terrain: MapTile[][] = [];
  for (let y = 0; y < m.height; y++) {
    const rows: MapTile[] = [];
    for (let x = 0; x < m.width; x++) for (let k = 0; k < K; k++) rows.push(m.terrain[y][x]);
    for (let k = 0; k < K; k++) terrain.push(rows.slice());
  }
  const pt = (v: number): number => v * K + off;
  return {
    ...m,
    width: m.width * K,
    height: m.height * K,
    terrain,
    startPositions: m.startPositions.map((s) => ({ slot: s.slot, x: pt(s.x), y: pt(s.y) })),
    goldMines: m.goldMines.map((g) => ({ x: pt(g.x), y: pt(g.y), amount: g.amount })),
    citadel: m.citadel ? { x: pt(m.citadel.x), y: pt(m.citadel.y) } : null,
  };
}

function build(s: MapSpec): GameMap {
  const { width: W, height: H, fold } = s;
  const t = groundGrid(W, H);
  paintBorder(t, s.border);
  s.paint?.(t, W, H, fold);

  const startPositions = orbit(W, H, fold, s.start).map((p, i) => ({ slot: i, x: p.x, y: p.y }));
  const goldMines = [
    ...orbit(W, H, fold, s.home).map((p) => ({ x: p.x, y: p.y, amount: s.homeGold ?? HOME_MINE_GOLD })),
    ...(s.mid ?? []).flatMap((m) => orbit(W, H, fold, m)).map((p) => ({ x: p.x, y: p.y, amount: NEUTRAL_DEPOSIT_GOLD })),
    ...(s.rich ?? []).flatMap((m) => orbit(W, H, fold, m)).map((p) => ({ x: p.x, y: p.y, amount: CENTRAL_DEPOSIT_GOLD })),
  ];
  // Never bury a mine or a start under a feature — carve those tiles (and a small ring) back to ground.
  for (const g of goldMines) rect(t, g.x - 1, g.y - 1, g.x + 1, g.y + 1, "ground");
  for (const p of startPositions) rect(t, p.x - 1, p.y - 1, p.x + 4, p.y + 4, "ground");

  const scaled = scaleMap({
    id: s.id, name: s.name, author: "official", maxPlayers: s.maxPlayers,
    width: W, height: H, terrain: t, startPositions, goldMines,
    citadel: { x: (W - 1) / 2, y: (H - 1) / 2 }, // exact rotation centre → equal distance to every start
  }, MAP_SCALE);
  if (s.nature) naturalize(scaled, s, s.nature);
  return scaled;
}

// ── 24 §C natural features at full resolution ───────────────────────────────────────────────────
// Determinism: shapes use ONLY integer hashing (Math.imul) and + − × / arithmetic — no Math.random,
// no trig/atan2/hypot (not guaranteed bit-identical across JS engines) — so every peer builds the
// same map. Symmetry: each feature's tiles are computed once in player 0's region (noise sampled at
// player 0's coordinates) and stamped at every rotation image via rot(), so the shapes are identical.

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0,1): random values on a `cell`-tile lattice, smoothstep-interpolated. */
function vnoise(x: number, y: number, seed: number, cell: number): number {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  let fx = (x - gx * cell) / cell, fy = (y - gy * cell) / cell;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy, seed), b = hash2(gx + 1, gy, seed), c = hash2(gx, gy + 1, seed), d = hash2(gx + 1, gy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Tiles of an organic blob centred (cx,cy) with mean radius R (full-res tiles). */
function blobTiles(cx: number, cy: number, R: number, seed: number): Pt[] {
  const out: Pt[] = [];
  const M = Math.ceil(R * 1.35) + 1;
  for (let y = Math.floor(cy) - M; y <= Math.ceil(cy) + M; y++) {
    for (let x = Math.floor(cx) - M; x <= Math.ceil(cx) + M; x++) {
      const k = R * (0.72 + 0.56 * vnoise(x, y, seed, 4));
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= k * k) out.push({ x, y });
    }
  }
  return out;
}
/** Stamp player-0 tiles at every rotation image, only over tiles `canPaint` accepts. */
function stamp(t: MapTile[][], W: number, H: number, fold: number, tiles: Pt[], tile: MapTile | ((cur: MapTile) => MapTile | null), canPaint: (cur: MapTile) => boolean): void {
  for (const p of tiles) {
    for (const q of orbit(W, H, fold, p)) {
      if (!inB(t, q.x, q.y)) continue;
      const cur = t[q.y][q.x];
      if (!canPaint(cur)) continue;
      const next = typeof tile === "function" ? tile(cur) : tile;
      if (next) t[q.y][q.x] = next;
    }
  }
}

const SOFT: ReadonlySet<MapTile> = new Set<MapTile>(["ground", "hill", "forest"]); // nature may repaint these

function naturalize(m: GameMap, s: MapSpec, n: NonNullable<MapSpec["nature"]>): void {
  const K = MAP_SCALE, off = (K - 1) / 2;
  const W = m.width, H = m.height, fold = s.fold, t = m.terrain;
  const P = (b: Feat): { x: number; y: number; R: number } => ({ x: b.x * K + off, y: b.y * K + off, R: b.r * K });
  let salt = n.seed * 7919;
  const nextSeed = (): number => (salt = (Math.imul(salt, 1103515245) + 12345) | 0);

  for (const h of n.hills ?? []) { const c = P(h); stamp(t, W, H, fold, blobTiles(c.x, c.y, c.R, nextSeed()), "hill", (cur) => cur === "ground"); }
  for (const f of n.forests ?? []) { const c = P(f); stamp(t, W, H, fold, blobTiles(c.x, c.y, c.R, nextSeed()), "forest", (cur) => cur === "ground"); }
  for (const l of n.lakes ?? []) {
    const c = P(l), sd = nextSeed();
    stamp(t, W, H, fold, blobTiles(c.x, c.y, c.R + 2.5, sd), "shallows", (cur) => SOFT.has(cur)); // the wadeable ring
    stamp(t, W, H, fold, blobTiles(c.x, c.y, c.R, sd), "water", (cur) => SOFT.has(cur) || cur === "shallows");
  }
  for (const r of n.rocks ?? []) { const c = P({ ...r, r: 0.5 }); stamp(t, W, H, fold, blobTiles(c.x, c.y, 1.3, nextSeed()), "rock", (cur) => cur === "ground"); }

  // Keep every base, mine and the Citadel buildable and open (bases get a generous clearing).
  const clear = (cx: number, cy: number, r: number): void => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        // Roads are buildable, so clearings keep them (a road should run right into the base/Citadel).
        if (inB(t, x, y) && dx * dx + dy * dy <= r * r && t[y][x] !== "mountain" && t[y][x] !== "void" && t[y][x] !== "bridge" && t[y][x] !== "road") t[y][x] = "ground";
      }
    }
  };
  if (n.road) paintRoad(t, W, H, fold, m);
  for (const p of m.startPositions) clear(p.x + 1, p.y + 1, 9);
  for (const g of m.goldMines) clear(g.x, g.y, 3);
  if (m.citadel) clear(m.citadel.x, m.citadel.y, 5);
}

/** 24 §C road: cheapest walkable route (4-neighbour Dijkstra preferring open ground) from player 0's
 *  base to the Citadel, widened to 2 tiles and rotated to every player. Bridges stay bridges. */
function paintRoad(t: MapTile[][], W: number, H: number, fold: number, m: GameMap): void {
  if (!m.citadel) return;
  const COST: Partial<Record<MapTile, number>> = { ground: 1, road: 1, bridge: 1, hill: 1.6, forest: 2.2, shallows: 4 };
  const s0 = m.startPositions.find((p) => p.slot === 0) ?? m.startPositions[0];
  const sx = Math.round(s0.x + 1), sy = Math.round(s0.y + 1);
  const gx = Math.round(m.citadel.x), gy = Math.round(m.citadel.y);
  const N = W * H, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const heap: [number, number][] = []; // tiny binary heap of [cost, index]
  const push = (c: number, i: number): void => {
    heap.push([c, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] < heap[k][0] || (heap[p][0] === heap[k][0] && heap[p][1] <= heap[k][1])) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = (): [number, number] => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let b = k;
        const less = (a: number, c: number): boolean => heap[a][0] < heap[c][0] || (heap[a][0] === heap[c][0] && heap[a][1] < heap[c][1]);
        if (l < heap.length && less(l, b)) b = l;
        if (r < heap.length && less(r, b)) b = r;
        if (b === k) break;
        [heap[b], heap[k]] = [heap[k], heap[b]]; k = b;
      }
    }
    return top;
  };
  const start = sy * W + sx, goal = gy * W + gx;
  dist[start] = 0; push(0, start);
  while (heap.length) {
    const [c, i] = pop();
    if (c > dist[i]) continue;
    if (i === goal) break;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (!inB(t, nx, ny)) continue;
      const w = COST[t[ny][nx]];
      if (w === undefined) continue;
      const ni = ny * W + nx, nc = c + w;
      if (nc < dist[ni]) { dist[ni] = nc; prev[ni] = i; push(nc, ni); }
    }
  }
  if (prev[goal] === -1) return; // unreachable — no road (validation will flag the map anyway)
  const path: Pt[] = [];
  for (let i = goal; i !== -1; i = prev[i]) path.push({ x: i % W, y: (i / W) | 0 });
  const wide: Pt[] = [];
  for (const p of path) wide.push(p, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y + 1 });
  stamp(t, W, H, fold, wide, "road", (cur) => cur === "ground" || cur === "forest" || cur === "hill" || cur === "shallows");
}

// ── The five official maps ───────────────────────────────────────────────────

const DUEL = build({
  id: "duel", name: "Duel", maxPlayers: 2, width: 32, height: 32, fold: 2, border: 1,
  start: { x: 5, y: 5 }, home: { x: 9, y: 9 },
  rich: [{ x: 15, y: 10 }], // flanks the Citadel (N/S pair via 180° orbit)
  paint: (t, W, H, f) => symTiles(t, W, H, f, [{ x: 10, y: 20 }, { x: 11, y: 20 }, { x: 22, y: 9 }], "rock"), // light cover
  nature: { seed: 11, forests: [{ x: 4, y: 15, r: 2.3 }, { x: 14, y: 4, r: 2 }, { x: 9, y: 23, r: 1.8 }], lakes: [{ x: 24, y: 5, r: 1.6 }], hills: [{ x: 11, y: 13, r: 1.3 }, { x: 19, y: 12, r: 1.1 }], rocks: [{ x: 3, y: 22 }, { x: 20, y: 3 }], road: true },
});

const DIVIDE = build({
  id: "divide", name: "Divide", maxPlayers: 2, width: 40, height: 32, fold: 2, border: 1,
  start: { x: 5, y: 15 }, home: { x: 9, y: 15 },
  mid: [{ x: 17, y: 7 }], // by the chokes (pair via 180°)
  paint: (t, _W, H) => {
    // Central mountain ridge (x=19,20) with two 2-tile chokes and a central gap for the Citadel.
    for (let y = 2; y < H - 2; y++) { set(t, 19, y, "mountain"); set(t, 20, y, "mountain"); }
    rect(t, 19, 6, 20, 8, "ground");   // north choke
    rect(t, 19, 23, 20, 25, "ground"); // south choke
    rect(t, 18, 14, 21, 17, "ground"); // central gap around the Citadel
  },
  nature: { seed: 12, forests: [{ x: 9, y: 6, r: 2.4 }, { x: 10, y: 25, r: 2.4 }, { x: 15, y: 11, r: 1.4 }], lakes: [{ x: 3, y: 26, r: 1.5 }], hills: [{ x: 15, y: 18, r: 1.3 }, { x: 15, y: 4, r: 1.1 }], rocks: [{ x: 12, y: 20 }, { x: 6, y: 4 }], road: true },
});

const TRIAD = build({
  id: "triad", name: "Triad", maxPlayers: 3, width: 40, height: 40, fold: 3, border: 1,
  start: { x: 19, y: 6 }, home: { x: 19, y: 10 },
  mid: [{ x: 12, y: 14 }], rich: [{ x: 24, y: 18 }],
  paint: (t, W, H, f) => {
    // Three water wedges at 120° with land bridges (carved by the mine/start ring-back afterwards).
    symTiles(t, W, H, f, [{ x: 13, y: 24 }, { x: 14, y: 25 }, { x: 15, y: 26 }, { x: 12, y: 26 }], "water");
  },
  nature: { seed: 13, forests: [{ x: 11, y: 7, r: 2 }, { x: 28, y: 8, r: 2 }], hills: [{ x: 19, y: 14, r: 1.2 }], rocks: [{ x: 24, y: 4 }], road: true },
});

const FOUR_CORNERS = build({
  id: "four_corners", name: "Four Corners", maxPlayers: 4, width: 48, height: 48, fold: 4, border: 2,
  start: { x: 6, y: 6 }, home: { x: 10, y: 10 },
  mid: [{ x: 24, y: 14 }],   // ring of 4 mid mines around the centre
  rich: [{ x: 18, y: 18 }],  // ring of 4 rich mines flanking the Citadel
  paint: (t, W, H, f) => symTiles(t, W, H, f, [{ x: 16, y: 16 }, { x: 17, y: 16 }, { x: 30, y: 12 }], "rock"), // scattered cover
  nature: { seed: 14, forests: [{ x: 5, y: 17, r: 2.5 }, { x: 17, y: 5, r: 2.5 }, { x: 11, y: 22, r: 1.8 }], lakes: [{ x: 21, y: 8, r: 1.8 }], hills: [{ x: 14, y: 13, r: 1.6 }], rocks: [{ x: 9, y: 18 }, { x: 18, y: 9 }], road: true },
});

const BASTION = build({
  id: "bastion", name: "Bastion", maxPlayers: 4, width: 48, height: 48, fold: 4, border: 2,
  start: { x: 6, y: 6 }, home: { x: 10, y: 8 },
  rich: [{ x: 20, y: 20 }], // contested centre (ring of 4)
  paint: (t, W, H, f) => {
    // Each base in a mountain-walled alcove with one choke exit (walls + orbit them 4×).
    const wall: Pt[] = [];
    for (let x = 2; x <= 13; x++) wall.push({ x, y: 13 });   // south wall of the NW alcove...
    for (let y = 2; y <= 13; y++) wall.push({ x: 13, y });   // ...and its east wall
    symTiles(t, W, H, f, wall, "mountain");
    symTiles(t, W, H, f, [{ x: 9, y: 13 }, { x: 10, y: 13 }], "ground"); // the choke exit
  },
  nature: { seed: 15, forests: [{ x: 17, y: 7, r: 2.4 }, { x: 7, y: 18, r: 2 }], lakes: [{ x: 18, y: 16, r: 1.6 }], hills: [{ x: 11, y: 16, r: 1.3 }], rocks: [{ x: 20, y: 4 }], road: true },
});

// ── Expanded pool (20 §F): 7 more maps, symmetry-enforced + connectivity-validated ──────────────

/** Water annulus at [rIn,rOut] from the map centre (rotationally symmetric by construction). */
function ringWater(t: MapTile[][], W: number, H: number, rIn: number, rOut: number): void {
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d >= rIn && d <= rOut) set(t, x, y, "water");
  }
}
/** Carve a ground disc of radius r at the centre (the Citadel island). */
function carveCenter(t: MapTile[][], W: number, H: number, r: number): void {
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - cx, y - cy) <= r) set(t, x, y, "ground");
}

const CROSSFIRE = build({
  id: "crossfire", name: "Crossfire", maxPlayers: 2, width: 36, height: 36, fold: 2, border: 1,
  start: { x: 6, y: 6 }, home: { x: 11, y: 11 },
  mid: [{ x: 17, y: 9 }], rich: [{ x: 12, y: 17 }], // a lane mine + a Citadel-flanking rich pair
  // Rock cover clustered where the two diagonal lanes cross the centre — flanky, scout-friendly.
  paint: (t, W, H, f) => symTiles(t, W, H, f, [{ x: 13, y: 13 }, { x: 14, y: 13 }, { x: 13, y: 14 }, { x: 21, y: 14 }], "rock"),
  nature: { seed: 16, forests: [{ x: 4, y: 16, r: 2.3 }, { x: 16, y: 4, r: 2 }, { x: 7, y: 27, r: 2 }], lakes: [{ x: 27, y: 5, r: 1.6 }], hills: [{ x: 20, y: 11, r: 1.2 }], rocks: [{ x: 9, y: 21 }], road: true },
});

const RIVERLINE = build({
  id: "riverline", name: "Riverline", maxPlayers: 2, width: 40, height: 32, fold: 2, border: 1,
  start: { x: 5, y: 15 }, home: { x: 9, y: 15 },
  mid: [{ x: 14, y: 6 }], rich: [{ x: 16, y: 15 }],
  paint: (t, _W, H) => {
    for (let y = 1; y < H - 1; y++) { set(t, 19, y, "water"); set(t, 20, y, "water"); } // the river
    rect(t, 18, 4, 21, 6, "ground");   // north crossing…
    rect(t, 19, 4, 20, 6, "bridge");   // …a real bridge over the river (24 §C)
    rect(t, 17, 13, 22, 18, "ground"); // centre bridge island (the Citadel)
    rect(t, 18, 25, 21, 27, "ground"); // south crossing…
    rect(t, 19, 25, 20, 27, "bridge"); // …a real bridge
  },
  nature: { seed: 17, forests: [{ x: 10, y: 6, r: 2.4 }, { x: 11, y: 25, r: 2.4 }, { x: 4, y: 27, r: 1.5 }], hills: [{ x: 14, y: 11, r: 1.3 }, { x: 14, y: 20, r: 1.3 }], rocks: [{ x: 7, y: 3 }], road: true },
});

const SCORCHED = build({
  id: "scorched", name: "Scorched", maxPlayers: 2, width: 32, height: 32, fold: 2, border: 1,
  start: { x: 6, y: 6 }, home: { x: 10, y: 10 },
  rich: [{ x: 15, y: 11 }], // a single contested rich pair — fewer, richer mines, almost no cover
  nature: { seed: 18, hills: [{ x: 12, y: 15, r: 1.3 }], rocks: [{ x: 9, y: 17 }, { x: 18, y: 6 }, { x: 4, y: 24 }], road: true }, // stays barren
});

const TRIDENT = build({
  id: "trident", name: "Trident", maxPlayers: 3, width: 42, height: 42, fold: 3, border: 1,
  start: { x: 20, y: 6 }, home: { x: 20, y: 10 },
  mid: [{ x: 20, y: 15 }], rich: [{ x: 20, y: 24 }],
  paint: (t, W, H, f) => {
    ringWater(t, W, H, 7, 9);              // sea ring around the centre
    carveCenter(t, W, H, 5);               // Citadel island
    // One 3-wide land bridge per peninsula (orbit player-0's northern bridge 3×).
    const bridge: Pt[] = [];
    for (let y = 9; y <= 16; y++) for (let x = 19; x <= 21; x++) bridge.push({ x, y });
    // 24 §C: where the causeway crosses the sea it's a real bridge; on land it stays ground.
    for (const p of bridge) for (const q of orbit(W, H, f, p)) if (inB(t, q.x, q.y)) t[q.y][q.x] = t[q.y][q.x] === "water" ? "bridge" : "ground";
  },
  nature: { seed: 19, forests: [{ x: 12, y: 8, r: 2 }, { x: 29, y: 8, r: 2 }], hills: [{ x: 15, y: 12, r: 1.1 }], rocks: [{ x: 26, y: 4 }], road: true },
});

const JUNCTION = build({
  id: "junction", name: "Junction", maxPlayers: 3, width: 40, height: 40, fold: 3, border: 1,
  start: { x: 20, y: 6 }, home: { x: 20, y: 10 },
  mid: [{ x: 27, y: 16 }], // one contested mine per player-pair boundary (orbit 3×)
  paint: (t, W, H, f) => {
    // Three partial Y-ridges reaching out between adjacent players (they don't touch centre or border,
    // so units flow around — friction, not walls).
    const ridge: Pt[] = [];
    for (let i = 0; i < 6; i++) ridge.push({ x: 23 + i, y: 17 - i }, { x: 24 + i, y: 17 - i });
    symTiles(t, W, H, f, ridge, "mountain");
  },
  nature: { seed: 20, forests: [{ x: 13, y: 9, r: 2 }, { x: 28, y: 7, r: 1.8 }], lakes: [{ x: 12, y: 16, r: 1.4 }], hills: [{ x: 20, y: 14, r: 1.2 }], road: true },
});

const QUADRANT = build({
  id: "quadrant", name: "Quadrant", maxPlayers: 4, width: 48, height: 48, fold: 4, border: 2,
  start: { x: 7, y: 7 }, home: { x: 12, y: 12 },
  rich: [{ x: 20, y: 20 }], // contested centre ring
  paint: (t, W, H, f) => {
    for (let y = 2; y < H - 2; y++) { set(t, 23, y, "mountain"); set(t, 24, y, "mountain"); } // vertical wall
    for (let x = 2; x < W - 2; x++) { set(t, x, 23, "mountain"); set(t, x, 24, "mountain"); } // horizontal wall
    rect(t, 20, 20, 27, 27, "ground"); // central opening (one gap toward centre for every quadrant)
    symTiles(t, W, H, f, [{ x: 23, y: 9 }, { x: 24, y: 9 }, { x: 23, y: 10 }, { x: 24, y: 10 }], "ground"); // neighbor gaps (orbit 4×)
  },
  nature: { seed: 21, forests: [{ x: 6, y: 17, r: 2.4 }, { x: 16, y: 6, r: 2 }], lakes: [{ x: 17, y: 15, r: 1.5 }], hills: [{ x: 18, y: 11, r: 1.2 }], rocks: [{ x: 4, y: 12 }], road: true },
});

const GOLDRUSH = build({
  id: "goldrush", name: "Goldrush", maxPlayers: 4, width: 44, height: 44, fold: 4, border: 2,
  start: { x: 7, y: 7 }, home: { x: 11, y: 11 }, homeGold: NEUTRAL_DEPOSIT_GOLD, // poor 3000 homes
  rich: [{ x: 17, y: 21 }, { x: 18, y: 18 }], // an enormous central cluster (orbit 4× each = 8 rich mines)
  paint: (t, W, H, f) => symTiles(t, W, H, f, [{ x: 14, y: 14 }, { x: 15, y: 14 }], "rock"), // token cover on the approaches
  nature: { seed: 22, forests: [{ x: 5, y: 16, r: 2.3 }, { x: 16, y: 5, r: 2.3 }], lakes: [{ x: 9, y: 21, r: 1.5 }], hills: [{ x: 21, y: 12, r: 1.2 }], road: true },
});

export const OFFICIAL_MAPS: GameMap[] = [
  DUEL, DIVIDE, SCORCHED, CROSSFIRE, RIVERLINE, // 2P (5)
  TRIAD, TRIDENT, JUNCTION,                     // 3P (3)
  FOUR_CORNERS, BASTION, QUADRANT, GOLDRUSH,    // 4P (4)
];
export const MAP_BY_ID = new Map(OFFICIAL_MAPS.map((m) => [m.id, m]));
