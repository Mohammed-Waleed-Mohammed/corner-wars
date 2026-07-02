// Field Medic (19 §D). No attack — auto-heals the lowest-HP damaged friendly UNIT within
// MEDIC.RANGE (switching targets as it needs to), at MEDIC.HEAL_PER_S (STIM_HEAL_PER_S once
// Combat Stims is researched). At most MAX_HEALERS_PER_TARGET medics may heal one unit in the
// same tick (no immortality stacks). With no patient in range, an unordered medic walks toward
// the nearest damaged friendly it can see. Deterministic: candidates are scored lowest-hp with
// lowest-id tie-break, and medics run inside the ordered per-unit dispatch loop.

import { MEDIC } from "../config/constants";
import { distance } from "../core/math";
import type { AnyEntity, GameState, Unit } from "../core/types";
import { medicHealPerS } from "../state/upgrades";
import { navigateTo } from "./navigation";
import { updateUnitMovement } from "./movement";
import { entityHash } from "./spatial";

// Healer count per target id THIS tick (stacking cap). Cleared lazily on tick change so the
// module carries no cross-tick state (replay/lockstep safe — derived purely from the sim step).
const claims = new Map<number, number>();
let claimsTick = -1;

const scratch: AnyEntity[] = [];

function lowestHpPatient(m: Unit, radius: number): Unit | null {
  entityHash.queryInto(m.x, m.y, radius, scratch);
  let best: Unit | null = null;
  for (const e of scratch) {
    if (e.kind !== "unit" || e.owner !== m.owner || e.id === m.id || e.hp <= 0 || e.hp >= e.maxHp) continue;
    if (distance(m, e) > radius) continue;
    if ((claims.get(e.id) ?? 0) >= MEDIC.MAX_HEALERS_PER_TARGET) continue;
    if (!best || e.hp < best.hp || (e.hp === best.hp && e.id < best.id)) best = e;
  }
  return best;
}

/** Heal the lowest-HP damaged friendly in range this tick (honoring the stacking cap); sets/clears
 *  m.healTarget. Returns the patient (or null). Shared by loose medics and formed ones (slot-follow). */
export function healTick(state: GameState, m: Unit, dt: number): Unit | null {
  if (claimsTick !== state.tick) { claims.clear(); claimsTick = state.tick; }
  const patient = lowestHpPatient(m, MEDIC.RANGE);
  if (patient) {
    claims.set(patient.id, (claims.get(patient.id) ?? 0) + 1);
    m.healTarget = patient.id;
    if (m.owner !== "neutral") {
      patient.hp = Math.min(patient.maxHp, patient.hp + medicHealPerS(state.players[m.owner]) * dt);
    }
    return patient;
  }
  m.healTarget = null;
  return null;
}

export function updateMedic(state: GameState, m: Unit, dt: number): void {
  m.forcedTargetId = null; // a medic can never attack — an attack order degrades to a move

  // Player-issued move first; healing continues opportunistically while walking.
  if (m.moveTarget) updateUnitMovement(state, m, dt);

  const patient = healTick(state, m, dt);
  if (patient) {
    if (!m.moveTarget) m.state = "healing";
    return;
  }

  if (m.moveTarget || m.guardPoint != null) { // ordered elsewhere — don't wander
    if (!m.moveTarget) m.state = "idle";
    return;
  }

  // Unordered: seek the nearest damaged friendly unit in sight and close to heal range.
  entityHash.queryInto(m.x, m.y, m.sightRadius, scratch);
  let seek: Unit | null = null;
  let bestD = Infinity;
  for (const e of scratch) {
    if (e.kind !== "unit" || e.owner !== m.owner || e.id === m.id || e.hp <= 0 || e.hp >= e.maxHp) continue;
    const d = distance(m, e);
    if (d > m.sightRadius) continue;
    if (d < bestD || (d === bestD && seek && e.id < seek.id)) { bestD = d; seek = e; }
  }
  if (seek) {
    navigateTo(state, m, seek.x, seek.y, dt, MEDIC.RANGE * 0.8);
    m.state = "moving";
  } else {
    m.state = "idle";
  }
}
