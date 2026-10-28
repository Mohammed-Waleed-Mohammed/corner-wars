// One mover for every unit (§12): follow an A* path of waypoints toward a goal, recomputing
// only when the goal drifts (NAV.repathDist) or the cached path becomes blocked — never every
// frame. When no route exists (goal walled off), back off A* for NAV.repathCooldown and inch
// straight toward the goal WITHOUT entering impassable tiles, so a unit never freezes and never
// walks into terrain/buildings. Every step that crosses into a new tile is checked (separation can
// push a unit off its straight line to the next waypoint, and that line may then clip a corner).
// Returns true once within `arriveDist` of the goal.

import { NAV } from "../config/constants";
import { approach } from "../core/steering";
import type { GameState, Owner, Unit } from "../core/types";
import { moveClassOf, terrainSpeedMult } from "../state/terrain";
import { computePath, enemyGateAt, navPassable, pathStats } from "./pathfinding";

/** Tile a unit may step onto: passable terrain/buildings AND not an enemy gate (closed to it). */
export function movePassable(state: GameState, x: number, y: number, owner: Owner): boolean {
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
  // 24 §B: terrain under the unit scales its speed for its movement class (road fast, forest/ford slow).
  speed *= terrainSpeedMult(state, u);

  u.repathCooldown = Math.max(0, (u.repathCooldown ?? 0) - dt);
  const goalMoved = !u.pathGoal || Math.hypot(u.pathGoal.x - gx, u.pathGoal.y - gy) > NAV.repathDist;
  const nextBlocked =
    u.path.length > 0 && !movePassable(state, Math.floor(u.path[0].x), Math.floor(u.path[0].y), u.owner);
  if (goalMoved || nextBlocked || (u.path.length === 0 && u.repathCooldown <= 0)) {
    if (state.navBudget === undefined || state.navBudget > 0) {
      u.pathGoal = { x: gx, y: gy };
      // owner-aware (own gates are passable) + class-weighted terrain costs (24 §B)
      u.path = computePath(state, u.x, u.y, gx, gy, u.owner, moveClassOf(u));
      if (state.navBudget !== undefined) state.navBudget -= Math.max(1, pathStats.expansions);
      if (u.path.length === 0) u.repathCooldown = NAV.repathCooldown; // no route — slow down retries
    } else if (nextBlocked || u.path.length === 0) {
      // This tick's A* budget is spent and there's no walkable route in hand: wait a tick rather
      // than guess a straight line (a mass order spreads over a few ticks instead of one long frame).
      if (nextBlocked) u.path = [];
      return false;
    } // else the goal drifted but the old route is still walkable: keep following it this tick
  }

  if (u.path.length > 0) {
    const wp = u.path[0];
    const ox = u.x, oy = u.y;
    const reached = approach(u, wp.x, wp.y, dt, NAV.waypointReach, speed);
    if (!canStep(state, u, ox, oy, u.x, u.y)) {
      // Pushed off the planned line: the straight step would clip a cliff or building corner. Slide
      // on one axis if that is clear, else stay put and re-plan from here next tick.
      const nx = u.x, ny = u.y;
      u.x = ox; u.y = oy;
      if (canStep(state, u, ox, oy, nx, oy)) u.x = nx;
      else if (canStep(state, u, ox, oy, ox, ny)) u.y = ny;
      else { u.path = []; u.pathGoal = null; }
      return false;
    }
    if (reached) u.path.shift();
    return false;
  }

  // The goal tile is blocked (a building went up on it) and we stand right beside it: this is as
  // close as it gets — arrive, instead of pressing against the wall forever.
  const gtx = Math.floor(gx), gty = Math.floor(gy);
  const ux = Math.floor(u.x), uy = Math.floor(u.y);
  if (Math.max(Math.abs(ux - gtx), Math.abs(uy - gty)) <= 1 && !movePassable(state, gtx, gty, u.owner) &&
      movePassable(state, ux, uy, u.owner)) {
    u.pathGoal = null;
    return true;
  }
  // No route — inch toward the goal but never commit a step into an impassable tile (incl. an
  // enemy gate, so a unit stops at a walled base's gate and aggros it instead of slipping through).
  return stepPassable(state, u, gx, gy, dt, arriveDist, speed);
}

/** May a unit step from (ox,oy) to (nx,ny)? Only checked when the step enters a new tile: that tile
 *  must be passable and, on a diagonal, both side tiles too (no corner cutting). A unit already
 *  standing on a blocked tile (a building was placed on it) may always move, so it can walk out. */
function canStep(state: GameState, u: Unit, ox: number, oy: number, nx: number, ny: number): boolean {
  const ax = Math.floor(ox), ay = Math.floor(oy), bx = Math.floor(nx), by = Math.floor(ny);
  if (ax === bx && ay === by) return true;
  if (!movePassable(state, ax, ay, u.owner)) return true;
  if (!movePassable(state, bx, by, u.owner)) return false;
  if (ax !== bx && ay !== by) return movePassable(state, bx, ay, u.owner) && movePassable(state, ax, by, u.owner);
  return true;
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
