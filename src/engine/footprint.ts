// Reaching a building's side (16 §2): builders, repairers and workers delivering gold walk to a
// free tile next to the footprint instead of toward its centre. Steering at the centre sent every
// worker to the first free tile A* found scanning from the top-left — often the far side, or a tile
// boxed in by a cliff — and a worker that stopped short of the centre-based contact radius stood
// "moving" forever. The stand tile is the nearest reachable free tile on the footprint's ring,
// spread across workers on the same building. Arrival is measured to the footprint's EDGE, so
// rectangular buildings and corner tiles work too.

import { FOOTPRINT } from "../config/constants";
import type { Building, GameState, Unit, Vec2 } from "../core/types";
import { moveClassOf } from "../state/terrain";
import { movePassable, navigateTo } from "./navigation";
import { computePath } from "./pathfinding";

/** Distance from (x, y) to the nearest point of a building's footprint (0 inside it). */
export function footprintDist(b: Building, x: number, y: number): number {
  const dx = Math.max(b.x - x, 0, x - (b.x + b.width));
  const dy = Math.max(b.y - y, 0, y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/** Is this worker close enough to work on (or deliver to) the building? `margin` absorbs separation
 *  jostle for a worker already parked there. */
export function atFootprint(w: Unit, b: Building, margin = 0): boolean {
  return footprintDist(b, w.x, w.y) <= FOOTPRINT.REACH + margin;
}

/** Walk a worker to a free side of `b`. Returns true once it is within reach of the footprint. */
export function goToFootprint(state: GameState, w: Unit, b: Building, dt: number, parked: boolean): boolean {
  const here = movePassable(state, Math.floor(w.x), Math.floor(w.y), w.owner);
  // Already beside it (on a free tile) — work from here; a parked worker keeps a little slack.
  if (here && atFootprint(w, b, parked ? FOOTPRINT.PARKED_SLACK : 0)) {
    w.path = [];
    w.pathGoal = null;
    return true;
  }
  let spot = w.standFor === b.id ? w.standSpot ?? null : null;
  if (!spot || !movePassable(state, Math.floor(spot.x), Math.floor(spot.y), w.owner)) {
    spot = pickStandSpot(state, w, b);
    w.standSpot = spot;
    w.standFor = b.id;
  }
  if (!spot) {
    // Every side tile is blocked (walled in): fall back to the old centre approach.
    const contact = Math.max(b.width, b.height) / 2 + FOOTPRINT.REACH;
    return navigateTo(state, w, b.x + b.width / 2, b.y + b.height / 2, dt, contact);
  }
  navigateTo(state, w, spot.x, spot.y, dt, FOOTPRINT.SPOT_ARRIVE);
  return movePassable(state, Math.floor(w.x), Math.floor(w.y), w.owner) && atFootprint(w, b);
}

/** The free ring tile (side or corner) nearest the worker, avoiding tiles other workers already
 *  claimed on this building, that the worker can actually reach. Primes the worker's A* path. */
function pickStandSpot(state: GameState, w: Unit, b: Building): Vec2 | null {
  const cands: { x: number; y: number; score: number }[] = [];
  for (let y = b.y - 1; y <= b.y + b.height; y++) {
    for (let x = b.x - 1; x <= b.x + b.width; x++) {
      const inside = x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
      if (inside || !movePassable(state, x, y, w.owner)) continue;
      let claimed = 0;
      for (const o of state.entities) {
        if (o === w || o.kind !== "unit" || o.hp <= 0 || o.owner !== w.owner || o.standFor !== b.id || !o.standSpot) continue;
        if (Math.floor(o.standSpot.x) === x && Math.floor(o.standSpot.y) === y) claimed++;
      }
      const cx = x + 0.5, cy = y + 0.5;
      cands.push({ x: cx, y: cy, score: Math.hypot(cx - w.x, cy - w.y) + claimed * FOOTPRINT.CLAIMED_PENALTY });
    }
  }
  cands.sort((a, c) => a.score - c.score); // stable: ties keep scan order (deterministic)
  for (let i = 0; i < Math.min(FOOTPRINT.MAX_TRIES, cands.length); i++) {
    const c = cands[i];
    if (Math.floor(w.x) === Math.floor(c.x) && Math.floor(w.y) === Math.floor(c.y)) return { x: c.x, y: c.y };
    const path = computePath(state, w.x, w.y, c.x, c.y, w.owner, moveClassOf(w));
    const end = path[path.length - 1];
    if (end && Math.floor(end.x) === Math.floor(c.x) && Math.floor(end.y) === Math.floor(c.y)) {
      w.path = path; // reuse this route: navigateTo keeps it while the goal stays put
      w.pathGoal = { x: c.x, y: c.y };
      return { x: c.x, y: c.y };
    }
  }
  return cands.length ? { x: cands[0].x, y: cands[0].y } : null; // none verified: try the nearest anyway
}
