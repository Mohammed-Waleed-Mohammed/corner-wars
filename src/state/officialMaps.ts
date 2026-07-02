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

  return {
    id: s.id, name: s.name, author: "official", maxPlayers: s.maxPlayers,
    width: W, height: H, terrain: t, startPositions, goldMines,
    citadel: { x: (W - 1) / 2, y: (H - 1) / 2 }, // exact rotation centre → equal distance to every start
  };
}

// ── The five official maps ───────────────────────────────────────────────────

const DUEL = build({
  id: "duel", name: "Duel", maxPlayers: 2, width: 32, height: 32, fold: 2, border: 1,
  start: { x: 5, y: 5 }, home: { x: 9, y: 9 },
  rich: [{ x: 15, y: 10 }], // flanks the Citadel (N/S pair via 180° orbit)
  paint: (t, W, H, f) => symTiles(t, W, H, f, [{ x: 10, y: 20 }, { x: 11, y: 20 }, { x: 22, y: 9 }], "rock"), // light cover
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
});

const TRIAD = build({
  id: "triad", name: "Triad", maxPlayers: 3, width: 40, height: 40, fold: 3, border: 1,
  start: { x: 19, y: 6 }, home: { x: 19, y: 10 },
  mid: [{ x: 12, y: 14 }], rich: [{ x: 24, y: 18 }],
  paint: (t, W, H, f) => {
    // Three water wedges at 120° with land bridges (carved by the mine/start ring-back afterwards).
    symTiles(t, W, H, f, [{ x: 13, y: 24 }, { x: 14, y: 25 }, { x: 15, y: 26 }, { x: 12, y: 26 }], "water");
  },
});

const FOUR_CORNERS = build({
  id: "four_corners", name: "Four Corners", maxPlayers: 4, width: 48, height: 48, fold: 4, border: 2,
  start: { x: 6, y: 6 }, home: { x: 10, y: 10 },
  mid: [{ x: 24, y: 14 }],   // ring of 4 mid mines around the centre
  rich: [{ x: 18, y: 18 }],  // ring of 4 rich mines flanking the Citadel
  paint: (t, W, H, f) => symTiles(t, W, H, f, [{ x: 16, y: 16 }, { x: 17, y: 16 }, { x: 30, y: 12 }], "rock"), // scattered cover
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
});

const RIVERLINE = build({
  id: "riverline", name: "Riverline", maxPlayers: 2, width: 40, height: 32, fold: 2, border: 1,
  start: { x: 5, y: 15 }, home: { x: 9, y: 15 },
  mid: [{ x: 14, y: 6 }], rich: [{ x: 16, y: 15 }],
  paint: (t, _W, H) => {
    for (let y = 1; y < H - 1; y++) { set(t, 19, y, "water"); set(t, 20, y, "water"); } // the river
    rect(t, 18, 4, 21, 6, "ground");   // north bridge
    rect(t, 17, 13, 22, 18, "ground"); // centre bridge island (the Citadel)
    rect(t, 18, 25, 21, 27, "ground"); // south bridge
  },
});

const SCORCHED = build({
  id: "scorched", name: "Scorched", maxPlayers: 2, width: 32, height: 32, fold: 2, border: 1,
  start: { x: 6, y: 6 }, home: { x: 10, y: 10 },
  rich: [{ x: 15, y: 11 }], // a single contested rich pair — fewer, richer mines, almost no cover
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
    symTiles(t, W, H, f, bridge, "ground");
  },
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
});

const GOLDRUSH = build({
  id: "goldrush", name: "Goldrush", maxPlayers: 4, width: 44, height: 44, fold: 4, border: 2,
  start: { x: 7, y: 7 }, home: { x: 11, y: 11 }, homeGold: NEUTRAL_DEPOSIT_GOLD, // poor 3000 homes
  rich: [{ x: 17, y: 21 }, { x: 18, y: 18 }], // an enormous central cluster (orbit 4× each = 8 rich mines)
  paint: (t, W, H, f) => symTiles(t, W, H, f, [{ x: 14, y: 14 }, { x: 15, y: 14 }], "rock"), // token cover on the approaches
});

export const OFFICIAL_MAPS: GameMap[] = [
  DUEL, DIVIDE, SCORCHED, CROSSFIRE, RIVERLINE, // 2P (5)
  TRIAD, TRIDENT, JUNCTION,                     // 3P (3)
  FOUR_CORNERS, BASTION, QUADRANT, GOLDRUSH,    // 4P (4)
];
export const MAP_BY_ID = new Map(OFFICIAL_MAPS.map((m) => [m.id, m]));
