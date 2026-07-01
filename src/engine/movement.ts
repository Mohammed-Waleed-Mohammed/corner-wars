// Generic player-issued move: navigate a unit to its commanded destination (tiles), routing
// around terrain and buildings via A* (§12). Shared by the worker and combat dispatchers.

import type { GameState, Unit } from "../core/types";
import { navigateTo } from "./navigation";

export function updateUnitMovement(state: GameState, u: Unit, dt: number, speed = u.speed): void {
  const dest = u.moveTarget;
  if (!dest) {
    if (u.state === "moving") u.state = "idle";
    return;
  }
  if (navigateTo(state, u, dest.x, dest.y, dt, 0, speed)) {
    u.moveTarget = null;
    u.path = [];
    u.state = "idle";
  } else {
    u.state = "moving";
  }
}
