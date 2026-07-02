// Formation runtime (19). Per-tick behavior for units that belong to a formation. M2 scope: a formed
// unit paths to its slot (anchor + rotated offset) and holds there — the shape "stands". Medics also
// heal from their slot. Movement of the whole shape along a path, cohesion (slowest-member speed),
// facing from orders, engagement discipline, and traits arrive in M4/M6. Deaths are pruned once per
// tick by pruneFormations (survivors keep their slot — deaths leave holes, §I).

import { FORMATIONS, NAV } from "../config/constants";
import type { Formation, GameState, PlayerId, Unit, Vec2 } from "../core/types";
import { FORMATION_DEFS, slotWorld } from "../sim/formations";
import { formationEngage, nearestEnemyTo } from "./combat";
import { healTick } from "./medic";
import { navigateTo } from "./navigation";
import { computePath } from "./pathfinding";

export function formationOf(state: GameState, u: Unit): Formation | null {
  if (u.formationId == null) return null;
  return state.formations.find((f) => f.id === u.formationId) ?? null;
}

/** §I cohesion: the whole shape moves at its slowest member's speed. */
function slowestSpeed(state: GameState, f: Formation): number {
  let s = Infinity;
  for (const e of state.entities) {
    if (e.kind === "unit" && e.hp > 0 && e.formationId === f.id) s = Math.min(s, e.speed);
  }
  return Number.isFinite(s) ? s : 2;
}

function stepAnchor(f: Formation, tx: number, ty: number, step: number): void {
  const dx = tx - f.anchor.x, dy = ty - f.anchor.y;
  const d = Math.hypot(dx, dy);
  if (d <= 1e-6) return;
  const t = Math.min(1, step / d);
  f.anchor = { x: f.anchor.x + dx * t, y: f.anchor.y + dy * t };
}

/** Advance every formation's anchor along its path this tick (before units chase their slots). */
export function updateFormations(state: GameState, dt: number): void {
  for (const f of state.formations) updateFormationAnchor(state, f, dt);
}

function traitSpeedMult(f: Formation): number {
  const trait = FORMATION_DEFS[f.formationDefId]?.trait;
  if (f.fallingBack) return FORMATIONS.FALL_BACK_SPEED; // §H withdraw at 80% (overrides march/charge)
  if (trait === "march") return FORMATIONS.TRAITS.MARCH_SPEED; // §F Column always +15%
  if (trait === "charge" && f.attackMove && f.charging) return FORMATIONS.TRAITS.CHARGE_SPEED; // §F Spear pre-contact
  return 1;
}

function updateFormationAnchor(state: GameState, f: Formation, dt: number): void {
  // §H Fall Back: withdraw from the nearest enemy, keeping the front turned toward it (units keep
  // firing from their slots via formationEngage). Ends if no enemy remains in view.
  if (f.fallingBack) { updateFallBack(state, f, dt); return; }

  if (!f.moveTarget) { if (f.stationarySince == null) f.stationarySince = state.time; return; }
  const goal = f.moveTarget;
  const speed = slowestSpeed(state, f) * traitSpeedMult(f);
  if (Math.hypot(goal.x - f.anchor.x, goal.y - f.anchor.y) <= FORMATIONS.ARRIVE) {
    f.moveTarget = null; f.path = []; f.pathGoal = null; f.stationarySince = state.time;
    return;
  }
  const owner = f.owner as PlayerId;
  const goalMoved = !f.pathGoal || Math.hypot(f.pathGoal.x - goal.x, f.pathGoal.y - goal.y) > NAV.repathDist;
  if (goalMoved || f.path.length === 0) {
    f.pathGoal = { x: goal.x, y: goal.y };
    f.path = computePath(state, f.anchor.x, f.anchor.y, goal.x, goal.y, owner);
  }
  const wp: Vec2 = f.path.length > 0 ? f.path[0] : goal; // straight-line fallback if no route
  stepAnchor(f, wp.x, wp.y, speed * dt);
  if (f.path.length > 0 && Math.hypot(f.path[0].x - f.anchor.x, f.path[0].y - f.anchor.y) <= NAV.waypointReach) {
    f.path.shift();
  }
  if (f.formationDefId !== "box") {
    const dx = goal.x - f.anchor.x, dy = goal.y - f.anchor.y;
    if (Math.hypot(dx, dy) > 0.5) f.facing = Math.atan2(dy, dx);
  }
}

/** §H fighting withdrawal: face the nearest enemy, step the anchor directly away from it at 80%
 *  speed. Units keep their slots (which retreat with the anchor) and keep firing. Auto-ends when no
 *  enemy is in view (nothing to withdraw from). */
function updateFallBack(state: GameState, f: Formation, dt: number): void {
  f.stationarySince = null;
  const enemy = nearestEnemyTo(f.owner as PlayerId, f.anchor, 20);
  if (!enemy) { f.fallingBack = false; f.moveTarget = null; return; }
  const ex = enemy.kind === "building" ? enemy.x + enemy.width / 2 : enemy.x;
  const ey = enemy.kind === "building" ? enemy.y + enemy.height / 2 : enemy.y;
  f.facing = Math.atan2(ey - f.anchor.y, ex - f.anchor.x); // front stays toward the enemy
  const away = Math.atan2(f.anchor.y - ey, f.anchor.x - ex);
  const step = slowestSpeed(state, f) * FORMATIONS.FALL_BACK_SPEED * dt;
  const nx = f.anchor.x + Math.cos(away) * step;
  const ny = f.anchor.y + Math.sin(away) * step;
  f.anchor = {
    x: Math.max(0.5, Math.min(state.mapWidth - 0.5, nx)),
    y: Math.max(0.5, Math.min(state.mapHeight - 0.5, ny)),
  };
}

/** Drive one in-formation unit: fight from its slot on a leash if there's a target (§H), else hold the
 *  slot. Medics heal from the slot. Returns false if the unit isn't in a live formation. */
export function updateFormationUnit(state: GameState, u: Unit, dt: number): boolean {
  const f = formationOf(state, u);
  if (!f || !u.slotOffset) { u.formationId = null; u.slotOffset = undefined; return false; }
  const slot = slotWorld(f.anchor, f.facing, u.slotOffset.dx, u.slotOffset.dy);

  if (u.unitType === "medic") {
    healTick(state, u, dt); // heal from wherever it stands, then hold its center slot
    const reached = navigateTo(state, u, slot.x, slot.y, dt, FORMATIONS.ARRIVE);
    u.state = reached ? (u.healTarget != null ? "healing" : "idle") : "moving";
    return true;
  }

  u.attackTimer = Math.max(0, u.attackTimer - dt); // cooldown ticks whether or not it fires
  if (formationEngage(state, u, f, slot, dt)) return true; // §H leashed fire-from-slot

  const reached = navigateTo(state, u, slot.x, slot.y, dt, FORMATIONS.ARRIVE);
  u.state = reached ? "idle" : "moving";
  return true;
}
