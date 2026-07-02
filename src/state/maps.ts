// Static map data (18 §A). A GameMap is designed data, loaded at match start — no runtime RNG.
// These two built-ins replace the old random terrain/resource generation: OPEN_MAP (all-ground, used
// by headless tests + the "open" option) and DEFAULT_MAP (a bordered four-corner map used by SP/MP
// until the official maps land in §C/M2). Both share the same starts/mines/Citadel so anything keyed
// to the classic four-corner layout keeps working; only the terrain differs.

import { BASES, CENTRAL_DEPOSIT_GOLD, GRID, HOME_MINE_GOLD, NEUTRAL_DEPOSIT_GOLD, TERRAIN_GEN } from "../config/constants";
import type { GameMap, MapTile } from "../core/types";

function groundGrid(w: number, h: number): MapTile[][] {
  return Array.from({ length: h }, () => new Array<MapTile>(w).fill("ground"));
}

/** Paint the file-14 §3 mountain border ring `b` tiles thick. */
function paintBorder(t: MapTile[][], b: number): void {
  const H = t.length;
  const W = t[0].length;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x < b || y < b || x >= W - b || y >= H - b) t[y][x] = "mountain";
    }
  }
}

/** A small `s`×`s` rock block at (x,y), only over ground (never buries a mine/start/Citadel). */
function paintRock(t: MapTile[][], x: number, y: number, s: number): void {
  for (let dy = 0; dy < s; dy++) {
    for (let dx = 0; dx < s; dx++) {
      const row = t[y + dy];
      if (row && row[x + dx] === "ground") row[x + dx] = "rock";
    }
  }
}

// Shared four-corner layout (matches config BASES + CITADEL, so existing code/tests stay valid).
const STARTS = BASES.map((b) => ({ slot: b.player, x: b.x, y: b.y }));
const MINES = [
  ...BASES.map((b) => ({ x: b.mine.x, y: b.mine.y, amount: HOME_MINE_GOLD })), // 4 home (5000)
  { x: 24, y: 15, amount: NEUTRAL_DEPOSIT_GOLD }, // 4 mid (3000), 90°-symmetric N/E/S/W of centre
  { x: 33, y: 24, amount: NEUTRAL_DEPOSIT_GOLD },
  { x: 24, y: 33, amount: NEUTRAL_DEPOSIT_GOLD },
  { x: 15, y: 24, amount: NEUTRAL_DEPOSIT_GOLD },
  { x: 19, y: 24, amount: CENTRAL_DEPOSIT_GOLD }, // 2 rich (8000) flanking the Citadel
  { x: 29, y: 24, amount: CENTRAL_DEPOSIT_GOLD },
];
const CITADEL = { x: 24, y: 24 };

export const OPEN_MAP: GameMap = {
  id: "_open",
  name: "Open Field",
  author: "official",
  maxPlayers: 4,
  width: GRID.width,
  height: GRID.height,
  terrain: groundGrid(GRID.width, GRID.height),
  startPositions: STARTS,
  goldMines: MINES,
  citadel: CITADEL,
};

function defaultTerrain(): MapTile[][] {
  const t = groundGrid(GRID.width, GRID.height);
  paintBorder(t, TERRAIN_GEN.border);
  for (const [x, y] of [[15, 15], [31, 15], [15, 31], [31, 31]] as const) paintRock(t, x, y, 2);
  return t;
}

export const DEFAULT_MAP: GameMap = {
  ...OPEN_MAP,
  id: "_default",
  name: "Four Corners",
  terrain: defaultTerrain(),
};
