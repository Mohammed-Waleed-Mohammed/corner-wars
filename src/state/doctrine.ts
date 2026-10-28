// 27 §B — commander doctrines as pure multipliers. Every system that reads a price, a build time,
// an HP total, a range, a damage roll, a mining drop or a capture rate asks THESE helpers, so a
// doctrine applies everywhere at once (and refunds always match what was paid). Pure + DOM-free.

import { RESEARCH, UNIT_STATS } from "../config/constants";
import { COMMANDERS, DEFENSES, INFANTRY, VEHICLES, type DoctrineDef } from "../config/commanders";
import type { BuildingType, Player, ResearchKey, UnitType } from "../core/types";

const NONE: DoctrineDef = {};

export function doctrineOf(p: Player | null | undefined): DoctrineDef {
  return p?.commander ? COMMANDERS[p.commander].doctrine : NONE;
}

// ── prices & times ────────────────────────────────────────────────────────────────────────────────

/** Gold this player pays for a unit (rounded — a whole-gold price on every peer). */
export function unitCost(p: Player | null | undefined, type: UnitType): number {
  const d = doctrineOf(p);
  let m = 1;
  if (d.infantryCostMult && INFANTRY.has(type)) m *= d.infantryCostMult;
  if (d.artilleryCostMult && type === "artillery") m *= d.artilleryCostMult;
  return Math.round(UNIT_STATS[type].gold * m);
}

/** Seconds a unit takes to train for this player (before production-speed multipliers). */
export function unitBuildTime(p: Player | null | undefined, type: UnitType): number {
  const d = doctrineOf(p);
  let t = UNIT_STATS[type].buildTime;
  if (d.infantryTimeMult && INFANTRY.has(type)) t *= d.infantryTimeMult;
  return t;
}

export function researchCost(p: Player | null | undefined, key: ResearchKey): number {
  return Math.round(RESEARCH[key].gold * (doctrineOf(p).researchCostMult ?? 1));
}

export function researchTime(p: Player | null | undefined, key: ResearchKey): number {
  return RESEARCH[key].time * (doctrineOf(p).researchTimeMult ?? 1);
}

// ── durability, damage, range ─────────────────────────────────────────────────────────────────────

/** Doctrine max-HP multiplier for a unit type (applied at creation and on rescale). */
export function unitHpDoctrineMult(p: Player | null | undefined, type: UnitType): number {
  const d = doctrineOf(p);
  let m = d.unitHpMult ?? 1;
  if (d.vehicleHpMult && VEHICLES.has(type)) m *= d.vehicleHpMult;
  return m;
}

export function buildingHpDoctrineMult(p: Player | null | undefined): number {
  return doctrineOf(p).buildingHpMult ?? 1;
}

/** Per-shot damage multiplier from doctrine for a unit (not buffs/fields — see engine/abilities). */
export function unitDamageDoctrineMult(p: Player | null | undefined): number {
  return doctrineOf(p).unitDamageMult ?? 1;
}

export function defenseDamageDoctrineMult(p: Player | null | undefined, type: BuildingType): number {
  const d = doctrineOf(p);
  return d.defenseDamageMult && DEFENSES.has(type) ? d.defenseDamageMult : 1;
}

/** Extra range (tiles) for a unit type from doctrine. */
export function unitRangeBonus(p: Player | null | undefined, type: UnitType): number {
  return type === "artillery" ? (doctrineOf(p).artilleryRangeBonus ?? 0) : 0;
}

/** Extra range (tiles) for a defensive structure from doctrine. */
export function defenseRangeBonus(p: Player | null | undefined, type: BuildingType): number {
  return type === "missileTower" ? (doctrineOf(p).missileTowerRangeBonus ?? 0) : 0;
}

// ── economy & the Citadel ─────────────────────────────────────────────────────────────────────────

/** Doctrine × active-buff mining multiplier (Supply Drop's buff is expired by engine/abilities). */
export function miningDoctrineMult(p: Player): number {
  return (doctrineOf(p).miningMult ?? 1) * (p.abilityBuff?.miningMult ?? 1);
}

export function captureSpeedMult(p: Player | null | undefined): number {
  return doctrineOf(p).captureSpeedMult ?? 1;
}

export function energyDoctrineMult(p: Player | null | undefined): number {
  return doctrineOf(p).energyMult ?? 1;
}

// ── terrain ───────────────────────────────────────────────────────────────────────────────────────

/** Lindqvist's Know the Land: shrink a rough-terrain speed penalty (factor < 1) by the doctrine. */
export function roughTerrainFactor(p: Player | null | undefined, factor: number): number {
  const k = doctrineOf(p).roughTerrainPenaltyMult;
  if (k == null || factor >= 1) return factor;
  return 1 - (1 - factor) * k;
}

/** Enemies must be this close to spot this player's units inside a forest. */
export function forestSpotRange(p: Player | null | undefined, base: number): number {
  return doctrineOf(p).forestSpotRange ?? base;
}
