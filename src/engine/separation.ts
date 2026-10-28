// Local avoidance / unit separation (§12, 15-logic §6). Overlapping units (center distance <
// sum of collision radii) are pushed apart along the line between them. Each unit's pushes from
// all its neighbours are summed and the total is clamped to a small max per frame, so a unit in
// a crowd jostles instead of being shoved half a tile per tick. Neighbor pairs come from the shared
// units-only spatial hash (rebuilt post-movement in update.ts), and pushes are obstacle-aware (no
// shoving into terrain/buildings).

import { SEPARATION } from "../config/constants";
import type { AnyEntity, GameState, Unit } from "../core/types";
import { navPassable } from "./pathfinding";
import { unitHash } from "./spatial";

const MAX_DIAMETER = 1.3; // largest collision diameter (heavy tank 0.6*2 = 1.2) + slack
const scratch: AnyEntity[] = [];
const pushes = new Map<Unit, { x: number; y: number }>(); // per-frame summed push, insertion-ordered (deterministic)

export function updateSeparation(state: GameState): void {
  pushes.clear();
  for (const u of state.entities) {
    if (u.kind !== "unit" || u.hp <= 0) continue;
    unitHash.queryInto(u.x, u.y, MAX_DIAMETER, scratch);
    for (let i = 0; i < scratch.length; i++) {
      const other = scratch[i];
      if (other.kind !== "unit" || other.id <= u.id) continue; // resolve each pair once
      resolvePair(u, other);
    }
  }
  const max = SEPARATION.maxPushPerFrame;
  for (const [u, p] of pushes) {
    const m = Math.hypot(p.x, p.y);
    const k = m > max ? max / m : 1;
    pushUnit(state, u, p.x * k, p.y * k);
  }
  walkOutOfFootprints(state);
}

let occ = new Uint8Array(0);
/** A unit standing inside a building footprint (a structure was placed on top of it) walks out to the
 *  nearest free tile at the separation rate instead of staying stuck inside the walls. */
function walkOutOfFootprints(state: GameState): void {
  const W = state.mapWidth;
  if (occ.length !== W * state.mapHeight) occ = new Uint8Array(W * state.mapHeight);
  else occ.fill(0);
  for (const b of state.entities) {
    if (b.kind !== "building" || b.hp <= 0 || b.buildingType === "gate") continue;
    for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) occ[y * W + x] = 1;
  }
  for (const u of state.entities) {
    if (u.kind !== "unit" || u.hp <= 0) continue;
    const tx = Math.floor(u.x), ty = Math.floor(u.y);
    if (tx < 0 || ty < 0 || tx >= W || ty >= state.mapHeight || !occ[ty * W + tx]) continue;
    const out = nearestFreeTile(state, u.x, u.y, tx, ty);
    if (!out) continue;
    const dx = out.x - u.x, dy = out.y - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= 1e-6) continue;
    const step = Math.min(d, SEPARATION.maxPushPerFrame);
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
  }
}

function addPush(u: Unit, dx: number, dy: number): void {
  const p = pushes.get(u);
  if (p) { p.x += dx; p.y += dy; } else pushes.set(u, { x: dx, y: dy });
}

function resolvePair(a: Unit, b: Unit): void {
  const minDist = a.collisionRadius + b.collisionRadius;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  if (dist >= minDist) return;

  if (dist === 0) {
    dx = ((a.id + b.id) % 2 === 0 ? 1 : -1) * 0.01;
    dy = 0.01;
    dist = Math.hypot(dx, dy);
  }

  const push = Math.min((minDist - dist) / 2, SEPARATION.maxPushPerFrame);
  const nx = (dx / dist) * push;
  const ny = (dy / dist) * push;
  addPush(a, -nx, -ny);
  addPush(b, nx, ny);
}

/** Centre of the free tile closest to (x, y) — the smallest ring around (tx, ty) that has one, and on
 *  that ring the nearest by distance (so a unit leaves by the closest edge, not the top-left). */
function nearestFreeTile(state: GameState, x: number, y: number, tx: number, ty: number): { x: number; y: number } | null {
  for (let r = 1; r <= 6; r++) {
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !navPassable(state, tx + dx, ty + dy)) continue;
        const cx = tx + dx + 0.5, cy = ty + dy + 0.5;
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (d < bd) { bd = d; best = { x: cx, y: cy }; }
      }
    }
    if (best) return best;
  }
  return null;
}

function pushUnit(state: GameState, u: Unit, dx: number, dy: number): void {
  const x = u.x + dx;
  const y = u.y + dy;
  if (navPassable(state, Math.floor(x), Math.floor(y))) {
    u.x = x;
    u.y = y;
  } else if (navPassable(state, Math.floor(x), Math.floor(u.y))) {
    u.x = x; // slide along one axis past the obstacle
  } else if (navPassable(state, Math.floor(u.x), Math.floor(y))) {
    u.y = y;
  }
}
