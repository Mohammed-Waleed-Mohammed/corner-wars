// One mover for every unit (§12): follow an A* path of waypoints toward a goal, recomputing
// only when the goal drifts (NAV.repathDist) or the cached path becomes blocked — never every
// frame. When no route exists (goal walled off), back off A* for NAV.repathCooldown and inch
// straight toward the goal WITHOUT entering impassable tiles, so a unit never freezes and never
// walks into terrain/buildings. Returns true once within `arriveDist` of the goal.

import { NAV } from "../config/constants";
import { approach } from "../core/steering";
import type { GameState, Owner, Unit } from "../core/types";
import { computePath, enemyGateAt, navPassable } from "./pathfinding";

/** Tile a unit may step onto: passable terrain/buildings AND not an enemy gate (closed to it). */
function movePassable(state: GameState, x: number, y: number, owner: Owner): boolean {
  return navPassable(state, x, y) && !enemyGateAt(state, x, y, owner);
}

export function navigateTo(
  state: GameState,
  u: Unit,
  gx: number,
  gy: number,
  dt: number,
  arriveDist: number,
  speed = u.speed,
): boolean {
  if (Math.hypot(gx - u.x, gy - u.y) <= arriveDist) {
    u.path = [];
    u.pathGoal = null;
    return true;
  }

  u.repathCooldown = Math.max(0, (u.repathCooldown ?? 0) - dt);
  const goalMoved = !u.pathGoal || Math.hypot(u.pathGoal.x - gx, u.pathGoal.y - gy) > NAV.repathDist;
  const nextBlocked =
    u.path.length > 0 && !movePassable(state, Math.floor(u.path[0].x), Math.floor(u.path[0].y), u.owner);
  if (goalMoved || nextBlocked || (u.path.length === 0 && u.repathCooldown <= 0)) {
    u.pathGoal = { x: gx, y: gy };
    u.path = computePath(state, u.x, u.y, gx, gy, u.owner); // owner-aware: own gates are passable
    if (u.path.length === 0) u.repathCooldown = NAV.repathCooldown; // no route — slow down retries
  }

  if (u.path.length > 0) {
    const wp = u.path[0];
    // Waypoints (and the smoothed segments between them) are passable, so a plain step is safe.
    if (approach(u, wp.x, wp.y, dt, NAV.waypointReach, speed)) u.path.shift();
    return false;
  }

  // No route — inch toward the goal but never commit a step into an impassable tile (incl. an
  // enemy gate, so a unit stops at a walled base's gate and aggros it instead of slipping through).
  return stepPassable(state, u, gx, gy, dt, arriveDist, speed);
}

function stepPassable(
  state: GameState, u: Unit, tx: number, ty: number, dt: number, contact: number, speed: number,
): boolean {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= contact) return true;
  const step = speed * dt;
  const t = step >= dist - contact ? (dist - contact) / dist : step / dist;
  const nx = u.x + dx * t;
  const ny = u.y + dy * t;
  if (movePassable(state, Math.floor(nx), Math.floor(ny), u.owner)) {
    u.x = nx;
    u.y = ny;
  } else if (movePassable(state, Math.floor(nx), Math.floor(u.y), u.owner)) {
    u.x = nx; // slide along the wall on one axis
  } else if (movePassable(state, Math.floor(u.x), Math.floor(ny), u.owner)) {
    u.y = ny;
  }
  return false;
}
