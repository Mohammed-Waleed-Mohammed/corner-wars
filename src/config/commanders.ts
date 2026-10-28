// 27 — commander doctrines + abilities (sim numbers; every value mirrors
// description/27-factions-and-commanders.md §B/§C). Names, bios and portraits are content
// (src/content/factions.ts) — nothing here is display text except the stable ids.

import type { AbilityId, BuildingType, CommanderId, FactionId, FieldKind, UnitType } from "../core/types";

export const FACTION_IDS: readonly FactionId[] = ["concord", "halcyon", "cantons", "choir"];
export const COMMANDER_IDS: readonly CommanderId[] = [
  "varga", "haddad", "marchetti", "achterberg", "okafor", "lindqvist", "cantor", "penitent",
];

/** 27 §B unit groups. */
export const INFANTRY: ReadonlySet<UnitType> = new Set<UnitType>(["rifleman", "grenadier", "rocket", "medic"]);
export const VEHICLES: ReadonlySet<UnitType> = new Set<UnitType>(["scoutBuggy", "tank", "heavyTank", "artillery"]);
export const DEFENSES: ReadonlySet<BuildingType> = new Set<BuildingType>(["turret", "pillbox", "antiArmorCannon", "missileTower"]);

/** Passive doctrine — every field optional; absent = ×1 / +0. */
export interface DoctrineDef {
  buildingHpMult?: number;
  defenseDamageMult?: number;
  artilleryRangeBonus?: number;
  artilleryCostMult?: number;
  missileTowerRangeBonus?: number;
  miningMult?: number;
  researchTimeMult?: number;
  researchCostMult?: number;
  vehicleHpMult?: number;
  infantryCostMult?: number;
  infantryTimeMult?: number;
  roughTerrainPenaltyMult?: number; // forest/hill/shallows: penalty (1 − factor) × this
  forestSpotRange?: number; // enemies must be this close to spot this player's units in forests
  captureSpeedMult?: number;
  energyMult?: number;
  unitDamageMult?: number;
  unitHpMult?: number;
}

export interface AbilityDef {
  id: AbilityId;
  target: "point" | "instant";
  cooldown: number; // s
  initial: number; // s locked at match start
  radius?: number; // tiles (fields + strikes)
  duration?: number; // s (fields + buffs)
  field?: FieldKind;
  // field strengths
  damageTakenMult?: number; // aegis: friendly damage taken ×
  enemyDamageMult?: number; // prism / ash: enemy damage dealt ×
  enemySpeedMult?: number; // prism / ash: enemy move speed ×
  cloakSpotRange?: number; // cloak / ash: enemies within this see hidden units
  // strikes
  damage?: number;
  delay?: number; // s until the first impact
  impacts?: { dx: number; dy: number; at: number }[]; // offsets (tiles) + extra delay (s) per impact
  // instant buffs
  gold?: number;
  buffDamageMult?: number;
  buffSpeedMult?: number;
  buffMiningMult?: number;
}

/** 27 §C: ability damage to buildings is halved; never friendly fire. */
export const ABILITY_BUILDING_MULT = 0.5;

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  aegis: { id: "aegis", target: "point", cooldown: 90, initial: 45, radius: 5, duration: 12, field: "aegis", damageTakenMult: 0.6 },
  hammerfall: {
    id: "hammerfall", target: "point", cooldown: 75, initial: 40, radius: 3, damage: 90, delay: 1.5,
    impacts: [{ dx: 0, dy: 0, at: 0 }, { dx: 1.2, dy: -0.8, at: 0.8 }, { dx: -1.0, dy: 1.0, at: 1.6 }],
  },
  supplyDrop: { id: "supplyDrop", target: "instant", cooldown: 120, initial: 60, duration: 30, gold: 400, buffMiningMult: 1.5 },
  prism: { id: "prism", target: "point", cooldown: 90, initial: 45, radius: 4, duration: 8, field: "prism", enemyDamageMult: 0.7, enemySpeedMult: 0.5 },
  rally: { id: "rally", target: "instant", cooldown: 90, initial: 45, duration: 15, buffDamageMult: 1.15, buffSpeedMult: 1.2 },
  ghostRoads: { id: "ghostRoads", target: "point", cooldown: 100, initial: 50, radius: 6, duration: 20, field: "cloak", cloakSpotRange: 2 },
  hymn: { id: "hymn", target: "point", cooldown: 100, initial: 60, radius: 3.5, damage: 220, delay: 3, impacts: [{ dx: 0, dy: 0, at: 0 }] },
  ashstorm: {
    id: "ashstorm", target: "point", cooldown: 110, initial: 55, radius: 5, duration: 15, field: "ash",
    enemyDamageMult: 0.65, enemySpeedMult: 0.75, cloakSpotRange: 2,
  },
};

export interface CommanderDef {
  faction: FactionId;
  doctrine: DoctrineDef;
  ability: AbilityId;
}

export const COMMANDERS: Record<CommanderId, CommanderDef> = {
  varga: { faction: "concord", ability: "aegis", doctrine: { buildingHpMult: 1.2, defenseDamageMult: 1.1 } },
  haddad: { faction: "concord", ability: "hammerfall", doctrine: { artilleryRangeBonus: 1, artilleryCostMult: 0.85, missileTowerRangeBonus: 1 } },
  marchetti: { faction: "halcyon", ability: "supplyDrop", doctrine: { miningMult: 1.15, researchTimeMult: 0.8 } },
  achterberg: { faction: "halcyon", ability: "prism", doctrine: { vehicleHpMult: 1.1, researchCostMult: 0.75 } },
  okafor: { faction: "cantons", ability: "rally", doctrine: { infantryCostMult: 0.85, infantryTimeMult: 0.8 } },
  lindqvist: { faction: "cantons", ability: "ghostRoads", doctrine: { roughTerrainPenaltyMult: 0.5, forestSpotRange: 3 } },
  cantor: { faction: "choir", ability: "hymn", doctrine: { captureSpeedMult: 1 / 0.7, energyMult: 1.5 } },
  penitent: { faction: "choir", ability: "ashstorm", doctrine: { unitDamageMult: 1.12, unitHpMult: 0.92 } },
};

export const COMMANDERS_OF: Record<FactionId, readonly [CommanderId, CommanderId]> = {
  concord: ["varga", "haddad"],
  halcyon: ["marchetti", "achterberg"],
  cantons: ["okafor", "lindqvist"],
  choir: ["cantor", "penitent"],
};

export function isCommanderId(x: unknown): x is CommanderId {
  return typeof x === "string" && (COMMANDER_IDS as readonly string[]).includes(x);
}

export function factionOf(c: CommanderId | null | undefined): FactionId | null {
  return c ? COMMANDERS[c].faction : null;
}

/** Deterministic pick for a "Random" seat: same seed + seat → same commander on every peer. */
export function randomCommander(seed: number, seat: number): CommanderId {
  let h = Math.imul((seed ^ 0x5bd1e995) | 0, 0x27d4eb2d) ^ Math.imul(seat + 1, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  return COMMANDER_IDS[h % COMMANDER_IDS.length];
}
