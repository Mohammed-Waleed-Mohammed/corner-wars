// Local avoidance / unit separation (§12, 15-logic §6). Overlapping units (center distance <
// sum of collision radii) are pushed apart along the line between them, clamped to a small max
// per frame so it reads as jostling. Neighbor pairs come from the shared units-only spatial
// hash (rebuilt post-movement in update.ts), and pushes are obstacle-aware (no shoving into
// terrain/buildings).

import { SEPARATION } from "../config/constants";
import type { AnyEntity, GameState, Unit } from "../core/types";
import { navPassable } from "./pathfinding";
import { unitHash } from "./spatial";

const MAX_DIAMETER = 1.3; // largest collision diameter (heavy tank 0.6*2 = 1.2) + slack
const scratch: AnyEntity[] = [];

export function updateSeparation(state: GameState): void {
  for (const u of state.entities) {
    if (u.kind !== "unit" || u.hp <= 0) continue;
    unitHash.queryInto(u.x, u.y, MAX_DIAMETER, scratch);
    for (let i = 0; i < scratch.length; i++) {
      const other = scratch[i];
      if (other.kind !== "unit" || other.id <= u.id) continue; // resolve each pair once
      resolvePair(state, u, other);
    }
  }
}

function resolvePair(state: GameState, a: Unit, b: Unit): void {
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
  pushUnit(state, a, -nx, -ny);
  pushUnit(state, b, nx, ny);
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
