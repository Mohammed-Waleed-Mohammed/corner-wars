// Formation runtime (19). Per-tick behavior for units that belong to a formation. M2 scope: a formed
// unit paths to its slot (anchor + rotated offset) and holds there — the shape "stands". Medics also
// heal from their slot. Movement of the whole shape along a path, cohesion (slowest-member speed),
// facing from orders, engagement discipline, and traits arrive in M4/M6. Deaths are pruned once per
// tick by pruneFormations (survivors keep their slot — deaths leave holes, §I).

import { FORMATIONS, NAV, UNIT_MOVE_CLASS } from "../config/constants";
import type { Formation, GameState, MoveClass, PlayerId, Unit, Vec2 } from "../core/types";
import { FORMATION_DEFS, slotWorld } from "../sim/formations";
import { speedFactor, terrainAt } from "../state/terrain";
import { formationEngage, nearestEnemyTo } from "./combat";
import { healTick } from "./medic";
import { navigateTo } from "./navigation";
import { computePath, enemyGateAt, navPassable } from "./pathfinding";

export function formationOf(state: GameState, u: Unit): Formation | null {
  if (u.formationId == null) return null;
  return state.formations.find((f) => f.id === u.formationId) ?? null;
}

// Live members of every formation, indexed once per tick by updateFormations (perf: the anchor helpers
// below used to scan every entity, once per formation per helper per tick).
const members = new Map<number, Unit[]>();
const NONE: Unit[] = [];
function indexMembers(state: GameState): void {
  for (const list of members.values()) list.length = 0;
  for (const e of state.entities) {
    if (e.kind !== "unit" || e.hp <= 0 || e.formationId == null) continue;
    let list = members.get(e.formationId);
    if (!list) { list = []; members.set(e.formationId, list); }
    list.push(e);
  }
}
function membersOf(f: Formation): Unit[] {
  return members.get(f.id) ?? NONE;
}

/** §I cohesion: the whole shape moves at its slowest member's speed — and (24 §B) at the terrain
 *  factor under its anchor for its most restrictive movement class (tracked if any vehicle, else foot). */
function slowestSpeed(state: GameState, f: Formation): number {
  let s = Infinity;
  for (const e of membersOf(f)) s = Math.min(s, e.speed);
  const base = Number.isFinite(s) ? s : 2;
  const factor = speedFactor(terrainAt(state, f.anchor.x, f.anchor.y), formationClass(f), state.biome);
  return base * (factor > 0 ? factor : 1);
}

/** 24 §B: the class a formation paths and paces as — tracked if it holds any vehicle, else foot. */
function formationClass(f: Formation): MoveClass {
  for (const e of membersOf(f)) if (UNIT_MOVE_CLASS[e.unitType] !== "foot") return "tracked";
  return "foot";
}

function stepAnchor(f: Formation, tx: number, ty: number, step: number): void {
  const dx = tx - f.anchor.x, dy = ty - f.anchor.y;
  const d = Math.hypot(dx, dy);
  if (d <= 1e-6) return;
  const t = Math.min(1, step / d);
  f.anchor = { x: f.anchor.x + dx * t, y: f.anchor.y + dy * t };
}

/** A tile the anchor may enter: walkable, no building, not an enemy gate. */
function anchorPassable(state: GameState, f: Formation, x: number, y: number): boolean {
  return navPassable(state, Math.floor(x), Math.floor(y)) && !enemyGateAt(state, Math.floor(x), Math.floor(y), f.owner);
}

/** Off-route anchor move (no A* route, or Fall Back): step only onto passable ground, sliding along
 *  a wall on one axis — the anchor never crosses mountains, water or buildings (§I). */
function stepAnchorPassable(state: GameState, f: Formation, nx: number, ny: number): void {
  if (anchorPassable(state, f, nx, ny)) f.anchor = { x: nx, y: ny };
  else if (anchorPassable(state, f, nx, f.anchor.y)) f.anchor = { x: nx, y: f.anchor.y };
  else if (anchorPassable(state, f, f.anchor.x, ny)) f.anchor = { x: f.anchor.x, y: ny };
}

/** §I cohesion: true while more than half the live members are over LAG_DIST from their slots. */
function membersLagging(f: Formation): boolean {
  let n = 0, far = 0;
  const lag2 = FORMATIONS.COHESION.LAG_DIST ** 2;
  for (const e of membersOf(f)) {
    if (!e.slotOffset) continue;
    n++;
    const s = slotWorld(f.anchor, f.facing, e.slotOffset.dx, e.slotOffset.dy);
    if ((e.x - s.x) ** 2 + (e.y - s.y) ** 2 > lag2) far++;
  }
  return far * 2 > n;
}

/** Advance every formation's anchor along its path this tick (before units chase their slots). */
export function updateFormations(state: GameState, dt: number): void {
  indexMembers(state);
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
  // §I: hold the shape while most members are still catching up — bounded, so a stuck unit can't
  // freeze the army.
  if (membersLagging(f)) {
    f.cohesionWait = (f.cohesionWait ?? 0) + dt;
    if (f.cohesionWait <= FORMATIONS.COHESION.MAX_WAIT) return;
  } else f.cohesionWait = 0;
  const owner = f.owner as PlayerId;
  const goalMoved = !f.pathGoal || Math.hypot(f.pathGoal.x - goal.x, f.pathGoal.y - goal.y) > NAV.repathDist;
  if (goalMoved || f.path.length === 0) {
    f.pathGoal = { x: goal.x, y: goal.y };
    f.path = computePath(state, f.anchor.x, f.anchor.y, goal.x, goal.y, owner, formationClass(f));
  }
  if (f.path.length > 0) {
    const wp: Vec2 = f.path[0];
    stepAnchor(f, wp.x, wp.y, speed * dt); // A* waypoints and the segments between them are passable
  } else {
    // No route (goal walled off, or already in the goal tile): edge straight in, on passable ground only.
    const dx = goal.x - f.anchor.x, dy = goal.y - f.anchor.y;
    const d = Math.hypot(dx, dy);
    const t = Math.min(1, (speed * dt) / d);
    const before = f.anchor;
    stepAnchorPassable(state, f, f.anchor.x + dx * t, f.anchor.y + dy * t);
    if (f.anchor === before) { // walled off: this is as close as it gets — stop here
      f.moveTarget = null; f.path = []; f.pathGoal = null; f.stationarySince = state.time;
      return;
    }
  }
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
  const nx = Math.max(0.5, Math.min(state.mapWidth - 0.5, f.anchor.x + Math.cos(away) * step));
  const ny = Math.max(0.5, Math.min(state.mapHeight - 0.5, f.anchor.y + Math.sin(away) * step));
  stepAnchorPassable(state, f, nx, ny); // backs up to a cliff or river and holds there, never through it
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
