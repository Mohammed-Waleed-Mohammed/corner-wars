// Single source of truth for all tunable numbers.
// Every value here MIRRORS a description/ file — when a number changes, change it in
// the description first, then here. The source file is noted on each block.

import type {
  BuildingType,
  CombatType,
  Owner,
  PlayerId,
  ResearchKey,
  UnitType,
} from "../core/types";

// ── Grid & world (02-map.md) ────────────────────────────────────────────────
export const GRID = { width: 48, height: 48 } as const;

// Map editor limits (18 §B): tunable bounds for custom maps.
export const MAP_EDITOR = {
  minSize: 20,
  maxSize: 160, // raised for the 3x-scaled official maps (validation + editor + import clamp)
  maxCustomMaps: 24,       // localStorage "My Maps" cap
  defaultMineAmount: 3000,
  maxMineAmount: 20000,
} as const;
export const TILE_SIZE = 32; // px per tile
export const WORLD = {
  width: GRID.width * TILE_SIZE, // 1536
  height: GRID.height * TILE_SIZE, // 1536
} as const;
export const MAP_CENTER = { x: 24, y: 24 } as const;

// ── Fixed map features (02-map.md) ──────────────────────────────────────────
// Base (x,y) is the TOP-LEFT tile of the Construction Yard's footprint.
// Home mine is 4 tiles toward center from the base anchor.
export interface BaseDef {
  player: PlayerId;
  x: number;
  y: number;
  mine: { x: number; y: number };
}
export const BASES: BaseDef[] = [
  { player: 0, x: 6, y: 6, mine: { x: 10, y: 10 } }, // top-left (human)
  { player: 1, x: 41, y: 6, mine: { x: 37, y: 10 } }, // top-right
  { player: 2, x: 6, y: 41, mine: { x: 10, y: 37 } }, // bottom-left
  { player: 3, x: 41, y: 41, mine: { x: 37, y: 37 } }, // bottom-right
];
export const CITADEL_POS = { x: 24, y: 24 } as const;

// ── Economy (03-resources-economy.md) ───────────────────────────────────────
export const START_GOLD = 10000; // user: matches start rich (also the MP default)
export const HOME_MINE_GOLD = 5000;
export const NEUTRAL_DEPOSIT_GOLD = 3000;
export const CENTRAL_DEPOSIT_GOLD = 8000;
// Unit cap is now tiered by Supply Lines research (15-logic §2): base 80, +30 per tier (→170).
export const BASE_UNIT_CAP = 80;
export const SUPPLY_LINE_CAP_BONUS = 30;
export const PRODUCTION_QUEUE_MAX = 12; // user: up to 12 queued per building
export const WORKER = {
  capacity: 10, // gold per trip
  mineTime: 2, // seconds to fill
  refineryBonus: 0.25, // +25% effective mining at a Refinery
} as const;

// Contact distances for the harvest loop (engine tuning, 08-combat-formulas.md loop).
export const HARVEST = {
  sourceContact: 1.0, // tiles — close enough to mine a deposit
  dropoffPadding: 0.6, // tiles beyond a building's half-extent counts as "at drop-off"
} as const;

// Random neutral-deposit generation (03-resources-economy.md §"Random generation")
export const RESOURCE_GEN = {
  minPerQuadrant: 2,
  maxPerQuadrant: 3,
  baseExclusion: 5, // tiles around a base
  citadelExclusion: 6, // tiles around the Citadel
  minSpacing: 4, // tiles between deposits
  centralRingRadius: 7, // rich deposits ring around Citadel
  centralCountMin: 1,
  centralCountMax: 2,
} as const;

// ── Units (05-units.md) ─────────────────────────────────────────────────────
export interface UnitStat {
  combatType?: CombatType;
  hp: number;
  damage: number;
  cooldown: number; // seconds between attacks
  range: number; // tiles
  minRange?: number; // tiles — cannot fire closer (artillery)
  speed: number; // tiles/s
  splashRadius?: number; // tiles — area damage on the shot (grenadier/artillery)
  collisionRadius: number; // tiles (§12 separation)
  sight: number; // tiles (§11 fog)
  gold: number;
  buildTime: number; // seconds
  requires?: BuildingType; // built-at is in PRODUCES; this is an extra building prereq if any
  unlock?: UnlockKey; // Lab research gate (15-logic §4): Heavy Tank / Artillery
}
export const UNIT_STATS: Record<UnitType, UnitStat> = {
  worker: { hp: 40, damage: 3, cooldown: 1.5, range: 1, speed: 2.5, collisionRadius: 0.35, sight: 5, gold: 50, buildTime: 8 },
  rifleman: {
    combatType: "infantry",
    hp: 60, damage: 8, cooldown: 1.0, range: 1, speed: 3.5, collisionRadius: 0.35, sight: 6, gold: 75, buildTime: 10,
  },
  rocket: {
    combatType: "ranged",
    hp: 45, damage: 9, cooldown: 1.0, range: 4, speed: 2.3, collisionRadius: 0.35, sight: 7, gold: 90, buildTime: 12,
  },
  tank: {
    combatType: "heavy",
    hp: 160, damage: 18, cooldown: 1.4, range: 2, speed: 1.8, collisionRadius: 0.55, sight: 6, gold: 180, buildTime: 18,
  },
  // 15-logic §4 — expanded roster.
  grenadier: {
    combatType: "infantry",
    hp: 55, damage: 12, cooldown: 1.5, range: 3, speed: 2.8, splashRadius: 1.0, collisionRadius: 0.35, sight: 6, gold: 110, buildTime: 13,
  },
  scoutBuggy: {
    combatType: "ranged",
    hp: 50, damage: 6, cooldown: 0.6, range: 3, speed: 5.0, collisionRadius: 0.4, sight: 7, gold: 70, buildTime: 9,
  },
  heavyTank: {
    combatType: "heavy",
    hp: 280, damage: 30, cooldown: 1.5, range: 3, speed: 1.4, collisionRadius: 0.6, sight: 6, gold: 360, buildTime: 28, unlock: "advancedVehicles",
  },
  artillery: {
    combatType: "siege",
    hp: 70, damage: 45, cooldown: 3.0, range: 9, minRange: 3, speed: 1.5, splashRadius: 1.5, collisionRadius: 0.45, sight: 9, gold: 300, buildTime: 22, unlock: "siegeDoctrine",
  },
  // Field Medic (19 §D): NO attack — heals via MEDIC below. damage/cooldown/range 0 are inert.
  medic: {
    combatType: "support",
    hp: 50, damage: 0, cooldown: 1.0, range: 0, speed: 2.5, collisionRadius: 0.35, sight: 6, gold: 120, buildTime: 14,
  },
};

// ── Combat overhaul (19-formations-v2.md) ────────────────────────────────────
// §B pacing: every unit's base maxHp × this (damage/costs/building HP unchanged).
export const COMBAT_PACE = { UNIT_HP_MULT: 1.5 } as const;
// §D Field Medic behavior. STIM_HEAL_PER_S applies once "Combat Stims" is researched.
export const MEDIC = { HEAL_PER_S: 4, RANGE: 2.5, MAX_HEALERS_PER_TARGET: 2, STIM_HEAL_PER_S: 6 } as const;

// §E/§F/§G/§H/§K formation dials — every tunable in one place, mirroring file 19 §N.
export const FORMATIONS = {
  SPACING: 0.8, // tiles between units in a row
  ROW_SPACING: 1.0, // tiles between rows
  LEASH: 2.0, // §H: in-formation units fire from their slot, shift up to this, never chase past it
  MOVE_AT_SLOWEST: true, // §I: whole formation moves at its slowest member's speed
  ARRIVE: 0.35, // tiles — how close to a slot counts as "in position"
  TRAITS: { CHARGE_SPEED: 1.2, VOLLEY_DMG: 1.1, BRACE_TAKEN: 0.85, MARCH_SPEED: 1.15 },
  FALL_BACK_SPEED: 0.8, // §H: withdraw at 80% speed, facing the enemy
  BREAK_ALERT: { LOSS_FRACTION: 0.3, WINDOW_S: 10 }, // §J: >30% loss in 10s → "line breaking" alert
  HOTKEYS: { open: "f", break: "shift+f", fallBack: "v" },
} as const;

// Weapon delivery per attacker (§9). melee/hitscan apply damage instantly; rocket/shell fly.
export type WeaponKind = "melee" | "hitscan" | "rocket" | "shell";
export const UNIT_WEAPON: Record<UnitType, WeaponKind> = {
  worker: "melee",
  rifleman: "hitscan",
  rocket: "rocket",
  tank: "shell",
  grenadier: "shell", // lobbed grenade (carries splash)
  scoutBuggy: "hitscan", // rapid light gun
  heavyTank: "shell",
  artillery: "shell", // lobbed shell (carries splash, min-range)
  medic: "melee", // inert — the Medic never attacks (damage 0); entry exists for the Record type
};
// Siege units deal +100% to buildings (15-logic §4), outside the counter triangle.
export const SIEGE_BUILDING_BONUS = 1.0;
export const PROJECTILE = {
  rocketSpeed: 10, // tiles/s
  shellSpeed: 16,
  arrivalDist: 0.3, // tiles — close enough to detonate
} as const;

// Counter triangle: attacking the type you counter deals +50% (05-units.md, 08-combat). Partial:
// "siege" has no entry (it's outside the triangle — normal vs units, +100% vs buildings).
export const COUNTERS: Partial<Record<CombatType, CombatType>> = {
  infantry: "ranged",
  ranged: "heavy",
  heavy: "infantry",
};
export const COUNTER_BONUS = 0.5; // +50%
export const AGGRO_RADIUS = 6; // tiles (08-combat-formulas.md)
// Walls/gates are excluded from auto-target acquisition (16 §2c). A unit only breaks a wall when
// it's the blocking segment on an otherwise-impassable route — the nearest enemy wall within this.
export const WALL_BREAK_RADIUS = 1.8; // tiles

// ── Buildings (06-buildings.md, 04-power.md) ────────────────────────────────
// `power` is NET: positive = produced, negative = consumed.
export type UnlockKey = "advancedVehicles" | "siegeDoctrine" | "advancedDefenses";
export interface BuildingStat {
  hp: number;
  gold: number;
  buildTime: number; // seconds
  power: number;
  width: number; // footprint tiles
  height: number;
  sight: number; // tiles (§11 fog)
  requires?: BuildingType; // building prerequisite (tech tree)
  unlock?: UnlockKey; // Lab research gate (15-logic §2)
  letter: string; // HUD/render label
}
export const BUILDING_STATS: Record<BuildingType, BuildingStat> = {
  // gold/buildTime are for a BUILT expansion CY (16 §5 maxCount 2); the starting CYs are created
  // complete so they ignore these. 1000g is a spec-gap value (file 16 doesn't price the expansion).
  constructionYard: { hp: 1500, gold: 1000, buildTime: 40, power: 50, width: 3, height: 3, sight: 10, letter: "CY" },
  powerPlant: { hp: 500, gold: 200, buildTime: 14, power: 100, width: 2, height: 2, sight: 7, letter: "P" },
  refinery: { hp: 700, gold: 250, buildTime: 22, power: -30, width: 2, height: 2, sight: 7, letter: "R" },
  barracks: { hp: 700, gold: 200, buildTime: 20, power: -20, width: 2, height: 2, sight: 7, letter: "B" },
  warFactory: { hp: 800, gold: 350, buildTime: 28, power: -40, width: 3, height: 2, sight: 7, requires: "barracks", letter: "W" },
  lab: { hp: 700, gold: 500, buildTime: 30, power: -30, width: 2, height: 2, sight: 7, requires: "barracks", letter: "L" },
  // Defenses (15-logic §3). turret = "Gun Turret" (general-purpose). All 1×1.
  turret: { hp: 600, gold: 200, buildTime: 15, power: -20, width: 1, height: 1, sight: 8, letter: "T" },
  pillbox: { hp: 400, gold: 150, buildTime: 10, power: -10, width: 1, height: 1, sight: 6, letter: "Pb" },
  antiArmorCannon: { hp: 700, gold: 300, buildTime: 18, power: -30, width: 1, height: 1, sight: 7, unlock: "advancedDefenses", letter: "AC" },
  missileTower: { hp: 650, gold: 400, buildTime: 20, power: -40, width: 1, height: 1, sight: 10, unlock: "advancedDefenses", letter: "MT" },
  // Walls & gates (15-logic §1). 1×1, no power.
  wall: { hp: 250, gold: 20, buildTime: 3, power: 0, width: 1, height: 1, sight: 2, letter: "" },
  gate: { hp: 400, gold: 75, buildTime: 8, power: 0, width: 1, height: 1, sight: 2, letter: "" },
};

// Defense combat params (15-logic §3), keyed by buildingType (single source; not per-instance).
// `bonusVsType` gives +COUNTER_BONUS (+50%) vs that unit combat-type (or "building").
export interface DefenseStat {
  damage: number;
  cooldown: number; // seconds
  range: number; // tiles
  weapon: "hitscan" | "shell" | "rocket";
  bonusVsType?: CombatType | "building";
  splashRadius?: number; // tiles (area damage on arrival)
}
export const DEFENSE_STATS: Partial<Record<BuildingType, DefenseStat>> = {
  pillbox: { damage: 5, cooldown: 0.4, range: 5, weapon: "hitscan", bonusVsType: "infantry" },
  turret: { damage: 25, cooldown: 1.0, range: 7, weapon: "shell" },
  antiArmorCannon: { damage: 40, cooldown: 1.6, range: 6, weapon: "shell", bonusVsType: "heavy" },
  missileTower: { damage: 30, cooldown: 2.0, range: 9, weapon: "rocket", splashRadius: 1.5 },
};

// Gates (15-logic §1) + the per-player wall/gate performance cap.
export const GATE = { openRadius: 1.5, closeDelay: 1.0 } as const; // friendly within 1.5 opens; closes 1s after
export const STRUCTURE_CAP = { wallsPerPlayer: 60 } as const;

// What each production building can build (06-buildings.md, 15-logic §4). ORDER = the fixed
// Q/W/E/R hotkey slots (16 §1): Barracks Q/W/E = Rifleman/Grenadier/Rocket; War Factory
// Q/W/E/R = Scout/Tank/Heavy/Artillery; CY Q = Worker.
export const PRODUCES: Partial<Record<BuildingType, UnitType[]>> = {
  constructionYard: ["worker"],
  warFactory: ["scoutBuggy", "tank", "heavyTank", "artillery", "worker"],
  barracks: ["rifleman", "grenadier", "rocket", "medic"], // medic on slot R (19 §D)
};
// Positional hotkeys for the Nth unit-production slot (16 §1). worker (5th WF slot) has none.
export const UNIT_HOTKEY_SLOTS = ["Q", "W", "E", "R"] as const;

// What each building can construct (structures, placed on the map). The Construction
// Yard's command card OFFERS all structures (06-buildings.md tech tree); the actual
// building is done by Workers at the placed site (15-logic worker-built construction).
export const CONSTRUCTS: Partial<Record<BuildingType, BuildingType[]>> = {
  constructionYard: [
    "powerPlant", "refinery", "barracks", "warFactory", "lab",
    "pillbox", "turret", "antiArmorCannon", "missileTower", "wall", "gate",
    "constructionYard", // expansion base (16 §5, maxCount 2)
  ],
};

// Build panel = the full buildable list, shown left-edge always (16 §4). Order = panel order.
export const BUILD_PANEL: BuildingType[] = [
  "powerPlant", "refinery", "barracks", "warFactory", "lab",
  "turret", "pillbox", "antiArmorCannon", "missileTower", "wall", "gate", "constructionYard",
];

// Fixed mnemonic build hotkeys (16 §1). P/R/B/F/L/T/G/Y per spec; the rest are free letters.
export const BUILD_HOTKEYS: Partial<Record<BuildingType, string>> = {
  powerPlant: "P", refinery: "R", barracks: "B", warFactory: "F", lab: "L",
  turret: "T", pillbox: "X", antiArmorCannon: "C", missileTower: "V",
  wall: "Y", gate: "G", constructionYard: "N",
};

// Build-once limits per player (16 §5). Absent = unlimited (walls/gates use STRUCTURE_CAP).
export const BUILD_MAX_COUNT: Partial<Record<BuildingType, number>> = {
  constructionYard: 2,
  lab: 1,
};

// Movement-line feedback (16 §3).
export const MOVE_LINE = { lifetime: 1.5 } as const; // seconds to fade

// One-line descriptions for build/production tooltips (16 §6).
export const BUILDING_DESC: Record<BuildingType, string> = {
  constructionYard: "Main base — build structures. Lose all to be eliminated.",
  powerPlant: "+100 power to run your base.",
  refinery: "Drop-off with +25% mining; includes a free Worker.",
  barracks: "Trains infantry: Rifleman, Grenadier, Rocket.",
  warFactory: "Builds vehicles: Scout, Tank, Heavy Tank, Artillery.",
  lab: "Researches upgrades and unlocks advanced units/defenses.",
  turret: "Balanced defense; shells at range 7.",
  pillbox: "Cheap anti-infantry defense (+50% vs Infantry).",
  antiArmorCannon: "Anti-armor defense (+50% vs Heavy).",
  missileTower: "Long-range splash defense.",
  wall: "Blocks movement; funnels attackers. Drag to build a line.",
  gate: "Opens for your units, closed to enemies.",
};
export const UNIT_DESC: Record<UnitType, string> = {
  worker: "Gathers gold, builds and repairs structures.",
  rifleman: "Cheap infantry (+50% vs Ranged).",
  grenadier: "Splash infantry; anti-clump (+50% vs Ranged).",
  rocket: "Ranged anti-armor (+50% vs Heavy).",
  scoutBuggy: "Fast raider/scout (+50% vs Heavy).",
  tank: "Heavy armor (+50% vs Infantry).",
  heavyTank: "Late-game bruiser (+50% vs Infantry).",
  artillery: "Siege: long range, splash, +100% vs buildings; fragile.",
  medic: "Support: no attack; auto-heals the lowest-HP friendly nearby.",
};

// Display names (shared by the HUD + build-rule tooltips; no DOM).
export const BUILDING_LABEL: Record<BuildingType, string> = {
  constructionYard: "Construction Yard", powerPlant: "Power Plant", refinery: "Refinery",
  barracks: "Barracks", warFactory: "War Factory", lab: "Lab", turret: "Gun Turret",
  pillbox: "Pillbox", antiArmorCannon: "Anti-Armor Cannon", missileTower: "Missile Tower",
  wall: "Wall", gate: "Gate",
};
export const UNIT_LABEL: Record<UnitType, string> = {
  worker: "Worker", rifleman: "Rifleman", grenadier: "Grenadier", rocket: "Rocket",
  scoutBuggy: "Scout Buggy", tank: "Tank", heavyTank: "Heavy Tank", artillery: "Artillery",
  medic: "Field Medic",
};
export const UNLOCK_LABEL: Record<UnlockKey, string> = {
  advancedVehicles: "Advanced Vehicles", siegeDoctrine: "Siege Doctrine", advancedDefenses: "Advanced Defenses",
};

// Lab research (15-logic §2). One at a time, queue up to 3; effects are per-player multipliers
// (applied in state/upgrades.ts). `requires` is a prerequisite research key (tiering).
export const RESEARCH_QUEUE_MAX = 3;
// Tech-tree categories (18 §I) — the grouping headers, in display order.
export const RESEARCH_CATEGORIES = [
  "Economy", "Construction & Production", "Weapons", "Armor", "Mobility", "Supply Lines", "Support", "Unlocks",
] as const;
export type ResearchCategory = (typeof RESEARCH_CATEGORIES)[number];
export interface ResearchDef {
  label: string;
  gold: number;
  time: number; // seconds
  requires?: ResearchKey;
  category: ResearchCategory; // 18 §I: which tech-tree group it lives in
  effect: string;             // 18 §I: exact effect string, shown verbatim in the tree/tooltip
}
export const RESEARCH: Record<ResearchKey, ResearchDef> = {
  mining1: { label: "Improved Mining I", gold: 300, time: 30, category: "Economy", effect: "+15% gather rate" },
  mining2: { label: "Improved Mining II", gold: 600, time: 45, requires: "mining1", category: "Economy", effect: "+30% gather rate" },
  constructionCrews: { label: "Construction Crews", gold: 350, time: 35, category: "Construction & Production", effect: "+25% Worker build speed" },
  streamlinedProduction: { label: "Streamlined Production", gold: 450, time: 40, category: "Construction & Production", effect: "+20% production speed" },
  weapons1: { label: "Weapons I", gold: 400, time: 40, category: "Weapons", effect: "+10% unit damage" },
  weapons2: { label: "Weapons II", gold: 700, time: 55, requires: "weapons1", category: "Weapons", effect: "+20% unit damage" },
  armor1: { label: "Armor I", gold: 400, time: 40, category: "Armor", effect: "+10% unit max HP" },
  armor2: { label: "Armor II", gold: 700, time: 55, requires: "armor1", category: "Armor", effect: "+20% unit max HP" },
  fieldLogistics: { label: "Field Logistics", gold: 500, time: 45, category: "Mobility", effect: "+15% unit move speed" },
  supply1: { label: "Supply Lines I", gold: 350, time: 35, category: "Supply Lines", effect: "+30 unit cap (→110)" },
  supply2: { label: "Supply Lines II", gold: 600, time: 50, requires: "supply1", category: "Supply Lines", effect: "+30 unit cap (→140)" },
  supply3: { label: "Supply Lines III", gold: 900, time: 65, requires: "supply2", category: "Supply Lines", effect: "+30 unit cap (→170)" },
  advancedVehicles: { label: "Advanced Vehicles", gold: 600, time: 50, category: "Unlocks", effect: "Enables the Heavy Tank" },
  siegeDoctrine: { label: "Siege Doctrine", gold: 400, time: 40, category: "Unlocks", effect: "Enables Artillery" },
  advancedDefenses: { label: "Advanced Defenses", gold: 500, time: 45, category: "Unlocks", effect: "Enables Anti-Armor Cannon + Missile Tower" },
  combatStims: { label: "Combat Stims", gold: 450, time: 45, category: "Support", effect: "Medic heal 4→6 HP/s" },
};
// Research offered by each building (only the Lab), in command-card order.
export const RESEARCHES: Partial<Record<BuildingType, ResearchKey[]>> = {
  lab: [
    "mining1", "mining2", "weapons1", "weapons2", "armor1", "armor2",
    "fieldLogistics", "constructionCrews", "streamlinedProduction",
    "supply1", "supply2", "supply3", "combatStims",
    "advancedVehicles", "siegeDoctrine", "advancedDefenses",
  ],
};

// ── Worker-built construction (15-logic) ────────────────────────────────────
// Placing a structure pays gold up front and creates a site at buildProgress 0;
// Workers walk to it and build. Build speed = min(sqrt(workersAtSite), maxSpeed),
// so 1 worker = base time, 4+ = the 2x cap; 0 workers pauses progress.
export const CONSTRUCTION = {
  maxSpeed: 2.0, // multiplier cap on a site's base build rate
  autoAssignWorkers: 2, // nearest idle Workers auto-assigned when a site is placed
  chainRadius: 8, // tiles — a Worker that finishes a build picks up the nearest unbuilt site within this
} as const;

// Worker repair (16 §7): 20 HP/s per Worker costing 0.25 gold/HP (= 5 gold/s), stacking with the
// same sqrt curve as construction (×2 at 4 Workers). Total gold to repair X HP is X × 0.25.
export const REPAIR = {
  hpPerSecond: 20,
  goldPerHp: 0.25,
  maxSpeed: 2.0,
} as const;

// ── Power (04-power.md) ──────────────────────────────────────────────────────
// When powerUsed > powerProduced: production timers run at x0.5 and turrets at half rate.
export const LOW_POWER_PRODUCTION_MULT = 0.5;

// ── Citadel (07-citadel.md) ─────────────────────────────────────────────────
export const CITADEL = {
  captureRadius: 3, // tiles
  captureTime: 12, // seconds of uncontested presence to flip
  goldPerSecond: 2, // flat holder income
  productionSpeedBonus: 0.2, // +20% production while held
  energyPerSecond: 0.5, // Command Energy generation while held
  maxEnergy: 100,
  winHoldTime: 120, // hold continuously to win
  visualRadius: 2, // tiles (hexagon ~4x4 footprint)
} as const;

export interface CitadelPowerDef {
  energy: number;
  damage?: number;
  radius?: number;
  count?: number;
  damageBonus?: number;
  speedBonus?: number;
  duration?: number;
  unitHeal?: number;
  structureHeal?: number;
}
export const CITADEL_POWERS: Record<string, CitadelPowerDef> = {
  artillery: { energy: 25, damage: 150, radius: 3 },
  reinforcements: { energy: 30, count: 3 },
  frenzy: { energy: 40, damageBonus: 0.3, speedBonus: 0.3, duration: 20 },
  repair: { energy: 35, unitHeal: 50, structureHeal: 200 },
  ion: { energy: 80, damage: 600, radius: 4 },
};

// Power display metadata (18 §J): full name, placeholder icon, and the tooltip. Tooltips are the
// spec's verbatim strings but TEMPLATED from CITADEL_POWERS so a number change here can't leave a
// stale tooltip (the M9 gate asserts they still match the spec text).
const P = CITADEL_POWERS;
export const POWER_INFO: Record<string, { label: string; icon: string; tooltip: string }> = {
  artillery: {
    label: "Artillery Strike", icon: "🎯",
    tooltip: `${P.artillery.damage} damage in a ${P.artillery.radius}-tile radius at the target point.`,
  },
  reinforcements: {
    label: "Reinforcements", icon: "🪖",
    tooltip: `Instantly spawn ${P.reinforcements.count} Riflemen at your base.`,
  },
  frenzy: {
    label: "Battle Frenzy", icon: "⚡",
    tooltip: `Your units gain +${Math.round(P.frenzy.damageBonus! * 100)}% damage and speed for ${P.frenzy.duration} seconds.`,
  },
  repair: {
    label: "Repair Surge", icon: "🔧",
    tooltip: `Heal all your units +${P.repair.unitHeal} HP and structures +${P.repair.structureHeal} HP.`,
  },
  ion: {
    label: "Ion Strike", icon: "☄️",
    tooltip: `${P.ion.damage} damage in a ${P.ion.radius}-tile radius. Devastates armies and bases.`,
  },
};

// ── Build placement & fog (§7, §11) ─────────────────────────────────────────
export const BUILD_RADIUS = 6; // tiles — a new building must be within this of a friendly one
export const FOG_UPDATE_INTERVAL = 0.2; // s between fog recomputations (human only)

// ── Terrain generation & navigation (§3, §12) ───────────────────────────────
export const TERRAIN_GEN = {
  border: 1, // mountain ring thickness around the map edge
  featuresPerQuadrant: 5, // cluster seeds generated in one quadrant, then mirrored
  clusterMin: 2, // tiles per cluster
  clusterMax: 6,
  baseMargin: 2, // keep clear around each base footprint
  citadelMargin: 4, // keep clear around the Citadel
  mineMargin: 1, // keep clear around home/neutral gold
  depositClear: true, // never bury a gold deposit
  maxAttempts: 40, // regenerate until the connectivity check passes, then fall back to border-only
} as const;

// Relative likelihood of each impassable type when scattering interior terrain.
export const TERRAIN_WEIGHTS = [
  { type: "mountain", weight: 5 },
  { type: "rock", weight: 3 },
  { type: "water", weight: 2 },
] as const;

export const NAV = {
  repathDist: 2.5, // tiles the goal may drift before a unit recomputes its path
  waypointReach: 0.35, // tiles — close enough to a waypoint to advance to the next
  maxAStarNodes: 6000, // hard cap on A* expansions (safety)
  repathCooldown: 0.4, // s — after a no-route result, wait this long before re-running A*
} as const;

// ── Win conditions (01-overview.md, 08-combat) ──────────────────────────────
export const CITADEL_DOMINATION_TIME = CITADEL.winHoldTime; // canonical: CITADEL.winHoldTime

// ── Colors / visual language (11-visuals-assets.md) ─────────────────────────
export const COLORS = {
  voidBg: "#15181d", // outside the map (render-only)
  ground: "#23272e",
  grid: "#31363f",
  players: ["#3b82f6", "#ef4444", "#22c55e", "#eab308"] as const, // P0..P3
  neutralGold: "#f5c518",
  citadelNeutral: "#cbd5e1",
  citadelEnergy: "#a855f7",
  hpFull: "#22c55e",
  hpLow: "#ef4444",
  selection: "#ffffff",
  uiPanel: "#1a1d23",
  uiText: "#e2e8f0",
  accentPowerPlant: "#facc15",
  accentRefinery: "#f5c518",
  accentBarracks: "#94a3b8",
  accentWarFactory: "#f97316",
  // Terrain (§3, §15).
  mountain: "#4b463f",
  water: "#1e3a5f",
  rock: "#6b7280",
  void: "#0b0d10", // 18 §A: outside the playable shape — near-black, not a terrain material

  validPlace: "#22c55e",
  invalidPlace: "#ef4444",
  // Render-only outline/detail colors (not part of the spec palette).
  mapBorder: "#3a4150",
  outline: "#11151b",
  outlineDeep: "#0f1216",
  goldShadow: "#d9a400",
  production: "#38bdf8", // production-progress bar
  muzzle: "#fde68a", // muzzle flash
  shell: "#e5e7eb", // shell/bullet
} as const;

// Fog overlay opacity (§11, §15).
export const FOG_ALPHA = { unexplored: 1, explored: 0.55, visible: 0 } as const;

// Player palette override (18 §H): players can pick their color in Settings; the host resolves
// conflicts and the agreed per-player palette is applied at match start. Colors are RENDER-ONLY —
// never hashed into the sim/checksum — so a module-level override keyed by playerId is determinism-
// safe (every peer sets the same palette from the shared roster). Defaults to the fixed corner colors.
let PLAYER_PALETTE: readonly string[] = COLORS.players;
export function setPlayerPalette(colors: readonly (string | undefined)[]): void {
  PLAYER_PALETTE = COLORS.players.map((def, i) => colors[i] ?? def);
}
export function resetPlayerPalette(): void {
  PLAYER_PALETTE = COLORS.players;
}
export function ownerColor(owner: Owner): string {
  return owner === "neutral" ? COLORS.neutralGold : (PLAYER_PALETTE[owner] ?? COLORS.players[owner]);
}

// Selectable player colors (18 §H settings). Keys map to fixed indices in COLORS.players, so only a
// clamped integer ever crosses the wire — a hostile peer can't inject an arbitrary color string.
export const COLOR_KEYS = ["blue", "red", "green", "yellow"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export function colorKeyToIndex(key: string): number {
  const i = (COLOR_KEYS as readonly string[]).indexOf(key);
  return i < 0 ? 0 : i;
}

// Per-type building accent stripe (11-visuals-assets.md)
export const BUILDING_ACCENT: Record<BuildingType, string> = {
  constructionYard: COLORS.selection,
  powerPlant: COLORS.accentPowerPlant,
  refinery: COLORS.accentRefinery,
  barracks: COLORS.accentBarracks,
  warFactory: COLORS.accentWarFactory,
  lab: COLORS.citadelEnergy, // research → purple
  turret: COLORS.citadelNeutral,
  pillbox: "#cbd5e1",
  antiArmorCannon: "#f97316", // anti-armor → orange
  missileTower: "#a855f7", // long-range → purple
  wall: "#6b7280",
  gate: "#9ca3af",
};

// ── Render sizes (11-visuals-assets.md; 1 tile = 32px) ──────────────────────
export const RENDER = {
  workerRadius: 8, // ⌀16px
  riflemanSize: 18,
  rocketSize: 18,
  tankSize: 24,
  grenadierSize: 18,
  scoutBuggySize: 16,
  heavyTankSize: 30,
  artillerySize: 24,
  hpBarHeight: 3,
  selectionPadding: 4,
  moveMarkerTtl: 0.6, // s — right-click destination feedback fade
  minimapSize: 168, // px — square minimap
  minimapMargin: 12, // px from the screen corner
} as const;

// Spacing between units when a multi-unit move spreads into a formation (tiles).
export const FORMATION_SPACING = 0.9;

// Guard-area command (15-logic §6): fixed radius, leash to avoid being baited.
export const GUARD = { radius: 8, chaseMultiplier: 1.5 } as const;

// Queue cancel refunds (15-logic §7): full if not started, half if in progress.
export const REFUND = { queued: 1.0, inProgress: 0.5 } as const;

// Input timing (15-logic §8/§9): double-click + right-drag-vs-order disambiguation.
export const INPUT = {
  doubleClickTime: 0.32, // s between clicks to count as a double-click
  rightDragPx: 8, // px of right-drag before it becomes a camera pan (suppress order)
  rightDragHold: 0.2, // s of right-hold before it becomes a pan
} as const;

// ── Combat feedback & separation (§10, §12) ─────────────────────────────────
export const EFFECTS = {
  muzzleLife: 0.08, // s
  hitLife: 0.1,
  tracerLife: 0.05,
  deathLife: 0.32,
  hitFlashTime: 0.1, // s a struck entity flashes white
  lungeTime: 0.13, // s melee lunge animation
  lungeDist: 0.28, // tiles a melee attacker lunges forward
} as const;

export const SEPARATION = {
  maxPushPerFrame: 0.12, // tiles — clamp so jostling never teleports
} as const;

// ── AI opponents (09-ai.md) ─────────────────────────────────────────────────
export const AI = {
  decisionInterval: 0.6, // s between brain evaluations (slower than the render loop)
  workerTarget: 9, // ramp workers to ~this many
  armyAttackThreshold: 8, // combat units before pushing out
  threatRadius: 14, // enemy combat units within this of the base -> DEFEND
  reattackInterval: 6, // s between re-issuing attack orders
  citadelContestCount: 2, // units peeled off toward the Citadel during an attack
  goldBuffer: 60, // keep this much gold free when deciding to spend on structures
  // 19 §M formation behavior:
  minFormationSize: 4, // don't bother forming fewer than this many combat units
  reformLossFraction: 0.7, // re-form when a formation drops below this fraction of the army
  combatPerMedic: 8, // maintain ~1 medic per this many combat units (once a Barracks exists)
  fallBackRatio: 0.4, // Fall Back when local strength odds drop below this
  battleRadius: 10, // tiles around the formation used to tally the local strength comparison
} as const;

// 20 §D: AI difficulty presets (Skirmish). Easy = slower decisions, leaner economy, later pushes, no
// Citadel powers. Medium = the tuned defaults. Deterministic — difficulty is fixed match config.
export const AI_DIFFICULTY = {
  easy: { decisionMult: 1.7, workerTarget: 6, armyAttackThreshold: 11, usePowers: false },
  medium: { decisionMult: 1.0, workerTarget: AI.workerTarget, armyAttackThreshold: AI.armyAttackThreshold, usePowers: true },
} as const;
export type Difficulty = keyof typeof AI_DIFFICULTY;

// ── Camera (02-map.md) ──────────────────────────────────────────────────────
export const CAMERA = {
  panSpeed: 900, // screen px/s via keyboard (fallback default; overridable via Settings §H)
  minZoom: 0.4,
  maxZoom: 2.0,
  zoomStep: 0.12,
  dragThreshold: 6, // px of movement before a left-drag becomes a selection box
  edgeBand: 14, // px from a viewport edge that triggers edge-scroll (when enabled in Settings)
} as const;

// User settings (18 §H) — local, no accounts; persisted in localStorage. Defaults live here so every
// tunable stays in constants. cameraScrollSpeed is in TILES/s and applied as tiles*TILE_SIZE screen px.
export const SETTINGS_DEFAULTS = {
  username: "Player",
  preferredColor: "blue" as ColorKey, // maps through COLOR_KEYS → COLORS.players
  masterVolume: 0.45, // 0..1 — matches AudioManager's prior fixed volume
  muted: false,
  cameraScrollSpeed: 28, // tiles/s (≈ the prior 900 px/s at TILE_SIZE 32)
  edgeScroll: false, // off by default; some players find it disruptive
} as const;
export const SETTINGS_LIMITS = {
  usernameMax: 20,
  volumeMin: 0, volumeMax: 1,
  scrollMin: 8, scrollMax: 60, // tiles/s slider range
} as const;

// ── Multiplayer / deterministic lockstep (17-multiplayer-implementation.md §7) ──
export const NET = {
  SIM_HZ: 30, // fixed simulation rate
  TICKS_PER_TURN: 3, // a lockstep turn = 3 sim ticks (= TURN_MS at 30 Hz)
  TURN_MS: 100,
  INPUT_DELAY_TURNS: 3, // a command issued at turn T executes at T + this (hides latency)
  CHECKSUM_INTERVAL: 30, // turns between desync checksum compares
  MAX_PLAYERS: 4,
  ICE: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      // TURN entry added here when needed (file 17); credentials from env/config.
    ],
  },
} as const;

// Lobby chat (18 §E) + connection-strength (18 §F) tunables.
export const NET_STRENGTH = {
  pingIntervalMs: 1000, // lobby ping cadence — "update ~once per second" (§F)
  window: 8,            // rolling samples used for RTT average + packet-loss %
  timeoutMs: 3000,      // a ping unanswered this long counts as lost
  greenRttMs: 60,   greenLossPct: 5,   // RTT < 60ms & ~no loss → green
  yellowRttMs: 150, yellowLossPct: 20, // RTT 60–150ms or minor loss → yellow; else red (§F)
} as const;
export const CHAT = { maxLength: 200, scrollback: 80 } as const;

// ── UI/UX design tokens (20 §A/§K) — one visual system for every screen ──────
export const UI = {
  BG: "#14161a", // app background
  PANEL: "#1a1d23", // panel surface
  RAISED: "#23272e", // raised surface (secondary buttons, cards)
  BORDER: "#31363f",
  TEXT: "#e2e8f0",
  DIM: "#94a3b8", // dim/caption text
  ACCENT: "#f5c518", // amber — primary actions + highlights (the gold identity)
  RADIUS: 6, // px panel/button corner radius
  PAD: 16, // px standard panel padding
  FADE_MS: 150, // screen transition duration
  OVERLAY: "rgba(20, 22, 26, 0.6)", // dark veil laid over a screen's background image so panels/text stay legible
} as const;

// ── In-game HUD design tokens (21 §B) — single source; mirrored as CSS vars in src/ui/hud.css ──
export const HUD = {
  // Surfaces
  BG_PANEL: "rgba(21, 24, 29, 0.94)", // console fill (#15181d @ 94%)
  BG_WELL: "rgba(10, 12, 15, 0.85)", // inset content wells (#0a0c0f)
  BG_CHIP: "rgba(35, 39, 46, 0.95)", // small chips/buttons (#23272e)
  // Bevel borders (fake depth: light top/left, dark bottom/right)
  EDGE_LIGHT: "#3d434e",
  EDGE_DARK: "#0c0e11",
  BORDER: "#2b313b",
  // Identity
  TRIM_GOLD: "#f5c518", // the gold trim line — the game's signature
  TRIM_GOLD_DIM: "rgba(245,197,24,0.35)",
  // Text
  TEXT: "#e2e8f0",
  TEXT_DIM: "#8b94a3",
  TEXT_GOLD: "#f5c518",
  GOOD: "#22c55e", BAD: "#ef4444", WARN: "#f59e0b", ENERGY: "#a855f7",
  // Geometry
  CHAMFER: 10, // px cut on chamfered corners (large panels)
  CHAMFER_SM: 6, // small chips/buttons
  PAD: 10, // internal padding unit
  CONSOLE_H: 148, // bottom console height
  STATUS_W: 232, // status console width
  SIDEBAR_W: 168, // build sidebar width
  MINIMAP: 168, // minimap inner square
  TRIM_H: 2, // gold trim line thickness
} as const;

// 21 §L micro-interaction timings — display-only; never touch the sim.
export const HUD_ANIM = {
  ENTRANCE_MS: 250, // console slide-in duration
  ENTRANCE_STAGGER_MS: 60, // status → sidebar → bottom
  ENTRANCE_SLIDE_PX: 12,
  TWEEN_RATE: 0.08, // gold/energy readouts lerp toward the real value at this rate per frame
  INCOME_FLASH_MS: 300, // income text flash when it changes by more than ±5
  INCOME_FLASH_DELTA: 5,
  HOVER_THROTTLE_MS: 80, // ui_hover sound throttle
} as const;

// 20: per-screen background images (public/backgrounds/*). The ScreenManager renders the current
// screen's image full-bleed cover-fit behind everything, under UI.OVERLAY. Purely visual — never
// touches layout/sim/determinism/MP. A screen with no entry (or a 404) falls back to plain UI.BG.
// Data-driven: swap a background by editing this map + the file, no per-screen code.
export const SCREEN_BACKGROUNDS: Record<string, string> = {
  menu: "/backgrounds/menu.png",
  settings: "/backgrounds/settings.png",
  editor: "/backgrounds/editor.png",
  lobby: "/backgrounds/lobby.png",
  skirmish: "/backgrounds/skirmish.png",
  postMatch: "/backgrounds/postmatch.png",
};

// 20 §D/§K: skirmish + shared match options (game speed is determinism-critical — see NET note).
export const MATCH_OPTIONS = {
  startingGoldDefault: 10000,
  startingGoldChoices: [5000, 10000, 20000, 50000] as const,
  gameSpeedChoices: [0.75, 1, 1.25] as const,
  gameSpeedDefault: 1 as const,
} as const;

// 10-second connection test (18 §G). Weighted toward what lockstep needs (stability over raw speed):
// latency 35% · jitter 35% · loss 25% · throughput 5%. Scores are 0–100.
export const NET_TEST = {
  durationMs: 10000,
  probeIntervalMs: 100,   // ~100 probes over 10 s
  timeoutMs: 2000,        // a probe unanswered this long counts as lost
  weights: { latency: 0.35, jitter: 0.35, loss: 0.25, throughput: 0.05 },
  latencyBestMs: 50, latencyWorstMs: 250,   // RTT: <50 → 100, ≥250 → 0
  jitterBestMs: 10, jitterWorstMs: 80,       // jitter: <10 → 100, ≥80 → 0
  lossWorstPct: 5,                            // loss: 0% → 100, ≥5% → 0
  throughputBestPerSec: 9,                    // completed probes/s → 100 (proxy for sustained traffic)
} as const;

// The one fixed simulation timestep. The sim ONLY ever advances by this — never a frame dt
// (17 §1.2). Rendering stays 60fps and interpolates between the last two sim states.
export const SIM_DT = 1 / NET.SIM_HZ;
