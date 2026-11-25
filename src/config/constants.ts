// Single source of truth for all tunable numbers.
// Every value here MIRRORS a description/ file — when a number changes, change it in
// the description first, then here. The source file is noted on each block.

import type {
  BuildingType,
  CombatType,
  MoveClass,
  Owner,
  PlayerId,
  ResearchKey,
  TerrainType,
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

// Reaching a building's side (16 §2): builders, repairers and gold deliveries walk to a free tile on the
// footprint's ring (nearest reachable, spread across workers) and work from its edge.
export const FOOTPRINT = {
  REACH: 1.0, // tiles from the footprint's edge that count as "at" the building
  PARKED_SLACK: 0.4, // extra reach for a worker already working there (separation jostle)
  SPOT_ARRIVE: 0.2, // tiles — close enough to the chosen stand tile's centre
  CLAIMED_PENALTY: 2.5, // tiles added to a stand tile's score per worker already headed there
  MAX_TRIES: 4, // nearest stand tiles checked for a real A* route before giving up on reachability
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
  // 38 deals: no weapon, no combat class (never in a formation, never auto-acquires). gold 0: their
  // price is the deal's (DEALS.ENVOY_COST), and they are worth nothing to an army's value.
  peacemaker: { hp: 40, damage: 0, cooldown: 1.0, range: 0, speed: 5.5, collisionRadius: 0.3, sight: 7, gold: 0, buildTime: 6 },
  treatyCart: { hp: 2400, damage: 0, cooldown: 1.0, range: 0, speed: 1.2, collisionRadius: 0.6, sight: 5, gold: 0, buildTime: 20 },
  spy: { hp: 40, damage: 0, cooldown: 1.0, range: 0, speed: 3.4, collisionRadius: 0.3, sight: 8, gold: 150, buildTime: 12 }, // 39
};

// ── Combat overhaul (19-formations-v2.md) ────────────────────────────────────
// §B pacing: every unit's base maxHp × this (damage/costs/building HP unchanged).
export const COMBAT_PACE = { UNIT_HP_MULT: 1.5 } as const;
// §D Field Medic behavior. STIM_HEAL_PER_S applies once "Combat Stims" is researched.
// 38 deals (engine/diplomacy.ts) — sim rules, so every peer runs them alike
// 39 the Spy: hidden from each enemy until it comes within REVEAL_PAD tiles of one of their powered
// towers' reach; it stays revealed to them LINGER_S after leaving it.
export const SPY = {
  REVEAL_PAD: 2,
  LINGER_S: 3,
} as const;

export const DEALS = {
  FROM_S: 300, // no offer before 5:00
  MIN_PLAYERS: 3, // alive players for deals to exist
  DOMINANT: 1.3, // the strongest is dominant at this × the next one's strength…
  DOMINANT_EXIT: 1.15, // …and stays dominant down to this
  // strength = army value + BUILDING_W × buildings' worth + a minute's income. Buildings count for less:
  // every base holds much the same ones, and at full weight they hid a 2:1 army lead (measured: the
  // top ÷ next ratio never passed 1.36 in three 15-minute FFAs)
  BUILDING_W: 0.4,
  INCOME_S: 60, // a minute's income counts toward strength
  DOMINANT_HOLD_S: 20, // an offer opens this long after the dominance is announced (time to raise the gold)
  OFFER_S: 30, // the weakest has this long to send a Peacemaker
  LETTER_S: 30, // the receiver has this long to answer the letter
  WAIT_S: 240, // after a declined or failed deal (or an offer let lapse), the sender waits this long
  ENVOY_COST: 1000,
  PREP_S: 6, // the Peacemaker is readied at the main yard
  STAND_OFF: 10, // it stops this far outside the receiver's nearest building
  CART_PREP_S: 20,
  TRIBUTE: 500, // carried by the cart, paid by the sender as it sets out
  TREATY_S: 480, // a treaty lasts at most this…
  WARN_S: 60, // …and warns this long before it ends
  ARRIVE_R: 3, // arrival: within this of the stand point / the yard
  BLOCKED_R: 18, // a walk that stops gaining ground this close (a wall in the way) counts as arrived
  STALL_S: 6,
  LOG_KEEP: 40,
} as const;

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
  COHESION: { LAG_DIST: 3, MAX_WAIT: 4 }, // §I: anchor holds while >half the members are >3 tiles off their slots, ≤4 s
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
  peacemaker: "melee", // inert (38)
  treatyCart: "melee", // inert (38)
  spy: "melee", // inert (39)
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
// 31 §C perf: a unit re-scans for the nearest / best enemy every this many sim ticks (0.2 s at
// 30 Hz), staggered by unit id; in between it keeps its current target while that stays valid.
export const TARGET_RESCAN_TICKS = 6;
// Walls/gates are excluded from auto-target acquisition (16 §2c). A unit only breaks a wall when
// it's the blocking segment on an otherwise-impassable route — the nearest enemy wall within this.
export const WALL_BREAK_RADIUS = 1.8; // tiles

// ── Buildings (06-buildings.md, 04-power.md) ────────────────────────────────
// `power` is NET: positive = produced, negative = consumed.
export type UnlockKey = "advancedVehicles" | "siegeDoctrine" | "advancedDefenses" | "resonanceTapping";
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
  // 32 §A late-game gold: no mine, no workers — expensive, power-hungry (no limit since 36 §F).
  resonanceTap: { hp: 650, gold: 1500, buildTime: 45, power: -60, width: 2, height: 2, sight: 7, unlock: "resonanceTapping", letter: "RT" },
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

// Gates (15-logic §1). 36 §F: no per-player wall/gate cap any more.
export const GATE = { openRadius: 1.5, closeDelay: 1.0 } as const; // friendly within 1.5 opens; closes 1s after

// What each production building can build (06-buildings.md, 15-logic §4). ORDER = the fixed
// Q/W/E/R hotkey slots (16 §1): Barracks Q/W/E = Rifleman/Grenadier/Rocket; War Factory
// Q/W/E/R = Scout/Tank/Heavy/Artillery; CY Q = Worker.
// Training order = command-card slots Q W E R T (30 §B).
export const PRODUCES: Partial<Record<BuildingType, UnitType[]>> = {
  constructionYard: ["worker"],
  warFactory: ["scoutBuggy", "tank", "heavyTank", "artillery", "worker"],
  barracks: ["rifleman", "grenadier", "rocket", "medic", "spy"], // medic on slot R (19 §D); 39 the Spy
};

// What each building can construct (structures, placed on the map). The Construction
// Yard's command card OFFERS all structures (06-buildings.md tech tree); the actual
// building is done by Workers at the placed site (15-logic worker-built construction).
export const CONSTRUCTS: Partial<Record<BuildingType, BuildingType[]>> = {
  constructionYard: [
    "powerPlant", "refinery", "resonanceTap", "barracks", "warFactory", "lab",
    "pillbox", "turret", "antiArmorCannon", "missileTower", "wall", "gate",
    "constructionYard", // expansion base (16 §5, maxCount 2)
  ],
};



// Build-count limits per player (16 §5). 36 §F: none — every building, wall and gate is unlimited.
// The dial stays: a type listed here (e.g. `lab: 1`) is capped again.
export const BUILD_MAX_COUNT: Partial<Record<BuildingType, number>> = {};

// 32 §A the Resonance Tap's income: gold per second while finished; halved under low power; ×1.5 with
// Deep Resonance. 4 Taps at 6 g/s = 24 g/s, about the take of 12 mining workers, with no mine at all.
export const RESONANCE_TAP = { goldPerSec: 4, deepMult: 1.5, lowPowerMult: 0.5 } as const;
// 32 §B Reinforced Structures: max HP of walls, gates and the four towers.
export const REINFORCED_HP_MULT = 1.25;
export const REINFORCED_TYPES: ReadonlySet<BuildingType> = new Set<BuildingType>(["wall", "gate", "pillbox", "turret", "antiArmorCannon", "missileTower"]);

// Movement-line feedback (16 §3).
export const MOVE_LINE = { lifetime: 1.5 } as const; // seconds to fade

// What each building does, in plain words: shown when hovering it on the command card or in the world,
// and in the selection panel (16 §6, 30 §F).
export const BUILDING_DESC: Record<BuildingType, string> = {
  constructionYard: "Your main base. Trains Workers and unlocks every other building. Lose all your Yards and you are out.",
  powerPlant: "Makes power (+100). Without enough power, your defenses switch off and training slows down.",
  refinery: "Workers drop their gold here and earn 25% more for it. Comes with one free Worker.",
  barracks: "Trains foot soldiers: Riflemen, Grenadiers, Rocket Soldiers, Medics and Spies.",
  warFactory: "Builds vehicles: Scout Buggies, Tanks, Heavy Tanks and Artillery. Can also make Workers.",
  lab: "Researches upgrades that make your army stronger, and unlocks advanced units and defenses.",
  turret: "A gun tower that shoots any enemy within 7 tiles. A good all-round defense.",
  pillbox: "A cheap bunker that is best at gunning down enemy foot soldiers.",
  antiArmorCannon: "A heavy gun that is best against tanks and other vehicles.",
  missileTower: "Fires missiles a long way (9 tiles) that hurt every enemy in a small area.",
  wall: "Blocks enemies and steers them toward your defenses. Drag to build a whole line.",
  gate: "A piece of wall your own units can walk through. Enemies cannot.",
  resonanceTap: "Draws gold straight from the Resonance Grid, no mine or workers needed: +4 gold every second. Uses a lot of power.",
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
  peacemaker: "Envoy: carries a peace letter; no weapon; only a direct attack order can hit it.",
  treatyCart: "Treaty cart: carries the tribute that seals a deal; slow, armoured, seen by everyone.",
  spy: "Unseen scout (sight 8, no weapon): hidden from the enemy unless within 2 tiles of their towers' reach.",
};

// Display names (shared by the HUD + build-rule tooltips; no DOM).
export const BUILDING_LABEL: Record<BuildingType, string> = {
  constructionYard: "Construction Yard", powerPlant: "Power Plant", refinery: "Refinery",
  barracks: "Barracks", warFactory: "War Factory", lab: "Lab", turret: "Gun Turret",
  pillbox: "Pillbox", antiArmorCannon: "Anti-Armor Cannon", missileTower: "Missile Tower",
  wall: "Wall", gate: "Gate", resonanceTap: "Resonance Tap",
};
export const UNIT_LABEL: Record<UnitType, string> = {
  worker: "Worker", rifleman: "Rifleman", grenadier: "Grenadier", rocket: "Rocket",
  scoutBuggy: "Scout Buggy", tank: "Tank", heavyTank: "Heavy Tank", artillery: "Artillery",
  medic: "Field Medic", peacemaker: "Peacemaker", treatyCart: "Treaty Cart", spy: "Spy",
};
export const UNLOCK_LABEL: Record<UnlockKey, string> = {
  advancedVehicles: "Advanced Vehicles", siegeDoctrine: "Siege Doctrine", advancedDefenses: "Advanced Defenses",
  resonanceTapping: "Resonance Tapping",
};

// Lab research (15-logic §2, re-planned in 32 §B). One at a time, queue up to 3; effects are per-player
// multipliers or unlocks (applied in state/upgrades.ts). The tree is six BRANCHES × four TIERS: `requires`
// is the research before it (usually in the same branch), `needsBuilding` a structure you must own.
export const RESEARCH_QUEUE_MAX = 3;
export const RESEARCH_BRANCHES = ["Economy", "Industry", "Armory", "Vehicles", "Fortification", "Logistics"] as const;
export type ResearchBranch = (typeof RESEARCH_BRANCHES)[number];
export const RESEARCH_BRANCH_INFO: Record<ResearchBranch, string> = {
  Economy: "More gold: faster mining, then gold from the Resonance Grid once the mines run dry.",
  Industry: "Build and train faster.",
  Armory: "Stronger weapons and armour for every unit, and better field medicine.",
  Vehicles: "Unlock the heavy hitters. Needs a War Factory.",
  Fortification: "Tougher walls and towers, then the advanced towers.",
  Logistics: "A bigger army and faster marching.",
};
export interface ResearchDef {
  label: string;
  gold: number;
  time: number; // seconds
  branch: ResearchBranch; // 32 §B: the row it lives in
  tier: 1 | 2 | 3 | 4; // 32 §B: the column (costs and times rise by tier)
  requires?: ResearchKey;
  needsBuilding?: BuildingType; // 32 §B: a finished structure you must own to start it
  effect: string; // shown verbatim in the tree and tooltips
  info: string; // one plain sentence for the tree's details panel
}
export const RESEARCH: Record<ResearchKey, ResearchDef> = {
  // Economy
  mining1: { label: "Improved Mining I", gold: 300, time: 30, branch: "Economy", tier: 1, effect: "+15% gold per trip", info: "Workers carry 15% more gold back from every trip." },
  mining2: { label: "Improved Mining II", gold: 600, time: 45, branch: "Economy", tier: 2, requires: "mining1", effect: "+30% gold per trip", info: "Workers carry 30% more gold back from every trip." },
  resonanceTapping: { label: "Resonance Tapping", gold: 1200, time: 70, branch: "Economy", tier: 3, requires: "mining2", effect: "Unlocks the Resonance Tap", info: "Lets you build Resonance Taps: +4 gold every second each, no mine or workers needed (up to 4)." },
  deepResonance: { label: "Deep Resonance", gold: 1600, time: 90, branch: "Economy", tier: 4, requires: "resonanceTapping", effect: "Resonance Taps +50%", info: "Every Resonance Tap makes 6 gold a second instead of 4." },
  // Industry
  constructionCrews: { label: "Construction Crews", gold: 350, time: 35, branch: "Industry", tier: 1, effect: "+25% Worker build speed", info: "Workers put up buildings 25% faster." },
  streamlinedProduction: { label: "Streamlined Production", gold: 450, time: 40, branch: "Industry", tier: 2, requires: "constructionCrews", effect: "+20% production speed", info: "Every building trains its units 20% faster." },
  // Armory
  weapons1: { label: "Weapons I", gold: 400, time: 40, branch: "Armory", tier: 1, effect: "+10% unit damage", info: "Every unit deals 10% more damage." },
  weapons2: { label: "Weapons II", gold: 700, time: 55, branch: "Armory", tier: 2, requires: "weapons1", effect: "+20% unit damage", info: "Every unit deals 20% more damage." },
  armor1: { label: "Armor I", gold: 400, time: 40, branch: "Armory", tier: 1, effect: "+10% unit max HP", info: "Every unit has 10% more health." },
  armor2: { label: "Armor II", gold: 700, time: 55, branch: "Armory", tier: 2, requires: "armor1", effect: "+20% unit max HP", info: "Every unit has 20% more health." },
  combatStims: { label: "Combat Stims", gold: 450, time: 45, branch: "Armory", tier: 3, requires: "armor2", effect: "Medic heal 4→6 HP/s", info: "Field Medics heal 6 health a second instead of 4." },
  // Vehicles
  advancedVehicles: { label: "Advanced Vehicles", gold: 600, time: 50, branch: "Vehicles", tier: 2, needsBuilding: "warFactory", effect: "Unlocks the Heavy Tank", info: "The War Factory can build Heavy Tanks." },
  siegeDoctrine: { label: "Siege Doctrine", gold: 700, time: 55, branch: "Vehicles", tier: 3, requires: "advancedVehicles", needsBuilding: "warFactory", effect: "Unlocks Artillery", info: "The War Factory can build long-range Artillery." },
  // Fortification
  reinforcedStructures: { label: "Reinforced Structures", gold: 350, time: 35, branch: "Fortification", tier: 1, effect: "Walls, gates, towers +25% HP", info: "Walls, gates and every defensive tower get 25% more health, existing ones too." },
  advancedDefenses: { label: "Advanced Defenses", gold: 500, time: 45, branch: "Fortification", tier: 2, requires: "reinforcedStructures", effect: "Unlocks AT Cannon + Missile Tower", info: "You can build the Anti-Armor Cannon and the Missile Tower." },
  // Logistics
  supply1: { label: "Supply Lines I", gold: 350, time: 35, branch: "Logistics", tier: 1, effect: "+30 unit cap (→110)", info: "Your army can be 30 units bigger (110)." },
  supply2: { label: "Supply Lines II", gold: 600, time: 50, branch: "Logistics", tier: 2, requires: "supply1", effect: "+30 unit cap (→140)", info: "Your army can be 30 more units bigger (140)." },
  supply3: { label: "Supply Lines III", gold: 900, time: 65, branch: "Logistics", tier: 3, requires: "supply2", effect: "+30 unit cap (→170)", info: "Your army can be 30 more units bigger (170)." },
  fieldLogistics: { label: "Field Logistics", gold: 500, time: 45, branch: "Logistics", tier: 2, requires: "supply1", effect: "+15% unit move speed", info: "Every unit moves 15% faster." },
};
// Research offered by each building (only the Lab), in tree order.
export const RESEARCHES: Partial<Record<BuildingType, ResearchKey[]>> = {
  lab: Object.keys(RESEARCH) as ResearchKey[],
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
// 36 §B city layout, shared by every AI (engine/layout.ts): streets, door aprons, the local flow check.
export const LAYOUT = {
  STREET: 1, // tiles kept clear round every building but walls and gates
  APRON: 2, // rows under a unit producer kept clear (its door)
  FLOW_PAD: 5, // the flow check floods the footprint plus this many tiles
} as const;
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

// ── 24 — Terrain types and how units interact with them (every number mirrors file 24) ──────────
export interface TerrainDef {
  passable: boolean;
  buildable: boolean;
  speed: Record<MoveClass, number>; // movement multiplier per class (1 = normal)
}
const NO_MOVE: Record<MoveClass, number> = { foot: 0, wheeled: 0, tracked: 0 };
export const TERRAIN: Record<TerrainType, TerrainDef> = {
  ground: { passable: true, buildable: true, speed: { foot: 1, wheeled: 1, tracked: 1 } },
  road: { passable: true, buildable: true, speed: { foot: 1.15, wheeled: 1.35, tracked: 1.2 } },
  bridge: { passable: true, buildable: false, speed: { foot: 1, wheeled: 1.2, tracked: 1 } },
  hill: { passable: true, buildable: true, speed: { foot: 0.8, wheeled: 0.7, tracked: 0.75 } },
  forest: { passable: true, buildable: false, speed: { foot: 0.7, wheeled: 0.45, tracked: 0.55 } },
  shallows: { passable: true, buildable: false, speed: { foot: 0.55, wheeled: 0.4, tracked: 0.6 } },
  water: { passable: false, buildable: false, speed: NO_MOVE },
  mountain: { passable: false, buildable: false, speed: NO_MOVE },
  rock: { passable: false, buildable: false, speed: NO_MOVE },
  void: { passable: false, buildable: false, speed: NO_MOVE },
};
/** Flat colour per terrain type for the minimap, map thumbnails and editor palette (24 §D). */
export const TERRAIN_MAP_COLOR: Record<TerrainType, string> = {
  ground: "#3d5a2a", road: "#8a7350", bridge: "#7a5a3a", hill: "#6f7d3e", forest: "#22401d",
  shallows: "#3f7f8f", water: "#1f4a73", mountain: "#5b544a", rock: "#7d7a72", void: "#0b0d10",
};
/** Fastest multiplier per class — scales the A* heuristic so weighted pathfinding stays admissible. */
export const FASTEST_MOVE: Record<MoveClass, number> = { foot: 1.15, wheeled: 1.35, tracked: 1.2 };
export const UNIT_MOVE_CLASS: Record<UnitType, MoveClass> = {
  worker: "foot", rifleman: "foot", rocket: "foot", grenadier: "foot", medic: "foot", peacemaker: "foot",
  scoutBuggy: "wheeled", treatyCart: "wheeled", spy: "foot",
  tank: "tracked", heavyTank: "tracked", artillery: "tracked",
};
export const TERRAIN_FX = {
  FOREST_COVER: { foot: 0.3, wheeled: 0.15, tracked: 0.15 } as Record<MoveClass, number>, // damage taken × (1 − this)
  FOREST_SPOT_RANGE: 4, // tiles — an enemy unit inside a forest is seen only this close
  HILL_SIGHT_BONUS: 2, // tiles of extra sight from high ground
  HILL_RANGE_BONUS: 1, // tiles of extra attack range from high ground…
  HILL_RANGE_MIN_BASE: 2, // …for units whose base range is at least this (and for all defenses)
} as const;

export const NAV = {
  repathDist: 2.5, // tiles the goal may drift before a unit recomputes its path
  waypointReach: 0.35, // tiles — close enough to a waypoint to advance to the next
  maxAStarNodes: 16000, // hard cap on A* expansions (safety; raised for weighted terrain on 144² maps)
  repathCooldown: 0.4, // s — after a no-route result, wait this long before re-running A*
  // 31 §C perf: A* nodes the unit movers may expand per sim tick, across all units. A unit over
  // budget keeps walking its old route (or waits a tick) — a mass order spreads over a few ticks
  // instead of freezing one frame (400 units re-pathing at once cost a 300 ms hitch).
  expansionsPerTick: 24000,
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
  resonanceTap: "#22d3ee", // 32 §A Resonance → cyan
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

// Guard-area command (15-logic §6, reworked by 34 §W.7): a fixed circle around the guard point. A guard
// shoots anything in its own weapon range from where it stands plus anything inside the circle; it may
// step out at most `stepOut` tiles past the edge for at most `outS` per sortie, then returns and rests
// `outCooldownS` before the next one. At most half a guard group may be out at once (`slack` absorbs
// separation pushes at the edge).
export const GUARD = { radius: 8, stepOut: 4, outS: 6, outCooldownS: 4, slack: 0.5 } as const;

// Hold fire (34 §W.6): a unit on hold fire never auto-acquires; its group opens fire when an enemy unit
// comes within this many tiles of any member, or when any member is damaged.
export const HOLD_FIRE_TRIGGER = 4;

// Queue cancel refunds (15-logic §7): full if not started, half if in progress.
export const REFUND = { queued: 1.0, inProgress: 0.5 } as const;
// Selling a structure (06 §Selling): a finished one returns `refund` of its price × its health; an
// unfinished site returns what wasn't built plus `refund` of what was. The Construction Yard can't be
// sold. confirmMs is UI-only: the Sell button arms on the first press and sells on a second within it.
export const SELL = { refund: 0.5, confirmMs: 3000 } as const;

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
  sellLife: 1.2, // s the "+gold" number floats over a sold building
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

// 20 §D: AI difficulty presets for the OLD simple AI — which file 22 §N keeps verbatim as EASY.
export const AI_DIFFICULTY = {
  easy: { decisionMult: 1.7, workerTarget: 6, armyAttackThreshold: 11, usePowers: false },
  medium: { decisionMult: 1.0, workerTarget: AI.workerTarget, armyAttackThreshold: AI.armyAttackThreshold, usePowers: true },
} as const;
export type Difficulty = "easy" | "medium" | "hard"; // 22 §N: medium/hard = the Commander

// ── 22 §C v3 — AI fog of war: every AI decides from its own perception (engine/aiPerception.ts) ──
export const AI_INTEL = {
  UNIT_MEMORY_TICKS: 9000, // forget an enemy unit not seen for 5 min (it may have died out of sight)
  // An enemy is believed to be in LOW POWER (defenses offline) only if this AI SAW one of their Power
  // Plants destroyed within this window and the plants it knows of can't cover the consumers it knows
  // of. Otherwise power is assumed sufficient — plants sit at the back of bases, so "I can't see their
  // plants" is no evidence at all.
  LOW_POWER_EVIDENCE_TICKS: 1800,
} as const;

// ── 22 — The AI Commander (every §B–§M number is a dial here) ────────────
export const COMMANDER = {
  // §A cadences (sim ticks @30Hz), staggered per player by playerId × STAGGER_PER_PLAYER.
  CADENCE: { STRATEGIC: 150, OPERATIONAL: 60, TACTICAL: 15 },
  STAGGER_PER_PLAYER: 7,
  // §E target scoring
  TARGET_STICKINESS: 1.25,
  GRUDGE_TICKS: 900,
  SCORE_W: { WEAKNESS: 2.0, PROXIMITY: 1.5, GRUDGE: 2.5, CITADEL: 1.0, BUSY: 1.5, EXPOSED: 1.0, FORTIFIED: 1.5 },
  EXPOSED_DIST: 18, // §E v2: an enemy whose army centroid is this far from its yard has an exposed base
  // §D adaptation
  DEFEND_THREAT: 0.6,
  DEFEND_EXIT: 0.2,
  DEFEND_ODDS: 1.0, // §D v2: also DEFEND when FightOdds at my base (my units + defenses there) < this…
  DEFEND_MIN_VALUE: 250, // …and the enemy force near my base is at least this much ArmyValue
  RECOVER_LOSS_FRAC: 0.4,
  RECOVER_WINDOW_TICKS: 900,
  RECOVER_REBUILD_FRAC: 0.8,
  ALLIN_ENEMY_DROP: 0.35,
  ALLIN_DROP_WINDOW_TICKS: 600,
  ALLIN_WINDOW_TICKS: 1350,
  // §C assessment
  THREAT_RADIUS: 14,
  DEFENSE_SCORE_RADIUS: 10,
  ECON_WORKER_VALUE: 2.5,
  FIGHT_HORIZON_S: 20, // §C v2 FightOdds: a medic's heal over this many seconds counts as extra HP
  ENGAGE_RADIUS: 9, // §C v2: a squad unit within this of an enemy fighter/defense is "in contact"
  DEFENSE_REACH_PAD: 3, // §C v2: a defense joins a fight when the fight point is within its range + this
  HOME_THREAT_RADIUS: 10, // §C v2: enemy fighters this close to ANY of my structures threaten my territory
  // §F economy
  WORKERS_PER_REFINERY: 2,
  WORKER_SATURATION: 6,
  POWER_SURPLUS_MIN: 20,
  REPAIR_HP_FRAC: 0.6,
  REPAIR_MAX_WORKERS: 2,
  REPAIR_ENEMY_RADIUS: 8,
  REPAIR_MAX_TOTAL: 2, // §F v2: never more than this many workers repairing at once (all buildings)
  REPAIR_MIN_GOLD: 150, // §F v2: start a repair only if this much gold remains after paying for it; below
  // it, standing repair crews are released back to mining (a repair at 0 gold pauses forever)
  REPAIR_MIN_MINERS_FRAC: 0.6, // §F v2: repairs never pull the miner count below this share of workers
  CLAIM_RADIUS: 7, // §F v2: a gold source is "mine" when one of my drop-offs is within this
  SOURCE_THREAT_RADIUS: 8, // §F v2: don't send workers to a source with enemy fighters this close
  REBALANCE_MAX: 2, // §F v2: workers moved per operational tick off an over-saturated source
  // §F v2 repair priority by building type (× missing HP). Walls/gates are never repaired — a 20g
  // segment is cheaper to rebuild than to crew; the §G plan re-places destroyed ones.
  REPAIR_PRIORITY: { constructionYard: 5, warFactory: 4, barracks: 4, powerPlant: 4, refinery: 3, lab: 3, defense: 3, other: 2 },
  SUPPLY_AT_CAP_FRAC: 0.85,
  EXPAND_PACKAGE: { workers: 2, pillboxes: 1 },
  // §G v4 base planning: a terrain-aware ring wall (engine/commander/basePlan.ts)
  WALL_R_MIN: 9, // smallest ring, in walking tiles from the yard
  WALL_R_MAX: 18, // largest ring considered
  RING_WALLS_SOFT: 60, // 36 §F: a cost weight, not a limit: rings longer than this score worse
  BASE_AREA_MIN: 150, // buildable tiles the base needs inside its ring
  HOME_MINE_DIST: 12, // gold within this walk of the yard is the home mine — kept inside (+3 tiles)
  OPENING_COST: 6, // ring score per tile that can't take a wall (forest, shallows, bridge, gold)
  GATES_MAX: 3, // gates (2 tiles wide each) on my routes: nearest enemy (main), the Citadel, outlying gold
  GATE_MERGE: 4, // routes crossing the ring this close (Manhattan) share one gate
  DEF_WALL_SPACING: 8, // extra pillboxes along the front wall stand at least this far apart
  DEF_HEAVY_SHARE: 0.35,
  DEF_BLOB_SHARE: 0.5,
  PLAN_REFRESH_TICKS: 900, // re-plan every 30 s until the first wall/gate commits the ring
  DEF_GOLD_RESERVE: 150, // walls, gates and core towers keep this much gold back (0 in DEFEND)
  DEF_EXTRA_RESERVE: 400, // extra towers wait until this much is left over after paying
  DEF_EXTRA_MIN_BUDGET: 0.1, // personalities below this defense budget build only core towers + walls
  WALLS_PER_TICK: 3, // wall tiles placed per operational tick
  // §K v4 base defense
  BASE_THREAT_MIN: 100, // enemy value inside my base that calls for a defense
  BASE_HOLD_ODDS: 1.6, // a committed army stays out only if what's home holds the threat at least this well
  BASE_DEFEND_RADIUS: 20, // with no wall planned, "my base" = this close to the yard
  BASE_WALL_SLACK: 3, // attackers this far outside my wall (chewing on it) count as inside the base
  GATE_POST_DEPTH: 4, // defenders muster this many tiles inside the main gate
  DEFEND_LOOSE_DIST: 15, // an army farther than this from the attack breaks formation and runs home at full speed
  // §H tech
  RESONANCE_AFTER_S: 720, // 32 §A: research Resonance Tapping after 12 min…
  RESONANCE_MINED_LEFT: 0.35, // …or once the gold I mine is down to this share
  RESONANCE_MIN_S: 480, // …but never before 8 min (an early home mine running low is the expansion rule's job)
  RESONANCE_SAVE_SLACK: 100, // 32 §D: saving for a step = its price + this
  TAP_GOLD_RESERVE: 300, // a Resonance Tap is placed only with this much left over
  TECH_INCOME_T1: 20,
  TECH_INCOME_T2: 35,
  ADV_VEHICLES_INCOME: 30,
  SIEGE_DEFSCORE: 25,
  STIMS_MEDICS: 3,
  // §I production
  MIX: { INF_FROM_RANGED: 0.8, INF_BASE: 0.3, RNG_FROM_HEAVY: 1.0, RNG_BASE: 0.2, HVY_FROM_INF: 0.8, HVY_BASE: 0.2 },
  SIEGE_SHARE_DEFSCORE: 25,
  MEDIC_PER_COMBAT: 8,
  SECOND_BARRACKS_FLOAT: 800,
  DEFAULT_MIX: { rusher: { infantry: 0.7, ranged: 0.3, heavy: 0 }, other: { infantry: 0.5, ranged: 0.3, heavy: 0.2 } },
  // §J squads
  HOMEGUARD_FRAC: 0.2,
  HOMEGUARD_FRAC_TURTLE: 0.4,
  RAID_SIZE: 4,
  RAID_INTERVAL_TICKS: [1200, 2100] as const,
  CITADEL_SQUAD_FRAC: 0.25,
  // §K attack/defense
  ATTACK_MIN_UNITS: 8,
  DEFENSE_IN_ATTACK: 0.7,
  FIGHT_ODDS: 0.9,
  RETREAT_ODDS: 0.6,
  RETREAT_CONFIRM_TICKS: 60, // 33 §F: a committed push retreats only on a losing read that lasts this long…
  ARRIVE_TILES: 10, // …counting members this much farther out (they arrive within seconds)
  LOCAL_ODDS_RADIUS: 12,
  WORKER_PULL_THREAT: 1.2,
  ROUT_ODDS: 0.35, // §K v2: below this, break formation and run home at full speed
  REGROUP_TICKS: 450, // §K v2: after a retreat, no new push for 15 s…
  REGROUP_GAIN: 1.25, // …and not until the squad has regrown to this × its value at the retreat
  REGROUP_ALLIN_FRAC: 0.5, // ALL_IN regroups for this share of REGROUP_TICKS and skips the regrow check
  GATHER_DIST: 14, // §K v2: a launched push first gathers this far from the objective (outside turret reach)…
  GATHER_RADIUS: 7, // …until this share of its value is within this of the gather point…
  GATHER_FRAC: 0.75,
  GATHER_TIMEOUT_TICKS: 600, // …or 20 s pass — then it engages as one body instead of a trickle
  PUSH_STALL_TICKS: 450, // 33 §F: a push that gets no closer for this long breaks formation and breaches loose
  PUSH_LOOSE_TICKS: 1800, // …for this long
  WALLED_RAZE_DIST: 26, // §K v2: vs a walled base, go loose (units chew blocking walls) from this far out
  RESPONSE_RADIUS: 22, // §K v2: enemy units within this of the push objective can respond in time
  // §K v2: launch when projected FightOdds ≥ 1 + (personality attackRatio − 1) × this. attackRatio was
  // tuned for the old gold-value ratio; on the Lanchester scale 1.4 is already a decisive edge.
  ATTACK_ODDS_SCALE: 0.5,
  FAR_ARMY_WEIGHT: 0.35, // §K v2: the rest of the target's army counts at this weight (it may come back)
  FINISH_YARD_FRAC: 0.4, // §K v2 finishing blow: a target yard below this HP fraction…
  FINISH_RADIUS: 14, // …within this of the squad…
  FINISH_ODDS: 0.45, // …is pressed home even at local odds down to this (an elimination is worth it)
  // 33 §F: the yard is the win condition (22 §W1) — once a push is in, it is THE objective
  VICTIM_W: { constructionYard: 12, warFactory: 4, barracks: 3.5, powerPlant: 2.5, POWER_CRIPPLE: 3, refinery: 2.5, lab: 2, defense: 1.5, other: 1 },
  COVER_NORM: 40, // §K v2: victim score ÷ (1 + covering defense DPS / this)
  DIST_NORM: 25, // §K v2: victim score ÷ (1 + distance from the squad / this)
  GUARD_RESPOND_ODDS: 0.8, // §J v2: HomeGuard leaves its post for a territory threat only at these odds
  RAID_RETREAT_ODDS: 1.2, // §J v2: raiders avoid fair fights — flee below these local odds
  // §J v3 scouting (needed now that the AI has fog of war): one fast unit re-checks the stalest point
  // of interest — enemy bases, unclaimed mines (expansions), the Citadel.
  SCOUT_INTERVAL_TICKS: 900, // a new scouting trip at most this often (× the tier's cadenceMult)
  SCOUT_STALE_TICKS: 1800, // a point is worth a look once unseen for this long (60 s)
  SCOUT_ARRIVE: 4, // tiles — close enough to count as "looked"
  SCOUT_FLEE_ODDS: 2.0, // the scout runs from anything but a trivially won fight
  // §K v3 look before you leap: a push objective unseen for longer than this is scouted first…
  ATTACK_INTEL_TICKS: 1350,
  ATTACK_INTEL_WAIT_TICKS: 900, // …waiting up to this long for the look; after that it launches anyway,
  STALE_INTEL_DISCOUNT: 0.8, // …but with projected odds × this (unknown defenders are assumed to exist)
  // §L formations
  FORMATION_COUNTERS: { line: "spear", spear: "box", box: "line", column: "line" } as const,
  REFORM_HOLES: 0.25,
  FLANK_DIST: 8,
  // §M citadel
  CITADEL_CONTEST: 0.8,
  CITADEL_ODDS: 1.0, // §M v2: contest only if projected FightOdds at the Citadel × citadelWeight ≥ this
  CITADEL_RADIUS: 10, // §M v2: radius used to read the fight around the Citadel
  CITADEL_RETRY_TICKS: 1800, // §M v4: after a Citadel squad falls back, no new one for 20 s (was re-sent every 0.5 s)
  REPEL_LINGER_TICKS: 150, // §K v4: a REPEL holds 5 s after the threat drops out of sight before main re-plans
  THREAT_MIX_WEIGHT: 2.0, // §I v2: enemy force near my territory weighs this × into the counter-mix
  POWERS: { ARTY_CLUSTER: 6, ARTY_RADIUS: 3, FRENZY_ODDS: [0.8, 1.2] as const, REPAIR_COUNT: 5, REPAIR_FRAC: 0.5, ION_CLUSTER: 12, ION_RESERVE_AT: 25, ION_GAP: 15 },
  // ── 33 §C economy (measured: a Refinery beside a mine ≈ ×5; 10 workers ≈ 29 g/s; mines last 2–5 min) ──
  ECON: {
    WORKERS_PER_MINE: 10, // crew per active mine (the measured knee of the saturation curve)
    BUILDER_SPARE: 2, // workers beyond the crews (builders, repairs)
    WORKER_CAP: 30,
    WORKER_CAP_FRAC: 0.33, // …and never more than this share of the unit cap
    WORKER_QUEUE: 2, // the yard keeps this many workers queued while below target
    WF_WORKER_DEFICIT: 6, // the War Factory helps train workers when the deficit is this large
    REFINERY_NEAR: 3, // a Refinery counts as "beside" a mine when its footprint is within this
    EXPAND_LEAD_S: 120, // start the next expansion when my active mines run dry within this
    EXPAND_FIRST_S: 150, // …or anyway after this, if a safe mine is free
    EXPAND_DIST_NORM: 15, // expansion pick: gold ÷ (1 + distance / this), ×INSIDE_BONUS inside my wall
    INSIDE_BONUS: 1.6,
    EXPAND_PARALLEL_INCOME: 45, // two projects at once above this income
    CREEP_MAX_STEPS: 6, // stepping stones per project
    PROJECT_STALL_TICKS: 2700, // a project that can't place a step for 90 s is dropped
    RICH_MINE_LEAD: 1.0, // a contested (central) mine needs my army ≥ this × the nearest enemy's est
    TAP_START_S: 300, // Resonance Tapping from 5 min…
    TAP_MINES_LEFT_S: 300, // …or earlier when projected mine gold ÷ income < this
    TAP_SOFT: 4, // 36 §F: Taps are unlimited; past this many, another only when the mines run dry or gold floats
    FLOAT_LIMIT: 1500, // gold above this with nothing to save for → more producers
    INCOME_WINDOW_TICKS: 1800, // my measured income: goldMined over the last 60 s
    MIL_SHARE: 0.6, // share of income an army is assumed to get (spend capacity, enemy growth)
    PRODUCER_RATE: 9, // g/s one Barracks / War Factory turns into units
    PRODUCERS_MIN: 2,
    PRODUCERS_MAX: 10,
    QUEUE_DEPTH: 2, // units queued per producer (gold in a queue is gold locked)
  },
  // ── 33 §B intel ──
  INTEL: {
    MIL_SHARE: 0.6, // unseen enemy growth: econEst × this per second since the last good look…
    UNSEEN_GROWTH_CAP: 4000, // …at most this much
    BANK_BURN: 15, // in the opening an enemy can also spend its starting bank: + this g/s…
    BANK_BURN_S: 300, // …for this long
    GOOD_LOOK_FRAC: 0.6, // a "good look" = at least this share of the known army in sight at once
    ECON_GUESS: 25, // g/s assumed for an enemy whose economy I haven't seen lately
    ECON_SEEN_TICKS: 3600, // "lately" = its main seen within 2 min
    ALERT_RADIUS: 45, // enemy fighters this close to my yard and closing raise an alert (at least;
    BASE_DEF_RADIUS: 18, // an enemy base's fortification = known towers this close to its yard
    ALERT_RADIUS_FRAC: 0.8, // or this share of the way from their base to mine, whichever is farther)…
    ALERT_MEMORY_TICKS: 900, // an alert outlives its sighting this long, the attackers' march extrapolated
    HOME_ALERT_RADIUS: 28, // …or this close whatever they're doing
    CLOSING_TILES: 2, // closing = distance to my yard fell this much since the last update
    ALERT_MIN_VALUE: 300, // smaller groups are a raid, not an alert
    DANGER_MEMORY_TICKS: 600, // a mine stays "in danger" 20 s after enemy fighters were seen there
    PEEK_DIST: 7, // the scout looks from this far short of its target
    FIRST_LOOK_DIST: 4, // 34 §M.3 a first look at a never-seen home stops this short (inside the scout's sight)
    // 39 whole-map scouting (Hard): the staleness map (commander/staleMap.ts)
    SWEEP: {
      CELL: 14, // tiles a side
      NEAR_HOME: 16, // cells this close to my base are mine to see…
      NEAR_RIVAL: 22, // …and this close to a rival's, the looks at their base cover (the corner behind it is no news)
      AGE_CAP: 20000, // ticks: never seen counts as this old (as the points of interest do)
      MIN_AGE_TICKS: 3600, // a cell is worth a trip once unseen 2 min
      LANE_DIST: 12, // a cell this close to the line from my base to a rival's is on a lane…
      LANE_W: 1.5, // …and weighs this much more
      IMP: 0.6, // against the points of interest (a rival's main 2–3, a mine 1)
      TOP: 3, // the stalest few join the scout's pick
    },
    SENTRY_OUT: 22, // sentries stand this far beyond my wall, toward the nearest enemies
    SENTRY_MAX: 2,
    SENTRY_FLEE_DIST: 9, // a sentry falls back from enemy fighters this close…
    SENTRY_RETURN_TICKS: 600, // …and returns to its post this much later
    SENTRY_MIN_ARMY: 6, // sentries are posted once main has this many fighters
  },
  // ── 33 §D priorities (the budget arbiter) ──
  PRIO: {
    SAVE_PRIO: 60, // an unaffordable request at least this important is saved for
    INVEST_WHILE_SHORT: 44, // 34 §E.6: investments drop to this (below every unit) while the army is short
    SAVE_LEAK: 85, // requests at least this important may still spend into the savings (workers, power)
    SITES_BASE: 2, // concurrent construction sites…
    SITES_PER_WORKERS: 8, // …+1 per this many workers
    SITE_SLACK: 1, // economy / survival requests may use this many more
  },
  // ── 33 §E defense ──
  DEFENSE2: {
    MIN_ARMY_BASE: 600, // desired army floor: this…
    MIN_ARMY_PER_MIN: 250, // …+ this per minute of match time…
    MIN_ARMY_MAX: 4000, // …up to this
    FFA_SECOND_W: 0.35, // the second-strongest enemy counts this much toward the threat
    DEF_ARMY_CREDIT: 0.6, // my powered towers' gold value counts this much toward the desired army
    DEFEND_DANGER: 0.55, // DEFEND posture at this danger…
    DEFEND_EXIT_DANGER: 0.25, // …until it falls below this
    ALERT_ETA_S: 40, // an alert arriving within this counts toward DEFEND
    ADAPTIVE_MAX: 2, // adaptive counter towers per attacked approach
    HIT_MERGE: 8, // attack points this close merge
    HIT_HALF_LIFE_TICKS: 5400, // attack-point weight halves every 3 min
    HIT_TOWER_WEIGHT: 2, // an approach needs this much weight before it gets an adaptive tower
    EMERGENCY_GAP_TICKS: 900, // one emergency tower per 30 s at most
    EMERGENCY_MIN_ETA_S: 12, // only if the attack is at least this far away (a tower takes 10–20 s)
    ANCHOR_RADIUS: 9, // defense anchor: the strongest tower group within this of the line threat→yard
    EVAC_TICKS: 600, // an evacuated mine is left alone this long
    RAID_MIN_ARMY: 1500, // Hard personalities raid once their army is worth this much
  },
  // 34 §W.1 the field manual, applied by the captains
  MANUAL: {
    ENGAGE_SCAN: 12, // tiles: a unit with no foe this close gets no micro
    BLIND_MARGIN: 1.5, // artillery steps away from a foe within its blind ring + this
    ARTY_STEP: 4, // tiles artillery steps back
    KITE_MARGIN: 1.2, // a kiter steps away when its foe is within the foe's range + this
    KITE_STEP: 2.5, // tiles a kiter steps back
  },
  // 34 §M the match as a campaign (the King's estimate, strategies, windows, FFA politics, AAR)
  CAMPAIGN: {
    // 34 §M.1 the situation estimate
    LOG_EVERY_S: 60, // the estimate is logged this often
    TRADE_WINDOW_S: 300, // trade = value killed ÷ value lost in the battles of this window
    TRADE_PRIOR: 300, // gold added to both sides of the trade ratio (no battles → 1.0)
    AHEAD: 1.1, // a measure at least this (mine ÷ theirs) is "ahead"
    BEHIND: 0.8, // … at most this is "behind"
    TIME_ME: 1.12, // income × tech above this: a long war favours me
    TIME_THEM: 0.89, // … below this: it favours them
    TECH_WEIGHT: 0.15, // each tech tier of difference moves the time read by this much
    INCOME_MEMORY_S: 180, // the income an enemy army's seen growth proved fades over about this long
    OPENING_S: 180, // the opening book (the plan) runs unmodified this long
    // 34 §M.2 grand strategies
    SWITCH_HOLD_S: 30, // a new strategy must be pointed at this long…
    SWITCH_MIN_S: 90, // …and the last switch be this old (hysteresis)
    SMOOTH_S: 30, // the income and army ratios are smoothed over about this long
    STRANGLE_SOURCES: 3, // their income comes from at most this many refineries and Taps
    ATTRITION_MAX_ARMY: 2, // time on my side → attrition, unless my army is this far ahead (then the plan presses)
    COMEBACK_ARMY: 0.7, // comeback: my army at most this share of theirs…
    COMEBACK_MEASURES: 3, // …and behind on at least this many of worth, income, army, trade
    // PRESSURE takes my army > attackRatio × their estimate × this (0 = never by the table)
    PRESS_MUL: { plan: 1, decisive: 0.85, attrition: 1.15, strangulation: 1, fortress: 0, opportunism: 1, comeback: 0 },
    // the Marshal's launch odds and the plan's strike nerve × this
    NEED_MUL: { plan: 1, decisive: 0.92, attrition: 1.15, strangulation: 1, fortress: 1.1, opportunism: 1, comeback: 1.25 },
    // the strategy's priority lean per petition category (on top of the plan phase's lean)
    LEAN: { plan: {}, decisive: { military: 6 }, attrition: { defense: 3, eco: 2 }, strangulation: { military: 3 }, fortress: { defense: 6, invest: 6 }, opportunism: { eco: 2 }, comeback: { defense: 4, military: 3, invest: -4 } },
    STRANGLE_ECON_W: 3, // strangulation: refineries and Taps weigh this much more as the push's victim
    RAID_FASTER: 0.5, // strangulation / comeback: the raid's rest between raids × this
    // 34 §M.6 windows
    COUNTERPUNCH_S: 45, // the window to strike after winning a defense
    COUNTER_DROP: 0.4, // a defense is won when the attacker's known army fell by this share…
    COUNTER_CLEAR_S: 6, // …and my territory has been clear this long
    SPIKE_S: 60, // my spike / their spike coming: the window's length
    SPIKE_PRESS_MUL: 0.85, // PRESSURE threshold × this while a spike window is open
    // 34 §M.9 FFA politics
    BRAWL_R: 9, // two enemies' fighters this close are fighting each other…
    BRAWL_MIN: 3, // …with at least this many of each in sight
    BRAWL_END_S: 8, // a brawl not seen for this long is over
    THIRDPARTY_S: 60, // strike the weakened winner (or the exposed loser) within this
    LEADER_RATIO: 1.5, // an enemy worth this × the next one is the runaway leader…
    LEADER_ME_FRAC: 0.8, // …if it is also worth at least this share of me
    // 34 §M.11 after-action review
    AAR_MIN_VALUE: 400, // the least value traded (both sides) for a fight to get a record
    AAR_GAP_S: 6, // a fight is over after this long without contact
    AAR_R: 9, // enemy fighters this close to a squad's units are in its fight
    AAR_KEEP: 40, // records kept
    // 34 §M counter-intelligence (§M.4) and the insurance yard (§M.7)
    HUNT_TERRITORY: 14, // enemy units this close to one of my structures are in my territory…
    HUNT_ARMY_R: 12, // …or this close to my main army: eyes worth hunting
    HUNT_GROUP_R: 8, // an eye's company: enemy fighters this close to it
    HUNT_MAX_GROUP: 450, // a company worth more than this is a raid or an army (the Warden's, the Marshal's), not eyes
    HUNT_ODDS: 1.5, // hunters bring at least this × the quarry's value…
    HUNT_MIN: 2, // …and at least this many units…
    HUNT_MAX: 4, // …and at most this many
    HUNT_LINGER_TICKS: 300, // an eye about my base this long keeps watch (the hunt's quarry); a scout passing through is not hunted
    HUNT_RECRUIT_R: 30, // hunters are taken only from units of mine this close to the quarry
    HUNT_LEASH: 10, // a hunter turns back this far outside my territory (HUNT_TERRITORY of a structure)
    HUNT_MEMORY_TICKS: 150, // an eye that slips out of sight is looked for at its last spot this long
    HUNT_SCREEN_R: 9, // the hunt screens the army this far out toward an eye still out of its sight (and pickets there between quarries)…
    HUNT_SCREEN_SLACK: 3, // …and chases the eye only once it is within the screen + this
    HUNT_EYES_RECENT_TICKS: 1800, // …until none has been seen for this long (then it disbands)
    SEEN_ARMY_FRAC: 0.25, // an enemy saw my army when this share of its value stood inside their units' sight
    HEAT_CELL: 8, // tiles per cell of the "where their eyes have been" map
    HEAT_HALF_LIFE_S: 180, // a sighting there weighs half after this long
    EXPOSED_LOG_TICKS: 900, // "they see my army" is logged at most this often
    INSURANCE_MID_S: 360, // the middle game (34 §M.3): from here the Treasurer saves for a second yard…
    INSURANCE_PRIO: 62, // …at this priority (≥ SAVE_PRIO: saved for; an "invest", so not while defending or short)
    INSURANCE_EMERGENCY_PRIO: 96, // under a winning attack it goes ahead of everything, and is saved for
    INSURANCE_THREAT_MIN: 400, // an attack inside my main base this big…
    INSURANCE_HOLD_ODDS: 1.0, // …that what is home holds below these odds is winning…
    INSURANCE_YARD_HP: 0.6, // …as is any attack once the main yard is below this hp share
    INSURANCE_BEHIND: 1.0, // the war goes badly: my army below this × the strongest enemy's estimate
    INSURANCE_MIN_DIST: 16, // tiles from the main yard: away from the main base
    INSURANCE_EMERGENCY_DIST: 10, // in an emergency, the least distance accepted when nothing farther is legal
    INSURANCE_THREAT_CLEAR: 14, // the yard is placed at least this far from the attack
    INSURANCE_SPOT_TICKS: 900, // the chosen spot is re-scored this often
    INSURANCE_CREW: 3, // workers sent to raise it
  },
  // 34 §W.8 standoffs and dances
  STANDOFF: {
    RANGE: 14, // a force this close to my main army, facing it…
    SECONDS: 30, // …this long with little blood traded is a standoff
    TRADE: 150, // gold value lost (both sides) that means they are fighting, not facing off
    DANCE_CYCLES: 2, // advance-then-back cycles in one standoff that make it a dance
    DANCE_FORGET_S: 120, // the cycle count lapses after this long without facing anyone
    STEP_S: 15, // seconds on each rung of the ladder
    MIN_FRAC: 0.4, // a force worth less than this share of mine is not a standoff (it is a target)
    GROUND_SCAN: 6, // tiles searched for a hill or forest to stand on
    MIN_GAP: 8, // a standoff starts only this far apart (closer, they are in contact: the retreat rule decides)
    COMMIT_MARGIN: 1.15, // odds this far above FIGHT_ODDS skip the waiting rungs and commit at once
  },
  // 34 §W.9 battle craft
  BATTLE: {
    ROAD_BAND: 6, // tiles either side of a road that count as "on it"
    TRICKLE_MIN: 4, // stragglers walk past enemies on the road only as a group this big…
    TRICKLE_FRAC: 0.25, // …worth this share of the squad
    DETOUR: 10, // a retreat passes this many tiles beside a force on its road home
    WOUNDED_FRAC: 0.3, // a loose unit below this hp share steps back to its medics
  },
  // 34 §W.4–5 operations and counter-craft
  OPS: {
    OP_COOLDOWN_S: 90, // a non-direct operation can't be chosen again within this
    OP_MAX_S: 150, // an operation's state is dropped this long after its strike went in
    FEINT_MIN_RAIDERS: 2,
    FEINT_MIN_DIST: 14, // tiles from their home: a mine this far makes a feint target
    FEINT_WAIT_S: 20, // the main army waits this long for the feint to draw their army
    SIEGE_SCAN: 14, // towers within this of the objective count for a siege
    SIEGE_MIN_ARTILLERY: 2,
    SIEGE_MIN_TOWERS: 2,
    SIEGE_ENGAGE: 6, // the siege takes over this far outside a tower's reach
    SIEGE_SCREEN_MARGIN: 2.5, // the screen stands this far outside the tower's reach
    SIEGE_MAX_S: 90,
    CHASE_MAX: 10, // tiles past my territory a defender may chase before it is called back
    RAID_ROTATE: 8, // a raid scores the spot it just hit this much worse (tiles-equivalent)
    // 39 the back door: their towers watch the front; go round and strike where they don't
    BACKDOOR_MIN_FRONT: 20, // known tower fire (dps) along the front approach worth going round (a turret is 25)
    BACKDOOR_BACK_FRAC: 0.5, // the back approach must face at most this share of it
    BACKDOOR_MIN_TURN: 4, // bearings (of 16) between the front and the back: 90° at least
    BACKDOOR_DETOUR: 2.0, // the way round may be this many times the direct march (+ 20 tiles)
    BACKDOOR_FRESH_S: 90, // the back approach must have been seen this recently (else the Spymaster looks first…)
    BACKDOOR_LOOK_WAIT_S: 50, // …the launch waiting this long for the look (a Spy may have to walk round)
    BACKDOOR_RING_PAD: 3, // the way round keeps this far outside every known tower's reach
    BACKDOOR_RING_MAX: 34, // …and no farther out than this from the objective
    BACKDOOR_ARRIVE: 5, // a leg is walked when the army's center is this close to its waypoint
    BACKDOOR_MAX_S: 120, // the detour gives up (and strikes from where it is) after this
  },
  // 34 the Council (§H dials)
  COUNCIL: {
    CONF_HALF_LIFE_S: 60, // a good look loses half its weight in this long
    CONF_TO_STRIKE: 0.55, // the least confidence for a decisive launch that is a close call…
    CONF_MARGIN: 1.25, // …i.e. whose odds against the (pessimistic) estimate are below need × this
    LOCATE_S: 45, // an army unseen this long is "not located"
    ROUTE_BAND: 12, // tiles either side of the launch route that count as "on the route"
    EVAC_ODDS: 1.2, // evacuate a mine when the Warden's odds there are below this
    EVAC_LEAD_S: 8, // leave this many seconds before a raid's ETA
    SHORT_FRAC: 0.2, // shortfall (share of desired) above which investments may not be saved for
    RULINGS_KEEP: 40,
    PLAN_MIN_GAP_S: 30,
    MINE_WARN_RADIUS: 24, // enemy fighters this close to a worked mine and closing are a raid warning
    MINE_WARN_MIN: 200, // …worth at least this much
    SHORT_DANGER: 0.25, // §E.6: a stronger target counts as a reason to hold investments only at this danger
    UNLOCATED_HOLD: 0.5, // launching while their army is not located: home (guard + towers) must hold its est this well
    VETO_LOG_TICKS: 900,
    PROFILE_MIN_SAMPLES: 2, // 34 §W.3 observations before an operation may rely on a profile trait
    OVERREACT_RATIO: 1.5, // they answer a raid with ≥ this × its value: feints work
    TURTLE_TOWERS: 8, // known towers that make an enemy a turtle
    ATTACK_MIN_VALUE: 400, // an incoming army worth this counts as an attack (aggression, routes)
    // sightings closer than this are the same attack (39: 40 s, was 60 s — with the whole-map sweep a wave is
    // seen earlier on its way in, and 60 s merged waves sent 70 s apart into one attack)
    ATTACK_GAP_TICKS: 1200,
 // the same veto is written to the AI log at most this often
  },
  // 36 the Architect (engine/commander/architect.ts)
  ARCH: {
    NO_WALL_S: 90, // no wall before this unless in danger
    L1_S: 240, // layer 1 by this time at the latest (Turtle / Rusher below)
    L1_TURTLE_S: 120,
    L1_RUSHER_S: 360,
    SIGHT_RANGE: 20, // an enemy army seen this far outside my wall, this recently, raises layer 1
    SIGHT_S: 20,
    L2_TURTLE_S: 420, // Turtle / fortress strategy: layer 2 from here
    L2_S: 600, // others: from here, when hit, outmatched or floating gold
    L2_HIT_W: 1.5,
    L2_STRONGER: 1.15,
    L3_S: 1080,
    LAYER_DONE: 0.8, // a layer counts as built at this share of its walls and gates
    GAP_MIN: 4, // an outer ring lies this many walking tiles beyond the previous one…
    GAP_MAX: 9, // …at most this many
    POCKET_MAX: 6, // free tiles an outer ring may leave cut off between the rings
    EXTRA_GATES: 3, // gates an outer ring may add for ground between the rings no route gate reaches
    WALL_BATCH: 6, // wall tiles asked for per layer per session
    WALL_SITE_SHARE: 4, // wall / gate sites per construction slot
    WALL_CREW_PER: 6, // at most one wall builder per this many workers (at least 2)
    WALL_PRIO: [58, 50, 46], // layer 1, 2, 3 …
    WALL_PRIO_D: [20, 15, 10], // … + this × danger
    FORT_BONUS: 10, // the Turtle and the fortress strategy
    WALL_RAMP_PER_MIN: 6, // a commissioned ring still unfinished gains this much priority per minute…
    WALL_RAMP_MAX: 30, // …up to this, so a war's unit spending can't starve it for good
    // …but never to SAVE_LEAK (85): a wall may be saved for, never spend into what is saved for another
    // request (a Tap). Measured: capped at 72 instead, ring 1 of the Boomer and the Turtle stalled at 0%
    // in 2 of 9 sweeps and the Turtle lost 2 of 3 to the Techer
    WALL_PRIO_MAX: 83,
    OUTER_TOWER_PRIO: 42,
    OUTPOSTS_MAX: 4,
    OUTPOST_PRIO: 44,
    OUTPOST_STRAT_S: 600, // attrition / strangulation / fortress: corridor outposts from here
    CANDIDATES: 40, // best-scored sites given the (costlier) flow check
    NO_SPOT_LOG_TICKS: 900,
  },
  // 37 the King's feelings (engine/commander/feelings.ts)
  FEEL: {
    FROM_S: 180, // no fear, confidence, greed or desperation before this: the opening's estimates are guesses
    FURY_S: 180, // fury lasts this long (renewed by a new offence)
    GRATITUDE_S: 240, // after a treaty ends, the partner is not my first target for this long
    // how fast a feeling fades once its cause is gone (time constant, s); it rises at RISE per update
    TAU_S: { fear: 90, confidence: 60, desperation: 120, suspicion: 120, greed: 90 },
    RISE: 0.5,
    SHOW: 0.25, // a feeling is shown (overlay, card) and logged from this strength…
    HIDE: 0.15, // …and stays shown down to this
    // the strongest enemy's worth (believed army + buildings) ÷ mine: no fear … full fear. Worth, not army:
    // a booming economy fields a small army by design (measured: read on armies, the Boomer was afraid at
    // 2:00 every game, spent on towers, and lost all three duels to the Opportunist it otherwise drew)
    FEAR_RATIO: [1.3, 2.4] as const,
    FEAR_ANNOUNCED: 0.6, // 38: the most fear an announced dominant player inspires (public news, seen or not)
    FEAR_ANNOUNCED_RATIO: [1.3, 3.0] as const, // …ramped on its announced strength over mine
    FEAR_LOSS: 350, // value lost in the last minute's battles (and at 1.5× what I killed) that frightens
    CONF_RATIO: [1.15, 2.0] as const, // min(army ratio, trade ratio) vs the target: no confidence … full
    SUSP_PER_EYE: 0.1, // suspicion per enemy eye seen in my territory per session
    GREED_INCOME: [1.15, 1.75] as const, // their income ÷ mine: no greed … full greed
    DESPERATE_ARMY: 0.4, // my army ÷ the strongest enemy's under this, with fear, is desperate
    DESPERATE_ALLIN_S: 60, // a hot-headed King's all-in when desperate lasts this long…
    DESPERATE_GAP_S: 240, // …at most once per this
    // effects (each × the feeling's strength)
    FURY_NEED: 0.15, // launch odds against the one I'm furious at × (1 − this)
    FURY_PRESS: 0.2, // and the PRESSURE bar × (1 − this)
    FEAR_PRESS: 0.35, // the PRESSURE bar × (1 + this)
    FEAR_NEED: 0.12,
    CONF_PRESS: 0.25, // the PRESSURE bar × (1 − this)
    CONF_NEED: 0.1,
    CONF_HOLD: 0.12, // the retreat odds × (1 − this): a confident army holds the field longer
    FEAR_HOLD: 0.1, // × (1 + this)
    LEAN: { fear: { defense: 10, survival: 4 }, confidence: { military: 6 }, fury: { military: 8 }, desperation: { survival: 10 } },
    FEAR_FORT: 0.55, // fear this strong raises the fortification level as if the enemy were at the door
    SUSP_SENTRY: 0.5, // suspicion this strong posts a second sentry toward them and hunts their scouts on sight
    GREED_RAID: 0.5, // greed this strong sends the raids at their economy
    TARGET_W: { fury: 100, gratitude: 3, greed: 0.8 }, // pickTarget: fury wins outright; gratitude −; greed +
    // personality: how strongly each feeling takes this King
    TEMPER: {
      rusher: { fury: 1.3, fear: 0.6, confidence: 1.3, suspicion: 0.8, greed: 1.0, desperation: 1.0 },
      boomer: { fury: 1.0, fear: 1.0, confidence: 0.9, suspicion: 1.0, greed: 1.1, desperation: 1.0 },
      turtle: { fury: 0.9, fear: 1.4, confidence: 0.7, suspicion: 1.3, greed: 0.6, desperation: 1.0 },
      techer: { fury: 1.0, fear: 1.1, confidence: 1.0, suspicion: 1.1, greed: 0.8, desperation: 1.0 },
      opportunist: { fury: 0.9, fear: 0.9, confidence: 1.1, suspicion: 1.0, greed: 1.5, desperation: 1.0 },
    },
    HOTHEADS: ["rusher", "opportunist"] as string[], // desperation → all-in; the others seek a deal and dig in
  },
  // 39 the Spymaster's Spies (spies.ts)
  SPIES: {
    FROM_S: 180, // none bought in the opening
    WANT_HARD: 2,
    WANT_MEDIUM: 1,
    PRIO: 52, // an investment: after the army's needs, before floating gold
    POST_MIN: 6, // a post this far from their base at least (sight 8 still reaches its edge)…
    POST_MAX: 26, // …and at most
    POST_OUT: 2, // tiles of margin beyond a known tower's reach + the reveal pad
    REPOST_S: 45, // look for a better (closer, still safe) post this often
    FLEE: 8, // seen: back off this far straight out from their base (a tower's reach is 7–11 + the pad)
    STAGE_OUT: 2, // a new post is reached along its own bearing, from this far beyond POST_MAX
    DEPTH_PAD: 3, // seen at r tiles from their base: posts on that bearing stand r + this out from now on (r + 1 on its neighbours)
    DEPTH_FORGET_S: 300, // a rival's reveal map is forgotten this long after its last reveal (towers fall, bases move)
    FLEE_MAX_S: 8, // a retreat ends at its point, or after this long (blocked)
  },
  // §B personalities — parameter sets, not code (firstPush = Infinity: never initiates).
  PERSONALITIES: {
    rusher: { workers: 6, safety: 1.0, firstPush: 600, attackRatio: 1.1, defenseBudget: 0.05, techBudget: 0.05, raidSquads: 1, citadelWeight: 0.6, strikeOdds: 1.15, trustEst: 0.6, cunning: 0.2 },
    boomer: { workers: 12, safety: 0.8, firstPush: 1500, attackRatio: 1.4, defenseBudget: 0.1, techBudget: 0.15, raidSquads: 1, citadelWeight: 0.8, strikeOdds: 1.35, trustEst: 0.9, cunning: 0.5 },
    turtle: { workers: 8, safety: 0.9, firstPush: Infinity, attackRatio: 1.6, defenseBudget: 0.3, techBudget: 0.15, raidSquads: 0, citadelWeight: 0.7, strikeOdds: 1.6, trustEst: 1.0, cunning: 0.6 },
    techer: { workers: 9, safety: 0.9, firstPush: 1200, attackRatio: 1.3, defenseBudget: 0.12, techBudget: 0.35, raidSquads: 1, citadelWeight: 1.0, strikeOdds: 1.3, trustEst: 0.9, cunning: 0.4 },
    opportunist: { workers: 8, safety: 0.9, firstPush: 900, attackRatio: 1.2, defenseBudget: 0.1, techBudget: 0.12, raidSquads: 2, citadelWeight: 1.3, strikeOdds: 1.2, trustEst: 0.8, cunning: 0.9 },
  },
  // §N difficulty tiers (EASY = the old simple AI, untouched).
  TIERS: {
    medium: { cadenceMult: 1.5, personalities: ["boomer", "turtle"] as const, fullAdaptation: false, flanking: false, raids: false },
    hard: { cadenceMult: 1.0, personalities: ["rusher", "boomer", "turtle", "techer", "opportunist"] as const, fullAdaptation: true, flanking: true, raids: true },
  },
  HARD_INCOME_MULT: 1.0, // optional handicap dial — default OFF: smart, not rich
  LOG_SIZE: 50, // §O AI_LOG ring buffer
} as const;

// ── Camera (02-map.md) ──────────────────────────────────────────────────────
export const CAMERA = {
  panSpeed: 900, // screen px/s via keyboard (fallback default; overridable via Settings §H)
  minZoom: 0.4,
  maxZoom: 2.0,
  zoomStep: 0.12,
  dragThreshold: 6, // px of movement before a left-drag becomes a selection box
  edgeBand: 14, // px from a viewport edge that triggers edge-scroll (when enabled in Settings)
  overscroll: 0.5, // 02-map: share of the viewport the view may run past each map edge (0.5 = an edge can reach the screen centre)
} as const;

// User settings (18 §H) — local, no accounts; persisted in localStorage. Defaults live here so every
// tunable stays in constants. cameraScrollSpeed is in TILES/s and applied as tiles*TILE_SIZE screen px.
export const SETTINGS_DEFAULTS = {
  username: "Player",
  preferredColor: "blue" as ColorKey, // maps through COLOR_KEYS → COLORS.players
  masterVolume: 0.45, // 0..1 — matches AudioManager's prior fixed volume
  muted: false,
  cameraScrollSpeed: 28, // tiles/s (≈ the prior 900 px/s at TILE_SIZE 32)
  edgeScroll: true, // 30 §B: on by default — keyboard panning is arrows only now (WASD are grid keys)
  hudScale: 1, // 30 §A: user HUD size multiplier on top of the automatic resolution scale
} as const;
export const SETTINGS_LIMITS = {
  usernameMax: 20,
  volumeMin: 0, volumeMax: 1,
  scrollMin: 8, scrollMax: 60, // tiles/s slider range
  hudScaleMin: 0.8, hudScaleMax: 1.25,
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
  WORLD_TIP_DELAY_MS: 350, // 30 §F: rest the cursor on a building this long before its tooltip shows
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
  // 28: story screens reuse the existing art until bespoke backgrounds exist.
  campaign: "/backgrounds/menu.png",
  briefing: "/backgrounds/skirmish.png",
  codex: "/backgrounds/settings.png",
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
