// 34 §W.1 — the field manual: what each unit is good at, what it must never be asked to do, and how to
// order it. Everything is DERIVED from the data (UNIT_STATS, COUNTERS, terrain effects, formation
// traits) so a balance change flows straight into the AI's doctrine. Pure functions of unit types —
// no state, no RNG.

import { COUNTERS, DEFENSE_STATS, TERRAIN_FX, UNIT_MOVE_CLASS, UNIT_STATS } from "../../config/constants";
import type { BuildingType, CombatType, UnitType } from "../../core/types";

const ct = (t: UnitType): CombatType | undefined => UNIT_STATS[t].combatType;
const range = (t: UnitType): number => UNIT_STATS[t].range;
const hillRange = (t: UnitType): number => range(t) + (range(t) >= TERRAIN_FX.HILL_RANGE_MIN_BASE ? TERRAIN_FX.HILL_RANGE_BONUS : 0);

/** a deals the counter bonus to b (the triangle: infantry > ranged > heavy > infantry). */
export function beats(a: UnitType, b: UnitType): boolean {
  const ca = ct(a), cb = ct(b);
  return !!ca && !!cb && COUNTERS[ca] === cb;
}

/** a can shoot b and step away faster than b closes: longer range and at least b's speed. */
export function canKite(a: UnitType, b: UnitType): boolean {
  if (UNIT_STATS[a].damage <= 0 || ct(b) === undefined) return false;
  return range(a) > range(b) && UNIT_STATS[a].speed >= UNIT_STATS[b].speed;
}

/** a out-ranges a tower of type `tower` (from the flat, or from a hill vs a tower on the flat). */
export function outranges(a: UnitType, tower: BuildingType, onHill = false): boolean {
  const d = DEFENSE_STATS[tower];
  if (!d) return true;
  return (onHill ? hillRange(a) : range(a)) > d.range;
}

/** The blind ring a unit can't fire into (artillery's minRange) — it must be screened. */
export const blindRing = (t: UnitType): number => UNIT_STATS[t].minRange ?? 0;

/** Damage taken in a forest, as a multiplier (foot units hide best). */
export const forestTaken = (t: UnitType): number => 1 - TERRAIN_FX.FOREST_COVER[UNIT_MOVE_CLASS[t]];

/** Splash units punish stationary, packed formations. */
export const splashes = (t: UnitType): boolean => (UNIT_STATS[t].splashRadius ?? 0) > 0;

/** Who to shoot first (34 §W.1 "focus"): artillery in range, then medics, then what I counter, then the
 *  most damaged. Higher = first. */
export function focusScore(shooter: UnitType, target: UnitType, hpFrac: number): number {
  let s = 0;
  if (target === "artillery") s += 40;
  if (target === "medic") s += 30;
  if (beats(shooter, target)) s += 20;
  s += 15 * (1 - hpFrac);
  s += UNIT_STATS[target].gold / 50;
  return s;
}

export type Job = "scout" | "raid" | "screen" | "front" | "backline" | "siege" | "bait" | "ambush" | "hunt" | "anchor" | "heal";

/** The jobs each unit is good at, best first — the Marshal picks task-force members from this. */
export function jobsFor(t: UnitType): Job[] {
  const s = UNIT_STATS[t];
  if (t === "worker") return [];
  if (t === "medic") return ["heal"];
  const out: Job[] = [];
  if (s.combatType === "siege") out.push("siege");
  if (s.speed >= 4.5) out.push("scout", "raid", "bait", "hunt");
  if (s.combatType === "heavy") out.push(s.hp >= 250 ? "anchor" : "front", "screen");
  if (s.combatType === "infantry") out.push("screen", "ambush", "hunt", "bait");
  if (s.combatType === "ranged" && s.speed < 4.5) out.push("backline", "ambush");
  if (splashes(t) && s.combatType !== "siege") out.push("front");
  return out;
}

/** The manual's verdict for an order: never put a unit where its "never" column says. */
export function never(t: UnitType, job: Job): boolean {
  switch (job) {
    case "front": return ct(t) === "siege" || t === "medic" || t === "scoutBuggy";
    case "screen": return ct(t) === "siege" || t === "medic";
    case "ambush": return ct(t) === "siege" || UNIT_MOVE_CLASS[t] !== "foot" && t !== "rocket";
    case "siege": return ct(t) !== "siege";
    default: return false;
  }
}
